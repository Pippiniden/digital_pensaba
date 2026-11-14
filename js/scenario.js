'use strict';
/* =====================================================================
   シナリオモード（サウンドノベル）
   - 画面は #scn（#app の外。render() では作り直さないので、文字送りやBGMが途切れない）。操作は data-sn を document で受ける
   - 物語の進行状態は SCN.st（シーン・位置・フラグ・編成・背景・BGM・ウィンドウ）。セーブはこの写し（スナップショット）
   - 戦闘は act('scnBattle',spec) でエンジンに渡す（G.scn）。決着後の「物語を進める」（data-ui="scnAfter"）で戻ってくる
   - シナリオが1つもなければメニューに出ない（scnAvail）。読み込み元：scenarios/index.js の SCENARIO_FILES と、外部読み込み（IndexedDB）
   ===================================================================== */

const SCN = { list:[], ready:false, s:null, key:null, st:null, snap:null, log:[], read:new Set(),
  view:null, /* null / 'list' / 'play' / 'battle'（戦闘中は #scn を隠す） */ modal:null, mkey:null, msg:'',
  battle:null, choice:null, auto:false, skip:false, hide:false, typing:null, timer:null, done:false, bgmEl:null, bgmKey:'' };
const SCN_PREF_KEY='pencilduel.scn.prefs', SCN_RUN_KEY='pencilduel.scnRun', SCN_SLOTS=6;
const SP = Object.assign({speed:30, auto:1500, bgm:60, se:80, skipAll:false}, readJSON(SCN_PREF_KEY)||{});
const scnSaveKey = id=>'pencilduel.scn.save.'+id, scnReadKey = id=>'pencilduel.scn.read.'+id;
const scnSaves = id=>{ const v=readJSON(scnSaveKey(id)); return v&&typeof v==='object'?{auto:v.auto||null, slots:Array.isArray(v.slots)?v.slots:[]}:{auto:null,slots:[]}; };
const scnAvail = ()=>SCN.list.some(x=>x.s);
const scnRoot = ()=>document.querySelector('#scn');
const scnQ = sel=>scnRoot().querySelector(sel);
const scnItem = key=>SCN.list.find(x=>x.key===key);
const scnDate = t=>{ const d=new Date(t), z=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}/${z(d.getMonth()+1)}/${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`; };

// ---------- 一覧の読み込み ----------
async function scnLoadList(){
  const list=[], base={units:ALL_UNITS, masters:ALL_MASTERS};
  const add=(key,src,raw)=>{ try{ const s=normScenario(raw); list.push({key,src,s,errs:validateScenario(s,base).filter(e=>e.level==='error').map(e=>e.msg)}); }catch(e){ if(src==='import') list.push({key,src,s:null,errs:[e.message]}); } };
  for(const f of (typeof SCENARIO_FILES!=='undefined'&&Array.isArray(SCENARIO_FILES)?SCENARIO_FILES:[])){
    try{ const r=await fetch(SCN_DIR+f); if(r.ok) add('f:'+f,'folder',await r.json()); }catch(e){}
  }
  try{ for(const k of await scnDbKeys()) if(String(k).startsWith('imp:')) add(k,'import',await scnDbGet(k)); }catch(e){}
  SCN.list=list;
}

// ---------- 画面 ----------
function scnDraw(){
  const root=scnRoot(), v=SCN.view;
  document.body.dataset.scn=v||'';
  root.hidden=!v||v==='battle';
  if(v==='list') setHTML(root,scnListHTML()+scnModalHTML());
  else if(v==='play'&&!scnQ('.sn-play')) root.innerHTML=scnPlayHTML();
  if(v==='play'){ scnBar(); scnQ('.sn-modalwrap').innerHTML=scnModalHTML(); scnQ('.sn-play').classList.toggle('hidewin',SCN.hide); }
}
function scnListHTML(){
  const cards=SCN.list.map(it=>{
    if(!it.s) return `<div class="sn-card bad"><div class="sn-cbody"><b>読み込めないシナリオ</b><p class="warn nm">${it.errs.map(esc).join('<br>')}</p><div class="row"><button class="danger" data-sn="askDel" data-key="${esc(it.key)}">削除</button></div></div></div>`;
    const s=it.s, sv=scnSaves(s.id), cover=scnImgUrl(s,s.cover), ok=!it.errs.length, k=`data-key="${esc(it.key)}"`;
    return `<div class="sn-card ${ok?'':'bad'}">${cover?`<img class="sn-cover" src="${esc(cover)}" alt="">`:'<div class="sn-cover none">SCENARIO</div>'}
      <div class="sn-cbody"><b>${esc(s.title)}</b>${s.author?`<small class="sub">作：${esc(s.author)}</small>`:''}
        <p class="sn-desc">${esc(s.desc)}</p>
        ${ok?'':`<p class="warn nm small">このシナリオにはエラーがあるため遊べません：<br>${it.errs.slice(0,4).map(esc).join('<br>')}${it.errs.length>4?`<br>…ほか${it.errs.length-4}件`:''}</p>`}
        <div class="row">${ok?`<button class="primary" data-sn="start" ${k}>はじめから</button>${sv.auto?`<button data-sn="cont" ${k}>つづきから</button>`:''}${sv.slots.some(Boolean)?`<button data-sn="openLoad" ${k}>ロード</button>`:''}`:''}
          <span class="grow"></span>${it.src==='import'?`<button class="ghost danger" data-sn="askDel" ${k}>削除</button>`:'<small class="sub">同梱</small>'}</div></div></div>`;
  }).join('');
  return `<div class="sn-list"><div class="sn-lhead"><button class="back" data-sn="close">戻る</button><h2>シナリオ</h2><span class="grow"></span><button data-sn="import">JSONを読み込む</button></div>
    ${SCN.msg?`<p class="sn-msg">${SCN.msg}</p>`:''}
    <div class="sn-cards">${cards||'<p class="sub">シナリオがありません。「JSONを読み込む」からシナリオのファイルを読み込んでください。</p>'}</div></div>`;
}
function scnPlayHTML(){
  return `<div class="sn-play" data-sn="next"><div class="sn-bg"><i></i><i></i></div><div class="sn-veil"></div>
    <div class="sn-stage"><div class="sn-win top empty" data-pos="top"></div><div class="sn-choices"></div><div class="sn-win bottom empty" data-pos="bottom"></div></div>
    <div class="sn-bar"></div></div><div class="sn-modalwrap"></div>`;
}
function scnBar(){
  const b=(a,label,on,title='')=>`<button class="${on?'on':''}" data-sn="${a}" title="${title}">${label}</button>`;
  scnQ('.sn-bar').innerHTML=`<span class="sn-ttl">${esc(SCN.s.title)}</span><span class="grow"></span>`
    +b('auto','オート',SCN.auto,'クリックしなくても自動で読み進めます')+b('skip','スキップ',SCN.skip,SP.skipAll?'選択肢まで早送りします':'読んだことのある文章を早送りします')
    +b('openLog','ログ')+b('openSave','セーブ')+b('openLoad','ロード')+b('hide','窓を消す',false,'ウィンドウを隠して背景を見ます（クリックで戻る）')+b('openConf','設定')+b('askQuit','タイトルへ');
}
function scnModalHTML(){
  const m=SCN.modal; if(!m) return '';
  const wrap=(body,cls='')=>`<div class="modal sn-modal ${cls}"><div class="mback" data-sn="closeModal"></div><div class="mbody">${body}</div></div>`;
  const head=t=>`<div class="navbar"><button class="back" data-sn="closeModal">閉じる</button></div><p class="navtitle">${t}</p>`;
  if(m==='log') return wrap(`${head('バックログ')}<div class="sn-log">${SCN.log.map(l=>`<div><b>${esc(l.name)}</b><p>${esc(l.text).replace(/\n/g,'<br>')}</p></div>`).join('')||'<p class="sub">まだありません</p>'}</div>`,'wide');
  if(m==='save'||m==='load'){
    const it=scnItem(SCN.mkey), sv=it&&it.s?scnSaves(it.s.id):{auto:null,slots:[]}, save=m==='save';
    const slot=(snap,name,i)=>`<button class="sn-slot" data-sn="${save?'saveTo':'loadFrom'}" data-i="${i}" ${!save&&!snap?'disabled':''}><b>${name}</b>${snap?`<span>${esc(snap.label||'')}</span><small>${scnDate(snap.at)}</small>`:'<span class="sub">（空き）</span>'}</button>`;
    return wrap(`${head(save?'セーブ':'ロード')}<div class="sn-slots">${save?'':slot(sv.auto,'オートセーブ','auto')}${Array.from({length:SCN_SLOTS},(_,i)=>slot(sv.slots[i],`スロット ${i+1}`,i)).join('')}</div>`);
  }
  if(m==='conf'){
    const seg=(k,items)=>`<div class="seg">${items.map(([lab,v])=>`<button class="${SP[k]===v?'on':''}" data-sn="pref" data-k="${k}" data-v="${v}">${lab}</button>`).join('')}</div>`;
    const row=(name,ctl)=>`<div class="setrow"><div><b>${name}</b></div>${ctl}</div>`, vol=k=>`<input type="range" min="0" max="100" step="5" value="${SP[k]}" data-snf="${k}">`;
    return wrap(`${head('シナリオの設定')}<div class="navstep setting">
      ${row('文字の速さ',seg('speed',[['遅い',60],['普通',30],['速い',12],['一瞬',0]]))}
      ${row('オートの待ち時間',seg('auto',[['長い',3000],['普通',1500],['短い',700]]))}
      ${row('スキップする範囲',seg('skipAll',[['読んだ文章だけ',false],['すべて',true]]))}
      ${row('BGMの音量',vol('bgm'))}${row('効果音の音量',vol('se'))}</div>`);
  }
  if(m==='quit') return wrap(`<p class="navtitle">タイトルに戻りますか？</p><p class="sub">ここまでの進行はオートセーブされています（「つづきから」で再開できます）。</p><div class="row"><button class="ghost" data-sn="closeModal">やめる</button><button class="primary" data-sn="quit">タイトルへ</button></div>`,'ask');
  if(m==='del'){ const it=scnItem(SCN.mkey);
    return wrap(`<p class="navtitle">シナリオを削除しますか？</p><p class="sub">「${esc(it&&it.s?it.s.title:'読み込めないシナリオ')}」と、そのセーブデータをこの端末から消します。</p><div class="row"><button class="ghost" data-sn="closeModal">やめる</button><button class="danger" data-sn="del">削除する</button></div>`,'ask'); }
  if(m==='end') return `<div class="modal sn-modal sn-end"><div class="mback"></div><div class="mbody"><h2 class="rtitle">END</h2><p class="sn-endtext">${esc(SCN.endText||'').replace(/\n/g,'<br>')}</p><div class="row"><button data-sn="openLog">ログ</button><button class="primary" data-sn="quit">タイトルへ</button></div></div></div>`;
  return '';
}

// ---------- 開始・終了 ----------
function scnStopTimers(){ clearTimeout(SCN.timer); SCN.timer=null; if(SCN.typing){ clearInterval(SCN.typing.id); SCN.typing=null; } }
function scnStart(key,snap,o={}){
  const it=scnItem(key); if(!it||!it.s||it.errs.length) return false;
  const s=it.s;
  scnStopTimers();
  SCN.s=s; SCN.key=key; SCN.modal=null; SCN.ended=false; SCN.choice=null; SCN.battle=null; SCN.auto=false; SCN.skip=false; SCN.hide=false; SCN.done=false; SCN.msg='';
  setScnData(s.units,s.masters);
  for(const k in IMG_OVERRIDE) delete IMG_OVERRIDE[k];
  Object.entries(s.unitImgs).forEach(([id,o2])=>{ IMG_OVERRIDE[id]={face:scnAssetUrl(s,o2.face), card:scnAssetUrl(s,o2.card)}; });
  const b=snap&&s.scenes.some(x=>x.id===snap.scene)?clone(snap):null;
  SCN.st=b?{scene:b.scene, pc:b.pc|0, flags:b.flags||{}, team:b.team||null, bg:b.bg||'', bgm:b.bgm||'', dark:!!b.dark, wins:b.wins||{top:null,bottom:null}, cur:b.cur||'bottom'}
          :{scene:s.start||s.scenes[0].id, pc:0, flags:{}, team:null, bg:'', bgm:'', dark:false, wins:{top:null,bottom:null}, cur:'bottom'};
  SCN.log=b&&Array.isArray(b.log)?b.log:[]; SCN.read=new Set(readJSON(scnReadKey(s.id))||[]); SCN.snap=b;
  SCN.view='play'; scnRoot().innerHTML=''; scnDraw();
  scnBg(SCN.st.bg,0); scnBgm(SCN.st.bgm); scnQ('.sn-veil').classList.toggle('dark',SCN.st.dark);
  ['top','bottom'].forEach(p=>scnWin(p,true));
  render(); // 専用キャラを反映
  if(!o.hold) scnRun();
  return true;
}
function scnExit(){
  scnStopTimers(); scnBgm('');
  const was=!!SCN.s;
  SCN.s=null; SCN.key=null; SCN.st=null; SCN.snap=null; SCN.battle=null; SCN.choice=null; SCN.modal=null; SCN.view=null;
  try{ sessionStorage.removeItem(SCN_RUN_KEY); }catch(e){}
  for(const k in IMG_OVERRIDE) delete IMG_OVERRIDE[k];
  scnRoot().innerHTML=''; scnDraw();
  if(was){ setScnData(); if(G.phase!=='mode') act('restart'); else render(); }
}

// ---------- セーブ ----------
// いま表示している文章（選択肢・戦闘）の直前の状態を写す。ロードするとその文章からやり直す
function scnSnapNow(label){
  const st=SCN.st;
  SCN.snap={...clone(st), log:SCN.log.slice(-40), at:Date.now(), label:String(label||'').slice(0,40)};
  const sv=scnSaves(SCN.s.id); sv.auto=SCN.snap; writeJSON(scnSaveKey(SCN.s.id),sv);
  scnRunSave();
}
function scnRunSave(){ try{ sessionStorage.setItem(SCN_RUN_KEY,JSON.stringify({key:SCN.key, snap:SCN.snap, battle:!!SCN.battle})); }catch(e){} }

// ---------- 背景・音 ----------
function scnBg(key,fade=600){
  const ls=[...scnRoot().querySelectorAll('.sn-bg i')]; if(!ls.length) return;
  const url=scnImgUrl(SCN.s,key), cur=ls.find(l=>l.classList.contains('on')), nx=ls.find(l=>l!==cur)||ls[0];
  ls.forEach(l=>l.style.transitionDuration=(SCN.skip?0:fade)+'ms');
  nx.style.backgroundImage=url?`url("${url.replace(/"/g,'%22')}")`:'none';
  void nx.offsetWidth; nx.classList.add('on'); if(cur&&cur!==nx) cur.classList.remove('on');
}
function scnBgm(key){
  const url=key&&SCN.s?scnAssetUrl(SCN.s,key):'';
  if(SCN.bgmEl&&SCN.bgmKey===key&&url) return;
  if(SCN.bgmEl){ const old=SCN.bgmEl; let v=old.volume; const id=setInterval(()=>{ v-=.1; if(v<=0){ clearInterval(id); old.pause(); } else old.volume=v; },40); SCN.bgmEl=null; }
  SCN.bgmKey=key||'';
  if(!url) return;
  const a=new Audio(url); a.loop=true; a.volume=SP.bgm/100; SCN.bgmEl=a; a.play().catch(()=>{});
}
function scnSe(key){ const url=scnAssetUrl(SCN.s,key); if(!url||SCN.skip) return; const a=new Audio(url); a.volume=SP.se/100; a.play().catch(()=>{}); }

