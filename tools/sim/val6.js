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
 const tpl=masterTpl(TC); const D_=${+process.env.D||0}, NSP=${+process.env.NSP||0}; const faces=tpl.faces.map((f,i)=>D_&&[0,2,4].includes(i)?{label:'狙撃',eff:[{k:'dmg',t:'enemy_master',v:D_}]}:(D_&&i!==3?{label:'無',eff:[]}:f)); const tm=normalizeMaster({id:'m_test',name:'t',cost:TC,hp:tpl.hp,faces,spells:[0,1,2].map(i=>({name:'s'+i,eff:i<NSP?[{k:'dmg',t:'enemy_master',v:V}]:[]}))}); MASTERS.push(tm);
 if(FIELD==='atk'){ const t3=masterTpl(TC); MASTERS.push(normalizeMaster({id:'m_atk',name:'a',cost:TC,hp:t3.hp,faces:t3.faces,spells:[0,1,2].map(i=>({name:'a'+i,eff:[{k:'atk',t:'svt',v:40,turns:1}]}))})); }
 SPELL_MIN_TEAM=3; SPELL_FREE=1; CPU_SPELL_KILL=true; CPU_SPELL_GUARD=false; CPU_SPELL_COSTK=0; CPU_SPELL_BURN=${process.env.BURN||0}; CPU_SPELL_RESERVE=${process.env.RES==='t'?true:false}; CPU_SPELL_RESERVE_SKIP='m_test'; CPU_SPELL_EVK=${process.env.EVK||0}; CPU_SPELL_SETUP=${process.env.SETUP||0};
 const pick=a=>a[Math.floor(Math.random()*a.length)];
 const team=cap=>{ for(;;){ let ids=[],c=0; const n=1+Math.floor(Math.random()*3); for(let i=0;i<n;i++){ const u=pick(UNITS); if(ids.includes(u.id)||c+u.cost>cap) continue; ids.push(u.id); c+=u.cost; } if(ids.length) return ids; } };
 let w=0,l=0,d=0; const st={games:0,blocks:0,takes:0,mkill:0,mkillWin:0,defLeft0:0,defKilledNoSpell:0}; const og=ACTIONS.guard; ACTIONS.guard=function(p){ if(G.guard&&G.guard.kind==='spell'){ if(p.to==='block') st.blocks++; else st.takes++; } return og.call(this,p); };
 for(let i=0;i<N;i++){ const cm=FIELD==='atk'?MASTERS.find(m=>m.id==='m_atk'):pick(field); const A=team(13-TC),B=team(13-cm.cost);
   for(const sw of [0,1]){ const picks=sw?[B,A]:[A,B], mp=sw?[cm.id,'m_test']:['m_test',cm.id];
     try{ const g=simGame(picks,'mteam',true,mp,'hard'); st.games++; const dp=sw?0:1, dm=G.players[dp].master; if(dm&&dm.out){ st.mkill++; if(g.winner===sw) st.mkillWin++; if(G.players[dp].spellLeft===0) st.defKilledNoSpell++; } if(g.winner===null) d++; else if(g.winner===sw) w++; else l++; }catch(e){} } }
 return JSON.stringify({win:+(100*w/(w+l+d)).toFixed(1),...st,blocksPerGame:+(st.blocks/st.games).toFixed(2),mkillRate:+(st.mkill/st.games*100).toFixed(1)});
 })()`;
console.log('D',process.env.D||0,'NSP',process.env.NSP||0,'v',process.argv[2],'TC',process.env.TC||4,'field',process.env.FIELD||'field','BURN',process.env.BURN||0,'SETUP',process.env.SETUP||0,'=>',vm.runInContext(run,ctx));
