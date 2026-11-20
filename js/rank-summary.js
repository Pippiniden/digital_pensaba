// 強さ解析の要約（Markdown）：1試合の1キャラ＝1件の記録を add() で流し込み、text() で LLM に渡せる大きさの要約にする
// バランスラボ（balance.js の「要約を保存」）と tools/rank-summary.js（CSV から作る）で共用。ブラウザでは グローバルの rankSummary、Node では require で使う
//
//   const s=rankSummary({only:Set|null, min:0（0=自動）, top:20});
//   s.add({match, rule, cpu, turns, win:1/0/.5, first:bool, side:'A'/'B', id, name, cost, master:'名前'|'',
//          dmg, team:チームの与ダメージ, taken, maxd, ko, atk, crit, np, skill, block, asc:再臨したターン|null, out:戦闘不能になったターン|null, hp});
//   s.text('元データの説明')  → Markdown
// 記録は試合ごとにまとめて流すこと（match が変わったところで1試合を締める）
'use strict';
function rankSummary(opt){
  opt=opt||{};
  const ONLY=opt.only||null, MIN=opt.min||0, TOP=opt.top||20;
  const chars=new Map();   // id -> 成績
  const costs=new Map();   // cost -> {n,w}
  const masters=new Map(); // マスター名 -> {n,w}
  const pairs=new Map();   // 味方どうし `a|b` -> {n,w}
  const vs=new Map();      // 対面 `a|b`（a 側から見た）-> {n,w}
  const meta={matches:0,rows:0,rules:new Set(),cpu:new Set(),first:{n:0,w:0},turns:0,pairN:0,vsN:0};
  const inc=(m,k,w)=>{ let e=m.get(k); if(!e){ e={n:0,w:0}; m.set(k,e); } e.n++; e.w+=w; };
  const C=id=>{ let c=chars.get(id); if(!c){ c={id,name:'',cost:0,n:0,w:0,dmg:0,taken:0,maxd:0,ko:0,atk:0,crit:0,np:0,skill:0,block:0,asc:0,ascT:0,out:0,outT:0,hp:0,team:0}; chars.set(id,c); } return c; };
  const N=v=>Number(v)||0;
  let cur=null, buf=[];

  function flush(){
    if(!buf.length) return;
    meta.matches++; meta.turns+=buf[0].turns;
    const side={};
    for(const r of buf) (side[r.side]=side[r.side]||{ids:[],win:r.win,first:r.first,master:r.master}).ids.push(r.id);
    const ss=Object.values(side);
    for(const s of ss){ if(s.first){ meta.first.n++; meta.first.w+=s.win; } if(s.master) inc(masters,s.master,s.win);
      const ids=[...s.ids].sort();
      for(let i=0;i<ids.length;i++) for(let j=i+1;j<ids.length;j++){ inc(pairs,ids[i]+'|'+ids[j],s.win); meta.pairN++; } }
    if(ss.length===2) for(const [a,b] of [[ss[0],ss[1]],[ss[1],ss[0]]]) for(const x of a.ids) for(const y of b.ids){ inc(vs,x+'|'+y,a.win); meta.vsN++; }
    buf=[];
  }
  function add(r){
    if(r.match!==cur){ flush(); cur=r.match; }
    meta.rows++; meta.rules.add(r.rule); meta.cpu.add(r.cpu);
    const win=N(r.win), c=C(r.id);
    c.name=r.name; c.cost=N(r.cost); c.n++; c.w+=win;
    c.dmg+=N(r.dmg); c.team+=N(r.team); c.taken+=N(r.taken); c.maxd=Math.max(c.maxd,N(r.maxd));
    c.ko+=N(r.ko); c.atk+=N(r.atk); c.crit+=N(r.crit); c.np+=N(r.np); c.skill+=N(r.skill); c.block+=N(r.block); c.hp+=N(r.hp);
    if(r.asc!=null){ c.asc++; c.ascT+=N(r.asc); }
    if(r.out!=null){ c.out++; c.outT+=N(r.out); }
    inc(costs,c.cost,win);
    buf.push({id:r.id,side:r.side,win,first:!!r.first,turns:N(r.turns),master:r.master||''});
  }

  // 勝率と95%の幅（Wilson）
  const wilson=(w,n)=>{ if(!n) return [0,0]; const z=1.96,p=w/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d; return [c-h,c+h]; };
  const pc=x=>(x*100).toFixed(1)+'%', sg=x=>(x>=0?'+':'')+(x*100).toFixed(1), r1=x=>Number.isFinite(x)?x.toFixed(1):'-', r0=x=>Number.isFinite(x)?Math.round(x).toLocaleString('en-US'):'-', n0=x=>x.toLocaleString('en-US');
  const table=(head,rows)=>['| '+head.join(' | ')+' |','|'+head.map((h,i)=>i<2?'---':'--:').join('|')+'|',...rows.map(r=>'| '+r.join(' | ')+' |')].join('\n');

  function text(source){
    flush();
    const L=[], P=s=>L.push(s);
    const cs=[...chars.values()];
    // 表示名：同じ名前のキャラが複数いるときは「名前（コストN）」、コストも同じなら ID も添える
    const label=new Map(), byName=new Map();
    for(const c of cs){ const k=String(c.name||c.id).trim(); (byName.get(k)||byName.set(k,[]).get(k)).push(c); }
    for(const [k,list] of byName) for(const c of list){
      const sameCost=list.filter(o=>o.cost===c.cost).length>1;
      label.set(c.id,list.length<2?k:sameCost?`${k}（コスト${c.cost}・${c.id}）`:`${k}（コスト${c.cost}）`); }
    const nm=id=>label.get(id)||id;
    const costWr=new Map([...costs].map(([k,e])=>[k,e.w/e.n])), wr=c=>c.w/c.n, cd=c=>wr(c)-costWr.get(c.cost);
    P(`# 強さ解析の要約`); P('');
    P(`- 元データ：${source||'-'}（${n0(meta.rows)}行・${n0(meta.matches)}試合）`);
    P(`- ルール：${[...meta.rules].join('、')}／CPU：${[...meta.cpu].join('、')}`);
    P(`- 平均ターン数：${r1(meta.turns/meta.matches)}／先攻の勝率：${meta.first.n?pc(meta.first.w/meta.first.n):'-'}`);
    P(`- 勝率の「95%の幅」：この範囲に本当の勝率がある見込み。幅が50%をまたぐなら、強い／弱いとは言い切れない`);
    P(`- 「コスト差」：同じコストのキャラ全体の勝率との差（コストが高いほど勝ちやすいぶんを除いた強さ）`);
    P(`- 並び順はバランスラボが HP の高い順に自動で決めている（どこに置くと強いかは試していない）ので、並び順ごとの強さはこの要約からは分からない`);
    P('');

    P(`## コスト別の勝率`); P('');
    P(table(['コスト','キャラ数','出場','勝率'],[...costs.keys()].sort((a,b)=>a-b).map(k=>{ const e=costs.get(k); return [k,cs.filter(c=>c.cost===k).length,n0(e.n),pc(e.w/e.n)]; })));
    P('');

    P(`## キャラ別の成績（コスト差の大きい順）`); P('');
    P(`与ダメ・被ダメ・撃破・攻撃・宝具・スキル・防御は1試合あたりの平均。与ダメ割合＝チームの与ダメージのうちそのキャラの分。生存＝試合の終わりまで戦闘不能にならなかった割合。`); P('');
    const sorted=[...cs].sort((a,b)=>cd(b)-cd(a));
    P(table(['キャラ','ID','コスト','出場','勝率','95%の幅','コスト差','与ダメ','与ダメ割合','被ダメ','最大ダメ','撃破','攻撃','宝具','スキル','防御','再臨率','生存','倒れたターン'],
      sorted.map(c=>{ const [lo,hi]=wilson(c.w,c.n);
        return [nm(c.id),c.id,c.cost,n0(c.n),pc(wr(c)),`${(lo*100).toFixed(1)}–${(hi*100).toFixed(1)}`,sg(cd(c)),
          r0(c.dmg/c.n),c.team?pc(c.dmg/c.team):'-',r0(c.taken/c.n),r0(c.maxd),r1(c.ko/c.n),r1(c.atk/c.n),r1(c.np/c.n),r1(c.skill/c.n),r1(c.block/c.n),pc(c.asc/c.n),pc(1-c.out/c.n),c.out?r1(c.outT/c.out):'-']; })));
    P('');

    P(`## 外れ値（95%の幅が同じコストの平均にかからないキャラ）`); P('');
    const odd=sorted.filter(c=>{ const [lo,hi]=wilson(c.w,c.n), m=costWr.get(c.cost); return lo>m||hi<m; });
    const strong=odd.filter(c=>cd(c)>0), weak=odd.filter(c=>cd(c)<0).reverse();
    P(`- 強すぎ（${strong.length}）：`+(strong.map(c=>`${String(c.name).trim()}（コスト${c.cost}・${sg(cd(c))}）`).join('、')||'なし'));
    P(`- 弱すぎ（${weak.length}）：`+(weak.map(c=>`${String(c.name).trim()}（コスト${c.cost}・${sg(cd(c))}）`).join('、')||'なし'));
    P('');

    if(masters.size){
      P(`## マスター別の勝率`); P('');
      P(table(['マスター','出場','勝率','95%の幅'],[...masters].sort((a,b)=>b[1].w/b[1].n-a[1].w/a[1].n).map(([k,e])=>{ const [lo,hi]=wilson(e.w,e.n); return [k,n0(e.n),pc(e.w/e.n),`${(lo*100).toFixed(1)}–${(hi*100).toFixed(1)}`]; })));
      P('');
    }

    // 組み合わせ・対面：見込み（2人の勝率から見込む値）との差で並べる。最低試合数は自動なら「1組あたりの平均の半分（30以上）」
    const moe=x=>{ const e=1.96*Math.sqrt(x.wr*(1-x.wr)/x.n); return '±'+(e*100).toFixed(1)+(Math.abs(x.d)>e?' ★':''); }; // 95%のぶれ。差がぶれより大きければ★
    const auto=(tot,keys)=>MIN||Math.max(30,Math.round(tot/Math.max(1,keys)*0.5));
    const keep=k=>!ONLY||k.split('|').some(id=>ONLY.has(id));
    if(pairs.size){
      const pairMin=auto(meta.pairN,pairs.size);
      const pr=[...pairs].filter(([k,e])=>e.n>=pairMin&&keep(k)).map(([k,e])=>{ const [a,b]=k.split('|'), exp=(wr(chars.get(a))+wr(chars.get(b)))/2; return {a,b,n:e.n,wr:e.w/e.n,exp,d:e.w/e.n-exp}; });
      const row=x=>[`${nm(x.a)} ＋ ${nm(x.b)}`,n0(x.n),pc(x.wr),pc(x.exp),sg(x.d),moe(x)], head=['組','試合','勝率','見込み','差','ぶれ'];
      P(`## 味方の組み合わせ（${pairMin}試合以上・${pr.length}組）`); P('');
      P(`見込み＝2人それぞれの勝率の平均。差が大きいほど「一緒にいると強い（弱い）」。ぶれ＝試合数から来る勝率の95%のぶれ。★＝差がぶれより大きい（偶然ではなさそう）。`); P('');
      P(`### 相性がよい組 上位${TOP}`); P(''); P(table(head,[...pr].sort((x,y)=>y.d-x.d).slice(0,TOP).map(row))); P('');
      P(`### 相性がわるい組 上位${TOP}`); P(''); P(table(head,[...pr].sort((x,y)=>x.d-y.d).slice(0,TOP).map(row))); P('');
    }
    if(vs.size){
      const vsMin=auto(meta.vsN,vs.size);
      const vr=[...vs].filter(([k,e])=>e.n>=vsMin&&keep(k)).map(([k,e])=>{ const [a,b]=k.split('|'), exp=(wr(chars.get(a))+1-wr(chars.get(b)))/2; return {a,b,n:e.n,wr:e.w/e.n,exp,d:e.w/e.n-exp}; })
        .filter(x=>ONLY?ONLY.has(x.a):x.a<x.b); // 両向きで同じ情報なので片方だけ（only のときは指定キャラを左に）
      const row=x=>[`${nm(x.a)} 対 ${nm(x.b)}`,n0(x.n),pc(x.wr),pc(x.exp),sg(x.d),moe(x)], head=['対面','試合','勝率','見込み','差','ぶれ'];
      P(`## 対面（${vsMin}試合以上）`); P('');
      P(`勝率＝左のキャラがいる側の勝率。見込み＝左の勝率と（1－右の勝率）の平均。差が大きいほど左が右に強い（マイナスなら右が左に強い）。ぶれ・★は組み合わせの表と同じ。`); P('');
      P(`### 左が右に強い 上位${TOP}`); P(''); P(table(head,[...vr].sort((x,y)=>y.d-x.d).slice(0,TOP).map(row))); P('');
      P(`### 右が左に強い 上位${TOP}`); P(''); P(table(head,[...vr].sort((x,y)=>x.d-y.d).slice(0,TOP).map(row))); P('');
    }
    return L.join('\n')+'\n';
  }
  return {add,text};
}
if(typeof module!=='undefined') module.exports=rankSummary;
