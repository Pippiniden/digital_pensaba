'use strict';
/* =====================================================================
   エディタ：バランス検証（シンプルルールの自動対戦）
   - 編集中のデータ（units）で、両者 CPU（ふつう）の対戦を js/sim-worker.js に回させる
   - 対象：選択中のキャラ vs 他キャラ ／ 全キャラ総当たり
   - 範囲：同コストのみ ／ 全コスト（ハンデ戦 ON/OFF）
   - 除外：特殊なキャラ（例：NP獲得が特殊なメディア）を相手・総当たりから外す。選択はブラウザに保存
   ===================================================================== */

const SIM = { target:'sel', range:'same', handicap:true, n:500, run:null, res:null };
const SIM_NS = [100,300,500,1000,3000];
const SIM_EXCL_KEY = 'pencilduel.simExclude';
SIM.excl = new Set(readJSON(SIM_EXCL_KEY)||[]);
const simExcluded = u=>SIM.excl.has(u.id);

const simDlg = ()=>document.querySelector('#simdlg');
const simU = id=>units.find(u=>u.id===id);
const simRate = r=>(r.win+r.draw/2)/Math.max(1,r.n-r.errors);
const simPct = p=>`${Math.round(p*100)}%`;
const simCi = (p,n)=>Math.round(196*Math.sqrt(p*(1-p)/Math.max(1,n)));
// 勝率の評価：同コストなら 50% からのずれ、別コストは参考表示のみ
function simGrade(p,same){
  if(!same) return '';
  const d=Math.abs(p-.5); return d<=.1?'ok':d<=.2?'wrn':'bad';
}

function simPairs(){
  const ok=u=>u&&u.id;
  if(SIM.target==='all'){
    const ps=[];
    for(let i=0;i<units.length;i++) for(let j=i+1;j<units.length;j++){
      const a=units[i], b=units[j];
      if(ok(a)&&ok(b)&&!simExcluded(a)&&!simExcluded(b)&&(SIM.range==='all'||a.cost===b.cost)) ps.push([a.id,b.id]);
    }
    return ps;
  }
  const t=cur(); if(!t) return [];
  return units.filter(u=>u!==t&&u.id!==t.id&&!simExcluded(u)&&(SIM.range==='all'||u.cost===t.cost))
    .sort((a,b)=>a.cost-b.cost||units.indexOf(a)-units.indexOf(b)).map(u=>[t.id,u.id]);
}

function simOpen(){
  const d=simDlg(); renderSim();
  if(!d.open) d.showModal();
}
function simClose(){ simStop(); simDlg().close(); }
function simStop(){
  if(SIM.run){ SIM.run.w.terminate(); SIM.run=null; }
}
function simStart(){
  if(hasErrors(units)){ toast('エラーがあるため検証できません。右の「検証」を確認してください',true); return; }
  const pairs=simPairs();
  if(!pairs.length){ toast(SIM.range==='same'?'同じコストの相手がいません。範囲を「全コスト」にしてください':'対戦できる組み合わせがありません',true); return; }
  simStop();
  let w;
  try{ w=new Worker('js/sim-worker.js'); }
  catch(e){ toast('検証を開始できませんでした（ローカルサーバーで開いてください）',true); return; }
  const snap=clone(units);
  SIM.run={w, total:pairs.length, done:0, t0:Date.now()};
  SIM.res={target:SIM.target, sel:cur()&&cur().id, range:SIM.range, handicap:SIM.handicap, n:SIM.n, units:snap, excl:units.filter(simExcluded).map(u=>u.name), pairs:[], done:false};
  w.onmessage=e=>{
    const m=e.data;
    if(m.t==='pair'){ SIM.res.pairs.push(m.r); SIM.run.done++; renderSim(); }
    else if(m.t==='done'){ SIM.res.done=true; SIM.res.ms=Date.now()-SIM.run.t0; simStop(); renderSim(); }
    else if(m.t==='error'){ simStop(); renderSim(); toast(`検証中にエラー：${m.msg}`,true); }
  };
  w.onerror=e=>{ e.preventDefault(); simStop(); renderSim(); toast(`検証を実行できませんでした：${e.message||'Worker の読み込みに失敗'}（ローカルサーバーで開いてください）`,true); };
  w.postMessage({units:snap, pairs, n:SIM.n, handicap:SIM.handicap});
  renderSim();
}

