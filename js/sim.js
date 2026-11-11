'use strict';
/* =====================================================================
   バランス検証：対戦を画面なしで回す
   rules → units → common → engine → cpu の後に読み込む（sim-worker.js から importScripts）。
   両陣営とも CPU（つよい）。act() と同じく ACTIONS を cpuDecide() の手で動かす。
   - シンプルルール：simPair(a,b,n,handicap) … 1騎同士
   - チームバトル  ：simTeam(t,n,pool,full) … t ＋ランダムな味方 vs 同じ合計コスト・同じ人数のランダムな編成
     （full=true なら味方の合計コストが上限ちょうどの編成だけ使う。t は相手側には入らない）
   ===================================================================== */

const SIM_TURN_LIMIT = 100;   // これを超えたら引き分け
if(typeof CPU_LOOKAHEAD!=='undefined') CPU_LOOKAHEAD=false; // 既定は先読みなしの「つよい」（先読みありだと1試合が数十倍遅い。これまでの検証結果とも揃う）
const SIM_LEVEL = 'hard';
const SIM_LEVEL_LOOK = 'hard+'; // 「つよい（先読みあり）」。ゲームの「つよい」と同じ強さ。cpu.js の CPU_LOOKAHEAD を試合ごとに切り替える擬似レベル（1試合が数十倍遅い）     // 両陣営の CPU の強さ（cpu.js の CPU_LEVELS。expert は先読みで重いので使わない。変えたら editor-sim.js の説明文も）
const SIM_STEP_LIMIT = 30000; // 念のための無限ループ止め

// picks=[[id..],[id..]] で1試合。結果は陣営0 視点
// mpicks=[マスターID|null, ...]（マスターのあるルールだけ）、level=CPUの強さ（省略時 SIM_LEVEL）
function simGame(picks,rule,handicap,mpicks,level){
  newGame({rule, handicap});
  const look=level===SIM_LEVEL_LOOK;
  if(typeof CPU_LOOKAHEAD!=='undefined') CPU_LOOKAHEAD=look; // 'hard+' だけ先読みあり。それ以外は先読みなし
  applyMode({mode:'cpu', level:look?'hard':(level||SIM_LEVEL), cpu:[true,true], names:['A','B']});
  G.picks=picks.map(p=>p.slice()); if(mpicks) G.mpicks=mpicks.slice(); G.phase='init';
  startGame();
  const first=G.cur; let steps=0;
  while(G.phase!=='over' && G.turn<=SIM_TURN_LIMIT && steps++<SIM_STEP_LIMIT){
    const s=cpuDecide(); if(!s) break;
    ACTIONS[s[0]](s[1]||{});
    FXQ.length=0; FXHIDE.clear(); // 演出は使わないので溜めない
    if(G.log.length>400) G.log.length=0;
  }
  const asc=[0,1].map(p=>G.players[p].party[0].asc);
  return { winner:G.phase==='over'?G.winner:null, turns:G.turn, first, asc, dealt:G.dealt.slice(),
    out0:G.players[0].party.map(u=>u.out), out1:G.players[1].party.map(u=>u.out) };
}
const simErr = (r,e)=>{ r.errors++; r.errMsg=r.errMsg||String(e&&e.message||e); };

// シンプルルール：n試合を集計（a 視点）
function simPair(a,b,n,handicap){
  const r={a,b,n,win:0,lose:0,draw:0,turns:0,firstWin:0,firstGames:0,ascA:0,ascB:0,dealtA:0,dealtB:0,errors:0};
  for(let i=0;i<n;i++){
    let g;
    try{ g=simGame([[a],[b]],'simple',handicap); }catch(e){ simErr(r,e); continue; }
    if(g.winner===0) r.win++;
    else if(g.winner===1) r.lose++;
    else r.draw++;
    if(g.first===0){ r.firstGames++; if(g.winner===0) r.firstWin++; }
    r.turns+=g.turns; r.ascA+=g.asc[0]; r.ascB+=g.asc[1]; r.dealtA+=g.dealt[0]; r.dealtB+=g.dealt[1];
  }
  return r;
}

