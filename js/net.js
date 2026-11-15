'use strict';
/* =====================================================================
   オンライン対戦（サーバーなし。WebRTC のデータチャネルで2人のブラウザを直接つなぐ）
   - つなぎ方：ホストが「招待コード」を作って相手に送り、ゲストが「返信コード」を作って送り返す（Discord などで貼り合う）。
     コードの中身は WebRTC の接続情報（SDP）を圧縮したもの。仲介サーバーは使わない（アドレスを調べる公開 STUN だけ使う）
   - 進め方：ホストだけがゲームを進める。ゲストは操作 {type,payload} をホストへ送り、ホストが act() を実行して
     状態 G と、その操作で出た演出イベントをゲストへ送る。ゲストは受け取った G をそのまま表示する（乱数の同期は要らない）
   - データ：ホストのキャラクターデータ（エディタで反映したものも含む）を最初に送り、ゲストは対戦中だけそれを使う（setNetData）
   - ホスト＝プレイヤー0、ゲスト＝プレイヤー1。編成はホスト→ゲストの順（ローカル対戦と同じ流れ）
   engine.js の act() が netAct / netTapOn / netSync を呼ぶ。画面の状態は UI.net（接続の画面）と UI.netMsg（お知らせ）
   ===================================================================== */
const NET_VER = 1;                 // 通信の形式が変わったら上げる（違う版同士はつながない）
const NET_FRAME = 4000;            // 1回に送る文字数（長いメッセージは分けて送る）
const NET_ICE = [{urls:['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302']}];
const NET = { on:false, me:0, pc:null, dc:null, remote:false, ng:null, logSent:0, lastNg:null, buf:'' };
const netOn = ()=>NET.on;
const netMe = ()=>NET.on?NET.me:0;
// 相手が操作する番（自分は待つ）。編成中も含む
const netWaiting = ()=>NET.on&&!['mode','over','init','stage'].includes(G.phase)&&actor()!==NET.me;
// ゲストからは受け付けない操作（部屋の設定・ひとり用のもの）
const NET_BAN = ['restart','useDefaultData','setRule','toggleHandicap','chooseMode','scnBattle','arcadeGo','arcadeNext','arcadeContinue','toggleSpeed'];

