// The camera's light meter. A photographer shooting one watch in a dark
// studio meters every frame and rides the exposure so the steel never sinks
// into murk and the highlights never wash out. This reads the finished frame
// at 32 x 18 (right after it is drawn, while the drawing buffer is valid),
// in relative luminance, and returns its mean and its 5th / 95th percentiles.
// The scene uses it to keep each shot inside the brief's light target:
// exposure for the mean, and a "punch" (a tighter, brighter background pool
// and brighter speculars) when the frame lacks contrast.

const W = 32;
const H = 18;

export class Meter {
  constructor() {
    this.c = document.createElement('canvas');
    this.c.width = W;
    this.c.height = H;
    this.g = this.c.getContext('2d', { willReadFrequently: true });
    this.lum = new Float32Array(W * H);
    this.out = { mean: 0, p05: 0, p95: 0, ok: false };
    // sRGB -> linear lookup (no pow in the loop).
    this.lut = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const v = i / 255;
      this.lut[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }
    this.bg = '';
  }

  read(source) {
    const g = this.g;
    const out = this.out;
    out.ok = false;
    if (!g) return out;
    try {
      this.bg = this.bg || getComputedStyle(document.body).backgroundColor || '#000';
      g.fillStyle = this.bg;
      g.fillRect(0, 0, W, H);
      g.drawImage(source, 0, 0, W, H);
      const d = g.getImageData(0, 0, W, H).data;
      const lum = this.lum;
      const lut = this.lut;
      let sum = 0;
      for (let i = 0; i < lum.length; i++) {
        const l = 0.2126 * lut[d[i * 4]] + 0.7152 * lut[d[i * 4 + 1]] + 0.0722 * lut[d[i * 4 + 2]];
        lum[i] = l;
        sum += l;
      }
      lum.sort();
      out.mean = sum / lum.length;
      out.p05 = lum[Math.floor(lum.length * 0.05)];
      out.p95 = lum[Math.floor(lum.length * 0.95)];
      out.ok = true;
    } catch {
      out.ok = false;
    }
    return out;
  }
}
