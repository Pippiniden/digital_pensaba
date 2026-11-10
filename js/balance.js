'use strict';
/* =====================================================================
   バランス検証ページ（balance.html）：開発者ツール。ゲームからはリンクしない
   - データ元：公開データ（js/units.js・js/masters.js） / ブラウザに「ゲームに反映」済みのデータ / エディタの下書き
   - ルール：team / mteam / simple / master（RULESETS のキー）。両陣営とも CPU の自動対戦を js/balance-worker.js に並列で回させる
   - 検証：rank＝編成の勝率ランキング（各編成が k チームとランダムに対戦） / team＝特定の編成の戦績（相手は全編成か直接対決）
           / master＝マスターの強さ（同じサーヴァント編成のミラーでマスターだけを変えて勝率を見る。マスターのあるルールだけ）
   - 1回の対戦（タスク）＝ simMatchup(rule,A,B,n,…)。タスクを作る plan() と、集計して表にする render*() が中心
   ===================================================================== */

const BSET_KEY='pencilduel.balance';
const BEXCL_KEY='pencilduel.simExclude';          // エディタのバランス検証と共有
const BMEXCL_KEY='pencilduel.simExcludeMaster';
const BRULES=['team','mteam','simple','master'];
const BSRC={ public:'公開データ', applied:'ブラウザに反映済み', draft:'エディタの下書き' };

const B={ src:'public', rule:'team', view:'rank', n:10, k:5, level:'hard', filter:'full', opp:'same', handicap:true, sv:9,
  vs:'pool', A:{ids:[],m:null}, B:{ids:[],m:null},
  excl:new Set(readJSON(BEXCL_KEY)||[]), mexcl:new Set(readJSON(BMEXCL_KEY)||[]),
  data:null, run:null, res:null };
try{ const s=readJSON(BSET_KEY)||{}; for(const k of ['src','rule','view','n','k','level','filter','opp','handicap','sv','vs']) if(k in s) B[k]=s[k]; }catch(e){}
const saveSet=()=>writeJSON(BSET_KEY,Object.fromEntries(['src','rule','view','n','k','level','filter','opp','handicap','sv','vs'].map(k=>[k,B[k]])));

const $=s=>document.querySelector(s);
const rs=()=>RULESETS[B.rule];
const hasMaster=()=>!!rs().master;
const capOf=()=>rs().costCap||RULES.costCap;
const pct=p=>`${Math.round(p*100)}%`;
const ci=(p,n)=>Math.round(196*Math.sqrt(p*(1-p)/Math.max(1,n)));
const grade=p=>{ const d=Math.abs(p-.5); return d<=.1?'ok':d<=.2?'wrn':'bad'; };
const bar=p=>`<span class="bar"><i style="width:${p*100}%"></i></span>`;
let toastTimer=null;
function toast(msg,err){ const t=$('#toast'); t.textContent=msg; t.className='show'+(err?' err':''); clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.className='',3500); }

// ---------- データ元 ----------
function loadData(kind){
  const d={kind, notes:[], units:null, masters:null, errors:[]};
  const defU=()=>normalizeUnits(DEFAULT_UNITS), defM=()=>DEFAULT_MASTERS.map(normalizeMaster);
  const get=(key,norm,label)=>{ const raw=readJSON(key); if(raw==null) return null;
    try{ return norm(raw); }catch(e){ d.notes.push(`${label}を読み込めませんでした（${e.message||'形式が違います'}）`); return null; } };
  const nu=raw=>normalizeUnits(raw), nm=raw=>{ if(!Array.isArray(raw)) throw new Error('配列ではありません'); return raw.map(normalizeMaster); };
  if(kind==='public'){ d.units=defU(); d.masters=defM(); }
  else{
    const applied=(key,norm,def)=>get(key,norm,'ブラウザのデータ')||def();
    d.units=kind==='draft'?(get(STORE.draft,nu,'エディタの下書き（サーヴァント）')||applied(STORE.units,nu,defU)):applied(STORE.units,nu,defU);
    d.masters=kind==='draft'?(get(STORE.mdraft,nm,'エディタの下書き（マスター）')||applied(STORE.masters,nm,defM)):applied(STORE.masters,nm,defM);
    const has=k=>readJSON(k)!=null;
    d.parts=kind==='draft'?[has(STORE.draft),has(STORE.mdraft)]:[has(STORE.units),has(STORE.masters)];
    if(!d.parts[0]) d.notes.push(kind==='draft'?'エディタの下書き（サーヴァント）がないため、ゲームのデータを使います':'「ゲームに反映」したサーヴァントがないため、公開データと同じです');
    if(!d.parts[1]) d.notes.push(kind==='draft'?'エディタの下書き（マスター）がないため、ゲームのデータを使います':'「ゲームに反映」したマスターがないため、公開データと同じです');
  }
  d.errors=[...validateUnits(d.units).filter(x=>x.level==='error').map(x=>(x.i>=0&&d.units[x.i]?`${d.units[x.i].name||d.units[x.i].id}：`:'')+x.msg),
            ...validateMasters(d.masters,d.units).filter(x=>x.level==='error').map(x=>(x.i>=0&&d.masters[x.i]?`${d.masters[x.i].name||d.masters[x.i].id}：`:'マスター：')+x.msg)];
  try{ d.same=kind==='public'||(JSON.stringify(d.units)===JSON.stringify(defU())&&JSON.stringify(d.masters)===JSON.stringify(defM())); }catch(e){ d.same=false; }
  return d;
}
function setSrc(kind){ B.src=kind; B.data=loadData(kind); B.A={ids:[],m:null}; B.B={ids:[],m:null}; saveSet(); }
const eu=()=>B.data.units.filter(u=>u.id&&!B.excl.has(u.id));
const em=()=>B.data.masters.filter(m=>m.id&&!B.mexcl.has(m.id));
const uOf=id=>B.data.units.find(u=>u.id===id)||{name:id,cost:0,hp:0};
const mOf=id=>B.data.masters.find(m=>m.id===id)||{name:id,cost:0};

