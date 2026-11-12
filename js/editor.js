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
    case 'optlines': { const a=v.split(/\r?\n/).map(x=>x.trim()).filter(Boolean); return a.length?a:undefined; } // 専用セリフ（空なら項目ごと消す）
    case 'bool': return el.checked||undefined; // チェックボックス（外したら項目ごと消す）
    case 'tags': return [...new Set(v.split(/[,、，\s]+/).map(x=>x.trim()).filter(Boolean))]; // 属性：読点・カンマ・空白区切り
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
  return { id:uniqueId('unit'), name:'新しいサーヴァント', cls:CLASSES[0], traits:[], cost:2, hp:100, fit:normFit(), lines:Object.fromEntries(Object.keys(LINE_KEYS).map(k=>[k,[]])),
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
  const c=makeCmd0(t,old); if(old.line&&old.line.length) c.line=old.line; // 専用セリフは種類を変えても残す
  return c;
}
function makeCmd0(t,old){
  if(t==='ASC') return {c:'ASC'};
  if(t==='W') return {c:'W',label:old.label||'特殊行動',eff:old.eff||[{k:'heal',t:'self',v:20}],dmg:0,np:0,star:0};
  return {c:t,dmg:old.dmg||20,np:0,star:0}; // 属性を変えたらNP・スターは0に戻す
}
function newEff(ctx,path){
  if(ctx==='ult') return {k:'dmg',t:'target',v:80};
  if(ctx==='master') return /^spells\./.test(path||'')?{k:'atk',t:'ally_svt',v:20,turns:1}:{k:'atk',t:'ally_svt',v:20}; // 令呪の継続効果は1ターン、補助の面はそのターンだけ（ターン数なし）
  if(ctx==='special') return {k:'heal',t:'self',v:20};
  return {k:'atk',t:'self',v:10,turns:3};
}
// ---------- 効果の種類を変えたときの自動設定（値・対象・ターン） ----------
// 値の目安（なければ20）。FX_VAL_MASTER＝マスターの補助・令呪で別の値を使うもの
const FX_VAL = { atk:20, atkDown:10, def:10, defDown:10, critPow:30, critMult:200, guts:100, critRoll:1, debuffUp:1, debuffDown:1, critDown:1, starDown:2, nullUnder:30,
  onAtkStar:3, onAtkNp:10, actsUp:1, actsDown:1, regenHp:20, regenNp:5, regenStar:2, atkVs:50, atkTrait:50, defTrait:50, counter:20, onHitNp:10, onHitStar:3,
  maxHp:100, poison:20, burn:20, drain:20, heal:100, np:20, star:5, starLoss:5, buffExtend:1, skillCharge:1, dmg:200, selfDmg:20, npPow:80, npPowDown:50, multiHit:2 };
const FX_VAL_MASTER = { heal:30, dmg:50, star:5 };
// 1ターンで足りる効果（ほかは3ターン）
const FX_TURN1 = ['evade','invul','pierce','sureHit','stun','sealSkill','sealUlt','charm','fear','ignoreDef','actsDown','taunt'];
// 対象の側：ally＝味方側（既定は自分） / enemy＝敵側 / master＝マスター（スター） / selfOnly＝自分だけ
const FX_SIDE = { star:'master', starLoss:'enemy', strip:'enemy', instantDeath:'enemy', dmg:'enemy', selfDmg:'selfOnly', copyRoll:'selfOnly' };
const sideOfFx = k=>FX_SIDE[k]||((FX[k]||{}).buff===false?'enemy':'ally');
const T_ALLY = ['self','ally_all','ally_other','master','svt','ally_svt','picked'], T_ENEMY = ['enemy_all','target','enemy_svt','enemy_master','enemy_both','picked'];
const T_DEF = { ally:{skill:'self',ult:'self',special:'self',master:'ally_svt'}, enemy:{skill:'enemy_all',ult:'enemy_all',special:'target',master:'enemy_svt'},
  master:{skill:'master',ult:'master',special:'master',master:'master'}, selfOnly:{skill:'self',ult:'self',special:'self',master:'self'} };
// 種類を変えた効果に、その種類らしい値・対象・ターンを入れる。ctx＝skill/ult/special/master、path＝効果の位置（令呪か補助の面かの判別用）
function autoEff(e,ctx,path){
  const f=FX[e.k]||{}, m=ctx==='master';
  if(f.noTgt){ fixEff(e); return; }
  e.v=f.val?((m&&FX_VAL_MASTER[e.k])||FX_VAL[e.k]||20):0;
  delete e.turns; delete e.times;
  if(!f.inst&&!f.perm){
    if(f.timesOnly) e.times=1;
    else if(!(m&&/^faces\./.test(path||''))) e.turns=m?1:(FX_TURN1.includes(e.k)?1:3); // 令呪の継続効果は1ターン（補助の面はそのターンだけなのでターン数なし）
  }
  const side=sideOfFx(e.k), allowed=TGT_BY_CTX[ctx]||[];
  const ok=side==='ally'?T_ALLY:side==='enemy'?T_ENEMY:[T_DEF[side][ctx]];
  if(!(allowed.includes(e.t)&&ok.includes(e.t))){ const d=e.k==='dmg'&&ctx==='ult'?'target':T_DEF[side][ctx]; e.t=allowed.includes(d)?d:allowed[0]; } // 合う対象なら今の選択を残す
  fixEff(e);
}
// 効果の種類を変えたときに、使わない項目を片づける
function fixEff(e){
  const f=FX[e.k]||{};
  if(!f.val) e.v=0;
  else if(!e.v&&!['poison','burn','critMult'].includes(e.k)) e.v=20; // 値を使わない効果から変えたときの仮の値
  if(f.inst){ delete e.turns; delete e.times; }
  else if(f.timesOnly){ delete e.turns; if(e.times==null) e.times=1; }
  else if(!f.perm&&e.turns==null&&e.times==null) e.turns=3;
  if((e.k==='poison'||e.k==='burn')&&!e.v) e.v=RULES.dot;
  if(!f.color) delete e.color;
  if(!(e.k in VS_KINDS)) delete e.vs;
  else if(e.vs&&!vsOk(e.k,e.vs)) delete e.vs; // 種類を変えたら、合わない指定は外す
  if(!f.trait) delete e.trait;
  else if(!e.trait) e.trait=allTraits()[0]||'';
  if(e.k==='cardConv'&&!e.color) e.color='R';
  if(e.k==='critMult'&&!(e.v>100)) e.v=200;
  if(e.k==='dmg'||e.k==='copyRoll') delete e.at;
  if(e.k==='star'&&e.t==='self') e.t='master';
  if(!f.maxOk) delete e.max;
  if(e.k!=='desc') delete e.text;
  else if(e.text==null) e.text='';
  if(f.noTgt){ e.t=e.t==='svt'?'svt':'self'; delete e.chance; delete e.at; delete e.cond; } // 対象・確率・タイミングを使わない効果
  if(e.k==='multiHit'&&!(e.v>=2)) e.v=2;
}

