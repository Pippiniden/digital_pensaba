'use strict';
/* =====================================================================
   シナリオエディタ（scenario-editor.html）
   - 編集中のシナリオは S（normScenario の形）。下書きは IndexedDB の 'draft' に自動保存
   - 入力欄は data-path（S の中の場所。例 scenes.0.cmds.3.text）で結びつけ、input で書き戻す。data-re 付きは変更後に描き直す
   - ボタンは data-act を document で受ける（要素に直接リスナーを付けない）
   - シーン・登場人物・素材の ID は自動で振る（名前だけ編集する）ので、名前を変えても参照は切れない
   ===================================================================== */

let S = newScenario();
const E = { tab:'scene', scene:0, cur:0, addType:'bg', pendAsset:null, pendUnits:'units' };
const BASE = (()=>{ const units=loadUnits().units; return {units, masters:loadMasters(units).masters}; })(); // ゲーム側のキャラ
const TABS = { info:'基本情報', chars:'登場人物', assets:'素材', units:'専用キャラ' };
const $ = sel=>document.querySelector(sel);
const allUnits = ()=>[...S.units,...BASE.units.filter(u=>!S.units.some(x=>x.id===u.id))];
const allMasters = ()=>[...S.masters,...BASE.masters.filter(m=>!S.masters.some(x=>x.id===m.id))];
const unitName = id=>{ const d=[...allUnits(),...allMasters()].find(u=>u.id===id); return d?d.name:`？${id}`; };
function toast(msg,err){ const t=$('#toast'); t.textContent=msg; t.className='show'+(err?' err':''); clearTimeout(toast.t); toast.t=setTimeout(()=>t.className='',2600); }
function newId(prefix,used){ for(let i=1;;i++){ const id=prefix+i; if(!used.includes(id)) return id; } }

// ---------- 保存 ----------
let saveTimer=null;
function dirty(){ clearTimeout(saveTimer); saveTimer=setTimeout(()=>{ scnDbPut('draft',S).catch(()=>toast('下書きを保存できませんでした（容量不足の可能性があります）',true)); drawSide(); drawStatus(); },350); }
function drawStatus(){
  const kb=new Blob([JSON.stringify(S)]).size/1024, n=validateScenario(S,BASE);
  const e=n.filter(x=>x.level==='error').length, w=n.length-e;
  $('#status').innerHTML=`${esc(S.title)} ・ ${kb>=1024?(kb/1024).toFixed(1)+' MB':Math.ceil(kb)+' KB'} ・ ${e?`<span class="dirty">エラー ${e}</span>`:'<span class="clean">エラーなし</span>'}${w?` ・ 注意 ${w}`:''}`;
}

// ---------- 部品 ----------
const get = path=>path.split('.').reduce((o,k)=>o==null?o:o[k],S);
function setPath(path,v){ const ks=path.split('.'), last=ks.pop(), o=ks.reduce((x,k)=>x[k],S); o[last]=v; }
const opt = (v,label,cur)=>`<option value="${esc(v)}" ${String(v)===String(cur)?'selected':''}>${esc(label)}</option>`;
const sel = (path,opts,cur,o={})=>`<select data-path="${path}" ${o.re?'data-re':''} ${o.num?'data-num':''} title="${esc(o.title||'')}">${opts.map(([v,l])=>opt(v,l,cur)).join('')}${opts.some(([v])=>String(v)===String(cur))?'':opt(cur,`（なし：${cur}）`,cur)}</select>`;
const inp = (path,v,o={})=>`<input ${o.num?'type="number" data-num':'type="text"'} data-path="${path}" value="${esc(v)}" placeholder="${esc(o.ph||'')}" ${o.re?'data-re':''} ${o.w?`style="width:${o.w}px"`:''} ${o.min!=null?`min="${o.min}"`:''} ${o.step?`step="${o.step}"`:''}>`;
const lab = (name,ctl,cls='')=>`<label class="${cls}">${name}${ctl}</label>`;
const sceneOpts = (none='（続きへ）')=>[['',none],...S.scenes.map((s,i)=>[s.id,`${i+1}. ${s.name||s.id}`])];
const assetOpts = (kind,none='（なし）')=>[['',none],...Object.entries(S.assets).filter(([,a])=>SCN_ASSET_TYPES[a.type].kind===kind).map(([k,a])=>[k,`${SCN_ASSET_TYPES[a.type].name}：${a.name||k}`])];
const imgOpts = (none='（なし）')=>[...assetOpts('img',none),...allUnits().map(u=>['unit:'+u.id,`キャラ画像：${u.name}`]),...allMasters().map(u=>['unit:'+u.id,`キャラ画像：${u.name}`])];
// id の並び（固定メンバー・選べるキャラ・相手）：チップ＋追加のセレクト
function idList(path,list,max){
  const ids=get(path)||[];
  return `<span class="idlist">${ids.map((id,k)=>`<span class="chip">${k+1}. ${esc(unitName(id))}<button class="small ghost" data-act="delId" data-p="${path}" data-k="${k}" title="外す">×</button></span>`).join('')}
    ${max&&ids.length>=max?'':`<select data-addid="${path}"><option value="">＋ 追加</option>${list.filter(u=>!ids.includes(u.id)).map(u=>opt(u.id,`${u.name}（C${u.cost}）${u.enemy?`［${ENEMY_KINDS[u.enemy]}］`:''}`,'')).join('')}</select>`}</span>`;
}

