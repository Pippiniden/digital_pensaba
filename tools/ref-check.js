// 基準値の検証：js/unit-ref.js（UNIT_REF）どおりに作ったテスト用サーヴァント同士を 3on3 で対戦させ、コスト・カード構成ごとの勝率を出す
//
//   node tools/ref-check.js              すべての検証（1キャラ 2000試合）
//   node tools/ref-check.js -n 5000      1キャラあたりの試合数
//   node tools/ref-check.js -e base,comp 検証を絞る（base / comp / tier / face / roster）
//   node tools/ref-check.js --set "hp.3=[600,700];postAdd.1=40"   基準値を一時的に書き換えて試す（js/unit-ref.js は変えない。; 区切り）
//   node tools/ref-check.js --list       テスト用サーヴァントの数値だけ表示して終わる
//
// テスト用サーヴァント：コスト1〜5 × カード構成6種（B3 / B2A2 / B2Q2 / A3 / A2Q2 / Q3）。スキルは全員同じ、宝具は追加効果のない単純なダメージ宝具で2通り。
//   宝具「全体」：全員 敵全体（威力は UNIT_REF.ult.all のコストごとの値）
//   宝具「単体」：全員 敵単体（威力は UNIT_REF.ult.one のコストごとの値）
//   数値は基準の幅の 下限 / 中央 / 上限（合計攻撃力やNP合計の上限に収まるよう、はみ出す分は1枚ずつ調整する）。
//   ほかに 耐久型（HPが上限・攻撃が下限）と 攻撃型（HPが下限・攻撃が上限）
// 検証：
//   base  ：中央のキャラ30体だけの環境で、各キャラ＋ランダムな味方2騎 vs 同じ合計コストのランダムな3騎（合計コスト10）
//   comp  ：中央のキャラで組んだ編成（5+4+1 / 5+3+2 / 4+4+2 / 4+3+3）ごとの勝率。相手は4つの編成からランダム
//   ult   ：全体宝具のキャラの環境に、単体宝具のキャラを1体。威力を変えながら、全体宝具のときと勝率が並ぶ単体の威力を探す
//           あわせて、1体だけ全体宝具の威力を変えたときの勝率も出す（コストごとの全体の威力を決める材料）
//           （-e ult を付けたときだけ実行。--grid 240,280,320 で試す単体の威力、--grid-all 160,200,240 で全体の威力を指定）
//   tier  ：中央のキャラの環境に、下限／上限／耐久型／攻撃型のキャラを1体だけ入れたときの勝率（基準の幅がどれだけ勝率を動かすか）
//   face  ：4番の面を 効果弱 / 中 / 強 に替えたときの勝率（3つが釣り合っているか）
//   roster：今のキャラの環境に、中央のキャラを1体だけ入れたときの勝率（今のキャラと比べた強さ）
// CPU は両方「つよい（先読みなし）」。目安は 50%±3%。
'use strict';
const fs=require('fs'), vm=require('vm'), path=require('path'), os=require('os'), cp=require('child_process');
const argv=process.argv.slice(2), opt=(...names)=>{ const i=argv.findIndex(a=>names.includes(a)); return i<0?null:argv[i+1]; }, flag=n=>argv.includes(n);
const N=Math.max(1,Number(opt('-n','--games'))||2000), ONLY=(opt('-e','--exp')||'base,comp,tier,face,roster').split(','), SET=opt('--set')||'';

// ---- ゲームのスクリプトを、ブラウザなしの入れ物（vm）に読み込む ----
function load(){
  const store=()=>({getItem(){return null},setItem(){},removeItem(){}});
  const ctx={console,Math,Date,JSON,localStorage:store(),sessionStorage:store(),document:{},setTimeout(){return 0},clearTimeout(){}};
  ctx.window=ctx; vm.createContext(ctx);
  const dir=path.join(__dirname,'..','js');
  let src='';
  for(const f of ['rules','units','masters','common','unit-ref','engine','cpu','sim']) src+=fs.readFileSync(path.join(dir,f+'.js'),'utf8')+'\n;\n';
  vm.runInContext(src+'function render(){}\n('+setup+')('+JSON.stringify(SET)+')',ctx,{filename:'game.js'});
  return ctx;
}

