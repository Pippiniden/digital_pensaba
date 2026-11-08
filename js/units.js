'use strict';
// ユニットデータ（ペンシルエディタで書き出し）
// img: キャラクター画像(face)・カード用キャラ画像(card、空欄ならfaceを使う) のパス
// lines: 場面ごとのセリフ
// faces: 出目1〜6の面 / acts: 行動回数 / pre・post: 覚醒前・後のコマンド
// c: R=Buster B=Arts G=Quick W=特殊 ASC=覚醒
const DEFAULT_UNITS = [
  {
    "id":"minamo", "name":"鉄扇のミナモ", "cls":"セイバー", "cost":5, "hp":120,
    "img":{"face":"img/placeholder/face.svg","card":""},
    "lines":{
      "start":["鉄扇のミナモ、参ります。"],
      "attack":["はっ！", "凪いで――断つ！", "この扇、ただの飾りではありませんよ。"],
      "damage":["くっ……！"],
      "skill":["流れを整えます。"],
      "np":["千の波よ、重なりて砕け――『千重波』！"],
      "npDamage":["これほどの……！"],
      "defeat":["申し訳……ありません……"],
      "win":["凪が戻りましたね。"]
    },
    "faces":[
      {"acts":1,"pre":{"c":"R","dmg":30,"np":0,"star":0},"post":{"c":"R","dmg":40,"np":0,"star":0}},
      {"acts":2,"pre":{"c":"B","dmg":20,"np":20,"star":0},"post":{"c":"B","dmg":25,"np":30,"star":0}},
      {"acts":1,"pre":{"c":"G","dmg":15,"np":0,"star":3},"post":{"c":"G","dmg":20,"np":0,"star":5}},
      {"acts":3,"pre":{"c":"R","dmg":30,"np":0,"star":0},"post":{"c":"R","dmg":45,"np":0,"star":0}},
      {"acts":2,"pre":{"c":"ASC"},"post":{"c":"R","dmg":60,"np":0,"star":0}},
      {"acts":1,"pre":{"c":"B","dmg":20,"np":20,"star":0},"post":{"c":"B","dmg":30,"np":20,"star":0}}
    ],
    "skills":[
      {"name":"凪の型","eff":[{"k":"atk","t":"self","v":20,"turns":3}]},
      {"name":"鉄扇返し","eff":[{"k":"evade","t":"self","v":0,"turns":3,"times":1},{"k":"star","t":"master","v":5}]},
      {"name":"水鏡","eff":[{"k":"np","t":"self","v":50}]}
    ],
    "ult":{"name":"千重波","c":"R","eff":[{"k":"dmg","t":"target","v":100}]}
  },
  {
    "id":"rio", "name":"灯火のリオ", "cls":"キャスター", "cost":3, "hp":90,
    "img":{"face":"img/placeholder/face.svg","card":""},
    "lines":{
      "start":["灯りを絶やさずにいきましょう！"],
      "attack":["えいっ！", "灯よ、走って！", "燃えて！"],
      "damage":["きゃっ！"],
      "skill":["みんな、温まって！"],
      "np":["小さな火でも、祈れば篝火に――『篝火の祈り』！"],
      "npDamage":["火が……揺らいで……！"],
      "defeat":["灯が……消え……"],
      "win":["みんな無事で、よかった！"]
    },
    "faces":[
      {"acts":2,"pre":{"c":"B","dmg":15,"np":30,"star":0},"post":{"c":"B","dmg":20,"np":40,"star":0}},
      {"acts":1,"pre":{"c":"G","dmg":10,"np":0,"star":4},"post":{"c":"G","dmg":15,"np":0,"star":6}},
      {"acts":3,"pre":{"c":"ASC"},"post":{"c":"B","dmg":30,"np":30,"star":0}},
      {"acts":2,"pre":{"c":"R","dmg":20,"np":0,"star":0},"post":{"c":"R","dmg":30,"np":0,"star":0}},
      {"acts":1,"pre":{"c":"B","dmg":15,"np":30,"star":0},"post":{"c":"B","dmg":20,"np":40,"star":0}},
      {"acts":2,"pre":{"c":"W","label":"癒しの灯","eff":[{"k":"heal","t":"self","v":20}],"np":0,"star":0},"post":{"c":"W","label":"癒しの大灯","eff":[{"k":"heal","t":"ally_all","v":20}],"np":0,"star":0}}
    ],
    "skills":[
      {"name":"導きの灯","eff":[{"k":"np","t":"picked","v":30}],"pick":"ally"},
      {"name":"護りの火","eff":[{"k":"def","t":"ally_all","v":10,"turns":2}]},
      {"name":"再燃","eff":[{"k":"heal","t":"picked","v":40},{"k":"cleanse","t":"picked","v":0}],"pick":"ally"}
    ],
    "ult":{"name":"篝火の祈り","c":"B","eff":[{"k":"atk","t":"ally_all","v":20,"turns":3},{"k":"heal","t":"ally_all","v":30}]}
  },
  {
    "id":"kagari", "name":"影縫いのカガリ", "cls":"アサシン", "cost":3, "hp":80,
    "img":{"face":"img/placeholder/face.svg","card":""},
    "lines":{
      "start":["……影は既に、お前の足元だ。"],
      "attack":["遅い。", "そこだ。", "縫い止める。"],
      "damage":["ちっ……"],
      "skill":["……仕込みは済んだ。"],
      "np":["千の影よ、喰らい尽くせ――『千影』。"],
      "npDamage":["見誤った、か……"],
      "defeat":["影に……還る……"],
      "win":["……任務完了。"]
    },
    "faces":[
      {"acts":1,"pre":{"c":"G","dmg":15,"np":0,"star":5},"post":{"c":"G","dmg":20,"np":0,"star":6}},
      {"acts":2,"pre":{"c":"R","dmg":25,"np":0,"star":0},"post":{"c":"R","dmg":35,"np":0,"star":0}},
      {"acts":1,"pre":{"c":"ASC"},"post":{"c":"G","dmg":30,"np":0,"star":8}},
      {"acts":3,"pre":{"c":"B","dmg":10,"np":20,"star":0},"post":{"c":"B","dmg":15,"np":30,"star":0}},
      {"acts":2,"pre":{"c":"G","dmg":15,"np":0,"star":5},"post":{"c":"G","dmg":20,"np":0,"star":7}},
      {"acts":2,"pre":{"c":"R","dmg":25,"np":0,"star":0},"post":{"c":"R","dmg":35,"np":0,"star":0}}
    ],
    "skills":[
      {"name":"影縫い","eff":[{"k":"stun","t":"picked","v":0,"turns":1,"chance":3}],"pick":"enemy"},
      {"name":"毒針","eff":[{"k":"poison","t":"picked","v":20,"turns":3}],"pick":"enemy"},
      {"name":"隠形","eff":[{"k":"evade","t":"self","v":0,"turns":2,"times":2},{"k":"critRoll","t":"self","v":1,"turns":3}]}
    ],
    "ult":{"name":"千影","c":"G","eff":[{"k":"dmg","t":"target","v":90},{"k":"poison","t":"target","v":20,"turns":3}]}
  },
  {
    "id":"selen", "name":"流星射手セレン", "cls":"アーチャー", "cost":4, "hp":100,
    "img":{"face":"img/placeholder/face.svg","card":""},
    "lines":{
      "start":["星の巡りは良好。始めましょう。"],
      "attack":["射抜きます！", "流れ星、一つ！", "狙いは外さない。"],
      "damage":["っ、やりますね……！"],
      "skill":["星を読みます。"],
      "np":["夜空の全てを、この一矢に――『流星雨』！"],
      "npDamage":["空が、落ちて……！"],
      "defeat":["星が……見えない……"],
      "win":["今夜も、いい星空です。"]
    },
    "faces":[
      {"acts":2,"pre":{"c":"R","dmg":25,"np":0,"star":0},"post":{"c":"R","dmg":35,"np":0,"star":0}},
      {"acts":1,"pre":{"c":"G","dmg":15,"np":0,"star":5},"post":{"c":"G","dmg":20,"np":0,"star":6}},
      {"acts":2,"pre":{"c":"B","dmg":15,"np":25,"star":0},"post":{"c":"B","dmg":20,"np":30,"star":0}},
      {"acts":3,"pre":{"c":"ASC"},"post":{"c":"G","dmg":30,"np":0,"star":8}},
      {"acts":1,"pre":{"c":"R","dmg":25,"np":0,"star":0},"post":{"c":"R","dmg":35,"np":0,"star":0}},
      {"acts":2,"pre":{"c":"G","dmg":10,"np":0,"star":4},"post":{"c":"G","dmg":15,"np":0,"star":5}}
    ],
    "skills":[
      {"name":"鷹の目","eff":[{"k":"critPow","t":"self","v":30,"turns":3}]},
      {"name":"星読み","eff":[{"k":"star","t":"master","v":10}]},
      {"name":"流星群","eff":[{"k":"sureHit","t":"self","v":0,"turns":3},{"k":"atk","t":"self","v":15,"turns":3}]}
    ],
    "ult":{"name":"流星雨","c":"G","eff":[{"k":"dmg","t":"enemy_all","v":60}]}
  },
  {
    "id":"tsubaki", "name":"槍兵ツバキ", "cls":"ランサー", "cost":2, "hp":90,
    "img":{"face":"img/placeholder/face.svg","card":""},
    "lines":{
      "start":["槍兵ツバキ、推参！"],
      "attack":["せいっ！", "穿つ！", "まだまだぁ！"],
      "damage":["ぐっ……効かないね！"],
      "skill":["さあ、かかってきな！"],
      "np":["一閃にて咲き誇れ――『一閃・椿』！"],
      "npDamage":["がはっ……！"],
      "defeat":["ここまで、か……"],
      "win":["椿は散らず、ってね！"]
    },
    "faces":[
      {"acts":1,"pre":{"c":"R","dmg":20,"np":0,"star":0},"post":{"c":"R","dmg":30,"np":0,"star":0}},
      {"acts":2,"pre":{"c":"B","dmg":15,"np":20,"star":0},"post":{"c":"B","dmg":20,"np":30,"star":0}},
      {"acts":1,"pre":{"c":"G","dmg":15,"np":0,"star":4},"post":{"c":"G","dmg":20,"np":0,"star":5}},
      {"acts":2,"pre":{"c":"R","dmg":20,"np":0,"star":0},"post":{"c":"R","dmg":30,"np":0,"star":0}},
      {"acts":3,"pre":{"c":"ASC"},"post":{"c":"R","dmg":50,"np":0,"star":0}},
      {"acts":1,"pre":{"c":"B","dmg":15,"np":20,"star":0},"post":{"c":"B","dmg":20,"np":30,"star":0}}
    ],
    "skills":[
      {"name":"不屈","eff":[{"k":"guts","t":"self","v":20,"turns":3,"times":1}]},
      {"name":"挑発","eff":[{"k":"taunt","t":"self","v":0,"turns":1},{"k":"def","t":"self","v":20,"turns":1}]},
      {"name":"穿ち","eff":[{"k":"pierce","t":"self","v":0,"turns":3},{"k":"np","t":"self","v":30}]}
    ],
    "ult":{"name":"一閃・椿","c":"R","eff":[{"k":"strip","t":"target","v":0},{"k":"dmg","t":"target","v":90}]}
  },
  {
    "id":"bard", "name":"狂嵐のバルド", "cls":"バーサーカー", "cost":1, "hp":110,
    "img":{"face":"img/placeholder/face.svg","card":""},
    "lines":{
      "start":["オオオオオッ！"],
      "attack":["ガアッ！", "砕けろォ！", "ウオオオッ！"],
      "damage":["グルル……"],
      "skill":["ハァ……ハァ……！"],
      "np":["嵐ヨ……吹キ荒レロォ――『嵐撃』！！"],
      "npDamage":["グ、ガ……ッ！"],
      "defeat":["ガ……ア……"],
      "win":["……オオオオオォッ！！"]
    },
    "faces":[
      {"acts":1,"pre":{"c":"R","dmg":35,"np":0,"star":0},"post":{"c":"R","dmg":45,"np":0,"star":0}},
      {"acts":1,"pre":{"c":"R","dmg":35,"np":0,"star":0},"post":{"c":"R","dmg":45,"np":0,"star":0}},
      {"acts":2,"pre":{"c":"ASC"},"post":{"c":"R","dmg":60,"np":0,"star":0}},
      {"acts":1,"pre":{"c":"B","dmg":10,"np":15,"star":0},"post":{"c":"B","dmg":15,"np":20,"star":0}},
      {"acts":3,"pre":{"c":"G","dmg":10,"np":0,"star":3},"post":{"c":"G","dmg":15,"np":0,"star":4}},
      {"acts":2,"pre":{"c":"R","dmg":35,"np":0,"star":0},"post":{"c":"R","dmg":45,"np":0,"star":0}}
    ],
    "skills":[
      {"name":"狂化","eff":[{"k":"atk","t":"self","v":30,"turns":2},{"k":"defDown","t":"self","v":10,"turns":2}]},
      {"name":"戦闘続行","eff":[{"k":"guts","t":"self","v":30,"turns":5,"times":1}]},
      {"name":"咆哮","eff":[{"k":"atkDown","t":"enemy_all","v":15,"turns":2}]}
    ],
    "ult":{"name":"嵐撃","c":"R","eff":[{"k":"dmg","t":"target","v":130}]}
  },
  {
    "id":"nono", "name":"見習い騎兵ノノ", "cls":"ライダー", "cost":0, "hp":70,
    "img":{"face":"img/placeholder/face.svg","card":""},
    "lines":{
      "start":["が、がんばります！"],
      "attack":["えーいっ！", "いっけー！", "とりゃあ！"],
      "damage":["いたた……"],
      "skill":["相棒、お願い！"],
      "np":["どこまでも駆けるよ――『草原駆け』！"],
      "npDamage":["わわっ、すごい力……！"],
      "defeat":["ごめんなさい……"],
      "win":["やったぁ！勝てたよ、相棒！"]
    },
    "faces":[
      {"acts":2,"pre":{"c":"G","dmg":10,"np":0,"star":3},"post":{"c":"G","dmg":15,"np":0,"star":4}},
      {"acts":1,"pre":{"c":"B","dmg":10,"np":20,"star":0},"post":{"c":"B","dmg":15,"np":25,"star":0}},
      {"acts":2,"pre":{"c":"R","dmg":15,"np":0,"star":0},"post":{"c":"R","dmg":25,"np":0,"star":0}},
      {"acts":1,"pre":{"c":"G","dmg":10,"np":0,"star":3},"post":{"c":"G","dmg":15,"np":0,"star":4}},
      {"acts":3,"pre":{"c":"ASC"},"post":{"c":"G","dmg":25,"np":0,"star":6}},
      {"acts":2,"pre":{"c":"W","label":"見回り","eff":[{"k":"star","t":"master","v":3}],"np":0,"star":0},"post":{"c":"G","dmg":20,"np":0,"star":5}}
    ],
    "skills":[
      {"name":"相棒の馬","eff":[{"k":"evade","t":"self","v":0,"turns":2,"times":1}]},
      {"name":"元気印","eff":[{"k":"np","t":"ally_all","v":10}]},
      {"name":"全速力","eff":[{"k":"atk","t":"self","v":20,"turns":3,"color":"G"},{"k":"star","t":"master","v":5}]}
    ],
    "ult":{"name":"草原駆け","c":"G","eff":[{"k":"dmg","t":"target","v":70},{"k":"star","t":"master","v":10}]}
  }
];
