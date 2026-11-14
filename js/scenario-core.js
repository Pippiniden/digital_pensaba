'use strict';
/* =====================================================================
   シナリオ：データ形式・検証・保存・表示の部品（ゲームとシナリオエディタで共有）
   - シナリオは1つのJSON（format:'pensaba-scenario'）。形式の説明は docs/agents/scenario.md
   - 外部から読み込むデータなので、文字は必ず esc()、画像・音声のURLは scnSafeSrc() を通す
   ===================================================================== */

const SCN_FORMAT='pensaba-scenario', SCN_VER=1;
const SCN_DIR='scenarios/', SCN_ASSET_DIR='scenarios/assets/';
// 素材の種類（エディタの絞り込み用）。img＝画像 / audio＝音声
const SCN_ASSET_TYPES = { bg:{name:'背景',kind:'img'}, face:{name:'顔グラフィック',kind:'img'}, bgm:{name:'BGM',kind:'audio'}, se:{name:'効果音',kind:'audio'} };
// コマンドの種類
const SCN_CMDS = { say:'セリフ', choice:'選択肢', bg:'背景', bgm:'BGM', se:'効果音', fx:'画面効果', wait:'待つ', clear:'ウィンドウを消す',
  set:'フラグ操作', if:'条件ジャンプ', jump:'ジャンプ', battle:'戦闘', end:'エンディング' };
const SCN_POS = { bottom:'下', top:'上' };
const SCN_FX = { flash:'フラッシュ', shake:'ゆれ', fadeout:'暗転', fadein:'暗転から戻す' };
const SCN_OPS = { '=':'にする', '+':'を足す', '-':'を引く' };
const SCN_CMPS = { '==':'と等しい', '!=':'と等しくない', '>=':'以上', '<=':'以下', '>':'より大きい', '<':'より小さい' };
// 編成の決め方：keep＝最初に選んだチームを使い続ける / choose＝戦闘の前に毎回選ぶ / fixed＝全員固定（選ばせない）
const SCN_PARTY_MODES = { keep:'最初に選んだチーム', choose:'戦闘の前に選ぶ', fixed:'メンバー固定（全員）' };
const SCN_LOSE_NEXT='@next'; // 敗北しても続きへ進む

const scnStr = v=>String(v??'').trim();
const scnIds = v=>[...new Set((Array.isArray(v)?v:[]).map(scnStr).filter(Boolean))];
// 画像・音声の参照先：埋め込み（data:）か、scenarios/assets/ の中の相対パスだけを通す（外部サイトのURLは使わない）
function scnSafeSrc(src){
  const s=scnStr(src);
  if(/^data:(image\/(png|jpeg|webp|gif|avif)|audio\/[a-z0-9.+-]+|video\/(ogg|webm|mp4));base64,[A-Za-z0-9+/=]+$/i.test(s)) return s;
  if(!s||/^[a-z][a-z0-9+.-]*:/i.test(s)||s.startsWith('/')||s.startsWith('\\')||s.split(/[\\/]/).includes('..')) return '';
  return SCN_ASSET_DIR+s.split('/').map(encodeURIComponent).join('/');
}
const scnAssetUrl = (s,key)=>{ const a=s&&s.assets[key]; return a?scnSafeSrc(a.src):''; };
// 画像の参照：'unit:<キャラid>'＝ゲームのキャラ画像 / それ以外＝素材のキー
function scnImgUrl(s,ref){
  ref=scnStr(ref); if(!ref) return '';
  if(ref.startsWith('unit:')){ const id=ref.slice(5), o=(s.unitImgs||{})[id]; return (o&&o.face&&scnAssetUrl(s,o.face))||IMG_DIR+encodeURIComponent(id)+'.'+IMG_EXT; }
  return scnAssetUrl(s,ref);
}
const scnChar = (s,id)=>s.chars.find(c=>c.id===id)||null;
// 話者の顔グラフィック（表情名があればその画像、なければ標準の画像）
function scnFaceUrl(s,who,face){
  const c=scnChar(s,who); if(!c) return '';
  const f=face&&c.faces.find(x=>x.name===face);
  return scnImgUrl(s,(f&&f.img)||c.img);
}