// ---------- ウィンドウ ----------
// pos のウィンドウを SCN.st.wins から描く。all＝文字を全部出した状態で
function scnWin(pos,all){
  const el=scnQ(`.sn-win.${pos}`), w=SCN.st.wins[pos]; if(!el) return;
  el.classList.toggle('empty',!w); el.classList.remove('wait');
  el.classList.toggle('dim',!!w&&SCN.st.cur!==pos);
  setHTML(el,scnWinInner(SCN.s,w,SCN.st.flags,all));
}
function scnLineDone(){
  SCN.done=true;
  const el=scnQ(`.sn-win.${SCN.st.cur}`); if(el) el.classList.add('wait');
  scnWaitNext();
}
// オート・スキップ中なら、少し待って次へ
function scnWaitNext(){
  clearTimeout(SCN.timer); SCN.timer=null;
  if(!SCN.done||SCN.choice||SCN.modal||SCN.view!=='play') return;
  const c=scnCmd(); if(!c||c.t!=='say') return;
  if(SCN.skip) SCN.timer=setTimeout(scnNext,50);
  else if(SCN.auto) SCN.timer=setTimeout(scnNext,SP.auto+Math.min(4000,scnTextPlain(c.text).length*45));
}
function scnSetSkip(v){ if(SCN.skip===v) return; SCN.skip=v; if(scnQ('.sn-bar')) scnBar(); }

