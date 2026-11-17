'use strict';
/* =====================================================================
   オンライン対戦（サーバーなし。WebRTC のデータチャネルで2人のブラウザを直接つなぐ）
   - つなぎ方：ホストが「招待コード」を作って相手に送り、ゲストが「返信コード」を作って送り返す（Discord などで貼り合う）。
     コードの中身は WebRTC の接続情報（SDP）を圧縮したもの。仲介サーバーは使わない（アドレスを調べる公開 STUN だけ使う）
   - 進め方：ホストだけがゲームを進める。ゲストは操作 {type,payload} をホストへ送り、ホストが act() を実行して
     状態 G と、その操作で出た演出イベントをゲストへ送る。ゲストは受け取った G をそのまま表示する（乱数の同期は要らない）
   - データ：ホストのキャラクターデータ（エディタで反映したものも含む）を最初に送り、ゲストは対戦中だけそれを使う（setNetData）
   - ホスト＝プレイヤー0、ゲスト＝プレイヤー1。編成はホスト→ゲストの順（ローカル対戦と同じ流れ）
   - 再接続：対戦中に切れたら、対戦をそのまま残して「中断」（NET.hold）にする。両方とも操作できなくなり、再接続の窓（netHoldHTML）で
     もう一度コードを送り合うと、ホストが今の状態を送り直して続きから再開する。ゲストがページを読み込み直したときは「部屋に入る」から入り直せば同じ。
     ホストが読み込み直したときは、同じタブなら保存した対戦（game-ui.js の saveMatch）から中断の状態で戻る。
     「タイトルに戻る」で自分から抜けたときだけ、相手側も対戦を終える
   engine.js の act() が netAct / netTapOn / netSync を呼ぶ。画面の状態は UI.net（接続の画面）と UI.netMsg（お知らせ）
   ===================================================================== */
const NET_VER = 1;                 // 通信の形式が変わったら上げる（違う版同士はつながない）
const NET_FRAME = 4000;            // 1回に送る文字数（長いメッセージは分けて送る）
const NET_ICE = [{urls:['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302']}];
const NET_HIGH = 1<<20;            // 送信待ちがこれ（バイト）を超えたら、減るまで次を送らない
// hold＝中断中（接続が切れたが対戦は残している。{msg,diag}）
const NET = { on:false, hold:null, me:0, pc:null, dc:null, remote:false, ng:null, logSent:0, lastNg:null, buf:'', q:[], tries:0, lastErr:'', sent:0, got:0 };
const netOn = ()=>NET.on||!!NET.hold; // オンライン対戦の最中（中断中も含む）
const netMe = ()=>netOn()?NET.me:0;
// 相手が操作する番（自分は待つ）。編成中も含む。中断中はどちらも操作できない
const netWaiting = ()=>!!NET.hold||NET.on&&!['mode','over','init','stage'].includes(G.phase)&&actor()!==NET.me;
// ゲストからは受け付けない操作（部屋の設定・ひとり用のもの）
const NET_BAN = ['restart','useDefaultData','setRule','toggleHandicap','chooseMode','scnBattle','arcadeGo','arcadeNext','arcadeContinue','toggleSpeed'];

// ---------- engine.js の act() から呼ばれる ----------
// true を返すと、その操作はここで終わり（エンジンでは実行しない）
function netAct(type,p){
  if(!netOn()) return false;
  if(type==='restart'){ netLeave(); return false; }
  if(NET.hold) return true;                                 // 中断中：つなぎ直すまで何も進めない         // タイトルに戻る＝退出。このあとふつうに newGame する
  if(NET.me===1){ netSend({t:'a',type,p}); return true; }   // ゲスト：ホストへ送るだけ
  if(NET.remote) return false;                              // ホスト：ゲストから届いた操作を実行中
  return type!=='rematch'&&netWaiting();                    // ホスト：相手の番の操作は捨てる
}
const netTapOn = ()=>NET.on&&NET.me===0;
// ホスト：操作のあとの状態と演出を送る。ログは増えたぶんだけ（lb＝ここまでは前と同じ）
function netSync(fx){
  const {log:lg,...g}=G, fresh=NET.lastNg!==NEWGAME_N||lg.length<NET.logSent, lb=fresh?0:NET.logSent;
  NET.logSent=lg.length; NET.lastNg=NEWGAME_N;
  netSend({t:'s',ng:NEWGAME_N,g,lb,ln:lg.slice(lb),fx});
}
// ゲスト：届いた状態を反映する。演出はホストと同じ順で FXQ に積み直す（表示の遅らせ方も fxEmit が同じように作る）
function netApply(m){
  const old=G.log||[];
  if(m.ng!==NET.ng){ // 新しい対戦：残っている演出を消す
    NET.ng=m.ng; FXQ.length=0; for(const k in FXHOLD) delete FXHOLD[k]; FXHIDE.clear(); KO_PEND.length=0; PRE={}; SYNCED={};
    if(typeof fxClear==='function') fxClear();
  }else snapPre();
  G=m.g; G.log=(m.lb?old.slice(0,m.lb):[]).concat(m.ln||[]);
  G.speed=(typeof window!=='undefined'&&window.SPEED_PREF)||700; // 進行速度は自分の設定
  (m.fx||[]).forEach(ev=>{ if(ev.t==='roll'&&ev.keys) ev.keys.forEach(k=>FXHIDE.add(k)); fxEmit(ev); });
  render();
}

