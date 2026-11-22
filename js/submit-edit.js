'use strict';
/* =====================================================================
   申請ツールの編集フォーム（submit.js から使う）
   名前・数値・セリフ・スキル/宝具/面の効果を、その場で書き換える（S.units[i] を直接変える）。
   入力欄は data-i（何体目）・data-p（"faces.0.pre.dmg" のようなパス）・data-t（値の型）を持つ。
     data-t：num 数 / str 文字 / optnum 空なら消す数 / optstr 空なら消す文字 / lines 1行1つの配列 / list 「、」区切りの配列 / bool チェック
   文字・数の入力（input）では検査欄だけ更新し、フォームは作り直さない（入力中のカーソルを保つ）。
   形が変わる操作（効果の種類・コマンドの色・効果の追加/削除）では、その体のフォームを作り直す。
   エディタ（editor.html）の機能のうち、条件つき効果・タイミングなどの細かい設定は編集できない（読み込んだ値はそのまま残る）。
   ===================================================================== */

const pGet=(o,p)=>p.split('.').reduce((a,k)=>a==null?a:a[k],o);
function pSet(o,p,v){ const ks=p.split('.'), last=ks.pop(), t=ks.reduce((a,k)=>a[k],o); if(v===undefined) delete t[last]; else t[last]=v; }
const eAttr=(i,p,t)=>`data-i="${i}" data-p="${esc(p)}" data-t="${t}"`;
const eOpt=(v,label,cur)=>`<option value="${esc(v)}"${String(v)===String(cur??'')?' selected':''}>${esc(label)}</option>`;
function eNum(i,p,v,label,w=''){ return `<label class="ef"><span>${label}</span><input type="number" class="${w}" ${eAttr(i,p,'num')} value="${esc(v??0)}"></label>`; }
function eTxt(i,p,v,label,cls='',ph=''){ return `<label class="ef ${cls}"><span>${label}</span><input ${eAttr(i,p,'str')} value="${esc(v??'')}" placeholder="${esc(ph)}"></label>`; }

// 場所ごとの効果の追加時の初期値
const EFF_NEW={ skill:{k:'atk',t:'self',v:20,turns:3}, ult:{k:'dmg',t:'enemy_all',v:200}, special:{k:'atk',t:'self',v:10,turns:1} };

// ---- 効果1つ：共通部品 effRowHTML（eff-ui.js）を使う ----
// その効果の持ち主（スキル・宝具）の「対象の選び方」。面の効果には無い
const ownerPick=(u,path)=>{ const m=/^(skills.d+|ult).eff$/.exec(path); return m?pGet(u,m[1]+'.pick'):undefined; };
function effRowE(i,path,j,e,ctx){
  const p=`${path}.${j}`;
  return effRowHTML(e,{ ctx, path:p, attr:(pp,t)=>eAttr(i,pp,t), more:S.more.has(i+':'+p), pick:ownerPick(S.units[i],path),
    btn:act=>`data-act="${act}" data-i="${i}" data-path="${path}" data-j="${j}" data-ctx="${ctx}"` });
}
function effListE(i,path,effs,ctx){
  return `<div class="effs">${(effs||[]).map((e,j)=>effRowE(i,path,j,e,ctx)).join('')}<button class="small" data-act="effAdd" data-i="${i}" data-path="${path}" data-ctx="${ctx}">＋効果</button></div>`;
}

// ---- コマンド（面の片側） ----
function cmdE(i,fi,side,c){
  const p=`faces.${fi}.${side}`;
  const lab=side==="pre"?`${TERMS.asc}前`:`${TERMS.asc}後`;
  if(c.c==="ASC") return `<td class="asc" data-l="${lab}">${TERMS.asc}（この面が出ると${TERMS.asc}）</td>`;
  const kinds=['R','B','G','W'];
  return `<td data-l="${lab}"><div class="cmdrow cmd-${esc(c.c)}">
      <select data-act="cmdColor" data-i="${i}" data-cp="${p}" aria-label="コマンド">${kinds.map(k=>eOpt(k,k==='W'?'特殊行動':TERMS[k],c.c)).join('')}</select>
      ${c.c==='W'?eTxt(i,p+'.label',c.label,'技名','mid'):''}
      ${eNum(i,p+'.dmg',c.dmg,'ダメージ','n3')}${eNum(i,p+'.np',c.np,'NP','n2')}${eNum(i,p+'.star',c.star,'スター','n2')}
    </div>
    ${c.c==='W'||(c.eff&&c.eff.length)?effListE(i,p+'.eff',c.eff,'special'):`<button class="small ghost" data-act="effAdd" data-i="${i}" data-path="${p}.eff" data-ctx="special">＋付加効果</button>`}</td>`;
}

