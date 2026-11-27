// 新しい効果（発動型・特性付与・参照・毎ターン上昇）の CPU の使いどきを決める検証
//
//   node tools/fx-timing.js                    すべての効果 × すべての案（team・mteam、1案 1000試合）
//   node tools/fx-timing.js -f onAtkFx,scale   効果を絞る（下の VARIANTS のキー）
//   node tools/fx-timing.js -v onAtkFx:now     案を1つだけ
//   node tools/fx-timing.js -n 4000 -r team    試合数（ルールごと）・ルール
//   node tools/fx-timing.js -j 12              同時に動かすプロセス数（既定：CPU数-2）
//   node tools/fx-timing.js --base old.js      「いまの判断」側を、取っておいた cpu.js のコピーにする（決めた案の確認用）
//   node tools/fx-timing.js --json out.json    サンプルキャラを JSON に書き出して終わる（エディタの「読み込み」で見られる）
//   node tools/fx-timing.js --list             サンプルキャラのスキルを表示して終わる
//
// やり方（cpu.js の「新しい効果の使いどき」と同じ）：
//   サンプルキャラ10体（コスト1〜5 × 2体。エディタのカード構成テンプレ CARD_TPL で作り、スキル3つすべてが新しい効果）だけで対戦する。
//   今のキャラは使わない（マスターチームのマスターだけは今のマスターから選ぶ。両陣営同じ）。
//   両陣営とも同じ編成（ミラー）で、片方だけ「案」の判断、もう片方は「いまの判断」（js/cpu.js そのまま）。陣営は1試合ごとに入れ替える。
//   編成はその効果を持つサンプルキャラを必ず1体入れる。CPU は両方「つよい（先読みなし）」。
//   出すもの：案の側の勝率（±は95%の幅）と、その効果のスキルを使った割合・使ったターンの平均（案の側 / いまの側）
'use strict';
const fs=require('fs'), vm=require('vm'), path=require('path'), os=require('os'), cp=require('child_process');
const argv=process.argv.slice(2), opt=(...n)=>{ const i=argv.findIndex(a=>n.includes(a)); return i<0?null:argv[i+1]; }, flag=n=>argv.includes(n);
const root=path.join(__dirname,'..'), dir=path.join(root,'js');

