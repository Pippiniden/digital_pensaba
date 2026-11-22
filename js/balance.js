'use strict';
/* =====================================================================
   バランス検証ページ（balance.html）：開発者ツール。ゲームからはリンクしない
   - データ元：公開データ（js/units.js・js/masters.js） / ブラウザに「ゲームに反映」済みのデータ / エディタの下書き
   - ルール：team / mteam / simple / master（RULESETS のキー）。両陣営とも CPU の自動対戦を js/balance-worker.js に並列で回させる
   - 検証：rank＝編成の勝率ランキング（各編成が k チームとランダムに対戦） / team＝特定の編成の戦績（相手は全編成か直接対決）
           / master＝マスターの強さ（同じサーヴァント編成のミラーでマスターだけを変えて勝率を見る。マスターのあるルールだけ）
   - 1回の対戦（タスク）＝ simMatchup(rule,A,B,n,…)。タスクを作る plan() と、集計して表にする render*() が中心
   - 目標の誤差（B.goal）：全員の誤差の幅が目標以下になるまで回す。誤差が残っている相手の対戦を優先する（startRun / goalState）。同じ組の結果は B.res.byKey で足し合わせる
   ===================================================================== */

const BSET_KEY='pencilduel.balance';
const BEXCL_KEY='pencilduel.simExclude';          // エディタのバランス検証と共有
const BMEXCL_KEY='pencilduel.simExcludeMaster';
const BRULES=['team','mteam','simple','master'];
const BSRC={ public:'公開データ', applied:'ブラウザに反映済み', draft:'エディタの下書き' };

const B={ src:'public', rule:'team', view:'rank', n:10, k:5, goal:0, detail:true, bg:true, level:'hard', filter:'full', opp:'same', handicap:true, sv:9, mcol:{}, cmin:7,
  vs:'pool', A:{ids:[],m:null}, B:{ids:[],m:null},
  excl:new Set(readJSON(BEXCL_KEY)||[]), mexcl:new Set(readJSON(BMEXCL_KEY)||[]),
  data:null, run:null, res:null };
try{ const s=readJSON(BSET_KEY)||{}; for(const k of ['src','rule','view','n','k','goal','detail','bg','level','filter','opp','handicap','sv','vs','mcol','cmin']) if(k in s) B[k]=s[k]; }catch(e){}
const saveSet=()=>writeJSON(BSET_KEY,Object.fromEntries(['src','rule','view','n','k','goal','detail','bg','level','filter','opp','handicap','sv','vs','mcol','cmin'].map(k=>[k,B[k]])));

const $=s=>document.querySelector(s);
const rs=()=>RULESETS[B.rule];
const hasMaster=()=>!!rs().master;
const capOf=()=>rs().costCap||RULES.costCap;
const pct=p=>`${Math.round(p*100)}%`;
const ci=(p,n)=>Math.round(196*Math.sqrt(p*(1-p)/Math.max(1,n)));
// 目標の誤差との比較に使う誤差の幅（丸めない）。試合が少ないうちに全勝・全敗で幅が0にならないよう、勝ち2・負け2を足して出す
const ciX=(w,g)=>{ const p=(w+2)/(g+4); return 196*Math.sqrt(p*(1-p)/(g+4)); };
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
function setSrc(kind){ B.src=kind; B.data=loadData(kind); B.uIdx=new Map(B.data.units.map(u=>[u.id,u])); B.dataVer=(B.dataVer||0)+1; B.A={ids:[],m:null}; B.B={ids:[],m:null}; saveSet(); }
const eu=()=>B.data.units.filter(u=>u.id&&!B.excl.has(u.id));
const em=()=>B.data.masters.filter(m=>m.id&&!B.mexcl.has(m.id));
// マスターチームでは編成が数十万になり uOf がそのぶん呼ばれるので、id → キャラの表（B.uIdx）で引く
const uOf=id=>(B.uIdx&&B.uIdx.get(id))||B.data.units.find(u=>u.id===id)||{name:id,cost:0,hp:0};
const uNm=id=>{ const u=uOf(id), same=B.data.units.some(o=>o.id!==id&&o.name===u.name); return same?`${u.name}（${id}）`:u.name; };   // 同名の別キャラは id を添えて見分ける
const mOf=id=>B.data.masters.find(m=>m.id===id)||{name:id,cost:0};

// ---------- 編成 ----------
const teamKey=(ids,m)=>[...ids].sort().join('+')+(m?'/'+m:'');
const byHp=ids=>[...ids].sort((a,b)=>uOf(b).hp-uOf(a).hp);   // CPU の編成と同じく HP が高い順
function mkTeam(ids,m){
  ids=byHp(ids); const cost=ids.reduce((s,id)=>s+uOf(id).cost,0)+(m?mOf(m).cost:0);
  return {ids,m:m||null,cost,key:teamKey(ids,m)};
}
const teamName=t=>t.ids.map(id=>uNm(id)).join('・')+(t.m?`／${mOf(t.m).name}`:'');
const teamHTML=t=>`${esc(t.ids.map(id=>uNm(id)).join('・'))}${t.m?` <span class="sub">／${esc(mOf(t.m).name)}</span>${((B.res&&B.res.mcol)||{})[t.m]?` <span class="tag">${TERMS[B.res.mcol[t.m]]}特化</span>`:''}`:''} <span class="sub small">C${t.cost}</span>`;

// ルールに合う編成を全部並べる（filter：full＝合計コストが上限ちょうど / maximal＝これ以上追加できない / all）
function enumTeams(filter=B.filter){
  const U=eu(), M=hasMaster()?em():[null], max=rs().partyMax, cap=capOf(), out=[];
  for(const m of M){
    const mc=m?m.cost:0, fc=m&&B.mcol[m.id]; // 色特化マスター：その色の面が cmin 以上の編成だけ
    if(max===1){ U.forEach(u=>out.push(mkTeam([u.id],m&&m.id))); continue; }
    const rec=(start,ids,c)=>{
      if(ids.length&&(!fc||colorFaces(ids,fc)>=B.cmin)) out.push(mkTeam(ids,m&&m.id));
      if(ids.length>=max) return;
      for(let i=start;i<U.length;i++){ const c2=c+U[i].cost; if(c2+mc<=cap) rec(i+1,[...ids,U[i].id],c2); }
    };
    rec(0,[],0);
  }
  if(max===1) return out;
  // 戦闘は満員（3騎）前提で調整しているので、人数が足りない編成（5コスト2騎など）は常に除外する
  const full3=out.filter(t=>t.ids.length>=max);
  if(filter==='full') return full3.filter(t=>t.cost===cap);
  return full3;
}
const sample=(a,k)=>{ if(!(k>0)||k>=a.length) return a.slice(); const b=a.slice(); for(let i=0;i<k;i++){ const j=i+Math.floor(Math.random()*(b.length-i)); [b[i],b[j]]=[b[j],b[i]]; } return b.slice(0,k); };
// a（self を含む）から self を除いて k 個をランダムに選ぶ（k が 0 か残り全部以上なら全部）。配列をコピーしないので、大きな a から少し選ぶときに速い
function pickOthers(a,k,self){
  const n=a.length-1;
  if(!(k>0)||k>=n) return a.filter(o=>o!==self);
  const got=new Set();
  while(got.size<k){ const i=Math.floor(Math.random()*a.length); if(a[i]!==self) got.add(i); }
  return [...got].map(i=>a[i]);
}
const oppOk=(a,b)=>a!==b&&(B.opp==='all'||(a.cost===b.cost&&a.ids.length===b.ids.length));
const oppGroup=t=>B.opp==='all'?'':t.cost+'/'+t.ids.length; // oppOk で相手になれる編成のまとまり
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
  // 相手になれる編成を先にまとめておき、そこから選ぶ（編成ごとに全編成を絞り込むと、マスターチームの十数万編成で数分かかる）
  const groups=new Map(); for(const t of teams){ const g=oppGroup(t); if(!groups.has(g)) groups.set(g,[]); groups.get(g).push(t); }
  const pairs=new Map();
  for(const t of teams){
    pickOthers(groups.get(oppGroup(t)),B.k,t).forEach(o=>{ const key=t.key<o.key?t.key+'|'+o.key:o.key+'|'+t.key; if(!pairs.has(key)) pairs.set(key,{ta:t,tb:o}); });
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
// 編成のサーヴァントが持つ、指定色(R/B/G)のコマンド面の合計（出目1〜6の再臨前の面。特殊行動・再臨の面は数えない）
const colorFaces=(ids,c)=>ids.reduce((s,id)=>s+(uOf(id).faces||[]).filter(f=>f.pre&&f.pre.c===c).length,0);
// マスターの強さ：同じサーヴァント編成の両陣営でマスターだけを変える（ハンデなし）
function planMaster(){
  const M=em(); if(M.length<2) return {tasks:[],err:'マスターが2人以上必要です（除外を確認してください）'};
  const U=eu(), max=rs().partyMax, tasks=[], skip=[];
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
      setups=ok.filter(x=>x.ids.length===max).map(x=>x.ids); // 満員（3騎）だけ
      const cs=[mi,mj].map(m=>B.mcol[m.id]).filter(Boolean); // 色特化マスターが出る対戦は、その色が cmin 面以上の編成だけ（2人とも指定ならどちらかの条件を満たせばよい）
      if(cs.length) setups=setups.filter(ids=>cs.some(c=>colorFaces(ids,c)>=B.cmin));
      if(!setups.length&&(B.mcol[mi.id]||B.mcol[mj.id])){ skip.push(`${mi.name}×${mj.name}`); continue; }
      setups=sample(setups,B.sv);
    }
    for(const ids of setups){
      const a=mkTeam(ids,mi.id), b=mkTeam(ids,mj.id);
      tasks.push({ta:a,tb:b,tag:{mi:mi.id,mj:mj.id,svt:teamKey(ids)}});
    }
  }
  if(!tasks.length&&skip.length) return {tasks:[],err:`色特化の条件（${B.cmin}面以上）を満たすサーヴァント編成がありません（除外や最小面数を確認してください）`};
  if(!tasks.length) return {tasks:[],err:'マスター2人とサーヴァント編成が両方収まる組み合わせがありません'};
  return {tasks,skip};
}

