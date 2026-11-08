'use strict';
/* =====================================================================
   ゲーム画面の描画と入力
   - 対戦画面は1画面に収まるレイアウト（上：相手 / 中央：コマンド / 下：自分 / 右：ログ）
   - 詳細（スキル説明・鉛筆の面）は ⓘ ボタンのウィンドウで見る
   - 画面だけの状態（詳細ウィンドウ・ログの開閉など）は UI に持ち、G には入れない
   ===================================================================== */

const UI = { menu:false, result:false, resultShown:false, endReady:false,
  roster:{ sort:'default', cls:'', cost:'', q:'', ok:false }, /* キャラクター選択の並べ替え・絞り込み */ detail:null, setupView:null, log:readLogPref(), auto:readPref('pencilduel.auto')==='1' };
function readPref(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
function savePref(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }
function readLogPref(){
  const v=readPref('pencilduel.logOpen'); if(v!=null) return v==='1';
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
  const ready=u.np>=RULES.ultCost&&!u.out, ok=own&&ultManual()&&canUlt(u)&&!G.ult&&ready;
  const tip=`${TERMS.ult}「${d.ult.name}」 [${TERMS[d.ult.c]}] ${effsText(d.ult.eff)}（${ultManual()?`${TERMS.gauge}${RULES.ultCost}%で使用可`:`${TERMS.gauge}${RULES.ultCost}%で手番を迎えると発動して勝利`}）`;
  const ult=`<span class="skw" title="${esc(tip)}"><button class="sk np ${d.ult.c} ${ready?'ready':''}" data-a="useUlt" data-uid="${u.uid}" ${ok?'':'disabled'}><i>${TERMS.ult}</i><span>${esc(d.ult.name)}</span></button></span>`;
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
  return G.phase==='actRoll'&&G.actRolled&&u.pid===G.cur&&!u.out&&!cpuActing()&&!FXHIDE.has(`f:${u.uid}`)
    &&(G.alloc[u.uid]||0)<(G.maxActs[u.uid]||0)&&totalAlloc()<RULES.actionsMax;
}
// 画面に出すHP・戦闘不能の状態（ダメージ演出の再生中は演出に合わせて遅れて変わる）
const shown = u=>FXHOLD[u.uid]||{hp:u.hp,out:u.out};
function svtHTML(u){
  const d=D(u.def), ph=G.phase, sh=shown(u);
  const allocable=canAllocMore(u);
  const pickable=allocable || (G.copy&&copyCands(U(G.copy.uid)).includes(u)) || (G.pending&&pickValid(u)) || (!G.pending&&!G.copy&&ph==='target'&&targetCandidates().includes(u));
  const acting=G.ult?G.ult===u.uid:(G.alloc[u.uid]||0)>0;
  const tgt=(G.targetAll?u.pid!==G.cur&&!u.out&&['target','end'].includes(ph):G.target===u.uid)&&!sh.out;
  // スキルを使える自分のサーヴァント（スキル欄が隠れる小さい表示のとき、ⓘ を光らせて知らせる）
  const canSk=u.pid===G.cur&&ph==='skill'&&!G.pending&&!cpuActing()&&(canSkill(u)&&d.skills.some((s,i)=>!u.used[i]&&(i<2||u.asc))||ultManual()&&!G.ult&&canUlt(u)&&u.np>=RULES.ultCost);
  const cls=['svt',sh.out?'out':'',pickable?'pickable':'',tgt?'targeted':'',acting&&u.pid===G.cur?'acting':'',canSk?'canskill':''].join(' ');
  const fx=u.fx.map(e=>`<span class="chip fx ${FX[e.k].buff?'buff':'debuff'}">${fxText(e)}</span>`).join('');
  // スマホの簡易表示用：効果の数（強化▲・弱体▼）。中身は拡大ウィンドウで見る
  const nb=u.fx.filter(e=>FX[e.k].buff===true).length, nd=u.fx.filter(e=>FX[e.k].buff===false).length;
  const pfx=nb||nd?`<span class="pfx">${nb?`<b class="buff">▲${nb}</b>`:''}${nd?`<b class="debuff">▼${nd}</b>`:''}</span>`:'';
  return `<div class="${cls}${allocable?' allocable':''}" data-uid="${u.uid}" ${allocable?`data-a="alloc" data-d="1" title="クリックで行動を1回追加"`:pickable?`data-a="cardClick"`:''}>
    <div class="svin"><div class="portrait">${unitImg(d,'face','pimg',d.name)}
      ${clsIconTag(d.cls,'pcls')}<span class="pord">${ORD[u.idx]}</span>
      ${u.asc?`<span class="pasc">${TERMS.asc}</span>`:''}
      ${sh.out?`<span class="pout">${TERMS.out}</span>`:''}
      ${pfx}${rollBadge(u,d)}
    </div>
    <div class="sinfo">
      <div class="sname"><b title="${esc(d.name)}">${esc(d.name)}</b><button class="info" data-ui="detail" data-uid="${u.uid}" title="詳細を見る">i</button></div>
      <div class="gauge hp"><span>HP</span><div class="bar"><i style="width:${pctOf(sh.hp,d.hp)}%"></i></div><b>${fmt(sh.hp)}<small>/${d.hp}</small></b></div>
      <div class="gauge np ${u.np>=RULES.ultCost?'full':''}"><span>${TERMS.gauge}</span><div class="bar"><i style="width:${Math.min(100,u.np)}%"></i></div><b>${u.np}<small>%</small></b></div>
      ${ctlHTML(u)}
      <div class="fxs" title="${esc(u.fx.map(fxText).join(' / '))}">${fx}</div>
      ${skillBtns(u,d)}
    </div></div>
  </div>`;
}
function sideHTML(pid,pos){
  const P=G.players[pid], turn=pid===G.cur&&G.phase!=='over';
  return `<section class="side ${pos} ${turn?'turn':''}">
    <div class="sidebar"><b class="p${pid}">${esc(P.name)}</b>${turn?'<span class="turnbadge">手番</span>':''}<span class="grow"></span><span class="stars" title="${TERMS.star}">★ <b>${P.stars}</b></span></div>
    <div class="svts ${P.party.length===1?'solo':''}">${P.party.map(svtHTML).join('')}</div>
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
        : `<p>行動させる${TERMS.unit}を選ぶと中央に並びます。中央のカードを選ぶと戻せます（合計 <b>${totalAlloc()}</b> / ${RULES.actionsMax}）。</p><button class="primary big" data-a="confirmAlloc">決定</button>`;
    case 'skill':
      return G.pending
        ? `<p class="hl">「${esc(pendingSkill().name)}」の対象を選んでください</p><button data-a="cancelPick">キャンセル</button>`
        : `<p>${ultManual()?`スキル・${TERMS.ult}を使えます。${TERMS.ult}は${TERMS.gauge}${RULES.ultCost}%以上・1ターン1回。`:`スキルを使えます。${TERMS.ult}は${TERMS.gauge}${RULES.ultCost}%で手番を迎えると発動して勝利。`}</p>${G.ult?`<p class="hl">${nm(U(G.ult))}が${TERMS.ult}を使用予定</p>`:''}<button class="primary big" data-a="skillDone">${G.ult?'攻撃対象の選択へ':'行動決定へ'}</button>`;
    case 'action': {
      const left=remainingRolls();
      if(G.copy) return `<p class="hl">${nm(U(G.copy.uid))}：ロールする${TERMS.unit}を選んでください（敵味方どちらでも・${TERMS.asc}後コマンドを使用）</p>`;
      return `<p>行動する${TERMS.unit}の「ロール」でコマンドを決めます（残り${left}回）。</p><button class="primary big" data-a="toTarget" ${left?'disabled':''}>攻撃対象の選択へ</button>`; }
    case 'target':
      if(G.targetAll) return `<p>${TERMS.ult}「${esc(D(U(G.ult).def).ult.name)}」は<b class="hl">敵全体</b>が対象です。</p><button class="primary big" data-a="resolve">⚔ ${TERMS.ult}発動</button>`;
      return `<p>相手の${TERMS.unit}をクリックして攻撃対象を選びます${targetCandidates().some(u=>has(u,'taunt'))?'（ターゲット集中あり）':''}。</p><p>対象：<b>${G.target?nm(U(G.target)):'未選択'}</b></p><button class="primary big" data-a="resolve" ${G.target?'':'disabled'}>⚔ 攻撃</button>`;
    case 'end':
      return `<p>ダメージフェイズが終わりました。</p><button class="primary big" data-a="endTurn">ターン終了</button>`;
    case 'over':
      if(!UI.endReady) return ''; // 決着の演出（VICTORY の帯）が終わってから出す
      return `<p class="win">${G.mode==='cpu'?(G.winner===0?'勝利！':'敗北…'):`${esc(G.players[G.winner].name)} の勝利！`}</p><div class="row"><button class="primary" data-a="rematch">もう一度</button><button data-ui="openResult">リザルト</button><button data-a="restart">モード選択へ</button></div>`;
  }
  return '';
}
// 行動配分中のコマンド列：割り振った回数ぶんサーヴァントのカードを並べる（クリックで1回戻す）
function allocCards(){
  return G.players[G.cur].party.filter(u=>!u.out&&!FXHIDE.has(`f:${u.uid}`))
    .flatMap(u=>Array.from({length:G.alloc[u.uid]||0},(_,k)=>({u,k})));
}
function allocLaneHTML(){
  const cs=allocCards(), own=!cpuActing();
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
  const stars=me.stars;
  return `<section class="stage">
    ${magicCircleHTML()}
    <div class="stagetop"><span class="turnno">TURN <b>${G.turn}</b></span><span class="p${G.cur} who">${esc(me.name)}の手番</span><div class="steps">${steps}</div></div>
    <div class="stagebody">
      <div class="prompt">${promptHTML()}</div>
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
function logHTML(){
  return `<aside class="logpane"><div class="loghead"><b>バトルログ</b><button class="small" data-ui="toggleLog">閉じる</button></div>
    <div id="log" class="log">${G.log.slice(-200).map(l=>`<div class="${l.cls}">${l.msg}</div>`).join('')}</div></aside>`;
}

// ---------- 詳細（対戦中の ⓘ・編成画面の右側で共用） ----------
function unitDetailHTML(d,u){
  const fx=u&&u.fx.length?`<h4>効果</h4><div class="fxs open">${u.fx.map(e=>`<span class="chip fx ${FX[e.k].buff?'buff':'debuff'}">${fxText(e)}</span>`).join('')}</div>`:'';
  return `<div class="udetail">
    <div class="udtop">
      <div class="udimg">${unitImg(d,'face','pimg',d.name)}</div>
      <div class="udinfo">${clsBadge(d.cls)}<h3>${esc(d.name)}</h3>
        <div class="sub small">コスト ${d.cost} ・ HP ${u?`${fmt(u.hp)} / `:''}${d.hp}${u?` ・ ${TERMS.gauge} ${u.np}%`:''}${u&&u.asc?` ・ <span class="hl">${TERMS.ascFull}済み</span>`:''}</div>
        <div class="ccrow">${['R','B','G'].map(k=>cmdCardHTML(d,{c:k},{small:true})).join('')}</div>
      </div>
    </div>
    ${fx}
    ${u?`<h4>操作</h4><div class="udops">${skillBtns(u,d)}</div>`:''}
    <h4>スキル・${TERMS.ult}</h4>${skillListHTML(d)}
    <h4>鉛筆の面</h4>${facesTableHTML(d)}
  </div>`;
}
function detailModalHTML(){
  const u=U(UI.detail); if(!u) return '';
  return `<div class="modal"><div class="mback" data-ui="closeDetail"></div>
    <div class="mbody"><button class="mclose" data-ui="closeDetail" title="閉じる">×</button>${unitDetailHTML(D(u.def),u)}</div></div>`;
}

// ---------- リザルト（決着後） ----------
function resultHTML(){
  const w=G.winner, cpuMode=G.mode==='cpu';
  const title=cpuMode?(w===0?'VICTORY':'DEFEAT'):'WINNER';
  const sub=cpuMode?(w===0?'勝利！':'敗北…'):`${esc(G.players[w].name)} の勝利！`;
  const side=pid=>{ const P=G.players[pid];
    const rows=P.party.map(u=>{ const d=D(u.def);
      return `<div class="rrow ${u.out?'out':''}">${unitImg(d,'face','pimg',d.name)}<b>${esc(d.name)}</b><span>${u.out?TERMS.out:`HP ${fmt(u.hp)}<small>/${d.hp}</small>`}</span></div>`; }).join('');
    return `<div class="rside ${pid===w?'rwin':''}"><h4><span class="p${pid}">${esc(P.name)}</span>${pid===w?'<em>WIN</em>':''}</h4>${rows}
      <p class="sub small">与えたダメージ合計 <b>${fmt(G.dealt[pid])}</b></p></div>`; };
  return `<div class="modal result"><div class="mback"></div>
    <div class="mbody"><h2 class="rtitle ${w===0?'p0':'p1'}">${title}</h2><p class="rsub">${sub}</p>
      <p class="sub small rturn">${esc(ruleset().name)}ルール ・ 経過ターン <b>${G.turn}</b>${G.winBy==='np'?` ・ ${TERMS.ult}発動で決着`:''}</p>
      <div class="rsides">${side(0)}${side(1)}</div>
      <div class="row"><button class="primary" data-a="rematch">もう一度</button><button data-a="restart">モード選択へ</button><button data-ui="closeResult">盤面を見る</button></div>
    </div></div>`;
}

// ---------- 編成画面 ----------
function setupHTML(){
  const pid=G.setupPid, picks=G.picks[pid], cost=sumCost(picks), rs=ruleset(), solo=rs.partyMax===1;
  const view=D(UI.setupView)||D(picks[picks.length-1])||UNITS[0];
  const slots=Array.from({length:rs.partyMax},(_,i)=>i).map(i=>{
    const d=D(picks[i]);
    return d ? `<button class="slot filled" data-a="setupToggle" data-id="${esc(d.id)}" data-view="${esc(d.id)}" title="外す">${unitImg(d,'face','pimg',d.name)}<span>${ORD[i]}</span><b>${esc(d.name)}</b></button>`
             : `<div class="slot"><span>${ORD[i]}</span></div>`;
  }).join('');
  return `<div class="setup">
    <div class="sethead">
      <div class="settitle"><h2><span class="p${pid}">${esc(G.players[pid].name)}</span> の${solo?`${TERMS.unit}選択`:'パーティ編成'}</h2>
        <p class="sub small nm">${solo?`${rs.name}ルール：${TERMS.unit}を1騎選びます。${handicapNote(pid)}`:`コスト合計${RULES.costCap}以下・最大${rs.partyMax}騎。選んだ順に 1st / 2nd / 3rd。`}</p></div>
      <div class="slots">${slots}</div>
      <div class="costm" ${solo?'hidden':''}><span>COST</span><b>${cost}</b><small>/ ${RULES.costCap}</small><div class="bar"><i style="width:${pctOf(cost,RULES.costCap)}%"></i></div></div>
      <div class="setbtns"><button data-a="${isCpu(pid)?'setupCpu':'setupRandom'}">おまかせ</button><button class="primary big" data-a="setupConfirm" ${picks.length?'':'disabled'}>決定</button></div>
    </div>
    ${G.setupMsg?`<p class="warn nm">${G.setupMsg}</p>`:''}
    <div class="setbody">
      <div class="rosterwrap">${rosterFilterHTML()}<div class="roster">${rosterTilesHTML(view)}</div></div>
      <div class="sdetail">${view?unitDetailHTML(view):''}</div>
    </div>
  </div>`;
}

// ---------- キャラクター選択：並べ替え・絞り込み ----------
const ROSTER_SORTS = { default:'標準', costDesc:'コストが高い順', costAsc:'コストが低い順', hpDesc:'HPが高い順', hpAsc:'HPが低い順', name:'名前順', cls:'クラス順' };
// 編成に加えられない（選択済みでなく、上限やコストを超える）
function rosterOver(d){
  const picks=G.picks[G.setupPid], rs=ruleset();
  return !picks.includes(d.id)&&rs.partyMax>1&&(picks.length>=rs.partyMax||sumCost(picks)+d.cost>RULES.costCap);
}
function rosterList(){
  const f=UI.roster, q=f.q.trim().toLowerCase();
  const list=UNITS.filter(d=>(!f.cls||d.cls===f.cls)&&(f.cost===''||d.cost===Number(f.cost))
    &&(!q||d.name.toLowerCase().includes(q)||d.cls.toLowerCase().includes(q))&&(!f.ok||!rosterOver(d)));
  const ci=c=>{ const i=CLASSES.indexOf(c); return i<0?CLASSES.length:i; };
  const by={ costDesc:(a,b)=>b.cost-a.cost, costAsc:(a,b)=>a.cost-b.cost, hpDesc:(a,b)=>b.hp-a.hp, hpAsc:(a,b)=>a.hp-b.hp,
    name:(a,b)=>a.name.localeCompare(b.name,'ja'), cls:(a,b)=>ci(a.cls)-ci(b.cls)||b.cost-a.cost }[f.sort];
  return by?[...list].sort((a,b)=>by(a,b)||UNITS.indexOf(a)-UNITS.indexOf(b)):list;
}
function rosterTilesHTML(view){
  const picks=G.picks[G.setupPid], list=rosterList();
  if(!list.length) return `<p class="sub rempty">条件に合う${TERMS.unit}がいません。<button data-ui="rosterReset">絞り込みを解除</button></p>`;
  return list.map(d=>{
    const i=picks.indexOf(d.id), sel=i>=0, over=rosterOver(d);
    return `<button class="tile ${sel?'sel':''} ${over?'dim':''} ${view&&view.id===d.id?'viewing':''}" data-a="setupToggle" data-id="${esc(d.id)}" data-view="${esc(d.id)}">
      ${unitImg(d,'face','pimg',d.name)}${clsIconTag(d.cls,'pcls')}
      <span class="tcost">C${d.cost}</span>${sel?`<span class="order">${i+1}</span>`:''}
      <span class="tname">${esc(d.name)}<small>${esc(d.cls)} ・ HP${d.hp}</small></span></button>`;
  }).join('');
}
function rosterFilterHTML(){
  const f=UI.roster;
  const clss=[...new Set(UNITS.map(d=>d.cls))].sort((a,b)=>(CLASSES.indexOf(a)+1||99)-(CLASSES.indexOf(b)+1||99));
  const costs=[...new Set(UNITS.map(d=>d.cost))].sort((a,b)=>a-b);
  const chip=(v,label,body)=>`<button class="rchip ${f.cls===v?'on':''}" data-ui="rosterCls" data-v="${esc(v)}" title="${esc(label)}">${body}</button>`;
  const n=rosterList().length;
  return `<div class="rfilter">
    <div class="rcls">${chip('','すべてのクラス','全')}${clss.map(c=>chip(c,c,`<img src="${esc(classIcon(c))}" alt="${esc(c)}">`)).join('')}</div>
    <div class="rrow2">
      <input type="search" class="rq" data-uif="q" placeholder="名前・クラスで検索" value="${esc(f.q)}">
      <select data-uif="cost" title="コストで絞り込み"><option value="">コスト：すべて</option>${costs.map(c=>`<option value="${c}" ${String(c)===f.cost?'selected':''}>コスト ${c}</option>`).join('')}</select>
      <select data-uif="sort" title="並べ替え">${Object.entries(ROSTER_SORTS).map(([k,v])=>`<option value="${k}" ${f.sort===k?'selected':''}>${v}</option>`).join('')}</select>
      ${ruleset().partyMax>1?`<label class="rok"><input type="checkbox" data-uif="ok" ${f.ok?'checked':''}>編成できるものだけ</label>`:''}
      <span class="sub small rcount">${n} / ${UNITS.length}騎</span>
    </div>
  </div>`;
}
// 絞り込みを変えたら一覧だけ描き直す（検索欄の入力中にフォーカスを失わないように）
function redrawRoster(){
  const r=document.querySelector('.roster'); if(!r){ render(); return; }
  const picks=G.picks[G.setupPid];
  r.innerHTML=rosterTilesHTML(D(UI.setupView)||D(picks[picks.length-1])||UNITS[0]);
  const c=document.querySelector('.rcount'); if(c) c.textContent=`${rosterList().length} / ${UNITS.length}騎`;
}
function onRosterField(e){
  const el=e.target.closest('[data-uif]'); if(!el) return;
  const k=el.dataset.uif; UI.roster[k]=el.type==='checkbox'?el.checked:el.value;
  redrawRoster();
}
document.addEventListener('input',onRosterField);
document.addEventListener('change',e=>{ if(e.target.matches('select[data-uif],input[type=checkbox][data-uif]')) onRosterField(e); });

// シンプルルール：相手のコストとハンデの説明
function handicapNote(pid){
  const opp=G.picks[1-pid][0]; if(!opp||pid===0) return '同コストどうしが公平です。';
  const rs=ruleset(), h=G.handicap&&rs.handicapAsc;
  return `相手はコスト${D(opp).cost}。${h?`コスト差${rs.handicapAsc}以上なら低い方が${TERMS.ascFull}済みで開始します。`:''}`;
}
// ---------- モード選択 ----------
function modeHTML(){
  const src = UNIT_SOURCE==='custom'
    ? `<p class="datainfo">ペンシルエディタで作ったデータ（${UNITS.length}騎）を使っています。<button data-a="useDefaultData">標準データに戻す</button></p>`
    : UNIT_BROKEN ? `<p class="datainfo warn">エディタのデータにエラーがあったため、標準データを使っています。</p>` : '';
  const show=UNITS.slice(0,7).map((d,i)=>`<div class="showtile" style="--i:${i}">${unitImg(d,'face','pimg',d.name)}${clsIconTag(d.cls,'pcls')}</div>`).join('');
  return `<div class="mode">
    <div class="title"><small>Fate fan-made pencil battle</small><h2>PENCIL DUEL</h2></div>
    <div class="showcase">${show}</div>
    ${src}
    <div class="rules">
      <span class="rlabel">ルール</span>
      ${Object.entries(RULESETS).map(([k,r])=>`<button class="${G.rule===k?'on':''}" data-a="setRule" data-rule="${k}">${esc(r.name)}</button>`).join('')}
      ${ruleset().handicapAsc?`<button class="hcap ${G.handicap?'on':''}" data-a="toggleHandicap" title="コスト差${ruleset().handicapAsc}以上なら、低コスト側が最初から${TERMS.ascFull}済み">ハンデ戦：${G.handicap?'ON':'OFF'}</button>`:''}
      <p class="sub small">${esc(ruleset().desc)}</p>
    </div>
    <div class="modes">
      <div class="card"><h3>CPU戦</h3>
        <p class="sub">あなたとCPUの${ruleset().partyMax===1?TERMS.unit:'パーティ'}を選んで、1対1で戦います（CPUはおまかせも選べます）。</p>
        <p class="sub small">よわい：スキルや攻撃対象をほぼ気まぐれに選ぶ<br>ふつう：状況を見てスキル・行動配分・攻撃対象を選ぶ</p>
        <div class="row mt"><button data-a="chooseMode" data-mode="cpu" data-level="easy">よわい</button><button class="primary" data-a="chooseMode" data-mode="cpu" data-level="normal">ふつう</button></div></div>
      <div class="card"><h3>2人対戦</h3>
        <p class="sub">同じ画面で交代しながら遊びます。</p>
        <div class="row mt"><button class="primary" data-a="chooseMode" data-mode="pvp">はじめる</button></div></div>
    </div></div>`;
}

// ---------- 描画 ----------
function render(){
  const app=document.querySelector('#app'), hinfo=document.querySelector('#hinfo'), spd=document.querySelector('#spd'), lb=document.querySelector('#logbtn'), ab=document.querySelector('#autobtn');
  const screen=G.phase==='mode'?'mode':G.phase==='setup'?'setup':'battle';
  document.body.dataset.screen=screen;
  document.body.dataset.phase=G.phase;
  if(G.phase!=='over'){ UI.result=false; UI.resultShown=false; UI.endReady=false; }
  document.body.classList.toggle('lock',cpuActing());
  spd.hidden=!(G.mode==='cpu'&&G.phase!=='mode');
  spd.textContent=`CPU速度：${G.speed<500?'速い':'普通'}`;
  lb.hidden=screen!=='battle'||UI.log;
  ab.hidden=screen!=='battle';
  ab.textContent=`オート：${UI.auto?'ON':'OFF'}`; ab.classList.toggle('on',UI.auto);
  document.body.classList.toggle('menuopen',UI.menu);
  document.querySelector('#menubtn').setAttribute('aria-expanded',UI.menu?'true':'false');
  if(screen==='mode'){ app.innerHTML=modeHTML(); hinfo.textContent=''; }
  else if(screen==='setup'){ app.innerHTML=setupHTML(); hinfo.textContent=ruleset().partyMax===1?`${ruleset().name}ルール ・ ${TERMS.unit}選択`:'パーティ編成'; }
  else {
    if(UI.detail&&!U(UI.detail)) UI.detail=null;
    app.innerHTML=`<div class="battle ${UI.log?'':'nolog'}"><main class="field">${sideHTML(1,'top')}${stageHTML()}${sideHTML(0,'bottom')}</main>${UI.log?logHTML():''}</div>${UI.detail?detailModalHTML():''}${UI.result&&G.phase==='over'?resultHTML():''}`;
    hinfo.textContent=`${ruleset().npWin?`${ruleset().name}ルール ・ `:''}ターン${G.turn}`;
    const l=document.querySelector('#log'); if(l) l.scrollTop=l.scrollHeight;
    animateLane();
  }
  scheduleCpu();
  scheduleAuto();
  fxKick();
}

// ---------- オート進行 ----------
// 選ぶ余地がない操作（ロールするだけ・決定するだけ）を、オートONのとき自動で押す。
// 人の手番だけ。act() を通すので、手で押したのと同じ扱い
const AUTO_DELAY=550;
let autoTimer=null;
function hasSkillChoice(){
  return alive(G.cur).some(u=>canSkill(u)&&D(u.def).skills.some((s,i)=>!u.used[i]&&(i<2||u.asc)&&s.eff.length))
      || (ultManual()&&!G.ult&&alive(G.cur).some(u=>canUlt(u)&&u.np>=RULES.ultCost));
}
function autoMove(){
  if(!UI.auto||cpuActing()||UI.detail||G.pending||G.copy) return null;
  switch(G.phase){
    case 'actRoll':
      if(!G.actRolled) return ['rollActs'];
      // 全員を最大まで行動させても上限以内なら、配分を選ぶ余地はない
      return Object.values(G.maxActs).reduce((a,b)=>a+b,0)<=RULES.actionsMax ? ['confirmAlloc'] : null;
    case 'skill': return hasSkillChoice()?null:['skillDone'];
    case 'action': {
      const uid=Object.keys(G.alloc).find(id=>!U(id).out&&G.rolled.filter(r=>r.uid===id).length<G.alloc[id]);
      return uid?['rollAction',{uid}]:['toTarget'];
    }
    case 'target': return (G.targetAll||targetCandidates().length===1)&&G.target ? ['resolve'] : null;
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
    case 'toggleLog': UI.log=!UI.log; savePref('pencilduel.logOpen',UI.log?'1':'0'); break;
    case 'toggleAuto': UI.auto=!UI.auto; savePref('pencilduel.auto',UI.auto?'1':'0'); break;
    case 'toggleMenu': UI.menu=!UI.menu; break;
    case 'rosterCls': UI.roster.cls=ds.v; break;
    case 'rosterReset': UI.roster={...UI.roster, cls:'', cost:'', q:'', ok:false}; break;
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