// ---------- 送受信 ----------
// 長いメッセージは分けて順番待ち（NET.q）に入れ、送信待ちが溜まりすぎないように少しずつ送る。
// 送信に失敗したら少し待ってやり直し、続けて失敗したときだけ切断扱いにする（原因はお知らせの「詳細」に出す）
function netSend(obj){
  const dc=NET.dc; if(!dc||dc.readyState!=='open') return;
  let s; try{ s=JSON.stringify(obj); }catch(e){ netFail('送るデータを作れませんでした',e); return; }
  for(let i=0;i<s.length;i+=NET_FRAME) NET.q.push((i+NET_FRAME>=s.length?'F':'P')+s.slice(i,i+NET_FRAME));
  netPump();
}
function netPump(){
  const dc=NET.dc; if(!dc||dc.readyState!=='open') return;
  clearTimeout(NET.pumpT);
  while(NET.q.length){
    if(dc.bufferedAmount>NET_HIGH){ dc.bufferedAmountLowThreshold=NET_HIGH>>2; dc.onbufferedamountlow=netPump; return; }
    try{ dc.send(NET.q[0]); NET.q.shift(); NET.tries=0; NET.sent++; }
    catch(e){
      if(++NET.tries>20){ netFail('データを送れませんでした',e); return; }
      NET.pumpT=setTimeout(netPump,150); return;
    }
  }
}
const netErrText = e=>e?`${e.name||'Error'}: ${e.message||e}${e.sctpCauseCode!=null?`（sctp ${e.sctpCauseCode}）`:''}${e.errorDetail?`（${e.errorDetail}）`:''}`:'';
function netFail(msg,e){ console.error('[net]',msg,e); NET.lastErr=netErrText(e)||NET.lastErr; netDrop(msg); }
// 切れたときの状況（お知らせの「詳細」。原因を調べる手がかり）
function netDiag(){
  const pc=NET.pc, dc=NET.dc, a=[];
  try{
    a.push(NET.me?'ゲスト':'ホスト', `場面 ${G.phase}${G.turn?`・ターン${G.turn}`:''}`);
    if(pc) a.push(`接続 ${pc.connectionState}/${pc.iceConnectionState}`);
    if(dc) a.push(`チャネル ${dc.readyState}`, `送信待ち ${dc.bufferedAmount}B＋${NET.q.length}件`);
    a.push(`送信 ${NET.sent}・受信 ${NET.got}`);
    if(NET.lastErr) a.push(NET.lastErr);
  }catch(e){}
  return a.join(' ／ ');
}
function netRecv(data){
  if(typeof data!=='string') return;
  NET.got++;
  NET.buf+=data.slice(1); if(data[0]!=='F') return;
  let m; try{ m=JSON.parse(NET.buf); }catch(e){ m=null; NET.lastErr='受信データを読めませんでした（'+netErrText(e)+'）'; console.error('[net] parse',e); } NET.buf='';
  if(!m) return;
  if(m.t==='bye'){ if(m.re) netDrop('相手のページが閉じられました（読み込み直し・終了）'); else netDrop('相手が退出しました',true); return; } // re＝ページを閉じた（戻ってくるかもしれない）
  if(NET.me===1){
    if(m.t==='hello'){
      if(m.v!==NET_VER||!Array.isArray(m.units)||!Array.isArray(m.masters)){ netDrop('ゲームの版が合いません。2人ともページを読み込み直してください',true); return; }
      NET.hold=null; UI.netMsg=null; UI.netDiag=null;
      setNetData({units:m.units,masters:m.masters}); UI.net=null; UI.nav={s:'top',step:'rule'}; SHOW_IDS=null; render();
    }else if(m.t==='s'&&m.g){ try{ netApply(m); }catch(e){ netFail('受け取った状態を表示できませんでした',e); } }
    return;
  }
  // ホスト：ゲストの操作。ゲストの番（決着後は「もう一度」だけ）で、許された操作だけ実行する
  if(m.t==='a'&&typeof m.type==='string'&&ACTIONS[m.type]&&!NET_BAN.includes(m.type)){
    if(G.phase==='over'?m.type!=='rematch':(['mode','init','stage'].includes(G.phase)||actor()!==1)) return;
    NET.remote=true; try{ act(m.type,m.p&&typeof m.p==='object'?m.p:{}); }catch(e){ console.error('[net] act',m.type,e); NET.lastErr=`操作 ${m.type} の処理でエラー（${netErrText(e)}）`; throw e; }finally{ NET.remote=false; }
  }
}