// ---------- チームバトル ----------
// pool のユニットから、合計コストが上限以内の1〜3騎の組み合わせをすべて列挙
function simCombos(pool){
  const ds=pool.map(D).filter(Boolean), max=RULESETS.team.partyMax, out=[];
  const rec=(start,cur,cost)=>{
    if(cur.length) out.push({ids:cur.map(d=>d.id),cost});
    if(cur.length>=max) return;
    for(let i=start;i<ds.length;i++){ const c=cost+ds[i].cost; if(c<=RULES.costCap) rec(i+1,[...cur,ds[i]],c); }
  };
  rec(0,[],0);
  return out;
}
// t の味方編成と相手編成の候補。味方はできるだけ多い人数（通常3騎）、相手は t を含まず「合計コストが同じ・同じ人数」
function simTeamPlan(t,pool,full){
  const all=simCombos(pool), mine=all.filter(c=>c.ids.includes(t)), foes=all.filter(c=>!c.ids.includes(t));
  const key=c=>`${c.ids.length}|${c.cost}`, byKey={};
  foes.forEach(c=>(byKey[key(c)]=byKey[key(c)]||[]).push(c));
  let ok=mine.filter(c=>byKey[key(c)]);
  if(full&&ok.some(c=>c.cost===RULES.costCap)) ok=ok.filter(c=>c.cost===RULES.costCap);
  // 3騎（partyMax）の編成だけ。人数が足りない編成（5コスト2騎など）は使わない
  return { allies:ok.filter(c=>c.ids.length===RULESETS.team.partyMax), byKey, key };
}
const simPick = a=>a[Math.floor(Math.random()*a.length)];
const simByHp = ids=>ids.slice().sort((a,b)=>D(b).hp-D(a).hp); // CPU の編成と同じく HP が高い順

function simTeam(t,n,pool,full){
  const r={t,n,win:0,lose:0,draw:0,turns:0,firstWin:0,firstGames:0,tOut:0,dealt:0,taken:0,errors:0,size:0,
    ally:{}, foe:{}, cost:{}, none:false};
  const plan=simTeamPlan(t,pool,full);
  if(!plan.allies.length){ r.none=true; return r; }
  r.size=plan.allies[0].ids.length;
  const add=(m,k,w)=>{ const x=m[k]||(m[k]={g:0,w:0}); x.g++; x.w+=w; };
  for(let i=0;i<n;i++){
    const me=simPick(plan.allies), op=simPick(plan.byKey[plan.key(me)]);
    const mine=simByHp(me.ids);
    let g;
    try{ g=simGame([mine,simByHp(op.ids)],'team',false); }catch(e){ simErr(r,e); continue; }
    const w=g.winner===0?1:g.winner===1?0:.5;
    if(g.winner===0) r.win++; else if(g.winner===1) r.lose++; else r.draw++;
    if(g.first===0){ r.firstGames++; r.firstWin+=w; }
    r.turns+=g.turns; r.dealt+=g.dealt[0]; r.taken+=g.dealt[1];
    if(g.out0[mine.indexOf(t)]) r.tOut++;
    me.ids.filter(id=>id!==t).forEach(id=>add(r.ally,id,w));
    new Set(op.ids).forEach(id=>add(r.foe,id,w));
    add(r.cost,me.cost,w);
  }
  return r;
}

// ---------- 指定した2つの編成の対戦（バランス検証ページ balance.html 用） ----------
// A,B = {ids:[サーヴァントID...], m:マスターID|null}。n試合（半分ずつ陣営を入れ替える）。結果は A 視点
function simMatchup(rule,A,B,n,handicap,level){
  const r={n,win:0,lose:0,draw:0,turns:0,firstWin:0,firstGames:0,dealtA:0,dealtB:0,aOut:0,aN:A.ids.length,errors:0};
  for(let i=0;i<n;i++){
    const sw=i%2===1, P=sw?[B,A]:[A,B];
    let g;
    try{ g=simGame(P.map(x=>x.ids),rule,handicap,P.map(x=>x.m||null),level); }catch(e){ simErr(r,e); continue; }
    const me=sw?1:0, w=g.winner===null?null:(g.winner===me?0:1);
    if(w===0) r.win++; else if(w===1) r.lose++; else r.draw++;
    if(g.first===me){ r.firstGames++; if(w===0) r.firstWin++; }
    r.turns+=g.turns; r.dealtA+=g.dealt[me]; r.dealtB+=g.dealt[1-me];
    r.aOut+=(sw?g.out1:g.out0).filter(Boolean).length;
  }
  return r;
}
