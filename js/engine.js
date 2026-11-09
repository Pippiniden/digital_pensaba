'use strict';
/* =====================================================================
   ゲームエンジン：状態(G)とルール処理
   - 状態はすべて G に集約し、操作は act(type, payload) だけで変化する
     → オンライン化(PeerJS)時は「ゲスト→ホストへ {type,payload} を送信、
        ホストが act() を実行して G をブロードキャスト」で載せ替え可能
   ===================================================================== */

let UNITS=[], MASTERS=[], UNIT_SOURCE='default', UNIT_BROKEN=false, MASTER_SOURCE='default', MASTER_BROKEN=false;
function reloadUnits(){ const r=loadUnits(); UNITS=r.units; UNIT_SOURCE=r.source; UNIT_BROKEN=!!r.broken; const mr=loadMasters(UNITS); MASTERS=mr.masters; MASTER_SOURCE=mr.source; MASTER_BROKEN=!!mr.broken; }
reloadUnits();

let G;
function newGame(o={}){
  G = { phase:'mode', mode:null, rule:o.rule||'team', handicap:o.handicap??true, cpu:[false,false], level:'normal', speed:700, seed:String(Math.random()),
    setupPid:0, picks:[[],[]], mpicks:[null,null], setupMsg:'',
    // master：マスタールールのマスター（makeMaster）。spell：令呪 null/'decl'(宣言済み・次のマスターフェイズで使う)/'used'
    // evac：退避中（次の相手ターンの間） / zeroNext：前のターンの行動回数が0だった（次の行動回数+1）
    players:[{name:TERMS.player+'1',party:[],stars:0,master:null,spell:null,evac:false,zeroNext:false},{name:TERMS.player+'2',party:[],stars:0,master:null,spell:null,evac:false,zeroNext:false}],
    cur:0, turn:0, actRolled:false, maxActs:{}, alloc:{}, rolled:[], ult:null, target:null,
    gen:0, pending:null, copy:null, guard:null, hcap:null, mastered:false, ultDone:false, log:[], winner:null, dealt:[0,0] };
  FXQ.length=0; for(const k in FXHOLD) delete FXHOLD[k]; FXHIDE.clear(); KO_PEND.length=0;
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
// 出目の表示待ち：ロール演出が着地するまで画面に結果を出さないもの（'f:<uid>'=肖像の出目 / 'r:<idx>'=コマンド列の1枚）
const FXHIDE=new Set();
// o.w を付けると、次の演出までの待ち時間をその値にする（重ねて見せたいとき）
// o.own：スキル・鉛筆の面の専用セリフ（あれば key の通常セリフの代わりに使う）
function say(u,key,o={}){ const {own,...r}=o; const t=pickLine(D(u.def),key,own); if(t) fxEmit({t:'say',uid:u.uid,key,text:t,...r}); }
// 出たコマンドの専用セリフ（他のサーヴァントの鉛筆をロールしたコマンドは、そのサーヴァントのセリフなので使わない）
const cmdLine = cmd=>cmd&&!cmd.from?cmd.line:null;
// フェイズ切り替えの帯。big はターン開始など大きく見せるもの
function phaseFx(title,sub,o={}){ fxEmit({t:'phase',title,sub,...o}); }
// 鉛筆ロールの演出。keys の結果は演出の着地まで隠す
function rollFx(uid,f,o={}){ (o.keys||[]).forEach(k=>FXHIDE.add(k)); fxEmit({t:'roll',uid,f,...o}); }

// ---------- ヘルパー ----------
const D = id=>UNITS.find(u=>u.id===id)||MASTERS.find(m=>m.id===id);
const traitsOf = u=>(D(u.def)||{}).traits||[]; // 属性（特攻・特防の判定用）
const ruleset = ()=>RULESETS[G.rule]||RULESETS.team;
const keepRule = ()=>({rule:G.rule, handicap:G.handicap});
const ALL = ()=>[...G.players[0].party,...G.players[1].party];
const masterOf = pid=>G.players[pid].master;
const masterRule = ()=>!!ruleset().master;
const mTeam = ()=>!!ruleset().mTeam; // マスターチームバトル
const costCap = ()=>ruleset().costCap||RULES.costCap;
const mcost = pid=>G.mpicks[pid]&&D(G.mpicks[pid])?D(G.mpicks[pid]).cost:0; // 編成中のマスターのコスト
const ALLM = ()=>[...ALL(),...G.players.map(P=>P.master).filter(Boolean)]; // サーヴァント＋マスター
const U = uid=>ALLM().find(u=>u.uid===uid);
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
// 行動回数は必ず使い切る：割り振る合計は「最大行動回数の合計」と上限（actionsMax）の小さい方ちょうど
const requiredAlloc = ()=>Math.min(RULES.actionsMax, Object.values(G.maxActs).reduce((a,b)=>a+b,0));
const remainingRolls = ()=>Object.entries(G.alloc).reduce((s,[uid,n])=>U(uid).out?s:s+n-G.rolled.filter(r=>r.uid===uid).length,0);
function makeUnit(pid,idx,id){ return {uid:`p${pid}u${idx}`,pid,idx,def:id,hp:D(id).hp,np:0,asc:false,out:false,used:[false,false,false],fx:[],face:null}; }
// マスター：サーヴァントと同じ形（fx・hp・out）にして、効果やダメージの処理を共用する。out＝瀕死
function makeMaster(pid,id){ return {uid:`p${pid}m`,pid,idx:-1,def:id,hp:D(id).hp,np:0,asc:false,out:false,used:[],fx:[],face:null,master:true}; }
// 宝具に「攻撃対象」を使う効果がない（全体宝具・補助宝具）なら、対象を選ばず敵全体が対象
const ultNoTarget = u=>!D(u.def).ult.eff.some(e=>e.t==='target');
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
// 最大HP（定義のHP＋最大HP+の合計）。最大HP+が切れたら HP を最大値まで下げる（1未満にはしない）
const maxHp = u=>D(u.def).hp+mods(u,'maxHp').sum;
function clampHp(u){ if(!u.out&&u.hp>maxHp(u)) u.hp=Math.max(1,maxHp(u)); }
// スターの獲得：手番側はこのターンの発生スター（G.gen）、相手側は手持ちに直接加える
function gainStars(pid,v){ if(pid===G.cur) G.gen+=v; else G.players[pid].stars+=v; }

// =====================================================================
// 効果の適用
// =====================================================================
function resolveTargets(src,t,picked){
  let ts=[];
  const m=masterOf(src.pid), em=masterOf(1-src.pid);
  if(t==='self') ts=[src];
  else if(t==='picked') ts=picked?[picked]:[];
  else if(t==='ally_all') ts=[...alive(src.pid),...(m?[m]:[])]; // マスタールール：味方全体の効果はマスターにも
  else if(t==='enemy_all') ts=alive(1-src.pid);
  else if(t==='target') ts=G.target?[U(G.target)]:[];
  else if(t==='svt') ts=picked&&picked.pid===src.pid?[picked]:alive(src.pid); // マスターチームの令呪は選んだ1騎
  else if(t==='enemy_master') ts=em?[em]:[];
  return ts.filter(u=>u&&!u.out);
}
// 確率の判定（chance）：対象ごとに別々にロールする（全体効果なら1体ずつ判定）
function chanceRoll(e,who){
  const r=roll()+1, ok=r<=e.chance;
  rollFx(who.uid,r-1,{ch:{need:e.chance,ok}});
  log(`判定ロール（${nm(who)}）出目${r} ≤ ${e.chance} → ${ok?'成功':'失敗'}`, ok?'':'sub');
  return ok;
}
// o.tmp：マスターの補助（このターンだけ）。付いた効果は終了フェイズで消える
function applyEffects(src,effs,picked,o={}){
  for(const e of effs){
    if(e.t==='master'){
      if(e.chance&&!chanceRoll(e,src)) continue;
      if(e.k==='star'||e.k==='starLoss') changeStars(src.pid,e.k==='star'?e.v:-e.v);
      continue;
    }
    resolveTargets(src,e.t,picked).forEach(t=>{
      if(e.chance&&!chanceRoll(e,t)) return;
      if(e.k==='dmg'){ if(src.master) fixedHit(src,t,e.v); return; } // 宝具のダメージは resolveUlt で処理
      applyOne(src,t,e,o);
    });
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
// 戦闘不能：ルール上はその場で倒れるが、画面で暗くするのは一連の攻撃が終わってから（flushKo）
const KO_PEND=[];
function retreat(u){ u.hp=0; u.out=true; u.fx=[]; log(`${nm(u)} ${TERMS.out}`,'bad'); KO_PEND.push(u.uid); }
// 攻撃・スキル・終了フェイズの処理が終わったところで呼ぶ：戦闘不能の演出とセリフをまとめて出す
function flushKo(){
  if(!KO_PEND.length) return;
  const uids=KO_PEND.splice(0);
  fxEmit({t:'ko',uids});
  uids.forEach(uid=>say(U(uid),'defeat'));
}
function applyOne(src,t,e,o={}){
  if(t.master&&mTeam()&&FX[e.k].buff===false){ log(`${nm(t)}は${TERMS.unit}に守られていて弱体を受けない`,'sub'); return; } // マスターチーム：マスターは弱体を受けない
  if(immuneTo(t,e.k)) return;
  switch(e.k){
    case 'heal': if(has(t,'healBlock')){ log(`${nm(t)}は回復無効でHPが回復しない`,'sub'); return; }
      t.hp=Math.min(maxHp(t),t.hp+e.v); log(`${nm(t)} HP${e.v}回復`,'good'); return;
    case 'np': addNp(t,e.v); log(`${nm(t)} ${TERMS.gauge}${e.v>=0?'+':''}${e.v}%`); return;
    case 'star': changeStars(t.pid,e.v); return;
    case 'starLoss': changeStars(t.pid,-e.v); return;
    case 'cleanse': t.fx=t.fx.filter(x=>FX[x.k].buff!==false); log(`${nm(t)}の弱体を解除`,'good'); return;
    case 'cleanseMental': t.fx=t.fx.filter(x=>!FX[x.k].mental); log(`${nm(t)}の精神異常を解除`,'good'); return;
    case 'strip': t.fx=t.fx.filter(x=>FX[x.k].buff!==true); clampHp(t); log(`${nm(t)}の強化を解除`,'bad'); return;
    case 'buffExtend': {
      const bs=t.fx.filter(x=>FX[x.k].buff===true&&x.turns!=null); bs.forEach(x=>x.turns+=e.v);
      log(`${nm(t)}の強化${bs.length}個の効果時間+${e.v}T`, bs.length?'good':'sub'); return;
    }
    case 'skillCharge': { // 使ったスキル自身は doSkill で後から使用済みにするので戻らない
      // スキル再使用を持つスキルは戻さない（2騎で戻し合う無限ループを防ぐ）
      const sk=D(t.def).skills, idx=t.used.map((x,i)=>x&&!sk[i].eff.some(f=>f.k==='skillCharge')?i:-1).filter(i=>i>=0).slice(0,Math.max(1,e.v));
      idx.forEach(i=>t.used[i]=false);
      log(idx.length?`${nm(t)}のスキル${idx.map(i=>i+1).join('・')}が再使用可能に`:`${nm(t)}に使用済みのスキルがない`, idx.length?'good':'sub'); return;
    }
    case 'instantDeath': { // HPを0にする。ガッツがあれば踏みとどまる
      log(`${nm(t)}に即死効果`,'bad');
      const g=t.fx.find(x=>x.k==='guts');
      if(g){ fxEmit({t:'dmg',uid:t.uid,text:FX.instantDeath.name,hp0:t.hp,hp:g.v,out:false}); t.hp=g.v; t.fx=t.fx.filter(x=>x!==g); log(`${nm(t)} ガッツ発動！ HP${g.v}で踏みとどまった`,'good'); return; }
      fxEmit({t:'dmg',uid:t.uid,text:FX.instantDeath.name,hp0:t.hp,hp:0,out:true}); retreat(t); return;
    }
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
  if(e.vs) inst.vs=e.vs;
  if(e.trait) inst.trait=e.trait;
  if(o.tmp){ inst.tmp=true; inst.turns=null; } // 補助：このターンの終了フェイズまで
  t.fx.push(inst);
  if(e.k==='maxHp') t.hp+=e.v; // 最大HPが増えたぶん HP も増える
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
  if(u.master){ masterHit(u,dmg,o); return; }
  const hp0=u.hp, g=hp0-dmg<=0?u.fx.find(e=>e.k==='guts'):null;
  const hp1=hp0-dmg<=0?(g?g.v:0):hp0-dmg;
  fxEmit({t:'dmg',uid:u.uid,v:fmt(dmg),crit:!!o.crit,np:!!o.np,hp0,hp:hp1,out:hp0-dmg<=0&&!g});
  G.dealt[1-u.pid]+=Math.min(dmg,hp0);
  u.hp-=dmg;
  if(u.hp<=0){
    if(g){ u.hp=g.v; u.fx=u.fx.filter(e=>e!==g); log(`${nm(u)} ガッツ発動！ HP${g.v}で踏みとどまった`,'good'); }
    else { retreat(u); return; }
  }
  if(isHit){
    // 被ダメージ時○○ はここではなく、攻撃対象になったターンの終了フェイズ（hitEffects）で発動する
    const c=u.fx.find(e=>e.k==='curse');
    if(c){ consume(u,[c]); log(`${nm(u)}は呪いで${TERMS.gauge}が増えない`,'sub'); }
    else addNp(u,npRate(u,RULES.gaugeOnHit));
    // 反撃：攻撃側へ固定ダメージ（補正・無敵・回避・クリティカルの影響なし、NPは増えない）
    const ct=mods(u,'counter'), a=o.att;
    if(ct.sum&&a&&!a.out){
      log(`${nm(u)}の反撃！ ${nm(a)}に<b>${ct.sum}</b>ダメージ`,'good');
      consume(u,ct.list); dealDamage(a,ct.sum,false);
    }
  }
}
// マスターへのダメージ：HPが0になったら瀕死（以降はマスターフェイズなし）。自軍サーヴァントがマスターの最大HP分のダメージを受ける
function masterHit(m,dmg,o={}){
  const hp0=m.hp, hp1=Math.max(0,hp0-dmg);
  fxEmit({t:'dmg',uid:m.uid,v:fmt(dmg),crit:!!o.crit,np:!!o.np,hp0,hp:hp1,out:hp1<=0});
  G.dealt[1-m.pid]+=Math.min(dmg,hp0);
  m.hp=hp1;
  if(hp1>0) return;
  m.out=true; m.fx=[];
  const full=D(m.def).hp;
  log(`${nm(m)} 瀕死！ ${TERMS.unit}が${TERMS.player}の最大HP分（${full}）のダメージを受ける`,'bad');
  fxEmit({t:'pop',uid:m.uid,text:'瀕死',cls:'ko'});
  alive(m.pid).forEach(u=>dealDamage(u,full,false));
}
// マスターの補助・令呪・攻撃による固定ダメージ（補正・無敵・回避・NP獲得なし）
function fixedHit(src,t,v){
  log(`${nm(src)}の攻撃 → ${nm(t)}に<b>${fmt(v)}</b>ダメージ`);
  dealDamage(t,v,false);
}
// 攻撃側の補正（被ダメージ減少無視なら相手の def を見ない）。使った効果も返す
function dmgMods(att,tgt,color){
  const a=mods(att,'atk',color), ad=mods(att,'atkDown');
  // ハンデの攻撃ダメージ+ も足す
  let sum=a.sum-ad.sum+(hasHcap(att)?G.hcap.atk:0); const usedA=[...a.list,...ad.list], usedT=[];
  if(tgt&&!tgt.out){
    // 弱体状態特攻：対象が指定の弱体（vs 未指定なら何か1つ）を受けていれば加算
    const vs=att.fx.filter(e=>e.k==='atkVs'&&tgt.fx.some(x=>e.vs?x.k===e.vs:FX[x.k].buff===false));
    if(vs.length){ sum+=vs.reduce((s,e)=>s+e.v,0); usedA.push(...vs); }
    // 属性特攻：対象が属性 trait を持っていれば加算
    const tt=traitsOf(tgt), at=att.fx.filter(e=>e.k==='atkTrait'&&tt.includes(e.trait));
    if(at.length){ sum+=at.reduce((s,e)=>s+e.v,0); usedA.push(...at); }
    const dd=mods(tgt,'defDown'); sum+=dd.sum; usedT.push(...dd.list);
    const ig=att.fx.find(e=>e.k==='ignoreDef');
    if(ig){ if(mods(tgt,'def').list.length) usedA.push(ig); }
    else { const df=mods(tgt,'def'); sum-=df.sum; usedT.push(...df.list);
      // 属性特防：攻撃してきた相手が属性 trait を持っていれば減算（被ダメージ減少無視なら見ない）
      const ta=traitsOf(att), dt=tgt.fx.filter(e=>e.k==='defTrait'&&ta.includes(e.trait));
      if(dt.length){ sum-=dt.reduce((s,e)=>s+e.v,0); usedT.push(...dt); } }
  }
  // 色指定のある攻撃ダメージ+（色バフ）の合計：クリティカルで2倍
  const colorBuff=a.list.filter(e=>e.color).reduce((s,e)=>s+e.v,0);
  return {sum, usedA, usedT, colorBuff};
}
function gainNpStar(att,cmd,mult){
  if(cmd.np) addNp(att,npRate(att,cmd.np*mult));
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
  rollFx(src.uid,f,{cmd,def:src.def,keys:[`f:${uid}`,`r:${G.copy.idx}`]});
  log(`${nm(u)}：${nm(src)}の鉛筆をロール 出目${f+1} → ${cmdChip(cmd)}`);
  G.copy=null;
}
// 攻撃に付いた効果を「攻撃前」と「攻撃後」に分ける（at が未指定なら def＝既定のタイミング）
function splitEffs(effs,def){
  const pre=[], post=[];
  (effs||[]).forEach(e=>((e.at||def)==='pre'?pre:post).push(e));
  return [pre,post];
}
// 宝具の効果の適用順：攻撃前 → 並び順（ダメージと未指定の効果） → 攻撃後
function ultEffOrder(effs){
  const at=e=>e.k==='dmg'?'':e.at||'';
  return [...effs.filter(e=>at(e)==='pre'), ...effs.filter(e=>!at(e)), ...effs.filter(e=>at(e)==='post')];
}
function resolveCommand(att,cmd,tgt,o={}){
  const n=nm(att);
  const atkFx=to=>fxEmit({t:'atk',uid:att.uid,tgt:to,cmd,ri:o.ri,extra:!!o.extra});
  if(cmd.c==='ASC'){ if(cmdLine(cmd)) say(att,'attack',{own:cmd.line}); atkFx(null); log(`${n}：${TERMS.ascFull}（1行動）`,'sub'); return; }
  if(isCopyCmd(cmd)){ // エクストラアタックで出たときは対象をランダムに選んで、その場でロール
    const cs=copyCands(att); if(!cs.length) return;
    const src=cs[Math.floor(Math.random()*cs.length)], r=copyRollFrom(src);
    log(`${n}：${nm(src)}の鉛筆をロール 出目${r.f+1} → ${cmdChip(r.cmd)}`);
    rollFx(src.uid,r.f,{cmd:r.cmd,def:src.def});
    return resolveCommand(att,r.cmd,tgt,o);
  }
  // 付加効果のタイミング：既定は特殊行動＝攻撃前、通常コマンド＝攻撃後（効果ごとの at で変えられる）
  const [preE,postE]=splitEffs(cmd.eff,EFF_AT_DEFAULT[cmd.c==='W'?'W':'cmd']);
  if(cmd.c==='W'){
    log(`${n}：特殊行動「${esc(cmd.label)}」${cmd.from?`（${esc(cmd.from)}）`:''}`);
    if(!(cmd.dmg>0)){ if(cmdLine(cmd)) say(att,'attack',{own:cmd.line}); atkFx(null); applyEffects(att,[...preE,...postE],null); gainNpStar(att,cmd,1); return; }
    // ダメージを持つ特殊行動は無属性の攻撃として続けて処理する（チェインには数えない）
  }
  applyEffects(att,preE,null); // 攻撃前の効果（防御無視・無敵貫通などを付けてから攻撃）
  say(att,(o.extra&&(D(att.def).lines.extra||[]).length)?'extra':'attack',{w:250,own:cmdLine(cmd)}); // 吹き出しと攻撃カードを重ねて見せる（エクストラ用が空なら通常の攻撃セリフ。面の専用セリフがあればそちら）
  atkFx(tgt.uid); // 戦闘不能の相手にも（オーバーキル）カードを飛ばす
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
      const cr=mods(att,'critRoll'), cd=mods(att,'critDown'); // critDown＝クリティカル発生率ダウン（弱体）
      if(ruleset().crit==='d6'){ // シンプルルール：1d6 の出目（クリティカルロール-x で出目を下げる）が必要値以下で成功
        const need=critNeedD6(st), r=roll()+1, rv=r-cr.sum+cd.sum;
        crit=(need>=6&&!cd.sum)||rv<=need;
        note.push(`クリ判定 出目${r}${cr.sum?`-${cr.sum}`:''}${cd.sum?`+${cd.sum}`:''} ≤ ${need} ${crit?'成功':'失敗'}`);
      } else {
        const lv=Math.max(0,Math.min(CRIT_TABLE.length,critLevel(st)+cr.sum-cd.sum)), p=critChance(lv);
        const r=Math.floor(Math.random()*100)+1;
        crit=r<=p;
        note.push(`クリ判定 Lv${lv}(${p}%) 出目${r} ${crit?'成功':'失敗'}`);
      }
      consume(att,[...cr.list,...cd.list]);
    }
    if(crit){
      const cp=mods(att,'critPow'), cm=att.fx.filter(e=>e.k==='critMult');
      if(cm.length){ // クリティカル倍率：+30/+60・色バフ2倍の代わりに、ここまでのダメージ×x%（威力+は最後に加算）
        const pct=Math.max(...cm.map(e=>e.v)), add=Math.round(dmg*pct/100)-dmg+cp.sum;
        dmg+=add; note.push(`クリ×${pct}%${cp.sum?`+${cp.sum}`:''}`); consume(att,cm);
      } else {
        const add=(cmd.c==='R'?RULES.critDmgR:RULES.critDmg)+cp.sum+colorBuff;
        dmg+=add; note.push(`クリ+${add}${colorBuff?`(色バフ+${colorBuff}含む)`:''}`);
      }
      consume(att,cp.list);
    }
  }
  // 6. 最終ダメージ（クリティカルとオーバーキルは重複：獲得NP・発生スターがそれぞれ2倍）
  const mult=(crit?2:1)*(tgt.out?2:1);
  if(tgt.out){
    log(`${n} ${cmdChip(cmd)} → オーバーキル（${TERMS.gauge}・${TERMS.star}${mult}倍）`);
    fxEmit({t:'dmg',uid:tgt.uid,v:fmt(dmg),crit,over:true});
  } else {
    const b=blocked(att,tgt);
    if(b){ log(`${n} ${cmdChip(cmd)} → ${nm(tgt)}：${b}で無効 <span class="sub">(${note.join(' / ')})</span>`); fxEmit({t:'dmg',uid:tgt.uid,text:b}); }
    else if(nullified(tgt,dmg)){ log(`${n} ${cmdChip(cmd)} → ${nm(tgt)}：${fmt(dmg)}ダメージは${nullified(tgt,dmg)}以下なので無効 <span class="sub">(${note.join(' / ')})</span>`); fxEmit({t:'dmg',uid:tgt.uid,text:'無効'}); consume(tgt,usedT); }
    else { log(`${n} ${cmdChip(cmd)} → ${nm(tgt)}：<b>${fmt(dmg)}</b>ダメージ <span class="sub">(${note.join(' / ')})</span>`); consume(tgt,usedT); dealDamage(tgt,dmg,true,{crit,att}); }
  }
  gainNpStar(att,cmd,mult);
  consume(att,usedA);
  // 攻撃時○○（エクストラアタックでは発動しない）
  if(!o.extra){
    const s=mods(att,'onAtkStar',cmd.c), p=mods(att,'onAtkNp',cmd.c);
    if(s.sum){ G.gen+=s.sum; log(`${n} 攻撃時効果：${TERMS.star}${s.sum}個発生`,'sub'); }
    if(p.sum){ addNp(att,npRate(att,p.sum)); log(`${n} 攻撃時効果：${TERMS.gauge}+${p.sum}%`,'sub'); }
    consume(att,[...s.list,...p.list]);
  }
  // 攻撃後の効果（例：自身の弱体解除）
  applyEffects(att,postE,null);
}
function resolveUlt(u,tgt){
  const ud=D(u.def).ult;
  log(`${nm(u)}の${TERMS.ult}「${esc(ud.name)}」！`,'good');
  fxEmit({t:'cutin',uid:u.uid,title:ud.name,ruby:ud.ruby,col:ud.c});
  say(u,'np');
  for(const e of ultEffOrder(ud.eff)){
    if(u.out) break; // 反撃で倒れたら残りの効果は出ない
    if(e.k!=='dmg'){ applyEffects(u,[e],null); continue; }
    // マスタールール：全体宝具は敵マスターにも当たる（退避中なら当たらない。無敵・回避などでは防げない）
    const em=masterOf(1-u.pid), hitM=e.t==='enemy_all'&&em&&!em.out&&!G.players[em.pid].evac&&!mTeam();
    const ts = e.t==='enemy_all' ? [...alive(1-u.pid),...(hitM?[em]:[])] : [tgt].filter(x=>x&&!x.out);
    const usedA=new Set();
    for(const t of ts){
      t.tgtd=true;
      const m=dmgMods(u,t,ud.c); m.usedA.forEach(x=>usedA.add(x));
      let dmg=Math.max(0,e.v+m.sum);
      if(t.master&&e.t==='enemy_all'){ log(`→ ${nm(t)}：<b>${fmt(dmg)}</b>ダメージ`); dealDamage(t,dmg,false,{np:true}); continue; }
      const b=blocked(u,t);
      if(b){ log(`→ ${nm(t)}：${b}で無効`); fxEmit({t:'dmg',uid:t.uid,text:b}); }
      else if(nullified(t,dmg)){ log(`→ ${nm(t)}：${fmt(dmg)}ダメージは${nullified(t,dmg)}以下なので無効`); fxEmit({t:'dmg',uid:t.uid,text:'無効'}); consume(t,m.usedT); }
      else { log(`→ ${nm(t)}：<b>${fmt(dmg)}</b>ダメージ`); consume(t,m.usedT); dealDamage(t,dmg,true,{np:true,att:u}); if(!t.out) say(t,'npDamage'); }
      if(u.out) break; // 反撃で倒れたら残りの対象には当たらない
    }
    consume(u,[...usedA]);
  }
}
function resolveDamage(){
  const tgt=U(G.target);
  log(`${PN(6)} ダメージフェイズ（攻撃対象：${G.targetAll?'敵全体':nm(tgt)}）`,'h');
  phaseFx('BATTLE','ダメージフェイズ',{w:800}); // 帯が消えてから攻撃カードを出す
  if(G.ult){ resolveUlt(U(G.ult),tgt); }
  else {
    tgt.tgtd=true; // 攻撃対象になった（被ダメージ時○○ の発動条件。回避・無敵で防いでも対象にはなっている）
    const hp0=tgt.hp;
    const acts=G.rolled, cols=acts.map(a=>a.cmd.c);
    const chain = acts.length===3 && ['R','B','G'].includes(cols[0]) && cols.every(c=>c===cols[0]) ? cols[0] : null;
    if(chain){ log(`${TERMS[chain]}チェイン発生！`,'good'); fxEmit({t:'banner',title:`${TERMS[chain]} Chain`,col:chain}); }
    acts.forEach((a,ri)=>{ if(!U(a.uid).out) resolveCommand(U(a.uid),a.cmd,tgt,{chain,ri}); }); // 反撃で倒れたら残りの行動はしない
    if(chain==='B'){ [...new Set(acts.map(a=>a.uid))].map(U).forEach(u=>addNp(u,npRate(u,RULES.chainB))); log(`チェインボーナス：行動${TERMS.unit}の${TERMS.gauge}+${RULES.chainB}%`); }
    if(chain==='G'){ G.gen+=RULES.chainG; log(`チェインボーナス：${TERMS.star}${RULES.chainG}個発生`); }
    // 7. ブレイブチェイン
    if(acts.length===3 && acts.every(a=>a.uid===acts[0].uid) && !U(acts[0].uid).out){
      const u=U(acts[0].uid), f=roll(), face=D(u.def).faces[f];
      log(`ブレイブチェイン！ ${nm(u)}のエクストラアタック（出目${f+1}）`,'good');
      fxEmit({t:'banner',title:'Brave Chain',sub:'エクストラアタック'});
      const cmd=!u.asc&&face.pre.c==='ASC'?face.pre:u.asc?face.post:face.pre;
      rollFx(u.uid,f,{cmd,keys:[`f:${u.uid}`]}); u.face={i:f,kind:'cmd',cmd};
      if(cmd.c==='ASC') ascend(u);
      else resolveCommand(u,cmd,tgt,{extra:true});
    }
    if(!tgt.out && tgt.hp<hp0) say(tgt,'damage');
  }
  flushKo();
  checkWin();
  if(G.winner==null) G.phase='end';
}
function ascend(u){ u.asc=true; fxEmit({t:'pop',uid:u.uid,text:TERMS.ascFull,cls:'asc'}); log(`${nm(u)} ${TERMS.ascFull}！ 以降は${TERMS.asc}後コマンド、スキル3解放`,'good'); }

// =====================================================================
// ターン進行
// =====================================================================
function startGame(){
  G.players.forEach((P,pid)=>{ P.party=G.picks[pid].map((id,i)=>makeUnit(pid,i,id)); P.stars=0;
    P.master=masterRule()&&G.mpicks[pid]?makeMaster(pid,G.mpicks[pid]):null; P.spell=null; P.spellLeft=ruleset().spells||1; P.spellUsed=[false,false,false]; P.evac=false; P.zeroNext=false; });
  applyHandicap();
  log('先攻・後攻の決定','h');
  let r0,r1;
  do{
    r0=roll(); r1=roll();
    const a=G.players[0].party[0], b=G.players[1].party[0];
    a.face={i:r0,kind:'die'}; b.face={i:r1,kind:'die'};
    rollFx(a.uid,r0,{grp:true,keys:[`f:${a.uid}`]}); rollFx(b.uid,r1,{keys:[`f:${b.uid}`]});
    log(`${nm(a)} 出目${r0+1} ／ ${nm(b)} 出目${r1+1}${r0===r1?'（同値・振り直し）':''}`);
  } while(r0===r1);
  G.cur=r0>r1?0:1; G.turn=1;
  log(`${esc(G.players[G.cur].name)} が先攻`,'good');
  [G.cur,1-G.cur].forEach(pid=>say(G.players[pid].party[0],'start'));
  beginTurn();
}
// シンプルルールのハンデ戦：コスト差が handicapAsc 以上なら、低コスト側を最初から霊基再臨済みにする
// 陣営のコスト（マスタールールはマスターのコストも足す）
const sideCost = P=>P.party.reduce((s,u)=>s+D(u.def).cost,0)+(P.master?D(P.master.def).cost:0);
function applyHandicap(){
  const rs=ruleset(); if(!rs.handicapAsc||!G.handicap) return;
  const c=G.players.map(P=>sideCost(P)), diff=Math.abs(c[0]-c[1]);
  if(diff<rs.handicapAsc) return;
  const low=c[0]<c[1]?0:1;
  log(`ハンデ戦：コスト差${diff}のため ${esc(G.players[low].name)} は${TERMS.ascFull}済みで開始`,'h');
  G.players[low].party.forEach(ascend);
  const hb=rs.hcapBonus;
  if(hb&&diff>=hb.gap){
    G.hcap={pid:low, np:hb.np, atk:hb.atk};
    log(`ハンデ戦：コスト差${diff}のため ${esc(G.players[low].name)} の${TERMS.unit}は ${hcapText()}`,'h');
  }
}
// ハンデ（コスト差 hcapBonus.gap 以上）：低コスト側のサーヴァントの攻撃ダメージ+atk・獲得NP+np%（解除できない）
const hasHcap = u=>!!G.hcap&&G.hcap.pid===u.pid&&!u.master;
const hcapText = ()=>G.hcap?`攻撃ダメージ+${G.hcap.atk}・獲得${TERMS.gauge}+${G.hcap.np}%`:'';
// 攻撃・被弾・チェインで得るNPに、ハンデのNP獲得量アップを掛ける（スキルなどで直接増えるNPには掛けない）
const npRate = (u,v)=>hasHcap(u)&&G.hcap.np?Math.round(v*(100+G.hcap.np)/100):v;
function beginTurn(){
  Object.assign(G,{phase:'actRoll',actRolled:false,maxActs:{},alloc:{},rolled:[],ult:null,target:null,targetAll:false,gen:0,pending:null,copy:null,guard:null,mastered:false,ultDone:false,spellPick:null});
  const P=G.players[G.cur];
  if(P.evac){ P.evac=false; log(`${esc(P.name)}の${TERMS.player}が退避から戻った`,'sub'); }
  log(`━ ターン${G.turn}：${esc(G.players[G.cur].name)} ━`,'h');
  phaseFx(`TURN ${G.turn}`,`${G.players[G.cur].name}の手番`,{big:true,pid:G.cur});
  // ① ターン開始：ターン開始時○○ を発動してから、このプレイヤーが付与した効果の残りターン-1
  turnStartEffects();
  ALLM().forEach(u=>{
    u.fx.forEach(e=>{ if(e.owner===G.cur && e.turns!=null) e.turns--; });
    const ex=u.fx.filter(e=>e.turns!=null&&e.turns<=0);
    if(ex.length){ u.fx=u.fx.filter(e=>!ex.includes(e)); clampHp(u); log(`${nm(u)}の ${ex.map(e=>FX[e.k].name).join('・')} が終了`,'sub'); }
  });
}
// ターン開始時○○：手番側の生存サーヴァントに付いているものが発動（スターはこのターンの手持ちに加わる）
function turnStartEffects(){
  alive(G.cur).forEach(u=>{
    const h=mods(u,'regenHp').sum, n=mods(u,'regenNp').sum, s=mods(u,'regenStar').sum;
    if(h&&has(u,'healBlock')) log(`${nm(u)}は回復無効でターン開始時に回復しない`,'sub');
    else if(h&&u.hp<maxHp(u)){ const v=Math.min(h,maxHp(u)-u.hp); u.hp+=v; log(`${nm(u)} ターン開始時：HP${v}回復`,'good'); fxEmit({t:'pop',uid:u.uid,text:`HP+${v}`,cls:'heal'}); }
    if(n){ addNp(u,n); log(`${nm(u)} ターン開始時：${TERMS.gauge}+${n}%`,'good'); }
    if(s){ G.players[G.cur].stars+=s; log(`${nm(u)} ターン開始時：${TERMS.star}${s}個獲得`,'good'); }
  });
}
// 被ダメージ時○○：このターンに攻撃対象になったサーヴァント（敵味方とも）に付いているものが、終了フェイズに1回発動
function hitEffects(){
  ALL().forEach(u=>{
    if(!u.tgtd) return; delete u.tgtd;
    if(u.out) return;
    const hn=mods(u,'onHitNp'), hs=mods(u,'onHitStar');
    if(hn.sum){
      const c=u.fx.find(e=>e.k==='curse');
      if(c){ consume(u,[c]); log(`${nm(u)}は呪いで被ダメージ時の${TERMS.gauge}が増えない`,'sub'); }
      else { addNp(u,hn.sum); log(`${nm(u)} 被ダメージ時：${TERMS.gauge}+${hn.sum}%`,'good'); }
      consume(u,hn.list);
    }
    if(hs.sum){ gainStars(u.pid,hs.sum); log(`${nm(u)} 被ダメージ時：${TERMS.star}${hs.sum}個獲得`,'good'); consume(u,hs.list); }
  });
}
function endPhase(){
  log(`${PN(7)} 終了フェイズ`,'h');
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
  hitEffects();
  // マスターの補助（このターンだけ）の効果を消す
  ALLM().forEach(u=>{ const t=u.fx.filter(e=>e.tmp); if(t.length){ u.fx=u.fx.filter(e=>!e.tmp); clampHp(u); } });
  G.players[G.cur].stars=G.gen;
  log(`${esc(G.players[G.cur].name)}：${TERMS.star}を${G.gen}個獲得（次のターンに使用）`);
  ALL().forEach(u=>u.face=null); // このターンの出目・コマンドの表示は次のターンに持ち越さない
  flushKo();
  checkWin(); if(G.winner!=null) return;
  G.cur=1-G.cur; G.turn++;
  beginTurn();
}
function checkWin(){
  if(alive(1-G.cur).length===0) win(G.cur);      // 同時全滅は手番側の勝ち
  else if(alive(G.cur).length===0) win(1-G.cur);
}
function win(pid){ G.winner=pid; G.phase='over'; log(`${esc(G.players[pid].name)} の勝利！`,'good');
  phaseFx(G.mode==='cpu'?(pid===0?'VICTORY':'DEFEAT'):'WINNER',G.mode==='cpu'?'':`${G.players[pid].name}の勝利`,{big:true,pid,end:true}); const w=alive(pid)[0]; if(w) say(w,'win'); }
function applyMode(cfg){
  Object.assign(G,{mode:cfg.mode, level:cfg.level, cpu:cfg.cpu, speed:cfg.speed||G.speed, phase:'setup'});
  cfg.names.forEach((n,i)=>G.players[i].name=n);
}
function doSkill(u,si,picked){
  const s=D(u.def).skills[si];
  log(`${nm(u)} スキル「${esc(s.name)}」`);
  // 使ったスキルの名前と効果を中央に出す（選んだ対象があれば名前も）
  fxEmit({t:'skill',uid:u.uid,si,name:s.name,picked:picked?D(picked.def).name:'',
    lines:s.eff.length?s.eff.map(e=>`${tLabel(e.t,s.pick)}：${fxText(e)}${e.chance?`（出目${e.chance}以下で成功）`:''}`):['効果なし']});
  say(u,'skill',{own:s.line}); // スキルの専用セリフがあればそちら
  applyEffects(u,s.eff,picked);
  u.used[si]=true; // 効果の後に使用済みにする（スキル再使用で自分自身が戻らないように）
  flushKo();
  checkWin(); // 即死などでスキルだけで決着することがある
}
function toTargetPhase(){
  G.phase='target'; log(`${PN(5)} 攻撃対象決定`,'h'); phaseFx('TARGET','攻撃対象の選択');
  const c=targetCandidates();
  if(G.ult&&ultNoTarget(U(G.ult))){ G.targetAll=true; G.target=c[0].uid; return; } // 全体宝具：最初から敵全体を選んだ状態
  if(c.length===1) G.target=c[0].uid;
}

// ログのフェイズ番号（マスタールールは③にマスターフェイズが入るので、スキル以降が1つずれる）
const PN = n=>'①②③④⑤⑥⑦⑧⑨'[n-1+(masterRule()&&n>=3?1:0)];
function toSkillPhase(){ G.phase='skill'; log(`${PN(3)} スキル・${TERMS.ult}使用`,'h'); phaseFx('SKILL',`スキル・${TERMS.ult}`); }
// ---------- マスタールール ----------
// マスターフェイズで行動できるマスター（なければ null）
function masterReady(){ const m=masterOf(G.cur); return G.phase==='master'&&!G.mastered&&m&&!m.out?m:null; }
function masterDone(){ G.mastered=true; flushKo(); checkWin(); if(G.winner==null&&G.phase==='master') toSkillPhase(); }
const masterAtkDmg = (m,t)=>Math.max(0,D(m.def).cost*ruleset().masterAtk[t.master?'master':'svt']+dmgMods(m,t,'W').sum);
// 令呪の状態：P.spellLeft＝残りの画数 / P.spellUsed[i]＝その効果を使った / P.spell==='decl'＝宣言中（マスタールール）
// 令呪を使える：マスタールールは未使用・このターンにサーヴァントが1回以上行動できる。
// マスターチームは残りがあり、生存サーヴァントが全員1回以上行動でき、行動を1回減らせる
function canDeclareSpell(){
  const P=G.players[G.cur]; if(!(P.spellLeft>0)||P.spell==='decl') return false;
  if(mTeam()) return P.spellUsed.some((u,i)=>!u&&D(P.master.def).spells[i].eff.length) && alive(G.cur).every(u=>(G.maxActs[u.uid]||0)>0) && totalAlloc()>0;
  return Object.values(G.maxActs).some(n=>n>0);
}
// 相手マスターへのダメージを令呪で防げる（残りがあり、宣言中でない）
const canGuardSpell = pid=>G.players[pid].spellLeft>0&&G.players[pid].spell!=='decl';
// 令呪の効果を使う。守る側の選択待ちになったら true
// picked：マスターチームで「自軍サーヴァント」の対象に選んだ1騎
function useSpell(m,i,picked){
  const s=D(m.def).spells[i], P=G.players[m.pid];
  log(`${nm(m)}：「${esc(s.name)}」${picked?` → ${nm(picked)}`:''}`,'good');
  fxEmit({t:'skill',uid:m.uid,head:'令呪',name:s.name,picked:picked?D(picked.def).name:'',lines:s.eff.map(e=>`${spellTgt(e.t)}：${fxText(e)}`)});
  P.spellUsed[i]=true; P.spellLeft--; P.spell=null;
  return masterEffects(m,s.eff,{},picked);
}
// マスターチームの令呪：「自軍サーヴァント」は全員ではなく選んだ1騎
const spellPicks = s=>mTeam()&&s.eff.some(e=>e.t==='svt');
const spellTgt = t=>t==='svt'&&mTeam()?`選んだ${TERMS.unit}`:tLabel(t);
// マスターの補助・令呪の効果を適用。「敵マスター」へのダメージは、相手が令呪で防げるなら守る側の選択（guard）を挟む。待ちになったら true
function masterEffects(m,effs,o={},picked=null){
  const md=effs.filter(e=>e.k==='dmg'&&e.t==='enemy_master');
  applyEffects(m,effs.filter(e=>!md.includes(e)),picked,o);
  const em=masterOf(1-m.pid), dmg=md.reduce((s,e)=>s+e.v,0);
  if(!dmg||!em||em.out) return false;
  if(canGuardSpell(em.pid)){ G.guard={kind:'spell',dmg}; G.phase='guard'; return true; }
  fixedHit(m,em,dmg); return false;
}
// 攻撃対象にできる敵マスター（ターゲット集中の敵がいれば不可。マスターチームでは対象にならない）
function masterTargetable(){
  const em=masterOf(1-G.cur);
  if(!em||em.out||mTeam()||G.targetAll||alive(1-G.cur).some(u=>has(u,'taunt'))) return null;
  return em;
}

// =====================================================================
// 操作（すべてここを通る）
// =====================================================================
const ACTIONS = {
  restart(){ newGame(keepRule()); },
  useDefaultData(){ clearCustomUnits(); clearCustomMasters(); reloadUnits(); SHOW_IDS=null; newGame(keepRule()); },
  setRule({rule}){ if(G.phase==='mode'&&RULESETS[rule]) G.rule=rule; },
  toggleHandicap(){ if(G.phase==='mode') G.handicap=!G.handicap; },
  chooseMode({mode,level}){
    if(G.phase!=='mode') return;
    applyMode(mode==='cpu'
      ? {mode, level:CPU_LEVELS[level]?level:'normal', cpu:[false,true], names:['あなた','CPU']}
      : {mode:'pvp', level:'normal', cpu:[false,false], names:[TERMS.player+'1',TERMS.player+'2']});
  },
  rematch(){
    const cfg={mode:G.mode, level:G.level, cpu:G.cpu, speed:G.speed, names:G.players.map(p=>p.name)};
    newGame(keepRule()); applyMode(cfg);
  },
  toggleSpeed(){ G.speed = G.speed>=500 ? 250 : 700; },
  setupToggle({id}){
    const pid=G.setupPid, picks=G.picks[pid], d=D(id); G.setupMsg='';
    if(!d) return;
    const i=picks.indexOf(id);
    if(i>=0){ picks.splice(i,1); return; }
    const max=ruleset().partyMax;
    if(max===1){ picks.splice(0,1,id); return; } // 1騎だけのルールは選び直し
    if(picks.length>=max){ G.setupMsg=`最大${max}体までです`; return; }
    if(sumCost(picks)+d.cost+mcost(pid)>costCap()){ G.setupMsg=`コスト合計が${costCap()}を超えます${masterRule()?`（${TERMS.player}込み）`:''}`; return; }
    picks.push(id);
  },
  setupRandom(){
    const pid=G.setupPid;
    if(masterRule()&&MASTERS.length) G.mpicks[pid]=MASTERS[Math.floor(Math.random()*MASTERS.length)].id;
    const room=costCap()-(ruleset().partyMax>1?mcost(pid):0); // チームはマスターのコストを引いた残りで編成
    let best=[];
    for(let t=0;t<50;t++){
      const pool=[...UNITS].sort(()=>Math.random()-.5), p=[];
      for(const d of pool){ if(p.length<ruleset().partyMax && sumCost(p)+d.cost<=room) p.push(d.id); }
      if(p.length>best.length) best=p;
      if(best.length===ruleset().partyMax) break;
    }
    G.picks[pid]=best; G.setupMsg='';
  },
  // マスタールール：マスターを選ぶ（もう一度押すと外す）
  setupMaster({id}){
    if(G.phase!=='setup'||!masterRule()||!MASTERS.some(m=>m.id===id)) return;
    const pid=G.setupPid; G.setupMsg='';
    if(G.mpicks[pid]===id){ G.mpicks[pid]=null; return; }
    if(ruleset().partyMax>1&&sumCost(G.picks[pid])+D(id).cost>costCap()){ G.setupMsg=`コスト合計が${costCap()}を超えます（${TERMS.player}込み）`; return; }
    G.mpicks[pid]=id;
  },
  // CPUのおまかせ編成。how='random'：完全ランダム（setupRandom と同じ） / how='same'：相手と同じコストになるように選ぶ
  setupCpu({how}={}){
    if(G.phase!=='setup') return;
    const pid=G.setupPid; G.setupMsg='';
    if(how==='random'){ ACTIONS.setupRandom(); return; }
    const opp=G.picks[1-pid], pick=a=>a[Math.floor(Math.random()*a.length)];
    if(masterRule()&&ruleset().partyMax===1){ // マスタールール：サーヴァント＋マスターの合計コストが相手と同じ（なければ一番近い）組み合わせからランダム
      const om=G.mpicks[1-pid], combos=UNITS.flatMap(u=>MASTERS.map(m=>({u:u.id,m:m.id,c:u.cost+m.cost})));
      const want=opp.length&&om?D(opp[0]).cost+D(om).cost:Math.max(...combos.map(x=>x.c));
      const gap=Math.min(...combos.map(x=>Math.abs(x.c-want))), top=combos.filter(x=>Math.abs(x.c-want)===gap), c=pick(top);
      G.picks[pid]=[c.u]; G.mpicks[pid]=c.m;
      if(gap) G.setupMsg=`合計コスト${want}の組み合わせがないため、いちばん近いコスト${c.c}で選びました`;
      return;
    }
    if(ruleset().partyMax===1){ // 1騎のルール：相手と同じ（なければ一番近い）コストからランダム
      const want=opp.length?D(opp[0]).cost:Math.max(...UNITS.map(d=>d.cost));
      const gap=Math.min(...UNITS.map(d=>Math.abs(d.cost-want))), c=UNITS.filter(d=>Math.abs(d.cost-want)===gap);
      G.picks[pid]=[pick(c).id]; return;
    }
    // チーム：相手と合計コストが同じ（なければ一番近い）編成からランダム。人数も相手に合わせ、相手が未編成ならコスト最大の3騎
    // マスターチームはマスターも含めた合計コストで比べる
    const combos=[], max=ruleset().partyMax;
    for(const m of masterRule()?MASTERS:[null]){
      const mc=m?m.cost:0;
      const rec=(start,ids,c)=>{ if(ids.length) combos.push({ids,c:c+mc,m:m&&m.id}); if(ids.length>=max) return;
        for(let i=start;i<UNITS.length;i++){ const c2=c+UNITS[i].cost; if(c2+mc<=costCap()) rec(i+1,[...ids,UNITS[i].id],c2); } };
      rec(0,[],0);
    }
    if(!combos.length){ ACTIONS.setupRandom(); return; }
    const size=opp.length||Math.max(...combos.map(x=>x.ids.length));
    const sized=combos.filter(x=>x.ids.length===size), pool=sized.length?sized:combos;
    const want=opp.length?sumCost(opp)+mcost(1-pid):Math.max(...pool.map(x=>x.c));
    const gap=Math.min(...pool.map(x=>Math.abs(x.c-want))), top=pool.filter(x=>Math.abs(x.c-want)===gap), c=pick(top);
    G.picks[pid]=c.ids.slice().sort((a,b)=>D(b).hp-D(a).hp); // HPが高い順に1st
    if(c.m) G.mpicks[pid]=c.m;
    if(gap) G.setupMsg=`合計コスト${want}の編成が作れないため、いちばん近いコスト${top[0].c}で編成しました`;
  },
  setupConfirm(){
    if(!G.picks[G.setupPid].length) return;
    if(masterRule()&&!G.mpicks[G.setupPid]){ G.setupMsg=`${TERMS.player}を選んでください`; return; }
    if(G.setupPid===0){ G.setupPid=1; G.setupMsg=''; } else { G.phase='init'; startGame(); }
  },
  rollActs(){
    if(G.phase!=='actRoll'||G.actRolled) return;
    log('② 行動回数決定','h');
    ALL().forEach(u=>u.face=null); // 先攻決定の出目なども消してから振る
    const P=G.players[G.cur], bonus=P.party.filter(u=>u.out).length; let left=RULES.actionsMax; const rolls=[];
    // マスタールール：3ターン目の後攻から+1 / 前のターンに行動回数0だったら+1
    let late=0, zero=0;
    if(masterRule()){ late=G.turn>=ruleset().lateBonus?1:0; zero=P.zeroNext?1:0; P.zeroNext=false; }
    alive(G.cur).forEach(u=>{
      let m=0;
      if(disabled(u)){ u.face=null; log(`${nm(u)}は行動不能`,'bad'); }
      else {
        const f=roll(); u.face={i:f,kind:'acts'}; rolls.push({uid:u.uid,f});
        const fear=has(u,'fear')?1:0, up=mods(u,'actsUp'); consume(u,up.list);
        m=Math.max(0,Math.min(RULES.actionsMax, faceActs(D(u.def),f)+bonus+late+zero+up.sum-fear));
        log(`${nm(u)} 出目${f+1} → 最大行動${m}${bonus?`（${TERMS.out}ボーナス+${bonus}）`:''}${late?'（3ターン目後攻から+1）':''}${zero?'（前ターン0回行動+1）':''}${up.sum?`（最大行動回数+${up.sum}）`:''}${fear?'（恐怖-1）':''}`, m?'':'bad');
      }
      G.maxActs[u.uid]=m; const a=Math.min(m,left); G.alloc[u.uid]=a; left-=a;
    });
    rolls.forEach((r,i)=>rollFx(r.uid,r.f,{n:G.maxActs[r.uid],grp:i<rolls.length-1,keys:[`f:${r.uid}`]}));
    if(masterRule()) P.zeroNext=Object.values(G.maxActs).every(n=>!n);
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
    for(const [uid,n] of Object.entries(a)){ if(!Number.isInteger(n)||n<0||n>(G.maxActs[uid]||0)) ok=false; tot+=n; }
    if(!ok || tot!==requiredAlloc()) return; // 使い切っていない配分は受け付けない
    G.alloc=a;
    ACTIONS.confirmAlloc();
  },
  confirmAlloc(){
    if(G.phase!=='actRoll'||!G.actRolled||totalAlloc()!==requiredAlloc()) return;
    const txt=Object.entries(G.alloc).filter(([,n])=>n).map(([uid,n])=>`${dn(U(uid))}×${n}`).join('、');
    log(`配分：${txt||'なし'}`,'sub');
    const m=masterOf(G.cur);
    if(m&&!m.out){ G.phase='master'; log(`③ ${TERMS.player}フェイズ`,'h'); phaseFx('MASTER',`${TERMS.player}フェイズ`); }
    else toSkillPhase();
  },
  // ---------- マスターフェイズ（マスタールール） ----------
  // 補助：マスターの鉛筆を振り、出た面の効果をこのターンだけ適用（無なら何も起きない）
  masterSupport(){
    const m=masterReady(); if(!m) return;
    const d=D(m.def), f=roll(), face=d.faces[f];
    log(`${MASTER_ACTS.support}：${nm(m)} 出目${f+1} → ${face.eff.length?`「${esc(face.label)}」（このターンのみ）`:'無'}`, face.eff.length?'good':'sub');
    fxEmit({t:'skill',uid:m.uid,head:`${MASTER_ACTS.support}・出目${f+1}`,name:face.eff.length?face.label:'無',
      lines:face.eff.length?face.eff.map(e=>`${tLabel(e.t)}：${fxText(e)}`):['何も起きない']});
    if(!masterEffects(m,face.eff,{tmp:true})) masterDone();
  },
  // 攻撃：相手マスターへはコスト×20、相手サーヴァントへはコスト×10（退避中のマスターには当たらない）
  masterAttack({to}){
    const m=masterReady(); if(!m||mTeam()) return;
    const em=masterOf(1-G.cur), t=to==='master'?em:alive(1-G.cur)[0];
    if(!t||t.out) return;
    const dmg=masterAtkDmg(m,t);
    log(`${MASTER_ACTS.attack}：${nm(m)} → ${nm(t)}`,'');
    if(t.master&&G.players[t.pid].evac){ log(`${nm(t)}は退避中のため当たらない`,'sub'); fxEmit({t:'dmg',uid:t.uid,text:'退避'}); masterDone(); return; }
    // マスターからマスターへの攻撃は、相手が令呪1画でサーヴァントに守らせて無効にできる（宣言中は不可）
    if(t.master&&dmg>0&&canGuardSpell(t.pid)){ G.guard={kind:'spell',dmg}; G.phase='guard'; return; }
    fixedHit(m,t,dmg); masterDone();
  },
  // 令呪：now=即時（スターを消費・スキップなし）なら i の効果をすぐ使う。宣言なら以降のフェイズをスキップして、次のマスターフェイズで使う
  masterSpell({now,i,uid}){
    const m=masterReady(); if(!m) return;
    const P=G.players[G.cur], need=ruleset().spellNowStars;
    if(!canDeclareSpell()) return;
    if(mTeam()){ // マスターチーム：その場で使い、行動回数-1（同じ効果は1回まで）
      const k=Number(i), s=D(m.def).spells[k]; if(!s||P.spellUsed[k]) return;
      let picked=null;
      if(spellPicks(s)){ // 対象の1騎を選ぶ（uid がなければ選択待ちにする）
        picked=uid&&U(uid);
        if(!picked||picked.master||picked.pid!==G.cur||picked.out){ G.spellPick={i:k}; return; }
      }
      G.spellPick=null;
      const top=Object.entries(G.alloc).filter(([,n])=>n>0).sort((a,b)=>b[1]-a[1])[0];
      G.alloc[top[0]]--; log(`令呪を使用：行動回数-1（${dn(U(top[0]))}）・残り${P.spellLeft-1}画`,'sub');
      if(!useSpell(m,k,picked)) masterDone(); return;
    }
    if(now){
      const s=D(m.def).spells[Number(i)]; if(!s||P.stars<need) return;
      P.stars-=need; log(`${esc(P.name)}：${TERMS.star}${need}個（クリティカルLv4）を消費して令呪を即時発動`,'sub');
      if(!useSpell(m,Number(i))) masterDone(); return;
    }
    P.spell='decl'; G.mastered=true;
    log(`${esc(P.name)}：令呪を宣言（このターンの以降のフェイズをスキップ。次の${TERMS.player}フェイズで発動）`,'good');
    fxEmit({t:'pop',uid:m.uid,text:'令呪宣言',cls:'asc'});
    endPhase();
  },
  // 宣言済みの令呪を使う（次のターンのマスターフェイズ）
  masterSpellUse({i}){
    const m=masterReady(); if(!m||G.players[G.cur].spell!=='decl'||!D(m.def).spells[Number(i)]) return;
    if(!useSpell(m,Number(i))) masterDone();
  },
  // 退避：次の相手ターン、相手マスターの通常攻撃と、サーヴァントの全体攻撃を受けない
  masterEvac(){
    const m=masterReady(); if(!m||mTeam()) return;
    G.players[G.cur].evac=true; log(`${MASTER_ACTS.evac}：${nm(m)}は次の相手ターンの間、退避する`,'good');
    fxEmit({t:'pop',uid:m.uid,text:MASTER_ACTS.evac,cls:'heal'});
    masterDone();
  },
  // 守る側の選択（G.guard）。spell：令呪でマスターへの攻撃を防ぐか / svt：サーヴァントの攻撃をどちらで受けるか
  guard({to}){
    if(G.phase!=='guard'||!G.guard) return;
    const g=G.guard, dp=1-G.cur, em=masterOf(dp);
    if(g.kind==='spell'){
      G.guard=null; G.phase='master';
      if(to==='block'){ G.players[dp].spellLeft--; log(`${esc(G.players[dp].name)}：令呪1画で${TERMS.unit}が${nm(em)}を守った（ダメージ無効）`,'good'); fxEmit({t:'dmg',uid:em.uid,text:'令呪'}); }
      else fixedHit(masterOf(G.cur),em,g.dmg);
      masterDone(); return;
    }
    if(g.kind==='svt'){
      const s=alive(dp)[0];
      G.target = to==='master'&&em&&!em.out ? em.uid : s.uid;
      log(`${esc(G.players[dp].name)}：${nm(U(G.target))}で受ける`,'sub');
      G.guard=null; G.phase='target'; resolveDamage();
    }
  },
  useSkill({uid,si}){
    si=Number(si); const u=U(uid), s=D(u.def).skills[si];
    if(G.phase!=='skill'||G.pending||u.pid!==G.cur||!canSkill(u)||u.used[si]||(si===2&&!u.asc)) return;
    if(s.pick){ G.pending={uid,si}; return; }
    doSkill(u,si,null);
  },
  cancelPick(){ G.pending=null; G.spellPick=null; },
  useUlt({uid}){
    const u=U(uid);
    if(G.phase!=='skill'||G.pending||G.ult||G.ultDone||u.pid!==G.cur||!canUlt(u)||u.np<RULES.ultCost) return;
    if(masterRule()&&!D(u.def).ult.eff.some(e=>e.k==='dmg')){
      // マスタールール：ダメージのない宝具は、行動回数-1でその場で使い、スキルフェイズを続けて行動決定へ進める
      u.np=0; G.ultDone=true; resolveUlt(u,null);
      const top=Object.entries(G.alloc).filter(([,n])=>n>0).sort((a,b)=>b[1]-a[1])[0];
      if(top){ G.alloc[top[0]]--; log(`補助${TERMS.ult}のため行動回数-1（${dn(U(top[0]))}）`,'sub'); }
      flushKo(); checkWin(); return;
    }
    G.ult=uid; u.np=0;
    log(`${nm(u)}が${TERMS.ult}「${esc(D(u.def).ult.name)}」を使用（このターンの行動になります）`,'good');
  },
  skillDone(){
    if(G.phase!=='skill'||G.pending) return;
    if(G.ult) toTargetPhase();
    else { G.phase='action'; log(`${PN(4)} 行動決定`,'h'); phaseFx('COMMAND','行動決定'); }
  },
  rollAction({uid}){
    const u=U(uid);
    if(G.phase!=='action'||G.copy||u.out) return;
    if(G.rolled.filter(r=>r.uid===uid).length>=(G.alloc[uid]||0)) return;
    const f=roll(), face=D(u.def).faces[f];
    let cmd;
    const asc=!u.asc && face.pre.c==='ASC';
    cmd=asc?face.pre:u.asc?face.post:face.pre;
    // カード変換：R/B/G のコマンドを指定色に（同じ色なら回数を使わない）
    const cv=u.fx.find(e=>e.k==='cardConv'&&e.color&&['R','B','G'].includes(cmd.c)&&cmd.c!==e.color);
    if(cv){ const from=cmd.c; cmd={...cmd,c:cv.color}; consume(u,[cv]); log(`${nm(u)} カード変換：${TERMS[from]} → ${TERMS[cv.color]}`,'sub'); }
    G.rolled.push({uid,f,cmd}); u.face={i:f,kind:'cmd',cmd};
    rollFx(uid,f,{cmd,keys:[`f:${uid}`,`r:${G.rolled.length-1}`]});
    if(asc) ascend(u);
    log(`${nm(u)} 出目${f+1} → ${cmdChip(cmd)}`);
    // 他のサーヴァントをロール：ロールするサーヴァントの選択待ち
    if(isCopyCmd(cmd) && copyCands(u).length) G.copy={idx:G.rolled.length-1, uid};
  },
  toTarget(){ if(G.phase==='action'&&!G.copy&&remainingRolls()===0) toTargetPhase(); },
  cardClick({uid}){
    const u=U(uid);
    if(G.copy){ const c=U(G.copy.uid); if(copyCands(c).includes(u)) doCopy(c.uid,u); return; }
    if(G.spellPick){ if(u&&!u.master&&u.pid===G.cur&&!u.out) ACTIONS.masterSpell({i:G.spellPick.i,uid}); return; } // 令呪の対象
    if(G.pending){ if(pickValid(u)){ const p=G.pending; G.pending=null; doSkill(U(p.uid),p.si,u); } return; }
    if(G.phase==='target' && G.targetAll){ if(u.pid!==G.cur&&!u.out&&!isCpu(G.cur)) resolveDamage(); return; } // 全体宝具：敵を押すと発動
    if(G.phase==='target' && targetCandidates().includes(u)){
      if(G.target===uid && !isCpu(G.cur)) ACTIONS.resolve(); // 選択中の相手をもう一度押すと確定
      else G.target=uid;
    }
    else if(G.phase==='target' && u && masterTargetable()===u){ if(G.target===uid && !isCpu(G.cur)) ACTIONS.resolve(); else G.target=uid; }
  },
  resolve(){
    if(G.phase!=='target'||!G.target) return;
    // マスタールール：マスターを攻撃対象にしたら、守る側がサーヴァントとマスターのどちらで受けるか選ぶ
    if(U(G.target).master){ if(masterTargetable()!==U(G.target)) return; G.guard={kind:'svt'}; G.phase='guard'; return; }
    resolveDamage();
  },
  endTurn(){ if(G.phase==='end') endPhase(); },
};
function act(type,p={}){
  if(!ACTIONS[type]) return;
  if(G.phase==='over' && !['restart','rematch','toggleSpeed','useDefaultData'].includes(type)) return;
  ACTIONS[type](p);
  render();
}
