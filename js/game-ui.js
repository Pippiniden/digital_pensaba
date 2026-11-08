'use strict';
/* =====================================================================
   ゲーム画面の描画と入力
   - 対戦画面は1画面に収まるレイアウト（上：相手 / 中央：コマンド / 下：自分 / 右：ログ）
   - 詳細（スキル説明・鉛筆の面）は ⓘ ボタンのウィンドウで見る
   - 画面だけの状態（詳細ウィンドウ・ログの開閉など）は UI に持ち、G には入れない
   ===================================================================== */

const UI = { detail:null, setupView:null, log:readLogPref() };
function readLogPref(){
  try{ const v=localStorage.getItem('pencilduel.logOpen'); if(v!=null) return v==='1'; }catch(e){}
  return window.innerWidth>1100;
}
const ORD=['1st','2nd','3rd'];
const pctOf=(a,b)=>Math.max(0,Math.min(100,a/b*100));

// ---------- 対戦画面：サーヴァント ----------
function skillBtns(u,d){
  const own=u.pid===G.cur && G.phase==='skill' && !u.out && !G.pending;
  const sealed=!canSkill(u)&&!u.out;
  const sk=d.skills.map((s,i)=>{
    const locked=i===2&&!u.asc, used=u.used[i], ok=own&&canSkill(u)&&!used&&!locked;
    const tip=`S${i+1}「${s.name}」 ${effsText(s.eff,s.pick)}${locked?`（${TERMS.asc}後に使用可）`:''}${used?'（使用済み）':''}${sealed?'（使用不可）':''}`;
    return `<span class="skw" title="${esc(tip)}"><button class="sk ${used?'used':''} ${locked?'locked':''}" data-a="useSkill" data-uid="${u.uid}" data-si="${i}" ${ok?'':'disabled'}><i>S${i+1}</i><span>${locked?'🔒':''}${esc(s.name)}</span></button></span>`;
  }).join('');
  const ready=u.np>=RULES.ultCost&&!u.out, ok=own&&canUlt(u)&&!G.ult&&ready;
  const tip=`${TERMS.ult}「${d.ult.name}」 [${TERMS[d.ult.c]}] ${effsText(d.ult.eff)}（${TERMS.gauge}${RULES.ultCost}%で使用可）`;
  const ult=`<span class="skw" title="${esc(tip)}"><button class="sk np ${d.ult.c} ${ready?'ready':''}" data-a="useUlt" data-uid="${u.uid}" ${ok?'':'disabled'}><i>${TERMS.ult}</i><span>${esc(d.ult.name)}</span></button></span>`;
  return `<div class="sks">${sk}${ult}</div>`;
}
function rollBadge(u,d){
  if(!u.face) return '';
  const n=u.face.kind==='acts'?(G.maxActs[u.uid]??faceActs(d,u.face.i)):0;
  return `<div class="proll"><span class="die">${u.face.i+1}</span>${u.face.kind==='acts'?`<span class="actn">×${n}</span>`:''}${u.face.kind==='cmd'?cmdCardHTML(d,u.face.cmd,{small:true}):''}</div>`;
}
function ctlHTML(u){
  if(u.pid!==G.cur || u.out) return '';
  if(G.phase==='actRoll' && G.actRolled){
    const m=G.maxActs[u.uid]||0, a=G.alloc[u.uid]||0;
    return `<div class="ctl"><span class="sub">行動</span><button data-a="alloc" data-uid="${u.uid}" data-d="-1" ${a<=0?'disabled':''}>−</button><b>${a}</b><button data-a="alloc" data-uid="${u.uid}" data-d="1" ${a>=m||totalAlloc()>=RULES.actionsMax?'disabled':''}>＋</button><span class="sub">最大${m}</span></div>`;
  }
  if(G.phase==='action'){
    const a=G.alloc[u.uid]||0, done=G.rolled.filter(r=>r.uid===u.uid).length;
    if(a) return `<div class="ctl"><button class="primary" data-a="rollAction" data-uid="${u.uid}" ${done>=a?'disabled':''}>🎲 ロール</button><span class="sub">${done} / ${a}回</span></div>`;
  }
  return '';
}
function svtHTML(u){
  const d=D(u.def), ph=G.phase;
  const pickable=(G.copy&&copyCands(U(G.copy.uid)).includes(u)) || (G.pending&&pickValid(u)) || (!G.pending&&!G.copy&&ph==='target'&&targetCandidates().includes(u));
  const acting=G.ult?G.ult===u.uid:(G.alloc[u.uid]||0)>0;
  const cls=['svt',u.out?'out':'',pickable?'pickable':'',G.target===u.uid&&!u.out?'targeted':'',acting&&u.pid===G.cur?'acting':''].join(' ');
  const fx=u.fx.map(e=>`<span class="chip fx ${FX[e.k].buff?'buff':'debuff'}">${fxText(e)}</span>`).join('');
  return `<div class="${cls}" data-uid="${u.uid}" ${pickable?`data-a="cardClick"`:''}>
    <div class="portrait">${imgTag(imgSrc(d,'face'),IMG_PLACEHOLDER.face,'pimg',d.name)}
      ${clsIconTag(d.cls,'pcls')}<span class="pord">${ORD[u.idx]}</span>
      ${u.asc?`<span class="pasc">${TERMS.asc}</span>`:''}
      ${u.out?`<span class="pout">撤退</span>`:''}
      ${rollBadge(u,d)}
    </div>
    <div class="sinfo">
      <div class="sname"><b title="${esc(d.name)}">${esc(d.name)}</b><button class="info" data-ui="detail" data-uid="${u.uid}" title="詳細を見る">i</button></div>
      <div class="gauge hp"><span>HP</span><div class="bar"><i style="width:${pctOf(u.hp,d.hp)}%"></i></div><b>${fmt(u.hp)}<small>/${d.hp}</small></b></div>
      <div class="gauge np ${u.np>=RULES.ultCost?'full':''}"><span>${TERMS.gauge}</span><div class="bar"><i style="width:${Math.min(100,u.np)}%"></i></div><b>${u.np}<small>%</small></b></div>
      ${ctlHTML(u)}
      <div class="fxs" title="${esc(u.fx.map(fxText).join(' / '))}">${fx}</div>
      ${skillBtns(u,d)}
    </div>
  </div>`;
}
function sideHTML(pid,pos){
  const P=G.players[pid], turn=pid===G.cur&&G.phase!=='over';
  return `<section class="side ${pos} ${turn?'turn':''}">
    <div class="sidebar"><b class="p${pid}">${esc(P.name)}</b>${turn?'<span class="turnbadge">手番</span>':''}<span class="grow"></span><span class="stars" title="${TERMS.star}">★ <b>${P.stars}</b></span></div>
    <div class="svts">${P.party.map(svtHTML).join('')}</div>
  </section>`;
}