// ---------- 接続 ----------
function netCloseConn(){
  const {pc,dc}=NET; NET.pc=null; NET.dc=null; NET.on=false; NET.buf=''; NET.ng=null; NET.logSent=0; NET.lastNg=null;
  NET.q=[]; NET.tries=0; NET.lastErr=''; NET.sent=0; NET.got=0; clearTimeout(NET.pumpT); clearTimeout(NET.timer);
  try{ if(dc){ dc.onclose=null; dc.onmessage=null; dc.close(); } }catch(e){}
  try{ if(pc){ pc.onconnectionstatechange=null; pc.close(); } }catch(e){}
}
// 自分から抜ける（タイトルに戻る）
function netLeave(){ if(!netOn()) return; netSend({t:'bye'}); netCloseConn(); NET.hold=null; setNetData(null); UI.net=null; }
// 切れた・相手が抜けた。対戦中なら中断にして再接続を待つ（end＝相手が自分から抜けたなど、続けられないとき）。それ以外はタイトルに戻してお知らせを出す
function netDrop(msg,end){
  const was=NET.on, diag=netDiag(); netCloseConn();
  console.warn('[net]',msg,diag);
  if(!was){
    if(NET.hold) UI.net={step:'top'}; // 再接続に失敗：コードを作るところからやり直す
    if(UI.net){ UI.net.busy=false; UI.net.err=msg; UI.net.diag=diag; if(G.phase==='mode'||NET.hold) render(); }
    return;
  }
  if(!end&&G.phase!=='mode'){ netHold(msg,diag); return; }
  NET.hold=null; setNetData(null); newGame(keepRule()); UI.net=null; UI.nav={s:'top',step:'rule'}; SHOW_IDS=null; UI.netMsg=msg; UI.netDiag=diag; render();
}
// 中断にする：対戦（G）はそのまま、再接続の窓を出す
function netHold(msg,diag){ NET.hold={msg,diag:diag||''}; UI.net={step:'top'}; UI.netMsg=null; UI.netDiag=null; render(); }
// ホストがページを読み込み直した：保存してあった対戦（game-ui.js の restoreMatch）を中断の状態で戻す
function netResumeHost(){ NET.me=0; NET.hold={msg:'ページが読み込み直されたため、接続が切れました',diag:''}; UI.net={step:'top'}; }
function netWire(dc){
  NET.dc=dc;
  dc.onmessage=e=>netRecv(e.data);
  dc.onerror=e=>{ NET.lastErr=netErrText(e&&e.error)||'チャネルのエラー'; console.error('[net] channel',e&&e.error||e); };
  dc.onclose=()=>{ if(NET.dc===dc) netDrop('接続が切れました'); };
  dc.onopen=()=>{
    if(NET.dc!==dc) return;
    NET.on=true; clearTimeout(NET.timer);
    if(NET.me===0){ // ホスト：データを送って編成へ（再接続なら、今の状態を送って続きから）
      const resume=!!NET.hold; NET.hold=null;
      const noMemo=a=>a.map(({memo,...x})=>x); // メモ（エディタ用の覚え書き）は相手に送らない
      netSend({t:'hello',v:NET_VER,units:noMemo(UNITS),masters:noMemo(MASTERS)});
      UI.net=null; UI.nav={s:'top',step:'rule'};
      if(resume){ netSync([]); render(); }
      else act('chooseMode',{mode:'net'});
    }else if(UI.net){ UI.net.step='joined'; if(G.phase==='mode'||NET.hold) render(); }
  };
}
function netNewPc(){
  netCloseConn();
  const pc=new RTCPeerConnection({iceServers:NET_ICE}); NET.pc=pc;
  // つながる前の 'failed' では切らない：ゲストは返信コードを作った時点で相手を探し始めるので、ホストが貼り付けるまで時間がかかると
  // いったん 'failed' になる（コードのやり取りには何分もかかる）。ホストが貼り付けて探し始めれば、そこからつながる
  pc.onconnectionstatechange=()=>{ if(NET.pc===pc&&pc.connectionState==='failed'&&NET.on) netDrop('接続が切れました'); };
  return pc;
}
// アドレス候補が出そろうまで待つ（長くても数秒）
const netIceDone = pc=>new Promise(res=>{
  if(pc.iceGatheringState==='complete') return res();
  const t=setTimeout(res,4000);
  pc.addEventListener('icegatheringstatechange',()=>{ if(pc.iceGatheringState==='complete'){ clearTimeout(t); res(); } });
});
// 接続情報 ⇔ コード（PD＋O/A＋圧縮の有無＋base64url）
async function netPack(desc){
  let bytes=new TextEncoder().encode(desc.sdp), flag='r';
  if(typeof CompressionStream==='function'){
    try{ bytes=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()); flag='z'; }catch(e){}
  }
  let s=''; bytes.forEach(b=>{ s+=String.fromCharCode(b); });
  return 'PD'+(desc.type==='offer'?'O':'A')+flag+btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
