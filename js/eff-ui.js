'use strict';
/* =====================================================================
   効果（Eff）の編集部品：申請ツール（submit-edit.js）で使い、エディタにも使えるように画面側の事情を持たない
   読み込み順：rules → units → masters → common → guide（FX_HELP）→ eff-ui
   - EffPick：効果の種類を選ぶ画面（言葉で検索・分類・説明文・今のキャラでの使われ方を見ながら選ぶ）
   - effRowHTML：効果1つの入力行。「［対象］に［効果］［値］［3ターン］」の文章の形。細かい設定は「詳しく」を開いたときだけ
   - effKindChange：効果の種類を変えたときに、対象・値・効果時間を新しい種類に合う形に整える
   操作はすべて document で受ける（data-epk＝選択画面の中 / 行のボタンは使う側が data-act で受ける）
   ===================================================================== */

// ---- 今のキャラ（原作キャラを除く）での使われ方：場所（skill / ult / special）× 効果 ----
const EFF_CTX_NAME={skill:'スキル',ult:TERMS.ult,special:'面'};
function effStats(){
  if(effStats.c) return effStats.c;
  const m={skill:{},ult:{},special:{}};
  const units=(typeof DEFAULT_UNITS!=='undefined'?normalizeUnits(DEFAULT_UNITS):[]).filter(u=>!CANON_UNIT_IDS.includes(u.id));
  const add=(ctx,e)=>{ const s=m[ctx][e.k]||(m[ctx][e.k]={n:0,pats:new Map()}); s.n++; const k=effPatText(e); s.pats.set(k,(s.pats.get(k)||0)+1); };
  for(const u of units){
    u.skills.forEach(s=>s.eff.forEach(e=>add('skill',e)));
    u.ult.eff.forEach(e=>add('ult',e));
    u.faces.forEach(f=>['pre','post'].forEach(k=>(f[k].eff||[]).forEach(e=>add('special',e))));
  }
  return effStats.c=m;
}
// 使われ方の1件を短い文に（例：「自身 20・3T」）
function effPatText(e){
  const f=FX[e.k]||{};
  const v=e.k==='cardUp'?`威力${e.v}/NP${e.np}/スター${e.star}`:f.val?(e.max?'最大HP':String(e.v)):'';
  const d=[e.turns?`${e.turns}T`:'',e.times?`${e.times}回`:'',e.chance?`ロール${e.chance}以下`:''].filter(Boolean).join('・');
  return [f.noTgt?'':(TARGETS[e.t]||e.t), [v,e.color?TERMS[e.color]:'',e.trait?`「${e.trait}」`:'',d].filter(Boolean).join('・')].filter(Boolean).join(' ');
}
const effUseCount=(ctx,k)=>((effStats()[ctx]||{})[k]||{n:0}).n;
// よく使われる形（多い順に max 件）
function effUseHint(ctx,k,max=3){
  const s=(effStats()[ctx]||{})[k]; if(!s) return '';
  return [...s.pats.entries()].sort((a,b)=>b[1]-a[1]).slice(0,max).map(([t,n])=>`${t}${n>1?`（${n}件）`:''}`).join('／');
}
const effHelp=k=>(typeof FX_HELP!=='undefined'&&FX_HELP[k])||'';
const effKindLabel=k=>{ const f=FX[k]||{}; return f.inst||f.noTgt?'即時':f.buff===true?'強化':f.buff===false?'弱体':''; };

