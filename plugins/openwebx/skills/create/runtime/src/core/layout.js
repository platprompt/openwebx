import { Box3, Sphere, Vector3 } from 'three';

// Where the text is, so the camera can frame the subject in the free space.
//
//   ctx.layout.free                 the current free area: the stage (canvas)
//                                   minus the text column(s), paper and a
//                                   margin, as {x, y, w, h} in CSS px plus
//                                   ndc {x0, y0, x1, y1} (stage NDC, y up)
//   ctx.layout.frame(camera, target, { fill = 0.55, bleed = false })
//                                   -> { shiftX, shiftY, distanceScale }
//   ctx.layout.subject(target)      declare the chapter's subject (for QA)
//   ctx.layout.stage                the canvas rect {x, y, w, h}
//   ctx.layout.paused               true while paper covers the viewport
//
// Measured on chapter change, resize, font load and at most every 100 ms
// while scrolling; never per frame. frame() allocates nothing.
//
// Quiet zone: `quietRects` (Float32Array, up to 3 rects as UV x0, y0, x1, y1,
// y up) and `quietCount` describe the text sitting over the world; the
// camera finish (createPost) darkens, softens and desaturates only there.
// Scenes without it get the .ox-quiet CSS layer (html.ox-quiet-css).
//
// With ?ox-qa in the URL the runtime also fills probe.layout / probe.light
// (see probe.js); visitors pay nothing for it.

const MARGIN = 24; // px kept between text and the free area
const MAX_BLOCKS = 3;
const PAPER = ['paper', 'spread', 'ledger'];

function rect() {
  return { x: 0, y: 0, w: 0, h: 0 };
}

export class Layout {
  constructor({ sections, canvas, brief = {}, probe, qa = false }) {
    this.sections = sections;
    this.canvas = canvas;
    this.probe = probe;
    this.qa = qa;
    this.reading = brief.reading || document.documentElement.dataset.reading || 'overlay';
    this.chapters = brief.chapters || [];
    this.index = 0;
    this.stage = rect();
    this.free = { x: 0, y: 0, w: 0, h: 0, ndc: { x0: -1, y0: -1, x1: 1, y1: 1 } };
    // Rects that cover the world (text columns and paper), viewport px.
    this.blocks = [rect(), rect(), rect()];
    this.blockCount = 0;
    this._isText = [false, false, false];
    this.quietRects = new Float32Array(MAX_BLOCKS * 4);
    this.quietCount = 0;
    this.postQuiet = false; // set by createPost when it draws the quiet zone
    this.paused = false;
    this.camera = null;
    this._subject = null;
    this._lastY = NaN;
    this._lastMeasure = -1e9;
    this._lastProbe = -1e9;
    this._out = { shiftX: 0, shiftY: 0, distanceScale: 1 };
    this._sphere = new Sphere();
    this._box = new Box3();
    this._v = new Vector3();
    this._cam = new Vector3();
    this._cut = 0;
    this._watchPaper();
    this.measure();
  }

  attach(camera) {
    this.camera = camera || null;
  }

  setChapter(i) {
    this.index = i;
    this.measure();
  }

  subject(target) {
    this._subject = target || null;
  }

  // Called every frame by the runtime; measures only when due.
  tick(now) {
    const y = scrollY;
    if (y !== this._lastY && now - this._lastMeasure >= 100) this.measure(now);
    if (this.qa && now - this._lastProbe >= 250) {
      this._lastProbe = now;
      this._probeSubject();
    }
  }