// ---------- サンプルキャラ（スキルはすべて新しい効果） ----------
const SAMPLE_DEF=[
  { id:'smp_5a', name:'試作ノ剣士', cls:'セイバー', cost:5, tpl:'B3', traits:['秩序','人型'], skills:[
    {name:'斬撃の呪印', eff:[{k:'onAtkFx',t:'self',turns:3,eff:[{k:'defDown',t:'target',v:15,turns:3}]}]},
    {name:'闘志', eff:[{k:'atk',t:'self',v:20,turns:3,grow:10,growMax:50}]},
    {name:'決死の誓い', eff:[{k:'onKoFx',t:'self',turns:5,eff:[{k:'atk',t:'ally_other',v:30,turns:3},{k:'np',t:'ally_other',v:30}]}]} ] },
  { id:'smp_5b', name:'試作ノ魔術師', cls:'キャスター', cost:5, tpl:'A3', traits:['混沌','人型'], skills:[
    {name:'呪詛の陣', eff:[{k:'endFx',t:'self',turns:3,eff:[{k:'poison',t:'enemy_all',v:20,turns:2}]}]},
    {name:'魔力循環', eff:[{k:'np',t:'self',v:20,scale:{by:'enemyFx',v:'*debuff',per:10,max:50}}]},
    {name:'終焉の刻', eff:[{k:'delayFx',t:'self',turns:2,eff:[{k:'np',t:'self',v:50},{k:'atk',t:'ally_all',v:20,turns:3}]}]} ] },
  { id:'smp_4a', name:'試作ノ槍兵', cls:'ランサー', cost:4, tpl:'B2Q2', traits:['秩序','人型'], skills:[
    {name:'反骨', eff:[{k:'onHitFx',t:'self',turns:3,eff:[{k:'atkDown',t:'target',v:15,turns:2}]}]},
    {name:'戦闘続行', eff:[{k:'guts',t:'self',v:300,times:1,turns:5},{k:'onGutsFx',t:'self',turns:5,eff:[{k:'np',t:'self',v:50},{k:'atk',t:'self',v:30,turns:3}]}]},
    {name:'竜殺し', eff:[{k:'traitAddFoe',t:'enemy_all',trait:'試作竜',turns:3},{k:'atkTrait',t:'self',trait:'試作竜',v:50,turns:3}]} ] },
  { id:'smp_4b', name:'試作ノ弓兵', cls:'アーチャー', cost:4, tpl:'A2Q2', traits:['秩序'], skills:[
    {name:'鷹の目', eff:[{k:'startFx',t:'self',turns:3,eff:[{k:'star',t:'master',v:3},{k:'critRoll',t:'self',v:1,turns:1}]}]},
    {name:'連携射撃', eff:[{k:'atk',t:'ally_all',v:10,turns:3,scale:{by:'allyTrait',v:'秩序',per:5,max:25}}]},
    {name:'狙撃', eff:[{k:'onAtkFx',t:'self',turns:3,eff:[{k:'critDown',t:'target',v:1,turns:2},{k:'np',t:'self',v:5}]}]} ] },
  { id:'smp_3a', name:'試作ノ騎兵', cls:'ライダー', cost:3, tpl:'B2A2', traits:['秩序','騎乗'], skills:[
    {name:'騎乗突撃', eff:[{k:'atk',t:'self',v:10,turns:1,scale:{by:'stars',per:2,max:40}}]},
    {name:'殿', eff:[{k:'onKoFx',t:'self',turns:5,eff:[{k:'heal',t:'ally_other',v:150}]}]},
    {name:'反撃の構え', eff:[{k:'onHitFx',t:'self',turns:3,times:3,eff:[{k:'burn',t:'target',v:30,turns:3}]}]} ] },
  { id:'smp_3b', name:'試作ノ暗殺者', cls:'アサシン', cost:3, tpl:'Q3', traits:['混沌'], skills:[
    {name:'毒刃', eff:[{k:'onAtkFx',t:'self',turns:3,eff:[{k:'poison',t:'target',v:30,turns:3}]}]},
    {name:'影縫い', eff:[{k:'delayFx',t:'self',turns:2,eff:[{k:'np',t:'self',v:40},{k:'evade',t:'self',turns:1}]}]},
    {name:'暗殺術', eff:[{k:'atk',t:'self',v:20,turns:3,scale:{by:'enemyFx',v:'poison',per:15,max:50}}]} ] },
  { id:'smp_2a', name:'試作ノ狂戦士', cls:'バーサーカー', cost:2, tpl:'B3', traits:['混沌','人型'], skills:[
    {name:'狂化', eff:[{k:'atk',t:'self',v:20,turns:3,grow:10,growMax:50}]},
    {name:'不屈', eff:[{k:'guts',t:'self',v:150,times:1,turns:5},{k:'onGutsFx',t:'self',turns:5,eff:[{k:'atk',t:'self',v:40,turns:3}]}]},
    {name:'道連れ', eff:[{k:'onKoFx',t:'self',turns:5,eff:[{k:'instantDeath',t:'target',chance:3}]}]} ] },
  { id:'smp_2b', name:'試作ノ祈祷師', cls:'キャスター', cost:2, tpl:'A3', traits:['秩序'], skills:[
    {name:'祝福', eff:[{k:'startFx',t:'ally_all',turns:3,eff:[{k:'heal',t:'self',v:30}]}]},
    {name:'魔力供給', eff:[{k:'endFx',t:'ally_all',turns:3,eff:[{k:'np',t:'self',v:5}]}]},
    {name:'鎮魂', eff:[{k:'np',t:'ally_all',v:10,scale:{by:'allyOut',per:20,max:50}}]} ] },
  { id:'smp_1a', name:'試作ノ従卒', cls:'セイバー', cost:1, tpl:'A2Q2', traits:['秩序','人型'], skills:[
    {name:'身代わりの盾', eff:[{k:'onHitFx',t:'self',turns:3,eff:[{k:'star',t:'master',v:2},{k:'np',t:'self',v:10}]}]},
    {name:'最期の祈り', eff:[{k:'onKoFx',t:'self',turns:5,eff:[{k:'np',t:'ally_other',v:30}]}]},
    {name:'挑発', eff:[{k:'traitAddFoe',t:'enemy_all',trait:'試作竜',turns:3},{k:'atkDown',t:'enemy_all',v:10,turns:3}]} ] },
  { id:'smp_1b', name:'試作ノ伝令', cls:'ライダー', cost:1, tpl:'B2Q2', traits:['混沌'], skills:[
    {name:'鼓舞', eff:[{k:'atk',t:'ally_other',v:10,turns:3,scale:{by:'enemyOut',per:10,max:30}}]},
    {name:'時限の加護', eff:[{k:'delayFx',t:'ally_all',turns:3,eff:[{k:'heal',t:'self',v:100}]}]},
    {name:'奮起', eff:[{k:'traitAdd',t:'self',trait:'試作竜',turns:3},{k:'endFx',t:'self',turns:3,eff:[{k:'atk',t:'self',v:10,turns:1}]}]} ] },
];
// テンプレ（rules.js の CARD_TPL / CARD_TPL_HP。エディタの「カード構成テンプレ」と同じ）から6面と HP を作る。宝具は基準値（UNIT_REF.ult.all）の全体宝具
function buildSamples(G){
  const cmd=t=>{ const m=/^([BAQ])(\d+)(?:\/(\d+))?$/.exec(t), c={B:'R',A:'B',Q:'G'}[m[1]], v=+(m[3]||0); return {c,dmg:+m[2],np:c==='B'?v:0,star:c==='G'?v:0}; };
  return SAMPLE_DEF.map(d=>{
    const faces=G.CARD_TPL[d.cost][d.tpl].split(',').map(r=>{
      if(r==='ASC') return {acts:1,pre:{c:'ASC'},post:{c:'W',label:'霊基の一撃',eff:[{k:'ignoreDef',t:'self',v:0,turns:1,times:1}],dmg:G.UNIT_REF.ascFace.dmg[d.cost].weak,np:0,star:0}};
      const [a,b]=r.split('>'); return {acts:1,pre:cmd(a),post:cmd(b)};
    });
    const L=s=>[s];
    return { id:d.id, name:d.name, cls:d.cls, traits:d.traits, cost:d.cost, hp:G.CARD_TPL_HP[d.cost], faces, skills:d.skills,
      ult:{name:`${d.name}の宝具`,c:faces[0].pre.c,eff:[{k:'dmg',t:'enemy_all',v:G.UNIT_REF.ult.all[d.cost]}]},
      lines:{start:L('試作、起動。'),attack:L('はっ！'),skill:L('いくぞ。'),np:L('宝具、展開！'),damage:L('くっ……'),defeat:L('ここまでか……'),win:L('任務完了。'),extra:L('まだだ！'),npDamage:L('ぐあっ！')},
      memo:'tools/fx-timing.js のサンプル（新しい効果の CPU 検証用）' };
  });
}