// 全サーヴァントの属性（入力候補・特攻/特防の選択肢）
const allTraits = ()=>[...new Set(units.flatMap(u=>u.traits||[]))].sort((a,b)=>a.localeCompare(b,'ja'));
const traitDatalist = ()=>`<datalist id="traitlist">${allTraits().map(t=>`<option value="${esc(t)}"></option>`).join('')}</datalist>`;
// 専用セリフ欄（スキル・鉛筆の面）。空なら通常の「スキル使用」「攻撃」のセリフを使う
const ownLineIn=(p,arr,fallback)=>`<label class="ownline"><span>専用セリフ（任意）</span><textarea data-p="${p}" data-t="optlines" rows="${Math.max(1,(arr||[]).length)}" placeholder="空なら「${esc(fallback)}」のセリフ。1行に1つ">${esc((arr||[]).join(String.fromCharCode(10)))}</textarea></label>`;

// ---------- 保存と再描画 ----------
function saveDraft(){ writeJSON(STORE.draft,units); writeJSON(STORE.mdraft,masters); }
// 再描画してもスクロール位置を保つ（フォームを丸ごと作り直すと、高さが一瞬縮んでページの先頭に戻されるため）
function keepScroll(fn){
  const y=window.scrollY, form=document.querySelector('#form'), ul=document.querySelector('.ulist'), lt=ul?ul.scrollTop:0;
  if(form) form.style.minHeight=form.offsetHeight+'px';
  fn();
  const u2=document.querySelector('.ulist'); if(u2) u2.scrollTop=lt;
  window.scrollTo(0,y);
  if(form) requestAnimationFrame(()=>{ form.style.minHeight=''; window.scrollTo(0,y); });
}
function light(){ saveDraft(); keepScroll(()=>{ renderList(); renderSide(); renderStatus(); updatePreviews(); }); }
function full(){ saveDraft(); keepScroll(renderAll); }
function renderAll(){ renderList(); renderForm(); renderSide(); renderStatus(); }

// 今のタブの検証結果・反映済みデータ
const issLabel = lv=>lv==='error'?'エラー':lv==='big'?'大警告':lv==='line'?'セリフ':isM()?'小警告':'注意';
// 確認済み（無視する）警告：タブ・キャラID・メッセージで覚える。内容が変わって別の警告になれば、また出る。エラーは無視できない
const ACK_KEY='pencilduel.ackIssues';
let acked=new Set(); try{ const a=JSON.parse(localStorage.getItem(ACK_KEY)||'[]'); if(Array.isArray(a)) acked=new Set(a); }catch(e){}
const saveAck=()=>{ try{ localStorage.setItem(ACK_KEY,JSON.stringify([...acked])); }catch(e){} };
const issAll = ()=>(isM()?validateMasters(masters,units):validateUnits(units)).map(x=>{ const it=list()[x.i]; return {...x,k:`${tab}|${it?it.id:'*'}|${x.msg}`}; });
const isIgn = x=>x.level!=='error'&&acked.has(x.k);
const issuesNow = ()=>issAll().filter(x=>!isIgn(x));
// 右の「検証」欄：i＝今のキャラの番号。無視ボタンと、無視した警告（戻せる）つき
function issBoxHTML(i){
  const all=issAll().filter(x=>x.i===i||x.i===-1), live=all.filter(x=>!isIgn(x)), ign=all.filter(isIgn);
  return (live.length?`<ul class="issues">${live.map(x=>`<li class="${x.level}">${issLabel(x.level)}：${esc(x.msg)}${x.level==='error'?'':` <button class="small ack" data-act="ack" data-k="${esc(x.k)}" title="確認済みにして表示しない">無視</button>`}</li>`).join('')}</ul>`:'<p class="ok small nm">問題は見つかりませんでした。</p>')
   +(ign.length?`<details class="ign"><summary>無視した警告（${ign.length}件）</summary><ul class="issues">${ign.map(x=>`<li class="${x.level}">${issLabel(x.level)}：${esc(x.msg)} <button class="small ack" data-act="unack" data-k="${esc(x.k)}">戻す</button></li>`).join('')}</ul></details>`:'');
}
function renderStatus(){
  const applied=isM()?loadMasters(units):loadUnits(), iss=issuesNow();
  const e=iss.filter(x=>x.level==='error').length, w=iss.filter(x=>x.level==='warn').length, bg=iss.filter(x=>x.level==='big').length, ln=iss.filter(x=>x.level==='line').length;
  const dirty=JSON.stringify(list())!==JSON.stringify(isM()?applied.masters:applied.units);
  document.querySelector('#status').innerHTML=
    `<b class="sub">${isM()?TERMS.player:TERMS.unit}：</b><span class="${dirty?'dirty':'clean'}">${dirty?'● ゲームに未反映の変更があります':`✓ ゲームと同じ内容（${applied.source==='custom'?'反映済みデータ':'標準データ'}）`}</span>`+
    ` <span class="sub">エラー${e}・${isM()?`大警告${bg}・小警告${w}`:`注意${w}`}${ln?`・セリフ${ln}`:''}</span>`;
  document.querySelector('#unapply').hidden = applied.source!=='custom';
  document.querySelector('#exportJS').textContent=`${isM()?'masters.js':'units.js'} を書き出し`;
  document.querySelector('#simbtn').hidden=isM(); // バランス検証はサーヴァントだけ
}

