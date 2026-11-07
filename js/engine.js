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
    gen:0, pending:null, log:[], winner:null };
}

// ---------- ヘルパー ----------
const D = id=>UNITS.find(u=>u.id===id);
const ALL = ()=>[...G.players[0].party,...G.players[1].party];
const U = uid=>ALL().find(u=>u.uid===uid);
const alive = pid=>G.players[pid].party.filter(u=>!u.out);
const roll = ()=>Math.floor(Math.random()*6);       // 面index(0-5)、出目は+1
const has = (u,k)=>u.fx.some(e=>e.k===k);
const disabled = u=>has(u,'stun')||has(u,'charm');
const fmt = n=>Number.isInteger(n)?n:Math.round(n*10)/10;
const dn = u=>esc(D(u.def).name);
const nm = u=>`<span class="p${u.pid}">${dn(u)}</span>`;
const log = (msg,cls='')=>G.log.push({msg,cls});
const sumCost = ids=>ids.reduce((s,id)=>s+D(id).cost,0);
const totalAlloc = ()=>Object.values(G.alloc).reduce((a,b)=>a+b,0);
const remainingRolls = ()=>Object.entries(G.alloc).reduce((s,[uid,n])=>s+n-G.rolled.filter(r=>r.uid===uid).length,0);
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
      if(e.k==='star'){ G.players[src.pid].stars+=e.v; log(`${esc(G.players[src.pid].name)}が${TERMS.star}${e.v}個獲得`); }
      continue;
    }
    resolveTargets(src,e.t,picked).forEach(t=>applyOne(src,t,e));
  }
}
function applyOne(src,t,e){
  const d=D(t.def);
  switch(e.k){
    case 'heal': t.hp=Math.min(d.hp,t.hp+e.v); log(`${nm(t)} HP${e.v}回復`,'good'); return;
    case 'np': addNp(t,e.v); log(`${nm(t)} ${TERMS.gauge}${e.v>=0?'+':''}${e.v}%`); return;
    case 'star': G.players[t.pid].stars+=e.v; log(`${TERMS.star}${e.v}個獲得`); return;
    case 'cleanse': t.fx=t.fx.filter(x=>FX[x.k].buff!==false); log(`${nm(t)}の弱体を解除`,'good'); return;
    case 'strip': t.fx=t.fx.filter(x=>FX[x.k].buff!==true); log(`${nm(t)}の強化を解除`,'bad'); return;
    case 'dmg': return; // 必殺技側で処理
  }
  if(e.k==='guts') t.fx=t.fx.filter(x=>x.k!=='guts'); // ガッツは重複不可
  const inst={k:e.k,v:e.v,color:e.color||null,turns:e.turns??null,times:e.times??null,owner:src.pid};
  t.fx.push(inst);
  log(`${nm(t)}に ${fxText(inst)}`, FX[e.k].buff?'good':'bad');
}