// ---------- 案（使いどき）：効果ごとに、cpu.js の NEWFX の差し替え（js の文）。'cur' はいまの判断（比較の基準なので書かない） ----------
const now=k=>`NEWFX.${k}={score:()=>5};`, never=k=>`NEWFX.${k}={score:()=>-9};`;
const keepW=(k,score)=>`NEWFX.${k}={...NEWFX.${k},score:${score}};`; // waste（今は働かない判定）はいまのまま
const VARIANTS={
  onAtkFx:{ now:now('onAtkFx'), never:never('onAtkFx'),
    acting:keepW('onAtkFx','c=>c.acting&&!G.ult?3.5:0'),
    atk2:keepW('onAtkFx','c=>!G.ult&&attackCount(c.mine)>=2?4:0') },
  onHitFx:{ now:now('onHitFx'), never:never('onHitFx'),
    always3:keepW('onHitFx','c=>c.mine.length?3.5:-1'),
    hp70:keepW('onHitFx','c=>c.mine.some(t=>hpR(t)<.7)?3.5:0') },
  onKoFx:{ now:now('onKoFx'), never:never('onKoFx'),
    hp50:keepW('onKoFx','c=>c.mine.some(t=>hpR(t)<.5)?3.5:0'),
    hp30:keepW('onKoFx','c=>c.mine.some(t=>hpR(t)<.3)?3.5:0'),
    danger:keepW('onKoFx','c=>c.mine.some(t=>cpuDanger(t))?3.5:0') },
  onGutsFx:{ now:now('onGutsFx'), never:never('onGutsFx'),
    guts:keepW('onGutsFx','c=>c.ts.some(t=>has(t,"guts"))||c.effs.some(x=>x.k==="guts")?3.5:0'),
    hp50:keepW('onGutsFx','c=>(c.ts.some(t=>has(t,"guts"))||c.effs.some(x=>x.k==="guts"))&&c.mine.some(t=>hpR(t)<.5)?3.5:0') },
  delayFx:{ now:now('delayFx'), never:never('delayFx'),
    hp60:keepW('delayFx','c=>c.mine.some(t=>hpR(t)<.6)?3.5:0'),
    t3:keepW('delayFx','c=>G.turn>=3?3.5:0') },
  startFx:{ now:now('startFx'), never:never('startFx'), t3:keepW('startFx','c=>G.turn>=3?3.5:0') },
  endFx:{ now:now('endFx'), never:never('endFx'), t3:keepW('endFx','c=>G.turn>=3?3.5:0') },
  traitAddFoe:{ now:now('traitAddFoe'), never:never('traitAddFoe'),
    acting:keepW('traitAddFoe','c=>c.foes.length&&cpuTraitUse(c.u,c.e.trait)&&alive(c.u.pid).some(a=>isActing(a)&&effsDeep(cpuKitEffs(a)).some(x=>x.trait===c.e.trait))?3.5:0') },
  traitAdd:{ now:now('traitAdd'), never:never('traitAdd') },
  scale:{ wait50:'SCALE_WAIT=.5;', wait100:'SCALE_WAIT=1;' },
  grow:{ early:'GROW_EARLY=true;' },
};
// その効果を持つスキル（サンプルキャラの）か
const hasFeat=(s,f)=>s.eff.some(e=>f==='scale'?!!e.scale:f==='grow'?!!e.grow:e.k===f);

