'use strict';
/* =====================================================================
   CPU
   cpuDecide() が「次の1手」を [type, payload] で返し、act() に渡すだけ。
   人と同じ操作経路を通るので、ルール違反の手は打てない。
   強さの調整は cpuSkillScore（スキルの使いどき）と cpuBestTarget（攻撃対象）で。
   ===================================================================== */

// 難易度。hard 以上は攻撃対象を「脅威度」で選び、宝具をダメージ見込みで撃つ。さらに攻撃対象は先読み（モンテカルロ）で決める：
// hard は軽く（試行 MC_R_HARD 回・先 MC_T_HARD ターン）、expert はじっくり（MC_R_EXPERT 回・MC_T_EXPERT ターン。スキル・宝具も）
const CPU_LEVELS = {
  easy:  {name:'よわい',   desc:'スキルや攻撃対象をほぼ気まぐれに選ぶ'},
  normal:{name:'ふつう',   desc:'状況を見てスキル・行動配分・攻撃対象を選ぶ'},
  hard:  {name:'つよい',   desc:'危険な相手を狙い、攻撃対象は少し先を読んで選ぶ。宝具も撃ちどきを選ぶ'},
  expert:{name:'超つよい', desc:'攻撃対象・スキル・宝具をじっくり先読みして選ぶ'},
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
const actor = ()=>G.phase==='draft'?draftTurn():G.phase==='setup'?G.setupPid:G.phase==='guard'?1-G.cur:G.cur; // guard＝守る側が選ぶ
const cpuActing = ()=>!['mode','setup','over'].includes(G.phase) && isCpu(actor()); // 編成はCPU分も人が選ぶ（おまかせ＝setupCpu）
const hpR = u=>u.hp/maxHp(u);
const isActing = u=>G.ult ? G.ult===u.uid : (G.alloc[u.uid]||0)>0;
function rnd01(s){ // 「よわい」用：同じ局面では同じ答えになる疑似乱数
  let h=2166136261; for(const ch of s+G.seed){ h^=ch.charCodeAt(0); h=Math.imul(h,16777619); }
  return (h>>>0)/4294967296;
}
// ドラフト：候補から1つ取る。よわい＝気まぐれ ／ それ以外＝この先も含めて合計コストと人数がいちばん大きくなる取り方（ふつうは少しぶれる）
function cpuDraft(easy){
  const pid=draftTurn(), R=G.draft, moves=draftMoves(pid), any=a=>a[Math.floor(Math.random()*a.length)];
  if(!moves.length) return null;
  if(easy) return ['draftPick',{id:any(moves)}];
  const rs=ruleset(), top=(sc,slack)=>{ const s=moves.map(sc), best=Math.max(...s); return moves.filter((_,i)=>s[i]>=best-slack); };
  if(R.mpool.includes(moves[0])) return ['draftPick',{id:any(rs.partyMax>1?moves:top(id=>D(id).cost,0))}]; // マスター：チームはコスト補正で釣り合うので好み、1騎のルールは高コスト
  if(rs.partyMax===1) return ['draftPick',{id:any(top(id=>D(id).cost*1000+D(id).hp/10,G.level==='normal'?1000:0))}];
  // チーム：取ったあとの残り枠を、残っている候補でいちばん高く埋められる合計（＋人数ぶん）で比べる
  const free=R.pool.filter(id=>R.taken[id]==null), budget=costCap()-mcost(pid)-sumCost(G.picks[pid]), slots=rs.partyMax-G.picks[pid].length;
  const fill=(ids,room,left)=>{ let best=0; if(left>0) ids.forEach((id,i)=>{ const c=D(id).cost; if(c<=room) best=Math.max(best,c+2+fill(ids.slice(i+1),room-c,left-1)); }); return best; };
  const score=id=>D(id).cost+2+fill(free.filter(x=>x!==id),budget-D(id).cost,slots-1);
  const c=top(score,G.level==='normal'?1:0), hp=Math.max(...c.map(id=>D(id).hp));
  return ['draftPick',{id:G.level==='normal'?any(c):c.find(id=>D(id).hp===hp)}];
}
let cpuTimer=null;
function scheduleCpu(){
  clearTimeout(cpuTimer);
  if(!cpuActing()) return;
  cpuTimer=setTimeout(()=>{
    if(typeof fxBusy==='function' && fxBusy()){ scheduleCpu(); return; } // 演出の再生中は待つ
    if(G.levels) G.level=G.levels[actor()]; // 観戦：CPUごとの強さ
    const s=cpuDecide(); if(s) act(s[0],s[1]||{});
  }, G.phase==='setup'?500:G.phase==='draft'?900:G.speed);
}
// カード変換（使用時に選ぶ）の色：そのユニットに乗っている色指定の強化（攻撃+・NP獲得・スター発生・クリティカル威力）が一番多い色。同点は Buster。弱い設定ではランダム
// つよい以上（CONV_EV）：このターンに変換される味方（スキルの対象）で見込みを比べ、いちばん得な色（convGain）。見込みがどの色も0なら旧判断
let CONV_EV = true;
function cpuPickColor(u,easy){
  const cols=['R','B','G'];
  if(easy) return cols[Math.floor(rnd01()*3)];
  if(CONV_EV&&cpuHard()&&G.pending&&G.pending.colorPick){
    const s=D(u.def).skills[G.pending.si], picked=s.pick?cpuPickTarget(u.uid,G.pending.si,false):null;
    const ts=s.eff.filter(e=>e.k==='cardConvPick').flatMap(e=>resolveTargets(u,e.t,picked));
    const g=cols.map(c=>[c,convGain(ts,c)]).sort((a,b)=>b[1]-a[1]);
    if(g[0][1]>0) return g[0][0];
  }
  const sc=c=>u.fx.filter(e=>e.color===c&&FX[e.k]&&FX[e.k].buff===true).reduce((s,e)=>s+(e.v||1),0);
  return cols.map(c=>[c,sc(c)]).sort((a,b)=>b[1]-a[1])[0][0];
}
// カード変換の今ターンの見込み（ダメージ換算）：ts のコマンドを c に変えたときと変えないときの差。
// 期待ダメージ（Busterチェイン・Busterのクリティカル・色つきの攻撃強化込み＝cmdValue）＋ NP（Artsチェイン・色つき攻撃時NP）×1.5 ＋ スター（Quickチェイン・色つき攻撃時スター）×1.3。
// 宝具のターン・攻撃しない味方には0。重みと点数（convScore）は先読みの解析で決めた：つよい同士 6000試合の 9343場面で、使わない／変換なし／R／B／G を
// それぞれ64回ずつ決着まで試した勝率差を当てはめると、NP 1 ≒ ダメージ1.5、スター1 ≒ ダメージ1.3。見込み100 ≒ 勝率+4〜5%
function convGain(ts,c){
  if(G.ult) return 0;
  const tgt=[...alive(1-G.cur)].filter(x=>!x.master).sort((a,b)=>maxHp(b)-maxHp(a))[0]; if(!tgt) return 0;
  const stars=G.players[G.cur].stars, RGB=['R','B','G'], slots=[];
  Object.entries(G.alloc).forEach(([uid,n])=>{ const x=U(uid); if(x&&!x.out&&x.pid===G.cur) for(let i=0;i<n;i++) slots.push(x); });
  if(!slots.length||!ts.some(t=>slots.includes(t))) return 0;
  const cardSum=(x,col,k)=>x.fx.filter(e=>e.k==='cardUp'&&e.color===col).reduce((s,e)=>s+(e[k]||0),0);
  const ev=cc=>{
    const per=slots.map(x=>{ const cs=[0,1,2,3,4,5].map(f=>{ const m=cmdOf(x,f); return cc&&ts.includes(x)&&RGB.includes(m.c)?{...m,c:cc}:m; });
      const p={}; RGB.forEach(k=>p[k]=cs.filter(m=>m.c===k).length/6);
      const col=(k,card)=>cs.reduce((s,m)=>s+(RGB.includes(m.c)&&m.dmg>0?mods(x,k,m.c).sum+cardSum(x,m.c,card):0),0)/6;
      return {v:cs.reduce((s,m)=>s+cmdValue(x,m,stars,tgt),0)/6, p, np:col('onAtkNp','np'), st:col('onAtkStar','star')}; });
    const pc=k=>slots.length===3?per.reduce((m,s)=>m*s.p[k],1):0;
    const dmg=per.reduce((s,x)=>s+x.v,0)+pc('R')*RULES.chainR*3;
    const np=pc('B')*RULES.chainB*new Set(slots).size+per.reduce((s,x)=>s+x.np,0);
    const st=pc('G')*RULES.chainG+per.reduce((s,x)=>s+x.st,0);
    return dmg+np*1.5+st*1.3;
  };
  return ev(c)-ev(null);
}
// 見込み（ダメージ換算）→ 点数。36で3点（変換だけで使う）。見込み0以下（宝具のターン・3回そろわない）は0
const convScore = g=>Math.max(0,Math.min(4,g/12));
function cpuDecide(){
  const easy=G.level==='easy';
  switch(G.phase){
    case 'draft': return cpuDraft(easy);
    case 'actRoll': return G.actRolled ? ['setAlloc',{alloc:JSON.stringify(cpuAlloc(easy))}] : ['rollActs'];
    case 'skill': {
      if(G.pending&&G.pending.colorPick) return ['skillColor',{c:cpuPickColor(U(G.pending.uid),easy)}];
      if(G.pending) return ['cardClick',{uid:cpuPickTarget(G.pending.uid,G.pending.ult?null:G.pending.si,easy).uid}];
      let m=null;
      if(!G.ult&&!G.ultDone){ const u=cpuUltUser(); if(u) m=['useUlt',{uid:u.uid}]; }
      if(!m){ const s=cpuNextSkill(easy); m=s ? ['useSkill',{uid:s.u.uid,si:String(s.si)}] : ['skillDone']; }
      // 超つよい：スキル・宝具も先読みで選ぶ（チームバトルは MC_SKILL_TEAM に入れた強さだけ）
      return mcSkillOn() ? cpuMcSkill(m) : m;
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
// 測定で差が出なかったので入れていないもの（基準版との対戦・各14000試合、±0.8）：見込みを「殴る予定の相手」への補正で出す 49.6〜51.0%、NPが貯まるコマンドに価値を足す 49.8〜51.1%
const ASC_VALUE = 40; // 再臨前の再臨面1回の価値（ダメージ換算。avgDmg と同じ）
function cmdOf(u,f){ const face=D(u.def).faces[f]; return !u.asc&&face.pre.c==='ASC'?face.pre:u.asc?face.post:face.pre; }
// 特殊行動のダメージ効果（dmg）の見込み：攻撃扱いなら攻撃ダメージ±・被ダメージ±を入れ、固定なら値そのまま。出目で分岐なら確率を掛ける
function cmdEffDmg(u,c,tgt,only){ // only＝tgt が受ける分だけ（estDamage）
  return (c.eff||[]).filter(e=>e.k==='dmg').reduce((s,e)=>{ const one=t=>e.max?maxHp(t):e.fixed?e.v:(m=>applyPct(Math.max(0,e.v+m.sum),m.pct))(dmgMods(u,t,null));
    const ts=e.t==='enemy_all'&&!only?alive(tgt.pid).filter(t=>!t.master):[tgt];
    return s+ts.reduce((a,t)=>a+one(t),0)*effRollP(e); },0)*hitsOf(c.eff);
}
function cmdValue(u,c,stars,tgt){
  if(c.c==='ASC') return u.asc?0:ASC_VALUE;
  if(!(c.dmg>0)) return cmdEffDmg(u,c,tgt);
  const m=dmgMods(u,tgt,c.c==='W'?null:c.c); let d=applyPct(Math.max(0,c.dmg+m.sum),m.pct);
  if(stars>0&&c.c!=='W'){
    const p=ruleset().crit==='d6'?Math.min(1,critNeedD6(stars)/6):critChance(critLevel(stars))/100;
    d+=p*((c.c==='R'?RULES.critDmgR:RULES.critDmg)+m.colorBuff);
  }
  return d*hitsOf(c.eff)*(isAoe(c.eff)?Math.max(1,alive(tgt.pid).length):1)+cmdEffDmg(u,c,tgt);
}
function allocEV(alloc,noChain,per){ // per＝騎ごとの見込みの使い回し（同じ局面で配分をいくつも比べるとき。cpuAllocEV）
  const tgt=[...alive(1-G.cur)].sort((a,b)=>maxHp(b)-maxHp(a))[0], stars=G.players[G.cur].stars;
  const slots=[]; Object.entries(alloc).forEach(([uid,n])=>{ for(let i=0;i<n;i++) slots.push(U(uid)); });
  if(!slots.length) return 0;
  // 1回ごとの期待値は独立なので足し合わせ、Busterチェインだけ「3回ともBuster」の確率で加える
  per=per||new Map();
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
  let best=null, bv=-1; const per=new Map();
  for(const a of out){ const v=allocEV(a,false,per); if(v>bv){ bv=v; best=a; } }
  return best||Object.fromEntries(us.map(u=>[u.uid,0]));
}
function ultPower(u){
  const ud=D(u.def).ult, h=hitsOf(ud.eff), up=mods(u,'npPow').sum-mods(u,'npPowDown').sum;
  const one=e=>e.max?Math.max(0,...alive(1-u.pid).map(maxHp)):Math.max(0,e.v+up);
  return ud.eff.filter(e=>e.k==='dmg').reduce((s,e)=>s+one(e)*effRollP(e)*h*(e.t==='enemy_all'?alive(1-u.pid).length:1),0)+ultRollPower(u,ud);
}
// 宝具の「他のサーヴァントをロール」の見込みダメージ：ロール回数 ×（ロールで出るコマンドの平均ダメージ ＋ 攻撃ダメージ+ ＋ クリティカルの期待値）。
// ちょうど3回なら宝具の持ち主のエクストラアタック（自分の再臨後カードの平均ダメージ。補正・クリティカルなし）も足す。選ぶ宝具は平均ダメージが高い相手の鉛筆を選ぶ（cpuPickTarget）
function ultRollPower(u,ud){
  const n=ud.eff.filter(e=>e.k==='copyRoll').length; if(!n) return 0;
  const cs=copyCands(u); if(!cs.length) return 0;
  const avgPost=x=>D(x.def).faces.reduce((s,f)=>s+(isCopyCmd(f.post)?0:(f.post.dmg||0)*hitsOf(f.post.eff)),0)/6;
  const avg=ud.pick?Math.max(...cs.map(avgPost)):cs.reduce((s,x)=>s+avgPost(x),0)/cs.length;
  const own=k=>ud.eff.filter(e=>e.k===k&&e.t==='self').reduce((s,e)=>s+e.v,0)+mods(u,k).sum;
  const atk=own('atk')-mods(u,'atkDown').sum, stars=G.players[u.pid].stars;
  let crit=0;
  if(stars>0){ // クリティカル：率（クリティカル率アップ込み）×（追加ダメージ＋威力+。Buster/Quick混在なので平均を使う）
    const cr=own('critRoll'), p=ruleset().crit==='d6'?Math.min(1,(critNeedD6(stars)+cr)/6):critChance(Math.min(CRIT_TABLE.length,critLevel(stars)+cr))/100;
    crit=p*((RULES.critDmg+RULES.critDmgR)/2+own('critPow'));
  }
  const extra=n===3&&!ud.eff.some(e=>e.k==='copyRoll'&&e.noExtra)?avgDmg(u):0;
  return n*(avg+Math.max(0,atk)+crit)+extra;
}
// 宝具のダメージのうち、回避・無敵で防がれずに通る見込み（tgt＝単体宝具の攻撃対象）。効果は実際と同じ順（ultEffOrder）にたどる：
// ダメージより前の「自分に無敵貫通・必中」「敵の強化解除」は効き、後ろに並んでいるものは間に合わない。回数つきの回避・無敵は防ぐたびに1回減る（連続攻撃・複数のダメージ効果）。
// raw=true なら防がれないものとして数える（割合を出すときの分母）。per（Map）を渡すと、敵ごとの通るダメージを入れる。ロール宝具の分（ultRollPower）は含めない
function ultLand(u,tgt,raw,per){
  const ud=D(u.def).ult, hits=hitsOf(ud.eff), up=mods(u,'npPow').sum-mods(u,'npPowDown').sum, foes=alive(1-u.pid);
  const cnt=(t,k)=>t.fx.filter(x=>x.k===k).reduce((s,x)=>s+(x.times==null?Infinity:x.times),0);
  const g=new Map(foes.map(t=>[t,raw?{invul:0,evade:0}:{invul:cnt(t,'invul'),evade:cnt(t,'evade')}]));
  let pierce=has(u,'pierce'), sure=has(u,'sureHit'), sum=0;
  for(const e of ultEffOrder(ud.eff)){
    if(e.k==='pierce'&&e.t==='self') pierce=true;
    else if(e.k==='sureHit'&&e.t==='self') sure=true;
    else if(e.k==='strip'&&(e.t==='enemy_all'||e.t==='target')) (e.t==='enemy_all'?foes:[tgt]).forEach(t=>{ const x=t&&g.get(t); if(!x||has(t,'stripImmune')) return; if(!e.vs||e.vs==='invul') x.invul=0; if(!e.vs||e.vs==='evade') x.evade=0; });
    else if(e.k==='dmg'&&(e.t==='enemy_all'||e.t==='target')){
      for(let h=0;h<hits;h++) (e.t==='enemy_all'?foes:[tgt]).forEach(t=>{ const x=t&&g.get(t); if(!x||(e.cond&&!condOk(e.cond,t))) return;
        if(!pierce&&x.invul>0){ x.invul--; return; }
        if(!pierce&&!sure&&x.evade>0){ x.evade--; return; }
        const v=(e.max?maxHp(t):Math.max(0,e.v+up))*effRollP(e); if(per) per.set(t,(per.get(t)||0)+v); sum+=v; });
    }
  }
  return sum;
}
// 宝具のダメージが通る割合（0〜1）。攻撃対象を選ぶときに使う
const ultPass = (u,t)=>{ const r=ultLand(u,t,true); return r>0?ultLand(u,t)/r:1; };
// つよい以上の「宝具の見込みダメージ」：防がれる分を引いたもの（単体宝具は一番通る相手に撃つ前提）＋ロール宝具の分
function ultHitPower(u){
  const ud=D(u.def).ult, single=ud.eff.some(e=>e.k==='dmg'&&e.t==='target');
  return (single?Math.max(0,...targetCandidates().map(t=>ultLand(u,t))):ultLand(u,null))+ultRollPower(u,ud);
}
// 宝具で倒せる敵の数（ガッツ持ちは倒せない扱い。単体宝具は倒せる相手がいれば1）
function ultKills(u){
  const ud=D(u.def).ult, single=ud.eff.some(e=>e.k==='dmg'&&e.t==='target'), n=t=>{ const per=new Map(); ultLand(u,t,false,per); return [...per].filter(([x,v])=>!has(x,'guts')&&v>=x.hp).length; };
  return single?Math.max(0,...targetCandidates().map(n)):n(null);
}
let ULT_KILL = 100;    // 宝具で倒せる敵1騎につき、見込みダメージに足す値（0=足さない）
let ULT_DYING = true;  // 次の相手の手番で倒れそうな騎（cpuDanger）の宝具は、通常攻撃の見込みを下回っていても撃つ（NP100%のまま倒れない）
function cpuUltUser(){
  const c=alive(G.cur).filter(u=>canUlt(u)&&u.np>=RULES.ultCost);
  if(!cpuHard()) return c.sort((a,b)=>ultPower(b)-ultPower(a))[0]||null;
  // つよい以上：攻撃宝具は「回避・無敵で防がれる分を引いた見込み」で比べ、このターンの通常攻撃の見込みダメージを下回るなら温存する（全員に防がれる空撃ちをしない）。
  // 攻撃宝具を温存するときも、ダメージのない補助宝具は使う
  // 測定（tools/cpu-audit.js・つよい同士・先読みなし）：空撃ち＝攻撃宝具がすべて防がれた割合はチーム 9.5% → 0%、シンプル 16.8% → 0%（対象選びの cpuTargetCands・cpuPickHard 込み）。
  // 直す前の版との対戦（各6000試合）はチーム 51.1%・シンプル 52.6%・マスター 49.5%・マスターチーム 50.3%（±1.3）＝強さはほぼ同じで、見た目の不自然さを消す修正
  const pw=new Map(c.map(u=>[u,ultHitPower(u)]));
  const atk=c.filter(u=>ultPower(u)>0).sort((a,b)=>pw.get(b)-pw.get(a))[0];
  if(atk&&pw.get(atk)>0&&(pw.get(atk)+(ULT_KILL?ULT_KILL*ultKills(atk):0)>=turnPower()||(ULT_DYING&&cpuDanger(atk)))) return atk;
  return c.find(u=>ultPower(u)<=0)||null;
}
// このターンに割り振った行動の見込みダメージ。つよい以上は allocEV（クリティカル期待値・ブレイブチェインの追加攻撃を含み、Busterチェインは含めない）
function turnPower(){
  if(cpuHard()) return allocEV(G.alloc,true);
  return Object.entries(G.alloc).reduce((s,[uid,n])=>s+n*avgDmg(U(uid)),0)+(Object.values(G.alloc).some(n=>n===3)?60:0);
}
// ---------- つよい以上：次の相手の手番で倒れそうか ----------
// 相手の次の手番に u が集中して狙われたときの見込みダメージ：
//  通常攻撃＝1回あたりの平均ダメージ（u への補正込み）がいちばん高い敵の DANGER_ACTS 回ぶん ／ 宝具＝いま撃てる（NP100%）敵の宝具のうち最大。大きい方。
//  回避・無敵が残っていれば、防ぐ回数ぶん（回数なしは全部）を引く。行動できない敵（スタン・魅了）は数えない
let DANGER_ACTS = 3;
function cpuIncoming(u){
  const foes=alive(1-u.pid).filter(e=>!disabled(e)); if(!foes.length) return 0;
  const guard=u.fx.filter(x=>x.k==='invul'||x.k==='evade').reduce((s,x)=>s+(x.times==null?Infinity:x.times),0);
  const per=e=>[0,1,2,3,4,5].reduce((s,f)=>{ const c=cmdOf(e,f); if(!(c.dmg>0)) return s; const m=dmgMods(e,u,c.c==='W'?null:c.c); return s+applyPct(Math.max(0,c.dmg+m.sum),m.pct)*hitsOf(c.eff); },0)/6;
  const normal=Math.max(...foes.map(per))*Math.max(0,DANGER_ACTS-Math.min(guard,DANGER_ACTS));
  const ult=e=>{ const ud=D(e.def).ult, up=mods(e,'npPow').sum-mods(e,'npPowDown').sum, h=hitsOf(ud.eff), n=ud.eff.filter(x=>x.k==='dmg').length*h; if(!n) return 0;
    const all=ud.eff.filter(x=>x.k==='dmg').reduce((s,x)=>s+(x.max?maxHp(u):(m=>applyPct(Math.max(0,x.v+m.sum+up),m.pct))(dmgMods(e,u,ud.c)))*effRollP(x)*h,0);
    return all*Math.max(0,n-Math.min(guard,n))/n; };
  return Math.max(normal,...foes.filter(e=>e.np>=RULES.ultCost&&canUlt(e)).map(ult));
}
// 倒れそうな味方：見込みダメージ × DANGER_K が残りHP以上（ガッツ持ちは踏みとどまるので別）。チームでは誰が狙われるか分からないので「集中して狙われたら倒れる」騎はすべて当てはまる
let DANGER_K = 1; // 1より小さいほど「本当に危ないときだけ」。0＝この判断を使わない
function cpuDanger(u){
  if(!DANGER_K||u.out||u.master||has(u,'guts')) return false;
  return cpuIncoming(u)*DANGER_K>=u.hp;
}
// 倒れそうな騎のスキルは、この点数以上なら使う（ふだんは3点）＝倒れる前に使い切る。0点のスキル（今は意味がない効果）は使わない
// 測定（tools/cpu-audit.js・つよい同士・先読みなし）：戦闘不能になった騎の未使用スキルはチーム 17.8% → 12.8%、シンプル 19.9% → 12.4%。
// 基準版（この判断を入れる前）との対戦（各2万試合を2回、±0.7）：ULT_KILL・ULT_DYING・TGT_GUARD と合わせて チーム 50.4〜51.4%・マスターチーム 51.1〜51.3%・シンプル 49.9〜50.5%・マスター 50.6〜51.4%＝強さはほぼ同じか、わずかに上。
// 入れなかったもの：守りの効果（回避・無敵・ガッツ・ターゲット集中）を「倒れそうな味方がいるとき」に使う → 49.3〜50.3% で差なし
let DANGER_MIN = .5;
function usableSkills(){
  const out=[];
  alive(G.cur).forEach(u=>{ if(!canSkill(u)) return;
    D(u.def).skills.forEach((s,si)=>{ if(skillUsable(u,si)) out.push({u,si}); }); });
  return out;
}
function cpuNextSkill(easy){
  const list=usableSkills();
  if(easy) return list.find(x=>rnd01(`${G.turn}s${x.u.uid}${x.si}`)<.3)||null;
  let best=null; const pass=[];
  const dying=new Map(), dy=u=>{ if(!dying.has(u)) dying.set(u,cpuHard()&&cpuDanger(u)); return dying.get(u); };
  for(const x of list){ if(cpuSkillWaste(x.u,x.si)) continue; // 効果がすべて今は働かないスキルは、倒れそうなときも使わない
    const sc=cpuHard()?cpuGuardScore(x.u,x.si):cpuSkillScore(x.u,x.si); if(sc>=(cpuHard()?3:2)||(sc>=DANGER_MIN&&dy(x.u))){ pass.push({...x,sc}); if(!best||sc>best.sc) best={...x,sc}; } } // 倒れそうかの見積もり（重い）は、3点に届かないスキルがあるときだけ // つよい以上は3点以上で使う（2→3は勝率同等だった）
  if(SKILL_ORDER&&best){ // このターンに使うスキルのうち、best を強めるもの（弱体成功率アップなど）があれば先に使う
    const pre=pass.filter(x=>x!==best&&!(x.u===best.u&&x.si===best.si)&&skillBefore(x,best)).sort((a,b)=>b.sc-a.sc)[0];
    if(pre) return pre;
  }
  return best;
}
// ---------- 使う順番 ----------
// 使った瞬間に結果が決まる効果（確率の判定・即時回復の量・スキル再使用）は、それを強めるスキルを先に使う。
// 攻撃のときに読まれる効果（クリティカル威力・特攻など）はスキルフェイズ内の順番で結果が変わらないので見ない。
// 強める側の点数は、強められる側を数えて付ける（debuffUpScore）。使う予定（点数が基準以上）のスキル同士でだけ順番を入れ替える
// 測定（つよい・先読みなし、両陣営同じ編成で旧判断と対戦・各6000試合 ±1.3）：ネサレテ 59.7%、謝肉祭の魔女リザ 49.9%・隠されし首領 49.0%・塵塚怪王 50.4%・リュキアン・キマイラ 50.9%（差なし）。
// 旧版との対戦（各4000試合 ±1.5）：team 51.5%・simple 50.1%・master 51.0%・mteam 50.5%
let SKILL_ORDER = true;
const skillEffs=x=>D(x.u.def).skills[x.si].eff;
const chanceFoe=e=>FX[e.k]&&FX[e.k].buff===false&&e.chance&&towardFoe(e);
const chanceAlly=e=>FX[e.k]&&FX[e.k].buff===true&&e.chance&&!towardFoe(e);
const ordTs=(u,e)=>e.t==='master'||e.t==='target'?[]:resolveTargets(u,e.t,null);
// x を y より先に使うと y が強くなるか
function skillBefore(x,y){
  const xe=skillEffs(x), ye=skillEffs(y), on=(e,b)=>ordTs(x.u,e).includes(b);
  for(const e of xe){
    if(e.k==='debuffUp'&&on(e,y.u)&&ye.some(chanceFoe)) return true;
    if(e.k==='buffUp'&&on(e,y.u)&&ye.some(chanceAlly)) return true;
    if(e.k==='healUp'){ const ts=ordTs(x.u,e); if(ye.some(h=>h.k==='heal'&&ordTs(y.u,h).some(t=>ts.includes(t)&&maxHp(t)>t.hp))) return true; }
  }
  return ye.some(e=>e.k==='skillCharge'&&ordTs(y.u,e).includes(x.u)); // スキル再使用は、戻す先のスキルを使ってから
}
// 弱体成功率アップ：対象がこれから使う確率つきの弱体（未使用のスキル・同じスキル・宝具・今ターンの攻撃の面）の多さで点数を付ける
function debuffUpScore(u,e,ts,effs,si){
  let v=0;
  for(const t of ts){ if(t.pid!==u.pid||t.master) continue; const d=D(t.def);
    v+=1.5*d.skills.filter((s,i)=>!(t===u&&i===si)&&!t.used[i]&&(i<2||t.asc)&&s.eff.some(chanceFoe)).length;
    if(t===u&&effs.some(x=>x!==e&&chanceFoe(x))) v+=1;
    if(d.ult.eff.some(chanceFoe)) v+=t.np>=RULES.ultCost?1.5:t.np>=50?1:.5;
    if(isActing(t)&&(d.faces||[]).some(f=>f&&f.post&&(f.post.eff||[]).concat(f.pre&&f.pre.eff||[]).some(chanceFoe))) v+=.5;
  }
  return Math.min(4,v);
}
// つよい（チームバトル）：回避・無敵を含むスキルは、敵の宝具（NP100%）に合わせて使う。
// 敵が宝具を撃てる → 狙われそうな味方（全体宝具なら誰でも）に回避・無敵が付くなら最優先。
// そうでなければ通常の点数（cpuEffScore）のまま。以前は倒れそうなとき（HP35%未満）まで温存していたが、同じスキルの攻撃強化なども止まって弱かったのでやめた
// 測定（チームバトル・各20万試合、温存あり＝旧版との対戦）：温存なし 51.2% 勝ち。温存を解くHPを 50〜90% にしても 50.6〜50.8% どまり。宝具に合わせる部分まで外すと 48.9%
// シンプルルールでは効果がなかったので使わない
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
  }
  return base;
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
// クリティカル率アップ（critRoll）：持っているスターでのクリティカル率がどれだけ上がるか × 今ターンの攻撃回数。スターがなければ0、宝具のターンは判定がない
function critRollScore(e,ts,stars){
  if(G.ult||stars<=0) return 0;
  const mine=ts.filter(t=>t.pid===G.cur&&!t.master), n=attackCount(mine); if(!n) return 0;
  const d6=ruleset().crit==='d6';
  const p=v=>d6?Math.min(1,(critNeedD6(stars)+v)/6):critChance(Math.min(CRIT_TABLE.length,critLevel(stars)+v))/100;
  return Math.min(4,Math.max(1,n*(p(e.v)-p(0))*(RULES.critDmg+RULES.critDmgR)/2/4.5));
}
// 攻撃時NP・攻撃時スター（onAtkNp / onAtkStar）：効果が続く間に見込める攻撃の回数で価値が決まる。
// 攻撃回数＝このターンに割り振られた行動（宝具ならその1回）＋効果が残る次以降のターン（1ターンあたり1.5回、シンプルルールは2回）。回数制（times）は回数が上限
function onAtkScore(e,ts){
  const mine=ts.filter(t=>t.pid===G.cur&&!t.master); if(!mine.length) return 0;
  const now=attackCount(mine), turns=e.turns||1;
  let atks=now+(turns>1?(turns-1)*(ruleset().partyMax===1?2:SKILL_V2&&e.k==='onAtkNp'?Math.min(3,1.5*mine.length):1.5):0);
  if(e.times) atks=Math.min(atks,e.times);
  if(atks<=0) return 0;
  if(e.k==='onAtkNp'){ // 全体で貯まるNP：宝具が撃てない味方がいなければ価値は低い
    if(!mine.some(t=>t.np<RULES.ultCost)) return .3;
    return Math.min(4.5,atks*e.v/RULES.ultCost*(SKILL_V2?8:6)); // 効果量10・攻撃3回なら+30%。次のターン以降の分も合わせて、宝具が近づく価値として評価する
  }
  // 攻撃時スター：増えたスターは次のターンのクリティカルになる。1ターンぶんの価値＝スターが増える前後のクリティカル率の差×次のターンの攻撃回数（starSkillScore と同じ見方）。
  // このターンはその割り振りで、残りのターンは1ターンの見込み攻撃回数で、2ターン目以降は先の不確かさで6割に割り引く
  const d6=ruleset().crit==='d6', st=G.gen, solo=ruleset().partyMax===1, next=solo?2:3, per=solo?2:1.5;
  const p=x=>x<=0?0:d6?Math.min(1,critNeedD6(x)/6):critChance(critLevel(x))/100;
  const turn=g=>next*(p(st+g)-p(st))*RULES.critDmg/4.5;
  let v=turn(now*e.v)+(turns>1?(turns-1)*.6*turn(per*e.v):0);
  if(e.times) v*=Math.min(1,e.times/Math.max(1,atks));
  return Math.min(4,v);
}
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
// 回数だけで消える守り（ターン数なしの回避・無敵・防御）は、受けるまで残るので早く使っても無駄にならない。守りだけのスキル（回避・無敵・防御・弱体解除・ターゲット集中）ならHPに関係なく使う。
// 先読み（超つよいと同じ16回×40ターン）の判断を集めた解析：つよいが温存した場面で使うと +3.1%（±0.7・1848件）。ほかの効果（回復など）が混ざるスキルは使い時が違うので対象外。
// 入れる前の版との対戦（つよい・先読みなし・各約20万試合）：チーム 50.20%・マスターチーム 50.27%（±0.22）。当てはまるキャラが少ないので全体の差は小さい
let GUARD_KEEP = true;
const permGuard = (e,effs,ts)=>e.times&&!e.turns&&ts.some(t=>t.pid===G.cur&&!(has(t,e.k)&&!(SKILL_V2&&e.k==='def')))&&effs.every(x=>['evade','invul','def','cleanse','taunt'].includes(x.k));
// 意味がない場面で使わない（tools/skill-waste.js の点検で見つかった無駄。スキル全体が無駄な使い方 2.5%→0.4%、旧版との対戦 team 50.8%・mteam 50.8%（±0.7））：条件つきのスタン・魅了は対象がいなければ0、1ターンの宝具威力アップは宝具を撃つときだけ、
// ターゲット集中はほかの味方が持っている・敵が全体宝具を撃てるなら0、自分用の守りはほかの味方がターゲット集中を持っている（全体宝具も来ない）なら0、ガッツは重ねない
let SKILL_SENSE = true;
// 超つよいの判断の蒸留（2回目）で見つかった使い控え・使いすぎの手直し：自分側にかかるデメリット（クリティカル率ダウンなど）は減点しない、
// 数ターン続く攻撃時NPは次のターン以降の味方の攻撃も数える、回数制の防御は防御がすでにあっても重ねる、長く残る回数制の回避・無敵は混ざったスキルでも価値あり、
// 防御無視は殴る予定の相手が防御を持っているときだけ。当てはまるキャラが少ないので全体の差は小さい（旧版との対戦 各約5.4万試合：team 50.22%・mteam 50.34%（±0.42）、スキル全体が無駄 0.3%）
let SKILL_V2 = true;
const selfDraw=(foes,ts,v)=>foes.length?v:SKILL_V2&&ts.length?0:-1; // 弱体：敵に入れば v、自分側だけならデメリットなので0（旧：-1）
// HP回復の手段がある（毎ターン回復が付いている／未使用のスキル・宝具に回復がある）。マスターは見ない
const cpuHealSrc=x=>{ if(x.master) return false; const d=D(x.def), hk=e=>e.k==='heal'||e.k==='regenHp';
  return has(x,'regenHp')||d.skills.some((s,i)=>!x.used[i]&&(i<2||x.asc)&&s.eff.some(hk))||d.ult.eff.some(hk); };
// 確率つきの弱体（敵に向けたもの）を、未使用のスキルか宝具に持っている
const cpuChanceDebuffer=x=>{ if(x.master) return false; const d=D(x.def), hit=e=>FX[e.k]&&FX[e.k].buff===false&&e.chance&&!['self','ally_all','ally_other'].includes(e.t);
  return d.skills.some((s,i)=>!x.used[i]&&s.eff.some(hit))||d.ult.eff.some(hit); };
// ---------- 今使っても意味がない効果（無駄づかいの判定） ----------
// 効果ごとに「この状況では働かない」を決める。スキルの効果がすべて無駄なら、よわい以外は使わない（倒れそうなとき・超つよいの先読みでも）。
// 一部の効果だけ無駄なら、その効果は点数に入れない（0.5点などの下限も付けない）。
// スキルは1試合1回なので、今働かない強化は「働くターンまで待つ」のが正しい（数ターン続く強化でも、今ターン攻撃しない騎には使わない）。
// 判定は tools/skill-waste.js の WASTE_NOW と同じ考え方（新しい FX を足したら両方に足す）
let SKILL_WASTE = true;
const ATK_FX = ['atk','atkPct','cardUp','critPow','critMult','critRoll','sureHit','pierce','ignoreDef','atkVs','atkTrait','npPow','aoeNormal','onAtkNp','onAtkStar','cardConv','cardConvPick'];
const NORMAL_ONLY_FX = ['critPow','critMult','critRoll','aoeNormal','onAtkNp','onAtkStar','cardConv','cardConvPick']; // 宝具には乗らない（通常攻撃だけ）
const GUARD_FX = ['def','evade','invul','nullUnder','counter','onHitNp','hitNpUp','onHitStar','defTrait','npDef'];
// 特性付与（弱体）で付けた属性を、味方の誰かが使う（特攻・条件・参照）
const cpuTraitUse = (u,tr)=>alive(u.pid).some(a=>effsDeep(cpuKitEffs(a)).some(x=>(x.k==='atkTrait'&&x.trait===tr)||(x.cond&&x.cond.k==='trait'&&x.cond.v===tr)||(x.scale&&x.scale.v===tr)));
// 発動型の中の効果の大きさの目安（1つ0.7点・3点まで）
const trigVal = e=>Math.min(3,(e.eff||[]).length*.7);
// ---------- 発動型・特性付与の使いどき（NEWFX） ----------
// 種類ごとに score（今使う価値の点数）と waste（今は働かない理由。なければ null）。tools/fx-timing.js が案を差し替えて勝率を比べる
// score の c：{u, e, ts（対象）, mine（対象のうち味方）, foes（対象のうち敵）, effs, si, acting（対象の誰かが今ターン攻撃する）, enemies, allies}
// waste の c：{u, e, t（対象1体）, mine（t が味方）, effs, si, enemies, allies}
const hasFoeAtk = u=>alive(1-u.pid).some(x=>!x.master&&!disabled(x)); // 次の相手の手番で攻撃してくる敵がいる
let NEWFX = {
  // 攻撃時発動：数ターン続くなら、今ターン攻撃しなくても早く付ける（次のターン以降の攻撃で働く）。1ターンだけなら今ターン攻撃する騎にだけ
  //   tools/fx-timing.js（つよい同士・ミラー・各2000試合。案の側の勝率）：すぐ使う 57.2%（team）・56.3%（mteam）／攻撃する騎だけ 57.4%・54.5%／旧判断（ほぼ使わない）より強い
  onAtkFx:{ score:c=>c.mine.length?3.5:0,
    waste:c=>c.mine&&!c.t.master&&(c.e.turns||0)<=1&&!c.e.times&&!(!G.ult&&(G.alloc[c.t.uid]||0)>0)?'今ターン攻撃しない':null },
  // 被ダメージ時発動：HPが7割を切ったら使う 54.8%・56.6%（すぐ 55.5%・52.1%／旧判断＝ほぼ使わない）。ほかの味方がターゲット集中なら使わない
  onHitFx:{ score:c=>c.mine.some(t=>hpR(t)<.7)?3.5:c.mine.length?.5:-1,
    waste:c=>c.mine&&!has(c.t,'taunt')&&c.allies.some(a=>a!==c.t&&has(a,'taunt'))?'ほかの味方がターゲット集中':null },
  // 戦闘不能時発動：HPが半分を切ったら（倒れそうなときも点数0.5以上で使う）。すぐ 47.1%・49.8%／HP3割 47.6%・48.5%／倒れそうなときだけ 47.9%・50.3%／HP半分 49.9%・51.9%
  onKoFx:{ score:c=>c.mine.some(t=>hpR(t)<.5)?3.5:1 },
  // ガッツ発動時発動：ガッツと同じスキルなら、ガッツの使いどき（HPが減ったとき）に合わせる。すぐ使うと 28.0%・32.5%（ガッツが切れてから倒れる）
  onGutsFx:{ score:c=>c.ts.some(t=>has(t,'guts'))||c.effs.some(x=>x.k==='guts')?2+trigVal(c.e)/2:.3,
    waste:c=>c.mine&&!has(c.t,'guts')&&!c.effs.some(x=>x.k==='guts')&&!cpuKitEffs(c.t).some(x=>x.k==='guts')?'ガッツがない':null },
  // 遅延・ターン開始時・ターン終了時発動：すぐ使う（遅延 57.9%・57.0%／開始時 54.0%・53.7%／終了時 63.0%・62.3%。3ターン目からにしても上がらない）
  delayFx:{ score:c=>c.mine.length?3.5:.5 },
  startFx:{ score:c=>c.mine.length?3.5:.5 },
  endFx:{ score:c=>c.mine.length?3.5:.5 },
  // 特性付与：自分側は小さな加点（使っても使わなくても 49〜50%）
  traitAdd:{ score:c=>c.mine.length?1:0 },
  // 特性付与（弱体）：その特性を使う味方がいれば使う（すぐ 51.5%・49.9%／その味方が攻撃するターンだけ 48.0%・50.7%：差なし）
  traitAddFoe:{ score:c=>c.foes.length&&cpuTraitUse(c.u,c.e.trait)?3:c.foes.length?.3:-1,
    waste:c=>!c.mine&&!cpuTraitUse(c.u,c.e.trait)?'その特性を使う味方がいない':null },
};
// 参照して値が増える効果（scale）：上限（max）までの伸びしろのうち、今の数でこの割合に届かなければ使わない（0＝今の数のまま点数にする）
// 待つと弱い：半分まで待つ 44.2%・45.1%／上限まで待つ 41.4%・43.1%（fx-timing.js）。今の数で点数にする
let SCALE_WAIT = 0;
// 毎ターン上昇（grow）つきの攻撃強化：2ターン以上続くなら、今ターン攻撃しない騎にも早めに使う（早く付けるほど値が育つ）
// 早めにしても差なし（51.2%・48.7%）なので、ふつうの攻撃強化と同じく攻撃するターンに使う
let GROW_EARLY = false;
const cpuKitEffs = x=>{ const d=D(x.def); return [...(d.skills||[]).flatMap(s=>s.eff),...((d.ult&&d.ult.eff)||[]),...(d.faces||[]).flatMap(f=>[f.pre,f.post].flatMap(c=>c&&c.eff||[])),...(d.spells||[]).flatMap(s=>s.eff)]; };
const towardFoe = x=>x.t!=='self'&&x.t!=='master'&&!String(x.t).startsWith('ally');
const cpuFoeHas = (u,test)=>alive(1-u.pid).some(x=>cpuKitEffs(x).some(test));
const oneTurnFx = e=>e.turns===1||(!e.turns&&!e.times); // 今ターン（と相手の1ターン）で切れる
const timedFx = e=>!!e.turns||!e.times;                 // ターンで切れる（回数だけで消える効果は待っていても無駄にならない）
// 効果 e が対象 t に今かかっても働かないなら理由（文字列）、働く・判定しないなら null
function cpuEffWasteOne(u,e,t,effs,si){
  const k=e.k, mine=t.pid===u.pid, enemies=alive(1-u.pid), allies=alive(u.pid);
  const gives=kk=>effs.some(x=>x!==e&&x.k===kk);
  if(NEWFX[k]) return NEWFX[k].waste?NEWFX[k].waste({u,e,t,mine,effs,si,enemies,allies}):null; // 発動型・特性付与
  if(e.scale&&SCALE_WAIT>0&&e.scale.max!=null&&e.scale.per>0&&e.scale.max>e.v&&(scaleVal(u,e,t)-e.v)/(e.scale.max-e.v)<SCALE_WAIT) return '参照の数がまだ少ない';
  if(mine&&!t.master&&ATK_FX.includes(k)){
    const atkNow=NORMAL_ONLY_FX.includes(k)?!G.ult&&(G.alloc[t.uid]||0)>0:isActing(t);
    if(timedFx(e)&&!atkNow&&!(GROW_EARLY&&e.grow&&(e.turns||0)>=2)) return '今ターン攻撃しない';
    switch(k){
      case 'critPow': case 'critMult': case 'critRoll': return oneTurnFx(e)&&G.players[u.pid].stars<=0&&!gives('star')?'スター0':null;
      case 'sureHit': return enemies.some(x=>has(x,'evade'))?null:oneTurnFx(e)||!cpuFoeHas(u,x=>x.k==='evade')?'回避の敵がいない':null;
      case 'pierce': return enemies.some(x=>has(x,'evade')||has(x,'invul'))?null:oneTurnFx(e)||!cpuFoeHas(u,x=>x.k==='evade'||x.k==='invul')?'回避・無敵の敵がいない':null;
      case 'ignoreDef': return enemies.some(x=>has(x,'def')||has(x,'defTrait'))?null:oneTurnFx(e)||!cpuFoeHas(u,x=>x.k==='def'||x.k==='defTrait')?'防御の敵がいない':null;
      case 'atkVs': return oneTurnFx(e)&&!enemies.some(x=>x.fx.some(f=>e.vs?f.k===e.vs:FX[f.k]&&FX[f.k].buff===false))&&!effs.some(x=>x!==e&&FX[x.k]&&FX[x.k].buff===false&&towardFoe(x))?'弱体の敵がいない':null;
      case 'atkTrait': return enemies.some(x=>traitHit(x,e.trait))?null:'属性の敵がいない';
      case 'aoeNormal': return enemies.filter(x=>!x.master).length<2?'敵が1体':null;
      case 'onAtkNp': return t.np>=RULES.gaugeMax?'NP満タン':null;
      case 'cardUp': return (D(t.def).faces||[]).some(f=>f&&f.c===e.color)?null:'その色の面がない';
      case 'npPow': { if(G.ult===t.uid) return null;
        const gain=effs.filter(x=>x.k==='np'&&x.v>0).reduce((s,x)=>s+x.v,0), now=!G.ult&&!G.ultDone&&canUlt(t)&&t.np+gain>=RULES.ultCost;
        if(now) return null;
        return oneTurnFx(e)||t.np+gain+30*((e.turns||1)-1)<RULES.ultCost?'宝具を撃たない':null; }
    }
    return null;
  }
  if(mine&&!t.master&&GUARD_FX.includes(k)){
    const aoeSoon=enemies.some(x=>!x.master&&canUlt(x)&&x.np>=70&&ultNoTarget(x)&&D(x.def).ult.eff.some(y=>y.k==='dmg'));
    if(!has(t,'taunt')&&!aoeSoon&&allies.some(a=>a!==t&&a.fx.some(x=>x.k==='taunt'&&(x.turns||0)!==0))) return 'ほかの味方がターゲット集中';
    if(k==='evade'||k==='invul'){ const o=t.fx.find(x=>x.k==='invul'||x.k===k); if(o&&o.times==null&&(o.turns||0)>=(e.turns||1)) return '同じ守りがある'; }
    if((k==='onHitNp'||k==='hitNpUp')&&t.np>=RULES.gaugeMax) return 'NP満タン';
    if(k==='hitNpUp'&&(has(t,'curse')||has(t,'hitNpSeal'))) return '被弾NP封印中';
    if(k==='defTrait'&&!enemies.some(x=>traitHit(x,e.trait))) return '属性の敵がいない';
    if(k==='npDef'){ if(!enemies.some(x=>!x.master&&D(x.def).ult.eff.some(y=>y.k==='dmg'))) return 'ダメージ宝具の敵がいない';
      if(oneTurnFx(e)&&!enemies.some(x=>!x.master&&canUlt(x)&&x.np>=70)) return '敵の宝具が来ない'; }
    return null;
  }
  switch(k){
    case 'guts': return mine&&has(t,'guts')?'ガッツがある':null;
    case 'taunt': return !mine?null:allies.filter(a=>!a.master).length<2?'味方が1体':allies.some(a=>a!==t&&has(a,'taunt'))?'ほかの味方がターゲット集中':enemies.some(x=>!x.master&&canUlt(x)&&x.np>=RULES.ultCost&&ultNoTarget(x))?'敵が全体宝具を撃てる':null;
    case 'debuffImmune': return mine&&!cpuFoeHas(u,x=>FX[x.k]&&FX[x.k].buff===false&&towardFoe(x))?'弱体を使う敵がいない':null;
    case 'mentalImmune': return mine&&!cpuFoeHas(u,x=>FX[x.k]&&FX[x.k].mental)?'精神異常を使う敵がいない':null;
    case 'deathImmune': return mine&&!cpuFoeHas(u,x=>x.k==='instantDeath')?'即死を使う敵がいない':null;
    case 'stripImmune': return mine&&!cpuFoeHas(u,x=>x.k==='strip')?'強化解除を使う敵がいない':null;
    case 'npDownImmune': return mine&&!cpuFoeHas(u,x=>x.k==='np'&&x.v<0)?'NP減少を使う敵がいない':null;
    case 'starLossImmune': return mine&&!cpuFoeHas(u,x=>x.k==='starLoss')?'スター消失を使う敵がいない':null;
    case 'debuffRes': return mine&&!cpuFoeHas(u,x=>FX[x.k]&&FX[x.k].buff===false&&x.chance&&towardFoe(x))?'確率弱体を使う敵がいない':null;
    case 'debuffUp': return mine&&!t.master&&!cpuChanceDebuffer(t)&&!effs.some(x=>x!==e&&FX[x.k]&&FX[x.k].buff===false&&x.chance&&towardFoe(x))?'確率弱体を持っていない':null;
    case 'regenNp': return mine&&t.np>=RULES.gaugeMax&&G.ult!==t.uid&&(e.turns||1)<=1?'NP満タン':null;
    case 'regenHp': return mine&&has(t,'healBlock')?'回復無効中':null;
    case 'heal': return mine&&(t.hp>=maxHp(t)||has(t,'healBlock'))?'HP満タン':null;
    case 'healUp': return !mine?null:has(t,'healBlock')?'回復無効中':!effs.some(x=>x.k==='heal'||x.k==='regenHp')&&!allies.some(cpuHealSrc)?'回復の手段がない':null;
    case 'np': return e.v>0&&mine&&t.np>=RULES.gaugeMax?'NP満タン':null;
    case 'cleanse': return t.fx.some(x=>e.vs?x.k===e.vs:FX[x.k]&&FX[x.k].buff===false)?null:'弱体がない';
    case 'cleanseMental': return t.fx.some(x=>FX[x.k]&&FX[x.k].mental)?null:'精神異常がない';
    case 'strip': return mine?null:t.fx.some(x=>(e.vs?x.k===e.vs:FX[x.k]&&FX[x.k].buff===true)&&!x.sure)?null:'解除できる強化がない';
    case 'buffExtend': return t.fx.some(x=>FX[x.k]&&FX[x.k].buff===true&&x.turns!=null)?null:'ターン制の強化がない';
    case 'skillCharge': return t.used.some((x,i)=>x&&!(t===u&&i===si))?null:'使用済みスキルがない';
    case 'ascend': return t.asc||t.master?'再臨済み':null;
    case 'starLoss': return !mine&&G.players[t.pid].stars<=0?'敵のスター0':null;
    case 'copyBuff': case 'copyDebuff': { const fu=resolveTargets(u,e.from||'self',null)[0], want=k==='copyBuff';
      return fu&&!fu.fx.some(x=>FX[x.k]&&FX[x.k].buff===want&&!x.tmp&&!x.sure)?'コピーする効果がない':null; }
  }
  if(mine) return null; // ここから下は敵に入れる弱体（自分側にかかる分はデメリットなので判定しない）
  if(FX[k]&&FX[k].buff===false&&has(t,'debuffImmune')&&!e.sure) return '弱体無効';
  switch(k){
    case 'stun': case 'charm': case 'petrify': case 'bind': case 'sleep': case 'confuse': case 'fear':
      return FX[k].mental&&has(t,'mentalImmune')?'精神異常無効':t.fx.some(x=>x.k===k&&(x.turns==null||x.turns>=(e.turns||1)))?'すでにかかっている':null;
    case 'instantDeath': return has(t,'deathImmune')?'即死無効':null;
    case 'sealUlt': return oneTurnFx(e)&&t.np<60?'敵のNPが低い':null;
    case 'npPowDown': return oneTurnFx(e)&&t.np<60?'敵のNPが低い':null;
    case 'sealSkill': return t.used.some((x,i)=>!x&&(i<2||t.asc))?null:'未使用スキルがない';
    case 'critDown': case 'critPowDown': return oneTurnFx(e)&&G.players[t.pid].stars<=0?'敵のスター0':null;
    case 'spread': return has(t,'burn')||gives('burn')?null:'やけどがない';
    case 'erosion': return has(t,'poison')||gives('poison')?null:'毒がない';
    case 'curse': case 'hitNpSeal': return has(t,'curse')||has(t,'hitNpSeal')?'すでに被弾NP封印中':null;
    case 'healBlock': case 'healDown': return cpuHealSrc(t)?null:'回復の手段がない敵';
    case 'cardDown': return (D(t.def).faces||[]).some(f=>f&&f.c===e.color)?null:'その色の面がない敵';
  }
  return null;
}
// 効果1つが今は働かないか（対象全員に働かないときだけ true）。判定しない効果（デメリット・説明文・マスター宛て）は false
function cpuEffWaste(u,e,ts,effs,si){
  if(!SKILL_WASTE||!FX[e.k]||FX[e.k].noTgt||e.t==='master'||e.k==='selfDmg') return false;
  if(!ts.length) return FX[e.k].buff!==false||towardFoe(e); // 条件に合う対象がいない
  if(FX[e.k].buff===false&&ts.every(t=>t.pid===u.pid)) return false; // 自分側へのデメリット
  return ts.every(t=>cpuEffWasteOne(u,e,t,effs,si)!=null);
}
// 判定する効果がすべて今は働かない（＝使う意味がない）
function cpuEffsWaste(u,effs,picked,si){
  if(!SKILL_WASTE) return false;
  let judged=0;
  for(const e of effs){
    if(!FX[e.k]||FX[e.k].noTgt||e.t==='master'||e.k==='selfDmg') continue;
    let ts=resolveTargets(u,e.t,picked);
    if(e.cond&&!(FX[e.k].condUse&&!e.cond.self)) ts=ts.filter(t=>condOk(e.cond,t));
    if(ts.length&&FX[e.k].buff===false&&ts.every(t=>t.pid===u.pid)) continue; // デメリットは数えない
    judged++;
    if(!cpuEffWaste(u,e,ts,effs,si)) return false;
  }
  return true; // 判定する効果がない（デメリットだけ）も使わない
}
function cpuSkillWaste(u,si){
  const s=D(u.def).skills[si];
  return cpuEffsWaste(u,s.eff,s.pick?cpuPickTarget(u.uid,si,false):null,si);
}
// 効果の並び（スキル・令呪）の「今使う価値」。si はスキル番号（スキル以外は -1）
function cpuEffScore(u,effs,picked,si){
  const allies=alive(u.pid), enemies=alive(1-u.pid), stars=G.players[u.pid].stars;
  const aoeSoon=SKILL_SENSE&&enemies.some(x=>!x.master&&canUlt(x)&&x.np>=70&&ultNoTarget(x));
  const shielded=t=>SKILL_SENSE&&t.pid===u.pid&&!has(t,'taunt')&&!aoeSoon&&allies.some(a=>a!==t&&has(a,'taunt')); // 敵の単体攻撃はターゲット集中の味方に行く
  let sc=0;
  for(let e of effs){
    if(FX[e.k]&&FX[e.k].noTgt) continue; // 説明文・連続攻撃（スキルでは使わない）
    const sc0=sc; // 出目で分岐する効果は、出る確率を掛けた見込みにする（下の switch のあと）
    let ts=e.t==='master'?[]:resolveTargets(u,e.t,picked);
    if(e.cond){ // 条件つき：付与時に見る効果は条件を満たす対象だけ／使う瞬間に見る効果（攻撃・防御補正）は条件を満たす敵がいるときだけ
      if(FX[e.k]&&FX[e.k].condUse&&!e.cond.self){ if(!enemies.some(x=>condOk(e.cond,x))) continue; }
      else ts=ts.filter(t=>condOk(e.cond,t));
    }
    if(cpuEffWaste(u,e,ts,effs,si)) continue; // 今は働かない効果は点数に入れない
    if(e.scale) e={...e,v:scaleVal(u,e,ts[0]||null)}; // 参照して値が増える：今の数で見る
    const acting=ts.some(isActing)||!!(GROW_EARLY&&e.grow&&(e.turns||0)>=2&&ts.some(t=>t.pid===u.pid&&!t.master));
    const foes=ts.filter(t=>t.pid!==u.pid);
    if(NEWFX[e.k]){ sc+=NEWFX[e.k].score({u,e,ts,mine:ts.filter(t=>t.pid===u.pid),foes,effs,si,acting,enemies,allies}); if(e.roll) sc=sc0+(sc-sc0)*effRollP(e); continue; }
    switch(e.k){
      case 'atkPct': sc+=acting?3:0; break;
      case 'atk': sc+=cpuHard()?atkBuffScore(e,ts):acting?3:0; break;
      case 'critPow': sc+=acting&&!G.ult&&critLevel(stars)>=3?3:0; break;
      case 'ignoreDef': sc+=acting&&(SKILL_V2?has(cpuPredictTarget()||u,'def')||enemies.every(x=>has(x,'def')):enemies.some(x=>has(x,'def')))?3:.5; break;
      case 'debuffImmune': sc+=ts.some(t=>hpR(t)<.7)?1.5:.5; break;
      case 'buffImmune': sc+=foes.length?2:-1; break;
      case 'fear': case 'actsDown': case 'sealSkill': sc+=foes.length?2:-1; break;
      case 'sealUlt': sc+=foes.some(t=>t.np>=RULES.ultCost-30)?4:foes.length?1:-1; break;
      case 'spread': sc+=foes.some(t=>has(t,'burn'))?2:.5; break;
      // 新しい効果の使いどき：つよい同士・同じ編成のミラー戦（全キャラのスキル1をその効果だけのスキルにして、各案4000試合）で決めた。数字は案の側の勝率（相手は旧判断）
      // 蝕毒：毒が付いている敵がいる（同じスキルで毒も付ける）ならすぐ使う。旧（2点＝実質使わない）より 66.5%。毒がなくても使う案と同じ勝率なので、無駄打ちしない方を採用
      case 'erosion': sc+=!foes.length?-1:foes.some(t=>has(t,'poison'))||effs.some(x=>x.k==='poison')?3.5:.5; break;
      // 弱体耐性アップ：すぐ使う 50.8% ／ 使わない 51.0% ／ 確率つき弱体を持つ敵がいるときだけ 50.4%（差なし）。小さな加点にとどめる
      case 'debuffRes': sc+=foes.length?-1:enemies.some(x=>cpuChanceDebuffer(x))?1.5:.3; break;
      // HP回復量アップ：減っている味方がいて回復の手段（同じスキル・未使用の回復スキル・毎ターン回復）があるとき 63.7%（すぐ 61.3% ／ HP70%未満の味方がいるとき 60.5%）
      case 'healUp': { if(foes.length){ sc-=1; break; } const al=alive(u.pid).filter(t=>!t.master);
        sc+=al.some(t=>maxHp(t)-t.hp>=70)&&(effs.some(x=>x.k==='heal'||x.k==='regenHp')||al.some(cpuHealSrc))?3.5:al.some(t=>hpR(t)<.7)?3:.3; break; }
      // HP回復量ダウン：すぐ使う 69.6%（敵が減ってから 50.5% ／ 敵が回復しそうなとき 49.6%：敵の回復は減ったらすぐ来るので、待つと間に合わない）。回復の手段がある敵がいれば先に使う
      case 'healDown': sc+=selfDraw(foes,ts,foes.some(cpuHealSrc)?3.5:.5); break;
      // クリティカル威力ダウン：敵のスター6個以上で使う 52.1%（すぐ 50.8% ／ 11個以上 51.4% ／ 使わない 48.7%）
      case 'critPowDown': sc+=selfDraw(foes,ts,foes.some(t=>G.players[t.pid].stars>=6)?3:.5); break;
      // 宝具被ダメージ-：敵が宝具を撃てる（NP100%）ときに使う 56.9%（NP70%以上 51.9% ／ すぐ 44.9% ／ 使わない 45.1%）
      case 'npDef': sc+=foes.length?-1:enemies.some(x=>!x.master&&x.np>=RULES.ultCost&&canUlt(x))?4:enemies.some(x=>!x.master&&x.np>=70)?1:0; break;
      // 混乱：チームは旧判断（2点＝ふだんは使わず、倒れそうなときに使う）がいちばんよかった（すぐ 48.0% ／ 3ターン目から 47.0% ／ 敵NP100% 42.6% ／ 使わない 41.2%）。
      // 1騎のルールはすぐ使う方がよい（旧判断に 54.2%）
      case 'confuse': sc+=!SKILL_SENSE||foes.some(t=>!has(t,'debuffImmune')&&!has(t,'mentalImmune'))?(ruleset().partyMax===1?3:2):-1; break;
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
      case 'critRoll': sc+=critRollScore(e,ts,stars); break;
      case 'aoeNormal': sc+=acting&&enemies.length>=2?3:.3; break;
      case 'sureHit': sc+=acting&&enemies.some(x=>has(x,'evade'))?4:.5; break;
      case 'pierce': sc+=acting&&enemies.some(x=>has(x,'evade')||has(x,'invul'))?4:.5; break;
      case 'def': case 'evade': case 'invul': { const ex=ts.filter(t=>!shielded(t)); sc+=ex.some(t=>hpR(t)<.6)||(GUARD_KEEP&&ex.length&&permGuard(e,effs,ex))?3:SKILL_V2&&e.k!=='def'&&e.times&&(e.turns||0)>=4&&ex.some(t=>t.pid===u.pid&&!has(t,e.k))?1.5:0; break; }
      case 'guts': sc+=ts.some(t=>hpR(t)<.5&&!(SKILL_SENSE&&has(t,'guts')))?4:0; break;
      case 'taunt': sc+=hpR(u)>=.5&&allies.some(a=>a!==u&&hpR(a)<.5)&&!(SKILL_SENSE&&(aoeSoon||allies.some(a=>a!==u&&has(a,'taunt'))))?3:0; break;
      case 'heal': sc+=ts.some(t=>maxHp(t)-t.hp>=e.v*.7)?3:0; break;
      case 'regenHp': case 'maxHp': sc+=ts.some(t=>hpR(t)<.8)?2:1; break;
      case 'regenNp': sc+=ts.some(t=>t.np<RULES.ultCost)?2:.5; break;
      case 'regenStar': case 'onHitStar': sc+=1.5; break;
      case 'hitNpUp': sc+=ts.some(t=>t.np<RULES.ultCost)?1.5:.5; break;
      case 'onHitNp': sc+=ts.some(t=>t.np<RULES.ultCost)?1.5:.5; break;
      case 'counter': sc+=ts.some(t=>t.pid===u.pid)?2:-1; break;
      case 'atkVs': sc+=acting&&enemies.some(x=>x.fx.some(f=>e.vs?f.k===e.vs:FX[f.k].buff===false))?3:.5; break;
      case 'atkTrait': sc+=acting&&traitHit(cpuPredictTarget(),e.trait)?3:0; break; // 殴る予定の相手（cpuPredictTarget）がその属性のときだけ使う
      case 'defTrait': sc+=ts.some(t=>t.pid===u.pid&&hpR(t)<.8)&&enemies.some(x=>traitHit(x,e.trait))?2.5:.5; break;
      case 'critDown': sc+=selfDraw(foes,ts,1.5); break;
      case 'npGainDown': sc+=selfDraw(foes,ts,1.5); break;
      case 'starDown': sc+=selfDraw(foes,ts,1); break;
      case 'debuffUp': sc+=SKILL_ORDER?debuffUpScore(u,e,ts,effs,si):acting?1:0; break;
      case 'copyBuff': case 'copyDebuff': { // コピー元に強化（弱体）があり、対象が味方（弱体は敵）なら価値あり
        const want=e.k==='copyBuff', fu=resolveTargets(u,e.from||'self',picked)[0];
        const n=fu?fu.fx.filter(x=>FX[x.k].buff===want&&!x.tmp&&!x.sure).length:0;
        const good=want?ts.some(t=>t.pid===u.pid&&t!==fu):foes.some(t=>t!==fu);
        sc+=n&&good?Math.min(4,1+n):want?0:-1; break; }
      case 'onAtkNp': case 'onAtkStar': sc+=onAtkScore(e,ts); break;
      case 'cardUp': { // カード性能アップ：攻撃ダメージ+・攻撃時NP・攻撃時スターの合計に、その色の面が出やすいかを掛ける（色の面が半分あれば満額）
        const share=ts.filter(t=>!t.master).reduce((m,t)=>Math.max(m,(D(t.def).faces||[]).filter(f=>f&&f.c===e.color).length/6),0);
        const a=(cpuHard()?atkBuffScore(e,ts):acting?3:0)*Math.min(1,e.v/20);
        const g=(e.np?onAtkScore({...e,k:'onAtkNp',v:e.np},ts):0)+(e.star?onAtkScore({...e,k:'onAtkStar',v:e.star},ts):0);
        sc+=Math.min(5,(a+g)*Math.min(1,share*2)); break; }
      case 'cardDown': { // カード性能ダウン：敵に入れば、威力・NP・スターの大きさに、その色の面が出やすいかを掛ける（色の面が半分あれば満額）
        if(!foes.length){ sc+=selfDraw(foes,ts,0); break; }
        const share=foes.filter(t=>!t.master).reduce((m,t)=>Math.max(m,(D(t.def).faces||[]).filter(f=>f&&f.c===e.color).length/6),0);
        sc+=Math.min(3.5,(2*Math.min(1,(e.v||0)/20)+(e.np||0)/10+(e.star||0)/3)*Math.min(1,share*2)); break; }
      case 'buffUp': sc+=acting?.5:0; break;
      case 'debuffResDown': sc+=selfDraw(foes,ts,1); break;
      case 'debuffDown': sc+=selfDraw(foes,ts,1.5); break;
      case 'buffDown': sc+=selfDraw(foes,ts,1.5); break;
      case 'critMult': sc+=acting&&!G.ult&&critLevel(stars)>=3?3:0; break;
      case 'healBlock': sc+=foes.some(t=>hpR(t)<.7||t.fx.some(x=>x.k==='regenHp'))?2:1; break;
      // カード変換：つよい以上は今ターンの見込み（convGain）。使用時に選ぶ変換はいちばん得な色で見る。
      // 解析（上の convGain）：宝具のターンや変換した味方が1〜2回しか行動しないときに使うと 0〜-3%、3回行動（チェインがそろう）なら +2〜5%
      case 'cardConv': case 'cardConvPick':
        if(CONV_EV&&cpuHard()){ sc+=convScore(Math.max(...(e.k==='cardConv'?[e.color]:['R','B','G']).map(c=>convGain(ts,c)))); break; }
        sc+=acting?1.5:.5; break;
      case 'buffExtend': sc+=ts.some(t=>t.fx.some(x=>FX[x.k].buff===true&&x.turns!=null))?2:0; break;
      case 'ascend': { // 再臨できる味方がいれば価値あり。スキル3が未使用ならさらに高い（再臨でそのターンから使える）。再臨済みだけなら使わない
        const can=ts.filter(t=>t.pid===u.pid&&!t.master&&!t.out&&!t.asc);
        sc+=can.length?(can.some(t=>!t.used[2])?5:3.5):-3; break; }
      case 'skillCharge': sc+=ts.some(t=>t.used.some((x,i)=>x&&!(t===u&&i===si)))?3:-1; break;
      case 'cleanse': sc+=ts.some(t=>t.fx.some(x=>e.vs?x.k===e.vs:FX[x.k].buff===false))?2:0; break;
      case 'np': sc+=ts.some(t=>t.np<RULES.ultCost&&t.np+e.v>=RULES.ultCost)?4:ts.some(t=>t.np<RULES.ultCost)?1.5:0; break;
      case 'star': sc+=cpuHard()?starSkillScore(e.v,u.pid):G.ult?.5:2; break;
      case 'stun': case 'charm': case 'petrify': case 'bind': case 'sleep': sc+=!SKILL_SENSE||foes.some(t=>!has(t,'debuffImmune')&&!(FX[e.k].mental&&has(t,'mentalImmune')))?3:-1; break; // 条件つき（特定の相手だけ）は対象がいなければ使わない
      case 'poison': case 'burn': sc+=ts.some(t=>!has(t,e.k))?2:0; break;
      case 'curse': case 'hitNpSeal': case 'atkDown': case 'atkPctDown': sc+=2; break;
      case 'strip': sc+=ts.some(t=>t.fx.some(x=>e.vs?x.k===e.vs:FX[x.k].buff))?2:0; break;
      case 'defDown': sc+=ts.some(t=>t.pid===u.pid)?-1:1; break;
      case 'dmg': sc+=foes.length?2:0; break;
      case 'npPow': // 1ターンだけなら、今ターン宝具を撃つとき（同じスキルのNPで100%に届く場合も）だけ。宝具を撃つかは先に決めているので、NP100%でも撃たないなら無駄
      if(SKILL_SENSE&&(e.turns||0)<=1&&!e.times){ const gain=effs.filter(x=>x.k==='np'&&x.v>0).reduce((s,x)=>s+x.v,0);
        sc+=ts.some(t=>G.ult===t.uid||(!G.ult&&!G.ultDone&&canUlt(t)&&t.np<RULES.ultCost&&t.np+gain>=RULES.ultCost))?3:0; break; }
      sc+=ts.some(t=>G.ult===t.uid||(t.np>=RULES.ultCost&&!G.ult))?3:.5; break;
      case 'npPowDown': sc+=foes.some(t=>t.np>=RULES.ultCost-30)?2.5:foes.length?.5:-1; break;
      case 'selfDmg': sc-=ts.reduce((s,t)=>s+(t.pid===u.pid?(effVal(e,t)>=t.hp?6:effVal(e,t)/maxHp(t)*4):-1.5),0); break; // 味方が倒れる自傷は使わない
    }
    if(e.roll) sc=sc0+(sc-sc0)*effRollP(e);
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
  let cands=skillCands(u,s);
  if(!cands.length) return u;
  if(easy) return cands[Math.floor(rnd01(`${G.turn}p${uid}${si}`)*cands.length)];
  if(cpuHard()) return cpuPickHard(u,s,si,cands);
  return cpuPickKind(cands,s,s.eff.map(e=>e.k))||cands[0];
}
// つよい以上の対象選び：まず候補ごとに効果の点数（cpuEffScore）を出して、いちばん高い相手に絞る（攻撃強化なら今ターン殴る味方、回避なら減っている味方、NPなら宝具に届く味方）。
// 同点の中では効果の種類ごとの決め打ち（cpuPickKind）、それでも決まらなければ：敵＝殴る予定の相手 ／ 守りだけの効果＝HPの割合が低い味方 ／ それ以外＝今ターンの攻撃回数が多い（同じなら平均ダメージが高い）味方。
// 以前は決め打ちに当てはまらない効果（攻撃強化・回避・無敵など）を候補の先頭＝編成順の1番目に付けていた
function cpuPickHard(u,s,si,cands){
  const k=s.eff.filter(e=>e.t==='picked'||e.from==='picked'||e.k==='copyRoll').map(e=>e.k); // 選んだ相手にかかる効果だけを見る（自分や全体にかかる効果で対象を決めない）
  if(si!=null){ const sc=cands.map(c=>cpuEffScore(u,s.eff,c,si)), mx=Math.max(...sc); cands=cands.filter((_,i)=>sc[i]>=mx-1e-9); }
  else if(k.includes('npPow')) return [...cands].sort((a,b)=>ultPower(b)-ultPower(a))[0]; // 宝具威力アップを配る宝具：宝具が強い味方へ
  const hit=cpuPickKind(cands,s,k); if(hit) return hit;
  if(cands.length<2) return cands[0];
  const foes=cands.filter(c=>c.pid!==u.pid);
  if(foes.length===cands.length){ const p=cpuPredictTarget(); return cands.includes(p)?p:cands[0]; }
  const mine=cands.filter(c=>c.pid===u.pid); if(!mine.length) return cands[0];
  const guard=x=>['evade','invul','guts','def','defTrait','nullUnder'].includes(x);
  if(k.some(guard)&&k.every(x=>guard(x)||!FX[x]||FX[x].buff!==true)) return [...mine].sort((a,b)=>hpR(a)-hpR(b))[0];
  return [...mine].sort((a,b)=>attackCount([b])-attackCount([a])||avgDmg(b)-avgDmg(a))[0];
}
// 効果の種類ごとの決め打ち（k＝見る効果の種類）。当てはまる種類がなければ null
function cpuPickKind(cands,s,k){
  if(k.includes('copyBuff')&&s.eff.some(e=>e.k==='copyBuff'&&e.from==='picked')) return [...cands].sort((a,b)=>a.fx.filter(x=>FX[x.k].buff===true).length<b.fx.filter(x=>FX[x.k].buff===true).length?1:-1)[0]; // 強化が多い相手からコピー
  if(k.includes('copyDebuff')&&s.eff.some(e=>e.k==='copyDebuff'&&e.from==='picked')) return [...cands].sort((a,b)=>a.fx.filter(x=>FX[x.k].buff===false).length<b.fx.filter(x=>FX[x.k].buff===false).length?1:-1)[0];
  if(k.includes('copyRoll')){ const avg=x=>D(x.def).faces.reduce((s2,f)=>s2+(isCopyCmd(f.post)?0:f.post.dmg||0),0); return [...cands].sort((a,b)=>avg(b)-avg(a))[0]; } // 再臨後コマンドの平均ダメージが高い相手の鉛筆
  if(k.includes('heal')||k.includes('cleanse')) return [...cands].sort((a,b)=>hpR(a)-hpR(b))[0];
  if(k.includes('np')){ const below=cands.filter(c=>c.np<RULES.ultCost); return [...(below.length?below:cands)].sort((a,b)=>b.np-a.np)[0]; }
  if(['stun','charm','petrify','bind','sleep','confuse','fear','sealSkill','sealUlt','instantDeath'].some(x=>k.includes(x))) return [...cands].sort((a,b)=>b.np-a.np||b.hp-a.hp)[0];
  if(k.includes('erosion')&&!k.includes('poison')){ const c=cands.filter(x=>has(x,'poison')); if(c.length) return [...c].sort((a,b)=>b.hp-a.hp)[0]; }
  if(k.includes('poison')||k.includes('burn')){ const c=cands.filter(x=>!has(x,'poison')&&!has(x,'burn')); return [...(c.length?c:cands)].sort((a,b)=>b.hp-a.hp)[0]; }
  return null;
}
// 攻撃対象：倒し切れる相手（NPが高い・コストが高い方）を優先、無理なら削れる割合が大きい相手
function estDamage(t){
  if(G.ult){
    const u=U(G.ult), ud=D(u.def).ult;
    const up=mods(u,'npPow').sum-mods(u,'npPowDown').sum;
    return ud.eff.filter(e=>e.k==='dmg').reduce((s,e)=>s+(e.max?maxHp(t):(dm=>applyPct(Math.max(0,e.v+dm.sum+up),dm.pct))(dmgMods(u,t,ud.c)))*effRollP(e),0)*hitsOf(ud.eff);
  }
  const cols=G.rolled.map(r=>r.cmd.c), chainR=G.rolled.length===3&&cols.every(c=>c==='R');
  return G.rolled.reduce((s,r)=>{
    const c=r.cmd, a=U(r.uid); if(!c.dmg) return s+cmdEffDmg(a,c,t,true);
    const dm=dmgMods(a,t,c.c), d=applyPct(Math.max(0,c.dmg+dm.sum)+(chainR?RULES.chainR:0),dm.pct);
    return s+d*hitsOf(c.eff)*(isAoe(c.eff)?Math.max(1,alive(t.pid).length):1)+cmdEffDmg(a,c,t,true);
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
// つよい以上の攻撃対象の候補：単体宝具は、すべて防がれる相手（回避・無敵）を外す（ほかに通る相手がいるとき）
const cpuTargetCands = ()=>{ const c=targetCandidates(); if(!G.ult||G.targetAll) return c; const u=U(G.ult), ok=c.filter(t=>ultLand(u,t)>0); return ok.length?ok:c; };
let TGT_GUARD = true; // 通常攻撃の対象選び（脅威度）：回避・無敵は一律「4割」ではなく、防がれる回数を数える（false＝4割）
// 通常攻撃が通る割合：攻撃 hits 回のうち、回避・無敵の回数ぶん（回数なしは全部）が防がれる
function atkPass(t,hits){ if(!hits) return 1; const g=t.fx.filter(x=>x.k==='invul'||x.k==='evade').reduce((s,x)=>s+(x.times==null?Infinity:x.times),0); return Math.max(0,hits-Math.min(g,hits))/hits; }
const cpuThreat = t=>avgDmg(t)*1.5+ultPower(t)*.3+40;
// 睡眠中の敵は殴ると目を覚ますので、倒せないなら起きている敵を狙う（ミラー戦4000試合：51.5%、狙いを変えないと 49.4%）
function cpuThreatTarget(){
  let c=cpuTargetCands();
  if(c.length>1&&c.some(t=>has(t,'sleep'))){ const aw=c.filter(t=>!t.fx.some(e=>e.k==='sleep'&&!e.sure)||estDamage(t)>=t.hp); if(aw.length) c=aw; }
  const hits=G.ult?D(U(G.ult).def).ult.eff.filter(e=>e.k==='dmg').length*hitsOf(D(U(G.ult).def).ult.eff):G.rolled.reduce((s,r)=>s+(r.cmd.dmg>0?hitsOf(r.cmd.eff):0),0);
  let best=c[0], bs=-Infinity;
  for(const t of c){
    let d=estDamage(t); if(G.ult) d*=ultPass(U(G.ult),t); else if(has(t,'invul')||has(t,'evade')) d*=TGT_GUARD?atkPass(t,hits):.4; // 宝具は防がれる割合をそのまま見る。通常攻撃は防がれる回数を引く（atkPass）
    const th=cpuThreat(t), kill=d>=t.hp&&!has(t,'guts');
    let sc=Math.min(d,t.hp)/maxHp(t)*th + th*.5;
    if(kill){ if(t.np>=70) sc+=ultPower(t)*.5; } // 宝具が近い相手を倒せるなら止める
    else if(t.np<RULES.ultCost && !has(t,'curse') && !has(t,'hitNpSeal') && t.np+hits*RULES.gaugeOnHit>=RULES.ultCost) sc-=ultPower(t)*.3;
    if(TGT_LEARN) sc=cpuTgtLearn(t,d,sc,kill,hits);
    if(sc>bs){ bs=sc; best=t; }
  }
  return best;
}
// 攻撃対象の点数の補正（学習）：つよい同士の試合で、攻撃対象を選ぶ場面ごとに全候補を先読み（16回×40ターン）で評価し、
// 「脅威度の点数から別の相手に変えたときの勝率の差」を候補の特徴の一次式で当てはめた重み（通常攻撃 約10万件・宝具 約7千件）。
// 交差検証では判断1回あたり 通常 +1.5%・宝具 +2.2%。重みどうしは相関が強いので、1つずつの意味は読まない
let TGT_LEARN = true;
const TGT_W = {
  atk:{hsc:2.357,dmgFrac:-10.811,dmgAbs:6.624,kill:.935,killNp70:-2.87,killReady:4.92,feed:1.204,th:3.319,hpR:.926,hp:-1.938,np:-.975,ready:3.659,ult:-1.75,pass:-2.877,cost:2.396,ultNoTgt:-1.444,skillsLeft:1.226,buffs:.144,debuffs:-.36,disabled:-.479,hpAfter:11.737,readyAfter:-1.261},
  ult:{hsc:1.573,dmgFrac:2.458,dmgAbs:4.838,kill:1.081,killNp70:-1.433,killReady:3.063,feed:-1.983,th:1.359,hpR:5.639,hp:-.943,np:.395,ready:2.554,ult:-.211,avg:1.047,pass:-.109,cost:4.663,guts:1.782,ultNoTgt:-3.736,skillsLeft:1.926,buffs:1.128,debuffs:-1.31,disabled:-3.522,hpAfter:3.181,readyAfter:-.509},
};
function cpuTgtLearn(t,d,sc,kill,hits){
  const w=G.ult?TGT_W.ult:TGT_W.atk, est=estDamage(t), pass=est>0?d/est:1, dd=Math.min(d,t.hp), mhp=maxHp(t), ready=t.np>=RULES.ultCost;
  const feed=!kill&&t.np<RULES.ultCost&&!has(t,'curse')&&!has(t,'hitNpSeal')&&t.np+hits*RULES.gaugeOnHit>=RULES.ultCost;
  const x={hsc:sc/100, dmgFrac:dd/mhp, dmgAbs:dd/100, kill:+kill, killNp70:+(kill&&t.np>=70), killReady:+(kill&&ready), feed:+feed,
    th:cpuThreat(t)/100, hpR:t.hp/mhp, hp:t.hp/100, np:t.np/100, ready:+ready, ult:ultPower(t)/100, avg:avgDmg(t)/10, pass, cost:D(t.def).cost,
    guts:+has(t,'guts'), ultNoTgt:+!!ultNoTarget(t), skillsLeft:t.used.filter(x=>!x).length,
    buffs:t.fx.filter(x=>FX[x.k]&&FX[x.k].buff===true).length, debuffs:t.fx.filter(x=>FX[x.k]&&FX[x.k].buff===false).length,
    disabled:+!!disabled(t), hpAfter:Math.max(0,t.hp-dd)/mhp, readyAfter:+(ready&&!kill)};
  let s=0; for(const k in w) s+=w[k]*x[k]; return s;
}

// ---------- 超つよい：攻撃対象を先読みで選ぶ（モンテカルロ） ----------
// 候補ごとに局面をコピーし、その相手を攻撃してから両陣営「つよい」（先読みなし）で決着まで mcRollouts() 回進めて、勝った回数が多い相手を選ぶ。
// 実際の出目は知らない（試しの乱数は別物）。ルール処理はエンジンそのものなので、ルールを変えても追従する
let cpuMcMemo=null;
function cpuMcTarget(){
  const c=cpuTargetCands();
  if(c.length<2) return c[0];
  const key=`${G.seed}|${G.turn}|${G.ult}|${G.rolled.length}`;
  if(cpuMcMemo&&cpuMcMemo.key===key&&c.some(u=>u.uid===cpuMcMemo.uid)) return U(cpuMcMemo.uid);
  const score=cpuMcScores(c.map(t=>()=>{ G.target=t.uid; resolveDamage(); }));
  let bi=0; score.forEach((s,i)=>{ if(s>score[bi]) bi=i; });
  cpuMcMemo={key, uid:c[bi].uid};
  return c[bi];
}
// 超つよい：スキル・宝具の手を先読みで選ぶ。h は「つよい」の手。
// 候補が多いと運よく高く出た手を選びがちなので、h より MC_MARGIN（勝率）以上よいときだけ h から変える
let MC_MARGIN = .1;
// チームバトルでもスキル・宝具を先読みで選ぶ強さ（'expert' / 'hard,expert' など。'' ＝使わない。hard は CPU_LOOKAHEAD のときだけ）
// 測定（旧版との対戦・各400試合）：expert で team 58.6%・mteam 59.3%。考える時間は1手番 平均約0.7〜1.1秒（旧 約0.2秒）。
// hard でも team 52.6%・mteam 54.4%（各800試合）と少し強くなるが、時間が約4倍（先読みありのバランス検証も遅くなる）ので入れていない
let MC_SKILL_TEAM = 'expert';
const mcSkillOn = ()=>!cpuInRollout && (ruleset().partyMax===1 ? G.level==='expert'
  : MC_SKILL_TEAM.split(',').includes(G.level) && (G.level==='expert'||CPU_LOOKAHEAD));
function cpuMcSkill(h){
  const cands=[['skillDone']];
  if(!G.ult&&!G.ultDone) alive(G.cur).forEach(u=>{ if(canUlt(u)&&u.np>=RULES.ultCost) cands.push(['useUlt',{uid:u.uid}]); });
  usableSkills().forEach(x=>{ if(D(x.u.def).skills[x.si].eff.length&&!cpuSkillWaste(x.u,x.si)) cands.push(['useSkill',{uid:x.u.uid,si:String(x.si)}]); });
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
