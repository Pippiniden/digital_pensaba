'use strict';
/* =====================================================================
   ルール定義：用語・数値・クラス・効果の種類
   ゲームとペンシルエディタの両方が読み込みます
   ===================================================================== */

// ---------- 用語（画面上の呼び名） ----------
const TERMS = { unit:'サーヴァント', player:'マスター', gauge:'NP', ult:'宝具', asc:'再臨', ascFull:'霊基再臨', star:'スター', out:'戦闘不能',
  R:'Buster', B:'Arts', G:'Quick', W:'特殊' };

// ---------- 画像 ----------
// サーヴァント画像は専用フォルダ IMG_DIR に、キャラクターの id と同じ名前で置きます
//   face: img/units/{id}.webp        キャラクター画像（なければ IMG_PLACEHOLDER.face の仮画像）
//   card: img/units/{id}_card.webp   コマンドカード用（任意。なければ face を使う。背景透過だと映えます）
const IMG_DIR = 'img/units/', IMG_EXT = 'webp', IMG_CARD_SUFFIX = '_card';
const IMG_KEYS = { face:'キャラクター画像', card:'カード用キャラ画像' };
const IMG_PLACEHOLDER = { face:'img/placeholder/face.webp', card:'img/placeholder/card.webp' }; // card は背景透過の仮画像

// コマンドカードは3枚の重ね合わせ： 背景（bg） → キャラ画像 → 枠と種別名（frame）
// bg と frame は全サーヴァント共通の素材です。空欄の間は CSS で描いた背景・枠・文字を使います
// frame の画像に種別名（BUSTER など）を描き込んだ場合は、文字の表示は自動で消えます
const CARD_LAYERS = {
  R:   { bg:'', frame:'' },   // Buster
  B:   { bg:'', frame:'' },   // Arts
  G:   { bg:'', frame:'' },   // Quick
  ULT: { bg:'', frame:'' },   // 宝具（空欄なら宝具の色の bg を使い、CSS の金枠を付ける）
};

// 画面の飾り
const UI_IMG = { circleOut:'img/ui/mcircleo.webp', circleIn:'img/ui/mcirclei.webp', grail:'img/ui/grail.webp' }; // grail＝霊基再臨カードの聖杯

// ---------- ルール定数 ----------
// 泥ペンサバ「チームバトルルール」（3on3・合計コスト10）準拠。クラス相性はなし
const RULES = {
  costCap:10, partyMax:3, actionsMax:3,
  // 行動回数決定フェイズ：出目1〜6 → 行動回数（全サーヴァント共通）。戦闘不能の味方1騎ごとに+1
  // null にすると、鉛筆の各面の acts（サーヴァントごとの値）を使う
  actsTable:[0,1,1,3,2,2],
  gaugeOnHit:10, gaugeMax:100, ultCost:100,
  chainR:30,   // Busterチェイン：各コマンドのダメージ+30
  chainB:20,   // Artsチェイン：行動した全サーヴァントのNP+20%
  chainG:10,   // Quickチェイン：スター10個発生
  critDmg:30, critDmgR:60, // クリティカル：ダメージ+30（Busterは+60）。獲得NP・発生スター・色バフは2倍
  dot:20,      // 毒・やけどの値が0（旧データ）のときのダメージ
  dotTiming:'current', // 毒・やけどの減少対象: 'current'=手番側のみ / 'all'=全ユニット
};
// クリティカルレベル：スター数で決まり、1d100 で確率以下ならクリティカル
const CRIT_TABLE = [ // [必要スター, 確率%]  index+1 がレベル
  [1,10],[6,20],[11,35],[16,50],[21,75],[26,90],[31,100],
];
function critLevel(stars){ let lv=0; CRIT_TABLE.forEach(([s],i)=>{ if(stars>=s) lv=i+1; }); return lv; }
const critChance = lv=>lv<=0?0:CRIT_TABLE[Math.min(lv,CRIT_TABLE.length)-1][1];
// シンプルルールのクリティカル：1d6 の出目がこの値以下なら成功（6 は確定）
const CRIT_D6_TABLE = [ // [必要スター, 成功する出目の上限]
  [1,2],[7,3],[14,5],[30,6],
];
function critNeedD6(stars){ let n=0; CRIT_D6_TABLE.forEach(([s,v])=>{ if(stars>=s) n=v; }); return n; }

