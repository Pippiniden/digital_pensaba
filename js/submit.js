'use strict';
/* =====================================================================
   サーヴァント申請ツール（submit.html）
   AI が書いたサーヴァントの JSON を貼り付け → 検査（validateUnits・基準値との比較）→ プレビュー
   → 勝率の測定（submit-worker.js）→ 申請用の JSON 保存・Discord に貼る文・AI に直してもらう文をコピー
   申請そのものは Discord で行う（このページは何も送信しない）
   読み込み順：rules → units → masters → common → unit-ref → ref-units → submit
   ===================================================================== */

const SUB_N=3000;                                    // 勝率の測定：環境（全体宝具／単体宝具）ごとの試合数（誤差 ±1% ほど）
const SUB_CHUNK=250;                                 // 1回のワーカー仕事の試合数
const OFFICIAL=normalizeUnits(DEFAULT_UNITS);        // 今のキャラ（js/units.js）。ID の重複を見る
const KNOWN_KEYS=new Set(['id','name','cls','traits','cost','hp','fit','link','memo','wip','lines','condLines','faces','skills','ult']);
const S={ raw:[], units:[], extra:[], rate:[], stale:[], busy:false, dirty:false, more:new Set(), tab:[], face:[] };   // tab[i]＝開いているタブ / face[i]＝編集中の出目   // more＝「詳しく」を開いている効果（'体:パス'）   // rate[i] = {A:{n,w}, S:{n,w}, done, total} | undefined / stale[i]＝測ったあとに編集した / dirty＝編集した

const $=s=>document.querySelector(s);
const msg=(t,bad)=>{ const m=$('#msg'); m.textContent=t; m.classList.toggle('bad',!!bad); };

