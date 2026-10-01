import * as THREE from 'three';
import { mulberry32 } from '../core/math.js';

// Small procedural textures drawn on canvases: brushing streaks for the
// satin steel, the engraved ring of type on the caseback, the lamphu leaves
// cut into the rotor, the printed name on the dial, soft masks for the
// out-of-focus leaves and the contact shadow. Nothing here is a binary asset.

function surface(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function wrap(tex, srgb = false) {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/** Fine streaks along u (lathe u runs round the case, so the satin top reads circular). */
export function brushedMap(seed = 7, size = 512) {
  const [c, g] = surface(size, size);
  const rnd = mulberry32(seed);
  g.fillStyle = 'rgb(118,118,118)';
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 2600; i++) {
    const v = 70 + rnd() * 120;
    g.fillStyle = `rgba(${v | 0},${v | 0},${v | 0},${0.25 + rnd() * 0.35})`;
    g.fillRect(rnd() * size - size * 0.5, rnd() * size, size * (0.3 + rnd() * 1.2), 0.5 + rnd() * 1.1);
  }
  return wrap(new THREE.CanvasTexture(c));
}

/** Engraved ring of type for the caseback band (planar ring UVs). Grey = surface, dark = cut. */
export function ringEngraving(text, { size = 1024, radius = 0.415, font = '400 34px "DM Mono", monospace' } = {}) {
  const [c, g] = surface(size, size);
  g.fillStyle = '#c8c8c8';
  g.fillRect(0, 0, size, size);
  g.translate(size / 2, size / 2);
  g.font = font;
  g.fillStyle = '#3a3a3a';
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  const r = radius * size;
  // Total arc of the string, then lay each glyph on the circle clockwise from the top.
  const widths = [...text].map((ch) => g.measureText(ch).width + 2);
  const total = widths.reduce((a, b) => a + b, 0);
  let a = -Math.PI / 2 - total / r / 2;
  [...text].forEach((ch, i) => {
    const w = widths[i];
    a += w / r / 2;
    g.save();
    g.rotate(a + Math.PI / 2);
    g.fillText(ch, 0, -r);
    g.restore();
    a += w / r / 2;
  });
  // A fine turned groove either side of the type.
  g.strokeStyle = '#6a6a6a';
  g.lineWidth = 2;
  for (const k of [0.355, 0.475]) {
    g.beginPath();
    g.arc(0, 0, k * size, 0, Math.PI * 2);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  return t;
}

/** Lamphu leaves cut into the rotor: narrow ovals in opposite pairs along a curved twig. */
export function rotorEngraving(size = 1024, seed = 11, withLeaves = true) {
  const [c, g] = surface(size, size);
  const rnd = mulberry32(seed);
  g.fillStyle = '#d0d0d0';
  g.fillRect(0, 0, size, size);
  // fine concentric turning on the whole rotor
  g.strokeStyle = 'rgba(150,150,150,0.35)';
  for (let r = 8; r < size * 0.7; r += 5) {
    g.lineWidth = 1 + (r % 3);
    g.beginPath();
    g.arc(size / 2, size / 2, r, 0, Math.PI * 2);
    g.stroke();
  }
  g.fillStyle = '#4a4a4a';
  g.strokeStyle = '#4a4a4a';
  // Two twigs arcing through the half-disc (rotor sits in the upper half: v < 0.5).
  const twigs = withLeaves
    ? [
      { cx: 0.5, cy: 0.5, r: 0.33, a0: Math.PI * 1.08, a1: Math.PI * 1.92 },
      { cx: 0.5, cy: 0.5, r: 0.2, a0: Math.PI * 1.15, a1: Math.PI * 1.75 },
    ]
    // The twig the cut-out leaves hang from (rotor radius 0.8 of 1.4).
    : [{ cx: 0.5, cy: 0.5, r: 0.8 / 2.8, a0: Math.PI * 1.22, a1: Math.PI * 1.78 }];
  for (const tw of twigs) {
    g.lineWidth = size * 0.006;
    g.beginPath();
    g.arc(tw.cx * size, tw.cy * size, tw.r * size, tw.a0, tw.a1);
    g.stroke();
    if (!withLeaves) continue;
    const n = tw.r > 0.3 ? 9 : 6;
    for (let i = 0; i < n; i++) {
      const a = tw.a0 + ((i + 0.5) / n) * (tw.a1 - tw.a0);
      const px = (tw.cx + Math.cos(a) * tw.r) * size;
      const py = (tw.cy + Math.sin(a) * tw.r) * size;
      for (const side of [-1, 1]) {
        g.save();
        g.translate(px, py);
        g.rotate(a + Math.PI / 2 + side * (0.75 + rnd() * 0.2));
        const len = size * (0.045 + rnd() * 0.012);
        g.beginPath();
        g.ellipse(0, -len * 0.62, len * 0.24, len * 0.62, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  return t;
}

/** Printed name under twelve o'clock (transparent canvas, cream ink). */
export function dialPrint(text, { font = '400 120px "DM Serif Display", serif', color = '#efe8cf' } = {}) {
  const [m] = surface(4, 4);
  const mg = m.getContext('2d');
  mg.font = font;
  const w = Math.ceil(mg.measureText(text).width + 40);
  const [c, g] = surface(w, 170);
  g.font = font;
  g.fillStyle = color;
  g.textBaseline = 'middle';
  g.fillText(text, 20, 88);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return { texture: t, aspect: w / 170 };
}

/**
 * Soft oval mask: an out-of-focus leaf seen against the light.
 * Alpha maps are read from the GREEN channel, so masks are drawn as opaque
 * grey levels on black (never as transparency), or the edge would be hard.
 */
export function leafMask(size = 128) {
  const [c, g] = surface(size, size);
  g.fillStyle = '#000';
  g.fillRect(0, 0, size, size);
  g.save();
  g.translate(size / 2, size / 2);
  g.scale(0.3, 0.42);
  const grad = g.createRadialGradient(0, 0, 0, 0, 0, size);
  grad.addColorStop(0, 'rgb(255,255,255)');
  grad.addColorStop(0.55, 'rgb(235,235,235)');
  grad.addColorStop(0.82, 'rgb(90,90,90)');
  grad.addColorStop(1, 'rgb(0,0,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(0, 0, size, 0, Math.PI * 2);
  g.fill();
  g.restore();
  return new THREE.CanvasTexture(c);
}

/** Radial falloff for decals: opaque grey levels (white centre, black edge), read as alpha via green. */
export function radialMask(size = 256, inner = 0.15) {
  const [c, g] = surface(size, size);
  g.fillStyle = '#000';
  g.fillRect(0, 0, size, size);
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgb(255,255,255)');
  grad.addColorStop(inner, 'rgb(225,225,225)');
  grad.addColorStop(inner + 0.3, 'rgb(110,110,110)');
  grad.addColorStop(0.8, 'rgb(28,28,28)');
  grad.addColorStop(1, 'rgb(0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

/** Tannin leather with saddle stitching, edge paint and holes, drawn over the CC0 grain. */
export async function leatherSkin(img, { holes = 0, tint = '#3b2416', size = [256, 1024], seed = 5 } = {}) {
  const [w, h] = size;
  const [c, g] = surface(w, h);
  const rnd = mulberry32(seed);
  if (img) {
    // Use a strip of the photographed grain; tile it along the strap.
    const sw = img.width * 0.3;
    for (let y = 0; y < h; y += w * 1.2) g.drawImage(img, img.width * 0.2, 0, sw, sw * 1.2, 0, y, w, w * 1.2);
  } else {
    g.fillStyle = '#6b4a33';
    g.fillRect(0, 0, w, h);
  }
  // Darken toward tannin brown (the CC0 hide is lighter than the brief's leather).
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = tint;
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'source-over';
  // Stitching: short slanted cream dashes along both edges.
  g.fillStyle = 'rgba(214,196,160,0.95)';
  const step = 13;
  for (const x of [w * 0.1, w * 0.9]) {
    for (let y = 18; y < h - 26; y += step) {
      g.save();
      g.translate(x, y);
      g.rotate(0.35);
      g.fillRect(-1.6, -3.6, 3.2, 7.2);
      g.restore();
    }
  }
  // Holes for the buckle on the long piece (towards the tip).
  for (let i = 0; i < holes; i++) {
    const y = h * (0.62 + i * 0.065);
    g.fillStyle = 'rgba(8,5,3,0.95)';
    g.beginPath();
    g.ellipse(w / 2, y, w * 0.07, w * 0.07, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(70,45,28,0.9)';
    g.lineWidth = 2;
    g.stroke();
  }
  // A little wear.
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(0,0,0,${0.04 + rnd() * 0.05})`;
    g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 6, 1 + rnd() * 30);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export async function loadImage(url) {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  try {
    await img.decode();
    return img;
  } catch {
    return null;
  }
}
