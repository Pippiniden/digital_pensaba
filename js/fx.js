'use strict';
/* =====================================================================
   演出：セリフの吹き出し・ダメージ数値・宝具カットイン
   engine.js が FXQ に積んだイベントを、画面の上（#fx）で順番に再生する。
   画面の再描画（render）とは別の層なので、描き直しても演出は消えない。
   ===================================================================== */

const FX_WAIT = { say:950, dmg:420, cutin:2000 }; // 次のイベントまでの待ち時間(ms)
const BUBBLE_MS = 2600;                            // 吹き出しの表示時間(ms)
let fxRunning=false;

const fxBusy = ()=>fxRunning||FXQ.length>0;
function fxKick(){ if(!fxRunning&&FXQ.length){ fxRunning=true; setTimeout(fxNext,30); } }
function fxNext(){
  const ev=FXQ.shift();
  if(!ev){ fxRunning=false; return; }
  let wait=0;
  try{ wait=fxPlay(ev); }catch(e){ console.error(e); }
  setTimeout(fxNext,wait);
}
const fxLayer = ()=>document.querySelector('#fx');
const portraitOf = uid=>document.querySelector(`.svt[data-uid="${uid}"] .portrait`);

function fxPlay(ev){
  const L=fxLayer(); if(!L) return 0;
  if(ev.t==='cutin'){ showCutin(L,ev); return FX_WAIT.cutin; }
  const p=portraitOf(ev.uid); if(!p) return 0;
  const r=p.getBoundingClientRect();
  if(ev.t==='say'){ showBubble(L,ev,r); return FX_WAIT.say; }
  if(ev.t==='dmg'){ showDmg(L,ev,r); return FX_WAIT.dmg; }
  return 0;
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
function showDmg(L,ev,r){
  const n=document.createElement('div');
  n.className='dmgpop'+(ev.crit?' crit':'')+(ev.np?' np':'')+(ev.text?' miss':'');
  n.textContent=ev.text||ev.v;
  n.style.left=`${r.left+r.width/2+(Math.random()*24-12)}px`;
  n.style.top=`${r.top+r.height*.45}px`;
  L.appendChild(n);
  const svt=document.querySelector(`.svt[data-uid="${ev.uid}"]`);
  if(svt&&!ev.text){ svt.classList.remove('hit'); void svt.offsetWidth; svt.classList.add('hit'); }
  setTimeout(()=>n.remove(),1100);
}

// 宝具カットイン：キャラクター画像が横切り、宝具名を大きく表示
function showCutin(L,ev){
  const u=U(ev.uid); if(!u) return;
  const d=D(u.def);
  const c=document.createElement('div');
  c.className=`cutin ${esc(ev.col||'R')}`;
  c.innerHTML=`<div class="ci-band"><div class="ci-lines"></div>
    ${imgTag(imgSrc(d,'face'),IMG_PLACEHOLDER.face,'ci-img',d.name)}
    <div class="ci-text"><small>${TERMS.ult} ・ ${esc(TERMS[ev.col]||'')}</small><b>${esc(ev.title)}</b><span>${clsIconTag(d.cls,'ci-cls')}${esc(d.name)}</span></div></div>`;
  L.appendChild(c);
  setTimeout(()=>c.remove(),FX_WAIT.cutin);
}
