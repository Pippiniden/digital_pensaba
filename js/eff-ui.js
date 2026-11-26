'use strict';
/* =====================================================================
   効果（Eff）の編集部品：エディタ（editor.js）と申請ツール（submit-edit.js）で共通。画面側の事情は持たない
   読み込み順：rules → units → masters → common → guide（FX_HELP）→ eff-ui
   - EffPick：効果の種類を選ぶ画面（言葉で検索・分類・説明文・今のキャラでの使われ方を見ながら選ぶ）
   - effRowHTML：効果1つの入力行。「［対象］に［効果］［値］［3ターン］」の文章の形。細かい設定は「詳しく」を開いたときだけ
   - effKindChange：効果の種類を変えたときに、対象・値・効果時間を新しい種類に合う形に整える（申請ツール用。エディタは autoEff）
   操作はすべて document で受ける（data-epk＝選択画面の中 / 行のボタン・入力は使う側が data-act・data-p で受ける）
   ===================================================================== */

// ---- 今のキャラ（原作キャラを除く）での使われ方：場所（skill / ult / special / master）× 効果 ----
const EFF_CTX_NAME={skill:'スキル',ult:TERMS.ult,special:'面',master:`${TERMS.player}の補助・令呪`};
function effStats(){
  if(effStats.c) return effStats.c;
  const m={skill:{},ult:{},special:{},master:{}};
  const add=(ctx,e)=>{ if(!FX[e.k]) return; const s=m[ctx][e.k]||(m[ctx][e.k]={n:0,pats:new Map()}); s.n++; const k=effPatText(e,ctx); s.pats.set(k,(s.pats.get(k)||0)+1); };
  const units=(typeof DEFAULT_UNITS!=='undefined'?normalizeUnits(DEFAULT_UNITS):[]).filter(u=>!CANON_UNIT_IDS.includes(u.id));
  for(const u of units){
    u.skills.forEach(s=>s.eff.forEach(e=>add('skill',e)));
    u.ult.eff.forEach(e=>add('ult',e));
    u.faces.forEach(f=>['pre','post'].forEach(k=>(f[k].eff||[]).forEach(e=>add('special',e))));
  }
  const ms=(typeof DEFAULT_MASTERS!=='undefined'?DEFAULT_MASTERS.map(normalizeMaster):[]).filter(x=>!CANON_MASTER_IDS.includes(x.id));
  for(const x of ms){ (x.faces||[]).forEach(f=>(f.eff||[]).forEach(e=>add('master',e))); (x.spells||[]).forEach(s=>(s.eff||[]).forEach(e=>add('master',e))); }
  return effStats.c=m;
}
const effTLabel=(t,ctx)=>ctx==='master'&&typeof mTLabel==='function'?mTLabel(t):(TARGETS[t]||t);
// 使われ方の1件を短い文に（例：「自身 20・3T」）
function effPatText(e,ctx){
  const f=FX[e.k]||{};
  const v=CARD_DEFS[e.k]?`威力${e.v}/NP${e.np}/スター${e.star}`:f.val?(e.max?'最大HP':String(e.v)):'';
  const d=[e.turns?`${e.turns}T`:'',e.times?`${e.times}回`:'',e.chance?`ロール${e.chance}以下`:''].filter(Boolean).join('・');
  return [f.noTgt?'':effTLabel(e.t,ctx), [v,e.color?TERMS[e.color]:'',e.trait?`「${e.trait}」`:'',d].filter(Boolean).join('・')].filter(Boolean).join(' ');
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
  cardUp:'かーど カード性能 ばすたー あーつ くいっく', cardDown:'かーど カード性能 だうん ばすたー あーつ くいっく', cardConv:'かーどへんかん カード変換', aoeNormal:'ぜんたい 全体化', aoe:'ぜんたい 全体化', desc:'せつめい 説明',
  debuffImmune:'じゃくたいむこう 弱体無効', buffImmune:'きょうかむこう 強化無効', healBlock:'かいふくふか 回復不可',
  erosion:'しょくどく 蝕毒 どく 毒', debuffRes:'じゃくたいたいせい 弱体耐性', healUp:'かいふくりょう 回復量', healDown:'かいふくりょう 回復量 だうん',
  critPowDown:'くりてぃかる クリ だうん', npDef:'ほうぐ 宝具 ぼうぎょ 防御 たいしゅくせい 対粛正', petrify:'せきか 石化 行動不能', bind:'こうそく 拘束 行動不能',
  sleep:'すいみん 睡眠 ねむり 眠り 行動不能', confuse:'こんらん 混乱 行動不能',
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
  // o = { ctx:'skill'|'ult'|'special'|'master', cur:今の効果キー, onPick:k=>{} }
  open(o){
    this.o=o; this.q=''; this.act=0;
    this.often=Object.keys(effStats()[o.ctx]||{}).length>0; // 使われ方の記録がある場所だけ「よく使う」を出す
    this.tab=this.often&&(effUseCount(o.ctx,o.cur)||!o.cur)?'often':fxGroupOf(o.cur||'atk');
    let el=document.getElementById('effpick');
    if(!el){ el=document.createElement('div'); el.id='effpick'; el.className='epk-back'; document.body.appendChild(el); }
    el.hidden=false;
    el.innerHTML=`<div class="epk" role="dialog" aria-label="効果を選ぶ">
      <div class="epk-head"><input class="epk-q" data-epk="q" placeholder="効果を探す（例：回避、どく、NP）" autocomplete="off"><button class="small" data-epk="close">閉じる</button></div>
      <div class="epk-tabs" data-epk-tabs></div><div class="epk-list" data-epk-list role="listbox"></div>
      <p class="epk-foot sub">↑↓で選んで Enter で決定。Esc で閉じる。${this.often?`「よく使う」は今の${o.ctx==='master'?TERMS.player:TERMS.unit}（原作を除く）の${EFF_CTX_NAME[o.ctx]}で使われている回数の順。`:''}</p></div>`;
    this.draw(); el.querySelector('.epk-q').focus();
  },
  close(){ const el=document.getElementById('effpick'); if(el){ el.hidden=true; el.innerHTML=''; } this.o=null; },
  keys(){
    const ctx=this.o.ctx, all=fxGroups().flatMap(([,ks])=>ks).filter(k=>FX[k]&&fxOnlyIn(k,ctx));
    if(this.q) return all.filter(k=>effMatch(k,this.q)).sort((a,b)=>effUseCount(ctx,b)-effUseCount(ctx,a));
    if(this.tab==='often') return all.filter(k=>effUseCount(ctx,k)>0).sort((a,b)=>effUseCount(ctx,b)-effUseCount(ctx,a));
    return all.filter(k=>fxGroupOf(k)===this.tab);
  },
  draw(){
    const el=document.getElementById('effpick'); if(!el||!this.o) return;
    const ctx=this.o.ctx, groups=fxGroups().filter(([,ks])=>ks.some(k=>fxOnlyIn(k,ctx)));
    el.querySelector('[data-epk-tabs]').innerHTML=[...(this.often?[['often','よく使う']]:[]),...groups.map(([g])=>[g,g])].map(([v,n])=>
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
  else if(e.key==='Enter'&&e.target.dataset.epk==='tab'){ e.target.click(); e.preventDefault(); }
  else if(e.key==='Enter'&&EffPick.list[EffPick.act]){ EffPick.pick(EffPick.list[EffPick.act]); e.preventDefault(); }
});

// ---- 効果の種類を変えたとき：対象・値・効果時間を新しい種類に合う形に整える ----
// pick＝その効果の持ち主（スキル・宝具）の「対象の選び方」
function effKindChange(old,k,ctx,pick){
  const f=FX[k], of=FX[old.k]||{}, tg=TGT_BY_CTX[ctx];
  const ne={k,t:old.t,v:f.val?(of.val&&old.v?old.v:10):0}; // 値のない効果から変えたときは仮に10
  if(k==='confuse'&&old.k!=='confuse') ne.v=3; // 混乱の値はロールの出目（1〜6）
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
  if(old.roll&&k!=='copyRoll'&&k!=='desc') ne.roll=old.roll; // 出目で分岐はそのまま
  if(f.color&&(old.color||CARD_DEFS[k]||k==='cardConv')) ne.color=old.color||'R';
  if(CARD_DEFS[k]) Object.assign(ne,CARD_DEFS[k][ne.color]);
  if(f.trait) ne.trait=old.trait||'';
  if(f.copy) ne.from='self';
  if(k==='multiHit') ne.v=Math.max(2,ne.v>10?2:ne.v);
  if(k==='desc') ne.text=old.text||'';
  return ne;
}

// ---- 効果1つの入力行 ----
// o = { ctx, path:'skills.0.eff.0', attr:(path,type)=>属性文字列, btn:(act)=>属性文字列（data-act など）, more:詳しくを開いているか, pick:持ち主の対象の選び方,
//       moreHTML:詳しくの中に足す入力（エディタの条件・タイミングなど。渡すとそれらの設定もここで変えられる扱いになる）,
//       turnsHTML:ターンの入力の差し替え（マスターの補助の面）, ops:×の前に足すボタン（↑↓など）, after:行の最後に足すHTML, traitList:特攻の相手の候補の datalist の id }
//   attr の type：num / optnum / optnum0（0も残す） / str / optstr / bool（使う側で値に直す）
//   「色」（カード性能アップ・ダウン）の選択には data-act="cardUpColor" が付く（色を変えたら、その色の既定値を入れるのは使う側）
const EFF_KEPT={cond:'条件',at:'タイミング',sure:'解除・無効不可',vs:'種類の指定',all:'すべての獲得',noExtra:'エクストラなし'}; // 詳しくの中の設定（入っていたら見出しに出す）
function effRowHTML(e,o){
  const f=FX[e.k]||{}, p=o.path, A=o.attr, B=o.btn, ctx=o.ctx, card=!!CARD_DEFS[e.k];
  const opt=(v,label,cur)=>`<option value="${esc(v)}"${String(v)===String(cur??'')?' selected':''}>${esc(label)}</option>`;
  const num=(sub,v,label,cls='n3',t='num')=>`<label class="ein"><input type="number" class="${cls}" ${A(p+'.'+sub,t)} value="${esc(v??'')}"${t==='optnum'?' placeholder="—" min="1"':t==='optnum0'?' placeholder="—" min="0" title="0＝ターン無制限（回数を使い切るまで）"':''}><span>${label}</span></label>`;
  const kindBtn=`<button class="ekbtn" ${B('effPick')} title="効果の種類を選ぶ（検索できます）">${esc(f.name||e.k)}<span class="ekarrow">▾</span></button>`;
  const tail=`${o.ops||''}<button class="small x" ${B('effDel')} title="この効果を消す">×</button>`;
  if(e.k==='desc') return `<div class="erow"><div class="eline">${kindBtn}<label class="ein grow"><input ${A(p+'.text','str')} value="${esc(e.text||'')}" placeholder="スキル・${TERMS.ult}の説明文（ほかの効果の説明の代わりに出る）"></label>${tail}</div>${o.after||''}</div>`;
  const tg=TGT_BY_CTX[ctx].includes(e.t)?TGT_BY_CTX[ctx]:[...TGT_BY_CTX[ctx],e.t];
  const L=[];
  // 1行目（文章の形）：［コピー元から］［対象］に［効果］［値］［期間］
  if(f.copy) L.push(`<label class="ein"><select ${A(p+'.from','str')}>${(FROM_BY_CTX[ctx]||['self']).map(t=>opt(t,FROM_TARGETS[t],e.from||'self')).join('')}</select><span>から</span></label>`);
  if(!f.noTgt) L.push(`<label class="ein"><select ${A(p+'.t','str')} aria-label="対象">${tg.map(t=>opt(t,effTLabel(t,ctx),e.t)).join('')}</select><span>に</span></label>`);
  L.push(kindBtn);
  if(card) L.push(`<label class="ein"><select ${A(p+'.color','str')} data-act="cardUpColor" aria-label="色" title="色を変えると、その色の既定値が入ります">${['R','B','G'].map(c=>opt(c,TERMS[c],e.color||'R')).join('')}</select></label>`,num('v',e.v,'威力'),num('np',e.np,'NP','n2'),num('star',e.star,'スター','n2'));
  else if(f.val&&!e.max) L.push(num('v',e.v,e.k==='multiHit'?'回':''));
  if(e.k==='cardConv') L.push(`<label class="ein"><span>→</span><select ${A(p+'.color','str')} aria-label="変換先の色">${['R','B','G'].map(c=>opt(c,TERMS[c],e.color||'R')).join('')}</select></label>`);
  if(f.trait) L.push(`<label class="ein"><span>相手：</span><input class="mid" ${o.traitList?`list="${o.traitList}" `:''}${A(p+'.trait','str')} value="${esc(e.trait||'')}" placeholder="属性・クラス・ID"></label>`);
  if(e.k==='dmg'&&ctx!=='master') L.push(`<label class="ein chk" title="チェックなし：攻撃扱い（攻撃ダメージ±・相手の被ダメージ±・回避・無敵・ダメージ無効・被ダメージ時NP・反撃が働く）。チェックあり：それらを受けない固定ダメージ"><input type="checkbox" ${A(p+'.fixed','bool')} ${e.fixed?'checked':''}><span>相手の効果を受けない</span></label>`);
  if(f.maxOk) L.push(`<label class="ein chk"><input type="checkbox" ${A(p+'.max','bool')} ${e.max?'checked':''}><span>最大HPぶん</span></label>`);
  if(!f.inst&&!f.noTgt){ if(!f.timesOnly) L.push(o.turnsHTML!=null?o.turnsHTML:num('turns',e.turns,'ターン','n2','optnum0')); L.push(num('times',e.times,'回','n2','optnum')); }
  // 詳しく：あまり使わない設定。設定されているものは見出しに出す
  const colorOpt=f.color&&!card&&e.k!=='cardConv';
  const kept=Object.keys(EFF_KEPT).filter(k=>e[k]!=null&&e[k]!==false);
  const rollOk=ctx!=='master'&&e.k!=='copyRoll'; // 出目で分岐（マスターの補助・令呪では使えない）
  const hasMore=colorOpt||!f.noTgt||rollOk||kept.length||!!o.moreHTML;
  const moreLabel=[e.roll?rollText(e.roll):'', colorOpt&&e.color?`${TERMS[e.color]}だけ`:'', e.chance?`ロール${e.chance}以下`:'', ...kept.map(k=>EFF_KEPT[k])].filter(Boolean).join('・');
  if(hasMore) L.push(`<button class="small ghost emore" ${B('effMore')} aria-expanded="${!!o.more}">詳しく${moreLabel?`（${esc(moreLabel)}）`:''}${o.more?' ▴':' ▾'}</button>`);
  L.push(tail);
  const more=o.more&&hasMore?`<div class="emoreb">
      ${colorOpt?`<label class="ein"><span>色を限定</span><select ${A(p+'.color','optstr')}>${opt('','しない（すべての色）',e.color||'')}${['R','B','G'].map(c=>opt(c,TERMS[c]+'だけ',e.color)).join('')}</select></label>`:''}
      ${rollOk?`<label class="ein" title="使うたびに1d6を1回だけ振り、出目がこの範囲のときだけこの効果が出ます（同じスキル・${TERMS.ult}・特殊行動の中で出目は共通）"><span>出目で分岐</span><select ${A(p+'.roll','roll')}>${opt('','しない（毎回）',e.roll?e.roll.join('-'):'')}${EFF_ROLL_OPTS.map(([a,b])=>opt(`${a}-${b}`,`${rollText([a,b])}のとき（${Math.round((b-a+1)/6*100)}%）`,e.roll?e.roll.join('-'):'')).join('')}</select></label>`:''}
      ${!f.noTgt?`<label class="ein"><span>成功する確率</span><select ${A(p+'.chance','optnum')}>${opt('','必ず成功',e.chance??'')}${[1,2,3,4,5].map(k=>opt(k,`ロール${k}以下で成功（${Math.round(k/6*100)}%）`,e.chance)).join('')}</select></label>`:''}
      ${o.moreHTML||''}
      ${kept.length&&!o.moreHTML?`<span class="sub">${esc(kept.map(k=>EFF_KEPT[k]).join('・'))}の設定があります（エディタで変えられます。ここではそのまま残します）</span>`:''}
    </div>`:'';
  const hint=effUseHint(ctx,e.k,2);
  return `<div class="erow"><div class="eline">${L.join('')}</div>${more}
    <div class="etxt"><span class="etxt-game">${esc(effRowText(e,ctx))}</span>${hint?`<span class="etxt-hint">よく使われる形：${esc(hint)}</span>`:''}</div>${o.after||''}</div>`;
}
// 行の下に出す「ゲームでの表示」
const effRowText=(e,ctx)=>effsText([normEff(e)],null,ctx==='master'&&typeof mTLabel==='function'?mTLabel:undefined);
