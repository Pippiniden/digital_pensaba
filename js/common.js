'use strict';
/* =====================================================================
   共通処理：データの読み込み・保存・検証・書き出し、表示用の文字列
   ゲームとペンシルエディタの両方が読み込みます
   ===================================================================== */

const STORE = { units:'pencilduel.units', draft:'pencilduel.editorDraft', masters:'pencilduel.masters', mdraft:'pencilduel.masterDraft' };

const esc = s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = v=>JSON.parse(JSON.stringify(v));
function readJSON(key){ try{ const s=localStorage.getItem(key); return s?JSON.parse(s):null; }catch(e){ return null; } }
function writeJSON(key,v){ try{ localStorage.setItem(key,JSON.stringify(v)); return true; }catch(e){ return false; } }
function removeKey(key){ try{ localStorage.removeItem(key); }catch(e){} }

// ---------- 正規化（読み込んだデータの形をそろえる） ----------
const num = (v,d=0)=>Number.isFinite(+v)&&v!==''&&v!=null ? +v : d;
// セリフ・属性の配列（文字列1つでも可）。空白だけのものは捨てる
const strList = v=>(Array.isArray(v)?v:v==null?[]:[v]).map(x=>String(x??'').trim()).filter(Boolean);
// 属性：重複を除いた配列
const normTraits = v=>[...new Set(strList(v))];
// 条件（cond）：{k:COND_KINDS のキー, v:値, not?:true}。不正なら null
function normCond(c){
  if(!c||!COND_KINDS[c.k]) return null;
  const o={k:c.k};
  if(c.k==='trait'||c.k==='cls'){ const v=String(c.v??'').trim(); if(!v) return null; o.v=v; }
  else if(c.k==='fx'){ const v=String(c.v??''); o.v=(v==='*debuff'||v==='*buff'||(FX[v]&&!FX[v].inst&&!FX[v].noTgt))?v:'*debuff'; }
  else if(c.k==='id'){ const v=String(c.v??'').trim(); if(!v) return null; o.v=v; }
  else if(c.k==='hpBelow'||c.k==='hpAbove') o.v=Math.min(100,Math.max(1,Math.round(num(c.v,50))||50));
  if(c.not) o.not=true;
  return o;
}
// 条件の説明文。use＝使う瞬間に見る効果（相手＝攻撃・防御の相手）／それ以外は「対象」
function condText(c,use){
  if(!c) return '';
  const s=use?'相手':'対象';
  const who=c.k==='id'?((typeof D==='function'&&D(c.v))||{}).name||c.v:'';
  const b={ trait:`${s}が〔${c.v}〕属性`, cls:`${s}が${c.v}`, id:`${s}が${who}`,
    fx:c.v==='*debuff'?`${s}が弱体状態`:c.v==='*buff'?`${s}が強化状態`:`${s}が${(FX[c.v]||{}).name||c.v}状態`,
    hpBelow:`${s}のHPが${c.v}%以下`, hpAbove:`${s}のHPが${c.v}%以上`, npFull:`${s}の${TERMS.gauge}が100%` }[c.k];
  return b?`${b}${c.not?'でないとき':'のとき'}`:'';
}
function normEff(e){
  e=e||{};
  const o={k:String(e.k||'atk'), t:String(e.t||'self'), v:num(e.v)};
  for(const k of ['turns','times','chance']) if(num(e[k])>0) o[k]=num(e[k]);
  if(['R','B','G'].includes(e.color)) o.color=e.color;
  // vs：弱体状態特攻の対象の弱体 / 弱体無効＝防ぐ弱体の種類 / 強化無効＝防ぐ強化の種類（未指定＝すべて）
  if(e.vs&&vsOk(String(e.k),e.vs)) o.vs=String(e.vs);
  const tr=String(e.trait??'').trim(); if(tr) o.trait=tr; // 属性特攻・特防の対象の属性
  const cd=normCond(e.cond); if(cd&&!(FX[o.k]&&FX[o.k].noTgt)) o.cond=cd; // 条件つき効果
  if(EFF_AT[e.at]) o.at=e.at; // 攻撃の前/後（未指定なら既定のタイミング。rules.js の EFF_AT）
  if(e.max&&FX[o.k]&&FX[o.k].maxOk) o.max=true; // 値＝対象の最大HP（軽減不可）
  const tx=String(e.text??'').trim(); if(tx&&o.k==='desc') o.text=tx; // 説明文
  return o;
}
function normCmd(c){
  c=c||{};
  const ln=strList(c.line), withLine=o=>(ln.length?Object.assign(o,{line:ln}):o); // この面の専用セリフ（任意）
  if(c.c==='ASC') return withLine({c:'ASC'});
  if(c.c==='W') return withLine({c:'W', label:String(c.label||''), eff:(c.eff||[]).map(normEff), dmg:num(c.dmg), np:num(c.np), star:num(c.star)});
  const o={c:String(c.c||'R'), dmg:num(c.dmg), np:num(c.np), star:num(c.star)};
  if(c.eff&&c.eff.length) o.eff=c.eff.map(normEff); // 通常コマンドの付加効果（任意）
  return withLine(o);
}
function normClass(c){ c=String(c||'').trim(); return CLASS_LEGACY[c]||c; }
// 画像の見せ方（はみ出し調整）。x,y = 表示位置(%) / z = 拡大率(%)。既定値のままなら書き出さない
// np = 宝具カットインで帯に透ける顔アップ（x,y = 立ち絵のどこを見せるか(%) / z = 立ち絵の幅(%)。縮小もできるので 60〜）
const FIT_DEF={ face:{x:50,y:18,z:100}, card:{x:50,y:12,z:100}, np:{x:50,y:14,z:105} };
const FIT_RANGE={ x:[0,100], y:[0,100], z:[100,300] };
const FIT_RANGE_K={ np:{ z:[60,300] } };
const fitRange=(k,a)=>(FIT_RANGE_K[k]||{})[a]||FIT_RANGE[a];
function normFit(f){
  f=f||{};
  const one=k=>Object.fromEntries(['x','y','z'].map(a=>{ const v=Number(((f[k]||{})[a])); const [lo,hi]=fitRange(k,a);
    return [a, Number.isFinite(v)?Math.min(hi,Math.max(lo,Math.round(v))):FIT_DEF[k][a]]; }));
  return { face:one('face'), card:one('card'), np:one('np') };
}
const fitIsDef=(f,k)=>!f||!f[k]||['x','y','z'].every(a=>f[k][a]===FIT_DEF[k][a]);
function fitStyle(d,k){
  const f=d&&d.fit; if(fitIsDef(f,k)) return '';
  const {x,y,z}=f[k];
  return `object-position:${x}% ${y}%;transform-origin:${x}% ${y}%;scale:${z/100}`;
}
function normalizeUnit(u){
  u=u||{};
  const faces=Array.from({length:6},(_,i)=>{ const f=(u.faces||[])[i]||{}; return {acts:num(f.acts,1), pre:normCmd(f.pre), post:normCmd(f.post||f.pre)}; });
  const skills=Array.from({length:3},(_,i)=>{ const s=(u.skills||[])[i]||{};
    const o={name:String(s.name||''), eff:(s.eff||[]).map(normEff)}; const rk=String(s.rank||'').trim(); if(rk) o.rank=rk; if(PICKS[s.pick]&&s.pick) o.pick=s.pick;
    const ln=strList(s.line); if(ln.length) o.line=ln; // このスキルの専用セリフ（任意）
    return o; });
  const ult=u.ult||{};
  const ln=u.lines||{};
  const lines=Object.fromEntries(Object.keys(LINE_KEYS).map(k=>[k,strList(ln[k])]));
  const condLines=(Array.isArray(u.condLines)?u.condLines:[]).map(normCondLine).filter(Boolean);
  return { id:String(u.id||''), name:String(u.name||''), cls:normClass(u.cls), traits:normTraits(u.traits), cost:num(u.cost), hp:num(u.hp,100),
    fit:normFit(u.fit), ...(normLink(u.link)?{link:normLink(u.link)}:{}), lines, ...(condLines.length?{condLines}:{}), faces, skills, ult:Object.assign({name:String(ult.name||''), c:String(ult.c||'R'), eff:(ult.eff||[]).map(normEff)}, String(ult.ruby||'').trim()?{ruby:String(ult.ruby).trim()}:{}, Number.isInteger(ult.br)&&ult.br>=0?{br:ult.br}:{}, PICKS[ult.pick]&&ult.pick?{pick:ult.pick}:{}) };
}
// 条件つきセリフ：{key:LINE_KEYS のキー, who:LINE_WHO のキー, cond:Cond, lines:string[]}。上にあるものから順に見て、最初に条件を満たしたものを使う。不正なら null
function normCondLine(c){
  c=c||{};
  const cond=normCond(c.cond), lines=strList(c.lines);
  if(!LINE_KEYS[c.key]||!cond||!lines.length) return null;
  return { key:c.key, who:LINE_WHO[c.who]?c.who:'other', cond, lines };
}
// キャラクター設定へのリンク：http(s) のURLだけ受け付ける（それ以外は空）
function normLink(v){ const s=String(v||'').trim(); return /^https?:\/\/\S+$/i.test(s)?s:''; }
// 宝具名（ルビがあれば <ruby> で表示）／スキルランク
function ultNameHTML(ult){ return ult.ruby?`<ruby>${esc(ult.name)}<rt>${esc(ult.ruby)}</rt></ruby>`:esc(ult.name); }
function skillNameHTML(s){ return esc(s.name)+(s.rank?` <small class="srank">${esc(s.rank)}</small>`:''); }
function normalizeUnits(raw){
  if(!Array.isArray(raw)) throw new Error('サーヴァントデータは配列である必要があります');
  return raw.map(normalizeUnit);
}