// ---------- 左：一覧 ----------
function drawList(){
  $('#list').innerHTML=`<div class="ulist">${Object.entries(TABS).map(([k,v])=>`<button class="uitem ${E.tab===k?'on':''}" data-act="tab" data-v="${k}"><span class="uname">${v}</span></button>`).join('')}</div>
    <h3 class="sehead">シーン</h3>
    <div class="ulist">${S.scenes.map((s,i)=>`<button class="uitem ${E.tab==='scene'&&E.scene===i?'on':''}" data-act="scene" data-i="${i}"><span class="uname">${i+1}. ${esc(s.name||s.id)}</span>${S.start===s.id||(!S.start&&i===0)?'<span class="dot big" title="開始シーン">S</span>':''}</button>`).join('')}</div>
    <button data-act="addScene">＋ シーンを追加</button>
    <p class="sub small">シーンは上から順に進みます（最後まで行くと次のシーンへ）。分岐は「選択肢」「条件ジャンプ」「戦闘」で。</p>`;
}

// ---------- 中央：フォーム ----------
function drawForm(){
  const f=$('#form'), y=window.scrollY;
  setHTML(f,E.tab==='info'?infoHTML():E.tab==='chars'?charsHTML():E.tab==='assets'?assetsHTML():E.tab==='units'?unitsHTML():sceneHTML());
  window.scrollTo(0,y);
}
function infoHTML(){
  return `<section class="sec"><h2>基本情報</h2><div class="fields">
    ${lab('タイトル',inp('title',S.title),'wide')}${lab('作者',inp('author',S.author))}
    ${lab('シナリオID <small>半角英数字・_・-（セーブデータの区別に使います）</small>',inp('id',S.id))}
    ${lab('開始シーン',sel('start',sceneOpts('（最初のシーン）'),S.start,{re:1}))}
    ${lab('表紙の画像',sel('cover',imgOpts(),S.cover,{re:1}))}
    <label class="wide">紹介文<textarea data-path="desc" rows="4">${esc(S.desc)}</textarea></label></div>
    ${S.cover?`<img class="seprev" src="${esc(scnImgUrl(S,S.cover))}" alt="">`:''}</section>
    <section class="sec"><h2>使い方</h2><ul class="sub small sehelp">
      <li>書き出したJSONを <code>${SCN_DIR}</code> に置いて <code>${SCN_DIR}index.js</code> にファイル名を書くか、ゲームの「設定 → シナリオの読み込み」で読み込むと、メニューに「シナリオ」が出ます。</li>
      <li>画像・音声は「素材」で埋め込むとJSONの中に入ります。<code>${SCN_ASSET_DIR}</code> に置いたファイルは、パスで指定すれば埋め込まずに使えます。</li>
      <li>文章の中で <code>｜漢字《かんじ》</code> と書くとルビ、<code>{フラグ名}</code> と書くとそのフラグの値になります。</li>
      <li>戦闘の編成：<b>最初に選んだチーム</b>＝一度選んだ編成を以後も使う ／ <b>戦闘の前に選ぶ</b>＝毎回選ぶ ／ <b>メンバー固定（全員）</b>＝選ばせない。「固定メンバー」に入れたキャラは、どの方式でも必ず出撃します。</li></ul></section>`;
}
function charsHTML(){
  return `<section class="sec"><h2>登場人物（セリフの話者）</h2>
    <p class="sub small nm">顔グラフィックは、素材の画像か、ゲームのキャラ画像から選びます。表情を足すと、セリフごとに切り替えられます。</p>
    ${S.chars.map((c,i)=>{ const p=`chars.${i}`, url=scnImgUrl(S,c.img);
      return `<div class="serow"><div class="sechar">${url?`<img class="seface" src="${esc(url)}" alt="">`:'<span class="seface none">顔なし</span>'}
        <div class="segrow">${lab('名前',inp(`${p}.name`,c.name,{re:1}))}${lab('顔グラフィック（標準）',sel(`${p}.img`,imgOpts(),c.img,{re:1}))}
          <span class="grow"></span><button class="small danger" data-act="delChar" data-i="${i}">削除</button></div></div>
        ${c.faces.map((fc,k)=>`<div class="segrow sub2">${lab('表情の名前',inp(`${p}.faces.${k}.name`,fc.name,{ph:'笑顔 など',w:120}))}${lab('画像',sel(`${p}.faces.${k}.img`,imgOpts(),fc.img,{re:1}))}${fc.img?`<img class="sethumb" src="${esc(scnImgUrl(S,fc.img))}" alt="">`:''}<button class="small ghost" data-act="delFace" data-i="${i}" data-k="${k}">×</button></div>`).join('')}
        <button class="small" data-act="addFace" data-i="${i}">＋ 表情を追加</button></div>`; }).join('')}
    <button data-act="addChar">＋ 登場人物を追加</button>
    <label class="mini">ゲームのキャラから追加：<select data-addchar><option value="">選ぶ</option>${[...allUnits(),...allMasters()].map(u=>opt(u.id,u.name,'')).join('')}</select></label></section>`;
}
function assetsHTML(){
  const rows=Object.entries(S.assets).map(([k,a])=>{ const t=SCN_ASSET_TYPES[a.type], emb=a.src.startsWith('data:'), url=scnSafeSrc(a.src), p=`assets.${k}`;
    return `<div class="serow"><div class="segrow">
      ${t.kind==='img'?(url?`<img class="sethumb big" src="${esc(url)}" alt="">`:'<span class="sethumb big none">未設定</span>'):(url?`<audio controls preload="none" src="${esc(url)}"></audio>`:'<span class="sub small">未設定</span>')}
      ${lab('種類',sel(`${p}.type`,Object.entries(SCN_ASSET_TYPES).filter(([,x])=>x.kind===t.kind).map(([v,x])=>[v,x.name]),a.type,{re:1}))}
      ${lab('名前',inp(`${p}.name`,a.name))}
      ${emb?`<span class="sub small">埋め込み ${(a.src.length*.75/1024).toFixed(0)} KB</span>`:lab(`パス <small>${SCN_ASSET_DIR} の中</small>`,inp(`${p}.src`,a.src,{ph:'bg/room.webp',re:1}))}
      <span class="grow"></span><button class="small" data-act="assetFile" data-k="${esc(k)}">ファイルを${emb?'差し替え':'埋め込む'}</button><button class="small danger" data-act="delAsset" data-k="${esc(k)}">削除</button></div></div>`; }).join('');
  return `<section class="sec"><h2>素材（背景・顔グラフィック・BGM・効果音）</h2>
    <p class="sub small nm">ファイルを選ぶとJSONに埋め込みます（画像は自動で縮小・WebP化：背景は長辺1920px、顔は512pxまで）。<code>${SCN_ASSET_DIR}</code> に置いたファイルを使うときは「パスで追加」。音声は埋め込むとJSONが大きくなります。</p>
    <div class="segrow addbar">${sel('__addType',Object.entries(SCN_ASSET_TYPES).map(([v,x])=>[v,x.name]),E.addType)}<button data-act="assetFile" data-k="">ファイルから追加（複数可）</button><button data-act="assetPath">パスで追加</button></div>
    ${rows||'<p class="sub">まだ素材がありません。</p>'}</section>`;
}
function unitsHTML(){
  const row=(u,i,m)=>{ const o=S.unitImgs[u.id]||{face:'',card:''}, base=BASE[m?'masters':'units'].some(x=>x.id===u.id);
    return `<div class="serow"><div class="segrow"><b>${esc(u.name)}</b><span class="chip">${esc(u.id)}</span><span class="chip">${m?TERMS.player:esc(u.cls)} ・ C${u.cost} ・ HP${u.hp}</span>${base?'<span class="chip fx buff">ゲームの同じIDのキャラを差し替え</span>':''}
      ${lab('キャラ画像',sel(`unitImgs.${u.id}.face`,assetOpts('img','（img/units の画像）'),o.face,{re:1}))}${m?'':lab('カード画像',sel(`unitImgs.${u.id}.card`,assetOpts('img','（キャラ画像と同じ）'),o.card,{re:1}))}
      <span class="grow"></span><button class="small danger" data-act="delUnit" data-m="${m?1:''}" data-i="${i}">削除</button></div></div>`; };
  return `<section class="sec"><h2>専用キャラ（このシナリオの中だけで使うキャラ）</h2>
    <p class="sub small nm">ペンシルエディタの「JSON を書き出し」で作ったファイルを読み込みます（同じIDのキャラは上書き）。敵専用のボスや、能力を調整した味方に使えます。
      ゲームにいるキャラと同じIDにすると、このシナリオの間だけそのキャラを差し替えます。図鑑や通常の対戦には出ません。</p>
    <div class="segrow addbar"><button data-act="importUnits" data-v="units">${TERMS.unit}のJSONを読み込む</button><button data-act="importUnits" data-v="masters">${TERMS.player}のJSONを読み込む</button></div>
    <h3 class="sehead">${TERMS.unit}</h3>${S.units.map((u,i)=>row(u,i,false)).join('')||'<p class="sub">なし</p>'}
    <h3 class="sehead">${TERMS.player}</h3>${S.masters.map((u,i)=>row(u,i,true)).join('')||'<p class="sub">なし</p>'}</section>`;
}
// コマンド1行ぶんの入力欄
function cmdFields(c,p){
  switch(c.t){
    case 'say': { const ch=scnChar(S,c.who);
      return `${sel(`${p}.pos`,Object.entries(SCN_POS).map(([v,l])=>[v,`${l}のウィンドウ`]),c.pos)}
        ${sel(`${p}.who`,[['','（地の文・顔なし）'],...S.chars.map(x=>[x.id,x.name||x.id])],c.who,{re:1})}
        ${ch&&ch.faces.length?sel(`${p}.face`,[['','標準'],...ch.faces.map(x=>[x.name,x.name])],c.face,{title:'表情'}):''}
        ${inp(`${p}.name`,c.name,{ph:'名前を変える（任意）',w:150})}
        <textarea class="setext" data-path="${p}.text" rows="2" placeholder="文章">${esc(c.text)}</textarea>`; }
    case 'choice': return `<div class="seopts">${c.opts.map((o,k)=>`<div class="segrow">${k+1}. ${inp(`${p}.opts.${k}.text`,o.text,{ph:'選択肢の文章',w:240})} → ${sel(`${p}.opts.${k}.to`,sceneOpts(),o.to)}
        <label class="mini">フラグ${inp(`${p}.opts.${k}.flag`,o.flag,{ph:'（任意）',w:90})}を${inp(`${p}.opts.${k}.v`,o.v,{num:1,w:60})}にする</label><button class="small ghost" data-act="delOpt" data-p="${p}" data-k="${k}">×</button></div>`).join('')}
        <button class="small" data-act="addOpt" data-p="${p}">＋ 選択肢</button></div>`;
    case 'bg': return `${sel(`${p}.img`,imgOpts('（背景なし・黒）'),c.img,{re:1})}<label class="mini">切り替え${inp(`${p}.fade`,c.fade,{num:1,w:70,min:0,step:100})}ミリ秒</label>`;
    case 'bgm': return sel(`${p}.audio`,assetOpts('audio','（BGMを止める）'),c.audio);
    case 'se': return sel(`${p}.audio`,assetOpts('audio'),c.audio);
    case 'fx': return sel(`${p}.kind`,Object.entries(SCN_FX),c.kind);
    case 'wait': return `<label class="mini">${inp(`${p}.ms`,c.ms,{num:1,w:80,min:0,step:100})}ミリ秒</label>`;
    case 'clear': return sel(`${p}.pos`,[['both','上と下'],['top','上'],['bottom','下']],c.pos);
    case 'set': return `<label class="mini">フラグ${inp(`${p}.flag`,c.flag,{ph:'フラグ名',w:120})}</label>${inp(`${p}.v`,c.v,{num:1,w:70})}${sel(`${p}.op`,Object.entries(SCN_OPS),c.op)}`;
    case 'if': return `<label class="mini">フラグ${inp(`${p}.flag`,c.flag,{ph:'フラグ名',w:120})}が</label>${inp(`${p}.v`,c.v,{num:1,w:70})}${sel(`${p}.cmp`,Object.entries(SCN_CMPS),c.cmp)}なら → ${sel(`${p}.to`,sceneOpts('（未設定）'),c.to)}<small class="sub">（未設定のフラグは 0）</small>`;
    case 'jump': return `→ ${sel(`${p}.to`,sceneOpts('（未設定）'),c.to)}`;
    case 'end': return `<textarea class="setext" data-path="${p}.text" rows="2" placeholder="最後に出す文章（任意）">${esc(c.text)}</textarea>`;
    case 'battle': { const rs=RULESETS[c.rule], us=allUnits(), ms=allMasters(), mo=none=>[['',none],...ms.map(m=>[m.id,`${m.name}（C${m.cost}）`])];
      return `<div class="sebattle">
        <div class="segrow">${lab('ルール',sel(`${p}.rule`,Object.entries(RULESETS).map(([k,r])=>[k,r.name]),c.rule,{re:1}))}${lab('CPUの強さ',sel(`${p}.level`,Object.entries(CPU_LEVELS).map(([k,l])=>[k,l.name]),c.level))}
          ${rs.partyMax>1?lab(`コスト上限 <small>0＝ルールどおり（${rs.costCap||RULES.costCap}）</small>`,inp(`${p}.cap`,c.cap,{num:1,w:70,min:0})):''}</div>
        <div class="sebox"><b>自分の編成</b><div class="segrow">${lab('決め方',sel(`${p}.party.mode`,Object.entries(SCN_PARTY_MODES),c.party.mode,{re:1}))}
          ${rs.master?lab(`${TERMS.player}${c.party.mode==='fixed'?'':'を固定'}`,sel(`${p}.party.master`,mo(c.party.mode==='fixed'?'（未設定）':'（自由に選ぶ）'),c.party.master)):''}</div>
          <div class="segrow"><span class="selab">${c.party.mode==='fixed'?'メンバー':'固定メンバー（必ず出撃）'}</span>${idList(`${p}.party.lock`,us,rs.partyMax)}</div>
          ${c.party.mode==='fixed'?'':`<div class="segrow"><span class="selab">選べるキャラ <small>空＝ゲームの全キャラ</small></span>${idList(`${p}.party.pool`,us)}</div>`}</div>
        <div class="sebox"><b>相手（CPU）</b><div class="segrow"><span class="selab">${TERMS.unit}（最大${rs.partyMax}騎・1番目が先頭）</span>${idList(`${p}.enemy.units`,us,rs.partyMax)}</div>
          <div class="segrow">${rs.master?lab(TERMS.player,sel(`${p}.enemy.master`,mo('（未設定）'),c.enemy.master)):''}${lab('表示名 <small>空＝CPU</small>',inp(`${p}.enemy.name`,c.enemy.name,{w:140}))}</div></div>
        <div class="segrow">${lab('勝ったら',sel(`${p}.win`,sceneOpts(),c.win))}${lab('負けたら',sel(`${p}.lose`,[['','再挑戦（勝つまで進めない）'],[SCN_LOSE_NEXT,'負けても続きへ'],...S.scenes.map((s,i)=>[s.id,`${i+1}. ${s.name||s.id} へ`])],c.lose))}</div></div>`; }
  }
  return '';
}
function sceneHTML(){
  const i=E.scene, sc=S.scenes[i];
  if(!sc) return '<section class="sec"><p>シーンがありません。「＋ シーンを追加」から作成してください。</p></section>';
  const add=(j)=>`<span class="seadd"><select data-addcmd="${j}"><option value="">＋ ここに追加</option>${Object.entries(SCN_CMDS).map(([k,v])=>opt(k,v,'')).join('')}</select></span>`;
  return `<section class="sec"><h2>シーン ${i+1}</h2><div class="segrow">${lab('シーンの名前',inp(`scenes.${i}.name`,sc.name,{re:1,w:260}))}
      <span class="grow"></span><button class="small" data-act="moveScene" data-d="-1" ${i?'':'disabled'}>↑ 前へ</button><button class="small" data-act="moveScene" data-d="1" ${i<S.scenes.length-1?'':'disabled'}>↓ 後ろへ</button>
      <button class="small" data-act="dupScene">複製</button><button class="small danger" data-act="delScene" ${S.scenes.length>1?'':'disabled'}>シーンを削除</button></div></section>
    <div class="secmds">${add(0)}${sc.cmds.map((c,j)=>`<div class="secmd t-${c.t} ${E.cur===j?'cur':''}" data-j="${j}">
        <div class="sehd"><span class="seno">${j+1}</span><b>${SCN_CMDS[c.t]}</b><span class="grow"></span>
          <button class="small ghost" data-act="moveCmd" data-j="${j}" data-d="-1" ${j?'':'disabled'} title="上へ">↑</button><button class="small ghost" data-act="moveCmd" data-j="${j}" data-d="1" ${j<sc.cmds.length-1?'':'disabled'} title="下へ">↓</button>
          <button class="small ghost" data-act="dupCmd" data-j="${j}" title="複製">複製</button><button class="small ghost danger" data-act="delCmd" data-j="${j}" title="削除">×</button></div>
        <div class="sebody">${cmdFields(c,`scenes.${i}.cmds.${j}`)}</div></div>${add(j+1)}`).join('')}</div>
    <div class="segrow sequick"><button data-act="quick" data-pos="bottom">＋ セリフ（下）</button><button data-act="quick" data-pos="top">＋ セリフ（上）</button><small class="sub">最後に追加します（直前の同じ側の話者を引き継ぎます）</small></div>`;
}