  measure(now = performance.now()) {
    this._lastMeasure = now;
    this._lastY = scrollY;
    const vw = innerWidth;
    const vh = innerHeight;
    const st = this.stage;
    const r = this.canvas && this.canvas.isConnected ? this.canvas.getBoundingClientRect() : null;
    if (r && r.width && r.height) {
      st.x = r.left;
      st.y = r.top;
      st.w = r.width;
      st.h = Math.min(r.height, vh - r.top);
    } else {
      st.x = 0;
      st.y = 0;
      st.w = vw;
      st.h = vh;
    }

    // Collect what covers the world in the viewport: paper sections whole,
    // text columns (and folios) of the others. Keep the largest three.
    // With reading "beside" nothing does: the text sits beside the world, or
    // (small screens) scrolls under it.
    let count = 0;
    for (let k = 0; this.reading !== 'beside' && k < this.sections.length; k++) {
      const s = this.sections[k];
      const sr = s.getBoundingClientRect();
      if (sr.bottom <= 0 || sr.top >= vh) continue;
      const paper = PAPER.includes(s.dataset.composition);
      const el = paper ? s : s.querySelector('.ox-chapter__inner');
      if (!el) continue;
      const er = paper ? sr : el.getBoundingClientRect();
      const x0 = Math.max(0, er.left);
      const y0 = Math.max(0, er.top);
      const x1 = Math.min(vw, er.right);
      const y1 = Math.min(vh, er.bottom);
      if (x1 - x0 < 2 || y1 - y0 < 2) continue;
      const area = (x1 - x0) * (y1 - y0);
      let slot = count < MAX_BLOCKS ? count++ : -1;
      if (slot < 0) {
        // replace the smallest block if this one is larger
        let min = Infinity;
        for (let j = 0; j < MAX_BLOCKS; j++) {
          const a = this.blocks[j].w * this.blocks[j].h;
          if (a < min) {
            min = a;
            slot = j;
          }
        }
        if (area <= min) continue;
      }
      const b = this.blocks[slot];
      b.x = x0;
      b.y = y0;
      b.w = x1 - x0;
      b.h = y1 - y0;
      this._isText[slot] = !paper;
    }
    this.blockCount = count;

    // Free area: start from the stage and cut each block away (largest first),
    // keeping the largest remaining strip each time.
    const f = this.free;
    f.x = st.x;
    f.y = st.y;
    f.w = st.w;
    f.h = st.h;
    for (let pass = 0; pass < count; pass++) {
      let bi = -1;
      let best = -1;
      for (let j = 0; j < count; j++) {
        const a = this.blocks[j].w * this.blocks[j].h;
        if (a > best && !(this._cut & (1 << j))) {
          best = a;
          bi = j;
        }
      }
      this._cut |= 1 << bi;
      this._subtract(this.blocks[bi]);
    }
    this._cut = 0;
    const n = f.ndc;
    n.x0 = ((f.x - st.x) / st.w) * 2 - 1;
    n.x1 = ((f.x + f.w - st.x) / st.w) * 2 - 1;
    n.y1 = 1 - ((f.y - st.y) / st.h) * 2;
    n.y0 = 1 - ((f.y + f.h - st.y) / st.h) * 2;

    // Quiet rects: text over the world only (UV of the stage, y up).
    let q = 0;
    if (this.reading !== 'beside') {
      for (let j = 0; j < count; j++) {
        if (!this._isText[j]) continue;
        const b = this.blocks[j];
        const o = q * 4;
        this.quietRects[o] = (b.x - st.x) / st.w;
        this.quietRects[o + 1] = 1 - (b.y + b.h - st.y) / st.h;
        this.quietRects[o + 2] = (b.x + b.w - st.x) / st.w;
        this.quietRects[o + 3] = 1 - (b.y - st.y) / st.h;
        q++;
      }
    }
    this.quietCount = q;
  }

