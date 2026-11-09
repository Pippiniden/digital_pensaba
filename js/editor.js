'use strict';
/* =====================================================================
   ペンシルエディタ
   - 編集中のデータはブラウザに自動保存（下書き）
   - 「ゲームに反映」で、同じブラウザのゲーム画面がそのデータを使う
   - 「units.js を書き出し」で js/units.js を置き換えれば、標準データとして公開できる
   ===================================================================== */

let units=[], sel=0, rollPost=false, rollIdx=null, rollTimer=null, toastTimer=null;
// マスター（マスタールール用）は別タブで編集する。tab='units'|'masters'
let masters=[], msel=0, tab='units';
try{ if(localStorage.getItem('pencilduel.editorTab')==='masters') tab='masters'; }catch(e){}
const isM = ()=>tab==='masters';
const list = ()=>isM()?masters:units;          // 今のタブの一覧
const selIdx = ()=>isM()?msel:sel;
function setSel(i){ if(isM()) msel=i; else sel=i; }
const cur = ()=>list()[selIdx()];

// ---------- 起動 ----------
function boot(){
  const draft=readJSON(STORE.draft);
  try{ units = draft ? normalizeUnits(draft) : clone(loadUnits().units); }
  catch(e){ units=clone(loadUnits().units); }
  const md=readJSON(STORE.mdraft);
  try{ masters = Array.isArray(md) ? md.map(normalizeMaster) : clone(loadMasters(units).masters); }
  catch(e){ masters=clone(loadMasters(units).masters); }
  renderAll();
}

// ---------- データ操作 ----------
const getPath=(obj,path)=>path.split('.').reduce((o,k)=>o==null?o:o[k],obj);
function setPath(obj,path,val){
  const ks=path.split('.'), last=ks.pop(), o=ks.reduce((o,k)=>o[k],obj);
  if(val===undefined) delete o[last]; else o[last]=val;
}
function conv(el){
  const v=el.value;
  switch(el.dataset.t){
    case 'num': return v===''?0:Number(v);
    case 'optnum': return v===''||!(Number(v)>0)?undefined:Number(v);
    case 'optstr': return v===''?undefined:v;
    case 'lines': return v.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    default: return v;
  }
}
function uniqueId(base){
  base=(base||'unit').replace(/_\d+$/,'').replace(/[^A-Za-z0-9_-]/g,'')||'unit';
  const ids=new Set([...units,...masters].map(u=>u.id)); // サーヴァントとマスターでIDが重ならないように
  if(!ids.has(base)) return base;
  for(let n=2;;n++) if(!ids.has(`${base}_${n}`)) return `${base}_${n}`;
}
const C=(c,dmg,np=0,star=0)=>({c,dmg,np,star});
function newUnit(){
  return { id:uniqueId('unit'), name:'新しいサーヴァント', cls:CLASSES[0], cost:2, hp:100, fit:normFit(), lines:Object.fromEntries(Object.keys(LINE_KEYS).map(k=>[k,[]])),
    faces:[ {acts:1,pre:C('R',20),post:C('R',30)}, {acts:2,pre:C('B',15,20),post:C('B',20,30)}, {acts:1,pre:C('G',10,0,3),post:C('G',15,0,5)},
            {acts:2,pre:C('R',20),post:C('R',30)}, {acts:3,pre:{c:'ASC'},post:C('R',45)}, {acts:1,pre:C('B',15,20),post:C('B',20,30)} ],
    skills:[ {name:'スキル1',eff:[{k:'atk',t:'self',v:10,turns:3}]},
             {name:'スキル2',eff:[{k:'np',t:'self',v:20}]},
             {name:'スキル3',eff:[{k:'star',t:'master',v:5}]} ],
    ult:{name:TERMS.ult,c:'R',eff:[{k:'dmg',t:'target',v:80}]} };
}
// カード構成テンプレを今のコストに合わせて適用（HP・6面。霊基再臨面の再臨後は既存を残す）
let tplKey=CARD_TPL_KEYS[0];
function parseTplCmd(t){
  const m=/^([BAQ])(\d+)(?:\/(\d+))?$/.exec(t), c={B:'R',A:'B',Q:'G'}[m[1]], v=+(m[3]||0);
  return {c,dmg:+m[2],np:c==='B'?v:0,star:c==='G'?v:0};
}
function applyCardTpl(u){
  const cost=u.cost, tpl=CARD_TPL[cost];
  if(!tpl) return `コスト${cost}のテンプレはありません（コスト1〜5）`;
  const rows=tpl[tplKey].split(',');
  u.hp=CARD_TPL_HP[cost];
  rows.forEach((r,i)=>{
    const f=u.faces[i];
    if(r==='ASC'){ f.pre={c:'ASC'}; if(f.post.c==='ASC'||f.post.c==='W') f.post=C('R',u.faces[0].post.dmg||30); }
    else { const [a,b]=r.split('>'); f.pre=parseTplCmd(a); f.post=parseTplCmd(b); }
  });
  return '';
}
function makeCmd(t,old){
  old=old||{};
  if(t==='ASC') return {c:'ASC'};
  if(t==='W') return {c:'W',label:old.label||'特殊行動',eff:old.eff||[{k:'heal',t:'self',v:20}],dmg:0,np:0,star:0};
  return {c:t,dmg:old.dmg||20,np:0,star:0}; // 属性を変えたらNP・スターは0に戻す
}
function newEff(ctx){
  if(ctx==='ult') return {k:'dmg',t:'target',v:80};
  if(ctx==='master') return {k:'atk',t:'svt',v:20};
  if(ctx==='special') return {k:'heal',t:'self',v:20};
  return {k:'atk',t:'self',v:10,turns:3};
}
// 効果の種類を変えたときに、使わない項目を片づける
function fixEff(e){
  const f=FX[e.k]||{};
  if(!f.val) e.v=0;
  if(f.inst){ delete e.turns; delete e.times; }
  else if(f.timesOnly){ delete e.turns; if(e.times==null) e.times=1; }
  else if(!f.perm&&e.turns==null&&e.times==null) e.turns=3;
  if((e.k==='poison'||e.k==='burn')&&!e.v) e.v=RULES.dot;
  if(!f.color) delete e.color;
  if(e.k!=='atkVs') delete e.vs;
  if(e.k==='cardConv'&&!e.color) e.color='R';
  if(e.k==='critMult'&&!(e.v>100)) e.v=200;
  if(e.k==='dmg'||e.k==='copyRoll') delete e.at;
  if(e.k==='star'&&e.t==='self') e.t='master';
}

