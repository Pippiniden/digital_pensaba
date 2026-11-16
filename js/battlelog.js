'use strict';
/* =====================================================================
   バトルログの書き出し（HTML / CSV）と表示
   - ゲーム（index.html）とビューア（battlelog.html）で共用する
   - データの形（CSV と表示で共通）：
       { meta:{date,rule,mode,p0,p1,turns,winner}, units:[{side,id,name,role,status,dealt,taken,kills}],
         rows:[{turn,cur,type,side,id,name,text}] }
     type＝ログの種類（log / h / good / bad / sub / cmd … と say＝セリフ）
   - blogCollect / blogExport* は対戦中の G から集める（ゲーム専用）。
     blogCSV / blogFromCSV / blogBodyHTML はエンジンに依存しない（ビューアでも動く）
   ===================================================================== */
const BLOG_COLS=['No','ターン','手番','種別','陣営','キャラID','キャラ名','内容'];
const BLOG_META={date:'日時',rule:'ルール',mode:'モード',p0:'プレイヤー1',p1:'プレイヤー2',turns:'経過ターン',winner:'勝者'};

// ---------- 集める（ゲーム専用） ----------
function blogCollect(){
  const tmp=document.createElement('div'), plain=h=>{ tmp.innerHTML=h; return tmp.textContent; };
  const mode=G.scn?`シナリオ${G.scn.title?`「${G.scn.title}」`:''}`:G.arcade?arcadeLabel():typeof netOn==='function'&&netOn()?'オンライン対戦':G.mode==='watch'?`観戦（${CPU_LEVELS[G.level].name}）`:G.mode==='cpu'?`CPU戦（${CPU_LEVELS[G.level].name}）`:'2人対戦';
  const units=[0,1].flatMap(pid=>{ let n=0; return sideUnits(pid).map(u=>{ const d=D(u.def), s=stOf(u);
    return {side:pid,id:u.def,name:d.name,role:u.master?TERMS.player:ORD[n++]||'',status:u.out?(u.master?'瀕死':TERMS.out):`HP ${fmt(u.hp)}/${maxHp(u)}`,dealt:fmt(s.dealt),taken:fmt(s.taken),kills:s.kills}; }); });
  const rows=G.log.map(l=>{ const say=l.cls==='say', d=say&&D(l.u);
    return {turn:l.t??'',cur:l.c??'',type:l.cls||'log',side:say?l.p:'',id:say?l.u:'',name:d?d.name:'',text:say?l.x:plain(l.msg)}; });
  return {meta:{date:new Date().toLocaleString('ja-JP'),rule:ruleset().name,mode,p0:G.players[0].name,p1:G.players[1].name,turns:G.turn,winner:G.winner==null?'':G.winner},units,rows};
}

