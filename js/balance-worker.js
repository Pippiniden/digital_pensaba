'use strict';
/* =====================================================================
   バランス検証ページ（balance.html）用 Web Worker
   受信：{t:'init', units, masters}                … データを設定して {t:'ready'} を返す
         {t:'task', id, rule, A, B, n, handicap, level} … A,B={ids,m}。simMatchup の結果を {t:'res', id, r} で返す
   失敗時は {t:'error', id, msg}
   ===================================================================== */

function render(){}           // engine.js の act() 用（画面はない）
var SHOW_IDS=null;

const SIM_Q=self.location.search||'';
importScripts(...['rules.js','units.js','masters.js','common.js','engine.js','cpu.js','sim.js'].map(f=>f+SIM_Q));

onmessage=e=>{
  const m=e.data;
  try{
    if(m.t==='init'){ UNITS=normalizeUnits(m.units); MASTERS=m.masters.map(normalizeMaster); postMessage({t:'ready'}); }
    else if(m.t==='task') postMessage({t:'res', id:m.id, r:simMatchup(m.rule,m.A,m.B,m.n,m.handicap,m.level)});
  }catch(err){ postMessage({t:'error', id:m&&m.id, msg:String(err&&err.message||err)}); }
};
