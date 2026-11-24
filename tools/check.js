// ヘッドレス検証：画面なしで CPU 同士の対戦を回し、止まる・例外・NaN が出ないかを見る（AGENTS.md §7）
//
//   node tools/check.js                 全ルール × 200試合 ＋ ドラフト
//   node tools/check.js -n 500          試合数（ルールごと）
//   node tools/check.js -r team,mteam   ルールを絞る（rules.js の RULESETS のキー）
//   node tools/check.js -l hard         CPU の強さを固定（既定：よわい・ふつう・つよい を混ぜる）
//   node tools/check.js --look          「つよい」の先読みを有効にする（実際のゲームと同じ。かなり遅い）
//   node tools/check.js --no-draft      ドラフトの検証を省く
//   node tools/check.js --no-modes      ボスレイド・聖杯戦争（試験版）の検証を省く
//   node tools/check.js --modes-only    ボスレイド・聖杯戦争だけ（-n は難易度ごとの挑戦回数。既定 200 のときは 40）
//   node tools/check.js --pl normal     ボスレイド・聖杯戦争で自軍を動かす CPU の強さ（既定 hard。人の代わり）
//
// 人と同じく act() → ACTIONS を通す（編成は setupCpu / setupRandom、対戦は cpuDecide の手）。
// 問題が1つでもあれば終了コード 1。問題が出た試合は、最後のログ数行と一緒に表示する。
'use strict';
const fs=require('fs'), vm=require('vm'), path=require('path');
const argv=process.argv.slice(2), opt=(...names)=>{ const i=argv.findIndex(a=>names.includes(a)); return i<0?null:argv[i+1]; }, flag=n=>argv.includes(n);
const N=Math.max(1,Number(opt('-n','--games'))||200), ONLY=opt('-r','--rule'), LEVEL=opt('-l','--level'), LOOK=flag('--look'), DRAFT_ON=!flag('--no-draft');
const MODES_ONLY=flag('--modes-only'), MODES=MODES_ONLY||!flag('--no-modes'), NM=Number(opt('-n','--games'))||40, PL=opt('--pl')||'hard';

// ---- ゲームのスクリプトを、ブラウザなしの入れ物（vm）に読み込む ----
const store=()=>({getItem(){return null},setItem(){},removeItem(){}});
const ctx={console,Math,Date,JSON,localStorage:store(),sessionStorage:store(),document:{},setTimeout(){return 0},clearTimeout(){}};
ctx.window=ctx; vm.createContext(ctx);
const dir=path.join(__dirname,'..','js');
for(const f of ['rules','units','masters','common','engine','cpu']) vm.runInContext(fs.readFileSync(path.join(dir,f+'.js'),'utf8'),ctx,{filename:f+'.js'});

