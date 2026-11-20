/* Shared disc painting + cut-outline extraction.
 *
 * The cut outline (the union of hub + all arms + rim, minus holes) is computed by
 * painting the disc at high resolution and tracing the boundary with marching
 * squares (sub-pixel interpolated on the anti-aliased edge). This keeps the
 * exported geometry identical to what is shown on screen and needs no library.
 */
(function () {
  const { S } = WS;
  const R = {};
  const TAU = Math.PI * 2;

  let cache = { version: -1, items: [] };

  R.getCache = () => {
    if (cache.version === S.version) return cache;
    const items = S.design.shapes.map((s) => {
      const d = G.shapePathData(s);
      const md = s.mirror ? G.shapePathData(G.mirrorShape(s)) : '';
      return { id: s.id, cut: !!s.cut, d, md, path: new Path2D(d), mpath: md ? new Path2D(md) : null };
    });
    cache = { version: S.version, items };
    return cache;
  };

  R.spokes = (design) => Math.max(1, Math.min(72, Math.round(design.disc.spokes || 1)));
  // cutout shapes repeat around the centre on their own count, independent of the arm count
  R.cutRepeats = (design) => Math.max(1, Math.min(72, Math.round(design.disc.cutouts || 1)));
  R.repeatsFor = (design, it) => (it.cut ? R.cutRepeats(design) : R.spokes(design));

  // Paint a full disc into ctx (already transformed into disc space, mm).
  // Must be a dedicated layer: clip-to-disc and holes use compositing.
  // Fill style for a disc: a plain colour, or a radial gradient (inner colour -> outer colour)
  // centred on the axle, built in the ctx's current (disc-space, mm) transform.
  R.discFill = (ctx, design, which) => {
    const c = design.colors;
    const inner = which === 'back' ? c.back : c.front;
    if (!c.radial) return inner;
    const outer = which === 'back' ? c.backOuter : c.frontOuter;
    const rad = design.disc.diameter / 2;
    const reach = Math.max(rad, R.extent(design)) * 1.01;
    const split = (Math.max(0, Math.min(100, c.split)) / 100) * rad;
    const half = (Math.max(0, c.blend) / 100) * rad / 2;
    const clamp = (v) => Math.max(0, Math.min(1, v / reach));
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, reach);
    g.addColorStop(0, inner);
    g.addColorStop(clamp(split - half), inner);
    g.addColorStop(Math.max(clamp(split - half), clamp(split + half)), outer);
    g.addColorStop(1, outer);
    return g;
  };

  // color: a CSS colour, or 'front' / 'back' to use the design's (possibly radial) disc colour.
  R.paintDisc = (ctx, design, color, opts = {}) => {
    if (color === 'front' || color === 'back') color = R.discFill(ctx, design, color);
    const c = R.getCache();
    const d = design.disc;
    const N = R.spokes(design);
    const rad = d.diameter / 2;
    ctx.save();
    ctx.fillStyle = color;
    for (let k = 0; k < N; k++) {
      ctx.save();
      ctx.rotate((k * TAU) / N);
      ctx.globalAlpha = opts.ghostOthers && k > 0 ? 0.28 : 1;
      for (const it of c.items) {
        if (it.cut) continue;
        ctx.fill(it.path);
        if (it.mpath) ctx.fill(it.mpath);
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    if (d.hubDiameter > 0) {
      ctx.beginPath();
      ctx.arc(0, 0, d.hubDiameter / 2, 0, TAU);
      ctx.fill();
    }
    if (d.rimWidth > 0) {
      ctx.beginPath();
      ctx.arc(0, 0, rad, 0, TAU);
      ctx.arc(0, 0, Math.max(0, rad - d.rimWidth), 0, TAU, true);
      ctx.fill('evenodd');
    }
    if (d.clipToDisc) {
      ctx.globalCompositeOperation = 'destination-in';
      ctx.beginPath();
      ctx.arc(0, 0, rad, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    const cuts = c.items.filter((it) => it.cut);
    if (cuts.length) {
      const M = R.cutRepeats(design);
      for (let k = 0; k < M; k++) {
        ctx.save();
        ctx.rotate((k * TAU) / M);
        for (const it of cuts) {
          ctx.fill(it.path);
          if (it.mpath) ctx.fill(it.mpath);
        }
        ctx.restore();
      }
    }
    for (const h of R.holes(design)) {
      ctx.beginPath();
      ctx.arc(h.x, h.y, h.r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  };

  R.holes = (design) => {
    const d = design.disc;
    const out = [];
    if (d.holeDiameter > 0) out.push({ x: 0, y: 0, r: d.holeDiameter / 2 });
    const n = Math.round(d.boltCount || 0);
    if (n > 0 && d.boltDiameter > 0) {
      for (let i = 0; i < n; i++) {
        const p = G.polar(d.boltCircle / 2, (360 * i) / n);
        out.push({ x: p.x, y: p.y, r: d.boltDiameter / 2 });
      }
    }
    return out;
  };

  // Max radius reached by any geometry (conservative), mm
  R.extent = (design) => {
    const d = design.disc;
    let m = Math.max(d.hubDiameter / 2, d.rimWidth > 0 ? d.diameter / 2 : 0, 10);
    for (const s of design.shapes) {
      for (const n of s.nodes) {
        const hw = s.type === 'stroke' ? (n.w || 0) / 2 : 0;
        m = Math.max(m, Math.hypot(n.x, n.y) + hw);
        for (const h of [n.hi, n.ho]) if (h) m = Math.max(m, Math.hypot(n.x + h.x, n.y + h.y) + hw);
      }
    }
    if (d.clipToDisc) m = Math.min(m, d.diameter / 2);
    return m;
  };

  // ---------- cut outline tracing ----------
  // returns { loops:[{pts, area, outer, length, parent}], pieces, holes, cutLength, area, res }
  R.traceCut = (design, res) => {
    const ext = R.extent(design) + 3;
    let px = res || 0.1;
    if ((2 * ext) / px > 7000) px = (2 * ext) / 7000;
    const W = Math.ceil((2 * ext) / px) + 4;
    const H = W;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.setTransform(1 / px, 0, 0, 1 / px, W / 2, H / 2);
    R.paintDisc(ctx, design, '#000');
    const data = ctx.getImageData(0, 0, W, H).data;
    cv.width = cv.height = 1; // free memory

    const thr = 127.5;
    const a = (i, j) => data[(j * W + i) * 4 + 3];
    const pts = new Map(); // edgeKey -> {x,y} (sample space)
    const next = new Map(); // startKey -> endKey
    const hKey = (i, j) => (j * W + i) * 2;
    const vKey = (i, j) => (j * W + i) * 2 + 1;

    const cornerX = [0, 1, 1, 0], cornerY = [0, 0, 1, 1];
    const vals = [0, 0, 0, 0], ins = [false, false, false, false], keys = [0, 0, 0, 0];

    const edgePoint = (k, i, j) => {
      const key = keys[k];
      let p = pts.get(key);
      if (p) return p;
      const k2 = (k + 1) & 3;
      const v1 = vals[k], v2 = vals[k2];
      const t = v2 === v1 ? 0.5 : (thr - v1) / (v2 - v1);
      p = {
        x: i + cornerX[k] + (cornerX[k2] - cornerX[k]) * t,
        y: j + cornerY[k] + (cornerY[k2] - cornerY[k]) * t,
      };
      pts.set(key, p);
      return p;
    };

    const addSeg = (eA, eB, refK, refInside, i, j) => {
      const A = edgePoint(eA, i, j), B = edgePoint(eB, i, j);
      const cx = i + cornerX[refK], cy = j + cornerY[refK];
      const cr = (B.x - A.x) * (cy - A.y) - (B.y - A.y) * (cx - A.x);
      if ((refInside && cr < 0) || (!refInside && cr > 0)) next.set(keys[eB], keys[eA]);
      else next.set(keys[eA], keys[eB]);
    };

    for (let j = 0; j < H - 1; j++) {
      for (let i = 0; i < W - 1; i++) {
        const tl = a(i, j), tr = a(i + 1, j), br = a(i + 1, j + 1), bl = a(i, j + 1);
        const c = (tl > thr ? 8 : 0) | (tr > thr ? 4 : 0) | (br > thr ? 2 : 0) | (bl > thr ? 1 : 0);
        if (c === 0 || c === 15) continue;
        vals[0] = tl; vals[1] = tr; vals[2] = br; vals[3] = bl;
        ins[0] = tl > thr; ins[1] = tr > thr; ins[2] = br > thr; ins[3] = bl > thr;
        keys[0] = hKey(i, j); keys[1] = vKey(i + 1, j); keys[2] = hKey(i, j + 1); keys[3] = vKey(i, j);
        if (c === 5 || c === 10) {
          const center = (tl + tr + br + bl) / 4 > thr;
          for (let k = 0; k < 4; k++) {
            if (ins[k] === !center) addSeg((k + 3) & 3, k, k, ins[k], i, j);
          }
        } else {
          const cross = [];
          for (let k = 0; k < 4; k++) if (ins[k] !== ins[(k + 1) & 3]) cross.push(k);
          let ref = 0;
          while (!ins[ref]) ref++;
          addSeg(cross[0], cross[1], ref, true, i, j);
        }
      }
    }

    // link into loops
    const visited = new Set();
    const loops = [];
    const toMM = (p) => ({ x: (p.x + 0.5 - W / 2) * px, y: (p.y + 0.5 - H / 2) * px });
    for (const start of next.keys()) {
      if (visited.has(start)) continue;
      const loop = [];
      let k = start;
      let guard = 0;
      while (k !== undefined && !visited.has(k) && guard++ < 5e6) {
        visited.add(k);
        loop.push(toMM(pts.get(k)));
        k = next.get(k);
      }
      if (loop.length >= 3) loops.push(loop);
    }

    // simplify
    const eps = px * 0.3;
    const simplified = loops
      .map((loop) => G.simplifyClosed(loop, eps))
      .filter((l) => l.length >= 3);

    const info = simplified.map((p) => ({ pts: p, area: G.polyArea(p), length: G.polyLength(p) }));
    info.sort((x, y) => Math.abs(y.area) - Math.abs(x.area));
    const outerSign = info.length ? Math.sign(info[0].area) : 1;
    info.forEach((l) => (l.outer = Math.sign(l.area) === outerSign));
    const outers = info.filter((l) => l.outer);
    for (const l of info) {
      if (l.outer) continue;
      let best = null;
      for (const o of outers) {
        if (Math.abs(o.area) > Math.abs(l.area) && G.pointInPoly(l.pts[0], o.pts)) {
          if (!best || Math.abs(o.area) < Math.abs(best.area)) best = o;
        }
      }
      l.parent = best;
    }
    const area = info.reduce((s, l) => s + (l.outer ? 1 : -1) * Math.abs(l.area), 0);
    return {
      loops: info,
      pieces: outers.length,
      holes: info.length - outers.length,
      cutLength: info.reduce((s, l) => s + l.length, 0),
      area,
      res: px,
    };
  };

  R.loopsPathData = (loops, dx = 0, dy = 0, flipY = false) =>
    loops
      .map(
        (l) =>
          'M' +
          l.pts
            .map((p) => `${(p.x + dx).toFixed(3)} ${((flipY ? -p.y : p.y) + dy).toFixed(3)}`)
            .join('L') +
          'Z'
      )
      .join('');

  window.R = R;
})();
