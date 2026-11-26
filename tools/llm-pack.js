// LLM（AI）にサーヴァントのデータを作らせるための資料づくりと、できたデータの検査
//
//   node tools/llm-pack.js                  docs/llm/reference.md を作り直す（基準値・効果の一覧・今のキャラでの使われ方）
//   node tools/llm-pack.js --check a.json   AI が書いた JSON（1体でも配列でも可）を検査する
//                                           （読み込みエラー・エディタの検証・強すぎ注意（UNIT_REF.limits）・基準値との比較）
//   バランスの試し打ちは  node tools/ref-check.js --add a.json
//
// 資料はゲームのコード（rules.js の FX / TARGETS、unit-ref.js、guide.js の FX_HELP、units.js）から作るので、
// 効果や基準値を変えたら作り直すこと。「今のキャラでの使われ方」は原作キャラ（CANON_UNIT_IDS）を除いて数える。
'use strict';
const fs=require('fs'), vm=require('vm'), path=require('path');
const ROOT=path.join(__dirname,'..'), argv=process.argv.slice(2), opt=n=>{ const i=argv.indexOf(n); return i<0?null:argv[i+1]; };

// ---- ゲームのスクリプトを vm に読み込む ----
const store=()=>({getItem(){return null},setItem(){},removeItem(){}});
const ctx={console,Math,Date,JSON,localStorage:store(),sessionStorage:store(),document:{addEventListener(){}},setTimeout(){return 0},clearTimeout(){}};
ctx.window=ctx; vm.createContext(ctx);
let src='';
for(const f of ['rules','units','masters','common','unit-ref','ref-units','engine','guide']) src+=fs.readFileSync(path.join(ROOT,'js',f+'.js'),'utf8')+'\n;\n';
vm.runInContext(src+'function render(){}\nthis.__G={FX,FX_GROUPS,FX_HELP,TARGETS,TGT_BY_CTX,PICKS,COND_KINDS,EFF_AT,LINE_KEYS,LINE_MIN,CLASSES,UNIT_REF,TERMS,RULES,VS_KINDS,FROM_BY_CTX,CARD_UP_DEF,CARD_DOWN_DEF,CANON_UNIT_IDS,ALL_UNITS,normalizeUnit,validateUnits,refCompare,refLimits,MSHEET,SPELL_TPL,MASTER_LINE_KEYS,DEFAULT_MASTERS,CANON_MASTER_IDS,normalizeMaster,validateMasters,spellLimits,normEff,effsText,mTLabel,fxOnlyIn};',ctx,{filename:'game.js'});
const G=ctx.__G, R=G.UNIT_REF;
const COL={R:'Buster',B:'Arts',G:'Quick'};
const SITE='https://pippiniden.github.io/digital_pensaba/'; // 公開版（キットの頭に、もう片方のキットと申請ツールへのリンクを書く）

// 値（v）の意味。ここにない効果は「値」とだけ書く
const VAL={
  atk:'攻撃ダメージ+v（固定値）', atkDown:'攻撃ダメージ-v', atkPct:'攻撃ダメージ+v%', atkPctDown:'攻撃ダメージ-v%',
  def:'受けるダメージ-v', defDown:'受けるダメージ+v', critPow:'クリティカルのダメージ増加+v', critMult:'クリティカル時のダメージ＝クリティカル前×v%（150など。100以下は無意味）',
  guts:'HP vで踏みとどまる', critRoll:'クリティカルレベル+v（1〜3が目安）', debuffUp:'弱体の判定ロール+v', buffUp:'強化の判定ロール+v',
  nullUnder:'1回のダメージがv以下なら0', onAtkStar:'攻撃のたびにスター v個', onAtkNp:'攻撃のたびにNP v%',
  cardUp:`v＝威力 / np＝NP獲得量 / star＝スター発生量（3つまとめて指定。既定 ${Object.entries(G.CARD_UP_DEF).map(([c,d])=>`${COL[c]} v${d.v}・np${d.np}・star${d.star}`).join(' / ')}）`,
  cardDown:`v＝威力ダウン / np＝NP獲得量ダウン / star＝スター発生量ダウン（その色の攻撃1回ごと。3つまとめて指定。既定 ${Object.entries(G.CARD_DOWN_DEF).map(([c,d])=>`${COL[c]} v${d.v}・np${d.np}・star${d.star}`).join(' / ')}）`,
  actsUp:'次の行動回数+v', regenHp:'毎ターンHP v回復', regenNp:'毎ターンNP v%', regenStar:'毎ターンスター v個',
  atkVs:'弱体状態の相手へダメージ+v', atkTrait:'属性 trait を持つ相手へダメージ+v', defTrait:'属性 trait を持つ相手から受けるダメージ-v',
  counter:'攻撃を受けるたびに相手へ vダメージ', onHitNp:'被ダメージのたびにNP v%', hitNpUp:'被ダメージ時のNP獲得+v%', onHitStar:'攻撃対象になったターンの終わりにスター v個',
  maxHp:'最大HP+v', poison:'毎ターン vダメージ', burn:'毎ターン vダメージ', drain:'毎ターン vダメージ（重ねると合計）',
  critDown:'クリティカルレベル-v', npGainDown:'攻撃で得るNP -v（1回ごと）', starDown:'攻撃1回のスター -v個', debuffResDown:'受ける弱体の判定ロール+v',
  debuffDown:'付ける弱体の判定ロール-v', buffDown:'付ける強化の判定ロール-v', actsDown:'次の最大行動回数-v',
  heal:'HP v回復', np:'NP +v%（マイナスで減らす）', star:'スター v個（対象は master）', starLoss:'スター v個を失わせる（対象は master 以外の敵）',
  buffExtend:'強化の残りターン+v', skillCharge:'使用済みスキルを v個戻す', dmg:'vダメージ（宝具のダメージ）', multiHit:'攻撃を v回（2〜10）',
  selfDmg:'自分などへ vダメージ（固定）', npPow:'宝具ダメージ+v', npPowDown:'宝具ダメージ-v',
  debuffRes:'受ける弱体の判定ロール-v', healUp:'受けるHP回復+v%', healDown:'受けるHP回復-v%', critPowDown:'クリティカルのダメージ増加-v',
  npDef:'受ける宝具ダメージ-v（1回ごと）', confuse:'行動回数決定のたびにロールv以下なら行動不能（1〜5。3が目安）',
};
const CTX_NAME={skill:'スキル',ult:G.TERMS.ult,special:'特殊行動・カードの付加効果',master:G.TERMS.player};