// 検索の読みかえ（ひらがなで打っても見つかるように。名前・説明文に出てこない言い方も足す）
const EFF_ALIAS={
  atk:'こうげき 攻撃力 ばふ バフ', atkPct:'こうげき 攻撃力 ぱーせんと 倍率', def:'ぼうぎょ 防御 軽減 けいげん', defDown:'ぼうぎょだうん 防御ダウン 被ダメ',
  atkDown:'こうげきだうん 攻撃ダウン', evade:'かいひ よける', invul:'むてき', guts:'がっつ 根性 こんじょう 戦闘続行 せんとうぞっこう', taunt:'たげしゅう ターゲット集中 挑発 ちょうはつ かばう',
  sureHit:'ひっちゅう', pierce:'むてきかんつう 貫通', ignoreDef:'ぼうぎょむし 防御無視', critPow:'くりてぃかる クリ', critRoll:'くりてぃかる クリ', critMult:'くりてぃかる クリ 倍率',
  npPow:'ほうぐいりょく 宝具威力', np:'えぬぴー NP チャージ ちゃーじ 魔力 まりょく 充填', star:'すたー スター', regenNp:'えぬぴー NP 毎ターン', regenHp:'かいふく 回復 毎ターン 継続回復',
  heal:'かいふく 回復 ひーる', poison:'どく 毒', burn:'やけど 火傷', stun:'すたん 行動不能', charm:'みりょう 魅了', fear:'きょうふ 恐怖', curse:'のろい 呪い',
  strip:'きょうかかいじょ 強化解除 ばふけし', cleanse:'じゃくたいかいじょ 弱体解除 でばふけし', instantDeath:'そくし 即死', sealSkill:'すきるふういん 封印', sealUlt:'ほうぐふういん 封印',
  dmg:'だめーじ ダメージ 攻撃 こうげき', multiHit:'れんぞく 連続 れんげき', selfDmg:'じしょう 自傷', counter:'はんげき 反撃 かうんたー', maxHp:'さいだいHP 最大HP',
  cardUp:'かーど カード性能 ばすたー あーつ くいっく', cardConv:'かーどへんかん カード変換', aoeNormal:'ぜんたい 全体化', aoe:'ぜんたい 全体化', desc:'せつめい 説明',
  debuffImmune:'じゃくたいむこう 弱体無効', buffImmune:'きょうかむこう 強化無効', healBlock:'かいふくふか 回復不可',
};
const effKana=s=>String(s||'').toLowerCase().replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60)).replace(/\s+/g,'');
function effMatch(k,q){
  if(!q) return true;
  const f=FX[k], text=effKana([k,f.name,effHelp(k),EFF_ALIAS[k]||'',fxGroupOf(k)].join(' '));
  return effKana(q).split(/[,、]/).filter(Boolean).every(w=>text.includes(w));
}