  _subtract(b) {
    const f = this.free;
    const bx0 = b.x - MARGIN;
    const by0 = b.y - MARGIN;
    const bx1 = b.x + b.w + MARGIN;
    const by1 = b.y + b.h + MARGIN;
    const fx1 = f.x + f.w;
    const fy1 = f.y + f.h;
    if (bx1 <= f.x || bx0 >= fx1 || by1 <= f.y || by0 >= fy1) return;
    // Four strips around the block, inside the current free rect.
    const lw = Math.max(0, bx0 - f.x);
    const rw = Math.max(0, fx1 - bx1);
    const th = Math.max(0, by0 - f.y);
    const bh = Math.max(0, fy1 - by1);
    const la = lw * f.h;
    const ra = rw * f.h;
    const ta = th * f.w;
    const ba = bh * f.w;
    const m = Math.max(la, ra, ta, ba);
    if (m <= 0) {
      // Nothing left: keep a small centre area so frame() stays defined.
      f.x += f.w * 0.4;
      f.y += f.h * 0.4;
      f.w *= 0.2;
      f.h *= 0.2;
    } else if (m === ra) {
      f.x = bx1;
      f.w = rw;
    } else if (m === la) {
      f.w = lw;
    } else if (m === ba) {
      f.y = by1;
      f.h = bh;
    } else {
      f.h = th;
    }
  }

  // Lens shift and distance that centre `target` in the free area at `fill`.
  // The scene damps toward these, then writes
  //   camera.projectionMatrix.elements[8] = shiftX; elements[9] = shiftY;
  //   camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  // and moves the camera to (distance to target) * distanceScale.
  frame(camera, target, opts) {
    const out = this._out;
    const fill = opts && opts.fill > 0 ? opts.fill : 0.55;
    const bleed = !!(opts && opts.bleed);
    const s = this._sphere;
    if (!target) return out;
    if (target.isSphere) s.copy(target);
    else if (target.isBox3) target.getBoundingSphere(s);
    else if (target.isObject3D) {
      this._box.setFromObject(target);
      if (this._box.isEmpty()) {
        target.getWorldPosition(s.center);
        s.radius = 0.5;
      } else this._box.getBoundingSphere(s);
    } else if (target.isVector3) {
      s.center.copy(target);
      s.radius = 0.5;
    }
    const n = this.free.ndc;
    out.shiftX = -(n.x0 + n.x1) * 0.5;
    out.shiftY = -(n.y0 + n.y1) * 0.5;
    out.distanceScale = 1;
    if (camera && camera.isPerspectiveCamera && s.radius > 0) {
      this._cam.setFromMatrixPosition(camera.matrixWorld);
      const d = this._cam.distanceTo(s.center);
      const tanH = Math.tan((camera.fov * Math.PI) / 360) / (camera.zoom || 1);
      const fw = Math.max(0.05, n.x1 - n.x0);
      const fh = Math.max(0.05, n.y1 - n.y0);
      const dy = (2 * s.radius) / (tanH * fill * fh);
      const dx = (2 * s.radius) / (tanH * camera.aspect * fill * fw);
      const want = bleed ? Math.min(dx, dy) : Math.max(dx, dy);
      if (d > 1e-6) out.distanceScale = want / d;
    }
    return out;
  }

  // --- paper pause: an opaque paper section covers the whole viewport.
  _watchPaper() {
    if (this.reading === 'beside' || !('IntersectionObserver' in window)) return;
    const papers = this.sections.filter((s) => PAPER.includes(s.dataset.composition));
    if (!papers.length) return;
    const top = new Set();
    const bottom = new Set();
    const update = () => {
      let t = -1;
      let b = -1;
      top.forEach((s) => (t = Math.max(t, this.sections.indexOf(s))));
      bottom.forEach((s) => (b = Math.max(b, this.sections.indexOf(s))));
      let covered = t >= 0 && b >= t;
      for (let k = t; covered && k <= b; k++) covered = PAPER.includes(this.sections[k].dataset.composition);
      this.paused = covered;
    };
    // Two thin bands: the top and the bottom 1% of the viewport.
    const band = (set, margin) =>
      new IntersectionObserver(
        (entries) => {
          for (const e of entries) e.isIntersecting ? set.add(e.target) : set.delete(e.target);
          update();
        },
        { rootMargin: margin }
      );
    const a = band(top, '0px 0px -99% 0px');
    const c = band(bottom, '-99% 0px 0px 0px');
    papers.forEach((s) => {
      a.observe(s);
      c.observe(s);
    });
  }

