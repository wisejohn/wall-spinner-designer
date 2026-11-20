/* Trace image: a reference picture shown under (or over) the editor so you can trace it.
 * Kept outside the design's undo history (images are large). Persisted separately in
 * localStorage and optionally embedded in saved design files.
 *
 * Placement (mm, disc space): image centre at (x, y), rotated by rot (degrees),
 * displayed width = size mm (height follows the aspect ratio).
 */
(function () {
  const { S } = WS;
  const KEY = 'wall-spinner-designer:reference';
  const MAX_DIM = 2000;
  const Ref = {};
  let img = null;

  S.ref = null;

  const persist = () => {
    try {
      if (S.ref) localStorage.setItem(KEY, JSON.stringify(Ref.toJSON()));
      else localStorage.removeItem(KEY);
    } catch (e) { /* quota or storage blocked: image just won't survive reload */ }
  };

  Ref.changed = (save = true) => {
    if (save) persist();
    WS.emit('reference');
  };

  Ref.toJSON = () => {
    if (!S.ref) return null;
    const { src, w, h, x, y, size, rot, opacity, visible, onTop, include } = S.ref;
    return { src, w, h, x, y, size, rot, opacity, visible, onTop, include };
  };

  Ref.image = () => (S.ref && img && img.complete ? img : null);

  // Load from a data URL (already sized) + optional placement
  Ref.set = (data) => {
    if (!data || !data.src) { Ref.clear(); return Promise.resolve(); }
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => {
        img = im;
        const D = S.design.disc.diameter;
        S.ref = Object.assign(
          { x: 0, y: 0, size: D, rot: 0, opacity: 0.6, visible: true, onTop: true, include: true },
          data,
          { w: im.naturalWidth, h: im.naturalHeight }
        );
        Ref.changed();
        resolve();
      };
      im.onerror = () => reject(new Error('Could not read that image'));
      im.src = data.src;
    });
  };

  Ref.clear = () => {
    S.ref = null;
    img = null;
    Ref.changed();
  };

  // Import an image File/Blob: downscale to keep storage sane, fit to the disc.
  Ref.loadFile = (file) =>
    new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => {
        const k = Math.min(1, MAX_DIM / Math.max(im.naturalWidth, im.naturalHeight));
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(im.naturalWidth * k));
        cv.height = Math.max(1, Math.round(im.naturalHeight * k));
        const c = cv.getContext('2d');
        c.fillStyle = '#fff'; // flatten transparency onto white (multiply-friendly)
        c.fillRect(0, 0, cv.width, cv.height);
        c.drawImage(im, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        const src = cv.toDataURL('image/jpeg', 0.9);
        Ref.set({ src, x: 0, y: 0, size: S.design.disc.diameter, rot: 0 }).then(resolve, reject);
      };
      im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Not an image the browser can read')); };
      im.src = url;
    });

  Ref.fit = () => {
    const r = S.ref;
    if (!r) return;
    // larger side spans the disc diameter
    const aspect = r.h / r.w;
    r.size = S.design.disc.diameter / Math.max(1, aspect);
    r.x = 0; r.y = 0; r.rot = 0;
    Ref.changed();
  };

  // ---- pick-to-align: P is the clicked point in disc space (mm) ----
  Ref.pickCentre = (P) => {
    const r = S.ref;
    r.x -= P.x;
    r.y -= P.y;
    Ref.changed();
  };
  Ref.pickRim = (P) => {
    const r = S.ref;
    const d = Math.hypot(P.x, P.y);
    if (d < 1e-3) return;
    const k = S.design.disc.diameter / 2 / d;
    r.size *= k; r.x *= k; r.y *= k;
    Ref.changed();
  };
  Ref.pickArm = (P) => {
    const r = S.ref;
    if (Math.hypot(P.x, P.y) < 1e-3) return;
    const th = Math.atan2(P.x, -P.y); // angle from 12 o'clock, clockwise
    const p = G.rotate({ x: r.x, y: r.y }, -th);
    r.x = p.x; r.y = p.y;
    r.rot = ((((r.rot - (th * 180) / Math.PI) % 360) + 540) % 360) - 180;
    Ref.changed();
  };

  // Draw in disc space. ctx must already carry the disc transform.
  Ref.draw = (ctx) => {
    const r = S.ref, im = Ref.image();
    if (!r || !im || !r.visible) return;
    const w = r.size, h = (r.size * r.h) / r.w;
    ctx.save();
    ctx.globalAlpha = r.opacity;
    if (r.onTop) ctx.globalCompositeOperation = 'multiply';
    ctx.translate(r.x, r.y);
    ctx.rotate((r.rot * Math.PI) / 180);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(im, -w / 2, -h / 2, w, h);
    ctx.restore();
  };

  Ref.init = () => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Ref.set(JSON.parse(raw)).catch(() => {});
    } catch (e) { /* ignore */ }
  };

  window.Reference = Ref;
})();
