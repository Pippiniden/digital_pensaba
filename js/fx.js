'use strict';
/* =====================================================================
   演出：セリフの吹き出し・ダメージ数値・宝具カットイン
         フェイズ切り替えの帯・鉛筆ロール・攻撃カードの拡大
   engine.js が FXQ に積んだイベントを、画面の上（#fx）で順番に再生する。
   画面の再描画（render）とは別の層なので、描き直しても演出は消えない。
   ===================================================================== */

// 次のイベントまでの待ち時間(ms)。イベントに w があればそちらを優先
const FX_WAIT = { sync:130, skill:700, say:950, dmg:420, cutin:CUTIN_MS-250, phase:420, phaseBig:900, banner:700, roll:780, rollGrp:110, atk:640, pop:520, ko:900 };
const ROLL_SPIN = 520;                             // ロール演出で出目が回っている時間(ms)
const BUBBLE_MS = 2600;                            // 吹き出しの表示時間(ms)
let fxRunning=false;

const fxBusy = ()=>fxRunning||FXQ.length>0;
function fxKick(){ if(!fxRunning&&FXQ.length){ fxRunning=true; setTimeout(fxNext,30); } }
function fxNext(){
  const ev=FXQ.shift();
  if(!ev){
    fxRunning=false; clearKoHolds();
    if(UI.defer){ UI.defer=false; render(); } // 演出中は出さなかった表示（ダメージフェイズ終了など）を出す
    // 決着：VICTORY などの帯（showPhase の end は 3200ms 表示）が消えるころに「もう一度」などのボタン、続いてリザルトを出す
    if(G.phase==='over'&&!UI.resultShown){ UI.resultShown=true;
      setTimeout(()=>{ if(G.phase==='over'){ UI.endReady=true; render(); } },1400);
      setTimeout(()=>{ if(G.phase==='over'){ UI.result=true; render(); } },2000); }
    return;
  }
  let wait=0;
  try{ wait=fxPlay(ev); }catch(e){ console.error(e); if(ev.t==='roll') reveal(ev); }
  if(ev.w!=null) wait=ev.w;
  setTimeout(fxNext,wait);
}
const fxLayer = ()=>document.querySelector('#fx');
const portraitOf = uid=>document.querySelector(`.svt[data-uid="${uid}"] .portrait, .mchip[data-uid="${uid}"]`); // マスターは帯のパネル

function fxPlay(ev){
  if(ev.t==='sync'){ stepHold(ev); return FX_WAIT.sync; } // NP・効果の表示を、この順番で更新
  const L=fxLayer(); if(!L){ if(ev.t==='dmg') stepHold(ev); if(ev.t==='roll') reveal(ev); if(ev.t==='ko') ev.uids.forEach(uid=>{ delete FXHOLD[uid]; redrawSvt(uid); }); return 0; }
  if(ev.t==='ko'){ showKo(L,ev); return FX_WAIT.ko; }
  if(ev.t==='cutin'){ showCutin(L,ev); return FX_WAIT.cutin; }
  if(ev.t==='phase'||ev.t==='banner'){ showPhase(L,ev); return ev.t==='banner'?FX_WAIT.banner:ev.big?FX_WAIT.phaseBig:FX_WAIT.phase; }
  if(ev.t==='atk'){ showAtk(L,ev); return FX_WAIT.atk; }
  if(ev.t==='skill'){ showSkill(L,ev); return FX_WAIT.skill; }
  if(ev.t==='dmg') stepHold(ev); // カードが見つからなくても表示HPは進める
  const p=portraitOf(ev.uid);
  if(!p){ if(ev.t==='roll') reveal(ev); return 0; }
  const r=p.getBoundingClientRect();
  if(ev.t==='say'){ showBubble(L,ev,r); return FX_WAIT.say; }
  if(ev.t==='dmg'){ showDmg(L,ev,r); return FX_WAIT.dmg; }
  if(ev.t==='pop'){ showPop(L,ev,r); return FX_WAIT.pop; }
  if(ev.t==='roll'){ showRoll(L,ev,r); return ev.grp?FX_WAIT.rollGrp:FX_WAIT.roll; }
  return 0;
}
const centerOf = r=>({x:r.left+r.width/2, y:r.top+r.height/2});

