'use strict';
/* =====================================================================
   共通処理：データの読み込み・保存・検証・書き出し、表示用の文字列
   ゲームとペンシルエディタの両方が読み込みます
   ===================================================================== */

const STORE = { units:'pencilduel.units', draft:'pencilduel.editorDraft' };

const esc = s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = v=>JSON.parse(JSON.stringify(v));
function readJSON(key){ try{ const s=localStorage.getItem(key); return s?JSON.parse(s):null; }catch(e){ return null; } }
function writeJSON(key,v){ try{ localStorage.setItem(key,JSON.stringify(v)); return true; }catch(e){ return false; } }
function removeKey(key){ try{ localStorage.removeItem(key); }catch(e){} }

// ---------- 正規化（読み込んだデータの形をそろえる） ----------
const num = (v,d=0)=>Number.isFinite(+v)&&v!==''&&v!=null ? +v : d;
function normEff(e){
  e=e||{};
  const o={k:String(e.k||'atk'), t:String(e.t||'self'), v:num(e.v)};
  for(const k of ['turns','times','chance']) if(num(e[k])>0) o[k]=num(e[k]);
  if(['R','B','G'].includes(e.color)) o.color=e.color;
  return o;
}
function normCmd(c){
  c=c||{};
  if(c.c==='ASC') return {c:'ASC'};
  if(c.c==='W') return {c:'W', label:String(c.label||''), eff:(c.eff||[]).map(normEff), np:num(c.np), star:num(c.star)};
  return {c:String(c.c||'R'), dmg:num(c.dmg), np:num(c.np), star:num(c.star)};
}
function normClass(c){ c=String(c||'').trim(); return CLASS_LEGACY[c]||c; }
function normalizeUnit(u){
  u=u||{};
  const faces=Array.from({length:6},(_,i)=>{ const f=(u.faces||[])[i]||{}; return {acts:num(f.acts,1), pre:normCmd(f.pre), post:normCmd(f.post||f.pre)}; });
  const skills=Array.from({length:3},(_,i)=>{ const s=(u.skills||[])[i]||{};
    const o={name:String(s.name||''), eff:(s.eff||[]).map(normEff)}; if(['ally','enemy','any'].includes(s.pick)) o.pick=s.pick; return o; });
  const ult=u.ult||{}, im=u.img||{};
  const img=Object.fromEntries(Object.keys(IMG_KEYS).map(k=>[k,String(im[k]||'')]));
  const ln=u.lines||{};
  const lines=Object.fromEntries(Object.keys(LINE_KEYS).map(k=>[k,(Array.isArray(ln[k])?ln[k]:[ln[k]]).map(x=>String(x??'').trim()).filter(Boolean)]));
  return { id:String(u.id||''), name:String(u.name||''), cls:normClass(u.cls), cost:num(u.cost), hp:num(u.hp,100),
    img, lines, faces, skills, ult:{name:String(ult.name||''), c:String(ult.c||'R'), eff:(ult.eff||[]).map(normEff)} };
}
function normalizeUnits(raw){
  if(!Array.isArray(raw)) throw new Error('サーヴァントデータは配列である必要があります');
  return raw.map(normalizeUnit);
}

