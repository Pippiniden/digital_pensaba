'use strict';
/* =====================================================================
   ルール説明・状態異常の説明（メインメニューの下／チュートリアルに表示）
   - 階層化：大項目（<details>）の中に小項目（<details>）
   - 数値は RULES / RULESETS / CRIT_TABLE から取るので、ルールを変えたら自動で追従する
   - 効果の説明文は FX_HELP（キーは rules.js の FX）。ここにない効果は名前だけ出す
   ===================================================================== */

const FX_HELP = {
  // 強化
  atk:'与える攻撃ダメージが増える。色（Buster/Arts/Quick）で限られるものもある。',
  atkPct:'与える攻撃ダメージが○％増える（固定値の補正やチェインを足したあとに掛ける）。宝具のダメージにも掛かる。',
  npPow:`${TERMS.ult}のダメージが増える（ダメージ1回ごと）。`,
  atkVs:'相手が弱体状態のとき、攻撃ダメージが増える。',
  atkTrait:'相手が特定の属性を持っているとき、攻撃ダメージが増える（特攻）。',
  ignoreDef:'相手の「被ダメージ-」を無視して攻撃する。',
  sureHit:'相手の回避を無視して攻撃が当たる。',
  aoeNormal:'通常攻撃（コマンドによる攻撃）が敵全体に当たる。宝具・スキルのダメージには影響しない。',
  pierce:'相手の無敵・回避を貫通して攻撃が当たる。',
  critPow:'クリティカルのときのダメージ増加量が増える。',
  critMult:'クリティカルのとき、ダメージが「クリティカル前のダメージ×倍率」になる。',
  critRoll:'クリティカルが出やすくなる（クリティカルレベル+）。',
  debuffUp:'敵に付ける弱体の判定ロール（ロールN以下）が、N+xになる。判定のある弱体が成功しやすくなる。',
  cardConv:'ロールで出たコマンドを、指定の色に変える（1回変えるごとに回数を消費）。',
  onAtkStar:'ダメージを与えるコマンドのたびに、スターが発生する。',
  onAtkNp:'ダメージを与えるコマンドのたびに、NPが増える。',
  def:'受ける攻撃ダメージが減る。',
  defTrait:'特定の属性の相手から受けるダメージが減る（特防）。',
  evade:'相手の攻撃を1回回避する（ダメージを受けない）。必中・無敵貫通で防げない。',
  invul:'相手の攻撃ダメージを受けない。無敵貫通で防げない。',
  guts:'HPが0になっても戦闘不能にならず、指定のHPで踏みとどまる（1回）。',
  taunt:'敵の攻撃対象がこのサーヴァントに集中する。',
  nullUnder:'攻撃1回ごとの最終ダメージが指定値以下なら0にする（毒ややけどなどの弱体ダメージには効かない）。',
  counter:'攻撃を受けるたびに、攻撃してきた相手へ固定ダメージを与える。',
  maxHp:'最大HPが増える。効果が切れると最大HPまで下がる。',
  debuffImmune:'弱体効果と弱体ダメージ（毒・やけど等）を受けない。種類が指定されているものは、その弱体だけを防ぐ。',
  mentalImmune:'精神異常（魅了・恐怖など）を受けない。',
  stripImmune:'敵の「強化解除」を受けない（防ぐたびに回数が減る）。',
  deathImmune:'「即死」を受けない（防ぐたびに回数が減る）。',
  npDownImmune:'敵の効果によるNP減少を受けない（防ぐたびに回数が減る）。',
  starLossImmune:'敵の効果によるスター消失を受けない（防ぐたびに回数が減る）。',
  actsUp:'次の行動回数ロールで、出た回数に加算される（使うと消える）。',
  regenHp:'自分のターン開始時にHPが回復する。',
  regenNp:'自分のターン開始時にNPが増える。',
  regenStar:'自分のターン開始時にスターが増える（そのターンから使える）。',
  hitNpUp:'ダメージを受けるたびに増えるNPが多くなる。回避・無敵で防いだときは増えない。',
  onHitNp:'攻撃の対象になったターンの終了時に、NPが増える。',
  onHitStar:'攻撃の対象になったターンの終了時に、スターが増える。',
  // 弱体
  atkDown:'与える攻撃ダメージが減る。',
  atkPctDown:'与える攻撃ダメージが○％減る（例：-50%なら半分）。宝具のダメージにも掛かる。',
  npPowDown:`${TERMS.ult}のダメージが減る。`,
  defDown:'受ける攻撃ダメージが増える。',
  critDown:'クリティカルが出にくくなる。',
  starDown:'攻撃するたびに発生するスターが減る（攻撃1回ごとに合計から引く）。',
  debuffDown:'敵に付ける弱体の判定ロールがN-xになる。「必ず」の弱体もロール6以下の判定になり、失敗することがある。',
  poison:'ターン終了時に毒ダメージを受ける。重ねても大きい値だけが適用される。',
  burn:'ターン終了時にやけどダメージを受ける。重ねても大きい値だけが適用される。',
  spread:'やけどのダメージが2倍になる。',
  drain:'ターン終了時にHPが減る。重ねると合計される。',
  curse:'攻撃を受けてもNPが増えない。受けるたびに回数が減る。',
  hitNpSeal:'攻撃を受けてもNPが増えない。ターンが経つか、回数を指定した場合は防ぐたびに減って切れる。',
  stun:`行動できず、スキルも${TERMS.ult}も使えない。`,
  charm:`行動できず、スキルも${TERMS.ult}も使えない（精神異常）。`,
  fear:'最大行動回数が1減る（精神異常）。',
  actsDown:'次の行動回数決定で、最大行動回数が値ぶん減る（0未満にはならない）。重ねると合計される。',
  sealSkill:'スキルが使えない。',
  sealUlt:`${TERMS.ult}が使えない。`,
  healBlock:'HP回復を受けない（毎ターンの回復も止まる）。',
  buffImmune:'強化効果を受けない。種類が指定されているものは、その強化だけを防ぐ。',
};