// ---------- 対戦画面：中央 ----------
function promptHTML(){
  const ph=G.phase;
  if(cpuActing()) return `<p class="thinking">CPUが行動中</p>`;
  switch(ph){
    case 'actRoll':
      return !G.actRolled
        ? `<p>全${TERMS.unit}の鉛筆を転がして、最大行動回数を決めます。</p><button class="primary big" data-a="rollActs">🎲 行動回数ロール</button>`
        : `<p>誰を何回行動させるか決めます（合計 <b>${totalAlloc()}</b> / ${RULES.actionsMax}）。</p><button class="primary big" data-a="confirmAlloc">決定</button>`;
    case 'skill':
      return G.pending
        ? `<p class="hl">「${esc(pendingSkill().name)}」の対象を選んでください</p><button data-a="cancelPick">キャンセル</button>`
        : `<p>スキル・${TERMS.ult}を使えます（${TERMS.ult}は${TERMS.gauge}${RULES.ultCost}%以上・1ターン1回）。</p>${G.ult?`<p class="hl">${nm(U(G.ult))}が${TERMS.ult}を使用予定</p>`:''}<button class="primary big" data-a="skillDone">${G.ult?'攻撃対象の選択へ':'行動決定へ'}</button>`;
    case 'action': {
      const left=remainingRolls();
      if(G.copy) return `<p class="hl">${nm(U(G.copy.uid))}：ロールする${TERMS.unit}を選んでください（敵味方どちらでも・${TERMS.asc}後コマンドを使用）</p>`;
      return `<p>行動する${TERMS.unit}の「ロール」でコマンドを決めます（残り${left}回）。</p><button class="primary big" data-a="toTarget" ${left?'disabled':''}>攻撃対象の選択へ</button>`; }
    case 'target':
      return `<p>相手の${TERMS.unit}をクリックして攻撃対象を選びます${targetCandidates().some(u=>has(u,'taunt'))?'（ターゲット集中あり）':''}。</p><p>対象：<b>${G.target?nm(U(G.target)):'未選択'}</b></p><button class="primary big" data-a="resolve" ${G.target?'':'disabled'}>⚔ 攻撃</button>`;
    case 'end':
      return `<p>ダメージフェイズが終わりました。</p><button class="primary big" data-a="endTurn">ターン終了</button>`;
    case 'over':
      return `<p class="win">${G.mode==='cpu'?(G.winner===0?'勝利！':'敗北…'):`${esc(G.players[G.winner].name)} の勝利！`}</p><div class="row"><button class="primary" data-a="rematch">もう一度</button><button data-a="restart">モード選択へ</button></div>`;
  }
  return '';
}
function laneHTML(){
  if(G.ult){ const d=D(U(G.ult).def); return `<div class="it">${cmdCardHTML(d,{c:'ULT',col:d.ult.c})}<span title="${dn(U(G.ult))}">${dn(U(G.ult))}</span></div>`; }
  if(!G.rolled.length) return `<span class="sub small lanehint">ここにこのターンのコマンドが並びます</span>`;
  let s=G.rolled.map(r=>`<div class="it">${cmdCardHTML(D(U(r.uid).def),r.cmd)}<span title="${dn(U(r.uid))}">${dn(U(r.uid))}</span></div>`).join('');
  const badges=[];
  if(G.rolled.length===3){
    const c=G.rolled.map(r=>r.cmd.c);
    if(['R','B','G'].includes(c[0])&&c.every(x=>x===c[0])) badges.push(`${TERMS[c[0]]} Chain`);
    if(G.rolled.every(r=>r.uid===G.rolled[0].uid)) badges.push('Brave Chain');
  }
  if(badges.length) s+=`<div class="chains">${badges.map(b=>`<span class="badge">${b}</span>`).join('')}</div>`;
  return s;
}
// 中央の魔法陣（飾り）：外側と内側を逆向きに回す
// 画面を描き直しても回転が最初に戻らないよう、経過時間ぶん animation-delay をずらす
const MC_SPIN = { out:120, in:80 }; // 1周の秒数（CSS と合わせる）
function magicCircleHTML(){
  const t=performance.now()/1000;
  return `<div class="circle" aria-hidden="true">
    <img class="mc-o" src="${UI_IMG.circleOut}" alt="" style="animation-delay:-${(t%MC_SPIN.out).toFixed(2)}s">
    <img class="mc-i" src="${UI_IMG.circleIn}" alt="" style="animation-delay:-${(t%MC_SPIN.in).toFixed(2)}s"></div>`;
}
function stageHTML(){
  const ph=G.phase, me=G.players[G.cur];
  const stepNo={actRoll:2,skill:3,action:4,target:5,end:7,over:8}[ph]||1;
  const names=['開始','行動回数','スキル','行動','対象','ダメージ','終了'];
  const steps=names.map((s,i)=>`<span class="${i+1===stepNo?'on':i+1<stepNo?'done':''}">${s}</span>`).join('');
  const stars=me.stars, lv=critLevel(stars);
  return `<section class="stage">
    ${magicCircleHTML()}
    <div class="stagetop"><span class="turnno">TURN <b>${G.turn}</b></span><span class="p${G.cur} who">${esc(me.name)}の手番</span><div class="steps">${steps}</div></div>
    <div class="stagebody">
      <div class="prompt">${promptHTML()}</div>
      <div class="lane">${laneHTML()}</div>
      <div class="critbox"><span>クリティカル</span><b>★${stars}</b><small>${lv?`Lv${lv}・${critChance(lv)}%`:'判定なし'}</small></div>
    </div>
  </section>`;
}
function logHTML(){
  return `<aside class="logpane"><div class="loghead"><b>バトルログ</b><button class="small" data-ui="toggleLog">閉じる</button></div>
    <div id="log" class="log">${G.log.slice(-200).map(l=>`<div class="${l.cls}">${l.msg}</div>`).join('')}</div></aside>`;
}

