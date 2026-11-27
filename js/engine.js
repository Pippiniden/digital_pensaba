'use strict';
/* =====================================================================
   ゲームエンジン：状態(G)とルール処理
   - 状態はすべて G に集約し、操作は act(type, payload) だけで変化する
     → オンライン化(PeerJS)時は「ゲスト→ホストへ {type,payload} を送信、
        ホストが act() を実行して G をブロードキャスト」で載せ替え可能
   ===================================================================== */

let UNITS=[], MASTERS=[], UNIT_SOURCE='default', UNIT_BROKEN=false, MASTER_SOURCE='default', MASTER_BROKEN=false;
let ALL_UNITS=[], ALL_MASTERS=[]; // 原作キャラも含む全員（D() の引き当て用）。UNITS / MASTERS は設定で原作キャラを除いたもの
function reloadUnits(){ const r=loadUnits(); ALL_UNITS=r.units; UNIT_SOURCE=r.source; UNIT_BROKEN=!!r.broken; const mr=loadMasters(ALL_UNITS); ALL_MASTERS=mr.masters; MASTER_SOURCE=mr.source; MASTER_BROKEN=!!mr.broken;
  const nc=noCanon(); UNITS=ALL_UNITS.filter(u=>!u.enemy&&!(nc&&CANON_UNIT_IDS.includes(u.id))); MASTERS=nc?ALL_MASTERS.filter(m=>!CANON_MASTER_IDS.includes(m.id)):ALL_MASTERS;
  // ↑ エネミー専用（u.enemy）は UNITS（編成の一覧）に出さない。ALL_UNITS には残すので D() では引ける
  // シナリオ専用キャラ：同じ id は差し替え、新しい id は D() で引けるようにだけする（編成の一覧には出さない。出すのは G.scn.pool）
  if(XUNITS.length||XMASTERS.length){ const mix=(base,x)=>[...x,...base.filter(b=>!x.some(y=>y.id===b.id))], swap=(list,x)=>list.map(b=>x.find(y=>y.id===b.id)||b);
    UNITS=swap(UNITS,XUNITS).filter(u=>!u.enemy); MASTERS=swap(MASTERS,XMASTERS); ALL_UNITS=mix(ALL_UNITS,XUNITS); ALL_MASTERS=mix(ALL_MASTERS,XMASTERS); }
  // オンライン対戦のゲスト：対戦中はホストから届いたデータだけを使う（net.js の setNetData）
  if(NETDATA){ ALL_UNITS=NETDATA.units; UNITS=ALL_UNITS.filter(u=>!u.enemy); MASTERS=ALL_MASTERS=NETDATA.masters; }
}
let NETDATA=null;
function setNetData(d){ NETDATA=d||null; reloadUnits(); }
// シナリオ専用のキャラ（シナリオJSONに同梱。シナリオを遊んでいる間だけ有効）。scenario.js が setScnData で出し入れする
let XUNITS=[], XMASTERS=[];
function setScnData(units=[],masters=[]){ XUNITS=units; XMASTERS=masters; reloadUnits(); }
reloadUnits();

// 実験用：マスターチームの令呪が行動回数を使わない（0=従来 / 1=使わず、使うとそのターンの補助は無し / 2=使わず、補助とも併用・続けて何度でも）
let SPELL_FREE = 0;
let G;
// オンライン対戦（net.js）用：NEWGAME_N＝newGame の回数（ゲストが演出を消す合図）／ FX_TAP＝1回の act() で出た演出イベントの控え（ホストがゲストへ送る）
let NEWGAME_N=0, FX_TAP=null;
function newGame(o={}){
  NEWGAME_N++; if(FX_TAP) FX_TAP.length=0;
  G = { phase:'mode', mode:null, rule:o.rule||'team', handicap:o.handicap??true, cpu:[false,false], level:'normal', scn:null, /* シナリオの戦闘中だけ：{spec,title,lock,mlock,pool,cap,pick,loseGo}（scnBegin） */ draft:null, /* ドラフトで編成した試合だけ：{pool,mpool,taken,order,i,done}（draftStart） */ arcade:null, /* アーケード中だけ：{diff,stage,picks,mpick,leads,seen,lap,results,continues}（arcadeStart） */ speed:(typeof window!=='undefined'&&window.SPEED_PREF)||700, seed:String(Math.random()),
    setupPid:0, picks:[[],[]], mpicks:[null,null], setupMsg:'',
    // master：マスタールールのマスター（makeMaster）。spell：令呪 null/'decl'(宣言済み・次のマスターフェイズで使う)/'used'
    // evac：退避中（次の相手ターンの間） / zeroNext：前のターンの行動回数が0だった（次の行動回数+1）
    players:[{name:TERMS.player+'1',party:[],stars:0,master:null,spell:null,evac:false,zeroNext:false},{name:TERMS.player+'2',party:[],stars:0,master:null,spell:null,evac:false,zeroNext:false}],
    cur:0, turn:0, actRolled:false, maxActs:{}, alloc:{}, rolled:[], ult:null, target:null,
    gen:0, pending:null, copy:null, guard:null, hcap:null, /* boost：陣営ごとの常時補正 [P1,P2]（ボスレイドのボス・聖杯戦争の報酬。boostOf） */ boost:[null,null], mastered:false, ultDone:false, log:[], winner:null, dealt:[0,0], dealtO:[0,0],
    // リザルト用の記録：stats＝ユニットごと（uid） / tl＝ターンごとの与ダメージ [P1,P2] / chains＝陣営ごとのチェイン回数 / starsGen＝発生スター合計
    stats:{}, tl:[], chains:[{R:0,B:0,G:0,brave:0},{R:0,B:0,G:0,brave:0}], starsGen:[0,0] };
  FXQ.length=0; for(const k in FXHOLD) delete FXHOLD[k]; FXHIDE.clear(); KO_PEND.length=0; for(const k in KO_BY) delete KO_BY[k]; LAST_KO[0]=LAST_KO[1]=null;
  if(typeof fxClear==='function') fxClear(); // 画面に残っている演出（吹き出し・帯・カットインなど）も消す
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
  FXQ.push(ev); if(FX_TAP) FX_TAP.push(ev);
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
  if(t){ fxEmit({t:'say',uid:u.uid,key,text:t,...r});
    // セリフもバトルログに残す（cls 'say'。表示するかは画面側の設定。u=キャラid / p=陣営 / x=セリフそのもの）
    if(G&&G.log) G.log.push({msg:`${nm(u)}「${esc(t)}」`,cls:'say',t:G.turn,c:G.cur,u:u.def,p:u.pid,x:t}); } }
