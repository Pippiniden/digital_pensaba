'use strict';
/* =====================================================================
   ゲームエンジン：状態(G)とルール処理
   - 状態はすべて G に集約し、操作は act(type, payload) だけで変化する
     → オンライン化(PeerJS)時は「ゲスト→ホストへ {type,payload} を送信、
        ホストが act() を実行して G をブロードキャスト」で載せ替え可能
   ===================================================================== */

let UNITS=[], UNIT_SOURCE='default', UNIT_BROKEN=false;
function reloadUnits(){ const r=loadUnits(); UNITS=r.units; UNIT_SOURCE=r.source; UNIT_BROKEN=!!r.broken; }
reloadUnits();

let G;
function newGame(){
  G = { phase:'mode', mode:null, cpu:[false,false], level:'normal', speed:700, seed:String(Math.random()),
    setupPid:0, picks:[[],[]], setupMsg:'',
    players:[{name:TERMS.player+'1',party:[],stars:0},{name:TERMS.player+'2',party:[],stars:0}],
    cur:0, turn:0, actRolled:false, maxActs:{}, alloc:{}, rolled:[], ult:null, target:null,
    gen:0, pending:null, copy:null, log:[], winner:null };
  FXQ.length=0; for(const k in FXHOLD) delete FXHOLD[k];
}

// ---------- 演出イベント ----------
// セリフ・ダメージ表示・宝具カットインを FXQ に積み、画面側（fx.js）が順番に再生する。ルール処理には影響しない
const FXQ=[];
// 表示用のHP：ダメージ演出が再生されるまで、画面には攻撃前のHPを出しておく（{uid:{hp,out}}）。
// fx.js がダメージ演出を1つ再生するたびに更新し、そのユニットの演出が無くなったら消す
const FXHOLD={};
function fxEmit(ev){
  if(ev.t==='dmg'&&ev.hp!=null&&!(ev.uid in FXHOLD)) FXHOLD[ev.uid]={hp:ev.hp0,out:false};
  FXQ.push(ev);
}
function say(u,key){ const t=pickLine(D(u.def),key); if(t) fxEmit({t:'say',uid:u.uid,key,text:t}); }

// ---------- ヘルパー ----------
const D = id=>UNITS.find(u=>u.id===id);
const ALL = ()=>[...G.players[0].party,...G.players[1].party];
const U = uid=>ALL().find(u=>u.uid===uid);
const alive = pid=>G.players[pid].party.filter(u=>!u.out);
const roll = ()=>Math.floor(Math.random()*6);       // 面index(0-5)、出目は+1
const has = (u,k)=>u.fx.some(e=>e.k===k);
const disabled = u=>has(u,'stun')||has(u,'charm');           // 行動・スキル・宝具すべて不可
const canSkill = u=>!u.out&&!disabled(u)&&!has(u,'sealSkill');
const canUlt = u=>!u.out&&!disabled(u)&&!has(u,'sealUlt');
const fmt = n=>Number.isInteger(n)?n:Math.round(n*10)/10;
const dn = u=>esc(D(u.def).name);
const nm = u=>`<span class="p${u.pid}">${dn(u)}</span>`;
const log = (msg,cls='')=>G.log.push({msg,cls});
const sumCost = ids=>ids.reduce((s,id)=>s+D(id).cost,0);
const totalAlloc = ()=>Object.values(G.alloc).reduce((a,b)=>a+b,0);
const remainingRolls = ()=>Object.entries(G.alloc).reduce((s,[uid,n])=>U(uid).out?s:s+n-G.rolled.filter(r=>r.uid===uid).length,0);
function makeUnit(pid,idx,id){ return {uid:`p${pid}u${idx}`,pid,idx,def:id,hp:D(id).hp,np:0,asc:false,out:false,used:[false,false,false],fx:[],face:null}; }
function targetCandidates(){ const es=alive(1-G.cur); const t=es.filter(u=>has(u,'taunt')); return t.length?t:es; }
function pendingSkill(){ return G.pending ? D(U(G.pending.uid).def).skills[G.pending.si] : null; }
function pickValid(u){
  const s=pendingSkill(); if(!s||u.out) return false;
  if(s.pick==='ally') return u.pid===G.cur;
  if(s.pick==='enemy') return u.pid!==G.cur;
  return true;
}
function mods(u,k,color){
  const list=u.fx.filter(e=>e.k===k && (!color || !e.color || e.color===color));
  return {sum:list.reduce((s,e)=>s+e.v,0), list};
}
function consume(u,list){
  list.forEach(e=>{ if(e.times!=null) e.times--; });
  u.fx=u.fx.filter(e=>e.times==null||e.times>0);
}
const dotVal = e=>e.v||RULES.dot; // 毒・やけどの値（0は旧データなので RULES.dot）
function addNp(u,v){ if(!u.out) u.np=Math.max(0,Math.min(RULES.gaugeMax,u.np+v)); }

