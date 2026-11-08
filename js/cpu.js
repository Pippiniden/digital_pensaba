'use strict';
/* =====================================================================
   CPU
   cpuDecide() が「次の1手」を [type, payload] で返し、act() に渡すだけ。
   人と同じ操作経路を通るので、ルール違反の手は打てない。
   強さの調整は cpuSkillScore（スキルの使いどき）と cpuBestTarget（攻撃対象）で。
   ===================================================================== */

const isCpu = pid=>!!(G.cpu&&G.cpu[pid]);
const actor = ()=>G.phase==='setup'?G.setupPid:G.cur;
const cpuActing = ()=>!['mode','setup','over'].includes(G.phase) && isCpu(actor()); // 編成はCPU分も人が選ぶ（おまかせ＝setupCpu）
const hpR = u=>u.hp/D(u.def).hp;
const isActing = u=>G.ult ? G.ult===u.uid : (G.alloc[u.uid]||0)>0;
function rnd01(s){ // 「よわい」用：同じ局面では同じ答えになる疑似乱数
  let h=2166136261; for(const ch of s+G.seed){ h^=ch.charCodeAt(0); h=Math.imul(h,16777619); }
  return (h>>>0)/4294967296;
}
let cpuTimer=null;
function scheduleCpu(){
  clearTimeout(cpuTimer);
  if(!cpuActing()) return;
  cpuTimer=setTimeout(()=>{
    if(typeof fxBusy==='function' && fxBusy()){ scheduleCpu(); return; } // 演出の再生中は待つ
    const s=cpuDecide(); if(s) act(s[0],s[1]||{});
  }, G.phase==='setup'?500:G.speed);
}
function cpuDecide(){
  const easy=G.level==='easy';
  switch(G.phase){
    case 'actRoll': return G.actRolled ? ['setAlloc',{alloc:JSON.stringify(cpuAlloc(easy))}] : ['rollActs'];
    case 'skill': {
      if(G.pending) return ['cardClick',{uid:cpuPickTarget(G.pending.uid,G.pending.si,easy).uid}];
      if(!G.ult){ const u=cpuUltUser(); if(u) return ['useUlt',{uid:u.uid}]; }
      const s=cpuNextSkill(easy);
      return s ? ['useSkill',{uid:s.u.uid,si:String(s.si)}] : ['skillDone'];
    }
    case 'action': {
      if(G.copy){ // 他のサーヴァントをロール：再臨後コマンドの平均ダメージが高い相手を選ぶ
        const cs=copyCands(U(G.copy.uid));
        const avgPost=u=>D(u.def).faces.reduce((s,f)=>s+(isCopyCmd(f.post)?0:f.post.dmg||0),0)/6;
        const best=G.level==='easy'?cs[Math.floor(rnd01()*cs.length)]:cs.sort((a,b)=>avgPost(b)-avgPost(a))[0];
        return ['cardClick',{uid:best.uid}];
      }
      const uid=Object.keys(G.alloc).find(id=>!U(id).out&&G.rolled.filter(r=>r.uid===id).length<G.alloc[id]);
      return uid ? ['rollAction',{uid}] : ['toTarget'];
    }
    case 'target': {
      if(G.targetAll) return ['resolve'];
      const best=cpuBestTarget(easy);
      return G.target!==best.uid ? ['cardClick',{uid:best.uid}] : ['resolve'];
    }
    case 'end': return ['endTurn'];
  }
  return null;
}
// 行動配分：3回行動できる強いユニットがいればブレイブチェイン狙い、なければ強い順
function avgDmg(u){
  const d=D(u.def);
  const base=d.faces.reduce((s,f)=>{ const c=u.asc?f.post:f.pre; return s+(c.dmg||0)+(c.c==='ASC'?40:0); },0)/6;
  return base;
}
function cpuAlloc(easy){
  const us=alive(G.cur).filter(u=>(G.maxActs[u.uid]||0)>0), res={};
  us.forEach(u=>res[u.uid]=0);
  let left=RULES.actionsMax;
  if(easy){
    let i=0;
    while(left>0){
      const c=us.filter(u=>res[u.uid]<G.maxActs[u.uid]); if(!c.length) break;
      res[c[Math.floor(rnd01(`${G.turn}a${i++}`)*c.length)].uid]++; left--;
    }
    return res;
  }
  const brave=us.filter(u=>G.maxActs[u.uid]>=3).sort((a,b)=>avgDmg(b)-avgDmg(a))[0];
  if(brave){ res[brave.uid]=3; return res; }
  [...us].sort((a,b)=>avgDmg(b)-avgDmg(a)).forEach(u=>{ const a=Math.min(G.maxActs[u.uid],left); res[u.uid]=a; left-=a; });
  return res;
}
function ultPower(u){
  return D(u.def).ult.eff.filter(e=>e.k==='dmg').reduce((s,e)=>s+e.v*(e.t==='enemy_all'?alive(1-u.pid).length:1),0);
}
function cpuUltUser(){
  const c=alive(G.cur).filter(u=>canUlt(u)&&u.np>=RULES.ultCost);
  return c.sort((a,b)=>ultPower(b)-ultPower(a))[0]||null;
}
function usableSkills(){
  const out=[];
  alive(G.cur).forEach(u=>{ if(!canSkill(u)) return;
    D(u.def).skills.forEach((s,si)=>{ if(!u.used[si]&&(si<2||u.asc)) out.push({u,si}); }); });
  return out;
}
function cpuNextSkill(easy){
  const list=usableSkills();
  if(easy) return list.find(x=>rnd01(`${G.turn}s${x.u.uid}${x.si}`)<.3)||null;
  let best=null;
  for(const x of list){ const sc=cpuSkillScore(x.u,x.si); if(sc>=2&&(!best||sc>best.sc)) best={...x,sc}; }
  return best;
}
// スキルの使いどき：効果ごとに「今使う価値」を点数化し、2点以上なら使う
function cpuSkillScore(u,si){
  const s=D(u.def).skills[si];
  const picked=s.pick?cpuPickTarget(u.uid,si,false):null;
  const allies=alive(u.pid), enemies=alive(1-u.pid), stars=G.players[u.pid].stars;
  let sc=0;
  for(const e of s.eff){
    const ts=e.t==='master'?[]:resolveTargets(u,e.t,picked), acting=ts.some(isActing);
    const foes=ts.filter(t=>t.pid!==u.pid);
    switch(e.k){
      case 'atk': sc+=acting?3:0; break;
      case 'critPow': sc+=acting&&!G.ult&&critLevel(stars)>=3?3:0; break;
      case 'ignoreDef': sc+=acting&&enemies.some(x=>has(x,'def'))?3:.5; break;
      case 'debuffImmune': sc+=ts.some(t=>hpR(t)<.7)?1.5:.5; break;
      case 'buffImmune': sc+=foes.length?2:-1; break;
      case 'fear': case 'sealSkill': sc+=foes.length?2:-1; break;
      case 'sealUlt': sc+=foes.some(t=>t.np>=RULES.ultCost-30)?4:foes.length?1:-1; break;
      case 'spread': sc+=foes.some(t=>has(t,'burn'))?2:.5; break;
      case 'instantDeath': sc+=foes.length?5:-5; break;
      case 'drain': sc+=foes.length?2:-1; break;
      case 'cleanseMental': sc+=ts.some(t=>t.fx.some(x=>FX[x.k].mental))?3:0; break;
      case 'mentalImmune': sc+=.5; break;
      case 'nullUnder': sc+=ts.some(t=>hpR(t)<.8)?2:1; break;
      case 'actsUp': sc+=ts.length&&!foes.length?2:0; break;
      case 'starLoss': sc+=foes.some(t=>G.players[t.pid].stars>0)?2:0; break;
      case 'critRoll': sc+=acting&&!G.ult&&stars>0?2:0; break;
      case 'sureHit': sc+=acting&&enemies.some(x=>has(x,'evade'))?4:.5; break;
      case 'pierce': sc+=acting&&enemies.some(x=>has(x,'evade')||has(x,'invul'))?4:.5; break;
      case 'def': case 'evade': case 'invul': sc+=ts.some(t=>hpR(t)<.6)?3:0; break;
      case 'guts': sc+=ts.some(t=>hpR(t)<.5)?4:0; break;
      case 'taunt': sc+=hpR(u)>=.5&&allies.some(a=>a!==u&&hpR(a)<.5)?3:0; break;
      case 'heal': sc+=ts.some(t=>D(t.def).hp-t.hp>=e.v*.7)?3:0; break;
      case 'cleanse': sc+=ts.some(t=>t.fx.some(x=>FX[x.k].buff===false))?2:0; break;
      case 'np': sc+=ts.some(t=>t.np<RULES.ultCost&&t.np+e.v>=RULES.ultCost)?4:ts.some(t=>t.np<RULES.ultCost)?1.5:0; break;
      case 'star': sc+=G.ult?.5:2; break;
      case 'stun': case 'charm': sc+=3; break;
      case 'poison': case 'burn': sc+=ts.some(t=>!has(t,e.k))?2:0; break;
      case 'curse': case 'atkDown': sc+=2; break;
      case 'strip': sc+=ts.some(t=>t.fx.some(x=>FX[x.k].buff))?2:0; break;
      case 'defDown': sc+=ts.some(t=>t.pid===u.pid)?-1:1; break;
    }
  }
  return sc;
}
function cpuPickTarget(uid,si,easy){
  const u=U(uid), s=D(u.def).skills[si];
  const cands=ALL().filter(x=>!x.out&&(s.pick==='ally'?x.pid===u.pid:s.pick==='enemy'?x.pid!==u.pid:true));
  if(easy) return cands[Math.floor(rnd01(`${G.turn}p${uid}${si}`)*cands.length)];
  const k=s.eff.map(e=>e.k);
  if(k.includes('heal')||k.includes('cleanse')) return [...cands].sort((a,b)=>hpR(a)-hpR(b))[0];
  if(k.includes('np')){ const below=cands.filter(c=>c.np<RULES.ultCost); return [...(below.length?below:cands)].sort((a,b)=>b.np-a.np)[0]; }
  if(['stun','charm','fear','sealSkill','sealUlt','instantDeath'].some(x=>k.includes(x))) return [...cands].sort((a,b)=>b.np-a.np||b.hp-a.hp)[0];
  if(k.includes('poison')||k.includes('burn')){ const c=cands.filter(x=>!has(x,'poison')&&!has(x,'burn')); return [...(c.length?c:cands)].sort((a,b)=>b.hp-a.hp)[0]; }
  return cands[0];
}
// 攻撃対象：倒し切れる相手（NPが高い・コストが高い方）を優先、無理なら削れる割合が大きい相手
function estDamage(t){
  if(G.ult){
    const u=U(G.ult), ud=D(u.def).ult;
    return ud.eff.filter(e=>e.k==='dmg').reduce((s,e)=>s+Math.max(0,e.v+dmgMods(u,t,ud.c).sum),0);
  }
  const cols=G.rolled.map(r=>r.cmd.c), chainR=G.rolled.length===3&&cols.every(c=>c==='R');
  return G.rolled.reduce((s,r)=>{
    const c=r.cmd; if(!c.dmg) return s;
    const a=U(r.uid), d=Math.max(0,c.dmg+dmgMods(a,t,c.c).sum)+(chainR?RULES.chainR:0);
    return s+d;
  },0);
}
function cpuBestTarget(easy){
  const c=targetCandidates();
  if(easy) return c[Math.floor(rnd01(`${G.turn}t`)*c.length)];
  let best=c[0], bs=-Infinity;
  for(const t of c){
    let d=estDamage(t); if(has(t,'invul')||has(t,'evade')) d*=.4;
    const sc = d>=t.hp&&!has(t,'guts') ? 1000+t.np+D(t.def).cost*5 : Math.min(d,t.hp)/t.hp*100+t.np*.2;
    if(sc>bs){ bs=sc; best=t; }
  }
  return best;
}