// ---------- ルールの種類 ----------
// team  : チームバトルルール（3on3・合計コスト10・クリティカルは1d100）
// simple: シンプルルール（1on1・クリティカルは1d6）。宝具はチームバトルと同じくスキルフェイズで使う
//         handicapAsc：ハンデ戦ON のとき、この値以上のコスト差があれば低コスト側が最初から霊基再臨済み
//         hcapBonus  ：さらにコスト差が gap 以上なら、低コスト側のサーヴァントは攻撃ダメージ+atk・獲得NP+np%（攻撃・被弾・チェインのNP）
const RULESETS = {
  team:  { name:'チームバトル', partyMax:3, crit:'d100',
    desc:'3騎まで・コスト合計10以下で編成する基本ルール。' },
  simple:{ name:'シンプル', partyMax:1, crit:'d6', handicapAsc:2, hcapBonus:{gap:3, atk:30, np:10},
    desc:`1騎同士で戦う簡易ルール。相手の${TERMS.unit}を${TERMS.out}にすれば勝利。` },
  // master: マスタールール（シンプルルール＋泥ペンマス）。行動回数決定の後にマスターフェイズが入る
  //   masterAtk   ：マスターの攻撃＝コスト×値（master＝相手マスターへ / svt＝相手サーヴァントへ）
  //   lateBonus   ：G.turn がこの値以上（=3ターン目の後攻から）は行動回数+1
  //   spellNowStars：令呪を宣言したターンにすぐ使うために消費するスター（クリティカルLv4 = CRIT_TABLE の16個）
  master:{ name:'マスター', partyMax:1, crit:'d6', handicapAsc:2, hcapBonus:{gap:3, atk:30, np:10}, master:true,
    masterAtk:{ master:20, svt:10 }, lateBonus:6, spellNowStars:16,
    desc:`${TERMS.unit}1騎＋${TERMS.player}1人で戦うルール。行動回数の後に${TERMS.player}フェイズ（補助・攻撃・令呪・退避）。相手の${TERMS.unit}を${TERMS.out}にすれば勝利。` },
};

// mteam: マスターチームバトル（サーヴァント3騎＋マスター1人・合計コスト costCap 以下）。チームバトルが基本（クリティカル1d100）
//   マスターフェイズは補助と令呪だけ（攻撃・退避なし）。令呪は spells 画、効果はそれぞれ1回。使うと行動回数-1
//   マスターはサーヴァントの攻撃・全体攻撃の対象にならず、弱体も受けない（補助・令呪の「敵マスター」指定のダメージだけ受ける）
RULESETS.mteam = { name:'マスターチーム', partyMax:3, crit:'d100', master:true, mTeam:true, costCap:13, spells:3, lateBonus:6,
  desc:`${TERMS.unit}3騎＋${TERMS.player}1人・合計コスト13以下で戦うチームバトル。${TERMS.player}フェイズは補助と令呪（3画）。相手の${TERMS.unit}を全員${TERMS.out}にすれば勝利。` };

// ---------- 泥ペンマスシート（マスター作成の基準。エディタの警告と目安表示に使う） ----------
// HP はコスト×hpPerCost を基準に ±hpRange まで補正してよい（hpStep 刻み）。
// 補助の6面：4番（index 3）は必ず効果あり（他より強め）。4番以外で効果がある面はコストと同じ数。補助の効果はそのターンだけ
// 同じ種類の効果（効果・色・対象が同じ）は補助全体で sameMax まで。全体と単体は別種
// forbid：補助に入れてはいけない効果（回避は(1回)・魅了はロール3以下の敵単体なら limit1 扱いで可）
// limit1：補助全体で1枠まで（主に4番）／ limit2：補助全体で2枠まで（主に4番）
// ref：目安値 [星4以下の4番以外, 4番, 星5の4番以外, 4番]（星5 = コスト star5Cost 以上）。single＝単体にすると増える量
const MSHEET = {
  hpPerCost:100, hpRange:100, hpStep:50, sameMax:3, star5Cost:5, faceMain:3,
  forbid:{ np:'NPの即時増加は補助に入れられません（「攻撃時NP+x%(1回)」などにしてください）', invul:'無敵は補助に入れられません（令呪クラスの効果です）',
    stun:'スタンは補助に入れられません（令呪クラスの効果です）', instantDeath:'即死は入れられません' },
  limit1:['cleanse','strip','actsUp','fear'],   // ＋ 回避(1回)・魅了(ロール3以下の敵単体)
  limit2:['buffImmune','debuffImmune'],
  single:['ally_svt','enemy_svt'],
  ref:{
    dmg_enemy_svt:{name:'敵単体ダメージ', vals:[80,100,100,120]},
    dmg_enemy_master:{name:'敵マスター単体ダメージ', vals:[100,150,120,200]},
    atk:{name:'攻撃ダメージ+', vals:[10,30,20,40], single:10},
    atk_R:{name:'Busterダメージ+', vals:[20,40,30,50], single:10},
    atk_B:{name:'Artsダメージ+', vals:[20,40,30,50], single:10},
    atk_G:{name:'Quickダメージ+', vals:[20,40,30,50], single:10},
    def:{name:'被ダメージ-（攻撃ダメージ系より-10）', vals:[0,20,10,30], single:10},
    onAtkNp_B:{name:'Arts攻撃時NP+', vals:[10,15,10,20], single:5},
    onAtkNp:{name:'攻撃時NP+', vals:[5,10,5,15], single:5},
    onAtkStar_G:{name:'Quick攻撃時スター', vals:[4,6,5,7], single:1},
    onAtkStar:{name:'攻撃時スター', vals:[2,4,3,5], single:1},
    critRoll:{name:'クリティカルレベル+', vals:[1,2,1,3], single:1},
    heal:{name:'HP回復', vals:[30,80,60,100], single:20},
    poison:{name:'毒ダメージ（敵単体）', vals:[40,60,50,80]},
    burn:{name:'やけどダメージ（敵単体）', vals:[40,60,50,80]},
  },
};

