// クイックチェイン強化案4：クイックチェインが起きた試合だけの勝率（寄与率）の比較。元: 強化案の比較：陣営0だけに案を適用し、陣営1は現行ルール。同じ編成を陣営を入れ替えて対戦させる
//   node tools/sim/quickchain.js [rule=team] [N=300]
// 案: base(現行10・対照) / star15 / guar(スター10＋次の自分のターン全員最低1回行動) / both
// 併せて base の対戦から、チェイン種ごとの「起きた試合の勝率」を出す（寄与の目安）
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const root=path.join(__dirname,'../../js/');
const ctx={console,Math,Date,JSON,localStorage:{getItem(){return null},setItem(){},removeItem(){}},sessionStorage:{getItem(){return null},setItem(){},removeItem(){}},window:{},document:{},setTimeout(){},clearTimeout(){}};
ctx.window=ctx; vm.createContext(ctx);
let src='';
for(const f of ['rules','units','masters','common','engine','cpu','sim']) src+=fs.readFileSync(root+f+'.js','utf8')+'\n;\n';
src+='function render(){}\n';
src+='var VARQ={now:0,cp:0,lv:0};\n';
const rep=(a,b)=>{ if(!src.includes(a)) throw new Error('patch miss: '+a.slice(0,40)); src=src.replace(a,b); };
// クイックチェインが成立した時点（コマンド解決の前）に、そのターンの手持ちスターを増やす（陣営0だけ）
rep("chainsOf(G.cur)[chain]++; }\n    acts.forEach(","chainsOf(G.cur)[chain]++; if(chain==='G'&&G.cur===0&&VARQ.now) G.players[0].stars+=VARQ.now; }\n    acts.forEach(");
// クイックチェインのコマンドのクリティカル威力+
rep("const add=Math.max(0,(cmd.c==='R'?RULES.critDmgR:RULES.critDmg)+pw+colorBuff);","const add=Math.max(0,(cmd.c==='R'?RULES.critDmgR:RULES.critDmg)+pw+colorBuff+(o.chain==='G'&&att.pid===0?VARQ.cp:0));");
rep("critLevel(stars)+cr.sum-cd.sum","critLevel(stars)+cr.sum-cd.sum+(o.chain==='G'&&att.pid===0?VARQ.lv:0)");
vm.runInContext(src,ctx);
const rule=process.argv[2]||'team', N=+process.argv[3]||300;
const run=`(function(){
 const N=${N}, rule='${rule}';
 const sv=UNITS.filter(u=>!u.enemy), ms=MASTERS.slice();
 const cap=RULESETS[rule].costCap, pm=RULESETS[rule].partyMax, hasM=!!RULESETS[rule].master;
 const pick=a=>a[Math.floor(Math.random()*a.length)];
 function team(){ for(let k=0;k<500;k++){ const m=hasM?pick(ms):null; let ids=[],c=m?m.cost:0;
   for(let i=0;i<20&&ids.length<pm;i++){ const u=pick(sv); if(ids.includes(u.id)||c+u.cost>cap) continue; ids.push(u.id); c+=u.cost; }
   if(ids.length===pm) return {ids,m:m&&m.id}; } }
 // 変更案：陣営0（simGame では P[0]）だけ
 let VAR={g:10,guar:false};
 Object.defineProperty(RULES,'chainG',{get(){ return G&&G.cur===0?VAR.g:10; },configurable:true});
 const orig=ACTIONS.rollActs;
 ACTIONS.rollActs=function(p){
   if(G.phase!=='actRoll'||G.actRolled) return;
   const P=G.players[G.cur], now=((G.chains&&G.chains[G.cur])||{}).G||0, bonus=G.cur===0&&VAR.guar&&now>(P.qprev||0);
   P.qprev=now;
   orig.call(this,p);
   if(bonus){
     let left=RULES.actionsMax;
     alive(G.cur).forEach(u=>{ let m=G.maxActs[u.uid]||0; if(m<1&&!disabled(u)&&!u.fx.some(e=>e.k==='confuse')) m=1; G.maxActs[u.uid]=m; const a=Math.min(m,left); G.alloc[u.uid]=a; left-=a; });
     if(masterRule()) P.zeroNext=Object.values(G.maxActs).every(n=>!n);
   }
 };
 const out={};
 // 同じ編成の組を全案で使い回す
 const variants={base:{now:0,cp:0,lv:0},s10_lv1_cp30:{now:10,cp:30,lv:1},s10_lv1_cp50:{now:10,cp:50,lv:1},s10_lv2_cp30:{now:10,cp:30,lv:2},s10_lv2_cp50:{now:10,cp:50,lv:2}};
 const pairs=[]; for(let i=0;i<N;i++){ const A=team(),B=team(); if(A&&B) pairs.push([A,B]); }
 const mk=()=>({R:[0,0],B:[0,0],G:[0,0]}); // [起きた回数, 勝ち数(引分.5)]
 for(const [name,v] of Object.entries(variants)){
   VARQ.now=v.now; VARQ.cp=v.cp; VARQ.lv=v.lv; const r={games:0,err:0,s0:mk(),s1:mk(),all:[0,0]};
   for(const [A,B] of pairs) for(const sw of [0,1]){
     const P=sw?[B,A]:[A,B];
     try{ const g=simGame(P.map(x=>x.ids),rule,false,P.map(x=>x.m),'hard',true);
       const w=g.winner===null?.5:(g.winner===0?1:0);
       r.games++; r.all[0]++; r.all[1]+=w;
       [[0,w,r.s0],[1,1-w,r.s1]].forEach(([side,ws,m])=>['R','B','G'].forEach((k,ci)=>{ if(g.chains[side][ci]>0){ m[k][0]++; m[k][1]+=ws; } }));
     }catch(e){ r.err++; r.msg=String(e&&e.stack||e).slice(0,300); }
   }
   out[name]=r;
 }
 return out; })()`;
const t=Date.now(); const R=vm.runInContext(run,ctx);
const pc=x=>(x*100).toFixed(1)+'%', cell=x=>x[0]?`${pc(x[1]/x[0])} ±${pc(Math.sqrt(.25/x[0])*1.96)} (n=${x[0]})`:'-';
console.log(`rule=${rule} 組数=${N}（各案 ${N*2} 試合）  ${(Date.now()-t)/1000}s`);
console.log('【陣営0（案を適用）が チェインを出した試合だけ の陣営0勝率】');
for(const [k,r] of Object.entries(R)) console.log(`${k.padEnd(9)} クイック ${cell(r.s0.G)} | バスター ${cell(r.s0.R)} | アーツ ${cell(r.s0.B)}${r.err?'  err'+r.err+' '+r.msg:''}`);
// 陣営1は常に現行ルール：全案を合算した「現行のチェインが起きた試合の勝率」
const ref={R:[0,0],B:[0,0],G:[0,0]}; Object.values(R).forEach(r=>['R','B','G'].forEach(k=>{ ref[k][0]+=r.s1[k][0]; ref[k][1]+=r.s1[k][1]; }));
console.log('【参考：陣営1（現行ルール）が出した試合の陣営1勝率（全案合算）】');
console.log(`クイック ${cell(ref.G)} | バスター ${cell(ref.R)} | アーツ ${cell(ref.B)}`);
