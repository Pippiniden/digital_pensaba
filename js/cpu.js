'use strict';
/* =====================================================================
   CPU
   cpuDecide() が「次の1手」を [type, payload] で返し、act() に渡すだけ。
   人と同じ操作経路を通るので、ルール違反の手は打てない。
   強さの調整は cpuSkillScore（スキルの使いどき）と cpuBestTarget（攻撃対象）で。
   ===================================================================== */

// 難易度。hard 以上は攻撃対象を「脅威度」で選び、宝具をダメージ見込みで撃つ。さらに攻撃対象は先読み（モンテカルロ）で決める：
// hard は軽く（試行 MC_R_HARD 回・先 MC_T_HARD ターン）、expert はじっくり（MC_R_EXPERT 回・MC_T_EXPERT ターン。シンプルルールではスキル・宝具も）
const CPU_LEVELS = {
  easy:  {name:'よわい',   desc:'スキルや攻撃対象をほぼ気まぐれに選ぶ'},
  normal:{name:'ふつう',   desc:'状況を見てスキル・行動配分・攻撃対象を選ぶ'},
  hard:  {name:'つよい',   desc:'危険な相手を狙い、攻撃対象は少し先を読んで選ぶ。宝具も撃ちどきを選ぶ'},
  expert:{name:'超つよい', desc:'攻撃対象（シンプルではスキル・宝具）をじっくり先読みして選ぶ'},
};
const cpuHard = ()=>G.level==='hard'||G.level==='expert';
// 先読み：攻撃対象の候補ごとに、決着まで（または打ち切りまで）試す回数と、1回の試しで進める最大ターン数（超えたら残りHPで評価）
// 測定（つよい旧版との対戦・3v3同コスト）：4/10 → 57% 勝ち・1回約30ms、16/40 → 64% 勝ち・1回約140ms。試行回数が強さをほぼ決め、ターン数は10まで減らしても影響が小さい
const MC_R_HARD = 4,    MC_T_HARD = 10;
const MC_R_EXPERT = 16, MC_T_EXPERT = 40;
const mcRollouts = ()=>G.level==='expert'?MC_R_EXPERT:MC_R_HARD;
const mcTurns    = ()=>G.level==='expert'?MC_T_EXPERT:MC_T_HARD;
// false にすると hard は先読みなしの脅威度判断（旧つよい）になる。バランス検証（sim.js）は速さのため false にする
let CPU_LOOKAHEAD = true;
// 先読みの試しの最中は true。試しの中の「つよい」は先読みせず脅威度で選ぶ（先読みの入れ子を防ぐ）
let cpuInRollout = false;
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
      if(G.pending) return ['cardClick',{uid:cpuPickTarget(G.pending.uid,G.pending.ult?null:G.pending.si,easy).uid}];
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
// 令呪の点数。CPU_SPELL_AGG: 'sum'=効果の点数を足す（従来）/ 'max'=一番高い効果だけ / 'avg'=効果の平均×√個数（効果が多いだけで高得点にならない）
let CPU_SPELL_AGG = 'max';
function cpuSpellScore(m,effs,t){
  const f=(CPU_SPELL_GUARD===true||CPU_SPELL_GUARD===m.pid)?cpuGuardEff:cpuEffScore;
  if(CPU_SPELL_AGG==='sum'||effs.length<2) return f(m,effs,t,-1);
  const sc=effs.map(e=>f(m,[e],t,-1)), n=sc.length;
  if(CPU_SPELL_AGG==='max') return Math.max(...sc);
  return sc.reduce((a,b)=>a+b,0)/n*Math.sqrt(n);
}
function cpuMaster(easy){
  const m=masterOf(G.cur), d=D(m.def), P=G.players[G.cur], em=masterOf(1-G.cur), es=alive(1-G.cur)[0], rs=ruleset();
  // 令呪の価値が一番高いもの（マスターチームで対象を選ぶ令呪は、味方ごとに試して一番よい1騎）
  const spellBest=()=>{ let best={i:0,sc:-Infinity,uid:null};
    d.spells.forEach((s,i)=>{ if(P.spellUsed[i]||!s.eff.length) return;
      (spellPicks(s)?pickCands(pickSide(s.eff),G.cur):[null]).forEach(t=>{ const v=cpuSpellScore(m,s.eff,t)+cpuSpellKill(m,s.eff,t); if(v>best.sc) best={i,sc:v,uid:t&&t.uid}; }); });
    return best; };
  if(G.spellPick){ // 対象の選択待ち（補助の「選んだ敵1体」など）：一番効く相手を選ぶ
    const sp=G.spellPick, effs=sp.sup?sp.sup.eff:d.spells[sp.i].eff;
    let best=null, bs=-Infinity;
    pickCands(sp.side,G.cur).forEach(t=>{ const v=cpuEffScore(m,effs,t,-1)+(t.pid!==G.cur?(1-hpR(t))*.01:0); if(v>bs){ bs=v; best=t; } });
    return best?['cardClick',{uid:best.uid}]:null;
  }
  if(P.spell==='decl'){ const b=spellBest(); return ['masterSpellUse',{i:String(b.i),...(b.uid?{uid:b.uid}:{})}]; }
  if(rs.mTeam){ // マスターチーム：補助か令呪（行動-1と引き換えなので、価値が高いときだけ）
    if(!easy&&canDeclareSpell()&&!spellReserved(m)){ const b=spellBest(); if(b.sc-spellActCost()-spellKeepValue(m)>=spellMinTeam()) return ['masterSpell',{i:String(b.i),...(b.uid?{uid:b.uid}:{})}]; }
    return ['masterSupport'];
  }
  const opts=[['masterSupport']];
  if(es) opts.push(['masterAttack',{to:'svt'}]);
  if(em&&!em.out&&!G.players[em.pid].evac) opts.push(['masterAttack',{to:'master'}]);
  if(easy) return opts[Math.floor(rnd01(`${G.turn}m`)*opts.length)];
  if(canDeclareSpell()&&P.stars>=rs.spellNowStars){ const b=spellBest(); if(b.sc>=4) return ['masterSpell',{now:'1',i:String(b.i),...(b.uid?{uid:b.uid}:{})}]; }
  if(es&&masterAtkDmg(m,es)>=es.hp&&!has(es,'guts')) return ['masterAttack',{to:'svt'}];
  // 相手マスターへの攻撃は、倒せば相手サーヴァントにマスターの最大HP分のダメージ（相手が令呪で守る場合もある）
  if(em&&!em.out&&!G.players[em.pid].evac&&d.cost>=2) return ['masterAttack',{to:'master'}];
  return ['masterSupport'];
}
// 令呪のダメージで敵サーヴァントを倒しきれるときの加点（1騎につき +KILL_BONUS）。固定ダメージなので無敵・回避・補正は関係なく、根性持ちは倒せない扱い。
// CPU_SPELL_KILL: true=両陣営で有効 / 0・1=その陣営だけ有効（バランス検証の比較用）/ false=無効
let CPU_SPELL_KILL = true;
let CPU_SPELL_RESERVE = false; // 自分のマスターが次の一撃で倒れる位置にいるとき、最後の1画は防御用に取っておく（true=両陣営 / 0・1=その陣営だけ）
// 相手が次に出せる「敵マスターへの最大ダメージ」（補助ダイスの面と、未使用の令呪）
function masterThreat(pid){
  const fm=masterOf(1-pid); if(!fm||fm.out) return 0; const fd=D(fm.def), Pf=G.players[1-pid]; let mx=0;
  const scan=effs=>effs.forEach(x=>{ if(x.k==='dmg'&&(x.t==='enemy_master'||x.t==='enemy_both')) mx=Math.max(mx,effVal(x,masterOf(pid))); });
  fd.faces.forEach(f=>scan(f.eff)); fd.spells.forEach((sp,i)=>{ if(!Pf.spellUsed[i]) scan(sp.eff); });
  return mx;
}
let CPU_SPELL_RESERVE_SKIP = null; // 比較用：このマスターIDは取っておかない
const spellReserved = m=>m.def!==CPU_SPELL_RESERVE_SKIP&&(CPU_SPELL_RESERVE===true||CPU_SPELL_RESERVE===m.pid)&&G.players[m.pid].spellLeft<=1&&m.hp<=masterThreat(m.pid);
// 令呪を防御用に取っておく価値（期待値）：相手の一撃で自分のマスターが倒れる確率 × 倒れたときの損失（最大HP×生存サーヴァント数。100ダメージ=1点）× 係数。
// 確率＝補助ダイスの致命面の数/6 ＋ 未使用の致命令呪があれば0.5（上限1）。係数 CPU_SPELL_EVK=0 で無効。
let CPU_SPELL_EVK = 0; // true の代わりに数値。0=見ない
function spellKeepValue(m){
  if(!CPU_SPELL_EVK||m.def===CPU_SPELL_RESERVE_SKIP||m.hp<=0) return 0;
  const fm=masterOf(1-m.pid); if(!fm||fm.out) return 0;
  const fd=D(fm.def), Pf=G.players[1-m.pid]; let faces=0, spells=0;
  const lethal=effs=>effs.some(x=>x.k==='dmg'&&(x.t==='enemy_master'||x.t==='enemy_both')&&effVal(x,m)>=m.hp);
  fd.faces.forEach(f=>{ if(lethal(f.eff)) faces++; });
  fd.spells.forEach((sp,i)=>{ if(!Pf.spellUsed[i]&&lethal(sp.eff)) spells++; });
  const p=Math.min(1,faces/6+(spells?.5:0)); if(!p) return 0;
  return CPU_SPELL_EVK*p*D(m.def).hp*alive(m.pid).length/100;
}
let CPU_SPELL_SETUP = 0; // 敵マスターへの削りダメージ＝次の令呪で仕留められる残りHPにする布石の加点（0=見ない）
let CPU_SPELL_BURN = 0; // 敵マスターへの「防がれる大ダメージ」＝相手の令呪を切らせる手の加点（1画あたり。0=見ない）
let CPU_SPELL_GUARD = false; // 測定の結果オフ（慎二入り4万試合で49.1%、全マスター3万試合で49.8%＝改善なし）。true=両陣営 / 0・1=その陣営だけ（比較用）/ false=無効。 令呪の回避・無敵も、敵の宝具に合わせて使う（cpuGuardEff）
const cpuSpellNew = pid=>CPU_SPELL_KILL===true||CPU_SPELL_KILL===pid;
// マスターチームで令呪を使う最低点（行動-1と引き換え）。令呪の点数を「一番高い効果だけ」にして（CPU_SPELL_AGG）4に戻した（効果が多いだけで高得点になり、使いすぎるマスターがいたため）。マスタールールの宣言方式は、点をいくつにしても負けたので使わない
let SPELL_MIN_TEAM = 4;
// 令呪を使うと、割り振った行動が1回減る（一番多く割り振った騎から）。その1回分の期待ダメージを点数に換算して引く
let CPU_SPELL_COSTPID = true; // true=両陣営 / 0・1=その陣営だけ（比較用）
let CPU_SPELL_COSTK = 0; // 100ダメージ=何点か（0=引かない）
function spellActCost(){
  const k=CPU_SPELL_COSTK; if(!k||!(CPU_SPELL_COSTPID===true||CPU_SPELL_COSTPID===G.cur)) return 0;
  const top=Object.entries(G.alloc).filter(([,n])=>n>0).sort((a,b)=>b[1]-a[1])[0]; if(!top) return 0;
  const less={...G.alloc,[top[0]]:top[1]-1};
  return Math.max(0,allocEV(G.alloc,true)-allocEV(less,true))/100*k;
}
let SPELL_MIN_BY = {}; // 比較用：マスターID別に最低点を上書き
const spellMinTeam = ()=>{ const m=masterOf(G.cur); return m&&SPELL_MIN_BY[m.def]!=null?SPELL_MIN_BY[m.def]:cpuSpellNew(G.cur)?SPELL_MIN_TEAM:4; };
const KILL_BONUS = 6;
function cpuSpellKill(m,effs,picked){
  if(!cpuSpellNew(m.pid)) return 0;
  const foes=alive(1-m.pid); let n=0, sc0=0;
  const killable=(t,v)=>!t.out&&!has(t,'guts')&&v>=t.hp;
  for(const e of effs){
    if(e.k!=='dmg') continue;
    if(e.t==='enemy_svt'){ if(picked&&picked.pid!==m.pid&&killable(picked,effVal(e,picked))) n++; }
    else if(e.t==='enemy_all'||e.t==='enemy_both') n+=foes.filter(t=>killable(t,effVal(e,t))).length;
    // 敵マスターへのダメージ：倒すと敵サーヴァントがマスターの最大HP分のダメージを受ける。
    // ただし相手に令呪が残っていれば（cpuGuard が）防ぐので無駄になる。守れないときだけ、巻き込んで倒せる数を加点
    if(e.t==='enemy_master'||e.t==='enemy_both'){
      const em=masterOf(1-m.pid);
      // 倒しきれるダメージは、相手に令呪が残っていれば防がれて「相手の令呪を1画切らせる」手になる。相手に使える令呪が残っているときだけ加点
      // 倒しきれない大ダメージでも、次の令呪で仕留められる残りHPまで削れるなら、相手に令呪を切らせる布石になる
      if(CPU_SPELL_SETUP&&em&&!em.out&&effVal(e,em)<em.hp){
        const Pm=G.players[m.pid]; let mx=0;
        D(m.def).spells.forEach((sp,i)=>{ if(Pm.spellUsed[i]||sp.eff===effs) return; sp.eff.forEach(x=>{ if(x.k==='dmg'&&(x.t==='enemy_master'||x.t==='enemy_both')) mx=Math.max(mx,effVal(x,em)); }); });
        if(mx>0&&em.hp-effVal(e,em)<=mx) sc0+=CPU_SPELL_SETUP;
      }
      if(CPU_SPELL_BURN&&em&&!em.out&&canGuardSpell(em.pid)&&effVal(e,em)>=em.hp){
        const Pe=G.players[em.pid], left=Math.min(Pe.spellLeft,Pe.spellUsed.filter((u,i)=>!u&&D(em.def).spells[i].eff.length).length);
        if(left>0) sc0+=CPU_SPELL_BURN*left;
      }
      if(em&&!em.out&&!canGuardSpell(em.pid)&&effVal(e,em)>=em.hp){
        const full=D(em.def).hp;
        n+=foes.filter(t=>!has(t,'guts')&&t.hp<=full).length;
      }
    }
  }
  return n*KILL_BONUS+sc0;
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
  const base=d.faces.reduce((s,f)=>{ const c=u.asc?f.post:f.pre; return s+(c.dmg||0)*hitsOf(c.eff)+(c.c==='ASC'?40:0); },0)/6;
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
  const m=dmgMods(u,tgt,c.c==='W'?null:c.c); let d=applyPct(Math.max(0,c.dmg+m.sum),m.pct);
  if(stars>0&&c.c!=='W'){
    const p=ruleset().crit==='d6'?Math.min(1,critNeedD6(stars)/6):critChance(critLevel(stars))/100;
    d+=p*((c.c==='R'?RULES.critDmgR:RULES.critDmg)+m.colorBuff);
  }
  return d*hitsOf(c.eff)*(isAoe(c.eff)?Math.max(1,alive(tgt.pid).length):1);
}
function allocEV(alloc,noChain){
  const tgt=[...alive(1-G.cur)].sort((a,b)=>maxHp(b)-maxHp(a))[0], stars=G.players[G.cur].stars;
  const slots=[]; Object.entries(alloc).forEach(([uid,n])=>{ for(let i=0;i<n;i++) slots.push(U(uid)); });
  if(!slots.length) return 0;
  // 1回ごとの期待値は独立なので足し合わせ、Busterチェインだけ「3回ともBuster」の確率で加える
  const per=new Map();
  const stat=u=>{ if(!per.has(u)){ const cs=[0,1,2,3,4,5].map(f=>cmdOf(u,f));
    per.set(u,{v:cs.reduce((s,c)=>s+cmdValue(u,c,stars,tgt),0)/6, pR:cs.filter(c=>c.c==='R'&&c.dmg>0).length/6,
      ex:cs.reduce((s,c)=>s+(c.c==='ASC'?(u.asc?0:ASC_VALUE):(c.dmg||0)*hitsOf(c.eff)),0)/6}); } return per.get(u); };
  let v=slots.reduce((s,u)=>s+stat(u).v,0);
  if(slots.length===3&&!noChain) v+=slots.reduce((p,u)=>p*stat(u).pR,1)*RULES.chainR*3;
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
  const ud=D(u.def).ult, h=hitsOf(ud.eff), up=mods(u,'npPow').sum-mods(u,'npPowDown').sum;
  const one=e=>e.max?Math.max(0,...alive(1-u.pid).map(maxHp)):Math.max(0,e.v+up);
  return ud.eff.filter(e=>e.k==='dmg').reduce((s,e)=>s+one(e)*h*(e.t==='enemy_all'?alive(1-u.pid).length:1),0);
}
function cpuUltUser(){
  const c=alive(G.cur).filter(u=>canUlt(u)&&u.np>=RULES.ultCost);
  const u=c.sort((a,b)=>ultPower(b)-ultPower(a))[0]||null;
  // つよい以上：攻撃宝具は、このターンの通常攻撃の見込みダメージを下回るなら温存する
  if(u&&cpuHard()&&ultPower(u)>0&&ultPower(u)<turnPower()) return null;
  return u;
}
// このターンに割り振った行動の見込みダメージ。つよい以上は allocEV（クリティカル期待値・ブレイブチェインの追加攻撃を含み、Busterチェインは含めない）
function turnPower(){
  if(cpuHard()) return allocEV(G.alloc,true);
  return Object.entries(G.alloc).reduce((s,[uid,n])=>s+n*avgDmg(U(uid)),0)+(Object.values(G.alloc).some(n=>n===3)?60:0);
}
function usableSkills(){
  const out=[];
  alive(G.cur).forEach(u=>{ if(!canSkill(u)) return;
    D(u.def).skills.forEach((s,si)=>{ if(skillUsable(u,si)) out.push({u,si}); }); });
  return out;
}
function cpuNextSkill(easy){
  const list=usableSkills();
  if(easy) return list.find(x=>rnd01(`${G.turn}s${x.u.uid}${x.si}`)<.3)||null;
  let best=null;
  for(const x of list){ const sc=cpuHard()?cpuGuardScore(x.u,x.si):cpuSkillScore(x.u,x.si); if(sc>=(cpuHard()?3:2)&&(!best||sc>best.sc)) best={...x,sc}; } // つよい以上は3点以上で使う（2→3は勝率同等だった）
  return best;
}
// つよい（チームバトル）：回避・無敵を含むスキルは、敵の宝具（NP100%）に合わせて使う。
// 敵が宝具を撃てる → 狙われそうな味方（全体宝具なら誰でも）に回避・無敵が付くなら最優先。
// そうでなければ、倒れそうなとき（HP35%未満）まで温存する。シンプルルールでは効果がなかったので使わない
function cpuGuardScore(u,si){
  const s=D(u.def).skills[si];
  return cpuGuardEff(u,s.eff,s.pick?cpuPickTarget(u.uid,si,false):null,si);
}
// 効果の並び（スキル・令呪）に回避・無敵があるとき、敵の宝具に合わせた点数にする
function cpuGuardEff(u,effs,picked,si){
  const base=cpuEffScore(u,effs,picked,si);
  if(ruleset().partyMax===1) return base;
  const gs=effs.filter(e=>e.k==='evade'||e.k==='invul'); if(!gs.length) return base;
  const ts=gs.flatMap(e=>e.t==='master'?[]:resolveTargets(u,e.t,picked));
  const ready=alive(1-u.pid).filter(e=>e.np>=RULES.ultCost&&canUlt(e));
  if(ready.length){
    const likely=[...alive(u.pid)].sort((a,b)=>maxHp(b)-maxHp(a))[0]; // 単体宝具が来そうな相手（つよいの狙い方と同じく大物）
    if((ready.some(ultNoTarget)||ts.includes(likely))&&!ts.some(t=>has(t,'evade')||has(t,'invul'))) return Math.max(base,5);
    return base;
  }
  return ts.some(t=>hpR(t)<.35) ? base : Math.min(base,0);
}
// つよい以上：このターンの攻撃回数（宝具を撃つならその1回、通常ならその対象が割り振られた行動数の合計）
function attackCount(ts){
  if(G.ult) return ts.some(t=>t.uid===G.ult)?1:0;
  return ts.reduce((s,t)=>s+(G.alloc[t.uid]||0),0);
}
// 攻撃強化：対象が何回攻撃するかで価値が決まる（3回以上は迷わず、2回で使う、1回だけなら温存。数ターン続く強化は1回でも少し価値あり）
function atkBuffScore(e,ts){
  const n=attackCount(ts.filter(t=>t.pid===G.cur));
  if(n>=3) return 4;
  if(n===2) return 3;
  return n===1&&(e.turns||0)>1 ? 2 : n===1 ? 1.5 : 0;
}
// スター付与：次のクリティカルレベル（シンプルルールは出目の上限）に届いて、その分の期待ダメージ（攻撃回数×上昇した確率×クリティカル追加ダメージ）が見込めるときに使う
function starSkillScore(v,pid){
  if(G.ult) return .5;
  const st=G.players[pid].stars, d6=ruleset().crit==='d6';
  const p=s=>s<=0?0:d6?Math.min(1,critNeedD6(s)/6):critChance(critLevel(s))/100;
  const n=Object.values(G.alloc).reduce((s,x)=>s+x,0);
  return n*(p(st+v)-p(st))*RULES.critDmg/4.5;
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
    if(FX[e.k]&&FX[e.k].noTgt) continue; // 説明文・連続攻撃（スキルでは使わない）
    let ts=e.t==='master'?[]:resolveTargets(u,e.t,picked);
    if(e.cond){ // 条件つき：付与時に見る効果は条件を満たす対象だけ／使う瞬間に見る効果（攻撃・防御補正）は条件を満たす敵がいるときだけ
      if(FX[e.k]&&FX[e.k].condUse&&!e.cond.self){ if(!enemies.some(x=>condOk(e.cond,x))) continue; }
      else ts=ts.filter(t=>condOk(e.cond,t));
    }
    const acting=ts.some(isActing);
    const foes=ts.filter(t=>t.pid!==u.pid);
    switch(e.k){
      case 'atkPct': sc+=acting?3:0; break;
      case 'atk': sc+=cpuHard()?atkBuffScore(e,ts):acting?3:0; break;
      case 'critPow': sc+=acting&&!G.ult&&critLevel(stars)>=3?3:0; break;
      case 'ignoreDef': sc+=acting&&enemies.some(x=>has(x,'def'))?3:.5; break;
      case 'debuffImmune': sc+=ts.some(t=>hpR(t)<.7)?1.5:.5; break;
      case 'buffImmune': sc+=foes.length?2:-1; break;
      case 'fear': case 'actsDown': case 'sealSkill': sc+=foes.length?2:-1; break;
      case 'sealUlt': sc+=foes.some(t=>t.np>=RULES.ultCost-30)?4:foes.length?1:-1; break;
      case 'spread': sc+=foes.some(t=>has(t,'burn'))?2:.5; break;
      case 'instantDeath': sc+=foes.length?5:-5; break;
      case 'drain': sc+=foes.length?2:-1; break;
      case 'cleanseMental': sc+=ts.some(t=>t.fx.some(x=>FX[x.k].mental))?3:0; break;
      case 'mentalImmune': sc+=.5; break;
      case 'deathImmune': sc+=enemies.some(x=>x.fx.some(f=>f.k==='instantDeath'))||ts.some(t=>hpR(t)<.5)?1:.3; break;
      case 'stripImmune': sc+=ts.some(t=>t.fx.some(x=>FX[x.k].buff))?1:.3; break;
      case 'npDownImmune': case 'starLossImmune': sc+=.3; break;
      case 'nullUnder': sc+=ts.some(t=>hpR(t)<.8)?2:1; break;
      case 'actsUp': sc+=ts.length&&!foes.length?2:0; break;
      case 'starLoss': sc+=foes.some(t=>G.players[t.pid].stars>0)?2:0; break;
      case 'critRoll': sc+=acting&&!G.ult&&stars>0?2:0; break;
      case 'aoeNormal': sc+=acting&&enemies.length>=2?3:.3; break;
      case 'sureHit': sc+=acting&&enemies.some(x=>has(x,'evade'))?4:.5; break;
      case 'pierce': sc+=acting&&enemies.some(x=>has(x,'evade')||has(x,'invul'))?4:.5; break;
      case 'def': case 'evade': case 'invul': sc+=ts.some(t=>hpR(t)<.6)?3:0; break;
      case 'guts': sc+=ts.some(t=>hpR(t)<.5)?4:0; break;
      case 'taunt': sc+=hpR(u)>=.5&&allies.some(a=>a!==u&&hpR(a)<.5)?3:0; break;
      case 'heal': sc+=ts.some(t=>maxHp(t)-t.hp>=e.v*.7)?3:0; break;
      case 'regenHp': case 'maxHp': sc+=ts.some(t=>hpR(t)<.8)?2:1; break;
      case 'regenNp': sc+=ts.some(t=>t.np<RULES.ultCost)?2:.5; break;
      case 'regenStar': case 'onHitStar': sc+=1.5; break;
      case 'hitNpUp': sc+=ts.some(t=>t.np<RULES.ultCost)?1.5:.5; break;
      case 'onHitNp': sc+=ts.some(t=>t.np<RULES.ultCost)?1.5:.5; break;
      case 'counter': sc+=ts.some(t=>t.pid===u.pid)?2:-1; break;
      case 'atkVs': sc+=acting&&enemies.some(x=>x.fx.some(f=>e.vs?f.k===e.vs:FX[f.k].buff===false))?3:.5; break;
      case 'atkTrait': sc+=acting&&traitsOf(cpuPredictTarget()).includes(e.trait)?3:0; break; // 殴る予定の相手（cpuPredictTarget）がその属性のときだけ使う
      case 'defTrait': sc+=ts.some(t=>t.pid===u.pid&&hpR(t)<.8)&&enemies.some(x=>traitsOf(x).includes(e.trait))?2.5:.5; break;
      case 'critDown': sc+=foes.length?1.5:-1; break;
      case 'starDown': sc+=foes.length?1:-1; break;
      case 'debuffUp': sc+=acting?1:0; break;
      case 'debuffResDown': sc+=foes.length?1:-1; break;
      case 'debuffDown': sc+=foes.length?1.5:-1; break;
      case 'buffDown': sc+=foes.length?1.5:-1; break;
      case 'critMult': sc+=acting&&!G.ult&&critLevel(stars)>=3?3:0; break;
      case 'healBlock': sc+=foes.some(t=>hpR(t)<.7||t.fx.some(x=>x.k==='regenHp'))?2:1; break;
      case 'cardConv': sc+=acting?1.5:.5; break;
      case 'buffExtend': sc+=ts.some(t=>t.fx.some(x=>FX[x.k].buff===true&&x.turns!=null))?2:0; break;
      case 'skillCharge': sc+=ts.some(t=>t.used.some((x,i)=>x&&!(t===u&&i===si)))?3:-1; break;
      case 'cleanse': sc+=ts.some(t=>t.fx.some(x=>e.vs?x.k===e.vs:FX[x.k].buff===false))?2:0; break;
      case 'np': sc+=ts.some(t=>t.np<RULES.ultCost&&t.np+e.v>=RULES.ultCost)?4:ts.some(t=>t.np<RULES.ultCost)?1.5:0; break;
      case 'star': sc+=cpuHard()?starSkillScore(e.v,u.pid):G.ult?.5:2; break;
      case 'stun': case 'charm': sc+=3; break;
      case 'poison': case 'burn': sc+=ts.some(t=>!has(t,e.k))?2:0; break;
      case 'curse': case 'hitNpSeal': case 'atkDown': case 'atkPctDown': sc+=2; break;
      case 'strip': sc+=ts.some(t=>t.fx.some(x=>e.vs?x.k===e.vs:FX[x.k].buff))?2:0; break;
      case 'defDown': sc+=ts.some(t=>t.pid===u.pid)?-1:1; break;
      case 'dmg': sc+=foes.length?2:0; break;
      case 'npPow': sc+=ts.some(t=>G.ult===t.uid||(t.np>=RULES.ultCost&&!G.ult))?3:.5; break;
      case 'npPowDown': sc+=foes.some(t=>t.np>=RULES.ultCost-30)?2.5:foes.length?.5:-1; break;
      case 'selfDmg': sc-=ts.reduce((s,t)=>s+(t.pid===u.pid?(effVal(e,t)>=t.hp?6:effVal(e,t)/maxHp(t)*4):-1.5),0); break; // 味方が倒れる自傷は使わない
    }
  }
  return sc;
}
// スキルを使う段階で殴る相手を予測する（攻撃対象は後のターゲット段階で決まるため）。
// 候補のうち脅威度（cpuThreat）が最も高い相手＝つよいの脅威度判断が選びそうな相手
function cpuPredictTarget(){
  const c=targetCandidates();
  return c.reduce((b,t)=>cpuThreat(t)>cpuThreat(b)?t:b, c[0]);
}
function cpuPickTarget(uid,si,easy){
  const u=U(uid), s=si==null?D(u.def).ult:D(u.def).skills[si]; // si なし＝宝具
  const cands=skillCands(u,s);
  if(!cands.length) return u;
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
    const up=mods(u,'npPow').sum-mods(u,'npPowDown').sum;
    return ud.eff.filter(e=>e.k==='dmg').reduce((s,e)=>s+(e.max?maxHp(t):(dm=>applyPct(Math.max(0,e.v+dm.sum+up),dm.pct))(dmgMods(u,t,ud.c))),0)*hitsOf(ud.eff);
  }
  const cols=G.rolled.map(r=>r.cmd.c), chainR=G.rolled.length===3&&cols.every(c=>c==='R');
  return G.rolled.reduce((s,r)=>{
    const c=r.cmd; if(!c.dmg) return s;
    const a=U(r.uid), dm=dmgMods(a,t,c.c), d=applyPct(Math.max(0,c.dmg+dm.sum)+(chainR?RULES.chainR:0),dm.pct);
    return s+d*hitsOf(c.eff)*(isAoe(c.eff)?Math.max(1,alive(t.pid).length):1);
  },0);
}
function cpuBestTarget(easy){
  const c=targetCandidates();
  if(easy) return c[Math.floor(rnd01(`${G.turn}t`)*c.length)];
  if(G.level==='expert'||(G.level==='hard'&&CPU_LOOKAHEAD&&!cpuInRollout)) return cpuMcTarget();
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
// 検証で効いた考え方（docs/agents/engine-notes.md 項目9）：
//  - 削れる割合より「危険な相手（攻撃力・宝具の強い大物）」を集中して狙う
//  - 倒せるからといって小物を優先しない（倒すと相手の残りが行動回数+1になる）
//  - 倒し切れない相手を殴って宝具ゲージを100%に乗せない（被弾1回ごとに NP+gaugeOnHit）
//  - 回避・無敵がある相手は後回し
const cpuThreat = t=>avgDmg(t)*1.5+ultPower(t)*.3+40;
function cpuThreatTarget(){
  const c=targetCandidates();
  const hits=G.ult?D(U(G.ult).def).ult.eff.filter(e=>e.k==='dmg').length*hitsOf(D(U(G.ult).def).ult.eff):G.rolled.reduce((s,r)=>s+(r.cmd.dmg>0?hitsOf(r.cmd.eff):0),0);
  let best=c[0], bs=-Infinity;
  for(const t of c){
    let d=estDamage(t); if(has(t,'invul')||has(t,'evade')) d*=.4;
    const th=cpuThreat(t), kill=d>=t.hp&&!has(t,'guts');
    let sc=Math.min(d,t.hp)/maxHp(t)*th + th*.5;
    if(kill){ if(t.np>=70) sc+=ultPower(t)*.5; } // 宝具が近い相手を倒せるなら止める
    else if(t.np<RULES.ultCost && !has(t,'curse') && !has(t,'hitNpSeal') && t.np+hits*RULES.gaugeOnHit>=RULES.ultCost) sc-=ultPower(t)*.3;
    if(sc>bs){ bs=sc; best=t; }
  }
  return best;
}

// ---------- 超つよい：攻撃対象を先読みで選ぶ（モンテカルロ） ----------
// 候補ごとに局面をコピーし、その相手を攻撃してから両陣営「つよい」（先読みなし）で決着まで mcRollouts() 回進めて、勝った回数が多い相手を選ぶ。
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
  return hi<0||score[bi]-score[hi]>=MC_MARGIN*mcRollouts() ? cands[bi] : h;
}
// 候補（局面を進める関数）ごとに、両陣営「つよい」（先読みなし）で決着まで mcRollouts() 回試した評価の合計
function cpuMcScores(moves){
  const me=G.cur, cap=G.turn+mcTurns(), R=mcRollouts(), rnd=Math.random;
  // エンジンが触る画面用の状態も退避して、試しの後に元へ戻す
  const save={g:JSON.stringify(G), G, fxq:FXQ.slice(), hold:JSON.stringify(FXHOLD), hide:[...FXHIDE], ko:KO_PEND.slice()};
  const reset=()=>{ G=JSON.parse(save.g); G.level='hard'; FXQ.length=0; for(const k in FXHOLD) delete FXHOLD[k]; FXHIDE.clear(); KO_PEND.length=0; KO_PEND.push(...save.ko); };
  const score=moves.map(()=>0);
  cpuInRollout=true;
  try{
    for(let r=0;r<R;r++){
      const seed=Math.floor(rnd()*2147483647);
      moves.forEach((mv,i)=>{
        reset(); Math.random=cpuPrng(seed); // 候補同士で同じ乱数列を使い、運の差を消して比べる
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
    cpuInRollout=false; Math.random=rnd; G=save.G;
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
