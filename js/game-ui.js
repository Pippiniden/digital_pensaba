'use strict';
/* =====================================================================
   ゲーム画面の描画と入力
   ===================================================================== */

function skillsHTML(u,d){
  const own=u.pid===G.cur && G.phase==='skill' && !u.out && !disabled(u) && !G.pending;
  const rows=d.skills.map((s,i)=>{
    const locked=i===2&&!u.asc, used=u.used[i], ok=own&&!used&&!locked;
    return `<div class="skill ${used?'used':''}"><button data-a="useSkill" data-uid="${u.uid}" data-si="${i}" ${ok?'':'disabled'}>S${i+1} ${locked?'🔒':''}${esc(s.name)}</button><span class="desc">${esc(effsText(s.eff,s.pick))}${locked?`（${TERMS.asc}後に使用可）`:''}</span></div>`;
  }).join('');
  const ultOk=own&&!G.ult&&u.np>=RULES.ultCost;
  const ult=`<div class="skill ult"><button data-a="useUlt" data-uid="${u.uid}" ${ultOk?'':'disabled'}>${TERMS.ult}「${esc(d.ult.name)}」</button><span class="desc">[${TERMS[d.ult.c]}] ${esc(effsText(d.ult.eff))}</span></div>`;
  return `<div class="skills">${rows}${ult}</div>`;
}
function cardHTML(u){
  const d=D(u.def), own=u.pid===G.cur, ph=G.phase;
  const pickable=(G.pending&&pickValid(u)) || (!G.pending&&ph==='target'&&targetCandidates().includes(u));
  const cls=['card',u.out?'out':'',pickable?'pickable':'',G.target===u.uid&&!G.ult?'targeted':''].join(' ');
  let last='';
  if(u.face){
    const f=d.faces[u.face.i];
    last=`<div class="lastroll">🎲 出目<b>${u.face.i+1}</b>${u.face.kind==='acts'?` ・ 行動回数<b>${f.acts}</b>`:''}${u.face.kind==='cmd'?cmdCardHTML(d,u.face.cmd,{small:true}):''}</div>`;
  }
  let ctl='';
  if(own && !u.out){
    if(ph==='actRoll' && G.actRolled){
      const m=G.maxActs[u.uid]||0, a=G.alloc[u.uid]||0;
      ctl=`<div class="row"><span class="sub">行動させる回数</span><button data-a="alloc" data-uid="${u.uid}" data-d="-1" ${a<=0?'disabled':''}>−</button><b>${a}</b><button data-a="alloc" data-uid="${u.uid}" data-d="1" ${a>=m||totalAlloc()>=RULES.actionsMax?'disabled':''}>＋</button><span class="sub">最大${m}</span></div>`;
    }
    if(ph==='action'){
      const a=G.alloc[u.uid]||0, done=G.rolled.filter(r=>r.uid===u.uid).length;
      if(a) ctl=`<div class="row"><button class="primary" data-a="rollAction" data-uid="${u.uid}" ${done>=a?'disabled':''}>ロール</button><span class="sub">${done} / ${a}回</span></div>`;
    }
  }
  const fx=u.fx.map(e=>`<span class="chip fx ${FX[e.k].buff?'buff':'debuff'}">${fxText(e)}</span>`).join('');
  return `<div class="${cls}" ${pickable?`data-a="cardClick" data-uid="${u.uid}"`:''}>
    <div class="uhead">${faceImg(d)}<div class="uinfo">
    <div class="top"><span class="cls">${esc(d.cls)}</span><b>${esc(d.name)}</b>${u.asc?`<span class="ascb">${TERMS.asc}</span>`:''}${u.out?'<span class="chip">撤退</span>':''}<span class="cost">${['1st','2nd','3rd'][u.idx]} ・ C${d.cost}</span></div>
    <div class="bars">
      <span>HP</span><div class="bar"><i style="width:${u.hp/d.hp*100}%;background:var(--hp)"></i></div><span>${fmt(u.hp)}/${d.hp}</span>
      <span>${TERMS.gauge}</span><div class="bar"><i style="width:${Math.min(100,u.np)}%;background:var(--np)"></i></div><span>${u.np}%</span>
    </div></div></div>
    ${fx?`<div class="fxs">${fx}</div>`:''}
    ${last}${ctl}
    ${skillsHTML(u,d)}
    <details><summary>鉛筆の面</summary>${facesTableHTML(d)}</details>
  </div>`;
}
function sideHTML(pid){
  const P=G.players[pid], turn=pid===G.cur&&G.phase!=='over';
  return `<section><div class="sidehead"><b class="p${pid}">${esc(P.name)}</b>${turn?'<span class="turnbadge">手番</span>':''}<span class="grow"></span><span class="chip">★ ${TERMS.star} ${P.stars}</span></div>${P.party.map(cardHTML).join('')}</section>`;
}
function centerHTML(){
  const ph=G.phase, me=G.players[G.cur];
  const stepNo={actRoll:2,skill:3,action:4,target:5,end:7,over:8}[ph]||1;
  const names=['開始','行動回数','スキル','行動','対象','ダメージ','終了'];
  const steps=names.map((s,i)=>`<span class="${i+1===stepNo?'on':i+1<stepNo?'done':''}">${'①②③④⑤⑥⑦'[i]}${s}</span>`).join('');
  let ctl='';
  if(cpuActing()) ctl=`<p class="thinking">CPUが行動中</p>`;
  else switch(ph){
    case 'actRoll':
      ctl=!G.actRolled
        ? `<p>全${TERMS.unit}をロールし、行動回数エリアの数字で最大行動回数を決めます。</p><button class="primary" data-a="rollActs">行動回数ロール</button>`
        : `<p>誰を何回行動させるか決めます（合計 <b>${totalAlloc()}</b> / ${RULES.actionsMax}）。</p><button class="primary" data-a="confirmAlloc">決定してスキルフェイズへ</button>`;
      break;
    case 'skill':
      ctl=G.pending
        ? `<p class="hl">「${esc(pendingSkill().name)}」の対象をクリックしてください</p><button data-a="cancelPick">キャンセル</button>`
        : `<p>スキル・${TERMS.ult}は任意・順不同で使えます（${TERMS.ult}は${TERMS.gauge}${RULES.ultCost}%以上、1ターン1回）。</p>${G.ult?`<p class="hl">${nm(U(G.ult))}の${TERMS.ult}を使用予定</p>`:''}<button class="primary" data-a="skillDone">${G.ult?'攻撃対象の選択へ':'行動決定へ'}</button>`;
      break;
    case 'action': {
      const left=remainingRolls();
      ctl=`<p>各${TERMS.unit}の「ロール」で行動を決めます（好きな順で・残り${left}回）。</p><button class="primary" data-a="toTarget" ${left?'disabled':''}>攻撃対象の選択へ</button>`;
      break; }
    case 'target':
      ctl=`<p>相手側の${TERMS.unit}をクリックして攻撃対象を選びます${targetCandidates().some(u=>has(u,'taunt'))?'（ターゲット集中あり）':''}。</p><p>対象：<b>${G.target?nm(U(G.target)):'未選択'}</b></p><button class="primary" data-a="resolve" ${G.target?'':'disabled'}>ダメージ計算</button>`;
      break;
    case 'end':
      ctl=`<p>ダメージフェイズが終わりました。</p><button class="primary" data-a="endTurn">終了フェイズ → 相手のターンへ</button>`;
      break;
    case 'over':
      ctl=`<p class="win">${G.mode==='cpu'?(G.winner===0?'あなたの勝利！':'CPUの勝利…'):`${esc(G.players[G.winner].name)} の勝利！`}</p><div class="row"><button class="primary" data-a="rematch">同じモードでもう一度</button><button data-a="restart">モード選択へ</button></div>`;
      break;
  }
  let lane='';
  if(G.ult){ const d=D(U(G.ult).def); lane=`<div class="it">${cmdCardHTML(d,{c:'ULT',col:d.ult.c})}<span class="sub">${dn(U(G.ult))}</span></div>`; }
  else if(G.rolled.length){
    lane=G.rolled.map(r=>`<div class="it">${cmdCardHTML(D(U(r.uid).def),r.cmd)}<span class="sub">${dn(U(r.uid))}</span></div>`).join('');
    if(G.rolled.length===3){
      const c=G.rolled.map(r=>r.cmd.c);
      if(['R','B','G'].includes(c[0])&&c.every(x=>x===c[0])) lane+=`<span class="badge">${TERMS[c[0]]}チェイン</span>`;
      if(G.rolled.every(r=>r.uid===G.rolled[0].uid)) lane+=`<span class="badge">ブレイブチェイン</span>`;
    }
  }
  const stars=me.stars, th=critThreshold(stars);
  return `<section>
    <div class="panel">
      <div class="steps">${steps}</div>
      <div class="turn">ターン${G.turn} ・ <span class="p${G.cur}">${esc(me.name)}</span>の手番</div>
      ${ctl}
      <div class="lane">${lane||`<span class="sub">このターンのコマンドはまだありません</span>`}</div>
      <p class="sub small">クリティカル：${TERMS.star}${stars}個 → ${stars>=30?'確定':th?`出目${th}以下`:'判定なし'}</p>
    </div>
    <div class="panel"><div class="sub small">ログ</div>
      <div id="log" class="log">${G.log.slice(-200).map(l=>`<div class="${l.cls}">${l.msg}</div>`).join('')}</div>
    </div>
  </section>`;
}
// そのユニットの Buster/Arts/Quick カードを並べる（編成画面用）
const cardRowHTML=d=>`<div class="ccrow">${['R','B','G'].map(k=>cmdCardHTML(d,{c:k},{small:true})).join('')}</div>`;
function setupHTML(){
  const pid=G.setupPid, picks=G.picks[pid], cost=sumCost(picks);
  const cards=UNITS.map(d=>{
    const i=picks.indexOf(d.id);
    return `<div class="card ${i>=0?'sel':''}">${i>=0?`<span class="order">${i+1}</span>`:''}
      <div class="uhead">${faceImg(d)}<div class="uinfo"><div class="top"><span class="cls">${esc(d.cls)}</span><b>${esc(d.name)}</b><span class="cost">コスト${d.cost} ・ HP${d.hp}</span></div>
      ${cardRowHTML(d)}</div></div>
      ${skillListHTML(d)}
      <details><summary>鉛筆の面</summary>${facesTableHTML(d)}</details>
      <div class="row mt"><button ${i>=0?'':'class="primary"'} data-a="setupToggle" data-id="${esc(d.id)}">${i>=0?'外す':'選ぶ'}</button></div>
    </div>`;
  }).join('');
  return `<div class="wrap setup">
    <h2><span class="p${pid}">${esc(G.players[pid].name)}</span> のパーティ編成</h2>
    <p class="sub nm">コスト合計${RULES.costCap}以下・最大${RULES.partyMax}体・同じ${TERMS.unit}は1体まで。選んだ順に 1st / 2nd / 3rd になります。</p>
    <div class="pickbar">${picks.map((id,i)=>`<span class="chip">${['1st','2nd','3rd'][i]} ${esc(D(id).name)}</span>`).join('')||'<span class="sub">未選択</span>'}
      <b>コスト ${cost} / ${RULES.costCap}</b><span class="grow"></span>
      <button data-a="setupRandom">おまかせ</button><button class="primary" data-a="setupConfirm" ${picks.length?'':'disabled'}>決定</button></div>
    ${G.setupMsg?`<p class="warn">${G.setupMsg}</p>`:''}
    ${cpuActing()?'<p class="thinking">CPUが編成中</p>':''}
    <div class="grid">${cards}</div></div>`;
}
function modeHTML(){
  const src = UNIT_SOURCE==='custom'
    ? `<p class="datainfo">ペンシルエディタで作ったデータ（${UNITS.length}体）を使っています。<button data-a="useDefaultData">標準データに戻す</button></p>`
    : UNIT_BROKEN ? `<p class="datainfo warn">エディタのデータにエラーがあったため、標準データを使っています。</p>` : '';
  return `<div class="mode"><h2>対戦モードを選ぶ</h2>
    ${src}
    <div class="modes">
      <div class="card"><h3>CPU戦</h3>
        <p class="sub">あなたが先にパーティを編成し、CPUと1対1で戦います。</p>
        <p class="sub small">よわい：スキルや攻撃対象をほぼ気まぐれに選ぶ<br>ふつう：状況を見てスキル・行動配分・攻撃対象を選ぶ</p>
        <div class="row mt"><button data-a="chooseMode" data-mode="cpu" data-level="easy">よわい</button><button class="primary" data-a="chooseMode" data-mode="cpu" data-level="normal">ふつう</button></div></div>
      <div class="card"><h3>2人対戦</h3>
        <p class="sub">同じ画面で交代しながら遊びます。</p>
        <div class="row mt"><button data-a="chooseMode" data-mode="pvp">はじめる</button></div></div>
    </div></div>`;
}
function render(){
  const app=document.querySelector('#app'), hinfo=document.querySelector('#hinfo'), spd=document.querySelector('#spd');
  document.body.classList.toggle('lock',cpuActing());
  spd.hidden=!(G.mode==='cpu'&&G.phase!=='mode');
  spd.textContent=`CPU速度：${G.speed<500?'速い':'普通'}`;
  if(G.phase==='mode'){ app.innerHTML=modeHTML(); hinfo.textContent=''; }
  else if(G.phase==='setup'){ app.innerHTML=setupHTML(); hinfo.textContent='パーティ編成'; }
  else {
    app.innerHTML=`<div class="wrap"><div class="board">${sideHTML(0)}${centerHTML()}${sideHTML(1)}</div></div>`;
    hinfo.textContent=`ターン${G.turn}`;
    const l=document.querySelector('#log'); if(l) l.scrollTop=l.scrollHeight;
  }
  scheduleCpu();
}
const FREE_ACTIONS=['restart','rematch','toggleSpeed','useDefaultData'];
document.addEventListener('click',e=>{
  if(e.target.closest('details')) return;
  const b=e.target.closest('[data-a]'); if(!b||b.disabled) return;
  if(cpuActing() && !FREE_ACTIONS.includes(b.dataset.a)) return; // CPUの手番中は操作を受け付けない
  act(b.dataset.a,{...b.dataset});
});
// エディタで反映したデータを、別タブから戻ってきたときに読み直す（モード選択画面にいるときだけ）
window.addEventListener('storage',e=>{ if(e.key===STORE.units && G.phase==='mode'){ reloadUnits(); render(); } });
newGame(); render();
