import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLSL } from '../core/glsl.js';
import { mulberry32, smoothstep, lerp } from '../core/math.js';
import { strapGeometry, lugPath } from './straps.js';
import { brushedMap, ringEngraving, rotorEngraving, dialPrint, leatherSkin } from './maps.js';

// Hing Hoi, built procedurally (centimetres, y up, twelve o'clock towards
// -z, the crown at three o'clock on +x, caseback resting at y = 0):
//   38 mm 316L case: polished flanks, satin (circular-brushed) top, a crisp
//   polished bevel between them, four bevelled lugs, a knurled screw-down crown;
//   a domed sapphire crystal with a violet anti-reflective cast and edge glints;
//   a green-black lacquered dial stamped with concentric water ripples (normal
//   perturbation under a flat clear lacquer), twelve domed hand-dropped lume
//   dots, slim tapered hands with lume inserts, a tannin-copper seconds hand;
//   a sapphire caseback over a movement: plate, bridges, a rotor engraved with
//   lamphu leaves, a beating balance and red jewels; an engraved ring of type;
//   a 20 mm tannin leather strap with edge paint, stitching, holes, a buckle
//   and quick-release levers. Turning the watch over morphs the strap so it
//   lies flat on the slab either way.

export const HC = 0.57; // half height: the pivot of the turn-over
export const TOP = 1.14;
const BAR_Y = 0.42;
const BAR_Z = 1.95;
const STRAP_T0 = 0.36;
const STRAP_T1 = 0.26;
const FLAT = 0.15;

const v2 = (r, y) => new THREE.Vector2(r, y);
const lathe = (pts, segs) => new THREE.LatheGeometry(pts.map(([r, y]) => v2(r, y)), segs);

function merge(list) {
  const flat = list.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k);
    return n;
  });
  const out = mergeGeometries(flat, false);
  list.forEach((g) => g.dispose());
  flat.forEach((g) => g.dispose());
  return out;
}

/** Side profile of a lug (u = distance from the centre along the 12-6 axis). */
function lugGeometry(sign) {
  const p = (u, y) => [sign * -u, y]; // +z lugs: shape x = -u (rotateY maps shape x -> -z)
  const s = new THREE.Shape();
  s.moveTo(...p(1.45, 0.22));
  s.lineTo(...p(1.45, 0.84));
  s.quadraticCurveTo(...p(1.95, 0.84), ...p(2.2, 0.6));
  s.quadraticCurveTo(...p(2.3, 0.45), ...p(2.22, 0.32));
  s.quadraticCurveTo(...p(1.9, 0.22), ...p(1.45, 0.22));
  const g = new THREE.ExtrudeGeometry(s, {
    depth: 0.19, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 3, curveSegments: 14,
  });
  g.rotateY(Math.PI / 2);
  return g;
}

function crownGeometry() {
  const knurl = new THREE.CylinderGeometry(0.3, 0.3, 0.3, 96, 1, true);
  const pos = knurl.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const a = Math.atan2(z, x);
    const r = 0.3 - 0.024 * (0.5 + 0.5 * Math.cos(a * 24));
    const l = Math.hypot(x, z) || 1;
    pos.setX(i, (x / l) * r);
    pos.setZ(i, (z / l) * r);
  }
  knurl.computeVertexNormals();
  knurl.rotateZ(-Math.PI / 2);
  knurl.translate(2.12, 0.48, 0);
  // Domed end cap and the inner face.
  const R = 0.82;
  const th = Math.asin(0.28 / R);
  const cap = new THREE.SphereGeometry(R, 48, 6, 0, Math.PI * 2, 0, th);
  cap.rotateZ(-Math.PI / 2);
  cap.translate(2.27 + 0.05 - R, 0.48, 0);
  const inner = new THREE.CircleGeometry(0.29, 48);
  inner.rotateY(-Math.PI / 2);
  inner.translate(1.97, 0.48, 0);
  const tube = new THREE.CylinderGeometry(0.16, 0.16, 0.2, 32, 1, true);
  tube.rotateZ(-Math.PI / 2);
  tube.translate(1.88, 0.48, 0);
  return [knurl, cap, inner, tube];
}

