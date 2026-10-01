// How the 3D world joins a page that is already readable.
//
// The article is complete in the HTML, so nothing here gates reading. The
// brief picks one of three arrivals (html[data-arrival], set by the scaffold):
//   veil        the canvas starts transparent and fades in from the page
//               colour once the scene is ready (.ox-arrived);
//   scene       the canvas is visible from the start; the scene draws its own
//               loading state from `arrival:progress` and `arrival:ready`;
//   hold-title  the head script adds .ox-hold, the hero headline's words wait,
//               and they rise when the world is ready (or after a short cap).
// There is no counter, no bar and no overlay in any mode.
//
// On ready: <main aria-busy> is cleared and the visually hidden
// .ox-status (role=status) receives the ready sentence. If the head
// failsafe already fired (.ox-failsafe: the text was shown without the
// world), a world that arrives late still fades in: .ox-failsafe gives way
// to .ox-late, which keeps every block of text visible.

const MODES = ['veil', 'scene', 'hold-title'];

export class Arrival {
  constructor({ mode, bus, sentence = '' }) {
    this.mode = MODES.includes(mode) ? mode : 'veil';
    this.bus = bus;
    this.sentence = sentence;
    this.progress = 0;
    this.done = false;
    this.shown = false;
    this._emitted = 0;
    this.root = document.documentElement;
    this.main = document.getElementById('content');
    this.status = document.querySelector('.ox-status');
  }

  // True once the head failsafe has given up on the world for this visit.
  get late() {
    return this.root.classList.contains('ox-failsafe');
  }

  // Monotonic load progress (0..1). Emitted on the bus in steps of >= 1%.
  set(fraction) {
    if (this.done) return;
    const f = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
    if (!(f > this.progress)) return;
    this.progress = f;
    if (f === 1 || f - this._emitted >= 0.01) {
      this._emitted = f;
      this.bus.emit('arrival:progress', f);
    }
  }

  // The runtime is done loading. `world` is false when there is no scene
  // (no WebGL, or the scene failed): the text simply stays as it is.
  // Returns whether the world is shown.
  ready(world = true) {
    if (this.done) return this.shown;
    this.set(1);
    this.done = true;
    this.shown = !!world;
    this.wasLate = this.shown && this.late;
    this.root.classList.remove('ox-hold');
    if (this.wasLate) {
      // Swap the classes first, then fade on the next frames so the canvas
      // transitions from transparent instead of popping in.
      this.root.classList.add('ox-late');
      this.root.classList.remove('ox-failsafe');
      requestAnimationFrame(() => requestAnimationFrame(() => this.root.classList.add('ox-arrived')));
    } else if (this.shown) this.root.classList.add('ox-arrived');
    this.main?.removeAttribute('aria-busy');
    if (this.shown && this.status && this.sentence) this.status.textContent = this.sentence;
    this.bus.emit('arrival:ready', { world: this.shown });
    return this.shown;
  }
}