// =====================================================================
// 効果の適用
// =====================================================================
function resolveTargets(src,t,picked){
  let ts=[];
  if(t==='self') ts=[src];
  else if(t==='picked') ts=picked?[picked]:[];
  else if(t==='ally_all') ts=alive(src.pid);
  else if(t==='enemy_all') ts=alive(1-src.pid);
  else if(t==='target') ts=G.target?[U(G.target)]:[];
  return ts.filter(u=>u&&!u.out);
}
function applyEffects(src,effs,picked){
  for(const e of effs){
    if(e.chance){
      const r=roll()+1, ok=r<=e.chance;
      log(`判定ロール（${dn(src)}）出目${r} ≤ ${e.chance} → ${ok?'成功':'失敗'}`, ok?'':'sub');
      if(!ok) continue;
    }
    if(e.t==='master'){
      if(e.k==='star'||e.k==='starLoss') changeStars(src.pid,e.k==='star'?e.v:-e.v);
      continue;
    }
    resolveTargets(src,e.t,picked).forEach(t=>applyOne(src,t,e));
  }
}
function changeStars(pid,v){
  const P=G.players[pid]; P.stars=Math.max(0,P.stars+v);
  log(`${esc(P.name)}：${TERMS.star}${Math.abs(v)}個${v>=0?'獲得':'消失'}`, v>=0?'':'bad');
}
// 強化無効・弱体無効で防がれたら true（防いだ効果に回数があれば1減らす）
function immuneTo(t,k){
  const b=FX[k].buff;
  let guard=b===true?'buffImmune':b===false?'debuffImmune':null;
  if(FX[k].mental&&!t.fx.some(x=>x.k===guard)&&t.fx.some(x=>x.k==='mentalImmune')) guard='mentalImmune';
  const g=guard&&t.fx.find(x=>x.k===guard); if(!g) return false;
  consume(t,[g]); log(`${nm(t)}は${FX[guard].name}で「${FX[k].name}」を防いだ`,'sub');
  return true;
}
function retreat(u){ u.hp=0; u.out=true; u.fx=[]; log(`${nm(u)} 撤退`,'bad'); say(u,'defeat'); }
function applyOne(src,t,e){
  const d=D(t.def);
  if(immuneTo(t,e.k)) return;
  switch(e.k){
    case 'heal': t.hp=Math.min(d.hp,t.hp+e.v); log(`${nm(t)} HP${e.v}回復`,'good'); return;
    case 'np': addNp(t,e.v); log(`${nm(t)} ${TERMS.gauge}${e.v>=0?'+':''}${e.v}%`); return;
    case 'star': changeStars(t.pid,e.v); return;
    case 'starLoss': changeStars(t.pid,-e.v); return;
    case 'cleanse': t.fx=t.fx.filter(x=>FX[x.k].buff!==false); log(`${nm(t)}の弱体を解除`,'good'); return;
    case 'cleanseMental': t.fx=t.fx.filter(x=>!FX[x.k].mental); log(`${nm(t)}の精神異常を解除`,'good'); return;
    case 'strip': t.fx=t.fx.filter(x=>FX[x.k].buff!==true); log(`${nm(t)}の強化を解除`,'bad'); return;
    case 'instantDeath': log(`${nm(t)}に即死効果`,'bad'); fxEmit({t:'dmg',uid:t.uid,text:FX.instantDeath.name,hp0:t.hp,hp:0,out:true}); retreat(t); return;
    case 'dmg': return; // 宝具側で処理
  }
  if(e.k==='guts') t.fx=t.fx.filter(x=>x.k!=='guts'); // ガッツは重複不可
  if(e.k==='curse'){ // 呪いは回数のみ。重ねると回数が増える
    const n=e.times||1, c=t.fx.find(x=>x.k==='curse');
    if(c){ c.times+=n; log(`${nm(t)}の呪いが${c.times}回に`,'bad'); return; }
    const inst={k:'curse',v:0,color:null,turns:null,times:n,owner:src.pid};
    t.fx.push(inst); log(`${nm(t)}に ${fxText(inst)}`,'bad'); return;
  }
  const inst={k:e.k,v:e.v,color:e.color||null,turns:e.turns??null,times:e.times??null,owner:src.pid};
  t.fx.push(inst);
  log(`${nm(t)}に ${fxText(inst)}`, FX[e.k].buff?'good':'bad');
}