function handGeometry(len, tail, wBase, wTip) {
  const s = new THREE.Shape();
  s.moveTo(-wBase * 0.42, -tail);
  s.lineTo(wBase * 0.42, -tail);
  s.lineTo(wBase / 2, len * 0.12);
  s.lineTo(wTip / 2, len * 0.97);
  s.lineTo(0, len);
  s.lineTo(-wTip / 2, len * 0.97);
  s.lineTo(-wBase / 2, len * 0.12);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.016, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1 });
  g.rotateX(-Math.PI / 2);
  return g;
}

function insertGeometry(from, to, w0, w1) {
  const s = new THREE.Shape();
  s.moveTo(-w0 / 2, from);
  s.lineTo(w0 / 2, from);
  s.lineTo(w1 / 2, to);
  s.quadraticCurveTo(0, to + w1 * 0.6, -w1 / 2, to);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.003, bevelSegments: 2 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.012, 0);
  return g;
}

function glassMaterial() {
  // Sapphire with an AR coating: reflections are added on top, the light
  // through it is only slightly dimmed (custom blend of the physical shader).
  const m = new THREE.MeshPhysicalMaterial({
    color: '#000000', metalness: 0, roughness: 0.03, ior: 1.77, specularIntensity: 1, specularColor: new THREE.Color('#ece6ff'),
    iridescence: 0.45, iridescenceIOR: 1.3, iridescenceThicknessRange: [160, 330],
    transparent: true, opacity: 0.1, depthWrite: false, premultipliedAlpha: true,
  });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <premultiplied_alpha_fragment>', '');
  };
  m.customProgramCacheKey = () => 'ox-sapphire';
  return m;
}

function dialMaterial() {
  const m = new THREE.MeshPhysicalMaterial({
    color: '#0d1c15', metalness: 0.62, roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.05,
  });
  m.userData.uniforms = { uFreq: { value: 57 }, uSlope: { value: 0.5 } };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, m.userData.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vDial; varying vec3 vAx; varying vec3 vAz;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vDial = position.xz;
        vAx = normalize(normalMatrix * vec3(1.0, 0.0, 0.0));
        vAz = normalize(normalMatrix * vec3(0.0, 0.0, 1.0));`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vDial; varying vec3 vAx; varying vec3 vAz; uniform float uFreq; uniform float uSlope;
        ${GLSL.simplex3}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // Stamped water ripples: concentric, slightly wandering, faded where they would alias.
          float rr = length(vDial);
          float wob = snoise(vec3(vDial * 1.6, 2.3)) * 0.55 + snoise(vec3(vDial * 4.8, 7.1)) * 0.12;
          float ph = rr * uFreq + wob * 5.0;
          float aa = clamp(1.7 - fwidth(ph) * 0.8, 0.0, 1.0);
          float edge = smoothstep(0.1, 0.32, rr) * (1.0 - smoothstep(1.4, 1.52, rr));
          vec2 dir = vDial / max(rr, 1e-4);
          float slope = uSlope * cos(ph) * aa * edge * (0.75 + 0.25 * sin(rr * 3.1 + wob * 2.0));
          normal = normalize(normal - (dir.x * vAx + dir.y * vAz) * slope);
        }`);
  };
  m.customProgramCacheKey = () => 'ox-ripple-dial';
  return m;
}