// ---------- 保存と再描画 ----------
function saveDraft(){ writeJSON(STORE.draft,units); writeJSON(STORE.mdraft,masters); }
function light(){ saveDraft(); renderList(); renderSide(); renderStatus(); updatePreviews(); }
function full(){ saveDraft(); renderAll(); }
function renderAll(){ renderList(); renderForm(); renderSide(); renderStatus(); }

// 今のタブの検証結果・反映済みデータ
const issuesNow = ()=>isM()?validateMasters(masters,units):validateUnits(units);
function renderStatus(){
  const applied=isM()?loadMasters(units):loadUnits(), iss=issuesNow();
  const e=iss.filter(x=>x.level==='error').length, w=iss.filter(x=>x.level==='warn').length;
  const dirty=JSON.stringify(list())!==JSON.stringify(isM()?applied.masters:applied.units);
  document.querySelector('#status').innerHTML=
    `<b class="sub">${isM()?TERMS.player:TERMS.unit}：</b><span class="${dirty?'dirty':'clean'}">${dirty?'● ゲームに未反映の変更があります':`✓ ゲームと同じ内容（${applied.source==='custom'?'反映済みデータ':'標準データ'}）`}</span>`+
    ` <span class="sub">エラー${e}・注意${w}</span>`;
  document.querySelector('#unapply').hidden = applied.source!=='custom';
  document.querySelector('#exportJS').textContent=`${isM()?'masters.js':'units.js'} を書き出し`;
  document.querySelector('#simbtn').hidden=isM(); // バランス検証はサーヴァントだけ
}

// ---------- 一覧 ----------
function tabsHTML(){
  return `<div class="edtabs" role="tablist">${[['units',TERMS.unit],['masters',TERMS.player]].map(([k,l])=>
    `<button role="tab" aria-selected="${tab===k}" class="${tab===k?'on':''}" data-act="tab" data-tab="${k}">${l}</button>`).join('')}</div>`;
}
function renderList(){
  const iss=issuesNow(), L=list(), si=selIdx();
  document.querySelector('#list').innerHTML=`${tabsHTML()}
    <div class="row"><b>${isM()?TERMS.player:TERMS.unit}一覧</b><span class="sub small">${L.length}${isM()?'人':'体'}</span></div>
    <div class="ulist">${L.map((u,i)=>{
      const e=iss.filter(x=>x.i===i&&x.level==='error').length, w=iss.filter(x=>x.i===i&&x.level==='warn').length;
      return `<button class="uitem ${i===si?'on':''}" data-act="sel" data-i="${i}">
        ${isM()?'':clsBadge(u.cls,true)}${faceImg(u,'face xs')}<span class="uname">${esc(u.name)||'（名前なし）'}</span><span class="sub small">C${u.cost}</span>
        ${e?`<span class="dot err" title="エラー${e}件">${e}</span>`:w?`<span class="dot wrn" title="注意${w}件">${w}</span>`:''}</button>`;
    }).join('')}</div>
    <div class="row">
      <button class="small" data-act="add">＋ 追加</button>
      <button class="small" data-act="dup" ${cur()?'':'disabled'}>複製</button>
      <button class="small" data-act="move" data-d="-1" ${si>0?'':'disabled'} title="上へ">↑</button>
      <button class="small" data-act="move" data-d="1" ${si<L.length-1?'':'disabled'} title="下へ">↓</button>
      <button class="small danger" data-act="del" ${cur()?'':'disabled'}>削除</button>
    </div>`;
}

