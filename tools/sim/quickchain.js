// クイックチェーン強化案の比較：陣営0だけに案を適用し、陣営1は現行ルール。同じ編成を陣営を入れ替えて対戦させる
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
 const variants={base:{g:10,guar:false},star15:{g:15,guar:false},guar:{g:10,guar:true},both:{g:15,guar:true}};
 // 同じ編成の組を全案で使い回す
 const pairs=[]; for(let i=0;i<N;i++){ const A=team(),B=team(); if(A&&B) pairs.push([A,B]); }
 for(const [name,v] of Object.entries(variants)){
   VAR=v; const r={w:0,l:0,d:0,err:0,chain:{R:[0,0,0],B:[0,0,0],G:[0,0,0]},nochain:[0,0],gcnt:0,games:0,stars:0};
   for(const [A,B] of pairs) for(const sw of [0,1]){
     const P=sw?[B,A]:[A,B];
     try{ const g=simGame(P.map(x=>x.ids),rule,false,P.map(x=>x.m),'hard',true);
       // 陣営0 視点
       const w=g.winner===null?.5:(g.winner===0?1:0);
       if(g.winner===null) r.d++; else if(g.winner===0) r.w++; else r.l++;
       r.games++;
       if(name==='base') for(const side of [0,1]){ const ws=side===0?w:1-w, c=g.chains[side]; ['R','B','G'].forEach((k,ci)=>{ const x=r.chain[k]; if(c[ci]>0){ x[0]++; x[1]+=ws; } else x[2]+=ws; }); }
       r.gcnt+=g.chains[0][2];
     }catch(e){ r.err++; r.msg=String(e&&e.stack||e).slice(0,300); }
   }
   out[name]=r;
 }
 return out; })()`;
const t=Date.now(); const R=vm.runInContext(run,ctx);
const pc=x=>(x*100).toFixed(1)+'%';
console.log(`rule=${rule} 組数=${N}（各案 ${N*2} 試合）  ${(Date.now()-t)/1000}s`);
for(const [k,r] of Object.entries(R)){
  const n=r.w+r.l+r.d, rate=(r.w+r.d/2)/n, se=Math.sqrt(.25/n)*1.96;
  console.log(`${k.padEnd(7)} 陣営0勝率 ${pc(rate)} ±${pc(se)}  (W${r.w} L${r.l} D${r.d} err${r.err})  陣営0のクイックチェイン/試合 ${(r.gcnt/Math.max(1,n)).toFixed(2)}${r.msg?'  '+r.msg:''}`);
}
const b=R.base; console.log('\n[現行] チェインが起きた陣営の勝率（起きなかった陣営との差）');
for(const k of ['R','B','G']){ const x=b.chain[k], n=x[0]; const wn=b.games*2-n; console.log(`${k}: 起きた${n}回 勝率${pc(x[1]/n)} / 起きなかった${wn}回 勝率${pc(x[2]/wn)}  差${((x[1]/n-x[2]/wn)*100).toFixed(1)}pt`); }
