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
const UI_IMG = { circleOut:'img/ui/mcircleo.webp', circleIn:'img/ui/mcirclei.webp' };

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
const RULESETS = {
  team:  { name:'チームバトル', partyMax:3, crit:'d100',
    desc:'3騎まで・コスト合計10以下で編成する基本ルール。' },
  simple:{ name:'シンプル', partyMax:1, crit:'d6', handicapAsc:2,
    desc:`1騎どうしで戦う簡易ルール。相手の${TERMS.unit}を${TERMS.out}にすれば勝利。` },
};

// 出目index(0-5)の行動回数
const faceActs = (d,i)=>RULES.actsTable ? RULES.actsTable[i] : d.faces[i].acts;

// ---------- セリフ ----------
// 各サーヴァントの lines に、場面ごとのセリフを配列で書きます（複数あればランダムに1つ）
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
  evade:{name:'回避',buff:true}, invul:{name:'無敵',buff:true},
  sureHit:{name:'必中',buff:true}, pierce:{name:'無敵貫通',buff:true}, guts:{name:'ガッツ',buff:true,val:true},
  taunt:{name:'ターゲット集中',buff:true},
  critRoll:{name:'クリティカルロール-',buff:true,val:true}, // クリティカルレベル+x
  ignoreDef:{name:'被ダメージ減少無視',buff:true},           // 相手の[被ダメージ-x]を受けずに攻撃
  debuffImmune:{name:'弱体無効',buff:true},                  // 弱体効果・弱体ダメージを受けない
  mentalImmune:{name:'精神異常無効',buff:true},              // 精神異常(mental)の弱体を受けない
  nullUnder:{name:'ダメージ無効(x以下)',buff:true,val:true},  // 攻撃1回ごとの最終ダメージがx以下なら0にする（弱体ダメージには効かない）
  // 攻撃時○○：ダメージを与えるコマンドを行うたびに発動（エクストラアタック・宝具では発動しない）。color で色を限定できる
  onAtkStar:{name:'攻撃時スター発生',buff:true,val:true,color:true},
  onAtkNp:{name:'攻撃時NP獲得',buff:true,val:true,color:true},
  actsUp:{name:'最大行動回数+',buff:true,val:true},          // 次の行動回数決定フェイズで出た数に+x（使うと回数を1消費）
  // 弱体
  buffImmune:{name:'強化無効',buff:false},                   // 強化効果を受けない
  poison:{name:'毒',buff:false,val:true}, burn:{name:'やけど',buff:false,val:true}, // ターン終了時に値ぶんの弱体ダメージ
  spread:{name:'延焼',buff:false},                           // やけどのダメージ2倍
  curse:{name:'呪い',buff:false,timesOnly:true},             // 被弾時にNPが増えない。重ねると回数が増える
  stun:{name:'スタン',buff:false}, charm:{name:'魅了',buff:false,mental:true},
  fear:{name:'恐怖',buff:false,mental:true},                             // 行動回数-1
  drain:{name:'HP減少',buff:false,val:true,perm:true},      // ターン終了時に値ぶんの弱体ダメージ。重複する（合計）。永続でよい
  sealSkill:{name:'スキル封印',buff:false}, sealUlt:{name:'宝具封印',buff:false},
  // 即時
  heal:{name:'HP回復',val:true,inst:true}, np:{name:'NP増減',val:true,inst:true}, star:{name:'スター獲得',val:true,inst:true},
  starLoss:{name:'スター消失',val:true,inst:true},             // 対象のマスターがスターを失う
  cleanse:{name:'弱体解除',inst:true}, cleanseMental:{name:'精神異常解除',inst:true}, strip:{name:'強化解除',inst:true},
  instantDeath:{name:'即死',inst:true},                      // 対象のHPを0にする（ガッツ無効）
  dmg:{name:'ダメージ',val:true,inst:true,only:'ult'},
  // 特殊行動専用：自分以外の戦闘不能でないサーヴァント1体（敵味方どちらでも）を選び、その鉛筆を代わりにロールして
  // 出た再臨後コマンドをこの行動として使う
  copyRoll:{name:'他のサーヴァントをロール',inst:true,only:'special'},
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