// ---------- 検証 ----------
// 戻り値: [{i: ユニット番号(全体なら-1), level:'error'|'warn'|'line', msg}]（line＝セリフ未設定・不足。警告とは別に数える）
function validateUnits(units){
  const issues=[], ids=new Map();
  if(!units.length) issues.push({i:-1,level:'error',msg:`${TERMS.unit}が1体もありません`});
  const allTraits=new Set(units.flatMap(u=>u.traits||[]));
  units.forEach((u,i)=>{
    const add=(level,msg)=>issues.push({i,level,msg});
    traitUseCheck(u.faces.flatMap(f=>[...(f.pre.eff||[]),...(f.post.eff||[])]).concat(...u.skills.map(s=>s.eff),u.ult.eff),allTraits,add);
    if(!/^[A-Za-z0-9_-]+$/.test(u.id)) add('error','IDは半角英数字・_・- で入力してください');
    else if(ids.has(u.id)) add('error',`ID「${u.id}」が他の${TERMS.unit}と重複しています`);
    else ids.set(u.id,i);
    if(!u.name.trim()) add('error','名前が空です');
    if(u.link&&!normLink(u.link)) add('warn','キャラクター設定のリンクは http:// か https:// で始まるURLにしてください（読み込み時に無視されます）');
    if(!u.cls.trim()) add('warn','クラスが空です');
    const noLine=Object.keys(LINE_KEYS).filter(k=>!u.lines[k].length);
    if(noLine.length) add('line',`セリフ未設定：${noLine.map(k=>LINE_KEYS[k]).join('・')}`);
    for(const [k,n] of Object.entries(LINE_MIN)) if(u.lines[k].length && u.lines[k].length<n) add('line',`${LINE_KEYS[k]}のセリフは${n}種類以上にしてください（今は${u.lines[k].length}種類）`);
    if(!(u.hp>0)) add('error','HPは1以上にしてください');
    if(!(u.cost>=0)) add('error','コストは0以上にしてください');
    if(u.cost>RULES.costCap) add('error',`コストが上限${RULES.costCap}を超えているため編成できません`);

    const ascN=u.faces.filter(f=>f.pre.c==='ASC').length;
    if(!ascN&&u.skills[2]&&u.skills[2].eff.length) add('warn',`${TERMS.asc}面がないため、スキル3が使えません`);
    if(ascN>1) add('warn',`${TERMS.asc}面が${ascN}つあります`);
    u.faces.forEach((f,fi)=>{
      if(!RULES.actsTable&&![1,2,3].includes(f.acts)) add('error',`出目${fi+1}：行動回数は1〜3にしてください`);
      if(f.post.c==='ASC') add('error',`出目${fi+1}：${TERMS.asc}後のコマンドに${TERMS.asc}面は置けません`);
      [['pre',`${TERMS.asc}前`],['post',`${TERMS.asc}後`]].forEach(([k,lab])=>{
        const c=f[k], where=`出目${fi+1}・${lab}`;
        if(!CMD_TYPES.includes(c.c)) add('error',`${where}：コマンドの種類が不正です`);
        if(['R','B','G'].includes(c.c) && !(c.dmg>0)) add('warn',`${where}：ダメージが0です`);
        if(['R','B','G'].includes(c.c) && c.eff) checkEffs(c.eff,'special',where,add);
        if(c.c==='W'){
          if(!c.label.trim()) add('warn',`${where}：特殊行動の名前が空です`);
          if(!c.eff.length&&!(c.dmg>0)) add('warn',`${where}：特殊行動に効果もダメージもありません`);
          if(c.eff.some(e=>e.k==='copyRoll')&&(c.dmg>0||c.eff.length>1)) add('warn',`${where}：「${FX.copyRoll.name}」があるときは、ダメージやほかの効果は使われません`);
          checkEffs(c.eff,'special',where,add);
        }
      });
    });
    u.skills.forEach((s,si)=>{
      const where=`スキル${si+1}`;
      if(si===2&&!ascN&&!s.eff.length) return; // 霊基再臨しないサーヴァントのスキル3は空でよい
      if(!s.name.trim()) add('warn',`${where}：名前が空です`);
      if(!s.eff.length) add('warn',`${where}：効果がありません`);
      const usesPicked=s.eff.some(e=>e.t==='picked');
      if(usesPicked&&!s.pick) add('error',`${where}：「${TARGETS.picked}」を使うには、対象の選び方を設定してください`);
      if(s.pick&&!usesPicked) add('warn',`${where}：対象を選びますが、「${TARGETS.picked}」への効果がありません`);
      checkEffs(s.eff,'skill',where,add);
    });
    if(!['R','B','G'].includes(u.ult.c)) add('error',`${TERMS.ult}：色はR/B/Gのどれかにしてください`);
    if(!u.ult.name.trim()) add('warn',`${TERMS.ult}：名前が空です`);
    if(u.ult.br>0&&u.ult.br>=[...u.ult.name].length) add('warn',`${TERMS.ult}：カットインの改行位置が名前の長さを超えています（自動で表示します）`);
    if(!u.ult.eff.length) add('warn',`${TERMS.ult}：効果がありません`);
    const uPicked=u.ult.eff.some(e=>e.t==='picked');
    if(uPicked&&!u.ult.pick) add('error',`${TERMS.ult}：「${TARGETS.picked}」を使うには、対象の選び方を設定してください`);
    if(u.ult.pick&&!uPicked) add('warn',`${TERMS.ult}：対象を選びますが、「${TARGETS.picked}」への効果がありません`);
    checkEffs(u.ult.eff,'ult',TERMS.ult,add);
  });
  return issues;
}
// 特攻・特防の属性を、どのサーヴァントも持っていなければ注意
function traitUseCheck(effs,allTraits,add){
  const miss=[...new Set([
    ...effs.filter(e=>FX[e.k]&&FX[e.k].trait&&e.trait&&!allTraits.has(e.trait)).map(e=>e.trait),
    ...effs.filter(e=>e.cond&&e.cond.k==='trait'&&e.cond.v&&!allTraits.has(e.cond.v)).map(e=>e.cond.v)])];
  if(miss.length) add('warn',`属性「${miss.join('」「')}」を持つ${TERMS.unit}がいません（特攻・特防が発動しません）`);
}
function checkEffs(effs,ctx,where,add){
  effs.forEach((e,ei)=>{
    const w=`${where}・効果${ei+1}`;
    if(!FX[e.k]) return add('error',`${w}：効果の種類が不正です`);
    if(!fxOnlyIn(e.k,ctx)) add('error',`${w}：「${FX[e.k].name}」は${[].concat(FX[e.k].only).map(c=>({ult:TERMS.ult,special:'特殊行動',master:TERMS.player}[c])).join('・')}でのみ使えます`);
    if(e.color&&!FX[e.k].color) add('warn',`${w}：この効果では色の指定は使われません`);
    if(!FX[e.k].noTgt&&!TGT_BY_CTX[ctx].includes(e.t)) add('error',`${w}：ここでは「${TARGETS[e.t]||e.t}」を対象にできません`);
    if(e.t==='master'&&e.k!=='star'&&e.k!=='starLoss') add('warn',`${w}：${TERMS.player}が対象だと、${TERMS.star}獲得以外は効果がありません`);
    if(FX[e.k].val&&e.v===0&&!e.max) add('warn',`${w}：値が0です`);
    if(!FX[e.k].inst&&!FX[e.k].perm&&e.turns==null&&e.times==null) add('warn',`${w}：効果時間がないため、ずっと続きます`);
    if(FX[e.k].timesOnly&&e.turns!=null) add('warn',`${w}：${FX[e.k].name}は回数で指定します（ターンは使われません）`);
    if(e.k==='instantDeath'&&['self','ally_all','ally_other'].includes(e.t)) add('warn',`${w}：味方に即死効果がかかります`);
    if(e.chance&&e.chance>=6) add('warn',`${w}：ロール6以下は必ず成功します`);
    if(e.k==='cardConv'&&!e.color) add('error',`${w}：カード変換は変換先の色を指定してください`);
    if(e.vs&&!(e.k in VS_KINDS)) add('warn',`${w}：この効果では弱体の種類の指定は使われません`);
    if(FX[e.k].trait&&!e.trait) add('error',`${w}：${FX[e.k].name}は対象の属性を指定してください`);
    if(e.trait&&!FX[e.k].trait) add('warn',`${w}：この効果では属性の指定は使われません`);
    if(e.cond){
      if(FX[e.k].noTgt) add('warn',`${w}：この効果では条件は使われません`);
      else if((e.cond.k==='trait'||e.cond.k==='cls')&&!e.cond.v) add('warn',`${w}：条件の${COND_KINDS[e.cond.k]}が空です`);
    }
    if(e.k==='critMult'&&e.v>0&&e.v<=100) add('warn',`${w}：クリティカル倍率が100%以下だと、クリティカルでダメージが増えません`);
    if(e.k==='maxHp'&&e.times!=null) add('warn',`${w}：最大HP+は回数では減りません（ターンで指定してください）`);
    if(['buffExtend','skillCharge'].includes(e.k)&&!(e.v>0)) add('error',`${w}：値は1以上にしてください`);
    if(e.at&&ctx==='skill') add('warn',`${w}：スキルでは「${EFF_AT[e.at]}」の指定は使われません`);
    if(e.at&&e.k==='dmg') add('warn',`${w}：ダメージ効果には「${EFF_AT[e.at]}」の指定は使われません`);
    if(e.k==='desc'&&!e.text) add('warn',`${w}：説明文が空です`);
    if(e.k==='multiHit'&&!(e.v>=2)) add('warn',`${w}：連続攻撃の回数は2以上にしてください`);
    if(e.k==='multiHit'&&e.v>10) add('warn',`${w}：連続攻撃は10回までです（それ以上は10回）`);
    if(e.k==='multiHit'&&effs.filter(x=>x.k==='multiHit').length>1&&effs.indexOf(e)!==effs.findIndex(x=>x.k==='multiHit')) add('warn',`${w}：連続攻撃が複数あります（一番大きい回数を使います）`);
  });
}
const hasErrors = units=>validateUnits(units).some(x=>x.level==='error');