// ---- 今のキャラ（原作キャラを除く）での使われ方 ----
const ORIG=G.ALL_UNITS.filter(u=>!G.CANON_UNIT_IDS.includes(u.id));
function usage(){
  const use={};
  const add=(where,u,e)=>(use[e.k]=use[e.k]||[]).push({where,cost:u.cost,e});
  for(const u of ORIG){
    u.skills.forEach(s=>s.eff.forEach(e=>add('skill',u,e)));
    u.ult.eff.forEach(e=>add('ult',u,e));
    u.faces.forEach(f=>['pre','post'].forEach(k=>(f[k].eff||[]).forEach(e=>add('face',u,e))));
  }
  return use;
}
const dur=e=>[e.turns?`${e.turns}T`:'',e.times?`${e.times}回`:'',e.chance?`ロール${e.chance}以下`:''].filter(Boolean).join('・');
const patText=e=>[G.TARGETS[e.t]||e.t, G.FX[e.k].val?(e.k==='cardUp'||e.k==='cardDown'?`v${e.v}/np${e.np}/star${e.star}`:`${e.v}`):'', e.color?COL[e.color]:'', e.trait?`「${e.trait}」`:'', dur(e)].filter(Boolean).join(' ');
function patterns(list,max=4){
  const m=new Map();
  for(const x of list){ const k=patText(x.e); const o=m.get(k)||{k,n:0,cost:[]}; o.n++; o.cost.push(x.cost); m.set(k,o); }
  return [...m.values()].sort((a,b)=>b.n-a.n).slice(0,max).map(o=>{ const c=[...new Set(o.cost)].sort(); return `${o.k}${o.n>1?` ×${o.n}`:''}（コスト${c.join('・')}）`; });
}

function fields(k){
  const f=G.FX[k], a=[];
  if(f.noTgt) a.push('対象 t は不要');
  if(f.inst) a.push('即時（turns・times は付けない）');
  else if(f.timesOnly) a.push('times（回数）で指定');
  else if(f.perm) a.push('効果時間なしでよい（永続）');
  else a.push('turns（ターン）か times（回数）が必要。どちらもないと永続');
  if(k==='cardUp'||k==='cardDown'||k==='cardConv') a.push('color 必須（R/B/G）'); else if(f.color) a.push('color で色を限定できる（任意）');
  if(f.trait) a.push('trait 必須（属性・クラス・キャラID）');
  if(f.copy) a.push(`from 必須（コピー元：${Object.keys(G.FROM_BY_CTX).map(c=>`${CTX_NAME[c]}は ${G.FROM_BY_CTX[c].join('/')}`).join('、')}）`);
  if(k in G.VS_KINDS) a.push(`vs で${G.VS_KINDS[k]?'強化':'弱体'}の種類（FXのキー）を限定できる（任意）`);
  if(f.maxOk) a.push('max:true で値＝対象の最大HP（軽減不可）');
  if(f.allOpt) a.push('all:true で攻撃以外の獲得も減らす');
  if(f.mental) a.push('精神異常');
  return a.join('。');
}
const whereOk=k=>['skill','ult','special'].filter(c=>!G.FX[k].only||[].concat(G.FX[k].only).includes(c)).map(c=>CTX_NAME[c]).join('・')||'（サーヴァントでは使えない）';