// ---------- 検証 ----------
// 戻り値: [{i: ユニット番号(全体なら-1), level:'error'|'warn', msg}]
function validateUnits(units){
  const issues=[], ids=new Map();
  if(!units.length) issues.push({i:-1,level:'error',msg:`${TERMS.unit}が1体もありません`});
  units.forEach((u,i)=>{
    const add=(level,msg)=>issues.push({i,level,msg});
    if(!/^[A-Za-z0-9_-]+$/.test(u.id)) add('error','IDは半角英数字・_・- で入力してください');
    else if(ids.has(u.id)) add('error',`ID「${u.id}」が他の${TERMS.unit}と重複しています`);
    else ids.set(u.id,i);
    if(!u.name.trim()) add('error','名前が空です');
    if(!u.cls.trim()) add('warn','クラスが空です');
    const noLine=Object.keys(LINE_KEYS).filter(k=>!u.lines[k].length);
    if(noLine.length) add('warn',`セリフ未設定：${noLine.map(k=>LINE_KEYS[k]).join('・')}`);
    for(const [k,n] of Object.entries(LINE_MIN)) if(u.lines[k].length && u.lines[k].length<n) add('warn',`${LINE_KEYS[k]}のセリフは${n}種類以上にしてください（今は${u.lines[k].length}種類）`);
    if(!(u.hp>0)) add('error','HPは1以上にしてください');
    if(!(u.cost>=0)) add('error','コストは0以上にしてください');
    if(u.cost>RULES.costCap) add('error',`コストが上限${RULES.costCap}を超えているため編成できません`);

    const ascN=u.faces.filter(f=>f.pre.c==='ASC').length;
    if(!ascN) add('warn',`${TERMS.asc}面がないため、スキル3が使えません`);
    if(ascN>1) add('warn',`${TERMS.asc}面が${ascN}つあります`);
    u.faces.forEach((f,fi)=>{
      if(!RULES.actsTable&&![1,2,3].includes(f.acts)) add('error',`出目${fi+1}：行動回数は1〜3にしてください`);
      if(f.post.c==='ASC') add('error',`出目${fi+1}：${TERMS.asc}後のコマンドに${TERMS.asc}面は置けません`);
      [['pre',`${TERMS.asc}前`],['post',`${TERMS.asc}後`]].forEach(([k,lab])=>{
        const c=f[k], where=`出目${fi+1}・${lab}`;
        if(!CMD_TYPES.includes(c.c)) add('error',`${where}：コマンドの種類が不正です`);
        if(['R','B','G'].includes(c.c) && !(c.dmg>0)) add('warn',`${where}：ダメージが0です`);
        if(c.c==='W'){
          if(!c.label.trim()) add('warn',`${where}：特殊行動の名前が空です`);
          if(!c.eff.length) add('warn',`${where}：特殊行動に効果がありません`);
          checkEffs(c.eff,'special',where,add);
        }
      });
    });
    u.skills.forEach((s,si)=>{
      const where=`スキル${si+1}`;
      if(!s.name.trim()) add('warn',`${where}：名前が空です`);
      if(!s.eff.length) add('warn',`${where}：効果がありません`);
      const usesPicked=s.eff.some(e=>e.t==='picked');
      if(usesPicked&&!s.pick) add('error',`${where}：「${TARGETS.picked}」を使うには、対象の選び方を設定してください`);
      if(s.pick&&!usesPicked) add('warn',`${where}：対象を選びますが、「${TARGETS.picked}」への効果がありません`);
      checkEffs(s.eff,'skill',where,add);
    });
    if(!['R','B','G'].includes(u.ult.c)) add('error',`${TERMS.ult}：色はR/B/Gのどれかにしてください`);
    if(!u.ult.name.trim()) add('warn',`${TERMS.ult}：名前が空です`);
    if(!u.ult.eff.length) add('warn',`${TERMS.ult}：効果がありません`);
    checkEffs(u.ult.eff,'ult',TERMS.ult,add);
  });
  return issues;
}
function checkEffs(effs,ctx,where,add){
  effs.forEach((e,ei)=>{
    const w=`${where}・効果${ei+1}`;
    if(!FX[e.k]) return add('error',`${w}：効果の種類が不正です`);
    if(e.k==='dmg'&&ctx!=='ult') add('error',`${w}：ダメージ効果は${TERMS.ult}でのみ使えます`);
    if(!TGT_BY_CTX[ctx].includes(e.t)) add('error',`${w}：ここでは「${TARGETS[e.t]||e.t}」を対象にできません`);
    if(e.t==='master'&&e.k!=='star') add('warn',`${w}：${TERMS.player}が対象だと、${TERMS.star}獲得以外は効果がありません`);
    if(FX[e.k].val&&e.v===0) add('warn',`${w}：値が0です`);
    if(!FX[e.k].inst&&e.turns==null&&e.times==null) add('warn',`${w}：効果時間がないため、ずっと続きます`);
    if(FX[e.k].timesOnly&&e.turns!=null) add('warn',`${w}：${FX[e.k].name}は回数で指定します（ターンは使われません）`);
    if(e.k==='instantDeath'&&['self','ally_all'].includes(e.t)) add('warn',`${w}：味方に即死効果がかかります`);
    if(e.chance&&e.chance>=6) add('warn',`${w}：ロール6以下は必ず成功します`);
  });
}
const hasErrors = units=>validateUnits(units).some(x=>x.level==='error');

// ---------- 読み込み・保存 ----------
// エディタで「ゲームに反映」したデータがあればそれを、なければ標準データ（units.js）を使う
function loadUnits(){
  const raw=readJSON(STORE.units);
  if(raw){
    try{ const u=normalizeUnits(raw); if(!hasErrors(u)) return {units:u, source:'custom'}; }catch(e){}
    return {units:normalizeUnits(DEFAULT_UNITS), source:'default', broken:true};
  }
  return {units:normalizeUnits(DEFAULT_UNITS), source:'default'};
}
const saveCustomUnits = units=>writeJSON(STORE.units,units);
const clearCustomUnits = ()=>removeKey(STORE.units);