// 制作中トグル：ONの間は js の書き出し（units.js / masters.js）に含めない。ゲームへの反映・JSON書き出しには含まれる
const wipIn = d=>`<label class="wipin"><input type="checkbox" data-p="wip" data-t="bool" data-act="structural" ${d.wip?'checked':''}> 制作中（js書き出しに含めない）<small>ONの間は units.js / masters.js の書き出しから外れます。ゲームへの反映とJSON書き出しには含まれます</small></label>`;

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
      const e=iss.filter(x=>x.i===i&&x.level==='error').length, w=iss.filter(x=>x.i===i&&x.level==='warn').length, bg=iss.filter(x=>x.i===i&&x.level==='big').length, ln=iss.filter(x=>x.i===i&&x.level==='line').length;
      return `<button class="uitem ${i===si?'on':''}" data-act="sel" data-i="${i}">
        ${isM()?'':clsBadge(u.cls,true)}${faceImg(u,'face xs')}<span class="uname">${esc(u.name)||'（名前なし）'}</span>${u.wip?'<span class="wipbadge" title="制作中：js書き出しに含まれません">制作中</span>':''}<span class="sub small">C${u.cost}</span>
        ${e?`<span class="dot err" title="エラー${e}件">${e}</span>`:bg?`<span class="dot big" title="大警告${bg}件${w?`・小警告${w}件`:''}">${bg}</span>`:w?`<span class="dot wrn" title="${isM()?'小警告':'注意'}${w}件">${w}</span>`:ln?`<span class="dot lin" title="セリフ${ln}件">${ln}</span>`:''}</button>`;
    }).join('')}</div>
    <div class="row">
      <button class="small" data-act="add">＋ 追加</button>
      <button class="small" data-act="dup" ${cur()?'':'disabled'}>複製</button>
      <button class="small" data-act="move" data-d="-1" ${si>0?'':'disabled'} title="上へ">↑</button>
      <button class="small" data-act="move" data-d="1" ${si<L.length-1?'':'disabled'} title="下へ">↓</button>
      <button class="small danger" data-act="del" ${cur()?'':'disabled'}>削除</button>
    </div>
    <div class="row">
      <button class="small" data-act="exportOne" ${cur()?'':'disabled'} title="選択中の1${isM()?'人':'体'}をJSONで書き出し">1${isM()?'人':'体'}を書き出し</button>
      <button class="small" data-act="importOne" title="書き出した1${isM()?'人':'体'}のJSON（複数入りでも可）を一覧の末尾に追加">1${isM()?'人':'体'}を読み込み</button>
    </div>`;
}

// ---------- マスターの編集（マスタールール・マスターチーム用） ----------
// 新しいマスターはコスト4（星4）のひな形。警告が出ない状態から始める
function newMaster(){
  const t=masterTpl(4), sp=n=>{ const x=SPELL_TPL.find(y=>y.name===n); return {name:x.name,eff:clone(x.eff).map(normEff)}; };
  return { id:uniqueId('master'), name:'新しいマスター', cls:TERMS.player, cost:4, hp:t.hp, master:true, fit:normFit(), lines:Object.fromEntries(Object.keys(MASTER_LINE_KEYS).map(k=>[k,[]])),
    faces:t.faces, spells:[sp('霊子譲渡'),sp('応急手当'),sp('瞬間強化')] };
}
// 令呪テンプレの選択肢：名前＋効果（対象つき）のかんたんな紹介
const spellTplLabel = t=>`${t.name}｜${effsText(t.eff,null,mTLabel)}`;
const mFaceText = f=>f.eff.length?effsText(f.eff,null,mTLabel):'無（何も起きない）';
function renderMasterForm(el){
  const m=cur();
  if(!m){ el.innerHTML=`<section class="sec"><p>${TERMS.player}がいません。「＋ 追加」から作成してください。</p></section>`; return; }
  const ma=RULESETS.master.masterAtk;
  el.innerHTML=`
  <section class="sec"><h2>基本情報</h2>
    <p class="sub small nm">マスタールール（${TERMS.unit}1騎＋${TERMS.player}）とマスターチーム（${TERMS.unit}3騎＋${TERMS.player}）で使う${TERMS.player}です。</p>
    ${wipIn(m)}
    <div class="fields">
      <label>名前<input data-p="name" value="${esc(m.name)}"></label>
      <label>ID<input data-p="id" value="${esc(m.id)}"><small>半角英数字・_・-（${TERMS.unit}と重ならないこと）</small></label>
      <label>コスト<input type="number" min="0" data-p="cost" data-t="num" value="${m.cost}"><small data-mprev="atk">攻撃：相手${TERMS.player}へ${m.cost*ma.master}・相手${TERMS.unit}へ${m.cost*ma.svt}（マスタールール）</small></label>
      <label>HP<input type="number" min="1" step="5" data-p="hp" data-t="num" value="${m.hp}"><small>0になると自軍${TERMS.unit}がこの値のダメージを受ける</small></label>
    </div>
    <div class="row tplrow"><button class="small" data-act="applyMTpl">このコストのテンプレを適用</button>
      <small class="sub">HPと補助の6面を、コスト${m.cost}の標準値（HP＝コスト×100・4番は強め・ほかはコストと同じ数の面）に置き換えます（令呪・セリフは変えません）</small></div>
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
        <div class="preview mprev" data-prev="mface" data-i="${i}">${esc(mFaceText(f))}</div>
        ${ownLineIn(`faces.${i}.line`,f.line,MASTER_LINE_KEYS.support)}</div>
    </div>`).join('')}</div>
  </section>
  <section class="sec"><h2>セリフ</h2>
    <p class="sub small nm">1行に1つずつ書きます。複数あるときは、その場面でランダムに1つを${TERMS.player}の帯から吹き出しで表示します。補助の面・令呪ごとの専用セリフは、各項目の欄で設定できます（空ならここのセリフ）。</p>
    <div class="lineed">${Object.entries(MASTER_LINE_KEYS).map(([k,lab])=>`<label class="linefield">
      <span class="linelab">${lab}<span class="sub small" data-linecount="${k}">${m.lines[k].length}件</span></span>
      <textarea data-p="lines.${k}" data-t="lines" rows="${Math.max(2,m.lines[k].length)}" placeholder="${esc(lab)}のセリフ">${esc(m.lines[k].join(String.fromCharCode(10)))}</textarea></label>`).join('')}</div>
  </section>
  <section class="sec"><h2>令呪</h2>
    <p class="sub small nm">マスタールールは1試合1回・3つから1つ。マスターチームは3画で、同じ効果は1回まで（使うと行動回数-1）。マスターチームでは「自軍${TERMS.unit}」の効果は選んだ1騎にかかります。</p>
    ${m.spells.map((s,i)=>`<div class="subcard">
      <div class="row"><b>令呪${i+1}</b></div>
      <div class="fields"><label>名前<input data-p="spells.${i}.name" value="${esc(s.name)}"></label>
        <label>汎用令呪から入力<select data-spl="${i}"><option value="">（選ぶと名前と効果を置き換えます）</option>${SPELL_TPL.map((t,k)=>opt(k,spellTplLabel(t),'')).join('')}</select></label></div>
      ${effList(`spells.${i}.eff`,s.eff,'master')}
      <div class="preview mprev" data-prev="spell" data-i="${i}">${esc(effsText(s.eff,null,mTLabel))}</div>
      ${ownLineIn(`spells.${i}.line`,s.line,MASTER_LINE_KEYS.spell)}
    </div>`).join('')}
  </section>
  ${traitDatalist()}`;
}
function renderMasterSide(el){
  const m=cur(); if(!m){ el.innerHTML=''; return; }
  el.innerHTML=`
    <div class="sidecard">
      <div class="row"><b>補助の鉛筆プレビュー</b><span class="grow"></span><button class="primary small" data-act="roll">転がす</button></div>
      <div class="pencil" aria-label="${TERMS.player}の鉛筆の6面"><div class="peraser"></div><div class="pferrule"></div>
        <div class="pbody">${m.faces.map((f,i)=>`<div class="pface ${rollIdx===i?'hit':''}"><span class="dieb">${i+1}</span><span class="mflabel ${f.eff.length?'':'sub'}">${esc(f.eff.length?f.label||'（名前なし）':'無')}</span></div>`).join('')}</div>
        <div class="ptip"><i></i></div></div>
      <div id="rollres" class="rollres">${rollResultHTML(m)}</div>
    </div>
    <div class="sidecard"><b>検証</b>
      ${issBoxHTML(msel)}
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
    ${wipIn(u)}
    <div class="fields">
      <label>名前<input data-p="name" value="${esc(u.name)}"></label>
      <label>ID<input data-p="id" value="${esc(u.id)}"><small>半角英数字・_・-（データの識別用）</small></label>
      <label>クラス<span class="clsin"><span data-clsprev>${clsIconTag(u.cls)}</span><input data-p="cls" list="classlist" value="${esc(u.cls)}"></span>
        <small>一覧から選ぶか、オリジナルのクラス名を入力（相性はなし）</small>
        <datalist id="classlist">${CLASSES.map(c=>`<option value="${esc(c)}">${CLASSES_BASIC.includes(c)?'基本':'エクストラ'}</option>`).join('')}</datalist></label>
      <label>コスト<input type="number" min="0" max="${RULES.costCap}" data-p="cost" data-t="num" value="${u.cost}"></label>
      <label>HP<input type="number" min="1" step="5" data-p="hp" data-t="num" value="${u.hp}"></label>
      <label class="wide">属性（複数可）<input data-p="traits" data-t="tags" value="${esc((u.traits||[]).join('、'))}" placeholder="例：竜、騎乗、王、人型">
        <small>読点・カンマ・空白で区切る。特攻・特防の判定に使います${allTraits().length?`（使用中：${esc(allTraits().join('・'))}）`:''}</small></label>
      <label class="wide">キャラクター設定のリンク（任意）<input type="url" data-p="link" data-t="optstr" value="${esc(u.link||'')}" placeholder="https://…">
        <small>http(s) のURL。ゲームのキャラクター詳細に「キャラクター設定」リンクが出ます（別タブで開く）</small></label>
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
  <section class="sec"><h2>条件つきセリフ</h2>
    <p class="sub small nm">相手や味方・敵の属性・クラス・状態・HP・キャラクターによって、場面ごとに専用のセリフを出します。上にあるものから順に見て、最初に条件を満たしたものを使い、どれも満たさなければ上の通常セリフを使います（スキル・鉛筆の面の専用セリフがあればそちらが優先）。「相手・対象」は、攻撃の対象・攻撃してきた相手・スキルの対象です（戦闘開始は敵の先頭）。</p>
    ${(u.condLines||[]).map((c,i)=>`<div class="subcard condline">
      <div class="row">
        <label class="mini"><span>場面</span><select data-p="condLines.${i}.key">${Object.entries(LINE_KEYS).map(([k,v])=>opt(k,v,c.key)).join('')}</select></label>
        <label class="mini"><span>条件を見る人</span><select data-p="condLines.${i}.who" data-act="structural">${Object.entries(LINE_WHO).map(([k,v])=>opt(k,v,c.who)).join('')}</select></label>
        ${condIn(`condLines.${i}`,c,{},LINE_WHO[c.who||'other'])}
        <span class="effbtns"><button data-act="clMove" data-i="${i}" data-d="-1" title="上へ">↑</button><button data-act="clMove" data-i="${i}" data-d="1" title="下へ">↓</button><button data-act="clDel" data-i="${i}" title="削除">×</button></span>
      </div>
      <textarea data-p="condLines.${i}.lines" data-t="lines" rows="${Math.max(2,(c.lines||[]).length)}" placeholder="この条件のときのセリフ。1行に1つ">${esc((c.lines||[]).join(String.fromCharCode(10)))}</textarea>
    </div>`).join('')}
    <button class="small add" data-act="clAdd">＋ 条件つきセリフ</button>
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
  ${traitDatalist()}
  <section class="sec"><h2>${TERMS.ult}</h2>
    <div class="subcard">
      <div class="fields">
        <label>名前<input data-p="ult.name" value="${esc(u.ult.name)}"></label>
        <label>ルビ（任意）<input data-p="ult.ruby" value="${esc(u.ult.ruby||'')}" placeholder="よみがな"></label>
        <label>コマンドの色<select data-p="ult.c">${['R','B','G'].map(c=>opt(c,TERMS[c],u.ult.c)).join('')}</select></label>
        <label>対象の選び方<select data-p="ult.pick" data-t="optstr" data-act="structural">${Object.entries(PICKS).map(([k,v])=>opt(k,v,u.ult.pick||'')).join('')}</select></label>
      </div>
      ${effList('ult.eff',u.ult.eff,'ult','ult')}
      <div class="preview" data-prev="ult">${esc(effsText(u.ult.eff,u.ult.pick))}</div>
    </div>
    ${cutinEdHTML(u)}
  </section>`;
  ctUpdate(true);
}
// ---------- 宝具カットイン（改行位置・顔アップ位置・プレビュー・注意） ----------
// 中身は ctUpdate が入れる（名前やルビの入力中もフォーカスを保ったまま更新するため）
const cutinEdHTML=u=>`<div class="subcard ctedit">
      <div class="row"><b>カットイン</b><span class="grow"></span><button class="small" data-act="ctReplay">▶ 再生</button></div>
      <div class="ctbr" data-ctbr></div>
      <div class="ctwarn" data-ctwarn></div>
      <div class="ctprev" data-ctprev></div>
      <div class="fitgrp"><b>帯の顔アップ（立ち絵のどこを大きく見せるか）</b>
        ${[['x','左右'],['y','上下'],['z','拡大']].map(([a,lab])=>`<label class="fitrow"><span>${lab}</span>
          <input type="range" min="${fitRange('np',a)[0]}" max="${fitRange('np',a)[1]}" step="1" data-p="fit.np.${a}" data-t="num" value="${u.fit.np[a]}">
          <output data-fitout="np.${a}">${u.fit.np[a]}%</output></label>`).join('')}
        <button class="small" data-act="fitReset" data-k="np">リセット</button></div>
      <div class="fitgrp"><b>右側の立ち絵（頭が切れるときに下げる・小さくする）</b>
        ${[['x','左右','右へ'],['y','上下','下へ'],['z','大きさ','']].map(([a,lab])=>`<label class="fitrow"><span>${lab}</span>
          <input type="range" min="${fitRange('cut',a)[0]}" max="${fitRange('cut',a)[1]}" step="1" data-p="fit.cut.${a}" data-t="num" value="${u.fit.cut[a]}">
          <output data-fitout="cut.${a}">${u.fit.cut[a]}%</output></label>`).join('')}
        <button class="small" data-act="fitReset" data-k="cut">リセット</button></div>
    </div>`;