// ---------- 詳細（対戦中の ⓘ・編成画面の右側で共用） ----------
function unitDetailHTML(d,u){
  const fx=u&&u.fx.length?`<h4>効果</h4><div class="fxs open">${u.fx.map(e=>`<span class="chip fx ${FX[e.k].buff?'buff':'debuff'}">${fxText(e)}</span>`).join('')}</div>`:'';
  return `<div class="udetail">
    <div class="udtop">
      <div class="udimg">${imgTag(imgSrc(d,'face'),IMG_PLACEHOLDER.face,'pimg',d.name)}</div>
      <div class="udinfo">${clsBadge(d.cls)}<h3>${esc(d.name)}</h3>
        <div class="sub small">コスト ${d.cost} ・ HP ${u?`${fmt(u.hp)} / `:''}${d.hp}${u?` ・ ${TERMS.gauge} ${u.np}%`:''}${u&&u.asc?` ・ <span class="hl">${TERMS.ascFull}済み</span>`:''}</div>
        <div class="ccrow">${['R','B','G'].map(k=>cmdCardHTML(d,{c:k},{small:true})).join('')}</div>
      </div>
    </div>
    ${fx}
    <h4>スキル・${TERMS.ult}</h4>${skillListHTML(d)}
    <h4>鉛筆の面</h4>${facesTableHTML(d)}
  </div>`;
}
function detailModalHTML(){
  const u=U(UI.detail); if(!u) return '';
  return `<div class="modal"><div class="mback" data-ui="closeDetail"></div>
    <div class="mbody"><button class="mclose" data-ui="closeDetail" title="閉じる">×</button>${unitDetailHTML(D(u.def),u)}</div></div>`;
}

