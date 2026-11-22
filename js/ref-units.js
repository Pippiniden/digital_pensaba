'use strict';
/* =====================================================================
   基準値（UNIT_REF）を使う部品：テスト用サーヴァントの組み立て・強さの測定・基準値との比較
   使う所：tools/ref-check.js / tools/llm-pack.js（Node の vm）、js/submit-worker.js・js/submit.js（申請ツール）
   読み込み順：rules → units → masters → common → unit-ref → ref-units（測定するなら engine → cpu → sim も）
   ===================================================================== */

// テスト用サーヴァント：コスト1〜5 × カード構成6種。スキルは全員同じ、宝具は追加効果のない単純なダメージ宝具
const REF_PATS={B3:[3,1,1],B2A2:[2,2,1],B2Q2:[2,1,2],A3:[1,3,1],A2Q2:[1,2,2],Q3:[1,1,3]}; // [Buster, Arts, Quick] の枚数
const REF_TIERS={lo:[0,0],mid:[.5,.5],hi:[1,1],tank:[1,0],glass:[0,1]}; // [HPの位置, 攻撃の位置]（0＝下限 / 1＝上限）
const REF_SKILLS=[ {name:'攻撃強化',eff:[{k:'atk',t:'self',v:20,turns:3}]}, {name:'魔力充填',eff:[{k:'np',t:'self',v:20}]}, {name:'回避',eff:[{k:'evade',t:'self',v:0,turns:1}]} ];
const REF_FACE_EFF={ weak:{k:'ignoreDef',t:'self',v:0,turns:1,times:1}, mid:{k:'atk',t:'self',v:30,turns:1}, strong:{k:'evade',t:'self',v:0,turns:1} };
const REF_KITS={A:'全体宝具の環境',S:'単体宝具の環境'};

// id = r_<コスト>_<構成>_<lo|mid|hi|tank|glass>_<weak|mid|strong>_<宝具>　宝具：A＝全体（基準値）/ S＝単体（基準値）/ a240＝全体240 / s360＝単体360
const refId=(cost,pat,tier='mid',face='weak',kit='A')=>['r',cost,pat,tier,face,kit].join('_');

function refUnit(id){
  const r10=v=>Math.round(v/10)*10, r5=v=>Math.round(v/5)*5, sum=a=>a.reduce((s,x)=>s+x,0);
  // 上限を超えていたら後ろのカードから step ずつ減らす（lo 未満にはしない）、下限に足りなければ前から増やす（hi は超えない）
  const fit=(vals,min,max,step,lo,hi)=>{
    vals=vals.slice();
    for(let g=0;g<200&&max!=null&&sum(vals)>max;g++){ const i=vals.length-1-g%vals.length; if(vals[i]-step>=lo(i)) vals[i]-=step; }
    for(let g=0;g<200&&min!=null&&sum(vals)<min;g++){ const i=g%vals.length; if(vals[i]+step<=hi(i)) vals[i]+=step; }
    return vals;
  };
  const [,c,pat,tier,face,kit]=id.split('_'), cost=+c, [fh,f]=REF_TIERS[tier], R=UNIT_REF, n=REF_PATS[pat];
  const cols=[...Array(n[0]).fill('R'),...Array(n[1]).fill('B'),...Array(n[2]).fill('G')];
  const rg=i=>R.dmg[cols[i]][cost];
  // 再臨前のダメージ：幅の中の f の位置。合計攻撃力の幅に収める
  let pre=cols.map((_,i)=>r10(rg(i)[0]+f*(rg(i)[1]-rg(i)[0])));
  pre=fit(pre,R.total[cost][0],R.total[cost][1],10,i=>rg(i)[0],i=>rg(i)[1]);
  // 再臨後：合計が postAdd だけ増えるように、前のカードから10ずつ配る
  const post=pre.slice(); for(let left=R.postAdd[cost],g=0;left>0;g++,left-=10) post[g%5]+=10;
  // NP：Arts 1枚あたり。合計の上限に収める（収まらなければ下限より下げる）
  const nr=R.np[Math.min(3,n[1])], npOf=(rng,max)=>fit(Array(n[1]).fill(0).map(()=>r5(rng[0]+f*(rng[1]-rng[0]))),null,max,5,()=>5,()=>99);
  const npPre=npOf(nr.pre,nr.preMax), npPost=npOf(nr.post,nr.postMax);
  // スター：Quick 3枚で合計の目安になるように1枚あたりを決める（コスト5は多め）
  const plus=cost>=R.star.plusCost?Math.round(R.star.plus[0]+f*(R.star.plus[1]-R.star.plus[0])):0;
  const split=t=>[Math.ceil(t/3),Math.round(t/3),t-Math.ceil(t/3)-Math.round(t/3)], stPre=split(R.star.pre+plus), stPost=split(R.star.post+plus);
  let a=0,q=0;
  const cards=cols.map((col,i)=>{ const np=col==='B'?a++:-1, st=col==='G'?q++:-1;
    return { pre:{c:col,dmg:pre[i],np:np<0?0:npPre[np],star:st<0?0:stPre[st]}, post:{c:col,dmg:post[i],np:np<0?0:npPost[np],star:st<0?0:stPost[st]} }; });
  const asc={ pre:{c:'ASC'}, post:{c:'W',label:'4番',eff:[REF_FACE_EFF[face]],dmg:R.ascFace.dmg[cost][face],np:0,star:0} };
  const faces=[cards[0],cards[1],cards[2],asc,cards[3],cards[4]].map(x=>({acts:1,...x}));
  const hp=r10(R.hp[cost][0]+fh*(R.hp[cost][1]-R.hp[cost][0]));
  const m=/^([as])(\d+)$/.exec(kit), u=m?[m[1]==='a'?'enemy_all':'target',+m[2]]:kit==='S'?['target',R.ult.one[cost]]:['enemy_all',R.ult.all[cost]];
  return normalizeUnit({ id, name:id, cls:'セイバー', cost, hp, faces, skills:REF_SKILLS, ult:{name:'宝具',c:cols[0],eff:[{k:'dmg',t:u[0],v:u[1]}]} });
}
// テスト用サーヴァントを UNITS / ALL_UNITS に足す（まだなければ）
function refEnsure(ids){ ids.forEach(id=>{ if(/^r_/.test(id)&&!D(id)){ const u=refUnit(id); UNITS=UNITS.concat(u); ALL_UNITS=ALL_UNITS.concat(u); } }); }
// 基準の中央のキャラ30体（宝具は kit）
const refPool=(kit='A')=>[5,4,3,2,1].flatMap(c=>Object.keys(REF_PATS).map(p=>refId(c,p,'mid','weak',kit)));
// t を基準の中央のキャラの環境に1体入れて n 試合（t＋ランダムな味方2騎 vs 同じ合計コストの3騎、合計コスト10）。t は UNITS に入れておく
function refMeasure(t,kit,n){
  const pool=refPool(kit); refEnsure(pool);
  const r=simTeam(t,n,[...new Set([t,...pool])],true);
  return { t, kit, n:r.win+r.lose+r.draw, w:r.win+r.draw/2, errors:r.errors, errMsg:r.errMsg, none:r.none };
}