// ---- vm の中に置く部品：テスト用サーヴァントの組み立てと対戦 ----
function setup(SET){
  // --set：UNIT_REF の値を一時的に書き換える（"hp.3=[600,700]" → UNIT_REF.hp[3]=[600,700]）
  for(const s of SET.split(';').map(x=>x.trim()).filter(Boolean)){ const [k,v]=s.split('='), ks=k.trim().split('.'); let o=UNIT_REF; ks.slice(0,-1).forEach(x=>o=o[x]); o[ks[ks.length-1]]=JSON.parse(v); }
  const PATS={B3:[3,1,1],B2A2:[2,2,1],B2Q2:[2,1,2],A3:[1,3,1],A2Q2:[1,2,2],Q3:[1,1,3]}; // [Buster, Arts, Quick] の枚数
  const TIERS={lo:[0,0],mid:[.5,.5],hi:[1,1],tank:[1,0],glass:[0,1]}; // [HPの位置, 攻撃の位置]（0＝下限 / 1＝上限）
  const r10=v=>Math.round(v/10)*10, r5=v=>Math.round(v/5)*5, sum=a=>a.reduce((s,x)=>s+x,0);
  // 上限を超えていたら後ろのカードから step ずつ減らす（lo 未満にはしない）、下限に足りなければ前から増やす（hi は超えない）
  const fit=(vals,min,max,step,lo,hi)=>{
    vals=vals.slice();
    for(let g=0;g<200&&max!=null&&sum(vals)>max;g++){ const i=vals.length-1-g%vals.length; if(vals[i]-step>=lo(i)) vals[i]-=step; }
    for(let g=0;g<200&&min!=null&&sum(vals)<min;g++){ const i=g%vals.length; if(vals[i]+step<=hi(i)) vals[i]+=step; }
    return vals;
  };
  const SKILLS=[ {name:'攻撃強化',eff:[{k:'atk',t:'self',v:20,turns:3}]}, {name:'魔力充填',eff:[{k:'np',t:'self',v:20}]}, {name:'回避',eff:[{k:'evade',t:'self',v:0,turns:1}]} ];
  const FACE_EFF={ weak:{k:'ignoreDef',t:'self',v:0,turns:1,times:1}, mid:{k:'atk',t:'self',v:30,turns:1}, strong:{k:'evade',t:'self',v:0,turns:1} };
  // id = r_<コスト>_<構成>_<lo|mid|hi|tank|glass>_<weak|mid|strong>_<宝具>　宝具：A＝全体（基準値）/ S＝単体（基準値）/ a240＝全体240 / s360＝単体360
  const refId=(cost,pat,tier='mid',face='weak',kit='A')=>['r',cost,pat,tier,face,kit].join('_');
  function refUnit(id){
    const [,c,pat,tier,face,kit]=id.split('_'), cost=+c, [fh,f]=TIERS[tier], R=UNIT_REF, n=PATS[pat];
    const cols=[...Array(n[0]).fill('R'),...Array(n[1]).fill('B'),...Array(n[2]).fill('G')];
    const rg=i=>R.dmg[cols[i]][cost];
    // 再臨前のダメージ：幅の中の f の位置。合計攻撃力の幅に収める
    let pre=cols.map((_,i)=>r10(rg(i)[0]+f*(rg(i)[1]-rg(i)[0])));
    pre=fit(pre,R.total[cost][0],R.total[cost][1],10,i=>rg(i)[0],i=>rg(i)[1]);
    // 再臨後：合計が postAdd だけ増えるように、前のカードから10ずつ配る
    const post=pre.slice(); for(let left=R.postAdd[cost],g=0;left>0;g++,left-=10) post[g%5]+=10;
    // NP：Arts 1枚あたり。合計の上限に収める（収まらなければ下限より下げる）
    const nr=R.np[Math.min(3,n[1])], npOf=(rng,max)=>fit(Array(n[1]).fill(0).map(()=>r5(rng[0]+f*(rng[1]-rng[0]))),null,max,5,()=>5,()=>99);
    const npPre=npOf(nr.pre,nr.preMax), npPost=npOf(nr.post,nr.postMax);
    // スター：Quick 3枚で合計の目安になるように1枚あたりを決める（コスト5は多め）
    const plus=cost>=R.star.plusCost?Math.round(R.star.plus[0]+f*(R.star.plus[1]-R.star.plus[0])):0;
    const split=t=>[Math.ceil(t/3),Math.round(t/3),t-Math.ceil(t/3)-Math.round(t/3)], stPre=split(R.star.pre+plus), stPost=split(R.star.post+plus);
    let a=0,q=0;
    const cards=cols.map((col,i)=>{ const np=col==='B'?a++:-1, st=col==='G'?q++:-1;
      return { pre:{c:col,dmg:pre[i],np:np<0?0:npPre[np],star:st<0?0:stPre[st]}, post:{c:col,dmg:post[i],np:np<0?0:npPost[np],star:st<0?0:stPost[st]} }; });
    const asc={ pre:{c:'ASC'}, post:{c:'W',label:'4番',eff:[FACE_EFF[face]],dmg:R.ascFace.dmg[cost][face],np:0,star:0} };
    const faces=[cards[0],cards[1],cards[2],asc,cards[3],cards[4]].map(x=>({acts:1,...x}));
    const hp=r10(R.hp[cost][0]+fh*(R.hp[cost][1]-R.hp[cost][0]));
    const m=/^([as])(\d+)$/.exec(kit), u=m?[m[1]==='a'?'enemy_all':'target',+m[2]]:kit==='S'?['target',R.ult.one[cost]]:['enemy_all',R.ult.all[cost]];
    return normalizeUnit({ id, name:id, cls:'セイバー', cost, hp, faces, skills:SKILLS, ult:{name:'宝具',c:cols[0],eff:[{k:'dmg',t:u[0],v:u[1]}]} });
  }
  const ROSTER=UNITS.map(u=>u.id);
  const ensure=ids=>ids.forEach(id=>{ if(/^r_/.test(id)&&!D(id)){ const u=refUnit(id); UNITS=UNITS.concat(u); ALL_UNITS=ALL_UNITS.concat(u); } });
  window.REFCHK={ PATS, refId, refUnit, ROSTER,
    // 1件の対戦：t ＋ランダムな味方 vs 同じ合計コスト・同じ人数（pool＝味方・相手に使うキャラ。t を足して使う）
    run(job){ const pool=job.pool==='roster'?ROSTER:job.pool; ensure([job.t,...pool]);
      const r=simTeam(job.t,job.n,[...new Set([job.t,...pool])],true);
      return { t:job.t, exp:job.exp, n:r.win+r.lose+r.draw, w:r.win+r.draw/2, errors:r.errors, errMsg:r.errMsg, none:r.none, turns:r.turns }; },
    // 編成ごとの対戦：コストの組 comp の編成（カード構成はランダム）vs 4つの編成からランダム
    comp(job){ const COMPS=[[5,4,1],[5,3,2],[4,4,2],[4,3,3]], pats=Object.keys(PATS);
      const team=cs=>{ for(;;){ const ids=cs.map(c=>refId(c,simPick(pats),'mid','weak',job.kit)); if(new Set(ids).size===ids.length){ ensure(ids); return simByHp(ids); } } };
      let w=0,n=0,errors=0,errMsg;
      for(let i=0;i<job.n;i++){ const sw=i%2, me=team(job.comp), op=team(simPick(COMPS));
        try{ const g=simGame(sw?[op,me]:[me,op],'team',false); n++; w+=g.winner===null?.5:(g.winner===sw?1:0); }catch(e){ errors++; errMsg=String(e&&e.message||e); } }
      return { t:job.comp.join('+'), exp:job.exp, n, w, errors, errMsg }; },
    // 表示用：キャラの数値を1行に
    line(id){ const u=refUnit(id), pre=u.faces.filter(f=>f.pre.c!=='ASC'), s=k=>pre.map(f=>f.pre[k]).reduce((a,b)=>a+b,0), sp=k=>pre.map(f=>f.post[k]).reduce((a,b)=>a+b,0), w=u.faces.find(f=>f.pre.c==='ASC').post;
      const card=f=>({R:'B',B:'A',G:'Q'})[f.pre.c]+f.pre.dmg+'>'+f.post.dmg;
      return `HP${u.hp}  ${pre.map(card).join(' ')}  4番${w.dmg}  合計${s('dmg')}>${sp('dmg')}  NP${s('np')}>${sp('np')}%  ★${s('star')}>${sp('star')}`; },
  };
}