// ---------- 編成画面 ----------
function setupHTML(){
  const pid=G.setupPid, picks=G.picks[pid], cost=sumCost(picks);
  const view=D(UI.setupView)||D(picks[picks.length-1])||UNITS[0];
  const slots=[0,1,2].map(i=>{
    const d=D(picks[i]);
    return d ? `<button class="slot filled" data-a="setupToggle" data-id="${esc(d.id)}" data-view="${esc(d.id)}" title="外す">${imgTag(imgSrc(d,'face'),IMG_PLACEHOLDER.face,'pimg',d.name)}<span>${ORD[i]}</span><b>${esc(d.name)}</b></button>`
             : `<div class="slot"><span>${ORD[i]}</span></div>`;
  }).join('');
  const tiles=UNITS.map(d=>{
    const i=picks.indexOf(d.id), sel=i>=0, over=!sel&&(picks.length>=RULES.partyMax||cost+d.cost>RULES.costCap);
    return `<button class="tile ${sel?'sel':''} ${over?'dim':''} ${view&&view.id===d.id?'viewing':''}" data-a="setupToggle" data-id="${esc(d.id)}" data-view="${esc(d.id)}">
      ${imgTag(imgSrc(d,'face'),IMG_PLACEHOLDER.face,'pimg',d.name)}${clsIconTag(d.cls,'pcls')}
      <span class="tcost">C${d.cost}</span>${sel?`<span class="order">${i+1}</span>`:''}
      <span class="tname">${esc(d.name)}<small>${esc(d.cls)} ・ HP${d.hp}</small></span></button>`;
  }).join('');
  return `<div class="setup">
    <div class="sethead">
      <div class="settitle"><h2><span class="p${pid}">${esc(G.players[pid].name)}</span> のパーティ編成</h2>
        <p class="sub small nm">コスト合計${RULES.costCap}以下・最大${RULES.partyMax}騎。選んだ順に 1st / 2nd / 3rd。</p></div>
      <div class="slots">${slots}</div>
      <div class="costm"><span>COST</span><b>${cost}</b><small>/ ${RULES.costCap}</small><div class="bar"><i style="width:${pctOf(cost,RULES.costCap)}%"></i></div></div>
      <div class="setbtns"><button data-a="setupRandom">おまかせ</button><button class="primary big" data-a="setupConfirm" ${picks.length?'':'disabled'}>決定</button></div>
    </div>
    ${G.setupMsg?`<p class="warn nm">${G.setupMsg}</p>`:''}
    ${cpuActing()?'<p class="thinking nm">CPUが編成中</p>':''}
    <div class="setbody">
      <div class="roster">${tiles}</div>
      <div class="sdetail">${view?unitDetailHTML(view):''}</div>
    </div>
  </div>`;
}

