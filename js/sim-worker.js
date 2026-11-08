'use strict';
/* =====================================================================
   バランス検証用 Web Worker（エディタから new Worker('js/sim-worker.js')）
   受信：シンプル {units, rule:'simple', pairs:[[a,b],...], n, handicap}
         チーム   {units, rule:'team', targets:[id,...], pool:[id,...], n, full}
   送信：{t:'pair', r} を1件ずつ（チームは simTeam の結果）、最後に {t:'done'}。{t:'error', msg} は失敗時
   ===================================================================== */

function render(){}           // engine.js の act() 用（画面はない）
var SHOW_IDS=null;

// 自分の URL の ?v= を読み込むスクリプトにも付けて、キャッシュされた古い版を使わないようにする
const SIM_Q=self.location.search||'';
importScripts(...['rules.js','units.js','common.js','engine.js','cpu.js','sim.js'].map(f=>f+SIM_Q));

onmessage=e=>{
  const m=e.data;
  try{
    UNITS=normalizeUnits(m.units);
    if(m.rule==='team') for(const t of m.targets) postMessage({t:'pair', r:simTeam(t,m.n,m.pool,m.full)});
    else if(!Array.isArray(m.pairs)) throw new Error('検証の条件を読めませんでした。ページを再読み込みしてください');
    else for(const [a,b] of m.pairs) postMessage({t:'pair', r:simPair(a,b,m.n,m.handicap)});
    postMessage({t:'done'});
  }catch(err){ postMessage({t:'error', msg:String(err&&err.message||err)}); }
};