// ---------- マスターの編集（マスタールール・マスターチーム用） ----------
function newMaster(){
  return { id:uniqueId('master'), name:'新しいマスター', cls:TERMS.player, cost:2, hp:120, master:true, fit:normFit(), lines:Object.fromEntries(Object.keys(LINE_KEYS).map(k=>[k,[]])),
    faces:[ {label:'無',eff:[]}, {label:'強化魔術',eff:[{k:'atk',t:'svt',v:20}]}, {label:'治癒魔術',eff:[{k:'heal',t:'svt',v:80}]},
            {label:'無',eff:[]}, {label:'魔力供給',eff:[{k:'np',t:'svt',v:20}]}, {label:'魔弾',eff:[{k:'dmg',t:'enemy_master',v:40}]} ],
    spells:[ {name:'令呪：宝具解放',eff:[{k:'np',t:'svt',v:100}]}, {name:'令呪：回復',eff:[{k:'heal',t:'svt',v:200}]}, {name:'令呪：強化',eff:[{k:'atk',t:'svt',v:30,turns:3}]} ] };
}
const mFaceText = f=>f.eff.length?effsText(f.eff):'無（何も起きない）';
function renderMasterForm(el){
  const m=cur();
  if(!m){ el.innerHTML=`<section class="sec"><p>${TERMS.player}がいません。「＋ 追加」から作成してください。</p></section>`; return; }
  const ma=RULESETS.master.masterAtk;
  el.innerHTML=`
  <section class="sec"><h2>基本情報</h2>
    <p class="sub small nm">マスタールール（${TERMS.unit}1騎＋${TERMS.player}）とマスターチーム（${TERMS.unit}3騎＋${TERMS.player}）で使う${TERMS.player}です。</p>
    <div class="fields">
      <label>名前<input data-p="name" value="${esc(m.name)}"></label>
      <label>ID<input data-p="id" value="${esc(m.id)}"><small>半角英数字・_・-（${TERMS.unit}と重ならないこと）</small></label>
      <label>コスト<input type="number" min="0" data-p="cost" data-t="num" value="${m.cost}"><small data-mprev="atk">攻撃：相手${TERMS.player}へ${m.cost*ma.master}・相手${TERMS.unit}へ${m.cost*ma.svt}（マスタールール）</small></label>
      <label>HP<input type="number" min="1" step="5" data-p="hp" data-t="num" value="${m.hp}"><small>0になると自軍${TERMS.unit}がこの値のダメージを受ける</small></label>
    </div>
  </section>
  <section class="sec"><h2>画像</h2>
    <p class="sub small nm"><code>${IMG_DIR}</code> にIDと同じ名前の ${IMG_EXT} を置くと自動で使われます（なければ仮画像）。</p>
    <div class="imged"><div class="imgfield isface"><span class="imgprev" data-imgprev="face">${faceImg(m,'face lg')}</span>
      <span class="imglab">${IMG_KEYS.face}</span><code data-imgpath="face">${esc(IMG_DIR+m.id)}.${IMG_EXT}</code></div></div>
    <div class="fited"><div class="fitgrp"><b>${IMG_KEYS.face}</b>
      ${[['x','左右'],['y','上下'],['z','拡大']].map(([a,lab])=>`<label class="fitrow"><span>${lab}</span>
        <input type="range" min="${FIT_RANGE[a][0]}" max="${FIT_RANGE[a][1]}" step="1" data-p="fit.face.${a}" data-t="num" value="${m.fit.face[a]}">
        <output data-fitout="face.${a}">${m.fit.face[a]}%</output></label>`).join('')}
      <button class="small" data-act="fitReset" data-k="face">リセット</button></div></div>
  </section>
  <section class="sec"><h2>補助（${TERMS.player}の鉛筆の6面）</h2>
    <p class="sub small nm">${TERMS.player}フェイズの「補助」で振り、出た面の効果を<b>そのターンだけ</b>適用します。効果のない面は「無」（何も起きない）。「敵${TERMS.player}」へのダメージは、相手が令呪1画で防げます。</p>
    <div class="mfaceed">${m.faces.map((f,i)=>`<div class="mfacerow">
      <span class="die">${i+1}</span>
      <div class="mfbody"><input data-p="faces.${i}.label" value="${esc(f.label)}" placeholder="面の名前（効果がなければ「無」）">
        ${effList(`faces.${i}.eff`,f.eff,'master')}
        <div class="preview mprev" data-prev="mface" data-i="${i}">${esc(mFaceText(f))}</div></div>
    </div>`).join('')}</div>
  </section>
  <section class="sec"><h2>令呪</h2>
    <p class="sub small nm">マスタールールは1試合1回・3つから1つ。マスターチームは3画で、同じ効果は1回まで（使うと行動回数-1）。マスターチームでは「自軍${TERMS.unit}」の効果は選んだ1騎にかかります。</p>
    ${m.spells.map((s,i)=>`<div class="subcard">
      <div class="row"><b>令呪${i+1}</b></div>
      <div class="fields"><label>名前<input data-p="spells.${i}.name" value="${esc(s.name)}"></label></div>
      ${effList(`spells.${i}.eff`,s.eff,'master')}
      <div class="preview mprev" data-prev="spell" data-i="${i}">${esc(effsText(s.eff))}</div>
    </div>`).join('')}
  </section>`;
}
function renderMasterSide(el){
  const m=cur(); if(!m){ el.innerHTML=''; return; }
  const iss=validateMasters(masters,units).filter(x=>x.i===msel||x.i===-1);
  el.innerHTML=`
    <div class="sidecard">
      <div class="row"><b>補助の鉛筆プレビュー</b><span class="grow"></span><button class="primary small" data-act="roll">転がす</button></div>
      <div class="pencil" aria-label="${TERMS.player}の鉛筆の6面"><div class="peraser"></div><div class="pferrule"></div>
        <div class="pbody">${m.faces.map((f,i)=>`<div class="pface ${rollIdx===i?'hit':''}"><span class="dieb">${i+1}</span><span class="mflabel ${f.eff.length?'':'sub'}">${esc(f.eff.length?f.label||'（名前なし）':'無')}</span></div>`).join('')}</div>
        <div class="ptip"><i></i></div></div>
      <div id="rollres" class="rollres">${rollResultHTML(m)}</div>
    </div>
    <div class="sidecard"><b>検証</b>
      ${iss.length?`<ul class="issues">${iss.map(x=>`<li class="${x.level}">${x.level==='error'?'エラー':'注意'}：${esc(x.msg)}</li>`).join('')}</ul>`:'<p class="ok small nm">問題は見つかりませんでした。</p>'}
    </div>
    <div class="sidecard"><b>数値の目安</b>
      <table class="stats">
        <tr><td>HP ／ コスト</td><td>${m.hp} ／ ${m.cost}</td></tr>
        <tr><td>補助で効果が出る確率</td><td>${Math.round(m.faces.filter(f=>f.eff.length).length/6*100)}%</td></tr>
        <tr><td>全${TERMS.player}の平均 HP ／ コスト</td><td>${Math.round(masters.reduce((s,x)=>s+x.hp,0)/masters.length)} ／ ${(masters.reduce((s,x)=>s+x.cost,0)/masters.length).toFixed(1)}</td></tr>
      </table>
    </div>`;
}

// ---------- 編集フォーム ----------
const opt=(v,label,c)=>`<option value="${esc(v)}" ${String(v)===String(c??'')?'selected':''}>${esc(label)}</option>`;
const numIn=(p,v,label)=>`<label class="mini"><span>${label}</span><input type="number" data-p="${p}" data-t="num" value="${v}"></label>`;
const optNum=(p,v,label)=>`<label class="mini"><span>${label}</span><input type="number" min="0" data-p="${p}" data-t="optnum" value="${v??''}" placeholder="-"></label>`;

