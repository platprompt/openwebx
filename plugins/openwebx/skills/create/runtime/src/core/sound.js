import { mulberry32 } from './math.js';

// Cue engine. Sound is synthesised (no files to license or load) and starts
// off on every visit; nothing about it is remembered between visits.
//
//   ctx.sound.cue(name, { intensity, pitch })
//
// Each named cue is a small recipe: sine partials or a filtered noise band,
// shaped by an attack/release envelope. When the reader accepts the offer,
// every recipe is rendered once into an AudioBuffer with an
// OfflineAudioContext; afterwards a cue is only a buffer replay.
//   intensity  0..1.5, scales the cue's level (default 1)
//   pitch      playback-rate factor for this call (default 1)
// All output passes one gain and a soft-clip WaveShaper limiter.
// While sound is off a cue returns at once and touches nothing.
//
// Recipe fields (tune them with brief.sound.cues.<name>):
//   f         base frequency in Hz for `partials`
//   partials  [[ratio, level], ...] sine partials relative to f
//   glide     frequency factor reached at the end of the cue (1 = none)
//   noise     [lowHz, highHz] band for a noise cue (the band opens upward)
//   q         band resonance for noise cues
//   attack    seconds to full level
//   release   seconds of decay after the attack
//   level     0..1 peak level before intensity
// brief.sound.pitch shifts every recipe (0.5 = an octave down).

const RECIPES = {
  touch: { f: 1244, partials: [[1, 1], [2.76, 0.18]], attack: 0.004, release: 0.09, level: 0.16 },
  grip: { f: 174, partials: [[1, 1], [2, 0.3], [3.01, 0.12]], glide: 0.88, attack: 0.018, release: 0.3, level: 0.3 },
  'let-go': { f: 233, partials: [[1, 1], [1.502, 0.35]], glide: 1.35, attack: 0.008, release: 0.62, level: 0.26 },
  turn: { f: 131, partials: [[1, 1], [1.498, 0.45], [2.003, 0.3], [2.997, 0.1]], attack: 0.06, release: 1.9, level: 0.22 },
  pass: { noise: [260, 3200], q: 0.7, attack: 0.22, release: 0.6, level: 0.3 },
  tick: { f: 1864, partials: [[1, 1], [4.2, 0.1]], attack: 0.001, release: 0.03, level: 0.12 },
  open: { f: 196, partials: [[1, 1], [1.26, 0.5], [1.68, 0.35], [2.52, 0.15]], attack: 0.05, release: 1.3, level: 0.2 },
};
const MIN_GAP = 0.05; // seconds between two plays of the same cue

function softClip(n = 2048, drive = 1.8) {
  const curve = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(drive * x) / norm;
  }
  return curve;
}

async function renderRecipe(r, pitch, rate, seed) {
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const attack = Math.max(0.001, +r.attack || 0.01);
  const release = Math.max(0.01, +r.release || 0.2);
  const dur = attack + release * 1.4;
  const length = Math.ceil(dur * rate);
  const oc = new Offline(1, length, rate);
  const env = oc.createGain();
  const level = Math.min(1, Math.max(0, r.level ?? 0.2));
  env.gain.setValueAtTime(0, 0);
  env.gain.linearRampToValueAtTime(level, attack);
  env.gain.setTargetAtTime(0, attack, release / 4);
  env.connect(oc.destination);

  if (Array.isArray(r.partials) && r.f > 0) {
    const sum = r.partials.reduce((a, p) => a + Math.abs(p[1] ?? 1), 0) || 1;
    for (const [ratio = 1, amp = 1] of r.partials) {
      const f = r.f * ratio * pitch;
      if (!(f > 0 && f < rate / 2)) continue;
      const osc = oc.createOscillator();
      osc.frequency.setValueAtTime(f, 0);
      if (r.glide && r.glide !== 1) osc.frequency.exponentialRampToValueAtTime(f * r.glide, dur);
      const g = oc.createGain();
      g.gain.value = amp / sum;
      osc.connect(g).connect(env);
      osc.start(0);
      osc.stop(dur);
    }
  }
  if (Array.isArray(r.noise)) {
    const rnd = mulberry32(seed);
    const buf = oc.createBuffer(1, length, rate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < length; i++) d[i] = rnd() * 2 - 1;
    const src = oc.createBufferSource();
    src.buffer = buf;
    const band = oc.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = r.q ?? 0.8;
    const lo = Math.max(20, r.noise[0] * pitch);
    const hi = Math.min(rate / 2 - 100, Math.max(lo + 1, r.noise[1] * pitch));
    band.frequency.setValueAtTime(lo, 0);
    band.frequency.exponentialRampToValueAtTime(hi, attack + release * 0.5);
    src.connect(band).connect(env);
    src.start(0);
  }
  return oc.startRendering();
}

