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
const S={ raw:[], units:[], extra:[], rate:[], busy:false };   // rate[i] = {A:{n,w}, S:{n,w}, done, total} | undefined

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
  try{ S.raw=parseSrc($('#src').value); }
  catch(e){ S.raw=[]; S.units=[]; $('#out').innerHTML=''; return msg(e.message,true); }
  S.units=S.raw.map(normalizeUnit);
  S.extra=S.raw.map(x=>Object.keys(x).filter(k=>!KNOWN_KEYS.has(k)));
  S.rate=[];
  msg(`${S.units.length}体を読み込みました`);
  draw();
}

// その体の検査結果（エラー・注意）。今のキャラと一緒に検証して、ID の重複も見る
function issuesOf(i){
  const all=[...OFFICIAL,...S.units];
  return validateUnits(all).filter(x=>x.i===OFFICIAL.length+i);
}
const cnt=(its,l)=>its.filter(x=>x.level===l).length;
function rateOf(i){
  const r=S.rate[i]; if(!r||!r.complete) return null;
  const p=k=>r[k].n?100*r[k].w/r[k].n:NaN, all=(r.A.w+r.S.w)/(r.A.n+r.S.n)*100;
  return { A:p('A'), S:p('S'), all, n:r.A.n, verdict:all>53?'強め':all<47?'弱め':'目安どおり' };
}

// ---- 表示 ----
function draw(){
  $('#out').innerHTML=S.units.map((u,i)=>unitHTML(u,i)).join('')+(S.units.length?shareHTML():'');
}
function unitHTML(u,i){
  const its=issuesOf(i), cmp=refCompare(u), r=S.rate[i], rr=rateOf(i);
  const icon={error:'✖',warn:'⚠',line:'・'};
  const list=its.length?`<ul class="iss">${its.map(x=>`<li class="${x.level}">${icon[x.level]||'・'} ${esc(x.msg)}</li>`).join('')}</ul>`:'<p class="ok">エラー・注意はありません</p>';
  const ex=S.extra[i].length?`<p class="warn">⚠ 使われない項目があります（読み込むと消えます）：${esc(S.extra[i].join(', '))}</p>`:'';
  const cmpT=cmp.length?`<table class="cmp">${cmp.map(x=>`<tr class="${x.ok===false?'ng':x.ok?'ok':''}"><td>${x.ok===false?'↕':x.ok?'○':'・'}</td><th>${esc(x.label)}</th><td>${esc(x.val)}${x.note?`<small>${esc(x.note)}</small>`:''}</td></tr>`).join('')}</table>`:'<p class="sub">このコストの基準値はありません</p>';
  const rateT=rr?`<table class="cmp rate"><tr><th>${REF_KITS.A}</th><td>${rr.A.toFixed(1)}%</td></tr><tr><th>${REF_KITS.S}</th><td>${rr.S.toFixed(1)}%</td></tr>
      <tr class="${rr.verdict==='目安どおり'?'ok':'ng'}"><th>平均</th><td><b>${rr.all.toFixed(1)}%</b> … ${rr.verdict}<small>目安 50%±3%。各${rr.n}試合</small></td></tr></table>`
    : r&&!r.complete?`<p class="sub">測定中… ${r.done}/${r.total}</p><div class="bar"><i style="width:${Math.round(100*r.done/r.total)}%"></i></div>`
    : `<p class="sub">基準どおりのテスト用${TERMS.unit}だけの環境（今のキャラは入れない）に1体入れて、CPU同士で戦わせた勝率を出します。数十秒かかります。</p>`;
  return `<section class="sbox unit">
    <h2>${esc(u.name||'（名前なし）')} <span class="sub">${esc(u.cls)}／コスト${u.cost}／HP${u.hp}／ID ${esc(u.id)}</span></h2>
    <div class="cols">
      <div>
        <h3>検査 ${cnt(its,'error')?`<span class="tag bad">エラー${cnt(its,'error')}</span>`:'<span class="tag good">エラーなし</span>'}</h3>
        ${ex}${list}
        <h3>基準値との比較</h3>${cmpT}
        <h3>勝率</h3>${rateT}
        <div class="row"><button data-act="measure" data-i="${i}" ${S.busy||cnt(its,'error')?'disabled':''}>${rr?'もう一度測る':'勝率を測る'}</button>
          ${cnt(its,'error')?'<span class="sub">エラーを直すと測れます</span>':''}</div>
        <h3>出典</h3>
        <p class="sub">設定ページのURL（任意。フリー素材の多くは出典の明記が条件です）</p>
        <input type="url" class="link" data-i="${i}" value="${esc(u.link||'')}" placeholder="https://">
      </div>
      <div class="prev">
        <h3>鉛筆の面</h3>${facesTableHTML(u)}
        <h3>スキル・${TERMS.ult}</h3>${skillListHTML(u,true)}
      </div>
    </div>
  </section>`;
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
  const u=JSON.parse(JSON.stringify(S.units[i])); u.id='submit_'+i; // 今のキャラと ID が重なっても測れるように別 ID にする
  const tasks=[]; for(const kit of ['A','S']) for(let n=SUB_N;n>0;n-=SUB_CHUNK) tasks.push({units:[u],id:u.id,kit,n:Math.min(SUB_CHUNK,n)});
  const r=S.rate[i]={A:{n:0,w:0},S:{n:0,w:0},done:0,total:tasks.length,complete:false};
  S.busy=true; draw();
  const nw=Math.max(1,Math.min(tasks.length,(navigator.hardwareConcurrency||4)-1)), q='?v='+Date.now();
  let alive=nw, failed=null;
  const finish=()=>{ if(--alive) return; S.busy=false; r.complete=!failed; if(failed){ S.rate[i]=undefined; msg('勝率を測れませんでした：'+failed,true); } draw(); };
  for(let k=0;k<nw;k++){
    const w=new Worker('js/submit-worker.js'+q);
    const next=()=>{ const t=tasks.pop(); if(!t||failed){ w.terminate(); finish(); return; } w.postMessage(t); };
    w.onmessage=e=>{ const m=e.data;
      if(m.t==='error'){ failed=m.msg; w.terminate(); finish(); return; }
      if(m.r.none){ failed='このコストでは合計コスト10の3騎編成が組めません'; w.terminate(); finish(); return; }
      r[m.r.kit].n+=m.r.n; r[m.r.kit].w+=m.r.w; r.done++; draw(); next(); };
    w.onerror=e=>{ failed=e.message||'ワーカーの読み込みに失敗しました（file:// では動きません。http で開いてください）'; w.terminate(); finish(); };
    next();
  }
}

