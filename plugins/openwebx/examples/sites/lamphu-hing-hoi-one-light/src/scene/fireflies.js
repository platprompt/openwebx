import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, noise3 } from '../core/math.js';
import { leafMask } from './maps.js';

// A cut lamphu twig on a small stand behind the slab, always out of focus:
// narrow oval leaves in opposite pairs on thin stems, drawn soft-edged so
// they read as defocused on every tier (the high tier's depth of field only
// adds to it). The fireflies on it are lens bokeh: discs sized as a share of
// the frame height (not by distance), slightly brighter at the rim, added
// to the image. The whole branch pulses together on a noise-modulated
// period, so there is no visible loop.

const TWIGS = [
  [[-21, -1.2, -27], [-15, 1.2, -23], [-8, 3.2, -19.5], [-1, 2.4, -17.5], [6, 3.6, -19], [11, 5.2, -23]],
  [[-15, 1.2, -23], [-17, 4.5, -21], [-19, 6.8, -18.5]],
  [[-8, 3.2, -19.5], [-9.5, 6.4, -18], [-12.5, 8.6, -17]],
  [[-4, 2.9, -18.2], [-3.5, 0.6, -15.8], [-6.5, -0.6, -14.6]],
  [[-1, 2.4, -17.5], [1.5, 5.6, -17], [0.5, 8.2, -18.5]],
  [[4, 3.2, -18.2], [6.5, 1.0, -16.2], [9.5, 0.4, -15.5]],
  [[6, 3.6, -19], [8.5, 7.0, -20], [7, 9.5, -21.5]],
];