// ---------- 描画 ----------
function renderSim(){
  const d=simDlg(); if(!d) return;
  const t=cur(), run=SIM.run, sel=(v,c)=>v===c?'selected':'';
  const nPairs=simPairs().length;
  d.innerHTML=`
    <div class="simhead"><h2>バランス検証 <small class="sub">シンプルルール</small></h2><span class="grow"></span>
      <button class="small" data-act="simClose" title="閉じる">✕</button></div>
    <p class="sub small nm">編集中のデータで、両陣営とも CPU（ふつう）の1騎どうしの対戦を自動で回します。先攻はランダム、${SIM_TURN_LIMIT}ターンで決着しなければ引き分け（勝率は0.5勝扱い）。</p>
    <div class="simopts">
      <label>対象<select data-sim="target" ${run?'disabled':''}>
        <option value="sel" ${sel(SIM.target,'sel')}>選択中：${esc(t?t.name:'-')}（C${t?t.cost:'-'}）</option>
        <option value="all" ${sel(SIM.target,'all')}>全キャラ総当たり</option></select></label>
      <label>相手の範囲<select data-sim="range" ${run?'disabled':''}>
        <option value="same" ${sel(SIM.range,'same')}>同コストのみ</option>
        <option value="all" ${sel(SIM.range,'all')}>全コスト</option></select></label>
      <label class="chk ${SIM.range==='same'?'dim':''}"><input type="checkbox" data-sim="handicap" ${SIM.handicap?'checked':''} ${run?'disabled':''}>ハンデ戦（コスト差${RULESETS.simple.handicapAsc}以上で低コスト側が${TERMS.ascFull}済み）</label>
      <label>1組あたり<select data-sim="n" ${run?'disabled':''}>${SIM_NS.map(n=>`<option value="${n}" ${sel(SIM.n,n)}>${n}試合</option>`).join('')}</select></label>
      ${run?`<button class="small danger" data-act="simStop">中止</button>`
           :`<button class="primary" data-act="simStart" ${nPairs?'':'disabled'}>実行（${nPairs}組 × ${SIM.n}試合）</button>`}
    </div>
    <div class="simexcl"><span class="sub small">検証から外す</span>${units.map((u,i)=>
      `<button class="small xchip ${simExcluded(u)?'on':''}" data-act="simExcl" data-i="${i}" aria-pressed="${simExcluded(u)}" ${run?'disabled':''}
        title="${simExcluded(u)?'クリックで検証に戻す':'クリックで相手・総当たりから外す'}">${esc(u.name)}<span class="sub small">C${u.cost}</span></button>`).join('')}
      ${SIM.excl.size&&SIM.target==='sel'&&t&&simExcluded(t)?'<span class="sub small">（選択中のキャラは外していても対象として検証します）</span>':''}</div>
    ${run?`<div class="simprog"><i style="width:${run.done/run.total*100}%"></i><span>${run.done} / ${run.total} 組</span></div>`:''}
    <div class="simres">${SIM.res?simResultHTML(SIM.res):'<p class="sub small">条件を選んで「実行」を押してください。</p>'}</div>`;
}

function simResultHTML(R){
  if(!R.pairs.length) return '<p class="sub small">集計中…</p>';
  const ud=id=>R.units.find(u=>u.id===id)||{name:id,cost:'?'};
  const cond=`${R.range==='same'?'同コストのみ':`全コスト・ハンデ${R.handicap?'あり':'なし'}`} ／ 1組${R.n}試合${R.excl&&R.excl.length?` ／ 除外：${R.excl.join('・')}`:''}${R.done?`（${(R.ms/1000).toFixed(1)}秒）`:'（実行中）'}`;
  const errs=R.pairs.reduce((s,r)=>s+r.errors,0);
  const errHTML=errs?`<p class="bad small">⚠ ${errs}試合でエラーが起きました：${esc(R.pairs.find(r=>r.errMsg).errMsg)}</p>`:'';
  return (R.target==='all'?simAllHTML(R,ud):simOneHTML(R,ud)).replace('%COND%',esc(cond))+errHTML+
    `<p class="sub small nm">色は同コスト戦の勝率の目安です：<span class="ok">40〜60%</span> ／ <span class="wrn">30〜70%</span> ／ <span class="bad">それより外</span>。±は95%の誤差の幅です。</p>`;
}
function simBar(p){ return `<span class="simbar"><i style="width:${p*100}%"></i></span>`; }

