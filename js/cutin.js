'use strict';
/* =====================================================================
   宝具カットイン（ゲームの演出とエディタのプレビューで共用）
   - cutinStageHTML(d, ult, {hold}) … 16:9 ステージの HTML（見た目は css/cutin.css）
   - cutinLayout(stage, ult)        … ルビ・宝具名を入れて、幅に収まるよう配置する（DOM に入れてから呼ぶ）
   - cutinIssues(r, ult)            … cutinLayout の結果から、エディタに出す注意文
   ult = {name, ruby?, br?, c}。br = カットインでの改行位置（エディタで指定）
     undefined … 自動（1行で縮める / 2行に折り返す のうち文字が大きく見える方。区切り文字か真ん中で改行）
     0         … 1行固定
     n (>0)    … n文字目の後ろで改行（2行固定）
   試作・調整用: docs/cutin-np-sample.html
   ===================================================================== */
const CUTIN_MS = 2600;           // カットイン全体の長さ(ms)。ドリフトの終点もここ
const CUTIN_NAME = {
  minX: .5,      // 宝具名を横だけで詰める限界（これより細くなるなら縦も縮める）
  rubyMinX: .7,  // ルビの同じ限界
  twoH: 1.15,    // 2行のときの高さ上限（1行の文字の高さに対する倍率。少しだけルビ側にはみ出してよい）
  twoPref: .7,   // 自動のとき: 2行案の文字が1行案のこの倍以上の大きさなら2行にする
};

// 稲妻を揺らす SVG フィルタ（CSS だけでは作れない）。ページに1回だけ差し込む
function cutinZap(){
  if(document.getElementById('ct-zap')) return;
  const s=document.createElementNS('http://www.w3.org/2000/svg','svg');
  s.setAttribute('width','0'); s.setAttribute('height','0'); s.setAttribute('aria-hidden','true');
  s.style.position='absolute';
  s.innerHTML=`<filter id="ct-zap" x="-5%" y="-200%" width="110%" height="500%">
    <feTurbulence type="fractalNoise" baseFrequency=".012 .35" numOctaves="2" seed="4">
      <animate attributeName="seed" values="1;2;3;4;5;6" dur=".4s" repeatCount="indefinite"/></feTurbulence>
    <feDisplacementMap in="SourceGraphic" scale="14" yChannelSelector="G"/></filter>`;
  document.body.appendChild(s);
}

function cutinStageHTML(d,ult,o={}){
  cutinZap();
  // CSS 変数に入れた url() は「使った CSS ファイル」基準で解決されるので、絶対 URL にしておく
  const f=(d.fit&&d.fit.np)||FIT_DEF.np, ch=(d.fit&&d.fit.cut)||FIT_DEF.cut, img=new URL(imgCandidates(d,'face')[0],document.baseURI).href;
  const col=['R','B','G'].includes(ult.c)?ult.c:'R';
  return `<div class="ct ${col}${o.hold?' hold':''}" style="--img:url('${esc(img)}');--pimg:url('${esc(new URL(UI_IMG.cutinParticles,document.baseURI).href)}');--gx:${f.x}%;--gy:${f.y}%;--gz:${f.z}%;--cx:${ch.x};--cy:${ch.y};--cz:${ch.z};--T:${CUTIN_MS}ms">
    <div class="ct-band mv">
      <div class="ct-fill"><div class="ct-pimg"></div><div class="ct-ghost mv"></div></div>
      <div class="ct-edge top"></div>
      <div class="ct-strip mv"><div class="ct-title">
        <div class="ct-line ct-ruby mv"></div>
        <div class="ct-line ct-name mv"></div>
      </div></div>
      <div class="ct-edge bot"></div>
    </div>
    <div class="ct-chara mv"></div>
    <div class="ct-lb t"></div><div class="ct-lb b"></div>
    <div class="ct-top"><span class="mv">${esc(TERMS.ult)}発動</span></div>
    <div class="ct-flash"></div>
  </div>`;
}

