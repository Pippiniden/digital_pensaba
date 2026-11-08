'use strict';
/* =====================================================================
   バランス検証用 Web Worker（エディタから new Worker('js/sim-worker.js')）
   受信：{units, pairs:[[a,b],...], n, handicap}
   送信：{t:'pair', r} を組み合わせごと、最後に {t:'done'}。{t:'error', msg} は失敗時
   ===================================================================== */

function render(){}           // engine.js の act() 用（画面はない）
var SHOW_IDS=null;

importScripts('rules.js','units.js','common.js','engine.js','cpu.js','sim.js');

onmessage=e=>{
  const m=e.data;
  try{
    UNITS=normalizeUnits(m.units);
    for(const [a,b] of m.pairs){
      postMessage({t:'pair', r:simPair(a,b,m.n,m.handicap)});
    }
    postMessage({t:'done'});
  }catch(err){ postMessage({t:'error', msg:String(err&&err.message||err)}); }
};