// ---------- 編成 ----------
const teamKey=(ids,m)=>[...ids].sort().join('+')+(m?'/'+m:'');
const byHp=ids=>[...ids].sort((a,b)=>uOf(b).hp-uOf(a).hp);   // CPU の編成と同じく HP が高い順
function mkTeam(ids,m){
  ids=byHp(ids); const cost=ids.reduce((s,id)=>s+uOf(id).cost,0)+(m?mOf(m).cost:0);
  return {ids,m:m||null,cost,key:teamKey(ids,m)};
}
const teamName=t=>t.ids.map(id=>uOf(id).name).join('・')+(t.m?`／${mOf(t.m).name}`:'');
const teamHTML=t=>`${esc(t.ids.map(id=>uOf(id).name).join('・'))}${t.m?` <span class="sub">／${esc(mOf(t.m).name)}</span>`:''} <span class="sub small">C${t.cost}</span>`;

// ルールに合う編成を全部並べる（filter：full＝合計コストが上限ちょうど / maximal＝これ以上追加できない / all）
function enumTeams(filter=B.filter){
  const U=eu(), M=hasMaster()?em():[null], max=rs().partyMax, cap=capOf(), out=[];
  for(const m of M){
    const mc=m?m.cost:0;
    if(max===1){ U.forEach(u=>out.push(mkTeam([u.id],m&&m.id))); continue; }
    const rec=(start,ids,c)=>{
      if(ids.length) out.push(mkTeam(ids,m&&m.id));
      if(ids.length>=max) return;
      for(let i=start;i<U.length;i++){ const c2=c+U[i].cost; if(c2+mc<=cap) rec(i+1,[...ids,U[i].id],c2); }
    };
    rec(0,[],0);
  }
  if(max===1||filter==='all') return out;
  if(filter==='full') return out.filter(t=>t.cost===cap);
  return out.filter(t=>t.ids.length>=max||!U.some(u=>!t.ids.includes(u.id)&&t.cost+u.cost<=cap));
}
const sample=(a,k)=>{ if(!(k>0)||k>=a.length) return a.slice(); const b=a.slice(); for(let i=0;i<k;i++){ const j=i+Math.floor(Math.random()*(b.length-i)); [b[i],b[j]]=[b[j],b[i]]; } return b.slice(0,k); };
const oppOk=(a,b)=>a!==b&&(B.opp==='all'||(a.cost===b.cost&&a.ids.length===b.ids.length));
const useHandicap=()=>!!rs().handicapAsc&&B.handicap;

// ---------- 対戦（タスク）の計画 ----------
// 戻り値 {tasks:[{ta,tb,tag?}], err?}。タスク1つ＝2編成の n 試合
function plan(){
  if(!B.data) return {tasks:[],err:'データを読み込めません'};
  if(B.data.errors.length) return {tasks:[],err:`データにエラーがあります（${B.data.errors[0]}${B.data.errors.length>1?` ほか${B.data.errors.length-1}件`:''}）。エディタの「検証」で直してください`};
  if(!eu().length) return {tasks:[],err:'検証に使えるサーヴァントがいません（除外を確認してください）'};
  if(hasMaster()&&!em().length) return {tasks:[],err:'検証に使えるマスターがいません'};
  if(B.view==='master') return planMaster();
  if(B.view==='team') return planTeam();
  return planRank();
}
function planRank(){
  const teams=enumTeams(); if(teams.length<2) return {tasks:[],err:'対戦できる編成が2つ以上ありません。編成の絞り込みを「すべて」にしてください'};
  const pairs=new Map();
  for(const t of teams){
    sample(teams.filter(o=>oppOk(t,o)),B.k).forEach(o=>{ const key=[t.key,o.key].sort().join('|'); if(!pairs.has(key)) pairs.set(key,{ta:t,tb:o}); });
  }
  if(!pairs.size) return {tasks:[],err:'相手を選べる編成がありません。「相手の範囲」を「すべて」にしてください'};
  return {tasks:[...pairs.values()], teams:teams.length};
}
const teamValid=T=>{
  if(!T.ids.length) return '編成のサーヴァントを選んでください';
  if(hasMaster()&&!T.m) return 'マスターを選んでください';
  return '';
};
function planTeam(){
  const e=teamValid(B.A); if(e) return {tasks:[],err:`チームA：${e}`};
  const ta=mkTeam(B.A.ids,B.A.m);
  if(B.vs==='duel'){
    const e2=teamValid(B.B); if(e2) return {tasks:[],err:`チームB：${e2}`};
    return {tasks:[{ta,tb:mkTeam(B.B.ids,B.B.m)}], teams:1};
  }
  const opps=enumTeams().filter(o=>oppOk(ta,o)&&o.key!==ta.key);
  if(!opps.length) return {tasks:[],err:'相手にできる編成がありません。「相手の範囲」や編成の絞り込みを変えてください'};
  return {tasks:sample(opps,B.k).map(tb=>({ta,tb})), teams:opps.length};
}
// マスターの強さ：同じサーヴァント編成の両陣営でマスターだけを変える（ハンデなし）
function planMaster(){
  const M=em(); if(M.length<2) return {tasks:[],err:'マスターが2人以上必要です（除外を確認してください）'};
  const U=eu(), max=rs().partyMax, tasks=[];
  let combos=null;
  if(max>1){ // マスターチーム：2人のマスターのコストが両方入る範囲で、できるだけ多い人数の編成を使う
    combos=[];
    const rec=(start,ids,c)=>{ if(ids.length) combos.push({ids,c}); if(ids.length>=max) return; for(let i=start;i<U.length;i++) rec(i+1,[...ids,U[i].id],c+U[i].cost); };
    rec(0,[],0);
  }
  for(let i=0;i<M.length;i++) for(let j=i+1;j<M.length;j++){
    const mi=M[i], mj=M[j];
    let setups;
    if(max===1) setups=sample(U.map(u=>[u.id]),B.sv);
    else{
      const lim=capOf()-Math.max(mi.cost,mj.cost), ok=combos.filter(x=>x.c<=lim);
      const top=Math.max(0,...ok.map(x=>x.ids.length));
      setups=sample(ok.filter(x=>x.ids.length===top).map(x=>x.ids),B.sv);
    }
    for(const ids of setups){
      const a=mkTeam(ids,mi.id), b=mkTeam(ids,mj.id);
      tasks.push({ta:a,tb:b,tag:{mi:mi.id,mj:mj.id,svt:teamKey(ids)}});
    }
  }
  if(!tasks.length) return {tasks:[],err:'マスター2人とサーヴァント編成が両方収まる組み合わせがありません'};
  return {tasks};
}

