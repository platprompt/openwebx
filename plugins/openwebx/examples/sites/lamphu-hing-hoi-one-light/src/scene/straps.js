import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { smoothstep } from '../core/math.js';

// Straps. Units are centimetres; the watch lies with twelve o'clock towards
// -z, so every strap runs along z. One generator sweeps a rounded-rectangle
// section along a path in the y/z plane: the tannin leather (with a second
// shape for the watch lying face down, used as a morph target so the strap
// settles flat on the slab when the watch is turned over), the FKM rubber
// strap, and the bed of the five-row steel bracelet.

const SECTION = 26;

/** Rounded-rectangle section (superellipse), x across the width, y through the thickness. */
function section(w, t, out, round = 0.22) {
  for (let i = 0; i < SECTION; i++) {
    const a = (i / SECTION) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    out[i * 2] = (w / 2) * Math.sign(c) * Math.pow(Math.abs(c), round);
    out[i * 2 + 1] = (t / 2) * Math.sign(s) * Math.pow(Math.abs(s), round + 0.08);
  }
  return out;
}

/**
 * Sweep a strap piece.
 *   len, w0 -> w1 (width at lug -> tip), t0 -> t1 (thickness)
 *   paths: [fn(s) -> {y, z}] one per shape (first is the base, the rest morph targets)
 *   dir: +1 runs towards +z (six o'clock), -1 towards -z (twelve o'clock)
 *   edge: vertex colour on the cut edges (edge paint)
 */