function renderForm(){
  const u=cur(), el=document.querySelector('#form');
  if(isM()) return renderMasterForm(el);
  if(!u){ el.innerHTML=`<section class="sec"><p>${TERMS.unit}がありません。「＋ 追加」から作成してください。</p></section>`; return; }
  el.innerHTML=`
  <section class="sec"><h2>基本情報</h2>
    <div class="fields">
      <label>名前<input data-p="name" value="${esc(u.name)}"></label>
      <label>ID<input data-p="id" value="${esc(u.id)}"><small>半角英数字・_・-（データの識別用）</small></label>
      <label>クラス<span class="clsin"><span data-clsprev>${clsIconTag(u.cls)}</span><input data-p="cls" list="classlist" value="${esc(u.cls)}"></span>
        <small>一覧から選ぶか、オリジナルのクラス名を入力（相性はなし）</small>
        <datalist id="classlist">${CLASSES.map(c=>`<option value="${esc(c)}">${CLASSES_BASIC.includes(c)?'基本':'エクストラ'}</option>`).join('')}</datalist></label>
      <label>コスト<input type="number" min="0" max="${RULES.costCap}" data-p="cost" data-t="num" value="${u.cost}"></label>
      <label>HP<input type="number" min="1" step="5" data-p="hp" data-t="num" value="${u.hp}"></label>
    </div>
    <div class="row tplrow"><label>カード構成テンプレ
      <select id="tplsel">${CARD_TPL_KEYS.map(k=>opt(k,k,tplKey)).join('')}</select></label>
      <button class="small" data-act="applyTpl">このコストのテンプレを適用</button>
      <small class="sub">HPと6面を、コストとカード構成に合わせた標準値に置き換えます（${TERMS.asc}面の${TERMS.asc}後・スキル・セリフは変えません）</small></div>
  </section>
  <section class="sec"><h2>画像</h2>
    <p class="sub small nm">画像は専用フォルダ <code>${IMG_DIR}</code> に、キャラクターのIDと同じ名前の ${IMG_EXT} を置くと自動で使われます（エディタでの指定は不要）。
      カード用画像がなければキャラクター画像をカードにも使います。コマンドカードは「共通の背景」＋「カード用キャラ画像」＋「共通の枠と種別名」の重ね合わせです（共通素材は rules.js の CARD_LAYERS）。</p>
    <div class="imged">
      <div class="imgfield isface"><span class="imgprev" data-imgprev="face">${faceImg(u,'face lg')}</span>
        <span class="imglab">${IMG_KEYS.face}</span>
        <code data-imgpath="face">${esc(IMG_DIR+u.id)}.${IMG_EXT}</code><small class="sub">なければ仮画像</small></div>
      <div class="imgfield iscards"><span class="imgprev" data-imgprev="cards">${cardPreviewHTML(u)}</span>
        <span class="imglab">${IMG_KEYS.card}（任意）</span>
        <code data-imgpath="card">${esc(IMG_DIR+u.id)}${IMG_CARD_SUFFIX}.${IMG_EXT}</code><small class="sub">なければキャラクター画像を使う。背景を透過すると共通背景が見えて映えます</small></div>
    </div>
    <p class="sub small nm">画像がはみ出る・見切れるときは、表示位置と拡大で調整できます（ゲーム画面・カット・カードに反映）。</p>
    <div class="fited">${['face','card'].map(k=>`<div class="fitgrp"><b>${IMG_KEYS[k]}</b>
      ${[['x','左右'],['y','上下'],['z','拡大']].map(([a,lab])=>`<label class="fitrow"><span>${lab}</span>
        <input type="range" min="${FIT_RANGE[a][0]}" max="${FIT_RANGE[a][1]}" step="1" data-p="fit.${k}.${a}" data-t="num" value="${u.fit[k][a]}">
        <output data-fitout="${k}.${a}">${u.fit[k][a]}%</output></label>`).join('')}
      <button class="small" data-act="fitReset" data-k="${k}">リセット</button></div>`).join('')}</div>
  </section>
  <section class="sec"><h2>セリフ</h2>
    <p class="sub small nm">1行に1つずつ書きます。複数あるときは、その場面でランダムに1つを吹き出しで表示します。</p>
    <div class="lineed">${Object.entries(LINE_KEYS).map(([k,lab])=>`<label class="linefield">
      <span class="linelab">${lab}${LINE_MIN[k]?`<small>（${LINE_MIN[k]}種類以上）</small>`:''}<span class="sub small" data-linecount="${k}">${u.lines[k].length}件</span></span>
      <textarea data-p="lines.${k}" data-t="lines" rows="${Math.max(2,LINE_MIN[k]||0,u.lines[k].length)}" placeholder="${esc(lab)}のセリフ">${esc(u.lines[k].join(String.fromCharCode(10)))}</textarea></label>`).join('')}</div>
  </section>
  <section class="sec"><h2>鉛筆の6面</h2>
    <p class="sub small nm">行動回数は行動回数決定フェイズで、コマンドは行動決定フェイズで使います。${RULES.actsTable?'行動回数は全サーヴァント共通の値です。':''}${TERMS.ascFull}面は${TERMS.asc}前に1つ置くのが基本です（霊基再臨しないサーヴァントは置かなくてもかまいません）。</p>
    <div class="faceed">
      <div class="facerow head"><span>出目</span><span>行動回数</span><span>${TERMS.asc}前のコマンド</span><span>${TERMS.asc}後のコマンド</span></div>
      ${u.faces.map((f,i)=>`<div class="facerow">
        <span class="die">${i+1}</span>
        ${RULES.actsTable
          ? `<span class="mini acts" title="行動回数は全サーヴァント共通（rules.js の RULES.actsTable）"><span class="only-narrow">行動回数</span>${RULES.actsTable[i]}回</span>`
          : `<label class="mini acts"><span class="only-narrow">行動回数</span><select data-p="faces.${i}.acts" data-t="num">${[1,2,3].map(n=>opt(n,`${n}回`,f.acts)).join('')}</select></label>`}
        ${cmdEd(`faces.${i}.pre`,f.pre,true)}
        ${cmdEd(`faces.${i}.post`,f.post,false)}
      </div>`).join('')}
    </div>
  </section>
  <section class="sec"><h2>スキル</h2>${u.skills.map(skillEd).join('')}</section>
  <section class="sec"><h2>${TERMS.ult}</h2>
    <div class="subcard">
      <div class="fields">
        <label>名前<input data-p="ult.name" value="${esc(u.ult.name)}"></label>
        <label>ルビ（任意）<input data-p="ult.ruby" value="${esc(u.ult.ruby||'')}" placeholder="よみがな"></label>
        <label>コマンドの色<select data-p="ult.c">${['R','B','G'].map(c=>opt(c,TERMS[c],u.ult.c)).join('')}</select></label>
      </div>
      ${effList('ult.eff',u.ult.eff,'ult','ult')}
      <div class="preview" data-prev="ult">${esc(effsText(u.ult.eff))}</div>
    </div>
  </section>`;
}
function cmdEd(path,c,isPre){
  const types=CMD_TYPES.filter(t=>t!=='ASC'||isPre||c.c==='ASC');
  const label=t=>t==='ASC'?`${TERMS.ascFull}面`:t==='W'?`${TERMS.W}（白）`:TERMS[t];
  const select=`<select class="ctype" data-act="cmdType" data-path="${path}" aria-label="コマンドの種類">${types.map(t=>opt(t,label(t),c.c)).join('')}</select>`;
  let body='';
  if(['R','B','G'].includes(c.c)) body=`<div class="cmdnums">${numIn(path+'.dmg',c.dmg,'ダメージ')}${numIn(path+'.np',c.np,TERMS.gauge)}${numIn(path+'.star',c.star,'★')}</div>${effList(path+'.eff',c.eff||[],'special','cmd')}`;
  else if(c.c==='W') body=`<input data-p="${path}.label" value="${esc(c.label)}" placeholder="特殊行動の名前">
    <div class="cmdnums">${numIn(path+'.dmg',c.dmg||0,'ダメージ')}${numIn(path+'.np',c.np,TERMS.gauge)}${numIn(path+'.star',c.star,'★')}</div>
    <p class="sub small nm">ダメージを入れると無属性の攻撃になります（チェインには数えません）。</p>${effList(path+'.eff',c.eff,'special','W')}`;
  else if(c.c==='ASC') body=`<span class="sub small">出たら${TERMS.ascFull}する（1行動として数える）</span>`;
  return `<div class="cmded c-${esc(c.c)}">${select}${body}</div>`;
}
function skillEd(s,i){
  const p=`skills.${i}`;
  return `<div class="subcard">
    <div class="row"><b>スキル${i+1}</b>${i===2?`<span class="sub small">${TERMS.ascFull}後に使えるスキル</span>`:''}</div>
    <div class="fields">
      <label>名前<input data-p="${p}.name" value="${esc(s.name)}"></label>
      <label>ランク（任意）<input data-p="${p}.rank" value="${esc(s.rank||'')}" placeholder="A+ など"></label>
      <label>対象の選び方<select data-p="${p}.pick" data-t="optstr" data-act="structural">${Object.entries(PICKS).map(([k,v])=>opt(k,v,s.pick||'')).join('')}</select></label>
    </div>
    ${effList(p+'.eff',s.eff,'skill')}
    <div class="preview" data-prev="skill" data-i="${i}">${esc(effsText(s.eff,s.pick))}</div>
  </div>`;
}
// atKind：攻撃に付いた効果のタイミングの既定（'W'＝特殊行動 / 'cmd'＝通常コマンド / 'ult'＝宝具）。スキルでは渡さない
function effList(path,effs,ctx,atKind){
  return `<div class="effs">${effs.map((e,j)=>effRow(path,j,e,ctx,effs.length,atKind)).join('')}
    <button class="small add" data-act="effAdd" data-path="${path}" data-ctx="${ctx}">＋ 効果</button></div>`;
}
// 攻撃前／攻撃後の選択（ダメージ効果と「他のサーヴァントをロール」には不要）
function effAtSel(p,e,atKind){
  if(!atKind||e.k==='dmg'||e.k==='copyRoll') return '';
  const def=EFF_AT_DEFAULT[atKind], defLabel=def==='order'?'並び順':EFF_AT[def];
  return `<label class="mini" title="攻撃（ダメージ）の前に適用するか、後に適用するか"><span>タイミング</span><select data-p="${p}.at" data-t="optstr">${opt('',`既定（${defLabel}）`,e.at||'')}${Object.entries(EFF_AT).map(([k,v])=>opt(k,v,e.at)).join('')}</select></label>`;
}
function effRow(path,j,e,ctx,n,atKind){
  const p=`${path}.${j}`, f=FX[e.k]||{};
  const kinds=Object.keys(FX).filter(k=>fxOnlyIn(k,ctx));
  const tg=TGT_BY_CTX[ctx].includes(e.t)?TGT_BY_CTX[ctx]:[...TGT_BY_CTX[ctx],e.t];
  return `<div class="eff" data-ep="${p}">
    <select data-p="${p}.k" data-act="effKind" aria-label="効果の種類">${kinds.map(k=>opt(k,FX[k].name,e.k)).join('')}</select>
    <select data-p="${p}.t" aria-label="対象">${tg.map(t=>opt(t,TARGETS[t]||t,e.t)).join('')}</select>
    ${f.val?numIn(p+'.v',e.v,'値'):''}
    ${f.inst?'':(f.timesOnly||(ctx==='master'&&/^faces./.test(path))?'':optNum(p+'.turns',e.turns,'ターン'))+optNum(p+'.times',e.times,'回数')}
    ${FX[e.k]&&FX[e.k].color?`<label class="mini"><span>色</span><select data-p="${p}.color" data-t="optstr">${opt('','すべて',e.color||'')}${['R','B','G'].map(c=>opt(c,TERMS[c],e.color)).join('')}</select></label>`:''}
    ${e.k==='atkVs'?`<label class="mini"><span>弱体</span><select data-p="${p}.vs" data-t="optstr">${opt('','どれでも',e.vs||'')}${Object.keys(FX).filter(k=>FX[k].buff===false).map(k=>opt(k,FX[k].name,e.vs)).join('')}</select></label>`:''}
    <label class="mini"><span>確率</span><select data-p="${p}.chance" data-t="optnum">${opt('','必ず',e.chance??'')}${[1,2,3,4,5].map(k=>opt(k,`ロール${k}以下`,e.chance)).join('')}</select></label>
    ${effAtSel(p,e,atKind)}
    <span class="effops">
      <button data-act="effMove" data-path="${path}" data-i="${j}" data-d="-1" ${j?'':'disabled'} title="上へ">↑</button>
      <button data-act="effMove" data-path="${path}" data-i="${j}" data-d="1" ${j<n-1?'':'disabled'} title="下へ">↓</button>
      <button data-act="effDel" data-path="${path}" data-i="${j}" title="削除">×</button>
    </span>
    <div class="effprev">${esc(fxText(e))}</div>
  </div>`;
}
// 3種のカードを並べたプレビュー（画像欄用）
const cardPreviewHTML=u=>`<span class="ccrow">${['R','B','G'].map(k=>cmdCardHTML(u,{c:k})).join('')}</span>`;
// 入力中は再描画せず、説明文だけ更新する（入力欄のフォーカスを保つため）
function updatePreviews(){
  const u=cur(); if(!u) return;
  document.querySelectorAll('.eff[data-ep]').forEach(el=>{ const e=getPath(u,el.dataset.ep); if(e) el.querySelector('.effprev').textContent=fxText(e); });
  if(isM()){
    document.querySelectorAll('[data-prev="mface"]').forEach(el=>el.textContent=mFaceText(u.faces[+el.dataset.i]));
    document.querySelectorAll('[data-prev="spell"]').forEach(el=>el.textContent=effsText(u.spells[+el.dataset.i].eff));
    document.querySelectorAll('[data-fitout]').forEach(el=>{ const [k,a]=el.dataset.fitout.split('.'); el.textContent=`${u.fit[k][a]}%`; });
    const ma=RULESETS.master.masterAtk, at=document.querySelector('[data-mprev="atk"]'); if(at) at.textContent=`攻撃：相手${TERMS.player}へ${u.cost*ma.master}・相手${TERMS.unit}へ${u.cost*ma.svt}（マスタールール）`;
    document.querySelectorAll('[data-imgprev]').forEach(el=>{ const key=`${u.id}|${JSON.stringify(u.fit)}`; if(el.dataset.key===key) return; el.dataset.key=key; el.innerHTML=faceImg(u,'face lg');
      const f=document.querySelector('[data-imgpath="face"]'); if(f) f.textContent=`${IMG_DIR+u.id}.${IMG_EXT}`; });
    return;
  }
  document.querySelectorAll('[data-prev="skill"]').forEach(el=>{ const s=u.skills[+el.dataset.i]; el.textContent=effsText(s.eff,s.pick); });
  document.querySelectorAll('[data-prev="ult"]').forEach(el=>el.textContent=effsText(u.ult.eff));
  document.querySelectorAll('[data-fitout]').forEach(el=>{ const [k,a]=el.dataset.fitout.split('.'); el.textContent=`${u.fit[k][a]}%`; });
  document.querySelectorAll('[data-linecount]').forEach(el=>el.textContent=`${u.lines[el.dataset.linecount].length}件`);
  document.querySelectorAll('[data-clsprev] img').forEach(im=>{ const src=classIcon(u.cls); if(im.getAttribute('src')!==src){ im.onerror=()=>{ im.onerror=null; im.src=CLASS_ICON_EXTRA; }; im.src=src; } });
  // 画像のパスが変わったときだけプレビューを作り直す（同じパスなら読み込み直さない）
  document.querySelectorAll('[data-imgprev]').forEach(el=>{
    const key=`${u.id}|${u.cls}|${JSON.stringify(u.fit)}`; if(el.dataset.key===key) return; el.dataset.key=key;
    el.innerHTML = el.dataset.imgprev==='face' ? faceImg(u,'face lg') : cardPreviewHTML(u);
    const f=document.querySelector('[data-imgpath="face"]'), c=document.querySelector('[data-imgpath="card"]');
    if(f) f.textContent=`${IMG_DIR+u.id}.${IMG_EXT}`; if(c) c.textContent=`${IMG_DIR+u.id}${IMG_CARD_SUFFIX}.${IMG_EXT}`;
  });
}