// ---- 子プロセス：渡された対戦を順にこなして結果を返す ----
if(flag('--worker')){
  const ctx=load();
  process.on('message',job=>{ process.send(vm.runInContext('REFCHK.'+(job.comp?'comp':'run')+'('+JSON.stringify(job)+')',ctx)); });
  return;
}

const ctx=load(), Q=code=>vm.runInContext(code,ctx);
const COSTS=[5,4,3,2,1], PATS=Object.keys(Q('REFCHK.PATS')), id=(...a)=>Q('REFCHK.refId('+a.map(x=>JSON.stringify(x)).join(',')+')');
const pad=(s,n)=>{ s=String(s); let w=0; for(const ch of s) w+=ch.charCodeAt(0)>255?2:1; return s+' '.repeat(Math.max(0,n-w)); };
const pct=r=>r&&r.n?(100*r.w/r.n).toFixed(1)+'%':'  -  ';

if(flag('--list')){
  for(const tier of ['lo','mid','hi','tank','glass']){ console.log(`\n■ ${({lo:'下限',mid:'中央',hi:'上限',tank:'耐久型（HP上限・攻撃下限）',glass:'攻撃型（HP下限・攻撃上限）'})[tier]}`);
    for(const c of COSTS) for(const p of PATS) console.log(pad(`コスト${c} ${p}`,14)+Q('REFCHK.line('+JSON.stringify(id(c,p,tier))+')')); }
  return;
}

