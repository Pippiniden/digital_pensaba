// 強さ解析の CSV（バランスラボの「CSV を保存」）を、LLM に渡せる大きさの要約（Markdown）にまとめる
// バランスラボの「要約を保存」と同じもの（集計の中身は js/rank-summary.js）。保存済みの CSV からあとで作り直す・絞り込むとき用
//
//   node tools/rank-summary.js <csv>                 要約を画面に出す
//   node tools/rank-summary.js <csv> -o summary.md   ファイルに書く
//   node tools/rank-summary.js <csv> --min 300       組み合わせ・対面の表に載せる最低試合数（既定：自動）
//   node tools/rank-summary.js <csv> --top 25        組み合わせ・対面の表の件数（上位・下位それぞれ。既定：20）
//   node tools/rank-summary.js <csv> -r チームバトル  ルール（CSV の「ルール」列の値）で絞る
//   node tools/rank-summary.js <csv> --only lancelot,lamorak  そのキャラが出る組み合わせ・対面だけに絞る（キャラ別の表はそのまま）
//
// 1行ずつ読むので数百MBでも大丈夫。行は試合番号ごとにまとまっている前提（バランスラボの出力はそうなっている）。
'use strict';
const fs=require('fs'), path=require('path'), readline=require('readline');
const rankSummary=require(path.join(__dirname,'..','js','rank-summary.js'));
const argv=process.argv.slice(2), opt=(...n)=>{ const i=argv.findIndex(a=>n.includes(a)); return i<0?null:argv[i+1]; };
const FILE=argv.find((a,i)=>!a.startsWith('-')&&(i===0||!argv[i-1].startsWith('-')));
if(!FILE){ console.error('使い方：node tools/rank-summary.js <csv> [-o out.md] [--min N] [--top N] [-r ルール] [--only id,id]'); process.exit(1); }
const OUT=opt('-o','--out'), RULE=opt('-r','--rule');
const S=rankSummary({min:Number(opt('--min'))||0, top:Number(opt('--top'))||20, only:opt('--only')?new Set(opt('--only').split(',')):null});

// CSV の1行を分ける（"..." の中の , と "" に対応）
function split(line){
  if(!line.includes('"')) return line.split(',');
  const out=[]; let cur='', q=false;
  for(let i=0;i<line.length;i++){ const c=line[i];
    if(q){ if(c==='"'){ if(line[i+1]==='"'){ cur+='"'; i++; } else q=false; } else cur+=c; }
    else if(c==='"') q=true; else if(c===','){ out.push(cur); cur=''; } else cur+=c; }
  out.push(cur); return out;
}
const num=v=>v===''||v==null?null:Number(v);
const COLS={match:'試合番号',rule:'ルール',cpu:'CPU',turns:'ターン数',win:'勝ち',first:'先攻',side:'側',id:'キャラID',name:'キャラ名',cost:'コスト',slot:'並び順',master:'味方のマスター',
  dmg:'与ダメージ',team:'チームの与ダメージ',taken:'被ダメージ',maxd:'最大ダメージ',ko:'撃破数',atk:'攻撃回数',crit:'クリティカル回数',np:'宝具回数',skill:'スキル回数',block:'防いだ回数',asc:'再臨したターン',out:'戦闘不能になったターン',hp:'残りHP'};

const t0=Date.now();
let I=null;
const rl=readline.createInterface({input:fs.createReadStream(FILE,{encoding:'utf8'}),crlfDelay:Infinity});
rl.on('line',line=>{
  if(!I){ const H=split(line.replace(/^﻿/,'')); I={};
    for(const [k,n] of Object.entries(COLS)){ I[k]=H.indexOf(n); if(I[k]<0&&k!=='master'){ console.error(`列「${n}」がありません`); process.exit(1); } }
    return; }
  if(!line) return;
  const f=split(line);
  if(RULE&&f[I.rule]!==RULE) return;
  const r={}; for(const k in I) r[k]=I[k]<0?'':f[I[k]];
  r.first=r.first==='1'; r.asc=num(r.asc); r.out=num(r.out);
  S.add(r);
});
rl.on('close',()=>{
  const text=S.text(path.basename(FILE));
  if(OUT){ fs.writeFileSync(OUT,text); console.error(`${OUT} に書きました（${(Buffer.byteLength(text)/1024).toFixed(0)}KB・${((Date.now()-t0)/1000).toFixed(1)}秒）`); }
  else process.stdout.write(text);
});
