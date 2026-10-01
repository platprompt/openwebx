import { Box3, Vector3 } from 'three';

// Anchored tags: one small label that names a scene target, placed beside
// the target's projected screen position (never beside the pointer).
//
//   ctx.tags.set(text | null, anchor, { kind: 'target' | 'hint', avoid })
//
// `anchor` is a THREE.Vector3 (world space) or a THREE.Object3D (its world
// position is read every frame, so the tag follows it). One tag at a time;
// `null` clears it. The runtime projects the anchor with the scene camera
// after each render, keeps the tag inside the stage (the canvas rect), and
// picks the side (right, left, above, below) that stays off the current
// chapter's text column, keeping its current side while that side still
// works. When every side would cover text, the tag hides instead.
//
// `avoid` (optional): an Object3D, Box3 or Sphere the tag should not cover,
// usually the object the part belongs to. Covering it costs in proportion to
// the area, so the tag takes a free side or is pushed along the edge first.
// A new text starts again from the right-hand side.
//
// Touch: a tag opened by a tap stays until the next tap; tags shown for any
// other reason (scroll-driven, a ledger row) follow the scene as on desktop.
// A chapter change clears the tag. Each new tag text is also written to a
// visually hidden polite live region. The tag element itself is aria-hidden.
//
// Hot path (update) allocates nothing per frame (the folio rect is re-read at
// most every 150 ms): positions are numbers on `this`, and
// the transform is written through a reused CSS Typed OM value where the
// browser has one, and only when the rounded position changes.

const GAP = 14; // px between the anchor point and the tag
const EDGE = 10; // px kept clear at the viewport edges
const SIDES = 4; // 0 right, 1 left, 2 above, 3 below
const OVERLAP = 1e6; // any overlap with the text column costs more than any push
const AVOID = 6; // cost per px² of covering the `avoid` object
const TAP_SLOP = 10; // px a touch may travel and still count as a tap
const TAP_WINDOW = 450; // ms after a tap in which a new tag counts as tap-opened

export class Tags {
  constructor(el, live, { enabled = true, coarse = false } = {}) {
    this.el = el;
    this.live = live;
    this.enabled = !!el && enabled;
    this.coarse = coarse;
    this.camera = null;
    this.text = null;
    this.kind = 'target';
    this.anchor = null;
    this.w = 0;
    this.h = 0;
    this.x = NaN;
    this.y = NaN;
    this.side = 0;
    this.shown = false;
    this.vw = innerWidth;
    this.vh = innerHeight;
    this.column = null;
    this.stage = null; // {x, y, w, h} canvas rect (ctx.layout.stage); null = viewport
    this.colL = 0;
    this.colR = 0;
    this.colT = 0;
    this.colB = 0;
    this.hasCol = false;
    this.folio = null; // the chapter's sticky running head: tags avoid it too
    this.fL = 0;
    this.fR = 0;
    this.fT = 0;
    this.fB = 0;
    this._folioAt = -1e9;
    this._v = new Vector3();
    this._taps = 0;
    this._tapShown = 0;
    this._tapAt = -1e9;
    this._sticky = false;
    this._cancelled = false;
    this._downX = 0;
    this._downY = 0;
    this.avoid = null;
    this._box = new Box3();
    this._p = new Vector3();
    this._aL = 0;
    this._aR = 0;
    this._aT = 0;
    this._aB = 0;
    if (!this.enabled) {
      el?.remove();
      live?.remove();
      return;
    }
    try {
      if (window.CSS && CSS.px && typeof CSSTranslate === 'function' && el.attributeStyleMap) {
        this._tx = CSS.px(0);
        this._ty = CSS.px(0);
        this._tf = new CSSTransformValue([new CSSTranslate(this._tx, this._ty)]);
      }
    } catch {
      this._tf = null;
    }
    if (coarse) {
      // A tap is a touch that ended without travelling or turning into a scroll.
      addEventListener('pointerdown', (e) => {
        this._cancelled = false;
        this._downX = e.clientX;
        this._downY = e.clientY;
      }, { passive: true });
      addEventListener('pointermove', (e) => {
        if (Math.abs(e.clientX - this._downX) + Math.abs(e.clientY - this._downY) > TAP_SLOP) this._cancelled = true;
      }, { passive: true });
      addEventListener('pointercancel', () => (this._cancelled = true), { passive: true });
      addEventListener('pointerup', () => {
        if (this._cancelled) return;
        this._taps++;
        this._tapAt = performance.now();
      }, { passive: true });
    }
  }

