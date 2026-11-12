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

// 実験用：マスターチームの令呪が行動回数を使わない（0=従来 / 1=使わず、使うとそのターンの補助は無し / 2=使わず、補助とも併用・続けて何度でも）
let SPELL_FREE = 0;
let G;
function newGame(o={}){
  G = { phase:'mode', mode:null, rule:o.rule||'team', handicap:o.handicap??true, cpu:[false,false], level:'normal', speed:(typeof window!=='undefined'&&window.SPEED_PREF)||700, seed:String(Math.random()),
    setupPid:0, picks:[[],[]], mpicks:[null,null], setupMsg:'',
    // master：マスタールールのマスター（makeMaster）。spell：令呪 null/'decl'(宣言済み・次のマスターフェイズで使う)/'used'
    // evac：退避中（次の相手ターンの間） / zeroNext：前のターンの行動回数が0だった（次の行動回数+1）
    players:[{name:TERMS.player+'1',party:[],stars:0,master:null,spell:null,evac:false,zeroNext:false},{name:TERMS.player+'2',party:[],stars:0,master:null,spell:null,evac:false,zeroNext:false}],
    cur:0, turn:0, actRolled:false, maxActs:{}, alloc:{}, rolled:[], ult:null, target:null,
    gen:0, pending:null, copy:null, guard:null, hcap:null, mastered:false, ultDone:false, ultNp:null, log:[], winner:null, dealt:[0,0],
    // リザルト用の記録：stats＝ユニットごと（uid） / tl＝ターンごとの与ダメージ [P1,P2] / chains＝陣営ごとのチェイン回数 / starsGen＝発生スター合計
    stats:{}, tl:[], chains:[{R:0,B:0,G:0,brave:0},{R:0,B:0,G:0,brave:0}], starsGen:[0,0] };
  FXQ.length=0; for(const k in FXHOLD) delete FXHOLD[k]; FXHIDE.clear(); KO_PEND.length=0;
}

// ---------- 演出イベント ----------
// セリフ・ダメージ表示・宝具カットインを FXQ に積み、画面側（fx.js）が順番に再生する。ルール処理には影響しない
const FXQ=[];
// 表示用のHP：ダメージ演出が再生されるまで、画面には攻撃前のHPを出しておく（{uid:{hp,out}}）。
// fx.js がダメージ演出を1つ再生するたびに更新し、そのユニットの演出が無くなったら消す
// HP のほか NPゲージ・効果（バフ/デバフ）の表示も同じ仕組みで遅らせる：{hp,np,fx,out,ko}
const FXHOLD={};
// act() の開始時点の表示状態（演出で「変化前」を出すための基準）と、最後に積んだ sync の内容
let PRE={}, SYNCED={};
const cloneFx = fx=>fx.map(e=>({...e}));
const viewSig = u=>JSON.stringify([u.hp,u.np,u.fx.map(e=>[e.k,e.v,e.turns,e.times,e.color])]);
function snapPre(){
  PRE={}; SYNCED={};
  ALLM().forEach(u=>{ PRE[u.uid]={hp:u.hp,np:u.np,fx:cloneFx(u.fx)}; SYNCED[u.uid]=viewSig(u); });
}
// 変化前の表示状態で、そのユニットの表示を固定する（まだ無ければ）
function holdOf(uid){
  if(uid in FXHOLD) return;
  const u=U(uid), b=PRE[uid]||(u&&{hp:u.hp,np:u.np,fx:cloneFx(u.fx)});
  if(b) FXHOLD[uid]={hp:b.hp,np:b.np,fx:cloneFx(b.fx),out:false};
}
function fxEmit(ev){
  if((ev.t==='dmg'&&ev.hp!=null)||ev.t==='sync'){
    holdOf(ev.uid);
    if(ev.t==='dmg'&&FXHOLD[ev.uid]&&!FXQ.some(e=>e.uid===ev.uid&&(e.t==='sync'||(e.t==='dmg'&&e.hp!=null)))) FXHOLD[ev.uid].hp=ev.hp0;
  }
  FXQ.push(ev);
}
// NP・効果・HPが変わったことを演出に積む。画面の表示は、この演出が再生されたときに変わる
function syncU(u){
  if(!u||u.out) return;
  const sig=viewSig(u); if(SYNCED[u.uid]===sig) return;
  SYNCED[u.uid]=sig;
  fxEmit({t:'sync',uid:u.uid,hp:u.hp,np:u.np,fx:cloneFx(u.fx)});
}
// 出目の表示待ち：ロール演出が着地するまで画面に結果を出さないもの（'f:<uid>'=肖像の出目 / 'r:<idx>'=コマンド列の1枚）
const FXHIDE=new Set();
// o.w を付けると、次の演出までの待ち時間をその値にする（重ねて見せたいとき）
// o.own：スキル・鉛筆の面の専用セリフ（あれば key の通常セリフの代わりに使う）
// o.other：その場面の相手（攻撃の対象・攻撃してきた相手・スキルの対象）。条件つきセリフ（condLines）の判定に使う
function say(u,key,o={}){ const {own,other,...r}=o; let t='';
  if(!(own&&own.length)){ const hit=condLineFor(u,key,other); if(hit) t=pickLine(null,key,hit.lines); }
  if(!t) t=pickLine(D(u.def),key,own);
  if(t) fxEmit({t:'say',uid:u.uid,key,text:t,...r}); }