  // --- QA probe (only with ?ox-qa)
  _probeSubject() {
    const p = this.probe;
    if (!p || !p.layout || !this._subject || !this.camera) return;
    const paper = PAPER.includes(this.sections[this.index]?.dataset.composition);
    if (this.paused) {
      // Paper covers the world: say so instead of leaving the chapter blank.
      if (!p.layout[this.index]) p.layout[this.index] = { covered: true, paper, frame: this.chapters[this.index]?.frame || 'fit' };
      return;
    }
    const box = this._box;
    const t = this._subject;
    if (t.isBox3) box.copy(t);
    else if (t.isSphere) t.getBoundingBox(box);
    else if (t.isObject3D) box.setFromObject(t);
    else return;
    if (box.isEmpty()) return;
    const st = this.stage;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let k = 0; k < 8; k++) {
      this._v.set(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z).project(this.camera);
      if (this._v.z > 1) continue;
      const sx = st.x + ((this._v.x + 1) / 2) * st.w;
      const sy = st.y + ((1 - this._v.y) / 2) * st.h;
      x0 = Math.min(x0, sx);
      y0 = Math.min(y0, sy);
      x1 = Math.max(x1, sx);
      y1 = Math.max(y1, sy);
    }
    if (!(x1 > x0 && y1 > y0)) return;
    const area = (x1 - x0) * (y1 - y0);
    const ix = Math.max(0, Math.min(x1, innerWidth) - Math.max(x0, 0));
    const iy = Math.max(0, Math.min(y1, innerHeight) - Math.max(y0, 0));
    let covered = 0;
    const text = [];
    for (let j = 0; j < this.blockCount; j++) {
      const b = this.blocks[j];
      text.push({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) });
      const ox = Math.max(0, Math.min(x1, b.x + b.w) - Math.max(x0, b.x));
      const oy = Math.max(0, Math.min(y1, b.y + b.h) - Math.max(y0, b.y));
      covered += ox * oy;
    }
    p.layout[this.index] = {
      subject: { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) },
      text,
      overlap: +Math.min(1, covered / area).toFixed(3),
      visible: +((ix * iy) / area).toFixed(3),
      paper,
      frame: this.chapters[this.index]?.frame || 'fit',
    };
  }
}

// Relative luminance of a 32x18 downsample of the canvas, taken right after a
// render (the drawing buffer is still valid in the same task). QA only.
export function createLightMeter(probe) {
  if (!probe || !probe.light) return null;
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 18;
  const g = c.getContext('2d', { willReadFrequently: true });
  const lum = new Float32Array(32 * 18);
  const lin = (v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  let last = -1e9;
  let page = '';
  return (source, chapter, now) => {
    if (!g || now - last < 1000) return;
    last = now;
    try {
      // The canvas may be transparent: measure it over the page colour.
      page = page || getComputedStyle(document.body).backgroundColor || '#000';
      g.fillStyle = page;
      g.fillRect(0, 0, 32, 18);
      g.drawImage(source, 0, 0, 32, 18);
      const d = g.getImageData(0, 0, 32, 18).data;
      let sum = 0;
      for (let i = 0; i < lum.length; i++) {
        const l = 0.2126 * lin(d[i * 4]) + 0.7152 * lin(d[i * 4 + 1]) + 0.0722 * lin(d[i * 4 + 2]);
        lum[i] = l;
        sum += l;
      }
      lum.sort();
      probe.light[chapter] = {
        mean: +(sum / lum.length).toFixed(3),
        p05: +lum[Math.floor(lum.length * 0.05)].toFixed(3),
        p95: +lum[Math.floor(lum.length * 0.95)].toFixed(3),
      };
    } catch (err) {
      probe.warn?.(`light meter: ${err?.message || err}`);
    }
  };
}