// ---------- engine.js の act() から呼ばれる ----------
// true を返すと、その操作はここで終わり（エンジンでは実行しない）
function netAct(type,p){
  if(!NET.on) return false;
  if(type==='restart'){ netLeave(); return false; }         // タイトルに戻る＝退出。このあとふつうに newGame する
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
function netSend(obj){
  const dc=NET.dc; if(!dc||dc.readyState!=='open') return;
  const s=JSON.stringify(obj);
  try{ for(let i=0;i<s.length;i+=NET_FRAME) dc.send((i+NET_FRAME>=s.length?'F':'P')+s.slice(i,i+NET_FRAME)); }catch(e){ netDrop('通信エラーが起きました'); }
}
function netRecv(data){
  if(typeof data!=='string') return;
  NET.buf+=data.slice(1); if(data[0]!=='F') return;
  let m; try{ m=JSON.parse(NET.buf); }catch(e){ m=null; } NET.buf='';
  if(!m) return;
  if(m.t==='bye'){ netDrop('相手が退出しました'); return; }
  if(NET.me===1){
    if(m.t==='hello'){
      if(m.v!==NET_VER||!Array.isArray(m.units)||!Array.isArray(m.masters)){ netDrop('ゲームの版が合いません。2人ともページを読み込み直してください'); return; }
      setNetData({units:m.units,masters:m.masters}); UI.net=null; UI.nav={s:'top',step:'rule'}; SHOW_IDS=null; render();
    }else if(m.t==='s'&&m.g) netApply(m);
    return;
  }
  // ホスト：ゲストの操作。ゲストの番（決着後は「もう一度」だけ）で、許された操作だけ実行する
  if(m.t==='a'&&typeof m.type==='string'&&ACTIONS[m.type]&&!NET_BAN.includes(m.type)){
    if(G.phase==='over'?m.type!=='rematch':(['mode','init','stage'].includes(G.phase)||actor()!==1)) return;
    NET.remote=true; try{ act(m.type,m.p&&typeof m.p==='object'?m.p:{}); }finally{ NET.remote=false; }
  }
}

// ---------- 接続 ----------
function netCloseConn(){
  const {pc,dc}=NET; NET.pc=null; NET.dc=null; NET.on=false; NET.buf=''; NET.ng=null; NET.logSent=0; NET.lastNg=null;
  try{ if(dc){ dc.onclose=null; dc.onmessage=null; dc.close(); } }catch(e){}
  try{ if(pc){ pc.onconnectionstatechange=null; pc.close(); } }catch(e){}
}
// 自分から抜ける（タイトルに戻る）
function netLeave(){ if(!NET.on) return; netSend({t:'bye'}); netCloseConn(); setNetData(null); UI.net=null; }
// 切れた・相手が抜けた：タイトルに戻してお知らせを出す
function netDrop(msg){
  const was=NET.on; netCloseConn();
  if(!was){ if(UI.net){ UI.net.busy=false; UI.net.err=msg; if(G.phase==='mode') render(); } return; }
  setNetData(null); newGame(keepRule()); UI.net=null; UI.nav={s:'top',step:'rule'}; SHOW_IDS=null; UI.netMsg=msg; render();
}
function netWire(dc){
  NET.dc=dc;
  dc.onmessage=e=>netRecv(e.data);
  dc.onclose=()=>{ if(NET.dc===dc) netDrop('接続が切れました'); };
  dc.onopen=()=>{
    if(NET.dc!==dc) return;
    NET.on=true; clearTimeout(NET.timer);
    if(NET.me===0){ // ホスト：データを送って編成へ
      netSend({t:'hello',v:NET_VER,units:UNITS,masters:MASTERS});
      UI.net=null; UI.nav={s:'top',step:'rule'};
      act('chooseMode',{mode:'net'});
    }else if(UI.net){ UI.net.step='joined'; if(G.phase==='mode') render(); }
  };
}
function netNewPc(){
  netCloseConn();
  const pc=new RTCPeerConnection({iceServers:NET_ICE}); NET.pc=pc;
  pc.onconnectionstatechange=()=>{ if(NET.pc===pc&&pc.connectionState==='failed') netDrop(NET.on?'接続が切れました':'接続できませんでした。回線の組み合わせによっては直接つながらないことがあります'); };
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
function netPanelHTML(rulePick){
  const N=UI.net||(UI.net={step:'top'});
  const bar=`<div class="navbar"><button class="back" data-ui="netBack">戻る</button></div><p class="navtitle">オンライン対戦</p>`;
  const err=N.err?`<p class="warn nm">${esc(N.err)}</p>`:'';
  const out=(label,note)=>`<div class="netbox"><b>${label}</b><textarea class="netcode" readonly data-netout>${esc(N.code||'')}</textarea>
    <div class="row"><button data-ui="netCopy">${N.copied?'コピーしました':'コードをコピー'}</button></div><small class="sub">${note}</small></div>`;
  const inp=(label,ph)=>`<div class="netbox"><b>${label}</b><textarea class="netcode" data-netin placeholder="${ph}">${esc(N.inp||'')}</textarea></div>`;
  const busy=t=>`<p class="thinking">${t}</p>`;
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
// お知らせ（切断など）。全画面共通の重ね表示（overlaysHTML）
function netNoticeHTML(){
  if(!UI.netMsg) return '';
  return `<div class="modal linkask"><div class="mback" data-ui="netMsgOk"></div><div class="mbody"><p>${esc(UI.netMsg)}</p><div class="row"><button class="primary" data-ui="netMsgOk">OK</button></div></div></div>`;
}
// uiAct（game-ui.js）から呼ばれる。扱ったら true
function netUi(a,ds){
  const N=UI.net||(UI.net={step:'top'});
  const fail=e=>{ N.busy=false; N.err=(e&&e.message)||'うまくいきませんでした。もう一度やり直してください'; if(G.phase==='mode') render(); };
  const redraw=()=>{ if(G.phase==='mode'&&UI.net===N) render(); };
  switch(a){
    case 'netMsgOk': UI.netMsg=null; return true;
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
  // ページを閉じるときは相手に知らせる
  window.addEventListener('pagehide',()=>{ if(NET.on) netSend({t:'bye'}); });
}