// ---------- 実行（Worker を並列に） ----------
function stopRun(){ if(B.run){ B.run.workers.forEach(w=>w.terminate()); B.run=null; } }
function startRun(){
  const p=plan(); if(p.err){ toast(p.err,true); return; }
  stopRun();
  const nW=Math.max(1,Math.min(6,(navigator.hardwareConcurrency||2)-1,p.tasks.length));
  const tasks=p.tasks.map((t,i)=>({...t,id:i,sw:Math.random()})).sort((a,b)=>a.sw-b.sw);
  const run={workers:[],queue:tasks.slice(),done:0,total:tasks.length,t0:Date.now(),byId:new Map(tasks.map(t=>[t.id,t]))};
  B.run=run;
  B.res={view:B.view,rule:B.rule,src:B.src,n:B.n,k:B.k,filter:B.filter,opp:B.opp,level:B.level,handicap:useHandicap()&&B.view!=='master',vs:B.vs,
    data:B.data,items:[],done:false,teams:p.teams,excl:eu().length<B.data.units.length||em().length<B.data.masters.length};
  const hcap=B.res.handicap, feed=w=>{ const t=run.queue.pop(); if(!t) return;
    w.postMessage({t:'task',id:t.id,rule:B.rule,A:{ids:t.ta.ids,m:t.ta.m},B:{ids:t.tb.ids,m:t.tb.m},n:B.n,handicap:hcap,level:B.level}); };
  const fail=msg=>{ stopRun(); renderProg(); toast(`検証中にエラー：${msg}`,true); };
  for(let i=0;i<nW;i++){
    let w;
    try{ w=new Worker(`js/balance-worker.js?v=${Date.now()}`); }catch(e){ fail('Worker を開始できませんでした（ローカルサーバーで開いてください）'); return; }
    run.workers.push(w);
    w.onmessage=e=>{
      if(B.run!==run) return;
      const m=e.data;
      if(m.t==='ready') feed(w);
      else if(m.t==='res'){ run.done++; B.res.items.push({task:run.byId.get(m.id),r:m.r}); schedule(); if(run.done>=run.total) finish(); else feed(w); }
      else if(m.t==='error') fail(m.msg);
    };
    w.onerror=e=>{ e.preventDefault(); fail(`${e.message||'Worker の読み込みに失敗'}（ローカルサーバーで開いてください）`); };
    w.postMessage({t:'init',units:B.data.units,masters:B.data.masters});
  }
  renderProg(); renderRes(); renderCtl();
}
function finish(){ B.res.ms=Date.now()-B.run.t0; B.res.done=true; stopRun(); renderProg(); renderRes(); renderCtl(); }
let pending=false;
function schedule(){ if(pending) return; pending=true; setTimeout(()=>{ pending=false; renderProg(); renderRes(); },250); }

// ---------- 画面：操作部 ----------
const seg=(key,opts,cur)=>`<div class="seg">${opts.map(([v,l])=>`<button class="${v===cur?'on':''}" data-b="set" data-k="${key}" data-v="${esc(v)}" ${B.run?'disabled':''}>${l}</button>`).join('')}</div>`;
const sel=(key,opts,cur,label,extra='')=>`<label ${extra}>${label}<select data-s="${key}" ${B.run?'disabled':''}>${opts.map(([v,l])=>`<option value="${esc(v)}" ${String(v)===String(cur)?'selected':''}>${l}</option>`).join('')}</select></label>`;