// ---------- 正規化 ----------
function scnNormCmd(c){
  const t=SCN_CMDS[c&&c.t]?c.t:'say', n=(v,d=0)=>Number.isFinite(+v)&&v!==''&&v!=null?+v:d;
  switch(t){
    case 'say': return {t, pos:SCN_POS[c.pos]?c.pos:'bottom', who:scnStr(c.who), face:scnStr(c.face), name:scnStr(c.name), text:String(c.text??'')};
    case 'choice': return {t, opts:(Array.isArray(c.opts)?c.opts:[]).map(o=>({text:scnStr(o&&o.text), to:scnStr(o&&o.to), flag:scnStr(o&&o.flag), v:n(o&&o.v,1)}))};
    case 'bg': return {t, img:scnStr(c.img), fade:Math.max(0,n(c.fade,600))};
    case 'bgm': return {t, audio:scnStr(c.audio)};
    case 'se': return {t, audio:scnStr(c.audio)};
    case 'fx': return {t, kind:SCN_FX[c.kind]?c.kind:'flash'};
    case 'wait': return {t, ms:Math.max(0,n(c.ms,500))};
    case 'clear': return {t, pos:['both','top','bottom'].includes(c.pos)?c.pos:'both'};
    case 'set': return {t, flag:scnStr(c.flag), op:SCN_OPS[c.op]?c.op:'=', v:n(c.v,1)};
    case 'if': return {t, flag:scnStr(c.flag), cmp:SCN_CMPS[c.cmp]?c.cmp:'==', v:n(c.v,1), to:scnStr(c.to)};
    case 'jump': return {t, to:scnStr(c.to)};
    case 'end': return {t, text:String(c.text??'')};
    case 'battle': { const p=c.party||{}, e=c.enemy||{};
      return {t, rule:RULESETS[c.rule]?c.rule:'team', level:scnStr(c.level)||'normal', cap:Math.max(0,n(c.cap,0)),
        party:{mode:SCN_PARTY_MODES[p.mode]?p.mode:'keep', lock:scnIds(p.lock), master:scnStr(p.master), pool:scnIds(p.pool)},
        enemy:{units:scnIds(e.units), master:scnStr(e.master), name:scnStr(e.name)}, win:scnStr(c.win), lose:scnStr(c.lose)}; }
  }
}
// 読み込んだJSONをシナリオの形に整える（形式が違えば例外）。知らない項目は落とす
function normScenario(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.format!==SCN_FORMAT) throw new Error('シナリオデータではありません（format が違います）');
  const assets={};
  Object.entries(raw.assets&&typeof raw.assets==='object'?raw.assets:{}).forEach(([k,a])=>{ k=scnStr(k); if(k&&a) assets[k]={type:SCN_ASSET_TYPES[a.type]?a.type:'bg', name:scnStr(a.name), src:scnStr(a.src)}; });
  const unitImgs={};
  Object.entries(raw.unitImgs&&typeof raw.unitImgs==='object'?raw.unitImgs:{}).forEach(([k,o])=>{ if(o&&(o.face||o.card)) unitImgs[scnStr(k)]={face:scnStr(o.face), card:scnStr(o.card)}; });
  return { format:SCN_FORMAT, v:SCN_VER, id:scnStr(raw.id)||'scenario', title:scnStr(raw.title)||'無題のシナリオ', author:scnStr(raw.author), desc:String(raw.desc??''), cover:scnStr(raw.cover),
    assets, unitImgs,
    chars:(Array.isArray(raw.chars)?raw.chars:[]).map(c=>({id:scnStr(c&&c.id), name:scnStr(c&&c.name), img:scnStr(c&&c.img), faces:(Array.isArray(c&&c.faces)?c.faces:[]).map(f=>({name:scnStr(f&&f.name), img:scnStr(f&&f.img)}))})),
    units:Array.isArray(raw.units)?normalizeUnits(raw.units):[], masters:Array.isArray(raw.masters)?raw.masters.map(normalizeMaster):[],
    start:scnStr(raw.start),
    scenes:(Array.isArray(raw.scenes)?raw.scenes:[]).map(sc=>({id:scnStr(sc&&sc.id), name:scnStr(sc&&sc.name), cmds:(Array.isArray(sc&&sc.cmds)?sc.cmds:[]).filter(Boolean).map(scnNormCmd)})) };
}
const newScenario = ()=>normScenario({format:SCN_FORMAT, id:'scenario_'+Date.now().toString(36), title:'新しいシナリオ', scenes:[{id:'scene1', name:'シーン1', cmds:[{t:'say',pos:'bottom',text:''}]}]});
function parseScenarioText(text){ let raw; try{ raw=JSON.parse(text); }catch(e){ throw new Error('JSONとして読めません'); } return normScenario(raw); }

