import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { GLSL } from '../core/glsl.js';
import { radialMask } from './maps.js';

// The set: a seamless dark-green sweep that wraps round the table (so every
// camera angle has a backdrop), a polished slate slab, a strip softbox key,
// a cool rim strip that never goes off, and a small brass practical lamp
// with an opal globe that stays dark until the last shot.
//
// The sweep carries three light terms of its own, the way a studio backdrop
// is lit separately from the subject: a background-light pool behind the
// watch (aimed per shot, like a flagged spot), the green spill of the
// fireflies near the branch, and a faint haze inside the key's beam.

export const SLAB = { w: 18, h: 2, d: 32 };
const FLOOR = -2;

function sweepGeometry(segs) {
  const pts = [new THREE.Vector2(72, 170), new THREE.Vector2(72, 26)];
  const cx = 46;
  const cy = 26;
  const r = 26;
  for (let i = 1; i <= 14; i++) {
    const a = (i / 14) * (Math.PI / 2);
    pts.push(new THREE.Vector2(cx + Math.cos(a) * r, cy - Math.sin(a) * r + FLOOR * (i / 14)));
  }
  pts.push(new THREE.Vector2(30, FLOOR), new THREE.Vector2(14, FLOOR), new THREE.Vector2(0.01, FLOOR));
  return new THREE.LatheGeometry(pts, segs);
}

export function createSweep(ctx, { color = '#24302a', pool = '#55604f' } = {}) {
  const uniforms = {
    uPoolC: { value: new THREE.Vector3(0, 0, -30) },
    uPoolCol: { value: new THREE.Color(pool) },
    uPoolR: { value: 30 },
    uPoolGain: { value: 0 },
    uGlowC: { value: new THREE.Vector3(-6, 2, -20) },
    uGlowCol: { value: new THREE.Color('#9fd05a') },
    uGlowR: { value: 16 },
    uGlowGain: { value: 0 },
    uKeyPos: { value: new THREE.Vector3(0, 30, 0) },
    uKeyDir: { value: new THREE.Vector3(0, -1, 0) },
    uHaze: { value: 0 },
    uHazeCol: { value: new THREE.Color('#fff3e2') },
  };
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.93, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWp;
        uniform vec3 uPoolC, uPoolCol, uGlowC, uGlowCol, uKeyPos, uKeyDir, uHazeCol;
        uniform float uPoolR, uPoolGain, uGlowR, uGlowGain, uHaze;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float dp = distance(vWp, uPoolC) / uPoolR;
          totalEmissiveRadiance += uPoolCol * uPoolGain * exp(-dp * dp * 1.7);
          float dg = distance(vWp, uGlowC) / uGlowR;
          totalEmissiveRadiance += uGlowCol * uGlowGain * exp(-dg * dg * 2.2);
          // Haze in the key's beam: nearest approach of the eye ray to the beam axis.
          vec3 rd = normalize(vWp - cameraPosition);
          vec3 w0 = cameraPosition - uKeyPos;
          float b = dot(rd, uKeyDir);
          float d = dot(rd, w0);
          float e = dot(uKeyDir, w0);
          float den = max(1.0 - b * b, 1e-3);
          float sc = clamp((b * e - d) / den, 0.0, distance(vWp, cameraPosition));
          float tc = max((e - b * d) / den, 0.0);
          float dist = distance(cameraPosition + rd * sc, uKeyPos + uKeyDir * tc);
          float cone = 3.0 + tc * 0.28;
          totalEmissiveRadiance += uHazeCol * uHaze * exp(-(dist * dist) / (cone * cone)) * smoothstep(2.0, 14.0, tc);
        }`);
  };
  mat.customProgramCacheKey = () => 'ox-sweep';
  const segs = Math.max(48, Math.round(128 * Math.sqrt(ctx.device.scale)));
  const mesh = new THREE.Mesh(sweepGeometry(segs), mat);
  mesh.receiveShadow = true;
  return { mesh, uniforms };
}

/**
 * Honed dark slate: a uniform near-black green-grey with a slight tonal drift,
 * a fine stone grain (world-space micro-normal, so every face of the slab has
 * the same grain and nothing stretches), and a gentle roughness variation.
 * It also carries the light the lume gives back, as a soft dithered pool.
 */
export function createSlabMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: '#1e2321', roughness: 0.6, metalness: 0, envMapIntensity: 0.3 });
  const uniforms = {
    uSpillC: { value: new THREE.Vector3() },
    uSpillCol: { value: new THREE.Color('#9fd05a') },
    uSpill: { value: 0 },
    uGrain: { value: 1 },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWp;
        uniform vec3 uSpillC, uSpillCol;
        uniform float uSpill, uGrain;
        ${GLSL.simplex3}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= 1.0 + 0.09 * snoise(vWp * 0.11) + 0.04 * snoise(vWp * 0.9);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + 0.06 * snoise(vWp * 0.08 + 3.1) + 0.025 * snoise(vWp * 0.7), 0.5, 0.7);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // Fine honed grain: gradient of 3D noise, faded where it would shimmer.
          vec3 q = vWp * 8.0;
          float n0 = snoise(q);
          vec3 g = vec3(snoise(q + vec3(0.08, 0.0, 0.0)) - n0, snoise(q + vec3(0.0, 0.08, 0.0)) - n0, snoise(q + vec3(0.0, 0.0, 0.08)) - n0) / 0.08;
          vec3 gv = mat3(viewMatrix) * g;
          gv -= dot(gv, normal) * normal;
          float fade = clamp(1.4 - length(fwidth(q)) * 1.2, 0.0, 1.0) * uGrain;
          normal = normalize(normal - gv * 0.003 * fade);
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          // Light given back by the lume dots: a soft pool on the stone, dithered (no rings).
          float d = length(vWp.xz - uSpillC.xz);
          float pool = exp(-(d * d) / 6.0);
          float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
          totalEmissiveRadiance += uSpillCol * uSpill * pool * step(-0.05, vWp.y) * (1.0 + dither * 0.12);
          totalEmissiveRadiance += vec3(dither * 0.0025);
        }`);
  };
  mat.customProgramCacheKey = () => 'ox-slab-honed';
  return { mat, uniforms };
}

