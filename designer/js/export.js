/* Import / export: design JSON, SVG + DXF (laser), STL + OpenSCAD (3D print), PNG, tiled paper template. */
(function () {
  const { S } = WS;
  const X = {};

  const PAPER = {
    letter: { name: 'US Letter', w: 215.9, h: 279.4 },
    legal: { name: 'US Legal', w: 215.9, h: 355.6 },
    tabloid: { name: 'Tabloid 11×17', w: 279.4, h: 431.8 },
    a4: { name: 'A4', w: 210, h: 297 },
    a3: { name: 'A3', w: 297, h: 420 },
  };
  X.PAPER = PAPER;

  const slug = () => (S.design.name || 'spinner').trim().replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'spinner';

  X.download = (data, filename, type) => {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  // ---------- geometry ----------
  let traced = { key: '', info: null };
  X.cutGeometry = (res = 0.08) => {
    const key = S.version + '|' + res;
    if (traced.key !== key) traced = { key, info: R.traceCut(S.design, res) };
    return traced.info;
  };

  const bounds = (loops) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const l of loops) for (const p of l.pts) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    if (!isFinite(minX)) return { minX: -1, minY: -1, maxX: 1, maxY: 1, w: 2, h: 2 };
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  };
  X.bounds = bounds;

  // ---------- JSON ----------
  X.saveJSON = () => {
    const data = Object.assign({}, S.design, { format: WS.FILE_TAG, version: 1, savedAt: new Date().toISOString() });
    X.download(JSON.stringify(data, null, 2), `${slug()}.spinner.json`, 'application/json');
  };

  X.importFile = (file) =>
    file.text().then((txt) => {
      const d = WS.normalizeDesign(JSON.parse(txt));
      WS.setDesign(d, false);
      return d;
    });

  // ---------- SVG ----------
  X.svgString = (opts = {}) => {
    const info = X.cutGeometry();
    const copies = Math.max(1, opts.copies || 1);
    const gap = opts.gap == null ? 10 : opts.gap;
    const b = bounds(info.loops);
    const pad = 2;
    const step = b.w + gap;
    const W = b.w * copies + gap * (copies - 1) + pad * 2;
    const H = b.h + pad * 2;
    const filled = opts.style === 'filled';
    const paths = [];
    for (let k = 0; k < copies; k++) {
      const d = R.loopsPathData(info.loops, -b.minX + pad + k * step, -b.minY + pad);
      paths.push(
        filled
          ? `  <path d="${d}" fill="#000" fill-rule="evenodd" stroke="none"/>`
          : `  <path d="${d}" fill="none" stroke="${opts.stroke || '#ff0000'}" stroke-width="${opts.strokeWidth || 0.1}"/>`
      );
    }
    return `<?xml version="1.0" encoding="UTF-8"?>
<!-- ${escapeXml(S.design.name)} — Wall Spinner Designer. Units: mm. Spokes: ${R.spokes(S.design)}, Ø${S.design.disc.diameter} mm. -->
<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(3)}mm" height="${H.toFixed(3)}mm" viewBox="0 0 ${W.toFixed(3)} ${H.toFixed(3)}">
  <title>${escapeXml(S.design.name)}</title>
${paths.join('\n')}
</svg>
`;
  };
  const escapeXml = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  X.exportSVG = (opts) => X.download(X.svgString(opts), `${slug()}${opts && opts.style === 'filled' ? '-filled' : ''}.svg`, 'image/svg+xml');

  // ---------- DXF (R12, mm) ----------
  X.dxfString = (opts = {}) => {
    const info = X.cutGeometry();
    const copies = Math.max(1, opts.copies || 1);
    const gap = opts.gap == null ? 10 : opts.gap;
    const b = bounds(info.loops);
    const out = [];
    const w = (code, val) => out.push(String(code), String(val));
    w(0, 'SECTION'); w(2, 'HEADER');
    w(9, '$ACADVER'); w(1, 'AC1009');
    w(9, '$INSUNITS'); w(70, 4);
    w(9, '$MEASUREMENT'); w(70, 1);
    w(0, 'ENDSEC');
    w(0, 'SECTION'); w(2, 'TABLES');
    w(0, 'TABLE'); w(2, 'LAYER'); w(70, 1);
    w(0, 'LAYER'); w(2, 'CUT'); w(70, 0); w(62, 1); w(6, 'CONTINUOUS');
    w(0, 'ENDTAB');
    w(0, 'ENDSEC');
    w(0, 'SECTION'); w(2, 'ENTITIES');
    for (let k = 0; k < copies; k++) {
      const dx = -b.minX + k * (b.w + gap);
      for (const l of info.loops) {
        w(0, 'POLYLINE'); w(8, 'CUT'); w(66, 1); w(70, 1);
        w(10, 0); w(20, 0); w(30, 0);
        for (const p of l.pts) {
          w(0, 'VERTEX'); w(8, 'CUT');
          w(10, (p.x + dx).toFixed(4));
          w(20, (b.maxY - p.y).toFixed(4)); // flip to y-up
          w(30, 0);
        }
        w(0, 'SEQEND'); w(8, 'CUT');
      }
    }
    w(0, 'ENDSEC');
    w(0, 'EOF');
    return out.join('\r\n') + '\r\n';
  };
  X.exportDXF = (opts) => X.download(X.dxfString(opts), `${slug()}.dxf`, 'application/dxf');

  // ---------- 3D: grouped polygons (y-up) ----------
  function polygonsYUp() {
    const info = X.cutGeometry(0.1);
    const toUp = (pts) => pts.map((p) => ({ x: p.x, y: -p.y }));
    const signed = (pts) => {
      let a = 0;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
      return a / 2;
    };
    const groups = [];
    const map = new Map();
    for (const l of info.loops) {
      if (!l.outer) continue;
      let pts = toUp(l.pts);
      if (signed(pts) < 0) pts.reverse(); // outer CCW
      const g = { outer: pts, holes: [] };
      map.set(l, g);
      groups.push(g);
    }
    for (const l of info.loops) {
      if (l.outer || !l.parent || !map.has(l.parent)) continue;
      let pts = toUp(l.pts);
      if (signed(pts) > 0) pts.reverse(); // holes CW
      map.get(l.parent).holes.push(pts);
    }
    return groups;
  }

  X.stlBuffer = () => {
    const t = Math.max(0.2, +S.design.disc.thickness || 6);
    const tris = []; // [ax,ay,az, bx,by,bz, cx,cy,cz]
    for (const g of polygonsYUp()) {
      const rings = [g.outer, ...g.holes];
      const flat = [];
      const holeIdx = [];
      const all = [];
      rings.forEach((r, ri) => {
        if (ri > 0) holeIdx.push(all.length);
        for (const p of r) { flat.push(p.x, p.y); all.push(p); }
      });
      const idx = earcut(flat, holeIdx);
      for (let i = 0; i < idx.length; i += 3) {
        let a = all[idx[i]], b = all[idx[i + 1]], c = all[idx[i + 2]];
        const cr = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        if (cr < 0) { const tmp = b; b = c; c = tmp; }
        tris.push([a.x, a.y, t, b.x, b.y, t, c.x, c.y, t]); // top (+z)
        tris.push([a.x, a.y, 0, c.x, c.y, 0, b.x, b.y, 0]); // bottom (-z)
      }
      for (const r of rings) {
        for (let i = 0; i < r.length; i++) {
          const a = r[i], b = r[(i + 1) % r.length];
          tris.push([a.x, a.y, 0, b.x, b.y, 0, b.x, b.y, t]);
          tris.push([a.x, a.y, 0, b.x, b.y, t, a.x, a.y, t]);
        }
      }
    }
    const buf = new ArrayBuffer(84 + tris.length * 50);
    const dv = new DataView(buf);
    const header = `Wall Spinner Designer - ${S.design.name}`.slice(0, 79);
    for (let i = 0; i < header.length; i++) dv.setUint8(i, header.charCodeAt(i) & 0x7f);
    dv.setUint32(80, tris.length, true);
    let o = 84;
    for (const v of tris) {
      const ux = v[3] - v[0], uy = v[4] - v[1], uz = v[5] - v[2];
      const wx = v[6] - v[0], wy = v[7] - v[1], wz = v[8] - v[2];
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const L = Math.hypot(nx, ny, nz) || 1;
      nx /= L; ny /= L; nz /= L;
      for (const f of [nx, ny, nz, ...v]) { dv.setFloat32(o, f, true); o += 4; }
      dv.setUint16(o, 0, true); o += 2;
    }
    return { buffer: buf, triangles: tris.length };
  };
  X.exportSTL = () => {
    const { buffer } = X.stlBuffer();
    X.download(new Blob([buffer], { type: 'model/stl' }), `${slug()}-${S.design.disc.thickness}mm.stl`);
  };

  X.scadString = () => {
    const t = S.design.disc.thickness;
    const groups = polygonsYUp();
    const parts = groups.map((g) => {
      const rings = [g.outer, ...g.holes];
      const pts = [];
      const paths = [];
      for (const r of rings) {
        const start = pts.length;
        paths.push(r.map((_, i) => start + i));
        for (const p of r) pts.push(`[${p.x.toFixed(3)},${p.y.toFixed(3)}]`);
      }
      return `  polygon(points=[${pts.join(',')}], paths=[${paths.map((p) => '[' + p.join(',') + ']').join(',')}]);`;
    });
    return `// ${S.design.name} — Wall Spinner Designer (units: mm)
thickness = ${t};
linear_extrude(height = thickness) {
${parts.join('\n')}
}
`;
  };
  X.exportSCAD = () => X.download(X.scadString(), `${slug()}.scad`, 'text/plain');

  // ---------- PNG ----------
  X.exportPNG = () => {
    const cv = Preview.renderStill(2000);
    cv.toBlob((blob) => X.download(blob, `${slug()}-preview.png`));
  };

  // ---------- Paper template (tiled, print at 100%) ----------
  X.planTiles = (opts) => {
    const info = X.cutGeometry(0.12);
    const b = bounds(info.loops);
    const paper = PAPER[opts.paper] || PAPER.letter;
    let pw = paper.w, ph = paper.h;
    if (opts.orientation === 'landscape') [pw, ph] = [ph, pw];
    const margin = 8, top = 14; // header strip
    const aw = pw - 2 * margin, ah = ph - top - margin;
    const ov = Math.min(opts.overlap == null ? 12 : opts.overlap, aw / 3, ah / 3);
    const cols = b.w <= aw ? 1 : Math.ceil((b.w - ov) / (aw - ov));
    const rows = b.h <= ah ? 1 : Math.ceil((b.h - ov) / (ah - ov));
    const totalW = cols * aw - (cols - 1) * ov, totalH = rows * ah - (rows - 1) * ov;
    const x0 = b.minX - (totalW - b.w) / 2, y0 = b.minY - (totalH - b.h) / 2;
    return { info, b, paper, pw, ph, margin, top, aw, ah, ov, cols, rows, x0, y0 };
  };

  X.printTemplate = (opts = {}) => {
    const plan = X.planTiles(opts);
    const { info, pw, ph, margin, top, aw, ah, ov, cols, rows, x0, y0 } = plan;
    const d = R.loopsPathData(info.loops);
    const R0 = S.design.disc.diameter / 2;
    const total = rows * cols;
    // registration marks live in the middle of each overlap band (shared by neighbouring pages)
    const regX = [], regY = [];
    for (let c = 1; c < cols; c++) regX.push(x0 + c * (aw - ov) + ov / 2);
    for (let r = 1; r < rows; r++) regY.push(y0 + r * (ah - ov) + ov / 2);
    const regXs = regX.length ? regX : [];
    const regYs = regY.length ? regY : [];

    let html = '';
    let n = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        n++;
        const vx = x0 + c * (aw - ov), vy = y0 + r * (ah - ov);
        let marks = '';
        const cross = (x, y) =>
          `<g stroke="#000" stroke-width="0.25"><circle cx="${x}" cy="${y}" r="2.5" fill="none"/><line x1="${x - 5}" y1="${y}" x2="${x + 5}" y2="${y}"/><line x1="${x}" y1="${y - 5}" x2="${x}" y2="${y + 5}"/></g>`;
        const xsIn = regXs.filter((x) => x >= vx && x <= vx + aw);
        const ysIn = regYs.filter((y) => y >= vy && y <= vy + ah);
        const ysAll = ysIn.length ? ysIn : [];
        const xsAll = xsIn.length ? xsIn : [];
        // marks along shared edges: at band centres, spaced along the band
        for (const x of xsAll) for (let y = vy + 15; y < vy + ah - 5; y += 60) marks += cross(x, y);
        for (const y of ysAll) for (let x = vx + 15; x < vx + aw - 5; x += 60) marks += cross(x, y);
        let bands = '';
        if (c > 0) bands += `<line x1="${vx + ov}" y1="${vy}" x2="${vx + ov}" y2="${vy + ah}" stroke="#888" stroke-width="0.2" stroke-dasharray="2 2"/>`;
        if (r > 0) bands += `<line x1="${vx}" y1="${vy + ov}" x2="${vx + aw}" y2="${vy + ov}" stroke="#888" stroke-width="0.2" stroke-dasharray="2 2"/>`;
        html += `<div class="pt-page" style="width:${pw}mm;height:${ph}mm">
  <div class="pt-head" style="left:${margin}mm;top:3mm;width:${aw}mm">
    <span><b>${escapeXml(S.design.name)}</b> — page ${n} of ${total}${total > 1 ? ` (row ${r + 1}, col ${c + 1})` : ''} · print at 100% / actual size · cut 2 (back disc is mounted flipped)</span>
    <span class="pt-scale"><span style="width:50mm"></span>50 mm</span>
  </div>
  <svg style="position:absolute;left:${margin}mm;top:${top}mm;width:${aw}mm;height:${ah}mm" viewBox="${vx} ${vy} ${aw} ${ah}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${vx}" y="${vy}" width="${aw}" height="${ah}" fill="none" stroke="#bbb" stroke-width="0.2"/>
    <circle cx="0" cy="0" r="${R0}" fill="none" stroke="#aaa" stroke-width="0.2" stroke-dasharray="3 2"/>
    <path d="${d}" fill="${opts.fill === false ? 'none' : '#e6e6e6'}" fill-rule="evenodd" stroke="#000" stroke-width="0.3"/>
    <g stroke="#000" stroke-width="0.2"><line x1="-6" y1="0" x2="6" y2="0"/><line x1="0" y1="-6" x2="0" y2="6"/></g>
    ${bands}${marks}
  </svg>
</div>`;
      }
    }
    const root = document.getElementById('print-root');
    root.innerHTML = html;
    let style = document.getElementById('print-page-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'print-page-style';
      document.head.appendChild(style);
    }
    style.textContent = `@page { size: ${pw}mm ${ph}mm; margin: 0; }`;
    setTimeout(() => window.print(), 50);
    return plan;
  };

  window.Exporter = X;
})();
