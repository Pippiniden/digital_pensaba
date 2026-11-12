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
      {"label":"連環腿","eff":[{"k":"dmg","t":"enemy_master","v":100}],"line":["絶対領域っ！"]},
      {"label":"宝石魔術・強化","eff":[{"k":"atk","t":"ally_svt","v":20,"color":"B"}]},
      {"label":"ガンド","eff":[{"k":"curse","t":"enemy_svt","v":0,"times":1}],"line":["こんにゃろっ"]},
      {"label":"エアグレネード","eff":[{"k":"dmg","t":"enemy_svt","v":80}]},
      {"label":"アイスグレネード","eff":[{"k":"dmg","t":"enemy_master","v":100}],"line":["Fünf！"]},
      {"label":"スタングレネード","eff":[{"k":"atkDown","t":"enemy_svt","v":10}],"line":["弾けろっ！"]}
    ],
    "spells":[
      {"name":"功程四拍","eff":[{"k":"dmg","t":"enemy_master","v":350}],"line":["内臓一発！"]},
      {"name":"カッティング・セブンカラーズ","eff":[{"k":"stun","t":"enemy_svt","v":0,"turns":1,"chance":2},{"k":"charm","t":"enemy_svt","v":0,"turns":1,"chance":2},{"k":"dmg","t":"enemy_svt","v":200}],"line":["Schuss schießt Beschuss Erschliesung！"]},
      {"name":"宝石剣ゼルレッチ","eff":[{"k":"pierce","t":"self","v":0,"turns":1},{"k":"dmg","t":"enemy_all","v":60}],"line":["Paradigm Cylinder！　溶かし切れ！七色の極光！"]}
    ]
  },
  {
    "id":"m_kiritsugu", "name":"衛宮切嗣", "cost":4, "hp":400,
    "fit":{"face":{"x":50,"y":17,"z":100}},
    "faces":[
      {"label":"息を潜める","eff":[{"k":"desc","t":"svt","v":0,"text":"息を潜めて様子を見る"}]},
      {"label":"狙撃","eff":[{"k":"dmg","t":"enemy_master","v":120}],"line":["ここで、仕留める"]},
      {"label":"キャリコM950","eff":[{"k":"critDown","t":"enemy_all","v":1}],"line":["こっちだ！"]},
      {"label":"狙撃","eff":[{"k":"dmg","t":"enemy_master","v":150}],"line":["ここで、仕留める"]},
      {"label":"狙撃","eff":[{"k":"dmg","t":"enemy_master","v":120}],"line":["ここで、仕留める"]},
      {"label":"破壊工作","eff":[{"k":"defDown","t":"enemy_all","v":10}]}
    ],
    "spells":[
      {"name":"固有時制御","eff":[{"k":"actsUp","t":"svt","v":3,"turns":1}],"line":["タイムアルター・ダブルアクセル！"]},
      {"name":"起源弾","eff":[{"k":"buffImmune","t":"enemy_master","v":0,"turns":3,"chance":3},{"k":"pierce","t":"self","v":0,"turns":1},{"k":"atkVs","t":"self","v":100,"turns":1,"vs":"buffImmune"},{"k":"dmg","t":"enemy_master","v":300}]},
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
      {"label":"深呼吸","eff":[{"k":"desc","t":"self","v":0,"text":"衛宮士郎は呼吸を落ち着かせた"}]}
    ],
    "spells":[
      {"name":"鶴翼三連","eff":[{"k":"sureHit","t":"self","v":0,"turns":1},{"k":"dmg","t":"enemy_master","v":250}],"line":["トレース、オン！"]},
      {"name":"無限の剣製","eff":[{"k":"dmg","t":"enemy_all","v":75},{"k":"atkDown","t":"enemy_all","v":10,"turns":3},{"k":"critRoll","t":"ally_all","v":1,"turns":3}],"line":["この体は無限の剣で出来ていた――"]},
      {"name":"射殺す百頭","eff":[{"k":"dmg","t":"enemy_svt","v":200}],"line":["ナインライブズブレイドワークス……うおおおお！"]}
    ]
  },
  {
    "id":"m_ritsuka", "name":"藤丸立香", "cost":3, "hp":350,
    "fit":{"face":{"x":50,"y":19,"z":100}},
    "faces":[
      {"label":"応急手当","eff":[{"k":"heal","t":"ally_svt","v":30}]},
      {"label":"瞬間強化","eff":[{"k":"atk","t":"ally_svt","v":10}]},
      {"label":"魔力放出","eff":[{"k":"atk","t":"ally_svt","v":20,"times":20,"color":"R"}]},
      {"label":"緊急回避","eff":[{"k":"evade","t":"enemy_svt","v":0,"times":1}]},
      {"label":"様子見","eff":[{"k":"desc","t":"svt","v":0,"text":"藤丸立香は様子を見ている"}]},
      {"label":"様子見","eff":[{"k":"desc","t":"self","v":0,"text":"藤丸立香は様子を見ている"}]}
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
    "id":"m_shinji", "name":"間桐慎二", "cost":1, "hp":150,
    "fit":{"face":{"x":50,"y":15,"z":100}},
    "faces":[
      {"label":"無","eff":[{"k":"desc","t":"svt","v":0,"text":"兄さんは何も出来ないみたいです"}]},
      {"label":"無","eff":[]},
      {"label":"無","eff":[{"k":"desc","t":"svt","v":0,"text":"ワカメ養殖場は豊作のようです"}]},
      {"label":"偽臣の書","eff":[{"k":"atk","t":"ally_svt","v":40}]},
      {"label":"虚勢","eff":[{"k":"star","t":"master","v":6}]},
      {"label":"無","eff":[]}
    ],
    "spells":[
      {"name":"僕のワカメ～死んでもいい2006～","eff":[{"k":"desc","t":"svt","v":0,"text":"PSP版ではこの名前でした"}]},
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
      {"label":"刻印虫の魔力","eff":[{"k":"atk","t":"svt","v":20},{"k":"onAtkNp","t":"svt","v":10}]},
      {"label":"無","eff":[{"k":"desc","t":"svt","v":0,"text":"雁夜は動くことができない"}]},
      {"label":"吐血","eff":[{"k":"desc","t":"svt","v":0,"text":"雁夜は血を吐いた"}]}
    ],
    "spells":[
      {"name":"令呪：宝具解放","eff":[{"k":"np","t":"svt","v":50}]},
      {"name":"令呪：狂化","eff":[{"k":"atk","t":"svt","v":50,"turns":3}]},
      {"name":"翅刃虫","eff":[{"k":"defDown","t":"enemy_all","v":20,"turns":3}]}
    ]
  },
  {
    "id":"m_shadowkaiser", "name":"シャドウカイザー", "cost":4, "hp":350,
    "fit":{"face":{"x":50,"y":0,"z":100}},
    "lines":{"support":["サーヴァントバトル、コマンド・オーダー！","ゆけっ、我が傀儡よ！","ハッハッハッハ……"],"attack":["聖杯戦争は命のやり取りなのだ！"],"spell":["サーヴァントなど勝つための道具にすぎん！","こうなっては令呪を使うほかあるまい！"]},
    "faces":[
      {"label":"無","eff":[]},
      {"label":"シャドウフレイム","eff":[{"k":"dmg","t":"enemy_all","v":20}],"line":["ハッハッハッハ……焼け焦げろ！"]},
      {"label":"シャドウスラッシュ","eff":[{"k":"dmg","t":"enemy_master","v":100}],"line":["貴様はこのシャドウカイザーが仕留める！","サーヴァントバトルとは殺し合いだ！"]},
      {"label":"シャドウインパルス","eff":[{"k":"dmg","t":"enemy_svt","v":80},{"k":"defDown","t":"enemy_svt","v":10}]},
      {"label":"シャドウサンダー","eff":[{"k":"dmg","t":"enemy_svt","v":80}],"line":["轟け、闇の雷鳴よ！"]},
      {"label":"シャドウカース","eff":[{"k":"defDown","t":"enemy_svt","v":10}],"line":["呪われるがいい！","闇の魂よ！"]}
    ],
    "spells":[
      {"name":"ダークブレイザー","eff":[{"k":"stun","t":"enemy_svt","v":0,"turns":1}],"line":["貴様には死が相応しい！"]},
      {"name":"ミラージュソード","eff":[{"k":"dmg","t":"enemy_master","v":300}],"line":["シャドウカイザーが直々に仕留めてやる！"]},
      {"name":"シャドウコマンダー","eff":[{"k":"sureHit","t":"ally_svt","v":0,"turns":1},{"k":"actsUp","t":"ally_svt","v":1,"times":1}],"line":["サーヴァントバトル、シャドウ・オーダー！","確実に仕留めるのだ、我が傀儡よ！"]}
    ]
  },
  {
    "id":"m_kota", "name":"一文字コータ", "cost":3, "hp":300,
    "fit":{"face":{"x":50,"y":0,"z":100}},
    "faces":[
      {"label":"みんな、ぶっとばせ！","eff":[{"k":"atk","t":"svt","v":20,"color":"R"}],"line":["一気にぶっとばしてやれ！","サーヴァントバトル！　コマンド・オーダー！"]},
      {"label":"応援","eff":[{"k":"desc","t":"svt","v":0,"text":"コータは精一杯応援している"}],"line":["みんな、がんばってくれ！"]},
      {"label":"変幻自在の攻撃だ！","eff":[{"k":"onAtkNp","t":"svt","v":10,"color":"B"}],"line":["サーヴァントバトル！　コマンド・オーダー！"]},
      {"label":"必殺の作戦だ！","eff":[{"k":"atk","t":"ally_svt","v":30},{"k":"onAtkNp","t":"ally_svt","v":10},{"k":"onAtkStar","t":"ally_svt","v":3}],"line":["とびっきりの作戦、いくぞ！"]},
      {"label":"ひらめき","eff":[{"k":"desc","t":"svt","v":0,"text":"コータは何かひらめいたようだ"}],"line":["そうか、そうだったのか！","わかったぞ！"]},
      {"label":"スピードで撹乱しろ！","eff":[{"k":"onAtkStar","t":"enemy_master","v":3,"color":"G"}],"line":["スピードで攻めろ！","サーヴァントバトル！　コマンド・オーダー！"]}
    ],
    "spells":[
      {"name":"コマンド：リカバリー","eff":[{"k":"heal","t":"ally_svt","v":200}],"line":["みんな、大丈夫か！？"]},
      {"name":"コマンド：オーバーパワー","eff":[{"k":"np","t":"ally_svt","v":30}],"line":["俺達の絆を見せてやろう！"]},
      {"name":"コマンド：スピーダー","eff":[{"k":"evade","t":"ally_svt","v":0,"turns":1},{"k":"actsUp","t":"ally_svt","v":1,"times":1}],"line":["かわせ、オレのサーヴァント！"]}
    ]
  },
  {
    "id":"m_ssetsuna", "name":"五月雨刹那", "cost":4, "hp":400,
    "fit":{"face":{"x":50,"y":0,"z":100}},
    "faces":[
      {"label":"","eff":[{"k":"onAtkStar","t":"ally_svt","v":3},{"k":"onAtkNp","t":"svt","v":5,"cond":{"k":"trait","v":"女性"}}]},
      {"label":"","eff":[{"k":"star","t":"master","v":6},{"k":"atk","t":"svt","v":10}]},
      {"label":"","eff":[{"k":"atk","t":"ally_svt","v":30,"color":"R"},{"k":"critRoll","t":"svt","v":1,"cond":{"k":"trait","v":"女性"}}]},
      {"label":"","eff":[{"k":"charm","t":"enemy_svt","v":0,"chance":4,"cond":{"k":"trait","v":"女性"}}]},
      {"label":"","eff":[{"k":"onAtkNp","t":"ally_svt","v":15,"color":"B"},{"k":"atk","t":"svt","v":10,"cond":{"k":"trait","v":"女性"}}]},
      {"label":"","eff":[]}
    ],
    "spells":[
      {"name":"緊急回避","eff":[{"k":"evade","t":"ally_svt","v":0,"turns":1},{"k":"actsUp","t":"ally_svt","v":1,"times":1},{"k":"np","t":"svt","v":20,"cond":{"k":"trait","v":"女性"}}]},
      {"name":"流脈利用式治癒","eff":[{"k":"cleanse","t":"ally_svt","v":0},{"k":"heal","t":"ally_svt","v":150}]},
      {"name":"火炎放出","eff":[{"k":"actsDown","t":"enemy_svt","v":1,"turns":1},{"k":"critDown","t":"enemy_svt","v":1,"turns":1},{"k":"dmg","t":"enemy_svt","v":80},{"k":"atkDown","t":"enemy_svt","v":10,"turns":1,"cond":{"k":"trait","v":"男性"}}]}
    ]
  },
  {
    "id":"m_jubiro", "name":"石鷹授比郎", "cost":1, "hp":100,
    "fit":{"face":{"x":50,"y":0,"z":100}},
    "lines":{"support":["こいつぁスゲェ！！なんて入り組んだストーリーと謎だ！！","この聖杯戦争に！！俺達の骨を埋めてやろうじゃねぇかぁ！！","この戦争に勝てないと心が折れたら、逃げ時だぜ？"],"attack":[],"spell":["先の詠める漫画なんざつまらないにもほどがあるだろうがァァアアア！！！","この聖杯戦争ッ！！”俺に描かせろ”ッッッ！！！！"]},
    "faces":[
      {"label":"","eff":[{"k":"atk","t":"ally_svt","v":30,"color":"R"},{"k":"onAtkNp","t":"ally_svt","v":5}]},
      {"label":"","eff":[]},
      {"label":"","eff":[]},
      {"label":"","eff":[{"k":"critRoll","t":"ally_svt","v":2},{"k":"critPow","t":"svt","v":30}]},
      {"label":"","eff":[]},
      {"label":"","eff":[]}
    ],
    "spells":[
      {"name":"しおさいと銅鑼","eff":[{"k":"actsUp","t":"ally_svt","v":3,"turns":1},{"k":"critRoll","t":"ally_svt","v":2,"turns":1},{"k":"np","t":"ally_svt","v":20}]},
      {"name":"倶利伽羅サーフィス","eff":[{"k":"evade","t":"ally_svt","v":0,"turns":1},{"k":"heal","t":"ally_svt","v":250},{"k":"cleanse","t":"ally_svt","v":0},{"k":"np","t":"ally_svt","v":10}]},
      {"name":"日光条約","eff":[{"k":"sealUlt","t":"enemy_svt","v":0,"turns":1,"chance":4},{"k":"sealSkill","t":"enemy_svt","v":0,"turns":1,"chance":4},{"k":"fear","t":"enemy_svt","v":0,"turns":1,"chance":4},{"k":"stun","t":"svt","v":0,"turns":1,"chance":4}]}
    ]
  },
  {
    "id":"m_seimei", "name":"安倍晴明", "cost":5, "hp":500,
    "fit":{"face":{"x":50,"y":0,"z":119}},
    "faces":[
      {"label":"鉄拳","eff":[{"k":"dmg","t":"enemy_master","v":120}],"line":["ふはははは！　貴様に術など不要！"]},
      {"label":"鉄拳","eff":[{"k":"dmg","t":"enemy_master","v":120}],"line":["ふはははは！　貴様に術など不要！"]},
      {"label":"陰陽術","eff":[{"k":"dmg","t":"enemy_svt","v":100}],"line":["どれ……小手調べをしてやろう","神秘で我に勝てると思うな！"]},
      {"label":"蜜の援護","eff":[{"k":"heal","t":"svt","v":100}],"line":["晴明様、お手伝いいたします！"]},
      {"label":"陰陽術","eff":[{"k":"dmg","t":"enemy_svt","v":100}],"line":["どれ……小手調べをしてやろう","神秘で我に勝てると思うな！"]},
      {"label":"霊符","eff":[{"k":"atk","t":"ally_svt","v":20}],"line":["どれ……これが必要というわけか？"]}
    ],
    "spells":[
      {"name":"脳天締め","eff":[{"k":"dmg","t":"enemy_svt","v":150}],"line":["ふはははははは！　まだ我に歯向かうか！"]},
      {"name":"脊椎砕き","eff":[{"k":"dmg","t":"enemy_master","v":200},{"k":"stun","t":"enemy_master","v":0,"turns":1}],"line":["ふはははははは！　砕けよ！"]},
      {"name":"結界術","eff":[{"k":"invul","t":"ally_svt","v":0,"turns":1}],"line":["どれ……我の結界を見せるとしよう"]}
    ]
  },
  {
    "id":"m_kuzunoha", "name":"葛の葉", "cost":1, "hp":100,
    "fit":{"face":{"x":50,"y":0,"z":100}},
    "faces":[
      {"label":"無","eff":[],"line":["わはは、このマンガは面白いのう！"]},
      {"label":"狸丼","eff":[{"k":"heal","t":"ally_svt","v":30}],"line":["狸丼さんや、おやつを持ってきてたもれ"]},
      {"label":"無","eff":[],"line":["うーむ、乳が邪魔で動けんのじゃ"]},
      {"label":"狸豆","eff":[{"k":"onAtkNp","t":"ally_svt","v":10}],"line":["狸豆さんや、あの子を手伝っといで"]},
      {"label":"無","eff":[],"line":["いなりは壺屋に限るのう！"]},
      {"label":"無","eff":[],"line":["お昼寝でもしたいのう……"]}
    ],
    "spells":[
      {"name":"いなりぱーてぃー","eff":[{"k":"heal","t":"ally_all","v":100}],"line":["今日は大盤振る舞いじゃの！"]},
      {"name":"ちちびんたみか","eff":[{"k":"stun","t":"enemy_svt","v":0,"turns":1}],"line":["ほーれほれ、これが女狐の力じゃぞい"]},
      {"name":"狐の魔力","eff":[{"k":"np","t":"ally_svt","v":30}],"line":["たまにはちとやる気を出そうかの"]}
    ]
  },
  {
    "id":"m_kiri", "name":"ドクトル・キリ", "cost":3, "hp":300,
    "fit":{"face":{"x":50,"y":0,"z":100}},
    "faces":[
      {"label":"無","eff":[],"line":["ん？　まちがったかな……"]},
      {"label":"治療手術","eff":[{"k":"heal","t":"ally_svt","v":30}],"line":["ま、この程度ならねー"]},
      {"label":"怪しい薬","eff":[{"k":"onAtkNp","t":"ally_svt","v":5}],"line":["これを飲めば君の力は百人力！"]},
      {"label":"パピリオ・マギア","eff":[{"k":"atk","t":"svt","v":30},{"k":"heal","t":"svt","v":80}],"line":["さぁさぁ、楽しい改造手術の時間だよ！"]},
      {"label":"メス","eff":[{"k":"dmg","t":"enemy_master","v":100}],"line":["おっと、隙ありー！"]},
      {"label":"無","eff":[],"line":["ん？　まちがったかな……"]}
    ],
    "spells":[
      {"name":"ケミカルブースト","eff":[{"k":"actsUp","t":"ally_svt","v":3,"times":1}],"line":["悪に障害は無いのさぁ！"]},
      {"name":"違法改造","eff":[{"k":"skillCharge","t":"ally_svt","v":1}],"line":["さあ、キリキリ働きなよ！"]},
      {"name":"巨大メス","eff":[{"k":"dmg","t":"enemy_master","v":300}],"line":["さーて、解剖のお時間だよ！"]}
    ]
  }
];