// ---------- ゲームの入れ物 ----------
function load(baseFile){
  const store=()=>({getItem(){return null},setItem(){},removeItem(){}});
  const ctx={console,Math,Date,JSON,localStorage:store(),sessionStorage:store(),document:{},setTimeout(){return 0},clearTimeout(){}};
  ctx.window=ctx; vm.createContext(ctx);
  for(const f of ['rules','units','masters','common','unit-ref','engine','cpu']) vm.runInContext(fs.readFileSync(path.join(dir,f+'.js'),'utf8'),ctx,{filename:f+'.js'});
  vm.runInContext('function render(){} this.__G={CARD_TPL,CARD_TPL_HP,UNIT_REF};',ctx);
  // 案の側の CPU：cpu.js をもう1つ、関数の中に閉じ込めて読み込む（G やエンジンは共有）。set で案の文をその中で実行する
  ctx.__ALT=fs.readFileSync(path.join(dir,'cpu.js'),'utf8'); // 1件ごとに読み込み直す（前の案を残さないため。runJob）
  if(baseFile){ // 「いまの判断」側を別の cpu.js にする
    const b=fs.readFileSync(baseFile,'utf8');
    vm.runInContext(`const BASE_CPU=(function(){\n${b}\n;CPU_LOOKAHEAD=false;return {decide:()=>cpuDecide()};})();`,ctx,{filename:'cpu.js(基準)'});
  }
  vm.runInContext('CPU_LOOKAHEAD=false;',ctx);
  return ctx;
}

