import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { media, mediaBytes, isEmbedded } from './assets.js';
import { GLSL } from './glsl.js';
import { mulberry32, noise3 } from './math.js';
import { disposeObject } from './dispose.js';

// Realism toolkit. What separates "cinematic real" from "illustration" is
// almost never the geometry: it is light that comes from an environment,
// physically based materials, an atmosphere with depth, and a camera-like
// finish (see post.js). Every helper here is tier-aware and disposable.
//
//   Lighting:   useHDRI (CC0 HDRI via fetch_cc0.py) | useSky (physical sky) | useStudio (product)
//   Surfaces:   loadPBR (CC0 texture sets)  | createTerrain (fbm heightfield)
//   Atmosphere: createMist (layered volumetric-looking mist) + scene.fog
//   Assets:     loadModel (CC0 glTF)         | softShadows

const pmremFor = (ctx) => (ctx._pmrem ||= new THREE.PMREMGenerator(ctx.renderer.gl));

/** Image-based lighting + optional background from an equirect .hdr. */
export async function useHDRI(ctx, scene, url, { background = true, blur = 0, intensity = 1, rotationY = 0, exposure } = {}) {
  // Parse the bytes ourselves (no loader fetch), so it also runs in hosts
  // whose CSP blocks fetch, such as Artifacts and Canvas.
  // Loaders are imported on first use so pages only download what they need.
  const { RGBELoader } = await import('three/addons/loaders/RGBELoader.js');
  const d = new RGBELoader().parse(await mediaBytes(url));
  const tex = new THREE.DataTexture(d.data, d.width, d.height, THREE.RGBAFormat, d.type);
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.flipY = true;
  tex.needsUpdate = true;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  const env = pmremFor(ctx).fromEquirectangular(tex).texture;
  scene.environment = env;
  scene.environmentIntensity = intensity;
  scene.environmentRotation = new THREE.Euler(0, rotationY, 0);
  if (background) {
    scene.background = tex;
    scene.backgroundBlurriness = blur;
    scene.backgroundRotation = new THREE.Euler(0, rotationY, 0);
    scene.backgroundIntensity = intensity;
  } else tex.dispose();
  if (exposure != null) ctx.renderer.gl.toneMappingExposure = exposure;
  return { env, background: background ? tex : null, dispose: () => { env.dispose(); tex.dispose(); } };
}

/** Physical (Preetham) sky with a movable sun that also lights the scene. */
export function useSky(ctx, scene, {
  elevation = 4, azimuth = 180, turbidity = 6, rayleigh = 2.2, mie = 0.006, mieG = 0.82,
  scale = 4500, envIntensity = 1, light = true,
} = {}) {
  const sky = new Sky();
  sky.scale.setScalar(scale);
  const u = sky.material.uniforms;
  u.turbidity.value = turbidity;
  u.rayleigh.value = rayleigh;
  u.mieCoefficient.value = mie;
  u.mieDirectionalG.value = mieG;
  scene.add(sky);

  const sun = new THREE.Vector3();
  const sunLight = light ? new THREE.DirectionalLight(0xffffff, 2.2) : null;
  if (sunLight) scene.add(sunLight, sunLight.target);
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(scale);
  envScene.add(envSky);
  let envRT = null;
  let lastEnv = { e: 999, a: 999 };
  const warm = new THREE.Color();

  function set(elev, az) {
    const phi = THREE.MathUtils.degToRad(90 - elev);
    const theta = THREE.MathUtils.degToRad(az);
    sun.setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(sun);
    if (sunLight) {
      sunLight.position.copy(sun).multiplyScalar(100);
      // Warm, dim light near the horizon; neutral and strong when high.
      const k = THREE.MathUtils.clamp(elev / 25, 0, 1);
      warm.setRGB(1, 0.62 + 0.36 * k, 0.38 + 0.58 * k);
      sunLight.color.copy(warm);
      sunLight.intensity = 0.4 + 2.4 * THREE.MathUtils.smoothstep(elev, -2, 20);
    }
    // Re-bake the environment only when the sun moved noticeably.
    if (Math.abs(elev - lastEnv.e) > 1.5 || Math.abs(az - lastEnv.a) > 3) {
      for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) envSky.material.uniforms[k].value = u[k].value;
      envSky.material.uniforms.sunPosition.value.copy(sun);
      envRT?.dispose();
      envRT = pmremFor(ctx).fromScene(envScene, 0.02);
      scene.environment = envRT.texture;
      scene.environmentIntensity = envIntensity;
      lastEnv = { e: elev, a: az };
    }
  }
  set(elevation, azimuth);
  return {
    sky, sun, light: sunLight, set,
    dispose: () => { disposeObject(sky); disposeObject(envSky); envRT?.dispose(); sunLight?.dispose(); },
  };
}