function renderCtl(){
  const d=B.data, dis=B.run?'disabled':'', m=hasMaster(), team=rs().partyMax>1;
  const views=[['rank','編成の勝率ランキング'],['team','特定の編成の戦績'],...(m?[['master','マスターの強さ']]:[])];
  if(!views.some(v=>v[0]===B.view)) B.view='rank';
  const p=plan(), games=p.tasks.length*B.n;
  const src=Object.entries(BSRC).map(([k,l])=>{
    const dd=k===B.src?d:null;
    const desc={public:'js/units.js・js/masters.js（今ゲームで公開しているデータ）',applied:'エディタの「ゲームに反映」でこのブラウザに保存したデータ',draft:'エディタで編集中の下書き（自動保存されたもの）'}[k];
    return `<button class="src ${k===B.src?'on':''}" data-b="src" data-v="${k}" ${dis}><b>${l}</b><span class="sub small">${desc}</span>${dd?`<span class="small">サーヴァント${dd.units.length}・マスター${dd.masters.length}${dd.same&&k!=='public'?' <span class="tag">公開データと同じ</span>':''}${dd.errors.length?` <span class="bad">エラー${dd.errors.length}件</span>`:''}</span>`:''}</button>`; }).join('');
  const notes=[...d.notes,...(d.errors.length?[`エラー：${d.errors.slice(0,3).join(' ／ ')}${d.errors.length>3?` ほか${d.errors.length-3}件`:''}`]:[])];
  const needTeam=B.view==='team';
  $('#ctl').innerHTML=`
    <section class="card"><h2>① データ元</h2><div class="srcs">${src}</div>
      ${notes.length?`<p class="note ${d.errors.length?'bad':''}">${notes.map(esc).join('<br>')}</p>`:''}
      <div class="row mt"><button class="small" data-b="reload" ${dis}>再読み込み</button><span class="sub small">エディタで反映・編集した後は、ここを押すと最新のブラウザ内データを読み直します。</span></div></section>
    <section class="card"><h2>② ルールと検証の種類</h2>
      <div class="row">${seg('rule',BRULES.map(k=>[k,RULESETS[k].name+(k==='team'?'（3対3）':k==='simple'?'（1対1）':k==='mteam'?'（3対3＋マスター）':'（1対1＋マスター）')]),B.rule)}</div>
      <p class="note">${esc(rs().desc)}</p>
      <div class="row mt">${seg('view',views,B.view)}</div>
      <p class="note">${{rank:'条件に合う編成をすべて作り、各編成が他の編成とランダムに対戦して勝率で並べます。サーヴァント・マスター別の平均勝率も出します。',
        team:'指定した編成が、他のすべての編成（または抽出した編成）と戦った戦績を調べます。「直接対決」なら2つの編成だけを戦わせます。',
        master:'同じサーヴァント編成を両陣営が使い、マスターだけを変えて戦わせます。サーヴァントの強さの影響を消して、マスター自体の強さを見ます。'}[B.view]}</p>
    </section>
    <section class="card"><h2>③ 条件</h2>
      <div class="opts">
        ${B.view==='rank'||(B.view==='team'&&B.vs==='pool')?
          (team?sel('filter',[['full',`合計コスト${capOf()}ちょうど`],['maximal','これ以上追加できない編成'],['all','すべての編成']],B.filter,'使う編成'):'')+
          sel('opp',[['same','同じ合計コスト'],['all','すべて']],B.opp,'相手の範囲')+
          sel('k',[[3,'3チーム'],[5,'5チーム'],[10,'10チーム'],[20,'20チーム'],[50,'50チーム'],[0,'すべて']],B.k,B.view==='rank'?'1編成あたりの相手':'相手の数（ランダム抽出）'):''}
        ${B.view==='master'?sel('sv',[[3,'3'],[6,'6'],[9,'9'],[20,'20'],[0,'すべて']],B.sv,'マスターの組ごとのサーヴァント編成数'):''}
        ${sel('n',[[10,'10試合'],[20,'20試合'],[50,'50試合'],[100,'100試合'],[300,'300試合']],B.n,'1対戦あたり')}
        ${sel('level',[['normal','ふつう'],['hard','つよい']],B.level,'CPUの強さ')}
        ${rs().handicapAsc&&B.view!=='master'?`<label class="chk"><input type="checkbox" data-s="handicap" ${B.handicap?'checked':''} ${dis}>ハンデ戦（コスト差${rs().handicapAsc}以上で低コスト側が${TERMS.ascFull}済み、${rs().hcapBonus.gap}以上でさらに攻撃+${rs().hcapBonus.atk}・獲得NP+${rs().hcapBonus.np}%）</label>`:''}
      </div>
      ${needTeam?`<div class="seg">${[['pool','全編成と対戦'],['duel','2つの編成の直接対決']].map(([v,l])=>`<button class="${B.vs===v?'on':''}" data-b="set" data-k="vs" data-v="${v}" ${dis}>${l}</button>`).join('')}</div>
        ${builderHTML('A',B.vs==='duel'?'チームA':'検証する編成')}${B.vs==='duel'?builderHTML('B','チームB'):''}`:''}
      ${exclHTML()}
    </section>
    <section class="card"><div class="runbar">
      ${B.run?`<button class="danger" data-b="stop">中止</button>`:`<button class="primary" data-b="run" ${p.err?'disabled':''}>検証を実行</button>`}
      <span class="est">${p.err?`<span class="bad">${esc(p.err)}</span>`:`${p.tasks.length}対戦 × ${B.n}試合 ＝ <b>${games.toLocaleString()}試合</b>${p.teams&&B.view!=='master'?`（対象の編成 ${p.teams}）`:''}　目安 ${etaText(games)}`}</span></div>
      <p class="note">同じ条件でも結果は少しぶれます（±は95%の誤差の幅）。ブラウザのタブを開いたままにしてください。</p></section>`;
}
function etaText(games){ const s=games/(250*Math.max(1,Math.min(6,(navigator.hardwareConcurrency||2)-1))); return s<90?`${Math.max(1,Math.round(s))}秒`:`${Math.round(s/60)}分`; }