// 小項目：<details>（クリックで開閉）
const gSub=(title,body,open)=>`<details class="gsub" ${open?'open':''}><summary>${title}</summary><div class="gbody">${body}</div></details>`;
const gTop=(title,body,open)=>`<details class="gtop" ${open?'open':''}><summary>${title}</summary><div class="gin">${body}</div></details>`;

function rulesGuideBody(){
  const R=RULES, cr=CRIT_TABLE.map(([s,p],i)=>`Lv${i+1}：★${s}以上で${p}%`).join(' ／ ');
  const d6=CRIT_D6_TABLE.map(([s,v])=>`★${s}以上：1〜${v}`).join(' ／ ');
  const rs=Object.values(RULESETS).map(r=>`<dt>${esc(r.name)}</dt><dd>${esc(r.desc)}</dd>`).join('');
  return [
    gSub('勝敗と全体の流れ',`<p>相手の${TERMS.unit}を全員${TERMS.out}にしたほうの勝ちです。ターンは交代で進み、1ターンは次の順番です。</p>
      <ol><li>行動回数をロールして決める</li><li>スキルと${TERMS.ult}を使う</li><li>行動（コマンドをロール）して攻撃対象を決める</li><li>ダメージ処理 → ターン終了（毒・やけど・スター獲得）</li></ol>`,true),
    gSub('行動回数',`<p>各${TERMS.unit}が鉛筆（6面ダイス）を振り、出目で最大行動回数が決まります（出目1〜6 → ${R.actsTable?R.actsTable.join('・')+'回':'各面の設定'}）。味方が${TERMS.out}になるごとに+1、恐怖で-1。${RULESETS.team.secondBonus?'チームバトルでは、後攻の最初のターンだけ全員+1。':''}</p>
      <p>1ターンに行える行動は合計${R.actionsMax}回までで、最大回数を使い切るように割り振ります。割り振り方は自分のカードをクリックして決めます。</p>`),
    gSub('コマンドとチェイン',`<p>行動ごとに鉛筆を振り、出た面のコマンド（<b>${TERMS.R}</b>＝攻撃力が高い／<b>${TERMS.B}</b>＝NPが貯まりやすい／<b>${TERMS.G}</b>＝スターが出やすい）で攻撃します。白い面は特殊行動です。</p>
      <dl><dt>${TERMS.R}チェイン</dt><dd>同じ色3枚で、各コマンドのダメージ+${R.chainR}。</dd>
      <dt>${TERMS.B}チェイン</dt><dd>行動した${TERMS.unit}全員のNP+${R.chainB}%。</dd>
      <dt>${TERMS.G}チェイン</dt><dd>スター${R.chainG}個が発生。</dd>
      <dt>ブレイブチェイン</dt><dd>同じ${TERMS.unit}が3回行動すると、追加で1回攻撃（エクストラアタック）。</dd></dl>
      <p>クラスの相性はありません。</p>`),
    gSub('クリティカルとスター',`<p>スターを持っていると、攻撃がクリティカルになることがあります。クリティカルのダメージは+${R.critDmg}（${TERMS.R}は+${R.critDmgR}）、NPとスターの獲得は2倍です。</p>
      <p><b>チームバトル系</b>（1d100）：${cr}</p><p><b>シンプル・マスター</b>（1d6、出目がこの範囲ならクリティカル）：${d6}</p>`),
    gSub(`${TERMS.gauge}と${TERMS.ult}`,`<p>攻撃すると${TERMS.gauge}が貯まり、被弾でも+${R.gaugeOnHit}%増えます。${R.ultCost}%以上で、スキルフェイズに${TERMS.ult}を1ターン1回使えます。</p>
      <p>スキルは1試合に各1回。スキル3は${TERMS.ascFull}後に使えます。</p>`),
    gSub(TERMS.ascFull,`<p>鉛筆の面に「${TERMS.asc}」が出ると${TERMS.ascFull}します。以降は各面の${TERMS.asc}後のコマンドになり、スキル3が使えるようになります。</p>`),
    gSub('ルールごとの違い',`<dl>${rs}</dl>
      <p>コスト差があるときは「ハンデ戦」で、低コスト側にボーナスが付きます（シンプル・マスター）。差が大きいほどボーナスも大きくなります。</p>
      <dl><dt>コスト差1</dt><dd>低コスト側が${TERMS.ascFull}済みで始まります。</dd>
      ${(RULESETS.simple.hcapBonus||[]).map((b,i,a)=>`<dt>コスト差${b.gap}${i===a.length-1?'以上':''}</dt><dd>${TERMS.ascFull}済みに加えて、攻撃ダメージ+${b.atk}・獲得${TERMS.gauge}+${b.np}%${b.hp?`・最大HP+${b.hp}`:''}。</dd>`).join('')}</dl>
      <p>ハンデはいつでも解除できない固定ボーナスです。画面の「ハンデ戦」ボタンでオン・オフを切り替えられます。</p>`),
    gSub(`${TERMS.player}ルール`,`<p>${TERMS.player}ルールでは、行動回数のあとに${TERMS.player}フェイズがあり、次から1つ選べます。</p>
      <dl><dt>${MASTER_ACTS.support}</dt><dd>鉛筆を振り、出た面の効果をそのターンだけ受ける。</dd>
      <dt>${MASTER_ACTS.attack}</dt><dd>相手の${TERMS.player}か${TERMS.unit}を攻撃（コスト×倍率のダメージ）。</dd>
      <dt>${MASTER_ACTS.spell}</dt><dd>1試合1回、3つの効果から1つ。宣言して次のフェイズに使うか、スターを払ってすぐ使う。</dd>
      <dt>${MASTER_ACTS.evac}</dt><dd>次の相手ターン、相手の${TERMS.player}攻撃と全体攻撃を受けない。</dd></dl>
      <p>${TERMS.player}のHPが0になると、自軍の${TERMS.unit}がそのHP分のダメージを受けます。マスターチームでは補助と令呪（3画）だけで、${TERMS.player}は攻撃されません。</p>`),
  ].join('');
}