export async function buildWatch(ctx, { leather = {}, segs = 128 } = {}) {
  const rnd = mulberry32(19);
  const disposables = [];
  const keep = (x) => (disposables.push(x), x);

  // ---------- materials
  const brushed = keep(brushedMap(7));
  brushed.repeat.set(10, 1);
  const polished = new THREE.MeshPhysicalMaterial({ color: '#cdd0d2', metalness: 1, roughness: 0.075 });
  const satin = new THREE.MeshPhysicalMaterial({ color: '#c2c5c7', metalness: 1, roughness: 0.36, roughnessMap: brushed, anisotropy: 0.7 });
  const satinFlat = new THREE.MeshPhysicalMaterial({ color: '#c2c5c7', metalness: 1, roughness: 0.32 });
  const glass = glassMaterial();
  const dial = dialMaterial();
  const rehaut = new THREE.MeshStandardMaterial({ color: '#0d1712', roughness: 0.55, metalness: 0.2 });
  const lume = new THREE.MeshStandardMaterial({ color: '#efe8cf', roughness: 0.42, emissive: new THREE.Color('#c9f06c'), emissiveIntensity: 0 });
  const copper = new THREE.MeshPhysicalMaterial({ color: '#c08a52', metalness: 1, roughness: 0.18 });
  const rhodium = new THREE.MeshPhysicalMaterial({ color: '#c9ccce', metalness: 1, roughness: 0.22 });
  const plateStripes = keep(brushedMap(23, 256));
  plateStripes.repeat.set(1, 3);
  plateStripes.rotation = Math.PI / 5;
  const plate = new THREE.MeshPhysicalMaterial({ color: '#b9bdc0', metalness: 1, roughness: 0.4, roughnessMap: plateStripes });
  const gold = new THREE.MeshPhysicalMaterial({ color: '#d2ad74', metalness: 1, roughness: 0.28 });
  const ruby = new THREE.MeshPhysicalMaterial({ color: '#a10d2b', roughness: 0.06, clearcoat: 1, emissive: new THREE.Color('#5a0618'), emissiveIntensity: 0.35 });
  const mats = [polished, satin, satinFlat, glass, dial, rehaut, lume, copper, rhodium, plate, gold, ruby];

  const root = new THREE.Group(); // pivot of the turn-over (sits at height HC)
  const body = new THREE.Group();
  body.position.y = -HC;
  root.add(body);
  const head = new THREE.Group();
  body.add(head);

  // ---------- case
  const polishedGeo = merge([
    lathe([[1.79, 0.17], [1.86, 0.26], [1.9, 0.4], [1.9, 0.56], [1.88, 0.7], [1.85, 0.78]], segs), // flank
    lathe([[1.85, 0.78], [1.8, 0.855]], segs), // bevel
    lathe([[1.64, 0.9], [1.625, 0.93]], segs), // inner lip
    lugGeometry(1).translate(1.03, 0, 0),
    lugGeometry(1).translate(-1.22, 0, 0),
    lugGeometry(-1).translate(1.03, 0, 0),
    lugGeometry(-1).translate(-1.22, 0, 0),
    ...crownGeometry(),
  ]);
  const caseMesh = new THREE.Mesh(polishedGeo, polished);
  const satinGeo = merge([
    lathe([[1.8, 0.855], [1.7, 0.885], [1.64, 0.9]], segs), // satin top of the bezel
    lathe([[1.5, 0.0], [1.62, 0.03], [1.72, 0.09], [1.79, 0.17]], segs), // caseback slope
  ]);
  const satinMesh = new THREE.Mesh(satinGeo, satin);
  // Inner tube seen through the caseback window.
  const tube = new THREE.Mesh(lathe([[1.0, 0.45], [1.0, 0.0]], 64), plate);
  head.add(caseMesh, satinMesh, tube);

  // ---------- engraved caseback band (type in the scene)
  const engr = keep(ringEngraving('LAMPHU ATELIER  ·  HING HOI  ·  CALIBRE L-01  ·  25 JEWELS  ·  100 M  ·  316L  ·  '));
  const engrMat = new THREE.MeshPhysicalMaterial({ color: '#c2c5c7', metalness: 1, roughness: 0.34, bumpMap: engr, bumpScale: 1.5, roughnessMap: engr });
  mats.push(engrMat);
  const band = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.5, 96, 1), engrMat);
  band.geometry.rotateX(Math.PI / 2);
  // Ring UVs are planar over the outer radius; the canvas text ring sits at 0.415 of it.
  engr.repeat.set(1, 1);
  head.add(band);

  // ---------- dial, flange, print, lume, hands
  const dialMesh = new THREE.Mesh(new THREE.CircleGeometry(1.53, 160).rotateX(-Math.PI / 2), dial);
  dialMesh.position.y = 0.74;
  const flange = new THREE.Mesh(lathe([[1.625, 0.92], [1.52, 0.745]], segs), rehaut);
  head.add(dialMesh, flange);

  const print = dialPrint('Lamphu');
  keep(print.texture);
  const printMat = new THREE.MeshStandardMaterial({ map: print.texture, transparent: true, roughness: 0.5, depthWrite: false });
  mats.push(printMat);
  const pw = 0.5;
  const printMesh = new THREE.Mesh(new THREE.PlaneGeometry(pw, pw / print.aspect).rotateX(-Math.PI / 2), printMat);
  printMesh.position.set(0, 0.742, -0.74);
  head.add(printMesh);

  const dot = new THREE.SphereGeometry(1, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const dots = new THREE.InstancedMesh(dot, lume, 12);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const pv = new THREE.Vector3();
  for (let h = 0; h < 12; h++) {
    const a = (h / 12) * Math.PI * 2;
    const r = 1.29;
    // hand-dropped: each dot a touch different
    const s = 0.086 * (0.96 + rnd() * 0.08);
    pv.set(Math.sin(a) * r + (rnd() - 0.5) * 0.008, 0.74, -Math.cos(a) * r + (rnd() - 0.5) * 0.008);
    sc.set(s, 0.034 + rnd() * 0.006, s * (0.97 + rnd() * 0.06));
    dots.setMatrixAt(h, m4.compose(pv, q, sc));
  }
  dots.instanceMatrix.needsUpdate = true;
  head.add(dots);

  const hands = {};
  const hourG = new THREE.Group();
  hourG.add(new THREE.Mesh(handGeometry(0.9, 0.18, 0.13, 0.045), polished), new THREE.Mesh(insertGeometry(0.2, 0.8, 0.07, 0.03), lume));
  hourG.position.y = 0.795;
  const minG = new THREE.Group();
  minG.add(new THREE.Mesh(handGeometry(1.36, 0.22, 0.105, 0.032), polished), new THREE.Mesh(insertGeometry(0.26, 1.24, 0.055, 0.022), lume));
  minG.position.y = 0.83;
  const secG = new THREE.Group();
  const secGeo = merge([
    new THREE.BoxGeometry(0.014, 0.012, 1.84).translate(0, 0, -0.54),
    new THREE.CylinderGeometry(0.07, 0.07, 0.014, 32).translate(0, 0, 0.28),
    new THREE.CylinderGeometry(0.05, 0.05, 0.02, 32),
  ]);
  secG.add(new THREE.Mesh(secGeo, copper));
  secG.position.y = 0.868;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.12, 32).translate(0, 0.84, 0), polished);
  head.add(hourG, minG, secG, cap);
  hands.hour = hourG;
  hands.minute = minG;
  hands.second = secG;

  // ---------- crystal and caseback window
  const Rs = (1.625 ** 2 + 0.22 ** 2) / (2 * 0.22);
  const crystal = new THREE.Mesh(new THREE.SphereGeometry(Rs, 128, 10, 0, Math.PI * 2, 0, Math.asin(1.625 / Rs)), glass);
  crystal.position.y = 0.92 + 0.22 - Rs;
  crystal.renderOrder = 5;
  const windowGlass = new THREE.Mesh(new THREE.CircleGeometry(1.0, 64).rotateX(Math.PI / 2), glass);
  windowGlass.position.y = 0.004;
  windowGlass.renderOrder = 5;
  head.add(crystal, windowGlass);

  // ---------- movement (seen through the caseback)
  const movement = new THREE.Group();
  head.add(movement);
  const plateMesh = new THREE.Mesh(new THREE.CircleGeometry(1.45, 64).rotateX(Math.PI / 2), plate);
  plateMesh.position.y = 0.42;
  movement.add(plateMesh);
  // Bridges: a crescent across the barrel side and the balance cock.
  const bridge = new THREE.Shape();
  bridge.absarc(0, 0, 0.98, Math.PI * 0.08, Math.PI * 0.92, false);
  bridge.absarc(0, 0, 0.42, Math.PI * 0.92, Math.PI * 0.08, true);
  const cock = new THREE.Shape();
  cock.absarc(0.6, -0.62, 0.17, 0, Math.PI * 2, false);
  const arm = new THREE.Shape();
  arm.moveTo(0.55, -0.68);
  arm.lineTo(1.3, -0.42);
  arm.lineTo(1.26, -0.28);
  arm.lineTo(0.62, -0.52);
  arm.closePath();
  const ex = { depth: 0.06, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 24 };
  const bridgesGeo = merge([new THREE.ExtrudeGeometry(bridge, ex), new THREE.ExtrudeGeometry(cock, ex), new THREE.ExtrudeGeometry(arm, ex)]);
  bridgesGeo.rotateX(Math.PI / 2); // shape y -> +z, extrusion -> -y (towards the window)
  const bridges = new THREE.Mesh(bridgesGeo, rhodium);
  bridges.position.y = 0.36;
  movement.add(bridges);

  const jewelPts = [[0, 0.0], [0.6, -0.62], [-0.55, 0.42], [0.55, 0.42], [-0.2, 0.72], [0.25, 0.7], [-0.85, -0.2], [0.85, 0.05], [-0.4, -0.75]];
  const jewels = new THREE.InstancedMesh(new THREE.SphereGeometry(0.05, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI), ruby, jewelPts.length);
  jewelPts.forEach(([x, z], i) => jewels.setMatrixAt(i, m4.makeTranslation(x, 0.285, z)));
  jewels.instanceMatrix.needsUpdate = true;
  movement.add(jewels);

  const balance = new THREE.Group();
  const balGeo = merge([
    new THREE.TorusGeometry(0.34, 0.034, 10, 64).rotateX(Math.PI / 2),
    new THREE.BoxGeometry(0.68, 0.02, 0.04),
    new THREE.BoxGeometry(0.04, 0.02, 0.68),
    new THREE.CylinderGeometry(0.05, 0.05, 0.08, 16),
  ]);
  balance.add(new THREE.Mesh(balGeo, gold));
  balance.position.set(0.6, 0.24, -0.62);
  movement.add(balance);

  const rotorShape = new THREE.Shape();
  rotorShape.absarc(0, 0, 1.36, 0, Math.PI, false);
  rotorShape.absarc(0, 0, 0.17, Math.PI, 0, true);
  // Openwork: lamphu leaves cut right through the rotor, in opposite pairs
  // along a curved twig (the twig itself is engraved).
  const leafHole = (cx, cy, ang, len, wid) => {
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const P = (u, v) => [cx + u * ca - v * sa, cy + u * sa + v * ca];
    const h = new THREE.Path();
    h.moveTo(...P(-len / 2, 0));
    h.quadraticCurveTo(...P(0, wid), ...P(len / 2, 0));
    h.quadraticCurveTo(...P(0, -wid), ...P(-len / 2, 0));
    return h;
  };
  for (const a of [0.3, 0.5, 0.7]) {
    const t = a * Math.PI;
    const tx = -Math.sin(t);
    const ty = Math.cos(t);
    const twig = 0.8;
    for (const side of [1, -1]) {
      const off = side > 0 ? 0.24 : 0.2;
      const r = twig + side * off;
      const tilt = Math.atan2(ty, tx) + side * 0.75;
      rotorShape.holes.push(leafHole(Math.cos(t) * r, Math.sin(t) * r, tilt, side > 0 ? 0.42 : 0.34, side > 0 ? 0.12 : 0.1));
    }
  }
  const rotorGeo = new THREE.ExtrudeGeometry(rotorShape, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.012, bevelSegments: 2, curveSegments: 64 });
  rotorGeo.rotateX(Math.PI / 2);
  const leaves = keep(rotorEngraving(1024, 11, false));
  leaves.repeat.set(1 / 2.8, 1 / 2.8);
  leaves.offset.set(0.5, 0.5);
  const rotorMat = new THREE.MeshPhysicalMaterial({ color: '#d2ae74', metalness: 1, roughness: 0.3, bumpMap: leaves, bumpScale: 0.8, side: THREE.DoubleSide });
  mats.push(rotorMat);
  const rotor = new THREE.Group();
  const rotorMesh = new THREE.Mesh(rotorGeo, rotorMat);
  rotor.add(rotorMesh);
  rotor.position.y = 0.16;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.07, 32), gold);
  hub.position.y = 0.13;
  movement.add(rotor, hub);

  head.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = o.material !== glass && o.material !== printMat;
      o.receiveShadow = true;
    }
  });

  // ---------- leather strap (two pieces, morph target = watch turned over)
  const strap = new THREE.Group();
  body.add(strap);
  const skinLong = keep(await leatherSkin(leather.img, { holes: 5, size: [256, 1440], seed: 3 }));
  const skinShort = keep(await leatherSkin(leather.img, { holes: 0, size: [256, 960], seed: 9 }));
  const leatherMat = (map) => new THREE.MeshStandardMaterial({
    map, normalMap: leather.normal || null, roughnessMap: leather.arm || null, roughness: 0.82, vertexColors: true,
    normalScale: new THREE.Vector2(0.6, 0.6),
  });
  const longMat = leatherMat(skinLong);
  const shortMat = leatherMat(skinShort);
  mats.push(longMat, shortMat);
  const pathUp = lugPath({ z0: BAR_Z, yb: BAR_Y, yFlat: FLAT });
  const pathDown = lugPath({ z0: BAR_Z, yb: 2 * HC - BAR_Y, yFlat: FLAT, mirror: HC });
  const piece = (len, dir, mat) => {
    const geo = strapGeometry({ len, w0: 2.0, w1: 1.62, t0: STRAP_T0, t1: STRAP_T1, paths: [pathUp, pathDown], dir, edge: 0.38 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.updateMorphTargets();
    strap.add(mesh);
    return mesh;
  };
  const longPiece = piece(11.2, 1, longMat);
  const shortPiece = piece(7.2, -1, shortMat);

  // Buckle at the end of the short piece.
  const outer = new THREE.Shape();
  const rr = (s, x, y, w, h, r) => {
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y);
    s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r);
    s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h);
    s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r);
    s.quadraticCurveTo(x, y, x + r, y);
  };
  rr(outer, -1.1, -0.55, 2.2, 1.1, 0.3);
  const hole = new THREE.Path();
  rr(hole, -0.92, -0.38, 1.84, 0.76, 0.18);
  outer.holes.push(hole);
  const buckleGeo = merge([
    new THREE.ExtrudeGeometry(outer, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 }).rotateX(-Math.PI / 2),
    new THREE.BoxGeometry(0.09, 0.08, 0.95).translate(0, 0.1, 0.15),
  ]);
  // Satin buckle: no pin-point glints to break into dotted bokeh when out of focus.
  const buckle = new THREE.Mesh(buckleGeo, satinFlat);
  buckle.castShadow = true;
  buckle.position.set(0, 0.04, -(BAR_Z + 7.2 + 0.25));
  strap.add(buckle);

  // Quick-release levers on the underside near each lug end.
  const levers = new THREE.InstancedMesh(
    merge([new THREE.CylinderGeometry(0.035, 0.035, 0.22, 12).rotateX(Math.PI / 2), new THREE.SphereGeometry(0.05, 12, 8).translate(0, -0.03, 0.1)]),
    polished, 2,
  );
  levers.castShadow = true;
  levers.visible = false; // under the strap while the watch is face up
  strap.add(levers);
  const tmp = { y: 0, z: 0 };
  const leverPos = [new THREE.Vector3(), new THREE.Vector3()];
  const leverAt = (flip) => {
    const s = 0.62;
    const ya = pathUp(s, tmp).y;
    const yb = pathDown(s, tmp).y;
    const y = lerp(ya, yb, flip) - STRAP_T0 / 2 - 0.02;
    leverPos[0].set(0.66, y, BAR_Z + s);
    leverPos[1].set(0.66, y, -(BAR_Z + s));
    levers.setMatrixAt(0, m4.makeTranslation(leverPos[0].x, leverPos[0].y, leverPos[0].z));
    levers.setMatrixAt(1, m4.makeTranslation(leverPos[1].x, leverPos[1].y, leverPos[1].z));
    levers.instanceMatrix.needsUpdate = true;
  };
  leverAt(0);

  // ---------- local boxes and anchors
  const boxes = {
    head: new THREE.Box3(new THREE.Vector3(-1.9, 0, -2.3), new THREE.Vector3(2.4, TOP, 2.3)),
    case: new THREE.Box3(new THREE.Vector3(-1.9, 0, -2.3), new THREE.Vector3(1.9, TOP, 2.3)),
    dial: new THREE.Box3(new THREE.Vector3(-1.62, 0.74, -1.62), new THREE.Vector3(1.62, TOP, 1.62)),
    watch: new THREE.Box3(new THREE.Vector3(-1.9, 0, -4.2), new THREE.Vector3(2.4, TOP, 4.6)),
  };
  const anchors = {
    crown: new THREE.Vector3(2.42, 0.5, 0),
    lume: new THREE.Vector3(Math.sin(Math.PI / 3) * 1.29, 0.8, -Math.cos(Math.PI / 3) * 1.29),
    crystal: new THREE.Vector3(-1.05, 1.08, -0.85),
    rotor: new THREE.Vector3(-0.55, 0.05, 0.65),
    balance: new THREE.Vector3(0.6, 0.05, -0.62),
    movement: new THREE.Vector3(-1.9, 0.12, 0.6),
    case: new THREE.Vector3(-1.92, 0.5, 0.35),
    watch: new THREE.Vector3(0, 1.2, 0),
  };

  let flipState = -1;
  const api = {
    root, body, head, strap, hands, rotor, balance, movement, dots, lume, crystal, boxes, anchors,
    longPiece, shortPiece, levers, leverPos,
    /** 0 = face up, 1 = turned over. */
    setFlip(f) {
      const m = smoothstep(0.3, 0.9, f);
      if (Math.abs(m - flipState) < 1e-4) return;
      flipState = m;
      longPiece.morphTargetInfluences[0] = m;
      shortPiece.morphTargetInfluences[0] = m;
      buckle.position.y = lerp(0.04, 2 * HC - 0.04, m);
      buckle.rotation.z = m * Math.PI;
      levers.visible = m > 0.2;
      leverAt(m);
    },
    /** Hands at 10:09:30 plus elapsed seconds (a quiet sweep, 8 steps a second). */
    setTime(seconds) {
      const s = 30 + seconds;
      const mins = 9 + s / 60;
      const hours = 10 + mins / 60;
      hourG.rotation.y = -((hours % 12) / 12) * Math.PI * 2;
      minG.rotation.y = -((mins % 60) / 60) * Math.PI * 2;
      secG.rotation.y = -((Math.floor(s * 8) / 8) % 60 / 60) * Math.PI * 2;
    },
    dispose() {
      disposables.forEach((d) => d.dispose?.());
      mats.forEach((m) => m.dispose());
    },
  };
  api.setFlip(0);
  api.setTime(0);
  return api;
}