// ---------- モード選択 ----------
function modeHTML(){
  const src = UNIT_SOURCE==='custom'
    ? `<p class="datainfo">ペンシルエディタで作ったデータ（${UNITS.length}騎）を使っています。<button data-a="useDefaultData">標準データに戻す</button></p>`
    : UNIT_BROKEN ? `<p class="datainfo warn">エディタのデータにエラーがあったため、標準データを使っています。</p>` : '';
  const show=UNITS.slice(0,7).map((d,i)=>`<div class="showtile" style="--i:${i}">${imgTag(imgSrc(d,'face'),IMG_PLACEHOLDER.face,'pimg',d.name)}${clsIconTag(d.cls,'pcls')}</div>`).join('');
  return `<div class="mode">
    <div class="title"><small>Fate fan-made pencil battle</small><h2>PENCIL DUEL</h2></div>
    <div class="showcase">${show}</div>
    ${src}
    <div class="modes">
      <div class="card"><h3>CPU戦</h3>
        <p class="sub">あなたが先にパーティを編成し、CPUと1対1で戦います。</p>
        <p class="sub small">よわい：スキルや攻撃対象をほぼ気まぐれに選ぶ<br>ふつう：状況を見てスキル・行動配分・攻撃対象を選ぶ</p>
        <div class="row mt"><button data-a="chooseMode" data-mode="cpu" data-level="easy">よわい</button><button class="primary" data-a="chooseMode" data-mode="cpu" data-level="normal">ふつう</button></div></div>
      <div class="card"><h3>2人対戦</h3>
        <p class="sub">同じ画面で交代しながら遊びます。</p>
        <div class="row mt"><button class="primary" data-a="chooseMode" data-mode="pvp">はじめる</button></div></div>
    </div></div>`;
}

// ---------- 描画 ----------
function render(){
  const app=document.querySelector('#app'), hinfo=document.querySelector('#hinfo'), spd=document.querySelector('#spd'), lb=document.querySelector('#logbtn');
  const screen=G.phase==='mode'?'mode':G.phase==='setup'?'setup':'battle';
  document.body.dataset.screen=screen;
  document.body.classList.toggle('lock',cpuActing());
  spd.hidden=!(G.mode==='cpu'&&G.phase!=='mode');
  spd.textContent=`CPU速度：${G.speed<500?'速い':'普通'}`;
  lb.hidden=screen!=='battle'||UI.log;
  if(screen==='mode'){ app.innerHTML=modeHTML(); hinfo.textContent=''; }
  else if(screen==='setup'){ app.innerHTML=setupHTML(); hinfo.textContent='パーティ編成'; }
  else {
    if(UI.detail&&!U(UI.detail)) UI.detail=null;
    app.innerHTML=`<div class="battle ${UI.log?'':'nolog'}"><main class="field">${sideHTML(1,'top')}${stageHTML()}${sideHTML(0,'bottom')}</main>${UI.log?logHTML():''}</div>${UI.detail?detailModalHTML():''}`;
    hinfo.textContent=`ターン${G.turn}`;
    const l=document.querySelector('#log'); if(l) l.scrollTop=l.scrollHeight;
  }
  scheduleCpu();
  fxKick();
}

// ---------- 入力 ----------
const FREE_ACTIONS=['restart','rematch','toggleSpeed','useDefaultData'];
function uiAct(a,ds){
  switch(a){
    case 'detail': UI.detail=ds.uid; break;
    case 'closeDetail': UI.detail=null; break;
    case 'toggleLog': UI.log=!UI.log; try{ localStorage.setItem('pencilduel.logOpen',UI.log?'1':'0'); }catch(e){} break;
  }
  render();
}
document.addEventListener('click',e=>{
  const u=e.target.closest('[data-ui]');
  if(u){ uiAct(u.dataset.ui,u.dataset); return; }
  const b=e.target.closest('[data-a]'); if(!b||b.disabled) return;
  if(b.dataset.view) UI.setupView=b.dataset.view;
  if(cpuActing() && !FREE_ACTIONS.includes(b.dataset.a)){ if(b.dataset.view) render(); return; } // CPUの手番中は操作を受け付けない
  act(b.dataset.a,{...b.dataset});
});
// 編成画面：カードにマウスを乗せると右側に詳細
document.addEventListener('mouseover',e=>{
  const t=e.target.closest('.tile[data-view]'); if(!t||UI.setupView===t.dataset.view) return;
  UI.setupView=t.dataset.view;
  const box=document.querySelector('.sdetail'), d=D(UI.setupView);
  if(box&&d) box.innerHTML=unitDetailHTML(d);
  document.querySelectorAll('.tile.viewing').forEach(x=>x.classList.remove('viewing')); t.classList.add('viewing');
});
document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&UI.detail){ UI.detail=null; render(); } });
// エディタで反映したデータを、別タブから戻ってきたときに読み直す（モード選択画面にいるときだけ）
window.addEventListener('storage',e=>{ if(e.key===STORE.units && G.phase==='mode'){ reloadUnits(); render(); } });
newGame(); render();