function md(){
  const L=[], P=s=>L.push(s), use=usage(), costs=[5,4,3,2,1];
  const rng=a=>a?`${a[0]??'—'}〜${a[1]??'—'}`:'—';
  P('# サーヴァント作成資料（LLM用）');
  P('');
  P('> このファイルは `node tools/llm-pack.js` が作ります。手で直さないでください（ゲームのコードから作り直されます）。');
  P(`> 作成日：${new Date().toISOString().slice(0,10)}　／　「今のキャラでの使われ方」は原作キャラを除く ${ORIG.length}体から数えています。`);
  P('');
  // 1. 基準値
  P('## 1. コストごとの基準値');
  P('');
  P('「再臨前」の数値の目安です。上限〜下限の間で作れば、だいたい勝率50%前後になります（3on3・合計コスト10でシミュレーション済み）。');
  P('HPを上限に寄せたら攻撃を下限に寄せる、のように片方を上げたらもう片方を下げてください。');
  P('');
  P('| コスト | HP | Buster 1枚 | Arts 1枚 | Quick 1枚 | 通常合計攻撃力（5面） | 再臨後の合計の増え方 | 宝具（全体） | 宝具（単体） |');
  P('|---|---|---|---|---|---|---|---|---|');
  for(const c of costs) P(`| ${c} | ${rng(R.hp[c])} | ${rng(R.dmg.R[c])} | ${rng(R.dmg.B[c])} | ${rng(R.dmg.G[c])} | ${rng(R.total[c])} | +${R.postAdd[c]} | ${R.ult.all[c]} | ${R.ult.one[c]} |`);
  P('');
  P('- **通常合計攻撃力**：霊基再臨面（ASC）を除く5面の、再臨前のダメージの合計。再臨後の5面の合計は「通常合計攻撃力＋増え方」にする。');
  P('- **宝具**の値は、追加効果のない単純なダメージ宝具の威力。追加効果（バフ・デバフ）を付けるほど威力を下げる。');
  P('- コスト1・2は宝具の威力で勝率がほとんど動かない（撃つ前に勝負がつくことが多い）ので、見栄えで決めてよい。');
  P('');
  P('### 霊基再臨面（4番の面）の再臨後');
  P('');
  P(`再臨前は必ず \`{"c":"ASC"}\`。再臨後は特殊行動（\`"c":"W"\`）にすることが多く、追加効果が強いほどダメージを下げます。`);
  P('');
  P(`| コスト | ${Object.values(R.ascFace.kinds).map(k=>`${k.name}（${k.ex}）`).join(' | ')} |`);
  P('|---|---|---|---|');
  for(const c of costs) P(`| ${c} | ${Object.keys(R.ascFace.kinds).map(k=>R.ascFace.dmg[c][k]).join(' | ')} |`);
  P('');
  P('コスト1・2で「回避」「無敵」のように攻撃を防ぐ効果を付けると、ダメージを0にしても強すぎる傾向がある（シミュレーションで効果弱より勝率+5%前後）。');
  P('');
  P('### NP（Arts のカード）');
  P('');
  P('| Arts の枚数 | 再臨前 1枚あたり | 再臨前 合計の上限 | 再臨後 1枚あたり | 再臨後 合計の上限 |');
  P('|---|---|---|---|---|');
  for(const n of [1,2,3]){ const x=R.np[n]; P(`| ${n}${n===3?'枚以上':'枚'} | ${rng(x.pre)}% | ${x.preMax}% | ${rng(x.post)}% | ${x.postMax}% |`); }
  P('');
  P(`Buster・Quick の np は 0 が基本。スター（star）は主に Quick に付け、6面の合計で 再臨前${R.star.pre}前後・再臨後${R.star.post}前後（コスト${R.star.plusCost}以上は ${R.star.plus[0]}〜${R.star.plus[1]} 多め）。`);
  P('');
  P(G.RULES.actsTable?`行動回数は全員共通の表で振る（${G.RULES.actsTable.map((a,i)=>`出目${i+1}＝${a}回`).join('・')}）ので、面の \`acts\` は使われません（1 でよい）。`:'行動回数は各面の `acts`（1〜3）で決まります。');
  P('');
  // 2. 構成の目安
  P('## 2. スキル・宝具の組み方（今のキャラの傾向）');
  P('');
  const by=c=>ORIG.filter(u=>u.cost===c);
  P('| コスト | 体数 | スキル1つの効果の数（平均） | 宝具が全体ダメージ | 宝具が単体ダメージ | 宝具がダメージなし | 宝具ダメージの平均 |');
  P('|---|---|---|---|---|---|---|');
  for(const c of costs){ const us=by(c); if(!us.length) continue;
    const sk=us.flatMap(u=>u.skills).filter(s=>s.eff.length), avg=(sk.reduce((a,s)=>a+s.eff.length,0)/sk.length).toFixed(1);
    const dm=u=>u.ult.eff.filter(e=>e.k==='dmg'), all=us.filter(u=>dm(u).some(e=>e.t==='enemy_all')).length, one=us.filter(u=>dm(u).some(e=>e.t!=='enemy_all')&&!dm(u).some(e=>e.t==='enemy_all')).length;
    const vs=us.flatMap(u=>dm(u).filter(e=>!e.max).map(e=>e.v)), av=vs.length?Math.round(vs.reduce((a,b)=>a+b,0)/vs.length):'—';
    P(`| ${c} | ${us.length} | ${avg} | ${all} | ${one} | ${us.length-all-one} | ${av} |`); }
  P('');
  P('- スキルは3つ。スキル3は霊基再臨したあとに使える（再臨前は使えない）。1つのスキルに効果は1〜3個。');
  P('- 効果時間は 1T（ターン）・3T がほとんど。強い効果ほど短く（1T・1回）、弱い効果は 3T。');
  P('- 確率つき（chance）は「ロールN以下で成功」。強い弱体（スタン・魅了など）に付けることが多い。');
  P('- 出目で分岐（roll）：`"roll":[下限,上限]`（1〜6）を付けた効果は、スキル・宝具・特殊行動を使うたびに1d6を1回だけ振り、出目がその範囲のときだけ出る（付けていない効果は毎回）。例：`[1,2]` 自身にHP回復、`[3,5]` 味方全体に攻撃アップ、`[6,6]` 宝具なら敵にダメージ。出目は同じスキルの中で共通。マスターの補助・令呪では使えない。効果の数の上限は出目ごとに数える。');
  P('- ダメージ（`dmg`）は宝具と特殊行動（白コマンドの面）で使える（スキルでは使えない）。対象は `target`（攻撃対象）か `enemy_all`（敵全体）。ふつうは攻撃扱い（攻撃ダメージ±・相手の被ダメージ±・回避・無敵・被ダメージ時NP・反撃が働く）。`"fixed":true` で相手の効果を受けない固定ダメージになる。');
  P('');
  // 強さの上限（UNIT_REF.limits。申請ツールの「強すぎ注意」と同じ）
  const LM=R.limits;
  if(LM){
    const fn=k=>`\`${k}\` ${G.FX[k]?G.FX[k].name:k}`, PL={skill:'スキル',ult:G.TERMS.ult,face:'面'};
    P('### 強さの上限（守ること）');
    P('');
    P('申請ツールは、これを超えると「強すぎ注意」を出します。設定上どんなに強いキャラでも、この範囲で表現してください。');
    P('');
    P(`- 1つのスキルの効果は **${LM.maxEffs}つまで**。そのうち下の「強い効果」は **${LM.maxStrong}つまで**。`);
    P(`- 効果時間は **${LM.maxTurns}T まで**。`);
    for(const [k,o] of Object.entries(LM.forbid)) for(const [pl,why] of Object.entries(o)) P(`- ${fn(k)}：**${PL[pl]}には入れない**。${why.replace(/^.*?（/,'').replace(/）$/,'')}`);
    P(`- コスト${LM.noDefFaceCost}以下は、鉛筆の面に \`evade\` 回避・\`invul\` 無敵を付けない。`);
    P('- 自分にかける代償（自分への即死・弱体）はこの上限の対象外。');
    P('');
    P('**強い効果**（敵や味方にかけるとき。確率の上限は「ロールN以下」のN。確率つきの効果は `chance` を必ず付ける）');
    P('');
    P('| 効果 | 単体・自分 | 全体（ally_all / enemy_all） |');
    P('|---|---|---|');
    const lim=(t,m,c)=>[t!=null||m!=null?[t!=null?`${t}T`:'',m!=null?`${m}回`:''].filter(Boolean).join('か')+'まで':'',c!=null?`chance ${c}以下`:''].filter(Boolean).join('・')||'—';
    for(const [k,s] of Object.entries(LM.strong)) P(`| ${fn(k)} | ${lim(s.turns,s.times,s.chance)} | ${lim(s.allTurns??s.turns,s.allTimes??s.times,s.allChance??s.chance)} |`);
    P('');
    P('**スキルの値の上限**');
    P('');
    P('| 効果 | 自分・単体 | 全体 |');
    P('|---|---|---|');
    for(const [k,[a,b]] of Object.entries(LM.val)) if(G.FX[k]) P(`| ${fn(k)} | ${a} | ${b} |`);
    P('');
  }
  // 3. 対象
  P('## 3. 効果の対象（t）');
  P('');
  P('| キー | 意味 | スキル | 宝具 | 特殊行動・カード |');
  P('|---|---|---|---|---|');
  for(const [k,n] of Object.entries(G.TARGETS)){ const ok=c=>G.TGT_BY_CTX[c].includes(k)?'○':''; if(!['skill','ult','special'].some(c=>G.TGT_BY_CTX[c].includes(k))) continue; P(`| \`${k}\` | ${n} | ${ok('skill')} | ${ok('ult')} | ${ok('special')} |`); }
  P('');
  P('- `picked` を使うときは、スキル・宝具に `pick`（対象の選び方）が必要：' + Object.entries(G.PICKS).filter(([k])=>k).map(([k,n])=>`\`${k}\`＝${n}`).join('、'));
  P('- `target`（攻撃対象）は宝具・特殊行動・カードの付加効果で使う。スキルでは使えない。');
  P('- `master` はスター獲得（`star`）専用。');
  P('');
  // 4. 効果
  P('## 4. 効果の一覧（k）');
  P('');
  P('書式：`{"k":キー, "t":対象, "v":値, "turns":ターン, "times":回数, "chance":成功ロール, "roll":[出目の下限,上限]}`（chance・roll は任意）。値を使わない効果も `"v":0` を書く。');
  P('');
  for(const [g,ks] of G.FX_GROUPS){
    P(`### ${g}`);
    P('');
    for(const k of ks){ const f=G.FX[k]; if(!f) continue;
      const kind=f.inst?'即時':f.buff===true?'強化':f.buff===false?'弱体':'—';
      P(`- **\`${k}\` ${f.name}**（${kind}）${G.FX_HELP[k]?' — '+G.FX_HELP[k]:''}`);
      P(`  - 値：${f.val?(VAL[k]||'値'):'使わない（0）'}。${fields(k)}。使える場所：${whereOk(k)}`);
      const u=use[k]||[]; if(u.length){
        for(const [w,lab] of [['skill','スキル'],['ult',G.TERMS.ult],['face','面']]){ const xs=u.filter(x=>x.where===w); if(xs.length) P(`  - 使用例（${lab} ${xs.length}件）：${patterns(xs).join('、')}`); }
      } else P('  - 使用例：まだない');
    }
    P('');
  }
  // 5. その他
  P('## 5. その他の決まり');
  P('');
  P(`- **クラス**（cls）：${G.CLASSES.join('・')}（一覧にないオリジナルクラスも可）`);
  P(`- **セリフ**（lines）：${Object.entries(G.LINE_KEYS).map(([k,n])=>`\`${k}\`＝${n}`).join('、')}。それぞれ文字列の配列。${Object.entries(G.LINE_MIN).map(([k,n])=>`${G.LINE_KEYS[k]}は${n}種類以上`).join('、')}`);
  P(`- **条件つき効果**（cond）：\`{"k":種類,"v":値,"not":true}\`。種類は ${Object.entries(G.COND_KINDS).map(([k,n])=>`\`${k}\`＝${n}`).join('、')}`);
  P(`- **タイミング**（at、宝具・カードの効果だけ）：${Object.entries(G.EFF_AT).map(([k,n])=>`\`${k}\`＝${n}`).join('、')}`);
  P('- **解除・無効不可**：持続する効果に `"sure":true`');
  P('');
  const traits=[...new Set(ORIG.flatMap(u=>u.traits||[]))];
  P(`- **属性**（traits）：今のキャラが使っている属性 → ${traits.join('・')}`);
  P(`- **使用済みのID**（重複不可）：${G.ALL_UNITS.map(u=>u.id).join(', ')}`);
  P('');
  return L.join('\n');
}

// ---- マスター用の資料（master-reference.md）：マスターシート（MSHEET）・令呪の上限（MSHEET.spell）・汎用令呪・今のマスター ----
const MASTERS=G.DEFAULT_MASTERS.map(G.normalizeMaster);
function mmd(){
  const L=[], P=s=>L.push(s), M=G.MSHEET, SL=M.spell, T=G.TERMS;
  const fn=k=>`\`${k}\` ${G.FX[k]?G.FX[k].name:k}`, et=effs=>G.effsText(effs.map(G.normEff),null,G.mTLabel);
  const orig=MASTERS.filter(m=>!G.CANON_MASTER_IDS.includes(m.id));
  P('# マスター作成資料（LLM用）');
  P('');
  P('> このファイルは `node tools/llm-pack.js` が作ります。手で直さないでください（ゲームのコードから作り直されます）。');
  P(`> 作成日：${new Date().toISOString().slice(0,10)}`);
  P('');
  P('## 1. マスターシートの決まり（HPと補助の6面）');
  P('');
  P(`- **HP**：コスト×${M.hpPerCost} を基準に ±${M.hpRange} まで、${M.hpStep}刻みで補正する（例：コスト3なら ${3*M.hpPerCost-M.hpRange}〜${3*M.hpPerCost+M.hpRange}）。`);
  P(`- **4番の面**（faces の4つ目）は必ず効果を入れる。ほかの面より強め（下の目安値の「4番」の列）。`);
  P('- **4番以外で効果を入れる面は、コストと同じ数**（コスト0なら0、コスト5なら5つ全部）。残りは `{"label":"無","eff":[]}`。');
  P('- 補助の効果は**そのターンだけ**。`turns`・`times` は書かない（回避の `"times":1` だけは例外）。');
  P(`- 同じ種類の効果（効果・色・対象が同じ）は補助全体で **${M.sameMax}つまで**。全体と単体は別の種類として数える。`);
  P('- **補助に入れてはいけない効果**：');
  for(const [k,why] of Object.entries(M.forbid)) P(`  - ${fn(k)}：${why}`);
  P('  - `evade` 回避：「回数1（`"times":1`）」のときだけ入れられる（リミット1枠）');
  P('  - `charm` 魅了：「敵サーヴァント単体（`enemy_svt`）・ロール3以下（`"chance":3` 以下）」のときだけ入れられる（リミット1枠）');
  P(`- **リミット1枠**（補助全体で1つまで。主に4番の面に入れる）：${M.limit1.map(fn).join('・')}・回避(1回)・魅了(ロール3以下)`);
  P(`- **リミット2枠**（補助全体で2つまで。主に4番の面に入れる）：${M.limit2.map(fn).join('・')}`);
  P('');
  P('### 補助の目安値');
  P('');
  P(`値はこれ以下にする。コスト${M.star5Cost}以上は★5の列。味方単体（\`ally_svt\`）にするときは「単体なら」の分だけ上げてよい。`);
  P('');
  P('| 効果 | ★4以下 4番以外 | ★4以下 4番 | ★5 4番以外 | ★5 4番 | 単体なら |');
  P('|---|---|---|---|---|---|');
  for(const [k,r] of Object.entries(M.ref)){ const fk=k.split('_')[0], col=/_(R|B|G)$/.exec(k);
    P(`| ${r.name}（\`${fk}\`${col?` \`"color":"${col[1]}"\``:''}） | ${r.vals[0]} | ${r.vals[1]} | ${r.vals[2]} | ${r.vals[3]} | ${r.single?'+'+r.single:'—'} |`); }
  P('');
  P('表にない効果（クリティカル威力・弱体など）は、表の近い効果と同じくらいの強さにする。');
  P('');
  P('## 2. 令呪の上限（守ること）');
  P('');
  P('申請ツールは、これを超えると「強すぎ注意」を出します。');
  P('');
  P(`- 1つの令呪の効果は **${SL.maxEffs}つまで**。効果時間は **${SL.maxTurns}T まで**（強化は 1T が基本）。`);
  for(const [k,why] of Object.entries(SL.forbid)) P(`- ${fn(k)}：${why}`);
  P('- 最大HPぶんのダメージ（`"max":true`）は入れない。');
  P('- 自分側への代償（自分・自軍への弱体や自傷）は上限の対象外。');
  P('');
  P('**強い効果**');
  P('');
  P('| 効果 | 時間・回数 | 敵全体にかけるとき |');
  P('|---|---|---|');
  for(const [k,st] of Object.entries(SL.strong)) P(`| ${fn(k)} | ${st.turns}Tか${st.times}回まで | ${st.allChance?`chance ${st.allChance}以下`:'—'} |`);
  P('');
  P('**値の上限**（単体＝`ally_svt`・`svt`・`enemy_svt`・`self` など / 全体＝`ally_all`・`enemy_all`・`enemy_both`）');
  P('');
  P('| 効果 | 単体 | 全体 |');
  P('|---|---|---|');
  for(const [k,[a,b]] of Object.entries(SL.val)) if(G.FX[k]) P(`| ${fn(k)} | ${a}${k==='dmg'?`（敵マスター \`enemy_master\` は ${SL.dmgMaster}）`:''} | ${b} |`);
  P('');
  P('### 汎用令呪の例（値の目安。名前は自由に変えてよい）');
  P('');
  for(const s of G.SPELL_TPL) P(`- ${s.name}（${s.tgt}）：${et(s.eff)}　\`${JSON.stringify(s.eff.map(({k,t,v,...r})=>({k,t,v:v||0,...r})))}\``);
  P('');
  P(`### 今のマスターの例（原作を除く ${orig.length}人。強さの保証ではない）`);
  P('');
  for(const m of orig){
    const on=m.faces.map((f,i)=>f.eff.some(e=>e.k!=='desc')?i+1:0).filter(Boolean);
    P(`- **${m.name}**（コスト${m.cost}・HP${m.hp}）補助の当たり：${on.join('・')||'なし'}番　4番「${m.faces[3].label}」${et(m.faces[3].eff)}　令呪：${m.spells.map(s=>`「${s.name}」${et(s.eff)}`).join('　')}`);
  }
  P('');
  P('## 3. 効果の対象（t、マスター用）');
  P('');
  P('| キー | 意味 |');
  P('|---|---|');
  const note={svt:'（補助では自軍サーヴァント全員。令呪では1騎を選ぶ）',self:`（${T.player}自身）`,ally_all:`（${T.player}も含む）`,enemy_all:`（敵${T.player}には当たらない）`,master:'（スター獲得専用）'};
  for(const t of G.TGT_BY_CTX.master) P(`| \`${t}\` | ${G.mTLabel(t)}${note[t]||''} |`);
  P('');
  P('## 4. 効果の一覧（k、マスターで使えるもの）');
  P('');
  P('書式：`{"k":キー, "t":対象, "v":値, "turns":ターン, "times":回数, "chance":成功ロール}`。値を使わない効果も `"v":0`。補助では turns・times を書かない。');
  P('');
  for(const [g,ks] of G.FX_GROUPS){
    const list=ks.filter(k=>G.FX[k]&&k!=='desc'&&G.fxOnlyIn(k,'master')); if(!list.length) continue;
    P(`### ${g}`);
    P('');
    for(const k of list){ const f=G.FX[k], kind=f.inst?'即時':f.buff===true?'強化':f.buff===false?'弱体':'—';
      const need=k==='cardUp'||k==='cardDown'||k==='cardConv'?'。color 必須（R/B/G）':f.trait?'。trait 必須':'';
      P(`- **\`${k}\` ${f.name}**（${kind}）${G.FX_HELP[k]?' — '+G.FX_HELP[k]:''}　値：${f.val?(VAL[k]||'値'):'使わない（0）'}${need}${M.forbid[k]?'　**補助には入れない**':''}`); }
    P('');
  }
  P('## 5. その他の決まり');
  P('');
  P(`- **セリフ**（lines）：${Object.entries(G.MASTER_LINE_KEYS).map(([k,n])=>`\`${k}\`＝${n}`).join('、')}。それぞれ文字列の配列。面・令呪だけの専用セリフは、その面・令呪に \`"line":["…"]\``);
  P(`- **使用済みのID**（サーヴァントとも重複不可）：${[...MASTERS.map(m=>m.id),...G.ALL_UNITS.map(u=>u.id)].join(', ')}`);
  P('');
  return L.join('\n');
}

