'use strict';
/* =====================================================================
   ルール定義：用語・数値・クラス相性・効果の種類
   ゲームとペンシルエディタの両方が読み込みます
   ===================================================================== */

// ---------- 用語（画面上の呼び名） ----------
const TERMS = { unit:'ユニット', player:'プレイヤー', gauge:'ゲージ', ult:'必殺技', asc:'覚醒', star:'スター',
  R:'パワー', B:'チャージ', G:'ラッシュ', W:'特殊' };

// ---------- ルール定数 ----------
const RULES = {
  costCap:10, partyMax:3, actionsMax:3,
  gaugeOnHit:10, gaugeMax:300, ultCost:100,
  chainR:30,   // パワーチェイン：各コマンドのダメージ+30
  chainB:20,   // チャージチェイン：行動した全ユニットのゲージ+20%
  chainG:10,   // ラッシュチェイン：スター10個発生
  dot:20,
  dotTiming:'current', // 毒・やけど・呪いの減少対象: 'current'=手番側のみ / 'all'=全ユニット
};
function critThreshold(stars){ if(stars>=30) return 99; if(stars>=14) return 4; if(stars>=7) return 2; if(stars>=1) return 1; return 0; }

// ---------- クラス相性（仮）：原本の相性図に合わせて書き換えてください ----------
const CLASSES = ['剣士','槍兵','弓兵','騎兵','術士','暗殺者','狂戦士'];
const AFFINITY = [ // [攻撃側, 防御側, 倍率]
  ['剣士','槍兵',2],['槍兵','弓兵',2],['弓兵','剣士',2],
  ['槍兵','剣士',.5],['弓兵','槍兵',.5],['剣士','弓兵',.5],
  ['騎兵','術士',2],['術士','暗殺者',2],['暗殺者','騎兵',2],
  ['術士','騎兵',.5],['暗殺者','術士',.5],['騎兵','暗殺者',.5],
];
function affinity(a,d){
  const hit=AFFINITY.find(x=>x[0]===a&&x[1]===d); if(hit) return hit[2];
  if(a==='狂戦士') return 1.5;
  if(d==='狂戦士') return 2;
  return 1;
}

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
  heal:{name:'HP回復',val:true,inst:true}, np:{name:'ゲージ増減',val:true,inst:true}, star:{name:'スター獲得',val:true,inst:true},
  cleanse:{name:'弱体解除',inst:true}, strip:{name:'強化解除',inst:true}, dmg:{name:'ダメージ',val:true,inst:true},
};

// ---------- 効果の対象 ----------
const TARGETS = { self:'自身', picked:'選んだ1体', ally_all:'味方全体', enemy_all:'敵全体', target:'攻撃対象', master:TERMS.player };
// 場所ごとに使える対象（skill=スキル / ult=必殺技 / special=白コマンドの特殊行動）
const TGT_BY_CTX = {
  skill:['self','picked','ally_all','enemy_all','master'],
  ult:['self','target','ally_all','enemy_all','master'],
  special:['self','target','ally_all','enemy_all','master'],
};
const PICKS = { '':'選ばない', ally:'味方単体', enemy:'敵単体', any:'単体（敵味方）' };