// ---------- 書き出し・読み込み（ファイル） ----------
// units.js 形式：中身はJSONなので、そのまま読み込み直せる
function unitsToJS(units){
  const j=v=>JSON.stringify(v);
  const body=units.map(u=>[
    '  {',
    `    "id":${j(u.id)}, "name":${j(u.name)}, "cls":${j(u.cls)}, "cost":${u.cost}, "hp":${u.hp},`,
    `    "img":${j(u.img)},`,
    '    "lines":{',
    Object.keys(LINE_KEYS).map(k=>`      ${j(k)}:${j(u.lines[k])}`).join(',\n'),
    '    },',
    '    "faces":[',
    u.faces.map(f=>`      ${j(f)}`).join(',\n'),
    '    ],',
    '    "skills":[',
    u.skills.map(s=>`      ${j(s)}`).join(',\n'),
    '    ],',
    `    "ult":${j(u.ult)}`,
    '  }'].join('\n')).join(',\n');
  return `'use strict';
// ${TERMS.unit}データ（ペンシルエディタで書き出し）
// img: キャラクター画像(face)・カード用キャラ画像(card、空欄ならfaceを使う) のパス
// lines: 場面ごとのセリフ
// faces: 出目1〜6の面 / acts: 行動回数 / pre・post: ${TERMS.asc}前・後のコマンド
// c: R=${TERMS.R} B=${TERMS.B} G=${TERMS.G} W=${TERMS.W} ASC=${TERMS.asc}
const DEFAULT_UNITS = [
${body}
];
`;
}
function parseUnitsFile(text){
  const t=text.trim();
  if(t.startsWith('[')) return normalizeUnits(JSON.parse(t));
  const a=t.indexOf('['), b=t.lastIndexOf(']');
  if(a<0||b<a) throw new Error('サーヴァントの配列が見つかりません');
  return normalizeUnits(JSON.parse(t.slice(a,b+1)));
}
function downloadText(name,text,type='text/plain'){
  const url=URL.createObjectURL(new Blob([text],{type:type+';charset=utf-8'}));
  const a=document.createElement('a'); a.href=url; a.download=name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

// ランダムにセリフを1つ（なければ空文字）
function pickLine(d,key){ const a=(d&&d.lines&&d.lines[key])||[]; return a.length?a[Math.floor(Math.random()*a.length)]:''; }

// ---------- 画像 ----------
// クラス表示（アイコン＋名前）。iconOnly ならアイコンだけ
function clsIconTag(cls,cls2='clsicon'){ return imgTag(classIcon(cls),CLASS_ICON_EXTRA,cls2,cls); }
function clsBadge(cls,iconOnly){ return `<span class="cls${iconOnly?' only':''}" title="${esc(cls)}">${clsIconTag(cls)}${iconOnly?'':`<span>${esc(cls)}</span>`}</span>`; }
// d: サーヴァント定義 / k: 'face' | 'card'（card が空欄なら face を使う）
function imgSrc(d,k){
  const im=(d&&d.img)||{};
  // キャラクター画像も仮画像のままなら、カードには背景透過の仮画像を使う
  if(k==='card') return im.card || (im.face&&im.face!==IMG_PLACEHOLDER.face ? im.face : IMG_PLACEHOLDER.card);
  return im[k]||IMG_PLACEHOLDER[k]||'';
}
const imgTag=(src,fallback,cls,alt='')=>`<img class="${cls}" src="${esc(src)}" alt="${esc(alt)}" loading="lazy" onerror="this.onerror=null;this.src='${esc(fallback)}'">`;
function faceImg(d,cls='face'){ return `<span class="${cls}">${imgTag(imgSrc(d,'face'),IMG_PLACEHOLDER.face,'',d?d.name:'')}</span>`; }
// コマンドカードの共通素材（rules.js の CARD_LAYERS）。宝具は bg が空なら宝具の色の bg を借りる
function cardLayers(kind,col){
  const L=CARD_LAYERS[kind]||{}, base=CARD_LAYERS[col]||{};
  return { bg:L.bg||(kind==='ULT'?base.bg:'')||'', frame:L.frame||'' };
}
// コマンドカード
//   Buster/Arts/Quick・宝具：背景(共通) → キャラ画像(サーヴァントごと) → 枠と種別名(共通) の3層
//   特殊・覚醒：文字だけのカード
function cmdCardHTML(d,c,opt={}){
  if(!c) return '';
  const sz=opt.small?' sm':'';
  const isUlt=c.c==='ULT';
  if(isUlt||['R','B','G'].includes(c.c)){
    const col=isUlt?(c.col||'R'):c.c, L=cardLayers(isUlt?'ULT':col,col);
    const label=isUlt?TERMS.ult:TERMS[col];
    const ex=[c.np?`${TERMS.gauge}+${c.np}`:'', c.star?`★${c.star}`:''].filter(Boolean).join(' ');
    return `<div class="ccard ${col}${isUlt?' ULT':''}${L.frame?' hasframe':''}${sz}" title="${esc(label)}${c.dmg!=null?` ${c.dmg}`:''}">
      ${L.bg?`<img class="cc-bg" src="${esc(L.bg)}" alt="">`:''}
      ${imgTag(imgSrc(d,'card'),IMG_PLACEHOLDER.card,'ccimg',d?d.name:'')}
      ${L.frame?`<img class="cc-frame" src="${esc(L.frame)}" alt="${esc(label)}">`:`<span class="ccname">${label}</span>`}
      ${d?clsIconTag(d.cls,'ccicon'):''}
      ${c.dmg!=null?`<span class="ccdmg">${c.dmg}</span>`:''}${ex&&!opt.small?`<span class="ccex">${ex}</span>`:''}</div>`;
  }
  const label=c.c==='ASC'?TERMS.asc:(c.label||TERMS.W);
  return `<div class="ccard ${esc(c.c)} plain${sz}"><span class="ccname">${esc(label)}</span></div>`;
}

// ---------- 表示用の文字列 ----------
function fxText(e){
  const col=e.color?`(${TERMS[e.color]})`:'';
  let s;
  switch(e.k){
    case 'atk': s=`攻撃ダメージ+${e.v}${col}`; break;
    case 'atkDown': s=`攻撃ダメージ-${e.v}`; break;
    case 'def': s=`被ダメージ-${e.v}`; break;
    case 'defDown': s=`被ダメージ+${e.v}`; break;
    case 'critPow': s=`クリティカル威力+${e.v}`; break;
    case 'guts': s=`ガッツ(HP${e.v})`; break;
    case 'critRoll': s=`クリティカルロール-${e.v}(Lv+${e.v})`; break;
    case 'poison': s=`毒${e.v||RULES.dot}`; break;
    case 'burn': s=`やけど${e.v||RULES.dot}`; break;
    case 'starLoss': s=`${TERMS.star}${e.v}個消失`; break;
    case 'heal': s=`HP${e.v}回復`; break;
    case 'np': s=`${TERMS.gauge}${e.v>=0?'+':''}${e.v}%`; break;
    case 'star': s=`${TERMS.star}${e.v}個獲得`; break;
    case 'dmg': s=`${e.v}ダメージ`; break;
    default: s=FX[e.k]?FX[e.k].name:e.k;
  }
  const dur=[e.times!=null?`${e.times}回`:'', e.turns!=null?`${e.turns}T`:''].filter(Boolean).join('・');
  return s+(dur?`(${dur})`:'')+(e.chance?`［ロール${e.chance}以下］`:'');
}
function tLabel(t,pick){
  if(t==='picked') return PICKS[pick]&&pick ? PICKS[pick] : TARGETS.picked;
  return TARGETS[t]||t;
}
const effsText=(effs,pick)=>effs.length?effs.map(e=>`${tLabel(e.t,pick)}：${fxText(e)}`).join(' ／ '):'効果なし';
function cmdChip(c){
  if(!c) return '';
  if(c.c==='ASC') return `<span class="cmd ASC">${TERMS.asc}</span>`;
  if(c.c==='W') return `<span class="cmd W">${esc(c.label||TERMS.W)}</span>`;
  const ex=[c.np?`${TERMS.gauge}+${c.np}`:'', c.star?`★${c.star}`:''].filter(Boolean).join(' ');
  return `<span class="cmd ${esc(c.c)}">${TERMS[c.c]||esc(c.c)} ${c.dmg}${ex?` <small>${ex}</small>`:''}</span>`;
}
function facesTableHTML(d){
  const cell=c=>cmdChip(c)+(c.c==='W'?`<div class="sub">${esc(effsText(c.eff))}</div>`:'');
  return `<table class="faces"><tr><th>出目</th><th>行動</th><th>${TERMS.asc}前</th><th>${TERMS.asc}後</th></tr>
    ${d.faces.map((f,i)=>`<tr><td>${i+1}</td><td>${faceActs(d,i)}</td><td>${cell(f.pre)}</td><td>${cell(f.post)}</td></tr>`).join('')}</table>`;
}
// 操作できないスキル一覧（編成画面・エディタのプレビュー用）
function skillListHTML(d){
  const rows=d.skills.map((s,i)=>`<div class="skill"><span class="sname">S${i+1} ${i===2?'🔒':''}${esc(s.name)}</span><span class="desc">${esc(effsText(s.eff,s.pick))}${i===2?`（${TERMS.asc}後に使用可）`:''}</span></div>`).join('');
  const ult=`<div class="skill ult"><span class="sname">${TERMS.ult}「${esc(d.ult.name)}」</span><span class="desc">[${TERMS[d.ult.c]||esc(d.ult.c)}] ${esc(effsText(d.ult.eff))}</span></div>`;
  return `<div class="skills">${rows}${ult}</div>`;
}