// 汎用令呪テンプレ（FGOのマスター礼装がもと）。選ぶと令呪の名前と効果を置き換える。名前は自由に変えてよい
// 対象：ally_svt＝選んだ自軍サーヴァント1騎（味方単体） / ally_all＝味方全体（マスターも含む）。※ svt（自軍サーヴァント）は「全員」なので、単体の令呪には使わない
const SPELL_TPL = [
  ['応急手当','味方単体',{k:'heal',t:'ally_svt',v:200}],
  ['瞬間強化','味方単体',{k:'atk',t:'ally_svt',v:40,turns:1}],
  ['緊急回避','味方単体',{k:'evade',t:'ally_svt',turns:1},{k:'actsUp',t:'ally_svt',v:1,times:1}],
  ['全体強化','味方全体',{k:'atk',t:'ally_all',v:20,turns:1}],
  ['ガンド','敵単体',{k:'stun',t:'enemy_svt',turns:1}],
  ['全体回復','味方全体',{k:'heal',t:'ally_all',v:100}],
  ['霊子譲渡','味方単体',{k:'np',t:'ally_svt',v:30}],
  ['コマンドシャッフル','味方単体',{k:'actsUp',t:'ally_svt',v:3,times:1}],
  ['オシリスの塵','味方単体',{k:'invul',t:'ally_svt',turns:1}],
  ['イシスの雨','味方単体',{k:'cleanse',t:'ally_svt'},{k:'actsUp',t:'ally_svt',v:1,times:1}],
  ['メジェドの眼','味方単体',{k:'skillCharge',t:'ally_svt',v:1}],
  ['魔力放出','味方単体',{k:'atk',t:'ally_svt',v:60,color:'R',turns:1}],
  ['騎士の誓い','味方単体',{k:'guts',t:'ally_svt',v:400,turns:1,times:1}],
  ['反応強化','味方単体',{k:'atk',t:'ally_svt',v:40,color:'G',turns:1},{k:'onAtkStar',t:'ally_svt',v:4,color:'G',turns:1}],
  ['鉄の専心','味方単体',{k:'critRoll',t:'ally_svt',v:4,turns:2}],
  ['必至','味方単体',{k:'sureHit',t:'ally_svt',turns:1},{k:'actsUp',t:'ally_svt',v:1,times:1}],
  ['ランブル・パーティー','味方全体',{k:'atk',t:'ally_all',v:20,color:'G',turns:1},{k:'onAtkStar',t:'ally_all',v:2,color:'G',turns:1}],
  ['必殺トライデント','味方単体',{k:'pierce',t:'ally_svt',turns:1}],
  ['シーハウス・シャワー','味方単体',{k:'heal',t:'ally_svt',v:150},{k:'np',t:'ally_svt',v:10}],
  ['霊子向上','味方単体',{k:'atk',t:'ally_svt',v:40,color:'B',turns:1},{k:'onAtkNp',t:'ally_svt',v:20,color:'B',turns:1}],
  ['完勝への布石','味方単体',{k:'onAtkStar',t:'ally_svt',v:8,turns:1}],
  ['パニッシュメント','敵単体',{k:'buffImmune',t:'enemy_svt',times:1},{k:'fear',t:'enemy_svt',times:1}],
  ['霊子向上・全','味方全体',{k:'atk',t:'ally_all',v:20,color:'B',turns:1},{k:'onAtkNp',t:'ally_all',v:10,color:'B',turns:1}],
  ['生存への布石','味方単体',{k:'debuffImmune',t:'ally_svt',times:1},{k:'actsUp',t:'ally_svt',v:1,times:1}],
  ['ダウン・スライド','敵単体',{k:'np',t:'enemy_svt',v:-35}],
  ['コード:F','味方単体',{k:'npPow',t:'ally_svt',v:100,turns:1}],
  ['コード:H','味方単体',{k:'onAtkNp',t:'ally_svt',v:15,turns:1}],
  ['浄化回復','味方単体',{k:'heal',t:'ally_svt',v:150},{k:'cleanse',t:'ally_svt'}],
  ['幻想強化','味方単体',{k:'atk',t:'ally_svt',v:30,turns:1},{k:'npPow',t:'ally_svt',v:50,turns:1}],
  ['予測回避','味方単体',{k:'evade',t:'ally_svt',turns:3,times:1},{k:'actsUp',t:'ally_svt',v:1,times:1}],
  ['ブルー・スプラッシュ','味方単体',{k:'atk',t:'ally_svt',v:40,color:'B',turns:1},{k:'npPow',t:'ally_svt',v:50,times:1}],
  ['ファースト・シャイン','味方全体',{k:'npPow',t:'ally_all',v:80,times:1}],
  ['オセチ・パッケージ','味方単体',{k:'maxHp',t:'ally_svt',v:200}],
  ['オーバー・チャージャー','味方単体',{k:'npPow',t:'ally_svt',v:80,turns:1},{k:'cleanse',t:'ally_svt'}],
  ['スター・ブラスター','味方単体',{k:'critPow',t:'ally_svt',v:100,turns:1}],
  ['エスケープ・ポッド','味方単体',{k:'evade',t:'ally_svt',turns:3,times:1},{k:'heal',t:'ally_svt',v:150}],
  ['一斉突撃','味方全体',{k:'atk',t:'ally_all',v:40,color:'R',turns:1}],
  ['三重治療','味方単体',{k:'regenHp',t:'ally_svt',v:50,times:3}],
  ['魔力変換','味方単体',{k:'np',t:'ally_svt',v:10},{k:'onAtkNp',t:'ally_svt',v:10,turns:1}],
  ['オリエンテーリング','味方単体',{k:'atk',t:'ally_svt',v:40,color:'G',turns:1},{k:'npPow',t:'ally_svt',v:50,times:1}],
  ['キャンプファイヤー','味方全体',{k:'critPow',t:'ally_all',v:50,turns:1}],
  ['サバイバルキット','味方単体',{k:'cleanse',t:'ally_svt'},{k:'np',t:'ally_svt',v:10}],
].map(([name,tgt,...eff])=>({name,tgt,eff}));