// ---------- 実行（Worker を並列に） ----------
function stopRun(){ if(B.run){ B.run.workers.forEach(w=>w.terminate()); B.run=null; keepAwake(false); } }
// ---------- 裏でも回し続ける ----------
// 対戦は Worker が回し、結果の受け取りもタイマーではなくメッセージなので、タブを裏にしても進む。
// ただしブラウザは長く裏にあるタブを止める（凍結・破棄）ことがあるので、実行中だけ ①Web Lock を持つ ②ほぼ無音の音を鳴らし続ける（B.bg がオンのとき）。
// どちらも「実行」ボタンを押した操作の中で始める（音は操作なしでは鳴らせない）。進み具合はタブの題名にも出す
const KEEP={ctx:null,osc:null,release:null}, BASE_TITLE=document.title;
function keepAwake(on){
  if(!on){
    if(KEEP.release){ KEEP.release(); KEEP.release=null; }
    try{ if(KEEP.osc) KEEP.osc.stop(); if(KEEP.ctx) KEEP.ctx.close(); }catch(e){}
    KEEP.osc=KEEP.ctx=null; return;
  }
  if(!B.bg||KEEP.release) return;
  KEEP.release=()=>{};
  try{ if(navigator.locks) navigator.locks.request('pencil-balance-run',()=>new Promise(res=>{ KEEP.release=res; })); }catch(e){}
  try{
    const AC=window.AudioContext||window.webkitAudioContext; if(!AC) return;
    const ctx=new AC(), osc=ctx.createOscillator(), gain=ctx.createGain();
    osc.frequency.value=40; gain.gain.value=.0008; // 聞こえない大きさ（完全な0だとブラウザが「鳴っていない」と見なすことがある）
    osc.connect(gain); gain.connect(ctx.destination); osc.start(); KEEP.ctx=ctx; KEEP.osc=osc;
  }catch(e){}
}
const setTitle=t=>{ document.title=t?`${t} – ${BASE_TITLE}`:BASE_TITLE; };
// ---------- 勝率の集計と誤差の幅 ----------
// 同じ対戦カード（2編成の組）の試合は勝ちやすさが共通なので、独立した試合として数えると誤差の幅が狭く出すぎる
// （実測：1カード10試合だと、ばらつきは独立と見なしたときの約2.4倍）。そこでカード1つを1かたまりとして、かたまりごとの勝ち数のばらつきから幅を出す。
// stAdd(s,w,g)：カード1つぶん（w勝・g試合）を足す。moeX(s)：95%の誤差の幅（％・丸めない）。カードが少ないうちは独立と見なした幅（ciX）を下回らないようにする
const stNew=()=>({w:0,g:0,sww:0,swg:0,sgg:0,m:0});
const stAdd=(s,w,g)=>{ s.w+=w; s.g+=g; s.sww+=w*w; s.swg+=w*g; s.sgg+=g*g; s.m++; return s; };
function moeX(s){
  if(!s||!s.g) return Infinity;
  const b=ciX(s.w,s.g); if(s.m<2) return b;
  const p=s.w/s.g, ss=Math.max(0,s.sww-2*p*s.swg+p*p*s.sgg);
  return Math.max(b,196*Math.sqrt(ss*s.m/(s.m-1))/s.g);
}
// その結果を、その相手（キー）の成績に数えるか。目標の誤差つきの実行では、すでに目標に届いた相手には以降の試合を数えない（x.skip）
const cred=(x,k)=>!(x.skip&&x.skip.has(k));

