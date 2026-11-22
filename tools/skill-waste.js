// スキルの無駄づかいの点検：CPU 同士を対戦させ、使ったスキルの効果ごとに「意味がなかった」かを数える
//
//   node tools/skill-waste.js                 team・mteam × 400試合（つよい同士・先読みなし）
//   node tools/skill-waste.js -n 2000 -r team -l expert --look   試合数・ルール・強さ・先読み
//   node tools/skill-waste.js --set "GUARD_KEEP=false"           cpu.js の調整用の変数を書き換えて回す
//   node tools/skill-waste.js --top 30        スキル別の一覧の件数（既定 20）
//
// 2種類を数える：
//   使った時点で分かる無駄（WASTE_NOW）：その場の状態だけで意味がないと判断できるもの（例：今ターン行動しない味方に1ターンの攻撃強化）
//   結果として無駄（WASTE_AFTER）：効果が切れる・試合が終わるまでに一度も働く場面がなかったもの（例：防御を付けたが一度も攻撃されなかった）
//     ※ 結果の方は相手の出方しだいなので、ある程度出るのはふつう。使った時点の無駄が 0 に近いのが目標
// 効果ごとの「意味がない状況」の定義は WASTE_NOW / USEFUL にまとめてある（新しい FX を足したらここにも足す）
'use strict';
const fs=require('fs'), vm=require('vm'), path=require('path');
const argv=process.argv.slice(2), opt=(...n)=>{ const i=argv.findIndex(a=>n.includes(a)); return i<0?null:argv[i+1]; }, flag=n=>argv.includes(n);
const N=Math.max(1,Number(opt('-n','--games'))||400), ONLY=opt('-r','--rule')||'team,mteam', LEVEL=opt('-l','--level')||'hard', LOOK=flag('--look'), SET=opt('--set'), TOP=Number(opt('--top'))||20;

const store=()=>({getItem(){return null},setItem(){},removeItem(){}});
const ctx={console,Math,Date,JSON,localStorage:store(),sessionStorage:store(),document:{},setTimeout(){return 0},clearTimeout(){}};
ctx.window=ctx; vm.createContext(ctx);
const dir=path.join(__dirname,'..','js');
for(const f of ['rules','units','masters','common','engine','cpu']) vm.runInContext(fs.readFileSync(path.join(dir,f+'.js'),'utf8'),ctx,{filename:f+'.js'});
vm.runInContext('function render(){}',ctx);
if(SET) vm.runInContext(SET,ctx,{filename:'--set'});