export function createSlab(mat) {
  const geo = new RoundedBoxGeometry(SLAB.w, SLAB.h, SLAB.d, 3, 0.16);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -SLAB.h / 2;
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

/** Soft contact shadow under the head (all tiers; on low it is the only shadow). */
export function contactShadow() {
  const tex = radialMask(256, 0.2);
  const mat = new THREE.MeshBasicMaterial({ color: '#000000', alphaMap: tex, transparent: true, opacity: 0.6, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 6.2).rotateX(-Math.PI / 2), mat);
  mesh.position.y = 0.006;
  mesh.renderOrder = 1;
  return { mesh, tex };
}

/** Lights decided once (shadow maps and light count never change at runtime). */
export function createLights(ctx, scene, { keyColor = '#fff3e2', rimColor = '#a9bfcf', lampColor = '#ffb46b' } = {}) {
  const tier = ctx.device.tier;
  const area = tier !== 'low';
  if (area) RectAreaLightUniformsLib.init();
  const lights = { area };
  lights.keyArea = area ? new THREE.RectAreaLight(keyColor, 0, 7, 28) : null;
  lights.keyDir = new THREE.DirectionalLight(keyColor, 0);
  lights.rim = area ? new THREE.RectAreaLight(rimColor, 0, 3.2, 26) : new THREE.DirectionalLight(rimColor, 0);
  lights.lamp = new THREE.PointLight(lampColor, 0, 0, 2);
  const target = new THREE.Object3D();
  lights.keyDir.target = target;
  if (!area) lights.rim.target = target;
  scene.add(target, lights.keyDir, lights.rim, lights.lamp);
  if (lights.keyArea) scene.add(lights.keyArea);
  lights.target = target;
  if (tier !== 'low') {
    const gl = ctx.renderer.gl;
    gl.shadowMap.enabled = true;
    gl.shadowMap.type = THREE.PCFSoftShadowMap;
    const k = lights.keyDir;
    k.castShadow = true;
    const res = tier === 'high' ? 1024 : 512;
    k.shadow.mapSize.set(res, res);
    k.shadow.bias = -0.0005;
    k.shadow.normalBias = 0.015;
    k.shadow.radius = 4;
    const cam = k.shadow.camera;
    cam.left = cam.bottom = -17;
    cam.right = cam.top = 17;
    cam.near = 1;
    cam.far = 90;
    cam.updateProjectionMatrix();
  }
  return lights;
}

/**
 * A small table lamp: a weighted brass base, a slim stem, and a tapered
 * linen drum shade with a bulb inside. Off, the shade is a pale cloth form;
 * on, it glows warm from inside and throws light down from under its rim.
 */
export function createLamp() {
  const group = new THREE.Group();
  const brass = new THREE.MeshPhysicalMaterial({ color: '#a8824f', metalness: 1, roughness: 0.34 });
  const shadeMat = new THREE.MeshStandardMaterial({
    color: '#d9cdb6', roughness: 0.9, side: THREE.DoubleSide, emissive: new THREE.Color('#ffb46b'), emissiveIntensity: 0,
  });
  const bulbMat = new THREE.MeshStandardMaterial({ color: '#f5ecd8', roughness: 0.3, emissive: new THREE.Color('#ffc887'), emissiveIntensity: 0 });
  const base = new THREE.Mesh(new THREE.LatheGeometry([
    new THREE.Vector2(0.0, 0.5), new THREE.Vector2(0.2, 0.5), new THREE.Vector2(0.5, 0.45), new THREE.Vector2(1.55, 0.32),
    new THREE.Vector2(1.75, 0.12), new THREE.Vector2(1.7, 0.0),
  ].reverse(), 48), brass);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 3.3, 20).translate(0, 2.1, 0), brass);
  const harp = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.04, 8, 32, Math.PI).rotateZ(Math.PI).translate(0, 4.6, 0), brass);
  // Tapered drum shade (open top and bottom), cloth seen from both sides.
  const shade = new THREE.Mesh(new THREE.LatheGeometry([
    new THREE.Vector2(2.3, 0), new THREE.Vector2(2.26, 0.06), new THREE.Vector2(1.55, 2.3), new THREE.Vector2(1.5, 2.36),
  ], 64), shadeMat);
  shade.position.y = 3.5;
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.55, 24, 16).translate(0, 4.2, 0), bulbMat);
  for (const m of [base, stem, harp, shade]) m.castShadow = m.receiveShadow = true;
  group.add(base, stem, harp, shade, bulb);
  return { group, shade, shadeMat, bulbMat, brass, light: new THREE.Vector3(0, 4.3, 0) };
}