// 条件つきセリフ：場面 key に合い、条件を満たす最初のもの（なければ null）
function condLineFor(u,key,other){
  const cl=(D(u.def)||{}).condLines; if(!cl||!cl.length) return null;
  return cl.find(c=>{
    if(c.key!==key) return false;
    switch(c.who){
      case 'self': return condOk(c.cond,u);
      case 'ally': return alive(u.pid).some(a=>a!==u&&condOk(c.cond,a));
      case 'enemy': { const al=alive(1-u.pid); return (al.length?al:G.players[1-u.pid].party).some(a=>condOk(c.cond,a)); } // 決着後（敵が全滅）は敵の編成全体で見る
      default: return !!other&&condOk(c.cond,other);
    }
  })||null;
}
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
const canUlt = u=>!u.out&&!disabled(u)&&!has(u,'sealUlt')&&(!D(u.def).ult.pick||skillCands(u,D(u.def).ult).length>0); // 対象を選ぶ宝具は、選べる相手がいること
const fmt = n=>Number.isInteger(n)?n:Math.round(n*10)/10;
const dn = u=>esc(D(u.def).name);
const nm = u=>`<span class="p${u.pid}">${dn(u)}</span>`;
const log = (msg,cls='')=>G.log.push({msg,cls});
const sumCost = ids=>ids.reduce((s,id)=>s+D(id).cost,0);
const totalAlloc = ()=>Object.values(G.alloc).reduce((a,b)=>a+b,0);
// 行動回数は必ず使い切る：割り振る合計は「最大行動回数の合計」と上限（actionsMax）の小さい方ちょうど
const requiredAlloc = ()=>Math.min(RULES.actionsMax, Object.values(G.maxActs).reduce((a,b)=>a+b,0));
const remainingRolls = ()=>Object.entries(G.alloc).reduce((s,[uid,n])=>U(uid).out?s:s+n-G.rolled.filter(r=>r.uid===uid).length,0);
// マスターチーム：自軍マスターのコストに応じた、サーヴァント全員への常時補正 {atk,hp}（基準 RULESETS.mteam.costBonus.base のコストでは 0）。
// fx ではないので、強化解除・弱体解除・弱体状態特攻の対象にならない。マスター自身・マスターチーム以外では null
function costBonus(u){
  const b=ruleset().costBonus; if(!b||!u||u.master||u.pid==null||!G.mpicks||!G.mpicks[u.pid]) return null;
  const n=mcost(u.pid)-b.base; return n?{atk:n*b.atk,hp:n*b.hp,n}:null;
}
const costBonusText = u=>{ const c=costBonus(u); return c?`攻撃ダメージ${c.atk>0?'+':''}${c.atk}・最大HP${c.hp>0?'+':''}${c.hp}`:''; };
function makeUnit(pid,idx,id){ return {uid:`p${pid}u${idx}`,pid,idx,def:id,hp:D(id).hp,np:0,asc:false,out:false,used:[false,false,false],fx:[],face:null}; }
// マスター：サーヴァントと同じ形（fx・hp・out）にして、効果やダメージの処理を共用する。out＝瀕死
function makeMaster(pid,id){ return {uid:`p${pid}m`,pid,idx:-1,def:id,hp:D(id).hp,np:0,asc:false,out:false,used:[],fx:[],face:null,master:true}; }
// 宝具に「攻撃対象」を使う効果がない（全体宝具・補助宝具）なら、対象を選ばず敵全体が対象
const ultNoTarget = u=>!D(u.def).ult.eff.some(e=>e.t==='target');
function targetCandidates(){ const es=alive(1-G.cur); const t=es.filter(u=>has(u,'taunt')); return t.length?t:es; }
function pendingSkill(){ return G.pending ? (G.pending.ult ? D(U(G.pending.uid).def).ult : D(U(G.pending.uid).def).skills[G.pending.si]) : null; } // 宝具の対象選びも同じ pending を使う（ult:true）
// スキルの対象に選べるか（pick：ally=味方 / other=自分以外の味方 / enemy=敵 / any=敵味方）
function skillPickOk(user,s,u){
  if(!u||u.out||u.master) return false;
  if(s.pick==='ally') return u.pid===user.pid;
  if(s.pick==='other') return u.pid===user.pid&&u.uid!==user.uid;
  if(s.pick==='enemy') return u.pid!==user.pid;
  return true;
}
const skillCands = (user,s)=>ALL().filter(u=>skillPickOk(user,s,u));
function pickValid(u){ const s=pendingSkill(); return !!s&&skillPickOk(U(G.pending.uid),s,u); }
// スキルを今使えるか（対象を選ぶスキルは、選べる相手がいること。例：1騎だけのときの「自分以外の味方」）
function skillUsable(u,si){
  const s=D(u.def).skills[si];
  return !!s&&canSkill(u)&&!u.used[si]&&(si<2||u.asc)&&(!s.pick||skillCands(u,s).length>0);
}
// 連続攻撃の回数（コマンド・宝具の効果の multiHit。なければ1、最大10）
const hitsOf = effs=>Math.min(10,Math.max(1,...(effs||[]).filter(e=>e.k==='multiHit').map(e=>Math.floor(e.v)||1)));
// 効果の値（max なら対象の最大HP）
const effVal = (e,t)=>e.max&&t?maxHp(t):e.v;
// 全体にかかる効果の呼び名（スキル演出の「→ 全体」）
function allLabel(effs){
  const ts=new Set(effs.filter(e=>FX[e.k]&&!FX[e.k].noTgt).map(e=>e.t)), a=ts.has('ally_all')||ts.has('ally_other'), en=ts.has('enemy_all')||ts.has('enemy_both');
  return a&&en?'全体':a?'味方全体':en?'敵全体':'';
}
function mods(u,k,color){
  const list=u.fx.filter(e=>e.k===k && (!color || !e.color || e.color===color));
  return {sum:list.reduce((s,e)=>s+e.v,0), list};
}
// 条件つきの効果を含む mods：相手 other が条件を満たすものだけ数える（other なしなら条件つきは数えない）
function modsC(u,k,color,other){
  const list=u.fx.filter(e=>e.k===k && (!color || !e.color || e.color===color) && (!e.cond||condOk(e.cond,other)));
  return {sum:list.reduce((s,e)=>s+e.v,0), list};
}
function consume(u,list){
  list.forEach(e=>{ if(e.times!=null) e.times--; });
  u.fx=u.fx.filter(e=>e.times==null||e.times>0);
}
// 被弾時にNPが増えなくなる弱体（呪い・被弾NP上昇封印）。回数があるものを先に使う
const npSealFx = u=>u.fx.find(e=>e.k==='curse')||u.fx.find(e=>e.k==='hitNpSeal'&&e.times!=null)||u.fx.find(e=>e.k==='hitNpSeal');
const dotVal = e=>e.v||RULES.dot; // 毒・やけどの値（0は旧データなので RULES.dot）
function addNp(u,v){ if(!u.out) u.np=Math.max(0,Math.min(RULES.gaugeMax,u.np+v)); }
// 最大HP（定義のHP＋最大HP+の合計）。最大HP+が切れたら HP を最大値まで下げる（1未満にはしない）
const maxHp = u=>D(u.def).hp+mods(u,'maxHp').sum+(costBonus(u)?costBonus(u).hp:0);
function clampHp(u){ if(!u.out&&u.hp>maxHp(u)) u.hp=Math.max(1,maxHp(u)); }
// スターの獲得：手番側はこのターンの発生スター（G.gen）、相手側は手持ちに直接加える
function gainStars(pid,v){ if(pid===G.cur) G.gen+=v; else G.players[pid].stars+=v; }
// ---------- リザルト用の記録 ----------
function st(u){
  const S=G.stats||(G.stats={});
  return S[u.uid]||(S[u.uid]={dealt:0,taken:0,maxHit:0,kills:0,attacks:0,crits:0,ults:0,skills:0,blocked:0});
}
// ダメージの記録。src＝与えた側（なければ毒など）。real＝実際に減ったHP / raw＝ダメージの値 / ko＝これで倒れた
function recDmg(src,u,real,raw,ko){
  st(u).taken+=real;
  if(src&&src.pid===u.pid) return; // 自傷・味方からのダメージは与ダメージに数えない
  G.dealt[1-u.pid]+=real;
  const tl=G.tl||(G.tl=[]), row=tl[G.turn]||(tl[G.turn]=[0,0]); row[1-u.pid]+=real;
  if(src){ const s=st(src); s.dealt+=real; s.maxHit=Math.max(s.maxHit,raw); if(ko) s.kills++; }
}

