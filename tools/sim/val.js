// usage: node val.js <type> <mode:forced|default> <pairs>
const fs=require('fs'),vm=require('vm');
const root=require('path').join(__dirname,'../../js/')+'/';
const ctx={console,Math,Date,JSON,localStorage:{getItem(){return null},setItem(){},removeItem(){}},sessionStorage:{getItem(){return null},setItem(){},removeItem(){}},window:{},document:{},setTimeout(){},clearTimeout(){}};
ctx.window=ctx; vm.createContext(ctx);
let src='';for(const f of ['rules','units','masters','common','engine','cpu','sim']) src+=fs.readFileSync(root+f+'.js','utf8')+'\n;\n';
src+='function render(){}\n'; vm.runInContext(src,ctx);
const [type,mode,pairs]=[process.argv[2],process.argv[3],+process.argv[4]||1500];
const T={
 single:{vals:[50,100,150,200,300,400],eff:v=>[{k:'dmg',t:'enemy_svt',v}]},
 all:{vals:[30,60,90,120,160,200],eff:v=>[{k:'dmg',t:'enemy_all',v}]},
 master:{vals:[100,200,300,400,600],eff:v=>[{k:'dmg',t:'enemy_master',v}]},
 heal:{vals:[100,200,300,400,600],eff:v=>[{k:'heal',t:'svt',v}]},
 atk1t:{vals:[10,20,30,40,60],eff:v=>[{k:'atk',t:'svt',v,turns:1}]},
 def1t:{vals:[10,20,30,40,60],eff:v=>[{k:'def',t:'svt',v,turns:1}]},
 atkdown:{vals:[10,20,30,40],eff:v=>[{k:'atkDown',t:'enemy_all',v,turns:3}]},
 defdown:{vals:[10,20,30,40,60],eff:v=>[{k:'defDown',t:'enemy_all',v,turns:3}]},
}[type];
const run=`(function(){
 const T=${JSON.stringify({vals:T.vals})}, type='${type}', forced=${mode==='forced'}, N=${pairs};
 const mk=(eff)=>{ const tpl=masterTpl(3); return normalizeMaster({id:'m_x',name:'x',cost:3,hp:tpl.hp,faces:tpl.faces,spells:eff?[0,1,2].map(i=>({name:'s'+i,eff})):[]}); };
 const base=mk(null); base.id='m_base'; MASTERS.push(base);
 const effs=${T.eff.toString()};
 SPELL_MIN_TEAM=forced?-1e9:3; SPELL_FREE=${process.env.FREE||0}; CPU_SPELL_KILL=true; CPU_SPELL_GUARD=false; CPU_SPELL_COSTK=0;
 const pick=a=>a[Math.floor(Math.random()*a.length)];
 const team=()=>{ for(;;){ let ids=[],c=0; const n=1+Math.floor(Math.random()*3); for(let i=0;i<n;i++){ const u=pick(UNITS); if(ids.includes(u.id)||c+u.cost>10) continue; ids.push(u.id); c+=u.cost; } if(ids.length) return ids; } };
 const out=[];
 for(const v of T.vals){
   const tm=mk(effs(v)); tm.id='m_test'; MASTERS.push(tm);
   let w=0,l=0,d=0,used=0; const o=ACTIONS.masterSpell; 
   for(let i=0;i<N;i++){ const A=team(),B=team();
     for(const sw of [0,1]){ const me=sw; // tester pid
       const picks=sw?[B,A]:[A,B], mp=sw?['m_base','m_test']:['m_test','m_base'];
       try{ const g=simGame(picks,'mteam',true,mp,'hard'); if(g.winner===null) d++; else if(g.winner===me) w++; else l++; }catch(e){}
     } }
   MASTERS.pop();
   out.push({v,win:+(100*w/(w+l+d)).toFixed(1),n:w+l+d});
 }
 return out; })()`;
const r=vm.runInContext(run,ctx); console.log(type,mode,JSON.stringify(r));