// ---------- 検証 ----------
// base＝ゲーム側のキャラ {units, masters}。戻り値: [{level:'error'|'warn', msg, scene?:番号, cmd?:番号}]
function validateScenario(s,base={units:[],masters:[]}){
  const out=[], add=(level,msg,scene,cmd)=>out.push({level,msg,scene,cmd});
  const units=new Map([...base.units,...s.units].map(u=>[u.id,u])), masters=new Map([...base.masters,...s.masters].map(m=>[m.id,m]));
  if(!/^[A-Za-z0-9_-]+$/.test(s.id)) add('error','シナリオIDは半角英数字・_・- で入力してください');
  if(!s.scenes.length) add('error','シーンが1つもありません');
  // 専用キャラ（ペンシルエディタと同じ検証）
  validateUnits(s.units).filter(x=>x.level==='error').forEach(x=>add('error',`専用${TERMS.unit}${x.i>=0&&s.units[x.i]?`「${s.units[x.i].name}」`:''}：${x.msg}`));
  if(s.masters.length) validateMasters(s.masters,[...units.values()].filter(u=>!s.masters.some(m=>m.id===u.id))).filter(x=>x.level==='error').forEach(x=>add('error',`専用${TERMS.player}${x.i>=0&&s.masters[x.i]?`「${s.masters[x.i].name}」`:''}：${x.msg}`));
  // 素材
  Object.entries(s.assets).forEach(([k,a])=>{ if(!a.src) add('warn',`素材「${a.name||k}」：ファイルが未設定です`); else if(!scnSafeSrc(a.src)) add('error',`素材「${a.name||k}」：使えない参照先です（埋め込みか、${SCN_ASSET_DIR} の中のパスだけ使えます）`); });
  const img=(ref,what,i,j)=>{ if(!ref) return; if(ref.startsWith('unit:')){ if(!units.has(ref.slice(5))&&!masters.has(ref.slice(5))) add('warn',`${what}：キャラ「${ref.slice(5)}」が見つかりません`,i,j); } else if(!s.assets[ref]) add('error',`${what}：素材「${ref}」がありません`,i,j); };
  img(s.cover,'表紙');
  Object.entries(s.unitImgs).forEach(([id,o])=>{ img(o.face,`キャラ画像（${id}）`); img(o.card,`カード画像（${id}）`); });
  // 登場人物
  const cids=new Set();
  s.chars.forEach(c=>{ const w=`登場人物「${c.name||c.id}」`;
    if(!c.id) add('error','登場人物：IDが空です'); else if(cids.has(c.id)) add('error',`${w}：IDが重複しています`);
    cids.add(c.id); img(c.img,w);
    c.faces.forEach(f=>{ if(!f.name) add('warn',`${w}：表情の名前が空です`); img(f.img,`${w}の表情「${f.name}」`); }); });
  // シーン
  const sids=new Set();
  s.scenes.forEach((sc,i)=>{ if(!sc.id) add('error',`シーン${i+1}：IDが空です`,i); else if(sids.has(sc.id)) add('error',`シーン「${sc.id}」：IDが重複しています`,i); sids.add(sc.id); });
  if(s.start&&!sids.has(s.start)) add('error',`開始シーン「${s.start}」がありません`);
  const to=(id,what,i,j,need)=>{ if(!id){ if(need) add('error',`${what}：行き先のシーンが未設定です`,i,j); } else if(!sids.has(id)) add('error',`${what}：シーン「${id}」がありません`,i,j); };
  s.scenes.forEach((sc,i)=>sc.cmds.forEach((c,j)=>{
    const w=SCN_CMDS[c.t];
    switch(c.t){
      case 'say': if(c.who){ const ch=scnChar(s,c.who); if(!ch) add('error',`${w}：登場人物「${c.who}」がいません`,i,j); else if(c.face&&!ch.faces.some(f=>f.name===c.face)) add('warn',`${w}：${ch.name}に表情「${c.face}」がありません`,i,j); }
        if(!c.text.trim()) add('warn',`${w}：文章が空です`,i,j); break;
      case 'choice': if(!c.opts.length) add('error',`${w}：選択肢が1つもありません`,i,j);
        c.opts.forEach((o,k)=>{ if(!o.text) add('warn',`${w}${k+1}：文章が空です`,i,j); to(o.to,`${w}${k+1}`,i,j,false); }); break;
      case 'bg': img(c.img,w,i,j); break;
      case 'bgm': case 'se': if(c.audio&&!s.assets[c.audio]) add('error',`${w}：素材「${c.audio}」がありません`,i,j); if(c.t==='se'&&!c.audio) add('warn',`${w}：音声が未設定です`,i,j); break;
      case 'set': if(!c.flag) add('error',`${w}：フラグ名が空です`,i,j); break;
      case 'if': if(!c.flag) add('error',`${w}：フラグ名が空です`,i,j); to(c.to,w,i,j,true); break;
      case 'jump': to(c.to,w,i,j,true); break;
      case 'battle': { const rs=RULESETS[c.rule], isU=id=>units.has(id)&&!masters.has(id);
        if(typeof CPU_LEVELS!=='undefined'&&!CPU_LEVELS[c.level]) add('error',`${w}：CPUの強さ「${c.level}」がありません`,i,j);
        if(!c.enemy.units.length) add('error',`${w}：相手の${TERMS.unit}が未設定です`,i,j);
        if(c.enemy.units.length>rs.partyMax) add('error',`${w}：相手は${rs.name}ルールでは最大${rs.partyMax}騎です`,i,j);
        [...c.enemy.units,...c.party.lock,...c.party.pool].forEach(id=>{ if(!isU(id)) add('error',`${w}：${TERMS.unit}「${id}」が見つかりません`,i,j); });
        if(c.party.lock.length>rs.partyMax) add('error',`${w}：固定メンバーは${rs.name}ルールでは最大${rs.partyMax}騎です`,i,j);
        if(c.party.mode==='fixed'&&!c.party.lock.length) add('error',`${w}：メンバー固定（全員）なのに固定メンバーが未設定です`,i,j);
        if(rs.master){ if(!masters.has(c.enemy.master)) add('error',`${w}：相手の${TERMS.player}が未設定か、見つかりません`,i,j);
          if(c.party.master&&!masters.has(c.party.master)) add('error',`${w}：固定の${TERMS.player}「${c.party.master}」が見つかりません`,i,j);
          if(c.party.mode==='fixed'&&!c.party.master) add('error',`${w}：メンバー固定（全員）なのに${TERMS.player}が未設定です`,i,j); }
        to(c.win,`${w}（勝利時）`,i,j,false); if(c.lose!==SCN_LOSE_NEXT) to(c.lose,`${w}（敗北時）`,i,j,false); break; }
    }
  }));
  return out;
}
const scenarioHasErrors = (s,base)=>validateScenario(s,base).some(x=>x.level==='error');