// ---- 1体ぶんのフォーム ----
function editFormHTML(u,i){
  const pickSel=(p,v)=>`<label class="ef"><span>対象の選び方</span><select ${eAttr(i,p,'optstr')}>${Object.entries(PICKS).map(([k,n])=>eOpt(k,n,v||'')).join('')}</select></label>`;
  const basic=`<div class="egrid">
      ${eTxt(i,'name',u.name,'名前','mid')}${eTxt(i,'id',u.id,'ID（半角英数字）','')}
      <label class="ef"><span>クラス</span><input list="clslist" ${eAttr(i,'cls','str')} value="${esc(u.cls)}"></label>
      ${eNum(i,'cost',u.cost,'コスト','n2')}${eNum(i,'hp',u.hp,'HP','n3')}
      <label class="ef wide"><span>属性（「、」区切り）</span><input ${eAttr(i,'traits','list')} value="${esc((u.traits||[]).join('、'))}"></label>
      <label class="ef wide"><span>出典（設定ページのURL。フリー素材の多くは明記が条件）</span><input type="url" ${eAttr(i,'link','optstr')} value="${esc(u.link||'')}" placeholder="https://"></label>
    </div>`;
  const faces=`<table class="eface"><tr><th>出目</th><th>${TERMS.asc}前</th><th>${TERMS.asc}後</th></tr>
      ${u.faces.map((f,fi)=>`<tr><th>${fi+1}</th>${cmdE(i,fi,'pre',f.pre)}${cmdE(i,fi,'post',f.post)}</tr>`).join('')}</table>`;
  const skills=u.skills.map((s,si)=>`<div class="eblk"><div class="egrid"><b class="eno">S${si+1}</b>${eTxt(i,`skills.${si}.name`,s.name,'スキル名','mid')}${eTxt(i,`skills.${si}.rank`,s.rank,'ランク','n2')}${pickSel(`skills.${si}.pick`,s.pick)}
      ${si===2?`<span class="sub">${TERMS.asc}後に使える</span>`:''}</div>${effListE(i,`skills.${si}.eff`,s.eff,'skill')}</div>`).join('');
  const ult=`<div class="eblk"><div class="egrid"><b class="eno">${TERMS.ult}</b>${eTxt(i,'ult.name',u.ult.name,'名前','mid')}${eTxt(i,'ult.ruby',u.ult.ruby,'読み（ルビ）','mid')}
      <label class="ef"><span>色</span><select ${eAttr(i,'ult.c','str')}>${['R','B','G'].map(c=>eOpt(c,TERMS[c],u.ult.c)).join('')}</select></label>${pickSel('ult.pick',u.ult.pick)}</div>
      ${effListE(i,'ult.eff',u.ult.eff,'ult')}</div>`;
  const lines=`<div class="elines">${Object.entries(LINE_KEYS).map(([k,n])=>`<label class="ef"><span>${n}${LINE_MIN[k]?`（${LINE_MIN[k]}種類以上）`:''}</span><textarea rows="2" ${eAttr(i,'lines.'+k,'lines')} placeholder="1行に1つ">${esc((u.lines[k]||[]).join('\n'))}</textarea></label>`).join('')}</div>`;
  const sec=(t,body,open)=>`<details class="esec"${open?' open':''}><summary>${t}</summary>${body}</details>`;
  return `<div class="uedit" data-i="${i}">
    ${sec('基本情報',basic,true)}${sec('鉛筆の面（ダメージ・NP・スター）',faces,true)}${sec(`スキル・${TERMS.ult}`,skills+ult,true)}${sec('セリフ',lines,false)}
  </div>`;
}

// ---- 入力 → データ ----
function editValue(el){
  const t=el.dataset.t, v=el.type==='checkbox'?el.checked:el.value;
  switch(t){
    case 'num': return Number(v)||0;
    case 'optnum': return v===''?undefined:Number(v);
    case 'optstr': return String(v).trim()?String(v).trim():undefined;
    case 'lines': return String(v).split('\n').map(x=>x.trim()).filter(Boolean);
    case 'list': return [...new Set(String(v).split(/[、,，\s]+/).map(x=>x.trim()).filter(Boolean))];
    case 'bool': return el.checked?true:undefined;
    default: return String(v);
  }
}
// 形が変わる操作：true を返したら、その体のフォームを作り直す
function editStructural(el){
  const i=+el.dataset.i, u=S.units[i];
  switch(el.dataset.act){
    case 'cmdColor': { // コマンドの種類を変える：特殊行動なら技名と効果欄を用意し、R/B/G なら技名を外す
      const p=el.dataset.cp, old=pGet(u,p), c=el.value, base={dmg:old.dmg||0,np:old.np||0,star:old.star||0};
      pSet(u,p,c==='W'?{c:'W',label:old.label||'特殊行動',eff:old.eff||[],...base}:{c,...base,...(old.eff&&old.eff.length?{eff:old.eff}:{})}); return true; }
  }
  return false;
}
function editClick(b){
  const i=+b.dataset.i, u=S.units[i], path=b.dataset.path, p=path&&path+'.'+b.dataset.j;
  switch(b.dataset.act){
    case 'effAdd': { let a=pGet(u,path); if(!a){ pSet(u,path,[]); a=pGet(u,path); } a.push({...EFF_NEW[b.dataset.ctx]}); return i; }
    case 'effDel': pGet(u,path).splice(+b.dataset.j,1); S.more.clear(); return i;
    case 'effMore': S.more.has(i+':'+p)?S.more.delete(i+':'+p):S.more.add(i+':'+p); return i;
    case 'effPick': { const old=pGet(u,p), ctx=b.dataset.ctx; // 選ぶ画面を開き、選んだら種類を変えてフォームを作り直す
      EffPick.open({ ctx, cur:old.k, onPick:k=>{ if(k===old.k) return; pSet(u,p,effKindChange(old,k,ctx,ownerPick(u,path))); edited(i,true); } }); return null; }
  }
  return null;
}
