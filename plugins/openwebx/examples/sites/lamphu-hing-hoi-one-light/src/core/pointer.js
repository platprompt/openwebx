import { damp } from './math.js';

// Normalised pointer state for scenes.
//   x, y     raw NDC (-1..1, y up)
//   sx, sy   smoothed NDC (use for parallax)
//   vx, vy   smoothed velocity in NDC/s (use for trails, stretch)
//   down     primary button / touch held
//   hold     seconds held (use for charge-up interactions)
//   idle     seconds since last movement (use for "evolve while idle")
//   px, py   CSS pixels (viewport)
// x/y are relative to the stage (the canvas rect, `pointer.area`), so they
// stay right when the world takes only one side of the page.
// Touch has no hover: `inside` turns false half a second after a finger
// lifts (long enough for a tap to name what it touched) and at once when a
// touch turns into a scroll, so an old touch point never hovers later shots.

const TOUCH_LINGER = 0.5; // s

export class Pointer {
  constructor(bus, motion) {
    this.bus = bus;
    this.motion = motion;
    Object.assign(this, { x: 0, y: 0, sx: 0, sy: 0, vx: 0, vy: 0, px: innerWidth / 2, py: innerHeight / 2 });
    this.down = false;
    this.hold = 0;
    this.idle = 0;
    this.inside = false;
    this._leave = 0; // s until a lifted touch stops counting as inside
    this._prev = { x: 0, y: 0 };
    this.area = null; // {x, y, w, h}; null = the whole viewport

    const move = (e) => {
      this.px = e.clientX;
      this.py = e.clientY;
      const a = this.area;
      const ax = a ? a.x : 0;
      const ay = a ? a.y : 0;
      const aw = a && a.w ? a.w : innerWidth;
      const ah = a && a.h ? a.h : innerHeight;
      this.x = ((e.clientX - ax) / aw) * 2 - 1;
      this.y = -((e.clientY - ay) / ah) * 2 + 1;
      this.idle = 0;
      this.inside = true;
      this._leave = 0;
    };
    addEventListener('pointermove', move, { passive: true });
    addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      move(e);
      // Presses on real UI (links, buttons, form fields, text) belong to the UI.
      const onUi = e.target.closest('a, button, input, textarea, select, label, [data-no-scene]');
      if (onUi) return;
      this.down = true;
      this.hold = 0;
      bus.emit('press', { x: this.x, y: this.y, px: this.px, py: this.py });
    });
    addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch') this._leave = TOUCH_LINGER;
      if (!this.down) return;
      this.down = false;
      bus.emit('release', { x: this.x, y: this.y, hold: this.hold });
    });
    // On touch screens a press that turns into a scroll is cancelled by the
    // browser: that is not a release, so scenes must not fire release effects.
    addEventListener('pointercancel', (e) => {
      if (e.pointerType === 'touch') this.inside = false;
      if (!this.down) return;
      this.down = false;
      bus.emit('cancel', { x: this.x, y: this.y });
    });
    document.documentElement.addEventListener('mouseleave', () => (this.inside = false));
  }

  update(dt) {
    const k = this.motion.reduced ? 25 : 7;
    const psx = this.sx, psy = this.sy;
    this.sx = damp(this.sx, this.x, k, dt);
    this.sy = damp(this.sy, this.y, k, dt);
    this.vx = damp(this.vx, (this.sx - psx) / Math.max(dt, 1e-3), 8, dt);
    this.vy = damp(this.vy, (this.sy - psy) / Math.max(dt, 1e-3), 8, dt);
    if (this.down) this.hold += dt;
    if (this._leave > 0 && (this._leave -= dt) <= 0) this.inside = false;
    this.idle += dt;
    return this;
  }

  snapshot() {
    const { x, y, sx, sy, vx, vy, px, py, down, hold, idle, inside } = this;
    return { x, y, sx, sy, vx, vy, px, py, down, hold, idle, inside };
  }
}