// ---- 貼り付けた文から JSON を取り出す（コードブロックの囲み・前後の文章は無視） ----
function parseSrc(text){
  let t=String(text||'').trim();
  if(!t) throw new Error('何も貼り付けられていません');
  const fence=/```(?:json)?\s*([\s\S]*?)```/i.exec(t); if(fence) t=fence[1].trim();
  let raw;
  try{ raw=JSON.parse(t); }
  catch(e){
    const a=t.search(/[[{]/), b=Math.max(t.lastIndexOf(']'),t.lastIndexOf('}'));
    if(a<0||b<a) throw new Error('JSON が見つかりません（{ で始まる部分を貼り付けてください）');
    try{ raw=JSON.parse(t.slice(a,b+1)); }catch(e2){ throw new Error('JSON として読めません：'+e2.message+'。AI に「JSON の書式が壊れているので、正しい JSON だけを出し直して」と頼んでください'); }
  }
  if(!Array.isArray(raw)) raw=[raw];
  if(!raw.length||raw.some(x=>!x||typeof x!=='object')) throw new Error('データが空です');
  if(raw.some(x=>!x.faces||!x.skills||!x.ult)) throw new Error(`${TERMS.unit}のデータではありません（faces・skills・ult が必要です）`);
  return raw;
}

function runCheck(){
  if(S.dirty&&!confirm('下で編集した内容は消えて、貼り付けた文の内容に戻ります。よろしいですか？')) return;
  try{ S.raw=parseSrc($('#src').value); }
  catch(e){ S.raw=[]; S.units=[]; $('#out').innerHTML=''; return msg(e.message,true); }
  S.units=S.raw.map(normalizeUnit);
  S.extra=S.raw.map(x=>Object.keys(x).filter(k=>!KNOWN_KEYS.has(k)));
  S.rate=[]; S.dirty=false; S.more.clear(); S.tab=[]; S.face=[];
  msg(`${S.units.length}体を読み込みました。下で名前や数値を直せます`);
  draw();
}

// 編集中のデータは形が崩れていることがあるので、検査・保存の前に正規化する
const unitN=i=>normalizeUnit(S.units[i]);
// その体の検査結果（エラー・注意）。今のキャラと一緒に検証して、ID の重複も見る。強すぎ注意（refLimits）も足す
function issuesOf(i){
  const all=[...OFFICIAL,...S.units.map((u,j)=>unitN(j))];
  return [...validateUnits(all).filter(x=>x.i===OFFICIAL.length+i), ...refLimits(unitN(i)).map(x=>({...x,i:OFFICIAL.length+i}))];
}
const cnt=(its,l)=>its.filter(x=>x.level===l).length;
function rateOf(i){
  const r=S.rate[i]; if(!r||!r.complete) return null;
  const p=k=>r[k].n?100*r[k].w/r[k].n:NaN, all=(r.A.w+r.S.w)/(r.A.n+r.S.n)*100;
  return { A:p('A'), S:p('S'), all, n:r.A.n, verdict:all>53?'強め':all<47?'弱め':'目安どおり' };
}

// ---- 表示 ----
// 全体を作り直す（読み込み時）。編集中は drawUnit（フォームの形が変わった）か refresh（検査欄だけ）を使う
function draw(){
  $('#out').innerHTML=S.units.map((u,i)=>unitHTML(u,i)).join('')+(S.units.length?`<div id="share">${shareHTML()}</div>`:'')+`<datalist id="clslist">${CLASSES.map(c=>`<option value="${esc(c)}">`).join('')}</datalist>`;
}
function drawUnit(i){
  const el=document.querySelector(`.unit[data-u="${i}"] .uedit-wrap`); if(!el) return draw();
  el.innerHTML=editFormHTML(S.units[i],i); refresh(i);
}
function refresh(i){
  const c=document.querySelector(`#chk-${i}`); if(c) c.innerHTML=checkHTML(i);
  const t=document.querySelector(`#ttl-${i}`); if(t) t.innerHTML=titleHTML(i);
  const tb=document.querySelector(`#etabs-${i}`); if(tb) tb.innerHTML=tabsHTML(i); // タブのエラー・注意の印
  const sh=$('#share'); if(sh) sh.innerHTML=shareHTML();
}
const refreshAll=()=>S.units.forEach((_,j)=>refresh(j));
function titleHTML(i){ const u=S.units[i]; return `${esc(u.name||'（名前なし）')} <span class="sub">${esc(u.cls)}／コスト${u.cost}／HP${u.hp}／ID ${esc(u.id)}</span>`; }
function unitHTML(u,i){
  return `<section class="sbox unit" data-u="${i}">
    <h2 id="ttl-${i}">${titleHTML(i)}</h2>
    <div class="cols ecols">
      <div class="uedit-wrap">${editFormHTML(u,i)}</div>
      <aside class="chkpane" id="chk-${i}">${checkHTML(i)}</aside>
    </div>
  </section>`;
}
function checkHTML(i){
  const u=unitN(i), its=issuesOf(i), cmp=refCompare(u), r=S.rate[i], rr=rateOf(i);
  const icon={error:'✖',warn:'⚠',line:'・'};
  // 指摘を押すと、その入力があるタブ（面なら出目）を開く
  const go=(tab,face)=>`data-act="goIssue" data-i="${i}" data-tab="${tab}" data-face="${face??''}" role="button" tabindex="0" title="押すと直す場所を開きます"`;
  const list=its.length?`<ul class="iss">${its.map(x=>`<li class="${x.level}" ${go(issueTab(x),issueFace(x))}>${icon[x.level]||'・'} ${esc(x.msg)}</li>`).join('')}</ul>`:'<p class="ok">エラー・注意はありません</p>';
  const ex=S.extra[i]&&S.extra[i].length?`<p class="warn">⚠ 使われない項目がありました（読み込みで消えています）：${esc(S.extra[i].join(', '))}</p>`:'';
  const cmpT=cmp.length?`<table class="cmp">${cmp.map(x=>`<tr class="${x.ok===false?'ng':x.ok?'ok':''}" ${go(cmpTab(x))}><td>${x.ok===false?'↕':x.ok?'○':'・'}</td><th>${esc(x.label)}</th><td>${esc(x.val)}${x.note?`<small>${esc(x.note)}</small>`:''}</td></tr>`).join('')}</table>`:'<p class="sub">このコストの基準値はありません</p>';
  const rateT=rr?`<table class="cmp rate"><tr><th>${REF_KITS.A}</th><td>${rr.A.toFixed(1)}%</td></tr><tr><th>${REF_KITS.S}</th><td>${rr.S.toFixed(1)}%</td></tr>
      <tr class="${rr.verdict==='目安どおり'?'ok':'ng'}"><th>平均</th><td><b>${rr.all.toFixed(1)}%</b> … ${rr.verdict}<small>目安 50%±3%。各${rr.n}試合</small></td></tr></table>`
    : r&&!r.complete?`<p class="sub">測定中… ${r.done}/${r.total}</p><div class="bar"><i style="width:${Math.round(100*r.done/r.total)}%"></i></div>`
    : S.stale&&S.stale[i]?'<p class="warn">内容を変えたので、勝率を測り直してください。</p>'
    : '';
  // 測っているルール（ref-units.js の refMeasure と sim.js の simGame / SIM_LEVEL に合わせる）
  const rule=`<details class="rulenote"><summary>どんなルールで測っているか</summary><ul>
      <li><b>${RULESETS.team.name}</b>（3対3・合計コスト${RULES.costCap}・${TERMS.player}なし）</li>
      <li>このキャラ＋ランダムな味方2騎 vs 合計コストが同じ3騎</li>
      <li>味方・相手は、基準値どおりに作ったテスト用${TERMS.unit}30体（コスト1〜5 × カード構成6種）だけ。今のキャラは入れない</li>
      <li>両方とも CPU「つよい（先読みなし）」</li>
      <li>テスト用${TERMS.unit}の${TERMS.ult}が全員「全体」の場合と、全員「単体」の場合で${SUB_N}試合ずつ測り、平均を出す</li>
      <li>目安は 50%±3%。1対1（シンプル）や${TERMS.player}ありのルールでは測っていない</li></ul></details>`;
  return `<h3>検査 ${cnt(its,'error')?`<span class="tag bad">エラー${cnt(its,'error')}</span>`:'<span class="tag good">エラーなし</span>'}</h3>
    ${ex}${list}
    <h3>基準値との比較</h3>${cmpT}
    <h3>勝率 <span class="sub">${RULESETS.team.name}（3対3）・CPU同士</span></h3>${rateT}${rule}
    <div class="row"><button data-act="measure" data-i="${i}" ${S.busy||cnt(its,'error')?'disabled':''}>${rr?'もう一度測る':'勝率を測る'}</button>
      ${cnt(its,'error')?'<span class="sub">エラーを直すと測れます</span>':''}</div>
    <details class="prev"><summary>スキル・${TERMS.ult}の説明文（ゲームでの表示）</summary>${skillListHTML(u,true)}</details>`;
}
function shareHTML(){
  const bad=S.units.some((u,i)=>cnt(issuesOf(i),'error'));
  return `<section class="sbox">
    <h2>3. 申請する</h2>
    ${bad?'<p class="warn">⚠ エラーが残っています。下の「AIに直してもらう文」を AI に送って、直したものを貼り直してください。</p>':''}
    <ol class="steps">
      <li>「JSONを保存」でファイルを保存します。</li>
      <li>「Discord用の文をコピー」を押し、Discord の申請先に貼り付けて、保存したファイルを添付して送ります。</li>
    </ol>
    <div class="row">
      <button class="primary" data-act="save">JSONを保存</button>
      <button data-act="copyDiscord">Discord用の文をコピー</button>
      <button data-act="copyFix">AIに直してもらう文をコピー</button>
    </div>
  </section>`;
}

// ---- 勝率の測定：環境2つ × SUB_N 試合を SUB_CHUNK ずつワーカーに配る ----
function measure(i){
  if(S.busy) return;
  const u=unitN(i); u.id='submit_'+i; S.stale[i]=false; // 今のキャラと ID が重なっても測れるように別 ID にする
  const tasks=[]; for(const kit of ['A','S']) for(let n=SUB_N;n>0;n-=SUB_CHUNK) tasks.push({units:[u],id:u.id,kit,n:Math.min(SUB_CHUNK,n)});
  const r=S.rate[i]={A:{n:0,w:0},S:{n:0,w:0},done:0,total:tasks.length,complete:false};
  S.busy=true; refreshAll();
  const nw=Math.max(1,Math.min(tasks.length,(navigator.hardwareConcurrency||4)-1)), q='?v='+Date.now();
  let alive=nw, failed=null;
  const finish=()=>{ if(--alive) return; S.busy=false; r.complete=!failed; if(failed){ S.rate[i]=undefined; msg('勝率を測れませんでした：'+failed,true); } refreshAll(); };
  for(let k=0;k<nw;k++){
    const w=new Worker('js/submit-worker.js'+q);
    const next=()=>{ const t=tasks.pop(); if(!t||failed){ w.terminate(); finish(); return; } w.postMessage(t); };
    w.onmessage=e=>{ const m=e.data;
      if(m.t==='error'){ failed=m.msg; w.terminate(); finish(); return; }
      if(m.r.none){ failed='このコストでは合計コスト10の3騎編成が組めません'; w.terminate(); finish(); return; }
      r[m.r.kit].n+=m.r.n; r[m.r.kit].w+=m.r.w; r.done++; refresh(i); next(); };
    w.onerror=e=>{ failed=e.message||'ワーカーの読み込みに失敗しました（file:// では動きません。http で開いてください）'; w.terminate(); finish(); };
    next();
  }
}

// ---- 申請用の文 ----
function discordText(){
  const L=['【サーヴァント導入申請】'];
  S.units.forEach((u,i)=>{
    const its=issuesOf(i), ng=refCompare(unitN(i)).filter(x=>x.ok===false), rr=S.stale[i]?null:rateOf(i);
    L.push('',`■ ${u.name}（${u.cls}／コスト${u.cost}）　ID：${u.id}`);
    L.push(`・出典：${u.link||'未記入'}`);
    L.push(`・検査：${cnt(its,'error')?`エラー${cnt(its,'error')}件`:'エラーなし'}${cnt(its,'warn')?`（注意${cnt(its,'warn')}件）`:''}`);
    L.push(`・基準値から外れた項目：${ng.length?ng.map(x=>`${x.label} ${x.val}`).join('、'):'なし'}`);
    L.push(`・勝率（${RULESETS.team.name}3対3・CPU同士）：${rr?`${rr.all.toFixed(1)}%（${REF_KITS.A} ${rr.A.toFixed(1)}%／${REF_KITS.S} ${rr.S.toFixed(1)}%、各${rr.n}試合）… ${rr.verdict}`:'未測定'}`);
  });
  L.push('',`（${fileName()} を添付します）`);
  return L.join('\n');
}
function fixText(){
  const L=['次の検査結果を見て、サーヴァントの JSON を直してください。直した JSON だけを ```json のコードブロック1つで出力してください。'];
  S.units.forEach((u,i)=>{
    const its=issuesOf(i), ng=refCompare(unitN(i)).filter(x=>x.ok===false), rr=S.stale[i]?null:rateOf(i);
    L.push('',`■ ${u.name}（${u.id}）`);
    if(S.extra[i].length) L.push(`- 使われない項目：${S.extra[i].join(', ')}（資料にない項目は書かない）`);
    its.forEach(x=>L.push(`- ${x.level==='error'?'エラー':'注意'}：${x.msg}`));
    ng.forEach(x=>L.push(`- 基準値から外れている：${x.label} ${x.val}${x.note?`（${x.note}）`:''}`));
    if(rr&&rr.verdict!=='目安どおり') L.push(`- 勝率が ${rr.all.toFixed(1)}% で${rr.verdict}です（目安 50%±3%）。${rr.verdict==='強め'?'スキルの効果の数や値、HP・ダメージを少し下げて':'HP・ダメージやスキルを少し上げて'}ください。`);
    if(L[L.length-1].startsWith('■')) L.push('- 問題はありません');
  });
  return L.join('\n');
}
const fileName=()=>(S.units.length===1?S.units[0].id||'servant':'servants')+'.json';
// 書き出す形：既定の画像位置（fit）や空の属性は省く
function cleanUnit(u){
  const o=JSON.parse(JSON.stringify(u));
  if(['face','card','np','cut'].every(k=>fitIsDef(o.fit,k))) delete o.fit;
  if(o.traits&&!o.traits.length) delete o.traits;
  return o;
}
async function copy(text,what){
  try{ await navigator.clipboard.writeText(text); }
  catch(e){ const t=document.createElement('textarea'); t.value=text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
  msg(`${what}をコピーしました`);
}

// ---- 操作（document でまとめて受ける） ----
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-act]'); if(!b||b.disabled) return;
  const i=+b.dataset.i;
  switch(b.dataset.act){
    case 'check': runCheck(); break;
    case 'file': $('#file').click(); break;
    case 'measure': measure(i); break;
    case 'save': { const data=S.units.map((u,j)=>cleanUnit(unitN(j))); downloadText(fileName(),JSON.stringify(data.length===1?data[0]:data,null,2),'application/json'); msg(`${fileName()} を保存しました`); break; }
    case 'copyDiscord': copy(discordText(),'Discord用の文'); break;
    case 'copyFix': copy(fixText(),'AIに直してもらう文'); break;
    default: { const j=editClick(b); if(j!=null) edited(j,true); }
  }
});
// 編集：文字・数の入力は検査欄だけ更新（フォームは作り直さない）。形が変わる操作はその体のフォームを作り直す
let refreshT=null;
function edited(i,rebuild){
  S.dirty=true; if(S.rate[i]&&S.rate[i].complete){ S.stale[i]=true; S.rate[i]=undefined; }
  if(rebuild) drawUnit(i);
  else{ clearTimeout(refreshT); refreshT=setTimeout(()=>refresh(i),150); }
}
document.addEventListener('input',e=>{
  const el=e.target; if(!el.closest('.uedit')||!el.dataset.p||el.dataset.act) return;
  if(el.tagName==='SELECT'||el.type==='checkbox') return; // 選択・チェックは change で受ける
  pSet(S.units[+el.dataset.i],el.dataset.p,editValue(el)); edited(+el.dataset.i,false);
  // 効果の値なら、その効果の説明文（ゲームでの表示）も直す
  const row=el.closest('.erow'), tx=row&&row.querySelector('.etxt-game'), ef=row&&pGet(S.units[+el.dataset.i],el.dataset.p.replace(/\.[^.]+$/,''));
  if(tx&&ef&&FX[ef.k]) tx.textContent=effsText([normEff(ef)]);
});
document.addEventListener('change',e=>{
  const el=e.target;
  if(el.id==='file'&&el.files[0]){ const rd=new FileReader(); rd.onload=()=>{ $('#src').value=String(rd.result); runCheck(); }; rd.readAsText(el.files[0]); el.value=''; return; }
  if(!el.closest('.uedit')) return;
  const i=+el.dataset.i;
  if(el.dataset.act){ if(editStructural(el)) edited(i,true); return; }
  if(el.dataset.p&&(el.tagName==='SELECT'||el.type==='checkbox')){
    pSet(S.units[i],el.dataset.p,editValue(el));
    // 対象を「選んだ1体」にしたのに、スキル・宝具の「対象の選び方」が未設定なら、弱体は敵単体・それ以外は味方単体にする
    const m=/^(skills\.\d+|ult)\.eff\.\d+\.t$/.exec(el.dataset.p);
    if(m&&el.value==='picked'&&!pGet(S.units[i],m[1]+'.pick')){ const e=pGet(S.units[i],el.dataset.p.replace(/\.t$/,'')); pSet(S.units[i],m[1]+'.pick',FX[e.k]&&FX[e.k].buff===false?'enemy':'ally'); msg('「対象の選び方」も合わせて設定しました'); }
    edited(i,!!el.closest('.erow')); // 効果の選択・チェックは、説明文や「詳しく」の見出しが変わるので作り直す
  }
});
// タブ・鉛筆の面・検査の指摘など（ボタンでない押せる要素）は Enter / Space でも押せるようにする
document.addEventListener('keydown',e=>{
  if(EffPick.o) return;
  const t=e.target;
  if((e.key==='Enter'||e.key===' ')&&t.dataset&&t.dataset.act&&!/^(BUTTON|INPUT|SELECT|TEXTAREA)$/.test(t.tagName)){ e.preventDefault(); t.click(); }
});
