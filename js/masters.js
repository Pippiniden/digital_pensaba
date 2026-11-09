'use strict';
// ※ 以下の7人はマスタールールの動作確認用のテスト用キャラクターです（後で差し替え・削除する予定）
// マスターデータ（ペンシルエディタで書き出し）。マスタールール・マスターチームで使う
// faces : 補助で振る鉛筆の面1〜6。eff が空なら「無」（何も起きない）。効果はそのターンだけ
// spells: 令呪3種
// 効果の対象（t）: svt=自軍サーヴァント / self=マスター自身 / ally_all=味方全体（マスター含む）
//                  enemy_all=敵サーヴァント / enemy_master=敵マスター / master=自陣のスター
const DEFAULT_MASTERS = [
  {
    "id":"m_rin", "name":"遠坂凛", "cost":5, "hp":200,
    "faces":[
      {"label":"無","eff":[]},
      {"label":"宝石魔術・強化","eff":[{"k":"atk","t":"svt","v":30}]},
      {"label":"ガンド","eff":[{"k":"defDown","t":"enemy_all","v":30}]},
      {"label":"宝石魔術・治癒","eff":[{"k":"heal","t":"svt","v":120}]},
      {"label":"宝石投擲","eff":[{"k":"dmg","t":"enemy_master","v":80}]},
      {"label":"魔力供給","eff":[{"k":"np","t":"svt","v":30}]}
    ],
    "spells":[
      {"name":"令呪：宝具解放","eff":[{"k":"np","t":"svt","v":100}]},
      {"name":"令呪：霊基修復","eff":[{"k":"heal","t":"svt","v":500}]},
      {"name":"令呪：全力強化","eff":[{"k":"atk","t":"svt","v":50,"turns":3}]}
    ]
  },
  {
    "id":"m_kiritsugu", "name":"衛宮切嗣", "cost":4, "hp":180,
    "faces":[
      {"label":"無","eff":[]},
      {"label":"固有時制御","eff":[{"k":"critRoll","t":"svt","v":2}]},
      {"label":"起源弾","eff":[{"k":"strip","t":"enemy_all","v":0}]},
      {"label":"トンプソン・コンテンダー","eff":[{"k":"dmg","t":"enemy_master","v":70}]},
      {"label":"狙撃","eff":[{"k":"dmg","t":"enemy_all","v":40}]},
      {"label":"魔術師殺し","eff":[{"k":"defDown","t":"enemy_all","v":30}]}
    ],
    "spells":[
      {"name":"令呪：宝具解放","eff":[{"k":"np","t":"svt","v":100}]},
      {"name":"令呪：無敵","eff":[{"k":"invul","t":"svt","v":0,"turns":2,"times":2}]},
      {"name":"令呪：攻撃強化","eff":[{"k":"atk","t":"svt","v":40,"turns":3}]}
    ]
  },
  {
    "id":"m_shirou", "name":"衛宮士郎", "cost":3, "hp":160,
    "faces":[
      {"label":"無","eff":[]},
      {"label":"強化魔術","eff":[{"k":"atk","t":"svt","v":20}]},
      {"label":"投影魔術","eff":[{"k":"atk","t":"svt","v":20},{"k":"star","t":"master","v":5}]},
      {"label":"無","eff":[]},
      {"label":"干将・莫耶","eff":[{"k":"dmg","t":"enemy_master","v":50}]},
      {"label":"魔力供給","eff":[{"k":"np","t":"svt","v":20}]}
    ],
    "spells":[
      {"name":"令呪：宝具解放","eff":[{"k":"np","t":"svt","v":100}]},
      {"name":"令呪：全て遠き理想郷","eff":[{"k":"heal","t":"svt","v":300},{"k":"def","t":"svt","v":30,"turns":2}]},
      {"name":"令呪：限界突破","eff":[{"k":"atk","t":"svt","v":40,"turns":2}]}
    ]
  },
  {
    "id":"m_ritsuka", "name":"藤丸立香", "cost":3, "hp":150,
    "faces":[
      {"label":"無","eff":[]},
      {"label":"応急手当","eff":[{"k":"heal","t":"svt","v":80}]},
      {"label":"瞬間強化","eff":[{"k":"atk","t":"svt","v":20}]},
      {"label":"霊子譲渡","eff":[{"k":"np","t":"svt","v":20}]},
      {"label":"ガンド","eff":[{"k":"defDown","t":"enemy_all","v":20}]},
      {"label":"スター供給","eff":[{"k":"star","t":"master","v":8}]}
    ],
    "spells":[
      {"name":"令呪：宝具解放","eff":[{"k":"np","t":"svt","v":100}]},
      {"name":"令呪：霊基修復","eff":[{"k":"heal","t":"svt","v":9999}]},
      {"name":"令呪：回避","eff":[{"k":"evade","t":"svt","v":0,"turns":2,"times":2}]}
    ]
  },
  {
    "id":"m_celenike", "name":"セレニケ・アイスコル・ユグドミレニア", "cost":2, "hp":120,
    "faces":[
      {"label":"無","eff":[]},
      {"label":"黒魔術","eff":[{"k":"defDown","t":"enemy_all","v":20}]},
      {"label":"生贄の儀","eff":[{"k":"np","t":"svt","v":15}]},
      {"label":"無","eff":[]},
      {"label":"呪いの針","eff":[{"k":"dmg","t":"enemy_master","v":40}]},
      {"label":"魔力供給","eff":[{"k":"atk","t":"svt","v":15}]}
    ],
    "spells":[
      {"name":"令呪：宝具解放","eff":[{"k":"np","t":"svt","v":100}]},
      {"name":"令呪：呪詛","eff":[{"k":"curse","t":"enemy_all","v":0,"times":3}]},
      {"name":"令呪：強化","eff":[{"k":"atk","t":"svt","v":30,"turns":3}]}
    ]
  },
  {
    "id":"m_shinji", "name":"間桐慎二", "cost":1, "hp":100,
    "faces":[
      {"label":"無","eff":[]},
      {"label":"無","eff":[]},
      {"label":"偽臣の書","eff":[{"k":"atk","t":"svt","v":15}]},
      {"label":"無","eff":[]},
      {"label":"虚勢","eff":[{"k":"star","t":"master","v":3}]},
      {"label":"魔力供給","eff":[{"k":"np","t":"svt","v":10}]}
    ],
    "spells":[
      {"name":"令呪：宝具解放","eff":[{"k":"np","t":"svt","v":100}]},
      {"name":"令呪：回復","eff":[{"k":"heal","t":"svt","v":200}]},
      {"name":"令呪：強化","eff":[{"k":"atk","t":"svt","v":30,"turns":2}]}
    ]
  },
  {
    "id":"m_kariya", "name":"間桐雁夜", "cost":0, "hp":80,
    "faces":[
      {"label":"無","eff":[]},
      {"label":"蟲使い","eff":[{"k":"defDown","t":"enemy_all","v":15}]},
      {"label":"無","eff":[]},
      {"label":"刻印虫の魔力","eff":[{"k":"atk","t":"svt","v":20}]},
      {"label":"無","eff":[]},
      {"label":"狂化供給","eff":[{"k":"np","t":"svt","v":10}]}
    ],
    "spells":[
      {"name":"令呪：宝具解放","eff":[{"k":"np","t":"svt","v":100}]},
      {"name":"令呪：狂化","eff":[{"k":"atk","t":"svt","v":40,"turns":3}]},
      {"name":"令呪：回復","eff":[{"k":"heal","t":"svt","v":200}]}
    ]
  }
];