export function strapGeometry({ len, w0, w1, t0, t1, paths, dir = 1, segs = 72, edge = 0.4, roundTip = true, round = 0.22 }) {
  const rows = segs + 1;
  const count = rows * SECTION + 1; // + tip centre
  const uv = new Float32Array(count * 2);
  const col = new Float32Array(count * 3);
  const sec = new Float32Array(SECTION * 2);
  const index = [];
  const shapes = paths.map(() => new Float32Array(count * 3));
  const p0 = { y: 0, z: 0 };
  const p1 = { y: 0, z: 0 };

  for (let k = 0; k < rows; k++) {
    const f = k / segs;
    const s = f * len;
    let w = THREE.MathUtils.lerp(w0, w1, smoothstep(0.15, 1, f));
    const t = THREE.MathUtils.lerp(t0, t1, f);
    if (roundTip) {
      const rTip = w1 / 2;
      const into = s - (len - rTip);
      if (into > 0) w *= Math.sqrt(Math.max(0.02, 1 - (into / rTip) ** 2));
    }
    section(w, t, sec, round);
    paths.forEach((path, m) => {
      const a = path(s, p0);
      const b = path(Math.min(len, s + 0.02), p1);
      const c = s + 0.02 > len ? path(s - 0.02, p1) : null;
      let ty;
      let tz;
      if (c) {
        ty = a.y - c.y;
        tz = a.z - c.z;
      } else {
        ty = b.y - a.y;
        tz = b.z - a.z;
      }
      const l = Math.hypot(ty, tz) || 1;
      ty /= l;
      tz /= l;
      // Normal of the strap's top face: perpendicular to the path, pointing up.
      const ny = tz;
      const nz = -ty;
      const ay = a.y;
      const az = a.z;
      const out = shapes[m];
      for (let i = 0; i < SECTION; i++) {
        const x = sec[i * 2];
        const yy = sec[i * 2 + 1];
        const o = (k * SECTION + i) * 3;
        out[o] = x;
        out[o + 1] = ay + ny * yy;
        out[o + 2] = (az + nz * yy) * dir;
      }
    });
    for (let i = 0; i < SECTION; i++) {
      const x = sec[i * 2];
      const yy = sec[i * 2 + 1];
      const v = k * SECTION + i;
      uv[v * 2] = THREE.MathUtils.clamp(x / Math.max(w, 1e-3) + 0.5, 0, 1);
      uv[v * 2 + 1] = f;
      // Edge paint: darker and denser on the cut sides, grain colour on top and bottom.
      const side = smoothstep(0.55, 0.95, Math.abs(x) / (w / 2)) * (1 - smoothstep(0.7, 1, Math.abs(yy) / (t / 2)) * 0.4);
      const c = 1 - side * (1 - edge);
      col[v * 3] = col[v * 3 + 1] = col[v * 3 + 2] = c;
    }
  }
  // Tip centre (closes the rounded end).
  const tip = rows * SECTION;
  paths.forEach((path, m) => {
    const a = path(len, p0);
    shapes[m][tip * 3] = 0;
    shapes[m][tip * 3 + 1] = a.y;
    shapes[m][tip * 3 + 2] = a.z * dir;
  });
  uv[tip * 2] = 0.5;
  uv[tip * 2 + 1] = 1;
  col[tip * 3] = col[tip * 3 + 1] = col[tip * 3 + 2] = 1;

  for (let k = 0; k < segs; k++) {
    for (let i = 0; i < SECTION; i++) {
      const a = k * SECTION + i;
      const b = k * SECTION + ((i + 1) % SECTION);
      const c = (k + 1) * SECTION + i;
      const d = (k + 1) * SECTION + ((i + 1) % SECTION);
      if (dir > 0) index.push(a, b, c, b, d, c);
      else index.push(a, c, b, b, c, d);
    }
  }
  const last = segs * SECTION;
  for (let i = 0; i < SECTION; i++) {
    const a = last + i;
    const b = last + ((i + 1) % SECTION);
    if (dir > 0) index.push(a, b, tip);
    else index.push(a, tip, b);
  }

  const geo = new THREE.BufferGeometry();
  geo.setIndex(index);
  geo.setAttribute('position', new THREE.BufferAttribute(shapes[0], 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  if (shapes.length > 1) {
    const pos = [];
    const nor = [];
    for (let m = 1; m < shapes.length; m++) {
      const tmp = new THREE.BufferGeometry();
      tmp.setIndex(index);
      tmp.setAttribute('position', new THREE.BufferAttribute(shapes[m], 3));
      tmp.computeVertexNormals();
      pos.push(tmp.attributes.position);
      nor.push(tmp.attributes.normal);
      tmp.dispose();
    }
    geo.morphAttributes.position = pos;
    geo.morphAttributes.normal = nor;
  }
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Path of a strap leaving the spring bar at height `yb` (centre line) and
 * settling flat on a surface at `yFlat` over `fall` cm. `mirror` returns the
 * same curve expressed in the frame of a watch turned over about the 12-6
 * axis through height `hc` (world y -> 2hc - y).
 */
export function lugPath({ z0, yb, yFlat, fall = 1.7, mirror = null }) {
  return (s, out) => {
    const k = 1 - smoothstep(0, fall, s);
    const y = yFlat + (yb - yFlat) * k * k * (1.4 - 0.4 * k);
    out.y = mirror == null ? y : 2 * mirror - y;
    out.z = z0 + s;
    return out;
  };
}

/**
 * Five-row steel bracelet laid flat: two runs of links either side of the
 * gap where a watch head would sit. Two instanced meshes: satin outer links
 * and polished centre links.
 */
export function bracelet({ satin, polished, from = 1.95, short = 7.2, long = 11.0, pitch = 0.72 }) {
  // Bevelled links: generous radii so every edge catches a line of light.
  const outerGeo = new RoundedBoxGeometry(0.5, 0.32, pitch * 0.94, 4, 0.12);
  domeTop(outerGeo, 0.25, pitch * 0.47, 0.035);
  const midGeo = new RoundedBoxGeometry(0.31, 0.3, pitch * 0.9, 4, 0.1);
  // Slight dome across the polished centre links, so a reflection grades over them.
  {
    const mp = midGeo.attributes.position;
    for (let i = 0; i < mp.count; i++) {
      const y = mp.getY(i);
      if (y > 0) {
        const u = mp.getX(i) / 0.155;
        const v = mp.getZ(i) / (pitch * 0.45);
        mp.setY(i, y + 0.05 * Math.max(0, 1 - 0.6 * u * u - 0.3 * v * v) * (y / 0.15));
      }
    }
    midGeo.computeVertexNormals();
  }
  const rowsShort = Math.floor(short / pitch);
  const rowsLong = Math.floor(long / pitch);
  const rows = rowsShort + rowsLong;
  const outer = new THREE.InstancedMesh(outerGeo, satin, rows * 2);
  const mid = new THREE.InstancedMesh(midGeo, polished, rows * 3);
  const m = new THREE.Matrix4();
  let o = 0;
  let c = 0;
  const put = (z, flip) => {
    // Outer links at the edges, three narrower links in the middle (offset by half a pitch).
    for (const x of [-0.75, 0.75]) outer.setMatrixAt(o++, m.makeTranslation(x, 0.16, z));
    for (const x of [-0.33, 0, 0.33]) mid.setMatrixAt(c++, m.makeTranslation(x, 0.155, z + flip * pitch * 0.5));
  };
  for (let i = 0; i < rowsLong; i++) put(from + (i + 0.5) * pitch, i === rowsLong - 1 ? -1 : 1);
  for (let i = 0; i < rowsShort; i++) put(-(from + (i + 0.5) * pitch), i === rowsShort - 1 ? 1 : -1);
  outer.count = o;
  mid.count = c;
  outer.instanceMatrix.needsUpdate = mid.instanceMatrix.needsUpdate = true;
  outer.castShadow = mid.castShadow = true;
  outer.receiveShadow = mid.receiveShadow = true;
  const group = new THREE.Group();
  group.add(outer, mid);
  // Folding clasp at the end of the long run.
  const claspGeo = new RoundedBoxGeometry(1.7, 0.36, 2.6, 4, 0.16);
  domeTop(claspGeo, 0.85, 1.3, 0.06);
  // The clasp's broad top is the darkest steel on the bracelet (it mirrors the flag above).
  const claspMat = polished.clone();
  claspMat.color.set('#868b8e');
  claspMat.roughness = 0.22;
  const clasp = new THREE.Mesh(claspGeo, claspMat);
  clasp.position.set(0, 0.18, from + rowsLong * pitch + 1.3);
  clasp.castShadow = true;
  group.add(clasp);
  return group;
}

/** Raise the top face of a box-like geometry into a gentle dome (so reflections grade). */
function domeTop(geo, hx, hz, amount) {
  const p = geo.attributes.position;
  let top = 0;
  for (let i = 0; i < p.count; i++) top = Math.max(top, p.getY(i));
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y > 0) {
      const u = p.getX(i) / hx;
      const v = p.getZ(i) / hz;
      p.setY(i, y + amount * Math.max(0, 1 - 0.7 * u * u - 0.5 * v * v) * (y / top));
    }
  }
  geo.computeVertexNormals();
}

function roundRect(path, x, y, w, h, r) {
  path.moveTo(x + r, y);
  path.lineTo(x + w - r, y);
  path.quadraticCurveTo(x + w, y, x + w, y + r);
  path.lineTo(x + w, y + h - r);
  path.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  path.lineTo(x + r, y + h);
  path.quadraticCurveTo(x, y + h, x, y + h - r);
  path.lineTo(x, y + r);
  path.quadraticCurveTo(x, y, x + r, y);
}

/** Loop that keeps the tail of a strap down: a rounded ring round the strap section (axis z). */
export function keeperGeometry(w = 2.3, t = 0.62, len = 0.55) {
  const s = new THREE.Shape();
  roundRect(s, -w / 2, -t / 2, w, t, t * 0.45);
  const hole = new THREE.Path();
  roundRect(hole, -w / 2 + 0.13, -t / 2 + 0.12, w - 0.26, t - 0.24, t * 0.3);
  s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.04, bevelSegments: 3, curveSegments: 10 });
  g.translate(0, 0, -len / 2);
  return g;
}

