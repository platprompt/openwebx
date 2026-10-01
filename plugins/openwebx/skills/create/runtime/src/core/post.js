import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Camera-like finish: the difference between "rendered" and "filmed".
//   bloom     highlights bleed (keep subtle; threshold high)
//   dof       shallow depth of field on the subject (high tier only)
//   grade     lift/gamma/gain, saturation, warmth (after tone mapping)
//   grain     fine film grain (kills banding in skies and fog)
//   vignette  darkened frame edges
//   chroma    tiny lens chromatic aberration at the edges
//   quiet     0..1 quiet zone under the text over the world: softens and
//             desaturates only there, and darkens bright areas to a legible
//             level (light schemes, whose ink is dark, lighten instead) (rects from ctx.layout; default
//             brief.look.quiet, else 0.6). Replaces boxes behind the text.
// A scene using this must set scene.background (the composer is opaque).
//
//   this.post = createPost(ctx, this.scene, this.camera, { bloom: { strength: .35 }, grain: .045, vignette: .3 });
//   render() { this.post ? this.post.render(time) : ctx.renderer.gl.render(this.scene, this.camera); }
//   resize(s) { this.post?.resize(s); }

const FINISH = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.04 }, uVignette: { value: 0.3 },
    uChroma: { value: 0.0 }, uLift: { value: new THREE.Vector3(0, 0, 0) }, uGamma: { value: new THREE.Vector3(1, 1, 1) },
    uGain: { value: new THREE.Vector3(1, 1, 1) }, uSaturation: { value: 1 }, uWarmth: { value: 0 },
    uQuiet: { value: 0 }, uQuietLight: { value: 0 }, uQuietCount: { value: 0 }, uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
    uQuietRect: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime, uGrain, uVignette, uChroma, uSaturation, uWarmth;
    uniform vec3 uLift, uGamma, uGain; varying vec2 vUv;
    uniform float uQuiet, uQuietLight, uQuietCount; uniform vec4 uQuietRect[3]; uniform vec2 uTexel;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    // Feathered mask of the text rects (UV, y up): 1 under the text, 0 in the free area.
    float quietMask(vec2 uv){
      float m = 0.0;
      for (int i = 0; i < 3; i++) {
        if (float(i) >= uQuietCount) break;
        vec4 r = uQuietRect[i];
        vec2 f = vec2(0.07, 0.09);
        float mx = smoothstep(r.x - f.x, r.x + f.x * 0.25, uv.x) * (1.0 - smoothstep(r.z - f.x * 0.25, r.z + f.x, uv.x));
        float my = smoothstep(r.y - f.y, r.y + f.y * 0.25, uv.y) * (1.0 - smoothstep(r.w - f.y * 0.25, r.w + f.y, uv.y));
        m = max(m, mx * my);
      }
      return m;
    }
    void main(){
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec3 col;
      if (uChroma > 0.0) {
        vec2 off = c * r2 * uChroma;
        col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      } else col = texture2D(tDiffuse, vUv).rgb;
      float q = uQuiet > 0.0 ? quietMask(vUv) * uQuiet : 0.0;
      if (q > 0.001) {
        vec2 o = uTexel * 3.0;
        vec3 soft = (texture2D(tDiffuse, vUv + vec2(o.x, o.y)).rgb + texture2D(tDiffuse, vUv + vec2(-o.x, o.y)).rgb
          + texture2D(tDiffuse, vUv + vec2(o.x, -o.y)).rgb + texture2D(tDiffuse, vUv - o).rgb) * 0.25;
        col = mix(col, soft, min(1.0, q * 1.2));
      }
      col = pow(max(col * uGain + uLift * (1.0 - col), 0.0), 1.0 / uGamma);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation);
      if (q > 0.001) {
        // Quiet zone: desaturate a little, then pull the luminance under the
        // text toward a legible level (display space; about 4.5:1 or better
        // for the scheme's ink). Bright areas move far more than areas that
        // are already quiet, so it never reads as a grey box.
        col = mix(col, vec3(l), q * 0.35);
        float a = min(1.0, q * 1.6);
        if (uQuietLight > 0.5) {
          float need = clamp((0.82 - l) / max(1.0 - l, 1e-3), 0.0, 1.0);
          col = mix(col, vec3(1.0), a * max(need, 0.12));
        } else {
          col *= mix(1.0, min(0.88, 0.36 / max(l, 1e-3)), a);
        }
      }
      col += vec3(0.06, 0.02, -0.05) * uWarmth;
      col *= 1.0 - uVignette * smoothstep(0.1, 0.75, r2 * 2.0);
      col += (h(vUv * 1000.0 + fract(uTime) * 100.0) - 0.5) * uGrain;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function createPost(ctx, scene, camera, opts = {}) {
  // Legacy signature: createPost(ctx, scene, camera, { strength, radius, threshold })
  if (opts.strength != null && opts.bloom == null) opts = { bloom: { strength: opts.strength, radius: opts.radius, threshold: opts.threshold } };
  const {
    bloom = { strength: 0.35, radius: 0.5, threshold: 0.85 }, dof = false, grain = 0.04, vignette = 0.28, chroma = 0,
    grade = {}, quiet = ctx.brief?.look?.quiet ?? 0.6,
  } = opts;
  const layout = ctx.layout;
  // The camera finish owns the quiet zone now: the CSS fallback steps aside.
  if (layout && quiet > 0) {
    layout.postQuiet = true;
    document.documentElement.classList.remove('ox-quiet-css');
  }
  const tier = ctx.device.tier;
  const { gl, size } = ctx.renderer;
  const composer = new EffectComposer(gl);
  composer.setPixelRatio(size.dpr);
  composer.setSize(size.width, size.height);
  composer.addPass(new RenderPass(scene, camera));

  let bokeh = null;
  if (dof && tier === 'high') {
    bokeh = new BokehPass(scene, camera, { focus: dof.focus ?? 10, aperture: dof.aperture ?? 0.00015, maxblur: dof.maxblur ?? 0.006 });
    // BokehPass draws the whole scene into its depth buffer with one opaque
    // material: points and sprites lose their size and soft, additive or
    // see-through things (haze, dust, glows) become solid walls. Hide them
    // for that pass only; they are blurred enough on their own.
    const airy = [];
    const isAiry = (o) => o.visible && (o.isPoints || o.isSprite || (o.material && !Array.isArray(o.material)
      && o.material.transparent && o.material.depthWrite === false));
    const depthRender = bokeh.render.bind(bokeh);
    bokeh.render = (...args) => {
      airy.length = 0;
      scene.traverseVisible((o) => isAiry(o) && airy.push(o));
      for (const o of airy) o.visible = false;
      try {
        depthRender(...args);
      } finally {
        for (const o of airy) o.visible = true;
      }
    };
    composer.addPass(bokeh);
  }
  let bloomPass = null;
  if (bloom && tier !== 'low') {
    bloomPass = new UnrealBloomPass(new THREE.Vector2(size.width, size.height), bloom.strength ?? 0.35, bloom.radius ?? 0.5, bloom.threshold ?? 0.85);
    composer.addPass(bloomPass);
  }
  composer.addPass(new OutputPass());
  const finish = new ShaderPass(FINISH);
  const u = finish.uniforms;
  u.uGrain.value = grain;
  u.uVignette.value = vignette;
  u.uQuietLight.value = ctx.brief?.palette?.scheme === 'light' ? 1 : 0;
  u.uChroma.value = tier === 'high' ? chroma : 0;
  if (grade.lift) u.uLift.value.fromArray(grade.lift);
  if (grade.gamma) u.uGamma.value.fromArray(grade.gamma);
  if (grade.gain) u.uGain.value.fromArray(grade.gain);
  if (grade.saturation != null) u.uSaturation.value = grade.saturation;
  if (grade.warmth != null) u.uWarmth.value = grade.warmth;
  composer.addPass(finish);
  u.uTexel.value.set(1 / Math.max(1, size.width), 1 / Math.max(1, size.height));
  const syncQuiet = () => {
    const n = layout && quiet > 0 ? layout.quietCount : 0;
    u.uQuiet.value = n ? quiet : 0;
    u.uQuietCount.value = n;
    for (let k = 0; k < n; k++) {
      const r = layout.quietRects;
      u.uQuietRect.value[k].set(r[k * 4], r[k * 4 + 1], r[k * 4 + 2], r[k * 4 + 3]);
    }
  };

  return {
    composer, bloom: bloomPass, bokeh, finish,
    render: (time = performance.now() / 1000) => {
      // Reduced motion: grain holds still instead of re-seeding every frame.
      u.uTime.value = ctx.motion.reduced ? 0 : time;
      syncQuiet();
      composer.render();
    },
    setFocus: (distance) => bokeh && (bokeh.uniforms.focus.value = distance),
    resize: (s) => {
      composer.setPixelRatio(s.dpr);
      composer.setSize(s.width, s.height);
      u.uTexel.value.set(1 / Math.max(1, s.width), 1 / Math.max(1, s.height));
    },
    dispose: () => {
      bloomPass?.dispose();
      bokeh?.dispose?.();
      finish.dispose?.();
      composer.dispose();
    },
  };
}