// ---------- マスターフェイズ（マスタールール） ----------
const MASTER_ACTS = { support:'補助', attack:'攻撃', spell:'令呪', evac:'退避' };

// 出目index(0-5)の行動回数
const faceActs = (d,i)=>RULES.actsTable ? RULES.actsTable[i] : d.faces[i].acts;

// ---------- セリフ ----------
// 各サーヴァントの lines に、場面ごとのセリフを配列で書きます（複数あればランダムに1つ）
// スキル・鉛筆の面ごとの専用セリフ（line）は、あればその場面の通常セリフの代わりに使う
// マスター用のセリフの場面（ペンシルエディタのマスター編集と masters.js の lines）
const MASTER_LINE_KEYS = { support:'補助', attack:'攻撃（マスタールール）', spell:'令呪使用' };
const LINE_KEYS = { start:'戦闘開始', attack:'攻撃', extra:'エクストラアタック', damage:'被ダメージ', skill:'スキル使用', np:'宝具使用', npDamage:'宝具で被ダメージ', defeat:'敗退', win:'勝利' };
const LINE_MIN = { attack:3 };   // 最低限そろえたい種類数（足りないと注意を出す）

// ---------- クラス ----------
// クラスはフレーバー（相性なし）。下の一覧以外の名前も自由に使え、そのときは CLASS_ICON_EXTRA のアイコンになります
// アイコンは img/classes/ に置いてあります
const CLASS_ICONS = {
  // 基本7騎
  'セイバー':'img/classes/saber.webp', 'アーチャー':'img/classes/archer.webp', 'ランサー':'img/classes/lancer.webp',
  'ライダー':'img/classes/rider.webp', 'キャスター':'img/classes/caster.webp', 'アサシン':'img/classes/assassin.webp',
  'バーサーカー':'img/classes/berserker.webp',
  // エクストラ
  'シールダー':'img/classes/shielder.webp', 'ルーラー':'img/classes/ruler.webp', 'アヴェンジャー':'img/classes/avenger.webp',
  'アルターエゴ':'img/classes/alterego.webp', 'ムーンキャンサー':'img/classes/mooncancer.webp', 'フォーリナー':'img/classes/foreigner.webp',
  'プリテンダー':'img/classes/pretender.webp', 'ビースト':'img/classes/beast.webp', 'アークエネミー':'img/classes/archenemy.webp',
  'ガンナー':'img/classes/gunner.webp', 'サーヴァント':'img/classes/servant.webp',
};
const CLASS_ICON_EXTRA = 'img/classes/extra.webp';   // 一覧にないオリジナルクラス用
const CLASSES = Object.keys(CLASS_ICONS);
const CLASSES_BASIC = CLASSES.slice(0,7);
const classIcon = cls=>CLASS_ICONS[cls]||CLASS_ICON_EXTRA;
// 旧データのクラス名を読み替える
const CLASS_LEGACY = { '剣士':'セイバー', '弓兵':'アーチャー', '槍兵':'ランサー', '騎兵':'ライダー', '術士':'キャスター', '暗殺者':'アサシン', '狂戦士':'バーサーカー' };