/**
 * The studio as the steel sees it: the CC0 studio HDRI turned down as the
 * room, black flags either side and under the set (so polished steel has
 * dark to reflect, not white), a tall strip softbox front left, a soft top
 * scrim and a narrow rim strip behind right. Baked once into an environment
 * map; the scene turns it with the camera so every shot keeps the same kind
 * of reflections, the way a product photographer moves flags with the camera.
 */
export function bakeStudioEnv(ctx, hdr, { flatLay = false } = {}) {
  const env = new THREE.Scene();
  const disposables = [];
  const add = (geo, mat, setup) => {
    const m = new THREE.Mesh(geo, mat);
    setup(m);
    env.add(m);
    disposables.push(geo, mat);
    return m;
  };
  const room = hdr
    ? new THREE.MeshBasicMaterial({ map: hdr, side: THREE.BackSide, color: new THREE.Color(0.32, 0.33, 0.32) })
    : new THREE.MeshBasicMaterial({ side: THREE.BackSide, color: new THREE.Color(0.05, 0.06, 0.055) });
  add(new THREE.SphereGeometry(60, 48, 24), room, () => {});
  const black = new THREE.MeshBasicMaterial({ color: '#000000', side: THREE.DoubleSide });
  const card = (r, g, b) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), side: THREE.DoubleSide });
  const place = (dir, dist) => (m) => {
    m.position.copy(dir).normalize().multiplyScalar(dist);
    m.lookAt(0, 0, 0);
  };
  // Floor and flags (dark reflections in the flanks and the links).
  add(new THREE.PlaneGeometry(200, 200), black, (m) => {
    m.rotation.x = -Math.PI / 2;
    m.position.y = -8;
  });
  add(new THREE.PlaneGeometry(40, 70), black, place(new THREE.Vector3(1, 0.15, 0.25), 26));
  add(new THREE.PlaneGeometry(40, 70), black, place(new THREE.Vector3(-1, 0.1, -0.6), 26));
  add(new THREE.PlaneGeometry(60, 30), black, place(new THREE.Vector3(0, 0.05, 1), 30));
  // Lights the steel reflects.
  add(new THREE.PlaneGeometry(7, 34), card(5.5, 5.2, 4.8), place(new THREE.Vector3(-0.75, 0.55, 0.55), 24));
  if (!flatLay) {
    add(new THREE.PlaneGeometry(30, 30), card(1.1, 1.1, 1.05), place(new THREE.Vector3(0.05, 1, 0.1), 24));
  } else {
    // Flat lay seen from above: a black flag overhead (the link tops would
    // otherwise mirror an even white scrim) with one narrow strip softbox
    // crossing it on the diagonal, so a single highlight runs across the links.
    add(new THREE.PlaneGeometry(70, 70), black, (m) => {
      m.rotation.x = Math.PI / 2;
      m.position.y = 22;
    });
    add(new THREE.PlaneGeometry(3, 80), card(4.5, 4.4, 4.2), (m) => {
      m.rotation.x = Math.PI / 2;
      m.rotation.z = 0.7;
      m.position.set(4, 21.5, -2);
    });
  }
  add(new THREE.PlaneGeometry(3.5, 30), card(2.2, 2.6, 3.0), place(new THREE.Vector3(0.65, 0.45, -0.75), 24));
  add(new THREE.PlaneGeometry(14, 3), card(1.4, 1.35, 1.3), place(new THREE.Vector3(0.4, 0.15, 0.9), 24));
  const pmrem = new THREE.PMREMGenerator(ctx.renderer.gl);
  const rt = pmrem.fromScene(env, 0.035);
  pmrem.dispose();
  disposables.forEach((d) => d.dispose());
  return rt;
}

export const FLOOR_Y = FLOOR;
