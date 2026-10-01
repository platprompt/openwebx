import * as THREE from 'three';
import { media } from './assets.js';

// Procedural texture helpers. All textures are generated on a canvas so the
// kit ships no binary assets. Call after fonts load (App guarantees this
// before Scene.load) so Thai and display fonts rasterise correctly.

// Text rendered to a texture, for typography placed inside the 3D scene.
// Returns { texture, aspect } so a plane can be sized: new PlaneGeometry(h*aspect, h).
export function textTexture(text, {
  font = '400 120px serif',
  color = '#ffffff',
  padding = 24,
  letterSpacing = 0,
  maxWidth = 2048,
} = {}) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = font;
  if ('letterSpacing' in g) g.letterSpacing = `${letterSpacing}px`;
  const m = g.measureText(text);
  const ascent = m.actualBoundingBoxAscent || parseInt(font.match(/(\d+)px/)?.[1] || 100, 10) * 0.8;
  const descent = m.actualBoundingBoxDescent || ascent * 0.25;
  const w = Math.min(maxWidth, Math.ceil(m.width + padding * 2));
  const h = Math.ceil(ascent + descent + padding * 2);
  c.width = w;
  c.height = h;
  g.font = font;
  if ('letterSpacing' in g) g.letterSpacing = `${letterSpacing}px`;
  g.fillStyle = color;
  g.textBaseline = 'alphabetic';
  g.fillText(text, padding, padding + ascent, w - padding * 2);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture, aspect: w / h, width: w, height: h };
}

// Radial glow sprite, e.g. for stars, lanterns, bioluminescence.
export function glowTexture(size = 128, inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.25, inner.replace(/[\d.]+\)$/, '0.45)'));
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Vertical gradient, e.g. sky domes or depth fades. stops: [[0,'#000'],[1,'#123']]
export function gradientTexture(stops, height = 256) {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = height;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, height);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, height);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Load an image from the site's media/ folder with progress-friendly promise.
export function loadTexture(url) {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      media(url),
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        resolve(t);
      },
      undefined,
      reject
    );
  });
}
