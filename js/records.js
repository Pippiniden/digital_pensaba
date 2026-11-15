'use strict';
/* =====================================================================
   戦績（pencilduel.records）と保存した編成（pencilduel.parties）
   - どちらも端末の localStorage に持つ。試合の状態（G）には入れない
   - 戦績は engine.js の win() が recordMatch() を呼んで記録する（決着のたびに1回。CPUの先読み中・シナリオの戦闘は数えない）
   - 画面：戦績＝タイトルの「戦績」（recordsBodyHTML）と図鑑の詳細（recUnitHTML）／ 編成＝編成画面の「編成リスト」（partyModalHTML）
   ===================================================================== */
const REC_KEY='pencilduel.records', PARTY_KEY='pencilduel.parties', PARTY_MAX=30;
function lsGet(k,def){ try{ const v=JSON.parse(localStorage.getItem(k)); return v==null?def:v; }catch(e){ return def; } }
function lsSet(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} }

// ---------- 戦績 ----------
// cpu[rule][level]={w,l} / pvp[rule]={n} / arcade[rule][diff]={battles,wins,clears,best,minCont,bestTurns} / units[id]={use,win,dealt,kills}
const recEmpty = ()=>({v:1, cpu:{}, pvp:{}, arcade:{}, units:{}});
function recLoad(){ const r=lsGet(REC_KEY,null); return r&&r.v===1?{...recEmpty(),...r}:recEmpty(); }
function recReset(){ try{ localStorage.removeItem(REC_KEY); }catch(e){} }
function recordMatch(){
  if(G.scn||G.winner==null||(typeof netOn==='function'&&netOn())) return; // オンライン対戦は数えない
  const R=recLoad(), w=G.winner, cpu=G.mode==='cpu', at=(o,k,d)=>o[k]||(o[k]=d);
  if(G.arcade){ // アーケード：best＝勝ち抜いたステージ数の最高（エンドレスは連勝数）。クリア時は最少コンティニューと最短の合計ターンも残す
    const A=G.arcade, a=at(at(R.arcade,G.rule,{}),A.diff,{battles:0,wins:0,clears:0,best:0,minCont:null,bestTurns:null});
    a.battles++;
    if(w===0){ a.wins++; a.best=Math.max(a.best,A.stage+1);
      if(arcadeLast()){ const c=A.continues||0, t=A.results.reduce((s,r)=>s+r.turn,0)+G.turn;
        a.clears++; a.minCont=a.minCont==null?c:Math.min(a.minCont,c); a.bestTurns=a.bestTurns==null?t:Math.min(a.bestTurns,t); } }
  }else if(cpu){ const c=at(at(R.cpu,G.rule,{}),G.level,{w:0,l:0}); if(w===0) c.w++; else c.l++; }
  else at(R.pvp,G.rule,{n:0}).n++;
  // キャラごと：CPU戦は自分の側だけ、ローカル対戦は両方
  (cpu?[0]:[0,1]).forEach(pid=>{ const P=G.players[pid];
    [...P.party,...(P.master?[P.master]:[])].forEach(u=>{ const s=(G.stats&&G.stats[u.uid])||{}, x=at(R.units,u.def,{use:0,win:0,dealt:0,kills:0});
      x.use++; if(w===pid) x.win++; x.dealt+=Math.round(s.dealt||0); x.kills+=s.kills||0; }); });
  lsSet(REC_KEY,R);
}
const recPct = (w,n)=>n?`${Math.round(w/n*100)}%`:'—';
// 図鑑の詳細に出す1行（使ったことがあるキャラだけ）
function recUnitHTML(d){
  const x=recLoad().units[d.id]; if(!x||!x.use) return '';
  return `<h4>戦績</h4><p class="sub small recunit">使用 <b>${x.use}</b>回 ・ 勝率 <b>${recPct(x.win,x.use)}</b>${d.master?'':` ・ 与ダメージ <b>${fmt(x.dealt)}</b> ・ 撃破 <b>${x.kills}</b>`}</p>`;
}
// タイトルの「戦績」パネルの中身。リセットは確認つき（UI.recAsk）
function recordsBodyHTML(){
  const R=recLoad(), rules=Object.keys(RULESETS), lvs=Object.keys(CPU_LEVELS), dfs=Object.keys(ARCADE.diffs);
  const sec=(t,body)=>`<div class="recsec"><h3>${t}</h3>${body}</div>`, none='<p class="sub small">まだ記録がありません。</p>';
  const table=(head,rows)=>`<div class="rtablewrap"><table class="rtable"><thead><tr>${head.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  const cpuRows=rules.filter(k=>R.cpu[k]).map(k=>`<tr><th>${esc(RULESETS[k].name)}</th>${lvs.map(l=>{ const c=R.cpu[k][l]; return `<td>${c?`${c.w}勝${c.l}敗<small class="sub"> ${recPct(c.w,c.w+c.l)}</small>`:'—'}</td>`; }).join('')}</tr>`);
  const arcRows=rules.filter(k=>R.arcade[k]).flatMap(k=>dfs.filter(d=>R.arcade[k][d]).map(d=>{ const a=R.arcade[k][d], df=ARCADE.diffs[d];
    return `<tr><th>${esc(RULESETS[k].name)}<small class="sub"> ${esc(df.name)}</small></th>${df.endless
      ?`<td>—</td><td>${a.best}連勝</td><td>—</td><td>—</td>`
      :`<td>${a.clears}回</td><td>${a.best?`STAGE ${Math.min(a.best,ARCADE.stages)}`:'—'}</td><td>${a.minCont==null?'—':`${a.minCont}回`}</td><td>${a.bestTurns==null?'—':`${a.bestTurns}ターン`}</td>`}</tr>`; }));
  const pvp=rules.filter(k=>R.pvp[k]).map(k=>`${esc(RULESETS[k].name)} <b>${R.pvp[k].n}</b>戦`).join(' ・ ');
  const us=Object.entries(R.units).map(([id,x])=>({d:D(id),x})).filter(o=>o.d&&o.x.use).sort((a,b)=>b.x.use-a.x.use||b.x.win-a.x.win).slice(0,12);
  const units=us.map(({d,x})=>`<div class="rrow">${unitImg(d,'face','pimg',d.name)}<b>${esc(d.name)}</b><span>使用 ${x.use} ・ 勝率 ${recPct(x.win,x.use)}${d.master?'':`<small> ・ 与ダメ ${fmt(x.dealt)} ・ 撃破 ${x.kills}</small>`}</span></div>`).join('');
  const empty=!cpuRows.length&&!arcRows.length&&!pvp&&!us.length;
  const reset=UI.recAsk
    ? `<p class="warn nm">すべての戦績を消します。元に戻せません。</p><div class="row"><button class="ghost" data-ui="recCancel">やめる</button><button data-ui="recReset">リセットする</button></div>`
    : `<div class="row"><button data-ui="recAsk" ${empty?'disabled':''}>記録をリセット</button></div>`;
  return `<div class="recs">
    ${sec('クイックバトル',cpuRows.length?table(['',...lvs.map(l=>esc(CPU_LEVELS[l].name))],cpuRows):none)}
    ${sec('アーケード',arcRows.length?table(['','クリア','最高到達','最少コンティニュー','最短クリア'],arcRows):none)}
    ${sec('ローカル対戦',pvp?`<p class="small nm">${pvp}</p>`:none)}
    ${sec('よく使うキャラクター',units||none)}
    <p class="sub small">戦績はこの端末のブラウザに保存されます。シナリオの戦闘は含みません。</p>
    <div class="recreset">${reset}</div>
  </div>`;
}

// ---------- 保存した編成 ----------
// [{rule, picks:[id], mpick:id|null}]（新しい順。同じ内容は1つだけ）。呼び出しは act('setupLoad',…) を通す
function partyList(){ const l=lsGet(PARTY_KEY,[]); return Array.isArray(l)?l.filter(e=>e&&Array.isArray(e.picks)):[]; }
const partySig = e=>JSON.stringify([e.rule,e.picks,e.mpick||null]);
function partySaveCur(){
  const pid=G.setupPid, picks=G.picks[pid].slice(); if(G.phase!=='setup'||!picks.length) return;
  const e={rule:G.rule, picks, mpick:masterRule()?G.mpicks[pid]||null:null};
  lsSet(PARTY_KEY,[e,...partyList().filter(x=>partySig(x)!==partySig(e))].slice(0,PARTY_MAX));
}
function partyDelete(sig){ lsSet(PARTY_KEY,partyList().filter(x=>partySig(x)!==sig)); }
// 今のデータ・ルールで使えるか（キャラが消えた・コストが変わった編成は呼び出せない）
function partyUsable(e){
  const rs=ruleset();
  if(e.rule!==G.rule||!e.picks.length||e.picks.length>rs.partyMax||!e.picks.every(id=>UNITS.some(u=>u.id===id))) return false;
  if(rs.master&&!MASTERS.some(m=>m.id===e.mpick)) return false;
  return rs.partyMax===1||sumCost(e.picks)+(rs.master?D(e.mpick).cost:0)<=costCap();
}
function partyModalHTML(){
  if(!UI.party||G.phase!=='setup') return '';
  const pid=G.setupPid, list=partyList().filter(e=>e.rule===G.rule), can=G.picks[pid].length&&(!masterRule()||G.mpicks[pid]);
  const rows=list.map(e=>{ const sig=partySig(e), ok=partyUsable(e), ds=[...e.picks.map(D),D(e.mpick)].filter(Boolean), m=D(e.mpick);
    const cost=ds.reduce((s,d)=>s+d.cost,0), del=UI.partyDel===sig;
    return `<div class="prow ${ok?'':'bad'}"><div class="pminis">${ds.map(d=>`<span class="arc-mini${d===m?' m':''}" title="${esc(d.name)}">${unitImg(d,'face','pimg',d.name)}</span>`).join('')}<span class="arc-cost">COST <b>${cost}</b></span></div>
      <b class="pnames">${ds.map(d=>esc(d.name)).join('・')||'（キャラクターがいません）'}</b>
      <div class="pbtns">${del?`<button class="small ghost" data-ui="partyDelCancel">やめる</button><button class="small" data-ui="partyDel" data-sig="${esc(sig)}">削除する</button>`
        :`<button class="small ghost" data-ui="partyDelAsk" data-sig="${esc(sig)}">削除</button><button class="small primary" data-ui="partyLoad" data-sig="${esc(sig)}" ${ok?'':'disabled'} title="${ok?'この編成にします':'今のデータ・コスト上限では使えません'}">呼び出す</button>`}</div></div>`; }).join('');
  return `<div class="modal navmodal"><div class="mback" data-ui="partyClose"></div><div class="mbody navpanel wide"><div class="navbar"><button class="back" data-ui="partyClose">閉じる</button></div>
    <p class="navtitle">編成リスト</p>
    <div class="row partytop"><button data-ui="partySave" ${can?'':'disabled'} title="今選んでいる編成を保存します">今の編成を保存</button></div>
    <div class="plist">${rows||`<p class="sub small">${esc(ruleset().name)}ルールで保存した編成はまだありません。</p>`}</div>
    <p class="sub small">編成はルールごとに、この端末のブラウザへ最大${PARTY_MAX}件まで保存されます。</p></div></div>`;
}