// ---------- 右：検証とプレビュー ----------
function drawSide(){
  const iss=validateScenario(S,BASE), sc=S.scenes[E.scene];
  let prev='';
  if(E.tab==='scene'&&sc){ // 選んでいる行までをシーンの頭からなぞって、その時点の画面を作る
    const wins={top:null,bottom:null}; let bg='', cur='bottom', ch=null;
    sc.cmds.slice(0,E.cur+1).forEach(c=>{ if(c.t==='bg') bg=c.img; else if(c.t==='say'){ wins[c.pos]=c; cur=c.pos; } else if(c.t==='clear') (c.pos==='both'?['top','bottom']:[c.pos]).forEach(p=>wins[p]=null); ch=c.t==='choice'?c:null; });
    const url=scnImgUrl(S,bg), win=p=>`<div class="sn-win ${p} ${wins[p]?'':'empty'} ${wins[p]&&cur!==p?'dim':''}">${scnWinInner(S,wins[p],{},true)}</div>`;
    prev=`<div class="sidecard"><h3>プレビュー <small class="sub">${E.cur+1}行目の時点</small></h3><div class="sn-play mini"><div class="sn-bg"><i class="on" ${url?`style="background-image:url('${esc(url)}')"`:''}></i></div>
      <div class="sn-stage">${win('top')}<div class="sn-choices" ${ch?'style="display:flex"':''}>${ch?ch.opts.map(o=>`<button tabindex="-1">${esc(o.text)}</button>`).join(''):''}</div>${win('bottom')}</div></div></div>`;
  }
  $('#side').innerHTML=`${prev}<div class="sidecard"><h3>チェック</h3>${iss.length?`<ul class="issues">${iss.map(x=>`<li class="${x.level}">${x.scene!=null?`<a href="#" data-act="goto" data-i="${x.scene}" data-j="${x.cmd??0}">シーン${x.scene+1}${x.cmd!=null?`-${x.cmd+1}`:''}</a>：`:''}${esc(x.msg)}</li>`).join('')}</ul>`:'<p class="clean nm">問題は見つかりませんでした。</p>'}</div>`;
}
function draw(){ drawList(); drawForm(); drawSide(); drawStatus(); }