// =====================================================================
// ダメージ処理
// =====================================================================
// x以下のダメージ無効：最終ダメージが値以下なら true
const nullified=(tgt,dmg)=>{ const v=Math.max(0,...tgt.fx.filter(e=>e.k==='nullUnder').map(e=>e.v)); return v>0&&dmg<=v?v:0; };
function blocked(att,tgt){
  if(has(att,'pierce')) return null;
  let e=tgt.fx.find(x=>x.k==='invul');
  if(!e && !has(att,'sureHit')) e=tgt.fx.find(x=>x.k==='evade');
  if(!e) return null;
  consume(tgt,[e]);
  return FX[e.k].name;
}
function dealDamage(u,dmg,isHit,o={}){
  if(u.out) return;
  const hp0=u.hp, g=hp0-dmg<=0?u.fx.find(e=>e.k==='guts'):null;
  const hp1=hp0-dmg<=0?(g?g.v:0):hp0-dmg;
  fxEmit({t:'dmg',uid:u.uid,v:fmt(dmg),crit:!!o.crit,np:!!o.np,hp0,hp:hp1,out:hp0-dmg<=0&&!g});
  u.hp-=dmg;
  if(u.hp<=0){
    if(g){ u.hp=g.v; u.fx=u.fx.filter(e=>e!==g); log(`${nm(u)} ガッツ発動！ HP${g.v}で踏みとどまった`,'good'); }
    else { retreat(u); return; }
  }
  if(isHit){
    const c=u.fx.find(e=>e.k==='curse');
    if(c){ consume(u,[c]); log(`${nm(u)}は呪いで${TERMS.gauge}が増えない`,'sub'); }
    else addNp(u,RULES.gaugeOnHit);
  }
}
// 攻撃側の補正（被ダメージ減少無視なら相手の def を見ない）。使った効果も返す
function dmgMods(att,tgt,color){
  const a=mods(att,'atk',color), ad=mods(att,'atkDown');
  let sum=a.sum-ad.sum; const usedA=[...a.list,...ad.list], usedT=[];
  if(tgt&&!tgt.out){
    const dd=mods(tgt,'defDown'); sum+=dd.sum; usedT.push(...dd.list);
    const ig=att.fx.find(e=>e.k==='ignoreDef');
    if(ig){ if(mods(tgt,'def').list.length) usedA.push(ig); }
    else { const df=mods(tgt,'def'); sum-=df.sum; usedT.push(...df.list); }
  }
  // 色指定のある攻撃ダメージ+（色バフ）の合計：クリティカルで2倍
  const colorBuff=a.list.filter(e=>e.color).reduce((s,e)=>s+e.v,0);
  return {sum, usedA, usedT, colorBuff};
}
function gainNpStar(att,cmd,mult){
  if(cmd.np) addNp(att,cmd.np*mult);
  if(cmd.star) G.gen+=cmd.star*mult;
}
// ---------- 他のサーヴァントをロール（copyRoll） ----------
const isCopyCmd = c=>!!c&&c.c==='W'&&(c.eff||[]).some(e=>e.k==='copyRoll');
const copyCands = u=>G.players.flatMap(P=>P.party).filter(x=>!x.out&&x.uid!==u.uid);
// 選んだサーヴァントの鉛筆をロールし、再臨後コマンドを返す（同じ特殊行動が出たら振り直し）
function copyRollFrom(src){
  const d=D(src.def); let f, c;
  for(let i=0;i<20;i++){ f=roll(); c=d.faces[f].post; if(!isCopyCmd(c)) break; }
  if(isCopyCmd(c)) c={c:'W',label:'不発',eff:[],np:0,star:0,dmg:0};
  return {f, cmd:{...c, from:d.name}};
}
function doCopy(uid,src){
  const r=G.rolled[G.copy.idx], u=U(uid);
  const {f,cmd}=copyRollFrom(src);
  r.cmd=cmd; u.face={i:r.f,kind:'cmd',cmd};
  log(`${nm(u)}：${nm(src)}の鉛筆をロール 出目${f+1} → ${cmdChip(cmd)}`);
  G.copy=null;
}
function resolveCommand(att,cmd,tgt,o={}){
  const n=nm(att);
  if(cmd.c==='ASC'){ log(`${n}：${TERMS.ascFull}（1行動）`,'sub'); return; }
  if(isCopyCmd(cmd)){ // エクストラアタックで出たときは対象をランダムに選んで、その場でロール
    const cs=copyCands(att); if(!cs.length) return;
    const src=cs[Math.floor(Math.random()*cs.length)], r=copyRollFrom(src);
    log(`${n}：${nm(src)}の鉛筆をロール 出目${r.f+1} → ${cmdChip(r.cmd)}`);
    return resolveCommand(att,r.cmd,tgt,o);
  }
  if(cmd.c==='W'){
    log(`${n}：特殊行動「${esc(cmd.label)}」${cmd.from?`（${esc(cmd.from)}）`:''}`);
    applyEffects(att,cmd.eff||[],null);
    if(!(cmd.dmg>0)){ gainNpStar(att,cmd,1); return; }
    // ダメージを持つ特殊行動は無属性の攻撃として続けて処理する（チェインには数えない）
  }
  say(att,'attack');
  let dmg=cmd.dmg; const note=[`基本${dmg}`]; let usedA=[], usedT=[], colorBuff=0;
  // 2. スキル効果補正 / 3. Busterチェイン
  if(!o.extra){
    const m=dmgMods(att,tgt,cmd.c); usedA=m.usedA; usedT=m.usedT; colorBuff=m.colorBuff;
    if(m.sum){ dmg=Math.max(0,dmg+m.sum); note.push(`補正${m.sum>0?'+':''}${m.sum}`); }
    if(o.chain==='R'){ dmg+=RULES.chainR; note.push(`チェイン+${RULES.chainR}`); }
  } else note.push('エクストラ：補正なし');
  // 4. クリティカル（クラス相性はなし）：スターがあれば1d100で判定。成功でダメージ+30（Buster+60）、色バフ2倍
  let crit=false;
  if(!o.extra){
    const st=G.players[att.pid].stars;
    if(st>0){
      const cr=mods(att,'critRoll'), lv=Math.min(CRIT_TABLE.length,critLevel(st)+cr.sum), p=critChance(lv);
      const r=Math.floor(Math.random()*100)+1;
      crit=r<=p; consume(att,cr.list);
      note.push(`クリ判定 Lv${lv}(${p}%) 出目${r} ${crit?'成功':'失敗'}`);
    }
    if(crit){
      const cp=mods(att,'critPow'), add=(cmd.c==='R'?RULES.critDmgR:RULES.critDmg)+cp.sum+colorBuff;
      dmg+=add; note.push(`クリ+${add}${colorBuff?`(色バフ+${colorBuff}含む)`:''}`); consume(att,cp.list);
    }
  }
  // 6. 最終ダメージ（クリティカルとオーバーキルは重複：獲得NP・発生スターがそれぞれ2倍）
  const mult=(crit?2:1)*(tgt.out?2:1);
  if(tgt.out){
    log(`${n} ${cmdChip(cmd)} → オーバーキル（${TERMS.gauge}・${TERMS.star}${mult}倍）`);
  } else {
    const b=blocked(att,tgt);
    if(b){ log(`${n} ${cmdChip(cmd)} → ${nm(tgt)}：${b}で無効 <span class="sub">(${note.join(' / ')})</span>`); fxEmit({t:'dmg',uid:tgt.uid,text:b}); }
    else if(nullified(tgt,dmg)){ log(`${n} ${cmdChip(cmd)} → ${nm(tgt)}：${fmt(dmg)}ダメージは${nullified(tgt,dmg)}以下なので無効 <span class="sub">(${note.join(' / ')})</span>`); fxEmit({t:'dmg',uid:tgt.uid,text:'無効'}); consume(tgt,usedT); }
    else { log(`${n} ${cmdChip(cmd)} → ${nm(tgt)}：<b>${fmt(dmg)}</b>ダメージ <span class="sub">(${note.join(' / ')})</span>`); consume(tgt,usedT); dealDamage(tgt,dmg,true,{crit}); }
  }
  gainNpStar(att,cmd,mult);
  consume(att,usedA);
  // 攻撃時○○（エクストラアタックでは発動しない）
  if(!o.extra){
    const s=mods(att,'onAtkStar',cmd.c), p=mods(att,'onAtkNp',cmd.c);
    if(s.sum){ G.gen+=s.sum; log(`${n} 攻撃時効果：${TERMS.star}${s.sum}個発生`,'sub'); }
    if(p.sum){ addNp(att,p.sum); log(`${n} 攻撃時効果：${TERMS.gauge}+${p.sum}%`,'sub'); }
    consume(att,[...s.list,...p.list]);
  }
  // コマンドに付いた効果（例：自身の弱体解除）。攻撃のあとに適用
  if(cmd.c!=='W'&&cmd.eff&&cmd.eff.length) applyEffects(att,cmd.eff,null); // 特殊行動の効果は冒頭で適用済み
}
function resolveUlt(u,tgt){
  const ud=D(u.def).ult;
  log(`${nm(u)}の${TERMS.ult}「${esc(ud.name)}」！`,'good');
  fxEmit({t:'cutin',uid:u.uid,title:ud.name,col:ud.c});
  say(u,'np');
  for(const e of ud.eff){
    if(e.k!=='dmg'){ applyEffects(u,[e],null); continue; }
    const ts = e.t==='enemy_all' ? alive(1-u.pid) : [tgt].filter(x=>x&&!x.out);
    const usedA=new Set();
    for(const t of ts){
      const m=dmgMods(u,t,ud.c); m.usedA.forEach(x=>usedA.add(x));
      let dmg=Math.max(0,e.v+m.sum);
      const b=blocked(u,t);
      if(b){ log(`→ ${nm(t)}：${b}で無効`); fxEmit({t:'dmg',uid:t.uid,text:b}); }
      else if(nullified(t,dmg)){ log(`→ ${nm(t)}：${fmt(dmg)}ダメージは${nullified(t,dmg)}以下なので無効`); fxEmit({t:'dmg',uid:t.uid,text:'無効'}); consume(t,m.usedT); }
      else { log(`→ ${nm(t)}：<b>${fmt(dmg)}</b>ダメージ`); consume(t,m.usedT); dealDamage(t,dmg,true,{np:true}); if(!t.out) say(t,'npDamage'); }
    }
    consume(u,[...usedA]);
  }
}
function resolveDamage(){
  const tgt=U(G.target);
  log(`⑥ ダメージフェイズ（攻撃対象：${nm(tgt)}）`,'h');
  if(G.ult){ resolveUlt(U(G.ult),tgt); }
  else {
    const hp0=tgt.hp;
    const acts=G.rolled, cols=acts.map(a=>a.cmd.c);
    const chain = acts.length===3 && ['R','B','G'].includes(cols[0]) && cols.every(c=>c===cols[0]) ? cols[0] : null;
    if(chain) log(`${TERMS[chain]}チェイン発生！`,'good');
    acts.forEach(a=>resolveCommand(U(a.uid),a.cmd,tgt,{chain}));
    if(chain==='B'){ [...new Set(acts.map(a=>a.uid))].map(U).forEach(u=>addNp(u,RULES.chainB)); log(`チェインボーナス：行動${TERMS.unit}の${TERMS.gauge}+${RULES.chainB}%`); }
    if(chain==='G'){ G.gen+=RULES.chainG; log(`チェインボーナス：${TERMS.star}${RULES.chainG}個発生`); }
    // 7. ブレイブチェイン
    if(acts.length===3 && acts.every(a=>a.uid===acts[0].uid)){
      const u=U(acts[0].uid), f=roll(), face=D(u.def).faces[f];
      log(`ブレイブチェイン！ ${nm(u)}のエクストラアタック（出目${f+1}）`,'good');
      if(!u.asc && face.pre.c==='ASC'){ ascend(u); u.face={i:f,kind:'cmd',cmd:face.pre}; }
      else { const cmd=u.asc?face.post:face.pre; u.face={i:f,kind:'cmd',cmd}; resolveCommand(u,cmd,tgt,{extra:true}); }
    }
    if(!tgt.out && tgt.hp<hp0) say(tgt,'damage');
  }
  checkWin();
  if(G.winner==null) G.phase='end';
}
function ascend(u){ u.asc=true; log(`${nm(u)} ${TERMS.ascFull}！ 以降は${TERMS.asc}後コマンド、スキル3解放`,'good'); }