// ---------- 目標の誤差（B.goal＝±何ポイント。0＝1周で終わり） ----------
// 誤差を見る相手：ランキング＝サーヴァント別（とマスター別）の平均勝率 ／ 特定の編成＝その編成の勝率 ／ マスターの強さ＝マスター別の勝率。
// 全員の誤差の幅が目標以下になるまで回す。回す順は完全なランダムではなく「まだ誤差が残っている相手が出る対戦」を、誤差が広い相手から優先する
// （出番の少ないキャラ＝色特化マスターなど＝を待って、もう収まったキャラの対戦を回し続けないため）。
// その周の対戦を使い切っても届かなければ、組を作り直して（plan()。相手の抽選もやり直す）誤差が残っている相手の対戦だけを足す。上限 GOAL_MAX_ROUNDS 周
const GOAL_MAX_ROUNDS=2000, GOAL_CHECK=20;
const DETAIL_MAX=150000; // 解析用の記録を残す試合数の上限（これを超えたぶんは集計だけして記録しない）。3対3だと1試合6行＝90万行で、表計算ソフトの上限（約104万行）に収まる。CSV は1試合あたり約0.8KB
const GOAL_RHO=.16; // 見込み用：カードごとの勝ちやすさの違いの大きさ（実測の割り増し 2.4倍 ÷ 9）
let GOAL_PRIORITY=true; // false＝優先せず完全にランダムな順で回す（比較用）
const maxWorkers=()=>Math.max(1,Math.min(6,(navigator.hardwareConcurrency||2)-1));
const goalCopies=len=>Math.max(1,Math.ceil(maxWorkers()/Math.max(1,len))); // 組が Worker の本数より少ないとき、同じ組を回す本数
const goalNeed=g=>Math.ceil((98/g)**2); // 勝率50%付近で ±g ポイントにするのに要る試合数
// 対戦1つが関わる「誤差を見る相手」のキー（u:サーヴァントID / m:マスターID / team）
function taskSubs(t,view){
  if(view==='team') return ['team'];
  if(view==='master') return ['m:'+t.tag.mi,'m:'+t.tag.mj];
  const out=[]; for(const tm of [t.ta,t.tb]){ tm.ids.forEach(id=>out.push('u:'+id)); if(tm.m) out.push('m:'+tm.m); } return [...new Set(out)];
}
const subName=k=>k==='team'?'検証する編成':k[0]==='u'?uNm(k.slice(2)):mOf(k.slice(2)).name;
// 目標までの試合数の見込み：全員が goalNeed 試合ずつ要る。1試合で進む人数（両陣営のサーヴァント／マスター）で割る
function goalEst(tasks,view,goal){
  // taskSubs と同じ数え方。対戦が数百万あるので、対戦ごとに配列を作らずに直接数える
  const us=new Set(), ms=new Set();
  if(view==='master') tasks.forEach(t=>{ ms.add(t.tag.mi); ms.add(t.tag.mj); });
  else if(view!=='team') for(const t of tasks) for(const tm of [t.ta,t.tb]){ for(const id of tm.ids) us.add(id); if(tm.m) ms.add(tm.m); }
  const nu=us.size, nm=ms.size, need=goalNeed(goal);
  const deff=1+(Math.max(1,B.n)-1)*GOAL_RHO; // 同じカードを B.n 試合ずつ回すぶんの割り増し
  return Math.ceil((view==='team'?need:Math.max(need*nu/(2*rs().partyMax),need*nm/2))*deff);
}
// いまの結果での、誤差を見る相手ごとの集計（キー → stAdd の集計）。すでに目標に届いた相手に数えない結果（x.skip）は除く
function goalStats(R){
  const st=new Map(), add=(x,k,w,g)=>{ if(!cred(x,k)) return; let a=st.get(k); if(!a) st.set(k,a=stNew()); stAdd(a,w,g); };
  for(const x of R.items){ const t=x.task, r=x.r, g=gOf(r), w=wOf(r); if(!g) continue;
    if(R.view==='team') add(x,'team',w,g);
    else if(R.view==='master'){ add(x,'m:'+t.tag.mi,w,g); add(x,'m:'+t.tag.mj,g-w,g); }
    else for(const [tm,ww] of [[t.ta,w],[t.tb,g-w]]){ tm.ids.forEach(id=>add(x,'u:'+id,ww,g)); if(tm.m) add(x,'m:'+tm.m,ww,g); } }
  return st;
}
// 同じ組の結果を足し合わせる（周回を重ねたぶん）
function mergeRes(a,b){ for(const k in b){ if(typeof b[k]==='number'&&k!=='aN') a[k]=(a[k]||0)+b[k]; else if(a[k]==null) a[k]=b[k]; } return a; }
function startRun(){
  const p=plan(); if(p.err){ toast(p.err,true); return; }
  stopRun();
  const goal=Number(B.goal)||0, view=B.view;
  let nextId=0;
  // 目標の誤差つきで組が少ないとき（直接対決など）は、同じ組を何本かに分けて並列に回す（結果は同じ組として足し合わせる）
  const mk=ts=>Array.from({length:goal?goalCopies(ts.length):1},()=>ts).flat().map(t=>({...t,id:nextId++,sw:Math.random()})).sort((a,b)=>a.sw-b.sw);
  const run={workers:[],queue:[],bySub:null,done:0,total:0,games:0,inflight:0,t0:Date.now(),byId:new Map(),round:1,goal,worst:null,lag:null,reached:new Set(),
    need:goal?[...new Set(p.tasks.flatMap(t=>taskSubs(t,view)))]:null};
  // その周の対戦を積む。目標つきのときは「相手ごとの対戦の山」（bySub）も作る
  const load=ts=>{ ts.forEach(t=>run.byId.set(t.id,t)); run.queue=ts.slice(); run.total+=ts.length;
    if(goal){ run.bySub=new Map(); ts.forEach(t=>taskSubs(t,view).forEach(k=>{ let a=run.bySub.get(k); if(!a) run.bySub.set(k,a=[]); a.push(t); })); } };
  load(mk(p.tasks));
  const nW=Math.max(1,Math.min(maxWorkers(),run.queue.length));
  B.run=run;
  B.res={goal,rounds:1,byKey:new Map(),view,rule:B.rule,src:B.src,n:B.n,k:B.k,filter:B.filter,opp:B.opp,level:B.level,handicap:useHandicap()&&B.view!=='master',vs:B.vs,mcol:{...B.mcol},cmin:B.cmin,
    data:B.data,items:[],log:B.detail?[]:null,logGames:0,done:false,teams:p.teams,excl:eu().length<B.data.units.length||em().length<B.data.masters.length};
  const R=B.res, hcap=R.handicap;
  // 次に回す対戦。目標つきで誤差の状況が分かっていれば、誤差が広い相手の対戦から。なければランダムな順のまま
  const next=()=>{
    if(goal&&run.lag&&GOAL_PRIORITY){ for(const k of run.lag){ const a=run.bySub.get(k); while(a&&a.length){ const t=a.pop(); if(!t.taken) return t; } } return null; }
    while(run.queue.length){ const t=run.queue.pop(); if(!t.taken) return t; }
    return null;
  };
  const feed=w=>{ const t=next(); if(!t){ w.idle=true; return false; } t.taken=true; w.idle=false; run.inflight++;
    w.postMessage({t:'task',id:t.id,rule:B.rule,A:{ids:t.ta.ids,m:t.ta.m},B:{ids:t.tb.ids,m:t.tb.m},n:B.n,handicap:hcap,level:B.level,detail:!!R.log&&R.logGames<DETAIL_MAX}); return true; };
  // 誤差の状況を確かめる：目標に届いた相手は reached に入れて成績を確定する（以降の試合は数えない。出番の少ない相手との対戦ばかりが後から混ざって勝率がずれるのを防ぐ）。
  // lag＝まだ届いていない相手（誤差が広い順。試合がまだない相手が先頭）。全員届いたら true
  const look=()=>{
    const st=goalStats(R), all=run.need.map(k=>({k,v:moeX(st.get(k))}));
    all.forEach(x=>{ if(x.v<=goal) run.reached.add(x.k); });
    const lag=all.filter(x=>!run.reached.has(x.k)).sort((a,b)=>b.v-a.v), top=(lag.length?lag:all.slice().sort((a,b)=>b.v-a.v))[0];
    run.worst=R.worst=top?{v:top.v,name:subName(top.k)}:{v:Infinity,name:''}; run.lag=lag.map(x=>x.k); run.left=R.left=lag.length; R.subjects=all.length;
    return !lag.length;
  };
  // 回せる対戦がなくなった：目標つきなら、誤差が残っている相手の対戦だけを作り直して足す
  const nextRound=()=>{
    if(!goal){ R.hit=true; finish(); return; }
    if(run.round>=GOAL_MAX_ROUNDS){ R.hit=false; finish(); return; }
    const p2=plan(), lag=new Set(run.lag), ts=p2.err?[]:p2.tasks.filter(t=>!GOAL_PRIORITY||taskSubs(t,view).some(k=>lag.has(k)));
    if(!ts.length){ R.hit=false; finish(); return; }
    run.round++; R.rounds=run.round; load(mk(ts)); run.workers.forEach(feed);
  };
  const fail=msg=>{ stopRun(); renderProg(); toast(`検証中にエラー：${msg}`,true); };
  for(let i=0;i<nW;i++){
    let w;
    try{ w=new Worker(`js/balance-worker.js?v=${Date.now()}`); }catch(e){ fail('Worker を開始できませんでした（ローカルサーバーで開いてください）'); return; }
    run.workers.push(w);
    w.onmessage=e=>{
      if(B.run!==run) return;
      const m=e.data;
      if(m.t==='ready') feed(w);
      else if(m.t==='res'){
        // 解析用の1試合ごとの記録は別に貯める（集計の足し合わせには混ぜない）
        if(m.r.games){ if(R.log){ R.log.push({task:run.byId.get(m.id),games:m.r.games}); R.logGames+=m.r.games.length; } delete m.r.games; }
        // すでに目標に届いた相手には数えない（skip）。同じ組・同じ skip の結果は足し合わせる
        const t=run.byId.get(m.id), skip=goal&&run.reached.size?taskSubs(t,view).filter(k=>run.reached.has(k)).sort():[];
        const key=t.ta.key+'|'+t.tb.key+(skip.length?'#'+skip.join(','):''), it=R.byKey.get(key);
        if(it) mergeRes(it.r,m.r); else{ const x={task:t,r:m.r,skip:skip.length?new Set(skip):null}; R.byKey.set(key,x); R.items.push(x); }
        run.done++; run.inflight--; run.games+=m.r.n; schedule();
        // 目標の誤差：GOAL_CHECK 対戦ごとに確かめ、全員が届いた時点で止める
        if(goal&&run.done%GOAL_CHECK===0&&look()){ R.hit=true; finish(); return; }
        if(!feed(w)){
          if(goal&&look()){ R.hit=true; finish(); return; } // 回せる対戦がない：最新の状況で確かめ直す
          if(!feed(w)&&run.inflight===0){ nextRound(); return; }
        }
        run.workers.forEach(x=>{ if(x.idle) feed(x); });
      }
      else if(m.t==='error') fail(m.msg);
    };
    w.onerror=e=>{ e.preventDefault(); fail(`${e.message||'Worker の読み込みに失敗'}（ローカルサーバーで開いてください）`); };
    w.postMessage({t:'init',units:B.data.units,masters:B.data.masters});
  }
  keepAwake(true);
  renderProg(); renderRes(); renderCtl();
}
function finish(){ B.res.ms=Date.now()-B.run.t0; B.res.done=true; stopRun(); renderProg(); renderRes(); renderCtl(); setTitle('✔ 完了'); }
let pending=false;
function schedule(){ if(pending) return; pending=true; setTimeout(()=>{ pending=false; renderProg(); renderRes(); },250); }

// ---------- 画面：操作部 ----------
const seg=(key,opts,cur)=>`<div class="seg">${opts.map(([v,l])=>`<button class="${v===cur?'on':''}" data-b="set" data-k="${key}" data-v="${esc(v)}" ${B.run?'disabled':''}>${l}</button>`).join('')}</div>`;
const sel=(key,opts,cur,label,extra='')=>`<label ${extra}>${label}<select data-s="${key}" ${B.run?'disabled':''}>${opts.map(([v,l])=>`<option value="${esc(v)}" ${String(v)===String(cur)?'selected':''}>${l}</option>`).join('')}</select></label>`;