  // The camera the anchors are projected with (the scene's `camera`).
  attach(camera) {
    this.camera = camera || null;
    if (!this.camera) this._hide();
  }

  // Keep tags off this chapter's text column. With reading "beside" the
  // text never sits over the world, so there is no column to avoid.
  follow(section) {
    const beside = document.documentElement.dataset.reading === 'beside';
    this.column = (!beside && section?.querySelector('.ox-chapter__inner')) || null;
    this.folio = section?.querySelector('.ox-folio') || null;
    this._folioAt = -1e9;
    // A new chapter starts without a tag (a tapped one would name a part
    // through another camera).
    this.text = null;
    this.anchor = null;
    this._sticky = false;
    this._hide();
    this.measure();
  }

  // Viewport and text column, in page coordinates (read on resize/chapter change only).
  measure() {
    this.vw = innerWidth;
    this.vh = innerHeight;
    this.hasCol = false;
    if (!this.column) return;
    const r = this.column.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const y = scrollY;
    this.colL = r.left;
    this.colR = r.right;
    this.colT = r.top + y;
    this.colB = r.bottom + y;
    this.hasCol = true;
  }

  set(text, anchor, opts) {
    if (!this.enabled) return;
    if (text == null || text === '' || !anchor) {
      if (this.text === null) return;
      // On touch a tag opened by a tap stays until the reader taps again.
      if (this._sticky && this._taps === this._tapShown) return;
      this.text = null;
      this.anchor = null;
      this._sticky = false;
      this._hide();
      return;
    }
    this.anchor = anchor;
    this.avoid = (opts && opts.avoid) || null;
    const kind = (opts && opts.kind) || 'target';
    const fresh = text !== this.text || kind !== this.kind;
    if (fresh) this._sticky = false;
    // Shown (or shown again) right after a tap: it stays until the next tap.
    if (this.coarse && this._taps !== this._tapShown && performance.now() - this._tapAt < TAP_WINDOW) {
      this._sticky = true;
      this._tapShown = this._taps;
    }
    if (fresh) {
      this.side = 0;
      this.text = text;
      this.kind = kind;
      this.el.textContent = text;
      this.el.dataset.kind = kind;
      this.w = this.el.offsetWidth;
      this.h = this.el.offsetHeight;
      if (this.coarse && this.live) this.live.textContent = text;
    }
  }