// ---------- 進行 ----------
const scnScene = ()=>SCN.s.scenes.find(x=>x.id===SCN.st.scene);
const scnCmd = ()=>{ const sc=SCN.s&&SCN.st&&scnScene(); return sc?sc.cmds[SCN.st.pc]:null; };
function scnGoto(id){ if(!SCN.s.scenes.some(x=>x.id===id)) return false; SCN.st.scene=id; SCN.st.pc=0; return true; }
function scnNext(){ scnStopTimers(); SCN.st.pc++; scnRun(); }
// 止まるコマンド（セリフ・選択肢・戦闘・待ち・エンディング）まで進める
function scnRun(){
  const s=SCN.s, st=SCN.st; SCN.done=false;
  for(let guard=0;;guard++){
    if(guard>3000){ scnEnding('（シナリオが同じところを回り続けているため、中断しました）'); return; }
    const sc=scnScene(), c=sc&&sc.cmds[st.pc];
    if(!c){ // シーンの終わり：並び順で次のシーンへ。最後なら終わり
      const i=s.scenes.indexOf(sc);
      if(sc&&i+1<s.scenes.length){ st.scene=s.scenes[i+1].id; st.pc=0; continue; }
      scnEnding(''); return;
    }
    switch(c.t){
      case 'say': scnSay(c); return;
      case 'choice': scnChoice(c); return;
      case 'battle': scnBattle(c); return;
      case 'end': scnEnding(c.text); return;
      case 'bg': st.bg=c.img; scnBg(c.img,c.fade); break;
      case 'bgm': st.bgm=c.audio; scnBgm(c.audio); break;
      case 'se': scnSe(c.audio); break;
      case 'clear': (c.pos==='both'?['top','bottom']:[c.pos]).forEach(p=>{ st.wins[p]=null; scnWin(p,true); }); break;
      case 'set': { const v=Number(st.flags[c.flag])||0; st.flags[c.flag]=c.op==='+'?v+c.v:c.op==='-'?v-c.v:c.v; break; }
      case 'if': { const v=Number(st.flags[c.flag])||0, ok={'==':v===c.v,'!=':v!==c.v,'>=':v>=c.v,'<=':v<=c.v,'>':v>c.v,'<':v<c.v}[c.cmp];
        if(ok&&scnGoto(c.to)) continue; break; }
      case 'jump': if(scnGoto(c.to)) continue; break;
      case 'fx': { const veil=scnQ('.sn-veil'), stage=scnQ('.sn-stage');
        if(c.kind==='fadeout'||c.kind==='fadein'){ st.dark=c.kind==='fadeout'; veil.classList.toggle('dark',st.dark); if(!SCN.skip){ SCN.timer=setTimeout(scnNext,550); return; } }
        else if(!SCN.skip){ const el=c.kind==='flash'?veil:stage; el.classList.remove(c.kind); void el.offsetWidth; el.classList.add(c.kind); setTimeout(()=>el.classList.remove(c.kind),600); }
        break; }
      case 'wait': if(!SCN.skip&&c.ms>0){ SCN.timer=setTimeout(scnNext,c.ms); return; } break;
    }
    st.pc++;
  }
}
function scnSay(c){
  const st=SCN.st, k=st.scene+':'+st.pc, ch=scnChar(SCN.s,c.who), plain=scnTextPlain(c.text,st.flags);
  if(SCN.skip&&!SP.skipAll&&!SCN.read.has(k)) scnSetSkip(false);
  scnSnapNow(plain.replace(/\n/g,' '));
  st.wins[c.pos]={who:c.who, face:c.face, name:c.name, text:c.text}; st.cur=c.pos;
  SCN.log.push({name:c.name||(ch?ch.name:''), text:plain}); if(SCN.log.length>200) SCN.log.shift();
  if(!SCN.read.has(k)){ SCN.read.add(k); writeJSON(scnReadKey(SCN.s.id),[...SCN.read]); }
  const other=c.pos==='top'?'bottom':'top', oel=scnQ(`.sn-win.${other}`);
  if(oel){ oel.classList.remove('wait'); oel.classList.toggle('dim',!!st.wins[other]); oel.querySelectorAll('.c').forEach(x=>x.classList.add('on')); }
  scnWin(c.pos,false);
  const cs=[...scnQ(`.sn-win.${c.pos}`).querySelectorAll('.c')];
  if(!SP.speed||SCN.skip||!cs.length){ cs.forEach(x=>x.classList.add('on')); scnLineDone(); return; }
  let i=0;
  const T=SCN.typing={ id:setInterval(()=>{ if(i<cs.length) cs[i++].classList.add('on'); if(i>=cs.length) T.finish(); },SP.speed),
    finish(){ clearInterval(T.id); cs.forEach(x=>x.classList.add('on')); if(SCN.typing===T) SCN.typing=null; scnLineDone(); } };
}
function scnChoice(c){
  scnSetSkip(false); scnSnapNow('選択肢');
  SCN.choice=c;
  scnQ('.sn-choices').innerHTML=c.opts.map((o,i)=>`<button data-sn="pick" data-i="${i}">${esc(scnTextPlain(o.text,SCN.st.flags))}</button>`).join('');
  scnQ('.sn-play').classList.add('choosing');
}
function scnPick(i){
  const c=SCN.choice, o=c&&c.opts[i]; if(!o) return;
  if(o.flag) SCN.st.flags[o.flag]=o.v;
  SCN.log.push({name:'▶ 選択', text:scnTextPlain(o.text,SCN.st.flags)});
  SCN.choice=null; scnQ('.sn-choices').innerHTML=''; scnQ('.sn-play').classList.remove('choosing');
  SCN.st.pc++; if(o.to) scnGoto(o.to);
  scnRun();
}
function scnEnding(text){
  scnStopTimers(); scnSetSkip(false); SCN.auto=false;
  SCN.endText=scnTextPlain(text,SCN.st.flags); SCN.modal='end';
  const sv=scnSaves(SCN.s.id); sv.auto=null; writeJSON(scnSaveKey(SCN.s.id),sv); // 読み終えたら「つづきから」は出さない
  try{ sessionStorage.removeItem(SCN_RUN_KEY); }catch(e){}
  scnDraw();
}