/* ---- 宝具名の配置 ---- */
const CT_CV=(typeof document!=='undefined')?document.createElement('canvas').getContext('2d'):null;
function ctFont(el){ const cs=getComputedStyle(el); CT_CV.font=`${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; }
// 文字の実際の上端・下端（要素の上からの px）をフォントの寸法から求める
function ctGlyph(el,text){
  ctFont(el);
  const m=CT_CV.measureText(text||'あ'), L=el.clientHeight;
  const base=(L-(m.fontBoundingBoxAscent+m.fontBoundingBoxDescent))/2+m.fontBoundingBoxAscent;
  return {top:base-m.actualBoundingBoxAscent, bottom:base+m.actualBoundingBoxDescent};
}
// 自動改行の位置: 真ん中に近い区切り文字（・ や空白など）の後ろ。無ければ真ん中
function ctSplit(t){
  const a=[...t], mid=a.length/2;
  let best=Math.round(mid), bd=1e9;
  a.forEach((c,i)=>{ if(/[・･　 、,／\/〜~＝=]/.test(c)){ const d=Math.abs(i+1-mid); if(d<bd&&d<=a.length*.25){ bd=d; best=i+1; } } });
  return [a.slice(0,best).join('').trim(), a.slice(best).join('').trim()];
}
const CT_RESET=/(white-space|line-height|height|transform|transform-origin)[^;]*;?/g;
/* 1行（ルビ）を幅に収める。文字サイズは変えず transform の scale だけで縮める（基準点 = 文字の左下）。戻り値 = 縦の縮み率 */
function ctFitLine(el,minX){
  el.style.cssText=el.style.cssText.replace(CT_RESET,'');
  const maxW=el.parentNode.clientWidth-el.offsetLeft, w=el.scrollWidth, g=ctGlyph(el,el.textContent);
  el.style.transformOrigin=`left ${g.bottom}px`;
  if(w<=maxW) return 1;
  const sx=maxW/w, sy=Math.min(1,sx/minX);
  el.style.transform=`scale(${sx},${sy})`;
  return sy;
}
/* 宝具名を入れる。1行で縮める / 2行に折り返す のどちらでも「文字の下端」は同じ位置。
   戻り値 {lines: 実際の行, sy: 縦の縮み率（2行のときは 2行の標準サイズに対する率）, auto: 自動で決めたか} */
function ctLayoutName(el,text,br){
  el.style.cssText=el.style.cssText.replace(CT_RESET,'');
  el.textContent=text;
  const N=CUTIN_NAME, chars=[...text];
  const g0=ctGlyph(el,text), h0=el.clientHeight, maxW=el.parentNode.clientWidth-el.offsetLeft;
  const forceTwo=br>0&&br<chars.length, forceOne=br===0;
  const w1=el.scrollWidth, sx1=Math.min(1,maxW/w1), sy1=Math.min(1,sx1/N.minX);
  let two=null;
  if(forceTwo||(!forceOne&&sy1<1&&chars.length>=8)){
    const fs=parseFloat(getComputedStyle(el).fontSize), lh=fs*1.08;
    const [l1,l2]=forceTwo?[chars.slice(0,br).join('').trim(),chars.slice(br).join('').trim()]:ctSplit(text);
    el.textContent=l1+'\n'+l2;
    el.style.whiteSpace='pre'; el.style.lineHeight=lh+'px';
    ctFont(el);
    const m1=CT_CV.measureText(l1), m2=CT_CV.measureText(l2);
    const base=i=>i*lh+(lh-(m1.fontBoundingBoxAscent+m1.fontBoundingBoxDescent))/2+m1.fontBoundingBoxAscent;
    const g={top:base(0)-m1.actualBoundingBoxAscent, bottom:base(1)+m2.actualBoundingBoxDescent};
    el.style.height=(g.bottom+fs*.12)+'px';
    const w2=el.scrollWidth, uh=N.twoH*(g0.bottom-g0.top)/(g.bottom-g.top);
    const u=Math.min(uh,maxW/w2/N.minX), sx=Math.min(u,maxW/w2);
    two={u,uh,sx,g,lines:[l1,l2]};
    if(!forceTwo&&u<sy1*N.twoPref){ two=null; el.style.cssText=el.style.cssText.replace(CT_RESET,''); el.textContent=text; }
  }
  const sx=two?two.sx:sx1, sy=two?two.u:sy1, g=two?two.g:g0;
  el.style.transformOrigin=`left ${g.bottom}px`;
  if(sx<1||sy<1) el.style.transform=`scale(${sx},${sy})`;
  // ルビ位置: 見た目の文字の上端が、1行・等倍のときより動いた分だけルビも動かす（要素が高くなった分はルビが自動で上がる）
  const h=el.clientHeight, visTop=(h0-h)+g.bottom-(g.bottom-g.top)*sy;
  return {lines:two?two.lines:[text], sy:two?two.u/two.uh:sy, auto:br==null, drop:visTop-g0.top+(h-h0)};
}
function cutinLayout(stage,ult){
  const ru=stage.querySelector('.ct-ruby'), nm=stage.querySelector('.ct-name');
  ru.textContent=ult.ruby||'';
  const r=ctLayoutName(nm,ult.name||'',ult.br);
  stage.querySelector('.ct-title').style.setProperty('--drop',r.drop.toFixed(1)+'px');
  r.rubySy=ult.ruby?ctFitLine(ru,CUTIN_NAME.rubyMinX):1;
  return r;
}
// フォントの読み込みが終わってから測り直す（読み込み前は代わりのフォントで測ってしまうため）
function cutinLayoutWhenReady(stage,ult){
  const r=cutinLayout(stage,ult);
  if(document.fonts&&document.fonts.status!=='loaded') document.fonts.ready.then(()=>{ if(stage.isConnected) cutinLayout(stage,ult); });
  return r;
}
// エディタ用の注意文
function cutinIssues(r,ult){
  const w=[], pct=x=>Math.round(x*100);
  if(r.sy<.97) w.push(r.lines.length===1
    ? `1行に収まりきらず、宝具名が ${pct(r.sy)}% に縮みます。改行位置を指定してください`
    : `この改行位置では1行が長すぎて、宝具名が ${pct(r.sy)}% に縮みます。改行位置を変えるか、名前を短くしてください`);
  if(r.lines.length===2&&r.auto) w.push(`自動で「${r.lines[0]}／${r.lines[1]}」と改行して表示します。意図と違うときは改行位置を指定してください`);
  if(r.rubySy<.97) w.push(`ルビが長すぎて ${pct(r.rubySy)}% に縮みます`);
  return w;
}
