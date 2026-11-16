'use strict';
/* =====================================================================
   ゲーム画面の描画と入力
   - 対戦画面は1画面に収まるレイアウト（上：相手 / 中央：コマンド / 下：自分 / 右：ログ）
   - 詳細（スキル説明・鉛筆の面）は ⓘ ボタンのウィンドウで見る
   - 画面だけの状態（詳細ウィンドウ・ログの開閉など）は UI に持ち、G には入れない
   ===================================================================== */

const UI = { nav:{s:'top',step:'rule'}, /* モード選択の階層：top / quick(rule→level) / local / tutorial / settings */ menu:false, mfold:false, /* マスター選択の折り畳み */ spellPick:false, /* 令呪の即時発動：3つの中から選ぶ表示 */ result:false, resultShown:false, endReady:false,
  roster:{ sort:'default', cls:'', cost:'', q:'', ok:false }, /* キャラクター選択の並べ替え・絞り込み */ detail:null, setupView:null, log:readLogPref(), auto:readPref('pencilduel.auto')==='1' };
function readPref(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
function savePref(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }
window.SPEED_PREF=Number(readPref('pencilduel.speed'))||0; // 設定で選んだ進行速度（newGame が読む）
function readLogPref(){
  const v=readPref('pencilduel.logOpen'); if(v!=null) return v==='1';
  return window.innerWidth>1100;
}
const ORD=['1st','2nd','3rd'];
// 自分が操作できない番：CPUの手番、またはオンライン対戦で相手の番（net.js。編成中も含む）
const netWait=()=>typeof netWaiting==='function'&&netWaiting();
const otherActing=()=>cpuActing()||netWait();
const pctOf=(a,b)=>Math.max(0,Math.min(100,a/b*100));

// ---------- 対戦画面：サーヴァント ----------
function skillBtns(u,d){
  const own=u.pid===G.cur && G.phase==='skill' && !u.out && !G.pending;
  const sealed=!canSkill(u)&&!u.out;
  const sk=d.skills.map((s,i)=>{
    const locked=i===2&&!u.asc, used=u.used[i], ok=own&&skillUsable(u,i);
    const tip=`S${i+1}「${s.name}」 ${effsText(s.eff,s.pick)}${locked?`（${TERMS.asc}後に使用可）`:''}${used?'（使用済み）':''}${sealed?'（使用不可）':''}`;
    return `<span class="skw" title="${esc(tip)}"><button class="sk ${used?'used':''} ${locked?'locked':''}" data-a="useSkill" data-uid="${u.uid}" data-si="${i}" ${ok?'':'disabled'}><i>S${i+1}</i><span>${locked?'🔒':''}${skillNameHTML(s)}</span></button></span>`;
  }).join('');
  if(G.ult===u.uid&&G.phase==='skill'){ // 使用予定の宝具：押すと取り消し（スキルフェイズの間だけ）
    return `<div class="sks">${sk}<span class="skw" title="${TERMS.ult}の使用を取り消して${TERMS.gauge}を戻す"><button class="sk np ${d.ult.c} ready" data-a="cancelUlt" ${own?'':'disabled'}><i>取消</i><span>${ultNameHTML(d.ult)}</span></button></span></div>`;
  }
  const ready=u.np>=RULES.ultCost&&!u.out, ok=own&&canUlt(u)&&!G.ult&&!G.ultDone&&ready;
  const tip=`${TERMS.ult}「${d.ult.name}」 [${TERMS[d.ult.c]}] ${effsText(d.ult.eff,d.ult.pick)}（${TERMS.gauge}${RULES.ultCost}%で使用可）`;
  const ult=`<span class="skw" title="${esc(tip)}"><button class="sk np ${d.ult.c} ${ready?'ready':''}" data-a="useUlt" data-uid="${u.uid}" ${ok?'':'disabled'}><i>${TERMS.ult}</i><span>${ultNameHTML(d.ult)}</span></button></span>`;
  return `<div class="sks">${sk}${ult}</div>`;
}
function rollBadge(u,d){
  if(!u.face||FXHIDE.has(`f:${u.uid}`)) return ''; // ロール演出の着地までは出さない
  const n=u.face.kind==='acts'?(G.maxActs[u.uid]??faceActs(d,u.face.i)):0;
  return `<div class="proll"><span class="die">${u.face.i+1}</span>${u.face.kind==='acts'?`<span class="actn">×${n}</span>`:''}${u.face.kind==='cmd'?cmdCardHTML(d,u.face.cmd,{small:true}):''}</div>`;
}
function ctlHTML(u){
  if(u.pid!==G.cur || u.out) return '';
  if(G.phase==='actRoll' && G.actRolled){
    if(FXHIDE.has(`f:${u.uid}`)) return `<div class="ctl"><span class="sub">ロール中…</span></div>`;
    const m=G.maxActs[u.uid]||0, a=G.alloc[u.uid]||0;
    // 配分はカードのクリックで行う（自分のカード＝1回追加、中央のカード＝1回戻す）。ここは回数の表示だけ
    return `<div class="ctl alloc"><span class="sub">行動</span>${Array.from({length:m},(_,i)=>`<i class="pip ${i<a?'on':''}"></i>`).join('')||'<span class="sub">なし</span>'}<b>${a}<small>/${m}</small></b></div>`;
  }
  if(G.phase==='action'){
    const a=G.alloc[u.uid]||0, done=G.rolled.filter(r=>r.uid===u.uid).length;
    if(a) return `<div class="ctl"><button class="primary" data-a="rollAction" data-uid="${u.uid}" ${done>=a?'disabled':''}>🎲 ロール</button><span class="sub">${done} / ${a}回</span></div>`;
  }
  return '';
}
// 行動配分：このサーヴァントにもう1回行動を割り振れるか
function canAllocMore(u){
  return G.phase==='actRoll'&&G.actRolled&&u.pid===G.cur&&!u.out&&!otherActing()&&!FXHIDE.has(`f:${u.uid}`)
    &&(G.alloc[u.uid]||0)<(G.maxActs[u.uid]||0)&&totalAlloc()<RULES.actionsMax;
}
// 画面に出すHP・戦闘不能の状態（ダメージ演出の再生中は演出に合わせて遅れて変わる）
// HP・NP・効果は、演出の再生に合わせて遅れて変わる（FXHOLD にあればそれを出す）
const shown = u=>{ const h=FXHOLD[u.uid]; return h?{hp:h.hp,out:h.out,np:h.np??u.np,fx:h.fx||u.fx}:{hp:u.hp,out:u.out,np:u.np,fx:u.fx}; };
// かかっている効果で枠を光らせる：回避・無敵＝緑 / 良い効果＝青 / 悪い効果＝赤（複数あるときは 緑→青→赤 の順に切り替わる）
function glowHTML(fxs){
  let g=false,b=false,r=false;
  fxs.forEach(e=>{ const f=FX[e.k]; if(!f) return; if(e.k==='evade'||e.k==='invul') g=true; else if(f.buff===true) b=true; else if(f.buff===false) r=true; });
  const key=(g?'g':'')+(b?'b':'')+(r?'r':'');
  return key?`<i class="glow gl-${key}"></i>`:'';
}
function svtHTML(u){
  const d=D(u.def), ph=G.phase, sh=shown(u), mhp=maxHp({def:u.def,fx:sh.fx,pid:u.pid});
  const allocable=canAllocMore(u);
  const pickable=allocable || (G.spellPick&&pickOk(G.spellPick.side,u,G.cur)) || (G.copy&&copyCands(U(G.copy.uid)).includes(u)) || (G.pending&&pickValid(u)) || (!G.pending&&!G.copy&&ph==='target'&&targetCandidates().includes(u));
  const acting=G.ult?G.ult===u.uid:(G.alloc[u.uid]||0)>0;
  const tgt=(G.targetAll?u.pid!==G.cur&&!u.out&&['target','end'].includes(ph):G.target===u.uid)&&!sh.out;
  // スキルを使える自分のサーヴァント（スキル欄が隠れる小さい表示のとき、ⓘ を光らせて知らせる）
  const canSk=u.pid===G.cur&&ph==='skill'&&!G.pending&&!otherActing()&&(d.skills.some((s,i)=>skillUsable(u,i))||!G.ult&&!G.ultDone&&canUlt(u)&&u.np>=RULES.ultCost);
  const cls=['svt',sh.out?'out':'',pickable?'pickable':'',tgt?'targeted':'',acting&&u.pid===G.cur?'acting':'',canSk?'canskill':''].join(' ');
  const fx=(hasHcap(u)?`<span class="chip fx buff hcapchip">ハンデ：${hcapText()}</span>`:'')+costChip(u)+sh.fx.map(e=>`<span class="chip fx ${FX[e.k].buff?'buff':'debuff'}">${fxText(e)}</span>`).join('');
  // スマホの簡易表示用：効果の数（強化▲・弱体▼）。中身は拡大ウィンドウで見る
  const nb=sh.fx.filter(e=>FX[e.k].buff===true).length, nd=sh.fx.filter(e=>FX[e.k].buff===false).length;
  const pfx=nb||nd?`<span class="pfx">${nb?`<b class="buff">▲${nb}</b>`:''}${nd?`<b class="debuff">▼${nd}</b>`:''}</span>`:'';
  return `<div class="${cls}${allocable?' allocable':''}" data-uid="${u.uid}" ${allocable?`data-a="alloc" data-d="1" title="クリックで行動を1回追加"`:pickable?`data-a="cardClick"`:''}>
    ${glowHTML(sh.fx)}
    <div class="svin"><div class="portrait">${unitImg(d,'face','pimg',d.name)}
      ${clsIconTag(d.cls,'pcls')}<span class="pord">${ORD[u.idx]}</span>
      ${u.asc?`<span class="pasc">${TERMS.asc}</span>`:''}
      ${sh.out?`<span class="pout">${TERMS.out}</span>`:''}
      ${pfx}${rollBadge(u,d)}
    </div>
    <div class="sinfo">
      <div class="sname"><b title="${esc(d.name)}">${esc(d.name)}</b><button class="info" data-ui="detail" data-uid="${u.uid}" title="詳細を見る">i</button></div>
      <div class="gauge hp"><span>HP</span><div class="bar"><i style="width:${pctOf(sh.hp,mhp)}%"></i></div><b>${fmt(sh.hp)}<small>/${mhp}</small></b></div>
      <div class="gauge np ${sh.np>=RULES.ultCost?'full':''}"><span class="npl">${TERMS.gauge}</span><div class="bar"><i style="width:${Math.min(100,sh.np)}%"></i></div><b>${sh.np}<small>%</small></b></div>
      ${ctlHTML(u)}
      <div class="fxs" title="${esc(sh.fx.map(fxText).join(' / '))}">${fx}</div>
      ${skillBtns(u,d)}
    </div></div>
  </div>`;
}
// マスター戦（1騎＋マスター）：マスターはサーヴァントの隣にカードで出す。マスターチーム戦は従来どおり帯の小パネル
const masterBeside = P=>!!P.master&&masterRule()&&!mTeam();
function masterCardHTML(m){
  const d=D(m.def), sh=shown(m), P=G.players[m.pid], mhp=maxHp({def:m.def,fx:sh.fx});
  const pick=G.phase==='target'&&!G.pending&&!G.copy&&!otherActing()&&masterTargetable()===m;
  const tgt=G.phase==='target'&&G.target===m.uid&&!sh.out;
  const sp=P.spell==='decl'?'令呪 宣言中':P.spellLeft>0?`令呪 ${P.spellLeft}画`:'令呪 使用済み';
  const fx=sh.fx.map(e=>`<span class="chip fx ${FX[e.k].buff?'buff':'debuff'}">${fxText(e)}</span>`).join('');
  const nb=sh.fx.filter(e=>FX[e.k].buff===true).length, nd=sh.fx.filter(e=>FX[e.k].buff===false).length;
  const pfx=nb||nd?`<span class="pfx">${nb?`<b class="buff">▲${nb}</b>`:''}${nd?`<b class="debuff">▼${nd}</b>`:''}</span>`:'';
  return `<div class="svt mcard ${sh.out?'out':''} ${pick?'pickable':''} ${tgt?'targeted':''}" data-uid="${m.uid}" ${pick?'data-a="cardClick"':''}>
    ${glowHTML(sh.fx)}
    <div class="svin"><div class="portrait">${unitImg(d,'face','pimg',d.name)}<span class="pord">${TERMS.player}</span>${sh.out?'<span class="pout">瀕死</span>':''}${pfx}</div>
    <div class="sinfo">
      <div class="sname"><b title="${esc(d.name)}">${esc(d.name)}</b><button class="info" data-ui="detail" data-uid="${m.uid}" title="詳細を見る">i</button></div>
      <div class="gauge hp"><span>HP</span><div class="bar"><i style="width:${pctOf(sh.hp,mhp)}%"></i></div><b>${fmt(sh.hp)}<small>/${mhp}</small></b></div>
      <div class="mtags"><span class="mtag ${P.spellLeft>0&&P.spell!=='decl'?'':'off'}">${sp}</span>${P.evac?'<span class="mtag evac">退避中</span>':''}</div>
      <div class="fxs" title="${esc(sh.fx.map(fxText).join(' / '))}">${fx}</div>
    </div></div>
  </div>`;
}
function sideHTML(pid,pos){
  const P=G.players[pid], turn=pid===G.cur&&G.phase!=='over', beside=masterBeside(P);
  return `<section class="side ${pos} ${turn?'turn':''}">
    <div class="sidebar"><b class="p${pid}">${esc(P.name)}</b>${turn?'<span class="turnbadge">手番</span>':''}${P.master&&!beside?masterChipHTML(P.master):'<span class="grow"></span>'}<span class="stars" title="${TERMS.star}">★ <b>${P.stars}</b></span></div>
    <div class="svts ${P.party.length===1?'solo':''} ${beside?'withm':''}">${P.party.map(svtHTML).join('')}${beside?masterCardHTML(P.master):''}</div>
  </section>`;
}

// ---------- 対戦画面：マスター（マスタールール） ----------
// 陣営の帯に出す小さなパネル。攻撃対象の選択中は、敵マスターを押して対象にできる
function masterChipHTML(m){
  const d=D(m.def), sh=shown(m), P=G.players[m.pid];
  const pick=G.phase==='target'&&!G.pending&&!G.copy&&!otherActing()&&masterTargetable()===m;
  const tgt=G.phase==='target'&&G.target===m.uid&&!sh.out;
  const sp=P.spell==='decl'?'令呪 宣言中':P.spellLeft>0?`令呪 ${P.spellLeft}画`:'令呪 使用済み';
  const nb=sh.fx.filter(e=>FX[e.k].buff===true).length, nd=sh.fx.filter(e=>FX[e.k].buff===false).length, mhp=maxHp({def:m.def,fx:sh.fx});
  return `<div class="mchip ${sh.out?'out':''} ${pick?'pickable':''} ${tgt?'targeted':''}" data-uid="${m.uid}" ${pick?'data-a="cardClick"':''} title="${esc(sh.fx.map(fxText).join(' / '))}">
    <span class="mlab">${TERMS.player}</span><b class="mname" title="${esc(d.name)}">${esc(d.name)}</b>
    <span class="gauge hp"><div class="bar"><i style="width:${pctOf(sh.hp,mhp)}%"></i></div><b>${fmt(sh.hp)}<small>/${mhp}</small></b></span>
    <span class="mtag ${P.spellLeft>0&&P.spell!=='decl'?'':'off'}">${sp}</span>${P.evac?'<span class="mtag evac">退避中</span>':''}${sh.out?'<span class="mtag dead">瀕死</span>':''}
    ${nb||nd?`<span class="pfx">${nb?`<b class="buff">▲${nb}</b>`:''}${nd?`<b class="debuff">▼${nd}</b>`:''}</span>`:''}
    <button class="info" data-ui="detail" data-uid="${m.uid}" title="詳細を見る">i</button></div>`;
}
// マスターフェイズの選択肢
function masterPromptHTML(){
  const m=masterOf(G.cur), d=D(m.def), P=G.players[G.cur], em=masterOf(1-G.cur), es=alive(1-G.cur)[0], rs=ruleset();
  const spells=(a,extra='')=>d.spells.map((s,i)=>`<button data-a="${a}" data-i="${i}" ${extra} title="${esc(effsText(s.eff,null,mTLabel))}">${esc(s.name)}</button>`).join('');
  if(G.spellPick){ // 対象の選択待ち（令呪・補助）。補助はロール済みなのでキャンセル不可
    const sp=G.spellPick, s=sp.sup||d.spells[sp.i], who=sp.side==='enemy'?`敵の${TERMS.unit}`:sp.side==='own'?`自軍の${TERMS.unit}`:TERMS.unit;
    const nmTxt=s.name||s.label;
    return `<p class="hl">${nmTxt?`「${esc(nmTxt)}」`:'補助効果'}の対象にする${who}を選んでください</p><p class="sub small">${esc(spellText(s))}</p>${sp.sup?'':'<button class="ghost" data-a="cancelPick">キャンセル</button>'}`;
  }
  if(P.spell==='decl') return `<p>宣言した<b class="hl">令呪</b>を1つ選んで発動します。</p><div class="row mopts">${spells('masterSpellUse')}</div>`;
  if(rs.mTeam){ // マスターチーム：補助か令呪（3画・同じ効果は1回）
    const can=canDeclareSpell();
    return `<p>${TERMS.player}の行動を1つ選びます。</p><div class="row mopts">
      <button class="primary" data-a="masterSupport" title="${TERMS.player}の鉛筆を振り、出た面の効果をこのターンだけ適用">🎲 ${MASTER_ACTS.support}</button>
      ${d.spells.map((s,i)=>`<button data-a="masterSpell" data-i="${i}" ${can&&!P.spellUsed[i]?'':'disabled'} title="${esc(spellText(s))}（行動回数-1）">${esc(s.name)}${P.spellUsed[i]?'（使用済み）':''}</button>`).join('')}</div>
      <p class="sub small">令呪は残り${P.spellLeft}画。使うと行動回数が1回減ります${can||!P.spellLeft?'':`（${TERMS.unit}が1騎でも行動0回のターンは使えません）`}。</p>`;
  }
  if(UI.spellPick) return `<p>★${rs.spellNowStars}（クリティカルLv4）を消費して、令呪をすぐに使います。</p><div class="row mopts"><button class="back" data-ui="spellPick">戻る</button>${spells('masterSpell','data-now="1"')}</div>`;
  const atkM=em&&!em.out, evac=atkM&&G.players[em.pid].evac, canSp=canDeclareSpell();
  return `<p>${TERMS.player}の行動を1つ選びます。</p><div class="row mopts">
    <button class="primary" data-a="masterSupport" title="${TERMS.player}の鉛筆を振り、出た面の効果をこのターンだけ適用">🎲 ${MASTER_ACTS.support}</button>
    <button data-a="masterAttack" data-to="svt" ${es?'':'disabled'} title="相手の${TERMS.unit}にコスト×${rs.masterAtk.svt}">${MASTER_ACTS.attack}：${TERMS.unit} ${es?masterAtkDmg(m,es):''}</button>
    <button data-a="masterAttack" data-to="master" ${atkM?'':'disabled'} title="相手の${TERMS.player}にコスト×${rs.masterAtk.master}${evac?'（退避中なので当たらない）':''}">${MASTER_ACTS.attack}：${TERMS.player} ${atkM?masterAtkDmg(m,em):''}${evac?'（退避中）':''}</button>
    <button data-a="masterSpell" ${canSp?'':'disabled'} title="このターンの以降のフェイズをスキップし、次の${TERMS.player}フェイズに3つの中から1つ使う（1試合1回）">${MASTER_ACTS.spell}：宣言</button>
    <button data-ui="spellPick" ${canSp&&P.stars>=rs.spellNowStars?'':'disabled'} title="★${rs.spellNowStars}を消費して、スキップせずにすぐ使う">${MASTER_ACTS.spell}：即時 ★${rs.spellNowStars}</button>
    <button data-a="masterEvac" title="次の相手ターン、相手${TERMS.player}の攻撃と${TERMS.unit}の全体攻撃を受けない">${MASTER_ACTS.evac}</button></div>
    ${!P.spellLeft?'<p class="sub small">令呪は使用済みです。</p>':!canSp?`<p class="sub small">このターンは${TERMS.unit}が行動できないため、令呪は使えません。</p>`:''}`;
}
// 令呪の効果の説明（マスターチームでは「自軍サーヴァント」が選んだ1騎になる）
const spellText = s=>effsText(s.eff,null,spellTgt);
// 守る側の選択（マスターへの攻撃）
function guardPromptHTML(){
  const g=G.guard, dp=1-G.cur, em=masterOf(dp), who=`<b class="p${dp}">${esc(G.players[dp].name)}</b>`;
  if(g.kind==='spell') return `<p class="hl">${who}：${nm(em)}への攻撃（${g.dmg}ダメージ）を、令呪1画を使って${TERMS.unit}に守らせますか？</p>
    <div class="row"><button data-a="guard" data-to="take">受ける</button><button class="primary" data-a="guard" data-to="block">令呪で守る</button></div>`;
  return `<p class="hl">${who}：${TERMS.player}への攻撃を、どちらで受けますか？</p>
    <div class="row"><button data-a="guard" data-to="master">${TERMS.player}で受ける</button><button class="primary" data-a="guard" data-to="svt">${TERMS.unit}で受ける</button></div>`;
}

// ---------- 対戦画面：中央 ----------
function promptHTML(){
  const ph=G.phase;
  if(netWait()) return `<p class="thinking">相手が行動中</p>`;
  if(otherActing()) return G.mode==='watch'?`<p class="thinking">観戦中：${esc(G.players[actor()].name)}が行動中</p>`:`<p class="thinking">CPUが行動中</p>`;
  switch(ph){
    case 'actRoll':
      return !G.actRolled
        ? `<p>全${TERMS.unit}の鉛筆を転がして、最大行動回数を決めます。</p><button class="primary big" data-a="rollActs">🎲 行動回数ロール</button>`
        : allocPromptHTML();
    case 'master': return masterPromptHTML();
    case 'guard': return guardPromptHTML();
    case 'skill':
      return G.pending
        ? `<p class="hl">「${esc(pendingSkill().name)}」の対象を選んでください</p><button class="ghost" data-a="cancelPick">キャンセル</button>`
        : `<p>スキル・${TERMS.ult}を使えます。${TERMS.ult}は${TERMS.gauge}${RULES.ultCost}%以上・1ターン1回。</p>${G.ult?`<p class="hl">${nm(U(G.ult))}が${TERMS.ult}を使用予定 <button class="small ghost" data-a="cancelUlt" title="${TERMS.gauge}を戻して取り消します（このフェイズの間だけ）">取り消す</button></p>`:''}<button class="primary big" data-a="skillDone">${G.ult?'攻撃対象の選択へ':'行動決定へ'}</button>`;
    case 'action': {
      const left=remainingRolls();
      if(G.copy) return `<p class="hl">${nm(U(G.copy.uid))}：ロールする${TERMS.unit}を選んでください（敵味方どちらでも・${TERMS.asc}後コマンドを使用）</p>`;
      return `<p>行動する${TERMS.unit}の「ロール」でコマンドを決めます（残り${left}回）。</p><button class="primary big" data-a="toTarget" ${left?'disabled':''}>攻撃対象の選択へ</button>`; }
    case 'target':
      if(G.targetAll) return `<p>${TERMS.ult}「${esc(D(U(G.ult).def).ult.name)}」は<b class="hl">敵全体</b>が対象です。</p><button class="primary big" data-a="resolve">⚔ ${TERMS.ult}発動</button>`;
      return `<p>相手の${TERMS.unit}${masterTargetable()?`か${TERMS.player}`:''}をクリックして攻撃対象を選びます${targetCandidates().some(u=>has(u,'taunt'))?'（ターゲット集中あり）':''}。</p><p>対象：<b>${G.target?nm(U(G.target)):'未選択'}</b></p><button class="primary big" data-a="resolve" ${G.target?'':'disabled'}>⚔ 攻撃</button>`;
    case 'end':
      // ダメージ演出の再生中は「終わりました」を出さない（演出が終わったら fx.js が描き直す）
      if(fxBusy()){ UI.defer=true; return `<p class="thinking">ダメージ処理中</p>`; }
      return `<p>ダメージフェイズが終わりました。</p><button class="primary big" data-a="endTurn">ターン終了</button>`;
    case 'over':
      if(!UI.endReady) return ''; // 決着の演出（VICTORY の帯）が終わってから出す
      if(G.arcade) return `<p class="win">${G.winner!==0?'敗北…':arcadeLast()?'アーケードクリア！':`STAGE ${G.arcade.stage+1} クリア！`}</p><div class="row"><button class="ghost" data-a="restart">タイトルに戻る</button><button data-ui="openResult">リザルト</button>${arcadeNextBtn()}</div>`;
      return `<p class="win">${G.mode==='cpu'?(G.winner===0?'勝利！':'敗北…'):`${esc(G.players[G.winner].name)} の勝利！`}</p><div class="row"><button class="ghost" data-a="restart">タイトルに戻る</button><button data-ui="openResult">リザルト</button>${rematchBtns()}</div>`;
  }
  return '';
}
// 行動配分の案内：行動回数は必ず使い切る（合計が requiredAlloc() ちょうどになるまで決定できない）
function allocPromptHTML(){
  const need=requiredAlloc(), tot=totalAlloc(), left=need-tot;
  return `<p>行動させる${TERMS.unit}を選ぶと中央に並びます。中央のカードを選ぶと戻せます。行動回数はすべて使い切ります（合計 <b>${tot}</b> / ${need}）。</p>
    ${left>0?`<p class="hl">あと${left}回割り振ってください</p>`:''}<button class="primary big" data-a="confirmAlloc" ${left?'disabled':''}>決定</button>`;
}
// 行動配分中のコマンド列：割り振った回数ぶんサーヴァントのカードを並べる（クリックで1回戻す）
function allocCards(){
  return G.players[G.cur].party.filter(u=>!u.out&&!FXHIDE.has(`f:${u.uid}`))
    .flatMap(u=>Array.from({length:G.alloc[u.uid]||0},(_,k)=>({u,k})));
}
function allocLaneHTML(){
  const cs=allocCards(), own=!otherActing();
  if(!cs.length) return `<span class="sub small lanehint">${TERMS.unit}を選ぶとここに並びます</span>`;
  const slots=Array.from({length:RULES.actionsMax-cs.length},()=>`<div class="it"><div class="aslot"></div><span>&nbsp;</span></div>`).join('');
  return cs.map(({u,k})=>{ const d=D(u.def);
    return `<div class="it al" data-key="${u.uid}#${k}" ${own?`data-a="alloc" data-uid="${u.uid}" data-d="-1" title="クリックで戻す"`:''}>
      <div class="acard">${unitImg(d,'card','pimg',d.name)}<span class="aord">${ORD[u.idx]}</span></div>
      <span title="${dn(u)}">${dn(u)}</span></div>`; }).join('')+slots;
}
// 新しく並んだカードを、そのサーヴァントの肖像の位置から飛ばしてくる（描き直しても既にあるカードは動かさない）
let laneSeen=new Set();
function animateLane(){
  const items=[...document.querySelectorAll('.lane .it.al')], now=new Set(items.map(e=>e.dataset.key));
  items.forEach(el=>{
    if(laneSeen.has(el.dataset.key)) { el.style.animation='none'; return; }
    const p=document.querySelector(`.svt[data-uid="${el.dataset.key.split('#')[0]}"] .portrait`); if(!p) return;
    const a=p.getBoundingClientRect(), b=el.getBoundingClientRect();
    el.style.animation='none';
    el.animate([{transform:`translate(${a.left+a.width/2-b.left-b.width/2}px,${a.top+a.height/2-b.top-b.height/2}px) scale(.6)`,opacity:.3},{transform:'none',opacity:1}],
      {duration:380,easing:'cubic-bezier(.2,.8,.2,1)'});
  });
  laneSeen=now;
}
function laneHTML(){
  if(G.phase==='actRoll') return G.actRolled?allocLaneHTML():'';
  if(G.ult){ const d=D(U(G.ult).def); return `<div class="it">${cmdCardHTML(d,{c:'ULT',col:d.ult.c})}<span title="${dn(U(G.ult))}">${dn(U(G.ult))}</span></div>`; }
  const vis=G.rolled.filter((r,i)=>!FXHIDE.has(`r:${i}`)); // ロール演出の着地前のカードはまだ出さない
  if(!vis.length) return `<span class="sub small lanehint">${G.rolled.length?'ロール中…':''}</span>`;
  let s=vis.map(r=>`<div class="it">${cmdCardHTML(D(U(r.uid).def),r.cmd)}<span title="${dn(U(r.uid))}">${dn(U(r.uid))}</span></div>`).join('');
  const badges=[];
  if(vis.length===3){
    const c=G.rolled.map(r=>r.cmd.c);
    if(['R','B','G'].includes(c[0])&&c.every(x=>x===c[0])) badges.push(`${TERMS[c[0]]} Chain`);
    if(G.rolled.every(r=>r.uid===G.rolled[0].uid)) badges.push('Brave Chain');
  }
  if(badges.length) s+=`<div class="chains">${badges.map(b=>`<span class="badge">${b}</span>`).join('')}</div>`;
  return s;
}
// 中央の魔法陣（飾り）：外側と内側を逆向きに回す
// CSS の animation は、要素を作り直したり付け替えたりすると最初からやり直しになる（描き直しのたびに回転がカクッと戻る）。
// そこで回転は Web Animations API で付ける：開始時刻をページの時計の 0 に固定するので、角度は「今の時刻」だけで決まり、
// 要素が作り直されても付け替えられても、同じ角度から途切れずに回り続ける
const MC_SPIN = { out:120, in:80 }; // 1周の秒数
function magicCircleHTML(){
  return `<div class="circle" aria-hidden="true">
    <img class="mc-o" src="${UI_IMG.circleOut}" alt="">
    <img class="mc-i" src="${UI_IMG.circleIn}" alt=""></div>`;
}
function syncMagicCircle(){
  document.querySelectorAll('.circle img').forEach(im=>{
    if(im._spin&&im._spin.playState==='running') return; // 付け替えた画像は回転が続いている
    const out=im.classList.contains('mc-o');
    try{
      im._spin=im.animate([{rotate:'0deg'},{rotate:'360deg'}],{duration:(out?MC_SPIN.out:MC_SPIN.in)*1000,iterations:Infinity,direction:out?'normal':'reverse'});
      im._spin.startTime=0;
    }catch(e){}
  });
}
// 点滅（宝具ゲージ・宝具ボタン）も、作り直すたびに最初の明るさへ飛んでチカチカするので、時刻に合わせた位置から始める
const PULSES = [['.gauge.np.full i',2000],['.sk.np.ready',2200],['.glow.gl-g,.glow.gl-b,.glow.gl-r',2400],['.glow.gl-gb,.glow.gl-gr,.glow.gl-br',3600],['.glow.gl-gbr',5400]]; // [セレクタ, 往復1回のミリ秒（CSS と合わせる）]
function syncPulses(){
  const t=performance.now();
  PULSES.forEach(([sel,ms])=>document.querySelectorAll(sel).forEach(el=>{ el.style.animationDelay=`-${(t%ms).toFixed(0)}ms`; }));
}
function stageHTML(){
  const ph=G.phase, me=G.players[G.cur];
  const mr=masterRule();
  const stepNo=(mr?{actRoll:2,master:3,skill:4,action:5,target:6,guard:G.guard&&G.guard.kind==='spell'?3:6,end:8,over:9}:{actRoll:2,skill:3,action:4,target:5,end:7,over:8})[ph]||1;
  const names=mr?['開始','行動回数',TERMS.player,'スキル','行動','対象','ダメージ','終了']:['開始','行動回数','スキル','行動','対象','ダメージ','終了'];
  const stepShown=ph==='end'&&fxBusy()?(mr?7:6):stepNo; // ダメージ演出中は「ダメージ」のまま
  const steps=names.map((s,i)=>`<span class="${i+1===stepShown?'on':i+1<stepShown?'done':''}">${s}</span>`).join('');
  const stars=me.stars;
  return `<section class="stage">
    ${magicCircleHTML()}
    <div class="stagetop"><span class="turnno">TURN <b>${G.turn}</b></span><span class="p${G.cur} who">${esc(me.name)}の手番</span><div class="steps">${steps}</div></div>
    <div class="stagebody">
      <div class="prompt">${promptHTML()}${hintHTML()}</div>
      <div class="lane">${laneHTML()}</div>
      <div class="critbox"><span>クリティカル</span><b>★${stars}</b><small>${critInfo(stars)}</small></div>
    </div>
  </section>`;
}
// クリティカルの見込み（ルールごと）
function critInfo(stars){
  if(ruleset().crit==='d6'){ const n=critNeedD6(stars); return !n?'判定なし':n>=6?'確定':`出目${n}以下`; }
  const lv=critLevel(stars); return lv?`Lv${lv}・${critChance(lv)}%`:'判定なし';
}
// バトルログの行。セリフ（cls 'say'。engine.js の say() が積む）は設定（pencilduel.logSay）でON/OFF。顔画像つき
const logSayOn = ()=>readPref('pencilduel.logSay')!=='0';
function logRowsHTML(max){
  const say=logSayOn(), list=G.log.filter(l=>say||l.cls!=='say');
  return (max?list.slice(-max):list).map(l=>l.cls==='say'?`<div class="say s${l.p}"><span class="lface">${unitImg(D(l.u),'face','')}</span><span>${l.msg}</span></div>`:`<div class="${l.cls}">${l.msg}</div>`).join('');
}
// セリフの表示切り替えと書き出し（js/battlelog.js）。ビューア（battlelog.html）は書き出したCSVを読む
const logToolsHTML = ()=>`<div class="logtools"><button class="small ghost${logSayOn()?' on':''}" data-ui="toggleLogSay" aria-pressed="${logSayOn()}" title="キャラクターのセリフをログに表示します">セリフ：${logSayOn()?'ON':'OFF'}</button><span class="grow"></span><button class="small ghost" data-ui="logHtml" title="画像つきの読みやすいHTMLファイルで保存します">HTML出力</button><button class="small ghost" data-ui="logCsv" title="CSVファイルで保存します（ビューアで読み込めます）">CSV出力</button><a class="btn small ghost" href="battlelog.html" target="_blank" rel="noopener" title="書き出したCSVを読むビューアを開きます">ビューア</a></div>`;
function logHTML(){
  return `<aside class="logpane"><div class="loghead"><b>バトルログ</b><button class="small ghost" data-ui="toggleLog">閉じる</button></div>${logToolsHTML()}
    <div id="log" class="log">${logRowsHTML(200)}</div></aside>`;
}

// マスターチームのコスト補正（常時。効果ではないのでここで別に表示する）
const costChip = u=>{ const c=costBonus(u); return c?`<span class="chip fx ${c.n>0?'buff':'debuff'}">${TERMS.player}コスト補正：${costBonusText(u)}</span>`:''; };
// ---------- 詳細（対戦中の ⓘ・編成画面の右側で共用） ----------
function unitDetailHTML(d,u){
  if(d.master) return masterDetailHTML(d,u);
  const hc=(u&&hasHcap(u)?`<span class="chip fx buff">ハンデ：${hcapText()}</span>`:'')+(u?costChip(u):'');
  const fx=u&&(u.fx.length||hc)?`<h4>効果</h4><div class="fxs open">${hc}${u.fx.map(e=>`<span class="chip fx ${FX[e.k].buff?'buff':'debuff'}">${fxText(e)}</span>`).join('')}</div>`:'';
  return `<div class="udetail">
    <div class="udtop">
      <div class="udimg">${unitImg(d,'face','pimg',d.name)}</div>
      <div class="udinfo">${clsBadge(d.cls)}<h3>${esc(d.name)}</h3>${traitsHTML(d)}
        <div class="sub small">コスト ${d.cost} ・ HP ${u?`${fmt(u.hp)} / ${maxHp(u)}`:d.hp}${u?` ・ ${TERMS.gauge} ${u.np}%`:''}${u&&u.asc?` ・ <span class="hl">${TERMS.ascFull}済み</span>`:''}</div>
        <div class="ccrow">${['R','B','G'].map(k=>cmdCardHTML(d,{c:k},{small:true})).join('')}</div>
      </div>
    </div>
    ${fx}
    ${u?`<h4>操作</h4><div class="udops">${skillBtns(u,d)}</div>`:''}
    <h4>スキル・${TERMS.ult}</h4>${skillListHTML(d,!!(u&&u.asc))}
    <h4>鉛筆の面</h4>${facesTableHTML(d)}
    ${d.link?`<div class="udlink"><button class="linkbtn" data-ui="openLink" data-url="${esc(d.link)}" title="${esc(d.link)}">キャラクター設定を見る ↗</button><small class="sub">別タブで開きます</small></div>`:''}
  </div>`;
}
// キャラクター設定リンクを開く前の確認（「今後は確認しない」で省略できる。メニューで戻せる）
const LINK_PREF='pencilduel.linkConfirm';
const linkConfirmOn=()=>readPref(LINK_PREF)!=='0';
function linkModalHTML(){
  if(!UI.linkAsk) return '';
  return `<div class="modal linkask"><div class="mback" data-ui="linkCancel"></div>
    <div class="mbody"><p>外部サイトを別タブで開きます。</p><p class="sub small linkurl">${esc(UI.linkAsk)}</p>
      <label class="rok"><input type="checkbox" id="linkNoAsk">今後は確認しない</label>
      <div class="row"><button class="ghost" data-ui="linkCancel">やめる</button><button class="primary" data-ui="linkGo">開く</button></div></div></div>`;
}
// 設定（保存される項目をすべて）。タイトル画面の設定パネルとメニューの設定ウィンドウで共有する
function settingsBodyHTML(){
  const sp=G.speed<=150?120:G.speed<500?250:700, seg=(on,items)=>`<div class="seg">${items.map(([lab,ui,v,k])=>`<button class="${on===k?'on':''}" data-ui="${ui}" data-v="${v}">${lab}</button>`).join('')}</div>`;
  const row=(name,sub,ctl)=>`<div class="setrow"><div><b>${name}</b>${sub?`<small class="sub">${sub}</small>`:''}</div>${ctl}</div>`;
  const onoff=(ui,on)=>seg(on?1:0,[['ON',ui,1,1],['OFF',ui,0,0]]);
  return `<div class="navstep setting">
    ${row('ゲーム進行速度','CPUの手番や演出の速さ',seg(sp,[['普通','setSpeed',700,700],['速い','setSpeed',250,250],['最速','setSpeed',120,120]]))}
    ${row('オート','選ぶ余地のない操作（ロール・決定だけのボタン）を自動で進めます',onoff('setAuto',UI.auto))}
    ${row('おすすめ表示','あなたの手番に、CPU（つよい）なら選ぶ手を表示します',onoff('setHint',hintOn()))}
    ${row('バトルログ','対戦画面にログを表示します',onoff('setLog',UI.log))}
    ${row('原作キャラを含まない','ONの間、原作のサーヴァント・マスターを選択肢とタイトル画面に出しません',onoff('setNoCanon',noCanon()))}
    ${row('設定リンクの確認','キャラクター設定リンクを開く前の確認',seg(linkConfirmOn()?1:0,[['確認する','setLinkConfirm',1,1],['確認しない','setLinkConfirm',0,0]]))}
    ${row('下の余白','スマホで画面の下がブラウザのバーに隠れるときに余白を足します',seg(UI.bottom,BOTTOM_LABELS.map((l,i)=>[l,'setBottom',i,i])))}
    ${typeof scnAvail==='function'&&G.phase==='mode'?row('シナリオの読み込み','シナリオのJSONファイルを読み込みます（この端末のブラウザに保存されます）','<button data-ui="scnImport">JSONを読み込む</button>'):''}
  </div>`;
}
// ---------- おすすめ表示（設定でON/OFF。pencilduel.hint） ----------
// 人の手番に、CPU（つよい）なら選ぶ手を cpuDecide() に聞いて案内に出す。選ぶ余地のない操作（ロール・決定だけ）は出さない。
// 同じ局面で何度も計算しないよう、局面のキーで覚えておく（render() のたびに呼ばれるため）
const HINT_PREF='pencilduel.hint';
const hintOn=()=>readPref(HINT_PREF)==='1';
let HINT={key:null,text:''};
function hintText(m){
  if(!m) return '';
  const t=m[0], p=m[1]||{}, u=p.uid?U(p.uid):null;
  switch(t){
    case 'setAlloc': { if(Object.values(G.maxActs).reduce((a,b)=>a+b,0)<=RULES.actionsMax) return '';
      return Object.entries(JSON.parse(p.alloc)).filter(([,n])=>n>0).map(([id,n])=>`${dn(U(id))}×${n}`).join('・'); }
    case 'useSkill': return `${dn(u)}のS${Number(p.si)+1}「${esc(D(u.def).skills[p.si].name)}」`;
    case 'useUlt': return `${dn(u)}の${TERMS.ult}「${esc(D(u.def).ult.name)}」`;
    case 'skillDone': return hasSkillChoice()?'スキルを使わずに進む':'';
    case 'cardClick': return u?`${dn(u)}を選ぶ`:'';
    case 'masterSupport': return MASTER_ACTS.support;
    case 'masterEvac': return MASTER_ACTS.evac;
    case 'masterAttack': return `${MASTER_ACTS.attack}：${p.to==='master'?TERMS.player:TERMS.unit}`;
    case 'masterSpell': case 'masterSpellUse': { const s=D(masterOf(G.cur).def).spells[p.i];
      return `${MASTER_ACTS.spell}${p.now?'（即時）':''}${s?`「${esc(s.name)}」`:''}${u?` → ${dn(u)}`:''}`; }
    case 'guard': return {take:'受ける', block:'令呪で守る', master:`${TERMS.player}で受ける`, svt:`${TERMS.unit}で受ける`}[p.to]||'';
  }
  return '';
}
function hintHTML(){
  if(!hintOn()||otherActing()||!['actRoll','master','guard','skill','action','target'].includes(G.phase)) return '';
  if(G.phase==='actRoll'&&!G.actRolled) return '';
  const key=JSON.stringify([G.turn,G.cur,G.phase,G.maxActs,G.rolled.length,G.target,G.pending,G.ult,G.ultDone,G.copy,G.spellPick,G.guard,G.mastered,ALLM().map(u=>[u.hp,u.np,u.used,u.fx.length])]);
  if(HINT.key!==key){
    const lv=G.level; let m=null;
    try{ G.level='hard'; m=cpuDecide(); }catch(e){ m=null; }finally{ G.level=lv; }
    let text=''; try{ text=hintText(m); }catch(e){}
    HINT={key,text};
  }
  return HINT.text?`<p class="hl hintp">💡 おすすめ：${HINT.text}</p>`:'';
}
function settingsModalHTML(){
  if(!UI.settings) return '';
  return `<div class="modal navmodal"><div class="mback" data-ui="closeSettings"></div><div class="mbody navpanel"><div class="navbar"><button class="back" data-ui="closeSettings">閉じる</button></div><p class="navtitle">設定</p>${settingsBodyHTML()}</div></div>`;
}
function tutorialModalHTML(){
  if(!UI.tut) return '';
  return `<div class="modal navmodal"><div class="mback" data-ui="closeTutorial"></div><div class="mbody navpanel"><div class="navbar"><button class="back" data-ui="closeTutorial">閉じる</button></div><p class="navtitle">チュートリアル</p>${rulesGuideHTML(false)}${statusGuideHTML(false)}</div></div>`;
}
function masterDetailHTML(d,m){
  const fx=m&&m.fx.length?`<h4>効果</h4><div class="fxs open">${m.fx.map(e=>`<span class="chip fx ${FX[e.k].buff?'buff':'debuff'}">${fxText(e)}${e.tmp?'（このターン）':''}</span>`).join('')}</div>`:'';
  const P=m&&G.players[m.pid], rs=RULESETS.master;
  return `<div class="udetail">
    <div class="udtop">
      <div class="udimg">${unitImg(d,'face','pimg',d.name)}</div>
      <div class="udinfo">${clsBadge(TERMS.player)}<h3>${esc(d.name)}</h3>
        <div class="sub small">コスト ${d.cost} ・ HP ${m?`${fmt(m.hp)} / ${maxHp(m)}`:d.hp}${m&&m.out?' ・ <span class="hl">瀕死</span>':''}${P&&P.evac?' ・ 退避中':''}</div>
        ${ruleset().mTeam?'':`<div class="sub small">${MASTER_ACTS.attack}：相手${TERMS.player}へ ${d.cost*rs.masterAtk.master} ／ 相手${TERMS.unit}へ ${d.cost*rs.masterAtk.svt}</div>`}
      </div>
    </div>
    ${fx}
    ${d.link?`<div class="udlink"><button class="linkbtn" data-ui="openLink" data-url="${esc(d.link)}" title="${esc(d.link)}">キャラクター設定を見る ↗</button><small class="sub">別タブで開きます</small></div>`:''}
    <h4>${MASTER_ACTS.support}（出た面の効果をこのターンだけ）</h4>
    <div class="skl">${d.faces.map((f,i)=>sklBlockHTML(`出目${i+1}`,f.label?esc(f.label):(f.eff.length?'':'<span class="sub">―</span>'),f.eff.length?effLines(f.eff,null,mTLabel):[],{cls:f.eff.length?'':'locked'})).join('')}</div>
    <h4>${MASTER_ACTS.spell}（${ruleset().mTeam?`${ruleset().spells}画・同じ効果は1回・使うと行動-1`:'1試合1回・3つから1つ'}）${P?`<small class="sub"> ${P.spell==='decl'?'宣言中':`残り${P.spellLeft}画`}</small>`:''}</h4>
    <div class="skl">${d.spells.map((s,i)=>sklBlockHTML(`${i+1}画`,esc(s.name),s.eff.length?effLines(s.eff,null,spellTgt):[],{cls:P&&P.spellUsed[i]?'locked':'',note:P&&P.spellUsed[i]?'使用済み':''})).join('')}</div>
  </div>`;
}
function detailModalHTML(){
  const u=U(UI.detail); if(!u) return '';
  return `<div class="modal"><div class="mback" data-ui="closeDetail"></div>
    <div class="mbody"><button class="mclose" data-ui="closeDetail" title="閉じる">×</button>${unitDetailHTML(D(u.def),u)}</div></div>`;
}

// ---------- リザルト（決着後） ----------
// タブ（UI.rtab）：概要 / サーヴァント別の成績 / ターンごとのダメージ推移 / バトルログ
const RTABS = { sum:'概要', unit:`${TERMS.unit}別`, tl:'ダメージ推移', log:'バトルログ' };
const stOf = u=>(G.stats&&G.stats[u.uid])||{dealt:0,taken:0,maxHit:0,kills:0,attacks:0,crits:0,ults:0,skills:0,blocked:0};
const sideUnits = pid=>[...G.players[pid].party,...(G.players[pid].master?[G.players[pid].master]:[])];
// 決着後の「もう一度」：同じ編成ですぐ対戦（data-same）／ 編成からやり直す、の2つに分ける
const rematchBtns = ()=>`<button data-a="rematch" title="${G.draft?'新しい候補でドラフトからやり直します':'編成（キャラクター選択）からやり直します'}">${G.draft?'ドラフトし直す':'キャラクター選択に戻る'}</button><button class="primary" data-a="rematch" data-same="1" title="おたがい同じ編成のまま、新しい対戦を始めます">同じ編成でもう一度</button>`;
// リザルトの枠と見出し（対戦のリザルト・アーケードの総合リザルト共通）。good＝勝ち（金）／ 負け（銀青）
// 登場の動きは最初の1回だけ：開いてからの秒数（--el）を渡し、CSS 側でそのぶん animation-delay を戻す（描き直しても続きから再生される）
function resultOpenHTML(good,cls=''){
  if(!UI.resultAt) UI.resultAt=performance.now();
  return `<div class="modal result ${good?'rv':'rd'} ${cls}" style="--el:${((performance.now()-UI.resultAt)/1000).toFixed(2)}s"><div class="mback"></div>`;
}
const resultHeadHTML = (kicker,title,sub,meta)=>`<div class="rhead"><p class="rkicker"><span>${kicker}</span></p><h2 class="rtitle">${title}</h2><p class="rsub">${sub}</p><p class="sub small rturn">${meta}</p></div>`;
function resultHTML(){
  const w=G.winner, cpuMode=G.mode==='cpu', tab=RTABS[UI.rtab]?UI.rtab:'sum';
  const title=cpuMode?(w===0?'VICTORY':'DEFEAT'):'WINNER';
  const sub=cpuMode?(w===0?'勝利！':'敗北…'):`${esc(G.players[w].name)} の勝利！`;
  const body={sum:resultSumHTML, unit:resultUnitsHTML, tl:resultTlHTML, log:resultLogHTML}[tab]();
  return `${resultOpenHTML(!cpuMode||w===0)}
    <div class="mbody">${resultHeadHTML('BATTLE RESULT',title,sub,`${G.scn&&G.scn.title?`${esc(G.scn.title)} ・ `:''}${G.arcade?`アーケード ${arcadeStageNo()} ・ `:''}${esc(ruleset().name)}ルール ・ 経過ターン <b>${G.turn}</b>`)}
      <div class="rtabs" role="tablist">${Object.entries(RTABS).map(([k,v])=>`<button role="tab" aria-selected="${tab===k}" class="${tab===k?'on':''}" data-ui="rtab" data-v="${k}">${v}</button>`).join('')}</div>
      <div class="rbody">${body}</div>
      <div class="row"><button class="ghost" data-a="restart">タイトルに戻る</button><button data-ui="closeResult">盤面を見る</button>${G.scn?scnResultBtn():G.arcade?arcadeNextBtn():rematchBtns()}</div>
    </div></div>`;
}
// シナリオの戦闘：勝ったとき・負けても物語が進むときは「物語を進める」（scenario.js の scnAfter）、そうでなければ再挑戦
const scnResultBtn = ()=>G.winner===0||G.scn.loseGo?'<button class="primary" data-ui="scnAfter">物語を進める</button>':'<button class="primary" data-a="rematch">再挑戦</button>';
function resultSumHTML(){
  const w=G.winner; // MVP：勝った側でいちばんダメージを与えたサーヴァント
  const mvp=G.players[w].party.reduce((b,u)=>!b||stOf(u).dealt>stOf(b).dealt?u:b,null);
  const side=pid=>{ const P=G.players[pid], us=sideUnits(pid), sum=k=>us.reduce((s,u)=>s+stOf(u)[k],0), ch=(G.chains||[])[pid]||{};
    const rows=us.map(u=>{ const d=D(u.def);
      return `<div class="rrow hp ${u.out?'out':''}">${unitImg(d,'face','pimg',d.name)}<b>${esc(d.name)}${u===mvp&&stOf(u).dealt?' <em class="mvp">MVP</em>':''}</b><span>${u.out?(u.master?'瀕死':TERMS.out):`HP ${fmt(u.hp)}<small>/${maxHp(u)}</small>`}</span><i class="rhp p${pid}bg" style="--w:${u.out?0:pctOf(u.hp,maxHp(u)).toFixed(1)}%"></i></div>`; }).join('');
    const kv=(k,v,c='')=>`<div class="${c}"><span>${k}</span><b>${v}</b></div>`;
    return `<div class="rside ${pid===w?'rwin':''}"><h4><span class="p${pid}">${esc(P.name)}</span>${pid===w?'<em>WIN</em>':''}</h4>${rows}
      <div class="rkv">${kv('与えたダメージ',fmt(G.dealt[pid]))}${kv('受けたダメージ',fmt(sum('taken')))}${kv('最大ダメージ',fmt(Math.max(0,...us.map(u=>stOf(u).maxHit))))}
        ${kv('撃破',sum('kills'))}${kv('クリティカル',sum('crits'))}${kv(TERMS.ult,`${sum('ults')}回`)}${kv('スキル',`${sum('skills')}回`)}${kv('無効化した攻撃',sum('blocked'))}
        ${kv('ブレイブチェイン',ch.brave||0)}${kv(`発生${TERMS.star}`,(G.starsGen||[])[pid]||0)}${kv('チェイン',`${TERMS.R} ${ch.R||0} ・ ${TERMS.B} ${ch.B||0} ・ ${TERMS.G} ${ch.G||0}`,'wide')}</div></div>`; };
  // いちばん上：MVP（大きい顔と成績）と、両陣営の与ダメージを比べる帯
  const ms=mvp&&stOf(mvp), md=mvp&&D(mvp.def);
  const mvpBox=ms&&ms.dealt?`<div class="rmvp"><div class="rmvp-pt">${unitImg(md,'face','pimg',md.name)}</div><div class="rmvp-tx"><small>MVP</small><b>${esc(md.name)}</b>
    <div class="rmvp-kv"><span>与ダメージ <b>${fmt(ms.dealt)}</b></span><span>最大 <b>${fmt(ms.maxHit)}</b></span><span>撃破 <b>${ms.kills}</b></span></div></div></div>`:'';
  const d0=G.dealt[0]||0, d1=G.dealt[1]||0;
  const vs=d0+d1>0?`<div class="rvs"><small>与えたダメージ</small><b class="p0">${fmt(d0)}</b><div class="rvsbar"><i class="p0bg" style="flex-grow:${d0}"></i><i class="p1bg" style="flex-grow:${d1}"></i></div><b class="p1">${fmt(d1)}</b></div>`:'';
  return `${mvpBox}${vs}<div class="rsides">${side(0)}${side(1)}</div>`;
}
function resultUnitsHTML(){
  const cols=[['dealt','与ダメ'],['taken','被ダメ'],['maxHit','最大'],['kills','撃破'],['attacks','攻撃'],['crits','クリ'],['ults',TERMS.ult],['skills','スキル'],['blocked','無効化']];
  const all=[0,1].flatMap(sideUnits), best=k=>Math.max(1,...all.map(u=>stOf(u)[k]));
  const rows=pid=>sideUnits(pid).map(u=>{ const d=D(u.def), s=stOf(u);
    return `<tr class="${u.out?'out':''}"><th><span class="p${pid}">●</span> ${esc(d.name)}${u.master?` <small class="sub">${TERMS.player}</small>`:''}</th>${cols.map(([k])=>`<td class="${s[k]&&s[k]===best(k)&&['dealt','maxHit','kills'].includes(k)?'top':''}">${fmt(s[k])}</td>`).join('')}</tr>`; }).join('');
  return `<div class="rtablewrap"><table class="rtable"><thead><tr><th></th>${cols.map(([,l])=>`<th>${l}</th>`).join('')}</tr></thead>
    <tbody>${rows(0)}${rows(1)}</tbody></table></div>
    <p class="sub small rnote">与ダメ・被ダメは実際に減ったHP（オーバーキル分は含まない）。最大＝1回の攻撃の最大ダメージ。攻撃＝攻撃の回数（連続攻撃は1回ずつ）。無効化＝回避・無敵・ダメージ無効で防いだ回数。</p>`;
}
function resultTlHTML(){
  const tl=G.tl||[], n=Math.max(G.turn,tl.length-1);
  if(!tl.some(Boolean)) return '<p class="sub">ダメージの記録がありません。</p>';
  // 1ターン1行。両陣営の与ダメージを色分けして横に積む（反撃などで手番でない側も与えることがある）
  const mx=Math.max(1,...tl.filter(Boolean).map(r=>r[0]+r[1]));
  const rows=Array.from({length:n},(_,i)=>i+1).map(t=>{ const r=tl[t]||[0,0];
    return `<div class="tlrow"><span class="tln">T${t}</span><div class="tlline">${[0,1].map(p=>r[p]?`<i class="p${p}bg" style="width:${(pctOf(r[p],mx)*.85).toFixed(1)}%" title="${esc(G.players[p].name)}：${fmt(r[p])}"></i>`:'').join('')}<small>${[0,1].filter(p=>r[p]).map(p=>`<span class="p${p}">${fmt(r[p])}</span>`).join(' ')}</small></div></div>`; }).join('');
  const tot=p=>tl.reduce((s,r)=>s+((r||[])[p]||0),0);
  return `<div class="tllegend">${[0,1].map(p=>`<span><i class="p${p}bg"></i>${esc(G.players[p].name)}の与ダメージ 合計 <b>${fmt(tot(p))}</b></span>`).join('')}</div><div class="tl">${rows}</div>`;
}
function resultLogHTML(){
  return `${logToolsHTML()}<div class="log rlog">${logRowsHTML()}</div>`;
}

// ---------- アーケード ----------
// 決着後の進むボタン：勝って次があれば「次のステージへ」、最後のステージか負けなら「総合リザルト」
// 負けたときはコンティニュー（同じ相手ともう一度。エンドレスにはない）も出す
const arcadeNextBtn = ()=>G.winner===0&&!arcadeLast()?'<button class="primary" data-a="arcadeNext">次のステージへ</button>'
  :arcadeCanContinue()?'<button data-ui="openTotal">総合リザルト</button><button class="primary" data-a="arcadeContinue" title="同じ相手ともう一度戦います（コンティニューの回数は総合リザルトに出ます）">コンティニュー</button>'
  :'<button class="primary" data-ui="openTotal">総合リザルト</button>';
const arcadeStageNo = ()=>`STAGE ${G.arcade.stage+1}${arcadeEndless()?'':`/${ARCADE.stages}`}`;
const arcadeLabel = ()=>`${arcadeEndless()?'エンドレス':'アーケード'}（${ARCADE.diffs[G.arcade.diff].name}）${arcadeStageNo()}`;
// ステージ紹介（phase 'stage'）：対戦の前に、今のステージ・相手の先頭キャラ・CPUの強さを見せる。
// 登場アニメーションはステージごとに最初の1回だけ（UI.stageSeen。render() のたびに再生しない）。オート進行では進めない（見せるための画面）
function arcadeStageHTML(){
  const A=G.arcade, df=ARCADE.diffs[A.diff], endless=arcadeEndless(), n=arcadeStages(), s=A.stage;
  const still=UI.stageSeen===s; UI.stageSeen=s;
  // 進行の目盛り：通常は全ステージ、エンドレスは今のステージの前後5つ
  const base=endless?Math.max(0,s-2):0;
  const track=Array.from({length:endless?5:df.levels.length},(_,k)=>base+k).map(i=>{ const l=arcadeLevel(df,i); return `<div class="arc-node ${i<s?'done':i===s?'now':''}"><i><b>${i<s?'✓':i+1}</b></i><span>${esc(CPU_LEVELS[l].name)}</span></div>`; }).join('');
  // マスター戦（マスターのいるルール）は、マスター同士を大きく対峙させて、サーヴァントは全員を下に並べる
  const side=pid=>{ const ids=G.picks[pid], m=masterRule()?D(G.mpicks[pid]):null, lead=m||D(ids[0]), cost=sumCost(ids)+(m?m.cost:0);
    const minis=(m?ids:ids.slice(1)).map(D).filter(Boolean).map(d=>`<span class="arc-mini" title="${esc(d.name)}">${unitImg(d,'face','pimg',d.name)}</span>`).join('');
    return `<div class="arc-side s${pid}${m?' mst':''}"><div class="arc-pt"><span>${unitImg(lead,'face','pimg',lead.name)}</span>${m?`<i class="arc-tag">${TERMS.player}</i>`:''}</div>
      <div class="arc-who"><small class="p${pid}">${pid?`CPU ・ ${esc(CPU_LEVELS[G.level].name)}`:esc(G.players[0].name)}</small><b>${esc(lead.name)}</b></div>
      <div class="arc-party">${minis}<span class="arc-cost">COST <b>${cost}</b></span></div></div>`; };
  return `<div class="arc${still?' still':''}">
    <div class="arc-head"><small>ARCADE ・ ${esc(df.name)} ・ ${esc(ruleset().name)}${A.continues?` ・ コンティニュー ${A.continues}回`:''}</small>
      <p class="arc-kicker">${s===0?'ARCADE START':s===n-1?'FINAL STAGE':'NEXT STAGE'}</p>
      <h2>STAGE <b>${s+1}</b>${endless?'':`<small>/ ${n}</small>`}</h2></div>
    <div class="arc-track">${track}</div>
    <div class="arc-vs">${side(0)}<em class="arc-mid">VS</em>${side(1)}</div>
    <div class="row arc-btns"><button class="ghost" data-a="restart">リタイア</button><button class="primary big" data-a="arcadeGo">バトル開始</button></div>
  </div>`;
}
// 総合リザルト：ステージごとの結果・合計・パーティの成績（与ダメージ順。いちばん上が MVP）
function arcadeTotalHTML(){
  const A=G.arcade, df=ARCADE.diffs[A.diff], endless=arcadeEndless(), rs=arcadeResults(), wins=rs.filter(r=>r.win).length, clear=!endless&&wins>=ARCADE.stages;
  const sum=k=>rs.reduce((t,r)=>t+r[k],0);
  // エンドレスは戦ったステージだけ、通常は全ステージ（まだのステージは「？」）
  const stages=(endless?rs.map((_,i)=>i):df.levels.map((_,i)=>i)).map(i=>{ const l=arcadeLevel(df,i), r=rs[i], lead=r&&D(r.enemy[0]);
    if(!r) return `<div class="astage none"><i>${i+1}</i><span class="aq">？</span><b>CPU ・ ${esc(CPU_LEVELS[l].name)}</b><em>—</em></div>`;
    return `<div class="astage ${r.win?'':'lose'}"><i>${i+1}</i>${unitImg(lead,'face','pimg',lead.name)}<b>${r.enemy.map(id=>esc(D(id).name)).join('・')}<small>CPU ・ ${esc(CPU_LEVELS[r.level].name)} ・ コスト${r.ecost}</small></b><em>${r.win?'WIN':'LOSE'}<small>${r.turn}ターン</small></em></div>`; }).join('');
  const us={}; rs.forEach(r=>r.units.forEach(u=>{ const x=us[u.id]||(us[u.id]={id:u.id,dealt:0,kills:0}); x.dealt+=u.dealt; x.kills+=u.kills; }));
  const party=Object.values(us).sort((a,b)=>b.dealt-a.dealt).map((u,i)=>{ const d=D(u.id);
    return `<div class="rrow">${unitImg(d,'face','pimg',d.name)}<b>${esc(d.name)}${i===0&&u.dealt?' <em class="mvp">MVP</em>':''}</b><span>与ダメージ ${fmt(u.dealt)}<small> ・ 撃破 ${u.kills}</small></span></div>`; }).join('');
  const kv=(k,v)=>`<div><span>${k}</span><b>${v}</b></div>`;
  return `${resultOpenHTML(clear,'arcsum')}
    <div class="mbody">${resultHeadHTML('ARCADE RESULT',clear?'ARCADE CLEAR':'GAME OVER',clear?'全ステージ制覇！':`${endless?`${wins}連勝 ・ `:''}STAGE ${rs.length} で敗北…`,`アーケード（${esc(df.name)}） ・ ${esc(ruleset().name)}ルール`)}
      <div class="astages">${stages}</div>
      <div class="rsides"><div class="rside"><h4>合計</h4><div class="rkv akv">${endless?kv('連勝',wins):kv('クリア',`${wins} / ${ARCADE.stages}`)+kv('コンティニュー',`${A.continues||0}回`)}${kv('合計ターン',sum('turn'))}${kv('与えたダメージ',fmt(sum('dealt')))}${kv('受けたダメージ',fmt(sum('taken')))}${kv('撃破',sum('kills'))}${kv(`${TERMS.out}になった数`,sum('lost'))}${kv('最大ダメージ',fmt(Math.max(0,...rs.map(r=>r.maxHit))))}</div></div>
        <div class="rside"><h4>パーティの成績</h4>${party}</div></div>
      <div class="row"><button class="ghost" data-a="restart">タイトルに戻る</button><button data-ui="closeResult">盤面を見る</button>${arcadeCanContinue()?'<button data-a="arcadeContinue" title="同じ相手ともう一度戦います">コンティニュー</button>':''}<button data-a="rematch" title="同じ難易度で、編成（キャラクター選択）からやり直します">キャラクター選択に戻る</button><button class="primary" data-a="rematch" data-same="1" title="同じ難易度・同じ編成で、STAGE 1 からやり直します">同じ編成でもう一度</button></div>
    </div></div>`;
}

// ---------- 編成画面 ----------
function setupHTML(){
  const pid=G.setupPid, picks=G.picks[pid], rs=ruleset(), solo=rs.partyMax===1, cost=sumCost(picks)+(rs.master?mcost(pid):0), cap=costCap();
  const view=D(UI.setupView)||D(picks[picks.length-1])||ROSTER()[0];
  const mr=masterRule(), mp=D(G.mpicks[pid]), S=G.scn, locked=id=>!!S&&S.lock.includes(id), mlock=!!S&&!!S.mlock;
  const slots=Array.from({length:rs.partyMax},(_,i)=>i).map(i=>{
    const d=D(picks[i]);
    return d ? `<button class="slot filled${locked(d.id)?' lock':''}" data-a="setupToggle" data-id="${esc(d.id)}" data-view="${esc(d.id)}" title="${locked(d.id)?'固定メンバー':'外す'}">${unitImg(d,'face','pimg',d.name)}<span>${ORD[i]}${locked(d.id)?' 固定':''}</span><b>${esc(d.name)}</b></button>`
             : `<div class="slot"><span>${ORD[i]}</span></div>`;
  }).join('')+(!mr?'':mp?`<button class="slot filled mslot${mlock?' lock':''}" data-a="setupMaster" data-id="${esc(mp.id)}" data-view="${esc(mp.id)}" title="${mlock?'固定':'外す'}">${unitImg(mp,'face','pimg',mp.name)}<span>${TERMS.player}${mlock?' 固定':''}</span><b>${esc(mp.name)}</b></button>`
             :`<div class="slot mslot"><span>${TERMS.player}</span></div>`);
  return `<div class="setup">
    <div class="sethead">
      <div class="settitle"><h2><span class="p${pid}">${esc(G.players[pid].name)}</span> の${solo?`${TERMS.unit}選択`:'パーティ編成'}</h2>
        <p class="sub small nm">${solo?`${rs.name}ルール：${TERMS.unit}を1騎${rs.master?`と${TERMS.player}を1人`:''}選びます。${handicapNote(pid)}`:`${rs.master?`${TERMS.player}1人と`:''}コスト合計${cap}以下${rs.master?`（${TERMS.player}込み）`:''}・最大${rs.partyMax}騎。選んだ順に 1st / 2nd / 3rd。`}${netWait()?'<b class="hl"> 相手が編成中です。決定されるまでお待ちください。</b>':''}${G.arcade?`<b class="hl"> アーケード（${esc(ARCADE.diffs[G.arcade.diff].name)}）：この編成で${arcadeEndless()?'負けるまで':`全${ARCADE.stages}戦を`}戦います。</b>`:''}${S?`<b class="hl"> シナリオ：${S.lock.length||mlock?'「固定」のメンバーは変えられません。':''}${S.spec.mode==='keep'?'ここで選んだ編成を、この先の戦闘でも使います。':''}</b>`:''}</p></div>
      <div class="slots">${slots}</div>
      <div class="costm" ${solo?'hidden':''}><span>COST</span><b>${cost}</b><small>/ ${cap}</small><div class="bar"><i style="width:${pctOf(cost,cap)}%"></i></div></div>
      <div class="setbtns ${mr?'wide':''}">${pid===0?`<button class="back" data-a="restart" data-keepnav="1" title="${S?'シナリオを中断してタイトルに戻ります（つづきから再開できます）':'メニューに戻ります'}">${S?'中断':'戻る'}</button>`:''}${pid===1?`<button class="back" data-a="setupBack" title="${esc(G.players[0].name)}の編成に戻ります（ここまでの選択は残ります）">戻る</button>`:''}<select class="rcost" data-rcost ${S?'hidden':''} title="おまかせ（ランダム）で選ぶ${solo?'':'合計'}コスト${mr?`（${TERMS.player}込み）`:''}を指定します">${['',...Array.from({length:cap+1},(_,i)=>i)].map(c=>`<option value="${c}" ${String(c)===String(UI.rcost??'')?'selected':''}>${c===''?'コスト指定なし':`コスト ${c}`}</option>`).join('')}</select>${isCpu(pid)
        ?`<button data-a="setupCpu" data-how="same" title="相手と同じ${solo?'コスト':'合計コスト・人数'}になるように選びます">おまかせ（同コスト）</button><button data-a="setupCpu" data-how="random" title="コスト上限の中から完全にランダムに選びます">おまかせ（ランダム）</button>`
        :`<button data-a="setupRandom">おまかせ</button>`}${mr?`<button data-a="setupRandom" data-only="svt" title="選んだ${TERMS.player}はそのままで、${TERMS.unit}だけランダムに選びます">${TERMS.unit}だけおまかせ</button><button data-a="setupRandom" data-only="master" title="選んだ${TERMS.unit}はそのままで、${TERMS.player}だけランダムに選びます">${TERMS.player}だけおまかせ</button>`:''}${S?'':'<button data-ui="partyOpen" title="編成を保存する・保存した編成を呼び出す">編成リスト</button>'}<button class="primary big" data-a="setupConfirm" ${picks.length&&(!masterRule()||G.mpicks[pid])?'':'disabled'}>決定</button></div>
    </div>
    ${G.setupMsg?`<p class="warn nm">${G.setupMsg}</p>`:''}
    <div class="setbody">
      <div class="rosterwrap">${mr&&!mlock?masterRosterHTML(pid,view):''}${rosterFilterHTML()}<div class="roster">${rosterTilesHTML(view)}</div></div>
      <div class="sdetail">${view?unitDetailHTML(view):''}</div>
    </div>
  </div>`;
}

// ---------- ドラフト（phase 'draft'）：候補を交互に取り合う。編成画面と同じ枠（上：両陣営の枠 / 左：候補 / 右：詳細） ----------
function draftHTML(){
  const R=G.draft, rs=ruleset(), turn=draftTurn(), mr=masterRule(), cap=costCap(), solo=rs.partyMax===1, cpuTurn=turn!=null&&isCpu(turn);
  const ids=[...R.mpool,...R.pool], view=D(UI.setupView)&&ids.includes(UI.setupView)?D(UI.setupView):D(ids.find(id=>R.taken[id]==null)||ids[0]);
  const side=pid=>{ const picks=G.picks[pid], mp=D(G.mpicks[pid]), mine=R.done&&!isCpu(pid)&&picks.length>1;
    const slots=Array.from({length:rs.partyMax},(_,i)=>i).map(i=>{ const d=D(picks[i]);
      return !d?`<div class="slot"><span>${ORD[i]}</span></div>`
        :mine?`<button class="slot filled" data-a="draftLead" data-id="${esc(d.id)}" data-view="${esc(d.id)}" title="先頭（1st）にする">${unitImg(d,'face','pimg',d.name)}<span>${ORD[i]}</span><b>${esc(d.name)}</b></button>`
        :`<div class="slot filled">${unitImg(d,'face','pimg',d.name)}<span>${ORD[i]}</span><b>${esc(d.name)}</b></div>`; }).join('')
      +(!mr?'':mp?`<div class="slot filled mslot">${unitImg(mp,'face','pimg',mp.name)}<span>${TERMS.player}</span><b>${esc(mp.name)}</b></div>`:`<div class="slot mslot"><span>${TERMS.player}</span></div>`);
    return `<div class="dside${turn===pid?' now':''}"><small><b class="p${pid}">${esc(G.players[pid].name)}</b>${isCpu(pid)?` ・ ${esc(CPU_LEVELS[G.level].name)}`:''}${solo?'':` ・ COST ${sumCost(picks)+mcost(pid)}/${cap}`}</small><div class="slots">${slots}</div></div>`; };
  const order=R.order.map((pid,i)=>`<i class="p${pid}${R.done||i<R.i?' done':i===R.i?' now':''}">${esc(G.players[pid].name)}</i>`).join('');
  const msg=R.done?`取り終わりました。${G.picks.some((p,pid)=>!isCpu(pid)&&p.length>1)?'自分の枠を押すと、そのキャラを先頭（1st）にできます。':''}「バトル開始」で対戦します。`
    :cpuTurn?`${esc(G.players[turn].name)} が選んでいます…`
    :`<b class="hl">${esc(G.players[turn].name)} の番です。</b>${draftNeedM(turn)?`${TERMS.player}を1人取ってください。`:`${TERMS.unit}を1騎取ってください。`}`;
  const tile=d=>{ const by=R.taken[d.id], m=R.mpool.includes(d.id), ok=turn!=null&&draftCan(turn,d.id);
    return `<button class="tile${m?' mtile':''}${by!=null?` taken t${by}`:ok?'':' dim'}${view&&view.id===d.id?' viewing':''}" data-a="draftPick" data-id="${esc(d.id)}" data-view="${esc(d.id)}">
      ${unitImg(d,'face','pimg',d.name)}${m?'':clsIconTag(d.cls,'pcls')}<span class="tcost">C${d.cost}</span>${by!=null?`<span class="dtag p${by}">${esc(G.players[by].name)}</span>`:''}
      <span class="tname">${esc(d.name)}<small>${m?'':`${esc(d.cls)} ・ `}HP${d.hp}</small></span>${tinfoHTML(d)}</button>`; };
  return `<div class="setup draft">
    <div class="sethead">
      <div class="settitle"><h2>ドラフト</h2>
        <p class="sub small nm">${rs.name}ルール：候補から交互に1つずつ取ります（取られた候補は選べません）。${solo?'':`コスト合計${cap}以下${mr?`（${TERMS.player}込み）`:''}・最大${rs.partyMax}騎。`}${mr?`最初に${TERMS.player}を取ります。`:''}${solo?handicapNote(0):''}</p>
        <div class="dorder" title="取る順番">${order}</div></div>
      <div class="dsides">${side(0)}<em>VS</em>${side(1)}</div>
      <div class="setbtns"><button class="back" data-a="restart" data-keepnav="1" title="メニューに戻ります">戻る</button>${R.done?'<button class="primary big" data-a="draftGo">バトル開始</button>':''}</div>
    </div>
    <p class="dmsg nm">${msg}${G.setupMsg?` <span class="warn">${G.setupMsg}</span>`:''}</p>
    <div class="setbody">
      <div class="rosterwrap"><div class="roster">${mr?`<h4 class="dhead">${TERMS.player}</h4>${R.mpool.map(D).map(tile).join('')}<h4 class="dhead">${TERMS.unit}</h4>`:''}${R.pool.map(D).map(tile).join('')}</div></div>
      <div class="sdetail">${view?viewDetailHTML(view):''}</div>
    </div>
  </div>`;
}

// マスタールール：マスターの一覧（選んだら右に詳細）
// 見出しを押すと折り畳める（未選択でも畳める。選ぶと自動で畳み、外すと開く）。UI.mfold：true=畳む
function masterRosterHTML(pid,view){
  const mp=D(G.mpicks[pid]), fold=UI.mfold;
  return `<div class="mroster ${fold?'folded':''}"><button class="mhead" data-ui="mToggle" aria-expanded="${!fold}">
      <span class="mcaret">${fold?'▶':'▼'}</span><span>${TERMS.player}を選ぶ</span>
      ${mp?`<span class="mpicked">${unitImg(mp,'face','mpimg',mp.name)}<b>${esc(mp.name)}</b><small>C${mp.cost}</small></span>`:'<small class="hl">未選択</small>'}
      <small class="mhint">${fold?'タップで開く':'タップで折り畳む'}</small></button>
    <div class="mtiles" ${fold?'hidden':''}>${MASTERS.map(d=>{
    const sel=G.mpicks[pid]===d.id;
    return `<button class="tile mtile ${sel?'sel':''} ${view&&view.id===d.id?'viewing':''}" data-a="setupMaster" data-id="${esc(d.id)}" data-view="${esc(d.id)}">
      ${unitImg(d,'face','pimg',d.name)}<span class="tcost">C${d.cost}</span>${sel?'<span class="order">✓</span>':''}
      <span class="tname">${esc(d.name)}<small>HP${d.hp}</small></span>${tinfoHTML(d)}</button>`; }).join('')}</div>
    <h4>${TERMS.unit}を選ぶ</h4></div>`;
}
// キャラクター選択のカードに付ける ⓘ（押すと詳細ウィンドウ。カードを選ぶ操作にはならない）
const tinfoHTML = d=>`<span class="info tinfo" role="button" tabindex="0" data-ui="sinfo" data-id="${esc(d.id)}" title="詳細を見る">i</span>`;
function sinfoModalHTML(){
  const d=D(UI.sinfo); if(!d) return '';
  return `<div class="modal"><div class="mback" data-ui="closeSinfo"></div>
    <div class="mbody"><button class="mclose" data-ui="closeSinfo" title="閉じる">×</button>${viewDetailHTML(d)}</div></div>`;
}
// ---------- 図鑑（タイトルの「図鑑」）：試合の状態は使わず UI だけで表示する ----------
// UI.ztab = 'svt' | 'master'、見ているキャラは UI.setupView（編成画面と共用）。狭い画面ではタップで詳細ウィンドウ（UI.sinfo）
const ZTABS = { svt:TERMS.unit, master:TERMS.player };
function zukanView(){
  const list=UI.ztab==='master'?MASTERS:UNITS, d=D(UI.setupView);
  return d&&list.includes(d)?d:(UI.ztab==='master'?list[0]:rosterList()[0]||list[0]);
}
function zukanTilesHTML(view){
  const list=UI.ztab==='master'?[...MASTERS].sort((a,b)=>b.cost-a.cost||MASTERS.indexOf(a)-MASTERS.indexOf(b)):rosterList();
  if(!list.length) return `<p class="sub rempty">条件に合う${TERMS.unit}がいません。<button data-ui="rosterReset">絞り込みを解除</button></p>`;
  return list.map(d=>`<button class="tile ${d.master?'mtile':''} ${view&&view.id===d.id?'viewing':''}" data-ui="zview" data-id="${esc(d.id)}" data-view="${esc(d.id)}">
      ${unitImg(d,'face','pimg',d.name)}${d.master?'':clsIconTag(d.cls,'pcls')}
      <span class="tcost">C${d.cost}</span>
      <span class="tname">${esc(d.name)}<small>${d.master?'':`${esc(d.cls)} ・ `}HP${d.hp}</small></span></button>`).join('');
}
// 図鑑の詳細：試合中と同じ詳細＋セリフ（場面ごとに折り畳み）
function zukanLinesHTML(d){
  const keys=d.master?MASTER_LINE_KEYS:LINE_KEYS;
  // 条件つきセリフは、その場面の中に条件を添えて並べる（「味方のだれか」が〇〇のとき など）
  const cond=k=>(d.condLines||[]).filter(c=>c.key===k&&c.lines.length);
  const rows=Object.entries(keys).map(([k,label])=>[k,label,(d.lines&&d.lines[k])||[],cond(k)]).filter(([,,l,c])=>l.length||c.length);
  if(!rows.length) return '';
  const cl=c=>condLineText(c); // 例：味方に黒咲恵梨佳がいる場合
  return `<h4>セリフ</h4><div class="zlines">${rows.map(([k,label,l,c])=>`<details><summary>${esc(label)}<small class="sub">${l.length+c.reduce((n,x)=>n+x.lines.length,0)}件</small></summary>
    <ul>${l.map(t=>`<li>${esc(t)}</li>`).join('')}${c.map(x=>x.lines.map(t=>`<li class="zcond"><small>${esc(cl(x))}</small>${esc(t)}</li>`).join('')).join('')}</ul></details>`).join('')}</div>`;
}
const zukanDetailHTML = d=>unitDetailHTML(d).replace(/<\/div>\s*$/,'')+recUnitHTML(d)+zukanLinesHTML(d)+'</div>';
// 編成画面・図鑑のどちらでも、右の詳細欄と ⓘ のウィンドウに出す中身
const viewDetailHTML = d=>G.phase==='mode'?zukanDetailHTML(d):unitDetailHTML(d);
function zukanHTML(){
  const tab=UI.ztab==='master'?'master':'svt', view=zukanView();
  return `<div class="setup zukan">
    <div class="zhead">
      <button class="back" data-ui="navBack">戻る</button>
      <div class="ztitle"><h2>図鑑</h2><p class="sub small nm">${TERMS.unit} ${UNITS.length}騎 ・ ${TERMS.player} ${MASTERS.length}人</p></div>
      <div class="rtabs" role="tablist">${Object.entries(ZTABS).map(([k,v])=>`<button role="tab" aria-selected="${tab===k}" class="${tab===k?'on':''}" data-ui="ztab" data-v="${k}">${v}</button>`).join('')}</div>
    </div>
    <div class="setbody">
      <div class="rosterwrap">${tab==='svt'?rosterFilterHTML():''}<div class="roster">${zukanTilesHTML(view)}</div></div>
      <div class="sdetail">${view?zukanDetailHTML(view):''}</div>
    </div>
  </div>`;
}

// ---------- キャラクター選択：並べ替え・絞り込み ----------
const ROSTER_SORTS = { default:'標準', costDesc:'コストが高い順', costAsc:'コストが低い順', hpDesc:'HPが高い順', hpAsc:'HPが低い順', name:'名前順', cls:'クラス順' };
// 編成に加えられない（選択済みでなく、上限やコストを超える）
function rosterOver(d){
  const picks=G.picks[G.setupPid], rs=ruleset();
  return !picks.includes(d.id)&&rs.partyMax>1&&(picks.length>=rs.partyMax||sumCost(picks)+d.cost+mcost(G.setupPid)>costCap());
}
function rosterList(){
  const f=UI.roster, q=f.q.trim().toLowerCase();
  const all=ROSTER(), list=all.filter(d=>(!f.cls||d.cls===f.cls)&&(f.cost===''||d.cost===Number(f.cost))
    &&(!q||d.name.toLowerCase().includes(q)||d.cls.toLowerCase().includes(q))&&(!f.ok||G.phase!=='setup'||!rosterOver(d)));
  const ci=c=>{ const i=CLASSES.indexOf(c); return i<0?CLASSES.length:i; };
  const by={ costDesc:(a,b)=>b.cost-a.cost, costAsc:(a,b)=>a.cost-b.cost, hpDesc:(a,b)=>b.hp-a.hp, hpAsc:(a,b)=>a.hp-b.hp,
    name:(a,b)=>a.name.localeCompare(b.name,'ja'), cls:(a,b)=>ci(a.cls)-ci(b.cls)||b.cost-a.cost }[f.sort];
  return by?[...list].sort((a,b)=>by(a,b)||all.indexOf(a)-all.indexOf(b)):list;
}
function rosterTilesHTML(view){
  const picks=G.picks[G.setupPid], list=rosterList();
  if(!list.length) return `<p class="sub rempty">条件に合う${TERMS.unit}がいません。<button data-ui="rosterReset">絞り込みを解除</button></p>`;
  return list.map(d=>{
    const i=picks.indexOf(d.id), sel=i>=0, over=rosterOver(d);
    return `<button class="tile ${sel?'sel':''} ${over?'dim':''} ${view&&view.id===d.id?'viewing':''}" data-a="setupToggle" data-id="${esc(d.id)}" data-view="${esc(d.id)}">
      ${unitImg(d,'face','pimg',d.name)}${clsIconTag(d.cls,'pcls')}
      <span class="tcost">C${d.cost}</span>${sel?`<span class="order">${i+1}</span>`:''}
      <span class="tname">${esc(d.name)}<small>${esc(d.cls)} ・ HP${d.hp}</small></span>${tinfoHTML(d)}</button>`;
  }).join('');
}
function rosterFilterHTML(){
  const f=UI.roster;
  const clss=[...new Set(ROSTER().map(d=>d.cls))].sort((a,b)=>(CLASSES.indexOf(a)+1||99)-(CLASSES.indexOf(b)+1||99));
  const costs=[...new Set(ROSTER().map(d=>d.cost))].sort((a,b)=>a-b);
  const chip=(v,label,body)=>`<button class="rchip ${f.cls===v?'on':''}" data-ui="rosterCls" data-v="${esc(v)}" title="${esc(label)}">${body}</button>`;
  const n=rosterList().length;
  return `<div class="rfilter">
    <div class="rcls">${chip('','すべてのクラス','全')}${clss.map(c=>chip(c,c,`<img src="${esc(classIcon(c))}" alt="${esc(c)}">`)).join('')}</div>
    <div class="rrow2">
      <input type="search" class="rq" data-uif="q" placeholder="名前・クラスで検索" value="${esc(f.q)}">
      <select data-uif="cost" title="コストで絞り込み"><option value="">コスト：すべて</option>${costs.map(c=>`<option value="${c}" ${String(c)===f.cost?'selected':''}>コスト ${c}</option>`).join('')}</select>
      <select data-uif="sort" title="並べ替え">${Object.entries(ROSTER_SORTS).map(([k,v])=>`<option value="${k}" ${f.sort===k?'selected':''}>${v}</option>`).join('')}</select>
      ${G.phase==='setup'&&ruleset().partyMax>1?`<label class="rok"><input type="checkbox" data-uif="ok" ${f.ok?'checked':''}>編成できるものだけ</label>`:''}
      <span class="sub small rcount">${n} / ${ROSTER().length}騎</span>
    </div>
  </div>`;
}
// 絞り込みを変えたら一覧だけ描き直す（検索欄の入力中にフォーカスを失わないように）
function redrawRoster(){
  const r=document.querySelector('.roster'); if(!r){ render(); return; }
  if(G.phase!=='setup'){ setHTML(r,zukanTilesHTML(zukanView())); const c=document.querySelector('.rcount'); if(c) c.textContent=`${rosterList().length} / ${UNITS.length}騎`; return; }
  const picks=G.picks[G.setupPid];
  setHTML(r,rosterTilesHTML(D(UI.setupView)||D(picks[picks.length-1])||ROSTER()[0]));
  const c=document.querySelector('.rcount'); if(c) c.textContent=`${rosterList().length} / ${ROSTER().length}騎`;
}
function onRosterField(e){
  const el=e.target.closest('[data-uif]'); if(!el) return;
  const k=el.dataset.uif; UI.roster[k]=el.type==='checkbox'?el.checked:el.value;
  redrawRoster();
}
document.addEventListener('input',onRosterField);
document.addEventListener('change',e=>{ if(e.target.matches('select[data-uif],input[type=checkbox][data-uif]')) onRosterField(e); });

// シンプルルール：相手のコストとハンデの説明
// ハンデ戦の説明（モード選択の title・編成画面）
function handicapNote(pid){
  const rs=ruleset(), mr=!!rs.master, cost=p=>{ const u=G.picks[p][0], m=G.mpicks[p]; return (u?D(u).cost:0)+(mr&&m?D(m).cost:0); };
  const mine=mr&&(G.picks[pid][0]||G.mpicks[pid])?`合計コスト${cost(pid)}。`:'';
  const opp=G.picks[1-pid][0]; if(!opp||pid===0) return mine+(mr?`${TERMS.unit}＋${TERMS.player}の合計コストを`:'')+'同コスト同士が公平です。';
  const h=G.handicap&&rs.handicapAsc;
  return `${mine}相手は${mr?'合計':''}コスト${cost(1-pid)}。${h?hcapRuleText(rs):''}`;
}
// ---------- モード選択 ----------
// ---------- タイトルのショーケース ----------
// 基本クラスごとに1騎ずつランダム（顔画像があるサーヴァントだけ）。20%の確率でどれか1枠をエクストラクラスの騎に差し替える。
// 画像の有無は読み込んで確かめるので、確認が済むまでは表示しない。選出はページを開いている間は固定
const FACE_OK={};   // id → true/false（画像があるか）
let SHOW_IDS=null;
function faceUrl(d){ return IMG_DIR+encodeURIComponent(d.id)+'.'+IMG_EXT; }
function probeFaces(){
  const todo=UNITS.filter(d=>!(d.id in FACE_OK));
  if(!todo.length) return Promise.resolve();
  return Promise.all(todo.map(d=>new Promise(res=>{
    const im=new Image(); im.onload=()=>{ FACE_OK[d.id]=true; res(); }; im.onerror=()=>{ FACE_OK[d.id]=false; res(); }; im.src=faceUrl(d);
  })));
}
function pickShowcase(){
  const pool=UNITS.filter(d=>FACE_OK[d.id]), rnd=a=>a[Math.floor(Math.random()*a.length)];
  const ids=[];
  CLASSES_BASIC.forEach(c=>{ const l=pool.filter(d=>d.cls===c); if(l.length) ids.push(rnd(l).id); });
  const ex=pool.filter(d=>!CLASSES_BASIC.includes(d.cls));
  if(ex.length && ids.length && Math.random()<0.2) ids[Math.floor(Math.random()*ids.length)]=rnd(ex).id;
  return ids;
}
function showcaseHTML(){
  if(!SHOW_IDS){
    if(!SHOW_IDS_PENDING){ SHOW_IDS_PENDING=true; probeFaces().then(()=>{ SHOW_IDS=pickShowcase(); SHOW_IDS_PENDING=false; if(G.phase==='mode') render(); }); }
    return '';
  }
  // 登場アニメーションは最初の1回だけ（render() は毎回 #app を作り直すので、付けたままだと選ぶたびに再生される）
  const still=SHOW_PLAYED; SHOW_PLAYED=true;
  return SHOW_IDS.map(D).filter(Boolean).map((d,i)=>`<div class="showtile${still?' still':''}" style="--i:${i}">${unitImg(d,'face','pimg',d.name)}${clsIconTag(d.cls,'pcls')}</div>`).join('');
}
let SHOW_PLAYED=false;
let SHOW_IDS_PENDING=false;

function modeHTML(){
  const cu=UNIT_SOURCE==='custom', cm=MASTER_SOURCE==='custom';
  const src = (cu||cm
    ? `<p class="datainfo">ペンシルエディタで作ったデータ（${[cu?`${TERMS.unit}${UNITS.length}騎`:'',cm?`${TERMS.player}${MASTERS.length}人`:''].filter(Boolean).join('・')}）を使っています。<button data-a="useDefaultData">標準データに戻す</button></p>` : '')
    + (UNIT_BROKEN||MASTER_BROKEN ? `<p class="datainfo warn">エディタの${UNIT_BROKEN?TERMS.unit:TERMS.player}データにエラーがあったため、標準データを使っています。</p>` : '');
  const show=showcaseHTML(), nav=UI.nav, s=nav.s;
  const head=`<div class="title"><small>Fate fan-made pencil battle</small><h2>PENSABA DUEL</h2></div>`;
  const back=(label='戻る')=>`<div class="navbar"><button class="back" data-ui="navBack">${label}</button></div>`;
  // ルール選択（クイックバトル・ローカル対戦の最初の段階）
  const rulePick=(nextBtn)=>`<div class="navstep"><h3>ルールを選ぶ</h3><div class="rules">
      ${Object.entries(RULESETS).map(([k,r])=>`<button class="gbtn ${G.rule===k?'p':''}" data-a="setRule" data-rule="${k}">${esc(r.name)}</button>`).join('')}
      ${ruleset().handicapAsc?`<button class="gbtn hcap ${G.handicap?'p':''}" data-a="toggleHandicap" title="${esc(hcapRuleText(ruleset()))}">ハンデ戦：${G.handicap?'ON':'OFF'}</button>`:''}
      </div><div class="row mt">${nextBtn}</div></div>`;
  // タイトル画面は常に表示し、選択（ルール・強さ・設定・チュートリアル）は上に浮かぶパネルで行う
  let panel='';
  if((s==='quick'||s==='watch')&&nav.step==='level'){
    const lv=CPU_LEVELS[nav.level]?nav.level:'normal', lv2=CPU_LEVELS[nav.level2]?nav.level2:'normal', w=s==='watch';
    const lvBtns=(cur,ui)=>Object.entries(CPU_LEVELS).map(([k,l])=>`<button class="gbtn ${k===cur?'p':''}" data-ui="${ui}" data-level="${k}">${esc(l.name)}</button>`).join('');
    if(w) panel=`${back()}<div class="navstep"><h3>CPU 1 の強さ</h3><div class="levels">${lvBtns(lv,'navLevel')}</div><h3>CPU 2 の強さ</h3><div class="levels">${lvBtns(lv2,'navLevel2')}</div><p class="sub small arcnote">このあと、CPU 1・CPU 2 の編成を選びます。</p><div class="row mt"><button class="gbtn go" data-a="chooseMode" data-mode="watch" data-level="${lv}" data-level2="${lv2}">編成へ</button></div></div>`;
    else
    panel=`${back()}<div class="navstep"><h3>${w?'両CPUの強さ':'CPUの強さ'}</h3><div class="levels">${Object.entries(CPU_LEVELS).map(([k,l])=>`<button class="gbtn ${k===lv?'p':''}" data-ui="navLevel" data-level="${k}">${esc(l.name)}</button>`).join('')}</div>${w?'<p class="sub small arcnote">編成はランダムに選ばれます（同コスト）。</p>':''}<div class="row mt"><button class="gbtn go" data-a="chooseMode" data-mode="${w?'watch':'cpu'}" data-level="${lv}">${w?'観戦する':'次へ'}</button></div></div>`;
  }else if(s==='draft'&&nav.step==='level'){ // ドラフト：CPUの強さ
    const lv=CPU_LEVELS[nav.level]?nav.level:'normal';
    panel=`${back()}<p class="navtitle">ドラフト</p><div class="navstep"><h3>CPUの強さ</h3><div class="levels">${Object.entries(CPU_LEVELS).map(([k,l])=>`<button class="gbtn ${k===lv?'p':''}" data-ui="navLevel" data-level="${k}">${esc(l.name)}</button>`).join('')}</div>
      <p class="sub small arcnote">ランダムに出た候補から、CPUと交互に1つずつ取り合って編成します。</p><div class="row mt"><button class="gbtn go" data-a="chooseMode" data-mode="draft" data-level="${lv}">ドラフトへ</button></div></div>`;
  }else if(s==='arcade'&&nav.step==='kind'){ // アーケード：アーケード（全5戦）かエンドレスか
    const df=ARCADE.diffs[nav.diff]?nav.diff:'normal';
    panel=`${back()}<p class="navtitle">アーケード（${esc(ARCADE.diffs[df].name)}）</p><div class="navstep"><h3>モードを選ぶ</h3><div class="levels">
      <button class="gbtn" data-a="chooseMode" data-mode="arcade" data-diff="${df}">アーケード</button>
      <button class="gbtn" data-a="chooseMode" data-mode="arcade" data-diff="${df}" data-endless="1">エンドレス</button></div>
      <p class="sub small arcnote">アーケード：全${ARCADE.stages}戦の連戦。負けてもコンティニューできます。<br>エンドレス：負けるまで続く連戦（コンティニューなし）。</p></div>`;
  }else if(s==='arcade'&&nav.step==='level'){ // アーケード：難易度
    const df=ARCADE.diffs[nav.diff]?nav.diff:'normal';
    panel=`${back()}<p class="navtitle">アーケード</p><div class="navstep"><h3>難易度</h3><div class="levels">${Object.entries(ARCADE.diffs).map(([k,d])=>`<button class="gbtn ${k===df?'p':''}" data-ui="navDiff" data-diff="${k}">${esc(d.name)}</button>`).join('')}</div>
      <div class="row mt"><button class="gbtn go" data-ui="navKind">次へ</button></div></div>`;
  }else if(s==='arcade'){ const ar=ARCADE.rules.includes(G.rule)?G.rule:ARCADE.rules[0];
    panel=`${back()}<p class="navtitle">アーケード</p><div class="navstep"><h3>ルールを選ぶ</h3><div class="rules">${ARCADE.rules.map(k=>`<button class="gbtn ${ar===k?'p':''}" data-a="setRule" data-rule="${k}">${esc(RULESETS[k].name)}</button>`).join('')}</div>
      <p class="sub small arcnote">CPUとの連戦。最初に選んだ編成で最後まで戦います。</p><div class="row mt"><button class="gbtn go" data-ui="navNext">次へ</button></div></div>`;
  }else if(s==='quick') panel=`${back()}<p class="navtitle">クイックバトル</p>${rulePick('<button class="gbtn go" data-ui="navNext">次へ</button>')}`;
  else if(s==='draft') panel=`${back()}<p class="navtitle">ドラフト</p>${rulePick('<button class="gbtn go" data-ui="navNext">次へ</button>')}`;
  else if(s==='watch') panel=`${back()}<p class="navtitle">観戦</p>${rulePick('<button class="gbtn go" data-ui="navNext">次へ</button>')}`;
  else if(s==='local') panel=`${back()}<p class="navtitle">ローカル対戦</p>${rulePick('<button class="gbtn go" data-a="chooseMode" data-mode="pvp">はじめる</button>')}`;
  else if(s==='tutorial') panel=`${back()}<p class="navtitle">チュートリアル</p>${rulesGuideHTML(false)}${statusGuideHTML(false)}`;
  else if(s==='settings') panel=`${back()}<p class="navtitle">設定</p>${settingsBodyHTML()}`;
  else if(s==='online') panel=netPanelHTML(rulePick);
  else if(s==='records') panel=`${back()}<p class="navtitle">戦績</p>${recordsBodyHTML()}`;
  const top=`<div class="showcase">${show}</div>${src}
    <div class="topmenu">
      <button class="gbtn p" data-ui="nav" data-s="quick">クイックバトル</button>
      <button class="gbtn" data-ui="nav" data-s="arcade">アーケード</button>
      <button class="gbtn" data-ui="nav" data-s="draft">ドラフト</button>
      ${typeof scnAvail==='function'&&scnAvail()?'<button class="gbtn" data-ui="scnList">シナリオ</button>':''}
      <button class="gbtn" data-ui="nav" data-s="local">ローカル対戦</button>
      <button class="gbtn" data-ui="nav" data-s="watch">観戦</button>
      <button class="gbtn" data-ui="nav" data-s="online">オンライン対戦</button>
      <button class="gbtn" data-ui="nav" data-s="zukan">図鑑</button>
      <button class="gbtn" data-ui="nav" data-s="records">戦績</button>
      <button class="gbtn" data-ui="nav" data-s="tutorial">チュートリアル</button>
      <button class="gbtn" data-ui="nav" data-s="settings">設定</button>
      <a class="gbtn editorlink" href="editor.html">ペンシルエディタ</a>
      <a class="gbtn editorlink" href="scenario-editor.html">シナリオエディタ</a>
    </div>`;
  return `<div class="mode">${head}${top}</div>${panel?`<div class="modal navmodal"><div class="mback" data-ui="navClose"></div><div class="mbody navpanel${s==='records'?' wide':''}">${panel}</div></div>`:''}`;
}
// 全画面で重ねて出す設定・チュートリアルのウィンドウ（ハンバーガーメニューから）
function overlaysHTML(){ return settingsModalHTML()+tutorialModalHTML()+(typeof netNoticeHTML==='function'?netNoticeHTML():'');
}

// ---------- 描画 ----------
function render(){
  const app=document.querySelector('#app'), hinfo=document.querySelector('#hinfo'), online=typeof netOn==='function'&&netOn(), me=online?netMe():0; // オンラインのゲストは自分（プレイヤー2）を下に出す
  const screen=G.phase==='mode'?(UI.nav.s==='zukan'?'zukan':'mode'):G.phase==='setup'?'setup':G.phase==='draft'?'draft':G.phase==='stage'?'stage':'battle';
  document.body.dataset.screen=screen;
  document.body.dataset.phase=G.phase;
  if(G.phase!=='over'){ UI.result=false; UI.resultShown=false; UI.endReady=false; UI.resultAt=0; }
  if(G.phase!=='master') UI.spellPick=false;
  if(screen!=='setup'&&screen!=='zukan'&&screen!=='draft') UI.sinfo=null;
  if(screen!=='stage') UI.stageSeen=null;
  if(screen!=='setup'){ UI.party=false; UI.partyDel=null; }
  if(screen!=='mode'||UI.nav.s!=='records') UI.recAsk=false;
  document.body.classList.toggle('lock',otherActing());
  const ab=document.querySelector('#autobtn'), spd=document.querySelector('#spd');
  ab.hidden=screen!=='battle'; ab.textContent=`オート：${UI.auto?'ON':'OFF'}`; ab.classList.toggle('on',UI.auto);
  spd.hidden=screen!=='battle'; spd.textContent=`速度：${G.speed<=150?'最速':G.speed<500?'速い':'普通'}`;
  document.body.classList.toggle('menuopen',UI.menu);
  document.querySelector('#menubtn').setAttribute('aria-expanded',UI.menu?'true':'false');
  // 画面は毎回作り直すが、読み込み済みの画像は残す（setHTML：フェイズ切り替えで画像がチカチカ消えないように）
  if(screen==='mode'){ setHTML(app,modeHTML()+overlaysHTML()); hinfo.textContent=''; }
  else if(screen==='zukan'){ setHTML(app,zukanHTML()+(UI.sinfo?sinfoModalHTML():'')+linkModalHTML()+overlaysHTML()); hinfo.textContent='図鑑'; }
  else if(screen==='setup'){ setHTML(app,setupHTML()+(UI.sinfo?sinfoModalHTML():'')+partyModalHTML()+linkModalHTML()+overlaysHTML()); hinfo.textContent=(online?`オンライン対戦（${me?'ゲスト':'ホスト'}） ・ `:'')+(ruleset().partyMax===1?`${ruleset().name}ルール ・ ${TERMS.unit}選択`:'パーティ編成'); }
  else if(screen==='draft'){ setHTML(app,draftHTML()+(UI.sinfo?sinfoModalHTML():'')+linkModalHTML()+overlaysHTML()); hinfo.textContent=`ドラフト ・ ${ruleset().name}ルール`; }
  else if(screen==='stage'){ setHTML(app,arcadeStageHTML()+overlaysHTML()); hinfo.textContent=arcadeLabel(); }
  else {
    if(UI.detail&&!U(UI.detail)) UI.detail=null;
    setHTML(app,`<div class="battle ${UI.log?'':'nolog'}"><main class="field">${sideHTML(1-me,'top')}${stageHTML()}${sideHTML(me,'bottom')}</main>${UI.log?logHTML():''}</div>${UI.detail?detailModalHTML():''}${UI.result&&G.phase==='over'?(UI.result==='total'&&G.arcade?arcadeTotalHTML():resultHTML()):''}${linkModalHTML()}${overlaysHTML()}`);
    hinfo.textContent=`${online?`オンライン対戦（${me?'ゲスト':'ホスト'}） ・ `:''}${G.scn&&G.scn.title?`${G.scn.title} ・ `:''}${G.arcade?`${arcadeLabel()} ・ `:''}${G.rule!=='team'?`${ruleset().name}ルール ・ `:''}ターン${G.turn}`;
    const l=document.querySelector('#log'); if(l) l.scrollTop=l.scrollHeight;
    animateLane();
    syncMagicCircle(); syncPulses();
  }
  saveMatch();
  if(typeof scnHook==='function') scnHook();
  scheduleCpu();
  scheduleAuto();
  fxKick();
}

// ---------- 試合の保存と再開 ----------
// スマホの引っぱって更新・メモリ不足によるタブの再読み込み・エディタへの移動などでページが読み込み直されても、
// 同じタブ（sessionStorage）なら編成・対戦の続きから再開する。モード選択に戻ると消える
const MATCH_KEY='pencilduel.match';
function saveMatch(){
  try{
    const net=typeof netOn==='function'&&netOn();
    if(G.phase==='mode'||G.phase==='init'||(net&&netMe()!==0)){ if(!MATCH_HOLD) sessionStorage.removeItem(MATCH_KEY); return; } // オンライン対戦：ゲームを進めているホストだけ保存する（読み込み直したら中断の状態で戻り、つなぎ直す）
    sessionStorage.setItem(MATCH_KEY,JSON.stringify({v:1,src:UNIT_SOURCE,net,G:{...G,log:G.log.slice(-400)}}));
  }catch(e){}
}
// シナリオの戦闘（G.scn）は、シナリオ本体を読み込んだあと scenario.js が restoreMatch(true) で再開する。それまで保存を消さない（MATCH_HOLD）
let MATCH_HOLD=false;
function restoreMatch(scn=false){
  try{
    const s=JSON.parse(sessionStorage.getItem(MATCH_KEY)||'null');
    if(!s||s.v!==1||!s.G||s.src!==UNIT_SOURCE) return false;
    if(!!s.G.scn!==scn){ if(s.G.scn) MATCH_HOLD=true; return false; }
    const g=s.G, ids=[...g.picks.flat(),...g.players.flatMap(P=>P.party.map(u=>u.def))];
    if(!ids.every(id=>D(id))) return false; // データが変わってキャラがいなければ再開しない
    G=g;
    if(s.net&&typeof netResumeHost==='function') netResumeHost(); // オンライン対戦のホスト：中断の状態で戻る（net.js）
    if(G.phase==='over'){ UI.endReady=true; UI.resultShown=true; } // 決着の演出は済んだものとして結果ボタンを出す
    if(G.phase!=='setup'&&G.phase!=='draft') log('（ページが読み込み直されたため、試合の続きから再開しました）','sub');
    return true;
  }catch(e){ return false; }
}

// ---------- オート進行 ----------
// 選ぶ余地がない操作（ロールするだけ・決定するだけ）を、オートONのとき自動で押す。
// 人の手番だけ。act() を通すので、手で押したのと同じ扱い
const AUTO_DELAY=550;
let autoTimer=null;
function hasSkillChoice(){
  return alive(G.cur).some(u=>D(u.def).skills.some((s,i)=>skillUsable(u,i)&&s.eff.length))
      || (!G.ult&&!G.ultDone&&alive(G.cur).some(u=>canUlt(u)&&u.np>=RULES.ultCost));
}
function autoMove(){
  if(!UI.auto||otherActing()||UI.detail||G.pending||G.copy) return null;
  switch(G.phase){
    case 'actRoll':
      if(!G.actRolled) return ['rollActs'];
      // 全員を最大まで行動させても上限以内なら、配分を選ぶ余地はない
      return Object.values(G.maxActs).reduce((a,b)=>a+b,0)<=RULES.actionsMax ? ['confirmAlloc'] : null;
    case 'skill': return hasSkillChoice()?null:['skillDone'];
    case 'master': { // マスターフェイズは毎回選ぶ。ただし補助の対象が1体しか選べないときは選ぶ余地がない
      const sp=G.spellPick;
      if(sp&&sp.sup){ const c=pickCands(sp.side,G.cur); if(c.length===1) return ['masterSupportPick',{uid:c[0].uid}]; }
      return null;
    }
    case 'action': {
      const uid=Object.keys(G.alloc).find(id=>!U(id).out&&G.rolled.filter(r=>r.uid===id).length<G.alloc[id]);
      return uid?['rollAction',{uid}]:['toTarget'];
    }
    case 'target': return (G.targetAll||targetCandidates().length===1||(!G.ult&&!G.rolled.length))&&G.target ? ['resolve'] : null; // 攻撃が1つもない（全員0回）ときも選ぶ余地なし
    case 'end': return ['endTurn'];
  }
  return null;
}
function scheduleAuto(delay=AUTO_DELAY){
  clearTimeout(autoTimer);
  if(!autoMove()) return;
  autoTimer=setTimeout(()=>{
    if(fxBusy()){ scheduleAuto(150); return; } // 演出が終わってから
    const m=autoMove(); if(m) act(m[0],m[1]||{});
  },delay);
}

// ---------- 入力 ----------
const FREE_ACTIONS=['restart','rematch','toggleSpeed','useDefaultData'];
function uiAct(a,ds){
  switch(a){
    case 'detail': UI.detail=ds.uid; break;
    case 'closeDetail': UI.detail=null; break;
    case 'openResult': UI.result=true; break;
    case 'closeResult': UI.result=false; break;
    case 'rtab': UI.rtab=ds.v; break;
    case 'sinfo': UI.sinfo=ds.id; break;
    case 'ztab': UI.ztab=ds.v; break;
    case 'zview': UI.setupView=ds.id; if(matchMedia('(max-width:860px)').matches) UI.sinfo=ds.id; break;
    case 'closeSinfo': UI.sinfo=null; break;
    case 'openLink': if(linkConfirmOn()) UI.linkAsk=ds.url; else window.open(ds.url,'_blank','noopener'); break;
    case 'linkGo': { const cb=document.querySelector('#linkNoAsk'); if(cb&&cb.checked) savePref(LINK_PREF,'0'); window.open(UI.linkAsk,'_blank','noopener'); UI.linkAsk=null; break; }
    case 'linkCancel': UI.linkAsk=null; break;
    case 'nav': UI.nav={s:ds.s,step:'rule'}; break;
    case 'navClose': UI.nav={s:'top',step:'rule'}; break;
    case 'navNext': UI.nav.step='level'; break;
    case 'navLevel': UI.nav.level=ds.level; break;
    case 'navLevel2': UI.nav.level2=ds.level; break;
    case 'navDiff': UI.nav.diff=ds.diff; break;
    case 'navKind': UI.nav.step='kind'; break;
    case 'openTotal': UI.result='total'; break;
    case 'openSettings': UI.settings=true; break;
    case 'closeSettings': UI.settings=false; break;
    case 'openTutorial': UI.tut=true; break;
    case 'closeTutorial': UI.tut=false; break;
    case 'setAuto': UI.auto=ds.v==='1'; savePref('pencilduel.auto',UI.auto?'1':'0'); break;
    case 'toggleSpeed': { const v=G.speed>=500?250:G.speed>150?120:700; savePref('pencilduel.speed',String(v)); window.SPEED_PREF=v; G.speed=v; break; }
    case 'setLog': UI.log=ds.v==='1'; savePref('pencilduel.logOpen',UI.log?'1':'0'); break;
    case 'setHint': savePref(HINT_PREF,ds.v==='1'?'1':'0'); break;
    case 'recAsk': UI.recAsk=true; break;
    case 'recCancel': UI.recAsk=false; break;
    case 'recReset': recReset(); UI.recAsk=false; break;
    case 'partyOpen': UI.party=true; UI.partyDel=null; break;
    case 'partyClose': UI.party=false; UI.partyDel=null; break;
    case 'partySave': partySaveCur(); break;
    case 'partyDelAsk': UI.partyDel=ds.sig; break;
    case 'partyDelCancel': UI.partyDel=null; break;
    case 'partyDel': partyDelete(ds.sig); UI.partyDel=null; break;
    case 'partyLoad': { const e=partyList().find(x=>partySig(x)===ds.sig); UI.party=false; if(e){ UI.setupView=null; act('setupLoad',{picks:e.picks,mpick:e.mpick}); return; } break; }
    case 'setBottom': UI.bottom=Math.min(BOTTOM_STEPS.length-1,Math.max(0,Number(ds.v)||0)); savePref('pencilduel.bottom',String(UI.bottom)); applyBottom(); break;
    case 'rcost': UI.rcost=ds.v; break;
    case 'navBack': if(UI.nav.s==='arcade'&&UI.nav.step==='kind') UI.nav.step='level'; else if(['quick','watch','arcade','draft'].includes(UI.nav.s)&&UI.nav.step==='level') UI.nav.step='rule'; else UI.nav={s:'top',step:'rule'}; break;
    case 'setSpeed': { const v=Number(ds.v)||700; savePref('pencilduel.speed',String(v)); window.SPEED_PREF=v; G.speed=v; break; }
    case 'setNoCanon': {
      savePref(CANON_PREF,ds.v==='0'?'0':'1'); reloadUnits(); SHOW_IDS=null; UI.setupView=null;
      if(G.phase==='setup'){ // 編成中に外れたキャラは選択から外す
        G.picks=G.picks.map(a=>a.filter(id=>UNITS.some(u=>u.id===id)));
        if(G.mpicks) G.mpicks=G.mpicks.map(id=>MASTERS.some(m=>m.id===id)?id:null);
      }
      break;
    }
    case 'setLinkConfirm': savePref(LINK_PREF,ds.v==='0'?'0':'1'); break;
    case 'toggleLinkConfirm': savePref(LINK_PREF,linkConfirmOn()?'0':'1'); break;
    case 'toggleLogSay': savePref('pencilduel.logSay',logSayOn()?'0':'1'); break;
    case 'logHtml': blogExportHTML(); return;
    case 'logCsv': blogExportCSV(); return;
    case 'toggleLog': UI.log=!UI.log; savePref('pencilduel.logOpen',UI.log?'1':'0'); break;
    case 'toggleAuto': UI.auto=!UI.auto; savePref('pencilduel.auto',UI.auto?'1':'0'); break;
    case 'toggleMenu': UI.menu=!UI.menu; break;
    case 'toggleBottom': UI.bottom=(UI.bottom+1)%BOTTOM_STEPS.length; savePref('pencilduel.bottom',String(UI.bottom)); applyBottom(); break;
    case 'spellPick': UI.spellPick=!UI.spellPick; break;
    case 'mToggle': UI.mfold=!UI.mfold; break;
    case 'rosterCls': UI.roster.cls=ds.v; break;
    case 'rosterReset': UI.roster={...UI.roster, cls:'', cost:'', q:'', ok:false}; break;
    default: if(typeof netUi==='function'&&netUi(a,ds)) break; // オンライン対戦（net.js）
      if(typeof scnUi==='function') scnUi(a,ds); // シナリオ（scenario.js）
  }
  render();
}
document.addEventListener('click',e=>{
  // メニュー（ハンバーガー）：中のボタンを押したとき・外側を押したときは閉じる
  if(UI.menu&&!e.target.closest('#menubtn')){ UI.menu=false; document.body.classList.remove('menuopen'); document.querySelector('#menubtn').setAttribute('aria-expanded','false'); }
  // 拡大ウィンドウの中でスキル・宝具を使ったら、盤面で結果（や対象選択）を見られるよう閉じる
  if(UI.detail&&e.target.closest('.udops [data-a]')) UI.detail=null;
  const u=e.target.closest('[data-ui]');
  if(u){ uiAct(u.dataset.ui,u.dataset); return; }
  const b=e.target.closest('[data-a]'); if(!b||b.disabled) return;
  if(b.dataset.a==='restart'&&!b.dataset.keepnav) UI.nav={s:'top',step:'rule'}; // 試合から戻るときはトップメニューへ（編成の「戻る」は直前の選択画面へ）
  if(b.dataset.view) UI.setupView=b.dataset.view;
  if(b.dataset.a==='setupMaster'&&b.classList.contains('mtile')) UI.mfold=!b.classList.contains('sel'); // 選んだら畳む／外したら開く
  if(b.dataset.a==='setupConfirm') UI.mfold=false; // 次の人の編成では、マスター一覧を開いた状態から始める
  if(otherActing() && !FREE_ACTIONS.includes(b.dataset.a)){ if(b.dataset.view) render(); return; } // CPUの手番中は操作を受け付けない
  const pl={...b.dataset};
  if(pl.a==='setupRandom'||(pl.a==='setupCpu'&&pl.how==='random')) pl.cost=UI.rcost??''; // おまかせ（ランダム）のコスト指定
  act(b.dataset.a,pl);
});
document.addEventListener('change',e=>{ if(e.target.matches('select[data-rcost]')) UI.rcost=e.target.value; });
// 編成画面：カードにマウスを乗せると右側に詳細
document.addEventListener('mouseover',e=>{
  const t=e.target.closest('.tile[data-view]'); if(!t||UI.setupView===t.dataset.view) return;
  if(G.phase==='mode') return; // 図鑑はクリックで固定（マウスを乗せただけでは切り替えない）
  UI.setupView=t.dataset.view;
  const box=document.querySelector('.sdetail'), d=D(UI.setupView);
  if(box&&d) setHTML(box,viewDetailHTML(d));
  document.querySelectorAll('.tile.viewing').forEach(x=>x.classList.remove('viewing')); t.classList.add('viewing');
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&(UI.settings||UI.tut)){ UI.settings=false; UI.tut=false; render(); return; }
  if(e.key==='Escape'&&UI.party){ UI.party=false; UI.partyDel=null; render(); return; }
  if(e.key==='Escape'&&UI.linkAsk){ UI.linkAsk=null; render(); return; }
  if(e.key==='Escape'&&(UI.detail||UI.sinfo)){ UI.detail=null; UI.sinfo=null; render(); return; }
  if(e.key==='Escape'&&G.phase==='mode'&&UI.nav.s!=='top'){ UI.nav={s:'top',step:'rule'}; render(); return; }
  if((e.key==='Enter'||e.key===' ')&&e.target.matches&&e.target.matches('.tinfo')){ e.preventDefault(); e.stopPropagation(); e.target.click(); } // キーボードでも ⓘ を開ける
});