async function netUnpack(code,type){
  const m=/^PD([OA])([rz])([A-Za-z0-9_-]+)$/.exec(String(code||'').replace(/\s+/g,''));
  if(!m) throw new Error('コードの形式が違います。コード全体を貼り付けてください');
  if(m[1]!==(type==='offer'?'O':'A')) throw new Error(type==='offer'?'これは返信コードです。ホストの招待コードを貼り付けてください':'これは招待コードです。ゲストの返信コードを貼り付けてください');
  const bin=atob(m[3].replace(/-/g,'+').replace(/_/g,'/')); let bytes=Uint8Array.from(bin,c=>c.charCodeAt(0));
  if(m[2]==='z'){
    if(typeof DecompressionStream!=='function') throw new Error('このブラウザではコードを読み込めません');
    bytes=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  }
  return {type,sdp:new TextDecoder().decode(bytes)};
}
// ホスト：招待コードを作る
async function netHostCode(){
  const pc=netNewPc(); NET.me=0;
  netWire(pc.createDataChannel('pd'));
  await pc.setLocalDescription(await pc.createOffer());
  await netIceDone(pc);
  return netPack(pc.localDescription);
}
// ホスト：返信コードを読み込んでつなぐ
async function netHostConnect(code){
  if(!NET.pc) throw new Error('招待コードを作り直してください');
  await NET.pc.setRemoteDescription(await netUnpack(code,'answer'));
  clearTimeout(NET.timer); NET.timer=setTimeout(()=>{ if(!NET.on) netDrop('接続できませんでした。回線の組み合わせによっては直接つながらないことがあります'); },25000);
}
// ゲスト：招待コードを読み込んで返信コードを作る
async function netJoinCode(code){
  const offer=await netUnpack(code,'offer');
  const pc=netNewPc(); NET.me=1;
  pc.ondatachannel=e=>netWire(e.channel);
  await pc.setRemoteDescription(offer);
  await pc.setLocalDescription(await pc.createAnswer());
  await netIceDone(pc);
  return netPack(pc.localDescription);
}