// ---- 検証の本体（ゲームと同じ入れ物の中で動かす。G や act をそのまま使える） ----
const body=function(N,ONLY,LEVEL,LOOK,DRAFT_ON,MODES,MODES_ONLY,NM,PL){
  const TURN_LIMIT=200, STEP_LIMIT=60000, LEVELS=['easy','normal','hard'];
  const any=a=>a[Math.floor(Math.random()*a.length)], lv=()=>LEVEL||any(LEVELS);
  CPU_LOOKAHEAD=!!LOOK;
  const problems=[], out=[];
  const bad=(where,what)=>{ if(problems.length<20) problems.push({where,what,log:G.log.slice(-4).map(l=>String(l.msg).replace(/<[^>]+>/g,''))}); };
  // 1手進める。cpuDecide が手を返さなければ false
  const step=()=>{ if(G.levels) G.level=G.levels[actor()]; const m=cpuDecide(); if(!m) return false; act(m[0],m[1]||{}); FXQ.length=0; FXHIDE.clear(); return true; };
  // 数値が壊れていないか（HP・NP・スター、ログの文字）
  let seen=0;
  const scan=where=>{
    for(;seen<G.log.length;seen++){ const s=String(G.log[seen].msg); if(/NaN|undefined|Infinity/.test(s)){ bad(where,'ログに '+s.match(/NaN|undefined|Infinity/)[0]); return false; } }
    for(const P of G.players){
      if(!Number.isFinite(P.stars)){ bad(where,'スターが数値でない'); return false; }
      for(const u of [...P.party,...(P.master?[P.master]:[])]) if(!Number.isFinite(u.hp)||!Number.isFinite(u.np)){ bad(where,`${u.def} の HP/NP が数値でない`); return false; }
    }
    return true;
  };
  // 対戦を決着まで進める。結果：0/1＝勝った陣営、'draw'＝ターン上限、null＝問題あり
  const play=where=>{
    seen=0; let steps=0;
    while(G.phase!=='over'){
      if(G.turn>TURN_LIMIT) return 'draw';
      if(++steps>STEP_LIMIT){ bad(where,`${STEP_LIMIT}手を超えても終わらない（phase=${G.phase}）`); return null; }
      let ok; try{ ok=step(); }catch(e){ bad(where,'例外：'+(e&&e.stack||e)); return null; }
      if(!ok){ bad(where,`CPU の手がない（phase=${G.phase}）`); return null; }
      if(!scan(where)) return null;
      if(G.log.length>600){ G.log.splice(0,400); seen=G.log.length; }
    }
    if(G.winner!==0&&G.winner!==1){ bad(where,'決着したのに勝者がいない'); return null; }
    return G.winner;
  };
  const tally=(name,run)=>{
    const r={name,games:0,win0:0,win1:0,draw:0,ng:0,turns:0}, t0=Date.now();
    for(let i=0;i<N;i++){
      let w=null; try{ w=run(`${name} #${i+1}`); }catch(e){ bad(`${name} #${i+1}`,'例外：'+(e&&e.stack||e)); }
      r.games++; if(w===0) r.win0++; else if(w===1) r.win1++; else if(w==='draw') r.draw++; else r.ng++;
      r.turns+=G.turn||0;
    }
    r.ms=Date.now()-t0; out.push(r);
  };
  // ボスレイド・聖杯戦争（試験版）：最初から最後まで通す。自軍も CPU（強さ PL）。負けたらコンティニュー（上限 MAXC 回）
  // 結果：難易度ごとのクリア数・平均コンティニュー・ステージごとの勝率（そのステージの全挑戦のうち勝った割合）
  const camp=[], MAXC=30;
  const campaign=(kind,diff,where,rec)=>{
    newGame({rule:'team'}); act('chooseMode',{mode:kind,diff});
    if(!G.arcade||arcadeKind()!==kind){ bad(where,'モードが始まらない'); return null; }
    if(kind!=='rogue'){ act('setupCpu',{how:'random'}); act('setupConfirm'); }
    for(let n=0;n<400;n++){
      if(G.phase==='reward'){ const o=G.arcade.offer||[]; if(!o.length){ bad(where,'報酬の候補がない'); return null; } act('rogueReward',{i:Math.floor(Math.random()*o.length)}); if(G.phase==='reward'){ bad(where,'報酬を選べない'); return null; } continue; }
      if(G.phase!=='stage'){ bad(where,`ステージ紹介に進まない（phase=${G.phase}）`+G.setupMsg); return null; }
      const i=G.arcade.stage; act('arcadeGo'); G.levels=[PL,G.level]; G.cpu=[true,true];
      const boss=G.boost&&G.boost[1]&&G.boost[1].boss, w=play(where); if(w==null) return null;
      const s=rec.st[i]||(rec.st[i]={n:0,w:0,boss}); s.n++; if(w===0) s.w++;
      if(w===0){ if(arcadeLast()) return {clear:true,cont:G.arcade.continues}; act('arcadeNext'); continue; }
      if(w==='draw'){ rec.draw++; return {clear:false,cont:G.arcade.continues}; }
      if(G.arcade.continues>=MAXC) return {clear:false,cont:G.arcade.continues};
      act('arcadeContinue');
      if(G.phase!=='stage'||!G.picks[1].length){ bad(where,'コンティニューで同じステージに戻らない'); return null; }
    }
    bad(where,'400戦を超えても終わらない'); return null;
  };
  if(MODES) for(const kind of ['raid','rogue']) for(const diff of Object.keys(ARC_KINDS[kind].cfg().diffs)){
    const rec={name:`${ARC_KINDS[kind].name}（${ARC_KINDS[kind].cfg().diffs[diff].name}）`,runs:0,clears:0,cont:0,ng:0,draw:0,st:[]}, t0=Date.now();
    for(let r=0;r<NM;r++){ let x=null; try{ x=campaign(kind,diff,`${rec.name} #${r+1}`,rec); }catch(e){ bad(`${rec.name} #${r+1}`,'例外：'+(e&&e.stack||e)); }
      rec.runs++; if(!x){ rec.ng++; continue; } if(x.clear) rec.clears++; rec.cont+=x.cont; }
    rec.ms=Date.now()-t0; camp.push(rec);
  }
  if(MODES_ONLY) return {out,problems,camp};
  const rules=Object.keys(RULESETS).filter(k=>!ONLY||ONLY.split(',').includes(k));
  if(!rules.length) return {error:'ルールが見つかりません：'+ONLY+'（'+Object.keys(RULESETS).join(' / ')+'）'};
  for(const rule of rules){
    // 通常の対戦：観戦モードと同じ流れ（両方 CPU）。編成は「同コスト」と「ランダム」を混ぜる
    tally(rule,where=>{
      newGame({rule,handicap:Math.random()<.5});
      act('chooseMode',{mode:'watch',level:lv(),level2:lv()});
      act('setupRandom'); act('setupConfirm');
      act('setupCpu',{how:Math.random()<.5?'same':'random'}); act('setupConfirm');
      if(G.phase==='setup'||G.phase==='mode'){ bad(where,'編成から対戦に進めない：'+G.setupMsg); return null; }
      return play(where);
    });
    // ドラフト：候補の取り合いも CPU に任せる（陣営0 も CPU にする）
    if(DRAFT_ON&&typeof DRAFT!=='undefined') tally(rule+'（ドラフト）',where=>{
      newGame({rule,handicap:Math.random()<.5});
      act('chooseMode',{mode:'draft',level:lv()});
      G.cpu=[true,true];
      let n=0; while(G.phase==='draft'&&!G.draft.done){ if(++n>50||!step()){ bad(where,'ドラフトが進まない'); return null; } }
      const rs=ruleset(), R=G.draft, all=[...G.picks[0],...G.picks[1]];
      if(new Set(all).size!==all.length) bad(where,'同じサーヴァントを両方が取っている');
      if(G.picks.some((p,pid)=>!p.length||p.length>rs.partyMax||(rs.partyMax>1&&sumCost(p)+mcost(pid)>costCap()))) bad(where,'ドラフトの編成が人数・コスト上限に合わない');
      if(all.some(id=>!R.pool.includes(id))||(rs.master&&G.mpicks.some(m=>!R.mpool.includes(m)))) bad(where,'候補にないキャラを取っている');
      act('draftGo');
      if(G.phase==='draft'){ bad(where,'ドラフトから対戦に進めない'); return null; }
      return play(where);
    });
  }
  return {out,problems,camp};
};
const res=vm.runInContext(`function render(){}\n(${body})(${JSON.stringify(N)},${JSON.stringify(ONLY)},${JSON.stringify(LEVEL)},${LOOK},${DRAFT_ON},${MODES},${MODES_ONLY},${NM},${JSON.stringify(PL)})`,ctx);

