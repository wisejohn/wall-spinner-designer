/* Main editor canvas: view transform, drawing, and the select / pen / brush / lasso / pan tools. */
(function () {
  const { S } = WS;
  const TAU = Math.PI * 2;
  const HANDLE_R = 6; // px hit radius

  const E = {};
  let canvas, ctx, layer, lctx, hitCtx;
  let dpr = 1, W = 0, H = 0;
  let drag = null; // active pointer interaction
  let draft = null; // pen / brush / lasso in progress
  let cursor = null; // world coords of mouse
  let cutOutline = null; // {path: Path2D, info}
  let cutTimer = null;
  let spaceDown = false;

  // ---------- transforms ----------
  const toScreen = (p) => ({ x: W / 2 + S.view.panX + p.x * S.view.zoom, y: H / 2 + S.view.panY + p.y * S.view.zoom });
  const toWorld = (sx, sy) => ({ x: (sx - W / 2 - S.view.panX) / S.view.zoom, y: (sy - H / 2 - S.view.panY) / S.view.zoom });
  const setDiscTransform = (c) =>
    c.setTransform(dpr * S.view.zoom, 0, 0, dpr * S.view.zoom, dpr * (W / 2 + S.view.panX), dpr * (H / 2 + S.view.panY));
  const snap = (p) => {
    if (!S.view.snap) return p;
    const g = S.view.gridSize || 1;
    return { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g };
  };

  let fitted = false; // first fit can happen before layout (hidden tab); refit on first real size
  E.fit = () => {
    fitted = W > 50 && H > 50;
    const ext = Math.max(S.design.disc.diameter / 2, R.extent(S.design));
    S.view.zoom = Math.max(0.05, (Math.min(W, H) * 0.46) / ext);
    S.view.panX = 0;
    S.view.panY = 0;
    E.draw();
  };

  E.zoomBy = (factor, sx = W / 2, sy = H / 2) => {
    const before = toWorld(sx, sy);
    S.view.zoom = Math.min(80, Math.max(0.05, S.view.zoom * factor));
    const after = toScreen(before);
    S.view.panX += sx - after.x;
    S.view.panY += sy - after.y;
    E.draw();
  };

  // ---------- drawing ----------
  let raf = 0;
  E.draw = () => {
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); });
  };

  function resize() {
    const r = canvas.parentElement.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    for (const c of [canvas, layer]) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    if (!fitted && S.design) E.fit();
    render();
  }

  function drawGrid() {
    if (!S.view.grid) return;
    const z = S.view.zoom;
    let step = S.view.gridSize || 5;
    while (step * z < 8) step *= 2;
    const major = step * 10;
    const tl = toWorld(0, 0), br = toWorld(W, H);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 1;
    for (const [s, color] of [[step, 'rgba(0,0,0,0.045)'], [major, 'rgba(0,0,0,0.09)']]) {
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (let x = Math.floor(tl.x / s) * s; x <= br.x; x += s) {
        const sx = Math.round(toScreen({ x, y: 0 }).x) + 0.5;
        ctx.moveTo(sx, 0); ctx.lineTo(sx, H);
      }
      for (let y = Math.floor(tl.y / s) * s; y <= br.y; y += s) {
        const sy = Math.round(toScreen({ x: 0, y }).y) + 0.5;
        ctx.moveTo(0, sy); ctx.lineTo(W, sy);
      }
      ctx.stroke();
    }
  }

  function drawGuides() {
    const d = S.design.disc;
    const z = S.view.zoom;
    const N = R.spokes(S.design);
    setDiscTransform(ctx);
    ctx.lineWidth = 1 / z;
    ctx.setLineDash([6 / z, 5 / z]);
    ctx.strokeStyle = 'rgba(40,60,90,0.45)';
    ctx.beginPath();
    ctx.arc(0, 0, d.diameter / 2, 0, TAU);
    ctx.stroke();
    // arm slot (sector the master arm lives in)
    const half = Math.PI / N;
    ctx.strokeStyle = 'rgba(40,110,200,0.35)';
    ctx.beginPath();
    for (const s of [-1, 1]) {
      const p = G.rotate({ x: 0, y: -d.diameter / 2 }, s * half);
      ctx.moveTo(0, 0);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    // center axis
    ctx.strokeStyle = 'rgba(40,110,200,0.25)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -d.diameter / 2);
    ctx.stroke();
    ctx.setLineDash([]);
    // centre cross
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.moveTo(-6 / z, 0); ctx.lineTo(6 / z, 0);
    ctx.moveTo(0, -6 / z); ctx.lineTo(0, 6 / z);
    ctx.stroke();
  }

  function compositeDisc(color, alpha, transform) {
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, layer.width, layer.height);
    setDiscTransform(lctx);
    transform && transform(lctx);
    R.paintDisc(lctx, S.design, color, { ghostOthers: S.view.ghostCopies });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.drawImage(layer, 0, 0);
    ctx.globalAlpha = 1;
  }

  function render() {
    if (!ctx || !S.design) return;
    const z = S.view.zoom;
    const colors = S.design.colors;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = colors.wall;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawGrid();
    if (S.ref && !S.ref.onTop) { setDiscTransform(ctx); Reference.draw(ctx); }

    if (S.view.showBack) {
      const off = (S.anim.offset * Math.PI) / 180;
      compositeDisc('back', 0.75, (c) => { c.rotate(off); c.scale(1, -1); });
    }
    compositeDisc('front', S.ref && S.ref.visible ? S.view.discAlphaTracing : 1);
    if (S.ref && S.ref.onTop) { setDiscTransform(ctx); Reference.draw(ctx); }
    if (S.view.showGuides) drawGuides();

    // cut preview
    if (S.view.cutPreview && cutOutline) {
      setDiscTransform(ctx);
      ctx.strokeStyle = '#e0242b';
      ctx.lineWidth = 1.2 / z;
      ctx.stroke(cutOutline.path);
    }

    // master arm outlines
    const c = R.getCache();
    setDiscTransform(ctx);
    for (const it of c.items) {
      const selected = it.id === S.sel.shapeId;
      ctx.lineWidth = (selected ? 2 : 1) / z;
      ctx.strokeStyle = selected ? '#1f7ae0' : 'rgba(31,122,224,0.55)';
      ctx.stroke(it.path);
      if (it.mpath) {
        ctx.setLineDash([4 / z, 3 / z]);
        ctx.stroke(it.mpath);
        ctx.setLineDash([]);
      }
    }

    drawSelection();
    drawDraft();
  }

  function drawSelection() {
    const s = WS.selectedShape();
    if (!s) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // spine for strokes
    if (s.type === 'stroke') {
      ctx.strokeStyle = 'rgba(31,122,224,0.9)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      const segs = G.segments(s);
      segs.forEach((g, k) => {
        const a = toScreen(g.p0), b = toScreen(g.c1), c = toScreen(g.c2), d = toScreen(g.p3);
        if (k === 0) ctx.moveTo(a.x, a.y);
        ctx.bezierCurveTo(b.x, b.y, c.x, c.y, d.x, d.y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }
    s.nodes.forEach((n, i) => {
      const p = toScreen(n);
      // bezier handles
      for (const h of [n.hi, n.ho]) {
        if (!h) continue;
        const q = toScreen({ x: n.x + h.x, y: n.y + h.y });
        ctx.strokeStyle = 'rgba(31,122,224,0.8)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(q.x, q.y, 4, 0, TAU); ctx.fill(); ctx.stroke();
      }
      // width handle
      if (s.type === 'stroke') {
        const wp = toScreen(widthHandlePos(s, i));
        ctx.strokeStyle = '#d97706';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(wp.x, wp.y); ctx.stroke();
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.moveTo(wp.x, wp.y - 5); ctx.lineTo(wp.x + 5, wp.y); ctx.lineTo(wp.x, wp.y + 5); ctx.lineTo(wp.x - 5, wp.y);
        ctx.closePath(); ctx.fill();
      }
      const isSel = i === S.sel.node;
      ctx.fillStyle = isSel ? '#1f7ae0' : '#fff';
      ctx.strokeStyle = '#1f7ae0';
      ctx.lineWidth = 1.5;
      const r = 4.5;
      ctx.beginPath();
      if (n.smooth) ctx.arc(p.x, p.y, r, 0, TAU);
      else ctx.rect(p.x - r, p.y - r, 2 * r, 2 * r);
      ctx.fill(); ctx.stroke();
    });
  }

  function drawDraft() {
    if (!draft) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (draft.kind === 'brush' || draft.kind === 'lasso') {
      ctx.lineJoin = ctx.lineCap = 'round';
      if (draft.kind === 'brush') {
        ctx.strokeStyle = 'rgba(31,122,224,0.45)';
        for (let i = 1; i < draft.pts.length; i++) {
          const a = toScreen(draft.pts[i - 1]), b = toScreen(draft.pts[i]);
          ctx.lineWidth = Math.max(1, draft.pts[i].w * S.view.zoom);
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      } else {
        ctx.strokeStyle = '#1f7ae0';
        ctx.fillStyle = 'rgba(31,122,224,0.15)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        draft.pts.forEach((p, i) => { const q = toScreen(p); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    } else if (draft.kind === 'pen') {
      const shape = { nodes: draft.nodes, closed: false };
      ctx.strokeStyle = '#1f7ae0';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      G.segments(shape).forEach((g, k) => {
        const a = toScreen(g.p0), b = toScreen(g.c1), c = toScreen(g.c2), d = toScreen(g.p3);
        if (k === 0) ctx.moveTo(a.x, a.y);
        ctx.bezierCurveTo(b.x, b.y, c.x, c.y, d.x, d.y);
      });
      ctx.stroke();
      const last = draft.nodes[draft.nodes.length - 1];
      if (last && cursor && !drag) {
        const a = toScreen(last), b = toScreen(cursor);
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.setLineDash([]);
      }
      draft.nodes.forEach((n, i) => {
        const p = toScreen(n);
        ctx.fillStyle = i === 0 ? '#1f7ae0' : '#fff';
        ctx.beginPath(); ctx.rect(p.x - 4, p.y - 4, 8, 8); ctx.fill(); ctx.stroke();
        for (const h of [n.hi, n.ho]) {
          if (!h) continue;
          const q = toScreen({ x: n.x + h.x, y: n.y + h.y });
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
          ctx.beginPath(); ctx.arc(q.x, q.y, 3, 0, TAU); ctx.fill(); ctx.stroke();
        }
      });
    }
  }

  // ---------- cut preview (debounced trace) ----------
  function scheduleCut() {
    clearTimeout(cutTimer);
    // Always traced (cheaply) so the status bar can warn about disconnected pieces.
    cutTimer = setTimeout(() => {
      const res = Math.max(0.12, S.design.disc.diameter / 1600);
      const info = R.traceCut(S.design, res);
      cutOutline = { path: new Path2D(R.loopsPathData(info.loops)), info };
      WS.emit('cutinfo', info);
      E.draw();
    }, 250);
  }
  E.refreshCut = scheduleCut;

  // ---------- hit testing ----------
  function widthHandlePos(s, i) {
    const n = s.nodes[i];
    const t = G.nodeTangent(s, i);
    const nrm = { x: -t.y, y: t.x };
    return { x: n.x + nrm.x * (n.w / 2), y: n.y + nrm.y * (n.w / 2) };
  }

  const near = (a, b, r = HANDLE_R) => {
    const p = toScreen(a), q = toScreen(b);
    return Math.hypot(p.x - q.x, p.y - q.y) <= r;
  };

  function hitHandles(s, w) {
    for (let i = s.nodes.length - 1; i >= 0; i--) {
      const n = s.nodes[i];
      for (const which of ['ho', 'hi']) {
        const h = n[which];
        if (h && near({ x: n.x + h.x, y: n.y + h.y }, w)) return { kind: 'handle', i, which };
      }
    }
    for (let i = s.nodes.length - 1; i >= 0; i--) if (near(s.nodes[i], w)) return { kind: 'node', i };
    if (s.type === 'stroke') {
      for (let i = s.nodes.length - 1; i >= 0; i--) if (near(widthHandlePos(s, i), w)) return { kind: 'width', i };
    }
    return null;
  }

  function hitShape(w) {
    const c = R.getCache();
    const N = R.spokes(S.design);
    hitCtx.lineWidth = 8 / S.view.zoom;
    for (let k = 0; k < N; k++) {
      const p = G.rotate(w, (-k * TAU) / N);
      for (let i = c.items.length - 1; i >= 0; i--) {
        const it = c.items[i];
        for (const path of [it.path, it.mpath]) {
          if (path && (hitCtx.isPointInPath(path, p.x, p.y) || hitCtx.isPointInStroke(path, p.x, p.y))) return it.id;
        }
      }
    }
    return null;
  }

  // ---------- tools ----------
  E.setTool = (t) => {
    if (draft && draft.kind === 'pen' && t !== 'pen') finishPen(false);
    S.tool = t;
    canvas.dataset.tool = t;
    WS.emit('tool');
    E.draw();
  };

  function finishPen(closed) {
    if (!draft || draft.kind !== 'pen') return;
    // drop near-duplicate trailing nodes (double-click)
    const nodes = [];
    for (const n of draft.nodes) {
      const prev = nodes[nodes.length - 1];
      if (!prev || G.dist(prev, n) * S.view.zoom > 3) nodes.push(n);
      else if (n.ho) { prev.ho = n.ho; prev.hi = prev.hi || n.hi; prev.smooth = true; }
    }
    draft = null;
    if (nodes.length < (closed ? 3 : 2)) { E.draw(); return; }
    const shape = closed
      ? { id: WS.newId(), type: 'outline', closed: true, mirror: false, nodes }
      : { id: WS.newId(), type: 'stroke', closed: false, cap: 'round', mirror: false, nodes };
    nodes.forEach((n) => (n.w = S.tools.brushWidth));
    S.design.shapes.push(shape);
    WS.select(shape.id, -1);
    WS.changed(true);
    E.setTool('select');
  }
  E.finishPen = finishPen;

  function finishFreehand() {
    const d = draft;
    draft = null;
    if (!d || d.pts.length < 2) { E.draw(); return; }
    const closed = d.kind === 'lasso';
    const eps = (S.tools.smoothing || 3) / S.view.zoom;
    let pts = d.pts;
    if (closed && G.dist(pts[0], pts[pts.length - 1]) < 1e-6) pts = pts.slice(0, -1);
    const idx = G.rdp(pts, eps);
    // smooth widths over the window each kept node represents
    const nodes = idx.map((ii, k) => {
      const from = k > 0 ? Math.floor((idx[k - 1] + ii) / 2) : ii;
      const to = k < idx.length - 1 ? Math.ceil((idx[k + 1] + ii) / 2) : ii;
      let sw = 0, cnt = 0;
      for (let j = from; j <= to; j++) { sw += pts[j].w; cnt++; }
      return { x: pts[ii].x, y: pts[ii].y, hi: null, ho: null, smooth: true, w: Math.round((sw / cnt) * 10) / 10 };
    });
    if (nodes.length < (closed ? 3 : 2)) { E.draw(); return; }
    G.autoHandles(nodes, closed);
    const shape = closed
      ? { id: WS.newId(), type: 'outline', closed: true, mirror: false, nodes }
      : { id: WS.newId(), type: 'stroke', closed: false, cap: 'round', mirror: false, nodes };
    S.design.shapes.push(shape);
    WS.select(shape.id, -1);
    WS.changed(true);
  }

  function onPointerDown(e) {
    canvas.focus();
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const w = toWorld(sx, sy);
    canvas.setPointerCapture(e.pointerId);

    if (e.button === 1 || e.button === 2 || S.tool === 'pan' || spaceDown) {
      drag = { kind: 'pan', sx, sy, panX: S.view.panX, panY: S.view.panY };
      return;
    }
    if (e.button !== 0) return;

    if (S.tool.startsWith('ref-')) {
      if (S.ref) {
        if (S.tool === 'ref-centre') Reference.pickCentre(w);
        else if (S.tool === 'ref-rim') Reference.pickRim(w);
        else if (S.tool === 'ref-arm') Reference.pickArm(w);
      }
      E.setTool('select');
      return;
    }

    if (S.tool === 'pen') {
      const p = snap(w);
      if (!draft) draft = { kind: 'pen', nodes: [] };
      if (draft.nodes.length >= 3 && near(draft.nodes[0], w, 9)) { finishPen(true); return; }
      draft.nodes.push({ x: p.x, y: p.y, hi: null, ho: null, smooth: false, w: S.tools.brushWidth });
      drag = { kind: 'penHandle', i: draft.nodes.length - 1 };
      E.draw();
      return;
    }
    if (S.tool === 'brush' || S.tool === 'lasso') {
      const pw = e.pointerType === 'pen' && e.pressure > 0 ? 0.25 + e.pressure * 1.5 : 1;
      draft = { kind: S.tool, pts: [{ x: w.x, y: w.y, w: S.tools.brushWidth * pw }] };
      drag = { kind: 'freehand', lastS: { x: sx, y: sy } };
      return;
    }

    // select tool
    const s = WS.selectedShape();
    const h = s && hitHandles(s, w);
    if (h) {
      if (h.kind === 'node') WS.select(s.id, h.i);
      drag = Object.assign(h, { start: w, orig: G.cloneShape(s), moved: false });
      E.draw();
      return;
    }
    const id = hitShape(w);
    if (id) {
      WS.select(id, -1);
      drag = { kind: 'shape', start: w, orig: G.cloneShape(WS.findShape(id)), moved: false };
      E.draw();
      return;
    }
    WS.select(null, -1);
    drag = { kind: 'pan', sx, sy, panX: S.view.panX, panY: S.view.panY };
    E.draw();
  }

  function onPointerMove(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const w = toWorld(sx, sy);
    cursor = w;
    WS.emit('cursor', w);
    if (!drag) {
      if (draft && draft.kind === 'pen') E.draw();
      updateHoverCursor(w);
      return;
    }
    const s = WS.selectedShape();
    switch (drag.kind) {
      case 'pan':
        S.view.panX = drag.panX + (sx - drag.sx);
        S.view.panY = drag.panY + (sy - drag.sy);
        E.draw();
        break;
      case 'penHandle': {
        const n = draft.nodes[drag.i];
        const d = G.sub(w, n);
        if (G.len(d) * S.view.zoom > 4) {
          n.ho = d;
          n.hi = G.mul(d, -1);
          n.smooth = true;
        }
        E.draw();
        break;
      }
      case 'freehand': {
        if (Math.hypot(sx - drag.lastS.x, sy - drag.lastS.y) < 2) break;
        drag.lastS = { x: sx, y: sy };
        const pw = e.pointerType === 'pen' && e.pressure > 0 ? 0.25 + e.pressure * 1.5 : 1;
        draft.pts.push({ x: w.x, y: w.y, w: S.tools.brushWidth * pw });
        E.draw();
        break;
      }
      case 'node': {
        const o = drag.orig.nodes[drag.i];
        const p = S.view.snap ? snap(w) : { x: o.x + w.x - drag.start.x, y: o.y + w.y - drag.start.y };
        s.nodes[drag.i].x = p.x;
        s.nodes[drag.i].y = p.y;
        drag.moved = true;
        WS.changed(false);
        break;
      }
      case 'handle': {
        const n = s.nodes[drag.i];
        const v = G.sub(w, n);
        n[drag.which] = v;
        if (e.altKey) n.smooth = false;
        const other = drag.which === 'ho' ? 'hi' : 'ho';
        if (n.smooth && n[other]) {
          const L = G.len(n[other]);
          const dir = G.norm(v);
          n[other] = { x: -dir.x * L, y: -dir.y * L };
        }
        drag.moved = true;
        WS.changed(false);
        break;
      }
      case 'width': {
        const n = s.nodes[drag.i];
        const t = G.nodeTangent(s, drag.i);
        const nrm = { x: -t.y, y: t.x };
        let wv = Math.max(0.5, 2 * Math.abs(G.dot(G.sub(w, n), nrm)));
        if (S.view.snap) wv = Math.max(0.5, Math.round(wv * 2) / 2);
        if (e.shiftKey) s.nodes.forEach((m) => (m.w = Math.round(wv * 10) / 10));
        else n.w = Math.round(wv * 10) / 10;
        drag.moved = true;
        WS.changed(false);
        break;
      }
      case 'shape': {
        let dx = w.x - drag.start.x, dy = w.y - drag.start.y;
        if (S.view.snap) { const g = S.view.gridSize; dx = Math.round(dx / g) * g; dy = Math.round(dy / g) * g; }
        if (!drag.moved && Math.hypot(dx, dy) * S.view.zoom < 3) break;
        s.nodes.forEach((n, i) => { n.x = drag.orig.nodes[i].x + dx; n.y = drag.orig.nodes[i].y + dy; });
        drag.moved = true;
        WS.changed(false);
        break;
      }
    }
  }

  function onPointerUp() {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.kind === 'freehand') finishFreehand();
    else if (d.moved) WS.changed(true);
    E.draw();
  }

  function updateHoverCursor(w) {
    if (S.tool !== 'select' || spaceDown) { canvas.style.cursor = ''; return; }
    const s = WS.selectedShape();
    const h = s && hitHandles(s, w);
    if (h) canvas.style.cursor = h.kind === 'width' ? 'ew-resize' : 'move';
    else canvas.style.cursor = hitShape(w) ? 'pointer' : 'default';
  }

  function onDblClick(e) {
    const rect = canvas.getBoundingClientRect();
    const w = toWorld(e.clientX - rect.left, e.clientY - rect.top);
    if (S.tool === 'pen') { finishPen(false); return; }
    if (S.tool !== 'select') return;
    const s = WS.selectedShape();
    if (!s) return;
    const h = hitHandles(s, w);
    if (h && h.kind === 'node') { E.cycleNodeType(s, h.i); return; }
    const nearest = G.nearestOnShape(s, w);
    if (nearest && nearest.d * S.view.zoom < Math.max(10, s.type === 'stroke' ? 10 : 8)) {
      const i = G.insertNode(s, nearest.seg, nearest.t);
      WS.select(s.id, i);
      WS.changed(true);
    }
  }

  E.cycleNodeType = (s, i) => {
    const n = s.nodes[i];
    if (n.smooth) n.smooth = false; // smooth -> corner (independent handles)
    else if (n.hi || n.ho) { n.hi = null; n.ho = null; } // corner -> sharp
    else G.autoHandles(s.nodes, s.closed || s.type === 'outline', i); // sharp -> smooth
    WS.select(s.id, i);
    WS.changed(true);
  };

  E.deleteSelection = () => {
    const s = WS.selectedShape();
    if (!s) return;
    const min = s.type === 'outline' || s.closed ? 3 : 2;
    if (S.sel.node >= 0 && s.nodes.length > min) {
      s.nodes.splice(S.sel.node, 1);
      WS.select(s.id, -1);
    } else {
      S.design.shapes = S.design.shapes.filter((x) => x !== s);
      WS.select(null, -1);
    }
    WS.changed(true);
  };

  E.cancelDraft = () => {
    if (draft) { draft = null; drag = null; E.draw(); return true; }
    return false;
  };
  E.hasPenDraft = () => !!(draft && draft.kind === 'pen');

  E.setSpace = (v) => { spaceDown = v; canvas.style.cursor = v ? 'grab' : ''; };

  E.snapshotPNG = () => canvas.toDataURL('image/png');

  E.init = (el) => {
    canvas = el;
    ctx = canvas.getContext('2d');
    layer = document.createElement('canvas');
    lctx = layer.getContext('2d');
    hitCtx = document.createElement('canvas').getContext('2d');
    canvas.tabIndex = 0;
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', () => { cursor = null; WS.emit('cursor', null); });
    canvas.addEventListener('dblclick', onDblClick);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      E.zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });
    new ResizeObserver(resize).observe(canvas.parentElement);
    resize();
    WS.on('design', () => { E.draw(); scheduleCut(); });
    WS.on('selection', E.draw);
    WS.on('view', () => { E.draw(); scheduleCut(); });
    WS.on('fit', () => E.fit());
    WS.on('reference', E.draw);
  };

  window.Editor = E;
})();
