// usage: node val2.js '<test spells json>' '<ctrl spells json|null>' pairs ; env FREE BURN MIN
const fs=require('fs'),vm=require('vm');
const root=require('path').join(__dirname,'../../js/')+'/';
const ctx={console,Math,Date,JSON,localStorage:{getItem(){return null},setItem(){},removeItem(){}},sessionStorage:{getItem(){return null},setItem(){},removeItem(){}},window:{},document:{},setTimeout(){},clearTimeout(){}};
ctx.window=ctx; vm.createContext(ctx);
let src='';for(const f of ['rules','units','masters','common','engine','cpu','sim']) src+=fs.readFileSync(root+f+'.js','utf8')+'\n;\n';
src+='function render(){}\n'; vm.runInContext(src,ctx);
const run=`(function(){
 const TS=${process.argv[2]}, CS=${process.argv[3]}, N=${+process.argv[4]||1500};
 const mk=(id,sp)=>{ const tpl=masterTpl(3); const m=normalizeMaster({id,name:id,cost:3,hp:tpl.hp,faces:tpl.faces,spells:sp?sp.map((eff,i)=>({name:'s'+i,eff})):[]}); MASTERS.push(m); };
 mk('m_test',TS); mk('m_ctrl',CS);
 SPELL_MIN_TEAM=${process.env.MIN||3}; SPELL_FREE=${process.env.FREE||1}; CPU_SPELL_KILL=true; CPU_SPELL_GUARD=false; CPU_SPELL_COSTK=0; CPU_SPELL_BURN=${process.env.BURN||0};
 const pick=a=>a[Math.floor(Math.random()*a.length)];
 const team=()=>{ for(;;){ let ids=[],c=0; const n=1+Math.floor(Math.random()*3); for(let i=0;i<n;i++){ const u=pick(UNITS); if(ids.includes(u.id)||c+u.cost>10) continue; ids.push(u.id); c+=u.cost; } if(ids.length) return ids; } };
 let w=0,l=0,d=0;
 for(let i=0;i<N;i++){ const A=team(),B=team();
   for(const sw of [0,1]){ const picks=sw?[B,A]:[A,B], mp=sw?['m_ctrl','m_test']:['m_test','m_ctrl'];
     try{ const g=simGame(picks,'mteam',true,mp,'hard'); if(g.winner===null) d++; else if(g.winner===sw) w++; else l++; }catch(e){} } }
 return +(100*w/(w+l+d)).toFixed(1); })()`;
console.log(process.argv[2].slice(0,90),'| ctrl',String(process.argv[3]).slice(0,60),'| FREE',process.env.FREE||1,'BURN',process.env.BURN||0,'MIN',process.env.MIN||3,'=>',vm.runInContext(run,ctx));