// ---------- コマンドの種類 ----------
const CMD_TYPES = ['R','B','G','W','ASC']; // W=白(特殊行動) / ASC=霊基再臨面

// ---------- 効果の種類 ----------
// buff: 強化(true)/弱体(false)/どちらでもない(undefined)  val: 値を使う  inst: 即時効果（効果時間なし）
// mental: 精神異常（精神異常解除・精神異常無効の対象）
// timesOnly: 効果時間は回数だけで指定する  perm: 効果時間なし（永続）が正常  color: 色(R/B/G)で限定できる  only: その場所(ult/special)でだけ使える
const FX = {
  atk:{name:'攻撃ダメージ+',buff:true,val:true,color:true}, atkDown:{name:'攻撃ダメージ-',buff:false,val:true},
  def:{name:'被ダメージ-',buff:true,val:true},   defDown:{name:'被ダメージ+',buff:false,val:true},
  critPow:{name:'クリティカル威力+',buff:true,val:true},   // クリティカル時のダメージ増加量に+x
  critMult:{name:'クリティカル倍率',buff:true,val:true},     // クリティカル時のダメージを「+30（Buster+60）・色バフ2倍」の代わりに、クリティカル前のダメージ×x%にする（複数なら最大値）。獲得NP・スターは通常どおり2倍
  evade:{name:'回避',buff:true}, invul:{name:'無敵',buff:true},
  sureHit:{name:'必中',buff:true}, pierce:{name:'無敵貫通',buff:true}, guts:{name:'ガッツ',buff:true,val:true},
  taunt:{name:'ターゲット集中',buff:true},
  critRoll:{name:'クリティカル率アップ',buff:true,val:true}, // クリティカルレベル+x
  debuffUp:{name:'弱体成功率アップ',buff:true,val:true},     // 自分が敵に付ける弱体の判定ロール（ロールN以下）をN+xにする（成功率ダウンと相殺）
  ignoreDef:{name:'被ダメージ減少無視',buff:true},           // 相手の[被ダメージ-x]を受けずに攻撃
  debuffImmune:{name:'弱体無効',buff:true},                  // 弱体効果・弱体ダメージを受けない
  mentalImmune:{name:'精神異常無効',buff:true},              // 精神異常(mental)の弱体を受けない
  nullUnder:{name:'ダメージ無効(x以下)',buff:true,val:true},  // 攻撃1回ごとの最終ダメージがx以下なら0にする（弱体ダメージには効かない）
  // 攻撃時○○：ダメージを与えるコマンドを行うたびに発動（エクストラアタック・宝具では発動しない）。color で色を限定できる
  onAtkStar:{name:'攻撃時スター発生',buff:true,val:true,color:true},
  onAtkNp:{name:'攻撃時NP獲得',buff:true,val:true,color:true},
  actsUp:{name:'最大行動回数+',buff:true,val:true},          // 次の行動回数決定フェイズで出た数に+x（使うと回数を1消費）
  // 毎ターン○○：持ち主の手番の終了フェイズに発動（弱体ダメージの後）
  // ターン開始時○○：持ち主の陣営のターン開始時に発動（スターはそのターンの手持ちに加わる）
  regenHp:{name:'ターン開始時HP回復',buff:true,val:true}, regenNp:{name:'ターン開始時NP獲得',buff:true,val:true},
  regenStar:{name:'ターン開始時スター獲得',buff:true,val:true},
  atkVs:{name:'弱体状態特攻',buff:true,val:true},
  // 属性特攻・特防：trait（サーヴァントの属性 traits の1つ）で相手を限定する
  atkTrait:{name:'特攻',buff:true,val:true,trait:true},      // 攻撃対象が属性 trait を持っていれば攻撃ダメージ+x
  defTrait:{name:'特防',buff:true,val:true,trait:true},      // 攻撃してきた相手が属性 trait を持っていれば被ダメージ-x（被ダメージ減少無視で無視される）           // 攻撃対象が弱体（vs で種類を限定、未指定なら何でも）を受けていれば攻撃ダメージ+x
  counter:{name:'反撃',buff:true,val:true},                  // 攻撃（コマンド・宝具）を受けるたびに攻撃側へxダメージ（補正・無敵・回避の影響なし）
  // 被ダメージ時○○：攻撃対象になったターンの終了フェイズに1回発動（回避・無敵で防いでも発動）
  onHitNp:{name:'被ダメージ時NP獲得',buff:true,val:true},      // NP+x%（呪いで止まる）
  onHitStar:{name:'被ダメージ時スター獲得',buff:true,val:true}, // 自分のマスターがスターx個獲得
  maxHp:{name:'最大HP+',buff:true,val:true},                 // 最大HP+x（付与時にHPもx増える。切れたら最大HPまで下がる）
  cardConv:{name:'カード変換',buff:true,color:true},          // 行動決定で出たコマンド(R/B/G)を color の色に変える（1回変えるごとに回数を1消費）
  // 弱体
  buffImmune:{name:'強化無効',buff:false},                   // 強化効果を受けない
  poison:{name:'毒',buff:false,val:true}, burn:{name:'やけど',buff:false,val:true}, // ターン終了時に値ぶんの弱体ダメージ
  spread:{name:'延焼',buff:false},                           // やけどのダメージ2倍
  curse:{name:'呪い',buff:false,timesOnly:true},             // 被弾時にNPが増えない。重ねると回数が増える
  stun:{name:'スタン',buff:false}, charm:{name:'魅了',buff:false,mental:true},
  fear:{name:'恐怖',buff:false,mental:true},                             // 行動回数-1
  drain:{name:'HP減少',buff:false,val:true,perm:true},      // ターン終了時に値ぶんの弱体ダメージ。重複する（合計）。永続でよい
  sealSkill:{name:'スキル封印',buff:false}, sealUlt:{name:'宝具封印',buff:false},
  critDown:{name:'クリティカル率ダウン',buff:false,val:true},
  debuffDown:{name:'弱体成功率ダウン',buff:false,val:true},   // 自分が敵に付ける弱体の判定ロールをN-xにする。「必ず」の弱体もロール6以下の判定になる
  healBlock:{name:'回復無効',buff:false},                   // HP回復・毎ターンHP回復を受けない // 攻撃時のクリティカルレベル-x（シンプルは出目+x）
  // 即時
  heal:{name:'HP回復',val:true,inst:true}, np:{name:'NP増減',val:true,inst:true}, star:{name:'スター獲得',val:true,inst:true},
  starLoss:{name:'スター消失',val:true,inst:true},             // 対象のマスターがスターを失う
  cleanse:{name:'弱体解除',inst:true}, cleanseMental:{name:'精神異常解除',inst:true}, strip:{name:'強化解除',inst:true},
  instantDeath:{name:'即死',inst:true},                      // 対象のHPを0にする（ガッツがあれば踏みとどまる）
  buffExtend:{name:'強化延長',val:true,inst:true},           // 対象のターン制の強化すべての残りターン+x
  skillCharge:{name:'スキル再使用',val:true,inst:true},      // 対象の使用済みスキルをx個（番号の若い順）もう一度使えるようにする。使ったスキル自身・スキル再使用を持つスキルは戻らない
  dmg:{name:'ダメージ',val:true,inst:true,maxOk:true,only:['ult','master']}, // マスターの補助・令呪では固定ダメージ（補正・無敵・回避なし）。max で対象の最大HPぶん（軽減不可）
  // 特殊行動専用：自分以外の戦闘不能でないサーヴァント1体（敵味方どちらでも）を選び、その鉛筆を代わりにロールして
  // 出た再臨後コマンドをこの行動として使う
  copyRoll:{name:'他のサーヴァントをロール',inst:true,only:'special'},
  // 連続攻撃：このコマンド（宝具ならダメージ効果それぞれ）の攻撃を v 回行う。1回ごとに補正・クリティカル・NP・スターを処理し、
  // 回避・無敵・回数制のバフも1回ごとに消費する。対象の指定は使わない
  multiHit:{name:'連続攻撃',val:true,inst:true,noTgt:true,only:['special','ult']},
  // 自傷：対象（ふつうは自身）に固定ダメージ（補正・無敵・回避なし、NPは増えない）。max にすると対象の最大HPぶん
  selfDmg:{name:'自傷ダメージ',val:true,inst:true,maxOk:true},
  npPow:{name:'宝具威力アップ',buff:true,val:true},        // 宝具のダメージ+x（ダメージ効果1つ・1ヒットごと）
  npPowDown:{name:'宝具威力ダウン',buff:false,val:true},   // 宝具のダメージ-x
  // 説明文：効果は持たない。これがあるスキル・宝具・特殊行動・補助・令呪の説明は、この文章に置き換わる（text）
  desc:{name:'説明文（表示のみ）',inst:true,noTgt:true},
};