export function createBranch(ctx, { leaves = 160, fireflies = 140, color = '#d6ef7a', sizes = [0.02, 0.04], cores = false } = {}) {
  const rnd = mulberry32(41);
  const group = new THREE.Group();
  const curves = TWIGS.map((pts) => new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))));

  // Twigs and the stand (one mesh).
  const bark = new THREE.MeshStandardMaterial({ color: '#2b2822', roughness: 0.9 });
  const parts = curves.map((c, i) => new THREE.TubeGeometry(c, 48, i === 0 ? 0.16 : 0.09, 6, false));
  parts.push(new THREE.CylinderGeometry(0.12, 0.12, 5.4, 8).translate(-8, -2 + 2.7, -19.5));
  parts.push(new THREE.CylinderGeometry(1.2, 1.3, 0.25, 24).translate(-8, -2 + 0.12, -19.5));
  const twigGeo = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false);
  parts.forEach((g) => g.dispose());
  const twigs = new THREE.Mesh(twigGeo, bark);
  group.add(twigs);

  // Leaves in opposite pairs.
  const mask = leafMask(128);
  // Thick, translucent lamphu leaves: cupped across and arched along their
  // length, soft at the edge, lit through from behind (emissive follows the backlight).
  const leafMat = new THREE.MeshStandardMaterial({
    color: '#4a614a', roughness: 0.6, alphaMap: mask, transparent: true, opacity: cores ? 0.78 : 0.92, depthWrite: false, side: THREE.DoubleSide,
    emissive: new THREE.Color('#3d6a33'), emissiveIntensity: 0,
  });
  const leafGeo = new THREE.PlaneGeometry(1.15, 3.3, 4, 10);
  {
    const lp = leafGeo.attributes.position;
    for (let i = 0; i < lp.count; i++) {
      const x = lp.getX(i) / 0.575;
      const y = lp.getY(i) / 1.65;
      lp.setZ(i, 0.16 * x * x - 0.2 * y * y);
    }
    leafGeo.computeVertexNormals();
  }
  leafGeo.translate(0, 1.55, 0);
  const leafMesh = new THREE.InstancedMesh(leafGeo, leafMat, leaves);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const t = new THREE.Vector3();
  const tips = [];
  let n = 0;
  const lengths = curves.map((c) => c.getLength());
  const total = lengths.reduce((a, b) => a + b, 0);
  curves.forEach((c, ci) => {
    const pairs = Math.max(2, Math.round(((leaves / 2) * lengths[ci]) / total));
    for (let k = 0; k < pairs && n < leaves - 1; k++) {
      const u = 0.08 + (k / pairs) * 0.9;
      c.getPointAt(u, p);
      c.getTangentAt(u, t);
      const yaw = Math.atan2(t.x, t.z);
      for (const side of [-1, 1]) {
        e.set(-0.9 + rnd() * 0.5, yaw + side * (1.1 + rnd() * 0.4), side * (0.5 + rnd() * 0.3), 'YXZ');
        q.setFromEuler(e);
        const k2 = 0.75 + rnd() * 0.45;
        s.set(k2, k2, k2);
        leafMesh.setMatrixAt(n++, m.compose(p, q, s));
        // Where the tip of this leaf is: fireflies settle there.
        const tip = new THREE.Vector3(0, 3.0 * k2, 0).applyQuaternion(q).add(p);
        tips.push(tip);
      }
    }
  });
  leafMesh.count = n;
  leafMesh.instanceMatrix.needsUpdate = true;
  group.add(leafMesh);

  // Fireflies.
  const count = fireflies;
  const pos = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const base = tips[Math.floor(rnd() * tips.length)] || new THREE.Vector3();
    // Spread round the leaf tips (not stacked on them), so discs overlap less.
    pos[i * 3] = base.x + (rnd() - 0.5) * 4.2;
    pos[i * 3 + 1] = base.y + (rnd() - 0.5) * 3.2;
    pos[i * 3 + 2] = base.z + (rnd() - 0.5) * 3.0;
    size[i] = sizes[0] + rnd() * (sizes[1] - sizes[0]);
    seed[i] = rnd();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const uniforms = {
    uColor: { value: new THREE.Color(color) },
    uFrameH: { value: 900 },
    uSize: { value: 1 },
    uLevel: { value: 0.2 },
    uPulse: { value: 1 },
    uTime: { value: 0 },
    uShimmer: { value: 1 },
    // 0 = lens bokeh discs (with depth of field), 1 = small glowing cores with a soft falloff.
    uCore: { value: cores ? 1 : 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uFrameH, uSize, uLevel, uPulse, uTime, uShimmer;
      attribute float aSize; attribute float aSeed;
      varying float vI;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float tw = 1.0 - uShimmer * 0.18 * (0.5 + 0.5 * sin(uTime * (0.5 + aSeed * 0.6) + aSeed * 40.0));
        vI = min(uLevel * uPulse * tw, 1.25);
        gl_PointSize = max(2.0, uFrameH * aSize * uSize);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uCore;
      varying float vI;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float r = length(c) * 2.0;
        if (r > 1.0) discard;
        float disc = 1.0 - smoothstep(0.8, 1.0, r);
        float rim = smoothstep(0.62, 0.9, r) * (1.0 - smoothstep(0.9, 1.0, r));
        float bokeh = disc * (0.8 + rim * 0.45);
        float core = exp(-r * r * 9.0) * 1.6 + exp(-r * r * 2.5) * 0.25;
        gl_FragColor = vec4(uColor * vI * mix(bokeh, core, uCore), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 8;
  group.add(points);

  const center = new THREE.Vector3(-4, 3, -19.5);
  let phase = 0;
  return {
    group, points, leaves: leafMesh, uniforms, center, count,
    /** level 0..1, swell >= 1, pulseDepth 0..1 (how far the pulse dips), reduced = no pulse. */
    update(time, dt, { level, swell, pulseDepth, reduced }) {
      uniforms.uTime.value = reduced ? 0 : time;
      uniforms.uShimmer.value = reduced ? 0 : 1;
      if (!reduced) phase += dt * ((Math.PI * 2) / 2.2) * (1 + 0.22 * noise3(time * 0.11, 3.1, 0.7));
      const wave = reduced ? 1 : 0.5 + 0.5 * Math.sin(phase);
      uniforms.uPulse.value = 1 - pulseDepth * (1 - wave);
      uniforms.uLevel.value = level;
      uniforms.uSize.value = swell;
      return wave;
    },
    setGlow(v) {
      leafMat.emissiveIntensity = v;
    },
    setDraw(fraction) {
      geo.setDrawRange(0, Math.max(8, Math.floor(count * fraction)));
    },
    dispose() {
      mask.dispose();
    },
  };
}