  // Called by the runtime after the scene has rendered this frame.
  update() {
    if (this.text === null || !this.camera) return;
    const v = this._v;
    if (this.anchor.isObject3D) this.anchor.getWorldPosition(v);
    else v.copy(this.anchor);
    v.project(this.camera);
    if (v.z > 1 || v.z < -1 || v.x < -1 || v.x > 1 || v.y < -1 || v.y > 1) {
      this._hide();
      return;
    }
    const vw = this.vw;
    const vh = this.vh;
    const w = this.w;
    const h = this.h;
    const st = this.stage;
    const ax = st ? st.x + (v.x + 1) * 0.5 * st.w : (v.x + 1) * 0.5 * vw;
    const ay = st ? st.y + (1 - v.y) * 0.5 * st.h : (1 - v.y) * 0.5 * vh;
    const top = this.colT - scrollY;
    const bottom = this.colB - scrollY;
    // Bounds: the visible part of the stage (the whole viewport by default).
    const minX = (st ? Math.max(0, st.x) : 0) + EDGE;
    const minY = (st ? Math.max(0, st.y) : 0) + EDGE;
    const maxX = Math.max(minX, (st ? Math.min(vw, st.x + st.w) : vw) - EDGE - w);
    const maxY = Math.max(minY, (st ? Math.min(vh, st.y + st.h) : vh) - EDGE - h);
    if (ax < minX - EDGE || ax > maxX + w + EDGE || ay < minY - EDGE || ay > maxY + h + EDGE) {
      this._hide();
      return;
    }

    // The folio is sticky, so its viewport rect moves with scrolling: re-read
    // it at most every 150 ms (the only read in this path).
    const now = performance.now();
    if (this.folio && now - this._folioAt > 150) {
      this._folioAt = now;
      const r = this.folio.getBoundingClientRect();
      this.fL = r.left - 4;
      this.fR = r.right + 4;
      this.fT = r.top - 4;
      this.fB = r.bottom + 4;
    }
    // The object to keep clear: its projected screen rect.
    let hasAvoid = false;
    const av = this.avoid;
    if (av) {
      const box = this._box;
      if (av.isBox3) box.copy(av);
      else if (av.isSphere) av.getBoundingBox(box);
      else if (av.isObject3D) box.setFromObject(av);
      if (!box.isEmpty()) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        const sx = st ? st.x : 0, sy = st ? st.y : 0, sw = st ? st.w : vw, sh = st ? st.h : vh;
        for (let k = 0; k < 8; k++) {
          const q = this._p.set(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z).project(this.camera);
          if (q.z > 1) continue;
          const px = sx + (q.x + 1) * 0.5 * sw;
          const py = sy + (1 - q.y) * 0.5 * sh;
          if (px < x0) x0 = px;
          if (px > x1) x1 = px;
          if (py < y0) y0 = py;
          if (py > y1) y1 = py;
        }
        if (x1 > x0 && y1 > y0) {
          this._aL = x0;
          this._aR = x1;
          this._aT = y0;
          this._aB = y1;
          hasAvoid = true;
        }
      }
    }
    let bestCost = Infinity;
    let bestSide = this.side;
    let bestX = 0;
    let bestY = 0;
    for (let k = 0; k < SIDES; k++) {
      const s = (this.side + k) % SIDES;
      let x;
      let y;
      if (s === 0) {
        x = ax + GAP;
        y = ay - h * 0.5;
      } else if (s === 1) {
        x = ax - GAP - w;
        y = ay - h * 0.5;
      } else if (s === 2) {
        x = ax - w * 0.5;
        y = ay - GAP - h;
      } else {
        x = ax - w * 0.5;
        y = ay + GAP;
      }
      // Clamp into the stage; the push needed is part of the cost.
      const cx = x < minX ? minX : x > maxX ? maxX : x;
      const cy = y < minY ? minY : y > maxY ? maxY : y;
      let cost = Math.abs(cx - x) + Math.abs(cy - y);
      if (this.hasCol) {
        const ox = Math.min(cx + w, this.colR) - Math.max(cx, this.colL);
        const oy = Math.min(cy + h, bottom) - Math.max(cy, top);
        if (ox > 0 && oy > 0) cost += OVERLAP + ox * oy;
      }
      if (hasAvoid) {
        const ox = Math.min(cx + w, this._aR) - Math.max(cx, this._aL);
        const oy = Math.min(cy + h, this._aB) - Math.max(cy, this._aT);
        if (ox > 0 && oy > 0) cost += AVOID * ox * oy;
      }
      if (this.folio && this.fR > this.fL) {
        const ox = Math.min(cx + w, this.fR) - Math.max(cx, this.fL);
        const oy = Math.min(cy + h, this.fB) - Math.max(cy, this.fT);
        if (ox > 0 && oy > 0) cost += OVERLAP + ox * oy;
      }
      if (cost < bestCost) {
        bestCost = cost;
        bestSide = s;
        bestX = cx;
        bestY = cy;
        if (cost === 0) break; // the current side (tried first) wins while it works
      }
    }
    if (bestCost >= OVERLAP) {
      // Every side covers text or the folio: say nothing rather than sit on it.
      this._hide();
      return;
    }
    this.side = bestSide;
    const rx = Math.round(bestX);
    const ry = Math.round(bestY);
    if (rx !== this.x || ry !== this.y) {
      this.x = rx;
      this.y = ry;
      this._write(rx, ry);
    }
    if (!this.shown) {
      this.shown = true;
      this.el.classList.add('is-shown');
    }
  }

  _write(x, y) {
    if (this._tf) {
      this._tx.value = x;
      this._ty.value = y;
      this.el.attributeStyleMap.set('transform', this._tf);
    } else {
      this.el.style.transform = `translate(${x}px, ${y}px)`;
    }
  }

  // Hide without forgetting (e.g. while paper covers the world).
  hide() {
    this._hide();
  }

  _hide() {
    if (!this.shown) return;
    this.shown = false;
    this.el.classList.remove('is-shown');
  }
}