// 画面の見込み（対戦数など）用の plan()。マスターチームは編成を並べるだけで1秒ほどかかるので、
// 組み合わせに関わる設定が変わったときだけ作り直す（試合数・CPUの強さなどを変えただけなら前の結果を使う）
let planMemo={key:'',p:null};
function planForView(){
  const key=JSON.stringify([B.dataVer,B.rule,B.view,B.filter,B.opp,B.k,B.sv,B.vs,B.A,B.B,[...B.excl],[...B.mexcl],B.mcol,B.cmin]);
  if(planMemo.key!==key) planMemo={key,p:plan()};
  return planMemo.p;
}
function renderCtl(){
  const d=B.data, dis=B.run?'disabled':'', m=hasMaster(), team=rs().partyMax>1;
  const views=[['rank','編成の勝率ランキング'],['team','特定の編成の戦績'],...(m?[['master','マスターの強さ']]:[])];
  if(!views.some(v=>v[0]===B.view)) B.view='rank';
  const p=planForView(), goal=Number(B.goal)||0, games=p.tasks.length*B.n, est=goal&&!p.err?goalEst(p.tasks,B.view,goal):0;
  const goalWho={rank:hasMaster()?'サーヴァント別・マスター別の平均勝率':'サーヴァント別の平均勝率',team:'検証する編成の勝率',master:'マスター別の勝率'}[B.view];
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
        ${sel('n',[[2,'2試合（先攻・後攻1回ずつ）'],[10,'10試合'],[20,'20試合'],[50,'50試合'],[100,'100試合'],[300,'300試合']],B.n,Number(B.goal)?'1対戦あたり（1周ぶん）':'1対戦あたり')}
        ${sel('goal',[[0,'指定しない（1周で終わる）'],[5,'±5%'],[3,'±3%'],[2,'±2%'],[1,'±1%']],B.goal,'目標の誤差（届くまで繰り返す）')}
        ${sel('level',[['normal','ふつう'],['hard','つよい（先読みなし・速い）'],['hard+','つよい（先読みあり・遅い）']],B.level,'CPUの強さ')}
        ${rs().handicapAsc&&B.view!=='master'?`<label class="chk"><input type="checkbox" data-s="handicap" ${B.handicap?'checked':''} ${dis}>ハンデ戦（${hcapRuleText(rs()).replace(/。$/,'')}）</label>`:''}
      </div>
      <div class="opts"><label class="chk"><input type="checkbox" data-s="detail" ${B.detail?'checked':''} ${dis}>解析用のデータを記録する（実行後に「キャラ別の内訳」と CSV・要約の保存が使えます）</label>
        <label class="chk"><input type="checkbox" data-s="bg" ${B.bg?'checked':''} ${dis}>タブを裏にしても回し続ける（実行中だけ、聞こえない大きさの音を鳴らします）</label></div>
      ${needTeam?`<div class="seg">${[['pool','全編成と対戦'],['duel','2つの編成の直接対決']].map(([v,l])=>`<button class="${B.vs===v?'on':''}" data-b="set" data-k="vs" data-v="${v}" ${dis}>${l}</button>`).join('')}</div>
        ${builderHTML('A',B.vs==='duel'?'チームA':'検証する編成')}${B.vs==='duel'?builderHTML('B','チームB'):''}`:''}
      ${m&&team?mcolHTML():''}
      ${exclHTML()}
    </section>
    <section class="card"><div class="runbar">
      ${B.run?`<button class="danger" data-b="stop">中止</button>`:`<button class="primary" data-b="run" ${p.err?'disabled':''}>検証を実行</button>`}
      <span class="est">${p.err?`<span class="bad">${esc(p.err)}</span>`:`${p.tasks.length}対戦 × ${B.n}試合 ＝ <b>${games.toLocaleString()}試合</b>${goal?` → 目標まで 約<b>${est.toLocaleString()}試合</b>`:''}${p.teams&&B.view!=='master'?`（対象の編成 ${p.teams}）`:''}　目安 ${etaText(goal?est:games)}${p.skip&&p.skip.length?` <span class="bad small">（条件に合う編成がなく除外：${p.skip.length}組）</span>`:''}`}</span></div>
      ${goal?`<p class="note">${goalWho}の誤差がすべて <b>±${goal}%</b> 以下になったら止まります（1人あたり約${goalNeed(goal).toLocaleString()}試合が目安）。まだ誤差が残っているキャラが出る対戦を優先して回し、目標に届いたキャラの成績はその時点で確定します（以降の試合は数えません）。${B.n>2?'「1対戦あたり」を<b>2試合</b>にすると、同じ精度に要る試合数が半分ほどになります（同じカードを何試合も回すより、いろいろなカードを回す方が誤差が早く縮みます）。':''}調整の前後を比べるときは、前後とも同じ目標で回してください（差の誤差は約1.4倍になります）。</p>`:''}
      <p class="note">同じ条件でも結果は少しぶれます（±は95%の誤差の幅）。ブラウザのタブを開いたままにしてください。</p></section>`;
}
// 目安の時間：1本あたり毎秒250試合ほど。先読みありのチーム戦は1試合が約40倍かかる（実測：6本で毎秒25試合ほど。1対1は攻撃対象が1体で先読みが走らないので変わらない）
function etaText(games){ const slow=B.level==='hard+'&&rs().partyMax>1?40:1, s=games*slow/(250*Math.max(1,Math.min(6,(navigator.hardwareConcurrency||2)-1))); return s<90?`${Math.max(1,Math.round(s))}秒`:`${Math.round(s/60)}分`; }

function builderHTML(key,label){
  const T=B[key], max=rs().partyMax, cap=capOf(), U=eu(), dis=B.run?'disabled':'';
  const mc=T.m?mOf(T.m).cost:0, cost=T.ids.reduce((s,id)=>s+uOf(id).cost,0)+mc;
  return `<div class="bld"><b>${label}</b>
    <div class="chips mt">${B.data.units.filter(u=>u.id).map(u=>{
      const on=T.ids.includes(u.id), over=!on&&max>1&&cost+u.cost>cap, full=!on&&max>1&&T.ids.length>=max;
      return `<button class="chip ${on?'on':''} ${B.excl.has(u.id)?'off':''}" data-b="bld" data-k="${key}" data-id="${esc(u.id)}" ${dis||over||full?'disabled':''}>${esc(uNm(u.id))}<span class="sub small">C${u.cost}</span></button>`; }).join('')}</div>
    ${hasMaster()?`<div class="row mt"><label class="sub small">マスター <select data-s="bm" data-k="${key}" ${dis}><option value="">（選んでください）</option>${B.data.masters.map(m=>`<option value="${esc(m.id)}" ${T.m===m.id?'selected':''}>${esc(m.name)}（C${m.cost}）</option>`).join('')}</select></label></div>`:''}
    <div class="cost">${max>1?`合計コスト <b class="${cost>cap?'bad':''}">${cost}</b> / ${cap}${hasMaster()?'（マスター込み）':''}　`:`コスト ${cost}　`}<button class="small" data-b="bldClear" data-k="${key}" ${dis}>クリア</button>
      ${max>1?`<button class="small" data-b="bldRandom" data-k="${key}" ${dis}>ランダム</button>`:''}</div></div>`;
}
// 色特化マスター：指定したマスターが出る対戦は、その色の面が編成の合計で cmin 以上のサーヴァント編成でだけ検証する
function mcolHTML(){
  const dis=B.run?'disabled':'', n=em().filter(m=>B.mcol[m.id]).length;
  return `<details class="excl"><summary>色特化マスターの指定　<span class="sub small">${n?`${n}人を指定中`:'なし'}</span></summary>
    <p class="note">色を指定したマスターは、サーヴァント編成のその色の面が合計で下の数以上のものとだけ組み合わせます（ランキング・特定の編成の相手・マスターの強さのすべてに効きます）。「マスターの強さ」では両陣営で共通の編成を使うので、2人とも指定がある対戦はどちらかの条件を満たす編成を使います。</p>
    <div class="opts">${sel('cmin',[5,6,7,8,9,10,11,12].map(n=>[n,`${n}面以上`]),B.cmin,'色の面（編成の合計）')}</div>
    <div class="opts mt">${em().map(m=>sel('mcol:'+m.id,[['','指定なし'],...['R','B','G'].map(c=>[c,TERMS[c]+'特化'])],B.mcol[m.id]||'',`${esc(m.name)} <span class="sub small">C${m.cost}</span>`)).join('')}</div></details>`;
}
function exclHTML(){
  const n=B.data.units.filter(u=>B.excl.has(u.id)).length, nm=B.data.masters.filter(m=>B.mexcl.has(m.id)).length, dis=B.run?'disabled':'';
  return `<details class="excl"><summary>検証から外す　<span class="sub small">${n||nm?`サーヴァント${n}体${hasMaster()?`・マスター${nm}人`:''}を除外中`:'なし'}</span></summary>
    <p class="note">外したキャラは、編成の組み合わせ・相手・マスター比較に使いません（エディタのバランス検証と共有）。</p>
    <div class="row"><button class="small" data-b="exclNone" ${dis}>すべて戻す</button></div>
    <div class="chips mt">${B.data.units.filter(u=>u.id).map(u=>`<button class="chip ${B.excl.has(u.id)?'off':''}" data-b="excl" data-id="${esc(u.id)}" ${dis}>${esc(uNm(u.id))}<span class="sub small">C${u.cost}</span></button>`).join('')}</div>
    ${hasMaster()?`<div class="chips mt">${B.data.masters.filter(m=>m.id).map(m=>`<button class="chip ${B.mexcl.has(m.id)?'off':''}" data-b="mexcl" data-id="${esc(m.id)}" ${dis}>${esc(m.name)}<span class="sub small">C${m.cost}</span></button>`).join('')}</div>`:''}</details>`;
}

function renderProg(){
  const r=B.run; if(!r){ $('#prog').innerHTML=''; return; }
  setTitle(r.goal?`${r.need.length-(r.lag?r.left:r.need.length)}/${r.need.length} 検証中`:`${Math.round(r.done/Math.max(1,r.total)*100)}% 検証中`);
  const el=(Date.now()-r.t0)/1000, eta=r.done?el/r.done*(r.total-r.done):0;
  if(r.goal){ // 目標の誤差つき：届いた人数と、いちばん広い誤差
    const w=r.worst, n=r.need.length, left=r.lag?r.left:n, wt=w&&isFinite(w.v)?`いちばん広い誤差 ±${w.v.toFixed(1)}%（${esc(w.name)}）`:'';
    $('#prog').innerHTML=`<div class="progbar"><i style="width:${(n-left)/Math.max(1,n)*100}%"></i><span>目標 ±${r.goal}% に到達 ${n-left} / ${n}　${r.games.toLocaleString()}試合　${wt}（経過${el<90?Math.round(el)+'秒':Math.round(el/60)+'分'}）</span></div>`;
    return;
  }
  $('#prog').innerHTML=`<div class="progbar"><i style="width:${r.done/r.total*100}%"></i><span>${r.done} / ${r.total} 対戦${r.done?`（残り約${eta<90?Math.round(eta)+'秒':Math.round(eta/60)+'分'}）`:''}</span></div>`;
}

// ---------- 画面：結果 ----------
function renderRes(){
  const R=B.res; if(!R){ $('#res').innerHTML='<section class="card"><p class="sub small nm">条件を選んで「検証を実行」を押してください。</p></section>'; return; }
  if(!R.items.length){ $('#res').innerHTML='<section class="card"><p class="sub small nm">集計中…</p></section>'; return; }
  const errs=R.items.reduce((s,x)=>s+x.r.errors,0), msg=(R.items.find(x=>x.r.errMsg)||{r:{}}).r.errMsg;
  const cond=[`${RULESETS[R.rule].name}`,`データ：${BSRC[R.src]}`,R.goal?`1対戦${R.n}試合ずつ・計${R.items.reduce((s,x)=>s+x.r.n,0).toLocaleString()}試合`:`1対戦${R.n}試合`,
    ...(R.goal?[R.done?(R.hit?`目標 ±${R.goal}% に到達（いちばん広い誤差 ±${R.worst.v.toFixed(1)}%）`:`目標 ±${R.goal}% に未到達（あと${R.left||0}人。いちばん広い誤差 ±${R.worst&&isFinite(R.worst.v)?R.worst.v.toFixed(1):'-'}%）`):`目標 ±${R.goal}%`]:[]),`CPU：${R.level==='hard+'?'つよい（先読みあり）':R.level==='hard'?'つよい（先読みなし）':'ふつう'}`,
    ...(Object.keys(R.mcol||{}).length?[`色特化マスターあり（${R.cmin}面以上）`]:[]),
    ...(RULESETS[R.rule].handicapAsc&&R.view!=='master'?[`ハンデ${R.handicap?'あり':'なし'}`]:[]),...(R.excl?['除外あり']:[]),
    R.done?`${(R.ms/1000).toFixed(1)}秒`:R.stopped?'中止（途中までの結果）':'実行中'].join(' ／ ');
  const body=R.view==='master'?resMaster(R):R.view==='team'?resTeam(R):resRank(R);
  $('#res').innerHTML=`<section class="card"><h2>結果 <small class="sub">${esc(cond)}</small></h2>${body}${R.log&&R.log.length&&(R.done||R.stopped)?resDetail(R):''}
    ${errs?`<p class="bad small">⚠ ${errs}試合でエラーが起きました：${esc(msg||'')}</p>`:''}
    <p class="note">色は勝率の目安です（50%が互角）：<span class="ok">40〜60%</span> ／ <span class="wrn">30〜70%</span> ／ <span class="bad">それより外</span>。±は95%の誤差の幅です（対戦カードごとの勝ちやすさの違いを含めて計算しています）。</p></section>`;
}
// ---------- 解析用のデータ（1試合ごとの記録 R.log）：キャラ別の内訳と CSV ----------
// 記録の形は sim.js の simMatchup(…,detail)：games=[{w:Aの勝ち1/負け0/引分null, f:Aが先攻なら1, t:ターン数, u:[Aのキャラ, Bのキャラ], c:[Aのチェイン, Bのチェイン]}]
// キャラ1体の記録は DET の順の配列（sim.js の SIM_UCOLS と同じ並び）
const DET={id:0,dealt:1,taken:2,maxHit:3,kills:4,attacks:5,crits:6,ults:7,skills:8,blocked:9,ascT:10,koT:11,hp:12};
// 記録を1行ずつたどる：fn({task, g, side:0=A/1=B, tm:その側の編成, op:相手の編成, win:1/0/.5, first, u:キャラの記録, slot, team:その側のキャラ全員, chain})
function eachDetail(R,fn){
  let gi=0;
  for(const {task,games} of R.log) for(const g of games){ gi++;
    for(const side of [0,1]){ const tm=side?task.tb:task.ta, op=side?task.ta:task.tb, win=g.w==null?.5:(side?1-g.w:g.w), first=side?1-g.f:g.f;
      g.u[side].forEach((u,slot)=>fn({task,g,gi,side,tm,op,win,first,u,slot,team:g.u[side],chain:g.c[side]})); } }
}
function resDetail(R){
  const m=new Map();
  eachDetail(R,x=>{ const u=x.u, id=u[DET.id]; let a=m.get(id);
    if(!a) m.set(id,a={n:0,w:0,dealt:0,share:0,taken:0,kills:0,attacks:0,crits:0,ults:0,ultsW:0,ultsL:0,nW:0,nL:0,skills:0,blocked:0,asc:0,ascT:0,ko:0,koT:0,first:0,firstW:0});
    const tot=x.team.reduce((s,v)=>s+v[DET.dealt],0);
    a.n++; a.w+=x.win; a.dealt+=u[DET.dealt]; a.share+=tot?u[DET.dealt]/tot:0; a.taken+=u[DET.taken]; a.kills+=u[DET.kills]; a.attacks+=u[DET.attacks]; a.crits+=u[DET.crits];
    a.ults+=u[DET.ults]; a.skills+=u[DET.skills]; a.blocked+=u[DET.blocked];
    if(x.win===1){ a.nW++; a.ultsW+=u[DET.ults]; } else if(x.win===0){ a.nL++; a.ultsL+=u[DET.ults]; }
    if(u[DET.ascT]!=null){ a.asc++; a.ascT+=u[DET.ascT]; } if(u[DET.koT]!=null){ a.ko++; a.koT+=u[DET.koT]; }
    if(x.first){ a.first++; a.firstW+=x.win; } });
  const rows=[...m.entries()].sort((a,b)=>b[1].w/b[1].n-a[1].w/a[1].n), f1=v=>v.toFixed(1), f2=v=>v.toFixed(2), solo=RULESETS[R.rule].partyMax===1;
  const th=(t,tip)=>`<th title="${tip}">${t}</th>`;
  return `<h3>キャラ別の内訳（解析用の記録 ${R.logGames.toLocaleString()}試合ぶん）</h3>
    <div class="row"><button class="small" data-b="csv">CSV を保存（1キャラ1行）</button><span class="sub small">表計算ソフトで開けます（${(R.logGames*RULESETS[R.rule].partyMax*2).toLocaleString()}行）。列の説明は表の見出しにマウスを乗せると出ます。</span></div>
    <div class="row"><button class="small" data-b="sum">要約を保存（Markdown）</button><span class="sub small">AI に渡せる大きさ（数十KB）にまとめたもの：キャラ別の成績とコスト内での強さ、外れ値、並び順、相性のよい／わるい組、対面。</span></div>
    <div class="tbl mt"><table class="stats"><thead><tr><th>#</th><th>名前</th>${th('勝率','このキャラがいた側が勝った割合（記録した全試合。目標の誤差つきの実行では、上の表と少し違うことがあります）')}${th('先攻時','このキャラの側が先攻だった試合の勝率')}
      ${th('与ダメ','1試合あたりの与ダメージ')}${solo?'':th('チーム内','味方全員の与ダメージに占める割合')}${th('被ダメ','1試合あたりの被ダメージ')}${th('撃破','1試合あたりに倒した数')}${th('クリ率','攻撃のうちクリティカルになった割合')}
      ${th('宝具','1試合あたりの宝具の回数')}${th('勝ち｜負け','勝った試合と負けた試合それぞれの、1試合あたりの宝具の回数')}${th('スキル','1試合あたりのスキルの回数')}${th('防いだ','1試合あたりに回避・無敵などで攻撃を防いだ回数')}
      ${th('再臨','再臨できた試合の割合と、再臨した平均ターン')}${th(TERMS.out,'戦闘不能になった試合の割合と、その平均ターン')}</tr></thead><tbody>${rows.map(([id,a],i)=>{ const n=a.n;
      return `<tr class="${grade(a.w/n)}"><td class="num">${i+1}</td><td>${esc(uNm(id))} <span class="sub small">C${uOf(id).cost}</span></td><td class="num rate"><b>${pct(a.w/n)}</b></td><td class="num">${a.first?pct(a.firstW/a.first):'-'}</td>
        <td class="num">${Math.round(a.dealt/n)}</td>${solo?'':`<td class="num">${pct(a.share/n)}</td>`}<td class="num">${Math.round(a.taken/n)}</td><td class="num">${f2(a.kills/n)}</td><td class="num">${a.attacks?pct(a.crits/a.attacks):'-'}</td>
        <td class="num">${f2(a.ults/n)}</td><td class="num">${a.nW?f2(a.ultsW/a.nW):'-'}｜${a.nL?f2(a.ultsL/a.nL):'-'}</td><td class="num">${f2(a.skills/n)}</td><td class="num">${f2(a.blocked/n)}</td>
        <td class="num">${pct(a.asc/n)} <span class="sub small">${a.asc?f1(a.ascT/a.asc)+'T':''}</span></td><td class="num">${pct(a.ko/n)} <span class="sub small">${a.ko?f1(a.koT/a.ko)+'T':''}</span></td></tr>`; }).join('')}</tbody></table></div>
    <p class="note">数字は「そのキャラがいた試合」の平均です。強さの理由の手がかりで、原因そのものではありません（強い味方と組んだぶんも混ざります）。</p>`;
}
const levelName=R=>R.level==='hard+'?'つよい（先読みあり）':R.level==='hard'?'つよい（先読みなし）':'ふつう';
// CSV：1試合の1キャラを1行に（Excel で文字化けしないよう BOM つき UTF-8）
function detailCSV(R){
  const q=v=>{ v=v==null?'':String(v); return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v; };
  const names=t=>t.ids.map(id=>uNm(id)).join('・'), lv=levelName(R);
  const head=['試合番号','ルール','CPU','ターン数','勝ち','先攻','側','キャラID','キャラ名','コスト','並び順','味方の編成','味方のマスター','相手の編成','相手のマスター',
    '与ダメージ','チームの与ダメージ','被ダメージ','最大ダメージ','撃破数','攻撃回数','クリティカル回数','宝具回数','スキル回数','防いだ回数','再臨したターン','戦闘不能になったターン','残りHP',
    'チェインBuster','チェインArts','チェインQuick','ブレイブチェイン'];
  const out=[head.join(',')];
  eachDetail(R,x=>{ const u=x.u, d=uOf(u[DET.id]);
    out.push([x.gi,RULESETS[R.rule].name,lv,x.g.t,x.win,x.first,x.side?'B':'A',u[DET.id],d.name,d.cost,x.slot+1,names(x.tm),x.tm.m?mOf(x.tm.m).name:'',names(x.op),x.op.m?mOf(x.op.m).name:'',
      u[DET.dealt],x.team.reduce((s,v)=>s+v[DET.dealt],0),u[DET.taken],u[DET.maxHit],u[DET.kills],u[DET.attacks],u[DET.crits],u[DET.ults],u[DET.skills],u[DET.blocked],u[DET.ascT],u[DET.koT],u[DET.hp],...x.chain].map(q).join(',')); });
  return '\ufeff'+out.join('\r\n');
}
// 要約（Markdown）：CSV と同じ記録を js/rank-summary.js に流す（tools/rank-summary.js で CSV から作るのと同じ中身）
function detailSummary(R,file){
  const S=rankSummary(), rule=RULESETS[R.rule].name, lv=levelName(R);
  eachDetail(R,x=>{ const u=x.u, d=uOf(u[DET.id]);
    S.add({match:x.gi,rule,cpu:lv,turns:x.g.t,win:x.win,first:!!x.first,side:x.side?'B':'A',id:u[DET.id],name:d.name,cost:d.cost,master:x.tm.m?mOf(x.tm.m).name:'',
      dmg:u[DET.dealt],team:x.team.reduce((s,v)=>s+v[DET.dealt],0),taken:u[DET.taken],maxd:u[DET.maxHit],ko:u[DET.kills],atk:u[DET.attacks],crit:u[DET.crits],np:u[DET.ults],skill:u[DET.skills],block:u[DET.blocked],
      asc:u[DET.ascT],out:u[DET.koT],hp:u[DET.hp]}); });
  return S.text(`バランスラボ（${file}）`);
}
function saveDetail(kind){
  const R=B.res; if(!R||!R.log||!R.log.length) return;
  const d=new Date(), p=n=>String(n).padStart(2,'0'), base=`pensaba-${R.rule}-${R.view}-${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  const name=kind==='sum'?base+'-summary.md':base+'.csv';
  const blob=kind==='sum'?new Blob([detailSummary(R,base)],{type:'text/markdown'}):new Blob([detailCSV(R)],{type:'text/csv'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),10000);
  toast(`${name} を保存しました`);
}
const gOf=r=>r.n-r.errors, wOf=r=>r.win+r.draw/2;
function addTo(map,key,w,g,r,extra){ const s=map.get(key)||{...stNew(),turns:0,games:0,x:extra}; stAdd(s,w,g); s.turns+=r.turns; s.games++; map.set(key,s); return s; }
// 勝率と±。st（stAdd で貯めた集計）があれば、対戦カードごとのばらつきを含めた幅（moeX）で出す
const rateCell=(w,g,st)=>g?`<b>${pct(w/g)}</b> <span class="sub small">±${st?Math.round(moeX(st)):ci(w/g,g)}</span>`:'-';
const rowCls=(w,g)=>g?grade(w/g):'';

// ---------- 単体の強さ（味方・相手の強さを差し引いた値） ----------
// キャラ別の平均勝率は「強い味方と組んだ」「弱い相手に当たった」ぶんも混ざる。そこで全対戦をまとめて
//   A側が勝つ確率 ＝ σ( A側のキャラの強さの合計 − B側のキャラの強さの合計 )   （σ＝ロジスティック関数。マスターも1人のキャラとして入れる）
// に当てはめ、キャラごとの強さ b を一度に求める（ロジスティック回帰。チーム戦の Bradley–Terry モデル）。
// 表示は σ(b)＝「ほかが全員平均的なとき、このキャラ1体の差で勝率が何%になるか」。50%＝平均的（同じ合計コスト同士の対戦ならコスト相応）。
// - 解き方：ニュートン法。強さの平均は決まらない（全員に同じ数を足しても同じ）ので、弱いリッジ（STR_RIDGE）で0の近くに寄せ、最後にサーヴァント／マスターそれぞれの平均を0にそろえる
// - ±：対戦カードを1かたまりとしたサンドイッチ分散（カードごとの勝ちやすさの違いを含む。moeX と同じ考え方）
// - 対戦の選び方（誤差が残るキャラの優先・目標に届いたキャラの確定）の影響を受けない：誰と組み誰と戦ったかを式に入れているので、R.items を全部使ってよい
const STR_RIDGE=.5;
function matInv(A){ // n×n の逆行列（掃き出し法）。解けなければ null
  const n=A.length, M=A.map((r,i)=>[...r,...Array.from({length:n},(_,j)=>i===j?1:0)]);
  for(let c=0;c<n;c++){
    let p=c; for(let r=c+1;r<n;r++) if(Math.abs(M[r][c])>Math.abs(M[p][c])) p=r;
    if(Math.abs(M[p][c])<1e-12) return null;
    [M[c],M[p]]=[M[p],M[c]];
    const d=M[c][c]; for(let j=c;j<2*n;j++) M[c][j]/=d;
    for(let r=0;r<n;r++){ if(r===c) continue; const f=M[r][c]; if(!f) continue; for(let j=c;j<2*n;j++) M[r][j]-=f*M[c][j]; }
  }
  return M.map(r=>r.slice(n));
}
// items=[{task:{ta,tb}, r}] から強さを求める。戻り値：Map(キー 'u:ID' / 'm:ID' → {b, p:σ(b), moe:±%（丸めない）})。当てはめられないときは null
function fitStrength(items){
  const idx=new Map(), keys=[], col=k=>{ let i=idx.get(k); if(i==null){ i=keys.length; idx.set(k,i); keys.push(k); } return i; }, rows=[];
  for(const {task:t,r} of items){ const g=gOf(r), w=wOf(r); if(!g) continue;
    const x=new Map(), add=(k,v)=>x.set(k,(x.get(k)||0)+v);
    t.ta.ids.forEach(id=>add('u:'+id,1)); t.tb.ids.forEach(id=>add('u:'+id,-1)); if(t.ta.m) add('m:'+t.ta.m,1); if(t.tb.m) add('m:'+t.tb.m,-1);
    const f=[...x].filter(([,v])=>v).map(([k,v])=>[col(k),v]); // 両陣営にいるキャラは打ち消し合うので式に入らない
    if(f.length) rows.push({f,w,g}); }
  const n=keys.length; if(n<2||rows.length<n) return null;
  const b=new Array(n).fill(0), sig=z=>1/(1+Math.exp(-z)), zOf=row=>row.f.reduce((s,[i,v])=>s+v*b[i],0);
  let Hinv=null;
  for(let it=0;it<30;it++){
    const grad=b.map(v=>-STR_RIDGE*v), H=Array.from({length:n},(_,i)=>{ const r=new Array(n).fill(0); r[i]=STR_RIDGE; return r; });
    for(const row of rows){ const p=sig(zOf(row)), e=row.w-row.g*p, h=row.g*p*(1-p);
      for(const [i,vi] of row.f){ grad[i]+=vi*e; for(const [j,vj] of row.f) H[i][j]+=h*vi*vj; } }
    Hinv=matInv(H); if(!Hinv) return null;
    let mx=0; for(let i=0;i<n;i++){ let d=0; for(let j=0;j<n;j++) d+=Hinv[i][j]*grad[j]; d=Math.max(-2,Math.min(2,d)); b[i]+=d; mx=Math.max(mx,Math.abs(d)); }
    if(mx<1e-7) break;
  }
  // サンドイッチ分散：V = H⁻¹ (Σ s sᵀ) H⁻¹、s＝カードごとの「勝ち数 − 見込み」×キャラの向き。対角だけ要る → Σ (H⁻¹ s)_i²
  const v=new Array(n).fill(0);
  for(const row of rows){ const e=row.w-row.g*sig(zOf(row)); for(let i=0;i<n;i++){ let a=0; for(const [j,vj] of row.f) a+=Hinv[i][j]*vj; v[i]+=a*a*e*e; } }
  const m=rows.length, adj=m>n?m/(m-n):1, out=new Map();
  for(const g of ['u','m']){ const is=keys.map((k,i)=>k[0]===g?i:-1).filter(i=>i>=0); if(!is.length) continue;
    const mean=is.reduce((s,i)=>s+b[i],0)/is.length;
    is.forEach(i=>{ const bb=b[i]-mean, p=sig(bb); out.set(keys[i],{b:bb,p,moe:196*p*(1-p)*Math.sqrt(v[i]*adj)}); }); }
  return out;
}
function strengthHTML(R,unitW,mW){
  if(!(R.done||R.stopped)) return '<p class="note">「単体の強さ」は実行が終わると表示されます。</p>';
  const fit=fitStrength(R.items); if(!fit) return '';
  const tbl=(title,pre,raw,nameOf,costOf)=>{
    const rows=[...fit.entries()].filter(([k])=>k[0]===pre).map(([k,x])=>({id:k.slice(2),...x})).sort((a,b)=>b.p-a.p); if(!rows.length) return '';
    return `<div><h3>${title}</h3><div class="tbl"><table class="stats"><thead><tr><th>#</th><th>名前</th><th title="ほかが全員平均的なとき、このキャラ1体の差で勝率が何%になるか（50%＝平均的）">単体の強さ</th><th></th><th title="上の表の、そのキャラを含む編成の平均勝率">平均勝率</th><th title="平均勝率 − 単体の強さ。プラスなら味方や相手に恵まれていたぶん、マイナスなら足を引っぱられていたぶん">差</th></tr></thead><tbody>${rows.map((x,i)=>{
      const s=raw.get(x.id), rp=s&&s.g?s.w/s.g:null, d=rp==null?null:Math.round((rp-x.p)*100);
      return `<tr class="${grade(x.p)}"><td class="num">${i+1}</td><td>${esc(nameOf(x.id))} <span class="sub small">C${costOf(x.id)}</span></td><td class="num rate"><b>${pct(x.p)}</b> <span class="sub small">±${Math.round(x.moe)}</span></td><td>${bar(x.p)}</td><td class="num">${rp==null?'-':pct(rp)}</td><td class="num">${d==null?'-':(d>0?'+':'')+d}</td></tr>`; }).join('')}</tbody></table></div></div>`; };
  return `<div class="grid">${tbl('サーヴァント単体の強さ','u',unitW,id=>uNm(id),id=>uOf(id).cost)}${hasMaster()?tbl('マスター単体の強さ','m',mW,id=>mOf(id).name,id=>mOf(id).cost):''}</div>
    <p class="note">「単体の強さ」は、味方と相手の強さを差し引いたそのキャラだけの強さです。全対戦をまとめて「両陣営のキャラの強さの差で勝敗が決まる」という式に当てはめて求めています。50%が平均的で、${R.opp==='same'?'同じ合計コスト同士の対戦なので「50%＝コスト相応」と読めます。':'相手の範囲が「すべて」なので、コストの高いキャラほど高く出ます。'}組み合わせの相性（特定の味方と組んだときだけ強い、など）は式に入っていないので、平均としての強さです。</p>`;
}

function resRank(R){
  const teams=new Map(), unitW=new Map(), mW=new Map(), cell=new Map();
  for(const x of R.items){
    const t=x.task, r=x.r, g=gOf(r), w=wOf(r); if(!g) continue;
    for(const [tm,ww] of [[t.ta,w],[t.tb,g-w]]){
      const s=addTo(teams,tm.key,ww,g,r); s.t=tm;
      tm.ids.forEach(id=>{ if(cred(x,'u:'+id)) addTo(unitW,id,ww,g,r); }); if(tm.m&&cred(x,'m:'+tm.m)) addTo(mW,tm.m,ww,g,r);
    }
    for(const [k,ww] of [[t.ta.key+'|'+t.tb.key,w],[t.tb.key+'|'+t.ta.key,g-w]]){ const c=cell.get(k)||{w:0,g:0}; c.w+=ww; c.g+=g; cell.set(k,c); }
  }
  const rows=[...teams.values()].sort((a,b)=>b.w/b.g-a.w/a.g);
  const tbl=`<div class="tbl"><table class="stats"><thead><tr><th>#</th><th>編成</th><th>勝率</th><th></th><th>対戦数</th><th>平均ターン</th></tr></thead><tbody>${rows.map((s,i)=>
    `<tr class="${rowCls(s.w,s.g)}"><td class="num">${i+1}</td><td class="nm2">${teamHTML(s.t)}</td><td class="num rate">${rateCell(s.w,s.g,s)}</td><td>${bar(s.w/s.g)}</td><td class="num">${s.g}</td><td class="num">${(s.turns/Math.max(1,s.g)).toFixed(1)}</td></tr>`).join('')}</tbody></table></div>`;
  const unitTbl=(title,map,nameOf,costOf)=>{
    const rs2=[...map.entries()].sort((a,b)=>b[1].w/b[1].g-a[1].w/a[1].g);
    return `<div><h3>${title}</h3><div class="tbl"><table class="stats"><thead><tr><th>#</th><th>名前</th><th>勝率</th><th></th><th>採用した編成</th></tr></thead><tbody>${rs2.map(([id,s],i)=>
      `<tr class="${rowCls(s.w,s.g)}"><td class="num">${i+1}</td><td>${esc(nameOf(id))} <span class="sub small">C${costOf(id)}</span></td><td class="num rate">${rateCell(s.w,s.g,s)}</td><td>${bar(s.w/s.g)}</td><td class="num">${[...teams.values()].filter(x=>title.includes('マスター')?x.t.m===id:x.t.ids.includes(id)).length}</td></tr>`).join('')}</tbody></table></div></div>`; };
  let mx='';
  if(rs().partyMax===1&&!hasMaster()&&rows.length<=24){ // シンプルルール：キャラ同士の勝率表
    const ks=rows.map(s=>s.t).sort((a,b)=>a.cost-b.cost||uNm(a.ids[0]).localeCompare(uNm(b.ids[0])));
    mx=`<h3>勝率表（行のキャラから見た勝率 %）</h3><div class="tbl"><table class="mx"><thead><tr><th></th>${ks.map(t=>`<th title="${esc(teamName(t))}"><span class="vert">${esc(uNm(t.ids[0]))}</span><span class="sub small">C${t.cost}</span></th>`).join('')}</tr></thead><tbody>${ks.map(a=>`<tr><th class="rh">${esc(uNm(a.ids[0]))} <span class="sub small">C${a.cost}</span></th>${ks.map(b=>{
      if(a===b) return '<td class="self">—</td>'; const c=cell.get(a.key+'|'+b.key); if(!c) return '<td class="none"></td>'; const p=c.w/c.g;
      return `<td class="hm" style="--p:${p}" title="${esc(teamName(a))} vs ${esc(teamName(b))}：${pct(p)}">${Math.round(p*100)}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  const spread=rows.length>1?`勝率の幅：${pct(rows[rows.length-1].w/rows[rows.length-1].g)}〜${pct(rows[0].w/rows[0].g)}`:'';
  return `<div class="sums"><div class="sum"><span class="sub small">編成数</span><b>${rows.length}</b></div>
      <div class="sum"><span class="sub small">対戦数</span><b>${R.items.length}</b></div>${spread?`<div class="sum"><span class="sub small">${spread.split('：')[0]}</span><b style="font-size:16px">${spread.split('：')[1]}</b></div>`:''}</div>
    <div class="grid"><div style="grid-column:1/-1"><h3>編成ランキング</h3>${tbl}</div>
    ${unitTbl('サーヴァント別の平均勝率',unitW,id=>uNm(id),id=>uOf(id).cost)}
    ${hasMaster()?unitTbl('マスター別の平均勝率',mW,id=>mOf(id).name,id=>mOf(id).cost):''}</div>${strengthHTML(R,unitW,mW)}${mx}
    <p class="note">キャラ別の勝率は、そのキャラを含む編成の勝率を試合数で平均したものです（味方・相手の組み合わせの影響を含みます）。</p>`;
}

function resTeam(R){
  const A=R.items[0].task.ta;
  let win=0,lose=0,draw=0,turns=0,fw=0,fg=0,dA=0,dB=0,out=0,g=0;
  const byU=new Map(), byM=new Map(), byC=new Map();
  const tot=stNew();
  const rows=R.items.map(({task:t,r})=>{ const gg=gOf(r), w=wOf(r); if(gg) stAdd(tot,w,gg);
    win+=r.win; lose+=r.lose; draw+=r.draw; turns+=r.turns; fw+=r.firstWin; fg+=r.firstGames; dA+=r.dealtA; dB+=r.dealtB; out+=r.aOut; g+=gg;
    if(gg){ t.tb.ids.forEach(id=>addTo(byU,id,w,gg,r)); if(t.tb.m) addTo(byM,t.tb.m,w,gg,r); addTo(byC,t.tb.cost,w,gg,r); }
    return {t:t.tb,r,g:gg,w}; }).sort((a,b)=>(a.g?a.w/a.g:2)-(b.g?b.w/b.g:2));
  const p=g?(win+draw/2)/g:0, box=(l,v,c='',s='')=>`<div class="sum ${c}"><span class="sub small">${l}</span><b>${v}</b>${s?`<span class="sub small">${s}</span>`:''}</div>`;
  const grp=(title,map,name)=>`<div><h3>${title}</h3><div class="tbl"><table class="stats"><thead><tr><th>${title.split('にいた')[0]}</th><th>試合</th><th>勝率（検証した編成）</th></tr></thead><tbody>${[...map.entries()].sort((a,b)=>a[1].w/a[1].g-b[1].w/b[1].g).map(([k,s])=>
    `<tr class="${rowCls(s.w,s.g)}"><td>${name(k)}</td><td class="num">${s.g}</td><td class="num rate">${rateCell(s.w,s.g,s)}</td></tr>`).join('')}</tbody></table></div></div>`;
  const dd=Math.max(1,g);
  return `<div class="sums"><div class="me"><b>${teamHTML(A)}</b></div>
      ${box('勝率',pct(p),grade(p),`±${Math.round(moeX(tot))}%`)}${box('勝-敗'+(draw?'-分':''),`${win}-${lose}${draw?`-${draw}`:''}`)}${box('平均ターン',(turns/dd).toFixed(1))}
      ${box('先攻時勝率',fg?pct(fw/fg):'-')}${box('与 / 被ダメ',`${Math.round(dA/dd)} / ${Math.round(dB/dd)}`)}${box(`${TERMS.out}した味方`,`${(out/dd).toFixed(2)}騎`,'', `1試合あたり`)}</div>
    ${R.items.length>1?`<div class="grid">
      ${grp('相手にいたサーヴァント',byU,id=>`${esc(uNm(id))} <span class="sub small">C${uOf(id).cost}</span>`)}
      ${byM.size?grp('相手にいたマスター',byM,id=>`${esc(mOf(id).name)} <span class="sub small">C${mOf(id).cost}</span>`):''}
      ${grp('相手の合計コスト',byC,k=>`コスト${k}`)}</div>
    <h3>相手別（苦手な順）</h3><div class="tbl"><table class="stats"><thead><tr><th>相手</th><th>勝率</th><th></th><th>勝-敗${draw?'-分':''}</th><th>平均ターン</th><th>先攻時勝率</th></tr></thead><tbody>${rows.map(x=>
      `<tr class="${rowCls(x.w,x.g)}"><td class="nm2">${teamHTML(x.t)}</td><td class="num rate">${rateCell(x.w,x.g)}</td><td>${x.g?bar(x.w/x.g):''}</td><td class="num">${x.r.win}-${x.r.lose}${draw?`-${x.r.draw}`:''}</td><td class="num">${(x.r.turns/Math.max(1,x.g)).toFixed(1)}</td><td class="num">${x.r.firstGames?pct(x.r.firstWin/x.r.firstGames):'-'}</td></tr>`).join('')}</tbody></table></div>`
      :`<h3>直接対決</h3><p class="note">相手：${teamHTML(R.items[0].task.tb)}</p>`}`;
}

function resMaster(R){
  const ms=new Map(), cell=new Map(), svtCell=new Map(), svts=new Set();
  for(const x of R.items){
    const t=x.task, r=x.r, g=gOf(r), w=wOf(r); if(!g) continue;
    const {mi,mj,svt}=t.tag;
    for(const [m,o,ww] of [[mi,mj,w],[mj,mi,g-w]]){
      if(cred(x,'m:'+m)) addTo(ms,m,ww,g,r);
      const c=cell.get(m+'|'+o)||{w:0,g:0}; c.w+=ww; c.g+=g; cell.set(m+'|'+o,c);
      if(rs().partyMax===1){ svts.add(svt); const k=m+'|'+svt, s=svtCell.get(k)||{w:0,g:0}; s.w+=ww; s.g+=g; svtCell.set(k,s); }
    }
  }
  const rows=[...ms.entries()].sort((a,b)=>b[1].w/b[1].g-a[1].w/a[1].g), ids=rows.map(x=>x[0]);
  const tbl=`<div class="tbl"><table class="stats"><thead><tr><th>#</th><th>マスター</th><th>コスト</th><th>勝率</th><th></th><th>試合数</th><th>平均ターン</th></tr></thead><tbody>${rows.map(([id,s],i)=>
    `<tr class="${rowCls(s.w,s.g)}"><td class="num">${i+1}</td><td>${esc(mOf(id).name)}${R.mcol&&R.mcol[id]?` <span class="tag">${TERMS[R.mcol[id]]}特化</span>`:''}</td><td class="num">${mOf(id).cost}</td><td class="num rate">${rateCell(s.w,s.g,s)}</td><td>${bar(s.w/s.g)}</td><td class="num">${s.g}</td><td class="num">${(s.turns/Math.max(1,s.g)).toFixed(1)}</td></tr>`).join('')}</tbody></table></div>`;
  const mx=`<div class="tbl"><table class="mx"><thead><tr><th></th>${ids.map(id=>`<th title="${esc(mOf(id).name)}"><span class="vert">${esc(mOf(id).name)}</span></th>`).join('')}</tr></thead><tbody>${ids.map(a=>`<tr><th class="rh">${esc(mOf(a).name)}</th>${ids.map(b=>{
    if(a===b) return '<td class="self">—</td>'; const c=cell.get(a+'|'+b); if(!c||!c.g) return '<td class="none"></td>'; const p=c.w/c.g;
    return `<td class="hm" style="--p:${p}" title="${esc(mOf(a).name)} vs ${esc(mOf(b).name)}：${pct(p)}">${Math.round(p*100)}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
  let sm='';
  if(svts.size&&svts.size<=14){
    const sl=[...svts].sort((a,b)=>uOf(a).cost-uOf(b).cost);
    sm=`<h3>マスター × サーヴァント（そのマスターの勝率 %）</h3><div class="tbl"><table class="mx"><thead><tr><th></th>${sl.map(s=>`<th><span class="vert">${esc(uNm(s))}</span><span class="sub small">C${uOf(s).cost}</span></th>`).join('')}</tr></thead><tbody>${ids.map(m=>`<tr><th class="rh">${esc(mOf(m).name)}</th>${sl.map(s=>{
      const c=svtCell.get(m+'|'+s); if(!c||!c.g) return '<td class="none"></td>'; const p=c.w/c.g;
      return `<td class="hm" style="--p:${p}" title="${esc(mOf(m).name)} × ${esc(uNm(s))}：${pct(p)}">${Math.round(p*100)}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
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
    case 'src': setSrc(d.v); B.res=null; setTitle(''); break;
    case 'reload': setSrc(B.src); toast('ブラウザのデータを読み直しました'); break;
    case 'set': { const v=d.v; B[d.k]=v; if(d.k==='rule'||d.k==='view'){ B.A={ids:[],m:null}; B.B={ids:[],m:null}; } saveSet(); break; }
    case 'run': startRun(); return;
    case 'csv': case 'sum': saveDetail(d.b); return;
    case 'stop': stopRun(); setTitle('中止'); if(B.res&&!B.res.done) B.res.stopped=true; renderProg(); renderRes(); break;
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
  else if(k.startsWith('mcol:')){ const id=k.slice(5); if(el.value) B.mcol[id]=el.value; else delete B.mcol[id]; }
  else if(el.type==='checkbox') B[k]=el.checked;
  else B[k]=['n','k','sv','cmin','goal'].includes(k)?Number(el.value):el.value;
  saveSet();
  const open=document.querySelector('details.excl')&&document.querySelector('details.excl').open;
  renderCtl(); if(open){ const x=document.querySelector('details.excl'); if(x) x.open=true; }
});
window.addEventListener('pagehide',stopRun);

setSrc(B.src); rerender();
