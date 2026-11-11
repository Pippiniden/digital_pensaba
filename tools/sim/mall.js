// node mall.js <rule> <gamesPerMaster>
const fs=require('fs'),vm=require('vm');
const root=require('path').join(__dirname,'../../js/')+'/';
const ctx={console,Math,Date,JSON,localStorage:{getItem(){return null},setItem(){},removeItem(){}},sessionStorage:{getItem(){return null},setItem(){},removeItem(){}},window:{},document:{},setTimeout(){},clearTimeout(){}};
ctx.window=ctx; vm.createContext(ctx);
let src='';for(const f of ['rules','units','masters','common','engine','cpu','sim']) src+=fs.readFileSync(root+f+'.js','utf8')+'\n;\n';
src+='function render(){}\n'; vm.runInContext(src,ctx);
const nm=fs.readFileSync(process.env.MFILE||(process.argv[1].replace(/[^\/]*$/,'')+'newmasters.js'),'utf8');
vm.runInContext(nm.replace("const DEFAULT_MASTERS","var NEWM_RAW"),ctx);
const run=`(function(){
 const rule='${process.argv[2]}', N=${+process.argv[3]||1000};
 MASTERS=NEWM_RAW.map(normalizeMaster);
 const cap=RULESETS[rule].costCap||RULES.costCap, pm=RULESETS[rule].partyMax;
 const pick=a=>a[Math.floor(Math.random()*a.length)];
 const team=c=>{ const pool=UNITS.slice().sort(()=>Math.random()-.5); const ids=[]; let t=0; for(const u of pool){ if(ids.length>=pm) break; if(t+u.cost<=c){ ids.push(u.id); t+=u.cost; } } return ids; };
 const res={}, vs={}; MASTERS.forEach(m=>{ res[m.id]={n:0,w:0,l:0,d:0,spell:0,gam:0}; vs[m.id]={}; MASTERS.forEach(o=>vs[m.id][o.id]={w:0,n:0}); });
 const cnt=[0,0]; const o=ACTIONS.masterSpell; ACTIONS.masterSpell=function(p){ if(G.phase==='master') cnt[G.cur]++; return o.call(this,p); };
 for(const m of MASTERS){ for(let i=0;i<N;i++){
   const opp=pick(MASTERS.filter(x=>x.id!==m.id)); const sw=i%2;
   const A=team(cap-m.cost), B=team(cap-opp.cost); if(!A.length||!B.length) continue;
   const picks=sw?[B,A]:[A,B], mp=sw?[opp.id,m.id]:[m.id,opp.id];
   cnt[0]=cnt[1]=0;
   try{ const g=simGame(picks,rule,true,mp,'hard'); const r=res[m.id]; r.n++; r.spell+=cnt[sw]; 
     const w=g.winner===null?0.5:(g.winner===sw?1:0); if(g.winner===null) r.d++; else if(w) r.w++; else r.l++; vs[m.id][opp.id].n++; vs[m.id][opp.id].w+=w; }catch(e){ res[m.id].err=(res[m.id].err||0)+1; }
 } }
 return JSON.stringify({res,vs,names:Object.fromEntries(MASTERS.map(m=>[m.id,[m.name,m.cost]]))}); })()`;
const out=JSON.parse(vm.runInContext(run,ctx));
console.log('rule',process.argv[2]);
const rows=Object.entries(out.res).map(([id,r])=>({name:out.names[id][0].slice(0,8),cost:out.names[id][1],n:r.n,win:+(100*(r.w+r.d/2)/r.n).toFixed(1),spellPerGame:+(r.spell/r.n).toFixed(2),err:r.err||0}));
rows.sort((a,b)=>b.win-a.win); rows.forEach(r=>console.log(`${r.name.padEnd(9,'　')} C${r.cost}  ${String(r.win).padStart(5)}%  n=${r.n} 令呪/試合=${r.spellPerGame}${r.err?' err='+r.err:''}`));
fs.writeFileSync(process.argv[4],JSON.stringify(out));