// ---------- 効果の分類（エディタで「分類 → 種類」の2段で選ぶ） ----------
// ここにない効果は最後の「その他」に入る
// 条件つき効果（Eff.cond）：条件を満たす相手にだけ働く。condUse の効果は「使う瞬間」（ダメージ計算）に攻撃・防御の相手を見る。
// それ以外は付与するときに対象を見る（満たさない対象には付かない・効かない）
const COND_KINDS = { trait:'属性', fx:'状態', hpBelow:'HP○%以下', hpAbove:'HP○%以上', npFull:'NP満タン', cls:'クラス', id:'キャラクター（ID）' };
// 条件つきセリフ（condLines）で条件を見る相手：other＝その場面の相手（攻撃の対象・攻撃してきた相手・スキルの対象）/ self＝自分 / ally＝自分以外の味方のだれか / enemy＝敵のだれか
const LINE_WHO = { other:'相手・対象', self:'自分', ally:'味方のだれか', enemy:'敵のだれか' };
['atk','atkDown','def','defDown'].forEach(k=>{ if(FX[k]) FX[k].condUse=true; });
const FX_GROUPS = [
  ['攻撃強化', ['atk','npPow','atkVs','atkTrait','ignoreDef','sureHit','pierce','critPow','critMult','critRoll','debuffUp','cardConv','onAtkStar','onAtkNp']],
  ['防御・耐性', ['def','defTrait','evade','invul','guts','taunt','nullUnder','counter','maxHp','debuffImmune','mentalImmune']],
  ['継続・ターン', ['actsUp','regenHp','regenNp','regenStar','onHitNp','onHitStar']],
  ['弱体', ['atkDown','npPowDown','defDown','critDown','debuffDown','poison','burn','spread','drain','curse','stun','charm','fear','sealSkill','sealUlt','healBlock','buffImmune']],
  ['回復・即時', ['heal','np','star','starLoss','cleanse','cleanseMental','strip','buffExtend','skillCharge']],
  ['攻撃・特殊', ['dmg','multiHit','selfDmg','instantDeath','copyRoll']],
  ['表示', ['desc']],
];
function fxGroupOf(k){ const g=FX_GROUPS.find(([,ks])=>ks.includes(k)); return g?g[0]:'その他'; }
function fxGroups(){ // 定義漏れの効果も「その他」として必ず選べるようにする
  const listed=new Set(FX_GROUPS.flatMap(([,ks])=>ks)), rest=Object.keys(FX).filter(k=>!listed.has(k));
  return [...FX_GROUPS.map(([g,ks])=>[g,ks.filter(k=>FX[k])]), ...(rest.length?[['その他',rest]]:[])];
}