// =====================================================================
// ターン進行
// =====================================================================
function startGame(){
  G.players.forEach((P,pid)=>{ P.party=G.picks[pid].map((id,i)=>makeUnit(pid,i,id)); P.stars=0; });
  log('先攻・後攻の決定','h');
  let r0,r1;
  do{
    r0=roll(); r1=roll();
    const a=G.players[0].party[0], b=G.players[1].party[0];
    a.face={i:r0,kind:'die'}; b.face={i:r1,kind:'die'};
    log(`${nm(a)} 出目${r0+1} ／ ${nm(b)} 出目${r1+1}${r0===r1?'（同値・振り直し）':''}`);
  } while(r0===r1);
  G.cur=r0>r1?0:1; G.turn=1;
  log(`${esc(G.players[G.cur].name)} が先攻`,'good');
  [G.cur,1-G.cur].forEach(pid=>say(G.players[pid].party[0],'start'));
  beginTurn();
}
function beginTurn(){
  Object.assign(G,{phase:'actRoll',actRolled:false,maxActs:{},alloc:{},rolled:[],ult:null,target:null,gen:0,pending:null,copy:null});
  log(`━ ターン${G.turn}：${esc(G.players[G.cur].name)} ━`,'h');
  // ① ターン開始：このプレイヤーが付与した効果の残りターン-1
  ALL().forEach(u=>{
    u.fx.forEach(e=>{ if(e.owner===G.cur && e.turns!=null) e.turns--; });
    const ex=u.fx.filter(e=>e.turns!=null&&e.turns<=0);
    if(ex.length){ u.fx=u.fx.filter(e=>!ex.includes(e)); log(`${nm(u)}の ${ex.map(e=>FX[e.k].name).join('・')} が終了`,'sub'); }
  });
}
function endPhase(){
  log('⑦ 終了フェイズ','h');
  const pids = RULES.dotTiming==='all' ? [0,1] : [G.cur];
  // 弱体ダメージ：攻防補正・無敵・回避・クリティカルの影響なし。弱体無効で防がれる。毒・やけどはそれぞれ重複せず最大値
  pids.forEach(pid=>alive(pid).forEach(u=>{
    const top=k=>Math.max(0,...u.fx.filter(e=>e.k===k).map(dotVal));
    const ps=top('poison'), bs=top('burn')*(has(u,'spread')?2:1), ds=mods(u,'drain').sum, d=ps+bs+ds;
    if(!d) return;
    const g=u.fx.find(e=>e.k==='debuffImmune');
    if(g){ consume(u,[g]); log(`${nm(u)}は弱体無効で弱体ダメージを防いだ`,'sub'); return; }
    log(`${nm(u)} 弱体ダメージ${d}（${[ps?`毒${ps}`:'',bs?`やけど${bs}`:'',ds?`HP減少${ds}`:''].filter(Boolean).join('・')}）`,'bad');
    dealDamage(u,d,false);
  }));
  G.players[G.cur].stars=G.gen;
  log(`${esc(G.players[G.cur].name)}：${TERMS.star}を${G.gen}個獲得（次のターンに使用）`);
  checkWin(); if(G.winner!=null) return;
  G.cur=1-G.cur; G.turn++;
  beginTurn();
}
function checkWin(){
  if(alive(1-G.cur).length===0) win(G.cur);      // 同時全滅は手番側の勝ち
  else if(alive(G.cur).length===0) win(1-G.cur);
}
function win(pid){ G.winner=pid; G.phase='over'; log(`${esc(G.players[pid].name)} の勝利！`,'good'); const w=alive(pid)[0]; if(w) say(w,'win'); }
function applyMode(cfg){
  Object.assign(G,{mode:cfg.mode, level:cfg.level, cpu:cfg.cpu, speed:cfg.speed||G.speed, phase:'setup'});
  cfg.names.forEach((n,i)=>G.players[i].name=n);
}
function doSkill(u,si,picked){
  const s=D(u.def).skills[si];
  u.used[si]=true;
  log(`${nm(u)} スキル「${esc(s.name)}」`);
  say(u,'skill');
  applyEffects(u,s.eff,picked);
  checkWin(); // 即死などでスキルだけで決着することがある
}
function toTargetPhase(){
  G.phase='target'; log('⑤ 攻撃対象決定','h');
  const c=targetCandidates(); if(c.length===1) G.target=c[0].uid;
}

