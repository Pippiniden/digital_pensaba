'use strict';
/* =====================================================================
   CPU
   cpuDecide() が「次の1手」を [type, payload] で返し、act() に渡すだけ。
   人と同じ操作経路を通るので、ルール違反の手は打てない。
   強さの調整は cpuSkillScore（スキルの使いどき）と cpuBestTarget（攻撃対象）で。
   ===================================================================== */

// 難易度。hard 以上は攻撃対象を「脅威度」で選び、宝具をダメージ見込みで撃つ。expert は攻撃対象を先読み（モンテカルロ）で決める（シンプルルールではスキル・宝具も）
const CPU_LEVELS = {
  easy:  {name:'よわい',   desc:'スキルや攻撃対象をほぼ気まぐれに選ぶ'},
  normal:{name:'ふつう',   desc:'状況を見てスキル・行動配分・攻撃対象を選ぶ'},
  hard:  {name:'つよい',   desc:'危険な相手から集中して狙い、宝具も撃ちどきを選ぶ'},
  expert:{name:'超つよい', desc:'攻撃対象（シンプルではスキル・宝具）を先読みして選ぶ'},
};
const cpuHard = ()=>G.level==='hard'||G.level==='expert';
const MC_ROLLOUTS = 16;  // 超つよい：攻撃対象の候補ごとに決着まで試す回数
const MC_TURNS = 40;     // 1回の試しで進める最大ターン数（超えたら残りHPで評価）
const isCpu = pid=>!!(G.cpu&&G.cpu[pid]);
const actor = ()=>G.phase==='setup'?G.setupPid:G.phase==='guard'?1-G.cur:G.cur; // guard＝守る側が選ぶ
const cpuActing = ()=>!['mode','setup','over'].includes(G.phase) && isCpu(actor()); // 編成はCPU分も人が選ぶ（おまかせ＝setupCpu）
const hpR = u=>u.hp/maxHp(u);
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
      let m=null;
      if(!G.ult&&!G.ultDone){ const u=cpuUltUser(); if(u) m=['useUlt',{uid:u.uid}]; }
      if(!m){ const s=cpuNextSkill(easy); m=s ? ['useSkill',{uid:s.u.uid,si:String(s.si)}] : ['skillDone']; }
      // 超つよい・シンプルルール：スキル・宝具も先読みで選ぶ（チームバトルでは逆に弱くなったので使わない）
      return G.level==='expert'&&ruleset().partyMax===1 ? cpuMcSkill(m) : m;
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
    case 'master': return cpuMaster(easy);
    case 'guard': return cpuGuard();
  }
  return null;
}
// ---------- マスタールール ----------
// マスターフェイズ：宣言済みの令呪があれば使う → 令呪を即時で使う価値があれば使う → 攻撃で倒せるなら攻撃 → 攻撃か補助
// 攻撃対象のマスターは守る側がサーヴァントで受けるか選べるので、CPU はサーヴァントの攻撃でマスターを狙わない
function cpuMaster(easy){
  const m=masterOf(G.cur), d=D(m.def), P=G.players[G.cur], em=masterOf(1-G.cur), es=alive(1-G.cur)[0], rs=ruleset();
  const spellBest=()=>{ let bi=0, bs=-Infinity; d.spells.forEach((s,i)=>{ const v=cpuEffScore(m,s.eff,null,-1); if(v>bs){ bs=v; bi=i; } }); return {i:bi,sc:bs}; };
  if(P.spell==='decl') return ['masterSpellUse',{i:String(spellBest().i)}];
  const opts=[['masterSupport']];
  if(es) opts.push(['masterAttack',{to:'svt'}]);
  if(em&&!em.out&&!G.players[em.pid].evac) opts.push(['masterAttack',{to:'master'}]);
  if(easy) return opts[Math.floor(rnd01(`${G.turn}m`)*opts.length)];
  if(canDeclareSpell()&&P.stars>=rs.spellNowStars){ const b=spellBest(); if(b.sc>=4) return ['masterSpell',{now:'1',i:String(b.i)}]; }
  if(es&&masterAtkDmg(m,es)>=es.hp&&!has(es,'guts')) return ['masterAttack',{to:'svt'}];
  // 相手マスターへの攻撃は、倒せば相手サーヴァントにマスターの最大HP分のダメージ（相手が令呪で守る場合もある）
  if(em&&!em.out&&!G.players[em.pid].evac&&d.cost>=2) return ['masterAttack',{to:'master'}];
  return ['masterSupport'];
}
// 守る側の選択：令呪で守るのは、受けるとマスターが瀕死になるときだけ。
// サーヴァントの攻撃は、サーヴァントが倒れそうならマスターで受け、マスターが倒れる（＝サーヴァントにマスターの最大HP分）ならサーヴァントで受ける
function cpuGuard(){
  const g=G.guard, dp=1-G.cur, em=masterOf(dp), s=alive(dp)[0];
  if(g.kind==='spell') return ['guard',{to:g.dmg>=em.hp?'block':'take'}];
  const est=estDamage(s);
  if(est>=s.hp&&est<em.hp) return ['guard',{to:'master'}];
  if(est<em.hp&&est*2<=em.hp&&hpR(s)<.5) return ['guard',{to:'master'}];
  return ['guard',{to:'svt'}];
}
// 行動配分（ふつう）：3回行動できる強いユニットがいればブレイブチェイン狙い、なければ強い順。つよい以上は cpuAllocEV
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
  if(cpuHard()) return cpuAllocEV(us);
  const brave=us.filter(u=>G.maxActs[u.uid]>=3).sort((a,b)=>avgDmg(b)-avgDmg(a))[0];
  if(brave){ res[brave.uid]=3; return res; }
  [...us].sort((a,b)=>avgDmg(b)-avgDmg(a)).forEach(u=>{ const a=Math.min(G.maxActs[u.uid],left); res[u.uid]=a; left-=a; });
  return res;
}
// ---------- つよい：行動配分をダメージ期待値で比べる ----------
// 配分の候補をすべて並べ、それぞれの期待ダメージ（6面の平均の合計）を比べる。
// 攻撃バフ・クリティカル期待値・Busterチェイン・ブレイブチェインの追加攻撃（補正なし）・再臨面の価値を含む。
// 例：アルトリア1回＋小次郎2回 ＞ 小次郎ブレイブ。ブレイブの追加攻撃は「その騎のもう1回分」程度なので、
//     1回あたりの期待値がほぼ2倍ある騎が別にいれば、混ぜた方が得になる
const ASC_VALUE = 40; // 再臨前の再臨面1回の価値（ダメージ換算。avgDmg と同じ）
function cmdOf(u,f){ const face=D(u.def).faces[f]; return !u.asc&&face.pre.c==='ASC'?face.pre:u.asc?face.post:face.pre; }
function cmdValue(u,c,stars,tgt){
  if(c.c==='ASC') return u.asc?0:ASC_VALUE;
  if(!(c.dmg>0)) return 0;
  const m=dmgMods(u,tgt,c.c==='W'?null:c.c); let d=Math.max(0,c.dmg+m.sum);
  if(stars>0&&c.c!=='W'){
    const p=ruleset().crit==='d6'?Math.min(1,critNeedD6(stars)/6):critChance(critLevel(stars))/100;
    d+=p*((c.c==='R'?RULES.critDmgR:RULES.critDmg)+m.colorBuff);
  }
  return d;
}
function allocEV(alloc){
  const tgt=[...alive(1-G.cur)].sort((a,b)=>maxHp(b)-maxHp(a))[0], stars=G.players[G.cur].stars;
  const slots=[]; Object.entries(alloc).forEach(([uid,n])=>{ for(let i=0;i<n;i++) slots.push(U(uid)); });
  if(!slots.length) return 0;
  // 1回ごとの期待値は独立なので足し合わせ、Busterチェインだけ「3回ともBuster」の確率で加える
  const per=new Map();
  const stat=u=>{ if(!per.has(u)){ const cs=[0,1,2,3,4,5].map(f=>cmdOf(u,f));
    per.set(u,{v:cs.reduce((s,c)=>s+cmdValue(u,c,stars,tgt),0)/6, pR:cs.filter(c=>c.c==='R'&&c.dmg>0).length/6,
      ex:cs.reduce((s,c)=>s+(c.c==='ASC'?(u.asc?0:ASC_VALUE):(c.dmg||0)),0)/6}); } return per.get(u); };
  let v=slots.reduce((s,u)=>s+stat(u).v,0);
  if(slots.length===3) v+=slots.reduce((p,u)=>p*stat(u).pR,1)*RULES.chainR*3;
  if(slots.length===3&&slots.every(s=>s===slots[0])) v+=stat(slots[0]).ex; // ブレイブチェインの追加攻撃（補正・クリティカルなし）
  return v;
}
function cpuAllocEV(us){
  const out=[];
  const rec=(i,cur,left)=>{ if(i===us.length){ if(left===0) out.push(cur); return; }
    for(let k=0;k<=Math.min(left,G.maxActs[us[i].uid]);k++) rec(i+1,{...cur,[us[i].uid]:k},left-k); };
  rec(0,{},requiredAlloc());
  let best=null, bv=-1;
  for(const a of out){ const v=allocEV(a); if(v>bv){ bv=v; best=a; } }
  return best||Object.fromEntries(us.map(u=>[u.uid,0]));
}
function ultPower(u){
  return D(u.def).ult.eff.filter(e=>e.k==='dmg').reduce((s,e)=>s+e.v*(e.t==='enemy_all'?alive(1-u.pid).length:1),0);
}
function cpuUltUser(){
  const c=alive(G.cur).filter(u=>canUlt(u)&&u.np>=RULES.ultCost);
  const u=c.sort((a,b)=>ultPower(b)-ultPower(a))[0]||null;
  // つよい以上：攻撃宝具は、このターンの通常攻撃の見込みダメージを下回るなら温存する
  if(u&&cpuHard()&&ultPower(u)>0&&ultPower(u)<turnPower()) return null;
  return u;
}
// このターンに割り振った行動の見込みダメージ（ブレイブチェインはおおよそ+60）
function turnPower(){
  return Object.entries(G.alloc).reduce((s,[uid,n])=>s+n*avgDmg(U(uid)),0)+(Object.values(G.alloc).some(n=>n===3)?60:0);
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
  for(const x of list){ const sc=cpuHard()?cpuGuardScore(x.u,x.si):cpuSkillScore(x.u,x.si); if(sc>=2&&(!best||sc>best.sc)) best={...x,sc}; }
  return best;
}
// つよい（チームバトル）：回避・無敵を含むスキルは、敵の宝具（NP100%）に合わせて使う。
// 敵が宝具を撃てる → 狙われそうな味方（全体宝具なら誰でも）に回避・無敵が付くなら最優先。
// そうでなければ、倒れそうなとき（HP35%未満）まで温存する。シンプルルールでは効果がなかったので使わない
function cpuGuardScore(u,si){
  const base=cpuSkillScore(u,si), s=D(u.def).skills[si];
  if(ruleset().partyMax===1) return base;
  const gs=s.eff.filter(e=>e.k==='evade'||e.k==='invul'); if(!gs.length) return base;
  const picked=s.pick?cpuPickTarget(u.uid,si,false):null;
  const ts=gs.flatMap(e=>resolveTargets(u,e.t,picked));
  const ready=alive(1-u.pid).filter(e=>e.np>=RULES.ultCost&&canUlt(e));
  if(ready.length){
    const likely=[...alive(u.pid)].sort((a,b)=>maxHp(b)-maxHp(a))[0]; // 単体宝具が来そうな相手（つよいの狙い方と同じく大物）
    if((ready.some(ultNoTarget)||ts.includes(likely))&&!ts.some(t=>has(t,'evade')||has(t,'invul'))) return Math.max(base,5);
    return base;
  }
  return ts.some(t=>hpR(t)<.35) ? base : Math.min(base,0);
}
// スキルの使いどき：効果ごとに「今使う価値」を点数化し、2点以上なら使う
function cpuSkillScore(u,si){
  const s=D(u.def).skills[si];
  return cpuEffScore(u,s.eff,s.pick?cpuPickTarget(u.uid,si,false):null,si);
}
// 効果の並び（スキル・令呪）の「今使う価値」。si はスキル番号（スキル以外は -1）
function cpuEffScore(u,effs,picked,si){
  const allies=alive(u.pid), enemies=alive(1-u.pid), stars=G.players[u.pid].stars;
  let sc=0;
  for(const e of effs){
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
      case 'heal': sc+=ts.some(t=>maxHp(t)-t.hp>=e.v*.7)?3:0; break;
      case 'regenHp': case 'maxHp': sc+=ts.some(t=>hpR(t)<.8)?2:1; break;
      case 'regenNp': sc+=ts.some(t=>t.np<RULES.ultCost)?2:.5; break;
      case 'regenStar': case 'onHitStar': sc+=1.5; break;
      case 'onHitNp': sc+=ts.some(t=>t.np<RULES.ultCost)?1.5:.5; break;
      case 'counter': sc+=ts.some(t=>t.pid===u.pid)?2:-1; break;
      case 'atkVs': sc+=acting&&enemies.some(x=>x.fx.some(f=>e.vs?f.k===e.vs:FX[f.k].buff===false))?3:.5; break;
      case 'critDown': sc+=foes.length?1.5:-1; break;
      case 'critMult': sc+=acting&&!G.ult&&critLevel(stars)>=3?3:0; break;
      case 'healBlock': sc+=foes.some(t=>hpR(t)<.7||t.fx.some(x=>x.k==='regenHp'))?2:1; break;
      case 'cardConv': sc+=acting?1.5:.5; break;
      case 'buffExtend': sc+=ts.some(t=>t.fx.some(x=>FX[x.k].buff===true&&x.turns!=null))?2:0; break;
      case 'skillCharge': sc+=ts.some(t=>t.used.some((x,i)=>x&&!(t===u&&i===si)))?3:-1; break;
      case 'cleanse': sc+=ts.some(t=>t.fx.some(x=>FX[x.k].buff===false))?2:0; break;
      case 'np': sc+=ts.some(t=>t.np<RULES.ultCost&&t.np+e.v>=RULES.ultCost)?4:ts.some(t=>t.np<RULES.ultCost)?1.5:0; break;
      case 'star': sc+=G.ult?.5:2; break;
      case 'stun': case 'charm': sc+=3; break;
      case 'poison': case 'burn': sc+=ts.some(t=>!has(t,e.k))?2:0; break;
      case 'curse': case 'atkDown': sc+=2; break;
      case 'strip': sc+=ts.some(t=>t.fx.some(x=>FX[x.k].buff))?2:0; break;
      case 'defDown': sc+=ts.some(t=>t.pid===u.pid)?-1:1; break;
      case 'dmg': sc+=foes.length?2:0; break;
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
  if(G.level==='expert') return cpuMcTarget();
  if(cpuHard()) return cpuThreatTarget();
  let best=c[0], bs=-Infinity;
  for(const t of c){
    let d=estDamage(t); if(has(t,'invul')||has(t,'evade')) d*=.4;
    const sc = d>=t.hp&&!has(t,'guts') ? 1000+t.np+D(t.def).cost*5 : Math.min(d,t.hp)/t.hp*100+t.np*.2;
    if(sc>bs){ bs=sc; best=t; }
  }
  return best;
}

// ---------- つよい：脅威度で攻撃対象を選ぶ ----------
// 検証で効いた考え方（AGENTS.md §6-10）：
//  - 削れる割合より「危険な相手（攻撃力・宝具の強い大物）」を集中して狙う
//  - 倒せるからといって小物を優先しない（倒すと相手の残りが行動回数+1になる）
//  - 倒し切れない相手を殴って宝具ゲージを100%に乗せない（被弾1回ごとに NP+gaugeOnHit）
//  - 回避・無敵がある相手は後回し
const cpuThreat = t=>avgDmg(t)*1.5+ultPower(t)*.3+40;
function cpuThreatTarget(){
  const c=targetCandidates();
  const hits=G.ult?D(U(G.ult).def).ult.eff.filter(e=>e.k==='dmg').length:G.rolled.filter(r=>r.cmd.dmg>0).length;
  let best=c[0], bs=-Infinity;
  for(const t of c){
    let d=estDamage(t); if(has(t,'invul')||has(t,'evade')) d*=.4;
    const th=cpuThreat(t), kill=d>=t.hp&&!has(t,'guts');
    let sc=Math.min(d,t.hp)/maxHp(t)*th + th*.5;
    if(kill){ if(t.np>=70) sc+=ultPower(t)*.5; } // 宝具が近い相手を倒せるなら止める
    else if(t.np<RULES.ultCost && !has(t,'curse') && t.np+hits*RULES.gaugeOnHit>=RULES.ultCost) sc-=ultPower(t)*.3;
    if(sc>bs){ bs=sc; best=t; }
  }
  return best;
}

// ---------- 超つよい：攻撃対象を先読みで選ぶ（モンテカルロ） ----------
// 候補ごとに局面をコピーし、その相手を攻撃してから両陣営「つよい」で決着まで MC_ROLLOUTS 回進めて、勝った回数が多い相手を選ぶ。
// 実際の出目は知らない（試しの乱数は別物）。ルール処理はエンジンそのものなので、ルールを変えても追従する
let cpuMcMemo=null;
function cpuMcTarget(){
  const c=targetCandidates();
  if(c.length<2) return c[0];
  const key=`${G.seed}|${G.turn}|${G.ult}|${G.rolled.length}`;
  if(cpuMcMemo&&cpuMcMemo.key===key&&c.some(u=>u.uid===cpuMcMemo.uid)) return U(cpuMcMemo.uid);
  const score=cpuMcScores(c.map(t=>()=>{ G.target=t.uid; resolveDamage(); }));
  let bi=0; score.forEach((s,i)=>{ if(s>score[bi]) bi=i; });
  cpuMcMemo={key, uid:c[bi].uid};
  return c[bi];
}
// 超つよい（シンプルルール）：スキル・宝具の手を先読みで選ぶ。h は「つよい」の手。
// 候補が多いと運よく高く出た手を選びがちなので、h より MC_MARGIN（勝率）以上よいときだけ h から変える
const MC_MARGIN = .1;
function cpuMcSkill(h){
  const cands=[['skillDone']];
  if(!G.ult&&!G.ultDone) alive(G.cur).forEach(u=>{ if(canUlt(u)&&u.np>=RULES.ultCost) cands.push(['useUlt',{uid:u.uid}]); });
  usableSkills().forEach(x=>{ if(D(x.u.def).skills[x.si].eff.length) cands.push(['useSkill',{uid:x.u.uid,si:String(x.si)}]); });
  if(cands.length<2) return h;
  const score=cpuMcScores(cands.map(m=>()=>ACTIONS[m[0]](m[1]||{})));
  const hi=cands.findIndex(m=>JSON.stringify(m)===JSON.stringify(h));
  let bi=0; score.forEach((s,i)=>{ if(s>score[bi]) bi=i; });
  return hi<0||score[bi]-score[hi]>=MC_MARGIN*MC_ROLLOUTS ? cands[bi] : h;
}
// 候補（局面を進める関数）ごとに、両陣営「つよい」で決着まで MC_ROLLOUTS 回試した評価の合計
function cpuMcScores(moves){
  const me=G.cur, cap=G.turn+MC_TURNS, rnd=Math.random;
  // エンジンが触る画面用の状態も退避して、試しの後に元へ戻す
  const save={g:JSON.stringify(G), G, fxq:FXQ.slice(), hold:JSON.stringify(FXHOLD), hide:[...FXHIDE], ko:KO_PEND.slice()};
  const reset=()=>{ G=JSON.parse(save.g); G.level='hard'; FXQ.length=0; for(const k in FXHOLD) delete FXHOLD[k]; FXHIDE.clear(); KO_PEND.length=0; KO_PEND.push(...save.ko); };
  const score=moves.map(()=>0);
  try{
    for(let r=0;r<MC_ROLLOUTS;r++){
      const seed=Math.floor(rnd()*2147483647);
      moves.forEach((mv,i)=>{
        reset(); Math.random=cpuPrng(seed); // 候補どうしで同じ乱数列を使い、運の差を消して比べる
        mv();
        let n=0;
        while(G.phase!=='over'&&G.turn<cap&&n++<5000){
          const s=cpuDecide(); if(!s) break;
          ACTIONS[s[0]](s[1]||{}); FXQ.length=0; if(G.log.length>100) G.log.length=0;
        }
        score[i]+=cpuEval(me);
      });
    }
  } finally {
    Math.random=rnd; G=save.G;
    FXQ.length=0; FXQ.push(...save.fxq);
    for(const k in FXHOLD) delete FXHOLD[k]; Object.assign(FXHOLD,JSON.parse(save.hold));
    FXHIDE.clear(); save.hide.forEach(k=>FXHIDE.add(k));
    KO_PEND.length=0; KO_PEND.push(...save.ko);
  }
  return score;
}
// 決着していれば勝ち1/負け0、打ち切りなら残りHP（コストで重み付け）の比
function cpuEval(me){
  if(G.phase==='over') return G.winner===me?1:0;
  const side=p=>G.players[p].party.reduce((s,u)=>s+(u.out?0:u.hp/maxHp(u)*(1+D(u.def).cost/5)+.2),0);
  const a=side(me), b=side(1-me); return a/(a+b);
}
function cpuPrng(a){ return ()=>{ a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