// ---------- 効果の対象 ----------
// マスタールールでは「味方全体」に自分のマスターも含む（敵全体のダメージは敵マスターにも当たる。退避で防げる）
const TARGETS = { self:'自身', picked:'選んだ1体', ally_all:'味方全体', enemy_all:'敵全体', target:'攻撃対象', master:TERMS.player,
  svt:`自軍${TERMS.unit}`, enemy_master:`敵${TERMS.player}`, enemy_svt:`選んだ敵${TERMS.unit}`, ally_svt:`選んだ自軍${TERMS.unit}`,
  enemy_both:`敵全体（${TERMS.unit}＋${TERMS.player}）` };
// マスターの補助・令呪では、enemy_all は敵サーヴァントだけ（敵マスターには当たらない）。両方に当てたいときは enemy_both
const mTLabel = t=>t==='enemy_all'?`敵${TERMS.unit}全体`:tLabel(t);
// 場所ごとに使える対象（skill=スキル / ult=宝具 / special=白コマンドの特殊行動 / master=マスターの補助・令呪）
// master の self はマスター自身。master（スター）は自分の陣営
const TGT_BY_CTX = {
  skill:['self','picked','ally_all','enemy_all','master'],
  ult:['self','target','ally_all','enemy_all','master'],
  special:['self','target','ally_all','enemy_all','master'],
  master:['svt','ally_svt','self','ally_all','enemy_all','enemy_both','enemy_svt','enemy_master','master'],
};
const fxOnlyIn = (k,ctx)=>!FX[k].only||[].concat(FX[k].only).includes(ctx); // その場所で使える効果か
const PICKS = { '':'選ばない', ally:'味方単体', other:'自分以外の味方単体', enemy:'敵単体', any:'単体（敵味方）' };