function builderHTML(key,label){
  const T=B[key], max=rs().partyMax, cap=capOf(), U=eu(), dis=B.run?'disabled':'';
  const mc=T.m?mOf(T.m).cost:0, cost=T.ids.reduce((s,id)=>s+uOf(id).cost,0)+mc;
  return `<div class="bld"><b>${label}</b>
    <div class="chips mt">${B.data.units.filter(u=>u.id).map(u=>{
      const on=T.ids.includes(u.id), over=!on&&max>1&&cost+u.cost>cap, full=!on&&max>1&&T.ids.length>=max;
      return `<button class="chip ${on?'on':''} ${B.excl.has(u.id)?'off':''}" data-b="bld" data-k="${key}" data-id="${esc(u.id)}" ${dis||over||full?'disabled':''}>${esc(u.name)}<span class="sub small">C${u.cost}</span></button>`; }).join('')}</div>
    ${hasMaster()?`<div class="row mt"><label class="sub small">マスター <select data-s="bm" data-k="${key}" ${dis}><option value="">（選んでください）</option>${B.data.masters.map(m=>`<option value="${esc(m.id)}" ${T.m===m.id?'selected':''}>${esc(m.name)}（C${m.cost}）</option>`).join('')}</select></label></div>`:''}
    <div class="cost">${max>1?`合計コスト <b class="${cost>cap?'bad':''}">${cost}</b> / ${cap}${hasMaster()?'（マスター込み）':''}　`:`コスト ${cost}　`}<button class="small" data-b="bldClear" data-k="${key}" ${dis}>クリア</button>
      ${max>1?`<button class="small" data-b="bldRandom" data-k="${key}" ${dis}>ランダム</button>`:''}</div></div>`;
}
function exclHTML(){
  const n=B.data.units.filter(u=>B.excl.has(u.id)).length, nm=B.data.masters.filter(m=>B.mexcl.has(m.id)).length, dis=B.run?'disabled':'';
  return `<details class="excl"><summary>検証から外す　<span class="sub small">${n||nm?`サーヴァント${n}体${hasMaster()?`・マスター${nm}人`:''}を除外中`:'なし'}</span></summary>
    <p class="note">外したキャラは、編成の組み合わせ・相手・マスター比較に使いません（エディタのバランス検証と共有）。</p>
    <div class="row"><button class="small" data-b="exclNone" ${dis}>すべて戻す</button></div>
    <div class="chips mt">${B.data.units.filter(u=>u.id).map(u=>`<button class="chip ${B.excl.has(u.id)?'off':''}" data-b="excl" data-id="${esc(u.id)}" ${dis}>${esc(u.name)}<span class="sub small">C${u.cost}</span></button>`).join('')}</div>
    ${hasMaster()?`<div class="chips mt">${B.data.masters.filter(m=>m.id).map(m=>`<button class="chip ${B.mexcl.has(m.id)?'off':''}" data-b="mexcl" data-id="${esc(m.id)}" ${dis}>${esc(m.name)}<span class="sub small">C${m.cost}</span></button>`).join('')}</div>`:''}</details>`;
}

function renderProg(){
  const r=B.run; if(!r){ $('#prog').innerHTML=''; return; }
  const el=(Date.now()-r.t0)/1000, eta=r.done?el/r.done*(r.total-r.done):0;
  $('#prog').innerHTML=`<div class="progbar"><i style="width:${r.done/r.total*100}%"></i><span>${r.done} / ${r.total} 対戦${r.done?`（残り約${eta<90?Math.round(eta)+'秒':Math.round(eta/60)+'分'}）`:''}</span></div>`;
}

// ---------- 画面：結果 ----------
function renderRes(){
  const R=B.res; if(!R){ $('#res').innerHTML='<section class="card"><p class="sub small nm">条件を選んで「検証を実行」を押してください。</p></section>'; return; }
  if(!R.items.length){ $('#res').innerHTML='<section class="card"><p class="sub small nm">集計中…</p></section>'; return; }
  const errs=R.items.reduce((s,x)=>s+x.r.errors,0), msg=(R.items.find(x=>x.r.errMsg)||{r:{}}).r.errMsg;
  const cond=[`${RULESETS[R.rule].name}`,`データ：${BSRC[R.src]}`,`1対戦${R.n}試合`,`CPU：${R.level==='hard'?'つよい':'ふつう'}`,
    ...(RULESETS[R.rule].handicapAsc&&R.view!=='master'?[`ハンデ${R.handicap?'あり':'なし'}`]:[]),...(R.excl?['除外あり']:[]),
    R.done?`${(R.ms/1000).toFixed(1)}秒`:'実行中'].join(' ／ ');
  const body=R.view==='master'?resMaster(R):R.view==='team'?resTeam(R):resRank(R);
  $('#res').innerHTML=`<section class="card"><h2>結果 <small class="sub">${esc(cond)}</small></h2>${body}
    ${errs?`<p class="bad small">⚠ ${errs}試合でエラーが起きました：${esc(msg||'')}</p>`:''}
    <p class="note">色は勝率の目安です（50%が互角）：<span class="ok">40〜60%</span> ／ <span class="wrn">30〜70%</span> ／ <span class="bad">それより外</span>。±は95%の誤差の幅です。</p></section>`;
}
const gOf=r=>r.n-r.errors, wOf=r=>r.win+r.draw/2;
function addTo(map,key,w,g,r,extra){ const s=map.get(key)||{w:0,g:0,turns:0,games:0,x:extra}; s.w+=w; s.g+=g; s.turns+=r.turns; s.games++; map.set(key,s); return s; }
const rateCell=(w,g)=>g?`<b>${pct(w/g)}</b> <span class="sub small">±${ci(w/g,g)}</span>`:'-';
const rowCls=(w,g)=>g?grade(w/g):'';