// ---- 効果の種類を選ぶ画面 ----
const EffPick={
  o:null, q:'', tab:'often', act:0, list:[],
  // o = { ctx:'skill'|'ult'|'special', cur:今の効果キー, onPick:k=>{} }
  open(o){
    this.o=o; this.q=''; this.tab=effUseCount(o.ctx,o.cur)||!o.cur?'often':fxGroupOf(o.cur); this.act=0;
    let el=document.getElementById('effpick');
    if(!el){ el=document.createElement('div'); el.id='effpick'; el.className='epk-back'; document.body.appendChild(el); }
    el.hidden=false;
    el.innerHTML=`<div class="epk" role="dialog" aria-label="効果を選ぶ">
      <div class="epk-head"><input class="epk-q" data-epk="q" placeholder="効果を探す（例：回避、どく、NP）" autocomplete="off"><button class="small" data-epk="close">閉じる</button></div>
      <div class="epk-tabs" data-epk-tabs></div><div class="epk-list" data-epk-list role="listbox"></div>
      <p class="epk-foot sub">↑↓で選んで Enter で決定。Esc で閉じる。「よく使う」は今の${TERMS.unit}（原作を除く）の${EFF_CTX_NAME[o.ctx]}で使われている回数の順。</p></div>`;
    this.draw(); el.querySelector('.epk-q').focus();
  },
  close(){ const el=document.getElementById('effpick'); if(el){ el.hidden=true; el.innerHTML=''; } this.o=null; },
  keys(){
    const ctx=this.o.ctx, all=fxGroups().flatMap(([,ks])=>ks).filter(k=>FX[k]&&fxOnlyIn(k,ctx)&&(ctx!=='skill'||k!=='copyRoll'));
    if(this.q) return all.filter(k=>effMatch(k,this.q)).sort((a,b)=>effUseCount(ctx,b)-effUseCount(ctx,a));
    if(this.tab==='often') return all.filter(k=>effUseCount(ctx,k)>0).sort((a,b)=>effUseCount(ctx,b)-effUseCount(ctx,a));
    return all.filter(k=>fxGroupOf(k)===this.tab);
  },
  draw(){
    const el=document.getElementById('effpick'); if(!el||!this.o) return;
    const ctx=this.o.ctx, groups=fxGroups().filter(([,ks])=>ks.some(k=>fxOnlyIn(k,ctx)));
    el.querySelector('[data-epk-tabs]').innerHTML=[['often','よく使う'],...groups.map(([g])=>[g,g])].map(([v,n])=>
      `<span role="tab" tabindex="0" class="epk-tab${!this.q&&this.tab===v?' on':''}" data-epk="tab" data-v="${esc(v)}">${esc(n)}</span>`).join('')+(this.q?`<span class="epk-tab on">「${esc(this.q)}」の検索結果</span>`:'');
    this.list=this.keys(); this.act=Math.min(this.act,Math.max(0,this.list.length-1));
    el.querySelector('[data-epk-list]').innerHTML=this.list.length?this.list.map((k,j)=>{ const n=effUseCount(ctx,k), kind=effKindLabel(k);
      return `<div role="option" tabindex="-1" class="epk-item${j===this.act?' act':''}${k===this.o.cur?' cur':''}" data-epk="pick" data-k="${esc(k)}" aria-selected="${j===this.act}">
        <div class="epk-name"><b>${esc(FX[k].name)}</b>${kind?`<span class="epk-kind ${kind==='弱体'?'debuff':kind==='強化'?'buff':''}">${kind}</span>`:''}${k===this.o.cur?'<span class="epk-kind">いまの効果</span>':''}<span class="epk-n">${n?`よく使う ${n}件`:''}</span></div>
        ${effHelp(k)?`<div class="epk-help">${esc(effHelp(k))}</div>`:''}
        ${n?`<div class="epk-ex">例：${esc(effUseHint(ctx,k,2))}</div>`:''}
      </div>`; }).join(''):'<p class="sub">見つかりません。ほかの言葉で探すか、分類から選んでください。</p>';
    const a=el.querySelector('.epk-item.act'); if(a) a.scrollIntoView({block:'nearest'});
  },
  pick(k){ const o=this.o; this.close(); if(o&&FX[k]) o.onPick(k); },
};
document.addEventListener('click',e=>{
  if(!EffPick.o) return;
  const t=e.target.closest('[data-epk]');
  if(!t){ if(e.target.id==='effpick') EffPick.close(); return; } // 外側を押したら閉じる
  if(t.dataset.epk==='close') EffPick.close();
  if(t.dataset.epk==='tab'&&t.dataset.v){ EffPick.tab=t.dataset.v; EffPick.q=''; EffPick.act=0; document.querySelector('#effpick .epk-q').value=''; EffPick.draw(); }
  if(t.dataset.epk==='pick') EffPick.pick(t.dataset.k);
});
document.addEventListener('input',e=>{ if(EffPick.o&&e.target.dataset.epk==='q'){ EffPick.q=e.target.value.trim(); EffPick.act=0; EffPick.draw(); } });
document.addEventListener('keydown',e=>{
  if(!EffPick.o) return;
  if(e.key==='Escape'){ EffPick.close(); e.preventDefault(); }
  else if(e.key==='ArrowDown'||e.key==='ArrowUp'){ EffPick.act=Math.max(0,Math.min(EffPick.list.length-1,EffPick.act+(e.key==='ArrowDown'?1:-1))); EffPick.draw(); e.preventDefault(); }
  else if(e.key==='Enter'&&EffPick.list[EffPick.act]){ EffPick.pick(EffPick.list[EffPick.act]); e.preventDefault(); }
  else if(e.key==='Enter'&&e.target.dataset.epk==='tab'){ e.target.click(); e.preventDefault(); }
});

