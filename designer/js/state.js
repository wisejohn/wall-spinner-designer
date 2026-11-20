/* App state, history (undo/redo), events, persistence and arm presets. */
(function () {
  const STORAGE_KEY = 'wall-spinner-designer:autosave';
  const FILE_TAG = 'wall-spinner-design';

  let idCounter = 0;
  const newId = () => 's' + Date.now().toString(36) + (idCounter++).toString(36);

  const defaultDisc = () => ({
    spokes: 5,
    cutouts: 4, // repeat count for cutout shapes (independent of arms)
    diameter: 400,
    hubDiameter: 90,
    holeDiameter: 8,
    rimWidth: 0,
    clipToDisc: false,
    thickness: 6,
    boltCount: 0,
    boltDiameter: 4,
    boltCircle: 50,
  });

  const defaultColors = () => ({
    front: '#b8784e', back: '#6e4630', wall: '#e9e5de',
    // radial colour: inner colour = front/back, outer colour beyond the split radius
    radial: false, frontOuter: '#d4481f', backOuter: '#8e2f16', split: 60, blend: 12,
  });

  // ---------------- presets ----------------
  // Every preset is a function (disc) => shapes[] in arm space (arm points to 12 o'clock).
  const node = (x, y, w, extra) => Object.assign({ x, y, hi: null, ho: null, smooth: false, w }, extra || {});
  const P = (r, deg) => G.polar(r, deg);

  const presets = {
    hooked: {
      name: 'Hooked blade',
      build(d) {
        const R = d.diameter / 2, h = d.hubDiameter / 2;
        const pts = [P(h * 0.7, -10), P(h + (R - h) * 0.35, 22), P(h + (R - h) * 0.62, 18), P(R * 0.96, -14)];
        const nodes = pts.map((p, i) => node(p.x, p.y, [16, 13, 14, 46][i]));
        G.autoHandles(nodes, false);
        return [{ id: newId(), type: 'stroke', closed: false, cap: 'butt', mirror: false, nodes }];
      },
    },
    swirl: {
      name: 'Swirl (flower)',
      build(d) {
        const R = d.diameter / 2, h = d.hubDiameter / 2;
        const pts = [P(h * 0.8, -25), P(h + (R - h) * 0.3, 10), P(h + (R - h) * 0.65, 38), P(R * 0.98, 72)];
        const nodes = pts.map((p, i) => node(p.x, p.y, [26, 22, 30, 8][i]));
        G.autoHandles(nodes, false);
        return [{ id: newId(), type: 'stroke', closed: false, cap: 'butt', mirror: false, nodes }];
      },
    },
    twoSegment: {
      name: 'Two-segment arm (wallwave)',
      build(d) {
        const R = d.diameter / 2, h = d.hubDiameter / 2;
        const L = (R - h) * 0.5;
        const p1 = P(h, 0), p2 = G.add(p1, P(L, 35)), p3 = G.add(p2, P(L, -25));
        const nodes = [node(p1.x, p1.y, 20), node(p2.x, p2.y, 20), node(p3.x, p3.y, 20)];
        G.autoHandles(nodes, false);
        return [{ id: newId(), type: 'stroke', closed: false, cap: 'square', mirror: false, nodes }];
      },
    },
    tapered: {
      name: 'Tapered spoke (test2)',
      build(d) {
        const R = d.diameter / 2, h = d.hubDiameter / 2;
        const r1 = h + (R - h) * 0.5;
        const a1 = 20, a2 = 45;
        const pts = [P(h * 0.9, -9), P(r1, a1 - 6), P(R, a2 - 2), P(R, a2 + 2), P(r1, a1 + 6), P(h * 0.9, 9)];
        const nodes = pts.map((p) => node(p.x, p.y, 10));
        G.autoHandles(nodes, true);
        return [{ id: newId(), type: 'outline', closed: true, mirror: false, nodes }];
      },
    },
    petal: {
      name: 'Petal loop (nova)',
      build(d) {
        const R = d.diameter / 2, h = d.hubDiameter / 2;
        const pts = [P(h * 0.85, -30), P(h + (R - h) * 0.45, -26), P(R * 0.95, 0), P(h + (R - h) * 0.45, 26), P(h * 0.85, 30)];
        const nodes = pts.map((p) => node(p.x, p.y, 11));
        G.autoHandles(nodes, true);
        return [{ id: newId(), type: 'stroke', closed: true, cap: 'butt', mirror: false, nodes }];
      },
    },
    sweep: {
      name: 'Sweep blade (generator)',
      build(d) {
        const R = d.diameter / 2;
        const k = R / 230;
        const raw = [[-10, -45], [10, -45], [100, -50], [120, -100], [-115, -200], [90, -75], [0, -55]];
        const nodes = raw.map(([x, y]) => node(x * k, y * k, 10));
        G.autoHandles(nodes, true);
        return [{ id: newId(), type: 'outline', closed: true, mirror: false, nodes }];
      },
    },
    leaf: {
      name: 'Mirrored leaf',
      build(d) {
        const R = d.diameter / 2, h = d.hubDiameter / 2;
        const pts = [P(R * 0.97, 0), P(h + (R - h) * 0.55, 14), P(h * 0.9, 6), P(h * 0.9, 0)];
        const nodes = pts.map((p) => node(p.x, p.y, 10));
        G.autoHandles(nodes, false);
        nodes[0].hi = null; nodes[0].ho = { x: 18, y: 25 }; nodes[0].smooth = false;
        nodes[3].ho = null; nodes[3].hi = null;
        return [{ id: newId(), type: 'outline', closed: true, mirror: true, nodes }];
      },
    },
  };

  // Cutout presets: subtracted from the disc, repeated `disc.cutouts` times (kind: 'cutout').
  const fitHub = (d, min) => Math.max(d.hubDiameter / 2, min);
  Object.assign(presets, {
    cutWindow: {
      name: 'Cutout: round window', kind: 'cutout',
      build(d) {
        const h = fitHub(d, 20), r = h * 0.2, c = P(h * 0.55, 0);
        const k = 0.5523 * r;
        const nodes = [
          node(c.x, c.y - r, 1, { hi: { x: -k, y: 0 }, ho: { x: k, y: 0 }, smooth: true }),
          node(c.x + r, c.y, 1, { hi: { x: 0, y: -k }, ho: { x: 0, y: k }, smooth: true }),
          node(c.x, c.y + r, 1, { hi: { x: k, y: 0 }, ho: { x: -k, y: 0 }, smooth: true }),
          node(c.x - r, c.y, 1, { hi: { x: 0, y: k }, ho: { x: 0, y: -k }, smooth: true }),
        ];
        return [{ id: newId(), type: 'outline', closed: true, mirror: false, cut: true, nodes }];
      },
    },
    cutSlot: {
      name: 'Cutout: curved slot', kind: 'cutout',
      build(d) {
        const h = fitHub(d, 20), w = Math.max(3, h * 0.14);
        const pts = [P(h * 0.5, -28), P(h * 0.62, 0), P(h * 0.5, 28)];
        const nodes = pts.map((p) => node(p.x, p.y, w));
        G.autoHandles(nodes, false);
        return [{ id: newId(), type: 'stroke', closed: false, cap: 'round', mirror: false, cut: true, nodes }];
      },
    },
    cutPetal: {
      name: 'Cutout: teardrop', kind: 'cutout',
      build(d) {
        const h = fitHub(d, 20);
        const pts = [P(h * 0.25, 0), P(h * 0.6, 14), P(h * 0.8, 0), P(h * 0.6, -14)];
        const nodes = pts.map((p) => node(p.x, p.y, 1));
        G.autoHandles(nodes, true);
        nodes[0].hi = nodes[0].ho = null; nodes[0].smooth = false;
        return [{ id: newId(), type: 'outline', closed: true, mirror: false, cut: true, nodes }];
      },
    },
    cutKnot: {
      name: 'Cutout: lobed knot (pair with 4)', kind: 'cutout',
      build(d) {
        const h = fitHub(d, 20), w = Math.max(3, h * 0.12);
        // spans < 90° so neighbouring copies leave a bridge to the centre
        const pts = [P(h * 0.3, -35), P(h * 0.6, -5), P(h * 0.72, 30), P(h * 0.55, 52)];
        const nodes = pts.map((p) => node(p.x, p.y, w));
        G.autoHandles(nodes, false);
        return [{ id: newId(), type: 'stroke', closed: false, cap: 'round', mirror: false, cut: true, nodes }];
      },
    },
  });

  const defaultDesign = () => {
    const disc = defaultDisc();
    return {
      format: FILE_TAG,
      version: 1,
      name: 'Untitled spinner',
      disc,
      colors: defaultColors(),
      shapes: presets.hooked.build(disc),
    };
  };

  // ---------------- state ----------------
  const S = {
    design: null,
    sel: { shapeId: null, node: -1 },
    tool: 'select',
    tools: { brushWidth: 14, smoothing: 3, cutout: false },
    view: {
      zoom: 1, panX: 0, panY: 0,
      grid: true, snap: false, gridSize: 5,
      showBack: false, ghostCopies: false, cutPreview: false, showGuides: true,
      discAlphaTracing: 0.55, // front disc opacity while a trace image is visible
    },
    anim: {
      playing: true, mode: 'yoyo',
      speed: 40, ramp: 2.5, hold: 2, pause: 0.6, period: 8,
      offset: 0, angle: 0, t: 0, velocity: 0,
      showFront: true, showBack: true, shadow: true,
    },
    version: 0,
  };

  // ---------------- events ----------------
  const listeners = {};
  const on = (ev, fn) => (listeners[ev] = listeners[ev] || []).push(fn);
  const emit = (ev, data) => (listeners[ev] || []).forEach((fn) => fn(data));

  // ---------------- history ----------------
  const history = [];
  let hIndex = -1;

  function snapshot() {
    return JSON.stringify(S.design);
  }

  function commit() {
    const snap = snapshot();
    if (hIndex >= 0 && history[hIndex] === snap) return;
    history.splice(hIndex + 1);
    history.push(snap);
    if (history.length > 200) history.shift();
    hIndex = history.length - 1;
    save();
    emit('history');
  }

  function restore(snap) {
    S.design = JSON.parse(snap);
    if (!findShape(S.sel.shapeId)) S.sel = { shapeId: null, node: -1 };
    changed(false);
  }

  function undo() {
    if (hIndex > 0) {
      hIndex--;
      restore(history[hIndex]);
      save();
      emit('history');
    }
  }
  function redo() {
    if (hIndex < history.length - 1) {
      hIndex++;
      restore(history[hIndex]);
      save();
      emit('history');
    }
  }
  const canUndo = () => hIndex > 0;
  const canRedo = () => hIndex < history.length - 1;

  // Call after any design mutation. commitNow=true records an undo step.
  function changed(commitNow = true) {
    S.version++;
    emit('design');
    if (commitNow) commit();
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, snapshot());
    } catch (e) { /* storage may be unavailable */ }
  }

  function normalizeDesign(d) {
    if (!d || typeof d !== 'object' || !Array.isArray(d.shapes)) throw new Error('Not a spinner design file');
    const out = defaultDesign();
    out.name = typeof d.name === 'string' ? d.name : out.name;
    Object.assign(out.disc, d.disc || {});
    Object.assign(out.colors, d.colors || {});
    out.shapes = d.shapes
      .filter((s) => s && Array.isArray(s.nodes) && s.nodes.length >= 2)
      .map((s) => ({
        id: s.id || newId(),
        type: s.type === 'stroke' ? 'stroke' : 'outline',
        closed: s.type === 'stroke' ? !!s.closed : true,
        cap: s.cap || 'round',
        mirror: !!s.mirror,
        cut: !!s.cut,
        nodes: s.nodes.map((n) => ({
          x: +n.x || 0, y: +n.y || 0,
          hi: n.hi ? { x: +n.hi.x || 0, y: +n.hi.y || 0 } : null,
          ho: n.ho ? { x: +n.ho.x || 0, y: +n.ho.y || 0 } : null,
          smooth: !!n.smooth,
          w: n.w == null ? 10 : +n.w,
        })),
      }));
    return out;
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return normalizeDesign(JSON.parse(raw));
    } catch (e) { /* ignore */ }
    return defaultDesign();
  }

  function setDesign(d, resetHistory) {
    S.design = d;
    S.sel = { shapeId: null, node: -1 };
    if (resetHistory) {
      history.length = 0;
      hIndex = -1;
    }
    changed(true);
    emit('fit');
  }

  function findShape(id) {
    return S.design && S.design.shapes.find((s) => s.id === id);
  }
  const selectedShape = () => findShape(S.sel.shapeId);

  function select(id, nodeIdx = -1) {
    S.sel = { shapeId: id, node: nodeIdx };
    emit('selection');
  }

  window.WS = {
    S, on, emit, changed, commit, undo, redo, canUndo, canRedo,
    newId, presets, defaultDesign, defaultDisc, normalizeDesign, load, setDesign,
    findShape, selectedShape, select, FILE_TAG,
  };
})();