// 改行位置の選択: 「自動」「1行」、文字と文字の間をクリックするとそこで改行
function ctBrHTML(ult){
  const a=[...ult.name], br=ult.br;
  return `<span class="ctbr-lab">改行位置</span>
    <button class="small ${br==null?'on':''}" data-act="ctBr" data-br="">自動</button>
    <button class="small ${br===0?'on':''}" data-act="ctBr" data-br="0">1行</button>
    <span class="ctbr-chars">${a.map((c,i)=>`<span>${esc(c)}</span>`+(i<a.length-1?`<button type="button" class="ctgap${br===i+1?' on':''}" data-act="ctBr" data-br="${i+1}" title="ここで改行"></button>`:'')).join('')}</span>`;
}
// プレビューを作り直す（内容が変わったときだけ。force = 再生し直す）
function ctUpdate(force){
  const u=cur(), box=document.querySelector('[data-ctprev]'); if(!u||isM()||!box) return;
  const key=JSON.stringify([u.id,u.ult.name,u.ult.ruby,u.ult.br,u.ult.c]);
  const brEl=document.querySelector('[data-ctbr]'), bk=JSON.stringify([u.ult.name,u.ult.br]);
  if(brEl.dataset.key!==bk){ brEl.dataset.key=bk; brEl.innerHTML=ctBrHTML(u.ult); }
  const old=box.querySelector('.ct');
  if(!force&&old&&box.dataset.key===key){ // 顔アップの位置だけ: 作り直さず値だけ差し替える
    ['x','y','z'].forEach(a=>{ old.style.setProperty('--g'+a,u.fit.np[a]+'%'); old.style.setProperty('--c'+a,u.fit.cut[a]); }); return; }
  box.dataset.key=key;
  box.innerHTML=cutinStageHTML(u,u.ult,{hold:true});
  // 「再生」以外（入力中など）は最後のコマへ飛ばす（1文字打つたびに演出が始まらないように）
  if(!force) box.querySelector('.ct').getAnimations({subtree:true}).forEach(a=>{ try{ a.finish(); }catch(e){} });
  ctMeasure();
  if(document.fonts&&document.fonts.status!=='loaded') document.fonts.ready.then(ctMeasure);
}
function ctMeasure(){
  const u=cur(), st=document.querySelector('[data-ctprev] .ct'), w=document.querySelector('[data-ctwarn]'); if(!u||!st||!w) return;
  const r=cutinLayout(st,u.ult), iss=cutinIssues(r,u.ult);
  w.innerHTML=iss.length?iss.map(s=>`<div class="iss warn">⚠ ${esc(s)}</div>`).join(''):'<div class="ok">✓ カットインに収まっています</div>';
}
// プレビューの幅が変わったら測り直す
if(typeof ResizeObserver!=='undefined') new ResizeObserver(()=>ctMeasure()).observe(document.querySelector('#form'));
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
  // 面の専用セリフ（攻撃のときの吹き出し。効果だけの特殊行動・霊基再臨面は、書いたときだけ出す）
  body+=ownLineIn(path+'.line',c.line,LINE_KEYS.attack);
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
    ${ownLineIn(p+'.line',s.line,LINE_KEYS.skill)}
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
// 条件（cond）の入力：種類 → 値 →「でないとき」。使う瞬間に見る効果（攻撃・防御補正）は「相手」、それ以外は「対象」を見る
function condIn(p,e,f,lab){
  const c=e.cond, s=lab||(f.condUse?'相手':'対象');
  const kind=`<label class="mini" title="条件を満たす${s}にだけ効果が働きます"><span>条件（${s}）</span><select data-act="condKind" data-ep="${p}">${opt('','なし',c?c.k:'')}${Object.entries(COND_KINDS).map(([k,v])=>opt(k,v,c&&c.k)).join('')}</select></label>`;
  if(!c) return kind;
  const fxs=Object.keys(FX).filter(k=>!FX[k].inst&&!FX[k].noTgt&&FX[k].buff!=null);
  const val={
    trait:`<input class="traitin" list="traitlist" data-p="${p}.cond.v" data-t="optstr" value="${esc(c.v||'')}" placeholder="属性名">`,
    cls:`<select data-p="${p}.cond.v">${[...new Set([...CLASSES,c.v].filter(Boolean))].map(k=>opt(k,k,c.v)).join('')}</select>`,
    fx:`<select data-p="${p}.cond.v">${opt('*debuff','いずれかの弱体',c.v)}${opt('*buff','いずれかの強化',c.v)}${fxs.map(k=>opt(k,FX[k].name,c.v)).join('')}</select>`,
    id:`<select data-p="${p}.cond.v">${[...new Set([...units.map(x=>x.id),...masters.map(x=>x.id),c.v].filter(Boolean))].map(k=>{ const x=[...units,...masters].find(y=>y.id===k); return opt(k,x?`${x.name}（${k}）`:k,c.v); }).join('')}</select>`,
    hpBelow:`<input type="number" min="1" max="100" data-p="${p}.cond.v" data-t="num" value="${c.v}"><span class="sub">%</span>`,
    hpAbove:`<input type="number" min="1" max="100" data-p="${p}.cond.v" data-t="num" value="${c.v}"><span class="sub">%</span>`,
  }[c.k]||'';
  const self=f.condUse?`<label class="mini chk" title="攻撃・防御の相手ではなく、この効果が付く本人（例：自分が女性のとき）を条件にします"><input type="checkbox" data-p="${p}.cond.self" data-t="bool" ${c.self?'checked':''}><span>付与先を見る</span></label>`:'';
  return kind+(val?`<label class="mini">${val}</label>`:'')+`<label class="mini chk"><input type="checkbox" data-p="${p}.cond.not" data-t="bool" ${c.not?'checked':''}><span>でないとき</span></label>`+self;
}
function effRow(path,j,e,ctx,n,atKind){
  const p=`${path}.${j}`, f=FX[e.k]||{};
  // 効果は「分類 → 種類」の2段で選ぶ（1つのリストだと長すぎるため。分類は rules.js の FX_GROUPS）
  const groups=fxGroups().map(([g,ks])=>[g,ks.filter(k=>fxOnlyIn(k,ctx))]).filter(([,ks])=>ks.length);
  const grp=fxGroupOf(e.k), kinds=(groups.find(([g])=>g===grp)||groups[0])[1];
  const tg=TGT_BY_CTX[ctx].includes(e.t)?TGT_BY_CTX[ctx]:[...TGT_BY_CTX[ctx],e.t];
  // 値：最大HPにできる効果（ダメージ・自傷）は「最大HP」にチェックすると値の代わりに対象の最大HP（軽減不可）
  const val=f.val?(f.maxOk?`${e.max?'':numIn(p+'.v',e.v,e.k==='multiHit'?'回数':'値')}<label class="mini chk" title="値の代わりに対象の最大HPと同じダメージにする（軽減できない）"><input type="checkbox" data-p="${p}.max" data-t="bool" data-act="structural" ${e.max?'checked':''}><span>最大HP</span></label>`
    :numIn(p+'.v',e.v,e.k==='multiHit'?'回数':'値')):'';
  if(e.k==='desc') return `<div class="eff" data-ep="${p}">
    <select class="effgrp" data-act="effGrp" data-ep="${p}" data-ctx="${ctx}" aria-label="効果の分類">${groups.map(([g,ks])=>opt(g,`${g}（${ks.length}）`,grp)).join('')}</select>
    <select data-p="${p}.k" data-act="effKind" data-ctx="${ctx}" aria-label="効果の種類">${kinds.map(k=>opt(k,FX[k].name,e.k)).join('')}</select>
    <input class="desctext" data-p="${p}.text" value="${esc(e.text||'')}" placeholder="説明文（スキル・${TERMS.ult}の説明がこの文章になります）">
    <span class="effops">
      <button data-act="effMove" data-path="${path}" data-i="${j}" data-d="-1" ${j?'':'disabled'} title="上へ">↑</button>
      <button data-act="effMove" data-path="${path}" data-i="${j}" data-d="1" ${j<n-1?'':'disabled'} title="下へ">↓</button>
      <button data-act="effDel" data-path="${path}" data-i="${j}" title="削除">×</button>
    </span>
    <div class="sub small">表示のみ・効果はありません。ほかの効果の説明の代わりに、この文章を出します。</div>
  </div>`;
  return `<div class="eff" data-ep="${p}">
    <select class="effgrp" data-act="effGrp" data-ep="${p}" data-ctx="${ctx}" aria-label="効果の分類">${groups.map(([g,ks])=>opt(g,`${g}（${ks.length}）`,grp)).join('')}</select>
    <select data-p="${p}.k" data-act="effKind" data-ctx="${ctx}" aria-label="効果の種類">${kinds.map(k=>opt(k,FX[k].name,e.k)).join('')}${kinds.includes(e.k)?'':opt(e.k,(FX[e.k]||{}).name||e.k,e.k)}</select>
    ${f.noTgt?'':`<select data-p="${p}.t" aria-label="対象">${tg.map(t=>opt(t,(ctx==='master'?mTLabel(t):TARGETS[t])||t,e.t)).join('')}</select>`}
    ${val}
    ${f.inst?'':(f.timesOnly||(ctx==='master'&&/^faces./.test(path))?'':optNum(p+'.turns',e.turns,'ターン'))+optNum(p+'.times',e.times,'回数')}
    ${FX[e.k]&&FX[e.k].color?`<label class="mini"><span>色</span><select data-p="${p}.color" data-t="optstr">${opt('','すべて',e.color||'')}${['R','B','G'].map(c=>opt(c,TERMS[c],e.color)).join('')}</select></label>`:''}
    ${f.trait?`<label class="mini"><span>属性</span><input class="traitin" list="traitlist" data-p="${p}.trait" data-t="optstr" value="${esc(e.trait||'')}" placeholder="属性名"></label>`:''}
    ${e.k in VS_KINDS?(()=>{ const bf=VS_KINDS[e.k]; return `<label class="mini"><span>${bf?'強化':'弱体'}</span><select data-p="${p}.vs" data-t="optstr">${opt('',e.k==='atkVs'?'どれでも':'すべて',e.vs||'')}${Object.keys(FX).filter(k=>FX[k].buff===bf).map(k=>opt(k,FX[k].name,e.vs)).join('')}</select></label>`; })():''}
    ${f.noTgt?'':`<label class="mini"><span>確率</span><select data-p="${p}.chance" data-t="optnum">${opt('','必ず',e.chance??'')}${[1,2,3,4,5].map(k=>opt(k,`ロール${k}以下`,e.chance)).join('')}</select></label>`}
    ${f.noTgt?'':condIn(p,e,f)}
    ${f.noTgt?'':effAtSel(p,e,atKind)}
    <span class="effops">
      <button data-act="effMove" data-path="${path}" data-i="${j}" data-d="-1" ${j?'':'disabled'} title="上へ">↑</button>
      <button data-act="effMove" data-path="${path}" data-i="${j}" data-d="1" ${j<n-1?'':'disabled'} title="下へ">↓</button>
      <button data-act="effDel" data-path="${path}" data-i="${j}" title="削除">×</button>
    </span>
    <div class="effprev">${esc(fxText(e))}</div>
    ${ctx==='master'&&/^faces\./.test(path)?`<div class="effref ${refOver(e,path)?'over':''}">${esc(refText(e,path))}</div>`:''}
  </div>`;
}
// 補助の効果に出す、マスターシートの目安（小さく）。path は faces.<面>.eff.<番号>
const refFace = path=>+path.split('.')[1];
const refText = (e,path)=>{ const m=cur(); return m?masterRefText(e,refFace(path),m.cost):''; };
const refOver = (e,path)=>{ const m=cur(), r=m&&masterRef(e,refFace(path),m.cost); return !!(r&&e.v>r.ref)||!!(m&&(masterSlot(e)||{}).c==='forbid'); };
// 3種のカードを並べたプレビュー（画像欄用）
const cardPreviewHTML=u=>`<span class="ccrow">${['R','B','G'].map(k=>cmdCardHTML(u,{c:k})).join('')}</span>`;
// 入力中は再描画せず、説明文だけ更新する（入力欄のフォーカスを保つため）
function updatePreviews(){
  const u=cur(); if(!u) return;
  document.querySelectorAll('.eff[data-ep]').forEach(el=>{ const e=getPath(u,el.dataset.ep); if(e) el.querySelector('.effprev').textContent=fxText(e); });
  if(isM()){
    document.querySelectorAll('.eff[data-ep^="faces."]').forEach(el=>{ const e=getPath(u,el.dataset.ep), r=el.querySelector('.effref'); if(e&&r){ r.textContent=refText(e,el.dataset.ep); r.classList.toggle('over',refOver(e,el.dataset.ep)); } });
    document.querySelectorAll('[data-prev="mface"]').forEach(el=>el.textContent=mFaceText(u.faces[+el.dataset.i]));
    document.querySelectorAll('[data-prev="spell"]').forEach(el=>el.textContent=effsText(u.spells[+el.dataset.i].eff,null,mTLabel));
    document.querySelectorAll('[data-fitout]').forEach(el=>{ const [k,a]=el.dataset.fitout.split('.'); el.textContent=`${u.fit[k][a]}%`; });
    document.querySelectorAll('[data-linecount]').forEach(el=>el.textContent=`${u.lines[el.dataset.linecount].length}件`);
    const ma=RULESETS.master.masterAtk, at=document.querySelector('[data-mprev="atk"]'); if(at) at.textContent=`攻撃：相手${TERMS.player}へ${u.cost*ma.master}・相手${TERMS.unit}へ${u.cost*ma.svt}（マスタールール）`;
    document.querySelectorAll('[data-imgprev]').forEach(el=>{ const key=`${u.id}|${JSON.stringify(u.fit)}`; if(el.dataset.key===key) return; el.dataset.key=key; el.innerHTML=faceImg(u,'face lg');
      const f=document.querySelector('[data-imgpath="face"]'); if(f) f.textContent=`${IMG_DIR+u.id}.${IMG_EXT}`; });
    return;
  }
  document.querySelectorAll('[data-prev="skill"]').forEach(el=>{ const s=u.skills[+el.dataset.i]; el.textContent=effsText(s.eff,s.pick); });
  document.querySelectorAll('[data-prev="ult"]').forEach(el=>el.textContent=effsText(u.ult.eff,u.ult.pick));
  if(u.ult.br>0&&u.ult.br>=[...u.ult.name].length) delete u.ult.br; // 名前を短くして改行位置が無効になったら自動に戻す
  ctUpdate();
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
      ${issBoxHTML(sel)}
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
      <div class="card prev"><div class="uhead">${faceImg(u)}<div class="uinfo"><div class="top">${clsBadge(u.cls)}<b>${esc(u.name)}</b>${traitsHTML(u)}<span class="cost">コスト${u.cost} ・ HP${u.hp}</span></div>
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
  if(isM()){ const f=u.faces[rollIdx]; return `出目<b>${rollIdx+1}</b> ・ ${f.eff.length?`<b>${esc(f.label)}</b><div class="sub small">${esc(effsText(f.eff,null,mTLabel))}</div>`:'無（何も起きない）'}`; }
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
  if(el.dataset.act==='condKind'){ // 条件の種類：なし／属性／状態／HP…
    const e=getPath(cur(),el.dataset.ep); if(!e) return;
    if(!el.value) delete e.cond;
    else { const old=e.cond&&e.cond.k===el.value?e.cond:null;
      e.cond={k:el.value, v:{trait:'',cls:CLASSES[0],fx:'*debuff',hpBelow:50,hpAbove:50,npFull:undefined,id:(units[0]||{}).id}[el.value]};
      if(e.cond.v===undefined) delete e.cond.v;
      if(old) e.cond=old; }
    return full();
  }
  if(el.dataset.act==='effGrp'){ // 分類を変えたら、その分類の最初の効果にする
    const e=getPath(cur(),el.dataset.ep), g=fxGroups().find(([n])=>n===el.value), k=g&&g[1].find(k=>fxOnlyIn(k,el.dataset.ctx));
    if(!e||!k) return;
    e.k=k; autoEff(e,el.dataset.ctx,el.dataset.ep); if(isM()&&/^faces\./.test(el.dataset.ep)) delete e.turns;
    return full();
  }
  if(!el.dataset.p) return;
  setPath(cur(),el.dataset.p,conv(el));
  if(el.dataset.act==='effKind'){ const ep=el.dataset.p.replace(/\.k$/,''), e=getPath(cur(),ep); autoEff(e,el.dataset.ctx,ep);
    if(isM()&&/^faces\./.test(el.dataset.p)) delete e.turns; // 補助の効果はそのターンだけ（ターン数は使わない）
    return full(); }
  if(el.dataset.act==='structural') return full();
  light();
});
document.addEventListener('change',e=>{
  const el=e.target;
  if(el.id==='tplsel') tplKey=el.value;
  if(el.dataset&&el.dataset.spl!==undefined&&el.value!==''){ // 汎用令呪テンプレ：名前と効果を置き換える（名前はあとで自由に変えてよい）
    const m=cur(), sp=m&&m.spells[+el.dataset.spl], t=SPELL_TPL[+el.value];
    if(sp&&t){ sp.name=t.name; sp.eff=clone(t.eff).map(normEff); full(); toast(`令呪${+el.dataset.spl+1}を「${t.name}」のテンプレに置き換えました`); }
  }
  if(el.id==='rollPost'){ rollPost=el.checked; renderSide(); }
  if(el.id==='fileOne'&&el.files[0]){ // 単体（または少数）の追加読み込み：今の一覧の末尾に足す。IDが被ったら振り直す
    const f=el.files[0], rd=new FileReader();
    rd.onload=()=>{
      try{
        const t=String(rd.result).trim(); let raw;
        try{ raw=JSON.parse(t); }
        catch(_){ const a=t.indexOf('['), b=t.lastIndexOf(']'); if(a<0||b<a) throw new Error('JSONとして読めません'); raw=JSON.parse(t.slice(a,b+1)); }
        if(!Array.isArray(raw)) raw=[raw];
        if(!raw.length||raw.some(x=>!x||typeof x!=='object')) throw new Error('データが空です');
        if(isM()&&raw.some(x=>!Array.isArray(x.spells))) throw new Error(`${TERMS.player}のデータではありません（spells がありません）`);
        if(!isM()&&raw.some(x=>!x.faces||!x.skills||!x.ult)) throw new Error(`${TERMS.unit}のデータではありません`);
        const add=raw.map(isM()?normalizeMaster:normalizeUnit), L=list(), start=L.length;
        add.forEach(x=>{ const ids=new Set([...units,...masters].map(y=>y.id)); if(!x.id||ids.has(x.id)) x.id=uniqueId(x.id); L.push(x); });
        setSel(start); rollIdx=null; full();
        toast(`${f.name} から${add.length}${isM()?'人':'体'}を追加しました（${add.map(x=>x.name).join('、')}）`);
      }
      catch(err){ toast(`読み込めませんでした：${err.message}`,true); }
      el.value='';
    };
    rd.readAsText(f);
  }
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
    case 'ack': acked.add(b.dataset.k); saveAck(); light(); break;
    case 'unack': acked.delete(b.dataset.k); saveAck(); light(); break;
    case 'tab': if(b.dataset.tab!==tab){ tab=b.dataset.tab==='masters'?'masters':'units'; rollIdx=null; try{ localStorage.setItem('pencilduel.editorTab',tab); }catch(e){} renderAll(); window.scrollTo({top:0}); } break;
    case 'sel': { // 一覧のスクロール位置は保つ（順番にキャラを見ていくときに先頭へ戻らないように）
      const ul=document.querySelector('.ulist'), lt=ul?ul.scrollTop:0;
      setSel(+b.dataset.i); rollIdx=null; renderAll(); window.scrollTo({top:0});
      const u2=document.querySelector('.ulist'); if(u2) u2.scrollTop=lt; break; }
    case 'add': { const L=list(); L.push(isM()?newMaster():newUnit()); setSel(L.length-1); rollIdx=null; full(); break; }
    case 'dup': { const L=list(), i=selIdx(), c=clone(u); c.id=uniqueId(c.id); c.name+='（コピー）'; L.splice(i+1,0,c); setSel(i+1); full(); break; }
    case 'del': if(confirm(`「${u.name||'名前なし'}」を削除しますか？`)){ const L=list(), i=selIdx(); L.splice(i,1); setSel(Math.max(0,Math.min(i,L.length-1))); rollIdx=null; full(); } break;
    case 'move': { const L=list(), i=selIdx(), j=i+Number(b.dataset.d); if(j<0||j>=L.length) break; [L[i],L[j]]=[L[j],L[i]]; setSel(j); full(); break; }
    case 'clAdd': { if(!u.condLines) u.condLines=[]; u.condLines.push({key:'attack',who:'other',cond:{k:'trait',v:'神性'},lines:[]}); full(); break; }
    case 'clDel': u.condLines.splice(+b.dataset.i,1); full(); break;
    case 'clMove': { const l=u.condLines, i=+b.dataset.i, j=i+Number(b.dataset.d); if(j<0||j>=l.length) break; [l[i],l[j]]=[l[j],l[i]]; full(); break; }
    case 'fitReset': { u.fit[b.dataset.k]={...FIT_DEF[b.dataset.k]}; full(); break; }
    case 'ctBr': { if(b.dataset.br==='') delete u.ult.br; else u.ult.br=+b.dataset.br; light(); break; }
    case 'ctReplay': ctUpdate(true); break;
    case 'effAdd': { if(!getPath(u,b.dataset.path)) setPath(u,b.dataset.path,[]); getPath(u,b.dataset.path).push(newEff(b.dataset.ctx,b.dataset.path)); full(); break; }
    case 'effDel': getPath(u,b.dataset.path).splice(+b.dataset.i,1); full(); break;
    case 'effMove': { const l=getPath(u,b.dataset.path), i=+b.dataset.i, j=i+Number(b.dataset.d); [l[i],l[j]]=[l[j],l[i]]; full(); break; }
    case 'applyTpl': {
      if(!confirm(`コスト${u.cost}・${tplKey} のテンプレで、HPと鉛筆の6面を置き換えますか？`)) break;
      const err=applyCardTpl(u); if(err){ toast(err,true); break; }
      full(); toast(`${tplKey}（コスト${u.cost}）のテンプレを適用しました`); break; }
    case 'applyMTpl': {
      if(!confirm(`コスト${u.cost}のテンプレで、HPと補助の6面を置き換えますか？`)) break;
      const t=masterTpl(u.cost); u.hp=t.hp; u.faces=t.faces.map((f,i)=>({...f,...(u.faces[i]&&u.faces[i].line?{line:u.faces[i].line}:{})}));
      full(); toast(`コスト${u.cost}のテンプレを適用しました`); break; }
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
    case 'exportJS': { const wn=list().filter(x=>x.wip).length, ex=wn?`（制作中の${wn}${isM()?'人':'体'}は除外）`:'';
      if(isM()){ downloadText('masters.js',mastersToJS(masters),'text/javascript'); toast('js/masters.js と置き換えると、標準データとして公開できます'+ex); break; }
      downloadText('units.js',unitsToJS(units),'text/javascript'); toast('js/units.js と置き換えると、標準データとして公開できます'+ex); break; }
    case 'exportJSON': if(isM()){ downloadText('pencil-masters.json',JSON.stringify(masters,null,2),'application/json'); break; }
      downloadText('pencil-units.json',JSON.stringify(units,null,2),'application/json'); break;
    case 'import': document.querySelector('#file').click(); break;
    case 'exportOne': if(u){ const base=(u.id||'unit').replace(/[^A-Za-z0-9_-]/g,'')||'unit';
      downloadText(`pencil-${isM()?'master':'unit'}-${base}.json`,JSON.stringify(u,null,2),'application/json'); toast(`「${u.name||u.id}」を書き出しました`); } break;
    case 'importOne': document.querySelector('#fileOne').click(); break;
    case 'resetDefault':
      if(isM()){ if(confirm(`編集中の${TERMS.player}を標準データ（js/masters.js）に戻しますか？ 今の編集内容は消えます。`)){ masters=(typeof DEFAULT_MASTERS!=='undefined'?DEFAULT_MASTERS:[]).map(normalizeMaster); msel=0; rollIdx=null; full(); toast('標準データに戻しました'); } break; }
      if(confirm('編集中のデータを標準データ（js/units.js）に戻しますか？ 今の編集内容は消えます。')){ units=normalizeUnits(DEFAULT_UNITS); sel=0; rollIdx=null; full(); toast('標準データに戻しました'); }
      break;
  }
});
// ゲーム側や別タブで反映状態が変わったら表示を更新
window.addEventListener('storage',e=>{ if(e.key===STORE.units||e.key===STORE.masters) renderStatus(); });

boot();