// =====================================================================
// 操作（すべてここを通る）
// =====================================================================
const ACTIONS = {
  restart(){ newGame(); },
  useDefaultData(){ clearCustomUnits(); reloadUnits(); newGame(); },
  chooseMode({mode,level}){
    if(G.phase!=='mode') return;
    applyMode(mode==='cpu'
      ? {mode, level:level||'normal', cpu:[false,true], names:['あなた','CPU']}
      : {mode:'pvp', level:'normal', cpu:[false,false], names:[TERMS.player+'1',TERMS.player+'2']});
  },
  rematch(){
    const cfg={mode:G.mode, level:G.level, cpu:G.cpu, speed:G.speed, names:G.players.map(p=>p.name)};
    newGame(); applyMode(cfg);
  },
  toggleSpeed(){ G.speed = G.speed>=500 ? 250 : 700; },
  setupToggle({id}){
    const pid=G.setupPid, picks=G.picks[pid], d=D(id); G.setupMsg='';
    if(!d) return;
    const i=picks.indexOf(id);
    if(i>=0){ picks.splice(i,1); return; }
    if(picks.length>=RULES.partyMax){ G.setupMsg=`最大${RULES.partyMax}体までです`; return; }
    if(sumCost(picks)+d.cost>RULES.costCap){ G.setupMsg=`コスト合計が${RULES.costCap}を超えます`; return; }
    picks.push(id);
  },
  setupRandom(){
    let best=[];
    for(let t=0;t<50;t++){
      const pool=[...UNITS].sort(()=>Math.random()-.5), p=[];
      for(const d of pool){ if(p.length<RULES.partyMax && sumCost(p)+d.cost<=RULES.costCap) p.push(d.id); }
      if(p.length>best.length) best=p;
      if(best.length===RULES.partyMax) break;
    }
    G.picks[G.setupPid]=best; G.setupMsg='';
  },
  setupCpu(){
    const pid=G.setupPid;
    if(G.level==='easy'){ ACTIONS.setupRandom(); return; }
    // コスト合計が最大になる3体の組み合わせからランダム（HPが高い順に1st）
    const combos=[];
    for(let i=0;i<UNITS.length;i++) for(let j=i+1;j<UNITS.length;j++) for(let k=j+1;k<UNITS.length;k++){
      const ids=[UNITS[i].id,UNITS[j].id,UNITS[k].id], c=sumCost(ids);
      if(c<=RULES.costCap) combos.push({ids,c});
    }
    if(!combos.length){ ACTIONS.setupRandom(); return; }
    const max=Math.max(...combos.map(x=>x.c)), top=combos.filter(x=>x.c===max);
    G.picks[pid]=top[Math.floor(Math.random()*top.length)].ids.sort((a,b)=>D(b).hp-D(a).hp);
  },
  setupConfirm(){
    if(!G.picks[G.setupPid].length) return;
    if(G.setupPid===0){ G.setupPid=1; G.setupMsg=''; } else { G.phase='init'; startGame(); }
  },
  rollActs(){
    if(G.phase!=='actRoll'||G.actRolled) return;
    log('② 行動回数決定','h');
    const bonus=G.players[G.cur].party.filter(u=>u.out).length; let left=RULES.actionsMax;
    alive(G.cur).forEach(u=>{
      let m=0;
      if(disabled(u)){ u.face=null; log(`${nm(u)}は行動不能`,'bad'); }
      else {
        const f=roll(); u.face={i:f,kind:'acts'};
        const fear=has(u,'fear')?1:0, up=mods(u,'actsUp'); consume(u,up.list);
        m=Math.max(0,Math.min(RULES.actionsMax, faceActs(D(u.def),f)+bonus+up.sum-fear));
        log(`${nm(u)} 出目${f+1} → 最大行動${m}${bonus?`（撤退ボーナス+${bonus}）`:''}${up.sum?`（最大行動回数+${up.sum}）`:''}${fear?'（恐怖-1）':''}`, m?'':'bad');
      }
      G.maxActs[u.uid]=m; const a=Math.min(m,left); G.alloc[u.uid]=a; left-=a;
    });
    G.actRolled=true;
  },
  alloc({uid,d}){
    if(G.phase!=='actRoll'||!G.actRolled) return;
    const v=(G.alloc[uid]||0)+Number(d);
    if(v<0||v>(G.maxActs[uid]||0)) return;
    if(Number(d)>0 && totalAlloc()>=RULES.actionsMax) return;
    G.alloc[uid]=v;
  },
  setAlloc({alloc}){
    if(G.phase!=='actRoll'||!G.actRolled) return;
    const a=JSON.parse(alloc); let tot=0, ok=true;
    for(const [uid,n] of Object.entries(a)){ if(n<0||n>(G.maxActs[uid]||0)) ok=false; tot+=n; }
    if(ok && tot<=RULES.actionsMax) G.alloc=a;
    const txt=Object.entries(G.alloc).filter(([,n])=>n).map(([uid,n])=>`${dn(U(uid))}×${n}`).join('、');
    log(`配分：${txt||'なし'}`,'sub');
    ACTIONS.confirmAlloc();
  },
  confirmAlloc(){ if(G.phase==='actRoll'&&G.actRolled){ G.phase='skill'; log(`③ スキル・${TERMS.ult}使用`,'h'); } },
  useSkill({uid,si}){
    si=Number(si); const u=U(uid), s=D(u.def).skills[si];
    if(G.phase!=='skill'||G.pending||u.pid!==G.cur||!canSkill(u)||u.used[si]||(si===2&&!u.asc)) return;
    if(s.pick){ G.pending={uid,si}; return; }
    doSkill(u,si,null);
  },
  cancelPick(){ G.pending=null; },
  useUlt({uid}){
    const u=U(uid);
    if(G.phase!=='skill'||G.pending||G.ult||u.pid!==G.cur||!canUlt(u)||u.np<RULES.ultCost) return;
    G.ult=uid; u.np=0;
    log(`${nm(u)}が${TERMS.ult}「${esc(D(u.def).ult.name)}」を使用（このターンの行動になります）`,'good');
  },
  skillDone(){
    if(G.phase!=='skill'||G.pending) return;
    if(G.ult) toTargetPhase();
    else { G.phase='action'; log('④ 行動決定','h'); }
  },
  rollAction({uid}){
    const u=U(uid);
    if(G.phase!=='action'||G.copy||u.out) return;
    if(G.rolled.filter(r=>r.uid===uid).length>=(G.alloc[uid]||0)) return;
    const f=roll(), face=D(u.def).faces[f];
    let cmd;
    if(!u.asc && face.pre.c==='ASC'){ cmd=face.pre; ascend(u); }
    else cmd=u.asc?face.post:face.pre;
    G.rolled.push({uid,f,cmd}); u.face={i:f,kind:'cmd',cmd};
    log(`${nm(u)} 出目${f+1} → ${cmdChip(cmd)}`);
    // 他のサーヴァントをロール：ロールするサーヴァントの選択待ち
    if(isCopyCmd(cmd) && copyCands(u).length) G.copy={idx:G.rolled.length-1, uid};
  },
  toTarget(){ if(G.phase==='action'&&!G.copy&&remainingRolls()===0) toTargetPhase(); },
  cardClick({uid}){
    const u=U(uid);
    if(G.copy){ const c=U(G.copy.uid); if(copyCands(c).includes(u)) doCopy(c.uid,u); return; }
    if(G.pending){ if(pickValid(u)){ const p=G.pending; G.pending=null; doSkill(U(p.uid),p.si,u); } return; }
    if(G.phase==='target' && targetCandidates().includes(u)) G.target=uid;
  },
  resolve(){ if(G.phase==='target'&&G.target) resolveDamage(); },
  endTurn(){ if(G.phase==='end') endPhase(); },
};
function act(type,p={}){
  if(!ACTIONS[type]) return;
  if(G.phase==='over' && !['restart','rematch','toggleSpeed','useDefaultData'].includes(type)) return;
  ACTIONS[type](p);
  render();
}