if(res.error){ console.error(res.error); process.exit(1); }
const pad=(s,n)=>{ s=String(s); let w=0; for(const ch of s) w+=ch.charCodeAt(0)>255?2:1; return s+' '.repeat(Math.max(0,n-w)); };
if(res.out.length) console.log(pad('ルール',24)+pad('試合',6)+pad('P1勝',6)+pad('P2勝',6)+pad('引分',6)+pad('異常',6)+pad('平均ターン',12)+'時間');
for(const r of res.out) console.log(pad(r.name,24)+pad(r.games,6)+pad(r.win0,6)+pad(r.win1,6)+pad(r.draw,6)+pad(r.ng,6)+pad((r.turns/r.games).toFixed(1),12)+(r.ms/1000).toFixed(1)+'s');
if(res.out.length) console.log('（P1勝・P2勝＝陣営ごとの勝ち数。引分＝200ターンで打ち切り）');
if(res.camp&&res.camp.length){
  console.log(`
ボスレイド・聖杯戦争（試験版。自軍も CPU：${PL}。負けたらコンティニュー）`);
  console.log(pad('モード',28)+pad('挑戦',6)+pad('クリア',8)+pad('平均コンテ',12)+pad('異常',6)+'ステージごとの勝率（B＝ボス戦）');
  for(const r of res.camp) console.log(pad(r.name,28)+pad(r.runs,6)+pad(r.clears,8)+pad((r.cont/Math.max(1,r.runs-r.ng)).toFixed(1),12)+pad(r.ng,6)
    +r.st.map((s,i)=>`${i+1}${s.boss?'B':''}:${Math.round(s.w/s.n*100)}%`).join(' ')+`  ${(r.ms/1000).toFixed(1)}s`);
}
if(res.problems.length){
  console.log(`\n問題 ${res.problems.length} 件${res.problems.length>=20?'（最初の20件まで）':''}：`);
  for(const p of res.problems){ console.log(`- ${p.where}：${p.what}`); for(const l of p.log) console.log('    '+l); }
  process.exit(1);
}
console.log('\n問題なし');