// ---- 対戦の一覧を作る ----
const jobs=[], KITS=[['A','宝具は全員 全体'],['S','宝具は全員 単体']], GRID=(opt('--grid')||'200,240,280,320,360,400,440,480,520').split(',').map(Number), GRID_ALL=(opt('--grid-all')||'120,160,200,240,280,320,360,400,440').split(',').map(Number);
const pool=(kit)=>COSTS.flatMap(c=>PATS.map(p=>id(c,p,'mid','weak',kit)));
for(const [kit] of KITS){
  if(ONLY.includes('base')) for(const t of pool(kit)) jobs.push({exp:'base|'+kit,t,pool:pool(kit),n:N});
  if(ONLY.includes('comp')) for(const comp of [[5,4,1],[5,3,2],[4,4,2],[4,3,3]]) for(let k=0;k<6;k++) jobs.push({exp:'comp|'+kit,comp,kit,n:N});
  if(ONLY.includes('tier')) for(const tier of ['lo','hi','tank','glass']) for(const c of COSTS) for(const p of PATS) jobs.push({exp:`tier|${kit}|${tier}`,t:id(c,p,tier,'weak',kit),pool:pool(kit),n:N});
  if(ONLY.includes('face')) for(const face of ['mid','strong']) for(const c of COSTS) for(const p of PATS) jobs.push({exp:`face|${kit}|${face}`,t:id(c,p,'mid',face,kit),pool:pool(kit),n:N});
  if(ONLY.includes('roster')) for(const t of pool(kit)) jobs.push({exp:'roster|'+kit,t,pool:'roster',n:N});
}
if(ONLY.includes('ult')) for(const c of COSTS) for(const p of PATS){
  for(let k=0;k<2;k++) jobs.push({exp:'ult|A',t:id(c,p,'mid','weak','A'),pool:pool('A'),n:N}); // 比べる相手：全体宝具のとき（2回ぶん回して誤差を減らす）
  for(const v of GRID) jobs.push({exp:'ult|'+v,t:id(c,p,'mid','weak','s'+v),pool:pool('A'),n:N});
  for(const v of GRID_ALL) jobs.push({exp:'ulta|'+v,t:id(c,p,'mid','weak','a'+v),pool:pool('A'),n:N});
}
if(ONLY.includes('roster')) for(const t of Q('REFCHK.ROSTER')) jobs.push({exp:'roster|self',t,pool:'roster',n:Math.ceil(N/2)});

// ---- 子プロセスに配って回す ----
const res=[], t0=Date.now(), total=jobs.length;
const workers=Math.max(1,Math.min(jobs.length,(os.cpus().length||2)-1));
let done=0, alive=workers;
console.error(`${total}件 × 最大${N}試合を ${workers} プロセスで実行中…`);
for(let i=0;i<workers;i++){
  const w=cp.fork(__filename,['--worker','--set',SET]);
  const next=()=>{ const j=jobs.pop(); if(j) w.send(j); else { w.kill(); if(!--alive) report(); } };
  w.on('message',r=>{ res.push(r); if(++done%20===0) console.error(`  ${done}/${total}`); next(); });
  next();
}