// =====================================================================
// ダメージ処理
// =====================================================================
function blocked(att,tgt){
  if(has(att,'pierce')) return null;
  let e=tgt.fx.find(x=>x.k==='invul');
  if(!e && !has(att,'sureHit')) e=tgt.fx.find(x=>x.k==='evade');
  if(!e) return null;
  consume(tgt,[e]);
  return FX[e.k].name;
}
function dealDamage(u,dmg,isHit){
  if(u.out) return;
  u.hp-=dmg;
  if(u.hp<=0){
    const g=u.fx.find(e=>e.k==='guts');
    if(g){ u.hp=g.v; u.fx=u.fx.filter(e=>e!==g); log(`${nm(u)} ガッツ発動！ HP${g.v}で踏みとどまった`,'good'); }
    else { u.hp=0; u.out=true; u.fx=[]; log(`${nm(u)} 撤退`,'bad'); return; }
  }
  if(isHit) addNp(u,RULES.gaugeOnHit);
}
function gainNpStar(att,cmd,mult){
  if(cmd.np) addNp(att,cmd.np*mult);
  if(cmd.star) G.gen+=cmd.star*mult;
}
function resolveCommand(att,cmd,tgt,o={}){
  const n=nm(att);
  if(cmd.c==='ASC'){ log(`${n}：${TERMS.asc}（1行動）`,'sub'); return; }
  if(cmd.c==='W'){ log(`${n}：特殊行動「${esc(cmd.label)}」`); applyEffects(att,cmd.eff||[],null); gainNpStar(att,cmd,1); return; }
  let dmg=cmd.dmg; const note=[`基本${dmg}`]; let usedA=[], usedT=[];
  // 2. スキル効果補正 / 3. パワーチェイン
  if(!o.extra){
    const a=mods(att,'atk',cmd.c), ad=mods(att,'atkDown');
    let mod=a.sum-ad.sum; usedA=[...a.list,...ad.list];
    if(!tgt.out){ const dd=mods(tgt,'defDown'), df=mods(tgt,'def'); mod+=dd.sum-df.sum; usedT=[...dd.list,...df.list]; }
    if(mod){ dmg=Math.max(0,dmg+mod); note.push(`補正${mod>0?'+':''}${mod}`); }
    if(o.chain==='R'){ dmg+=RULES.chainR; note.push(`チェイン+${RULES.chainR}`); }
  } else note.push('エクストラ：補正なし');
  // 4. クラス相性
  const af=affinity(D(att.def).cls,D(tgt.def).cls);
  if(af!==1){ dmg*=af; note.push(`相性×${af}`); }
  // 5. クリティカル
  let crit=false;
  if(!o.extra){
    const st=G.players[att.pid].stars;
    if(st>=30){ crit=true; note.push('確定クリ'); }
    else if(st>0){
      const r=roll()+1, m=mods(att,'critRoll').sum, th=critThreshold(st);
      crit=(r-m)<=th; note.push(`クリ判定 ${r}${m?`-${m}`:''}≤${th} ${crit?'成功':'失敗'}`);
    }
    if(crit){ const cp=mods(att,'critPow'); const x=cp.list.length?Math.max(...cp.list.map(e=>e.v)):2; dmg*=x; note.push(`クリ×${x}`); consume(att,cp.list); }
  }
  // 6. 最終ダメージ
  const mult=(crit||tgt.out)?2:1;
  if(tgt.out){
    log(`${n} ${cmdChip(cmd)} → オーバーキル（${TERMS.gauge}・${TERMS.star}2倍）`);
  } else {
    const b=blocked(att,tgt);
    if(b) log(`${n} ${cmdChip(cmd)} → ${nm(tgt)}：${b}で無効 <span class="sub">(${note.join(' / ')})</span>`);
    else { log(`${n} ${cmdChip(cmd)} → ${nm(tgt)}：<b>${fmt(dmg)}</b>ダメージ <span class="sub">(${note.join(' / ')})</span>`); consume(tgt,usedT); dealDamage(tgt,dmg,true); }
  }
  gainNpStar(att,cmd,mult);
  consume(att,usedA);
}
function resolveUlt(u,tgt){
  const ud=D(u.def).ult;
  log(`${nm(u)}の${TERMS.ult}「${esc(ud.name)}」！`,'good');
  for(const e of ud.eff){
    if(e.k!=='dmg'){ applyEffects(u,[e],null); continue; }
    const ts = e.t==='enemy_all' ? alive(1-u.pid) : [tgt].filter(x=>x&&!x.out);
    const a=mods(u,'atk',ud.c), ad=mods(u,'atkDown');
    for(const t of ts){
      const dd=mods(t,'defDown'), df=mods(t,'def');
      let dmg=Math.max(0,e.v+a.sum-ad.sum+dd.sum-df.sum);
      dmg*=affinity(D(u.def).cls,D(t.def).cls);
      const b=blocked(u,t);
      if(b) log(`→ ${nm(t)}：${b}で無効`);
      else { log(`→ ${nm(t)}：<b>${fmt(dmg)}</b>ダメージ`); consume(t,[...dd.list,...df.list]); dealDamage(t,dmg,true); }
    }
    consume(u,[...a.list,...ad.list]);
  }
}
function resolveDamage(){
  const tgt=U(G.target);
  log(`⑥ ダメージフェイズ（攻撃対象：${nm(tgt)}）`,'h');
  if(G.ult){ resolveUlt(U(G.ult),tgt); }
  else {
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
  }
  checkWin();
  if(G.winner==null) G.phase='end';
}
function ascend(u){ u.asc=true; log(`${nm(u)} ${TERMS.asc}！ 以降は${TERMS.asc}後コマンド、スキル3解放`,'good'); }

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
  beginTurn();
}
function beginTurn(){
  Object.assign(G,{phase:'actRoll',actRolled:false,maxActs:{},alloc:{},rolled:[],ult:null,target:null,gen:0,pending:null});
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
  pids.forEach(pid=>alive(pid).forEach(u=>{
    let d=0;
    if(has(u,'poison')) d+=RULES.dot;
    if(has(u,'burn')) d+=RULES.dot;
    d+=RULES.dot*u.fx.filter(e=>e.k==='curse').length;
    if(d){ log(`${nm(u)} 状態異常で${d}ダメージ`,'bad'); dealDamage(u,d,false); }
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
function win(pid){ G.winner=pid; G.phase='over'; log(`${esc(G.players[pid].name)} の勝利！`,'good'); }
function applyMode(cfg){
  Object.assign(G,{mode:cfg.mode, level:cfg.level, cpu:cfg.cpu, speed:cfg.speed||G.speed, phase:'setup'});
  cfg.names.forEach((n,i)=>G.players[i].name=n);
}
function doSkill(u,si,picked){
  const s=D(u.def).skills[si];
  u.used[si]=true;
  log(`${nm(u)} スキル「${esc(s.name)}」`);
  applyEffects(u,s.eff,picked);
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
        m=Math.min(RULES.actionsMax, D(u.def).faces[f].acts+bonus);
        log(`${nm(u)} 出目${f+1} → 最大行動${m}${bonus?`（撤退ボーナス+${bonus}）`:''}`);
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
    if(G.phase!=='skill'||G.pending||u.pid!==G.cur||u.out||disabled(u)||u.used[si]||(si===2&&!u.asc)) return;
    if(s.pick){ G.pending={uid,si}; return; }
    doSkill(u,si,null);
  },
  cancelPick(){ G.pending=null; },
  useUlt({uid}){
    const u=U(uid);
    if(G.phase!=='skill'||G.pending||G.ult||u.pid!==G.cur||u.out||disabled(u)||u.np<RULES.ultCost) return;
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
    if(G.phase!=='action'||u.out) return;
    if(G.rolled.filter(r=>r.uid===uid).length>=(G.alloc[uid]||0)) return;
    const f=roll(), face=D(u.def).faces[f];
    let cmd;
    if(!u.asc && face.pre.c==='ASC'){ cmd=face.pre; ascend(u); }
    else cmd=u.asc?face.post:face.pre;
    G.rolled.push({uid,f,cmd}); u.face={i:f,kind:'cmd',cmd};
    log(`${nm(u)} 出目${f+1} → ${cmdChip(cmd)}`);
  },
  toTarget(){ if(G.phase==='action'&&remainingRolls()===0) toTargetPhase(); },
  cardClick({uid}){
    const u=U(uid);
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