function statusGuideBody(){
  const groups=[['弱体（悪い効果）',Object.keys(FX).filter(k=>FX[k].buff===false)],
    ['防御・耐性',FX_GROUPS.find(g=>g[0]==='防御・耐性')[1]],
    ['攻撃強化',FX_GROUPS.find(g=>g[0]==='攻撃強化')[1]],
    ['継続・ターン',FX_GROUPS.find(g=>g[0]==='継続・ターン')[1]]];
  const dl=ks=>`<dl class="fxhelp">${ks.filter(k=>FX[k]&&FX_HELP[k]).map(k=>`<dt><span class="chip fx ${FX[k].buff===false?'debuff':'buff'}">${esc(FX[k].name)}</span></dt><dd>${esc(FX_HELP[k])}</dd>`).join('')}</dl>`;
  return `<p class="sub small">キャラクターの枠の色：<b class="gcol g">緑</b>＝回避・無敵 ／ <b class="gcol b">青</b>＝強化 ／ <b class="gcol r">赤</b>＝弱体（複数のときは緑→青→赤の順に切り替わります）。効果の持続は「ターン数」か「回数」で決まります。</p>`
    +groups.map(([t,ks],i)=>gSub(t,dl(ks),i===0)).join('');
}
const rulesGuideHTML=(open)=>gTop('ルール説明',rulesGuideBody(),open);
const statusGuideHTML=(open)=>gTop('状態異常・効果の説明',statusGuideBody(),open);
