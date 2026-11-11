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
 const DES=${JSON.stringify(process.env.DES||'')}; const FEM=${process.env.FEM==='1'};
 if(DES){ const [sc,mu,spl]=DES.split(',').map(Number); const me0=MASTERS.find(m=>m.id==='ssetsuna'); const F={k:'trait',v:'女性'}, R=x=>Math.round(x), f=me0.faces;
   f[0].eff=[{k:'onAtkStar',t:'ally_svt',v:R(4*sc)},{k:'onAtkStar',t:'ally_svt',v:R(4*(mu-sc)),cond:F}];
   f[1].eff=[{k:'star',t:'master',v:R(6*sc)}];
   f[2].eff=[{k:'atk',t:'ally_svt',v:R(30*sc),color:'R'},{k:'atk',t:'ally_svt',v:R(30*(mu-sc)),color:'R',cond:F}];
   f[4].eff=[{k:'onAtkNp',t:'ally_svt',v:R(15*sc),color:'B'},{k:'onAtkNp',t:'ally_svt',v:R(15*(mu-sc)),color:'B',cond:F}];
   if(spl){ const sp=me0.spells; sp[1].eff=[{k:'cleanse',t:'ally_svt',v:0},{k:'heal',t:'ally_svt',v:R(150*sc)},{k:'heal',t:'ally_svt',v:R(150*(mu-sc)),cond:F}];
     sp[2].eff=[sp[2].eff[0],sp[2].eff[1],{k:'dmg',t:'enemy_svt',v:R(120*sc)},{k:'dmg',t:'enemy_svt',v:R(120*(mu-sc)),cond:F}]; }
   me0.faces=f.map(x=>({...x,eff:x.eff.map(normEff)})); me0.spells=me0.spells.map(x=>({...x,eff:x.eff.map(normEff)})); }
 const DJ=${JSON.stringify(process.env.DESJ||'')}; if(DJ){ const P=JSON.parse(DJ), me0=MASTERS.find(m=>m.id==='ssetsuna');
   for(const [i,e] of Object.entries(P.faces||{})) me0.faces[+i].eff=e.map(normEff);
   for(const [i,e] of Object.entries(P.spells||{})) me0.spells[+i].eff=e.map(normEff); }
 if(variant==='none') SPELL_MIN_BY[id]=99;
 const me=MASTERS.find(m=>m.id===id), field=MASTERS.filter(m=>m.id!==id);
 const pick=a=>a[Math.floor(Math.random()*a.length)];
 const team=(c,fem)=>{ const pool=UNITS.filter(u=>!fem||(u.traits||[]).includes('女性')).sort(()=>Math.random()-.5); const ids=[]; let t=0; for(const u of pool){ if(ids.length>=3) break; if(t+u.cost<=c){ ids.push(u.id); t+=u.cost; } } return ids; };
 let w=0,n=0; for(let i=0;i<N;i++){ const o=pick(field), sw=i%2, A=team(13-me.cost,FEM), B=team(13-o.cost);
   const picks=sw?[B,A]:[A,B], mp=sw?[o.id,id]:[id,o.id];
   try{ const g=simGame(picks,'mteam',true,mp,'hard'); n++; w+=g.winner===null?.5:(g.winner===sw?1:0); }catch(e){} }
 return +(100*w/n).toFixed(1); })()`;
console.log((process.env.TAG||'')+' DES',process.env.DES||'orig','FEM',process.env.FEM||0,process.argv[2],process.argv[3],vm.runInContext(run,ctx));
