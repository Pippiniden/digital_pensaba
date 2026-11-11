const fs=require('fs'),vm=require('vm');
const root=require('path').join(__dirname,'../../js/')+'/';
const ctx={console,Math,Date,JSON,localStorage:{getItem(){return null},setItem(){},removeItem(){}},sessionStorage:{getItem(){return null},setItem(){},removeItem(){}},window:{},document:{},setTimeout(){},clearTimeout(){}};
ctx.window=ctx; vm.createContext(ctx);
let src='';
for(const f of ['rules','units','masters','common','engine','cpu','sim']) src+=fs.readFileSync(root+f+'.js','utf8')+'\n;\n';
src+='function render(){}\n';
vm.runInContext(src,ctx);
const N=+process.argv[3]||300, rule=process.argv[2]||'master';
const run=`(function(){
 const N=${N}, rule='${rule}';
 const sv=UNITS.map(u=>u), ms=MASTERS.map(m=>m);
 const cap=RULESETS[rule].costCap, pm=RULESETS[rule].partyMax;
 const pick=a=>a[Math.floor(Math.random()*a.length)];
 function team(fm){ for(let k=0;k<200;k++){ const m=fm?ms.find(x=>x.id===fm):pick(ms); let ids=[],c=m.cost; const n=pm===1?1:1+Math.floor(Math.random()*3);
   for(let i=0;i<n;i++){ const u=pick(sv); if(ids.includes(u.id)||c+u.cost>cap) continue; ids.push(u.id); c+=u.cost; }
   if(ids.length) return {ids,m:m.id,c}; } }
 const cnt=[0,0]; const o=ACTIONS.masterSpell; ACTIONS.masterSpell=function(p){ if(G.phase==='master') cnt[G.cur]++; return o.call(this,p); }; const res={cnt,on:{w:0,l:0,d:0},used:0,err:0};
 for(let i=0;i<N;i++){
  const A=team('${process.env.MID||''}'), B=team(); if(!A||!B) continue;
  for(const sw of [0,1]){
    CPU_SPELL_KILL=true; CPU_SPELL_GUARD=false; CPU_SPELL_COSTPID=0; CPU_SPELL_COSTK=${process.env.K??0};  // 陣営0だけ新ロジック
    const P=sw?[B,A]:[A,B];
    try{ const g=simGame(P.map(x=>x.ids),rule,true,P.map(x=>x.m),'hard');
      if(g.winner===null) res.on.d++; else if(g.winner===0) res.on.w++; else res.on.l++;
    }catch(e){res.err++;res.msg=String(e&&e.stack||e).slice(0,300);}
  }
 }
 res.cnt=cnt; return res; })()`;
const t=Date.now(); const r=vm.runInContext(run,ctx); console.log(rule,JSON.stringify(r),(Date.now()-t)/1000+'s');