function report(){
  const by=exp=>res.filter(r=>r.exp===exp), of=(exp,c,p)=>by(exp).find(r=>r.t.startsWith(`r_${c}_${p}_`)), agg=rs=>rs.reduce((a,r)=>({n:a.n+r.n,w:a.w+r.w}),{n:0,w:0});
  const table=(title,exp)=>{
    if(!by(exp).length) return;
    console.log(`\n■ ${title}`);
    console.log(pad('',10)+PATS.map(p=>pad(p,8)).join('')+'平均');
    for(const c of COSTS) console.log(pad(`コスト${c}`,10)+PATS.map(p=>pad(pct(of(exp,c,p)),8)).join('')+pct(agg(PATS.map(p=>of(exp,c,p)).filter(Boolean))));
    console.log(pad('平均',10)+PATS.map(p=>pad(pct(agg(COSTS.map(c=>of(exp,c,p)).filter(Boolean))),8)).join(''));
  };
  for(const [kit,name] of KITS){
    table(`基準の中央のキャラ同士（${name}）`,'base|'+kit);
    const cm=by('comp|'+kit);
    if(cm.length){ console.log(`\n■ 編成ごとの勝率（${name}）`); for(const k of [...new Set(cm.map(r=>r.t))].sort().reverse()) console.log(pad(k,10)+pct(agg(cm.filter(r=>r.t===k)))); }
    table(`中央の環境に、下限のキャラを1体（${name}）`,`tier|${kit}|lo`);
    table(`中央の環境に、上限のキャラを1体（${name}）`,`tier|${kit}|hi`);
    table(`中央の環境に、耐久型（HP上限・攻撃下限）のキャラを1体（${name}）`,`tier|${kit}|tank`);
    table(`中央の環境に、攻撃型（HP下限・攻撃上限）のキャラを1体（${name}）`,`tier|${kit}|glass`);
    table(`4番の面を「効果中：攻撃ダメージ+30(1T)」にしたキャラを1体（${name}。効果弱は上の中央の表）`,`face|${kit}|mid`);
    table(`4番の面を「効果強：回避(1T)」にしたキャラを1体（${name}）`,`face|${kit}|strong`);
    table(`今のキャラの環境に、中央のキャラを1体（${name}）`,'roster|'+kit);
  }
  if(by('ult|A').length){
    console.log('\n■ 全体宝具の環境で、単体宝具の威力を変えたときの勝率（6構成の平均）');
    console.log(pad('',10)+pad('全体',14)+GRID.map(v=>pad('単体'+v,9)).join('')+'釣り合う単体の威力');
    for(const c of COSTS){ const rate=exp=>{ const a=agg(by(exp).filter(r=>r.t.startsWith(`r_${c}_`))); return 100*a.w/a.n; }, base=rate('ult|A'), rs=GRID.map(v=>rate('ult|'+v));
      // 単体の威力と勝率の関係を直線で近似し（1点ごとの誤差をならす）、全体宝具のときの勝率になる威力を求める
      const mx=GRID.reduce((a,b)=>a+b,0)/GRID.length, my=rs.reduce((a,b)=>a+b,0)/rs.length;
      const k=GRID.reduce((s,x,i)=>s+(x-mx)*(rs[i]-my),0)/(GRID.reduce((s,x)=>s+(x-mx)**2,0)||1), v=k>0?mx+(base-my)/k:NaN;
      const eq=!(k>0)?'求まらない（威力で勝率が上がらない）':v<GRID[0]?`${GRID[0]}より下`:v>GRID[GRID.length-1]?`${GRID[GRID.length-1]}より上`:`約${Math.round(v)}（100あたり+${(k*100).toFixed(1)}%）`;
      console.log(pad(`コスト${c}`,10)+pad(`${Q('UNIT_REF.ult.all['+c+']')}：${base.toFixed(1)}%`,14)+rs.map(x=>pad(x.toFixed(1)+'%',9)).join('')+eq); }
  }
  if(by('ult|A').length&&GRID_ALL.length){
    console.log('\n■ 全体宝具の環境で、1体だけ全体宝具の威力を変えたときの勝率（6構成の平均）');
    console.log(pad('',10)+GRID_ALL.map(v=>pad('全体'+v,9)).join(''));
    for(const c of COSTS) console.log(pad(`コスト${c}`,10)+GRID_ALL.map(v=>{ const a=agg(by('ulta|'+v).filter(r=>r.t.startsWith(`r_${c}_`))); return pad((100*a.w/a.n).toFixed(1)+'%',9); }).join(''));
  }
  const self=by('roster|self');
  if(self.length){
    console.log('\n■ 今のキャラ同士（コストごとの平均と幅）');
    const costOf=t=>Q('D('+JSON.stringify(t)+').cost');
    for(const c of [...COSTS,0]){ const rs=self.filter(r=>costOf(r.t)===c&&r.n); if(!rs.length) continue;
      const v=rs.map(r=>100*r.w/r.n); console.log(pad(`コスト${c}`,10)+pad(pct(agg(rs)),8)+`（${Math.min(...v).toFixed(1)}〜${Math.max(...v).toFixed(1)}%・${rs.length}体）`); }
  }
  const errs=res.filter(r=>r.errors), none=res.filter(r=>r.none);
  if(none.length) console.log(`\n編成できず対戦しなかったキャラ：${none.map(r=>r.t).join(', ')}`);
  if(errs.length){ console.log(`\n対戦中のエラー ${errs.length}件：`); for(const r of errs.slice(0,10)) console.log(`- ${r.t}（${r.exp}）：${r.errors}回 ${r.errMsg}`); }
  console.log(`\n${((Date.now()-t0)/1000).toFixed(0)}秒`);
  process.exit(errs.length?1:0);
}
