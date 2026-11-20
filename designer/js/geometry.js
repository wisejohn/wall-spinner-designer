/* Geometry helpers: vectors, cubic beziers, shape -> outline conversion.
 * Coordinate system: millimetres, origin at disc centre, +y points DOWN (screen style).
 * The "master arm" is drawn pointing up (towards -y, 12 o'clock).
 */
(function () {
  const G = {};

  G.add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
  G.sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
  G.mul = (a, s) => ({ x: a.x * s, y: a.y * s });
  G.len = (a) => Math.hypot(a.x, a.y);
  G.dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  G.dot = (a, b) => a.x * b.x + a.y * b.y;
  G.norm = (a) => {
    const l = Math.hypot(a.x, a.y);
    return l > 1e-12 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
  };
  G.lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  G.rotate = (p, ang) => {
    const c = Math.cos(ang), s = Math.sin(ang);
    return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
  };
  G.polar = (r, degFromUp) => {
    // angle measured clockwise from 12 o'clock (screen coords)
    const a = (degFromUp * Math.PI) / 180;
    return { x: r * Math.sin(a), y: -r * Math.cos(a) };
  };

  G.bez = (p0, c1, c2, p3, t) => {
    const u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return { x: a * p0.x + b * c1.x + c * c2.x + d * p3.x, y: a * p0.y + b * c1.y + c * c2.y + d * p3.y };
  };

  // de Casteljau split
  G.split = (p0, c1, c2, p3, t) => {
    const a = G.lerp(p0, c1, t), b = G.lerp(c1, c2, t), c = G.lerp(c2, p3, t);
    const d = G.lerp(a, b, t), e = G.lerp(b, c, t);
    const f = G.lerp(d, e, t);
    return { left: [p0, a, d, f], right: [f, e, c, p3] };
  };

  // ---------- nodes / segments ----------
  G.cloneNode = (n) => ({
    x: n.x, y: n.y,
    hi: n.hi ? { x: n.hi.x, y: n.hi.y } : null,
    ho: n.ho ? { x: n.ho.x, y: n.ho.y } : null,
    smooth: !!n.smooth,
    w: n.w,
  });

  G.cloneShape = (s) => JSON.parse(JSON.stringify(s));

  G.segments = (shape) => {
    const n = shape.nodes;
    const segs = [];
    if (!n || n.length < 2) return segs;
    const cnt = shape.closed ? n.length : n.length - 1;
    for (let i = 0; i < cnt; i++) {
      const j = (i + 1) % n.length;
      const a = n[i], b = n[j];
      segs.push({
        i, j,
        p0: { x: a.x, y: a.y },
        c1: { x: a.x + (a.ho ? a.ho.x : 0), y: a.y + (a.ho ? a.ho.y : 0) },
        c2: { x: b.x + (b.hi ? b.hi.x : 0), y: b.y + (b.hi ? b.hi.y : 0) },
        p3: { x: b.x, y: b.y },
        w0: a.w == null ? 10 : a.w,
        w1: b.w == null ? 10 : b.w,
      });
    }
    return segs;
  };

  const f = (v) => (Math.round(v * 1000) / 1000).toString();

  G.bezierPathData = (shape) => {
    const n = shape.nodes;
    if (!n || n.length < 2) return '';
    let d = `M${f(n[0].x)} ${f(n[0].y)}`;
    for (const s of G.segments(shape)) {
      d += `C${f(s.c1.x)} ${f(s.c1.y)} ${f(s.c2.x)} ${f(s.c2.y)} ${f(s.p3.x)} ${f(s.p3.y)}`;
    }
    if (shape.closed) d += 'Z';
    return d;
  };

  G.ringsPathData = (rings) =>
    rings
      .filter((r) => r.length >= 3)
      .map((r) => 'M' + r.map((p) => `${f(p.x)} ${f(p.y)}`).join('L') + 'Z')
      .join('');

  // Sample the spine of a shape: [{x,y,w}]
  G.flattenSpine = (shape, step = 0.75) => {
    const segs = G.segments(shape);
    const out = [];
    segs.forEach((s, si) => {
      const approx = G.dist(s.p0, s.c1) + G.dist(s.c1, s.c2) + G.dist(s.c2, s.p3);
      const steps = Math.max(2, Math.min(160, Math.ceil(approx / step)));
      for (let k = si === 0 ? 0 : 1; k <= steps; k++) {
        const t = k / steps;
        const p = G.bez(s.p0, s.c1, s.c2, s.p3, t);
        p.w = s.w0 + (s.w1 - s.w0) * t;
        out.push(p);
      }
    });
    if (shape.closed && out.length > 1 && G.dist(out[0], out[out.length - 1]) < 1e-6) out.pop();
    // remove near-duplicates
    const clean = [];
    for (const p of out) {
      if (!clean.length || G.dist(clean[clean.length - 1], p) > 1e-4) clean.push(p);
    }
    return clean;
  };

  // Convert a variable-width stroke shape into one or two closed rings.
  G.strokeRings = (shape) => {
    const pts = G.flattenSpine(shape);
    const n = pts.length;
    if (n < 2) return [];
    const closed = !!shape.closed;
    const left = [], right = [], tans = [];
    for (let i = 0; i < n; i++) {
      const prev = closed ? pts[(i - 1 + n) % n] : pts[Math.max(i - 1, 0)];
      const next = closed ? pts[(i + 1) % n] : pts[Math.min(i + 1, n - 1)];
      let t = G.norm(G.sub(next, prev));
      if (t.x === 0 && t.y === 0) t = tans[i - 1] || { x: 0, y: -1 };
      tans.push(t);
      const nrm = { x: -t.y, y: t.x };
      const hw = Math.max(0.05, pts[i].w / 2);
      left.push({ x: pts[i].x + nrm.x * hw, y: pts[i].y + nrm.y * hw });
      right.push({ x: pts[i].x - nrm.x * hw, y: pts[i].y - nrm.y * hw });
    }
    if (closed) return [left, right.reverse()];

    const cap = shape.cap || 'round';
    const ring = left.slice();
    const capPts = (p, t, hw, isEnd) => {
      const res = [];
      const nrm = { x: -t.y, y: t.x };
      if (cap === 'round') {
        const m = Math.max(6, Math.min(32, Math.ceil(hw * 1.5)));
        const a0 = Math.atan2(t.y, t.x);
        for (let k = 1; k < m; k++) {
          // end: from +normal through +tangent to -normal ; start: from -normal through -tangent to +normal
          const a = isEnd ? a0 + Math.PI / 2 - (Math.PI * k) / m : a0 - Math.PI / 2 - (Math.PI * k) / m;
          res.push({ x: p.x + Math.cos(a) * hw, y: p.y + Math.sin(a) * hw });
        }
      } else if (cap === 'square') {
        const s = isEnd ? 1 : -1;
        const e = { x: p.x + t.x * hw * s, y: p.y + t.y * hw * s };
        if (isEnd) {
          res.push({ x: e.x + nrm.x * hw, y: e.y + nrm.y * hw }, { x: e.x - nrm.x * hw, y: e.y - nrm.y * hw });
        } else {
          res.push({ x: e.x - nrm.x * hw, y: e.y - nrm.y * hw }, { x: e.x + nrm.x * hw, y: e.y + nrm.y * hw });
        }
      }
      return res;
    };
    ring.push(...capPts(pts[n - 1], tans[n - 1], pts[n - 1].w / 2, true));
    for (let i = n - 1; i >= 0; i--) ring.push(right[i]);
    ring.push(...capPts(pts[0], tans[0], pts[0].w / 2, false));
    return [ring];
  };

  G.mirrorShape = (shape) => {
    const m = (h) => (h ? { x: -h.x, y: h.y } : null);
    const nodes = shape.nodes
      .slice()
      .reverse()
      .map((n) => ({ x: -n.x, y: n.y, hi: m(n.ho), ho: m(n.hi), smooth: n.smooth, w: n.w }));
    return Object.assign({}, shape, { nodes, mirror: false });
  };

  // SVG path data for a single shape (no mirror)
  G.shapePathData = (shape) => {
    if (shape.type === 'stroke') return G.ringsPathData(G.strokeRings(shape));
    return G.bezierPathData(Object.assign({}, shape, { closed: true }));
  };

  // All path data generated by a shape (including mirrored copy)
  G.shapeAllPathData = (shape) => {
    const out = [G.shapePathData(shape)];
    if (shape.mirror) out.push(G.shapePathData(G.mirrorShape(shape)));
    return out.filter(Boolean);
  };

  // ---------- freehand helpers ----------
  G.rdp = (pts, eps) => {
    const n = pts.length;
    if (n < 3) return pts.map((_, i) => i);
    const keep = new Uint8Array(n);
    keep[0] = keep[n - 1] = 1;
    const stack = [[0, n - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      let maxD = 0, idx = -1;
      const A = pts[a], B = pts[b];
      const dx = B.x - A.x, dy = B.y - A.y;
      const L = Math.hypot(dx, dy) || 1e-9;
      for (let i = a + 1; i < b; i++) {
        const d = Math.abs((pts[i].x - A.x) * dy - (pts[i].y - A.y) * dx) / L;
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (maxD > eps && idx > 0) {
        keep[idx] = 1;
        stack.push([a, idx], [idx, b]);
      }
    }
    const res = [];
    for (let i = 0; i < n; i++) if (keep[i]) res.push(i);
    return res;
  };

  // RDP for a closed ring: split at the point farthest from the first so neither half is degenerate
  G.simplifyClosed = (loop, eps) => {
    const n = loop.length;
    if (n < 4) return loop.slice();
    let far = 1, fd = -1;
    for (let i = 1; i < n; i++) {
      const d = G.dist(loop[0], loop[i]);
      if (d > fd) { fd = d; far = i; }
    }
    const a = loop.slice(0, far + 1);
    const b = loop.slice(far).concat([loop[0]]);
    const ia = G.rdp(a, eps).map((i) => a[i]);
    const ib = G.rdp(b, eps).map((i) => b[i]);
    return ia.concat(ib.slice(1, -1));
  };

  // Give nodes smooth (Catmull-Rom-like, length-proportional) handles
  G.autoHandles = (nodes, closed, which) => {
    const n = nodes.length;
    const idxs = which != null ? [which] : nodes.map((_, i) => i);
    for (const i of idxs) {
      const p = nodes[i];
      const hasPrev = closed || i > 0, hasNext = closed || i < n - 1;
      const prev = hasPrev ? nodes[(i - 1 + n) % n] : null;
      const next = hasNext ? nodes[(i + 1) % n] : null;
      let t;
      if (prev && next) t = G.norm(G.sub(next, prev));
      else if (next) t = G.norm(G.sub(next, p));
      else if (prev) t = G.norm(G.sub(p, prev));
      else t = { x: 0, y: 0 };
      p.hi = prev ? G.mul(t, -G.dist(prev, p) / 3) : null;
      p.ho = next ? G.mul(t, G.dist(p, next) / 3) : null;
      p.smooth = true;
    }
    return nodes;
  };

  // nearest point on a shape's spine: {seg, t, d, p}
  G.nearestOnShape = (shape, q) => {
    let best = null;
    for (const s of G.segments(shape)) {
      const N = 40;
      for (let k = 0; k <= N; k++) {
        const t = k / N;
        const p = G.bez(s.p0, s.c1, s.c2, s.p3, t);
        const d = G.dist(p, q);
        if (!best || d < best.d) best = { seg: s, t, d, p };
      }
    }
    if (!best) return null;
    // refine
    let lo = Math.max(0, best.t - 1 / 40), hi = Math.min(1, best.t + 1 / 40);
    for (let it = 0; it < 20; it++) {
      const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
      const s = best.seg;
      const d1 = G.dist(G.bez(s.p0, s.c1, s.c2, s.p3, m1), q);
      const d2 = G.dist(G.bez(s.p0, s.c1, s.c2, s.p3, m2), q);
      if (d1 < d2) hi = m2; else lo = m1;
    }
    const t = (lo + hi) / 2, s = best.seg;
    const p = G.bez(s.p0, s.c1, s.c2, s.p3, t);
    return { seg: s, t, d: G.dist(p, q), p };
  };

  // Insert a node into shape at segment/t, preserving curve
  G.insertNode = (shape, seg, t) => {
    const { left, right } = G.split(seg.p0, seg.c1, seg.c2, seg.p3, t);
    const a = shape.nodes[seg.i], b = shape.nodes[seg.j];
    const mid = left[3];
    const isLine = !a.ho && !b.hi;
    a.ho = isLine ? null : G.sub(left[1], a);
    b.hi = isLine ? null : G.sub(right[2], b);
    const node = {
      x: mid.x, y: mid.y,
      hi: isLine ? null : G.sub(left[2], mid),
      ho: isLine ? null : G.sub(right[1], mid),
      smooth: !isLine,
      w: seg.w0 + (seg.w1 - seg.w0) * t,
    };
    shape.nodes.splice(seg.i + 1, 0, node);
    return seg.i + 1;
  };

  // Tangent direction at a node (for width handles)
  G.nodeTangent = (shape, i) => {
    const n = shape.nodes, p = n[i];
    if (p.ho && G.len(p.ho) > 1e-6) return G.norm(p.ho);
    if (p.hi && G.len(p.hi) > 1e-6) return G.norm(G.mul(p.hi, -1));
    const L = n.length;
    const prev = shape.closed || i > 0 ? n[(i - 1 + L) % L] : p;
    const next = shape.closed || i < L - 1 ? n[(i + 1) % L] : p;
    const t = G.norm(G.sub(next, prev));
    return t.x || t.y ? t : { x: 0, y: -1 };
  };

  // Polygon utilities
  G.polyArea = (pts) => {
    let a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j].x - pts[i].x) * (pts[j].y + pts[i].y);
    return a / 2; // sign depends on orientation
  };
  G.polyLength = (pts) => {
    let L = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) L += G.dist(pts[i], pts[j]);
    return L;
  };
  G.pointInPoly = (p, pts) => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  };

  window.G = G;
})();