export class Sound {
  constructor(button, { labels = {}, tuning = {}, bus } = {}) {
    this.button = button;
    this.bus = bus;
    this.on = false;
    this.ctx = null;
    this.out = null;
    this.buffers = null;
    this.pitch = tuning.pitch > 0 ? tuning.pitch : 1;
    this.recipes = {};
    for (const [name, r] of Object.entries(RECIPES)) this.recipes[name] = { ...r };
    for (const [name, r] of Object.entries(tuning.cues || {})) {
      if (r && typeof r === 'object') this.recipes[name] = { ...(this.recipes[name] || {}), ...r };
    }
    this.last = {};
    for (const name of Object.keys(this.recipes)) this.last[name] = -1;

    const AC = window.AudioContext || window.webkitAudioContext;
    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    this.available = !!(AC && Offline);
    this.$label = button?.querySelector('.ox-sound__label') || button;
    this.labels = { off: labels.off || this.$label?.textContent.trim() || '', on: labels.on || '' };
    if (button && this.available) {
      button.hidden = false;
      button.addEventListener('click', () => this.set(!this.on));
    }
  }

  set(on) {
    on = !!on && this.available;
    if (on && !this.ctx) this._start(); // inside the click: browsers need a gesture
    this.on = on;
    if (this.ctx) (on ? this.ctx.resume() : this.ctx.suspend())?.catch?.(() => {});
    if (this.button) {
      this.button.setAttribute('aria-pressed', String(on));
      const text = on ? this.labels.on || this.labels.off : this.labels.off;
      if (this.$label && text) this.$label.textContent = text;
    }
    this.bus?.emit('sound', { on });
    if (on && this.buffers) this.cue('open');
  }

  _start() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    const gain = this.ctx.createGain();
    gain.gain.value = 0.85;
    const limiter = this.ctx.createWaveShaper();
    limiter.curve = softClip();
    limiter.oversample = '2x';
    gain.connect(limiter).connect(this.ctx.destination);
    this.out = gain;
    const rate = this.ctx.sampleRate;
    const names = Object.keys(this.recipes);
    Promise.all(names.map((n, i) => renderRecipe(this.recipes[n], this.pitch, rate, 97 + i).catch(() => null)))
      .then((list) => {
        const buffers = {};
        names.forEach((n, i) => list[i] && (buffers[n] = list[i]));
        this.buffers = buffers;
        if (this.on) this.cue('open');
      });
  }

  cue(name, opts) {
    if (!this.on || !this.buffers) return;
    const buf = this.buffers[name];
    if (!buf) return;
    const t = this.ctx.currentTime;
    if (t - this.last[name] < MIN_GAP) return;
    this.last[name] = t;
    const intensity = opts && opts.intensity != null ? Math.min(1.5, Math.max(0, +opts.intensity || 0)) : 1;
    const rate = opts && opts.pitch > 0 ? opts.pitch : 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = intensity;
    src.connect(g).connect(this.out);
    src.onended = () => g.disconnect();
    src.start(t);
  }

  dispose() {
    this.on = false;
    this.ctx?.close?.().catch?.(() => {});
    this.ctx = null;
  }
}