// ---------- 戦闘 ----------
function scnBattle(c){
  scnStopTimers(); scnSetSkip(false); SCN.auto=false;
  SCN.battle=c; scnSnapNow(`戦闘：${RULESETS[c.rule].name}`);
  SCN.view='battle'; scnDraw();
  act('scnBattle',{title:SCN.s.title, rule:c.rule, level:c.level, cap:c.cap, mode:c.party.mode, lock:c.party.lock, mlock:c.party.master, pool:c.party.pool,
    prev:SCN.st.team, enemy:c.enemy.units, emaster:c.enemy.master, ename:c.enemy.name, loseGo:c.lose!==''});
}
// 決着後：勝敗で行き先を決めて物語に戻る
function scnAfter(){
  const c=SCN.battle, st=SCN.st; if(!c||!G.scn||G.phase!=='over') return;
  const win=G.winner===0;
  SCN.battle=null; SCN.view='play';
  act('restart');
  st.pc++;
  const to=win?c.win:c.lose===SCN_LOSE_NEXT?'':c.lose; if(to) scnGoto(to);
  scnDraw(); scnRun();
}
// render() のたびに呼ばれる（game-ui.js）。戦闘中にタイトルへ戻ったらシナリオも終える。対戦が始まったら編成を覚える
function scnHook(){
  if(SCN.view!=='battle') return;
  if(!G.scn){ scnExit(); return; }
  if(G.scn.pick&&!['setup','init','mode'].includes(G.phase)){ // 自分で選んだ編成だけ覚える（全員固定の戦闘は「選んだチーム」にしない）
    const t={picks:G.picks[0].slice(), mpick:G.mpicks[0], rule:G.rule};
    if(JSON.stringify(t)!==JSON.stringify(SCN.st.team)){ SCN.st.team=t; if(SCN.snap){ SCN.snap.team=clone(t); const sv=scnSaves(SCN.s.id); sv.auto=SCN.snap; writeJSON(scnSaveKey(SCN.s.id),sv); scnRunSave(); } }
  }
}
// game-ui.js の uiAct から（data-ui="scn…"）
function scnUi(a){
  if(a==='scnList'){ SCN.msg=''; SCN.view='list'; UI.settings=false; scnDraw(); }
  else if(a==='scnImport') scnPickFile();
  else if(a==='scnAfter') scnAfter();
}

