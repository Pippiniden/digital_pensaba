// node mx3.js <masterId> <L|none> <games> ; env MFILE MIN K AGG
const fs=require('fs'),vm=require('vm');
const root=require('path').join(__dirname,'../../js/')+'/';
const ctx={console,Math,Date,JSON,localStorage:{getItem(){return null},setItem(){},removeItem(){}},sessionStorage:{getItem(){return null},setItem(){},removeItem(){}},window:{},document:{},setTimeout(){},clearTimeout(){}};
ctx.window=ctx; vm.createContext(ctx);
let src='';for(const f of ['rules','units','masters','common','engine','cpu','sim']) src+=fs.readFileSync(root+f+'.js','utf8')+'\n;\n';
src+='function render(){}\n'; vm.runInContext(src,ctx);
vm.runInContext(fs.readFileSync(process.env.MFILE||require('path').join(__dirname,'newmasters.js'),'utf8').replace("const DEFAULT_MASTERS","var NEWM_RAW"),ctx);
const run=`(function(){
 const id='${process.argv[2]}', variant='${process.argv[3]}', N=${+process.argv[4]||3000};
 MASTERS=NEWM_RAW.map(normalizeMaster);
 SPELL_MIN_TEAM=${process.env.MIN||3}; CPU_SPELL_COSTK=${process.env.K||0}; CPU_SPELL_COSTPID=true; CPU_SPELL_AGG='${process.env.AGG||'sum'}';
 if(variant==='none') SPELL_MIN_BY[id]=99;
 const me=MASTERS.find(m=>m.id===id), field=MASTERS.filter(m=>m.id!==id);
 const pick=a=>a[Math.floor(Math.random()*a.length)];
 const team=c=>{ const pool=UNITS.slice().sort(()=>Math.random()-.5); const ids=[]; let t=0; for(const u of pool){ if(ids.length>=3) break; if(t+u.cost<=c){ ids.push(u.id); t+=u.cost; } } return ids; };
 let w=0,n=0; for(let i=0;i<N;i++){ const o=pick(field), sw=i%2, A=team(13-me.cost), B=team(13-o.cost);
   const picks=sw?[B,A]:[A,B], mp=sw?[o.id,id]:[id,o.id];
   try{ const g=simGame(picks,'mteam',true,mp,'hard'); n++; w+=g.winner===null?.5:(g.winner===sw?1:0); }catch(e){} }
 return +(100*w/n).toFixed(1); })()`;
console.log(process.env.MIN||3,process.env.K||0,process.env.AGG||'sum',process.argv[2],process.argv[3],vm.runInContext(run,ctx));