// フェイズ切り替え：中央の帯（.stage）に重ねて横切る帯を出す。big はターン開始・決着
function showPhase(L,ev){
  const st=document.querySelector('.stage'); if(!st) return;
  const r=st.getBoundingClientRect();
  L.querySelectorAll('.phasefx').forEach(x=>x.remove());
  const el=document.createElement('div');
  el.className=`phasefx ${ev.t}${ev.big?' big':''}${ev.end?' end':''}${ev.pid!=null?` p${ev.pid}`:''}${ev.col?` c${ev.col}`:''}`;
  Object.assign(el.style,{left:`${r.left}px`,top:`${r.top}px`,width:`${r.width}px`,height:`${r.height}px`});
  el.innerHTML=`<div class="pf-band"><b>${esc(ev.title)}</b>${ev.sub?`<small>${esc(ev.sub)}</small>`:''}</div>`;
  L.appendChild(el);
  setTimeout(()=>el.remove(),ev.end?3200:ev.big?1500:1100);
}

// 鉛筆ロール：肖像の上で出目がくるくる変わり、止まったら結果（行動回数・コマンド）を見せる
function showRoll(L,ev,r){
  const u=U(ev.uid), d=u&&D(ev.def||u.def);
  const el=document.createElement('div');
  el.className='rollfx';
  const c=centerOf(r);
  el.style.left=`${c.x}px`; el.style.top=`${c.y}px`;
  el.innerHTML=`<div class="rf-pencil"><span>${roll()+1}</span></div><div class="rf-res"></div>`;
  L.appendChild(el);
  const num=el.querySelector('.rf-pencil span');
  let last=-1;
  const tick=setInterval(()=>{ let n; do{ n=roll()+1; }while(n===last); last=n; num.textContent=n; },55);
  setTimeout(()=>{
    clearInterval(tick);
    num.textContent=ev.f+1;
    el.classList.add('land');
    const res=el.querySelector('.rf-res');
    if(ev.ch) res.innerHTML=`<span class="rf-acts rf-ch ${ev.ch.ok?'':'zero'}">${ev.ch.ok?'成功':'失敗'}<small>${ev.ch.need}以下で成功</small></span>`;
    else if(ev.n!=null) res.innerHTML=`<span class="rf-acts ${ev.n?'':'zero'}">行動 ×${ev.n}</span>`;
    else if(ev.cmd&&d) res.innerHTML=cmdCardHTML(d,ev.cmd);
    reveal(ev);
  },ROLL_SPIN);
  setTimeout(()=>el.classList.add('bye'),ROLL_SPIN+(ev.grp?900:650));
  setTimeout(()=>el.remove(),ROLL_SPIN+(ev.grp?1200:950));
}
// ロール結果を画面に出す（隠していた出目バッジ・コマンド列のカード）
function reveal(ev){
  if(!ev.keys||!ev.keys.length) return;
  const uids=new Set(); let lane=false;
  ev.keys.forEach(k=>{ FXHIDE.delete(k); if(k.startsWith('f:')) uids.add(k.slice(2)); else lane=true; });
  uids.forEach(redrawSvt);
  if(lane||G.phase==='actRoll') redrawLane(); // 行動配分中は、出目が出たサーヴァントのカードを中央に並べる
}
function redrawLane(){ const l=document.querySelector('.lane'); if(l){ setHTML(l,laneHTML()); animateLane(); } }

