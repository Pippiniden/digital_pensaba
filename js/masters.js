'use strict';
// マスターデータ（ペンシルエディタで書き出し）。マスタールール・マスターチームで使う
// faces : 補助で振る鉛筆の面1〜6。eff が空なら「無」（何も起きない）。効果はそのターンだけ
// spells: 令呪3種
// lines : セリフ（support=補助 / attack=攻撃 / spell=令呪使用）。faces・spells の line は、その面・令呪だけの専用セリフ（任意）
// 効果の対象（t）: svt=自軍サーヴァント / self=マスター自身 / ally_all=味方全体（マスター含む）
//                  enemy_all=敵サーヴァント全員（敵マスターには当たらない） / enemy_both=敵全体（敵サーヴァント全員＋敵マスター）
//                  enemy_svt=選んだ敵サーヴァント / enemy_master=敵マスター / master=自陣のスター
const DEFAULT_MASTERS = [
  {
    "id":"m_rin", "name":"遠坂凛", "cost":5, "hp":500,
    "fit":{"face":{"x":50,"y":31,"z":100}},
    "lines":{"support":["行くわよっ！"],"attack":[],"spell":[]},
    "faces":[
      {"label":"連環腿","eff":[{"k":"dmg","t":"enemy_master","v":120}],"line":["絶対領域っ！"]},
      {"label":"宝石魔術・強化","eff":[{"k":"atk","t":"ally_svt","v":30,"color":"B"}]},
      {"label":"ガンド","eff":[{"k":"stun","t":"enemy_svt","v":0,"chance":3}],"line":["こんにゃろっ"]},
      {"label":"エアグレネード","eff":[{"k":"dmg","t":"enemy_svt","v":100}]},
      {"label":"アイスグレネード","eff":[{"k":"dmg","t":"enemy_master","v":120}],"line":["Fünf！"]},
      {"label":"スタングレネード","eff":[{"k":"stun","t":"enemy_all","v":0,"chance":2}],"line":["弾けろっ！"]}
    ],
    "spells":[
      {"name":"功程四拍","eff":[{"k":"dmg","t":"enemy_master","v":350}],"line":["内臓一発！"]},
      {"name":"カッティング・セブンカラーズ","eff":[{"k":"stun","t":"enemy_svt","v":0,"turns":1,"chance":2},{"k":"charm","t":"enemy_svt","v":0,"turns":1,"chance":2},{"k":"dmg","t":"enemy_svt","v":250}],"line":["Schuss schießt Beschuss Erschliesung！"]},
      {"name":"宝石剣ゼルレッチ","eff":[{"k":"sureHit","t":"self","v":0,"turns":1},{"k":"pierce","t":"self","v":0,"turns":1},{"k":"dmg","t":"enemy_all","v":150}],"line":["Paradigm Cylinder！　溶かし切れ！七色の極光！"]}
    ]
  },
  {
    "id":"m_kiritsugu", "name":"衛宮切嗣", "cost":4, "hp":400,
    "fit":{"face":{"x":50,"y":17,"z":100}},
    "faces":[
      {"label":"息を潜める","eff":[{"k":"desc","t":"svt","v":0,"text":"息を潜めて様子を見る"}]},
      {"label":"狙撃","eff":[{"k":"dmg","t":"enemy_master","v":100}],"line":["ここで、仕留める"]},
      {"label":"キャリコM950","eff":[{"k":"stun","t":"enemy_all","v":0,"chance":1}],"line":["こっちだ！"]},
      {"label":"狙撃","eff":[{"k":"dmg","t":"enemy_master","v":150}],"line":["ここで、仕留める"]},
      {"label":"狙撃","eff":[{"k":"dmg","t":"enemy_master","v":100}],"line":["ここで、仕留める"]},
      {"label":"破壊工作","eff":[{"k":"defDown","t":"enemy_all","v":10}]}
    ],
    "spells":[
      {"name":"固有時制御","eff":[{"k":"actsUp","t":"self","v":1,"turns":1}],"line":["タイムアルター・ダブルアクセル！"]},
      {"name":"起源弾","eff":[{"k":"buffImmune","t":"enemy_master","v":0,"turns":3,"chance":3},{"k":"pierce","t":"self","v":0,"turns":1},{"k":"atkVs","t":"self","v":50,"turns":1,"vs":"buffImmune"},{"k":"dmg","t":"enemy_master","v":250}]},
      {"name":"令呪：攻撃強化","eff":[{"k":"atk","t":"svt","v":40,"turns":1}],"line":["令呪を以て我が傀儡に命ず！"]}
    ]
  },
  {
    "id":"m_shirou", "name":"衛宮士郎", "cost":3, "hp":350,
    "fit":{"face":{"x":50,"y":45,"z":100}},
    "faces":[
      {"label":"深呼吸","eff":[{"k":"desc","t":"svt","v":0,"text":"深呼吸で息を整える"}]},
      {"label":"強化魔術","eff":[{"k":"atk","t":"ally_svt","v":20}]},
      {"label":"精密狙撃","eff":[{"k":"dmg","t":"enemy_master","v":100}]},
      {"label":"投影魔術","eff":[{"k":"atk","t":"ally_svt","v":20,"color":"R"},{"k":"onAtkNp","t":"ally_svt","v":10,"color":"B"},{"k":"onAtkStar","t":"ally_svt","v":3,"color":"G"}],"line":["トレース……オン"]},
      {"label":"干将・莫耶","eff":[{"k":"dmg","t":"enemy_svt","v":50},{"k":"def","t":"enemy_svt","v":10}]},
      {"label":"魔力供給","eff":[{"k":"np","t":"ally_svt","v":10}]}
    ],
    "spells":[
      {"name":"鶴翼三連","eff":[{"k":"sureHit","t":"self","v":0,"turns":3},{"k":"dmg","t":"enemy_master","v":250}],"line":["トレース、オン！"]},
      {"name":"無限の剣製","eff":[{"k":"dmg","t":"enemy_all","v":150},{"k":"atkDown","t":"enemy_all","v":30,"turns":3},{"k":"critRoll","t":"ally_all","v":2,"turns":3}],"line":["この体は無限の剣で出来ていた――"]},
      {"name":"射殺す百頭","eff":[{"k":"dmg","t":"enemy_svt","v":200}],"line":["ナインライブズブレイドワークス……うおおおお！"]}
    ]
  },
  {
    "id":"m_ritsuka", "name":"藤丸立香", "cost":3, "hp":350,
    "fit":{"face":{"x":50,"y":19,"z":100}},
    "faces":[
      {"label":"応急手当","eff":[{"k":"heal","t":"ally_svt","v":30}]},
      {"label":"瞬間強化","eff":[{"k":"atk","t":"ally_svt","v":10}]},
      {"label":"緊急回避","eff":[{"k":"evade","t":"ally_svt","v":0,"times":1}]},
      {"label":"ガンド","eff":[{"k":"stun","t":"enemy_svt","v":0,"chance":2}]},
      {"label":"勝利への確信","eff":[{"k":"star","t":"master","v":4}]},
      {"label":"魔力放出","eff":[{"k":"atk","t":"ally_svt","v":20,"color":"R"}]}
    ],
    "spells":[
      {"name":"令呪：宝具解放","eff":[{"k":"np","t":"svt","v":30}]},
      {"name":"令呪：霊基修復","eff":[{"k":"heal","t":"svt","v":500}]},
      {"name":"令呪：強化","eff":[{"k":"atk","t":"svt","v":40,"turns":1,"times":1}]}
    ]
  },
  {
    "id":"m_celenike", "name":"セレニケ・アイスコル・ユグドミレニア", "cost":2, "hp":300,
    "fit":{"face":{"x":50,"y":15,"z":100}},
    "faces":[
      {"label":"何もしない","eff":[{"k":"desc","t":"svt","v":0,"text":"セレニケは地下で何かやっている"}]},
      {"label":"何もしない","eff":[],"line":["セレニケは地下で何かやっている"]},
      {"label":"観察","eff":[{"k":"desc","t":"svt","v":0,"text":"セレニケは地下で何かやっている"}]},
      {"label":"黒魔術","eff":[{"k":"defDown","t":"enemy_all","v":20}]},
      {"label":"呪殺","eff":[{"k":"curse","t":"enemy_svt","v":0,"times":1}]},
      {"label":"鞭打ち","eff":[{"k":"dmg","t":"enemy_master","v":100}]}
    ],
    "spells":[
      {"name":"令呪：宝具解放","eff":[{"k":"np","t":"svt","v":30}]},
      {"name":"令呪：呪詛","eff":[{"k":"curse","t":"enemy_all","v":0,"times":3}]},
      {"name":"令呪：強化","eff":[{"k":"atk","t":"svt","v":40,"turns":1}]}
    ]
  },
  {
    "id":"m_shinji", "name":"間桐慎二", "cost":1, "hp":250,
    "fit":{"face":{"x":50,"y":15,"z":100}},
    "faces":[
      {"label":"無","eff":[{"k":"desc","t":"svt","v":0,"text":"兄さんは何も出来ないみたいです"}]},
      {"label":"無","eff":[]},
      {"label":"偽臣の書","eff":[{"k":"atk","t":"svt","v":10}]},
      {"label":"無","eff":[{"k":"desc","t":"svt","v":0,"text":"ワカメ養殖場は豊作のようです"}]},
      {"label":"虚勢","eff":[{"k":"star","t":"master","v":3}]},
      {"label":"無","eff":[]}
    ],
    "spells":[
      {"name":"僕のワカメ～死んでもいい2006～","eff":[{"k":"desc","t":"svt","v":0}]},
      {"name":"僕のワカメ～ひとりのビッグ・ショウ2006～","eff":[{"k":"actsUp","t":"svt","v":3,"times":1}]},
      {"name":"令呪：回避","eff":[{"k":"evade","t":"svt","v":0,"times":3}]}
    ]
  },
  {
    "id":"m_kariya", "name":"間桐雁夜", "cost":0, "hp":50,
    "fit":{"face":{"x":50,"y":20,"z":100}},
    "faces":[
      {"label":"無","eff":[{"k":"desc","t":"svt","v":0,"text":"雁夜は苦しみに耐え、うずくまっている"}]},
      {"label":"吐血","eff":[{"k":"desc","t":"svt","v":0,"text":"雁夜は血を吐いた"}]},
      {"label":"吐血","eff":[{"k":"desc","t":"self","v":0,"text":"雁夜の胃から血液が逆流している"}]},
      {"label":"刻印虫の魔力","eff":[{"k":"atk","t":"svt","v":20},{"k":"np","t":"svt","v":10}]},
      {"label":"無","eff":[{"k":"desc","t":"svt","v":0,"text":"雁夜は動くことができない"}]},
      {"label":"吐血","eff":[{"k":"desc","t":"svt","v":0,"text":"雁夜は血を吐いた"}]}
    ],
    "spells":[
      {"name":"令呪：宝具解放","eff":[{"k":"np","t":"svt","v":50}]},
      {"name":"令呪：狂化","eff":[{"k":"atk","t":"svt","v":50,"turns":3}]},
      {"name":"翅刃虫","eff":[{"k":"defDown","t":"enemy_all","v":20,"turns":3}]}
    ]
  }
];