// ---- 効果の種類を変えたとき：対象・値・効果時間を新しい種類に合う形に整える ----
// pick＝その効果の持ち主（スキル・宝具）の「対象の選び方」
function effKindChange(old,k,ctx,pick){
  const f=FX[k], of=FX[old.k]||{}, tg=TGT_BY_CTX[ctx];
  const ne={k,t:old.t,v:f.val?(of.val&&old.v?old.v:10):0}; // 値のない効果から変えたときは仮に10
  if(!f.noTgt&&!tg.includes(ne.t)) ne.t=tg[0];
  // 弱体は敵へ、強化は味方へ（逆向きになっていたら直す。スキルで敵1体を狙うには「対象の選び方」が要るので敵全体にする）
  const foe=['enemy_all','target'].includes(ne.t)||(ne.t==='picked'&&['enemy','any'].includes(pick));
  if(f.buff===false&&!foe) ne.t=ctx==='skill'?'enemy_all':'target';
  if(f.buff===true&&foe) ne.t='self';
  if(k==='star') ne.t='master';
  if(k==='starLoss') ne.t=ctx==='skill'?'enemy_all':'target';
  if(k==='dmg'&&!foe) ne.t='enemy_all';
  if(!f.inst&&!f.noTgt){ if(old.turns&&!f.timesOnly) ne.turns=old.turns; if(old.times) ne.times=old.times; if(!ne.turns&&!ne.times) ne[f.timesOnly?'times':'turns']=f.timesOnly?1:3; }
  if(!f.noTgt&&old.chance) ne.chance=old.chance;
  if(f.color&&(old.color||k==='cardUp'||k==='cardConv')) ne.color=old.color||'R';
  if(k==='cardUp') Object.assign(ne,CARD_UP_DEF[ne.color]);
  if(f.trait) ne.trait=old.trait||'';
  if(f.copy) ne.from='self';
  if(k==='multiHit') ne.v=Math.max(2,ne.v>10?2:ne.v);
  if(k==='desc') ne.text=old.text||'';
  return ne;
}