// 攻撃：コマンドカードを中央で大きく見せ、攻撃対象へ飛ばす
function showAtk(L,ev){
  const u=U(ev.uid); if(!u) return;
  const d=D(u.def);
  const st=document.querySelector('.stage'), from=portraitOf(ev.uid), to=ev.tgt&&portraitOf(ev.tgt);
  if(!st||!from) return;
  const c0=centerOf(from.getBoundingClientRect()), cs=centerOf(st.getBoundingClientRect());
  const svt=document.querySelector(`.svt[data-uid="${ev.uid}"]`);
  if(svt){ svt.classList.remove('lunge','up','down'); void svt.offsetWidth; svt.classList.add('lunge',svt.closest('.side.top')?'down':'up'); }
  const lane=ev.ri!=null&&document.querySelectorAll('.lane .it')[ev.ri];
  if(lane){ lane.classList.remove('fire'); void lane.offsetWidth; lane.classList.add('fire'); }
  const el=document.createElement('div');
  el.className=`atkfx${ev.extra?' extra':''}`;
  el.innerHTML=`${ev.extra?'<span class="af-tag">EXTRA</span>':''}${cmdCardHTML(d,ev.cmd)}`;
  el.style.left=`${cs.x}px`; el.style.top=`${cs.y}px`;
  L.appendChild(el);
  const dx=c0.x-cs.x, dy=c0.y-cs.y;
  const frames=[
    {transform:`translate(${dx}px,${dy}px) scale(.35)`,opacity:0},
    {transform:'translate(0,0) scale(1.15)',opacity:1,offset:.3},
    {transform:'translate(0,0) scale(1)',opacity:1,offset:.6},
  ];
  if(to){ const c1=centerOf(to.getBoundingClientRect()); frames.push({transform:`translate(${c1.x-cs.x}px,${c1.y-cs.y}px) scale(.45) rotate(${c1.y>cs.y?'':'-'}8deg)`,opacity:.15}); }
  else frames.push({transform:'translate(0,-20px) scale(1.05)',opacity:0});
  const a=el.animate(frames,{duration:760,easing:'cubic-bezier(.3,.7,.3,1)',fill:'forwards'});
  a.onfinish=()=>el.remove();
  setTimeout(()=>el.remove(),1200);
}
// 肖像の上に文字を出す（霊基再臨など）
function showPop(L,ev,r){
  const n=document.createElement('div');
  n.className=`txtpop ${ev.cls||''}`;
  n.textContent=ev.text;
  const c=centerOf(r);
  n.style.left=`${c.x}px`; n.style.top=`${c.y}px`;
  L.appendChild(n);
  setTimeout(()=>n.remove(),1400);
}

// 吹き出し：画面の上半分にいるサーヴァントは下向き、下半分なら上向きに出す（どちらも中央に向かう）
function showBubble(L,ev,r){
  L.querySelectorAll(`.bubble[data-uid="${ev.uid}"]`).forEach(b=>b.remove());
  const u=U(ev.uid), d=u&&D(u.def);
  const b=document.createElement('div');
  const down=r.top+r.height/2 < window.innerHeight/2;
  b.className=`bubble ${down?'down':'up'} k-${ev.key}`;
  b.dataset.uid=ev.uid;
  b.innerHTML=`<span class="who">${esc(d?d.name:'')}</span>${esc(ev.text)}`;
  L.appendChild(b);
  const w=b.offsetWidth, h=b.offsetHeight;
  const left=Math.max(8,Math.min(window.innerWidth-w-8, r.left+r.width*.35));
  const top = down ? r.bottom-6 : r.top-h+6; // 上の列は肖像の下、下の列は肖像の上（どちらも中央側）
  b.style.left=`${left}px`; b.style.top=`${Math.max(8,Math.min(window.innerHeight-h-8,top))}px`;
  b.style.setProperty('--tail',`${Math.max(14,Math.min(w-28,r.left+r.width*.5-left))}px`);
  setTimeout(()=>b.classList.add('bye'),BUBBLE_MS);
  setTimeout(()=>b.remove(),BUBBLE_MS+350);
}

