// requestAnimationFrame loop with clamped delta, tab-visibility pause,
// an FPS estimate, and a sustained-low-FPS signal for adaptive quality.

export class Loop {
  constructor(tick, { onSlow } = {}) {
    this.tick = tick;
    this.onSlow = onSlow;
    this.running = false;
    this.time = 0;
    this.frames = 0;
    this.fps = 60;
    this.slowFrames = 0;
    this.last = 0;
    this._raf = 0;
    this._frame = this._frame.bind(this);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stop();
      else this.start();
    });
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this._raf = requestAnimationFrame(this._frame);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
  }

  _frame(now) {
    if (!this.running) return;
    const raw = (now - this.last) / 1000;
    this.last = now;
    // Clamp so a long GC pause or tab switch never produces a physics jump.
    const dt = Math.min(Math.max(raw, 0), 1 / 20);
    this.time += dt;
    this.frames++;
    if (raw > 0) this.fps += (1 / raw - this.fps) * 0.05;

    // Ignore the first seconds (shader compile, font swap) before judging.
    if (this.time > 3 && this.onSlow) {
      this.slowFrames = this.fps < 40 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 2);
      if (this.slowFrames > 90) {
        this.slowFrames = 0;
        this.onSlow(this.fps);
      }
    }

    this.tick(this.time, dt);
    this._raf = requestAnimationFrame(this._frame);
  }
}