// =====================================================================
// 効果の適用
// =====================================================================
// 条件（Eff.cond）を満たすか。s＝見る相手（なければ満たさない）
function condOk(c,s){
  if(!c) return true;
  if(!s) return false;
  let r=false;
  switch(c.k){
    case 'trait': r=traitsOf(s).includes(c.v); break;
    case 'cls': r=((D(s.def)||{}).cls)===c.v; break;
    case 'id': r=s.def===c.v; break;
    case 'fx': r=s.fx.some(x=>c.v==='*debuff'?FX[x.k].buff===false:c.v==='*buff'?FX[x.k].buff===true:x.k===c.v); break;
    case 'hpBelow': r=s.hp<=maxHp(s)*c.v/100; break;
    case 'hpAbove': r=s.hp>=maxHp(s)*c.v/100; break;
    case 'npFull': r=s.np>=RULES.ultCost; break;
  }
  return c.not?!r:r;
}
// 条件を付与時に見る効果か（ダメージ計算で相手を見る condUse 以外）
const condAtApply = e=>!!e.cond&&(!!e.cond.self||!(FX[e.k]&&FX[e.k].condUse)); // cond.self＝付与先自身を見る
function resolveTargets(src,t,picked){
  let ts=[];
  const m=masterOf(src.pid), em=masterOf(1-src.pid);
  if(t==='self') ts=[src];
  else if(t==='picked') ts=picked?[picked]:[];
  else if(t==='ally_all') ts=[...alive(src.pid),...(m?[m]:[])]; // マスタールール：味方全体の効果はマスターにも
  else if(t==='ally_other') ts=alive(src.pid).filter(u=>u.uid!==src.uid); // 自分以外の味方全体（マスターは含まない）
  else if(t==='enemy_all') ts=alive(1-src.pid);
  else if(t==='target') ts=G.target?[U(G.target)]:[];
  else if(t==='svt') ts=picked&&picked.pid===src.pid?[picked]:alive(src.pid); // マスターチームの令呪は選んだ1騎
  else if(t==='ally_svt') ts=picked&&!picked.master&&picked.pid===src.pid?[picked]:[]; // マスターが選んだ自軍1騎
  else if(t==='enemy_master') ts=em?[em]:[];
  else if(t==='enemy_both') ts=[...alive(1-src.pid),...(em?[em]:[])]; // マスターの補助・令呪：敵サーヴァント全員＋敵マスター
  else if(t==='enemy_svt') ts=picked&&!picked.master&&picked.pid!==src.pid?[picked]:[]; // マスターが選んだ敵1体
  return ts.filter(u=>u&&!u.out);
}
// 確率の判定（chance）：対象ごとに別々にロールする（全体効果なら1体ずつ判定）
function chanceRoll(e,who,need=e.chance){
  const r=roll()+1, ok=r<=need;
  rollFx(who.uid,r-1,{ch:{need,ok}});
  log(`判定ロール（${nm(who)}）出目${r} ≤ ${need} → ${ok?'成功':'失敗'}`, ok?'':'sub');
  return ok;
}
// 弱体の成功率：敵に付ける弱体の判定は、弱体成功率アップ(+x)／ダウン(-x)でロールの基準値をずらす（0〜6）。
// 「必ず」の弱体はロール6以下として扱うので、ダウンがあるときだけ失敗しうる。アップは確率つきの弱体にだけ効く
function debuffRate(src,e){
  if(!(FX[e.k]&&FX[e.k].buff===false)) return null;
  const up=mods(src,'debuffUp'), dn=mods(src,'debuffDown');
  return (up.list.length||dn.list.length)?{up:up.sum,dn:dn.sum,list:[...up.list,...dn.list],used:false}:null;
}
// o.tmp：マスターの補助（このターンだけ）。付いた効果は終了フェイズで消える
function applyEffects(src,effs,picked,o={}){
  for(const e of effs){
    if(FX[e.k]&&FX[e.k].noTgt) continue; // 連続攻撃・説明文は効果を持たない（連続攻撃は攻撃側で使う）
    if(e.t==='master'){
      if(condAtApply(e)&&!condOk(e.cond,src)) continue;
      if(e.chance&&!chanceRoll(e,src)) continue;
      if(e.k==='star'||e.k==='starLoss') changeStars(src.pid,e.k==='star'?e.v:-e.v);
      continue;
    }
    const rate=debuffRate(src,e);
    resolveTargets(src,e.t,picked).forEach(t=>{
      if(condAtApply(e)&&!condOk(e.cond,t)){ log(`${nm(t)}：条件（${condText(e.cond)}）を満たさないため「${FX[e.k].name}」は効果なし`,'sub'); return; }
      if(rate&&t.pid!==src.pid&&(e.chance||rate.dn)){ // 敵への弱体：成功率アップ／ダウンで判定をずらす
        rate.used=true;
        const need=Math.max(0,Math.min(6,(e.chance||6)+rate.up-rate.dn));
        if(need<6&&!chanceRoll(e,t,need)) return;
      } else if(e.chance&&!chanceRoll(e,t)) return;
      if(e.k==='dmg'){ if(src.master) fixedHit(src,t,effVal(e,t)); return; } // 宝具のダメージは resolveUlt で処理
      applyOne(src,t,e,o);
    });
    if(rate&&rate.used) consume(src,rate.list); // 判定に使ったら回数を1消費（全体効果でも1回）
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
  // 種類指定つき（vs）は、その効果だけ防ぐ。指定なしはすべて防ぐ
  const matches=x=>x.k===guard&&(!x.vs||x.vs===k);
  if(FX[k].mental&&!t.fx.some(matches)&&t.fx.some(x=>x.k==='mentalImmune')) guard='mentalImmune';
  const g=guard&&t.fx.find(guard==='mentalImmune'?(x=>x.k===guard):matches); if(!g) return false;
  consume(t,[g]); log(`${nm(t)}は${FX[guard].name}で「${FX[k].name}」を防いだ`,'sub');
  return true;
}
// 戦闘不能：ルール上はその場で倒れるが、画面で暗くするのは一連の攻撃が終わってから（flushKo）
const KO_PEND=[];
function retreat(u){ u.hp=0; u.out=true; u.fx=[]; log(`${nm(u)} ${TERMS.out}`,'bad'); KO_PEND.push(u.uid); }
// 攻撃・スキル・終了フェイズの処理が終わったところで呼ぶ：戦闘不能の演出とセリフをまとめて出す
function flushKo(){
  settleGuts();
  if(!KO_PEND.length) return;
  const uids=KO_PEND.splice(0);
  fxEmit({t:'ko',uids});
  uids.forEach(uid=>say(U(uid),'defeat'));
}
// ガッツ：HPが0になっても、その一連の攻撃（ダメージフェイズ・スキル・終了フェイズなど）が終わるまではHP0のまま踏みとどまる。
// その間に攻撃されてもオーバーキルにはならない。終わったところ（flushKo）で、ガッツの値までHPが戻る
function gutsHold(u){
  const g=u.fx.find(e=>e.k==='guts'); if(!g) return false;
  if(!g.fired){ g.fired=true; log(`${nm(u)} ガッツ！ 一連の攻撃が終わるまで踏みとどまる`,'good'); fxEmit({t:'pop',uid:u.uid,text:FX.guts.name,cls:'asc'}); }
  return true;
}
function settleGuts(){
  ALL().forEach(u=>{
    if(u.out) return;
    const g=u.fx.find(e=>e.k==='guts'&&e.fired);
    if(g){
      u.fx=u.fx.filter(e=>e!==g);
      if(u.hp<=0){ u.hp=Math.min(g.v,maxHp(u))||1; log(`${nm(u)} ガッツ発動！ HP${u.hp}で復帰`,'good'); fxEmit({t:'pop',uid:u.uid,text:`HP${u.hp}`,cls:'heal'}); }
      syncU(u);
    } else if(u.hp<=0) retreat(u); // 踏みとどまっている間にガッツを解除された
  });
}
function applyOne(src,t,e,o={}){ applyOne0(src,t,e,o); syncU(t); }
function applyOne0(src,t,e,o={}){
  if(t.master&&mTeam()&&FX[e.k].buff===false){ log(`${nm(t)}は${TERMS.unit}に守られていて弱体を受けない`,'sub'); return; } // マスターチーム：マスターは弱体を受けない
  if(!e.sure&&immuneTo(t,e.k)) return; // sure＝強化無効・弱体無効で防がれない
  { // 即時効果への無効（強化解除・即死・NP減少・スター消失）。NP減少・スター消失は敵からのものだけ防ぐ
    const hostile=src&&src.pid!==t.pid;
    const gk=e.k==='strip'?'stripImmune':e.k==='instantDeath'?'deathImmune':e.k==='np'&&e.v<0&&hostile?'npDownImmune':e.k==='starLoss'&&hostile?'starLossImmune':null;
    const g=gk&&t.fx.find(x=>x.k===gk);
    if(g){ consume(t,[g]); log(`${nm(t)}は${FX[gk].name}で「${FX[e.k].name}」を防いだ`,'sub'); return; }
  }
  switch(e.k){
    case 'heal': if(has(t,'healBlock')){ log(`${nm(t)}は回復無効でHPが回復しない`,'sub'); return; }
      t.hp=Math.min(maxHp(t),t.hp+e.v); log(`${nm(t)} HP${e.v}回復`,'good'); return;
    case 'np': addNp(t,e.v); log(`${nm(t)} ${TERMS.gauge}${e.v>=0?'+':''}${e.v}%`); return;
    case 'star': changeStars(t.pid,e.v); return;
    case 'starLoss': changeStars(t.pid,-e.v); return;
    case 'cleanse': { // vs 指定ならその弱体だけ解除
      const nmv=e.vs&&FX[e.vs]?`「${FX[e.vs].name}」`:'弱体';
      t.fx=t.fx.filter(x=>x.sure||FX[x.k].buff!==false||(e.vs&&x.k!==e.vs)); log(`${nm(t)}の${nmv}を解除`,'good'); return;
    }
    case 'cleanseMental': t.fx=t.fx.filter(x=>x.sure||!FX[x.k].mental); log(`${nm(t)}の精神異常を解除`,'good'); return;
    case 'strip': {
      const nmv=e.vs&&FX[e.vs]?`「${FX[e.vs].name}」`:'強化';
      t.fx=t.fx.filter(x=>x.sure||FX[x.k].buff!==true||(e.vs&&x.k!==e.vs)); clampHp(t); log(`${nm(t)}の${nmv}を解除`,'bad'); return;
    }
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
      const g=has(t,'guts');
      fxEmit({t:'dmg',uid:t.uid,text:FX.instantDeath.name,hp0:t.hp,hp:0,out:!g});
      t.hp=0; if(!gutsHold(t)) retreat(t); return;
    }
    case 'selfDmg': { const v=effVal(e,t); log(`${nm(t)} ${FX.selfDmg.name} <b>${fmt(v)}</b>${e.max?'（最大HP・軽減不可）':''}`,'bad'); dealDamage(t,v,false,{src:t}); return; }
    case 'dmg': case 'multiHit': case 'desc': return; // 宝具側で処理 / 効果なし
  }
  if(e.k==='guts') t.fx=t.fx.filter(x=>x.k!=='guts'); // ガッツは重複不可
  if(e.k==='curse'){ // 呪いは回数のみ。重ねると回数が増える
    const n=e.times||1, c=t.fx.find(x=>x.k==='curse');
    if(c){ c.times+=n; log(`${nm(t)}の呪いが${c.times}回に`,'bad'); return; }
    if(c&&e.sure) c.sure=true;
    const inst={k:'curse',v:0,color:null,turns:null,times:n,owner:src.pid};
    if(e.sure) inst.sure=true;
    t.fx.push(inst); log(`${nm(t)}に ${fxText(inst)}`,'bad'); return;
  }
  const inst={k:e.k,v:e.v,color:e.color||null,turns:e.turns??null,times:e.times??null,owner:src.pid};
  if(e.vs) inst.vs=e.vs;
  if(e.sure) inst.sure=true; // 解除・無効の影響を受けない（ターン・回数では切れる）
  if(e.trait) inst.trait=e.trait;
  if(e.cond&&!e.cond.self) inst.cond=e.cond; // 条件つき（使う瞬間に見る効果はダメージ計算で判定）
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
  const hp0=u.hp, ko=hp0-dmg<=0, g=ko&&has(u,'guts');
  const hp1=ko?0:hp0-dmg;
  fxEmit({t:'dmg',uid:u.uid,v:fmt(dmg),crit:!!o.crit,np:!!o.np,hp0,hp:hp1,out:ko&&!g});
  recDmg(o.att||o.src,u,Math.min(dmg,Math.max(0,hp0)),dmg,ko&&!g&&hp0>0);
  u.hp=hp1;
  if(ko){ if(!gutsHold(u)){ retreat(u); return; } } // ガッツ：一連の攻撃が終わるまでHP0で踏みとどまる
  if(isHit){
    // 被ダメージ時○○ はここではなく、攻撃対象になったターンの終了フェイズ（hitEffects）で発動する
    const c=npSealFx(u);
    if(c){ consume(u,[c]); log(`${nm(u)}は${FX[c.k].name}で${TERMS.gauge}が増えない`,'sub'); }
    else addNp(u,npRate(u,RULES.gaugeOnHit));
    // 反撃：攻撃側へ固定ダメージ（補正・無敵・回避・クリティカルの影響なし、NPは増えない）
    const ct=mods(u,'counter'), a=o.att;
    if(ct.sum&&a&&!a.out){
      log(`${nm(u)}の反撃！ ${nm(a)}に<b>${ct.sum}</b>ダメージ`,'good');
      consume(u,ct.list); dealDamage(a,ct.sum,false,{src:u});
    }
  }
  syncU(u);
}
// マスターへのダメージ：HPが0になったら瀕死（以降はマスターフェイズなし）。自軍サーヴァントがマスターの最大HP分のダメージを受ける
function masterHit(m,dmg,o={}){
  const hp0=m.hp, hp1=Math.max(0,hp0-dmg);
  fxEmit({t:'dmg',uid:m.uid,v:fmt(dmg),crit:!!o.crit,np:!!o.np,hp0,hp:hp1,out:hp1<=0});
  recDmg(o.att||o.src,m,Math.min(dmg,hp0),dmg,hp1<=0&&hp0>0);
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
  dealDamage(t,v,false,{src});
}
// 攻撃側の補正（被ダメージ減少無視なら相手の def を見ない）。使った効果も返す
function dmgMods(att,tgt,color){
  const a=modsC(att,'atk',color,tgt), ad=modsC(att,'atkDown',null,tgt);
  // ハンデの攻撃ダメージ+ も足す
  let sum=a.sum-ad.sum+(hasHcap(att)?G.hcap.atk:0)+(costBonus(att)?costBonus(att).atk:0); const usedA=[...a.list,...ad.list], usedT=[];
  if(tgt&&!tgt.out){
    // 弱体状態特攻：対象が指定の弱体（vs 未指定なら何か1つ）を受けていれば加算
    const vs=att.fx.filter(e=>e.k==='atkVs'&&tgt.fx.some(x=>e.vs?x.k===e.vs:FX[x.k].buff===false));
    if(vs.length){ sum+=vs.reduce((s,e)=>s+e.v,0); usedA.push(...vs); }
    // 属性特攻：対象が属性 trait を持っていれば加算
    const tt=traitsOf(tgt), at=att.fx.filter(e=>e.k==='atkTrait'&&tt.includes(e.trait));
    if(at.length){ sum+=at.reduce((s,e)=>s+e.v,0); usedA.push(...at); }
    const dd=modsC(tgt,'defDown',null,att); sum+=dd.sum; usedT.push(...dd.list);
    const ig=att.fx.find(e=>e.k==='ignoreDef');
    if(ig){ if(modsC(tgt,'def',null,att).list.length) usedA.push(ig); }
    else { const df=modsC(tgt,'def',null,att); sum-=df.sum; usedT.push(...df.list);
      // 属性特防：攻撃してきた相手が属性 trait を持っていれば減算（被ダメージ減少無視なら見ない）
      const ta=traitsOf(att), dt=tgt.fx.filter(e=>e.k==='defTrait'&&ta.includes(e.trait));
      if(dt.length){ sum-=dt.reduce((s,e)=>s+e.v,0); usedT.push(...dt); } }
  }
  // 色指定のある攻撃ダメージ+（色バフ）の合計：クリティカルで2倍
  const colorBuff=a.list.filter(e=>e.color).reduce((s,e)=>s+e.v,0);
  return {sum, usedA, usedT, colorBuff};
}
// スター発生数ダウン(starDown)：1回の攻撃で発生するスターの合計から x 個引く（0未満にはしない）。返り値＝まだ引き切れていない分
function gainNpStar(att,cmd,mult){
  if(cmd.np) addNp(att,npRate(att,cmd.np*mult));
  let cut=mods(att,'starDown').sum;
  if(cmd.star){ const v=cmd.star*mult, g=Math.max(0,v-cut); cut=Math.max(0,cut-v); G.gen+=g; }
  return cut;
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
// 攻撃1回ぶん（補正 → Busterチェイン → クリティカル → 最終ダメージ → NP・スター → 攻撃時○○）。lab はログの「（2/3）」など
function attackHit(att,cmd,tgt,o,lab){
  const n=nm(att)+lab, sa=st(att);
  let dmg=cmd.dmg; const note=[`基本${dmg}`]; let usedA=[], usedT=[], colorBuff=0;
  sa.attacks++;
  // 2. スキル効果補正 / 3. Busterチェイン
  if(!o.extra){
    const m=dmgMods(att,tgt,cmd.c); usedA=m.usedA; usedT=m.usedT; colorBuff=m.colorBuff;
    if(m.sum){ dmg=Math.max(0,dmg+m.sum); note.push(`補正${m.sum>0?'+':''}${m.sum}`); }
    if(o.chain==='R'){ dmg+=RULES.chainR; note.push(`チェイン+${RULES.chainR}`); }
  } else note.push('エクストラ：補正なし');
  // 4. クリティカル（クラス相性はなし）：スターがあれば1d100で判定。成功でダメージ+30（Buster+60）、色バフ2倍
  let crit=false;
  if(!o.extra){
    const stars=G.players[att.pid].stars;
    if(stars>0){
      const cr=mods(att,'critRoll'), cd=mods(att,'critDown'); // critDown＝クリティカル率ダウン（弱体）
      if(ruleset().crit==='d6'){ // シンプルルール：1d6 の出目（クリティカル率アップ(critRoll)で出目を下げる）が必要値以下で成功
        const need=critNeedD6(stars), r=roll()+1, rv=r-cr.sum+cd.sum;
        crit=(need>=6&&!cd.sum)||rv<=need;
        note.push(`クリ判定 出目${r}${cr.sum?`-${cr.sum}`:''}${cd.sum?`+${cd.sum}`:''} ≤ ${need} ${crit?'成功':'失敗'}`);
      } else {
        const lv=Math.max(0,Math.min(CRIT_TABLE.length,critLevel(stars)+cr.sum-cd.sum)), p=critChance(lv);
        const r=Math.floor(Math.random()*100)+1;
        crit=r<=p;
        note.push(`クリ判定 Lv${lv}(${p}%) 出目${r} ${crit?'成功':'失敗'}`);
      }
      consume(att,[...cr.list,...cd.list]);
    }
    if(crit){
      sa.crits++;
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
  // ガッツで踏みとどまっている相手（HP0・戦闘不能ではない）はオーバーキルにならない
  const mult=(crit?2:1)*(tgt.out?2:1);
  if(tgt.out){
    log(`${n} ${cmdChip(cmd)} → オーバーキル（${TERMS.gauge}・${TERMS.star}${mult}倍）`);
    fxEmit({t:'dmg',uid:tgt.uid,v:fmt(dmg),crit,over:true});
  } else {
    const b=blocked(att,tgt);
    if(b){ st(tgt).blocked++; log(`${n} ${cmdChip(cmd)} → ${nm(tgt)}：${b}で無効 <span class="sub">(${note.join(' / ')})</span>`); fxEmit({t:'dmg',uid:tgt.uid,text:b}); }
    else if(nullified(tgt,dmg)){ st(tgt).blocked++; log(`${n} ${cmdChip(cmd)} → ${nm(tgt)}：${fmt(dmg)}ダメージは${nullified(tgt,dmg)}以下なので無効 <span class="sub">(${note.join(' / ')})</span>`); fxEmit({t:'dmg',uid:tgt.uid,text:'無効'}); consume(tgt,usedT); }
    else { log(`${n} ${cmdChip(cmd)} → ${nm(tgt)}：<b>${fmt(dmg)}</b>ダメージ <span class="sub">(${note.join(' / ')})</span>`); consume(tgt,usedT); dealDamage(tgt,dmg,true,{crit,att}); }
  }
  const starCut=gainNpStar(att,cmd,mult);
  consume(att,usedA);
  // 攻撃時○○（エクストラアタックでは発動しない）
  if(!o.extra){
    const s=mods(att,'onAtkStar',cmd.c), p=mods(att,'onAtkNp',cmd.c);
    if(s.sum){ const g=Math.max(0,s.sum-starCut); G.gen+=g; log(`${n} 攻撃時効果：${TERMS.star}${g}個発生`,'sub'); }
    if(p.sum){ addNp(att,npRate(att,p.sum)); log(`${n} 攻撃時効果：${TERMS.gauge}+${p.sum}%`,'sub'); }
    consume(att,[...s.list,...p.list]);
  }
}
function resolveCommand(att,cmd,tgt,o={}){
  const n=nm(att);
  const atkFx=(to,x={})=>fxEmit({t:'atk',uid:att.uid,tgt:to,cmd,ri:o.ri,extra:!!o.extra,...x});
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
    if(!(cmd.dmg>0)){ if(cmdLine(cmd)) say(att,'attack',{own:cmd.line}); atkFx(null); applyEffects(att,[...preE,...postE],null); gainNpStar(att,cmd,1); syncU(att); return; }
    // ダメージを持つ特殊行動は無属性の攻撃として続けて処理する（チェインには数えない）
  }
  applyEffects(att,preE,null); // 攻撃前の効果（防御無視・無敵貫通などを付けてから攻撃）
  if(att.out) return; // 攻撃前の自傷などで倒れた
  say(att,(o.extra&&(D(att.def).lines.extra||[]).length)?'extra':'attack',{w:250,own:cmdLine(cmd),other:tgt}); // 吹き出しと攻撃カードを重ねて見せる（エクストラ用が空なら通常の攻撃セリフ。面の専用セリフがあればそちら）
  // 連続攻撃：同じ攻撃を hits 回。1回ごとに補正・クリティカル・NP・スター・回避/無敵・回数制の効果を処理する
  const hits=hitsOf(cmd.eff);
  if(hits>1) log(`${n} ${cmdChip(cmd)}：${hits}回連続攻撃`,'sub');
  for(let h=0;h<hits;h++){
    if(att.out) break; // 反撃で倒れたら残りの攻撃はしない
    atkFx(tgt.uid,h?{w:260}:{}); // 戦闘不能の相手にも（オーバーキル）カードを飛ばす
    attackHit(att,cmd,tgt,o,hits>1?`（${h+1}/${hits}）`:'');
  }
  syncU(tgt); syncU(att); // 獲得したNP・使い切った効果は、ダメージ演出のあとで画面に反映

  // 攻撃後の効果（例：自身の弱体解除）
  applyEffects(att,postE,null);
}
function resolveUlt(u,tgt,picked){
  const ud=D(u.def).ult;
  if(picked===undefined) picked=G.ultPick?U(G.ultPick):null;
  log(`${nm(u)}の${TERMS.ult}「${esc(ud.name)}」！`,'good');
  fxEmit({t:'cutin',uid:u.uid,title:ud.name,ruby:ud.ruby,br:ud.br,col:ud.c});
  say(u,'np',{other:tgt});
  st(u).ults++;
  const hits=hitsOf(ud.eff); // 連続攻撃：ダメージ効果それぞれを hits 回
  if(hits>1) log(`${hits}回連続攻撃`,'sub');
  for(const e of ultEffOrder(ud.eff)){
    if(u.out) break; // 反撃で倒れたら残りの効果は出ない
    if(e.k!=='dmg'){ applyEffects(u,[e],picked); continue; }
    for(let h=0;h<hits;h++){
      if(u.out) break;
      // マスタールール：全体宝具は敵マスターにも当たる（退避中なら当たらない。無敵・回避などでは防げない）
      const em=masterOf(1-u.pid), hitM=e.t==='enemy_all'&&em&&!em.out&&!G.players[em.pid].evac&&!mTeam();
      let ts = e.t==='enemy_all' ? [...alive(1-u.pid),...(hitM?[em]:[])] : [tgt].filter(x=>x&&!x.out);
      if(e.cond) ts=ts.filter(t=>condOk(e.cond,t)); // 条件つきダメージ：満たす対象だけ
      if(!ts.length) break;
      const usedA=new Set(), lab=hits>1?`（${h+1}/${hits}）`:'';
      for(const t of ts){
        t.tgtd=true;
        // 宝具威力アップ・ダウンは攻撃ダメージ+と同じく足し引き。max（最大HPぶん）は補正を受けない（軽減不可）
        let dmg, usedT=[];
        if(e.max) dmg=maxHp(t);
        else {
          const m=dmgMods(u,t,ud.c), up=mods(u,'npPow'), dn=mods(u,'npPowDown');
          [...m.usedA,...up.list,...dn.list].forEach(x=>usedA.add(x)); usedT=m.usedT;
          dmg=Math.max(0,e.v+m.sum+up.sum-dn.sum);
        }
        if(t.master&&e.t==='enemy_all'){ log(`→ ${nm(t)}${lab}：<b>${fmt(dmg)}</b>ダメージ`); dealDamage(t,dmg,false,{np:true,src:u}); continue; }
        const b=blocked(u,t);
        if(b){ st(t).blocked++; log(`→ ${nm(t)}${lab}：${b}で無効`); fxEmit({t:'dmg',uid:t.uid,text:b}); }
        else if(!e.max&&nullified(t,dmg)){ st(t).blocked++; log(`→ ${nm(t)}${lab}：${fmt(dmg)}ダメージは${nullified(t,dmg)}以下なので無効`); fxEmit({t:'dmg',uid:t.uid,text:'無効'}); consume(t,usedT); }
        else { log(`→ ${nm(t)}${lab}：<b>${fmt(dmg)}</b>ダメージ${e.max?'（最大HP・軽減不可）':''}`); consume(t,usedT); dealDamage(t,dmg,true,{np:true,att:u}); if(!t.out&&!h) say(t,'npDamage',{other:u}); }
        if(u.out) break; // 反撃で倒れたら残りの対象には当たらない
      }
      consume(u,[...usedA]);
      ts.forEach(syncU); syncU(u);
    }
  }
}
function resolveDamage(){
  const tgt=U(G.target);
  log(`${PN(6)} ダメージフェイズ（攻撃対象：${G.targetAll?'敵全体':nm(tgt)}）`,'h');
  phaseFx('BATTLE','ダメージフェイズ',{w:800}); // 帯が消えてから攻撃カードを出す
  if(G.ult){ resolveUlt(U(G.ult),tgt); }
  else {
    if(G.rolled.length) tgt.tgtd=true; // 攻撃対象になった（被ダメージ時○○ の発動条件。回避・無敵で防いでも対象にはなっている）
    const hp0=tgt.hp;
    const acts=G.rolled, cols=acts.map(a=>a.cmd.c);
    const chain = acts.length===3 && ['R','B','G'].includes(cols[0]) && cols.every(c=>c===cols[0]) ? cols[0] : null;
    if(chain){ log(`${TERMS[chain]}チェイン発生！`,'good'); fxEmit({t:'banner',title:`${TERMS[chain]} Chain`,col:chain}); chainsOf(G.cur)[chain]++; }
    acts.forEach((a,ri)=>{ if(!U(a.uid).out) resolveCommand(U(a.uid),a.cmd,tgt,{chain,ri}); }); // 反撃で倒れたら残りの行動はしない
    if(chain==='B'){ [...new Set(acts.map(a=>a.uid))].map(U).forEach(u=>{ addNp(u,npRate(u,RULES.chainB)); syncU(u); }); log(`チェインボーナス：行動${TERMS.unit}の${TERMS.gauge}+${RULES.chainB}%`); }
    if(chain==='G'){ G.gen+=RULES.chainG; log(`チェインボーナス：${TERMS.star}${RULES.chainG}個発生`); }
    // 7. ブレイブチェイン
    if(acts.length===3 && acts.every(a=>a.uid===acts[0].uid) && !U(acts[0].uid).out){
      const u=U(acts[0].uid), f=roll(), face=D(u.def).faces[f];
      log(`ブレイブチェイン！ ${nm(u)}のエクストラアタック（出目${f+1}）`,'good'); chainsOf(G.cur).brave++;
      fxEmit({t:'banner',title:'Brave Chain',sub:'エクストラアタック'});
      const cmd=!u.asc&&face.pre.c==='ASC'?face.pre:u.asc?face.post:face.pre;
      rollFx(u.uid,f,{cmd,keys:[`f:${u.uid}`]}); u.face={i:f,kind:'cmd',cmd};
      if(cmd.c==='ASC') ascend(u);
      else resolveCommand(u,cmd,tgt,{extra:true});
    }
    if(!tgt.out && tgt.hp<hp0) say(tgt,'damage',{other:acts.length?U(acts[0].uid):null});
  }
  flushKo();
  checkWin();
  if(G.winner==null) G.phase='end';
}
const chainsOf = pid=>(G.chains||(G.chains=[{R:0,B:0,G:0,brave:0},{R:0,B:0,G:0,brave:0}]))[pid];
function ascend(u){ u.asc=true; fxEmit({t:'pop',uid:u.uid,text:TERMS.ascFull,cls:'asc'}); log(`${nm(u)} ${TERMS.ascFull}！ 以降は${TERMS.asc}後コマンド、スキル3解放`,'good'); }

// =====================================================================
// ターン進行
// =====================================================================
function startGame(){
  G.players.forEach((P,pid)=>{ P.party=G.picks[pid].map((id,i)=>makeUnit(pid,i,id)); P.stars=0;
    P.master=masterRule()&&G.mpicks[pid]?makeMaster(pid,G.mpicks[pid]):null; P.spell=null; P.spellLeft=ruleset().spells||1; P.spellUsed=[false,false,false]; P.evac=false; P.zeroNext=false; });
  applyHandicap();
  if(ruleset().costBonus) G.players.forEach((P,pid)=>{ P.party.forEach(u=>{ u.hp=maxHp(u); }); const t=P.party[0]&&costBonusText(P.party[0]); if(t) log(`${esc(P.name)}：${TERMS.player}のコスト${mcost(pid)}（基準${ruleset().costBonus.base}）→ ${TERMS.unit}は ${t}`,'h'); });
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
  [G.cur,1-G.cur].forEach(pid=>{ const f=G.players[pid].party[0]; say(f,'start',{other:G.players[1-pid].party[0]}); });
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
  Object.assign(G,{phase:'actRoll',actRolled:false,maxActs:{},alloc:{},rolled:[],ult:null,ultPick:null,ultNp:null,target:null,targetAll:false,gen:0,pending:null,copy:null,guard:null,mastered:false,ultDone:false,spellPick:null});
  const P=G.players[G.cur];
  if(P.evac){ P.evac=false; log(`${esc(P.name)}の${TERMS.player}が退避から戻った`,'sub'); }
  log(`━ ターン${G.turn}：${esc(G.players[G.cur].name)} ━`,'h');
  phaseFx(`TURN ${G.turn}`,`${G.players[G.cur].name}の手番`,{big:true,pid:G.cur});
  // ① ターン開始：ターン開始時○○ を発動してから、このプレイヤーが付与した効果の残りターン-1
  turnStartEffects();
  ALLM().forEach(u=>{
    u.fx.forEach(e=>{ if(e.owner===G.cur && e.turns!=null) e.turns--; });
    const ex=u.fx.filter(e=>e.turns!=null&&e.turns<=0);
    if(ex.length){ u.fx=u.fx.filter(e=>!ex.includes(e)); clampHp(u); syncU(u); log(`${nm(u)}の ${ex.map(e=>FX[e.k].name).join('・')} が終了`,'sub'); }
  });
}
// ターン開始時○○：手番側の生存サーヴァントに付いているものが発動（スターはこのターンの手持ちに加わる）
function turnStartEffects(){
  alive(G.cur).forEach(u=>{
    const h=mods(u,'regenHp').sum, n=mods(u,'regenNp').sum, s=mods(u,'regenStar').sum;
    if(h&&has(u,'healBlock')) log(`${nm(u)}は回復無効でターン開始時に回復しない`,'sub');
    else if(h&&u.hp<maxHp(u)){ const v=Math.min(h,maxHp(u)-u.hp); u.hp+=v; log(`${nm(u)} ターン開始時：HP${v}回復`,'good'); fxEmit({t:'pop',uid:u.uid,text:`HP+${v}`,cls:'heal'}); }
    if(n){ addNp(u,n); log(`${nm(u)} ターン開始時：${TERMS.gauge}+${n}%`,'good'); }
    syncU(u);
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
      const c=npSealFx(u);
      if(c){ consume(u,[c]); log(`${nm(u)}は${FX[c.k].name}で被ダメージ時の${TERMS.gauge}が増えない`,'sub'); }
      else { addNp(u,hn.sum); log(`${nm(u)} 被ダメージ時：${TERMS.gauge}+${hn.sum}%`,'good'); }
      consume(u,hn.list);
    }
    if(hs.sum){ gainStars(u.pid,hs.sum); log(`${nm(u)} 被ダメージ時：${TERMS.star}${hs.sum}個獲得`,'good'); consume(u,hs.list); }
    syncU(u);
  });
}
function endPhase(){
  log(`${PN(7)} 終了フェイズ`,'h');
  const pids = RULES.dotTiming==='all' ? [0,1] : [G.cur];
  // 弱体ダメージ：攻防補正・無敵・回避・クリティカルの影響なし。弱体無効で防がれる。毒・やけどはそれぞれ重複せず最大値
  pids.forEach(pid=>alive(pid).forEach(u=>{
    const top=k=>Math.max(0,...u.fx.filter(e=>e.k===k).map(dotVal));
    let ps=top('poison'), bs=top('burn')*(has(u,'spread')?2:1), ds=mods(u,'drain').sum;
    // 弱体無効：種類指定なし＝すべて防ぐ（1回消費）／種類指定あり＝その弱体ダメージだけ防ぐ
    const blockDot=(k,v)=>{ if(!v) return v; const g=u.fx.find(e=>e.k==='debuffImmune'&&(!e.vs||e.vs===k)); if(!g) return v; consume(u,[g]); log(`${nm(u)}は${FX.debuffImmune.name}で${FX[k].name}ダメージを防いだ`,'sub'); return 0; };
    ps=blockDot('poison',ps); bs=blockDot('burn',bs); ds=blockDot('drain',ds);
    const d=ps+bs+ds;
    if(!d) return;
    log(`${nm(u)} 弱体ダメージ${d}（${[ps?`毒${ps}`:'',bs?`やけど${bs}`:'',ds?`HP減少${ds}`:''].filter(Boolean).join('・')}）`,'bad');
    dealDamage(u,d,false);
  }));
  hitEffects();
  // マスターの補助（このターンだけ）の効果を消す
  ALLM().forEach(u=>{ const t=u.fx.filter(e=>e.tmp); if(t.length){ u.fx=u.fx.filter(e=>!e.tmp); clampHp(u); syncU(u); } });
  G.players[G.cur].stars=G.gen; (G.starsGen||(G.starsGen=[0,0]))[G.cur]+=G.gen;
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
// 宝具を使う（picked＝対象を選ぶ宝具で選んだ1体）
function startUlt(u,picked){
  const uid=u.uid;
  if(masterRule()&&!D(u.def).ult.eff.some(e=>e.k==='dmg')){
    // マスタールール：ダメージのない宝具は、行動回数-1でその場で使い、スキルフェイズを続けて行動決定へ進める
    u.np=0; syncU(u); G.ultDone=true; resolveUlt(u,null,picked);
    const top=Object.entries(G.alloc).filter(([,n])=>n>0).sort((a,b)=>b[1]-a[1])[0];
    if(top){ G.alloc[top[0]]--; log(`補助${TERMS.ult}のため行動回数-1（${dn(U(top[0]))}）`,'sub'); }
    flushKo(); checkWin(); return;
  }
  G.ult=uid; G.ultPick=picked?picked.uid:null; G.ultNp=u.np; u.np=0; syncU(u);
  log(`${nm(u)}が${TERMS.ult}「${esc(D(u.def).ult.name)}」を使用${picked?`（対象：${nm(picked)}）`:''}（このターンの行動になります）`,'good');
}
function doSkill(u,si,picked){
  const s=D(u.def).skills[si];
  log(`${nm(u)} スキル「${esc(s.name)}」`);
  // 使ったスキルの名前と効果を中央に出す（選んだ対象があれば名前も）
  // 全体にかかるスキルは「→ 全体」（味方全体・敵全体）と出す。説明文があればその文章
  fxEmit({t:'skill',uid:u.uid,si,name:s.name,picked:picked?D(picked.def).name:allLabel(s.eff),
    lines:s.eff.length?effLines(s.eff,s.pick):['効果なし']});
  st(u).skills++;
  say(u,'skill',{own:s.line,other:picked}); // スキルの専用セリフがあればそちら
  applyEffects(u,s.eff,picked);
  u.used[si]=true; // 効果の後に使用済みにする（スキル再使用で自分自身が戻らないように）
  flushKo();
  checkWin(); // 即死などでスキルだけで決着することがある
}
function toTargetPhase(){
  G.phase='target'; log(`${PN(5)} 攻撃対象決定`,'h'); phaseFx('TARGET','攻撃対象の選択');
  const c=targetCandidates();
  if(G.ult&&ultNoTarget(U(G.ult))){ G.targetAll=true; G.target=c[0].uid; return; } // 全体宝具：最初から敵全体を選んだ状態
  if(c.length===1||(!G.ult&&!G.rolled.length)) G.target=c[0].uid; // 攻撃がない（全員行動0回）ときは対象を選ぶ意味がないので自動で決める
}

// ログのフェイズ番号（マスタールールは③にマスターフェイズが入るので、スキル以降が1つずれる）
const PN = n=>'①②③④⑤⑥⑦⑧⑨'[n-1+(masterRule()&&n>=3?1:0)];
function toSkillPhase(){ G.phase='skill'; log(`${PN(3)} スキル・${TERMS.ult}使用`,'h'); phaseFx('SKILL',`スキル・${TERMS.ult}`); }
// ---------- マスタールール ----------
// マスターフェイズで行動できるマスター（なければ null）
function masterReady(){ const m=masterOf(G.cur); return G.phase==='master'&&!G.mastered&&m&&!m.out&&!(G.spellPick&&G.spellPick.sup)?m:null; } // 補助の対象選択中は他の行動を受け付けない
function masterDone(){ G.mastered=true; flushKo(); checkWin(); if(G.winner==null&&G.phase==='master') toSkillPhase(); }
const masterAtkDmg = (m,t)=>Math.max(0,D(m.def).cost*ruleset().masterAtk[t.master?'master':'svt']+dmgMods(m,t,'W').sum);
// 令呪の状態：P.spellLeft＝残りの画数 / P.spellUsed[i]＝その効果を使った / P.spell==='decl'＝宣言中（マスタールール）
// 令呪を使える：マスタールールは未使用・このターンにサーヴァントが1回以上行動できる。
// マスターチームは残りがあり、生存サーヴァントが全員1回以上行動でき、行動を1回減らせる
function canDeclareSpell(){
  const P=G.players[G.cur]; if(!(P.spellLeft>0)||P.spell==='decl') return false;
  if(mTeam()) return P.spellUsed.some((u,i)=>!u&&D(P.master.def).spells[i].eff.length) && alive(G.cur).every(u=>(G.maxActs[u.uid]||0)>0) && (SPELL_FREE||totalAlloc()>0);
  return Object.values(G.maxActs).some(n=>n>0);
}
// 相手マスターへのダメージを令呪で防げる（残りがあり、宣言中でない）
const canGuardSpell = pid=>G.players[pid].spellLeft>0&&G.players[pid].spell!=='decl';
// 令呪の効果を使う。守る側の選択待ちになったら true
// picked：マスターチームで「自軍サーヴァント」の対象に選んだ1騎
function useSpell(m,i,picked){
  const s=D(m.def).spells[i], P=G.players[m.pid];
  log(`${nm(m)}：「${esc(s.name)}」${picked?` → ${nm(picked)}`:''}`,'good');
  fxEmit({t:'skill',uid:m.uid,head:'令呪',name:s.name,picked:picked?D(picked.def).name:allLabel(s.eff),lines:effLines(s.eff,null,spellTgt)});
  say(m,'spell',{own:s.line});
  P.spellUsed[i]=true; P.spellLeft--; P.spell=null;
  return masterEffects(m,s.eff,{},picked);
}
// マスターチームの令呪：「自軍サーヴァント」は全員ではなく選んだ1騎
// 対象を選ぶ側：'own'=自軍1騎（マスターチームの svt）/ 'enemy'=敵1体（enemy_svt）/ 'any'=両方ある / null=選ばない
// ally_svt（選んだ自軍サーヴァント）はどのマスタールールでも1騎を選ぶ。svt はマスターチームの令呪だけ1騎を選ぶ
const pickSide = effs=>{ const own=effs.some(e=>e.t==='ally_svt'||(mTeam()&&e.t==='svt')), en=effs.some(e=>e.t==='enemy_svt'); return own&&en?'any':en?'enemy':own?'own':null; };
// 補助は svt が全員なので、選ぶのは ally_svt / enemy_svt だけ
const supPickSide = effs=>{ const own=effs.some(e=>e.t==='ally_svt')&&alive(G.cur).length, en=effs.some(e=>e.t==='enemy_svt')&&alive(1-G.cur).length; return own&&en?'any':en?'enemy':own?'own':null; };
const pickOk = (side,u,pid)=>!!(side&&u&&!u.master&&!u.out&&(side==='any'||(side==='own')===(u.pid===pid)));
const pickCands = (side,pid)=>side==='own'?alive(pid):side==='enemy'?alive(1-pid):side==='any'?[...alive(pid),...alive(1-pid)]:[];
const spellPicks = s=>!!pickSide(s.eff);
const spellTgt = t=>t==='svt'&&mTeam()?`選んだ${TERMS.unit}`:mTLabel(t);
// マスターの補助・令呪の効果を適用。「敵マスター」へのダメージは、相手が令呪で防げるなら守る側の選択（guard）を挟む。待ちになったら true
function masterEffects(m,effs,o={},picked=null){
  // 敵全体（enemy_both）のダメージは、敵サーヴァント全員（enemy_all）と敵マスター（enemy_master＝令呪で守れる）に分けて処理する
  effs=effs.flatMap(e=>e.k==='dmg'&&e.t==='enemy_both'?[{...e,t:'enemy_all'},{...e,t:'enemy_master'}]:[e]);
  const md=effs.filter(e=>e.k==='dmg'&&e.t==='enemy_master');
  applyEffects(m,effs.filter(e=>!md.includes(e)),picked,o);
  const em=masterOf(1-m.pid), dmg=md.reduce((s,e)=>s+effVal(e,em),0);
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
  // 2人目（CPU）の編成から1人目の編成に戻る
  setupBack(){ if(G.phase==='setup'&&G.setupPid===1){ G.setupPid=0; G.setupMsg=''; } },
  // おまかせ。only='svt'：サーヴァントだけ（選んだマスターはそのまま） / only='master'：マスターだけ（選んだサーヴァントはそのまま）
  setupRandom({only}={}){
    if(G.phase!=='setup') return;
    const pid=G.setupPid, team=ruleset().partyMax>1, rnd=a=>a[Math.floor(Math.random()*a.length)];
    if(only==='master'){
      if(!masterRule()||!MASTERS.length) return;
      const room=costCap()-(team?sumCost(G.picks[pid]):0), c=MASTERS.filter(m=>!team||m.cost<=room);
      if(!c.length){ G.setupMsg=`コスト上限に収まる${TERMS.player}がいません`; return; }
      G.mpicks[pid]=rnd(c).id; G.setupMsg=''; return;
    }
    if(masterRule()&&MASTERS.length&&only!=='svt') G.mpicks[pid]=rnd(MASTERS).id;
    const room=costCap()-(team?mcost(pid):0); // チームはマスターのコストを引いた残りで編成
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
    // チームバトル：後攻の最初のターンは全員+1
    const second=ruleset().secondBonus&&G.turn===2?1:0;
    alive(G.cur).forEach(u=>{
      let m=0;
      if(disabled(u)){ u.face=null; log(`${nm(u)}は行動不能`,'bad'); }
      else {
        const f=roll(); u.face={i:f,kind:'acts'}; rolls.push({uid:u.uid,f});
        const fear=has(u,'fear')?1:0, dn=mods(u,'actsDown').sum, up=mods(u,'actsUp'); consume(u,up.list); syncU(u);
        m=Math.max(0,Math.min(RULES.actionsMax, faceActs(D(u.def),f)+bonus+late+zero+second+up.sum-fear-dn));
        log(`${nm(u)} 出目${f+1} → 最大行動${m}${bonus?`（${TERMS.out}ボーナス+${bonus}）`:''}${late?'（3ターン目後攻から+1）':''}${zero?'（前ターン0回行動+1）':''}${second?'（後攻の初ターン+1）':''}${up.sum?`（最大行動回数+${up.sum}）`:''}${fear?'（恐怖-1）':''}${dn?`（最大行動回数-${dn}）`:''}`, m?'':'bad');
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
    log(`${MASTER_ACTS.support}：${nm(m)} 出目${f+1} → ${face.eff.length?`${face.label?`「${esc(face.label)}」`:''}（このターンのみ）`:'何も起きない'}`, face.eff.length?'good':'sub');
    fxEmit({t:'skill',uid:m.uid,head:`${MASTER_ACTS.support}・出目${f+1}`,name:face.eff.length?face.label:'',picked:allLabel(face.eff),
      lines:face.eff.length?effLines(face.eff,null,mTLabel):['何も起きない']});
    if(face.eff.length) say(m,'support',{own:face.line});
    const side=supPickSide(face.eff);
    if(side){ G.spellPick={sup:{label:face.label,eff:face.eff},side}; return; } // 「選んだ敵1体」：対象の選択待ち
    if(!masterEffects(m,face.eff,{tmp:true})) masterDone();
  },
  masterSupportPick({uid}){
    const m=masterOf(G.cur), sp=G.spellPick;
    if(G.phase!=='master'||G.mastered||!m||m.out||!sp||!sp.sup) return;
    const picked=U(uid); if(!pickOk(sp.side,picked,G.cur)) return;
    G.spellPick=null; log(`${MASTER_ACTS.support}の対象：${nm(picked)}`,'sub');
    if(!masterEffects(m,sp.sup.eff,{tmp:true},picked)) masterDone();
  },
  // 攻撃：相手マスターへはコスト×20、相手サーヴァントへはコスト×10（退避中のマスターには当たらない）
  masterAttack({to}){
    const m=masterReady(); if(!m||mTeam()) return;
    const em=masterOf(1-G.cur), t=to==='master'?em:alive(1-G.cur)[0];
    if(!t||t.out) return;
    const dmg=masterAtkDmg(m,t);
    log(`${MASTER_ACTS.attack}：${nm(m)} → ${nm(t)}`,''); say(m,'attack');
    if(t.master&&G.players[t.pid].evac){ log(`${nm(t)}は退避中のため当たらない`,'sub'); fxEmit({t:'dmg',uid:t.uid,text:'退避'}); masterDone(); return; }
    // マスターからマスターへの攻撃は、相手が令呪1画でサーヴァントに守らせて無効にできる（宣言中は不可）
    if(t.master&&dmg>0&&canGuardSpell(t.pid)){ G.guard={kind:'spell',dmg}; G.phase='guard'; return; }
    fixedHit(m,t,dmg); masterDone();
  },
  // 令呪：now=即時（スターを消費・スキップなし）なら i の効果をすぐ使う。宣言なら以降のフェイズをスキップして、次のマスターフェイズで使う
  masterSpell({now,i,uid}){ // uid：対象を選ぶ令呪（選んだ敵1体など）の対象
    const m=masterReady(); if(!m) return;
    const P=G.players[G.cur], need=ruleset().spellNowStars;
    if(!canDeclareSpell()) return;
    if(mTeam()){ // マスターチーム：その場で使い、行動回数-1（同じ効果は1回まで）
      const k=Number(i), s=D(m.def).spells[k]; if(!s||P.spellUsed[k]) return;
      let picked=null;
      const side=pickSide(s.eff);
      if(side){ // 対象の1体を選ぶ（uid がなければ選択待ちにする）
        picked=uid&&U(uid);
        if(!pickOk(side,picked,G.cur)){ G.spellPick={i:k,side}; return; }
      }
      G.spellPick=null;
      if(!SPELL_FREE){ const top=Object.entries(G.alloc).filter(([,n])=>n>0).sort((a,b)=>b[1]-a[1])[0];
        G.alloc[top[0]]--; log(`令呪を使用：行動回数-1（${dn(U(top[0]))}）・残り${P.spellLeft-1}画`,'sub'); }
      if(!useSpell(m,k,picked)){ if(SPELL_FREE===2){ flushKo(); checkWin(); } else masterDone(); } return;
    }
    if(now){
      const k=Number(i), s=D(m.def).spells[k]; if(!s||P.stars<need) return;
      const side=pickSide(s.eff); let picked=null;
      if(side){ picked=uid&&U(uid); if(!pickOk(side,picked,G.cur)){ G.spellPick={i:k,now:true,side}; return; } }
      G.spellPick=null;
      P.stars-=need; log(`${esc(P.name)}：${TERMS.star}${need}個（クリティカルLv4）を消費して令呪を即時発動`,'sub');
      if(!useSpell(m,k,picked)) masterDone(); return;
    }
    P.spell='decl'; G.mastered=true;
    log(`${esc(P.name)}：令呪を宣言（このターンの以降のフェイズをスキップ。次の${TERMS.player}フェイズで発動）`,'good');
    fxEmit({t:'pop',uid:m.uid,text:'令呪宣言',cls:'asc'});
    endPhase();
  },
  // 宣言済みの令呪を使う（次のターンのマスターフェイズ）
  masterSpellUse({i,uid}){
    const m=masterReady(), k=Number(i); if(!m||G.players[G.cur].spell!=='decl'||!D(m.def).spells[k]) return;
    const side=pickSide(D(m.def).spells[k].eff); let picked=null;
    if(side){ picked=uid&&U(uid); if(!pickOk(side,picked,G.cur)){ G.spellPick={i:k,use:true,side}; return; } }
    G.spellPick=null;
    if(!useSpell(m,k,picked)) masterDone();
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
    if(G.phase!=='skill'||G.pending||!u||u.pid!==G.cur||!skillUsable(u,si)) return;
    if(s.pick){ G.pending={uid,si}; return; }
    doSkill(u,si,null);
  },
  cancelPick(){ G.pending=null; if(!(G.spellPick&&G.spellPick.sup)) G.spellPick=null; }, // 補助のロール後は取り消せない
  useUlt({uid}){
    const u=U(uid);
    if(G.phase!=='skill'||G.pending||G.ult||G.ultDone||u.pid!==G.cur||!canUlt(u)||u.np<RULES.ultCost) return;
    if(D(u.def).ult.pick){ G.pending={uid,ult:true}; return; } // 対象を選ぶ宝具：選んでから発動（取消は cancelPick）
    startUlt(u,null);
  },
  // 宝具の取り消し（スキルフェイズの間だけ。使ったNPを戻す）
  cancelUlt(){
    if(G.phase!=='skill'||G.pending||!G.ult) return;
    const u=U(G.ult); u.np=Math.min(RULES.gaugeMax,u.np+(G.ultNp??RULES.ultCost));
    G.ult=null; G.ultPick=null; G.ultNp=null; syncU(u);
    log(`${nm(u)}の${TERMS.ult}の使用を取り消した`,'sub');
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
    if(cv){ const from=cmd.c; cmd={...cmd,c:cv.color}; consume(u,[cv]); syncU(u); log(`${nm(u)} カード変換：${TERMS[from]} → ${TERMS[cv.color]}`,'sub'); }
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
    if(G.spellPick){ // 令呪・補助の対象
      const sp=G.spellPick; if(!pickOk(sp.side,u,G.cur)) return;
      if(sp.sup) ACTIONS.masterSupportPick({uid}); else if(sp.use) ACTIONS.masterSpellUse({i:sp.i,uid}); else ACTIONS.masterSpell({i:sp.i,uid,now:sp.now});
      return;
    }
    if(G.pending){ if(pickValid(u)){ const p=G.pending; G.pending=null; if(p.ult) startUlt(U(p.uid),u); else doSkill(U(p.uid),p.si,u); } return; }
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
  snapPre();
  ACTIONS[type](p);
  render();
}
