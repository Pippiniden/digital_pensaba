'use strict';
/* =====================================================================
   ルール定義：用語・数値・クラス・効果の種類
   ゲームとペンシルエディタの両方が読み込みます
   ===================================================================== */

// ---------- 用語（画面上の呼び名） ----------
const TERMS = { unit:'サーヴァント', player:'マスター', gauge:'NP', ult:'宝具', asc:'覚醒', star:'スター',
  R:'Buster', B:'Arts', G:'Quick', W:'特殊' };

// ---------- 画像 ----------
// 各サーヴァントの img に書くもの
//   face: キャラクター画像（必須。空欄・読み込めないときは IMG_PLACEHOLDER.face の仮画像）
//   card: コマンドカードに載せるキャラ画像（空欄なら face を使う。背景を透過したPNG/WebPだと映えます）
const IMG_KEYS = { face:'キャラクター画像', card:'カード用キャラ画像' };
const IMG_PLACEHOLDER = { face:'img/placeholder/face.svg', card:'img/placeholder/card.svg' }; // card は背景透過の仮画像

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
const UI_IMG = { circleOut:'img/ui/mcircleo.webp', circleIn:'img/ui/mcirclei.webp' };

// ---------- ルール定数 ----------
const RULES = {
  costCap:10, partyMax:3, actionsMax:3,
  gaugeOnHit:10, gaugeMax:300, ultCost:100,
  chainR:30,   // Busterチェイン：各コマンドのダメージ+30
  chainB:20,   // Artsチェイン：行動した全サーヴァントのNP+20%
  chainG:10,   // Quickチェイン：スター10個発生
  dot:20,
  dotTiming:'current', // 毒・やけど・呪いの減少対象: 'current'=手番側のみ / 'all'=全ユニット
};
function critThreshold(stars){ if(stars>=30) return 99; if(stars>=14) return 4; if(stars>=7) return 2; if(stars>=1) return 1; return 0; }

// ---------- セリフ ----------
// 各サーヴァントの lines に、場面ごとのセリフを配列で書きます（複数あればランダムに1つ）
const LINE_KEYS = { start:'戦闘開始', attack:'攻撃', damage:'被ダメージ', skill:'スキル使用', np:'宝具使用', npDamage:'宝具で被ダメージ', defeat:'敗退', win:'勝利' };
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
const CMD_TYPES = ['R','B','G','W','ASC']; // W=白(特殊行動) / ASC=覚醒面

// ---------- 効果の種類 ----------
// buff: 強化(true)/弱体(false)/どちらでもない(undefined)  val: 値を使う  inst: 即時効果（効果時間なし）
const FX = {
  atk:{name:'攻撃ダメージ+',buff:true,val:true}, atkDown:{name:'攻撃ダメージ-',buff:false,val:true},
  def:{name:'被ダメージ-',buff:true,val:true},   defDown:{name:'被ダメージ+',buff:false,val:true},
  critPow:{name:'クリティカル威力',buff:true,val:true}, evade:{name:'回避',buff:true}, invul:{name:'無敵',buff:true},
  sureHit:{name:'必中',buff:true}, pierce:{name:'無敵貫通',buff:true}, guts:{name:'ガッツ',buff:true,val:true},
  taunt:{name:'ターゲット集中',buff:true}, critRoll:{name:'クリティカルロール-',buff:true,val:true},
  poison:{name:'毒',buff:false}, burn:{name:'やけど',buff:false}, curse:{name:'呪い',buff:false},
  stun:{name:'スタン',buff:false}, charm:{name:'魅了',buff:false},
  heal:{name:'HP回復',val:true,inst:true}, np:{name:'NP増減',val:true,inst:true}, star:{name:'スター獲得',val:true,inst:true},
  cleanse:{name:'弱体解除',inst:true}, strip:{name:'強化解除',inst:true}, dmg:{name:'ダメージ',val:true,inst:true},
};

// ---------- 効果の対象 ----------
const TARGETS = { self:'自身', picked:'選んだ1体', ally_all:'味方全体', enemy_all:'敵全体', target:'攻撃対象', master:TERMS.player };
// 場所ごとに使える対象（skill=スキル / ult=宝具 / special=白コマンドの特殊行動）
const TGT_BY_CTX = {
  skill:['self','picked','ally_all','enemy_all','master'],
  ult:['self','target','ally_all','enemy_all','master'],
  special:['self','target','ally_all','enemy_all','master'],
};
const PICKS = { '':'選ばない', ally:'味方単体', enemy:'敵単体', any:'単体（敵味方）' };
