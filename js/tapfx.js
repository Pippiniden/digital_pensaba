/* タップ時プリズムエフェクト。pointerdown の位置にダイヤ型の輪郭パーティクルを出す（DOM + CSS Animation）。
   既存のクリック処理には触れない（capture で見るだけ）。CSS は css/tapfx.css */
const EFFECT_CONFIG = {
  count: 3,        // 粒子数
  groups: 3,       // 方向グループ数（粒子はグループに順に割り振る）
  size: 16,        // 大きさ px
  stroke: 2.5,     // 輪郭の太さ px
  distance: 18,    // 飛散距離 px
  duration: 1000,  // 表示時間 ms
  opacity: 0.33,   // 最大不透明度
  sat: 100,        // 彩度 %
  light: 78,       // 明度 %
  baseAngle: 90,   // 中心方向（度。画面座標でY+が下なので90=真下）
  spread: 130,     // グループ間の開き（度）。groups=2 なら 90±65
  jitter: 59,      // 基準角度からのランダム差（±度）
  randomize: 0.5, // サイズ・距離・時間の±ランダム補正の割合
  hueMin: 0,       // 色相の範囲（度）
  hueMax: 360,
  spin: 154,      // 回転量（±度）
  glow: 5,         // 発光の広がり px（0で発光なし）
  highlight: 1     // 内側の白い細線 1=あり 0=なし
};

(function () {
  let box = null;
  function container() {
    if (box && box.isConnected) return box;
    box = document.createElement('div');
    box.id = 'tapfx';
    box.setAttribute('aria-hidden', 'true');
    document.body.appendChild(box);
    return box;
  }
  const rnd = (a, b) => a + Math.random() * (b - a);
  const vary = v => v * (1 + rnd(-EFFECT_CONFIG.randomize, EFFECT_CONFIG.randomize));

  function spawn(cx, cy) {
    const C = EFFECT_CONFIG, host = container();
    const r = host.getBoundingClientRect();
    const x = cx - r.left, y = cy - r.top;
    const g = Math.max(1, C.groups);
    for (let i = 0; i < C.count; i++) {
      const gi = i % g;
      const center = g === 1 ? C.baseAngle : C.baseAngle - C.spread / 2 + C.spread * gi / (g - 1);
      const ang = (center + rnd(-C.jitter, C.jitter)) * Math.PI / 180;
      const dist = vary(C.distance);
      const p = document.createElement('div');
      p.className = 'tapfx-p';
      const s = p.style;
      s.left = x + 'px';
      s.top = y + 'px';
      s.setProperty('--size', vary(C.size).toFixed(1) + 'px');
      s.setProperty('--stroke', C.stroke + 'px');
      s.setProperty('--color', `hsl(${Math.floor(rnd(C.hueMin, C.hueMax))},${C.sat}%,${C.light}%)`);
      s.setProperty('--dx', (Math.cos(ang) * dist).toFixed(1) + 'px');
      s.setProperty('--dy', (Math.sin(ang) * dist).toFixed(1) + 'px');
      s.setProperty('--spin', rnd(-C.spin, C.spin).toFixed(0) + 'deg');
      s.setProperty('--glow', C.glow + 'px');
      s.setProperty('--hl', C.highlight ? 1 : 0);
      s.setProperty('--duration', Math.round(vary(C.duration)) + 'ms');
      s.setProperty('--alpha', C.opacity);
      p.addEventListener('animationend', e => { if (e.animationName === 'tapfx-fade') p.remove(); });
      host.appendChild(p);
    }
  }

  document.addEventListener('pointerdown', e => {
    if (e.button > 0) return; // 左クリック・タッチ・ペンのみ
    spawn(e.clientX, e.clientY);
  }, true);
  window.tapfxSpawn = spawn;
})();