// ---------- CSV ----------
const blogCell=v=>{ v=String(v??''); return /[",\r\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v; };
// 先頭に meta（対戦の情報）と unit（編成と成績）の行、そのあとにログを1行ずつ
function blogCSV(d){
  const out=[BLOG_COLS];
  Object.keys(BLOG_META).forEach(k=>out.push(['','','','meta','',k,BLOG_META[k],d.meta[k]]));
  d.units.forEach(u=>out.push(['','','','unit',u.side,u.id,u.name,['role','status','dealt','taken','kills'].map(k=>`${k}=${u[k]}`).join(';')]));
  d.rows.forEach((r,i)=>out.push([i+1,r.turn,r.cur,r.type,r.side,r.id,r.name,r.text]));
  return out.map(r=>r.map(blogCell).join(',')).join('\r\n')+'\r\n';
}
function blogParseCSV(text){
  const rows=[]; let row=[], cell='', q=false;
  text=text.replace(/^﻿/,'');
  for(let i=0;i<text.length;i++){ const c=text[i];
    if(q){ if(c==='"'){ if(text[i+1]==='"'){ cell+='"'; i++; } else q=false; } else cell+=c; }
    else if(c==='"') q=true;
    else if(c===','){ row.push(cell); cell=''; }
    else if(c==='\n'||c==='\r'){ if(c==='\r'&&text[i+1]==='\n') i++; row.push(cell); cell=''; rows.push(row); row=[]; }
    else cell+=c;
  }
  if(cell||row.length){ row.push(cell); rows.push(row); }
  return rows;
}
function blogFromCSV(text){
  const rows=blogParseCSV(text), num=v=>v===''||v==null||isNaN(Number(v))?'':Number(v);
  if(!rows.length||rows[0][0]!==BLOG_COLS[0]||rows[0][3]!==BLOG_COLS[3]||rows[0].length<BLOG_COLS.length) throw new Error('バトルログのCSVではありません（1行目の見出しが違います）');
  const d={meta:{},units:[],rows:[]};
  rows.slice(1).forEach(r=>{ if(r.length<BLOG_COLS.length) return;
    const [,turn,cur,type,side,id,name,txt]=r;
    if(type==='meta') d.meta[id]=id==='winner'||id==='turns'?num(txt):txt;
    else if(type==='unit'){ const u={side:num(side),id,name}; txt.split(';').forEach(kv=>{ const i=kv.indexOf('='); if(i>0) u[kv.slice(0,i)]=kv.slice(i+1); }); d.units.push(u); }
    else d.rows.push({turn:num(turn),cur:num(cur),type:type||'log',side:num(side),id,name,text:txt});
  });
  return d;
}

// ---------- 表示（HTML 出力とビューアで共通） ----------
// face(id,name)：顔画像のHTMLを返す（出力では埋め込み画像、ビューアでは img/units の画像）
function blogBodyHTML(d,face){
  const m=d.meta, pn=[m.p0||'プレイヤー1',m.p1||'プレイヤー2'], w=m.winner===0||m.winner===1?m.winner:null;
  // 名前の色分け：片方の陣営にしかいない名前だけ（同じキャラが両陣営にいると区別できない）
  const sideOf={}; [...d.units.map(u=>[u.name,u.side]),[pn[0],0],[pn[1],1]].forEach(([n,s])=>{ if(!n||(s!==0&&s!==1)) return; const k=esc(n); sideOf[k]=k in sideOf&&sideOf[k]!==s?-1:s; });
  const names=Object.keys(sideOf).filter(k=>sideOf[k]>=0).sort((a,b)=>b.length-a.length);
  const re=names.length?new RegExp(names.map(n=>n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'g'):null;
  const hl=t=>re?esc(t).replace(re,x=>`<span class="p${sideOf[x]}">${x}</span>`):esc(t);
  const cls=t=>String(t).replace(/[^a-z0-9 _-]/gi,'');
  const side=pid=>`<section class="bl-side s${pid}${w===pid?' win':''}"><h3><span class="p${pid}">${esc(pn[pid])}</span>${w===pid?'<em>WIN</em>':''}</h3>
    ${d.units.filter(u=>u.side===pid).map(u=>`<div class="bl-unit${/^HP /.test(u.status||'')?'':' out'}">${face(u.id,u.name)}<div><b>${esc(u.name)}</b><small>${esc(u.role||'')} ・ ${esc(u.status||'')}</small></div>
      <dl><div><dt>与ダメ</dt><dd>${esc(u.dealt??'-')}</dd></div><div><dt>被ダメ</dt><dd>${esc(u.taken??'-')}</dd></div><div><dt>撃破</dt><dd>${esc(u.kills??'-')}</dd></div></dl></div>`).join('')}</section>`;
  const turns=[]; let nSay=0;
  const body=d.rows.map(r=>{
    if(r.type==='say'){ nSay++; return `<div class="bl-r say s${r.side===1?1:0}">${face(r.id,r.name)}<div class="bl-bub"><b>${esc(r.name)}</b><p>${esc(r.text)}</p></div></div>`; }
    if(r.type==='h'&&/^━/.test(r.text)){ const id=turns.includes(r.turn)?'':` id="bl-t${cls(r.turn)}"`; if(id) turns.push(r.turn);
      return `<h2 class="bl-turn c${r.cur===1?1:0}"${id}>${esc(r.text.replace(/^━\s*|\s*━$/g,''))}</h2>`; }
    if(r.type==='h') return `<h4 class="bl-r bl-ph">${hl(r.text)}</h4>`;
    return `<p class="bl-r ${cls(r.type)}">${hl(r.text)}</p>`;
  }).join('');
  return `<div class="bl">
    <header class="bl-head"><h1>BATTLE LOG</h1>
      <p class="bl-sub">${[m.mode,m.rule&&`${m.rule}ルール`,m.turns!==''&&m.turns!=null&&`経過ターン ${m.turns}`,m.date].filter(Boolean).map(esc).join(' ・ ')}</p>
      <p class="bl-res">${w==null?'対戦中のログ':`<span class="p${w}">${esc(pn[w])}</span> の勝利`}</p>
      <div class="bl-vs">${side(0)}<em>VS</em>${side(1)}</div></header>
    <input type="checkbox" id="bl-say" class="bl-ck" checked><input type="checkbox" id="bl-sub" class="bl-ck" checked>
    <div class="bl-bar"><label for="bl-say">セリフ<small>（${nSay}）</small></label><label for="bl-sub">細かいログ</label>
      ${turns.length?`<nav>ターン：${turns.map(t=>`<a href="#bl-t${cls(t)}">${esc(t)}</a>`).join('')}</nav>`:''}</div>
    <div class="bl-log">${body||'<p class="bl-r sub">ログがありません。</p>'}</div>
  </div>`;
}
const blogNoFace=name=>`<span class="bl-face none">${esc(String(name||'?').slice(0,1))}</span>`;

// 出力したHTML・ビューアの見た目（ゲームのCSSに頼らない。1か所で持つ）
const BLOG_CSS=`
.bl-page{margin:0;background:#070e24;color:#e8ecf8;font:14px/1.7 "Hiragino Sans","Yu Gothic UI","Meiryo",system-ui,sans-serif}
.bl{--p0:#ff8f6b;--p1:#7fb0ff;--gold:#d6b25e;--gold-hi:#f6e3a1;--gold-lo:#8a6a26;--sub:#9fb0d6;--line:rgba(150,185,255,.18);--serif:"Cinzel","Noto Serif JP","Yu Mincho","Hiragino Mincho ProN",serif;
  max-width:860px;margin:0 auto;padding:20px 16px 60px;box-sizing:border-box;text-align:left}
.bl *{box-sizing:border-box}
.bl .p0{color:var(--p0)}.bl .p1{color:var(--p1)}
.bl-head{padding:18px 16px 16px;text-align:center;border:1px solid var(--gold);border-radius:6px;background:linear-gradient(160deg,#16295a,#0f1e45 40%,#0a1533);box-shadow:0 8px 24px rgba(0,0,0,.5)}
.bl-head h1{margin:0;font:700 30px/1.2 var(--serif);letter-spacing:.2em;color:var(--gold-hi)}
.bl-sub{margin:4px 0 0;font-size:12px;color:var(--sub)}
.bl-res{margin:8px 0 12px;font:700 18px var(--serif)}
.bl-vs{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:10px;align-items:center}
.bl-vs>em{font:italic 700 24px var(--serif);color:var(--gold-hi)}
.bl-side{padding:8px 10px;text-align:left;border:1px solid var(--line);border-radius:4px;background:rgba(6,13,34,.55)}
.bl-side.s0{border-top:3px solid var(--p0)}.bl-side.s1{border-top:3px solid var(--p1)}
.bl-side.win{border-color:var(--gold);box-shadow:0 0 14px rgba(246,227,161,.25)}
.bl-side h3{display:flex;justify-content:space-between;align-items:center;margin:0 0 6px;font:700 15px var(--serif)}
.bl-side h3 em{font:700 11px var(--serif);letter-spacing:.15em;padding:1px 8px;border-radius:3px;color:#1a1206;background:linear-gradient(180deg,var(--gold-hi),var(--gold))}
.bl-unit{display:grid;grid-template-columns:44px minmax(0,1fr);gap:2px 8px;align-items:center;padding:5px 0;border-top:1px solid var(--line)}
.bl-unit.out{opacity:.6}
.bl-unit b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.3}
.bl-unit small{color:var(--sub);font-size:11px}
.bl-unit dl{grid-column:1/-1;display:flex;gap:12px;margin:0;font-size:11px;color:var(--sub)}
.bl-unit dl div{display:flex;gap:4px}.bl-unit dd{margin:0;font-weight:700;color:#e8ecf8}
.bl-face{position:relative;flex:none;display:block;width:44px;height:44px;overflow:hidden;border-radius:4px;border:1px solid var(--gold-lo);background:#0a1533}
.bl-face img{display:block;width:100%;height:100%;object-fit:cover;object-position:50% 18%}
.bl-face.im{background-size:cover;background-position:center}
.bl-face.none{display:grid;place-items:center;font:700 18px var(--serif);color:var(--gold-hi)}
.bl-ck{position:absolute;opacity:0;pointer-events:none}
.bl-bar{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:12px 0 4px;padding:8px 10px;font-size:12px;border:1px solid var(--line);border-radius:4px;background:rgba(7,14,36,.94)}
.bl-bar label{cursor:pointer;user-select:none;padding:2px 10px;border-radius:99px;border:1px solid var(--gold-lo);color:var(--sub)}
.bl-bar label::before{content:'□ '}
#bl-say:checked~.bl-bar label[for=bl-say],#bl-sub:checked~.bl-bar label[for=bl-sub]{color:var(--gold-hi);border-color:var(--gold);background:rgba(214,178,94,.14)}
#bl-say:checked~.bl-bar label[for=bl-say]::before,#bl-sub:checked~.bl-bar label[for=bl-sub]::before{content:'☑ '}
#bl-say:focus-visible~.bl-bar label[for=bl-say],#bl-sub:focus-visible~.bl-bar label[for=bl-sub]{outline:2px solid var(--gold-hi)}
#bl-say:not(:checked)~.bl-log .say,#bl-sub:not(:checked)~.bl-log .sub,#bl-sub:not(:checked)~.bl-log .cmd{display:none}
.bl-bar nav{display:flex;flex-wrap:wrap;gap:2px 4px;align-items:center;margin-left:auto;color:var(--sub)}
.bl-bar nav a{min-width:22px;padding:0 4px;text-align:center;border-radius:3px;color:var(--gold-hi);text-decoration:none;border:1px solid transparent}
.bl-bar nav a:hover{border-color:var(--gold)}
.bl-turn{margin:22px 0 8px;padding:6px 12px;font:700 16px var(--serif);letter-spacing:.08em;scroll-margin-top:56px;border-left:5px solid var(--p0);background:linear-gradient(90deg,rgba(255,143,107,.18),transparent)}
.bl-turn.c1{border-left-color:var(--p1);background:linear-gradient(90deg,rgba(127,176,255,.18),transparent)}
.bl-r{margin:0;padding:1px 4px}
.bl-ph{margin:10px 0 2px;font:700 13px var(--serif);color:var(--gold-hi);border-bottom:1px solid var(--line)}
.bl-r.good{color:#7be3a4}.bl-r.bad{color:#ff8a80}.bl-r.sub{color:var(--sub);font-size:12px}.bl-r.cmd{font-size:12px;padding-left:12px}
.bl-r.say{display:flex;gap:8px;align-items:flex-start;margin:6px 0;max-width:86%}
.bl-r.say.s1{flex-direction:row-reverse;margin-left:auto}
.bl-r.say.s0 .bl-face{border-color:var(--p0)}.bl-r.say.s1 .bl-face{border-color:var(--p1)}
.bl-bub{min-width:0;padding:5px 12px 6px;border-radius:4px 12px 12px 12px;border:1px solid color-mix(in srgb,var(--p0) 55%,transparent);background:rgba(255,143,107,.09)}
.bl-r.say.s1 .bl-bub{border-radius:12px 4px 12px 12px;border-color:color-mix(in srgb,var(--p1) 55%,transparent);background:rgba(127,176,255,.09)}
.bl-bub b{display:block;font-size:11px;color:var(--p0)}.bl-r.say.s1 .bl-bub b{color:var(--p1);text-align:right}
.bl-bub p{margin:0;font-family:var(--serif);white-space:pre-wrap;overflow-wrap:anywhere}
.bl-r.hide{display:none}
@media (max-width:640px){.bl-vs{grid-template-columns:minmax(0,1fr)}.bl-vs>em{text-align:center}.bl-r.say{max-width:100%}}
@media print{.bl-page{background:#fff;color:#111}.bl-bar{display:none}}
`;
function blogDocHTML(d,face,css=''){
  return `<!doctype html>\n<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pensaba Duel バトルログ ${esc(d.meta.date||'')}</title>\n<style>${BLOG_CSS}${css}</style></head>\n<body class="bl-page">${blogBodyHTML(d,face)}</body></html>\n`;
}

// ---------- 書き出し（ゲーム専用） ----------
const blogName=ext=>{ const t=new Date(), z=n=>String(n).padStart(2,'0'); return `battlelog_${t.getFullYear()}${z(t.getMonth()+1)}${z(t.getDate())}_${z(t.getHours())}${z(t.getMinutes())}.${ext}`; };
function blogExportCSV(){ downloadText(blogName('csv'),'﻿'+blogCSV(blogCollect()),'text/csv'); } // BOM 付き（Excel で文字化けしないように）
// 顔画像を小さく切り出して埋め込む（出力したHTML 1つで画像も見られるように）。トリミング設定（fit.face）も反映する
function blogFaceData(d,size=112){
  const srcs=imgCandidates(d,'face');
  return new Promise(res=>{ let i=0; const im=new Image();
    im.onerror=()=>{ if(++i<srcs.length) im.src=srcs[i]; else res(null); };
    im.onload=()=>{ try{
      const ph=Object.values(IMG_PLACEHOLDER).includes(srcs[i]), f=(!ph&&d&&d.fit&&d.fit.face)||FIT_DEF.face, w=im.naturalWidth, h=im.naturalHeight;
      const s=Math.min(w,h), s2=s/Math.max(1,f.z/100), x=(w-s)*f.x/100+(s-s2)*f.x/100, y=(h-s)*f.y/100+(s-s2)*f.y/100;
      const c=document.createElement('canvas'); c.width=c.height=size;
      c.getContext('2d').drawImage(im,x,y,s2,s2,0,0,size,size);
      res(c.toDataURL('image/webp',.82));
    }catch(e){ res(null); } };
    im.src=srcs[0]; });
}
async function blogExportHTML(){
  const d=blogCollect(), ids=[...new Set([...d.units,...d.rows].map(x=>x.id).filter(Boolean))], imgs={};
  await Promise.all(ids.map(async id=>{ imgs[id]=await blogFaceData(D(id)||{id}); }));
  // 同じ顔はセリフのたびに出るので、画像は1キャラ1回だけCSSに埋め込んで、クラスで参照する
  const no={}; let css=''; ids.forEach((id,i)=>{ if(imgs[id]){ no[id]=i; css+=`.bl-f${i}{background-image:url(${imgs[id]})}
`; } });
  downloadText(blogName('html'),blogDocHTML(d,(id,name)=>id in no?`<span class="bl-face im bl-f${no[id]}" role="img" aria-label="${esc(name||'')}"></span>`:blogNoFace(name),css),'text/html');
}