// ---------- 右側：プレビュー・検証・数値 ----------
function faceStats(u,post){
  const cs=u.faces.map(f=>post?f.post:f.pre), avg=a=>a.reduce((s,x)=>s+x,0)/a.length;
  return { dmg:avg(cs.map(c=>c.dmg||0)), np:avg(cs.map(c=>c.np||0)), star:avg(cs.map(c=>c.star||0)),
    asc:cs.filter(c=>c.c==='ASC').length/6, acts:avg(u.faces.map((f,i)=>faceActs(u,i))), hp:u.hp, cost:u.cost,
    mix:CMD_TYPES.map(t=>[t,cs.filter(c=>c.c===t).length]).filter(x=>x[1]) };
}
function renderSide(){
  const u=cur(), el=document.querySelector('#side');
  if(isM()) return renderMasterSide(el);
  if(!u){ el.innerHTML=''; return; }
  const iss=validateUnits(units).filter(x=>x.i===sel||x.i===-1);
  const a=faceStats(u,false), b=faceStats(u,true), all=units.map(x=>faceStats(x,false));
  const av=k=>all.reduce((s,x)=>s+x[k],0)/all.length, r=n=>Math.round(n*10)/10, pct=n=>`${Math.round(n*100)}%`;
  const mix=m=>m.map(([t,n])=>`${t==='ASC'?TERMS.asc:TERMS[t]}${n}`).join(' ');
  el.innerHTML=`
    <div class="sidecard">
      <div class="row"><b>鉛筆プレビュー</b><span class="grow"></span>
        <label class="mini"><input type="checkbox" id="rollPost" ${rollPost?'checked':''}>${TERMS.asc}後</label>
        <button class="primary small" data-act="roll">転がす</button></div>
      ${pencilHTML(u)}
      <div id="rollres" class="rollres">${rollResultHTML(u)}</div>
    </div>
    <div class="sidecard"><b>検証</b>
      ${iss.length?`<ul class="issues">${iss.map(x=>`<li class="${x.level}">${x.level==='error'?'エラー':'注意'}：${esc(x.msg)}</li>`).join('')}</ul>`:'<p class="ok small nm">問題は見つかりませんでした。</p>'}
    </div>
    <div class="sidecard"><b>数値の目安</b>
      <table class="stats">
        <tr><th></th><th>${TERMS.asc}前</th><th>${TERMS.asc}後</th><th>全体平均</th></tr>
        <tr><td>ダメージ／ロール</td><td>${r(a.dmg)}</td><td>${r(b.dmg)}</td><td>${r(av('dmg'))}</td></tr>
        <tr><td>${TERMS.gauge}／ロール</td><td>${r(a.np)}%</td><td>${r(b.np)}%</td><td>${r(av('np'))}%</td></tr>
        <tr><td>${TERMS.star}／ロール</td><td>${r(a.star)}</td><td>${r(b.star)}</td><td>${r(av('star'))}</td></tr>
        <tr><td>${TERMS.ascFull}する確率</td><td>${pct(a.asc)}</td><td>-</td><td>${pct(av('asc'))}</td></tr>
        <tr><td>平均行動回数</td><td colspan="2">${r(a.acts)}</td><td>${r(av('acts'))}</td></tr>
        <tr><td>HP ／ コスト</td><td colspan="2">${u.hp} ／ ${u.cost}</td><td>${r(av('hp'))} ／ ${r(av('cost'))}</td></tr>
        <tr><td>面の内訳</td><td>${mix(a.mix)}</td><td>${mix(b.mix)}</td><td></td></tr>
      </table>
      <p class="sub small nm">1回ロールしたときの平均値です。全体平均は${units.length}体の${TERMS.asc}前の値です。</p>
    </div>
    <div class="sidecard"><b>カードの見え方</b>
      <div class="card prev"><div class="uhead">${faceImg(u)}<div class="uinfo"><div class="top">${clsBadge(u.cls)}<b>${esc(u.name)}</b><span class="cost">コスト${u.cost} ・ HP${u.hp}</span></div>
        <div class="ccrow">${['R','B','G'].map(k=>cmdCardHTML(u,{c:k},{small:true})).join('')}</div></div></div>${skillListHTML(u)}</div>
    </div>`;
}
function pencilHTML(u){
  return `<div class="pencil" aria-label="鉛筆の6面">
    <div class="peraser"></div><div class="pferrule"></div>
    <div class="pbody">${u.faces.map((f,i)=>{ const n=faceActs(u,i); return `<div class="pface ${rollIdx===i?'hit':''}">
      <span class="dieb">${i+1}</span><span class="pips" title="行動回数${n}">${'●'.repeat(n)}${'○'.repeat(Math.max(0,3-n))}</span>${cmdChip(rollPost?f.post:f.pre)}</div>`; }).join('')}</div>
    <div class="ptip"><i></i></div></div>`;
}
function rollResultHTML(u){
  if(rollIdx==null) return '<span class="sub small">「転がす」で1回ロールを試せます。</span>';
  if(rollTimer) return '<span class="sub small">ころころ…</span>';
  if(isM()){ const f=u.faces[rollIdx]; return `出目<b>${rollIdx+1}</b> ・ ${f.eff.length?`<b>${esc(f.label)}</b><div class="sub small">${esc(effsText(f.eff))}</div>`:'無（何も起きない）'}`; }
  const f=u.faces[rollIdx], c=rollPost?f.post:f.pre;
  return `出目<b>${rollIdx+1}</b> ・ 行動回数<b>${faceActs(u,rollIdx)}</b> ・ ${cmdChip(c)}${c.eff&&c.eff.length?`<div class="sub small">${esc(effsText(c.eff))}</div>`:''}`;
}
function doRoll(){
  clearInterval(rollTimer);
  const final=Math.floor(Math.random()*6); let n=0;
  rollTimer=setInterval(()=>{
    n++; rollIdx = n<9 ? Math.floor(Math.random()*6) : final;
    if(n>=9){ clearInterval(rollTimer); rollTimer=null; }
    document.querySelectorAll('.pface').forEach((el,i)=>el.classList.toggle('hit',i===rollIdx));
    const r=document.querySelector('#rollres'); if(r) r.innerHTML=rollResultHTML(cur());
  },60);
}