// ---------- 参照の掃除（削除したシーン・人物・素材を指している所を空にする） ----------
function eachCmd(fn){ S.scenes.forEach(sc=>sc.cmds.forEach(fn)); }
function dropScene(id){ if(S.start===id) S.start=''; eachCmd(c=>{ if(c.to===id) c.to=''; if(c.win===id) c.win=''; if(c.lose===id) c.lose=''; if(c.opts) c.opts.forEach(o=>{ if(o.to===id) o.to=''; }); }); }
function dropAsset(k){ if(S.cover===k) S.cover=''; S.chars.forEach(c=>{ if(c.img===k) c.img=''; c.faces.forEach(f=>{ if(f.img===k) f.img=''; }); });
  Object.values(S.unitImgs).forEach(o=>{ if(o.face===k) o.face=''; if(o.card===k) o.card=''; }); eachCmd(c=>{ if(c.img===k) c.img=''; if(c.audio===k) c.audio=''; }); }

// ---------- 素材の取り込み ----------
const readAs = (file,how)=>new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=()=>rej(r.error); r[how](file); });
// 画像は縮小して WebP に（ブラウザが WebP で書き出せない・かえって大きくなるときは元のまま）
async function imageToDataUrl(file,max){
  const src=await readAs(file,'readAsDataURL');
  const im=await new Promise((res,rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=()=>rej(new Error('画像として読めません')); i.src=src; });
  const k=Math.min(1,max/Math.max(im.naturalWidth,im.naturalHeight)), cv=document.createElement('canvas');
  cv.width=Math.round(im.naturalWidth*k); cv.height=Math.round(im.naturalHeight*k); cv.getContext('2d').drawImage(im,0,0,cv.width,cv.height);
  const out=cv.toDataURL('image/webp',.86);
  return out.startsWith('data:image/webp')&&(k<1||out.length<src.length)?out:src;
}
async function addAssetFiles(files){
  const P=E.pendAsset; if(!P) return;
  for(const file of files){
    const type=P.key?S.assets[P.key].type:P.type, kind=SCN_ASSET_TYPES[type].kind;
    try{
      if(kind==='img'&&!file.type.startsWith('image/')) throw new Error('画像ファイルを選んでください');
      if(kind==='audio'&&!file.type.startsWith('audio/')&&!/^video\/(ogg|webm|mp4)$/.test(file.type)) throw new Error('音声ファイルを選んでください');
      const src=kind==='img'?await imageToDataUrl(file,type==='face'?512:1920):await readAs(file,'readAsDataURL');
      if(!scnSafeSrc(src)) throw new Error('この形式は使えません');
      if(P.key) S.assets[P.key].src=src;
      else S.assets[newId(type,Object.keys(S.assets))]={type, name:file.name.replace(/\.[^.]+$/,''), src};
      if(kind==='audio'&&file.size>1.5*1024*1024) toast(`「${file.name}」は ${(file.size/1048576).toFixed(1)} MB あります。JSONが大きくなるので、フォルダに置いてパスで指定する方法も検討してください`);
    }catch(e){ toast(`${file.name}：${e.message||e}`,true); }
  }
  dirty(); draw();
}