/** Soft studio lighting for objects (products, specimens, interiors). */
export function useStudio(ctx, scene, { intensity = 1, blur = 0.04 } = {}) {
  const env = pmremFor(ctx).fromScene(new RoomEnvironment(), blur).texture;
  scene.environment = env;
  scene.environmentIntensity = intensity;
  return { env, dispose: () => env.dispose() };
}

/** PBR material from a CC0 texture set fetched by fetch_cc0.py.
 *  files: { diff, nor_gl, rough, arm, ao, disp } (paths under media/). */
export async function loadPBR(ctx, files, { repeat = [1, 1], displacementScale = 0, color, roughness = 1, metalness = 0 } = {}) {
  const loader = new THREE.TextureLoader();
  const load = (p, srgb) => p ? loader.loadAsync(media(p)).then((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
    t.anisotropy = ctx.device.tier === 'low' ? 2 : 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }) : Promise.resolve(null);
  const [map, normalMap, roughMap, arm, ao, disp] = await Promise.all([
    load(files.diff, true), load(files.nor_gl), load(files.rough), load(files.arm), load(files.ao), load(files.disp),
  ]);
  const mat = new THREE.MeshStandardMaterial({ map, normalMap, roughness, metalness, color: color ?? 0xffffff });
  if (arm) {
    // ARM = AO (r), roughness (g), metalness (b)
    mat.aoMap = arm;
    mat.roughnessMap = arm;
    mat.metalnessMap = files.metal ? arm : null;
  } else {
    mat.roughnessMap = roughMap;
    mat.aoMap = ao;
  }
  if (disp && displacementScale) {
    mat.displacementMap = disp;
    mat.displacementScale = displacementScale;
  }
  return mat;
}

/** Heightfield terrain with ridged fbm. Returns { mesh, heightAt(x, z) }.
 *  Colour it with a PBR material, or pass `material: 'slope'` for a
 *  procedural slope/height shader (grass-to-rock) that needs no textures. */
export function createTerrain(ctx, {
  size = 400, segments = 256, height = 60, seed = 3, octaves = 6, frequency = 0.0045, ridge = 0.35,
  material, colors = { low: '#34402a', high: '#6b6558', rock: '#4a4540', peak: '#b9b2a4' },
} = {}) {
  const seg = Math.max(32, Math.round(segments * Math.sqrt(ctx.device.scale)));
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const rnd = mulberry32(seed);
  const ox = rnd() * 1000, oz = rnd() * 1000;
  const h = (x, z) => {
    let amp = 1, f = frequency, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      let n = noise3(x * f + ox, 0, z * f + oz);
      const r = 1 - Math.abs(n);
      n = n * (1 - ridge) + (r * r * 2 - 1) * ridge;
      sum += n * amp;
      norm += amp;
      amp *= 0.5;
      f *= 2.03;
    }
    return (sum / norm) * height;
  };
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, h(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  if (geo.attributes.uv) geo.setAttribute('uv1', geo.attributes.uv);

  let mat = material;
  if (!mat || mat === 'slope') {
    mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
    const c = Object.fromEntries(Object.entries(colors).map(([k, v]) => [k, new THREE.Color(v)]));
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, {
        uLow: { value: c.low }, uHigh: { value: c.high }, uRock: { value: c.rock }, uPeak: { value: c.peak }, uHeight: { value: height },
      });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNorm;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz; vWNorm = normalize(mat3(modelMatrix) * objectNormal);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vWPos; varying vec3 vWNorm; uniform vec3 uLow, uHigh, uRock, uPeak; uniform float uHeight;\n${GLSL.simplex3}`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float hN = clamp(vWPos.y / uHeight * 0.5 + 0.5, 0.0, 1.0);
          float slope = 1.0 - clamp(vWNorm.y, 0.0, 1.0);
          float n = snoise(vWPos * 0.08) * 0.5 + snoise(vWPos * 0.6) * 0.15;
          vec3 base = mix(uLow, uHigh, smoothstep(0.25, 0.75, hN + n * 0.15));
          base = mix(base, uRock, smoothstep(0.28, 0.55, slope + n * 0.2));
          base = mix(base, uPeak, smoothstep(0.82, 0.95, hN + n * 0.05) * (1.0 - slope));
          diffuseColor.rgb *= base * (0.85 + 0.3 * n);`);
    };
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return { mesh, heightAt: h, dispose: () => disposeObject(mesh) };
}