// ---------- 1件の検証（子プロセスで動く）：feat の案 code を n 試合 ----------
function runJob(ctx,job){
  ctx.__SAMPLES=buildSamples(ctx.__G); ctx.__JOB=job;
  vm.runInContext(`var ALT_CPU=(function(){\n${ctx.__ALT}\n;CPU_LOOKAHEAD=false;return {decide:()=>cpuDecide(), set:code=>eval(code)};})();`,ctx,{filename:'cpu.js(案)'});
  return vm.runInContext(`(()=>{
    const job=__JOB, S=__SAMPLES.map(normalizeUnit);
    if(!D(S[0].id)){ UNITS=UNITS.concat(S); ALL_UNITS=ALL_UNITS.concat(S); }
    ALT_CPU.set(job.code);
    const base=typeof BASE_CPU!=='undefined'?BASE_CPU.decide:cpuDecide;
    const feat=job.feat, has=u=>u.skills.some(s=>(${hasFeat})(s,feat));
    const rs=RULESETS[job.rule], masters=rs.master?MASTERS.filter(m=>m.cost<=4):[null];
    const combos=[]; for(let a=0;a<S.length;a++) for(let b=a+1;b<S.length;b++) for(let c=b+1;c<S.length;c++) combos.push([S[a],S[b],S[c]]);
    const out={w:0,g:0,use:[[0,0,0],[0,0,0]]}; // use[0]＝案の側 / [1]＝いまの側：[使った回数, 使えた騎×試合, 使ったターンの合計]
    for(let i=0;i<job.n;i++){
      const m=masters[Math.floor(Math.random()*masters.length)], cap=(rs.costCap||RULES.costCap)-(m?m.cost:0);
      let ok=combos.filter(t=>t.some(has)&&t.reduce((s,u)=>s+u.cost,0)===cap); if(!ok.length) ok=combos.filter(t=>t.some(has)&&t.reduce((s,u)=>s+u.cost,0)<=cap);
      const team=ok[Math.floor(Math.random()*ok.length)].slice().sort(()=>Math.random()-.5).map(u=>u.id);
      const NEW=i%2;
      newGame({rule:job.rule,handicap:false});
      applyMode({mode:'cpu',level:'hard',cpu:[true,true],names:['A','B']});
      G.picks=[team.slice(),team.slice()]; if(m) G.mpicks=[m.id,m.id]; G.phase='init';
      startGame();
      let steps=0;
      while(G.phase!=='over'&&G.turn<=150&&steps++<40000){
        const side=actor(), mv=side===NEW?ALT_CPU.decide():base(); if(!mv) break;
        if(mv[0]==='useSkill'){ const u=U(mv[1].uid), s=D(u.def).skills[mv[1].si]; if((${hasFeat})(s,feat)){ const r=out.use[side===NEW?0:1]; r[0]++; r[2]+=G.turn; } }
        ACTIONS[mv[0]](mv[1]||{}); FXQ.length=0; FXHIDE.clear(); if(G.log.length>300) G.log.length=0;
      }
      if(G.phase!=='over') continue;
      out.g++; if(G.winner===NEW) out.w++;
      G.players.forEach((P,pid)=>P.party.forEach(u=>D(u.def).skills.forEach((s,si)=>{ if((${hasFeat})(s,feat)&&(si<2||u.asc)) out.use[pid===NEW?0:1][1]++; })));
    }
    return out;
  })()`,ctx);
}

// ---------- 子プロセス ----------
if(flag('--worker')){
  const ctx=load(opt('--base'));
  process.on('message',job=>{ try{ process.send({id:job.id,r:runJob(ctx,job)}); }catch(e){ process.send({id:job.id,err:String(e&&e.stack||e)}); } });
  return;
}

