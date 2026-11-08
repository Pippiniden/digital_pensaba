'use strict';
/* =====================================================================
   バランス検証：シンプルルールの対戦を画面なしで回す
   rules → units → common → engine → cpu の後に読み込む（sim-worker.js から importScripts）。
   両陣営とも CPU（ふつう）。act() と同じく ACTIONS を cpuDecide() の手で動かす。
   ===================================================================== */

const SIM_TURN_LIMIT = 100;   // これを超えたら引き分け
const SIM_STEP_LIMIT = 20000; // 念のための無限ループ止め

// a と b（ユニットid）を1試合。結果は a 視点
function simGame(a,b,handicap){
  newGame({rule:'simple', handicap});
  applyMode({mode:'cpu', level:'normal', cpu:[true,true], names:['A','B']});
  G.picks=[[a],[b]]; G.phase='init';
  startGame();
  const first=G.cur; let steps=0;
  while(G.phase!=='over' && G.turn<=SIM_TURN_LIMIT && steps++<SIM_STEP_LIMIT){
    const s=cpuDecide(); if(!s) break;
    ACTIONS[s[0]](s[1]||{});
    FXQ.length=0; FXHIDE.clear(); // 演出は使わないので溜めない
    if(G.log.length>400) G.log.length=0;
  }
  const asc=[0,1].map(p=>G.players[p].party[0].asc);
  return { winner:G.phase==='over'?G.winner:null, turns:G.turn, np:G.winBy==='np', first, asc, dealt:G.dealt.slice() };
}

// n試合を集計（a 視点）
function simPair(a,b,n,handicap){
  const r={a,b,n,win:0,lose:0,draw:0,turns:0,npWin:0,npLose:0,firstWin:0,firstGames:0,ascA:0,ascB:0,dealtA:0,dealtB:0,errors:0};
  for(let i=0;i<n;i++){
    let g;
    try{ g=simGame(a,b,handicap); }catch(e){ r.errors++; r.errMsg=r.errMsg||String(e&&e.message||e); continue; }
    if(g.winner===0){ r.win++; if(g.np) r.npWin++; }
    else if(g.winner===1){ r.lose++; if(g.np) r.npLose++; }
    else r.draw++;
    if(g.first===0){ r.firstGames++; if(g.winner===0) r.firstWin++; }
    r.turns+=g.turns; r.ascA+=g.asc[0]; r.ascB+=g.asc[1]; r.dealtA+=g.dealt[0]; r.dealtB+=g.dealt[1];
  }
  return r;
}
