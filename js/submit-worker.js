'use strict';
/* =====================================================================
   申請ツールの勝率測定用 Web Worker（submit.js から new Worker('js/submit-worker.js')）
   受信：{units:[サーヴァント], id, kit:'A'|'S', n}
         units を足した上で、id を基準の中央のキャラの環境に1体入れて n 試合（refMeasure）
   送信：{t:'done', r}（r は refMeasure の結果）／ {t:'error', msg}
   ===================================================================== */
function render(){}           // engine.js の act() 用（画面はない）
var SHOW_IDS=null;
const SUB_Q=self.location.search||'';
importScripts(...['rules.js','units.js','masters.js','common.js','unit-ref.js','ref-units.js','engine.js','cpu.js','sim.js'].map(f=>f+SUB_Q));

onmessage=e=>{
  const m=e.data;
  try{
    const add=m.units.map(normalizeUnit).filter(u=>!D(u.id));
    UNITS=UNITS.concat(add); ALL_UNITS=ALL_UNITS.concat(add);
    postMessage({t:'done', r:refMeasure(m.id,m.kit,m.n)});
  }catch(err){ postMessage({t:'error', msg:String(err&&err.message||err)}); }
};