// ---- 基準値との比較：[{label, val, ok:true|false|null, note}]（ok＝null は参考表示） ----
const REF_COL={R:'Buster',B:'Arts',G:'Quick'};
function refCompare(u){
  const c=u.cost, R=UNIT_REF, out=[];
  if(!R.hp[c]) return out;
  const judge=(v,[lo,hi])=>lo!=null&&v<lo?{ok:false,note:`下限${lo}より低い`}:hi!=null&&v>hi?{ok:false,note:`上限${hi}より高い`}:{ok:true,note:''};
  const rng=([lo,hi])=>`${lo??''}〜${hi??''}`;
  const pre=u.faces.filter(f=>f.pre.c!=='ASC'), sum=k=>pre.reduce((a,f)=>a+(f[k].dmg||0),0);
  out.push({label:'HP',val:`${u.hp}（基準 ${rng(R.hp[c])}）`,...judge(u.hp,R.hp[c])});
  out.push({label:'通常合計攻撃力',val:`${sum('pre')}（基準 ${rng(R.total[c])}）`,...judge(sum('pre'),R.total[c])});
  const want=sum('pre')+R.postAdd[c], d=sum('post')-want;
  out.push({label:'再臨後の合計',val:`${sum('post')}（基準 ${want}）`,ok:Math.abs(d)<=20,note:Math.abs(d)<=20?'':d>0?`${d}多い`:`${-d}少ない`});
  pre.forEach((f,i)=>{ const x=f.pre, r=R.dmg[x.c]&&R.dmg[x.c][c]; if(!r) return; const j=judge(x.dmg,r); if(!j.ok) out.push({label:`${REF_COL[x.c]}のダメージ`,val:`${x.dmg}（基準 ${rng(r)}）`,...j}); });
  const arts=pre.filter(f=>f.pre.c==='B'), nr=R.np[Math.min(3,arts.length)];
  if(nr){ const np=arts.reduce((a,f)=>a+f.pre.np,0), npp=arts.reduce((a,f)=>a+f.post.np,0);
    out.push({label:'NP合計',val:`${np}%→${npp}%（上限 ${nr.preMax}%→${nr.postMax}%）`,ok:np<=nr.preMax&&npp<=nr.postMax,note:np>nr.preMax||npp>nr.postMax?'上限より高い':''}); }
  const asc=u.faces.find(f=>f.pre.c==='ASC');
  if(asc){ const a=R.ascFace.dmg[c]; out.push({label:'4番の面（再臨後）',val:`ダメージ${asc.post.dmg||0}（効果 弱${a.weak}／中${a.mid}／強${a.strong}）`,ok:null,note:'追加効果が強いほどダメージを下げる'}); }
  const dm=u.ult.eff.filter(e=>e.k==='dmg');
  if(dm.length) out.push({label:TERMS.ult,val:`${dm.map(e=>`${e.t==='enemy_all'?'全体':'単体'}${e.max?'最大HP':e.v}`).join('＋')}（基準 全体${R.ult.all[c]}／単体${R.ult.one[c]}）`,ok:null,note:'追加効果があるなら基準より低め'});
  return out;
}