// ---------- 外部読み込み ----------
function scnPickFile(){
  const f=document.createElement('input'); f.type='file'; f.accept='.json,application/json';
  f.addEventListener('change',()=>{ const file=f.files[0]; if(!file) return;
    const rd=new FileReader();
    rd.onload=async()=>{
      try{
        const s=parseScenarioText(String(rd.result));
        const errs=validateScenario(s,{units:ALL_UNITS,masters:ALL_MASTERS}).filter(e=>e.level==='error');
        await scnDbPut(scnImpKey(s.id),s);
        await scnLoadList();
        SCN.msg=errs.length?`「${esc(s.title)}」を読み込みましたが、エラーが${errs.length}件あるため遊べません。`:`「${esc(s.title)}」を読み込みました。`;
      }catch(e){ SCN.msg=`<span class="warn">読み込めませんでした：${esc(e.message||e)}</span>`; }
      UI.settings=false; SCN.view='list'; scnDraw(); render();
    };
    rd.readAsText(file);
  });
  f.click();
}

// ---------- 入力 ----------
function scnAct(a,ds){
  const it=scnItem(ds.key);
  switch(a){
    case 'close': SCN.view=null; SCN.modal=null; scnDraw(); render(); return;
    case 'import': scnPickFile(); return;
    case 'start': scnStart(ds.key); return;
    case 'cont': if(it&&it.s) scnStart(ds.key,scnSaves(it.s.id).auto); return;
    case 'askDel': SCN.modal='del'; SCN.mkey=ds.key; break;
    case 'del': { const d=scnItem(SCN.mkey); SCN.modal=null;
      scnDbDel(SCN.mkey).catch(()=>{}).then(scnLoadList).then(()=>{ if(d&&d.s&&!SCN.list.some(x=>x.s&&x.s.id===d.s.id)){ removeKey(scnSaveKey(d.s.id)); removeKey(scnReadKey(d.s.id)); } SCN.msg='削除しました。'; scnDraw(); render(); });
      return; }
    case 'closeModal': if(SCN.modal==='end') return; SCN.modal=SCN.ended?'end':null; SCN.ended=false; break; // エンディングから開いたログは、閉じるとエンディングに戻る
    case 'openLog': SCN.ended=SCN.modal==='end'; SCN.modal='log'; break;
    case 'openSave': if(!SCN.snap) return; SCN.modal='save'; SCN.mkey=SCN.key; break;
    case 'openLoad': SCN.modal='load'; SCN.mkey=ds.key||SCN.key; break;
    case 'openConf': SCN.modal='conf'; break;
    case 'askQuit': SCN.modal='quit'; break;
    case 'quit': scnExit(); return;
    case 'saveTo': { const sv=scnSaves(SCN.s.id); sv.slots[Number(ds.i)]={...clone(SCN.snap), at:Date.now()}; for(let i=0;i<SCN_SLOTS;i++) if(!sv.slots[i]) sv.slots[i]=null;
      SCN.modal=writeJSON(scnSaveKey(SCN.s.id),sv)?null:'save'; break; }
    case 'loadFrom': { const m=scnItem(SCN.mkey); if(!m||!m.s) return; const sv=scnSaves(m.s.id), snap=ds.i==='auto'?sv.auto:sv.slots[Number(ds.i)];
      if(snap){ SCN.ended=false; scnStart(SCN.mkey,snap); } return; }
    case 'pref': { const v=ds.v==='true'?true:ds.v==='false'?false:Number(ds.v); SP[ds.k]=v; writeJSON(SCN_PREF_KEY,SP); break; }
    case 'auto': SCN.auto=!SCN.auto; scnSetSkip(false); scnBar(); scnWaitNext(); return;
    case 'skip': scnSetSkip(!SCN.skip); if(SCN.skip){ if(SCN.typing) SCN.typing.finish(); else scnWaitNext(); } else scnWaitNext(); return;
    case 'hide': SCN.hide=true; break;
    case 'pick': scnPick(Number(ds.i)); return;
    case 'next':
      if(SCN.modal||SCN.view!=='play') return;
      if(SCN.hide){ SCN.hide=false; break; }
      if(SCN.choice) return;
      if(SCN.skip){ scnSetSkip(false); scnWaitNext(); return; }
      if(SCN.typing){ SCN.typing.finish(); return; }
      if(SCN.done) scnNext();
      return;
  }
  scnDraw(); scnWaitNext();
}
document.addEventListener('click',e=>{
  if(SCN.bgmEl&&SCN.bgmEl.paused) SCN.bgmEl.play().catch(()=>{}); // 自動再生が止められていたら、最初の操作で鳴らす
  const t=e.target.closest('[data-sn]'); if(!t||t.disabled||!scnRoot().contains(t)) return;
  scnAct(t.dataset.sn,t.dataset);
});
document.addEventListener('input',e=>{
  const k=e.target.dataset&&e.target.dataset.snf; if(!k) return;
  SP[k]=Number(e.target.value)||0; writeJSON(SCN_PREF_KEY,SP);
  if(k==='bgm'&&SCN.bgmEl) SCN.bgmEl.volume=SP.bgm/100;
});
document.addEventListener('keydown',e=>{
  if(!SCN.view||SCN.view==='battle') return;
  if(e.key==='Escape'){ if(SCN.modal&&SCN.modal!=='end') scnAct('closeModal',{}); else if(SCN.view==='list') scnAct('close',{}); return; }
  if(SCN.view==='play'&&!SCN.modal&&(e.key==='Enter'||e.key===' ')&&!e.target.closest('button,input,select,textarea')){ e.preventDefault(); scnAct('next',{}); }
});