// ---------- 画面（タイトルの「オンライン対戦」パネル。modeHTML から呼ぶ） ----------
// UI.net＝{step:'top'|'hostRule'|'host'|'join'|'reply'|'joined', code, inp, err, busy, copied}
// コードの欄など、接続の画面の部品（タイトルのパネルと再接続の窓で共通）
const netParts = N=>({
  err:N.err?`<p class="warn nm">${esc(N.err)}</p>${N.diag?`<p class="sub small netdiag">詳細：${esc(N.diag)}</p>`:''}`:'',
  out:(label,note)=>`<div class="netbox"><b>${label}</b><textarea class="netcode" readonly data-netout>${esc(N.code||'')}</textarea>
    <div class="row"><button data-ui="netCopy">${N.copied?'コピーしました':'コードをコピー'}</button></div><small class="sub">${note}</small></div>`,
  inp:(label,ph)=>`<div class="netbox"><b>${label}</b><textarea class="netcode" data-netin placeholder="${ph}">${esc(N.inp||'')}</textarea></div>`,
  busy:t=>`<p class="thinking">${t}</p>`,
});
function netPanelHTML(rulePick){
  const N=UI.net||(UI.net={step:'top'});
  const bar=`<div class="navbar"><button class="back" data-ui="netBack">戻る</button></div><p class="navtitle">オンライン対戦</p>`;
  const {err,out,inp,busy}=netParts(N);
  if(typeof RTCPeerConnection!=='function') return `${bar}<p class="warn nm">このブラウザはオンライン対戦に対応していません。</p>`;
  switch(N.step){
    case 'hostRule': return `${bar}${rulePick(`<button class="gbtn go" data-ui="netHost" ${N.busy?'disabled':''}>招待コードを作る</button>`)}${N.busy?busy('コードを作成中'):''}${err}`;
    case 'host': return `${bar}<div class="navstep netstep">
      ${out('① 招待コード（相手に送る）','このコードを相手に送ってください。相手が作った返信コードを下に貼り付けます。')}
      ${inp('② 返信コード（相手から受け取る）','相手から届いた返信コードを貼り付け')}
      ${err}${N.busy?busy('接続中'):''}
      <div class="row mt"><button class="gbtn go" data-ui="netConnect" ${N.busy?'disabled':''}>接続する</button></div>
      <p class="sub small">つながるまで、このページを閉じたり読み込み直したりしないでください。${esc(ruleset().name)}ルール${ruleset().handicapAsc?`・ハンデ戦${G.handicap?'ON':'OFF'}`:''}で始めます。</p></div>`;
    case 'join': return `${bar}<div class="navstep netstep">
      ${inp('① 招待コード（ホストから受け取る）','ホストから届いた招待コードを貼り付け')}
      ${err}${N.busy?busy('コードを作成中'):''}
      <div class="row mt"><button class="gbtn go" data-ui="netJoin" ${N.busy?'disabled':''}>返信コードを作る</button></div></div>`;
    case 'reply': return `${bar}<div class="navstep netstep">
      ${out('② 返信コード（ホストに送る）','このコードをホストに送ってください。ホストが貼り付けると対戦が始まります。')}
      ${err}${busy('ホストの接続を待っています')}
      <p class="sub small">つながるまで、このページを閉じたり読み込み直したりしないでください。</p></div>`;
    case 'joined': return `${bar}<div class="navstep netstep">${busy('つながりました。ホストのデータを受け取っています')}</div>`;
  }
  return `${bar}<div class="navstep"><div class="rules">
      <button class="gbtn" data-ui="netStep" data-v="hostRule">部屋を作る（ホスト）</button>
      <button class="gbtn" data-ui="netStep" data-v="join">部屋に入る（ゲスト）</button></div>
    <p class="sub small arcnote">2人のブラウザを直接つないで対戦します。ホストが作った招待コードと、ゲストが作った返信コードを、Discord などで1回ずつ送り合ってください。<br>キャラクターデータはホストのものを使います。</p>${err}</div>`;
}
// 再接続の窓（中断中。どの画面でも重ねて出す）。コードの送り合いは最初の接続と同じ：ホストが招待コード → ゲストが返信コード
function netHoldHTML(){
  const H=NET.hold, N=UI.net||(UI.net={step:'top'}), host=NET.me===0, {err,out,inp,busy}=netParts(N);
  const quit=`<button class="ghost" data-a="restart" title="対戦を終えてタイトルに戻ります">対戦をやめる</button>`;
  let body;
  if(host) body=N.step==='host'
    ? `${out('① 招待コード（相手に送る）','このコードを相手に送ってください。相手が作った返信コードを下に貼り付けます。')}
       ${inp('② 返信コード（相手から受け取る）','相手から届いた返信コードを貼り付け')}${err}${N.busy?busy('接続中'):''}
       <div class="row mt">${quit}<button class="primary" data-ui="netConnect" ${N.busy?'disabled':''}>接続する</button></div>`
    : `<p class="sub small">新しい招待コードを作って相手に送ると、続きから再開できます。相手がページを読み込み直した場合は、相手に「オンライン対戦 → 部屋に入る（ゲスト）」から入ってもらってください。</p>${err}${N.busy?busy('コードを作成中'):''}
       <div class="row mt">${quit}<button class="primary" data-ui="netHost" ${N.busy?'disabled':''}>招待コードを作る</button></div>`;
  else body=N.step==='reply'||N.step==='joined'
    ? `${out('② 返信コード（ホストに送る）','このコードをホストに送ってください。ホストが貼り付けると続きから再開します。')}${err}${busy(N.step==='joined'?'つながりました。対戦の状態を受け取っています':'ホストの接続を待っています')}
       <div class="row mt">${quit}</div>`
    : `<p class="sub small">ホストに新しい招待コードを作ってもらい、下に貼り付けてください。</p>
       ${inp('① 招待コード（ホストから受け取る）','ホストから届いた招待コードを貼り付け')}${err}${N.busy?busy('コードを作成中'):''}
       <div class="row mt">${quit}<button class="primary" data-ui="netJoin" ${N.busy?'disabled':''}>返信コードを作る</button></div>`;
  return `<div class="modal linkask nethold"><div class="mback"></div><div class="mbody navpanel"><p class="navtitle">対戦を中断しています</p>
    <div class="navstep netstep"><p class="nm">${esc(H.msg)}。対戦はこのまま残っています。</p>${H.diag?`<p class="sub small netdiag">詳細：${esc(H.diag)}</p>`:''}${body}</div></div></div>`;
}
// お知らせ（切断など）。全画面共通の重ね表示（overlaysHTML）
function netNoticeHTML(){
  if(NET.hold) return netHoldHTML();
  if(!UI.netMsg) return '';
  return `<div class="modal linkask"><div class="mback" data-ui="netMsgOk"></div><div class="mbody"><p>${esc(UI.netMsg)}</p>${UI.netDiag?`<p class="sub small netdiag">詳細：${esc(UI.netDiag)}</p>`:''}<div class="row"><button class="primary" data-ui="netMsgOk">OK</button></div></div></div>`;
}
// uiAct（game-ui.js）から呼ばれる。扱ったら true
function netUi(a,ds){
  const N=UI.net||(UI.net={step:'top'});
  const fail=e=>{ console.error('[net]',e); N.busy=false; N.diag=''; N.err=(e&&e.message)||'うまくいきませんでした。もう一度やり直してください'; if(G.phase==='mode'||NET.hold) render(); };
  const redraw=()=>{ if((G.phase==='mode'||NET.hold)&&UI.net===N) render(); };
  switch(a){
    case 'netMsgOk': UI.netMsg=null; UI.netDiag=null; return true;
    case 'netBack':
      if(N.step==='top'){ UI.net=null; UI.nav={s:'top',step:'rule'}; }
      else { if(!NET.on) netCloseConn(); UI.net={step:'top'}; }
      return true;
    case 'netStep': UI.net={step:ds.v==='join'?'join':'hostRule'}; return true;
    case 'netHost': if(N.busy) return true; N.busy=true; N.err='';
      netHostCode().then(code=>{ if(UI.net!==N) return; Object.assign(N,{step:'host',code,busy:false,copied:false,inp:''}); redraw(); },fail); return true;
    case 'netConnect': if(N.busy) return true; N.busy=true; N.err='';
      netHostConnect(N.inp).catch(fail); return true;
    case 'netJoin': if(N.busy) return true; N.busy=true; N.err='';
      netJoinCode(N.inp).then(code=>{ if(UI.net!==N) return; Object.assign(N,{step:'reply',code,busy:false,copied:false}); redraw(); },fail); return true;
    case 'netCopy': { const done=()=>{ N.copied=true; redraw(); };
      const old=()=>{ const t=document.querySelector('[data-netout]'); if(t){ t.select(); try{ document.execCommand('copy'); done(); }catch(e){} } };
      if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(N.code||'').then(done,old); else old();
      return true; }
  }
  return false;
}
if(typeof document!=='undefined'){
  // 貼り付けたコードは UI.net に持つ（画面を作り直しても消えないように）
  document.addEventListener('input',e=>{ if(e.target.matches&&e.target.matches('[data-netin]')&&UI.net) UI.net.inp=e.target.value; });
  // コードの欄を押したら全体を選ぶ
  document.addEventListener('focusin',e=>{ if(e.target.matches&&e.target.matches('[data-netout]')) e.target.select(); });
  // ページを閉じるときは相手に知らせる（re＝自分から抜けたのではない。相手は中断にして待つ）
  window.addEventListener('pagehide',()=>{ if(NET.on) netSend({t:'bye',re:1}); });
}