/** Layered mist / sea of clouds. Several thin fbm sheets stacked in height
 *  read as volume; they catch sun colour and fade toward the camera. */
export function createMist(ctx, {
  width = 800, depth = 800, y = 0, layers = 5, spacing = 1.6, color = '#e8e2d6', shade = '#8f8a86',
  opacity = 0.85, scale = 0.012, speed = 0.015, sunColor = '#ffd2a0',
} = {}) {
  const group = new THREE.Group();
  const n = Math.max(2, Math.round(layers * (ctx.device.tier === 'low' ? 0.5 : 1)));
  const uniforms = {
    uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uShade: { value: new THREE.Color(shade) },
    uSun: { value: new THREE.Color(sunColor) }, uSunDir: { value: new THREE.Vector3(0, 0.2, -1).normalize() },
    uOpacity: { value: opacity }, uScale: { value: scale }, uSpeed: { value: speed },
  };
  const mats = [];
  for (let i = 0; i < n; i++) {
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: { ...uniforms, uLayer: { value: i / (n - 1) } },
      vertexShader: /* glsl */ `
        varying vec3 vW; varying vec2 vUv;
        void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uOpacity, uScale, uSpeed, uLayer;
        uniform vec3 uColor, uShade, uSun, uSunDir;
        varying vec3 vW; varying vec2 vUv;
        ${GLSL.simplex3}
        ${GLSL.fbm}
        void main(){
          vec3 p = vec3(vW.xz * uScale, uLayer * 1.7) + vec3(uTime * uSpeed, 0.0, uTime * uSpeed * 0.4);
          float d = fbm(p) * 0.5 + 0.5;
          float density = smoothstep(0.38 - uLayer * 0.08, 0.78, d);
          float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x) * smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.82, vUv.y);
          float camFade = smoothstep(4.0, 40.0, distance(cameraPosition, vW));
          vec3 lit = mix(uShade, uColor, 0.35 + 0.65 * uLayer);
          float toward = pow(max(dot(normalize(vW - cameraPosition), uSunDir), 0.0), 6.0);
          lit += uSun * (0.25 * uLayer + toward * 0.6);
          gl_FragColor = vec4(lit, density * edge * camFade * uOpacity * (0.45 + 0.55 * uLayer));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, depth, 1, 1), mat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = y + i * spacing;
    plane.renderOrder = 10 + i;
    group.add(plane);
    mats.push(mat);
  }
  return {
    group, uniforms,
    update: (t) => { uniforms.uTime.value = t; },
    dispose: () => disposeObject(group),
  };
}

/** CC0 glTF model (fetch_cc0.py --model). Enables shadows on meshes.
 *  Parsed from bytes; images decode through <img> (TextureLoader), not
 *  fetch-based ImageBitmapLoader, so it works inside Artifacts too. */
export async function loadModel(url, { castShadow = true, receiveShadow = true } = {}) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  loader.register((parser) => {
    parser.textureLoader = new THREE.TextureLoader(parser.options.manager);
    return { name: 'openwebx_img_textures' };
  });
  const dir = url.slice(0, url.lastIndexOf('/') + 1);
  const buf = await mediaBytes(url);
  const gltf = await new Promise((resolve, reject) => loader.parse(buf, isEmbedded(url) ? '' : dir, resolve, reject));
  gltf.scene.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = castShadow;
      o.receiveShadow = receiveShadow;
    }
  });
  return gltf;
}

/** Tier-aware soft shadows for one key light. */
export function softShadows(ctx, light, { size = 60, bias = -0.0004 } = {}) {
  const tier = ctx.device.tier;
  if (tier === 'low') return false;
  const gl = ctx.renderer.gl;
  gl.shadowMap.enabled = true;
  gl.shadowMap.type = THREE.PCFSoftShadowMap;
  light.castShadow = true;
  const res = tier === 'high' ? 1024 : 512; // the budget table in runtime-api.md
  light.shadow.mapSize.set(res, res);
  light.shadow.bias = bias;
  light.shadow.normalBias = 0.02;
  const cam = light.shadow.camera;
  cam.left = cam.bottom = -size;
  cam.right = cam.top = size;
  cam.near = 0.5;
  cam.far = size * 6;
  cam.updateProjectionMatrix();
  return true;
}

/** Distance fog that matches the sky at the horizon. */
export function atmosphere(scene, color = '#b9a58a', density = 0.0012) {
  scene.fog = new THREE.FogExp2(new THREE.Color(color), density);
  return scene.fog;
}