// 選択中のキャラ vs 各相手
function simOneHTML(R,ud){
  const me=ud(R.pairs[0].a);
  const tot=(rs)=>{ const n=rs.reduce((s,r)=>s+r.n-r.errors,0), w=rs.reduce((s,r)=>s+r.win+r.draw/2,0); return n?{p:w/n,n}:null; };
  const same=tot(R.pairs.filter(r=>ud(r.b).cost===me.cost)), all=tot(R.pairs);
  const sum=(x,label,isSame)=>x?`<div class="simsum ${simGrade(x.p,isSame)}"><span class="sub small">${label}</span><b>${simPct(x.p)}</b><span class="sub small">±${simCi(x.p,x.n)}%</span></div>`:'';
  const rows=R.pairs.map(r=>{
    const o=ud(r.b), g=r.n-r.errors, p=simRate(r), isSame=o.cost===me.cost, h=R.handicap&&R.range!=='same'&&Math.abs(o.cost-me.cost)>=RULESETS.simple.handicapAsc;
    const hand=h?(me.cost<o.cost?'自分が再臨':'相手が再臨'):'';
    return `<tr class="${simGrade(p,isSame)}"><td>${esc(o.name)} <span class="sub small">C${o.cost}</span>${hand?` <span class="tag">${hand}</span>`:''}</td>
      <td class="num rate"><b>${simPct(p)}</b> <span class="sub small">±${simCi(p,g)}</span></td><td>${simBar(p)}</td>
      <td class="num">${r.win}-${r.lose}${r.draw?`-${r.draw}`:''}</td>
      <td class="num">${(r.turns/Math.max(1,g)).toFixed(1)}</td>
      <td class="num">${r.win?simPct(r.npWin/r.win):'-'}</td><td class="num">${r.lose?simPct(r.npLose/r.lose):'-'}</td>
      <td class="num">${r.firstGames?simPct(r.firstWin/r.firstGames):'-'}</td>
      <td class="num">${Math.round(r.dealtA/Math.max(1,g))} / ${Math.round(r.dealtB/Math.max(1,g))}</td></tr>`;
  }).join('');
  return `<div class="simsums"><div class="simme"><b>${esc(me.name)}</b> <span class="sub small">C${me.cost} ・ HP${me.hp}</span><div class="sub small">%COND%</div></div>
      ${sum(same,'同コスト勝率',true)}${R.range==='all'?sum(all,'全体勝率',false):''}</div>
    <div class="simtbl"><table class="stats sim"><thead><tr><th>相手</th><th>勝率</th><th></th><th>勝-敗${R.pairs.some(r=>r.draw)?'-分':''}</th><th>平均ターン</th>
      <th title="勝った試合のうち${TERMS.ult}発動（NP勝利）の割合">宝具で勝ち</th><th title="負けた試合のうち相手の${TERMS.ult}発動で負けた割合">宝具で負け</th>
      <th title="自分が先攻だった試合の勝率">先攻時勝率</th><th title="1試合あたりの与ダメージ / 被ダメージ">与 / 被ダメ</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
}

// 全キャラ総当たり：順位表 + 勝率表
function simAllHTML(R,ud){
  const ids=[...new Set(R.pairs.flatMap(r=>[r.a,r.b]))].sort((a,b)=>ud(a).cost-ud(b).cost||R.units.findIndex(u=>u.id===a)-R.units.findIndex(u=>u.id===b));
  const cell={}, st={};
  ids.forEach(id=>st[id]={w:0,n:0,sw:0,sn:0,turns:0,g:0});
  for(const r of R.pairs){
    const g=r.n-r.errors, w=r.win+r.draw/2, same=ud(r.a).cost===ud(r.b).cost;
    cell[r.a+'|'+r.b]=g?w/g:null; cell[r.b+'|'+r.a]=g?(g-w)/g:null;
    for(const [id,ww] of [[r.a,w],[r.b,g-w]]){ const s=st[id]; s.w+=ww; s.n+=g; s.turns+=r.turns; s.g+=g; if(same){ s.sw+=ww; s.sn+=g; } }
  }
  const rank=[...ids].sort((a,b)=>st[b].w/Math.max(1,st[b].n)-st[a].w/Math.max(1,st[a].n));
  const rows=rank.map((id,i)=>{ const s=st[id], p=s.w/Math.max(1,s.n), sp=s.sn?s.sw/s.sn:null;
    return `<tr class="${sp==null?'':simGrade(sp,true)}"><td class="num">${i+1}</td><td>${esc(ud(id).name)} <span class="sub small">C${ud(id).cost}</span></td>
      <td class="num rate">${sp==null?'<span class="sub">-</span>':`<b>${simPct(sp)}</b> <span class="sub small">±${simCi(sp,s.sn)}</span>`}</td>
      ${R.range==='all'?`<td class="num">${simPct(p)}</td>`:''}<td>${simBar(p)}</td><td class="num">${(s.turns/Math.max(1,s.g)).toFixed(1)}</td></tr>`; }).join('');
  const hd=ids.map(id=>`<th title="${esc(ud(id).name)}"><span class="vert">${esc(ud(id).name)}</span><span class="sub small">C${ud(id).cost}</span></th>`).join('');
  const mx=ids.map(a=>`<tr><th class="rh">${esc(ud(a).name)} <span class="sub small">C${ud(a).cost}</span></th>${ids.map(b=>{
    if(a===b) return '<td class="self">—</td>';
    const p=cell[a+'|'+b]; if(p==null) return '<td class="none"></td>';
    const same=ud(a).cost===ud(b).cost;
    return `<td class="hm ${simGrade(p,same)}" style="--p:${p}" title="${esc(ud(a).name)} vs ${esc(ud(b).name)}：${simPct(p)}">${Math.round(p*100)}</td>`; }).join('')}</tr>`).join('');
  return `<div class="simme"><b>全キャラ総当たり</b><div class="sub small">%COND%</div></div>
    <div class="simtbl"><table class="stats sim"><thead><tr><th>#</th><th>キャラ</th><th>同コスト勝率</th>${R.range==='all'?'<th>全体勝率</th>':''}<th></th><th>平均ターン</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="sub small nm">勝率表：行のキャラから見た勝率（%）。</p>
    <div class="simtbl"><table class="simmx"><thead><tr><th></th>${hd}</tr></thead><tbody>${mx}</tbody></table></div>`;
}

// ---------- 入力 ----------
document.addEventListener('change',e=>{
  const el=e.target, k=el.dataset&&el.dataset.sim; if(!k) return;
  if(k==='handicap') SIM.handicap=el.checked;
  else if(k==='n') SIM.n=Number(el.value);
  else SIM[k]=el.value;
  renderSim();
});
document.addEventListener('click',e=>{
  const b=e.target.closest('button[data-act]'); if(!b||b.disabled) return;
  switch(b.dataset.act){
    case 'simOpen': simOpen(); break;
    case 'simClose': simClose(); break;
    case 'simStart': simStart(); break;
    case 'simStop': simStop(); renderSim(); break;
    case 'simExcl': {
      const u=units[+b.dataset.i]; if(!u||SIM.run) break;
      SIM.excl.has(u.id)?SIM.excl.delete(u.id):SIM.excl.add(u.id);
      writeJSON(SIM_EXCL_KEY,[...SIM.excl]); renderSim(); break;
    }
  }
});
// Esc で閉じたときも Worker を止める
simDlg()&&simDlg().addEventListener('close',simStop);