/** Tongue buckle lying flat (frame + tongue), centred on its own origin. */
export function buckleFrameGeometry() {
  const outer = new THREE.Shape();
  roundRect(outer, -1.1, -0.55, 2.2, 1.1, 0.3);
  const hole = new THREE.Path();
  roundRect(hole, -0.92, -0.38, 1.84, 0.76, 0.18);
  outer.holes.push(hole);
  const frame = new THREE.ExtrudeGeometry(outer, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 });
  frame.rotateX(-Math.PI / 2);
  const tongue = new THREE.BoxGeometry(0.09, 0.08, 0.95).translate(0, 0.1, 0.15);
  return [frame, tongue];
}

/** FKM rubber: a fine matte micro-texture (bump) with a few moulded grooves across the strap near the lug. */
export function rubberBump(size = [128, 512]) {
  const [w, h] = size;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#808080';
  g.fillRect(0, 0, w, h);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 4000; i++) {
    const v = 100 + rnd() * 60;
    g.fillStyle = `rgba(${v | 0},${v | 0},${v | 0},0.5)`;
    g.fillRect(rnd() * w, rnd() * h, 1.5, 1.5);
  }
  g.fillStyle = '#5a5a5a';
  for (let k = 0; k < 4; k++) g.fillRect(w * 0.12, h * (0.04 + k * 0.03), w * 0.76, 3);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  return t;
}
