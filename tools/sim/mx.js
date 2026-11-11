// node mx.js <masterId> <variant> <games> ; env MFILE ; variants: base | nospell | min6 | free1 | spell0 | spell1 | spell2 (only that spell)
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
 const me=MASTERS.find(m=>m.id===id), field=MASTERS.filter(m=>m.id!==id);
 if(variant==='nospell') me.spells.forEach(s=>s.eff=[]);
 if(/^spell\d$/.test(variant)){ const k=+variant[5]; me.spells.forEach((s,i)=>{ if(i!==k) s.eff=[]; }); }
 if(variant.startsWith('min')) SPELL_MIN_BY[id]=+variant.slice(3);
 if(variant==='free1') SPELL_FREE=1;
 const pick=a=>a[Math.floor(Math.random()*a.length)];
 const team=c=>{ const pool=UNITS.slice().sort(()=>Math.random()-.5); const ids=[]; let t=0; for(const u of pool){ if(ids.length>=3) break; if(t+u.cost<=c){ ids.push(u.id); t+=u.cost; } } return ids; };
 let w=0,n=0,sp=0; const cnt=[0,0]; const og=ACTIONS.masterSpell; ACTIONS.masterSpell=function(p){ if(G.phase==='master') cnt[G.cur]++; return og.call(this,p); }; for(let i=0;i<N;i++){ const o=pick(field), sw=i%2, A=team(13-me.cost), B=team(13-o.cost);
   const picks=sw?[B,A]:[A,B], mp=sw?[o.id,id]:[id,o.id];
   cnt[0]=cnt[1]=0; try{ const g=simGame(picks,'mteam',true,mp,'hard'); n++; sp+=cnt[sw]; w+=g.winner===null?.5:(g.winner===sw?1:0); }catch(e){} }
 return +(100*w/n).toFixed(1)+' spells/game='+(sp/n).toFixed(2); })()`;
console.log(process.argv[2],process.argv[3],'=>',vm.runInContext(run,ctx));