// iPhone Safari: 下部のバーに隠れるときの手動の余白（メニュー「下の余白」で切り替え、端末に保存）
const BOTTOM_STEPS=[0,28,56,84], BOTTOM_LABELS=['なし','小','中','大'];
UI.bottom=Math.min(BOTTOM_STEPS.length-1,Math.max(0,parseInt(readPref('pencilduel.bottom'),10)||0));
function applyBottom(){ document.documentElement.style.setProperty('--bot',BOTTOM_STEPS[UI.bottom]+'px'); }
applyBottom();
// 見えている高さを --app-h に入れる（dvh が効かない環境の保険。対戦画面以外で使う）
function fitViewportH(){
  const h=(window.visualViewport&&window.visualViewport.height)||window.innerHeight;
  if(h) document.documentElement.style.setProperty('--app-h',Math.round(h)+'px');
  if(document.body.dataset.screen==='battle'&&(window.scrollY||window.scrollX)) window.scrollTo(0,0); // ページごとずれていたら戻す
}
fitViewportH();
window.addEventListener('resize',fitViewportH);
window.addEventListener('orientationchange',fitViewportH);
window.addEventListener('scroll',fitViewportH,{passive:true});
if(window.visualViewport) window.visualViewport.addEventListener('resize',fitViewportH);
// エディタで反映したデータを、別タブから戻ってきたときに読み直す（モード選択画面にいるときだけ）
window.addEventListener('storage',e=>{ if((e.key===STORE.units||e.key===STORE.masters) && G.phase==='mode'){ reloadUnits(); render(); } });
// タイトル画面の夜空（#titlebg）：#app の外に1回だけ作る（render() で作り直さないので、回転・瞬きのアニメーションが途切れない）。
// 背景画像は UI_IMG から CSS 変数へ。星は固定の乱数で散らした box-shadow（毎回同じ配置）
function initTitleBg(){
  const el=document.querySelector('#titlebg'); if(!el) return;
  const url=p=>`url('${new URL(p,document.baseURI).href}')`;
  el.style.setProperty('--tb-pc',url(UI_IMG.titleBg));
  el.style.setProperty('--tb-sp',url(UI_IMG.titleBgSp));
  el.style.setProperty('--tb-circle',url(UI_IMG.titleCircle));
  let seed=7; const r=()=>(seed=(seed*16807)%2147483647)/2147483647;
  const layer=(n,size,col)=>Array.from({length:n},()=>`${Math.round(r()*2400)}px ${Math.round(r()*1400)}px 0 ${size}px ${col}`).join(',');
  el.innerHTML=[[140,0,'rgba(255,255,255,.75)'],[60,.5,'rgba(220,230,255,.9)']].map(([n,s,c],i)=>`<i class="tb-stars s${i+1}" style="box-shadow:${layer(n,s,c)}"></i>`).join('')
    +'<i class="tb-circle"></i><i class="tb-mist"></i>';
}
initTitleBg();
newGame(); restoreMatch(); render();