// ---------- 入力 ----------
function loadScenario(s,msg){ S=s; E.tab='scene'; E.scene=0; E.cur=0; dirty(); draw(); if(msg) toast(msg); }
function onAct(a,ds){
  const sc=S.scenes[E.scene], j=Number(ds.j), i=Number(ds.i), k=Number(ds.k);
  switch(a){
    case 'tab': E.tab=ds.v; break;
    case 'scene': E.tab='scene'; E.scene=i; E.cur=0; break;
    case 'goto': E.tab='scene'; E.scene=i; E.cur=j; break;
    case 'addScene': { const id=newId('scene',S.scenes.map(x=>x.id)); S.scenes.push({id, name:`シーン${S.scenes.length+1}`, cmds:[scnNormCmd({t:'say'})]}); E.tab='scene'; E.scene=S.scenes.length-1; E.cur=0; break; }
    case 'dupScene': { const c=clone(sc); c.id=newId('scene',S.scenes.map(x=>x.id)); c.name+='（複製）'; S.scenes.splice(E.scene+1,0,c); E.scene++; break; }
    case 'delScene': if(S.scenes.length<2||!confirm(`シーン「${sc.name}」を削除しますか？`)) return; dropScene(sc.id); S.scenes.splice(E.scene,1); E.scene=Math.max(0,E.scene-1); E.cur=0; break;
    case 'moveScene': { const d=Number(ds.d), t=E.scene+d; if(t<0||t>=S.scenes.length) return; S.scenes.splice(t,0,S.scenes.splice(E.scene,1)[0]); E.scene=t; break; }
    case 'delCmd': sc.cmds.splice(j,1); E.cur=Math.min(E.cur,Math.max(0,sc.cmds.length-1)); break;
    case 'dupCmd': sc.cmds.splice(j+1,0,clone(sc.cmds[j])); E.cur=j+1; break;
    case 'moveCmd': { const t=j+Number(ds.d); if(t<0||t>=sc.cmds.length) return; sc.cmds.splice(t,0,sc.cmds.splice(j,1)[0]); E.cur=t; break; }
    case 'quick': { const last=[...sc.cmds].reverse().find(c=>c.t==='say'&&c.pos===ds.pos); sc.cmds.push(scnNormCmd({t:'say',pos:ds.pos,who:last?last.who:'',face:last?last.face:''})); E.cur=sc.cmds.length-1; break; }
    case 'addOpt': get(ds.p).opts.push({text:'',to:'',flag:'',v:1}); break;
    case 'delOpt': get(ds.p).opts.splice(k,1); break;
    case 'delId': get(ds.p).splice(k,1); break;
    case 'addChar': S.chars.push({id:newId('c',S.chars.map(c=>c.id)), name:'', img:'', faces:[]}); break;
    case 'delChar': { const id=S.chars[i].id; if(!confirm(`登場人物「${S.chars[i].name||id}」を削除しますか？`)) return; S.chars.splice(i,1); eachCmd(c=>{ if(c.t==='say'&&c.who===id){ c.who=''; c.face=''; } }); break; }
    case 'addFace': S.chars[i].faces.push({name:'',img:''}); break;
    case 'delFace': S.chars[i].faces.splice(k,1); break;
    case 'assetFile': E.pendAsset=ds.k?{key:ds.k}:{type:E.addType}; { const f=$('#afile'), kind=SCN_ASSET_TYPES[ds.k?S.assets[ds.k].type:E.addType].kind; f.accept=kind==='img'?'image/*':'audio/*'; f.multiple=!ds.k; f.value=''; f.click(); } return;
    case 'assetPath': S.assets[newId(E.addType,Object.keys(S.assets))]={type:E.addType, name:'', src:''}; break;
    case 'delAsset': if(!confirm(`素材「${S.assets[ds.k].name||ds.k}」を削除しますか？（使っている場所は「なし」になります）`)) return; dropAsset(ds.k); delete S.assets[ds.k]; break;
    case 'importUnits': E.pendUnits=ds.v; $('#ufile').value=''; $('#ufile').click(); return;
    case 'delUnit': { const list=ds.m?S.masters:S.units, id=list[i].id; list.splice(i,1); delete S.unitImgs[id]; break; }
    case 'new': if(!confirm('いまの内容を捨てて、新しいシナリオを作りますか？（必要なら先にJSONを書き出してください）')) return; loadScenario(newScenario()); return;
    case 'import': $('#file').value=''; $('#file').click(); return;
    case 'export': downloadText(`${S.id||'scenario'}.json`,JSON.stringify(S),'application/json'); toast('JSONを書き出しました'); return;
    case 'test': {
      if(scenarioHasErrors(S,BASE)){ toast('エラーがあるため試せません（右の「チェック」を見てください）',true); return; }
      const w=window.open('about:blank','_blank'); // 保存を待つ前に開く（あとから開くとポップアップ扱いで止められる）
      scnDbPut(scnImpKey(S.id),S).then(()=>{ const url='index.html#scn='+encodeURIComponent(S.id); if(w) w.location.href=url; else location.href=url; })
        .catch(()=>{ if(w) w.close(); toast('保存できませんでした（容量不足の可能性があります）',true); });
      return; }
    default: return;
  }
  dirty(); draw();
}
document.addEventListener('click',e=>{
  const row=e.target.closest('.secmd'); // 行を選ぶとプレビューがその時点になる
  if(row&&E.cur!==Number(row.dataset.j)){ E.cur=Number(row.dataset.j); document.querySelectorAll('.secmd.cur').forEach(x=>x.classList.remove('cur')); row.classList.add('cur'); drawSide(); }
  const b=e.target.closest('[data-act]'); if(!b||b.disabled) return;
  if(b.tagName==='A') e.preventDefault();
  onAct(b.dataset.act,b.dataset);
});
document.addEventListener('focusin',e=>{ const row=e.target.closest&&e.target.closest('.secmd'); if(row&&E.cur!==Number(row.dataset.j)){ E.cur=Number(row.dataset.j); document.querySelectorAll('.secmd.cur').forEach(x=>x.classList.remove('cur')); row.classList.add('cur'); drawSide(); } });
document.addEventListener('input',e=>{
  const t=e.target, p=t.dataset&&t.dataset.path; if(!p) return;
  if(p==='__addType'){ E.addType=t.value; return; }
  if(p.startsWith('unitImgs.')){ const id=p.split('.')[1]; if(!S.unitImgs[id]) S.unitImgs[id]={face:'',card:''}; }
  setPath(p,t.dataset.num!=null?(Number.isFinite(+t.value)&&t.value!==''?+t.value:0):t.value);
  dirty();
});
document.addEventListener('change',e=>{
  const t=e.target, ds=t.dataset||{};
  if(ds.addcmd!=null&&t.value){ const j=Number(ds.addcmd), sc=S.scenes[E.scene]; sc.cmds.splice(j,0,scnNormCmd(t.value==='choice'?{t:'choice',opts:[{text:''},{text:''}]}:{t:t.value})); E.cur=j; dirty(); draw(); return; }
  if(ds.addid&&t.value){ get(ds.addid).push(t.value); dirty(); draw(); return; }
  if(ds.addchar&&t.value){ const u=[...allUnits(),...allMasters()].find(x=>x.id===t.value); S.chars.push({id:newId('c',S.chars.map(c=>c.id)), name:u.name, img:'unit:'+u.id, faces:[]}); dirty(); draw(); return; }
  if(ds.path&&ds.re!=null){ if(ds.path.endsWith('.who')){ const c=get(ds.path.replace(/\.who$/,'')); c.face=''; } draw(); }
  if(t.id==='afile'&&t.files.length) addAssetFiles([...t.files]);
  if(t.id==='file'&&t.files[0]) readAs(t.files[0],'readAsText').then(txt=>loadScenario(parseScenarioText(String(txt)),'読み込みました')).catch(err=>toast(`読み込めませんでした：${err.message||err}`,true));
  if(t.id==='ufile'&&t.files[0]) readAs(t.files[0],'readAsText').then(txt=>{
    const m=E.pendUnits==='masters', inc=m?parseMastersFile(String(txt)):parseUnitsFile(String(txt)), list=m?S.masters:S.units;
    if(!m&&inc.some(u=>Array.isArray(u.spells))) throw new Error(`${TERMS.player}のデータです`);
    inc.forEach(u=>{ const at=list.findIndex(x=>x.id===u.id); if(at>=0) list[at]=u; else list.push(u); });
    dirty(); draw(); toast(`${inc.length}件を読み込みました`);
  }).catch(err=>toast(`読み込めませんでした：${err.message||err}`,true));
});

// ---------- 起動 ----------
scnDbGet('draft').then(d=>{ if(d){ try{ S=normScenario(d); }catch(e){} } }).catch(()=>{}).then(draw);