// ---------- エディタ用：カード構成テンプレ（コスト × カード構成） ----------
// 行は出目1〜6。'再臨前>再臨後'。B=Buster A=Arts Q=Quick（コード上は R/B/G）。
// 'B90'=ダメージ90、'A70/15'=ダメージ70・NP15%、'Q50/4'=ダメージ50・スター4、'ASC'=霊基再臨面（再臨後は既存の内容を残す）
const CARD_TPL_HP = {5:850,4:750,3:550,2:500,1:450};
const CARD_TPL_KEYS = ['B3','B2A2','B2Q2','A3','A2Q2','Q3'];
const CARD_TPL = {
 5:{B3:'B90>B120,B90>B110,B80>B100,ASC,A70/15>A90/20,Q50/4>Q60/6',B2A2:'B90>B120,B90>B110,A70/15>A80/20,ASC,A60/10>A70/15,Q50/4>Q60/6',B2Q2:'B90>B120,B90>B110,A70/15>A80/20,ASC,Q50/4>Q60/6,Q50/3>Q60/5',A3:'B90>B120,A70/15>A80/20,A60/10>A70/15,ASC,A50/10>A60/15,Q50/4>Q60/6',A2Q2:'B90>B120,A70/15>A80/20,A60/10>A70/15,ASC,Q50/4>Q60/6,Q50/3>Q60/5',Q3:'B90>B120,A70/15>A80/20,Q50/4>Q60/6,ASC,Q50/3>Q60/5,Q40/3>Q50/5'},
 4:{B3:'B80>B110,B80>B100,B70>B90,ASC,A60/15>A70/20,Q40/4>Q50/6',B2A2:'B80>B110,B80>B100,A60/15>A60/20,ASC,A50/10>A60/15,Q40/4>Q50/6',B2Q2:'B80>B110,B80>B100,A60/15>A60/20,ASC,Q40/4>Q50/6,Q40/3>Q50/5',A3:'B80>B110,A60/15>A70/20,A60/10>A60/15,ASC,A50/10>A60/15,Q40/4>Q50/6',A2Q2:'B80>B110,A60/15>A60/20,A50/10>A60/15,ASC,Q40/4>Q50/6,Q40/3>Q50/5',Q3:'B80>B110,A60/15>A60/20,Q40/4>Q50/6,ASC,Q40/3>Q50/5,Q30/3>Q40/5'},
 3:{B3:'B60>B90,B60>B80,B50>B70,ASC,A50/15>A60/20,Q30/4>Q40/6',B2A2:'B70>B100,B70>B90,A50/15>A60/20,ASC,A40/10>A50/15,Q30/4>Q40/6',B2Q2:'B70>B100,B70>B90,A50/15>A60/20,ASC,Q30/4>Q40/6,Q30/3>Q40/5',A3:'B70>B100,A50/15>A60/20,A40/10>A50/15,ASC,A20/10>A40/15,Q30/4>Q40/6',A2Q2:'B70>B100,A50/15>A60/20,A40/10>A50/15,ASC,Q30/4>Q40/6,Q30/3>Q40/5',Q3:'B70>B100,A50/15>A60/20,Q30/4>Q40/6,ASC,Q30/3>Q40/5,Q20/3>Q30/5'},
 2:{B3:'B50>B90,B50>B80,B40>B70,ASC,A40/20>A50/25,Q20/4>Q30/6',B2A2:'B50>B90,B50>B80,A40/20>A50/25,ASC,A20/15>A40/20,Q20/4>Q30/6',B2Q2:'B50>B90,B50>B80,A40/20>A50/25,ASC,Q20/4>Q30/6,Q20/3>Q30/5',A3:'B50>B90,A40/20>A50/25,A20/15>A40/20,ASC,A10/15>A20/20,Q20/4>Q30/6',A2Q2:'B50>B90,A40/20>A50/25,A20/15>A40/20,ASC,Q20/4>Q30/6,Q20/3>Q30/5',Q3:'B50>B90,A40/20>A50/25,Q20/4>Q30/6,ASC,Q20/3>Q30/5,Q10/3>Q20/5'},
 1:{B3:'B50>B80,B50>B70,B40>B60,ASC,A40/20>A50/25,Q20/4>Q30/6',B2A2:'B50>B80,B50>B70,A40/20>A50/25,ASC,A20/15>A40/20,Q20/4>Q30/6',B2Q2:'B50>B80,B50>B70,A40/20>A50/25,ASC,Q20/4>Q30/6,Q20/3>Q30/5',A3:'B50>B80,A40/20>A50/25,A20/15>A40/20,ASC,A10/15>A20/20,Q20/4>Q30/6',A2Q2:'B50>B80,A40/20>A50/25,A20/15>A40/20,ASC,Q20/4>Q30/6,Q20/3>Q30/5',Q3:'B50>B80,A40/20>A50/25,Q20/4>Q30/6,ASC,Q20/3>Q30/5,Q10/3>Q20/5'}
};

// ---------- 攻撃に付いた効果のタイミング（効果ごとの at） ----------
// コマンド（特殊行動・Buster/Arts/Quick の付加効果）と宝具の効果で使う。スキルでは使わない
//   pre ：攻撃の前に適用（例：防御無視・無敵貫通を付けてから攻撃する）
//   post：攻撃の後に適用（例：攻撃してから自身の弱体を解除する）
//   未指定：既定のタイミング … 特殊行動は攻撃前／通常コマンドは攻撃後／宝具は効果の並び順
const EFF_AT = { pre:'攻撃前', post:'攻撃後' };
const EFF_AT_DEFAULT = { W:'pre', cmd:'post', ult:'order' };