const body=function(N,ONLY,LEVEL,LOOK){
  CPU_LOOKAHEAD=!!LOOK;
  const READY=RULES.ultCost;
  const enemiesOf=u=>alive(1-u.pid), alliesOf=u=>alive(u.pid);
  const hasDebuffK=(t,vs)=>t.fx.some(x=>vs?x.k===vs:FX[x.k]&&FX[x.k].buff===false);
  const aoeReady=u=>enemiesOf(u).some(e=>!e.master&&canUlt(e)&&e.np>=READY&&ultNoTarget(e)&&D(e.def).ult.eff.some(x=>x.k==='dmg'));
  const ultSoon=u=>enemiesOf(u).some(e=>!e.master&&canUlt(e)&&e.np>=70&&ultNoTarget(e)&&D(e.def).ult.eff.some(x=>x.k==='dmg'));
  // 敵の陣営がその種類の効果を持っているか（スキル・宝具・コマンド）。耐性・無効系の要不要に使う
  const enemyHas=(u,test)=>enemiesOf(u).some(e=>{ const d=D(e.def), effs=[...d.skills.flatMap(s=>s.eff),...d.ult.eff,...d.faces.flatMap(f=>[f.pre,f.post].flatMap(c=>c&&c.eff||[]))];
    return effs.some(test); });
  const oneTurn=e=>e.turns===1||(!e.turns&&!e.times); // 今ターン（と相手の1ターン）だけの効果
  const ATK_K=['atk','atkPct','cardConv','cardConvPick','critPow','critMult','critRoll','sureHit','pierce','ignoreDef','atkVs','atkTrait','npPow','aoeNormal','onAtkNp','onAtkStar','cardUp'];
  // ---- 使った時点で分かる無駄。t＝効果の対象1体、e＝効果、u＝使った側、effs＝同じスキルの全効果。理由の文字列か null ----
  const WASTE_NOW={
    atk:(t,e)=>oneTurn(e)&&!isActing(t)?'今ターン攻撃しない味方（1ターン）':null,
    critPow:(t,e,u)=>oneTurn(e)&&(!isActing(t)?'今ターン攻撃しない味方（1ターン）':G.ult?'宝具のターン（クリティカルなし）':G.players[u.pid].stars<=0&&!sameSkillGives(e,'star')?'スター0（クリティカルなし）':null),
    sureHit:(t,e,u)=>oneTurn(e)&&(!isActing(t)?'今ターン攻撃しない味方（1ターン）':!enemiesOf(u).some(x=>has(x,'evade'))?'回避を持つ敵がいない':null),
    pierce:(t,e,u)=>oneTurn(e)&&(!isActing(t)?'今ターン攻撃しない味方（1ターン）':!enemiesOf(u).some(x=>has(x,'evade')||has(x,'invul'))?'回避・無敵を持つ敵がいない':null),
    ignoreDef:(t,e,u)=>oneTurn(e)&&(!isActing(t)?'今ターン攻撃しない味方（1ターン）':!enemiesOf(u).some(x=>has(x,'def')||has(x,'defTrait'))?'被ダメージ減少を持つ敵がいない':null),
    atkVs:(t,e,u)=>!enemiesOf(u).some(x=>hasDebuffK(x,e.vs))&&!sameSkillGives(e,null,true)?(oneTurn(e)?'対象の弱体を持つ敵がいない（1ターン）':null):oneTurn(e)&&!isActing(t)?'今ターン攻撃しない味方（1ターン）':null,
    atkTrait:(t,e,u)=>!enemiesOf(u).some(x=>traitHit(x,e.trait))?'その属性の敵がいない':oneTurn(e)&&!isActing(t)?'今ターン攻撃しない味方（1ターン）':null,
    npPow:(t,e)=>oneTurn(e)&&G.ult!==t.uid&&!(canUlt(t)&&!G.ult&&!G.ultDone&&t.np+curEffs.filter(x=>x.k==='np'&&x.v>0).reduce((s,x)=>s+x.v,0)>=READY)?'今ターン宝具を撃たない味方（1ターン）':null,
    aoeNormal:(t,e,u)=>enemiesOf(u).length<2?'敵が1体だけ':oneTurn(e)&&(!isActing(t)||G.ult)?'今ターン通常攻撃しない味方（1ターン）':null,
    onAtkNp:(t,e)=>t.np>=RULES.gaugeMax?'NPが満タン':oneTurn(e)&&(!isActing(t)||G.ult)?'今ターン通常攻撃しない味方（1ターン）':null,
    onAtkStar:(t,e)=>oneTurn(e)&&(!isActing(t)||G.ult)?'今ターン通常攻撃しない味方（1ターン）':null,
    cardUp:(t,e)=>oneTurn(e)&&!isActing(t)?'今ターン攻撃しない味方（1ターン）':!(D(t.def).faces||[]).some(f=>f&&f.c===e.color)?'その色の面がない味方':null,
    cardConv:(t,e)=>oneTurn(e)&&(!isActing(t)||G.ult)?'今ターン通常攻撃しない味方（1ターン）':null,
    // 守り：自分だけを守る効果なのに、ほかの味方がターゲット集中を持っていて、全体宝具も来そうにない
    def:(t,e,u)=>guardShadowed(t,u), evade:(t,e,u)=>guardShadowed(t,u)||dupGuard(t,e), invul:(t,e,u)=>guardShadowed(t,u)||dupGuard(t,e),
    nullUnder:(t,e,u)=>guardShadowed(t,u), defTrait:(t,e,u)=>!enemiesOf(u).some(x=>traitHit(x,e.trait))?'その属性の敵がいない':guardShadowed(t,u),
    counter:(t,e,u)=>guardShadowed(t,u), onHitNp:(t,e,u)=>t.np>=RULES.gaugeMax?'NPが満タン':guardShadowed(t,u),
    hitNpUp:(t,e,u)=>has(t,'curse')||has(t,'hitNpSeal')?'呪い・被弾NP封印中':t.np>=RULES.gaugeMax?'NPが満タン':guardShadowed(t,u),
    guts:(t)=>has(t,'guts')?'すでにガッツがある（上書き）':null,
    taunt:(t,e,u)=>alliesOf(u).length<2?'味方が1体だけ':alliesOf(u).some(a=>a!==t&&has(a,'taunt'))?'ほかの味方がすでにターゲット集中':aoeReady(u)?'敵が全体宝具を撃てる（NP100%）':null,
    debuffImmune:(t,e,u)=>!enemyHas(u,x=>FX[x.k]&&FX[x.k].buff===false&&x.t!=='self'&&!String(x.t).startsWith('ally'))?'弱体を使う敵がいない':null,
    mentalImmune:(t,e,u)=>!enemyHas(u,x=>FX[x.k]&&FX[x.k].mental)?'精神異常を使う敵がいない':null,
    deathImmune:(t,e,u)=>!enemyHas(u,x=>x.k==='instantDeath')?'即死を使う敵がいない':null,
    stripImmune:(t,e,u)=>!enemyHas(u,x=>x.k==='strip')?'強化解除を使う敵がいない':null,
    npDownImmune:(t,e,u)=>!enemyHas(u,x=>x.k==='np'&&x.v<0)?'NP減少を使う敵がいない':null,
    starLossImmune:(t,e,u)=>!enemyHas(u,x=>x.k==='starLoss')?'スター消失を使う敵がいない':null,
    regenNp:(t)=>t.np>=RULES.gaugeMax?'NPが満タン':null,
    // 即時
    heal:(t)=>t.hp>=maxHp(t)?'HPが満タン':has(t,'healBlock')?'回復無効中':null,
    regenHp:(t)=>has(t,'healBlock')?'回復無効中':null,
    np:(t,e)=>e.v>0&&t.np>=RULES.gaugeMax?'NPが満タン':null,
    cleanse:(t,e)=>!hasDebuffK(t,e.vs)?'弱体がない':null,
    cleanseMental:(t)=>!t.fx.some(x=>FX[x.k]&&FX[x.k].mental)?'精神異常がない':null,
    strip:(t,e)=>!t.fx.some(x=>(e.vs?x.k===e.vs:FX[x.k]&&FX[x.k].buff===true)&&!x.sure)?'解除できる強化がない':null,
    buffExtend:(t)=>!t.fx.some(x=>FX[x.k]&&FX[x.k].buff===true&&x.turns!=null)?'ターン制の強化がない':null,
    skillCharge:(t,e,u,si)=>!t.used.some((x,i)=>x&&!(t===u&&i===si))?'使用済みスキルがない':null,
    ascend:(t)=>t.asc?'すでに再臨済み':null,
    starLoss:(t)=>G.players[t.pid].stars<=0?'敵のスターが0':null,
    // 敵への弱体
    sealUlt:(t,e)=>has(t,'debuffImmune')?null:oneTurn(e)&&t.np<60?'敵のNPが低い（1ターン・60%未満）':null,
    sealSkill:(t)=>!t.used.some((x,i)=>!x&&(i<2||t.asc))?'敵に未使用スキルがない':null,
    npPowDown:(t,e)=>oneTurn(e)&&t.np<60?'敵のNPが低い（1ターン・60%未満）':null,
    spread:(t,e)=>!has(t,'burn')&&!sameSkillGives(e,'burn')?'やけどがない':null,
    critDown:(t,e)=>oneTurn(e)&&G.players[t.pid].stars<=0?'敵のスターが0（1ターン）':null,
    curse:(t)=>has(t,'hitNpSeal')?'すでに被弾NP封印中':null,
    hitNpSeal:(t)=>has(t,'curse')||has(t,'hitNpSeal')?'すでに呪い・被弾NP封印中':null,
  };
  ['atkPct'].forEach(k=>WASTE_NOW[k]=WASTE_NOW.atk); WASTE_NOW.critMult=WASTE_NOW.critPow; WASTE_NOW.critRoll=WASTE_NOW.critPow; WASTE_NOW.cardConvPick=WASTE_NOW.cardConv;
  let curEffs=[];
  function sameSkillGives(e,k,anyDebuff){ return curEffs.some(x=>x!==e&&(anyDebuff?FX[x.k]&&FX[x.k].buff===false:x.k===k)); }
  function guardShadowed(t,u){ // 敵の単体攻撃はターゲット集中の味方に行く。全体宝具が来そうでなければ、t への守りは働かない
    if(t.pid!==u.pid||has(t,'taunt')) return null;
    if(!alliesOf(u).some(a=>a!==t&&has(a,'taunt')&&(a.fx.find(x=>x.k==='taunt').turns||0)!==0)) return null; // 相手のターンまで残るターゲット集中だけ
    return ultSoon(u)?null:'ほかの味方がターゲット集中（全体宝具も来ない）';
  }
  function dupGuard(t,e){ const o=t.fx.find(x=>x.k==='invul'||(x.k===e.k)); return o&&o.times==null&&(o.turns||0)>=(e.turns||1)?'同じ守り（無敵・回避）がすでに付いている':null; }
  // ---- 結果として働いたか：効果の持ち主 h が、効果が残っている間にその場面に出会ったか ----
  // ev：{type:'atk', att:[攻撃した側], tg:[攻撃を受けた側], ult:bool, all:bool} または {type:'skillPhase', pid}
  const attacks=(h,ev)=>ev.type==='atk'&&ev.att.includes(h);
  const normalAtk=(h,ev)=>attacks(h,ev)&&!ev.ult;
  const hit=(h,ev)=>ev.type==='atk'&&ev.tg.includes(h);
  const USEFUL={
    atk:attacks, atkPct:attacks, cardConv:normalAtk, cardConvPick:normalAtk,
    critPow:(h,ev)=>normalAtk(h,ev)&&ev.stars>0, critMult:(h,ev)=>normalAtk(h,ev)&&ev.stars>0, critRoll:(h,ev)=>normalAtk(h,ev)&&ev.stars>0,
    sureHit:(h,ev)=>attacks(h,ev)&&ev.tg.some(t=>has(t,'evade')), pierce:(h,ev)=>attacks(h,ev)&&ev.tg.some(t=>has(t,'evade')||has(t,'invul')),
    ignoreDef:(h,ev)=>attacks(h,ev)&&ev.tg.some(t=>has(t,'def')||has(t,'defTrait')),
    atkVs:(h,ev,x)=>attacks(h,ev)&&ev.tg.some(t=>hasDebuffK(t,x.vs)), atkTrait:(h,ev,x)=>attacks(h,ev)&&ev.tg.some(t=>traitHit(t,x.trait)),
    npPow:(h,ev)=>attacks(h,ev)&&ev.ult, aoeNormal:(h,ev)=>normalAtk(h,ev)&&alive(1-h.pid).length>=2,
    onAtkNp:normalAtk, onAtkStar:normalAtk, cardUp:attacks,
    def:hit, evade:hit, invul:hit, nullUnder:hit, guts:hit, counter:hit, onHitNp:hit, hitNpUp:hit, onHitStar:hit,
    defTrait:(h,ev,x)=>hit(h,ev)&&ev.att.some(a=>traitHit(a,x.trait)),
    taunt:(h,ev)=>hit(h,ev)&&!ev.all&&alive(h.pid).length>=2,
    // 敵に付けた弱体
    atkDown:attacks, atkPctDown:attacks, starDown:normalAtk, npGainDown:attacks, critDown:(h,ev)=>normalAtk(h,ev)&&ev.stars>0,
    npPowDown:(h,ev)=>attacks(h,ev)&&ev.ult, defDown:hit, curse:hit, hitNpSeal:hit,
    sealUlt:(h,ev)=>ev.type==='skillPhase'&&ev.pid===h.pid&&h.np>=READY, sealSkill:(h,ev)=>ev.type==='skillPhase'&&ev.pid===h.pid&&h.used.some((x,i)=>!x&&(i<2||h.asc)),
  };
  const res={};
  for(const rule of ONLY.split(',')){
    const S={games:0,skills:0,allWaste:0,partWaste:0,byK:{},bySkill:{}};
    let live=[]; // {inst, h, k, key, useful}
    const kStat=k=>S.byK[k]||(S.byK[k]={n:0,now:0,why:{},track:0,after:0});
    const sk=key=>S.bySkill[key]||(S.bySkill[key]={n:0,now:0,all:0,whyN:{},after:0});
    const notify=ev=>{ for(const r of live) if(!r.useful&&r.h.fx.includes(r.inst)&&USEFUL[r.k](r.h,ev,r.inst)) r.useful=true; };
    const doSkill0=doSkill, resolveDamage0=resolveDamage;
    doSkill=function(u,si,picked,color){
      const s=D(u.def).skills[si], key=`${D(u.def).name}「${s.name}」`, k2=sk(key); k2.n++; S.skills++;
      curEffs=s.eff; let wasted=[], judged=0;
      for(const e of s.eff){
        if(!FX[e.k]||FX[e.k].noTgt||e.k==='desc'||e.t==='master') continue;
        judged++;
        let ts=resolveTargets(u,e.t,picked);
        if(e.cond&&!(FX[e.k].condUse&&!e.cond.self)) ts=ts.filter(t=>condOk(e.cond,t));
        const st=kStat(e.k); st.n++;
        if(!ts.length){ st.now++; st.why['条件に合う対象がいない']=(st.why['条件に合う対象がいない']||0)+1; wasted.push('条件に合う対象がいない'); continue; }
        const f=WASTE_NOW[e.k]; if(!f) continue;
        const ws=ts.map(t=>f(t,e,u,si)); // 全員に無駄なときだけ無駄とする
        if(ws.every(Boolean)){ st.now++; st.why[ws[0]]=(st.why[ws[0]]||0)+1; wasted.push(`${FX[e.k].name}：${ws[0]}`); }
      }
      const before=new Map(ALLM().map(t=>[t,new Set(t.fx)]));
      doSkill0(u,si,picked,color);
      // 新しく付いた効果を追う（結果として働いたか）
      for(const t of ALLM()){ const old=before.get(t)||new Set(); for(const x of t.fx) if(!old.has(x)&&USEFUL[x.k]&&!x.tmp) live.push({inst:x,h:t,k:x.k,key,useful:false}); }
      if(wasted.length){ k2.now++; wasted.forEach(w=>k2.whyN[w]=(k2.whyN[w]||0)+1); if(wasted.length>=judged){ k2.all++; S.allWaste++; } else S.partWaste++; }
    };
    resolveDamage=function(){
      const att=G.ult?[U(G.ult)]:[...new Set(G.rolled.filter(r=>r.cmd.dmg>0).map(r=>U(r.uid)))];
      const all=G.targetAll||(!G.ult&&G.rolled.some(r=>r.cmd.dmg>0&&(isAoe(r.cmd.eff)||att.some(a=>has(a,'aoeNormal')))));
      const tg=all?alive(1-G.cur):G.target?[U(G.target)]:[];
      if(att.length&&tg.length) notify({type:'atk',att,tg,ult:!!G.ult,all,stars:G.players[G.cur].stars});
      return resolveDamage0();
    };
    const finish=()=>{ for(const r of live){ if(r.h.fx.includes(r.inst)&&!r.h.out) continue; // 試合が終わったときにまだ残っている効果は数えない
      const st=kStat(r.k); st.track++; if(!r.useful){ st.after++; sk(r.key).after++; } } live=[]; };
    for(let g=0;g<N;g++){
      newGame({rule,handicap:false});
      act('chooseMode',{mode:'watch',level:LEVEL,level2:LEVEL});
      act('setupRandom'); act('setupConfirm'); act('setupCpu',{how:'same'}); act('setupConfirm');
      if(G.phase==='setup'||G.phase==='mode') continue;
      S.games++;
      let steps=0, seen='';
      while(G.phase!=='over'&&G.turn<=200&&steps++<60000){
        G.level=G.levels[actor()];
        if(G.phase==='skill'&&seen!==G.turn+''){ seen=G.turn+''; notify({type:'skillPhase',pid:G.cur}); }
        const m=cpuDecide(); if(!m) break;
        act(m[0],m[1]||{}); FXQ.length=0; FXHIDE.clear(); if(G.log.length>300) G.log.splice(0,200);
      }
      finish();
    }
    doSkill=doSkill0; resolveDamage=resolveDamage0;
    res[rule]=S;
  }
  return res;
};
const out=vm.runInContext(`(${body})(${N},${JSON.stringify(ONLY)},${JSON.stringify(LEVEL)},${LOOK})`,ctx);
const FXN=vm.runInContext('Object.fromEntries(Object.entries(FX).map(([k,v])=>[k,v.name]))',ctx);
const pc=(a,b)=>b?`${a}/${b}（${(a/b*100).toFixed(1)}%）`:'-';
for(const [rule,S] of Object.entries(out)){
  console.log(`\n===== ${rule}：${S.games}試合・スキル使用 ${S.skills}回（${LEVEL} 同士・先読み${LOOK?'あり':'なし'}） =====`);
  console.log(`スキル全体が無駄（すべての効果が使った時点で無駄） ${pc(S.allWaste,S.skills)}　一部の効果だけ無駄 ${pc(S.partWaste,S.skills)}`);
  console.log('\n## 効果ごと（使った時点で分かる無駄 ／ 結果として一度も働かなかった）');
  for(const [k,x] of Object.entries(S.byK).sort((a,b)=>b[1].now-a[1].now||b[1].after/Math.max(1,b[1].track)-a[1].after/Math.max(1,a[1].track))){
    if(!x.now&&!x.after) continue;
    console.log(`${(FXN[k]||k).padEnd(14,'　')} 使用時 ${pc(x.now,x.n).padEnd(18)} 結果 ${pc(x.after,x.track)}`);
    for(const [w,c] of Object.entries(x.why).sort((a,b)=>b[1]-a[1])) console.log(`    ${c}回  ${w}`);
  }
  const list=(t,f,v)=>{ console.log(`\n## ${t}（多い順・上位${TOP}）`);
    for(const [key,x] of Object.entries(S.bySkill).filter(([,x])=>f(x)).sort((a,b)=>v(b[1])-v(a[1])).slice(0,TOP))
      console.log(`${pc(v(x),x.n).padEnd(18)} ${key}　${Object.entries(x.whyN).sort((a,b)=>b[1]-a[1]).map(([w,c])=>`${w}×${c}`).join('／')}`); };
  list('スキル全体が無駄だった使い方',x=>x.all,x=>x.all);
  list('一部の効果だけ無駄だった使い方',x=>x.now>x.all,x=>x.now-x.all);
}