function resRank(R){
  const teams=new Map(), unitW=new Map(), mW=new Map(), cell=new Map();
  for(const {task:t,r} of R.items){
    const g=gOf(r), w=wOf(r); if(!g) continue;
    for(const [tm,ww] of [[t.ta,w],[t.tb,g-w]]){
      const s=addTo(teams,tm.key,ww,g,r); s.t=tm;
      tm.ids.forEach(id=>addTo(unitW,id,ww,g,r)); if(tm.m) addTo(mW,tm.m,ww,g,r);
    }
    cell.set(t.ta.key+'|'+t.tb.key,w/g); cell.set(t.tb.key+'|'+t.ta.key,(g-w)/g);
  }
  const rows=[...teams.values()].sort((a,b)=>b.w/b.g-a.w/a.g);
  const tbl=`<div class="tbl"><table class="stats"><thead><tr><th>#</th><th>編成</th><th>勝率</th><th></th><th>対戦数</th><th>平均ターン</th></tr></thead><tbody>${rows.map((s,i)=>
    `<tr class="${rowCls(s.w,s.g)}"><td class="num">${i+1}</td><td class="nm2">${teamHTML(s.t)}</td><td class="num rate">${rateCell(s.w,s.g)}</td><td>${bar(s.w/s.g)}</td><td class="num">${s.g}</td><td class="num">${(s.turns/s.games/Math.max(1,R.n)).toFixed(1)}</td></tr>`).join('')}</tbody></table></div>`;
  const unitTbl=(title,map,nameOf,costOf)=>{
    const rs2=[...map.entries()].sort((a,b)=>b[1].w/b[1].g-a[1].w/a[1].g);
    return `<div><h3>${title}</h3><div class="tbl"><table class="stats"><thead><tr><th>#</th><th>名前</th><th>勝率</th><th></th><th>採用した編成</th></tr></thead><tbody>${rs2.map(([id,s],i)=>
      `<tr class="${rowCls(s.w,s.g)}"><td class="num">${i+1}</td><td>${esc(nameOf(id))} <span class="sub small">C${costOf(id)}</span></td><td class="num rate">${rateCell(s.w,s.g)}</td><td>${bar(s.w/s.g)}</td><td class="num">${[...teams.values()].filter(x=>title.includes('マスター')?x.t.m===id:x.t.ids.includes(id)).length}</td></tr>`).join('')}</tbody></table></div></div>`; };
  let mx='';
  if(rs().partyMax===1&&!hasMaster()&&rows.length<=24){ // シンプルルール：キャラ同士の勝率表
    const ks=rows.map(s=>s.t).sort((a,b)=>a.cost-b.cost||uOf(a.ids[0]).name.localeCompare(uOf(b.ids[0]).name));
    mx=`<h3>勝率表（行のキャラから見た勝率 %）</h3><div class="tbl"><table class="mx"><thead><tr><th></th>${ks.map(t=>`<th title="${esc(teamName(t))}"><span class="vert">${esc(uOf(t.ids[0]).name)}</span><span class="sub small">C${t.cost}</span></th>`).join('')}</tr></thead><tbody>${ks.map(a=>`<tr><th class="rh">${esc(uOf(a.ids[0]).name)} <span class="sub small">C${a.cost}</span></th>${ks.map(b=>{
      if(a===b) return '<td class="self">—</td>'; const p=cell.get(a.key+'|'+b.key); if(p==null) return '<td class="none"></td>';
      return `<td class="hm" style="--p:${p}" title="${esc(teamName(a))} vs ${esc(teamName(b))}：${pct(p)}">${Math.round(p*100)}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  const spread=rows.length>1?`勝率の幅：${pct(rows[rows.length-1].w/rows[rows.length-1].g)}〜${pct(rows[0].w/rows[0].g)}`:'';
  return `<div class="sums"><div class="sum"><span class="sub small">編成数</span><b>${rows.length}</b></div>
      <div class="sum"><span class="sub small">対戦数</span><b>${R.items.length}</b></div>${spread?`<div class="sum"><span class="sub small">${spread.split('：')[0]}</span><b style="font-size:16px">${spread.split('：')[1]}</b></div>`:''}</div>
    <div class="grid"><div style="grid-column:1/-1"><h3>編成ランキング</h3>${tbl}</div>
    ${unitTbl('サーヴァント別の平均勝率',unitW,id=>uOf(id).name,id=>uOf(id).cost)}
    ${hasMaster()?unitTbl('マスター別の平均勝率',mW,id=>mOf(id).name,id=>mOf(id).cost):''}</div>${mx}
    <p class="note">キャラ別の勝率は、そのキャラを含む編成の勝率を試合数で平均したものです（味方・相手の組み合わせの影響を含みます）。</p>`;
}

function resTeam(R){
  const A=R.items[0].task.ta;
  let win=0,lose=0,draw=0,turns=0,fw=0,fg=0,dA=0,dB=0,out=0,g=0;
  const byU=new Map(), byM=new Map(), byC=new Map();
  const rows=R.items.map(({task:t,r})=>{ const gg=gOf(r), w=wOf(r);
    win+=r.win; lose+=r.lose; draw+=r.draw; turns+=r.turns; fw+=r.firstWin; fg+=r.firstGames; dA+=r.dealtA; dB+=r.dealtB; out+=r.aOut; g+=gg;
    if(gg){ t.tb.ids.forEach(id=>addTo(byU,id,w,gg,r)); if(t.tb.m) addTo(byM,t.tb.m,w,gg,r); addTo(byC,t.tb.cost,w,gg,r); }
    return {t:t.tb,r,g:gg,w}; }).sort((a,b)=>(a.g?a.w/a.g:2)-(b.g?b.w/b.g:2));
  const p=g?(win+draw/2)/g:0, box=(l,v,c='',s='')=>`<div class="sum ${c}"><span class="sub small">${l}</span><b>${v}</b>${s?`<span class="sub small">${s}</span>`:''}</div>`;
  const grp=(title,map,name)=>`<div><h3>${title}</h3><div class="tbl"><table class="stats"><thead><tr><th>${title.split('にいた')[0]}</th><th>試合</th><th>勝率（検証した編成）</th></tr></thead><tbody>${[...map.entries()].sort((a,b)=>a[1].w/a[1].g-b[1].w/b[1].g).map(([k,s])=>
    `<tr class="${rowCls(s.w,s.g)}"><td>${name(k)}</td><td class="num">${s.g}</td><td class="num rate">${rateCell(s.w,s.g)}</td></tr>`).join('')}</tbody></table></div></div>`;
  const dd=Math.max(1,g);
  return `<div class="sums"><div class="me"><b>${teamHTML(A)}</b></div>
      ${box('勝率',pct(p),grade(p),`±${ci(p,g)}%`)}${box('勝-敗'+(draw?'-分':''),`${win}-${lose}${draw?`-${draw}`:''}`)}${box('平均ターン',(turns/dd).toFixed(1))}
      ${box('先攻時勝率',fg?pct(fw/fg):'-')}${box('与 / 被ダメ',`${Math.round(dA/dd)} / ${Math.round(dB/dd)}`)}${box(`${TERMS.out}した味方`,`${(out/dd).toFixed(2)}騎`,'', `1試合あたり`)}</div>
    ${R.items.length>1?`<div class="grid">
      ${grp('相手にいたサーヴァント',byU,id=>`${esc(uOf(id).name)} <span class="sub small">C${uOf(id).cost}</span>`)}
      ${byM.size?grp('相手にいたマスター',byM,id=>`${esc(mOf(id).name)} <span class="sub small">C${mOf(id).cost}</span>`):''}
      ${grp('相手の合計コスト',byC,k=>`コスト${k}`)}</div>
    <h3>相手別（苦手な順）</h3><div class="tbl"><table class="stats"><thead><tr><th>相手</th><th>勝率</th><th></th><th>勝-敗${draw?'-分':''}</th><th>平均ターン</th><th>先攻時勝率</th></tr></thead><tbody>${rows.map(x=>
      `<tr class="${rowCls(x.w,x.g)}"><td class="nm2">${teamHTML(x.t)}</td><td class="num rate">${rateCell(x.w,x.g)}</td><td>${x.g?bar(x.w/x.g):''}</td><td class="num">${x.r.win}-${x.r.lose}${draw?`-${x.r.draw}`:''}</td><td class="num">${(x.r.turns/Math.max(1,x.g)).toFixed(1)}</td><td class="num">${x.r.firstGames?pct(x.r.firstWin/x.r.firstGames):'-'}</td></tr>`).join('')}</tbody></table></div>`
      :`<h3>直接対決</h3><p class="note">相手：${teamHTML(R.items[0].task.tb)}</p>`}`;
}

function resMaster(R){
  const ms=new Map(), cell=new Map(), svtCell=new Map(), svts=new Set();
  for(const {task:t,r} of R.items){
    const g=gOf(r), w=wOf(r); if(!g) continue;
    const {mi,mj,svt}=t.tag;
    for(const [m,o,ww] of [[mi,mj,w],[mj,mi,g-w]]){
      addTo(ms,m,ww,g,r);
      const c=cell.get(m+'|'+o)||{w:0,g:0}; c.w+=ww; c.g+=g; cell.set(m+'|'+o,c);
      if(rs().partyMax===1){ svts.add(svt); const k=m+'|'+svt, s=svtCell.get(k)||{w:0,g:0}; s.w+=ww; s.g+=g; svtCell.set(k,s); }
    }
  }
  const rows=[...ms.entries()].sort((a,b)=>b[1].w/b[1].g-a[1].w/a[1].g), ids=rows.map(x=>x[0]);
  const tbl=`<div class="tbl"><table class="stats"><thead><tr><th>#</th><th>マスター</th><th>コスト</th><th>勝率</th><th></th><th>試合数</th><th>平均ターン</th></tr></thead><tbody>${rows.map(([id,s],i)=>
    `<tr class="${rowCls(s.w,s.g)}"><td class="num">${i+1}</td><td>${esc(mOf(id).name)}</td><td class="num">${mOf(id).cost}</td><td class="num rate">${rateCell(s.w,s.g)}</td><td>${bar(s.w/s.g)}</td><td class="num">${s.g}</td><td class="num">${(s.turns/s.games/Math.max(1,R.n)).toFixed(1)}</td></tr>`).join('')}</tbody></table></div>`;
  const mx=`<div class="tbl"><table class="mx"><thead><tr><th></th>${ids.map(id=>`<th title="${esc(mOf(id).name)}"><span class="vert">${esc(mOf(id).name)}</span></th>`).join('')}</tr></thead><tbody>${ids.map(a=>`<tr><th class="rh">${esc(mOf(a).name)}</th>${ids.map(b=>{
    if(a===b) return '<td class="self">—</td>'; const c=cell.get(a+'|'+b); if(!c||!c.g) return '<td class="none"></td>'; const p=c.w/c.g;
    return `<td class="hm" style="--p:${p}" title="${esc(mOf(a).name)} vs ${esc(mOf(b).name)}：${pct(p)}">${Math.round(p*100)}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
  let sm='';
  if(svts.size&&svts.size<=14){
    const sl=[...svts].sort((a,b)=>uOf(a).cost-uOf(b).cost);
    sm=`<h3>マスター × サーヴァント（そのマスターの勝率 %）</h3><div class="tbl"><table class="mx"><thead><tr><th></th>${sl.map(s=>`<th><span class="vert">${esc(uOf(s).name)}</span><span class="sub small">C${uOf(s).cost}</span></th>`).join('')}</tr></thead><tbody>${ids.map(m=>`<tr><th class="rh">${esc(mOf(m).name)}</th>${sl.map(s=>{
      const c=svtCell.get(m+'|'+s); if(!c||!c.g) return '<td class="none"></td>'; const p=c.w/c.g;
      return `<td class="hm" style="--p:${p}" title="${esc(mOf(m).name)} × ${esc(uOf(s).name)}：${pct(p)}">${Math.round(p*100)}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  return `<div class="sums"><div class="sum"><span class="sub small">マスター</span><b>${rows.length}</b></div><div class="sum"><span class="sub small">対戦数</span><b>${R.items.length}</b></div></div>
    <h3>マスターの強さ（同じサーヴァントでの勝率）</h3>${tbl}
    <h3>マスター同士の勝率表（行のマスターから見た勝率 %）</h3>${mx}${sm}
    <p class="note">ハンデなしのミラー戦です。マスターのコストは考慮していないので、勝率が高くコストも高いマスターは強さに見合っています。コストの低いマスターが高勝率なら要調整です。</p>`;
}

// ---------- 入力 ----------
function rerender(){ renderCtl(); renderProg(); renderRes(); }
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-b]'); if(!b||b.disabled) return;
  const a=b.dataset.b, d=b.dataset;
  switch(a){
    case 'src': setSrc(d.v); B.res=null; break;
    case 'reload': setSrc(B.src); toast('ブラウザのデータを読み直しました'); break;
    case 'set': { const v=d.v; B[d.k]=v; if(d.k==='rule'||d.k==='view'){ B.A={ids:[],m:null}; B.B={ids:[],m:null}; } saveSet(); break; }
    case 'run': startRun(); return;
    case 'stop': stopRun(); renderProg(); break;
    case 'bld': { const T=B[d.k], i=T.ids.indexOf(d.id); if(i>=0) T.ids.splice(i,1); else if(rs().partyMax===1) T.ids=[d.id]; else T.ids.push(d.id); break; }
    case 'bldClear': B[d.k]={ids:[],m:null}; break;
    case 'bldRandom': { // 上限に収まるランダムな編成（マスター込み）
      const T=B[d.k], U=eu(), M=em(); T.m=hasMaster()?M[Math.floor(Math.random()*M.length)].id:null;
      const room=capOf()-(T.m?mOf(T.m).cost:0); let best=[];
      for(let t=0;t<40;t++){ const p=[]; let c=0; for(const u of sample(U,0).sort(()=>Math.random()-.5)) if(p.length<rs().partyMax&&c+u.cost<=room){ p.push(u.id); c+=u.cost; } if(p.length>best.length) best=p; }
      T.ids=best; break; }
    case 'excl': B.excl.has(d.id)?B.excl.delete(d.id):B.excl.add(d.id); writeJSON(BEXCL_KEY,[...B.excl]); break;
    case 'mexcl': B.mexcl.has(d.id)?B.mexcl.delete(d.id):B.mexcl.add(d.id); writeJSON(BMEXCL_KEY,[...B.mexcl]); break;
    case 'exclNone': B.excl.clear(); B.mexcl.clear(); writeJSON(BEXCL_KEY,[]); writeJSON(BMEXCL_KEY,[]); break;
  }
  const open=document.querySelector('details.excl')&&document.querySelector('details.excl').open;
  renderCtl(); if(open){ const x=document.querySelector('details.excl'); if(x) x.open=true; }
  if(a==='src'||a==='reload') renderRes();
});
document.addEventListener('change',e=>{
  const el=e.target, k=el.dataset&&el.dataset.s; if(!k) return;
  if(k==='bm') B[el.dataset.k].m=el.value||null;
  else if(el.type==='checkbox') B[k]=el.checked;
  else B[k]=['n','k','sv'].includes(k)?Number(el.value):el.value;
  saveSet();
  const open=document.querySelector('details.excl')&&document.querySelector('details.excl').open;
  renderCtl(); if(open){ const x=document.querySelector('details.excl'); if(x) x.open=true; }
});
window.addEventListener('pagehide',stopRun);

setSrc(B.src); rerender();