// ---------- マスター（泥ペンマス：マスタールール用） ----------
// { id, name, cls:'マスター', cost, hp,
//   faces:[ {label, eff:Eff[]} ×6 ]   補助：出た面の効果をこのターンだけ適用（eff が空なら「無」）
//   spells:[ {name, eff:Eff[]} ×3 ] } 令呪：1試合1回、3つから1つ選ぶ
// 効果の対象は TGT_BY_CTX.master（self＝マスター自身）
function normalizeMaster(m){
  m=m||{};
  const own=o=>{ const a=strList(o.line); return a.length?{line:a}:{}; }; // 専用セリフ（空なら項目ごと持たない）
  const faces=Array.from({length:6},(_,i)=>{ const f=(m.faces||[])[i]||{}; return {label:String(f.label||''), eff:(f.eff||[]).map(normEff), ...own(f)}; });
  const spells=Array.from({length:3},(_,i)=>{ const s=(m.spells||[])[i]||{}; return {name:String(s.name||''), eff:(s.eff||[]).map(normEff), ...own(s)}; });
  const ln=m.lines||{};
  return { id:String(m.id||''), name:String(m.name||''), cls:TERMS.player, traits:[], cost:num(m.cost), hp:num(m.hp,100), master:true,
    fit:normFit(m.fit), lines:Object.fromEntries(Object.keys(MASTER_LINE_KEYS).map(k=>[k,strList(ln[k])])), faces, spells };
}
// ---------- 泥ペンマスシート（MSHEET）に沿った警告と目安 ----------
// 補助の効果が「入れてはいけない」「リミット枠」のどれに当たるか。{c:'forbid'|'limit1'|'limit2', msg} または null
function masterSlot(e){
  const F=MSHEET.forbid;
  if(e.k==='np'&&e.v>0&&!/^enemy/.test(e.t)) return {c:'forbid',msg:F.np};
  if(F[e.k]&&e.k!=='np') return {c:'forbid',msg:F[e.k]};
  if(e.k==='evade') return e.times===1?{c:'limit1',msg:'回避(1回)はリミット1枠（補助全体で1つ・主に4番）'}:{c:'forbid',msg:'回避は「回数1」のときだけ入れられます'};
  if(e.k==='charm') return e.t==='enemy_svt'&&e.chance&&e.chance<=3?{c:'limit1',msg:'魅了(ロール3以下)はリミット1枠（補助全体で1つ・主に4番）'}:{c:'forbid',msg:'魅了は「敵サーヴァント単体・ロール3以下」のときだけ入れられます'};
  if(MSHEET.limit1.includes(e.k)) return {c:'limit1',msg:`${(FX[e.k]||{}).name||e.k}はリミット1枠（補助全体で1つ・主に4番）`};
  if(MSHEET.limit2.includes(e.k)) return {c:'limit2',msg:`${(FX[e.k]||{}).name||e.k}はリミット2枠（補助全体で2つまで・主に4番）`};
  return null;
}
// 参考用補助効果一覧の目安値。fi＝補助の面（0始まり）。{name, ref（この面・このコストの目安）, adj（単体の加算分）, vals} または null
function masterRef(e,fi,cost){
  const c=e.color||'', R=MSHEET.ref;
  const key={ dmg:e.t==='enemy_master'?'dmg_enemy_master':e.t==='enemy_svt'?'dmg_enemy_svt':null,
    atk:'atk'+(c?'_'+c:''), onAtkNp:!c?'onAtkNp':c==='B'?'onAtkNp_B':null, onAtkStar:!c?'onAtkStar':c==='G'?'onAtkStar_G':null,
    def:'def', critRoll:'critRoll', heal:'heal', poison:e.t==='enemy_svt'?'poison':null, burn:e.t==='enemy_svt'?'burn':null }[e.k];
  const r=key&&R[key]; if(!r) return null;
  const v=r.vals[(cost>=MSHEET.star5Cost?2:0)+(fi===MSHEET.faceMain?1:0)]; if(!(v>0)) return null;
  const adj=e.t==='ally_svt'?(r.single||0):0;
  return {name:r.name, ref:v+adj, adj, vals:r.vals};
}
// 補助の効果1つの説明（エディタに小さく出す）。目安値と、禁止・リミット枠の注意
function masterRefText(e,fi,cost){
  const r=masterRef(e,fi,cost), s=masterSlot(e), out=[];
  if(r) out.push(`目安 ${r.ref}${r.adj?`（単体+${r.adj}込み）`:''}　${r.name}　★4以下 ${r.vals[0]}/${r.vals[1]}・★5 ${r.vals[2]}/${r.vals[3]}（4番以外/4番）`);
  if(s) out.push(`${s.c==='forbid'?'⚠ ':''}${s.msg}`);
  return out.join('　／　');
}
// コスト相応のマスターのひな形（HPと補助の6面）。4番は強め・ほかはコストと同じ数の面に目安値ちょうどの効果を入れる（シート準拠なので警告は出ない）
function masterTpl(cost){
  cost=Math.max(0,Math.round(cost)||0);
  const R=MSHEET.ref, star5=cost>=MSHEET.star5Cost, v=(key,main)=>R[key].vals[(star5?2:0)+(main?1:0)];
  const slots=[ // 4番以外に入れる順番（コストぶんだけ先頭から）
    ['強化魔術',[{k:'atk',t:'svt',v:v('atk')}]],
    ['治癒魔術',[{k:'heal',t:'svt',v:v('heal')}]],
    ['魔力供給',[{k:'onAtkNp',t:'svt',v:v('onAtkNp')}]],
    ['魔弾',[{k:'dmg',t:'enemy_svt',v:v('dmg_enemy_svt')}]],
    ['星の加護',[{k:'onAtkStar',t:'svt',v:v('onAtkStar')}]],
  ];
  const order=[1,4,2,5,0], faces=Array.from({length:6},()=>({label:'無',eff:[]}));
  order.slice(0,Math.min(cost,slots.length)).forEach((fi,i)=>{ faces[fi]={label:slots[i][0],eff:slots[i][1].map(normEff)}; });
  faces[MSHEET.faceMain]={label:'秘術',eff:[{k:'atk',t:'svt',v:v('atk',true)},{k:'heal',t:'svt',v:v('heal',true)}].map(normEff)};
  return {hp:Math.max(MSHEET.hpStep,cost*MSHEET.hpPerCost), faces};
}
function checkMasterSheet(m,add){
  const base=m.cost*MSHEET.hpPerCost, lo=Math.max(1,base-MSHEET.hpRange), hi=base+MSHEET.hpRange;
  if(m.hp<lo||m.hp>hi) add('big',`HP${m.hp}がシートの範囲外です（コスト${m.cost}×${MSHEET.hpPerCost}を基準に±${MSHEET.hpRange}：${lo}〜${hi}）`);
  else if((m.hp-base)%MSHEET.hpStep) add('warn',`HPは基準（${base}）から${MSHEET.hpStep}刻みで補正する目安です（今${m.hp-base>0?'+':''}${m.hp-base}）`);
  const real=f=>f.eff.filter(e=>e.k!=='desc');
  const main=MSHEET.faceMain;
  if(!m.faces[main]||!real(m.faces[main]).length) add('big',`補助${main+1}番は必ず効果を入れます（他より強めに）`);
  const others=m.faces.filter((f,i)=>i!==main&&real(f).length).length;
  const want=Math.min(m.cost,5); // 4番以外の面は5つしかない
  if(others>want) add('big',`補助の成功枠が多すぎます（${main+1}番以外で効果のある面が${others}つ。コスト${m.cost}まで）`);
  else if(others<want) add('warn',`補助の成功枠が足りません（${main+1}番以外で効果のある面は、コストと同じ${want}つが目安。今${others}つ）`);
  const same=new Map(), lim={limit1:[],limit2:[]};
  m.faces.forEach((f,fi)=>real(f).forEach(e=>{
    const w=`補助${fi+1}`, name=(FX[e.k]||{}).name||e.k, s=masterSlot(e);
    if(s){
      if(s.c==='forbid') add('big',`${w}：${name} — ${s.msg}`);
      else{ lim[s.c].push(fi); if(fi!==main) add('warn',`${w}：${name}は主に${main+1}番にだけ入れる効果です`); }
    }
    const key=`${e.k}|${e.color||''}|${e.t==='svt'?'ally_all':e.t}`, a=same.get(key)||{n:0,name:`${e.color?TERMS[e.color]+'の':''}${name}`,t:e.t,fs:[]};
    a.n++; a.fs.push(fi+1); same.set(key,a);
    const r=masterRef(e,fi,m.cost);
    if(r&&e.v>r.ref) add('warn',`${w}：${name}${e.v}が目安（${r.ref}）を超えています`);
  }));
  for(const a of same.values()) if(a.n>MSHEET.sameMax) add('big',`同じ種類の効果が多すぎます：${a.name}（${mTLabel(a.t)}）が${a.n}つ（補助${a.fs.join('・')}）。補助全体で${MSHEET.sameMax}つまで`);
  if(lim.limit1.length>1) add('big',`リミット1枠の効果が${lim.limit1.length}つ入っています（補助${lim.limit1.map(i=>i+1).join('・')}）。補助全体で1つまで`);
  if(lim.limit2.length>2) add('big',`リミット2枠の効果が${lim.limit2.length}つ入っています（補助${lim.limit2.map(i=>i+1).join('・')}）。補助全体で2つまで`);
}
// units を渡すと、サーヴァントとIDが重なっていないかも確かめる（ゲームはIDでサーヴァント→マスターの順に探すため）
// level：'error'（反映できない） / 'big'（大警告：シートの決まりに反する） / 'warn'（小警告・注意：シートの目安から外れる）
function validateMasters(ms,units=[]){
  const issues=[], ids=new Map(), uids=new Set(units.map(u=>u.id)), allTraits=new Set(units.flatMap(u=>u.traits||[]));
  if(!ms.length) issues.push({i:-1,level:'warn',msg:`${TERMS.player}が1人もいません（マスタールールが遊べません）`});
  ms.forEach((m,i)=>{
    const add=(level,msg)=>issues.push({i,level,msg});
    if(!/^[A-Za-z0-9_-]+$/.test(m.id)) add('error','IDは半角英数字・_・- で入力してください');
    else if(ids.has(m.id)) add('error',`ID「${m.id}」が他の${TERMS.player}と重複しています`);
    else if(uids.has(m.id)) add('error',`ID「${m.id}」が${TERMS.unit}と重複しています`);
    else ids.set(m.id,i);
    if(!m.name.trim()) add('error','名前が空です');
    if(!(m.cost>=0)) add('error','コストは0以上にしてください');
    if(!(m.hp>0)) add('error','HPは1以上にしてください');
    traitUseCheck([...m.faces,...m.spells].flatMap(x=>x.eff),allTraits,add);
    checkMasterSheet(m,add);
    m.faces.forEach((f,fi)=>{ if(f.eff.length&&!f.label.trim()) add('warn',`補助${fi+1}：面の名前が空です`); });
    m.spells.forEach((s,si)=>{ if(!s.name.trim()) add('warn',`令呪${si+1}：名前が空です`); });
    // 補助の効果はそのターンだけなので、効果時間なしの注意は出さない
    m.faces.forEach((f,fi)=>checkEffs(f.eff,'master',`補助${fi+1}`,(lv,msg)=>{ if(!msg.includes('効果時間がない')) add(lv,msg); }));
    m.spells.forEach((s,si)=>{ if(!s.eff.length) add('warn',`令呪${si+1}：効果がありません`); checkEffs(s.eff,'master',`令呪${si+1}`,add); });
  });
  return issues;
}
const mastersHaveErrors = (ms,units)=>validateMasters(ms,units).some(x=>x.level==='error');
// エディタで「ゲームに反映」したマスターがあればそれを、なければ標準データ（masters.js）を使う
function loadMasters(units=[]){
  const def=()=>(typeof DEFAULT_MASTERS!=='undefined'?DEFAULT_MASTERS:[]).map(normalizeMaster);
  const raw=readJSON(STORE.masters);
  if(raw){
    try{ if(!Array.isArray(raw)) throw 0; const ms=raw.map(normalizeMaster); if(!mastersHaveErrors(ms,units)) return {masters:ms, source:'custom'}; }catch(e){}
    return {masters:def(), source:'default', broken:true};
  }
  return {masters:def(), source:'default'};
}
const saveCustomMasters = ms=>writeJSON(STORE.masters,ms);
const clearCustomMasters = ()=>removeKey(STORE.masters);
// masters.js 形式で書き出す（中身はJSONなので、そのまま読み込み直せる）
function mastersToJS(ms){
  const j=v=>JSON.stringify(v);
  const body=ms.map(m=>[
    '  {',
    `    "id":${j(m.id)}, "name":${j(m.name)}, "cost":${m.cost}, "hp":${m.hp},`,
    ...(fitIsDef(m.fit,'face')?[]:[`    "fit":${j({face:m.fit.face})},`]),
    ...(Object.keys(MASTER_LINE_KEYS).some(k=>m.lines[k].length)?[`    "lines":${j(Object.fromEntries(Object.keys(MASTER_LINE_KEYS).map(k=>[k,m.lines[k]])))},`]:[]),
    '    "faces":[',
    m.faces.map(f=>`      ${j({label:f.label,eff:f.eff,...(f.line?{line:f.line}:{})})}`).join(',\n'),
    '    ],',
    '    "spells":[',
    m.spells.map(s=>`      ${j({name:s.name,eff:s.eff,...(s.line?{line:s.line}:{})})}`).join(',\n'),
    '    ]',
    '  }'].join('\n')).join(',\n');
  return `'use strict';
// ${TERMS.player}データ（ペンシルエディタで書き出し）。マスタールール・マスターチームで使う
// faces : 補助で振る鉛筆の面1〜6。eff が空なら「無」（何も起きない）。効果はそのターンだけ
// spells: 令呪3種
// lines : セリフ（support=補助 / attack=攻撃 / spell=令呪使用）。faces・spells の line は、その面・令呪だけの専用セリフ（任意）
// 効果の対象（t）: svt=自軍${TERMS.unit} / self=${TERMS.player}自身 / ally_all=味方全体（${TERMS.player}含む）
//                  enemy_all=敵${TERMS.unit}全員（敵${TERMS.player}には当たらない） / enemy_both=敵全体（敵${TERMS.unit}全員＋敵${TERMS.player}）
//                  enemy_svt=選んだ敵${TERMS.unit} / enemy_master=敵${TERMS.player} / master=自陣の${TERMS.star}
const DEFAULT_MASTERS = [
${body}
];
`;
}
function parseMastersFile(text){
  const t=text.trim(), a=t.indexOf('['), b=t.lastIndexOf(']');
  if(a<0||b<a) throw new Error(`${TERMS.player}の配列が見つかりません`);
  const raw=JSON.parse(t.slice(a,b+1));
  if(!Array.isArray(raw)||raw.some(m=>!m||!Array.isArray(m.spells))) throw new Error(`${TERMS.player}のデータではありません（spells がありません）`);
  return raw.map(normalizeMaster);
}

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
    ...(u.traits&&u.traits.length?[`    "traits":${j(u.traits)},`]:[]),
    ...(['face','card','np'].every(k=>fitIsDef(u.fit,k))?[]:[`    "fit":${j(u.fit)},`]),
    ...(u.link?[`    "link":${j(u.link)},`]:[]),
    '    "lines":{',
    Object.keys(LINE_KEYS).map(k=>`      ${j(k)}:${j(u.lines[k])}`).join(',\n'),
    ...(u.condLines&&u.condLines.length?['    },',`    "condLines":[`,u.condLines.map(c=>`      ${j(c)}`).join(',\n'),'    ],']:['    },']),
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
// traits: 属性（特攻・特防の判定に使う）
// lines: 場面ごとのセリフ（スキル・面の line はその場面専用のセリフ）
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

