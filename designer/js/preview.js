/* Animated preview: front disc + flipped back disc counter-rotating.
 * Modes: constant, yoyo (ramp up, hold, ramp down, pause, reverse), pendulum (sine).
 */
(function () {
  const { S } = WS;
  const P = {};
  const TAU = Math.PI * 2;
  const targets = []; // {canvas, ctx}
  let bitmaps = { key: '', front: null, back: null, size: 0, scale: 1 };
  let last = 0;
  let graph = null;

  const ease = (x) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, x)))) / 2;

  // velocity in deg/s at time t (seconds)
  P.velocity = (t, a = S.anim) => {
    if (a.mode === 'constant') return a.speed;
    if (a.mode === 'sine') return a.speed * Math.sin((TAU * t) / Math.max(0.1, a.period));
    const ramp = Math.max(0, a.ramp), hold = Math.max(0, a.hold), pause = Math.max(0, a.pause);
    const half = 2 * ramp + hold + pause;
    if (half <= 0) return a.speed;
    let u = t % (2 * half);
    let dir = 1;
    if (u >= half) { u -= half; dir = -1; }
    let v;
    if (u < ramp) v = ease(u / ramp);
    else if (u < ramp + hold) v = 1;
    else if (u < 2 * ramp + hold) v = ramp > 0 ? ease(1 - (u - ramp - hold) / ramp) : 0;
    else v = 0;
    return dir * a.speed * v;
  };

  P.cycleLength = (a = S.anim) => {
    if (a.mode === 'sine') return Math.max(0.1, a.period);
    if (a.mode === 'constant') return 0;
    return 2 * (2 * a.ramp + a.hold + a.pause);
  };

  P.addTarget = (canvas) => {
    const t = { canvas, ctx: canvas.getContext('2d') };
    targets.push(t);
    const ro = new ResizeObserver(() => sizeTarget(t));
    ro.observe(canvas.parentElement);
    sizeTarget(t);
  };

  P.setGraph = (canvas) => { graph = { canvas, ctx: canvas.getContext('2d') }; };

  function sizeTarget(t) {
    const r = t.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    t.w = r.width; t.h = r.height; t.dpr = dpr;
    t.canvas.width = Math.max(1, Math.round(r.width * dpr));
    t.canvas.height = Math.max(1, Math.round(r.height * dpr));
    t.canvas.style.width = r.width + 'px';
    t.canvas.style.height = r.height + 'px';
  }

  function ensureBitmaps(sizePx) {
    const c = S.design.colors;
    const key = [S.version, sizePx, c.front, c.back].join('|');
    if (bitmaps.key === key) return bitmaps;
    const ext = Math.max(S.design.disc.diameter / 2, R.extent(S.design)) * 1.02;
    const scale = sizePx / (2 * ext);
    const make = (color) => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = sizePx;
      const x = cv.getContext('2d');
      x.setTransform(scale, 0, 0, scale, sizePx / 2, sizePx / 2);
      R.paintDisc(x, S.design, color);
      return cv;
    };
    bitmaps = { key, front: make(c.front), back: make(c.back), size: sizePx, ext };
    return bitmaps;
  }

  function drawTarget(t) {
    if (!t.canvas.offsetParent || !t.w) return; // hidden
    const ctx = t.ctx, dpr = t.dpr;
    const W = t.canvas.width, H = t.canvas.height;
    const fitPx = Math.min(W, H) * 0.94;
    const bm = ensureBitmaps(Math.min(2400, Math.ceil(fitPx / 64) * 64));
    const a = S.anim;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = S.design.colors.wall;
    ctx.fillRect(0, 0, W, H);
    const draw = (img, angleDeg, flip) => {
      ctx.save();
      ctx.translate(W / 2, H / 2);
      if (a.shadow) {
        ctx.shadowColor = 'rgba(0,0,0,0.35)';
        ctx.shadowBlur = 10 * dpr;
        ctx.shadowOffsetX = 3 * dpr;
        ctx.shadowOffsetY = 7 * dpr;
      }
      ctx.rotate((angleDeg * Math.PI) / 180);
      if (flip) ctx.scale(1, -1);
      ctx.drawImage(img, -fitPx / 2, -fitPx / 2, fitPx, fitPx);
      ctx.restore();
    };
    if (a.showBack) draw(bm.back, -a.angle + a.offset, true);
    if (a.showFront) draw(bm.front, a.angle, false);
    // axle nut
    const pxPerMM = fitPx / (2 * bm.ext);
    const r = Math.max(3 * dpr, (S.design.disc.holeDiameter / 2 + 3) * pxPerMM);
    ctx.fillStyle = '#9aa0a6';
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = dpr;
    ctx.beginPath(); ctx.arc(W / 2, H / 2, r, 0, TAU); ctx.fill(); ctx.stroke();
  }

  function drawGraph() {
    if (!graph || !graph.canvas.offsetParent) return;
    const c = graph.canvas, ctx = graph.ctx;
    const dpr = window.devicePixelRatio || 1;
    const r = c.getBoundingClientRect();
    if (c.width !== Math.round(r.width * dpr)) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); }
    const W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    const a = S.anim;
    const span = a.mode === 'constant' ? 10 : P.cycleLength();
    const maxV = Math.max(1, Math.abs(a.speed));
    ctx.strokeStyle = 'rgba(148,163,184,0.35)';
    ctx.lineWidth = dpr;
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 2) {
      const v = P.velocity((x / W) * span);
      const y = H / 2 - (v / maxV) * (H / 2 - 3 * dpr);
      x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    const tx = ((a.t % span) / span) * W;
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(tx, H / 2 - (a.velocity / maxV) * (H / 2 - 3 * dpr), 3.5 * dpr, 0, TAU);
    ctx.fill();
  }

  function frame(now) {
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    const a = S.anim;
    if (a.playing) {
      a.t += dt;
      a.velocity = P.velocity(a.t);
      a.angle = (a.angle + a.velocity * dt) % 360;
      WS.emit('anim');
    }
    for (const t of targets) drawTarget(t);
    drawGraph();
    requestAnimationFrame(frame);
  }

  P.reset = () => {
    S.anim.t = 0;
    S.anim.angle = 0;
    S.anim.velocity = 0;
    WS.emit('anim');
  };

  // Render a still image of the current preview (for PNG export)
  P.renderStill = (sizePx) => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = sizePx;
    const t = { canvas: cv, ctx: cv.getContext('2d'), w: sizePx, h: sizePx, dpr: sizePx / 600 };
    // drawTarget checks offsetParent; draw directly
    const saved = bitmaps; bitmaps = { key: '' };
    Object.defineProperty(cv, 'offsetParent', { value: document.body });
    drawTarget(t);
    bitmaps = saved;
    return cv;
  };

  P.start = () => requestAnimationFrame(frame);

  window.Preview = P;
})();
