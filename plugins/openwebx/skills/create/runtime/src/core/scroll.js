import { clamp, damp } from './math.js';

// Scroll stays native (keyboard, screen readers, find-in-page and crawlers all
// keep working). The scene gets a smoothed, inertial reading of it instead:
//   progress  0..1 over the whole page
//   story     0..N float: chapter index + progress inside that chapter
//   velocity  smoothed px/s, signed
// Scenes should drive cameras from `story`, not from raw scrollY.

export class Scroll {
  constructor(chapterEls, motion) {
    this.els = chapterEls;
    this.motion = motion;
    this.count = chapterEls.length;
    this.raw = 0;
    this.progress = 0;
    this.story = 0;
    this.storyTarget = 0;
    this.velocity = 0;
    this.chapter = 0;
    this.chapterProgress = 0;
    this._lastY = window.scrollY;
    this.measure();
  }

  measure() {
    const y = window.scrollY;
    this.tops = this.els.map((el) => el.getBoundingClientRect().top + y);
    this.heights = this.els.map((el) => el.offsetHeight || 1);
    this.max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    // The reading line: the middle of the viewport, or of the part below the
    // world when reading "beside" stacks the world on top (small screens).
    this.line = window.innerHeight * 0.5;
    if (document.documentElement.dataset.reading === 'beside') {
      const r = document.querySelector('.ox-stage')?.getBoundingClientRect();
      if (r && r.top <= 1 && r.width >= window.innerWidth * 0.9 && r.bottom < window.innerHeight * 0.9) {
        this.line = (r.bottom + window.innerHeight) * 0.5;
      }
    }
  }

  // Map a scrollY to the continuous chapter coordinate.
  storyAt(y) {
    if (!this.count) return 0;
    const probe = y + this.line;
    let i = 0;
    for (let k = 0; k < this.count; k++) if (probe >= this.tops[k]) i = k;
    const local = clamp((probe - this.tops[i]) / this.heights[i]);
    return i + local;
  }

  update(dt) {
    const y = window.scrollY;
    const instant = (y - this._lastY) / Math.max(dt, 1e-3);
    this._lastY = y;
    this.raw = clamp(y / this.max);
    this.storyTarget = this.storyAt(y);

    const k = this.motion.reduced ? 30 : 5.5;
    this.progress = damp(this.progress, this.raw, k, dt);
    this.story = damp(this.story, this.storyTarget, k, dt);
    this.velocity = damp(this.velocity, instant, 6, dt);

    this.chapter = Math.min(this.count - 1, Math.floor(this.story + 1e-4));
    this.chapterProgress = this.story - this.chapter;
    return this;
  }

  snapshot() {
    return {
      progress: this.progress,
      raw: this.raw,
      story: this.story,
      velocity: this.velocity,
      chapter: Math.max(0, this.chapter),
      chapterProgress: this.chapterProgress,
      chapterCount: this.count,
    };
  }
}