// ---- 申請用の文 ----
function discordText(){
  const L=['【サーヴァント導入申請】'];
  S.units.forEach((u,i)=>{
    const its=issuesOf(i), ng=refCompare(u).filter(x=>x.ok===false), rr=rateOf(i);
    L.push('',`■ ${u.name}（${u.cls}／コスト${u.cost}）　ID：${u.id}`);
    L.push(`・出典：${u.link||'未記入'}`);
    L.push(`・検査：${cnt(its,'error')?`エラー${cnt(its,'error')}件`:'エラーなし'}${cnt(its,'warn')?`（注意${cnt(its,'warn')}件）`:''}`);
    L.push(`・基準値から外れた項目：${ng.length?ng.map(x=>`${x.label} ${x.val}`).join('、'):'なし'}`);
    L.push(`・勝率：${rr?`${rr.all.toFixed(1)}%（${REF_KITS.A} ${rr.A.toFixed(1)}%／${REF_KITS.S} ${rr.S.toFixed(1)}%、各${rr.n}試合）… ${rr.verdict}`:'未測定'}`);
  });
  L.push('',`（${fileName()} を添付します）`);
  return L.join('\n');
}
function fixText(){
  const L=['次の検査結果を見て、サーヴァントの JSON を直してください。直した JSON だけを ```json のコードブロック1つで出力してください。'];
  S.units.forEach((u,i)=>{
    const its=issuesOf(i), ng=refCompare(u).filter(x=>x.ok===false), rr=rateOf(i);
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
    case 'save': { const data=S.units.map(cleanUnit); downloadText(fileName(),JSON.stringify(data.length===1?data[0]:data,null,2),'application/json'); msg(`${fileName()} を保存しました`); break; }
    case 'copyDiscord': copy(discordText(),'Discord用の文'); break;
    case 'copyFix': copy(fixText(),'AIに直してもらう文'); break;
  }
});
document.addEventListener('change',e=>{
  const el=e.target;
  if(el.id==='file'&&el.files[0]){ const rd=new FileReader(); rd.onload=()=>{ $('#src').value=String(rd.result); runCheck(); }; rd.readAsText(el.files[0]); el.value=''; }
  if(el.classList.contains('link')){ const i=+el.dataset.i, v=el.value.trim();
    if(v&&!normLink(v)){ msg('URL は http:// か https:// で始めてください',true); return; }
    S.units[i].link=normLink(v)||undefined; if(!S.units[i].link) delete S.units[i].link; msg(v?'出典を設定しました':'出典を消しました'); }
});
