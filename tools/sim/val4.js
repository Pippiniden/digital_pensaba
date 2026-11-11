// node val4.js <v> <pairs> ; env BURN SETUP TC(tester master cost) FIELD(field|atk)
const fs=require('fs'),vm=require('vm');
const root=require('path').join(__dirname,'../../js/')+'/';
const ctx={console,Math,Date,JSON,localStorage:{getItem(){return null},setItem(){},removeItem(){}},sessionStorage:{getItem(){return null},setItem(){},removeItem(){}},window:{},document:{},setTimeout(){},clearTimeout(){}};
ctx.window=ctx; vm.createContext(ctx);
let src='';for(const f of ['rules','units','masters','common','engine','cpu','sim']) src+=fs.readFileSync(root+f+'.js','utf8')+'\n;\n';
src+='function render(){}\n'; vm.runInContext(src,ctx);
const run=`(function(){
 const V=${+process.argv[2]}, N=${+process.argv[3]||1000}, TC=${process.env.TC||4}, FIELD='${process.env.FIELD||'field'}';
 const field=MASTERS.slice();
 const tpl=masterTpl(TC); const tm=normalizeMaster({id:'m_test',name:'t',cost:TC,hp:tpl.hp,faces:tpl.faces,spells:V?[0,1,2].map(i=>({name:'s'+i,eff:[{k:'dmg',t:'enemy_master',v:V}]})):[]}); MASTERS.push(tm);
 if(FIELD==='atk'){ const t3=masterTpl(TC); MASTERS.push(normalizeMaster({id:'m_atk',name:'a',cost:TC,hp:t3.hp,faces:t3.faces,spells:[0,1,2].map(i=>({name:'a'+i,eff:[{k:'atk',t:'svt',v:40,turns:1}]}))})); }
 SPELL_MIN_TEAM=3; SPELL_FREE=1; CPU_SPELL_KILL=true; CPU_SPELL_GUARD=false; CPU_SPELL_COSTK=0; CPU_SPELL_BURN=${process.env.BURN||0}; CPU_SPELL_SETUP=${process.env.SETUP||0};
 const pick=a=>a[Math.floor(Math.random()*a.length)];
 const team=cap=>{ for(;;){ let ids=[],c=0; const n=1+Math.floor(Math.random()*3); for(let i=0;i<n;i++){ const u=pick(UNITS); if(ids.includes(u.id)||c+u.cost>cap) continue; ids.push(u.id); c+=u.cost; } if(ids.length) return ids; } };
 let w=0,l=0,d=0;
 for(let i=0;i<N;i++){ const cm=FIELD==='atk'?MASTERS.find(m=>m.id==='m_atk'):pick(field); const A=team(13-TC),B=team(13-cm.cost);
   for(const sw of [0,1]){ const picks=sw?[B,A]:[A,B], mp=sw?[cm.id,'m_test']:['m_test',cm.id];
     try{ const g=simGame(picks,'mteam',true,mp,'hard'); if(g.winner===null) d++; else if(g.winner===sw) w++; else l++; }catch(e){} } }
 return +(100*w/(w+l+d)).toFixed(1); })()`;
console.log('v',process.argv[2],'TC',process.env.TC||4,'field',process.env.FIELD||'field','BURN',process.env.BURN||0,'SETUP',process.env.SETUP||0,'=>',vm.runInContext(run,ctx));