// ---------- 文章 ----------
// 文章 → HTML。1文字ずつ <span class="c">（文字送り用）。ルビ：｜漢字《かんじ》 / {フラグ名} はその値に置き換える
function scnTextHTML(text,flags={}){
  const t=String(text??'').replace(/\{([^{}\s]+)\}/g,(m,k)=>k in flags?String(flags[k]):m);
  const re=/[|｜]([^|｜《》\n]+)《([^《》\n]+)》|\n|[\s\S]/gu; let out='', m;
  while((m=re.exec(t))) out+= m[1]?`<ruby class="c">${esc(m[1])}<rt>${esc(m[2])}</rt></ruby>` : m[0]==='\n'?'<br>' : `<span class="c">${esc(m[0])}</span>`;
  return out;
}
const scnTextPlain = (text,flags={})=>String(text??'').replace(/\{([^{}\s]+)\}/g,(m,k)=>k in flags?String(flags[k]):m).replace(/[|｜]([^|｜《》\n]+)《[^《》\n]+》/g,'$1');
// セリフウィンドウ1つぶんの中身（顔グラフィック＋名前＋文章）。w＝{who,face,name,text} か null（空）。shown＝文字を最初から全部見せる
function scnWinInner(s,w,flags,shown){
  if(!w) return '';
  const ch=scnChar(s,w.who), url=scnFaceUrl(s,w.who,w.face), name=w.name||(ch?ch.name:'');
  return `${url?`<div class="sn-face"><img src="${esc(url)}" alt="${esc(name)}" onerror="this.parentNode.classList.add('none')"></div>`:''}
    <div class="sn-box">${name?`<b class="sn-name">${esc(name)}</b>`:''}<p class="sn-text${shown?' all':''}">${scnTextHTML(w.text,flags)}</p><i class="sn-next"></i></div>`;
}

// ---------- 保存（IndexedDB：画像を埋め込んだシナリオは大きいので localStorage には入れない） ----------
// キー：'imp:<シナリオID>'＝外部読み込みしたシナリオ / 'draft'＝シナリオエディタの下書き
const SCN_DB='pensaba-scenarios';
function scnDbOp(mode,fn){
  return new Promise((res,rej)=>{
    let rq; try{ rq=indexedDB.open(SCN_DB,1); }catch(e){ rej(e); return; }
    rq.onupgradeneeded=()=>rq.result.createObjectStore('s');
    rq.onerror=()=>rej(rq.error);
    rq.onsuccess=()=>{ const db=rq.result, tx=db.transaction('s',mode), r=fn(tx.objectStore('s'));
      tx.oncomplete=()=>{ db.close(); res(r&&r.result); }; tx.onerror=tx.onabort=()=>{ db.close(); rej(tx.error); }; };
  });
}
const scnDbGet = k=>scnDbOp('readonly',st=>st.get(k));
const scnDbPut = (k,v)=>scnDbOp('readwrite',st=>st.put(v,k));
const scnDbDel = k=>scnDbOp('readwrite',st=>st.delete(k));
const scnDbKeys = ()=>scnDbOp('readonly',st=>st.getAllKeys());
const scnImpKey = id=>'imp:'+id;
