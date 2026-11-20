/* Panel bindings, selection panel, keyboard shortcuts, file handling, export dialog, boot. */
(function () {
  const { S } = WS;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  const setPath = (obj, path, v) => {
    const ks = path.split('.');
    const last = ks.pop();
    ks.reduce((o, k) => o[k], obj)[last] = v;
  };
  const fmt = (v) => (typeof v === 'number' ? (Math.round(v * 100) / 100).toString() : v);

  function toast(msg, isErr) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast' + (isErr ? ' err' : '');
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (t.hidden = true), 2600);
  }

  // ---------- generic bindings ----------
  const readInput = (el) => (el.type === 'checkbox' ? el.checked : el.type === 'number' || el.type === 'range' ? parseFloat(el.value) : el.value);
  const writeInput = (el, v) => {
    if (document.activeElement === el && el.type === 'number') return;
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v == null ? '' : fmt(v);
  };

  function refreshBindings() {
    $$('[data-bind]').forEach((el) => writeInput(el, getPath(S.design, el.dataset.bind)));
    $$('[data-anim]').forEach((el) => writeInput(el, S.anim[el.dataset.anim]));
    $$('[data-view]').forEach((el) => writeInput(el, S.view[el.dataset.view]));
    $$('[data-toolopt]').forEach((el) => writeInput(el, S.tools[el.dataset.toolopt]));
    $$('output[data-out]').forEach((o) => {
      const [scope, ...rest] = o.dataset.out.split('.');
      const v = getPath({ anim: S.anim, tools: S.tools }[scope], rest.join('.'));
      o.textContent = fmt(v) + (o.dataset.unit || '');
    });
    $('#design-name').value === S.design.name || document.activeElement === $('#design-name') || ($('#design-name').value = S.design.name);
    $('#dia-inch').textContent = (S.design.disc.diameter / 25.4).toFixed(2) + ' in';
    $$('#mode-seg button').forEach((b) => b.classList.toggle('active', b.dataset.mode === S.anim.mode));
    $$('[data-modes]').forEach((el) => (el.style.display = el.dataset.modes.split(' ').includes(S.anim.mode) ? '' : 'none'));
    $('[data-action="undo"]').disabled = !WS.canUndo();
    $('[data-action="redo"]').disabled = !WS.canRedo();
  }

  function bindInputs() {
    $$('[data-bind]').forEach((el) => {
      const path = el.dataset.bind;
      const apply = (commitNow) => {
        let v = readInput(el);
        if (typeof v === 'number' && !isFinite(v)) return;
        const old = getPath(S.design, path);
        if (path === 'disc.diameter') {
          v = Math.max(10, v);
          if ($('#scale-with-disc').checked && old > 0 && v !== old) scaleShapes(v / old);
        }
        if (typeof v === 'number' && el.min !== '' && v < +el.min) v = +el.min;
        setPath(S.design, path, v);
        WS.changed(commitNow);
        refreshBindings();
      };
      // number boxes apply on change (Enter / blur) so typing "400" doesn't pass through 4 and 40
      el.addEventListener('input', () => { if (el.type !== 'number') apply(el.type === 'checkbox'); });
      el.addEventListener('change', () => apply(true));
    });
    $$('[data-anim]').forEach((el) => {
      el.addEventListener('input', () => {
        S.anim[el.dataset.anim] = readInput(el);
        refreshBindings();
      });
    });
    $$('[data-view]').forEach((el) => {
      el.addEventListener('input', () => {
        const v = readInput(el);
        if (typeof v === 'number' && !(v > 0)) return;
        S.view[el.dataset.view] = v;
        WS.emit('view');
        refreshBindings();
      });
    });
    $$('[data-toolopt]').forEach((el) => {
      el.addEventListener('input', () => {
        S.tools[el.dataset.toolopt] = readInput(el);
        refreshBindings();
      });
    });
    $('#design-name').addEventListener('change', (e) => {
      S.design.name = e.target.value.trim() || 'Untitled spinner';
      WS.changed(true);
    });
    $$('#mode-seg button').forEach((b) =>
      b.addEventListener('click', () => {
        S.anim.mode = b.dataset.mode;
        S.anim.t = 0;
        refreshBindings();
      })
    );
    const scrub = $('#rotation-scrub');
    scrub.addEventListener('input', () => {
      S.anim.angle = parseFloat(scrub.value);
      if (S.anim.playing) setPlaying(false);
      updateAnimReadout();
    });
  }

  function scaleShapes(k) {
    for (const s of S.design.shapes) {
      for (const n of s.nodes) {
        n.x *= k; n.y *= k;
        if (n.hi) { n.hi.x *= k; n.hi.y *= k; }
        if (n.ho) { n.ho.x *= k; n.ho.y *= k; }
        n.w *= k;
      }
    }
  }

  // ---------- animation readouts ----------
  function setPlaying(p) {
    S.anim.playing = p;
    $$('.play-btn').forEach((b) => (b.textContent = p ? 'Pause' : 'Play'));
  }
  function updateAnimReadout() {
    const a = S.anim;
    const v = a.playing ? a.velocity : 0;
    const dir = Math.abs(v) < 0.05 ? '■' : v > 0 ? '↻' : '↺';
    const txt = `${dir} ${Math.abs(v).toFixed(1)}°/s · front ${((a.angle % 360) + 360) % 360 | 0}°`;
    $$('.speed-readout').forEach((el) => (el.textContent = txt));
    const scrub = $('#rotation-scrub');
    if (document.activeElement !== scrub) scrub.value = ((a.angle % 360) + 360) % 360;
    $('#rotation-out').textContent = (((a.angle % 360) + 360) % 360).toFixed(0) + '°';
  }
  let lastReadout = 0;
  WS.on('anim', () => {
    const now = performance.now();
    if (now - lastReadout > 100) { lastReadout = now; updateAnimReadout(); }
  });

  // ---------- selection panel ----------
  function renderSelection() {
    const body = $('#sel-body');
    const s = WS.selectedShape();
    if (!s) {
      body.innerHTML = `<div class="sel-empty">Nothing selected. Click an arm part to edit it, or draw a new one with the pen, brush or outline tool.</div>
        <div class="muted">${S.design.shapes.length} part(s) in the arm.</div>`;
      return;
    }
    const isStroke = s.type === 'stroke';
    const n = S.sel.node >= 0 ? s.nodes[S.sel.node] : null;
    const avgW = isStroke ? s.nodes.reduce((a, m) => a + m.w, 0) / s.nodes.length : 0;
    body.innerHTML = `
      <div class="row gap"><span class="sel-type">${isStroke ? 'Stroke (spine + width)' : 'Outline (filled shape)'}</span><span class="muted grow right">${s.nodes.length} nodes</span></div>
      <div class="checks">
        <label><input type="checkbox" id="sp-mirror" ${s.mirror ? 'checked' : ''}> Mirror (M)</label>
        ${isStroke ? `<label><input type="checkbox" id="sp-closed" ${s.closed ? 'checked' : ''}> Closed loop</label>` : ''}
      </div>
      ${isStroke ? `
      <label class="field"><span>Ends</span><select id="sp-cap">
        ${['round', 'butt', 'square'].map((c) => `<option value="${c}" ${s.cap === c ? 'selected' : ''}>${c}</option>`).join('')}
      </select></label>
      <label class="field"><span>All widths</span><input type="number" id="sp-wall" step="0.5" min="0.5" class="num" value="${fmt(avgW)}"><button type="button" id="sp-wall-btn">Set</button></label>
      <label class="field"><span>Taper start→end</span><span class="row gap"><input type="number" id="sp-t0" step="0.5" min="0.5" class="num" value="${fmt(s.nodes[0].w)}"><input type="number" id="sp-t1" step="0.5" min="0.5" class="num" value="${fmt(s.nodes[s.nodes.length - 1].w)}"></span><button type="button" id="sp-taper">Apply</button></label>
      ` : ''}
      <div class="btn-grid">
        <button type="button" data-sa="rotl" title="Rotate part 5° anticlockwise about the centre">⟲ 5°</button>
        <button type="button" data-sa="rotr" title="Rotate part 5° clockwise about the centre">⟳ 5°</button>
        <button type="button" data-sa="flip" title="Flip left/right">Flip</button>
        <button type="button" data-sa="smooth" title="Make every node smooth">Smooth all</button>
        <button type="button" data-sa="sharp" title="Remove all curve handles">Sharpen</button>
        <button type="button" data-sa="convert" title="${isStroke ? 'Convert to an editable outline' : 'Convert to a centre-line stroke is not available'}" ${isStroke ? '' : 'disabled'}>To outline</button>
        <button type="button" data-sa="dup">Duplicate</button>
        <button type="button" data-sa="up" title="Move later in drawing order">Raise</button>
        <button type="button" data-sa="del" class="danger">Delete</button>
      </div>
      ${n ? `
      <div class="node-box">
        <div class="muted">Node ${S.sel.node + 1} — ${n.smooth ? 'smooth' : n.hi || n.ho ? 'corner' : 'sharp'}</div>
        <label class="field"><span>X / Y</span><span class="row gap"><input type="number" id="sn-x" step="0.5" class="num" value="${fmt(n.x)}"><input type="number" id="sn-y" step="0.5" class="num" value="${fmt(n.y)}"></span><span></span></label>
        ${isStroke ? `<label class="field"><span>Width</span><input type="range" id="sn-wr" min="0.5" max="120" step="0.5" value="${n.w}"><input type="number" id="sn-w" min="0.5" step="0.5" class="num" value="${fmt(n.w)}"></label>` : ''}
        <div class="row gap"><button type="button" id="sn-type" class="grow">Cycle type</button><button type="button" id="sn-del" class="grow">Delete node</button></div>
      </div>` : '<div class="muted">Click a node to edit it. Double-click the curve to add one.</div>'}
    `;
    const on = (id, ev, fn) => { const el = $('#' + id, body); if (el) el.addEventListener(ev, fn); };
    on('sp-mirror', 'change', (e) => { s.mirror = e.target.checked; WS.changed(true); });
    on('sp-closed', 'change', (e) => { s.closed = e.target.checked; if (s.nodes.length < 3) s.closed = false; WS.changed(true); renderSelection(); });
    on('sp-cap', 'change', (e) => { s.cap = e.target.value; WS.changed(true); });
    on('sp-wall-btn', 'click', () => { const v = +$('#sp-wall').value; if (v > 0) { s.nodes.forEach((m) => (m.w = v)); WS.changed(true); } });
    on('sp-taper', 'click', () => {
      const a = +$('#sp-t0').value, b = +$('#sp-t1').value;
      if (!(a > 0 && b > 0)) return;
      const L = s.nodes.length - 1 || 1;
      s.nodes.forEach((m, i) => (m.w = Math.round((a + ((b - a) * i) / L) * 10) / 10));
      WS.changed(true);
    });
    on('sn-x', 'change', (e) => { n.x = +e.target.value; WS.changed(true); });
    on('sn-y', 'change', (e) => { n.y = +e.target.value; WS.changed(true); });
    on('sn-w', 'change', (e) => { n.w = Math.max(0.5, +e.target.value); WS.changed(true); });
    on('sn-wr', 'input', (e) => { n.w = +e.target.value; $('#sn-w').value = n.w; WS.changed(false); });
    on('sn-wr', 'change', () => WS.changed(true));
    on('sn-type', 'click', () => Editor.cycleNodeType(s, S.sel.node));
    on('sn-del', 'click', () => Editor.deleteSelection());
    $$('[data-sa]', body).forEach((b) => b.addEventListener('click', () => shapeAction(b.dataset.sa)));
  }

  function shapeAction(act) {
    const s = WS.selectedShape();
    if (!s) return;
    const rot = (deg) => {
      const a = (deg * Math.PI) / 180;
      s.nodes.forEach((n) => {
        const p = G.rotate(n, a);
        n.x = p.x; n.y = p.y;
        if (n.hi) n.hi = G.rotate(n.hi, a);
        if (n.ho) n.ho = G.rotate(n.ho, a);
      });
    };
    switch (act) {
      case 'rotl': rot(-5); break;
      case 'rotr': rot(5); break;
      case 'flip': Object.assign(s, { nodes: G.mirrorShape(s).nodes }); break;
      case 'smooth': G.autoHandles(s.nodes, s.closed || s.type === 'outline'); break;
      case 'sharp': s.nodes.forEach((n) => { n.hi = n.ho = null; n.smooth = false; }); break;
      case 'convert': {
        const rings = G.strokeRings(s);
        if (!rings.length) return;
        const ring = rings[0];
        const eps = 0.15;
        const nodes = G.simplifyClosed(ring, eps).map((p) => ({ x: p.x, y: p.y, hi: null, ho: null, smooth: false, w: 10 }));
        if (rings.length > 1) { toast('Closed loops keep their inner hole only as a stroke — converted outer edge.'); }
        Object.assign(s, { type: 'outline', closed: true, nodes });
        delete s.cap;
        WS.select(s.id, -1);
        break;
      }
      case 'dup': {
        const c = G.cloneShape(s);
        c.id = WS.newId();
        c.nodes.forEach((n) => { n.x += 5; n.y += 5; });
        S.design.shapes.push(c);
        WS.select(c.id, -1);
        break;
      }
      case 'up': {
        const i = S.design.shapes.indexOf(s);
        if (i < S.design.shapes.length - 1) { S.design.shapes.splice(i, 1); S.design.shapes.splice(i + 1, 0, s); }
        break;
      }
      case 'del':
        S.design.shapes = S.design.shapes.filter((x) => x !== s);
        WS.select(null, -1);
        break;
    }
    WS.changed(true);
  }

  // ---------- presets ----------
  function initPresets() {
    const sel = $('#preset-select');
    sel.innerHTML = Object.entries(WS.presets).map(([k, p]) => `<option value="${k}">${p.name}</option>`).join('');
  }

  // ---------- export dialog ----------
  function openExport() {
    const dlg = $('#export-dialog');
    const paperSel = $('#ex-paper');
    if (!paperSel.options.length) {
      paperSel.innerHTML = Object.entries(Exporter.PAPER).map(([k, p]) => `<option value="${k}">${p.name}</option>`).join('');
    }
    refreshBindings();
    dlg.showModal();
    $('#export-summary').textContent = 'Computing cut outline…';
    setTimeout(() => {
      const info = Exporter.cutGeometry();
      const b = Exporter.bounds(info.loops);
      const pieceTxt = info.pieces === 1
        ? '<span class="st-ok">1 connected piece ✓</span>'
        : `<span class="st-warn">⚠ ${info.pieces} separate pieces — some parts don't connect to the hub</span>`;
      $('#export-summary').innerHTML =
        `<b>${b.w.toFixed(1)} × ${b.h.toFixed(1)} mm</b> (${(b.w / 25.4).toFixed(2)} × ${(b.h / 25.4).toFixed(2)} in) · ` +
        `${pieceTxt} · ${info.holes} hole(s) · cut length <b>${(info.cutLength / 1000).toFixed(2)} m</b> per disc · area ${(info.area / 100).toFixed(0)} cm²`;
      updateTiles();
    }, 30);
  }

  function updateTiles() {
    const plan = Exporter.planTiles(printOpts());
    $('#ex-tiles').textContent = `${plan.rows * plan.cols} page(s): ${plan.cols} across × ${plan.rows} down`;
  }
  const printOpts = () => ({
    paper: $('#ex-paper').value || 'letter',
    orientation: $('#ex-orient').value,
    overlap: +$('#ex-overlap').value,
    fill: $('#ex-fill').checked,
  });
  const laserOpts = () => ({ copies: +$('#ex-copies').value, gap: +$('#ex-gap').value });

  function doExport(kind) {
    try {
      switch (kind) {
        case 'svg': Exporter.exportSVG(laserOpts()); break;
        case 'svg-filled': Exporter.exportSVG(Object.assign(laserOpts(), { style: 'filled' })); break;
        case 'dxf': Exporter.exportDXF(laserOpts()); break;
        case 'stl': Exporter.exportSTL(); break;
        case 'scad': Exporter.exportSCAD(); break;
        case 'json': Exporter.saveJSON(); break;
        case 'png': Exporter.exportPNG(); break;
        case 'print':
          $('#export-dialog').close();
          Exporter.printTemplate(printOpts());
          break;
      }
    } catch (err) {
      console.error(err);
      toast('Export failed: ' + err.message, true);
    }
  }

  // ---------- actions ----------
  function action(name) {
    switch (name) {
      case 'new':
        if (!confirm('Start a new design? (The current one can be restored with Undo.)')) return;
        { const d = WS.defaultDesign(); WS.setDesign(d, false); }
        break;
      case 'open': $('#file-input').click(); break;
      case 'save': Exporter.saveJSON(); break;
      case 'undo': WS.undo(); break;
      case 'redo': WS.redo(); break;
      case 'export': openExport(); break;
      case 'zoom-in': Editor.zoomBy(1.25); break;
      case 'zoom-out': Editor.zoomBy(0.8); break;
      case 'fit': Editor.fit(); break;
      case 'play': setPlaying(!S.anim.playing); break;
      case 'reset-anim': Preview.reset(); updateAnimReadout(); break;
      case 'big-preview': {
        const bp = $('#big-preview');
        bp.hidden = !bp.hidden;
        $('[data-action="big-preview"]').classList.toggle('active', !bp.hidden);
        break;
      }
      case 'preset-replace':
      case 'preset-add': {
        const p = WS.presets[$('#preset-select').value];
        const shapes = p.build(S.design.disc);
        if (name === 'preset-replace') S.design.shapes = shapes;
        else S.design.shapes.push(...shapes);
        WS.select(shapes[0].id, -1);
        WS.changed(true);
        break;
      }
    }
  }

  function updateToolUI() {
    $$('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === S.tool));
    const hints = {
      select: '',
      pen: 'Pen: click = corner, drag = curve · click the first point to close an outline · Enter / double-click finishes an open stroke · Esc cancels',
      brush: `Brush: drag to paint a stroke arm (${S.tools.brushWidth} mm wide). Pen pressure is used if available.`,
      lasso: 'Outline: drag to draw a closed filled shape',
      pan: 'Pan: drag to move the view · scroll to zoom',
    };
    $('#tool-hint').textContent = hints[S.tool] || '';
  }

  // ---------- keyboard ----------
  function onKey(e) {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if ($('#export-dialog').open) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (ctrl && k === 'z') { e.preventDefault(); e.shiftKey ? WS.redo() : WS.undo(); return; }
    if (ctrl && k === 'y') { e.preventDefault(); WS.redo(); return; }
    if (ctrl && k === 's') { e.preventDefault(); Exporter.saveJSON(); return; }
    if (ctrl && k === 'o') { e.preventDefault(); action('open'); return; }
    if (ctrl && k === 'e') { e.preventDefault(); openExport(); return; }
    if (ctrl && k === 'd') { e.preventDefault(); shapeAction('dup'); return; }
    if (ctrl) return;
    switch (e.key) {
      case 'v': case 'V': Editor.setTool('select'); break;
      case 'p': case 'P': Editor.setTool('pen'); break;
      case 'b': case 'B': Editor.setTool('brush'); break;
      case 'l': case 'L': Editor.setTool('lasso'); break;
      case 'h': case 'H': Editor.setTool('pan'); break;
      case 'f': case 'F': Editor.fit(); break;
      case 'm': case 'M': { const s = WS.selectedShape(); if (s) { s.mirror = !s.mirror; WS.changed(true); renderSelection(); } break; }
      case '+': case '=': Editor.zoomBy(1.25); break;
      case '-': case '_': Editor.zoomBy(0.8); break;
      case ' ': e.preventDefault(); action('play'); break;
      case 'Tab': e.preventDefault(); action('big-preview'); break;
      case 'Enter': if (Editor.hasPenDraft()) Editor.finishPen(false); break;
      case 'Escape':
        if (!Editor.cancelDraft()) { if (S.sel.node >= 0) WS.select(S.sel.shapeId, -1); else WS.select(null, -1); }
        break;
      case 'Delete': case 'Backspace': e.preventDefault(); Editor.deleteSelection(); break;
      case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight': {
        const s = WS.selectedShape();
        if (!s) return;
        e.preventDefault();
        const st = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -st : e.key === 'ArrowRight' ? st : 0;
        const dy = e.key === 'ArrowUp' ? -st : e.key === 'ArrowDown' ? st : 0;
        const targets = S.sel.node >= 0 ? [s.nodes[S.sel.node]] : s.nodes;
        targets.forEach((n) => { n.x += dx; n.y += dy; });
        WS.changed(true);
        break;
      }
    }
  }

  // ---------- status bar ----------
  function updateCursor(w) {
    if (!w) { $('#st-cursor').textContent = '—'; return; }
    const r = Math.hypot(w.x, w.y);
    let th = (Math.atan2(w.x, -w.y) * 180) / Math.PI;
    if (th < 0) th += 360;
    $('#st-cursor').textContent = `x ${w.x.toFixed(1)}  y ${(-w.y).toFixed(1)} mm · r ${r.toFixed(1)} · θ ${th.toFixed(1)}°`;
    $('#st-zoom').textContent = `${(S.view.zoom * 100).toFixed(0)}%`;
  }
  function updatePieces(info) {
    const el = $('#st-pieces');
    if (!info || !info.loops.length) { el.textContent = 'Empty design'; el.className = 'grow st-warn'; return; }
    if (info.pieces === 1) {
      el.textContent = `1 piece ✓ · cut ${(info.cutLength / 1000).toFixed(2)} m · ${(info.area / 100).toFixed(0)} cm²`;
      el.className = 'grow st-ok';
    } else {
      el.textContent = `⚠ ${info.pieces} separate pieces — make every arm touch the hub (or add a rim)`;
      el.className = 'grow st-warn';
    }
  }

  // ---------- boot ----------
  function boot() {
    S.design = WS.load();
    WS.commit();

    Editor.init($('#editor'));
    Preview.addTarget($('#preview-small'));
    Preview.addTarget($('#preview-big'));
    Preview.setGraph($('#vel-graph'));
    Preview.start();

    bindInputs();
    initPresets();

    $$('[data-tool]').forEach((b) => b.addEventListener('click', () => Editor.setTool(b.dataset.tool)));
    $$('[data-action]').forEach((b) => b.addEventListener('click', () => action(b.dataset.action)));
    $$('[data-ex]').forEach((b) => b.addEventListener('click', () => doExport(b.dataset.ex)));
    ['#ex-paper', '#ex-orient', '#ex-overlap'].forEach((s) => $(s).addEventListener('input', updateTiles));

    $('#file-input').addEventListener('change', (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      Exporter.importFile(f).then((d) => toast(`Opened “${d.name}”`)).catch((err) => toast('Could not open file: ' + err.message, true));
    });
    // drag & drop a design file anywhere
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      const f = e.dataTransfer.files[0];
      if (f) Exporter.importFile(f).then((d) => toast(`Opened “${d.name}”`)).catch((err) => toast('Could not open file: ' + err.message, true));
    });

    window.addEventListener('keydown', onKey);
    window.addEventListener('afterprint', () => ($('#print-root').innerHTML = ''));

    WS.on('design', () => { refreshBindings(); renderSelection(); });
    WS.on('selection', renderSelection);
    WS.on('history', refreshBindings);
    WS.on('tool', updateToolUI);
    WS.on('cursor', updateCursor);
    WS.on('cutinfo', updatePieces);

    refreshBindings();
    renderSelection();
    updateToolUI();
    setPlaying(true);
    Editor.fit();
    Editor.refreshCut();
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