// ランダムにセリフを1つ（なければ空文字）。own（スキル・面の専用セリフ）があればそちらを優先
function pickLine(d,key,own){ const a=own&&own.length?own:(d&&d.lines&&d.lines[key])||[]; return a.length?a[Math.floor(Math.random()*a.length)]:''; }

// ---------- 画像 ----------
// クラス表示（アイコン＋名前）。iconOnly ならアイコンだけ
function clsIconTag(cls,cls2='clsicon'){ return imgTag(classIcon(cls),CLASS_ICON_EXTRA,cls2,cls); }
// 属性のチップ（なければ空文字）
function traitsHTML(d){ const t=(d&&d.traits)||[]; return t.length?`<span class="traits">${t.map(x=>`<span class="trait">${esc(x)}</span>`).join('')}</span>`:''; }
function clsBadge(cls,iconOnly){ return `<span class="cls${iconOnly?' only':''}" title="${esc(cls)}">${clsIconTag(cls)}${iconOnly?'':`<span>${esc(cls)}</span>`}</span>`; }
// サーヴァント画像は IMG_DIR の中から id に合う名前のファイルを探す（rules.js）
//   face: {id}.webp / card: {id}_card.webp → なければ face → なければ仮画像
// 一度読み込めなかったURLは IMG_BAD に覚えて、次の描画からは最初から飛ばす
// （毎回 404 → 差し替え をくり返すと、描き直すたびに画像がチカチカ消える）
const IMG_BAD=new Set();
function imgCandidates(d,k){
  const id=d&&d.id, base=id?IMG_DIR+encodeURIComponent(id):'';
  const face=base?base+'.'+IMG_EXT:'', card=base?base+IMG_CARD_SUFFIX+'.'+IMG_EXT:'';
  const all=(k==='card' ? [card,face,IMG_PLACEHOLDER.card] : [face,IMG_PLACEHOLDER.face]).filter(Boolean);
  const ok=all.filter(u=>!IMG_BAD.has(u));
  return ok.length?ok:all.slice(-1);
}
// 読み込めなければ data-fb に積んだ次の候補へ順に差し替える
function imgFail(el){
  IMG_BAD.add(el.getAttribute('src'));
  const fb=(el.dataset.fb||'').split('|').filter(Boolean);
  if(!fb.length){ el.onerror=null; return; }
  el.dataset.fb=fb.slice(1).join('|'); el.src=fb[0];
  if(Object.values(IMG_PLACEHOLDER).includes(fb[0])) el.removeAttribute('style'); // 仮画像にはトリミング設定を当てない
}
// loading="lazy" は付けない：描き直しで作り直した画像が、表示されるまで一瞬空白になるため
const imgTag=(src,fallback,cls,alt='',style='')=>`<img class="${cls}" src="${esc(src)}" alt="${esc(alt)}" data-fb="${esc([].concat(fallback).join('|'))}" onerror="imgFail(this)"${style?` style="${style}"`:''}>`;
// ---------- 画像を残したまま描き直す ----------
// innerHTML で丸ごと作り直すと、同じ画像でも <img> が作り直されて一瞬消える（チカチカ）・毎回デコードし直す。
// 新しいHTMLを組み立てたあと、読み込み済みの同じ画像（src・class・style が同じもの）を古い要素から移し替える。
// 回転中の魔法陣（.mc-o / .mc-i）は style（animation-delay）が毎回変わるので style を見ずに残す（回転も途切れない）
const KEEP_STYLELESS=['mc-o','mc-i'];
function imgKey(im){
  const free=KEEP_STYLELESS.some(c=>im.classList.contains(c));
  return `${im.getAttribute('src')}|${im.className}|${free?'':im.getAttribute('style')||''}`;
}
function keepImgs(oldRoot,newRoot){
  const pool=new Map();
  oldRoot.querySelectorAll('img').forEach(im=>{
    if(!im.complete||!im.naturalWidth) return; // 読み込み中・失敗した画像は使い回さない
    const k=imgKey(im); if(!pool.has(k)) pool.set(k,[]); pool.get(k).push(im);
  });
  if(!pool.size) return;
  newRoot.querySelectorAll('img').forEach(im=>{ const a=pool.get(imgKey(im)); if(a&&a.length) im.replaceWith(a.shift()); });
}
// el の中身を html に置き換える（画像は残す）
function setHTML(el,html){
  const t=document.createElement('template'); t.innerHTML=html;
  keepImgs(el,t.content);
  el.replaceChildren(t.content);
}
// el そのものを html の要素に置き換える（画像は残す）。新しい要素を返す
function replaceHTML(el,html){
  const t=document.createElement('template'); t.innerHTML=html.trim();
  const n=t.content.firstElementChild; if(!n) return el;
  keepImgs(el,n);
  el.replaceWith(n);
  return n;
}
function unitImg(d,k,cls,alt=''){ const c=imgCandidates(d,k); const ph=Object.values(IMG_PLACEHOLDER).includes(c[0]); return imgTag(c[0],c.slice(1),cls,alt,ph?'':fitStyle(d,k)); }
function faceImg(d,cls='face'){ return `<span class="${cls}">${unitImg(d,'face','',d?d.name:'')}</span>`; }
// コマンドカードの共通素材（rules.js の CARD_LAYERS）。宝具は bg が空なら宝具の色の bg を借りる
function cardLayers(kind,col){
  const L=CARD_LAYERS[kind]||{}, base=CARD_LAYERS[col]||{};
  return { bg:L.bg||(kind==='ULT'?base.bg:'')||'', frame:L.frame||'' };
}
// コマンドカード
//   Buster/Arts/Quick・宝具：背景(共通) → キャラ画像(サーヴァントごと) → 枠と種別名(共通) の3層
//   特殊：文字だけのカード / 霊基再臨：聖杯の画像（UI_IMG.grail）＋文字
function cmdCardHTML(d,c,opt={}){
  if(!c) return '';
  const sz=opt.small?' sm':'';
  const isUlt=c.c==='ULT';
  if(isUlt||['R','B','G'].includes(c.c)){
    const col=isUlt?(c.col||'R'):c.c, L=cardLayers(isUlt?'ULT':col,col);
    const label=isUlt?TERMS.ult:TERMS[col];
    const ex=[c.np?`${TERMS.gauge}+${c.np}`:'', c.star?`★${c.star}`:'', c.eff&&c.eff.length?'＋効果':''].filter(Boolean).join(' ');
    return `<div class="ccard ${col}${isUlt?' ULT':''}${L.frame?' hasframe':''}${sz}" title="${esc(label)}${c.dmg!=null?` ${c.dmg}`:''}">
      ${L.bg?`<img class="cc-bg" src="${esc(L.bg)}" alt="">`:''}
      ${unitImg(d,'card','ccimg',d?d.name:'')}
      ${L.frame?`<img class="cc-frame" src="${esc(L.frame)}" alt="${esc(label)}">`:`<span class="ccname">${label}</span>`}
      ${c.dmg!=null?`<span class="ccdmg">${c.dmg}</span>`:''}${ex&&!opt.small?`<span class="ccex">${ex}</span>`:''}</div>`;
  }
  const label=c.c==='ASC'?TERMS.asc:(c.label||TERMS.W);
  const grail=c.c==='ASC'&&UI_IMG.grail?`<img class="cc-grail" src="${esc(UI_IMG.grail)}" alt="">`:'';
  return `<div class="ccard ${esc(c.c)} plain${grail?' hasgrail':''}${sz}">${grail}<span class="ccname">${esc(label)}</span>${c.dmg>0?`<span class="ccdmg">${c.dmg}</span>`:''}</div>`;
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
    case 'critMult': s=`クリティカル時ダメージ×${e.v}%`; break;
    case 'guts': s=`ガッツ(HP${e.v})`; break;
    case 'critRoll': s=`クリティカル率アップ(Lv+${e.v})`; break;
    case 'debuffUp': s=`弱体成功率アップ(ロール+${e.v})`; break;
    case 'debuffDown': s=`弱体成功率ダウン(ロール-${e.v})`; break;
    case 'poison': s=`毒${e.v||RULES.dot}`; break;
    case 'burn': s=`やけど${e.v||RULES.dot}`; break;
    case 'starLoss': s=`${TERMS.star}${e.v}個消失`; break;
    case 'nullUnder': s=`${e.v}以下のダメージ無効`; break;
    case 'drain': s=`ターン終了時HP${e.v}減少`; break;
    case 'actsUp': s=`最大行動回数+${e.v}`; break;
    case 'actsDown': s=`最大行動回数-${e.v}`; break;
    case 'onAtkStar': s=`${e.color?TERMS[e.color]:''}攻撃時：${TERMS.star}${e.v}個発生`; break;
    case 'onAtkNp': s=`${e.color?TERMS[e.color]:''}攻撃時：${TERMS.gauge}+${e.v}%`; break;
    case 'heal': s=`HP${e.v}回復`; break;
    case 'regenHp': s=`ターン開始時HP${e.v}回復`; break;
    case 'regenNp': s=`ターン開始時${TERMS.gauge}+${e.v}%`; break;
    case 'regenStar': s=`ターン開始時${TERMS.star}${e.v}個獲得`; break;
    case 'atkTrait': s=`〔${e.trait||'属性未指定'}〕特攻+${e.v}`; break;
    case 'defTrait': s=`〔${e.trait||'属性未指定'}〕特防(被ダメージ-${e.v})`; break;
    case 'debuffImmune': case 'buffImmune': s=e.vs&&FX[e.vs]?`〔${FX[e.vs].name}〕${e.k==='buffImmune'?'強化':'弱体'}無効`:FX[e.k].name; break;
    case 'cleanse': case 'strip': s=e.vs&&FX[e.vs]?`〔${FX[e.vs].name}〕解除`:FX[e.k].name; break;
    case 'atkVs': s=`${e.vs&&FX[e.vs]?`〔${FX[e.vs].name}〕状態`:'弱体状態'}特攻+${e.v}`; break;
    case 'counter': s=`反撃(${e.v}ダメージ)`; break;
    case 'onHitNp': s=`被ダメージ時${TERMS.gauge}+${e.v}%`; break;
    case 'onHitStar': s=`被ダメージ時${TERMS.star}${e.v}個獲得`; break;
    case 'maxHp': s=`最大HP+${e.v}`; break;
    case 'critDown': s=`クリティカル率ダウン(Lv-${e.v})`; break;
    case 'cardConv': s=`カード変換→${e.color?TERMS[e.color]:'(色未指定)'}`; break;
    case 'buffExtend': s=`強化の効果時間+${e.v}T`; break;
    case 'skillCharge': s=`使用済みスキル${e.v}個を再使用可能に`; break;
    case 'np': s=`${TERMS.gauge}${e.v>=0?'+':''}${e.v}%`; break;
    case 'star': s=`${TERMS.star}${e.v}個獲得`; break;
    case 'dmg': s=e.max?'最大HPぶんのダメージ(軽減不可)':`${e.v}ダメージ`; break;
    case 'selfDmg': s=e.max?'最大HPぶんの自傷ダメージ(軽減不可)':`自傷ダメージ${e.v}`; break;
    case 'multiHit': s=`${e.v}回連続攻撃`; break;
    case 'npPow': s=`${TERMS.ult}威力+${e.v}`; break;
    case 'npPowDown': s=`${TERMS.ult}威力-${e.v}`; break;
    case 'desc': return e.text||'（説明文なし）';
    default: s=FX[e.k]?FX[e.k].name:e.k;
  }
  const dur=[e.times!=null?`${e.times}回`:'', e.turns!=null?`${e.turns}T`:''].filter(Boolean).join('・');
  return s+(dur?`(${dur})`:'')+(e.cond?`［${condText(e.cond,FX[e.k]&&FX[e.k].condUse)}］`:'')+(e.chance?`［ロール${e.chance}以下］`:'')+(EFF_AT[e.at]&&e.k!=='dmg'?`［${EFF_AT[e.at]}］`:'');
}
function tLabel(t,pick){
  if(t==='picked') return PICKS[pick]&&pick ? PICKS[pick] : TARGETS.picked;
  return TARGETS[t]||t;
}
// 効果の説明を1行ずつ。説明文（desc）があれば、それだけを返す（ほかの効果の説明は出さない）
// tl：対象の呼び名（マスターチームの令呪など、場所で変わるとき）
function effLines(effs,pick,tl){
  const ds=effs.filter(e=>e.k==='desc');
  if(ds.length) return ds.map(e=>e.text||'（説明文なし）');
  return effs.map(e=>FX[e.k]&&FX[e.k].noTgt?fxText(e):`${tl?tl(e.t):tLabel(e.t,pick)}：${fxText(e)}`);
}
const effsText=(effs,pick,tl)=>effs.length?effLines(effs,pick,tl).join(' ／ '):'効果なし';
function cmdChip(c){
  if(!c) return '';
  if(c.c==='ASC') return `<span class="cmd ASC">${TERMS.asc}</span>`;
  if(c.c==='W') return `<span class="cmd W">${esc(c.label||TERMS.W)}${c.dmg>0?` ${c.dmg}`:''}</span>`;
  const ex=[c.np?`${TERMS.gauge}+${c.np}`:'', c.star?`★${c.star}`:''].filter(Boolean).join(' ');
  const fx=c.eff&&c.eff.length?` <small title="${esc(effsText(c.eff))}">＋効果</small>`:'';
  return `<span class="cmd ${esc(c.c)}">${TERMS[c.c]||esc(c.c)} ${c.dmg}${ex?` <small>${ex}</small>`:''}${fx}</span>`;
}
function facesTableHTML(d){
  const cell=c=>cmdChip(c)+(c.eff&&c.eff.length?`<div class="sub">${esc(effsText(c.eff))}</div>`:'');
  return `<table class="faces"><tr><th>出目</th><th>行動</th><th>${TERMS.asc}前</th><th>${TERMS.asc}後</th></tr>
    ${d.faces.map((f,i)=>`<tr><td>${i+1}</td><td>${faceActs(d,i)}</td><td>${cell(f.pre)}</td><td>${cell(f.post)}</td></tr>`).join('')}</table>`;
}
// 操作できないスキル一覧（編成画面・エディタのプレビュー用）
function skillListHTML(d){
  const rows=d.skills.map((s,i)=>`<div class="skill"><span class="sname">S${i+1} ${i===2?'🔒':''}${skillNameHTML(s)}</span><span class="desc">${esc(effsText(s.eff,s.pick))}${i===2?`（${TERMS.asc}後に使用可）`:''}</span></div>`).join('');
  const ult=`<div class="skill ult"><span class="sname">${TERMS.ult}「${ultNameHTML(d.ult)}」</span><span class="desc">[${TERMS[d.ult.c]||esc(d.ult.c)}] ${esc(effsText(d.ult.eff,d.ult.pick))}</span></div>`;
  return `<div class="skills">${rows}${ult}</div>`;
}