// ---------- お知らせ ----------
function toast(msg,err){
  const t=document.querySelector('#toast');
  t.textContent=msg; t.className='show'+(err?' err':'');
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.className='',3500);
}

// ---------- 入力 ----------
document.addEventListener('input',e=>{
  const el=e.target;
  if(el.dataset.act==='cmdType'){
    const old=getPath(cur(),el.dataset.path);
    setPath(cur(),el.dataset.path,makeCmd(el.value,old));
    return full();
  }
  if(!el.dataset.p) return;
  setPath(cur(),el.dataset.p,conv(el));
  if(el.dataset.act==='effKind'){ const e=getPath(cur(),el.dataset.p.replace(/\.k$/,'')); fixEff(e);
    if(isM()&&/^faces\./.test(el.dataset.p)) delete e.turns; // 補助の効果はそのターンだけ（ターン数は使わない）
    return full(); }
  if(el.dataset.act==='structural') return full();
  light();
});
document.addEventListener('change',e=>{
  const el=e.target;
  if(el.id==='tplsel') tplKey=el.value;
  if(el.id==='rollPost'){ rollPost=el.checked; renderSide(); }
  if(el.id==='file'&&el.files[0]){
    const f=el.files[0], rd=new FileReader();
    rd.onload=()=>{
      try{
        if(isM()){ masters=parseMastersFile(String(rd.result)); msel=0; rollIdx=null; full(); toast(`${f.name} から${TERMS.player}${masters.length}人を読み込みました`); }
        else { units=parseUnitsFile(String(rd.result)); sel=0; rollIdx=null; full(); toast(`${f.name} から${units.length}体を読み込みました`); }
      }
      catch(err){ toast(`読み込めませんでした：${err.message}`,true); }
      el.value='';
    };
    rd.readAsText(f);
  }
});
document.addEventListener('click',e=>{
  const b=e.target.closest('button[data-act]'); if(!b||b.disabled) return;
  const a=b.dataset.act, u=cur();
  switch(a){
    case 'tab': if(b.dataset.tab!==tab){ tab=b.dataset.tab==='masters'?'masters':'units'; rollIdx=null; try{ localStorage.setItem('pencilduel.editorTab',tab); }catch(e){} renderAll(); window.scrollTo({top:0}); } break;
    case 'sel': setSel(+b.dataset.i); rollIdx=null; renderAll(); window.scrollTo({top:0}); break;
    case 'add': { const L=list(); L.push(isM()?newMaster():newUnit()); setSel(L.length-1); rollIdx=null; full(); break; }
    case 'dup': { const L=list(), i=selIdx(), c=clone(u); c.id=uniqueId(c.id); c.name+='（コピー）'; L.splice(i+1,0,c); setSel(i+1); full(); break; }
    case 'del': if(confirm(`「${u.name||'名前なし'}」を削除しますか？`)){ const L=list(), i=selIdx(); L.splice(i,1); setSel(Math.max(0,Math.min(i,L.length-1))); rollIdx=null; full(); } break;
    case 'move': { const L=list(), i=selIdx(), j=i+Number(b.dataset.d); if(j<0||j>=L.length) break; [L[i],L[j]]=[L[j],L[i]]; setSel(j); full(); break; }
    case 'fitReset': { u.fit[b.dataset.k]={...FIT_DEF[b.dataset.k]}; full(); break; }
    case 'effAdd': { if(!getPath(u,b.dataset.path)) setPath(u,b.dataset.path,[]); getPath(u,b.dataset.path).push(newEff(b.dataset.ctx)); full(); break; }
    case 'effDel': getPath(u,b.dataset.path).splice(+b.dataset.i,1); full(); break;
    case 'effMove': { const l=getPath(u,b.dataset.path), i=+b.dataset.i, j=i+Number(b.dataset.d); [l[i],l[j]]=[l[j],l[i]]; full(); break; }
    case 'applyTpl': {
      if(!confirm(`コスト${u.cost}・${tplKey} のテンプレで、HPと鉛筆の6面を置き換えますか？`)) break;
      const err=applyCardTpl(u); if(err){ toast(err,true); break; }
      full(); toast(`${tplKey}（コスト${u.cost}）のテンプレを適用しました`); break; }
    case 'roll': doRoll(); break;
    case 'apply':
      if(isM()){
        if(mastersHaveErrors(masters,units)){ toast('エラーがあるため反映できません。一覧の赤い数字と右の「検証」を確認してください',true); break; }
        if(saveCustomMasters(masters)){ renderStatus(); toast(`${TERMS.player}をゲームに反映しました。マスタールール・マスターチームで使えます`); }
        else toast('ブラウザに保存できませんでした',true);
        break;
      }
      if(hasErrors(units)){ toast('エラーがあるため反映できません。一覧の赤い数字と右の「検証」を確認してください',true); break; }
      if(saveCustomUnits(units)){ renderStatus(); toast('ゲームに反映しました。ゲーム画面のモード選択から使えます'); }
      else toast('ブラウザに保存できませんでした',true);
      break;
    case 'unapply':
      if(isM()){ if(confirm(`ゲームの${TERMS.player}を標準データ（js/masters.js）に戻しますか？ 編集中のデータはこのまま残ります。`)){ clearCustomMasters(); renderStatus(); toast(`ゲームの${TERMS.player}は標準データに戻りました`); } break; }
      if(confirm('ゲームを標準データ（js/units.js）に戻しますか？ 編集中のデータはこのまま残ります。')){ clearCustomUnits(); renderStatus(); toast('ゲームは標準データに戻りました'); }
      break;
    case 'exportJS': if(isM()){ downloadText('masters.js',mastersToJS(masters),'text/javascript'); toast('js/masters.js と置き換えると、標準データとして公開できます'); break; }
      downloadText('units.js',unitsToJS(units),'text/javascript'); toast('js/units.js と置き換えると、標準データとして公開できます'); break;
    case 'exportJSON': if(isM()){ downloadText('pencil-masters.json',JSON.stringify(masters,null,2),'application/json'); break; }
      downloadText('pencil-units.json',JSON.stringify(units,null,2),'application/json'); break;
    case 'import': document.querySelector('#file').click(); break;
    case 'resetDefault':
      if(isM()){ if(confirm(`編集中の${TERMS.player}を標準データ（js/masters.js）に戻しますか？ 今の編集内容は消えます。`)){ masters=(typeof DEFAULT_MASTERS!=='undefined'?DEFAULT_MASTERS:[]).map(normalizeMaster); msel=0; rollIdx=null; full(); toast('標準データに戻しました'); } break; }
      if(confirm('編集中のデータを標準データ（js/units.js）に戻しますか？ 今の編集内容は消えます。')){ units=normalizeUnits(DEFAULT_UNITS); sel=0; rollIdx=null; full(); toast('標準データに戻しました'); }
      break;
  }
});
// ゲーム側や別タブで反映状態が変わったら表示を更新
window.addEventListener('storage',e=>{ if(e.key===STORE.units||e.key===STORE.masters) renderStatus(); });

boot();