// ---- 検査 ----
function check(file){
  let t=fs.readFileSync(file,'utf8').trim(), raw;
  t=t.replace(/^```[a-z]*\s*/i,'').replace(/```\s*$/,''); // コードブロックの囲みは外す
  try{ raw=JSON.parse(t); }catch(e){ const a=t.search(/[\[{]/), b=Math.max(t.lastIndexOf(']'),t.lastIndexOf('}')); try{ raw=JSON.parse(t.slice(a,b+1)); }catch(e2){ console.log('✖ JSONとして読めません：'+e2.message); process.exit(1); } }
  if(!Array.isArray(raw)) raw=[raw];
  if(raw.some(x=>x&&x.spells)) return checkMasters(raw);
  const units=raw.map(x=>G.normalizeUnit(x)), all=[...G.ALL_UNITS,...units];
  let bad=0, much=0;
  // 正規化で消えた項目（スペルミスなど）を見つける
  const known=new Set(['id','name','cls','traits','cost','hp','fit','link','memo','wip','lines','condLines','faces','skills','ult']);
  raw.forEach((x,i)=>{ const extra=Object.keys(x).filter(k=>!known.has(k)); if(extra.length) console.log(`⚠ ${units[i].name||i}：使われない項目 ${extra.join(', ')}`); });
  const issues=G.validateUnits(all).filter(x=>x.i>=G.ALL_UNITS.length);
  units.forEach((u,ui)=>{
    const i=G.ALL_UNITS.length+ui, its=[...issues.filter(x=>x.i===i),...G.refLimits(u)];
    console.log(`\n■ ${u.name}（${u.id}）コスト${u.cost} ${u.cls}`);
    for(const x of its){ console.log(`  ${x.level==='error'?'✖':x.level==='warn'?'⚠':'・'} ${x.msg}`); if(x.level==='error') bad++; if(/^強すぎ注意/.test(x.msg)) much++; }
    const cmp=G.refCompare(u); if(!cmp.length){ console.log('  （このコストの基準値はありません）'); return; }
    for(const x of cmp) console.log(`  ${x.ok===false?'↕':x.ok?'○':'・'} ${x.label} ${x.val}${x.note?'：'+x.note:''}`);
  });
  if(much) console.log(`\n強すぎ注意 ${much}件。資料の「強さの上限」を超えています（読み込みはできますが、申請では直すよう頼まれます）。`);
  console.log(bad?`\nエラー ${bad}件。エディタでは読み込めますが、直さないとゲームに反映できません。`:'\nエラーなし。エディタの「1体を読み込み」で取り込めます。バランスは node tools/ref-check.js --add '+file+' で確かめられます。');
  process.exit(bad?1:0);
}

// マスターの検査（spells がある JSON）：validateMasters（マスターシート）＋令呪の強すぎ注意（spellLimits）
function checkMasters(raw){
  const ms=raw.map(x=>G.normalizeMaster(x)), all=[...MASTERS,...ms];
  const known=new Set(['id','name','cls','cost','hp','fit','link','memo','wip','lines','faces','spells','master']);
  raw.forEach((x,i)=>{ const extra=Object.keys(x).filter(k=>!known.has(k)); if(extra.length) console.log(`⚠ ${ms[i].name||i}：使われない項目 ${extra.join(', ')}`); });
  const issues=G.validateMasters(all,G.ALL_UNITS);
  let bad=0, big=0, much=0;
  ms.forEach((m,mi)=>{
    const i=MASTERS.length+mi, its=[...issues.filter(x=>x.i===i),...G.spellLimits(m)];
    console.log(`\n■ ${m.name}（${m.id}）${G.TERMS.player} コスト${m.cost} HP${m.hp}`);
    if(!its.length) console.log('  エラー・注意なし');
    for(const x of its){ console.log(`  ${x.level==='error'?'✖':x.level==='big'?'‼':'⚠'} ${x.msg}`); if(x.level==='error') bad++; if(x.level==='big') big++; if(/^強すぎ注意/.test(x.msg)) much++; }
  });
  if(big) console.log(`\nマスターシートの決まりに反する所 ${big}件（‼）。直してください。`);
  if(much) console.log(`\n強すぎ注意 ${much}件。資料の「令呪の上限」を超えています。`);
  console.log(bad?`\nエラー ${bad}件。`:`\nエラーなし。エディタの「${G.TERMS.player}」で読み込めます。`);
  process.exit(bad?1:0);
}

if(opt('--check')) check(opt('--check'));
else {
  const dir=path.join(ROOT,'docs','llm'), rd=f=>fs.readFileSync(path.join(dir,f),'utf8').replace(/\r\n/g,'\n').trim();
  fs.mkdirSync(dir,{recursive:true});
  const ref=md();
  fs.writeFileSync(path.join(dir,'reference.md'),ref+'\n');
  // kit.md：AI に1つで渡せるように、プロンプト本文・資料・見本・設定シートをつなげたもの（申請ツールからダウンロードする）
  const prompt=rd('prompt.md'), body=prompt.slice(prompt.search(/^## ここからプロンプト$/m)).replace(/^.*\n/,'').trim(); // 「## ここからプロンプト」の行より下
  const down=s=>s.replace(/^(#{1,5}) /gm,'#$1 '); // 見出しを1段下げて、kit の中の章に収める
  const kit=['# PENSABA DUEL サーヴァント作成キット','',
    '> このファイル1つを AI（ChatGPT・Claude・Gemini など）に渡してから、作ってほしいキャラクターの設定を送ってください。',
    `> AI が返した JSON は、申請ツール（${SITE}submit.html ）に貼り付けて検査してから Discord で申請します。`,
    `> マスター（泥ペンマス）を作るときは、こちらではなくマスター作成キット（${SITE}docs/llm/master-kit.md ）を使ってください。`,'',
    '## 指示（AI はこの章に従うこと）','',body.replace(/`reference\.md`/g,'「資料」の章').replace(/`template\.json`/g,'「見本」の章'),'',
    '## 資料','',down(ref.replace(/^# .*\n+(> .*\n)*/,'')).replace(/`node tools\/llm-pack\.js`/g,'').trim(),'',
    '## 見本（template.json）','','```json',rd('template.json'),'```','',
    '## 設定シートの書き方（キャラクターの設定はこの形で送ると伝わりやすい）','',down(rd('sheet.md').replace(/^# .*\n+(> .*\n)*/,'')).trim(),''].join('\n');
  fs.writeFileSync(path.join(dir,'kit.md'),kit);
  // マスター用：master-reference.md と master-kit.md（作り方は kit.md と同じ）
  const mref=mmd();
  fs.writeFileSync(path.join(dir,'master-reference.md'),mref+'\n');
  const mp=rd('master-prompt.md'), mbody=mp.slice(mp.search(/^## ここからプロンプト$/m)).replace(/^.*\n/,'').trim();
  const mkit=['# PENSABA DUEL マスター作成キット','',
    '> このファイル1つを AI（ChatGPT・Claude・Gemini など）に渡してから、作ってほしいマスター（泥ペンマス）の設定を送ってください。',
    `> AI が返した JSON は、申請ツール（${SITE}submit.html ）に貼り付けて検査してから Discord で申請します。`,
    `> サーヴァントを作るときは、こちらではなくサーヴァント作成キット（${SITE}docs/llm/kit.md ）を使ってください。`,'',
    '## 指示（AI はこの章に従うこと）','',mbody.replace(/`master-reference\.md`/g,'「資料」の章').replace(/`master-template\.json`/g,'「見本」の章').replace(/`master-kit\.md`/g,'このキット'),'',
    '## 資料','',down(mref.replace(/^# .*\n+(> .*\n)*/,'')).trim(),'',
    '## 見本（master-template.json）','','```json',rd('master-template.json'),'```','',
    '## 設定シートの書き方（マスターの設定はこの形で送ると伝わりやすい）','',down(rd('master-sheet.md').replace(/^# .*\n+(> .*\n)*/,'')).trim(),''].join('\n');
  fs.writeFileSync(path.join(dir,'master-kit.md'),mkit);
  console.log('書き出しました：docs/llm/reference.md, kit.md, master-reference.md, master-kit.md');
}