// ---- 強すぎ注意（UNIT_REF.limits）：validateUnits と同じ形の指摘 [{level:'warn', msg}] ----
// msg の頭は validateUnits と同じ（スキル1・効果2：/ 宝具・効果1：/ 出目4・再臨後・効果1：）なので、issueArea でタブに飛べる
function refLimits(u){
  const L=UNIT_REF.limits, out=[]; if(!L) return out;
  const add=msg=>out.push({level:'warn',msg:'強すぎ注意：'+msg});
  const isAll=e=>e.t==='ally_all'||e.t==='enemy_all';
  const nm=k=>(FX[k]||{}).name||k;
  // 弱体・即死を自分や味方にかける（代償）のは制限しない
  const harm=e=>FX[e.k]&&(FX[e.k].buff===false||e.k==='instantDeath');
  const one=(e,w,place)=>{
    if(harm(e)&&['self','ally_all','ally_other'].includes(e.t)) return;
    const f=L.forbid[e.k]; if(f&&f[place]) return add(`${w}：${f[place]}`);
    if(e.turns>L.maxTurns) add(`${w}：効果時間は${L.maxTurns}Tまでにしてください（今は${e.turns}T）`);
    const s=L.strong[e.k];
    if(s){
      const all=isAll(e), tc=all&&s.allTurns!=null?s.allTurns:s.turns, mc=all&&s.allTimes!=null?s.allTimes:s.times, cc=all&&s.allChance!=null?s.allChance:s.chance;
      // ターンと回数はどちらか一方が上限内ならよい（回避3回、のように回数で区切る書き方もあるため）
      const okT=tc!=null&&e.turns!=null&&e.turns<=tc, okM=mc!=null&&e.times!=null&&e.times<=mc;
      if((tc!=null||mc!=null)&&!okT&&!okM) add(`${w}：${nm(e.k)}${all?'（全体）':''}は ${[tc!=null?`${tc}T`:'',mc!=null?`${mc}回`:''].filter(Boolean).join('か')} までにしてください`);
      if(cc!=null&&!(e.chance>0&&e.chance<=cc)) add(`${w}：${nm(e.k)}${all?'（全体）':''}は確率つき（chance ${cc}以下）にしてください${e.chance?`（今は${e.chance}）`:'（今は必ず成功）'}`);
    }
    const v=L.val[e.k];
    if(place==='skill'&&v&&typeof e.v==='number'&&!e.max){ const m=isAll(e)?v[1]:v[0];
      if(Math.abs(e.v)>m) add(`${w}：${nm(e.k)}${isAll(e)?'（全体）':''}の値は${m}までにしてください（今は${e.v}）`); }
  };
  u.skills.forEach((s,si)=>{
    const w=`スキル${si+1}`;
    const n=s.eff.filter(e=>e.k!=='desc'&&!(harm(e)&&e.t==='self')).length; // 説明文・自分への代償は数えない
    if(n>L.maxEffs) add(`${w}：効果は${L.maxEffs}つまでにしてください（今は${n}つ）`);
    const st=s.eff.filter(e=>L.strong[e.k]&&!(harm(e)&&['self','ally_all','ally_other'].includes(e.t)));
    if(st.length>L.maxStrong) add(`${w}：強い効果（${st.map(e=>nm(e.k)).join('・')}）は1つのスキルに${L.maxStrong}つまでにしてください`);
    s.eff.forEach((e,ei)=>one(e,`${w}・効果${ei+1}`,'skill'));
  });
  u.ult.eff.forEach((e,ei)=>one(e,`${TERMS.ult}・効果${ei+1}`,'ult'));
  u.faces.forEach((f,fi)=>[['pre',`${TERMS.asc}前`],['post',`${TERMS.asc}後`]].forEach(([k,lab])=>{
    (f[k].eff||[]).forEach((e,ei)=>{ const w=`出目${fi+1}・${lab}・効果${ei+1}`;
      if(u.cost<=L.noDefFaceCost&&(e.k==='evade'||e.k==='invul')) add(`${w}：コスト${L.noDefFaceCost}以下は、面に${nm(e.k)}を付けないでください（ダメージを0にしても強すぎる）`);
      one(e,w,'face'); });
  }));
  return out;
}