// ---------- 起動 ----------
(async function scnInit(){
  await scnLoadList();
  SCN.ready=true;
  let run=null; try{ run=JSON.parse(sessionStorage.getItem(SCN_RUN_KEY)||'null'); }catch(e){}
  const m=/^#scn=(.+)$/.exec(location.hash);
  if(m){ // シナリオエディタの「ゲームで試す」：そのシナリオを最初から
    const id=decodeURIComponent(m[1]), it=SCN.list.find(x=>x.src==='import'&&x.s&&x.s.id===id);
    history.replaceState(null,'',location.pathname+location.search);
    MATCH_HOLD=false;
    if(it&&!it.errs.length){ if(G.phase!=='mode') act('restart'); scnStart(it.key); return; }
    SCN.view='list'; scnDraw(); render(); return;
  }
  // ページが読み込み直されたとき：同じタブなら物語（戦闘中ならその対戦）の続きから
  if(run&&run.key&&run.snap&&scnStart(run.key,run.snap,{hold:true})){
    const c=scnCmd();
    if(run.battle&&c&&c.t==='battle'&&restoreMatch(true)){ MATCH_HOLD=false; SCN.battle=c; SCN.view='battle'; scnDraw(); render(); return; }
    MATCH_HOLD=false; scnRun(); return;
  }
  MATCH_HOLD=false;
  render();
})();