// ---------- 親：サンプルの表示・書き出し、案ごとの検証を子プロセスに配る ----------
if(flag('--json')||flag('--list')){
  const ctx=load(); const S=buildSamples(ctx.__G);
  if(flag('--json')){ fs.writeFileSync(opt('--json'),JSON.stringify(S,null,1)); console.log(`${S.length}体を書き出しました：${opt('--json')}`); }
  else { ctx.__S=S; console.log(vm.runInContext(`__S.map(normalizeUnit).map(u=>'コスト'+u.cost+' '+u.name+'（'+u.id+'）HP'+u.hp+'\\n'+u.skills.map((s,i)=>'  S'+(i+1)+' '+s.name+'：'+effsText(s.eff)).join('\\n')).join('\\n')`,ctx));
    const iss=vm.runInContext(`validateUnits(__S.map(normalizeUnit)).filter(x=>x.level==='error').map(x=>x.msg)`,ctx); if(iss.length) console.log('エラー：',iss); }
  return;
}
const N=Math.max(1,Number(opt('-n'))||1000), RULES_=(opt('-r')||'team,mteam').split(','), J=Math.max(1,Number(opt('-j'))||Math.max(1,os.cpus().length-2));
const ONLYF=opt('-f')?opt('-f').split(','):null, ONLYV=opt('-v'), BASE=opt('--base');
const cases=[];
for(const [f,vs] of Object.entries(VARIANTS)){ if(ONLYF&&!ONLYF.includes(f)) continue;
  for(const [v,code] of Object.entries(vs)){ if(ONLYV&&ONLYV!==`${f}:${v}`) continue; for(const rule of RULES_) cases.push({f,v,code,rule}); } }
if(ONLYV&&!cases.length){ // 案を直接書いた（-v feat:js文）
  const [f,...rest]=ONLYV.split(':'); for(const rule of RULES_) cases.push({f,v:'custom',code:rest.join(':'),rule});
}
// 1件を CHUNK 試合ずつに分けて配る
const CHUNK=Math.max(25,Math.ceil(N/Math.max(1,Math.floor(J*2/Math.max(1,cases.length))||1)));
const jobs=[]; cases.forEach((c,ci)=>{ for(let left=N;left>0;left-=CHUNK) jobs.push({id:jobs.length,ci,feat:c.f,code:c.code,rule:c.rule,n:Math.min(CHUNK,left)}); });
const acc=cases.map(()=>({w:0,g:0,use:[[0,0,0],[0,0,0]]}));
let next=0, done=0; const t0=Date.now();
console.log(`${cases.length}件（案×ルール）・${jobs.length}個に分けて ${J}プロセスで実行（1件 ${N}試合${BASE?`・いまの側＝${BASE}`:''}）`);
const workers=[...Array(Math.min(J,jobs.length))].map(()=>cp.fork(__filename,['--worker',...(BASE?['--base',BASE]:[])],{stdio:['ignore','inherit','inherit','ipc']}));
const feed=w=>{ if(next<jobs.length) w.send(jobs[next++]); else w.kill(); };
workers.forEach(w=>{ w.on('message',m=>{ if(m.err){ console.error(m.err); process.exit(1); }
  const a=acc[jobs[m.id].ci], r=m.r; a.w+=r.w; a.g+=r.g; r.use.forEach((x,i)=>x.forEach((v,j)=>a.use[i][j]+=v));
  if(++done===jobs.length) report(); feed(w); }); feed(w); });
function report(){
  const pct=(a,b)=>b?`${(a/b*100).toFixed(0)}%`:'-', avg=(a,b)=>b?(a/b).toFixed(1):'-';
  console.log(`\n${((Date.now()-t0)/1000).toFixed(0)}秒`);
  console.log('効果          案        ルール  案の勝率        使った割合（案／いま）  使ったターン（案／いま）');
  cases.forEach((c,i)=>{ const a=acc[i], r=a.w/a.g, se=Math.sqrt(r*(1-r)/a.g)*196, star=Math.abs(r-.5)*100>se?' ★':'';
    console.log(`${c.f.padEnd(13)} ${c.v.padEnd(9)} ${c.rule.padEnd(6)}  ${(r*100).toFixed(1)}% ±${se.toFixed(1)}${star}`.padEnd(48)+`  ${pct(a.use[0][0],a.use[0][1])} ／ ${pct(a.use[1][0],a.use[1][1])}`.padEnd(24)+`  ${avg(a.use[0][2],a.use[0][0])} ／ ${avg(a.use[1][2],a.use[1][0])}`); });
  console.log('（★＝差が95%の幅を超えている。案の勝率が50%より上なら、案の方がいまの判断より強い）');
}
