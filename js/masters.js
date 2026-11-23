'use strict';
// マスターデータ（ペンシルエディタで書き出し）。マスタールール・マスターチームで使う
// faces : 補助で振る鉛筆の面1〜6。eff が空なら「無」（何も起きない）。効果はそのターンだけ（turns≥2 を書いた効果はそのターン数）
// spells: 令呪3種
// lines : セリフ（support=補助 / attack=攻撃 / spell=令呪使用）。faces・spells の line は、その面・令呪だけの専用セリフ（任意）
// 効果の対象（t）: svt=自軍サーヴァント / self=マスター自身 / ally_all=味方全体（マスター含む）
//                  enemy_all=敵サーヴァント全員（敵マスターには当たらない） / enemy_both=敵全体（敵サーヴァント全員＋敵マスター）
//                  enemy_svt=選んだ敵サーヴァント / enemy_master=敵マスター / master=自陣のスター
const DEFAULT_MASTERS = [
  {
    "id":"m_rin", "name":"遠坂凛", "cost":5, "hp":500,
    "fit":{"face":{"x":50,"y":31,"z":100}},
    "lines":{"support":["行くわよっ！"]},
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
      {"label":"狙撃","eff":[{"k":"dmg","t":"enemy_master","v":100}],"line":["ここで、仕留める"]},
      {"label":"キャリコM950","eff":[{"k":"critDown","t":"enemy_all","v":1}],"line":["こっちだ！"]},
      {"label":"狙撃","eff":[{"k":"dmg","t":"enemy_master","v":150}],"line":["ここで、仕留める"]},
      {"label":"狙撃","eff":[{"k":"dmg","t":"enemy_master","v":100}],"line":["ここで、仕留める"]},
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
    "id":"m_kota", "name":"一文字コータ", "cost":3, "hp":300,
    "fit":{"face":{"x":50,"y":0,"z":100},"np":{"x":50,"y":15,"z":85}},
    "link":"https://seesaawiki.jp/kagemiya/d/%b0%ec%ca%b8%bb%fa%a5%b3%a1%bc%a5%bf",
    "lines":{"win":["これがサーヴァントの真の力だ！"],"defeat":["つ、強いっ。オレじゃ敵わないのか……？"]},
    "condLines":[
      {"key":"start","who":"enemy","cond":{"k":"id","v":"m_shadowkaiser"},"lines":["サーヴァントは友達だ！　お前みたいなやつには負けてたまるか！"]}
    ],
    "faces":[
      {"label":"みんな、ぶっとばせ！","eff":[{"k":"atk","t":"svt","v":30,"color":"R"}],"line":["一気にぶっとばしてやれ！","サーヴァントバトル！　コマンド・オーダー！"]},
      {"label":"応援","eff":[{"k":"desc","t":"svt","v":0,"text":"コータは精一杯応援している"}],"line":["みんな、がんばってくれ！"]},
      {"label":"変幻自在の攻撃だ！","eff":[{"k":"onAtkNp","t":"svt","v":10,"color":"B"}],"line":["サーヴァントバトル！　コマンド・オーダー！"]},
      {"label":"必殺の作戦だ！","eff":[{"k":"atk","t":"ally_svt","v":30,"color":"R"},{"k":"onAtkNp","t":"ally_svt","v":10,"color":"B"},{"k":"onAtkStar","t":"ally_svt","v":4,"color":"G"}],"line":["とびっきりの作戦、いくぞ！"]},
      {"label":"ひらめき","eff":[{"k":"desc","t":"svt","v":0,"text":"コータは何かひらめいたようだ"}],"line":["そうか、そうだったのか！","わかったぞ！"]},
      {"label":"スピードで撹乱しろ！","eff":[{"k":"onAtkStar","t":"enemy_master","v":4,"color":"G"}],"line":["スピードで攻めろ！","サーヴァントバトル！　コマンド・オーダー！"]}
    ],
    "spells":[
      {"name":"コマンド：リカバリー","eff":[{"k":"heal","t":"ally_svt","v":200}],"line":["みんな、大丈夫か！？"]},
      {"name":"コマンド：オーバーパワー","eff":[{"k":"np","t":"ally_svt","v":15},{"k":"npPow","t":"svt","v":70,"turns":1}],"line":["俺達の絆を見せてやろう！"]},
      {"name":"コマンド：スピーダー","eff":[{"k":"evade","t":"ally_svt","v":0,"turns":1},{"k":"actsUp","t":"ally_svt","v":1,"times":1}],"line":["かわせ、オレのサーヴァント！"]}
    ]
  },
  {
    "id":"m_shadowkaiser", "name":"シャドウカイザー", "cost":4, "hp":350,
    "fit":{"face":{"x":50,"y":0,"z":100},"np":{"x":50,"y":3,"z":105},"cut":{"x":0,"y":9,"z":100}},
    "link":"https://seesaawiki.jp/kagemiya/d/%a5%b7%a5%e3%a5%c9%a5%a6%a5%ab%a5%a4%a5%b6%a1%bc",
    "lines":{"support":["サーヴァントバトル、コマンド・オーダー！","ゆけっ、我が傀儡よ！","ハッハッハッハ……"],"attack":["聖杯戦争は命のやり取りなのだ！"],"spell":["サーヴァントなど勝つための道具にすぎん！","こうなっては令呪を使うほかあるまい！"]},
    "condLines":[
      {"key":"start","who":"enemy","cond":{"k":"id","v":"m_kota"},"lines":["これは命を賭けた殺し合いなのだよ！　子供は家でおとなしくしていろ！"]},
      {"key":"start","who":"enemy","cond":{"k":"id","v":"m_masaru"},"lines":["これは命を賭けた殺し合いなのだよ！　子供は家でおとなしくしていろ！"]},
      {"key":"defeat","who":"enemy","cond":{"k":"id","v":"m_kota"},"lines":["バカなっ！　私がこんな子供に負けるだとっ！？"]},
      {"key":"defeat","who":"enemy","cond":{"k":"id","v":"m_masaru"},"lines":["バカな……！　コータならいざ知らず、貴様のような子供に……！"]}
    ],
    "faces":[
      {"label":"無","eff":[]},
      {"label":"シャドウフレイム","eff":[{"k":"dmg","t":"enemy_all","v":15}],"line":["ハッハッハッハ……焼け焦げろ！"]},
      {"label":"シャドウスラッシュ","eff":[{"k":"dmg","t":"enemy_master","v":80}],"line":["貴様はこのシャドウカイザーが仕留める！","サーヴァントバトルとは殺し合いだ！"]},
      {"label":"シャドウインパルス","eff":[{"k":"dmg","t":"enemy_svt","v":80},{"k":"defDown","t":"enemy_svt","v":10}]},
      {"label":"シャドウサンダー","eff":[{"k":"dmg","t":"enemy_svt","v":80}],"line":["轟け、闇の雷鳴よ！"]},
      {"label":"シャドウカース","eff":[{"k":"defDown","t":"enemy_svt","v":10}],"line":["呪われるがいい！","闇の魂よ！"]}
    ],
    "spells":[
      {"name":"ダークブレイザー","eff":[{"k":"stun","t":"enemy_svt","v":0,"turns":1}],"line":["貴様には死が相応しい！"]},
      {"name":"ミラージュソード","eff":[{"k":"dmg","t":"enemy_master","v":150}],"line":["シャドウカイザーが直々に仕留めてやる！"]},
      {"name":"シャドウコマンダー","eff":[{"k":"sureHit","t":"ally_svt","v":0,"turns":1},{"k":"actsUp","t":"ally_svt","v":1,"times":1}],"line":["サーヴァントバトル、シャドウ・オーダー！","確実に仕留めるのだ、我が傀儡よ！"]}
    ]
  },
  {
    "id":"m_masaru", "name":"大聖寺マサル", "cost":3, "hp":300,
    "fit":{"face":{"x":50,"y":43,"z":100},"np":{"x":50,"y":31,"z":105},"cut":{"x":0,"y":5,"z":100}},
    "link":"https://seesaawiki.jp/kagemiya/d/%c2%e7%c0%bb%bb%fb%a5%de%a5%b5%a5%eb",
    "faces":[
      {"label":"","eff":[]},
      {"label":"","eff":[{"k":"def","t":"ally_svt","v":20},{"k":"maxHp","t":"svt","v":60}]},
      {"label":"","eff":[{"k":"def","t":"svt","v":20},{"k":"maxHp","t":"svt","v":40}]},
      {"label":"","eff":[{"k":"def","t":"ally_svt","v":30},{"k":"maxHp","t":"ally_svt","v":80}]},
      {"label":"","eff":[{"k":"def","t":"svt","v":20},{"k":"maxHp","t":"svt","v":30}]},
      {"label":"","eff":[]}
    ],
    "spells":[
      {"name":"必殺強化","eff":[{"k":"npPow","t":"ally_svt","v":100,"turns":1}]},
      {"name":"応急手当","eff":[{"k":"heal","t":"ally_svt","v":200}]},
      {"name":"緊急回避","eff":[{"k":"evade","t":"ally_svt","v":0,"turns":1},{"k":"actsUp","t":"ally_svt","v":1,"times":1}]}
    ]
  },
  {
    "id":"m_erika", "name":"黒咲恵梨佳", "cost":4, "hp":350,
    "fit":{"face":{"x":50,"y":16,"z":100},"np":{"x":50,"y":14,"z":89}},
    "link":"https://seesaawiki.jp/kagemiya/d/%b9%f5%ba%e9%b7%c3%cd%fc%b2%c2",
    "faces":[
      {"label":"高速思考","eff":[{"k":"desc","t":"self","v":0,"text":"黒咲恵梨佳は戦況を見極めようとしている。"}]},
      {"label":"血晶魔術・治癒","eff":[{"k":"heal","t":"ally_svt","v":30}]},
      {"label":"血晶魔術・加速","eff":[{"k":"atk","t":"ally_svt","v":10},{"k":"atk","t":"ally_svt","v":20,"color":"G"},{"k":"critPow","t":"ally_svt","v":30,"color":"G"}]},
      {"label":"起源血晶の欠片","eff":[{"k":"heal","t":"ally_all","v":60},{"k":"cleanse","t":"ally_all","v":0}]},
      {"label":"血晶魔術・覚醒","eff":[{"k":"onAtkNp","t":"svt","v":5},{"k":"onAtkNp","t":"ally_svt","v":5,"color":"G"},{"k":"onAtkStar","t":"ally_svt","v":4,"color":"G"}]},
      {"label":"血晶魔術・閃光","eff":[{"k":"star","t":"master","v":6},{"k":"atk","t":"ally_svt","v":20,"color":"G"},{"k":"critPow","t":"ally_svt","v":30,"color":"G"}]}
    ],
    "spells":[
      {"name":"血晶魔術・反転","eff":[{"k":"stun","t":"enemy_svt","v":0,"turns":1},{"k":"defDown","t":"enemy_svt","v":20,"turns":1}]},
      {"name":"起源血晶","eff":[{"k":"heal","t":"ally_all","v":130},{"k":"cleanse","t":"ally_all","v":0},{"k":"debuffImmune","t":"ally_all","v":0,"turns":1},{"k":"np","t":"ally_all","v":5}]},
      {"name":"血晶魔術・爆破","eff":[{"k":"dmg","t":"enemy_svt","v":80},{"k":"dmg","t":"enemy_master","v":120}]}
    ]
  },
  {
    "id":"m_seiji", "name":"柏木星司", "cost":5, "hp":470,
    "fit":{"face":{"x":50,"y":11,"z":100},"np":{"x":50,"y":14,"z":94}},
    "link":"https://seesaawiki.jp/kagemiya/d/%c7%f0%cc%da%c0%b1%bb%ca",
    "faces":[
      {"label":"","eff":[{"k":"onAtkStar","t":"ally_svt","v":3}]},
      {"label":"","eff":[{"k":"onAtkStar","t":"ally_svt","v":3}]},
      {"label":"","eff":[{"k":"onAtkStar","t":"ally_svt","v":3}]},
      {"label":"","eff":[{"k":"atk","t":"ally_svt","v":50,"color":"R"}]},
      {"label":"","eff":[{"k":"atk","t":"ally_svt","v":30,"color":"R"}]},
      {"label":"","eff":[{"k":"atk","t":"ally_svt","v":30,"color":"R"}]}
    ],
    "spells":[
      {"name":"竜の心臓","eff":[{"k":"np","t":"ally_svt","v":50},{"k":"hitNpSeal","t":"ally_svt","v":0,"turns":1,"sure":true}]},
      {"name":"EMCカートリッジ","eff":[{"k":"critRoll","t":"svt","v":2,"turns":1}]},
      {"name":"Quad_Burst","eff":[{"k":"dmg","t":"enemy_svt","v":180},{"k":"selfDmg","t":"self","v":100}]}
    ]
  },
  {
    "id":"m_antonia", "name":"シスター・アントニア", "cost":2, "hp":330,
    "fit":{"face":{"x":50,"y":15,"z":100},"np":{"x":50,"y":9,"z":105},"cut":{"x":0,"y":11,"z":100}},
    "link":"https://seesaawiki.jp/kagemiya/d/%a5%b7%a5%b9%a5%bf%a1%bc%a1%a6%a5%a2%a5%f3%a5%c8%a5%cb%a5%a2",
    "faces":[
      {"label":"","eff":[]},
      {"label":"","eff":[]},
      {"label":"","eff":[{"k":"onAtkNp","t":"ally_svt","v":10,"color":"B"},{"k":"heal","t":"ally_svt","v":30},{"k":"def","t":"ally_svt","v":15}]},
      {"label":"","eff":[{"k":"onAtkNp","t":"svt","v":15,"color":"B"},{"k":"heal","t":"svt","v":50},{"k":"def","t":"ally_svt","v":25}]},
      {"label":"","eff":[{"k":"onAtkNp","t":"ally_svt","v":10,"color":"B"},{"k":"heal","t":"ally_svt","v":30},{"k":"def","t":"ally_svt","v":15}]},
      {"label":"","eff":[]}
    ],
    "spells":[
      {"name":"瞬間強化","eff":[{"k":"atk","t":"ally_svt","v":40,"turns":1},{"k":"def","t":"ally_svt","v":30,"turns":1}]},
      {"name":"霊子向上・全","eff":[{"k":"atk","t":"svt","v":20,"turns":1,"color":"B"},{"k":"onAtkNp","t":"svt","v":10,"turns":1},{"k":"np","t":"svt","v":10}]},
      {"name":"A.A.A.","eff":[{"k":"atk","t":"ally_svt","v":68,"turns":1,"color":"B"},{"k":"nullUnder","t":"ally_svt","v":68,"turns":1},{"k":"np","t":"ally_svt","v":68},{"k":"actsUp","t":"ally_svt","v":1,"turns":1}]}
    ]
  },
  {
    "id":"m_ssetsuna", "name":"五月雨刹那", "cost":4, "hp":400,
    "fit":{"face":{"x":50,"y":0,"z":100}},
    "link":"https://seesaawiki.jp/kagemiya/d/%b8%de%b7%ee%b1%ab%d1%eb%c6%e1",
    "faces":[
      {"label":"","eff":[{"k":"onAtkStar","t":"ally_svt","v":3},{"k":"onAtkNp","t":"ally_svt","v":5,"cond":{"k":"trait","v":"女性"}}]},
      {"label":"","eff":[{"k":"star","t":"master","v":6},{"k":"atk","t":"svt","v":10,"cond":{"k":"trait","v":"女性","self":true}}]},
      {"label":"","eff":[{"k":"atk","t":"ally_svt","v":30,"color":"R"},{"k":"critRoll","t":"svt","v":1,"cond":{"k":"trait","v":"女性"}}]},
      {"label":"","eff":[{"k":"charm","t":"enemy_svt","v":0,"chance":4,"cond":{"k":"trait","v":"女性"}}]},
      {"label":"","eff":[{"k":"onAtkNp","t":"ally_svt","v":15,"color":"B"},{"k":"atk","t":"svt","v":10,"cond":{"k":"trait","v":"女性","self":true}}]},
      {"label":"","eff":[]}
    ],
    "spells":[
      {"name":"緊急回避","eff":[{"k":"evade","t":"ally_svt","v":0,"turns":1},{"k":"actsUp","t":"ally_svt","v":1,"times":1},{"k":"np","t":"svt","v":20,"cond":{"k":"trait","v":"女性"}}]},
      {"name":"流脈利用式治癒","eff":[{"k":"cleanse","t":"ally_svt","v":0},{"k":"heal","t":"ally_svt","v":150},{"k":"atk","t":"ally_svt","v":30,"turns":1,"cond":{"k":"trait","v":"女性","self":true}}]},
      {"name":"火炎放出","eff":[{"k":"actsDown","t":"enemy_svt","v":1,"turns":1},{"k":"critDown","t":"enemy_svt","v":1,"turns":1},{"k":"dmg","t":"enemy_svt","v":80},{"k":"atkDown","t":"enemy_svt","v":15,"turns":1,"cond":{"k":"trait","v":"男性"}}]}
    ]
  },
  {
    "id":"m_jubiro", "name":"石鷹授比郎", "cost":1, "hp":250,
    "fit":{"face":{"x":50,"y":0,"z":100},"np":{"x":50,"y":8,"z":105},"cut":{"x":0,"y":8,"z":100}},
    "link":"https://seesaawiki.jp/kagemiya/d/%c0%d0%c2%eb%bc%f8%c8%e6%cf%ba",
    "lines":{"support":["こいつぁスゲェ！！なんて入り組んだストーリーと謎だ！！","この聖杯戦争に！！俺達の骨を埋めてやろうじゃねぇかぁ！！","この戦争に勝てないと心が折れたら、逃げ時だぜ？"],"spell":["先の詠める漫画なんざつまらないにもほどがあるだろうがァァアアア！！！","この聖杯戦争ッ！！”俺に描かせろ”ッッッ！！！！"]},
    "faces":[
      {"label":"","eff":[{"k":"atk","t":"ally_svt","v":40,"color":"R"},{"k":"onAtkNp","t":"ally_svt","v":10}]},
      {"label":"","eff":[]},
      {"label":"","eff":[]},
      {"label":"","eff":[{"k":"critRoll","t":"ally_svt","v":2},{"k":"critPow","t":"svt","v":50}]},
      {"label":"","eff":[]},
      {"label":"","eff":[]}
    ],
    "spells":[
      {"name":"しおさいと銅鑼","eff":[{"k":"actsUp","t":"ally_svt","v":3,"turns":1},{"k":"critRoll","t":"ally_svt","v":2,"turns":1},{"k":"np","t":"ally_svt","v":30}]},
      {"name":"倶利伽羅サーフィス","eff":[{"k":"evade","t":"ally_svt","v":0,"turns":1},{"k":"heal","t":"ally_svt","v":250},{"k":"cleanse","t":"ally_svt","v":0},{"k":"np","t":"ally_svt","v":25}]},
      {"name":"日光条約","eff":[{"k":"sealUlt","t":"enemy_svt","v":0,"turns":1,"chance":4},{"k":"sealSkill","t":"enemy_svt","v":0,"turns":1,"chance":4},{"k":"fear","t":"enemy_svt","v":0,"turns":1,"chance":4},{"k":"stun","t":"svt","v":0,"turns":1,"chance":4}]}
    ]
  },
  {
    "id":"m_seimei", "name":"安倍晴明", "cost":5, "hp":500,
    "fit":{"face":{"x":50,"y":0,"z":119},"np":{"x":50,"y":9,"z":105}},
    "link":"https://seesaawiki.jp/kagemiya/d/%b0%c2%c7%dc%c0%b2%cc%c0",
    "lines":{"start":["フハハハハ！！　我こそは、至高の陰陽術師！！　安倍晴明である！！"],"win":["ふははははは！！　当然のように！！　大勝利！！"],"defeat":["おのれおのれおのれー！！"]},
    "condLines":[
      {"key":"start","who":"enemy","cond":{"k":"cls","v":"キャスター"},"lines":["西洋魔術など気に食わぬ！　魔術師はとっとと去ねぃ！！"]},
      {"key":"start","who":"enemy","cond":{"k":"id","v":"m_kuzunoha"},"lines":["母上ェ！？　何故ここにおられるのだァァ！！"]},
      {"key":"start","who":"enemy","cond":{"k":"id","v":"yorimitsu"},"lines":["頼光ォ！！　千年ぶりよのう！！！"]}
    ],
    "faces":[
      {"label":"鉄拳","eff":[{"k":"dmg","t":"enemy_master","v":100}],"line":["ふはははは！　貴様に術など不要！"]},
      {"label":"鉄拳","eff":[{"k":"dmg","t":"enemy_master","v":100}],"line":["ふはははは！　貴様に術など不要！"]},
      {"label":"陰陽術","eff":[{"k":"dmg","t":"enemy_svt","v":80}],"line":["どれ……小手調べをしてやろう","神秘で我に勝てると思うな！"]},
      {"label":"蜜の援護","eff":[{"k":"heal","t":"svt","v":80}],"line":["晴明様、お手伝いいたします！"]},
      {"label":"占術","eff":[{"k":"atkDown","t":"enemy_all","v":10}],"line":["ふははははは！　貴様の動きなど占うまでも無い！"]},
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
    "link":"https://seesaawiki.jp/kagemiya/d/%b3%eb%a4%ce%cd%d5",
    "lines":{"start":["なんじゃそうぞうしいのう"],"win":["わらわの勝ちじゃ！"]},
    "condLines":[
      {"key":"start","who":"enemy","cond":{"k":"id","v":"m_seimei"},"lines":["ほんに可愛い息子じゃのう。ほれ、わらわが勝ったらいなりをたんまり頼むぞい"]},
      {"key":"start","who":"other","cond":{"k":"trait","v":"悪"},"lines":["これはちと見過ごしてやれんのう……"]}
    ],
    "faces":[
      {"label":"無","eff":[],"line":["わはは、このマンガは面白いのう！"]},
      {"label":"狸丼","eff":[{"k":"heal","t":"ally_svt","v":30}],"line":["狸丼さんや、おやつを持ってきてたもれ"]},
      {"label":"無","eff":[],"line":["うーむ、乳が邪魔で動けんのじゃ"]},
      {"label":"狸豆","eff":[{"k":"onAtkNp","t":"ally_svt","v":10}],"line":["狸豆さんや、あの子を手伝っといで"]},
      {"label":"無","eff":[],"line":["いなりは壺屋に限るのう！"]},
      {"label":"無","eff":[],"line":["お昼寝でもしたいのう……"]}
    ],
    "spells":[
      {"name":"いなりぱーてぃー","eff":[{"k":"heal","t":"ally_all","v":80}],"line":["今日は大盤振る舞いじゃの！"]},
      {"name":"ちちびんたみか","eff":[{"k":"stun","t":"enemy_svt","v":0,"turns":1}],"line":["ほーれほれ、これが女狐の力じゃぞい"]},
      {"name":"狐の魔力","eff":[{"k":"np","t":"ally_svt","v":25}],"line":["たまにはちとやる気を出そうかの"]}
    ]
  },
  {
    "id":"m_kiri", "name":"ドクトル・キリ", "cost":3, "hp":280,
    "fit":{"face":{"x":50,"y":0,"z":100},"np":{"x":50,"y":3,"z":105},"cut":{"x":0,"y":9,"z":100}},
    "link":"https://seesaawiki.jp/kagemiya/d/%a5%c9%a5%af%a5%c8%a5%eb%a1%a6%a5%ad%a5%ea",
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
      {"name":"巨大メス","eff":[{"k":"dmg","t":"enemy_master","v":150}],"line":["さーて、解剖のお時間だよ！"]}
    ]
  },
  {
    "id":"m_isla", "name":" アイラ・ダウル・オルナ", "cost":5, "hp":540,
    "fit":{"face":{"x":50,"y":21,"z":100}},
    "link":"https://seesaawiki.jp/kagemiya/d/%a5%a2%a5%a4%a5%e9%a1%a6%a5%c0%a5%a6%a5%eb%a1%a6%a5%aa%a5%eb%a5%ca",
    "faces":[
      {"label":"","eff":[{"k":"onAtkNp","t":"ally_svt","v":10},{"k":"cardConv","t":"ally_svt","v":0,"color":"B"},{"k":"cardUp","t":"ally_svt","v":30,"color":"B","np":10,"star":2}]},
      {"label":"","eff":[{"k":"onAtkNp","t":"svt","v":5},{"k":"cardUp","t":"svt","v":10,"color":"B","np":5,"star":1}]},
      {"label":"","eff":[{"k":"atk","t":"ally_svt","v":15},{"k":"cardUp","t":"ally_svt","v":30,"color":"B","np":10,"star":2},{"k":"cardConv","t":"ally_svt","v":0,"color":"B"}]},
      {"label":"","eff":[{"k":"evade","t":"svt","v":0,"times":1}]},
      {"label":"","eff":[{"k":"atk","t":"ally_svt","v":15},{"k":"cardConv","t":"ally_svt","v":0,"color":"B"},{"k":"cardUp","t":"ally_svt","v":30,"color":"B","np":10,"star":2}]},
      {"label":"","eff":[{"k":"onAtkNp","t":"ally_svt","v":10}]}
    ],
    "spells":[
      {"name":"戦魔女の嘶き","eff":[{"k":"actsUp","t":"svt","v":3,"turns":1},{"k":"onAtkStar","t":"svt","v":8,"turns":1},{"k":"defDown","t":"svt","v":20,"turns":1}]},
      {"name":"秘蔵の宝石","eff":[{"k":"cardUp","t":"ally_svt","v":40,"turns":1,"color":"B","np":10,"star":2},{"k":"np","t":"svt","v":25}]},
      {"name":"大神慟哭・三弦狂騒","eff":[{"k":"stun","t":"enemy_all","v":0,"turns":1,"chance":2},{"k":"charm","t":"enemy_all","v":0,"turns":1,"chance":4},{"k":"defDown","t":"enemy_all","v":20,"turns":1}]}
    ]
  },
  {
    "id":"m_ophelia", "name":"ベアズリー・オフィーリア", "cost":3, "hp":300,
    "fit":{"face":{"x":50,"y":0,"z":100}},
    "link":"https://seesaawiki.jp/kagemiya/d/%a5%d9%a5%a2%a5%ba%a5%ea%a1%bc%a1%a6%a5%aa%a5%d5%a5%a3%a1%bc%a5%ea%a5%a2",
    "faces":[
      {"label":"","eff":[{"k":"heal","t":"svt","v":30}]},
      {"label":"","eff":[{"k":"heal","t":"ally_svt","v":50}]},
      {"label":"","eff":[{"k":"heal","t":"ally_svt","v":50}]},
      {"label":"","eff":[{"k":"heal","t":"ally_svt","v":80}]},
      {"label":"","eff":[]},
      {"label":"","eff":[]}
    ],
    "spells":[
      {"name":"応急手当","eff":[{"k":"heal","t":"ally_svt","v":200}]},
      {"name":"怪我しないでね？","eff":[{"k":"heal","t":"ally_svt","v":100},{"k":"def","t":"ally_svt","v":20,"turns":1}]},
      {"name":"真なる慈愛","eff":[{"k":"guts","t":"ally_svt","v":250,"turns":2}]}
    ]
  },
  {
    "id":"m_chudovishche", "name":"チュドーヴィシチェ", "cost":2, "hp":240,
    "fit":{"face":{"x":50,"y":16,"z":100},"np":{"x":50,"y":0,"z":77},"cut":{"x":0,"y":1,"z":87}},
    "link":"https://seesaawiki.jp/kagemiya/d/%a5%c1%a5%e5%a5%c9%a1%bc%a5%f4%a5%a3%a5%b7%a5%c1%a5%a7",
    "lines":{"start":["キュィィ……キィィィィ"],"win":["キュイイイイイイン！！！"]},
    "faces":[
      {"label":"にじり寄り","eff":[]},
      {"label":"咀嚼","eff":[{"k":"dmg","t":"enemy_master","v":70}]},
      {"label":"這い回り","eff":[]},
      {"label":"咀嚼","eff":[{"k":"dmg","t":"enemy_svt","v":80},{"k":"heal","t":"self","v":40}]},
      {"label":"咀嚼","eff":[{"k":"dmg","t":"enemy_svt","v":50}]},
      {"label":"よだれを垂らす","eff":[]}
    ],
    "spells":[
      {"name":"繧ｿ繝吶Ν","eff":[{"k":"dmg","t":"enemy_master","v":100},{"k":"heal","t":"self","v":50}]},
      {"name":"4B494C4C","eff":[{"k":"dmg","t":"enemy_svt","v":80},{"k":"heal","t":"self","v":50}]},
      {"name":"ｻ爨ﾋ､ｿ､､","eff":[{"k":"atkDown","t":"enemy_svt","v":30,"turns":1},{"k":"fear","t":"enemy_svt","v":0,"turns":1,"chance":3}]}
    ]
  },
  {
    "id":"m_natsume", "name":"千速棗", "cost":3, "hp":400,
    "fit":{"face":{"x":50,"y":15,"z":100},"np":{"x":50,"y":11,"z":105},"cut":{"x":0,"y":0,"z":93}},
    "link":"https://seesaawiki.jp/kagemiya/d/%c0%e9%c2%ae%dc%a7",
    "lines":{"start":["ハハッ、荒っぽいな！"],"support":["ほら、頑張んなよ","私の足が必要かい？"],"attack":["仙道ドライブキーック！","仙道オーバードライブキーック！","足癖が悪くてね！"],"win":["何百年か生きた分、私の方が薄皮一枚上だったな"],"defeat":["死ぬ前に逃げるのが長生きの秘訣だ！"]},
    "condLines":[
      {"key":"start","who":"enemy","cond":{"k":"id","v":"m_seimei"},"lines":["あいつのご先祖さまかよ！　生きてたんかワレ！"]},
      {"key":"start","who":"ally","cond":{"k":"id","v":"hangaku"},"lines":["噂に聞きし坂額御前――味方にいるなんてかしこまちゃうね"]}
    ],
    "faces":[
      {"label":"無","eff":[]},
      {"label":"神行法","eff":[{"k":"onAtkNp","t":"ally_svt","v":5},{"k":"star","t":"master","v":5}]},
      {"label":"仙道シール","eff":[{"k":"heal","t":"ally_svt","v":40},{"k":"onAtkStar","t":"ally_svt","v":3}]},
      {"label":"天速星","eff":[{"k":"onAtkStar","t":"ally_svt","v":5},{"k":"onAtkNp","t":"ally_svt","v":10},{"k":"atk","t":"ally_svt","v":20,"color":"G"},{"k":"onAtkNp","t":"ally_svt","v":5,"color":"G"},{"k":"critRoll","t":"ally_svt","v":1}]},
      {"label":"仙道シール","eff":[{"k":"heal","t":"svt","v":30},{"k":"onAtkStar","t":"ally_svt","v":3}]},
      {"label":"無","eff":[]}
    ],
    "spells":[
      {"name":"韋駄天夏目","eff":[{"k":"evade","t":"ally_svt","v":0,"turns":1},{"k":"actsUp","t":"ally_svt","v":1,"times":1}],"line":["悪いけど、こっちは暇なんだ！"]},
      {"name":"仙人の知恵","eff":[{"k":"evade","t":"ally_svt","v":0,"turns":3,"times":1},{"k":"actsUp","t":"ally_svt","v":1,"times":1}],"line":["無駄に長生きしてるんでね！"]},
      {"name":"よくわかんないけど仙丹","eff":[{"k":"guts","t":"ally_svt","v":200,"turns":1,"times":1},{"k":"np","t":"ally_svt","v":15}],"line":["一粒齧れば健康だよ！"]}
    ]
  },
  {
    "id":"m_ursula", "name":"ウルシュラ・ムラチニク", "cost":4, "hp":380,
    "fit":{"face":{"x":50,"y":30,"z":100},"np":{"x":50,"y":18,"z":105}},
    "link":"https://seesaawiki.jp/kagemiya/d/%bc%d5%c6%f9%ba%d7%a4%ce%cb%e2%bd%f7%a5%a6%a5%eb%a5%b7%a5%e5%a5%e9",
    "lines":{"support":["行きなさい、サーヴァント","これが効率というものよ"],"attack":["切り刻んであげるわ！"],"spell":["古の術式を見よ！"]},
    "condLines":[
      {"key":"start","who":"enemy","cond":{"k":"id","v":"m_ursula"},"lines":["なっ……あれは……私！？"]},
      {"key":"start","who":"enemy","cond":{"k":"id","v":"liza"},"lines":["……嫌な思い出があるわね、あの顔と胸は"]}
    ],
    "faces":[
      {"label":"無","eff":[]},
      {"label":"切断魔術","eff":[{"k":"dmg","t":"enemy_master","v":80},{"k":"healBlock","t":"enemy_master","v":0}]},
      {"label":"蝶魔術","eff":[{"k":"heal","t":"svt","v":30}]},
      {"label":"混沌解放","eff":[{"k":"dmg","t":"enemy_both","v":40}]},
      {"label":"猫耳センサー","eff":[{"k":"def","t":"ally_svt","v":10}]},
      {"label":"肉儀端末","eff":[{"k":"atk","t":"ally_svt","v":20,"color":"B"},{"k":"onAtkNp","t":"ally_svt","v":5,"color":"B"}]}
    ],
    "spells":[
      {"name":"混沌再臨","eff":[{"k":"skillCharge","t":"ally_svt","v":1}]},
      {"name":"蛹は羽化せず","eff":[{"k":"heal","t":"ally_svt","v":200}]},
      {"name":"擬似宇宙・災厄世界","eff":[{"k":"dmg","t":"enemy_both","v":80},{"k":"curse","t":"enemy_both","v":0,"times":1,"chance":3}]}
    ]
  },
  {
    "id":"m_roswitha", "name":"ロズヴィータ・ネーベルク・レーゲンフェルト", "cost":4, "hp":360,
    "fit":{"np":{"x":50,"y":45,"z":105}},
    "link":"https://seesaawiki.jp/kagemiya/d/%a5%ed%a5%ba%a5%f4%a5%a3%a1%bc%a5%bf%a1%a6%a5%cd%a1%bc%a5%d9%a5%eb%a5%af%a1%a6%a5%ec%a1%bc%a5%b2%a5%f3%a5%d5%a5%a7%a5%eb%a5%c8",
    "lines":{"start":["あの...もう帰っていいですか？","ひぃぃぃぃ！！！！","ふええええ...帰りたい...早く帰りたぁい...！"],"support":["すぐに楽にしてあげますよぉ...","は、早く死んでくださいよぉ！！"],"attack":["Gift　des　Todes！！","Todes！Todes！Todes！！！！"],"spell":["令呪を持って命じますぅ...！"],"win":["もう、動かない方がいいですよ？無理に回路と刻印を回すと負荷で...ほら、だから言ったのに...","か、勝ちましたぁ...あっ、早く痕跡を処理しないと...！酸毒...酸毒..."],"defeat":["痛いよぉ...なんでこんな目にぃぃぃぃ！！","ぴぎゃああ！！このままじゃ...死ぬ！し、死にたくないですぅぅ！！","せ、戦略的撤退ですぅぅ！！","せめて...自分の部屋の中で死にたかった..."]},
    "faces":[
      {"label":"苦痛の増加","eff":[{"k":"defDown","t":"enemy_svt","v":20}]},
      {"label":"呪詛の炸裂","eff":[{"k":"dmg","t":"enemy_svt","v":80}]},
      {"label":"幻妖穿窬","eff":[{"k":"poison","t":"enemy_svt","v":40,"turns":3}]},
      {"label":"狭霧に霞む","eff":[{"k":"evade","t":"ally_svt","v":0,"times":1}],"line":["───Der　nebel　fallt"]},
      {"label":"心筋の呪縛","eff":[{"k":"dmg","t":"enemy_master","v":100}]},
      {"label":"頼むから死んでくださいぃ！！","eff":[{"k":"desc","t":"self","v":0,"text":"ロズヴィータは怯えながらも、高度な呪殺の準備を進めている..."}]}
    ],
    "spells":[
      {"name":"醜穢澱濘","eff":[{"k":"stun","t":"enemy_svt","v":0,"turns":1,"chance":4},{"k":"buffImmune","t":"enemy_svt","v":0,"turns":1,"times":1}]},
      {"name":"腐蝕霊症","eff":[{"k":"erosion","t":"enemy_svt","v":0,"turns":1,"times":3}]},
      {"name":"肉體溶媒","eff":[{"k":"dmg","t":"enemy_master","v":150}]}
    ]
  },
  {
    "id":"m_uzumebi", "name":"埋火", "cost":1, "hp":100,
    "fit":{"face":{"x":50,"y":19,"z":100},"np":{"x":50,"y":32,"z":81}},
    "link":"https://seesaawiki.jp/kagemiya/d/%cb%e4%b2%d0",
    "faces":[
      {"label":"無","eff":[]},
      {"label":"無","eff":[]},
      {"label":"無","eff":[]},
      {"label":"","eff":[{"k":"onAtkNp","t":"svt","v":10}]},
      {"label":"無","eff":[]},
      {"label":"","eff":[{"k":"onAtkNp","t":"ally_svt","v":10}]}
    ],
    "spells":[
      {"name":"のじゃの雄叫び","eff":[{"k":"np","t":"ally_svt","v":50},{"k":"hitNpSeal","t":"ally_svt","v":0,"turns":1}]},
      {"name":"のじゃの頑張り","eff":[{"k":"evade","t":"ally_svt","v":0,"turns":1},{"k":"actsUp","t":"ally_svt","v":1,"times":1}]},
      {"name":"のじゃの居眠り","eff":[{"k":"actsUp","t":"ally_svt","v":3,"times":1}]}
    ]
  },
  {
    "id":"m_medoisan", "name":"めどいさん", "cost":3, "hp":350,
    "fit":{"face":{"x":50,"y":11,"z":100},"np":{"x":50,"y":28,"z":105},"cut":{"x":0,"y":7,"z":100}},
    "lines":{"support":["はぁ……めど……"]},
    "faces":[
      {"label":"おさぼり","eff":[]},
      {"label":"バール持ってください","eff":[{"k":"atk","t":"svt","v":40,"color":"R"},{"k":"critPow","t":"ally_svt","v":30},{"k":"cardDown","t":"ally_svt","v":10,"color":"G","np":0,"star":2}]},
      {"label":"ちこいさんお願いします","eff":[{"k":"dmg","t":"enemy_master","v":80}]},
      {"label":"めどいので今のうちにお掃除","eff":[{"k":"cleanse","t":"svt","v":0},{"k":"heal","t":"svt","v":60}]},
      {"label":"カップ麺にご飯いれたやつ","eff":[{"k":"heal","t":"svt","v":30}]},
      {"label":"お昼寝","eff":[]}
    ],
    "spells":[
      {"name":"霊子譲渡","eff":[{"k":"np","t":"ally_svt","v":30}]},
      {"name":"応急手当","eff":[{"k":"heal","t":"ally_svt","v":200}]},
      {"name":"たまには本気出す","eff":[{"k":"atk","t":"ally_all","v":20,"turns":1},{"k":"actsUp","t":"ally_all","v":1,"turns":1},{"k":"cleanse","t":"ally_all","v":0}]}
    ]
  },
  {
    "id":"m_hidoisan", "name":"ひどいさん", "cost":1, "hp":999,
    "fit":{"np":{"x":50,"y":20,"z":105},"cut":{"x":0,"y":7,"z":100}},
    "faces":[
      {"label":"無","eff":[],"line":["何も出来ないなんてひどいですー"]},
      {"label":"ひどいガード","eff":[{"k":"def","t":"ally_svt","v":10},{"k":"def","t":"self","v":150}]},
      {"label":"無","eff":[],"line":["何も出来ないなんてひどいですー"]},
      {"label":"痛いのは嫌ですー","eff":[{"k":"def","t":"ally_all","v":20},{"k":"def","t":"self","v":150}]},
      {"label":"無","eff":[],"line":["何も出来ないなんてひどいですー"]},
      {"label":"無","eff":[],"line":["何も出来ないなんてひどいですー"]}
    ],
    "spells":[
      {"name":"イシスの雨","eff":[{"k":"cleanse","t":"ally_svt","v":0},{"k":"actsUp","t":"ally_svt","v":1,"times":1}]},
      {"name":"生存への布石","eff":[{"k":"debuffImmune","t":"ally_svt","v":0,"times":1},{"k":"actsUp","t":"ally_svt","v":1,"times":1}]},
      {"name":"全体回復","eff":[{"k":"heal","t":"ally_all","v":100}]}
    ]
  },
  {
    "id":"m_itaisan", "name":"マスターロード・ペイン", "cost":4, "hp":350,
    "fit":{"face":{"x":50,"y":12,"z":100},"cut":{"x":0,"y":6,"z":100}},
    "faces":[
      {"label":"ノートを確認中","eff":[],"line":["主殿！ この技の読み方はなんですか？"]},
      {"label":"七ツ夜ノ死刀","eff":[{"k":"atk","t":"svt","v":10}],"line":["吾は面影糸を巣と張る蜘蛛！"]},
      {"label":"冥キ混沌ヨ来タレ","eff":[{"k":"onAtkNp","t":"svt","v":5}],"line":["さぁ、生を謳歌せよ！"]},
      {"label":"影ヲ追フ者","eff":[{"k":"atk","t":"svt","v":30},{"k":"heal","t":"svt","v":80}]},
      {"label":"零式・無限剣刃","eff":[{"k":"heal","t":"svt","v":30}],"line":["我の身体は無限のツルギで出来ている！"]},
      {"label":"其は夢幻の理想郷","eff":[{"k":"dmg","t":"enemy_svt","v":80}],"line":["我が栄光のアルカディアよ！"]}
    ],
    "spells":[
      {"name":"カイザースラウテルン","eff":[{"k":"dmg","t":"enemy_svt","v":80}],"line":["奈落より這い山河を越え大路にて判を下す！"]},
      {"name":"メルトダウン","eff":[{"k":"atkDown","t":"enemy_all","v":40,"turns":1}]},
      {"name":"シュヴァルツ・ゲシュヒテ","eff":[{"k":"atk","t":"ally_svt","v":40,"turns":1},{"k":"selfDmg","t":"ally_svt","v":50}],"line":["主殿、深淵の魔導書の開帳を！"]}
    ]
  }
];