// 条件つきセリフ：場面 key に合い、条件を満たす最初のもの（なければ null）
function condLineFor(u,key,other){
  const cl=(D(u.def)||{}).condLines; if(!cl||!cl.length) return null;
  return cl.find(c=>{
    if(c.key!==key) return false;
    switch(c.who){
      case 'self': return condOk(c.cond,u);
      // 味方・敵には マスター も含める（マスタールールで「味方に〇〇（マスター）がいるとき」を書けるように）
      case 'ally': { const m=masterOf(u.pid); return [...alive(u.pid),...(m&&!m.out?[m]:[])].some(a=>a!==u&&condOk(c.cond,a)); }
      case 'enemy': { const al=alive(1-u.pid), m=masterOf(1-u.pid); return [...(al.length?al:G.players[1-u.pid].party),...(m?[m]:[])].some(a=>condOk(c.cond,a)); } // 決着後（敵が全滅）は敵の編成全体で見る
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
const D = id=>UNITS.find(u=>u.id===id)||MASTERS.find(m=>m.id===id)||ALL_UNITS.find(u=>u.id===id)||ALL_MASTERS.find(m=>m.id===id);
// 属性（特攻・特防・条件の判定用）：キャラの属性＋特性付与で付いている属性
const traitsOf = u=>{ const b=(D(u.def)||{}).traits||[], a=u.fx?u.fx.filter(x=>TRAIT_ADD.includes(x.k)&&x.trait).map(x=>x.trait):[]; return a.length?[...b,...a]:b; };
// 特攻・特防の対象指定：属性・クラス名・キャラID のどれに一致してもよい
const traitHit = (u,s)=>!!u&&!!s&&(traitsOf(u).includes(s)||((D(u.def)||{}).cls)===s||u.def===s);
const ruleset = ()=>RULESETS[G.rule]||RULESETS.team;
const keepRule = ()=>({rule:G.rule, handicap:G.handicap});
const ALL = ()=>[...G.players[0].party,...G.players[1].party];
const masterOf = pid=>G.players[pid].master;
const masterRule = ()=>!!ruleset().master;
const mTeam = ()=>!!ruleset().mTeam; // マスターチームバトル
const costCap = ()=>(G.scn&&G.scn.cap)||ruleset().costCap||RULES.costCap;
// 編成で選べるサーヴァント（シナリオが選べるキャラを指定していればそれだけ）
const ROSTER = ()=>G&&G.scn&&G.scn.pool?G.scn.pool.map(D).filter(Boolean):UNITS;
const mcost = pid=>G.mpicks[pid]&&D(G.mpicks[pid])?D(G.mpicks[pid]).cost:0; // 編成中のマスターのコスト
const ALLM = ()=>[...ALL(),...G.players.map(P=>P.master).filter(Boolean)]; // サーヴァント＋マスター
const U = uid=>ALLM().find(u=>u.uid===uid);
const alive = pid=>G.players[pid].party.filter(u=>!u.out);
const roll = ()=>Math.floor(Math.random()*6);       // 面index(0-5)、出目は+1
const has = (u,k)=>u.fx.some(e=>e.k===k);
const DISABLE_FX = ['stun','charm','petrify','bind','sleep']; // 行動不能になる弱体
const disabled = u=>u.fx.some(e=>DISABLE_FX.includes(e.k));  // 行動・スキル・宝具すべて不可
const canSkill = u=>!u.out&&!disabled(u)&&!has(u,'sealSkill');
const canUlt = u=>!u.out&&!disabled(u)&&!has(u,'sealUlt')&&(!D(u.def).ult.pick||skillCands(u,D(u.def).ult).length>0); // 対象を選ぶ宝具は、選べる相手がいること
const fmt = n=>Number.isInteger(n)?n:Math.round(n*10)/10;
const dn = u=>esc(D(u.def).name);
const nm = u=>`<span class="p${u.pid}">${dn(u)}</span>`;
const log = (msg,cls='')=>G.log.push({msg,cls,t:G.turn,c:G.cur}); // t=ターン / c=手番（ログの書き出し用）
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
const ultNoTarget = u=>!D(u.def).ult.eff.some(e=>e.t==='target'||e.k==='copyRoll'||(FX[e.k]&&FX[e.k].copy&&e.from==='target')); // 攻撃対象を使う効果がなければ全体宝具扱い（コマンドのロール・攻撃対象からのコピーは対象が要る）
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
function pickValid(u){ const s=pendingSkill(); return !!s&&!G.pending.colorPick&&skillPickOk(U(G.pending.uid),s,u); }
// 使用時に色を選ぶカード変換（cardConvPick）：選んだ色の cardConv に置き換える
const hasColorPick = s=>!!s&&!!s.eff&&s.eff.some(e=>e.k==='cardConvPick');
const withPickedColor = (effs,c)=>effs.map(e=>e.k==='cardConvPick'?{...e,k:'cardConv',color:c}:e);
// スキルを今使えるか（対象を選ぶスキルは、選べる相手がいること。例：1騎だけのときの「自分以外の味方」）
function skillUsable(u,si){
  const s=D(u.def).skills[si];
  return !!s&&canSkill(u)&&!u.used[si]&&(si<2||u.asc)&&(!s.pick||skillCands(u,s).length>0);
}
// 連続攻撃の回数（コマンド・宝具の効果の multiHit。なければ1、最大10）
const isAoe = effs=>(effs||[]).some(e=>e.k==='aoe'); // 攻撃の全体化
const hitsOf = effs=>Math.min(10,Math.max(1,...(effs||[]).filter(e=>e.k==='multiHit').map(e=>Math.floor(e.v)||1)));
// 効果の値（max なら対象の最大HP）
const effVal = (e,t)=>e.max&&t?maxHp(t):e.v;
// ---------- 参照して値が増える（Eff.scale・SCALE_BY） ----------
// 数え上げ：src＝効果を使った側、t＝その効果の対象（対象の強化・弱体を数えるとき）
function scaleCount(src,c,t){
  const side=pid=>G.players[pid].party, al=side(src.pid), en=side(1-src.pid);
  const isB=x=>FX[x.k]&&FX[x.k].buff===true, isD=x=>FX[x.k]&&FX[x.k].buff===false;
  const inFx=u=>c.v==='*buff'?u.fx.some(isB):c.v==='*debuff'?u.fx.some(isD):u.fx.some(x=>x.k===c.v);
  switch(c.by){
    case 'stars': return G.players[src.pid].stars||0;
    case 'selfBuff': return src.fx.filter(isB).length;
    case 'selfDebuff': return src.fx.filter(isD).length;
    case 'tgtBuff': return t?t.fx.filter(isB).length:0;
    case 'tgtDebuff': return t?t.fx.filter(isD).length:0;
    case 'allyTrait': return al.filter(x=>!x.out&&traitHit(x,c.v)).length;
    case 'enemyTrait': return en.filter(x=>!x.out&&traitHit(x,c.v)).length;
    case 'allyFx': return al.filter(x=>!x.out&&inFx(x)).length;
    case 'enemyFx': return en.filter(x=>!x.out&&inFx(x)).length;
    case 'allyOut': return al.filter(x=>x.out).length;
    case 'enemyOut': return en.filter(x=>x.out).length;
  }
  return 0;
}
// 値 v に「数 × per」を足した値（max で止める）
function scaleVal(src,e,t){
  const c=e.scale; if(!c) return e.v;
  let v=e.v+c.per*scaleCount(src,c,t);
  if(c.max!=null) v=c.per>0?Math.min(v,c.max):Math.max(v,c.max);
  return Math.round(v);
}
// 参照を数えて値を決めた効果（scale は外す）。値が変わったらログに出す
function scaleEff(src,e,t){
  const v=scaleVal(src,e,t), {scale,...r}=e;
  if(v!==e.v) log(`${nm(src)}：${scaleText(scale)} → 「${fxName(e)}」の値 ${e.v}→${v}`,'sub');
  return {...r,v};
}
// ---------- 効果の出どころ（付いた状態の src） ----------
// src = {uid:使った側, def:そのキャラ, kind:'skill'|'ult'|'face'|'master'|'spell', i?:スキル番号, trig?:発動型の種類, copy?:true（状態コピーで付いた）}
// u に、自分のスキル si で付いた状態が残っているか（状態コピーで付いたものは数えない）。変身スキルなどの判定用
const fxFromSkill = (u,si,k)=>!!u&&u.fx.some(x=>x.src&&x.src.uid===u.uid&&x.src.kind==='skill'&&x.src.i===si&&!x.src.copy&&(!k||x.k===k));
// 全体にかかる効果の呼び名（スキル演出の「→ 全体」）
function allLabel(effs){
  const ts=new Set(effs.filter(e=>FX[e.k]&&!FX[e.k].noTgt).map(e=>e.t)), a=ts.has('ally_all')||ts.has('ally_other'), en=ts.has('enemy_all')||ts.has('enemy_both');
  return a&&en?'全体':a?'味方全体':en?'敵全体':'';
}
// カード性能アップ（cardUp）は 攻撃ダメージ+（atk）・攻撃時NP（onAtkNp）・攻撃時スター（onAtkStar）の一部として、
// カード性能ダウン（cardDown）は 攻撃ダメージ-（atkDown）・スター発生数ダウン（starDown）の一部として数える（値はそれぞれ v / np / star）。
// カード性能ダウンの NP獲得量は gainNpStar で、その色の攻撃1回で得る NP から引く
const CARD_PART = { cardUp:{atk:'v', onAtkNp:'np', onAtkStar:'star'}, cardDown:{atkDown:'v', starDown:'star'} };
const modOf = (e,k)=>CARD_PART[e.k]?(e[CARD_PART[e.k][k]]||0):e.v;
const modHit = (e,k)=>e.k===k||(!!CARD_PART[e.k]&&!!CARD_PART[e.k][k]&&(e[CARD_PART[e.k][k]]||0)>0);
const isCard = e=>!!CARD_PART[e.k]; // 回数は攻撃1回につき1回だけ減らす（威力が0なら attackHit の最後で減らす）
function mods(u,k,color){
  const list=u.fx.filter(e=>modHit(e,k) && (!color || !e.color || e.color===color));
  return {sum:list.reduce((s,e)=>s+modOf(e,k),0), list};
}
// 条件つきの効果を含む mods：相手 other が条件を満たすものだけ数える（other なしなら条件つきは数えない）
function modsC(u,k,color,other){
  const list=u.fx.filter(e=>modHit(e,k) && (!color || !e.color || e.color===color) && (!e.cond||condOk(e.cond,other)));
  return {sum:list.reduce((s,e)=>s+modOf(e,k),0), list};
}
function consume(u,list){
  list.forEach(e=>{ if(e.times!=null) e.times--; });
  u.fx=u.fx.filter(e=>e.times==null||e.times>0);
}
// 被弾時にNPが増えなくなる弱体（呪い・被弾NP上昇封印）。回数があるものを先に使う
const npSealFx = u=>u.fx.find(e=>e.k==='curse')||u.fx.find(e=>e.k==='hitNpSeal'&&e.times!=null)||u.fx.find(e=>e.k==='hitNpSeal');
const dotVal = e=>e.v||RULES.dot; // 毒・やけどの値（0は旧データなので RULES.dot）
// 受けるHP回復の量：HP回復量アップ(+x%)・ダウン(-x%)を足し引きして掛ける（0未満にはならない）。回数つきなら1回消費
function healAmt(u,v){
  const up=mods(u,'healUp'), dn=mods(u,'healDown'), p=up.sum-dn.sum;
  consume(u,[...up.list,...dn.list]);
  return p?Math.max(0,Math.round(v*(100+p)/100)):v;
}
// src：'atk'＝攻撃で得るNP（コマンド・攻撃時NP・チェイン）/ 'other'＝スキル・ターン開始時・被弾時など。NP獲得量ダウンは増える分から引く（0未満にはしない。all なら other も対象）
function addNp(u,v,src){
  if(u.out) return;
  if(v>0&&src){
    const l=u.fx.filter(e=>e.k==='npGainDown'&&(src==='atk'||e.all)), cut=l.reduce((s,e)=>s+e.v,0);
    if(cut>0){ v=Math.max(0,v-cut); consume(u,l); }
  }
  u.np=Math.max(0,Math.min(RULES.gaugeMax,u.np+v));
}
// 最大HP（定義のHP＋最大HP+の合計）。最大HP+が切れたら HP を最大値まで下げる（1未満にはしない）
const maxHp = u=>D(u.def).hp+mods(u,'maxHp').sum+(costBonus(u)?costBonus(u).hp:0)+(hasHcap(u)?(G.hcap.hp||0):0)+((boostOf(u)||{}).hp||0);
function clampHp(u){ if(!u.out&&u.hp>maxHp(u)) u.hp=Math.max(1,maxHp(u)); }
// スターの獲得：手番側はこのターンの発生スター（G.gen）、相手側は手持ちに直接加える
function gainStars(pid,v){ if(pid===G.cur) G.gen+=v; else G.players[pid].stars+=v; }
// ---------- リザルト用の記録 ----------
function st(u){
  const S=G.stats||(G.stats={});
  return S[u.uid]||(S[u.uid]={dealt:0,taken:0,dealtO:0,takenO:0,maxHit:0,kills:0,attacks:0,crits:0,ults:0,skills:0,blocked:0});
}
// ダメージの記録。src＝与えた側（なければ毒など）。real＝実際に減ったHP / raw＝ダメージの値 / ko＝これで倒れた
// 〇O（dealtO / takenO）＝オーバーキル分も含めたダメージ（raw）。リザルトでカッコ書きする用
function recDmg(src,u,real,raw,ko){
  const su=st(u); su.taken+=real; su.takenO+=raw;
  if(src&&src.pid===u.pid) return; // 自傷・味方からのダメージは与ダメージに数えない
  G.dealt[1-u.pid]+=real; (G.dealtO||(G.dealtO=[0,0]))[1-u.pid]+=raw;
  const tl=G.tl||(G.tl=[]), row=tl[G.turn]||(tl[G.turn]=[0,0]); row[1-u.pid]+=real;
  if(src){ const s=st(src); s.dealt+=real; s.dealtO+=raw; s.maxHit=Math.max(s.maxHit,raw); if(ko) s.kills++; }
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
// 出目で分岐（Eff.roll=[下限,上限]）：スキル・宝具・特殊行動を使うたびに1d6を1回だけ振り、出目が範囲に入る効果だけを残す（範囲のない効果は毎回）
const rollIn = (e,r)=>!e.roll||(r>=e.roll[0]&&r<=e.roll[1]);
function effRollPick(u,effs){
  effs=effs||[];
  if(!effs.some(e=>e.roll)) return effs;
  const r=roll()+1, hit=effs.filter(e=>e.roll&&rollIn(e,r));
  rollFx(u.uid,r-1,{lab:hit.length?`${rollText([r,r])}の効果`:'効果なし'});
  log(`出目分岐ロール（${nm(u)}）出目${r} → ${hit.length?hit.map(fxName).join('・'):'該当する効果なし'}`,hit.length?'':'sub');
  return effs.filter(e=>rollIn(e,r));
}
// 弱体の成功率：敵に付ける弱体の判定は、弱体成功率アップ(+x)／ダウン(-x)でロールの基準値をずらす（0〜6）。
// 「必ず」の弱体はロール6以下として扱うので、ダウンがあるときだけ失敗しうる。アップは確率つきの弱体にだけ効く
// 強化の成功率：味方（自分含む）に付ける強化の判定は、強化成功率ダウン(-x)でロールの基準値が下がる。
// 「必ず」の強化もロール6以下として扱うので、ダウンがあれば失敗しうる
function debuffRate(src,e){
  const b=FX[e.k]&&FX[e.k].buff;
  if(b===false){
    const up=mods(src,'debuffUp'), dn=mods(src,'debuffDown');
    return (up.list.length||dn.list.length)?{up:up.sum,dn:dn.sum,list:[...up.list,...dn.list],used:false,foe:true}:null;
  }
  if(b===true){
    const up=mods(src,'buffUp'), dn=mods(src,'buffDown');
    return (up.list.length||dn.list.length)?{up:up.sum,dn:dn.sum,list:[...up.list,...dn.list],used:false,foe:false}:null;
  }
  return null;
}
// o.tmp：マスターの補助（既定はこのターンだけ）。付いた効果は終了フェイズで消える。面の効果に turns≥2 があれば、自分の終了フェイズをその回数迎えるまで続く
// o.src：効果の出どころ {kind:'skill'|'ult'|'face'|'master'|'spell', i?}（付いた状態に src として残す。画面には出さない。fxFromSkill など）
// o.other：発動型の中の効果を出すとき。t:'target' はこの1体（null なら効果なし）
function applyEffects(src,effs,picked,o={}){
  for(const e0 of effs){
    if(FX[e0.k]&&FX[e0.k].noTgt) continue; // 連続攻撃・説明文は効果を持たない（連続攻撃は攻撃側で使う）
    if(o.trig&&FX[e0.k]&&FX[e0.k].trig) continue; // 発動型の中に発動型は入れない（データが壊れていても無限に続かないように）
    let e=e0;
    if(e.t==='master'){
      if(e0.scale) e=scaleEff(src,e0,null);
      if(condAtApply(e)&&!condOk(e.cond,src)) continue;
      if(e.chance&&!chanceRoll(e,src)) continue;
      if(e.k==='star'||e.k==='starLoss') changeStars(src.pid,e.k==='star'?e.v:-e.v);
      continue;
    }
    const rate=debuffRate(src,e);
    let oe=o; // 状態コピー：コピー元（from）を1体に決めて applyOne へ渡す
    if(FX[e.k]&&FX[e.k].copy){
      const fu=resolveTargets(src,e.from||'self',picked)[0];
      if(!fu){ log(`${nm(src)}：コピー元がいないため「${fxName(e)}」は効果なし`,'sub'); continue; }
      oe={...o,from:fu};
    }
    const tgts='other' in o&&e.t==='target'?(o.other&&!o.other.out?[o.other]:[]):resolveTargets(src,e.t,picked);
    tgts.forEach(t=>{
      if(e0.scale) e=scaleEff(src,e0,t); // 参照して値が増える：対象ごとに数える
      if(condAtApply(e)&&!condOk(e.cond,t)){ log(`${nm(t)}：条件（${condText(e.cond)}）を満たさないため「${fxName(e)}」は効果なし`,'sub'); return; }
      // 弱体耐性ダウン：対象が受ける弱体（確率つきのみ）の判定ロールをN+xにする
      // 弱体耐性アップ（debuffRes）は逆に N-x にする（両方あれば相殺）
      const dbf=FX[e.k]&&FX[e.k].buff===false&&e.chance;
      const rd=dbf?mods(t,'debuffResDown'):null, ru=dbf?mods(t,'debuffRes'):null;
      const useRd=!!(rd&&(rd.list.length||ru.list.length));
      const useRate=!!(rate&&(t.pid!==src.pid)===rate.foe&&(e.chance||rate.dn));
      if(useRate||useRd){ // 敵への弱体／味方への強化：成功率アップ／ダウンで判定をずらす
        if(useRate) rate.used=true;
        const need=Math.max(0,Math.min(6,(e.chance||6)+(useRate?rate.up-rate.dn:0)+(useRd?rd.sum-ru.sum:0)));
        if(useRd) consume(t,[...rd.list,...ru.list]);
        if(need<6&&!chanceRoll(e,t,need)) return;
      } else if(e.chance&&!chanceRoll(e,t)) return;
      if(e.k==='dmg'){ if(src.master) fixedHit(src,t,effVal(e,t)); return; } // 宝具のダメージは resolveUlt で処理
      applyOne(src,t,e,oe);
    });
    if(rate&&rate.used) consume(src,rate.list); // 判定に使ったら回数を1消費（全体効果でも1回）
  }
}
function changeStars(pid,v){
  const P=G.players[pid]; P.stars=Math.max(0,P.stars+v);
  log(`${esc(P.name)}：${TERMS.star}${Math.abs(v)}個${v>=0?'獲得':'消失'}`, v>=0?'':'bad');
}
// 強化無効・弱体無効で防がれたら true（防いだ効果に回数があれば1減らす）
function immuneTo(t,k,e0){
  const b=FX[k].buff;
  let guard=b===true?'buffImmune':b===false?'debuffImmune':null;
  // 種類指定つき（vs）は、その効果だけ防ぐ。指定なしはすべて防ぐ
  const matches=x=>x.k===guard&&(!x.vs||x.vs===k);
  if(FX[k].mental&&!t.fx.some(matches)&&t.fx.some(x=>x.k==='mentalImmune')) guard='mentalImmune';
  const g=guard&&t.fx.find(guard==='mentalImmune'?(x=>x.k===guard):matches); if(!g) return false;
  consume(t,[g]); log(`${nm(t)}は${FX[guard].name}で「${e0?fxName(e0):FX[k].name}」を防いだ`,'sub');
  return true;
}
// 戦闘不能：ルール上はその場で倒れるが、画面で暗くするのは一連の攻撃が終わってから（flushKo）
const KO_PEND=[];
// 倒した相手の記録（条件つきセリフの「敗退」「勝利」で who:'other' が見る相手）
// KO_BY：uid→とどめを刺した側（ダメージ・反撃・即死の与え手。継続ダメージ・マスター瀕死の巻き添え・自傷は null） / LAST_KO：陣営ごとの、最後に倒れたユニット
const KO_BY={}, LAST_KO=[null,null];
const markKiller=(u,by)=>{ KO_BY[u.uid]=by&&by!==u?by:null; };
// 戦闘不能時発動（onKoFx）は倒れる前に取っておき、戦闘不能の演出のあと（flushKo）で出す
const KO_TRIG=[];
function retreat(u){ const kt=u.fx.filter(x=>x.k==='onKoFx'); if(kt.length) KO_TRIG.push({u,list:kt,by:KO_BY[u.uid]||null});
  u.hp=0; u.out=true; u.fx=[]; LAST_KO[u.pid]=u; log(`${nm(u)} ${TERMS.out}`,'bad'); KO_PEND.push(u.uid); }
// 攻撃・スキル・終了フェイズの処理が終わったところで呼ぶ：戦闘不能の演出とセリフをまとめて出す
function flushKo(){
  settleGuts();
  if(!KO_PEND.length) return;
  const uids=KO_PEND.splice(0);
  fxEmit({t:'ko',uids});
  uids.forEach(uid=>{ say(U(uid),'defeat',{other:KO_BY[uid]||null}); delete KO_BY[uid]; });
  // 戦闘不能時発動：倒れた本人は効果を受けない。中の効果でさらに倒れたら、もう一度ここを通る
  const kt=KO_TRIG.splice(0);
  kt.forEach(r=>fireTrig(r.u,'onKoFx',[r.by],{list:r.list,pop:true}));
  if(kt.length) flushKo();
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
      if(u.hp<=0){ u.hp=Math.min(g.v,maxHp(u))||1; log(`${nm(u)} ガッツ発動！ HP${u.hp}で復帰`,'good'); fxEmit({t:'pop',uid:u.uid,text:`HP${u.hp}`,cls:'heal'});
        fireTrig(u,'onGutsFx',[KO_BY[u.uid]||null],{pop:true}); } // ガッツ発動時発動（相手＝HPを0にした相手）
      syncU(u);
    } else if(u.hp<=0) retreat(u); // 踏みとどまっている間にガッツを解除された
  });
}
// ---------- 発動型（FX[k].trig）：決まった場面で中の効果（inst.eff）を出す ----------
// u＝持ち主、k＝発動型の種類、others＝その場面の相手（中の効果の t:'target'。攻撃時発動で全体攻撃なら当たった全員）、
// color＝攻撃の色（攻撃時発動の色指定）、list＝発動するもの（戦闘不能時は倒れる前に取っておいたもの）
// 「その場面の相手」への効果は相手ごとに、それ以外（自身・味方全体など）は1回だけ出す。回数つきなら1回の発動で1減る
let TRIG_DEPTH=0;
function fireTrig(u,k,others=[],o={}){
  if(!u||TRIG_DEPTH>=4) return; // 発動の中の効果で別の発動が起きる連鎖は4段まで
  const list=o.list||u.fx.filter(x=>x.k===k&&(!o.color||!x.color||x.color===o.color));
  if(!list.length) return;
  others=others.filter(Boolean);
  TRIG_DEPTH++;
  try{
    for(const x of list){
      const eff=x.eff||[]; if(!eff.length) continue;
      log(`${nm(u)}の${FX[k].name}${x.color&&k==='onAtkFx'?`（${TERMS[x.color]}）`:''}`,'sub');
      if(o.pop) fxEmit({t:'pop',uid:u.uid,text:FX[k].name,cls:'asc'});
      const so={trig:k,src:{...(x.src||{}),trig:k}};
      const mine=eff.filter(e=>e.t!=='target'), toO=eff.filter(e=>e.t==='target');
      if(mine.length) applyEffects(u,mine,null,{...so,other:others[0]||null});
      if(toO.length) others.forEach(t=>{ if(!t.out) applyEffects(u,toO,null,{...so,other:t}); });
    }
  } finally { TRIG_DEPTH--; }
  if(!o.list) consume(u,list);
  ALLM().forEach(syncU);
}
const FX_CAP=60; // 1体に付けられる状態の数の上限（コピーの暴走止め）
function applyOne(src,t,e,o={}){ applyOne0(src,t,e,o); syncU(t); }
function applyOne0(src,t,e,o={}){
  if(t.master&&mTeam()&&FX[e.k].buff===false){ log(`${nm(t)}は${TERMS.unit}に守られていて弱体を受けない`,'sub'); return; } // マスターチーム：マスターは弱体を受けない
  if(!e.sure&&immuneTo(t,e.k,e)) return; // sure＝強化無効・弱体無効で防がれない
  if(e.k==='instantDeath'&&(boostOf(t)||{}).boss){ log(`${nm(t)}はボスのため即死しない`,'sub'); return; } // ボスレイドのボス：即死無効
  { // 即時効果への無効（強化解除・即死・NP減少・スター消失）。NP減少・スター消失は敵からのものだけ防ぐ
    const hostile=src&&src.pid!==t.pid;
    const gk=e.k==='strip'?'stripImmune':e.k==='instantDeath'?'deathImmune':e.k==='np'&&e.v<0&&hostile?'npDownImmune':e.k==='starLoss'&&hostile?'starLossImmune':null;
    const g=gk&&t.fx.find(x=>x.k===gk);
    if(g){ consume(t,[g]); log(`${nm(t)}は${FX[gk].name}で「${FX[e.k].name}」を防いだ`,'sub'); return; }
  }
  switch(e.k){
    case 'heal': { if(has(t,'healBlock')){ log(`${nm(t)}は回復無効でHPが回復しない`,'sub'); return; }
      const v=healAmt(t,e.v); t.hp=Math.min(maxHp(t),t.hp+v); log(`${nm(t)} HP${v}回復${v!==e.v?`（回復量${e.v}→${v}）`:''}`,'good'); return; }
    case 'np': addNp(t,e.v,'other'); log(`${nm(t)} ${TERMS.gauge}${e.v>=0?'+':''}${e.v}%`); return;
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
    case 'ascend': // スキルによる再臨。マスター・戦闘不能・再臨済みには効果なし
      if(t.master||t.out||t.asc){ log(`${nm(t)}は${TERMS.asc}の効果を受けられない`,'sub'); return; }
      ascend(t); return;
    case 'instantDeath': { // HPを0にする。ガッツがあれば踏みとどまる
      log(`${nm(t)}に即死効果`,'bad');
      const g=has(t,'guts');
      fxEmit({t:'dmg',uid:t.uid,text:FX.instantDeath.name,hp0:t.hp,hp:0,out:!g});
      t.hp=0; markKiller(t,src); if(!gutsHold(t)) retreat(t); return;
    }
    case 'selfDmg': { const v=effVal(e,t); log(`${nm(t)} ${FX.selfDmg.name} <b>${fmt(v)}</b>${e.max?'（最大HP・軽減不可）':''}`,'bad'); dealDamage(t,v,false,{src:t}); return; }
    case 'copyBuff': case 'copyDebuff': { // コピー元（o.from）の強化／弱体を、同じ値・残り時間で対象に付ける（付与は1つずつ無効判定・上書きルールに従う）
      const fu=o.from, want=e.k==='copyBuff', nmv=want?'強化':'弱体';
      if(!fu||fu===t){ log(`${nm(t)}：コピー元と対象が同じため${nmv}状態のコピーは効果なし`,'sub'); return; }
      const cand=fu.fx.filter(x=>FX[x.k]&&FX[x.k].buff===want&&!x.tmp&&!x.sure);
      if(!cand.length){ log(`${nm(fu)}に${nmv}状態がないため、${nm(t)}へのコピーは効果なし`,'sub'); return; }
      // 同じ状態（種類・値・色・種類指定・属性・条件が同じ）は、対象がすでに持っている数までは重ねない（コピーし合うと状態が倍々に増えて処理が止まるため）
      const key=x=>[x.k,x.v,x.np??'',x.star??'',x.color||'',x.vs||'',x.trait||'',x.cond?JSON.stringify(x.cond):'',x.eff?JSON.stringify(x.eff):'',x.grow||''].join('|'), have={}; // 出どころ（src）は見ない
      t.fx.forEach(x=>{ const k=key(x); have[k]=(have[k]||0)+1; });
      const list=cand.filter(x=>{ const k=key(x); if(have[k]>0){ have[k]--; return false; } return true; }).slice(0,Math.max(0,FX_CAP-t.fx.length));
      if(!list.length){ log(`${nm(t)}は${nm(fu)}の${nmv}状態をすでに持っているため、コピーは効果なし`,'sub'); return; }
      log(`${nm(t)}が${nm(fu)}の${nmv}状態（${list.length}個）をコピー`, want?'good':'bad');
      list.forEach(x=>{
        const c={k:x.k,t:e.t,v:x.v};
        ['color','turns','times','vs','trait','cond','all','np','star','eff','grow','growMax'].forEach(p=>{ if(x[p]!=null) c[p]=x[p]; });
        if(!t.out) applyOne0(src,t,c,{src:{...(o.src||{}),copy:true}}); // コピーで付いた状態は、元の出どころを引き継がない（コピーしたスキルのもの・copy 印つき）
      });
      return;
    }
    case 'copyRoll': case 'dmg': case 'multiHit': case 'aoe': case 'desc': return; // 宝具側で処理 / 効果なし
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
  const inst={k:e.k,v:e.v,color:e.color||null,turns:e.turns||null,times:e.times??null,owner:src.pid};
  if(e.vs) inst.vs=e.vs;
  if(CARD_PART[e.k]){ inst.np=e.np||0; inst.star=e.star||0; } // カード性能アップ・ダウン：NP獲得量・スター発生量
  if(e.sure) inst.sure=true; // 解除・無効の影響を受けない（ターン・回数では切れる）
  if(e.trait) inst.trait=e.trait;
  if(e.cond&&!e.cond.self) inst.cond=e.cond; // 条件つき（使う瞬間に見る効果はダメージ計算で判定）
  if(FX[e.k].trig) inst.eff=(e.eff||[]).map(x=>({...x})); // 発動型：発動する効果
  if(e.grow){ inst.grow=e.grow; if(e.growMax) inst.growMax=e.growMax; } // 毎ターン上昇
  if(o.src) inst.src={uid:src.uid,def:src.def,...o.src}; // 出どころ（内部用。表示しない）
  if(o.tmp&&e.turns!==0){ inst.tmp=e.turns>1?e.turns:true; inst.turns=null; } // turns:0（ターン無制限）は回数だけで消える。補助：このターンの終了フェイズまで（turns≥2 なら残り回数。自分の終了フェイズごとに-1）
  t.fx.push(inst);
  if(e.k==='maxHp') t.hp+=e.v; // 最大HPが増えたぶん HP も増える
  log(`${nm(t)}に ${fxText(inst)}`, FX[e.k].buff?'good':'bad');
}

// =====================================================================
// ダメージ処理
// =====================================================================
// x以下のダメージ無効：最終ダメージが値以下なら true
const nullified=(tgt,dmg)=>{ const v=Math.max(0,...tgt.fx.filter(e=>e.k==='nullUnder').map(e=>e.v)); return v>0&&dmg<=v?v:0; };
// 無効にした nullUnder（条件を満たすうち最も小さいもの1つ）を使用済みにする
const nullUse=(tgt,dmg)=>{ const l=tgt.fx.filter(e=>e.k==='nullUnder'&&e.v>0&&dmg<=e.v).sort((a,b)=>a.v-b.v); if(l.length) consume(tgt,[l[0]]); };
// 回避・無敵で防げるか。defer(u,list)：攻撃側の必中・無敵貫通の消費（全体攻撃・複数ダメージ効果ではあとでまとめて）。攻撃1回ごとに1回消費
function blocked(att,tgt,defer=consume){
  const pi=att.fx.filter(e=>e.k==='pierce'), sh=att.fx.filter(e=>e.k==='sureHit');
  if(pi.length){ defer(att,pi); return null; }
  if(sh.length) defer(att,sh);
  let e=tgt.fx.find(x=>x.k==='invul');
  if(!e && !sh.length) e=tgt.fx.find(x=>x.k==='evade');
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
  if(ko){ markKiller(u,o.att||o.src); if(!gutsHold(u)){ retreat(u); return; } } // ガッツ：一連の攻撃が終わるまでHP0で踏みとどまる
  if(isHit){
    // 睡眠：攻撃でダメージを受けると解ける（解除不可（sure）の睡眠は解けない）
    if(dmg>0&&u.fx.some(e=>e.k==='sleep'&&!e.sure)){ u.fx=u.fx.filter(e=>e.k!=='sleep'||e.sure); log(`${nm(u)}は攻撃を受けて目を覚ました`,'sub'); }
    // 被ダメージ時NP（onHitNp）も被弾のたびにここで加算する（被ダメージ時スターだけは終了フェイズの hitEffects）
    const c=npSealFx(u), hn=mods(u,'onHitNp');
    if(c){ consume(u,[c]); log(`${nm(u)}は${FX[c.k].name}で${TERMS.gauge}が増えない`,'sub'); if(hn.list.length) consume(u,hn.list); }
    else{
      const hu=mods(u,'hitNpUp'); addNp(u,npRate(u,RULES.gaugeOnHit+hu.sum),'other'); if(hu.list.length) consume(u,hu.list); // 被弾時NP獲得量アップ（回避・無敵で防いだ攻撃はここに来ない）
      if(hn.sum){ addNp(u,hn.sum,'other'); log(`${nm(u)} 被ダメージ時：${TERMS.gauge}+${hn.sum}%`,'good'); consume(u,hn.list); }
    }
    // 反撃：攻撃側へ固定ダメージ（補正・無敵・回避・クリティカルの影響なし、NPは増えない）
    const ct=mods(u,'counter'), a=o.att;
    if(ct.sum&&a&&!a.out){
      log(`${nm(u)}の反撃！ ${nm(a)}に<b>${ct.sum}</b>ダメージ`,'good');
      consume(u,ct.list); dealDamage(a,ct.sum,false,{src:u});
    }
    if(a&&!a.out&&!u.out) fireTrig(u,'onHitFx',[a]); // 被ダメージ時発動（相手＝攻撃してきた相手）
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
  markKiller(m,o.att||o.src);
  m.out=true; m.fx=[];
  const full=D(m.def).hp;
  log(`${nm(m)} 瀕死！ ${TERMS.unit}が${TERMS.player}の最大HP分（${full}）のダメージを受ける`,'bad');
  KO_PEND.push(m.uid); // 暗くする・「瀕死」の文字は、ダメージ演出が終わってから（flushKo）
  alive(m.pid).forEach(u=>dealDamage(u,full,false));
}
// マスターの補助・令呪・攻撃による固定ダメージ（補正・無敵・回避・NP獲得なし）
function fixedHit(src,t,v){
  log(`${nm(src)}の攻撃 → ${nm(t)}に<b>${fmt(v)}</b>ダメージ`);
  dealDamage(t,v,false,{src});
}
// 攻撃側の補正（被ダメージ減少無視なら相手の def を見ない）。使った効果も返す
// 攻撃ダメージ±%（atkPct / atkPctDown）を d に掛ける（pct が 0 なら何もしない）
const applyPct = (d,pct)=>pct?Math.max(0,Math.round(d*(100+pct)/100)):d;
function dmgMods(att,tgt,color){
  const a=modsC(att,'atk',color,tgt), ad=modsC(att,'atkDown',color,tgt), pa=modsC(att,'atkPct',color,tgt), pd=modsC(att,'atkPctDown',color,tgt);
  // ハンデの攻撃ダメージ+ も足す
  let sum=a.sum-ad.sum+(hasHcap(att)?G.hcap.atk:0)+(costBonus(att)?costBonus(att).atk:0)+boostAtk(att); const usedA=[...a.list,...ad.list,...pa.list,...pd.list], usedT=[];
  if(tgt&&!tgt.out){
    // 弱体状態特攻：対象が指定の弱体（vs 未指定なら何か1つ）を受けていれば加算
    const vs=att.fx.filter(e=>e.k==='atkVs'&&tgt.fx.some(x=>e.vs?x.k===e.vs:FX[x.k].buff===false));
    if(vs.length){ sum+=vs.reduce((s,e)=>s+e.v,0); usedA.push(...vs); }
    // 特攻：対象が属性・クラス・キャラIDが trait に一致すれば加算
    const at=att.fx.filter(e=>e.k==='atkTrait'&&traitHit(tgt,e.trait));
    if(at.length){ sum+=at.reduce((s,e)=>s+e.v,0); usedA.push(...at); }
    const dd=modsC(tgt,'defDown',color,att); sum+=dd.sum; usedT.push(...dd.list);
    const ig=att.fx.find(e=>e.k==='ignoreDef');
    if(ig){ if(modsC(tgt,'def',color,att).list.length) usedA.push(ig); }
    else { const df=modsC(tgt,'def',color,att); sum-=df.sum; usedT.push(...df.list);
      // 属性特防：攻撃してきた相手が属性 trait を持っていれば減算（被ダメージ減少無視なら見ない）
      const dt=tgt.fx.filter(e=>e.k==='defTrait'&&traitHit(att,e.trait));
      if(dt.length){ sum-=dt.reduce((s,e)=>s+e.v,0); usedT.push(...dt); } }
  }
  // 色指定のある攻撃ダメージ+（色バフ）の合計：クリティカルで2倍
  const colorBuff=a.list.filter(e=>e.color).reduce((s,e)=>s+modOf(e,'atk'),0);
  return {sum, pct:pa.sum-pd.sum, usedA, usedT, colorBuff};
}
// スター発生数ダウン(starDown)：1回の攻撃で発生するスターの合計から x 個引く（0未満にはしない）。
// カード性能ダウン(cardDown)：その色の攻撃1回で得る NP・発生するスターの合計から np / star を引く。返り値＝まだ引き切れていない分 {star, np}
function gainNpStar(att,cmd,mult){
  let np=att.fx.filter(e=>e.k==='cardDown'&&e.color===cmd.c).reduce((s,e)=>s+(e.np||0),0);
  if(cmd.np){ const v=npRate(att,cmd.np*mult), g=Math.max(0,v-np); np=Math.max(0,np-v); addNp(att,g,'atk'); }
  const sd=mods(att,'starDown',cmd.c); let cut=sd.sum;
  if(cmd.star){ const v=cmd.star*mult, g=Math.max(0,v-cut); cut=Math.max(0,cut-v); G.gen+=g; consume(att,sd.list.filter(e=>!isCard(e))); }
  return {star:cut, np};
}
// ---------- 他のサーヴァントをロール（copyRoll） ----------
const isCopyCmd = c=>!!c&&c.c==='W'&&(c.eff||[]).some(e=>e.k==='copyRoll');
const copyCands = u=>G.players.flatMap(P=>P.party).filter(x=>!x.out&&x.uid!==u.uid);
// 選んだサーヴァントの鉛筆をロールし、再臨後コマンドを返す（同じ特殊行動が出たら振り直し）
// orig＝ロールの元になった特殊行動。そのほかの効果（例：クリティカル率アップ）は、出たコマンドの攻撃前に適用する
function copyRollFrom(src,orig){
  const d=D(src.def); let f, c;
  for(let i=0;i<20;i++){ f=roll(); c=d.faces[f].post; if(!isCopyCmd(c)) break; }
  if(isCopyCmd(c)) c={c:'W',label:'不発',eff:[],np:0,star:0,dmg:0};
  const extra=((orig&&orig.eff)||[]).filter(e=>e.k!=='copyRoll'&&!(FX[e.k]&&FX[e.k].noTgt)).map(e=>({...e,at:'pre'}));
  return {f, cmd:{...c, ...(extra.length?{eff:[...extra,...(c.eff||[])]}:{}), from:d.name}};
}
function doCopy(uid,src){
  const r=G.rolled[G.copy.idx], u=U(uid);
  const {f,cmd}=copyRollFrom(src,r.cmd);
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
  const cons=(u,l)=>o.pend?o.pend.push([u,l]):consume(u,l); // 全体攻撃：攻撃側の効果の消費は全対象に当て終わってから
  const n=nm(att)+lab, sa=st(att);
  let dmg=cmd.dmg; const note=[`基本${dmg}`]; let usedA=[], usedT=[], colorBuff=0;
  sa.attacks++;
  // 2. スキル効果補正 / 3. Busterチェイン
  if(!o.extra){
    const m=dmgMods(att,tgt,cmd.c); usedA=m.usedA; usedT=m.usedT; colorBuff=m.colorBuff;
    if(m.sum){ dmg=Math.max(0,dmg+m.sum); note.push(`補正${m.sum>0?'+':''}${m.sum}`); }
    if(o.chain==='R'){ dmg+=RULES.chainR; note.push(`チェイン+${RULES.chainR}`); }
    if(m.pct){ dmg=applyPct(dmg,m.pct); note.push(`攻撃${m.pct>0?'+':''}${m.pct}%`); }
  } else note.push('エクストラ：補正なし');
  // 4. クリティカル（クラス相性はなし）：スターがあれば1d100で判定。成功でダメージ+30（Buster+60）、色バフ2倍
  let crit=false;
  if(!o.extra){
    const stars=G.players[att.pid].stars;
    if(stars>0){
      const cr=mods(att,'critRoll'), cd=mods(att,'critDown'); // critDown＝クリティカル率ダウン（弱体）
      const cl=o.chain==='G'?(RULES.chainGCritLv||0):0; // Quickチェイン中の3回の攻撃：クリティカルレベル+
      if(ruleset().crit==='d6'){ // シンプルルール：1d6 の出目（クリティカル率アップ(critRoll)で出目を下げる）が必要値以下で成功
        const need=critNeedD6(stars), r=roll()+1, rv=r-cr.sum-cl+cd.sum;
        crit=(need>=6&&!cd.sum)||rv<=need;
        note.push(`クリ判定 出目${r}${cr.sum+cl?`-${cr.sum+cl}`:''}${cd.sum?`+${cd.sum}`:''} ≤ ${need} ${crit?'成功':'失敗'}`);
      } else {
        const lv=Math.max(0,Math.min(CRIT_TABLE.length,critLevel(stars)+cr.sum+cl-cd.sum)), p=critChance(lv);
        const r=Math.floor(Math.random()*100)+1;
        crit=r<=p;
        note.push(`クリ判定 Lv${lv}(${p}%) 出目${r} ${crit?'成功':'失敗'}`);
      }
      cons(att,[...cr.list,...cd.list]);
    }
    if(crit){
      sa.crits++;
      const cp=mods(att,'critPow',cmd.c), cpd=mods(att,'critPowDown',cmd.c), cm=att.fx.filter(e=>e.k==='critMult');
      const pw=cp.sum-cpd.sum+(o.chain==='G'?(RULES.chainGCritDmg||0):0); // クリティカル威力ダウン：増加量から引く（増加量は0未満にしない）。Quickチェイン中は威力+
      if(cm.length){ // クリティカル倍率：+30/+60・色バフ2倍の代わりに、ここまでのダメージ×x%（威力+は最後に加算）
        const pct=Math.max(...cm.map(e=>e.v)), add=Math.max(0,Math.round(dmg*pct/100)-dmg+pw);
        dmg+=add; note.push(`クリ×${pct}%${pw?`${pw>0?'+':''}${pw}`:''}`); cons(att,cm);
      } else {
        const add=Math.max(0,(cmd.c==='R'?RULES.critDmgR:RULES.critDmg)+pw+colorBuff);
        dmg+=add; note.push(`クリ+${add}${colorBuff?`(色バフ+${colorBuff}含む)`:''}${cpd.sum?`(威力ダウン-${cpd.sum}含む)`:''}`);
      }
      cons(att,[...cp.list,...cpd.list]);
    }
  }
  // 6. 最終ダメージ（クリティカルとオーバーキルは重複：獲得NP・発生スターがそれぞれ2倍）
  // ガッツで踏みとどまっている相手（HP0・戦闘不能ではない）はオーバーキルにならない
  const mult=(crit?2:1)*(tgt.out?2:1);
  if(tgt.out){
    log(`${n} ${cmdChip(cmd)} → オーバーキル（${TERMS.gauge}・${TERMS.star}${mult}倍）`);
    fxEmit({t:'dmg',uid:tgt.uid,v:fmt(dmg),crit,over:true});
  } else {
    const b=blocked(att,tgt,cons);
    if(b){ st(tgt).blocked++; log(`${n} ${cmdChip(cmd)} → ${nm(tgt)}：${b}で無効 <span class="sub">(${note.join(' / ')})</span>`); fxEmit({t:'dmg',uid:tgt.uid,text:b}); }
    else if(nullified(tgt,dmg)){ st(tgt).blocked++; log(`${n} ${cmdChip(cmd)} → ${nm(tgt)}：${fmt(dmg)}ダメージは${nullified(tgt,dmg)}以下なので無効 <span class="sub">(${note.join(' / ')})</span>`); fxEmit({t:'dmg',uid:tgt.uid,text:'無効'}); nullUse(tgt,dmg); consume(tgt,usedT); }
    else { log(`${n} ${cmdChip(cmd)} → ${nm(tgt)}：<b>${fmt(dmg)}</b>ダメージ <span class="sub">(${note.join(' / ')})</span>`); consume(tgt,usedT); dealDamage(tgt,dmg,true,{crit,att}); if(o.landed) o.landed.add(tgt); }
  }
  const cut=o.noGain?{star:0,np:0}:gainNpStar(att,cmd,mult);
  cons(att,usedA);
  // 攻撃時○○（エクストラアタックでは発動しない）
  if(!o.extra&&!o.noGain){
    const s=mods(att,'onAtkStar',cmd.c), p=mods(att,'onAtkNp',cmd.c);
    if(s.sum){ const g=Math.max(0,s.sum-cut.star); G.gen+=g; log(`${n} 攻撃時効果：${TERMS.star}${g}個発生`,'sub'); if(cut.star>0){ const sd=mods(att,'starDown',cmd.c); consume(att,sd.list.filter(e=>!isCard(e))); } }
    if(p.sum){ const v=Math.max(0,npRate(att,p.sum)-cut.np); addNp(att,v,'atk'); log(`${n} 攻撃時効果：${TERMS.gauge}+${p.sum}%${cut.np?`（カード性能ダウン-${Math.min(cut.np,npRate(att,p.sum))}）`:''}`,'sub'); }
    consume(att,[...s.list,...p.list].filter(e=>!isCard(e))); // カード性能アップ・ダウンの回数は攻撃ダメージ側で1回だけ減らす
    consume(att,att.fx.filter(e=>isCard(e)&&!(e.v>0)&&e.color===cmd.c)); // 威力0のカード性能アップ・ダウンはここで1回減らす
  }
}
const FACE_SRC={src:{kind:'face'}}; // 鉛筆の面（コマンド・特殊行動）の効果の出どころ
function resolveCommand(att,cmd,tgt,o={}){
  const n=nm(att);
  const atkFx=(to,x={})=>fxEmit({t:'atk',uid:att.uid,tgt:to,cmd,ri:o.ri,extra:!!o.extra,...x});
  if(cmd.c==='ASC'){ if(cmdLine(cmd)) say(att,'attack',{own:cmd.line}); atkFx(null); log(`${n}：${TERMS.ascFull}（1行動）`,'sub'); return; }
  if(isCopyCmd(cmd)){ // エクストラアタックで出たときは対象をランダムに選んで、その場でロール
    const cs=copyCands(att); if(!cs.length) return;
    const src=cs[Math.floor(Math.random()*cs.length)], r=copyRollFrom(src,cmd);
    log(`${n}：${nm(src)}の鉛筆をロール 出目${r.f+1} → ${cmdChip(r.cmd)}`);
    rollFx(src.uid,r.f,{cmd:r.cmd,def:src.def});
    return resolveCommand(att,r.cmd,tgt,o);
  }
  if(cmd.c==='W') log(`${n}：特殊行動「${esc(cmd.label)}」${cmd.from?`（${esc(cmd.from)}）`:''}`);
  if((cmd.eff||[]).some(e=>e.roll)) cmd={...cmd,eff:effRollPick(att,cmd.eff)}; // 出目で分岐：使うたびに1回振って、出た効果だけ残す
  // 付加効果のタイミング：既定は特殊行動＝攻撃前、通常コマンド＝攻撃後（効果ごとの at で変えられる）
  // ダメージ効果（dmg・特殊行動のみ）は攻撃前の効果と面の攻撃のあと、攻撃後の効果の前に当てる（effDamage）
  const [preE,postE]=splitEffs((cmd.eff||[]).filter(e=>e.k!=='dmg'),EFF_AT_DEFAULT[cmd.c==='W'?'W':'cmd']);
  const effHit=()=>(cmd.eff||[]).filter(e=>e.k==='dmg').forEach(e=>{ if(!att.out) effDamage(att,e,tgt,hitsOf(cmd.eff)); });
  if(cmd.c==='W'){
    if(!(cmd.dmg>0)){ if(cmdLine(cmd)) say(att,'attack',{own:cmd.line,other:tgt}); atkFx(null); applyEffects(att,preE,null,FACE_SRC); effHit(); if(!att.out) applyEffects(att,postE,null,FACE_SRC); gainNpStar(att,cmd,1); syncU(att); return; }
    // ダメージを持つ特殊行動は無属性の攻撃として続けて処理する（チェインには数えない）
  }
  applyEffects(att,preE,null,FACE_SRC); // 攻撃前の効果（防御無視・無敵貫通などを付けてから攻撃）
  if(att.out) return; // 攻撃前の自傷などで倒れた
  say(att,(o.extra&&(D(att.def).lines.extra||[]).length)?'extra':'attack',{w:250,own:cmdLine(cmd),other:tgt}); // 吹き出しと攻撃カードを重ねて見せる（エクストラ用が空なら通常の攻撃セリフ。面の専用セリフがあればそちら）
  // 連続攻撃：同じ攻撃を hits 回。1回ごとに補正・クリティカル・NP・スター・回避/無敵・回数制の効果を処理する
  const hits=hitsOf(cmd.eff);
  if(hits>1) log(`${n} ${cmdChip(cmd)}：${hits}回連続攻撃`,'sub');
  // 攻撃の全体化：選んだ対象のあと、残りの生存する敵にも同じ攻撃を当てる（NP・スター・攻撃時効果は最初の1回だけ。マスターには当たらない）
  const aoe=(isAoe(cmd.eff)||has(att,'aoeNormal'))&&cmd.dmg>0; // 面の効果の全体化、または自分に付いている「通常攻撃の全体化」
  const tl=aoe?[tgt,...alive(1-att.pid).filter(x=>x!==tgt)]:[tgt];
  if(aoe) log(`${n} ${cmdChip(cmd)}：${isAoe(cmd.eff)?'攻撃の全体化':'通常攻撃の全体化'}（敵全体に攻撃）`,'sub');
  if(!o.extra) o={...o,landed:new Set()}; // 攻撃時発動：攻撃が当たった相手（連続攻撃でも1体1回）
  for(let h=0;h<hits;h++){
    const pend=aoe?[]:null;
    for(let i=0;i<tl.length;i++){
      if(att.out) break; // 反撃で倒れたら残りの攻撃はしない
      const t=tl[i];
      if(i&&t.out) continue;
      t.tgtd=true;
      atkFx(t.uid,h||i?{w:260}:{}); // 戦闘不能の相手にも（オーバーキル）カードを飛ばす
      attackHit(att,cmd,t,aoe?{...o,pend,noGain:i>0}:o,hits>1?`（${h+1}/${hits}）`:'');
    }
    if(pend) pend.forEach(([u,l])=>consume(u,l));
  }
  if(aoe&&!isAoe(cmd.eff)) consume(att,att.fx.filter(e=>e.k==='aoeNormal')); // 通常攻撃の全体化：攻撃1回で1回消費
  tl.forEach(syncU); syncU(att); // 獲得したNP・使い切った効果は、ダメージ演出のあとで画面に反映
  if(o.landed&&o.landed.size&&!att.out) fireTrig(att,'onAtkFx',[...o.landed],{color:cmd.c});
  effHit(); if(att.out) return;

  // 攻撃後の効果（例：自身の弱体解除）
  applyEffects(att,postE,null,FACE_SRC);
}
// 宝具の「他のサーヴァントをロール」（n個ぶんまとめて）：選んだ1体（picked）の鉛筆を、選ばなければランダムな1体のを、ロールして
// 出た再臨後コマンドを攻撃対象に使う。出たコマンドは通常のコマンドと同じく NP・スターを増やす。
// ちょうど3回ロールするときは「攻撃3回」とみなす：3つとも同じ色ならチェイン、そのあと宝具の持ち主のエクストラアタック（ブレイブチェイン）
function ultCopyRolls(u,tgt,picked,n,noExtra){
  const t=tgt||alive(1-u.pid)[0], cs=copyCands(u); if(!t||!cs.length) return;
  const cmds=[];
  for(let i=0;i<n;i++){ // 先に全部ロールする（チェインは3枚そろってから決まる）
    const src=picked&&cs.includes(picked)?picked:cs[Math.floor(Math.random()*cs.length)], r=copyRollFrom(src);
    log(`${nm(u)}：${nm(src)}の鉛筆をロール 出目${r.f+1} → ${cmdChip(r.cmd)}`);
    rollFx(src.uid,r.f,{cmd:r.cmd,def:src.def});
    cmds.push(r.cmd);
  }
  const three=n===3, c0=cmds[0].c;
  const chain=three&&['R','B','G'].includes(c0)&&cmds.every(c=>c.c===c0)?c0:null;
  if(chain){ log(`${TERMS[chain]}チェイン発生！`,'good'); fxEmit({t:'banner',title:`${TERMS[chain]} Chain`,col:chain}); chainsOf(u.pid)[chain]++; chainGNow(u.pid,chain); }
  cmds.forEach((cmd,ri)=>{ if(!u.out) resolveCommand(u,cmd,t,{chain,ri}); });
  if(u.out) return;
  if(chain==='B'){ addNp(u,npRate(u,RULES.chainB),'atk'); syncU(u); log(`チェインボーナス：${nm(u)}の${TERMS.gauge}+${RULES.chainB}%`); }
  if(chain==='G'){ gainStars(u.pid,RULES.chainG); log(`チェインボーナス：${TERMS.star}${RULES.chainG}個発生`); }
  if(three&&!noExtra){ // ブレイブチェイン（copyRoll に「エクストラなし」があれば行わない）：宝具の持ち主のカードでエクストラアタック
    const f=roll(), face=D(u.def).faces[f];
    log(`ブレイブチェイン！ ${nm(u)}のエクストラアタック（出目${f+1}）`,'good'); chainsOf(u.pid).brave++;
    fxEmit({t:'banner',title:'Brave Chain',sub:'エクストラアタック'});
    const cmd=!u.asc&&face.pre.c==='ASC'?face.pre:u.asc?face.post:face.pre;
    rollFx(u.uid,f,{cmd,keys:[`f:${u.uid}`]}); u.face={i:f,kind:'cmd',cmd};
    if(cmd.c==='ASC') ascend(u); else resolveCommand(u,cmd,t,{extra:true});
  }
}
// ダメージ効果（dmg）を1つ、hits 回（宝具・特殊行動で共通）。o.ult＝宝具（色 o.c・宝具威力±・宝具被ダメージ-・敵マスターへの全体ダメージ・被ダメージ時セリフ）
// 特殊行動のダメージは無属性の攻撃（攻撃ダメージ±・被ダメージ±・回避・無敵・ダメージ無効・被ダメージ時NP・反撃が働く）
// e.fixed＝相手の効果を受けない固定ダメージ：補正・回避・無敵・ダメージ無効なし、相手のNPは増えず反撃もない（マスターの固定ダメージと同じ扱い）
function effDamage(u,e,tgt,hits,o={}){
  for(let h=0;h<hits;h++){
    if(u.out) break;
    // マスタールール：全体宝具は敵マスターにも当たる（退避中なら当たらない。無敵・回避などでは防げない）。特殊行動は当たらない
    const em=masterOf(1-u.pid), hitM=o.ult&&e.t==='enemy_all'&&em&&!em.out&&!G.players[em.pid].evac&&!mTeam();
    let ts = e.t==='enemy_all' ? [...alive(1-u.pid),...(hitM?[em]:[])] : [tgt].filter(x=>x&&!x.out&&x.pid!==u.pid);
    if(e.cond) ts=ts.filter(t=>condOk(e.cond,t)); // 条件つきダメージ：満たす対象だけ
    if(!ts.length) break;
    const usedA=new Set(), lab=hits>1?`（${h+1}/${hits}）`:'';
    for(const t of ts){
      t.tgtd=true;
      // 宝具威力アップ・ダウンは攻撃ダメージ+と同じく足し引き。max（最大HPぶん）は補正を受けない（軽減不可）
      let dmg, usedT=[];
      const ev=e.scale?scaleVal(u,e,t):e.v; // 参照して威力が増える（対象ごとに数える）
      if(e.scale&&!h&&ev!==e.v) log(`${nm(u)}：${scaleText(e.scale)} → 威力${e.v}→${ev}`,'sub');
      if(e.max) dmg=maxHp(t);
      else if(e.fixed) dmg=ev;
      else {
        const m=dmgMods(u,t,o.ult?o.c:null), up=o.ult?mods(u,'npPow'):{sum:0,list:[]}, dn=o.ult?mods(u,'npPowDown'):{sum:0,list:[]};
        [...m.usedA,...up.list,...dn.list].forEach(x=>usedA.add(x)); usedT=m.usedT;
        dmg=applyPct(Math.max(0,ev+m.sum+up.sum-dn.sum),m.pct);
        // 宝具被ダメージ-：受ける側の宝具ダメージを減らす（被ダメージ減少無視なら見ない）
        const nd=!o.ult||has(u,'ignoreDef')?null:mods(t,'npDef');
        if(nd&&nd.list.length){ dmg=Math.max(0,dmg-nd.sum); usedT=[...usedT,...nd.list]; }
      }
      if(t.master&&e.t==='enemy_all'){ log(`→ ${nm(t)}${lab}：<b>${fmt(dmg)}</b>ダメージ`); dealDamage(t,dmg,false,{np:!!o.ult,src:u}); continue; }
      if(e.fixed){ log(`→ ${nm(t)}${lab}：<b>${fmt(dmg)}</b>ダメージ（${e.max?'最大HP・':''}固定）`); dealDamage(t,dmg,false,{np:!!o.ult,src:u}); if(o.ult&&!t.out&&!h) say(t,'npDamage',{other:u}); continue; }
      const b=blocked(u,t,(x,l)=>l.forEach(y=>usedA.add(y)));
      if(b){ st(t).blocked++; log(`→ ${nm(t)}${lab}：${b}で無効`); fxEmit({t:'dmg',uid:t.uid,text:b}); }
      else if(!e.max&&nullified(t,dmg)){ st(t).blocked++; log(`→ ${nm(t)}${lab}：${fmt(dmg)}ダメージは${nullified(t,dmg)}以下なので無効`); fxEmit({t:'dmg',uid:t.uid,text:'無効'}); nullUse(t,dmg); consume(t,usedT); }
      else { log(`→ ${nm(t)}${lab}：<b>${fmt(dmg)}</b>ダメージ${e.max?'（最大HP・軽減不可）':''}`); consume(t,usedT); dealDamage(t,dmg,true,{np:!!o.ult,att:u}); if(o.ult&&!t.out&&!h) say(t,'npDamage',{other:u}); }
      if(u.out) break; // 反撃で倒れたら残りの対象には当たらない
    }
    consume(u,[...usedA]);
    ts.forEach(syncU); syncU(u);
  }
}
function resolveUlt(u,tgt,picked){
  const ud=D(u.def).ult;
  if(picked===undefined) picked=G.ultPick?U(G.ultPick):null;
  log(`${nm(u)}の${TERMS.ult}「${esc(ud.name)}」！`,'good');
  u.np=0; syncU(u); // 宝具を撃った時点でNPを全部払う（使用予定の間は減らさない）
  fxEmit({t:'cutin',uid:u.uid,title:ud.name,ruby:ud.ruby,br:ud.br,col:ud.c});
  say(u,'np',{other:tgt});
  st(u).ults++;
  const effs=effRollPick(u,ud.eff); // 出目で分岐：撃つたびに1回振って、出た効果だけ使う
  const hits=hitsOf(effs); // 連続攻撃：ダメージ効果それぞれを hits 回
  if(hits>1) log(`${hits}回連続攻撃`,'sub');
  let copyDone=false;
  for(const e of ultEffOrder(effs)){
    if(u.out) break; // 反撃で倒れたら残りの効果は出ない
    if(e.k==='copyRoll'){ if(!copyDone){ copyDone=true; ultCopyRolls(u,tgt,picked,effs.filter(x=>x.k==='copyRoll').length,effs.some(x=>x.k==='copyRoll'&&x.noExtra)); flushKo(); } continue; } // ロールは最初の1つのところでまとめて行う
    if(e.k!=='dmg'){ applyEffects(u,[e],picked,{src:{kind:'ult'}}); continue; }
    effDamage(u,e,tgt,hits,{ult:true,c:ud.c});
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
    if(chain){ log(`${TERMS[chain]}チェイン発生！`,'good'); fxEmit({t:'banner',title:`${TERMS[chain]} Chain`,col:chain}); chainsOf(G.cur)[chain]++; chainGNow(G.cur,chain); }
    acts.forEach((a,ri)=>{ if(!U(a.uid).out) resolveCommand(U(a.uid),a.cmd,tgt,{chain,ri}); }); // 反撃で倒れたら残りの行動はしない
    if(chain==='B'){ [...new Set(acts.map(a=>a.uid))].map(U).forEach(u=>{ addNp(u,npRate(u,RULES.chainB),'atk'); syncU(u); }); log(`チェインボーナス：行動${TERMS.unit}の${TERMS.gauge}+${RULES.chainB}%`); }
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
// Quickチェイン成立時（コマンドを解決する前）：そのターンの手持ちスターを増やす。クリティカルレベル・威力は attackHit が o.chain==='G' で足す
function chainGNow(pid,chain){
  if(chain!=='G'||!RULES.chainGNow) return;
  G.players[pid].stars+=RULES.chainGNow; // 手番側の手持ちはターン終了で G.gen に置き換わるので、そのターンだけ有効
  log(`チェインボーナス：このターンの${TERMS.star}+${RULES.chainGNow}、クリティカルLv+${RULES.chainGCritLv}・威力+${RULES.chainGCritDmg}`);
}
const chainsOf = pid=>(G.chains||(G.chains=[{R:0,B:0,G:0,brave:0},{R:0,B:0,G:0,brave:0}]))[pid];
function ascend(u){ u.asc=true; fxEmit({t:'pop',uid:u.uid,text:TERMS.ascFull,cls:'asc'}); log(`${nm(u)} ${TERMS.ascFull}！ 以降は${TERMS.asc}後コマンド、スキル3解放`,'good'); }

// =====================================================================
// ターン進行
// =====================================================================
function startGame(){
  G.players.forEach((P,pid)=>{ P.party=G.picks[pid].map((id,i)=>makeUnit(pid,i,id)); P.stars=0;
    P.master=masterRule()&&G.mpicks[pid]?makeMaster(pid,G.mpicks[pid]):null; P.spell=null; P.spellLeft=ruleset().spells||1; P.spellUsed=[false,false,false]; P.evac=false; P.zeroNext=false; });
  applyHandicap(); applyBoost();
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
  // マスターがいればマスター → 先頭のサーヴァントの順（マスターは start のセリフがあるときだけ喋る）
  [G.cur,1-G.cur].forEach(pid=>{ const f=G.players[pid].party[0], o=G.players[1-pid].party[0], m=masterOf(pid);
    if(m&&!m.out) say(m,'start',{other:o}); say(f,'start',{other:o}); });
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
  const hb=(rs.hcapBonus||[]).filter(b=>diff>=b.gap).sort((a,b)=>b.gap-a.gap)[0]; // コスト差以下で最大の gap の行
  if(hb){
    G.hcap={pid:low, np:hb.np||0, atk:hb.atk||0, hp:hb.hp||0};
    if(G.hcap.hp) G.players[low].party.forEach(u=>{ u.hp=maxHp(u); }); // 最大HPが増えたぶん開始時のHPも増やす
    log(`ハンデ戦：コスト差${diff}のため ${esc(G.players[low].name)} の${TERMS.unit}は ${hcapText()}`,'h');
  }
}
// ハンデ（コスト差が大きいほど段階的に強化。HCAP_BONUS）：低コスト側のサーヴァントの攻撃ダメージ+atk・獲得NP+np%・最大HP+hp（解除できない）
const hasHcap = u=>!!G.hcap&&G.hcap.pid===u.pid&&!u.master;
const hcapText = ()=>G.hcap?`攻撃ダメージ+${G.hcap.atk}・獲得${TERMS.gauge}+${G.hcap.np}%${G.hcap.hp?`・最大HP+${G.hcap.hp}`:''}`:'';
// 攻撃・被弾・チェインで得るNPに、ハンデのNP獲得量アップを掛ける（スキルなどで直接増えるNPには掛けない）
const npRate = (u,v)=>{ const r=(hasHcap(u)?G.hcap.np||0:0)+((boostOf(u)||{}).np||0); return r?Math.round(v*(100+r)/100):v; }; // 陣営の補正（boost）の獲得NP+% も足す
// ---------- 陣営ごとの常時補正（ボスレイドのボス・聖杯戦争の報酬と相手の補正。RAID / ROGUE＝rules.js） ----------
// G.boost[pid]＝{label, hp, atk, np, npStart, stars, acts, asc, boss, rage, raged}
//   hp＝最大HP+ / atk＝攻撃ダメージ+ / np＝獲得NP+%（攻撃・被弾・チェイン）/ npStart＝開始時のNP / stars＝開始時のスター / acts＝最大行動回数+ / asc＝最初から霊基再臨
//   boss＝ボス（即死無効。HPが rage.at 以下になったターンの始めに一度だけ怒り＝弱体解除＋以降 攻撃ダメージ+rage.atk。raged＝怒り済み）
// fx ではないので、強化解除・弱体解除・弱体状態特攻の対象にならない。マスターには掛からない
const boostOf = u=>!!u&&!u.master&&u.pid!=null&&G.boost?G.boost[u.pid]||null:null;
const boostAtk = u=>{ const b=boostOf(u); return b?(b.atk||0)+(b.raged&&b.rage?b.rage.atk||0:0):0; };
function boostText(b){
  if(!b) return '';
  const p=[b.hp?`最大HP+${b.hp}`:'', b.atk||b.raged?`攻撃ダメージ+${(b.atk||0)+(b.raged&&b.rage?b.rage.atk||0:0)}`:'', b.np?`獲得${TERMS.gauge}+${b.np}%`:'', b.acts?`最大行動回数+${b.acts}`:'',
    b.npStart?`開始時${TERMS.gauge}+${b.npStart}%`:'', b.stars?`開始時${TERMS.star}+${b.stars}`:'', b.boss?'即死無効':'', b.raged?'怒り':''].filter(Boolean);
  return p.join('・');
}
// 試合開始時：最大HPを反映し、開始時のNP・スター・霊基再臨を与える
function applyBoost(){
  G.players.forEach((P,pid)=>{ const b=G.boost&&G.boost[pid]; if(!b) return;
    P.party.forEach(u=>{ u.hp=maxHp(u); if(b.npStart) u.np=Math.min(RULES.gaugeMax,u.np+b.npStart); });
    if(b.stars) P.stars+=b.stars;
    log(`${esc(P.name)}：${esc(b.label||'補正')} → ${TERMS.unit}は ${boostText(b)}`,'h');
    if(b.asc) P.party.forEach(u=>{ if(!u.asc) ascend(u); });
  });
}
// ボスの怒り：手番の始めに、HPが半分（rage.at）以下のボスがいれば一度だけ
function bossRage(){
  G.players.forEach((P,pid)=>{ const b=G.boost&&G.boost[pid]; if(!b||!b.boss||b.raged||!b.rage) return;
    const u=P.party.find(x=>!x.out&&x.hp<=maxHp(x)*b.rage.at); if(!u) return;
    b.raged=true; u.fx=u.fx.filter(x=>x.sure||FX[x.k].buff!==false); syncU(u);
    log(`${nm(u)}が怒り状態になった！ 弱体をすべて解除し、攻撃ダメージ+${b.rage.atk}`,'bad');
    phaseFx('RAGE',`${D(u.def).name}の怒り`,{pid});
    fxEmit({t:'pop',uid:u.uid,text:'怒り',cls:'asc'});
  });
}
function beginTurn(){
  Object.assign(G,{phase:'actRoll',actRolled:false,maxActs:{},alloc:{},rolled:[],ult:null,ultSup:false,ultPick:null,target:null,targetAll:false,gen:0,pending:null,copy:null,guard:null,mastered:false,ultDone:false,spellPick:null});
  const P=G.players[G.cur];
  if(P.evac){ P.evac=false; log(`${esc(P.name)}の${TERMS.player}が退避から戻った`,'sub'); }
  log(`━ ターン${G.turn}：${esc(G.players[G.cur].name)} ━`,'h');
  phaseFx(`TURN ${G.turn}`,`${G.players[G.cur].name}の手番`,{big:true,pid:G.cur});
  bossRage(); // ボスレイド：HPが半分以下になったボスは怒る
  // ① ターン開始：ターン開始時○○ を発動してから、このプレイヤーが付与した効果の残りターン-1
  turnStartEffects();
  const delay=[];
  ALLM().forEach(u=>{
    u.fx.forEach(e=>{ if(e.owner!==G.cur) return; if(e.turns!=null) e.turns--;
      if(e.grow&&e.turns!==0){ const v=e.growMax?Math.min(e.growMax,e.v+e.grow):e.v+e.grow; if(v!==e.v){ e.v=v; log(`${nm(u)}の ${fxText(e)}`,'sub'); } } }); // 毎ターン上昇（切れるターンには上げない）
    const ex=u.fx.filter(e=>e.turns!=null&&e.turns<=0);
    if(ex.length){ u.fx=u.fx.filter(e=>!ex.includes(e)); clampHp(u); syncU(u); log(`${nm(u)}の ${ex.map(fxName).join('・')} が終了`,'sub');
      const d=ex.filter(e=>e.k==='delayFx'); if(d.length&&!u.out) delay.push([u,d]); }
  });
  delay.forEach(([u,d])=>{ if(!u.out) fireTrig(u,'delayFx',[],{list:d,pop:true}); }); // 遅延発動：ターン経過で切れたとき
  flushKo(); checkWin(); // ターン開始時の発動・遅延発動で倒れることがある
}
// ターン開始時○○：手番側の生存サーヴァントに付いているものが発動（スターはこのターンの手持ちに加わる）
function turnStartEffects(){
  alive(G.cur).forEach(u=>{
    const h0=mods(u,'regenHp').sum, h=h0?healAmt(u,h0):0, n=mods(u,'regenNp').sum, s=mods(u,'regenStar').sum;
    if(h&&has(u,'healBlock')) log(`${nm(u)}は回復無効でターン開始時に回復しない`,'sub');
    else if(h&&u.hp<maxHp(u)){ const v=Math.min(h,maxHp(u)-u.hp); u.hp+=v; log(`${nm(u)} ターン開始時：HP${v}回復`,'good'); fxEmit({t:'pop',uid:u.uid,text:`HP+${v}`,cls:'heal'}); }
    if(n){ addNp(u,n,'other'); log(`${nm(u)} ターン開始時：${TERMS.gauge}+${n}%`,'good'); }
    syncU(u);
    if(s){ G.players[G.cur].stars+=s; log(`${nm(u)} ターン開始時：${TERMS.star}${s}個獲得`,'good'); }
  });
  alive(G.cur).forEach(u=>{ if(!u.out) fireTrig(u,'startFx',[],{pop:true}); }); // ターン開始時発動
}
// 被ダメージ時○○：このターンに攻撃対象になったサーヴァント（敵味方とも）に付いているものが、終了フェイズに1回発動
function hitEffects(){
  ALL().forEach(u=>{
    if(!u.tgtd) return; delete u.tgtd;
    if(u.out) return;
    const hs=mods(u,'onHitStar');
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
    let ps=top('poison')*(has(u,'erosion')?2:1), bs=top('burn')*(has(u,'spread')?2:1), ds=mods(u,'drain').sum; // 蝕毒＝毒2倍 / 延焼＝やけど2倍
    // 弱体無効：種類指定なし＝すべて防ぐ（1回消費）／種類指定あり＝その弱体ダメージだけ防ぐ
    const blockDot=(k,v)=>{ if(!v) return v; const g=u.fx.find(e=>e.k==='debuffImmune'&&(!e.vs||e.vs===k)); if(!g) return v; consume(u,[g]); log(`${nm(u)}は${FX.debuffImmune.name}で${FX[k].name}ダメージを防いだ`,'sub'); return 0; };
    ps=blockDot('poison',ps); bs=blockDot('burn',bs); ds=blockDot('drain',ds);
    const d=ps+bs+ds;
    if(!d) return;
    log(`${nm(u)} 弱体ダメージ${d}（${[ps?`毒${ps}`:'',bs?`やけど${bs}`:'',ds?`HP減少${ds}`:''].filter(Boolean).join('・')}）`,'bad');
    dealDamage(u,d,false);
  }));
  alive(G.cur).forEach(u=>{ if(!u.out) fireTrig(u,'endFx',[],{pop:true}); }); // ターン終了時発動（弱体ダメージのあと）
  hitEffects();
  // マスターの補助の効果：このターンだけのものを消し、複数ターンのもの（tmp が数）は残りを-1
  ALLM().forEach(u=>{ if(!u.fx.some(e=>e.tmp&&e.owner===G.cur)) return;
    u.fx=u.fx.filter(e=>{ if(!e.tmp||e.owner!==G.cur) return true; if(e.tmp===true||e.tmp<=1) return false; e.tmp--; if(e.tmp<=1) e.tmp=true; return true; });
    clampHp(u); syncU(u); });
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
function win(pid){ const first=G.winner==null; G.winner=pid; G.phase='over';
  if(first&&typeof recordMatch==='function'&&!(typeof cpuInRollout!=='undefined'&&cpuInRollout)) recordMatch(); // 戦績（records.js。ゲーム画面だけ）
  log(`${esc(G.players[pid].name)} の勝利！`,'good');
  phaseFx(G.mode==='cpu'?(pid===0?'VICTORY':'DEFEAT'):'WINNER',G.mode==='cpu'?'':`${G.players[pid].name}の勝利`,{big:true,pid,end:true});
  // 勝った側のマスター → 勝った側のサーヴァント → 負けた側のマスター（敗北）の順。マスターはセリフがあるときだけ喋る
  const w=alive(pid)[0], m=masterOf(pid), lm=masterOf(1-pid);
  if(m&&!m.out) say(m,'win',{other:LAST_KO[1-pid]||null});
  if(w) say(w,'win',{other:LAST_KO[1-pid]||null});
  if(lm) say(lm,'defeat',{other:w||null}); }
// ---------- アーケード（CPUと連戦。ARCADE＝rules.js） ----------
// 流れ：chooseMode(arcade) → 編成（プレイヤーだけ）→ phase 'stage'（ステージ紹介）→ arcadeGo で対戦 → 勝ったら arcadeNext で次の 'stage' …
// G.arcade：diff＝難易度 / stage＝今のステージ（0始まり）/ picks・mpick＝プレイヤーの編成（全ステージ共通）/ leads＝これまでの相手の先頭 / results＝終わったステージの記録
// エンドレス（ARCADE.diffs[].endless）はステージ数の上限なし。CPUの強さは levels を順に使い、使い切ったら最後の強さのまま
// kind：'arcade'＝アーケード / 'raid'＝ボスレイド（RAID）/ 'rogue'＝聖杯戦争（ROGUE）。難易度の設定は arcadeDf()（どれも levels の数がステージ数）
const ARC_KINDS = { arcade:{name:'アーケード', cfg:()=>ARCADE}, raid:{name:'ボスレイド', cfg:()=>RAID}, rogue:{name:'聖杯戦争', cfg:()=>ROGUE} };
const arcadeKind = (A=G.arcade)=>A&&ARC_KINDS[A.kind]?A.kind:'arcade';
const arcadeDf = (A=G.arcade)=>{ const C=ARC_KINDS[arcadeKind(A)].cfg(); return C.diffs[A.diff]||C.diffs.normal; };
const arcadeName = ()=>arcadeEndless()?'エンドレス':ARC_KINDS[arcadeKind()].name;
const arcadeEndless = ()=>!!G.arcade&&!!G.arcade.endless;
const arcadeStages = ()=>arcadeEndless()?Infinity:arcadeDf().levels.length;
// ボス戦のステージか（ボスレイドは全部、聖杯戦争は最後だけ）
const arcadeBossAt = (A,i)=>arcadeKind(A)==='raid'||(arcadeKind(A)==='rogue'&&i===arcadeDf(A).levels.length-1);
const arcadeLevel = (df,i)=>df.levels[Math.min(i,df.levels.length-1)];
const arcadeLast = ()=>!!G.arcade&&G.arcade.stage>=arcadeStages()-1;
// コンティニュー：負けたステージを同じ相手でやり直す（回数は G.arcade.continues。総合リザルトに出す）。エンドレスでは不可
const arcadeCanContinue = ()=>!!G.arcade&&G.phase==='over'&&G.winner!==0&&!arcadeEndless();
// 今のステージの相手を編成して、ステージ紹介へ。1戦目だけコストを first ぶんずらす。先頭がこれまでの相手と重なったら選び直す（数回まで）
// 相手には、すでに登場したサーヴァント・マスター（A.seen）と、1周目だけはプレイヤーの編成もなるべく出さない。
// 残りで同じコストの編成が作れなくなったら seen を空にして次の周（A.lap）へ。2周目からはプレイヤーの編成も解禁
const arcadeAvoid = A=>[...(A.seen||[]),...(A.lap?[]:[...A.picks,A.mpick].filter(Boolean))];
function arcadeStage(){
  const A=G.arcade, df=arcadeDf(A), K=arcadeKind(A), delta=K==='rogue'?(df.delta||[])[A.stage]||0:A.stage===0?df.first||0:0;
  G.level=arcadeLevel(df,A.stage); G.setupPid=1; G.phase='setup';
  A.foe=null; G.boost=[arcadeBoost(A),null];
  if(arcadeBossAt(A,A.stage)){ bossStage(A,df); return; }
  if(K==='rogue'&&df.foe&&(df.foe.atk||df.foe.hp)) A.foe={label:`STAGE ${A.stage+1} の補正`, atk:df.foe.atk*A.stage, hp:df.foe.hp*A.stage};
  G.boost[1]=A.foe&&(A.foe.atk||A.foe.hp)?{...A.foe}:null;
  for(let t=0;t<4;t++){
    if(ACTIONS.setupCpu({how:'same',delta,avoid:arcadeAvoid(A)})===false){ A.seen=[]; A.lap=(A.lap||0)+1; ACTIONS.setupCpu({how:'same',delta,avoid:arcadeAvoid(A)}); }
    if(!A.leads.slice(-4).includes(G.picks[1][0])) break;
  }
  A.leads.push(G.picks[1][0]);
  A.seen=[...(A.seen||[]),...G.picks[1],...(G.mpicks[1]?[G.mpicks[1]]:[])];
  G.setupMsg=''; G.phase='stage';
}
// 決着したステージの記録（総合リザルト用）
// ボス戦：ボス（コスト RAID.minCost 以上・これまでに出ていない・自軍にいない）を1騎選び、補正（G.boost[1]）を付けてステージ紹介へ
// 倍率 hp は自軍3騎のときの値。自軍が少ない（聖杯戦争で仲間を増やさなかった）ときは、増えるぶんを人数に合わせて減らす
function bossStage(A,df){
  const mine=new Set(A.picks), seen=new Set(A.seen||[]), all=ROSTER().filter(d=>!mine.has(d.id)&&!d.spells);
  const eb=ALL_UNITS.filter(d=>d.enemy==='boss'&&!mine.has(d.id)); // エネミー専用のボスはコストに関係なく候補
  const top=Math.max(0,...all.map(d=>d.cost)), big=[...all.filter(d=>d.cost>=Math.min(RAID.minCost,top)),...eb];
  const pool=big.filter(d=>!seen.has(d.id)), c=(pool.length?pool:big.length?big:UNITS)[Math.floor(Math.random()*(pool.length||big.length||UNITS.length))];
  const i=A.stage, raid=arcadeKind(A)==='raid', cfg=raid?{hp:df.hp[i],atk:df.atk[i],np:df.np,acts:df.acts}:df.boss, n=Math.max(1,A.picks.length);
  const mult=Math.max(1,1+(cfg.hp-1)*Math.min(3,n)/3); // 3騎なら hp 倍、1騎なら増えるぶんが1/3
  A.foe={label:'ボス', boss:true, asc:true, hp:Math.round(c.hp*(mult-1)/10)*10, atk:cfg.atk||0, np:cfg.np||0, acts:cfg.acts||0, rage:{...RAID.rage}, raged:false};
  G.picks[1]=[c.id]; G.mpicks[1]=null; G.boost[1]={...A.foe};
  A.leads.push(c.id); A.seen=[...(A.seen||[]),c.id];
  G.setupMsg=''; G.phase='stage';
}
// 聖杯戦争：自軍の補正＝選んだ強化（A.perks）の合計。ほかのモードは null
function arcadeBoost(A){
  if(arcadeKind(A)!=='rogue'||!A.perks||!A.perks.length) return null;
  const b={label:'聖杯の加護'};
  A.perks.forEach(k=>{ const p=ROGUE.perks[k]; if(p) ['hp','atk','np','npStart','stars'].forEach(f=>{ if(p[f]) b[f]=(b[f]||0)+p[f]; }); });
  return b;
}
// 聖杯戦争の報酬の候補：start＝最初の1騎（サーヴァントだけ）。以降は、3騎未満でコストが足りればサーヴァント2騎＋強化1つ、それ以外は強化だけ
function rogueOffer(A,start){
  const shuf=a=>a.map(x=>[Math.random(),x]).sort((p,q)=>p[0]-q[0]).map(p=>p[1]), own=new Set(A.picks), room=costCap()-sumCost(A.picks);
  const units=shuf(ROSTER().filter(d=>!own.has(d.id)&&!d.spells&&d.cost<=room)).map(d=>({unit:d.id}));
  const perks=shuf(Object.keys(ROGUE.perks)).map(k=>({perk:k})), n=ROGUE.offer||3;
  if(start) return units.slice(0,n);
  const u=A.picks.length<ruleset().partyMax?units.slice(0,n-1):[];
  return [...u,...perks].slice(0,n);
}
function arcadeRec(){
  const us=[...G.players[0].party,...(G.players[0].master?[G.players[0].master]:[])], S=u=>(G.stats&&G.stats[u.uid])||{}, sum=k=>us.reduce((s,u)=>s+(S(u)[k]||0),0);
  return {level:G.level, win:G.winner===0, turn:G.turn, dealt:G.dealt[0], taken:sum('taken'), kills:sum('kills'), maxHit:Math.max(0,...us.map(u=>S(u).maxHit||0)),
    lost:G.players[0].party.filter(u=>u.out).length, enemy:G.picks[1].slice(), emaster:G.mpicks[1], ecost:sumCost(G.picks[1])+mcost(1),
    units:us.map(u=>({id:u.def, dealt:S(u).dealt||0, kills:S(u).kills||0})), boss:!!(G.boost&&G.boost[1]&&G.boost[1].boss)};
}
// 終わったステージすべての記録（決着済みの今のステージを含む）
const arcadeResults = ()=>G.arcade?[...G.arcade.results,...(G.phase==='over'?[arcadeRec()]:[])]:[];
const arcadeCfg = level=>({mode:'cpu', level, cpu:[false,true], names:['あなた','CPU']});
function arcadeStart(diff,endless,kind){
  const K=ARC_KINDS[kind]?kind:'arcade', C=ARC_KINDS[K].cfg();
  if(K!=='arcade') G.rule=C.rule; else if(!ARCADE.rules.includes(G.rule)) G.rule=ARCADE.rules[0];
  const d=C.diffs[diff]?diff:'normal';
  // perks＝聖杯戦争で選んだ強化 / offer＝報酬の候補（phase 'reward'）/ foe＝今のステージの相手の補正（コンティニューで使い回す）
  G.arcade={kind:K, diff:d, endless:K==='arcade'&&!!endless, stage:0, picks:[], mpick:null, leads:[], seen:[], lap:0, results:[], continues:0, perks:[], offer:null, foe:null};
  applyMode(arcadeCfg(C.diffs[d].levels[0]));
  if(K==='rogue'){ G.arcade.offer=rogueOffer(G.arcade,true); G.setupPid=0; G.phase='reward'; } // 聖杯戦争：編成の代わりに最初の1騎を選ぶ
}
// ---------- シナリオの戦闘（scenario.js が act('scnBattle',spec) で始める） ----------
// spec：{title, rule, level, cap, mode:'keep'|'choose'|'fixed', lock:[id], mlock:id, pool:[id], prev:{picks,mpick}, enemy:[id], emaster:id, ename, loseGo}
//   keep＝前に選んだ編成（prev）が使えるならそのまま、なければ選ぶ / choose＝毎回選ぶ（prev を初期値に） / fixed＝lock と mlock で固定
//   prev.rule＝その編成を選んだときのルール / lock＝外せないメンバー / pool＝選べるキャラ（空ならゲームの全キャラ） / loseGo＝負けても物語が進む（false は再挑戦だけ）
function scnBegin(spec){
  const speed=G.speed; newGame({rule:RULESETS[spec.rule]?spec.rule:'team', handicap:false});
  const rs=ruleset(), isM=id=>{ const d=D(id); return !!d&&Array.isArray(d.spells); }, isU=id=>!!D(id)&&!isM(id), uniq=a=>[...new Set((a||[]).filter(isU))];
  const lock=uniq(spec.lock).slice(0,rs.partyMax), mlock=rs.master&&isM(spec.mlock)?spec.mlock:null, pool=uniq(spec.pool);
  G.scn={spec, title:String(spec.title||''), lock, mlock, pool:pool.length?[...new Set([...lock,...pool])]:null, cap:Number(spec.cap)>0?Number(spec.cap):0, loseGo:!!spec.loseGo, pick:false};
  applyMode({mode:'cpu', level:CPU_LEVELS[spec.level]?spec.level:'normal', cpu:[false,true], names:['あなた',String(spec.ename||'')||'CPU'], speed});
  G.picks[1]=uniq(spec.enemy).slice(0,rs.partyMax); G.mpicks[1]=rs.master?(isM(spec.emaster)?spec.emaster:(MASTERS[0]||{}).id||null):null;
  if(!G.picks[1].length&&UNITS[0]) G.picks[1]=[UNITS[0].id];
  const prev=spec.prev||{}, pv=uniq(prev.picks), ros=ROSTER();
  const pr=RULESETS[prev.rule]||rs; // 選んだときのルールと人数・マスターの有無が違えば選び直す
  const good=pr.partyMax===rs.partyMax&&!!pr.master===!!rs.master&&pv.length>0&&pv.length<=rs.partyMax&&lock.every(id=>pv.includes(id))&&pv.every(id=>lock.includes(id)||ros.some(d=>d.id===id))
    &&(!rs.master||(isM(prev.mpick)&&(mlock?prev.mpick===mlock:MASTERS.some(m=>m.id===prev.mpick))))
    &&(rs.partyMax===1||sumCost(pv)+(rs.master?D(prev.mpick).cost:0)<=costCap());
  const fixed=spec.mode==='fixed'&&lock.length>0&&(!rs.master||mlock), use=!fixed&&good;
  G.picks[0]=use?pv:lock.slice(); G.mpicks[0]=rs.master?(use?prev.mpick:mlock):null;
  G.scn.pick=!fixed&&(spec.mode==='choose'||!good);
  if(G.scn.pick){ G.phase='setup'; G.setupPid=0; } else { G.phase='init'; startGame(); }
}
// シナリオの編成のおまかせ：固定メンバーはそのままで、残りを選べるキャラから埋める
function scnRandom(only){
  const S=G.scn, rs=ruleset(), rnd=a=>a[Math.floor(Math.random()*a.length)]; G.setupMsg='';
  if(rs.master&&!S.mlock&&only!=='svt'&&MASTERS.length) G.mpicks[0]=rnd(MASTERS).id;
  if(only==='master') return;
  let best=null;
  for(let t=0;t<50;t++){
    const p=S.lock.slice();
    for(const d of [...ROSTER()].sort(()=>Math.random()-.5)) if(!p.includes(d.id)&&p.length<rs.partyMax&&(rs.partyMax===1||sumCost(p)+d.cost+mcost(0)<=costCap())) p.push(d.id);
    if(!best||p.length>best.length) best=p;
    if(best.length===rs.partyMax) break;
  }
  G.picks[0]=best;
}
// ---------- ドラフト ----------
// 流れ：chooseMode(draft) → phase 'draft'（候補から交互に1つずつ取る）→ 全員取り終えたら done → draftGo で対戦
// G.draft：pool＝候補のサーヴァント / mpool＝候補のマスター / taken＝{id:取った陣営} / order＝取る順（陣営の並び。折り返し式）/ i＝今の番 / done＝取り終えた
// マスターのいるルールは、最初の1回でマスターを取る。コスト上限は通常の編成と同じ（取れるものがない番は飛ばす）
const draftTurn = ()=>G.draft&&!G.draft.done?G.draft.order[G.draft.i]:null;
const draftNeedM = pid=>masterRule()&&!G.mpicks[pid];
function draftCan(pid,id){
  const R=G.draft, d=D(id); if(!R||R.done||!d||(pid!==0&&pid!==1)) return false;
  if(R.mpool.includes(id)) return draftNeedM(pid)&&(R.taken[id]==null||R.mpool.length<2); // マスターが1人しかいないデータでは両方が同じマスター
  const picks=G.picks[pid], rs=ruleset();
  return !draftNeedM(pid)&&R.pool.includes(id)&&R.taken[id]==null&&picks.length<rs.partyMax&&(rs.partyMax===1||sumCost(picks)+d.cost+mcost(pid)<=costCap());
}
const draftMoves = pid=>G.draft?[...G.draft.mpool,...G.draft.pool].filter(id=>draftCan(pid,id)):[];
function draftStart(){
  const rs=ruleset(), team=rs.partyMax>1, mix=a=>{ a=a.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; };
  const n=Math.min(UNITS.length,team?DRAFT.pool.team:DRAFT.pool.solo), need=rs.partyMax*2;
  // チーム：両方が上限まで編成しやすいように、安い順に need 騎の合計コストが2人分の枠に収まる候補が出るまで引き直す
  const room=2*(costCap()-(rs.master?(rs.costBonus?rs.costBonus.base:0):0));
  let pool=[];
  for(let t=0;t<40;t++){
    pool=mix(UNITS).slice(0,n);
    if(!team||pool.map(d=>d.cost).sort((a,b)=>a-b).slice(0,need).reduce((s,c)=>s+c,0)<=room) break;
  }
  const first=Math.random()<.5?0:1, per=rs.partyMax+(rs.master?1:0);
  G.picks=[[],[]]; G.mpicks=[null,null]; G.setupMsg='';
  G.draft={ pool:pool.map(d=>d.id), mpool:rs.master?mix(MASTERS).slice(0,DRAFT.masters).map(m=>m.id):[], taken:{},
    order:Array.from({length:per*2},(_,k)=>k%4===0||k%4===3?first:1-first), i:0, done:false };
  G.phase='draft';
  draftSkip();
}
// 取れるものがない番を飛ばす。最後まで行ったら取り終わり（CPUの側はHPが高い順に並べる）
function draftSkip(){
  const R=G.draft;
  while(R.i<R.order.length&&!draftMoves(R.order[R.i]).length) R.i++;
  if(R.i<R.order.length) return;
  R.done=true;
  [0,1].forEach(pid=>{ if(G.cpu[pid]&&ruleset().partyMax>1) G.picks[pid].sort((a,b)=>D(b).hp-D(a).hp); });
}
function applyMode(cfg){
  Object.assign(G,{mode:cfg.mode, level:cfg.level, levels:cfg.levels||null, cpu:cfg.cpu, speed:cfg.speed||G.speed, phase:'setup'});
  cfg.names.forEach((n,i)=>G.players[i].name=n);
}
// 宝具を使う（picked＝対象を選ぶ宝具で選んだ1体）
function startUlt(u,picked){
  const uid=u.uid;
  if(masterRule()&&!D(u.def).ult.eff.some(e=>e.k==='dmg'||e.t==='target'||e.k==='copyRoll'||(FX[e.k]&&FX[e.k].copy&&e.from==='target'))){ // 攻撃対象（t:'target'）を使う効果がある宝具は補助扱いにせず、通常どおり攻撃対象を選ぶ（選ばないと対象なしで不発になる）
    // マスタールール：ダメージのない宝具は使用予定にして、スキルフェイズを終えるとき（skillDone）に行動回数-1で発動する。それまでは取り消せる
    G.ult=uid; G.ultSup=true; G.ultPick=picked?picked.uid:null; // NP は発動したときに払う（resolveUlt）
    log(`${nm(u)}が${TERMS.ult}「${esc(D(u.def).ult.name)}」を使用予定${picked?`（対象：${nm(picked)}）`:''}（スキルフェイズを終えると発動します）`,'good');
    return;
  }
  G.ult=uid; G.ultPick=picked?picked.uid:null; // NP は発動したときに払う（resolveUlt）。予約中にNPを増やしても、発動で全部使う
  log(`${nm(u)}が${TERMS.ult}「${esc(D(u.def).ult.name)}」を使用${picked?`（対象：${nm(picked)}）`:''}（このターンの行動になります）`,'good');
}
function doSkill(u,si,picked,color){
  const s0=D(u.def).skills[si];
  const s=color&&hasColorPick(s0)?{...s0,eff:withPickedColor(s0.eff,color)}:s0;
  log(`${nm(u)} スキル「${esc(s.name)}」${color&&hasColorPick(s0)?`（カード変換：${TERMS[color]}）`:''}`);
  // 使ったスキルの名前と効果を中央に出す（選んだ対象があれば名前も）
  // 全体にかかるスキルは「→ 全体」（味方全体・敵全体）と出す。説明文があればその文章
  fxEmit({t:'skill',uid:u.uid,si,name:s.name,picked:picked?D(picked.def).name:allLabel(s.eff),
    lines:s.eff.length?effLines(s.eff,s.pick):['効果なし']});
  st(u).skills++;
  say(u,'skill',{own:s.line,other:picked}); // スキルの専用セリフがあればそちら
  applyEffects(u,effRollPick(u,s.eff),picked,{src:{kind:'skill',i:si}}); // 出目で分岐する効果は、ここで1回振って出たものだけ
  u.used[si]=true; // 効果の後に使用済みにする（スキル再使用で自分自身が戻らないように）
  flushKo();
  checkWin(); // 即死などでスキルだけで決着することがある
}
function toTargetPhase(){
  G.phase='target';
  const c=targetCandidates(), all=G.ult&&ultNoTarget(U(G.ult));
  if(all){ log(`${PN(5)} ${TERMS.ult}発動`,'h'); phaseFx('NOBLE PHANTASM',`${TERMS.ult}発動`); } // 対象を選ばない宝具は「攻撃対象」の表示を出さない
  else { log(`${PN(5)} 攻撃対象決定`,'h'); phaseFx('TARGET','攻撃対象の選択'); }
  if(all){ G.targetAll=true; G.target=c[0].uid; return; } // 全体宝具：最初から敵全体を選んだ状態
  if(c.length===1||(!G.ult&&!G.rolled.length)) G.target=c[0].uid; // 攻撃がない（全員行動0回）ときは対象を選ぶ意味がないので自動で決める
}

// ログのフェイズ番号（マスタールールは③にマスターフェイズが入るので、スキル以降が1つずれる）
const PN = n=>'①②③④⑤⑥⑦⑧⑨'[n-1+(masterRule()&&n>=3?1:0)];
function toSkillPhase(){ G.phase='skill'; log(`${PN(3)} スキル・${TERMS.ult}使用`,'h'); phaseFx('SKILL',`スキル・${TERMS.ult}`); }
// ---------- マスタールール ----------
// マスターフェイズで行動できるマスター（なければ null）
function masterReady(){ const m=masterOf(G.cur); return G.phase==='master'&&!G.mastered&&m&&!m.out&&!disabled(m)&&!(G.spellPick&&G.spellPick.sup)?m:null; } // スタン・魅了（disabled）のマスターは補助・攻撃・令呪・退避のすべて不可 // 補助の対象選択中は他の行動を受け付けない
function masterDone(){ G.mastered=true; flushKo(); checkWin(); if(G.winner==null&&G.phase==='master') toSkillPhase(); }
const masterAtkDmg = (m,t)=>{ const dm=dmgMods(m,t,'W'); return applyPct(Math.max(0,D(m.def).cost*ruleset().masterAtk[t.master?'master':'svt']+dm.sum),dm.pct); };
// 令呪の状態：P.spellLeft＝残りの画数 / P.spellUsed[i]＝その効果を使った / P.spell==='decl'＝宣言中（マスタールール）
// 令呪を使える：マスタールールは未使用・このターンにサーヴァントが1回以上行動できる。
// マスターチームは残りがあり、生存サーヴァントが全員1回以上行動でき、行動を1回減らせる
function canDeclareSpell(){
  const P=G.players[G.cur]; if(!(P.spellLeft>0)||P.spell==='decl') return false;
  if(mTeam()) return P.spellUsed.some((u,i)=>!u&&D(P.master.def).spells[i].eff.length) && alive(G.cur).every(u=>(G.maxActs[u.uid]||0)>0) && (SPELL_FREE||totalAlloc()>0);
  return Object.values(G.maxActs).some(n=>n>0);
}
// 相手マスターへのダメージを令呪で防げる（残りがあり、宣言中でない）
const canGuardSpell = pid=>{ const m=masterOf(pid); return G.players[pid].spellLeft>0&&G.players[pid].spell!=='decl'&&!(m&&disabled(m)); }; // 行動不能のマスターは令呪で守らせることもできない
// 令呪の効果を使う。守る側の選択待ちになったら true
// picked：マスターチームで「自軍サーヴァント」の対象に選んだ1騎
function useSpell(m,i,picked){
  const s=D(m.def).spells[i], P=G.players[m.pid];
  log(`${nm(m)}：「${esc(s.name)}」${picked?` → ${nm(picked)}`:''}`,'good');
  fxEmit({t:'cutin',uid:m.uid,title:s.name,ruby:s.ruby,col:'Y',top:'令呪発動'}); // 宝具と同じカットイン（金背景は暫定）
  fxEmit({t:'skill',uid:m.uid,head:'令呪',name:s.name,picked:picked?D(picked.def).name:allLabel(s.eff),lines:effLines(s.eff,null,spellTgt)});
  say(m,'spell',{own:s.line,other:picked||null});
  P.spellUsed[i]=true; P.spellLeft--; P.spell=null;
  return masterEffects(m,s.eff,{src:{kind:'spell',i}},picked);
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
  applyEffects(m,effs.filter(e=>!md.includes(e)),picked,o.src?o:{...o,src:{kind:'master'}});
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
// コストを指定したおまかせ編成。want＝合計コスト（マスタールールはマスター込み）。ちょうどになる編成がなければ一番近いものを選んで知らせる
function setupRandomCost(pid,team,only,want,rnd){
  const mr=masterRule(), max=ruleset().partyMax, cap=costCap();
  if(want>cap){ G.setupMsg=`コスト${want}は上限${cap}を超えています`; return; }
  const fixedM=mr&&only==='svt'?D(G.mpicks[pid]):null;          // サーヴァントだけ選び直す：マスターはそのまま
  const fixedS=mr&&only==='master'?G.picks[pid].slice():null;   // マスターだけ選び直す：サーヴァントはそのまま
  if(mr&&only==='svt'&&!fixedM){ G.setupMsg=`${TERMS.player}を選んでから使ってください`; return; }
  const mpool=!mr?[null]:fixedM?[fixedM]:MASTERS;
  const spool=[...UNITS];
  const cands=[]; // {ids, m, c}
  if(fixedS){
    const sc=sumCost(fixedS);
    for(const m of MASTERS) cands.push({ids:fixedS,m:m.id,c:sc+m.cost});
  }else if(!team){
    for(const m of mpool) for(const u of spool) cands.push({ids:[u.id],m:m&&m.id,c:u.cost+(m?m.cost:0)});
  }else{
    for(const m of mpool){
      const mc=m?m.cost:0, found=[];
      for(let t=0;t<400;t++){
        const pool=[...spool].sort(()=>Math.random()-.5), p=[]; let s=0;
        for(const d of pool){ if(p.length>=max) break; if(s+d.cost+mc<=cap){ p.push(d.id); s+=d.cost; } }
        if(p.length) found.push({ids:p,m:m&&m.id,c:s+mc});
      }
      cands.push(...found);
    }
  }
  if(!cands.length){ G.setupMsg='選べる編成がありません'; return; }
  // チームは満員（partyMax 騎）の編成を優先する（コスト10で 5＋5 の2騎だけ、などにしない）
  if(team&&!fixedS&&cands.some(x=>x.ids.length===max)) cands.splice(0,cands.length,...cands.filter(x=>x.ids.length===max));
  const gap=Math.min(...cands.map(x=>Math.abs(x.c-want))), top=cands.filter(x=>Math.abs(x.c-want)===gap), c=rnd(top);
  G.picks[pid]=c.ids.slice();
  if(team) G.picks[pid].sort((a,b)=>D(b).hp-D(a).hp);
  if(mr&&c.m) G.mpicks[pid]=c.m;
  G.setupMsg=gap?`合計コスト${want}の編成が作れないため、いちばん近いコスト${c.c}で選びました`:'';
}
const ACTIONS = {
  restart(){ newGame(keepRule()); },
  useDefaultData(){ clearCustomUnits(); clearCustomMasters(); reloadUnits(); SHOW_IDS=null; newGame(keepRule()); },
  setRule({rule}){ if(G.phase==='mode'&&RULESETS[rule]) G.rule=rule; },
  toggleHandicap(){ if(G.phase==='mode') G.handicap=!G.handicap; },
  chooseMode({mode,level,level2,diff,endless}){
    if(G.phase!=='mode') return;
    if(mode==='draft'){ applyMode({mode:'cpu', level:CPU_LEVELS[level]?level:'normal', cpu:[false,true], names:['あなた','CPU']}); draftStart(); return; } // ドラフト：編成の代わりに候補を取り合う
    if(mode==='arcade'){ arcadeStart(diff,endless==='1'||endless===true); return; }
    if(mode==='raid'||mode==='rogue'){ arcadeStart(diff,false,mode); return; } // ボスレイド・聖杯戦争（試験版）
    if(mode==='watch'){ const lv=l=>CPU_LEVELS[l]?l:'normal'; applyMode({mode, level:lv(level), levels:[lv(level),lv(level2)], cpu:[true,true], names:['CPU 1','CPU 2']}); return; } // 観戦：編成は人が選ぶ。強さはCPUごと
    applyMode(mode==='cpu'
      ? {mode, level:CPU_LEVELS[level]?level:'normal', cpu:[false,true], names:['あなた','CPU']}
      : {mode:'pvp', level:'normal', cpu:[false,false], names:mode==='net'?['ホスト','ゲスト']:[TERMS.player+'1',TERMS.player+'2']}); // net＝オンライン対戦（net.js）。進め方はローカル対戦と同じ
  },
  scnBattle(spec){ if(spec&&Array.isArray(spec.enemy)) scnBegin(spec); },
  // もう一度。same＝同じ編成のまますぐ対戦（決着後だけ。出目は毎回変わる）／ なし＝編成（キャラクター選択）からやり直す
  rematch({same}={}){
    if(G.scn){ scnBegin({...G.scn.spec, prev:{picks:G.picks[0].slice(), mpick:G.mpicks[0], rule:G.rule}}); return; } // シナリオ：同じ戦闘に再挑戦
    same=!!same&&G.phase==='over';
    const okU=ids=>ids.length>0&&ids.every(id=>UNITS.some(u=>u.id===id)), okM=id=>!masterRule()||MASTERS.some(m=>m.id===id);
    if(G.arcade){ // アーケード：同じ難易度で最初から。same は編成を飛ばして STAGE 1 の紹介へ
      const A=G.arcade, speed=G.speed; newGame(keepRule()); arcadeStart(A.diff,A.endless,A.kind); G.speed=speed;
      if(same&&arcadeKind(A)!=='rogue'&&okU(A.picks)&&okM(A.mpick)){ G.picks[0]=A.picks.slice(); G.mpicks[0]=A.mpick; G.arcade.picks=A.picks.slice(); G.arcade.mpick=A.mpick; arcadeStage(); }
      return;
    }
    const cfg={mode:G.mode, level:G.level, levels:G.levels, cpu:G.cpu, speed:G.speed, names:G.players.map(p=>p.name)}, picks=G.picks.map(p=>p.slice()), mp=G.mpicks.slice();
    const keep=same&&picks.every(okU)&&mp.every(okM), dr=G.draft;
    newGame(keepRule()); applyMode(cfg);
    if(keep){ G.picks=picks; G.mpicks=mp; G.draft=dr; G.phase='init'; startGame(); }
    else if(dr) draftStart(); // ドラフト：新しい候補で取り直す
  },
  toggleSpeed(){ G.speed = G.speed>=500 ? 250 : G.speed>150 ? 120 : 700; },
  setupToggle({id}){
    const pid=G.setupPid, picks=G.picks[pid], d=D(id); G.setupMsg='';
    if(!d) return;
    const i=picks.indexOf(id), max=ruleset().partyMax;
    if(G.scn){ // シナリオ：固定メンバーは外せない・選べるキャラ以外は選べない
      if(G.phase!=='setup') return;
      if(G.scn.lock.includes(id)||G.scn.lock.length>=max){ G.setupMsg='固定メンバーは変えられません'; return; }
      if(i<0&&!ROSTER().some(x=>x.id===id)) return;
    }
    if(i>=0){ picks.splice(i,1); return; }
    if(max===1){ picks.splice(0,1,id); return; } // 1騎だけのルールは選び直し
    if(picks.length>=max){ G.setupMsg=`最大${max}体までです`; return; }
    if(sumCost(picks)+d.cost+mcost(pid)>costCap()){ G.setupMsg=`コスト合計が${costCap()}を超えます${masterRule()?`（${TERMS.player}込み）`:''}`; return; }
    picks.push(id);
  },
  // 編成の順番を1つ前へ（1st / 2nd / 3rd の入れ替え）。シナリオの固定メンバーは動かさない
  setupMove({id}){
    if(G.phase!=='setup') return;
    const picks=G.picks[G.setupPid], i=picks.indexOf(id); G.setupMsg='';
    if(i<1) return;
    if(G.scn&&(G.scn.lock.includes(id)||G.scn.lock.includes(picks[i-1]))){ G.setupMsg='固定メンバーは変えられません'; return; }
    [picks[i-1],picks[i]]=[picks[i],picks[i-1]];
  },
  // 編成をすべて外す（シナリオの固定メンバー・固定マスターは残す）
  setupClear(){
    if(G.phase!=='setup') return;
    const pid=G.setupPid, S=G.scn; G.setupMsg='';
    G.picks[pid]=S?G.picks[pid].filter(id=>S.lock.includes(id)):[];
    if(!S||!S.mlock) G.mpicks[pid]=null;
  },
  // 保存した編成（records.js の編成リスト）を呼び出す。今のルール・データで使えるものだけ
  setupLoad({picks,mpick}={}){
    if(G.phase!=='setup'||G.scn) return;
    const pid=G.setupPid, rs=ruleset(), ids=[...new Set(Array.isArray(picks)?picks:[])], bad='この編成は今のルール・データでは使えません';
    if(!ids.length||ids.length>rs.partyMax||!ids.every(id=>UNITS.some(u=>u.id===id))){ G.setupMsg=bad; return; }
    const m=rs.master&&MASTERS.some(x=>x.id===mpick)?mpick:null;
    if(rs.master&&!m){ G.setupMsg=bad; return; }
    if(rs.partyMax>1&&sumCost(ids)+(m?D(m).cost:0)>costCap()){ G.setupMsg=`コスト合計が${costCap()}を超えます`; return; }
    G.picks[pid]=ids; G.mpicks[pid]=m; G.setupMsg='';
  },
  // 2人目（CPU）の編成から1人目の編成に戻る
  setupBack(){ if(G.phase==='setup'&&G.setupPid===1){ G.setupPid=0; G.setupMsg=''; } },
  // おまかせ。only='svt'：サーヴァントだけ（選んだマスターはそのまま） / only='master'：マスターだけ（選んだサーヴァントはそのまま）
  setupRandom({only,cost}={}){
    if(G.phase!=='setup') return;
    if(G.scn){ scnRandom(only); return; }
    const pid=G.setupPid, team=ruleset().partyMax>1, rnd=a=>a[Math.floor(Math.random()*a.length)];
    const want=cost===undefined||cost===''||cost===null?null:Number(cost);
    if(want!==null&&Number.isFinite(want)) return setupRandomCost(pid,team,only,want,rnd);
    if(only==='master'){
      if(!masterRule()||!MASTERS.length) return;
      const room=costCap()-(team?sumCost(G.picks[pid]):0), c=MASTERS.filter(m=>!team||m.cost<=room);
      if(!c.length){ G.setupMsg=`コスト上限に収まる${TERMS.player}がいません`; return; }
      G.mpicks[pid]=rnd(c).id; G.setupMsg=''; return;
    }
    if(masterRule()&&MASTERS.length&&only!=='svt') G.mpicks[pid]=rnd(MASTERS).id;
    const room=costCap()-(team?mcost(pid):0); // チームはマスターのコストを引いた残りで編成
    let best=[];
    for(let t=0;t<200;t++){
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
    if(G.scn&&G.scn.mlock){ G.setupMsg=`${TERMS.player}は固定です`; return; }
    if(G.mpicks[pid]===id){ G.mpicks[pid]=null; return; }
    if(ruleset().partyMax>1&&sumCost(G.picks[pid])+D(id).cost>costCap()){ G.setupMsg=`コスト合計が${costCap()}を超えます（${TERMS.player}込み）`; return; }
    G.mpicks[pid]=id;
  },
  // CPUのおまかせ編成。how='random'：完全ランダム（setupRandom と同じ） / how='same'：相手と同じコストになるように選ぶ
  // delta：相手のコストからずらす量（アーケードの1戦目）
  // avoid：なるべく使わないキャラ・マスターの id（アーケード。チームのルールだけ）。避けると全キャラで選ぶより
  //   コストが合わなくなる（または同じ人数で組めない）ときは何も選ばず false を返す
  setupCpu({how,cost,delta,avoid}={}){
    if(G.phase!=='setup'||G.scn) return;
    const pid=G.setupPid; G.setupMsg='';
    if(how==='random'){ ACTIONS.setupRandom({cost}); return; }
    const opp=G.picks[1-pid], pick=a=>a[Math.floor(Math.random()*a.length)];
    // 組み合わせは十数万通りになるので Math.min(...配列) は使わない（引数が多すぎて例外になる）
    const lo=(a,f)=>a.reduce((m,x)=>Math.min(m,f(x)),Infinity), hi=(a,f)=>a.reduce((m,x)=>Math.max(m,f(x)),-Infinity);
    if(masterRule()&&ruleset().partyMax===1){ // マスタールール：サーヴァント＋マスターの合計コストが相手と同じ（なければ一番近い）組み合わせからランダム
      const om=G.mpicks[1-pid], combos=UNITS.flatMap(u=>MASTERS.map(m=>({u:u.id,m:m.id,c:u.cost+m.cost})));
      const want=opp.length&&om?D(opp[0]).cost+D(om).cost:hi(combos,x=>x.c);
      const gap=lo(combos,x=>Math.abs(x.c-want)), top=combos.filter(x=>Math.abs(x.c-want)===gap), c=pick(top);
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
    const size=opp.length||hi(combos,x=>x.ids.length);
    const sized=combos.filter(x=>x.ids.length===size), all=sized.length?sized:combos;
    const want=(opp.length?sumCost(opp)+mcost(1-pid):hi(all,x=>x.c))+(Number(delta)||0);
    const bad=new Set(Array.isArray(avoid)?avoid:[]);
    const pool=bad.size?sized.filter(x=>!x.ids.some(id=>bad.has(id))&&!(x.m&&bad.has(x.m))):all;
    if(bad.size&&(!pool.length||lo(pool,x=>Math.abs(x.c-want))>lo(all,x=>Math.abs(x.c-want)))) return false;
    const gap=lo(pool,x=>Math.abs(x.c-want)), top=pool.filter(x=>Math.abs(x.c-want)===gap), c=pick(top);
    G.picks[pid]=c.ids.slice().sort((a,b)=>D(b).hp-D(a).hp); // HPが高い順に1st
    if(c.m) G.mpicks[pid]=c.m;
    if(gap) G.setupMsg=`合計コスト${want}の編成が作れないため、いちばん近いコスト${top[0].c}で編成しました`;
    return true;
  },
  setupConfirm(){
    if(!G.picks[G.setupPid].length) return;
    if(masterRule()&&!G.mpicks[G.setupPid]){ G.setupMsg=`${TERMS.player}を選んでください`; return; }
    if(G.scn){ if(G.phase==='setup'&&G.setupPid===0){ G.phase='init'; startGame(); } return; } // シナリオ：相手は決まっているのですぐ対戦
    if(G.arcade){ // アーケード：編成はプレイヤーだけ。相手はステージごとに自動で決まる
      if(G.phase!=='setup'||G.setupPid!==0) return;
      G.arcade.picks=G.picks[0].slice(); G.arcade.mpick=G.mpicks[0]; arcadeStage(); return;
    }
    if(G.setupPid===0){ G.setupPid=1; G.setupMsg=''; } else { G.phase='init'; startGame(); }
  },
  // ドラフト：候補を1つ取る（マスターのいるルールは最初にマスター）
  draftPick({id}={}){
    if(G.phase!=='draft') return;
    const pid=draftTurn(), R=G.draft; G.setupMsg='';
    if(!draftCan(pid,id)){ if(pid!=null&&D(id)) G.setupMsg=R.mpool.includes(id)?(draftNeedM(pid)?'すでに取られています':`${TERMS.player}はもう取っています`):draftNeedM(pid)?`先に${TERMS.player}を取ってください`:R.taken[id]!=null?'すでに取られています':`コスト合計が${costCap()}を超えます`; return; }
    R.taken[id]=pid;
    if(R.mpool.includes(id)) G.mpicks[pid]=id; else G.picks[pid].push(id);
    R.i++; draftSkip();
  },
  // ドラフト：取り終えたあと、自分の並び順を変える（押したキャラを先頭に）
  draftLead({id}={}){
    if(G.phase!=='draft'||!G.draft.done) return;
    const pid=[0,1].find(p=>!G.cpu[p]&&G.picks[p].includes(id)); if(pid==null) return;
    const a=G.picks[pid]; a.splice(a.indexOf(id),1); a.unshift(id);
  },
  draftGo(){ if(G.phase==='draft'&&G.draft.done&&G.picks.every(p=>p.length)&&(!masterRule()||G.mpicks.every(Boolean))){ G.phase='init'; startGame(); } },
  // アーケード：ステージ紹介から対戦を始める
  arcadeGo(){ if(G.arcade&&G.phase==='stage'){ G.phase='init'; startGame(); } },
  // アーケード：勝ったステージを記録して、次のステージの紹介へ（編成はそのまま）
  arcadeNext(){
    const A=G.arcade; if(!A||G.phase!=='over'||G.winner!==0||arcadeLast()) return;
    const next={...A, stage:A.stage+1, results:[...A.results,arcadeRec()]}, speed=G.speed;
    newGame(keepRule()); G.arcade=next;
    applyMode({...arcadeCfg(arcadeLevel(arcadeDf(next),next.stage)), speed});
    G.picks[0]=next.picks.slice(); G.mpicks[0]=next.mpick;
    if(arcadeKind(next)==='rogue'){ next.offer=rogueOffer(next,false); G.setupPid=0; G.phase='reward'; return; } // 聖杯戦争：次の前に報酬を選ぶ
    arcadeStage();
  },
  // 聖杯戦争：報酬を1つ選ぶ（i＝候補の番号）。最初の1騎もこれで選ぶ。選んだら次のステージの紹介へ
  rogueReward({i}={}){
    const A=G.arcade; if(!A||G.phase!=='reward'||!A.offer) return;
    const o=A.offer[Number(i)]; if(!o) return;
    if(o.unit){ const d=D(o.unit);
      if(!d||A.picks.includes(o.unit)||A.picks.length>=ruleset().partyMax||sumCost(A.picks)+d.cost>costCap()) return;
      A.picks=[...A.picks,o.unit];
    } else if(ROGUE.perks[o.perk]) A.perks=[...(A.perks||[]),o.perk];
    else return;
    A.offer=null; G.picks[0]=A.picks.slice(); arcadeStage();
  },
  // 聖杯戦争：自軍の並び順を変える（押したサーヴァントを先頭に）。報酬選び・ステージ紹介のとき
  rogueLead({id}={}){
    const A=G.arcade; if(!A||arcadeKind(A)!=='rogue'||!['reward','stage'].includes(G.phase)||!A.picks.includes(id)) return;
    A.picks=[id,...A.picks.filter(x=>x!==id)]; G.picks[0]=A.picks.slice();
  },
  // アーケード：負けたステージを同じ相手でやり直す（ステージ紹介から）
  arcadeContinue(){
    if(!arcadeCanContinue()) return;
    const A=G.arcade, next={...A, continues:(A.continues||0)+1}, speed=G.speed, level=G.level, ep=G.picks[1].slice(), em=G.mpicks[1];
    newGame(keepRule()); G.arcade=next;
    applyMode({...arcadeCfg(level), speed});
    G.picks=[next.picks.slice(),ep]; G.mpicks=[next.mpick,em];
    G.boost=[arcadeBoost(next),next.foe?{...next.foe,raged:false}:null]; // 補正（ボス・報酬）も同じものを付け直す
    G.setupPid=1; G.setupMsg=''; G.phase='stage';
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
      const cf=u.fx.find(e=>e.k==='confuse');
      if(disabled(u)){ u.face=null; log(`${nm(u)}は行動不能`,'bad'); }
      else if(cf&&(consume(u,[cf]),chanceRoll(cf,u,Math.min(6,cf.v||3)))){ u.face=null; log(`${nm(u)}は混乱していて行動できない`,'bad'); syncU(u); } // 混乱：ロールv以下（0なら3以下）でこのターン行動不能
      else {
        const f=roll(); u.face={i:f,kind:'acts'}; rolls.push({uid:u.uid,f});
        const fear=has(u,'fear')?1:0, dn=mods(u,'actsDown').sum, up=mods(u,'actsUp'); consume(u,up.list); syncU(u);
        const ba=(boostOf(u)||{}).acts||0; // ボスなど陣営の補正
        m=Math.max(0,Math.min(RULES.actionsMax, faceActs(D(u.def),f)+bonus+late+zero+second+up.sum+ba-fear-dn));
        log(`${nm(u)} 出目${f+1} → 最大行動${m}${ba?`（ボス+${ba}）`:''}${bonus?`（${TERMS.out}ボーナス+${bonus}）`:''}${late?'（3ターン目後攻から+1）':''}${zero?'（前ターン0回行動+1）':''}${second?'（後攻の初ターン+1）':''}${up.sum?`（最大行動回数+${up.sum}）`:''}${fear?'（恐怖-1）':''}${dn?`（最大行動回数-${dn}）`:''}`, m?'':'bad');
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
    if(m&&!m.out&&disabled(m)){ log(`③ ${TERMS.player}フェイズ`,'h'); log(`${nm(m)}は行動不能（${TERMS.player}フェイズはスキップ）`,'bad'); toSkillPhase(); } // 宣言済みの令呪も、行動不能が治るまで使えない
    else if(m&&!m.out){ G.phase='master'; log(`③ ${TERMS.player}フェイズ`,'h'); phaseFx('MASTER',`${TERMS.player}フェイズ`); }
    else toSkillPhase();
  },
  // ---------- マスターフェイズ（マスタールール） ----------
  // 補助：マスターの鉛筆を振り、出た面の効果を適用（既定はこのターンだけ。面の効果に turns があればそのターン数。無なら何も起きない）
  masterSupport(){
    const m=masterReady(); if(!m) return;
    const d=D(m.def), f=roll(), face=d.faces[f];
    log(`${MASTER_ACTS.support}：${nm(m)} 出目${f+1} → ${face.eff.length?`${face.label?`「${esc(face.label)}」`:''}${face.eff.some(e=>e.turns>1||e.turns===0)?'':'（このターンのみ）'}`:'何も起きない'}`, face.eff.length?'good':'sub');
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
    log(`${MASTER_ACTS.attack}：${nm(m)} → ${nm(t)}`,''); say(m,'attack',{other:t});
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
    if(hasColorPick(s)){ G.pending={uid,si,colorPick:true,color:null}; return; } // 先に色を選ぶ（対象を選ぶスキルはそのあと）
    if(s.pick){ G.pending={uid,si}; return; }
    doSkill(u,si,null);
  },
  // カード変換の色を選ぶ（c＝R:Buster / B:Arts / G:Quick）
  skillColor({c}){
    const p=G.pending; if(G.phase!=='skill'||!p||p.ult||!p.colorPick||!['R','B','G'].includes(c)) return;
    const u=U(p.uid), s=D(u.def).skills[p.si];
    if(s.pick){ G.pending={uid:p.uid,si:p.si,color:c}; return; }
    G.pending=null; doSkill(u,p.si,null,c);
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
    const u=U(G.ult); // NP はまだ払っていないので戻すものはない
    G.ult=null; G.ultPick=null; G.ultSup=false;
    log(`${nm(u)}の${TERMS.ult}の使用を取り消した`,'sub');
  },
  skillDone(){
    if(G.phase!=='skill'||G.pending) return;
    if(G.ult&&G.ultSup){ // マスタールールの補助宝具：ここで発動し、行動回数-1
      const u=U(G.ult), picked=G.ultPick?U(G.ultPick):null;
      G.ult=null; G.ultPick=null; G.ultSup=false; G.ultDone=true;
      resolveUlt(u,null,picked);
      const top=Object.entries(G.alloc).filter(([,n])=>n>0).sort((a,b)=>b[1]-a[1])[0];
      if(top){ G.alloc[top[0]]--; log(`補助${TERMS.ult}のため行動回数-1（${dn(U(top[0]))}）`,'sub'); }
      flushKo(); checkWin(); if(G.winner!=null) return;
      G.phase='action'; log(`${PN(4)} 行動決定`,'h'); phaseFx('COMMAND','行動決定');
      return;
    }
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
    if(G.pending){ if(pickValid(u)){ const p=G.pending; G.pending=null; if(p.ult) startUlt(U(p.uid),u); else doSkill(U(p.uid),p.si,u,p.color); } return; }
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
  if(typeof netAct==='function'&&netAct(type,p)) return; // オンライン：ゲストは操作をホストへ送るだけ／相手の番の操作は捨てる（net.js）
  if(G.phase==='over' && !['restart','rematch','toggleSpeed','useDefaultData','arcadeNext','arcadeContinue','scnBattle'].includes(type)) return;
  snapPre();
  FX_TAP=typeof netTapOn==='function'&&netTapOn()?[]:null;
  ACTIONS[type](p);
  if(FX_TAP){ const fx=FX_TAP; FX_TAP=null; netSync(fx); } // オンラインのホスト：状態と演出をゲストへ送る
  render();
}