// ダメージ数値：肖像の中央から浮き上がって消える
// 表示HPをこのダメージのぶんだけ減らす。
// HP0になっても、ここではまだ暗くしない（ko イベント＝一連の攻撃が終わったところで戦闘不能の表示にする）
// sync イベント（NP・効果・HP）も同じ：再生されたぶんだけ表示を進め、そのユニットの演出が尽きたら表示固定を外す
function stepHold(ev){
  if(ev.t==='dmg'&&ev.hp==null) return;
  holdOf(ev.uid);
  const h=FXHOLD[ev.uid]; if(!h){ redrawSvt(ev.uid); return; }
  if(ev.t==='dmg'){ h.hp=ev.hp; if(ev.out) h.ko=true; }
  else { if(ev.hp!=null) h.hp=ev.hp; h.np=ev.np; h.fx=ev.fx; }
  if(!h.ko&&!FXQ.some(e=>e.uid===ev.uid&&(e.t==='sync'||(e.t==='dmg'&&e.hp!=null)))) delete FXHOLD[ev.uid];
  redrawSvt(ev.uid);
}
// 戦闘不能の演出：カードを暗くして「戦闘不能」の文字を出す
function showKo(L,ev){
  ev.uids.forEach(uid=>{
    delete FXHOLD[uid]; redrawSvt(uid);
    const el=document.querySelector(`.svt[data-uid="${uid}"]`); if(el) el.classList.add('ko');
    const p=portraitOf(uid); if(p) showPop(L,{text:TERMS.out,cls:'ko'},p.getBoundingClientRect());
  });
}
// 念のため：演出が全部終わったのに戦闘不能待ちが残っていたら表示を戻す
function clearKoHolds(){
  for(const uid in FXHOLD) if(FXHOLD[uid].ko){ delete FXHOLD[uid]; redrawSvt(uid); }
}
function showDmg(L,ev,r){
  const n=document.createElement('div');
  n.className='dmgpop'+(ev.crit?' crit':'')+(ev.np?' np':'')+(ev.text?' miss':'')+(ev.over?' over':'');
  n.textContent=ev.text||ev.v;
  n.style.left=`${r.left+r.width/2+(Math.random()*24-12)}px`;
  n.style.top=`${r.top+r.height*.45}px`;
  L.appendChild(n);
  const svt=document.querySelector(`.svt[data-uid="${ev.uid}"]`);
  if(svt&&!ev.text){ svt.classList.remove('hit'); void svt.offsetWidth; svt.classList.add('hit'); }
  setTimeout(()=>n.remove(),1100);
}

// サーヴァントのカード1枚だけ描き直す（画面全体の render は呼ばない）
function redrawSvt(uid){
  const u0=U(uid);
  if(u0&&u0.master){
    const m=document.querySelector(`.mchip[data-uid="${uid}"]`); if(m){ replaceHTML(m,masterChipHTML(u0)); return; }
    const c=document.querySelector(`.mcard[data-uid="${uid}"]`); if(c){ replaceHTML(c,masterCardHTML(u0)); syncPulses(); }
    return;
  }
  const el=document.querySelector(`.svt[data-uid="${uid}"]`), u=U(uid);
  if(!el||!u) return;
  replaceHTML(el,svtHTML(u)); // 肖像の画像は残したまま差し替える（チカチカ防止）
  syncPulses();
}

// スキル使用：中央の帯（.stage）の上に、スキル名と効果のパネルを出す（続くセリフの吹き出しと重ねて見せる）
const SKILL_MS = 2300;
function showSkill(L,ev){
  const u=U(ev.uid), st=document.querySelector('.stage'); if(!u||!st) return;
  const d=D(u.def), r=st.getBoundingClientRect();
  L.querySelectorAll('.skillfx').forEach(x=>x.remove());
  const el=document.createElement('div');
  el.className=`skillfx p${u.pid}`;
  // 誰が使ったか分かるように、使用者の顔と名前を左に出す（サーヴァントもマスターも）
  el.innerHTML=`<div class="sf-main">${faceImg(d,'face sf-img')}
      <div class="sf-text">
        <div class="sf-who">${clsIconTag(d.cls,'sf-cls')}<b>${esc(d.name)}</b>${ev.picked?`<span class="sf-to">→ ${esc(ev.picked)}</span>`:''}</div>
        <div class="sf-head"><i>${esc(ev.head||`S${ev.si+1}`)}</i><b>${esc(ev.name)}</b></div>
      </div></div>
    <ul>${ev.lines.map(t=>`<li>${esc(t)}</li>`).join('')}</ul>`;
  L.appendChild(el);
  el.style.left=`${r.left+r.width/2}px`; el.style.top=`${r.top+r.height/2}px`;
  el.style.maxWidth=`${Math.max(240,Math.min(520,r.width-16))}px`;
  setTimeout(()=>el.classList.add('bye'),SKILL_MS);
  setTimeout(()=>el.remove(),SKILL_MS+300);
}

// 宝具カットイン：見た目と宝具名の配置は js/cutin.js + css/cutin.css（エディタのプレビューと共用）
function showCutin(L,ev){
  const u=U(ev.uid); if(!u) return;
  const d=D(u.def), ult={name:ev.title, ruby:ev.ruby, br:ev.br, c:ev.col};
  const c=document.createElement('div');
  c.className='cutin';
  c.innerHTML=cutinStageHTML(d,ult);
  L.appendChild(c);
  cutinLayoutWhenReady(c.querySelector('.ct'),ult);
  setTimeout(()=>c.remove(),CUTIN_MS+50);
}