// ---- 効果1つの入力行 ----
// o = { ctx, path:'skills.0.eff.0', attr:(path,type)=>属性文字列, btn:(act)=>属性文字列（data-act など）, more:詳しくを開いているか, pick:持ち主の対象の選び方 }
//   attr の type：num / optnum / str / optstr / bool（使う側で値に直す）
function effRowHTML(e,o){
  const f=FX[e.k]||{}, p=o.path, A=o.attr, B=o.btn;
  const opt=(v,label,cur)=>`<option value="${esc(v)}"${String(v)===String(cur??'')?' selected':''}>${esc(label)}</option>`;
  const num=(sub,v,label,cls='n3',t='num')=>`<label class="ein"><input type="number" class="${cls}" ${A(p+'.'+sub,t)} value="${esc(v??'')}"${t==='optnum'?' placeholder="—" min="1"':''}><span>${label}</span></label>`;
  const kindBtn=`<button class="ekbtn" ${B('effPick')} title="効果の種類を選ぶ（検索できます）">${esc(f.name||e.k)}<span class="ekarrow">▾</span></button>`;
  const del=`<button class="small x" ${B('effDel')} title="この効果を消す">×</button>`;
  if(e.k==='desc') return `<div class="erow"><div class="eline">${kindBtn}<label class="ein grow"><input ${A(p+'.text','str')} value="${esc(e.text||'')}" placeholder="スキル・${TERMS.ult}の説明文"></label>${del}</div></div>`;
  const tg=TGT_BY_CTX[o.ctx].includes(e.t)?TGT_BY_CTX[o.ctx]:[...TGT_BY_CTX[o.ctx],e.t];
  const L=[];
  // 1行目（文章の形）：［コピー元から］［対象］に［効果］［値］［期間］
  if(f.copy) L.push(`<label class="ein"><select ${A(p+'.from','str')}>${(FROM_BY_CTX[o.ctx]||['self']).map(t=>opt(t,FROM_TARGETS[t],e.from||'self')).join('')}</select><span>から</span></label>`);
  if(!f.noTgt) L.push(`<label class="ein"><select ${A(p+'.t','str')} aria-label="対象">${tg.map(t=>opt(t,TARGETS[t]||t,e.t)).join('')}</select><span>に</span></label>`);
  L.push(kindBtn);
  if(e.k==='cardUp') L.push(`<label class="ein"><select ${A(p+'.color','str')} aria-label="色">${['R','B','G'].map(c=>opt(c,TERMS[c],e.color||'R')).join('')}</select></label>`,num('v',e.v,'威力'),num('np',e.np,'NP','n2'),num('star',e.star,'スター','n2'));
  else if(f.val&&!e.max) L.push(num('v',e.v,e.k==='multiHit'?'回':''));
  if(e.k==='cardConv') L.push(`<label class="ein"><span>→</span><select ${A(p+'.color','str')} aria-label="変換先の色">${['R','B','G'].map(c=>opt(c,TERMS[c],e.color||'R')).join('')}</select></label>`);
  if(f.trait) L.push(`<label class="ein"><span>相手：</span><input class="mid" ${A(p+'.trait','str')} value="${esc(e.trait||'')}" placeholder="属性・クラス・ID"></label>`);
  if(f.maxOk) L.push(`<label class="ein chk"><input type="checkbox" ${A(p+'.max','bool')} ${e.max?'checked':''}><span>最大HPぶん</span></label>`);
  if(!f.inst&&!f.noTgt){ if(!f.timesOnly) L.push(num('turns',e.turns,'ターン','n2','optnum')); L.push(num('times',e.times,'回','n2','optnum')); }
  // 詳しく：あまり使わない設定（色の限定・確率）。設定されているものは見出しに出す
  const kept=['cond','vs','at','sure','all'].filter(k=>e[k]!=null).length;
  const hasMore=(f.color&&e.k!=='cardUp'&&e.k!=='cardConv')||!f.noTgt||kept;
  const moreLabel=[e.color&&f.color&&e.k!=='cardUp'&&e.k!=='cardConv'?`${TERMS[e.color]}だけ`:'', e.chance?`ロール${e.chance}以下`:'', kept?`ほか${kept}件`:''].filter(Boolean).join('・');
  if(hasMore) L.push(`<button class="small ghost emore" ${B('effMore')} aria-expanded="${!!o.more}">詳しく${moreLabel?`（${esc(moreLabel)}）`:''}${o.more?' ▴':' ▾'}</button>`);
  L.push(del);
  const more=o.more&&hasMore?`<div class="emoreb">
      ${f.color&&e.k!=='cardUp'&&e.k!=='cardConv'?`<label class="ein"><span>色を限定</span><select ${A(p+'.color','optstr')}>${opt('','しない（すべての色）',e.color||'')}${['R','B','G'].map(c=>opt(c,TERMS[c]+'だけ',e.color)).join('')}</select></label>`:''}
      ${!f.noTgt?`<label class="ein"><span>成功する確率</span><select ${A(p+'.chance','optnum')}>${opt('','必ず成功',e.chance??'')}${[1,2,3,4,5].map(k=>opt(k,`ロール${k}以下で成功（${Math.round(k/6*100)}%）`,e.chance)).join('')}</select></label>`:''}
      ${kept?`<span class="sub">条件・タイミングなどの設定が${kept}件あります（エディタで変えられます。ここではそのまま残します）</span>`:''}
    </div>`:'';
  const hint=effUseHint(o.ctx,e.k,2);
  return `<div class="erow"><div class="eline">${L.join('')}</div>${more}
    <div class="etxt"><span class="etxt-game">${esc(effsText([normEff(e)]))}</span>${hint?`<span class="etxt-hint">よく使われる形：${esc(hint)}</span>`:''}</div></div>`;
}
