import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { damp, clamp, lerp, noise3 } from '../core/math.js';
import { disposeObject } from '../core/dispose.js';
import { useStudio, softShadows } from '../core/realism.js';
import { createPost } from '../core/post.js';

// Reference scene shipped with the kit. It works out of the box and doubles
// as the contract example for builders: a small lit set (a seamless paper
// sweep, a bevelled stone plinth and a turned ceramic vessel with a brass
// foot) rather than a world. A key light with a clear direction travels
// round the set as the story advances, so every chapter is a different,
// properly lit frame (G-light). Holding the pointer spins the turntable up
// and the key light warms; release lets it coast. Hovering (or, on touch,
// tapping) the vessel names the current chapter with an anchored tag
// (ctx.tags) and plays the `touch` cue (ctx.sound). The camera frames the
// set in the free space beside the text: the scene declares its subject
// (ctx.layout.subject) and follows ctx.layout.frame() with a lens shift and
// a distance, so the subject is never parked behind a paragraph.
// The builder replaces this file (and may add sibling modules) per brief.

const TARGET = new THREE.Vector3(0, 0.55, 0);

// A seamless studio sweep: floor, a curved cove, then the back wall.
function sweepGeometry(width, segs) {
  const floor = 26, radius = 7, wall = 30;
  const arc = (Math.PI / 2) * radius;
  const length = floor + arc + wall;
  const geo = new THREE.PlaneGeometry(width, length, 1, segs);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const s = (pos.getY(i) / length + 0.5) * length; // 0 at the front edge
    let y, z;
    if (s < floor) {
      y = 0;
      z = 16 - s;
    } else if (s < floor + arc) {
      const a = (s - floor) / radius;
      y = radius - Math.cos(a) * radius;
      z = 16 - floor - Math.sin(a) * radius;
    } else {
      y = radius + (s - floor - arc);
      z = 16 - floor - radius;
    }
    pos.setXYZ(i, pos.getX(i), y, z);
  }
  geo.computeVertexNormals();
  return geo;
}

// Turned profile of the vessel: foot, belly, shoulder, neck and a rolled lip.
function vesselProfile() {
  const pts = [];
  const add = (x, y) => pts.push(new THREE.Vector2(x, y));
  add(0.0, 0.0);
  add(0.42, 0.0);
  add(0.46, 0.03);
  add(0.44, 0.1);
  for (let k = 0; k <= 16; k++) {
    const t = k / 16;
    add(0.44 + Math.sin(t * Math.PI * 0.95) * 0.42 - t * 0.12, 0.1 + t * 1.15);
  }
  add(0.3, 1.36);
  add(0.27, 1.5);
  add(0.29, 1.6);
  add(0.33, 1.64); // rolled lip
  add(0.31, 1.67);
  add(0.26, 1.63);
  add(0.24, 1.5);
  add(0.0, 1.45);
  return pts;
}

// Small tiling noise map: roughness variation and fine bump for stone and glaze.
function noiseTexture(size, scale, seed) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      // Periodic sampling on a torus so the texture tiles.
      const a = u * Math.PI * 2, b = v * Math.PI * 2;
      const n = noise3(Math.cos(a) * scale + seed, Math.sin(a) * scale, Math.cos(b) * scale + Math.sin(b) * scale * 0.7)
        * 0.6 + noise3(u * scale * 9 + seed, v * scale * 9, seed) * 0.4;
      const c = clamp(128 + n * 200, 0, 255);
      data.set([c, c, c, 255], (y * size + x) * 4);
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

export default class Scene {
  constructor(ctx) {
    this.ctx = ctx;
    const pal = ctx.brief.palette || {};
    this.dark = (pal.scheme || 'dark') === 'dark';
    const fov = ctx.brief.look?.camera?.fov ?? 34;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(fov, ctx.size.aspect, 0.1, 120);
    this.camera.position.set(0, 2.2, 9);
    this.group = new THREE.Group();
    this.scene.add(this.group);

    // Palette: paper from the page colours, accent tints the glaze.
    const bg = new THREE.Color(pal.bg || (this.dark ? '#14120f' : '#ece7df'));
    const ink = new THREE.Color(pal.ink || (this.dark ? '#f2ede4' : '#1a1814'));
    this.paper = bg.clone().lerp(ink, this.dark ? 0.34 : 0.12);
    this.glaze = new THREE.Color(pal.accent || '#b8a27a').lerp(new THREE.Color('#f4efe6'), 0.35);
    this.scene.background = this.paper.clone().multiplyScalar(this.dark ? 0.32 : 0.7);
    this.scene.fog = new THREE.Fog(this.scene.background, 22, 60);

    this.spin = 0;
    this.spinSpeed = 0;
    this.heat = 0;
    this.kick = 0;
    this.orbit = 0;
    this.names = (ctx.brief.chapters || []).map((c) => c.name || '');
    this.tagAnchor = new THREE.Object3D();
    this.tagAnchor.position.set(0, 2.55, 0);
    this.group.add(this.tagAnchor);
    this._hit = new THREE.Sphere(new THREE.Vector3(0, 1.4, 0), 1.0);
    this._ray = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this.hovering = false;
    // Framing: the subject's bounds, and the damped lens shift / distance.
    this.subjectSphere = new THREE.Sphere(TARGET.clone(), 1.9);
    ctx.layout.subject(this.subjectSphere);
    this.shiftX = 0;
    this.shiftY = 0;
    this.dist = 9;
    this._dir = new THREE.Vector3();
  }

  async load(progress) {
    const ctx = this.ctx;
    const scale = ctx.device.scale;
    const segs = Math.max(24, Math.round(96 * scale));

    // Environment for reflections and bounce, kept low so the key light wins.
    this.studio = useStudio(ctx, this.scene, { intensity: this.dark ? 0.32 : 0.55 });
    progress(0.2);

    this.rough = noiseTexture(128, 2.2, 3);
    this.speck = noiseTexture(128, 6, 11);
    await ctx.yieldTask();
    progress(0.45);

    // Set: sweep, plinth, turntable with vessel and brass foot ring.
    const sweep = new THREE.Mesh(sweepGeometry(70, segs), new THREE.MeshStandardMaterial({ color: this.paper, roughness: 0.92 }));
    sweep.position.y = -0.72;
    sweep.receiveShadow = true;
    this.group.add(sweep);

    const stone = new THREE.MeshStandardMaterial({
      color: this.paper.clone().lerp(new THREE.Color('#8d877e'), 0.6), roughness: 0.85,
      roughnessMap: this.rough, bumpMap: this.speck, bumpScale: 0.3,
    });
    const plinth = new THREE.Mesh(new RoundedBoxGeometry(2.6, 0.72, 2.6, 4, 0.06), stone);
    plinth.position.y = -0.36;
    plinth.castShadow = plinth.receiveShadow = true;
    this.group.add(plinth);

    this.turntable = new THREE.Group();
    this.group.add(this.turntable);
    const ceramic = new THREE.MeshPhysicalMaterial({
      color: this.glaze, roughness: 0.38, roughnessMap: this.speck, clearcoat: 0.6, clearcoatRoughness: 0.25,
      bumpMap: this.speck, bumpScale: 0.15, sheen: 0.2,
    });
    const vessel = new THREE.Mesh(new THREE.LatheGeometry(vesselProfile(), segs), ceramic);
    vessel.position.y = 0.12;
    vessel.castShadow = vessel.receiveShadow = true;
    this.turntable.add(vessel);
    const brass = new THREE.MeshStandardMaterial({ color: '#b08a4a', metalness: 1, roughness: 0.32, roughnessMap: this.rough });
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.56, 0.12, segs), brass);
    foot.position.y = 0.06;
    foot.castShadow = foot.receiveShadow = true;
    this.turntable.add(foot);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.018, 8, segs), brass);
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.3;
    this.turntable.add(band);
    progress(0.75);

    // Key light with a clear direction (shadows decided once, here), a cool
    // rim from behind and nothing else: contrast comes from the key.
    this.key = new THREE.DirectionalLight('#fff1dc', this.dark ? 3.4 : 2.6);
    this.key.target.position.copy(TARGET);
    this.scene.add(this.key, this.key.target);
    softShadows(ctx, this.key, { size: 5, bias: -0.0006 });
    this.rim = new THREE.DirectionalLight('#cfdcff', this.dark ? 1.2 : 0.8);
    this.rim.position.set(-4, 5, -6);
    this.scene.add(this.rim);
    this.keyColor = new THREE.Color('#fff1dc');
    this.warm = new THREE.Color('#ffc58a');

    this.post = createPost(ctx, this.scene, this.camera, {
      bloom: { strength: 0.22, radius: 0.5, threshold: 0.92 }, grain: 0.035, vignette: 0.32,
    });

    ctx.bus.on('release', ({ hold }) => {
      this.spinSpeed += 1.2 + Math.min(2, hold) * 1.4;
    });
    ctx.bus.on('chapter', () => (this.kick = 1));
    progress(1);
  }

  resize(size) {
    this.camera.aspect = size.aspect;
    // Resets the lens shift; update() writes it again every frame.
    this.camera.updateProjectionMatrix();
    this.post?.resize(size);
  }

  update({ time, dt, scroll, pointer, reduced }) {
    if (!this.post) return;
    const motion = reduced ? 0 : 1;
    const k = reduced ? 30 : 2.5;
    const story = scroll.story;
    const chapter = this.ctx.brief.chapters?.[scroll.chapter];

    // The key light travels round the set with the story: low and raking at
    // the start, high at the middle, back down to the other side at the end.
    const last = Math.max(1, scroll.chapterCount - 1);
    const t = clamp(story / last, 0, 1);
    const az = lerp(-0.9, 2.2, t) + Math.sin(time * 0.05) * 0.05 * motion;
    const el = 0.35 + Math.sin(t * Math.PI) * 0.55;
    this.key.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(9).add(TARGET);
    const tone = chapter?.tone;
    const level = tone === 'night' ? 0.45 : tone === 'bright' ? 1.25 : 1;
    this.heat = damp(this.heat, pointer.down ? Math.min(1, pointer.hold * 0.8) : 0, 4, dt);
    this.key.color.copy(this.keyColor).lerp(this.warm, this.heat * 0.6);
    this.key.intensity = damp(this.key.intensity, (this.dark ? 3.4 : 2.6) * level * (1 + this.heat * 0.25), 3, dt);

    // Turntable: idle drift, spun up while held, coasting after release.
    if (pointer.down) this.spinSpeed = damp(this.spinSpeed, 2.4, 1.5, dt);
    this.spinSpeed = damp(this.spinSpeed, pointer.idle > 5 ? 0.18 : 0.08, 0.8, dt);
    this.spin += dt * this.spinSpeed * motion;
    this.turntable.rotation.y = this.spin;

    // Camera: orbit a little per chapter, frame the subject in the free area
    // (lens shift + distance), plus inertial parallax and a push on chapter change.
    this.orbit = damp(this.orbit, lerp(0.35, -0.45, t), reduced ? 30 : 1.6, dt);
    const f = this.ctx.layout.frame(this.camera, this.subjectSphere, { fill: 0.55, bleed: chapter?.frame === 'bleed' });
    this.shiftX = damp(this.shiftX, f.shiftX, k, dt);
    this.shiftY = damp(this.shiftY, f.shiftY, k, dt);
    this.dist = damp(this.dist, clamp(this.camera.position.distanceTo(TARGET) * f.distanceScale, 4, 30), k, dt);
    this.kick = damp(this.kick, 0, 3, dt);
    const d = this.dist - this.kick * 0.5 * motion;
    const yaw = this.orbit + pointer.sx * 0.12 * motion;
    const pitch = 0.2 + pointer.sy * 0.06 * motion;
    this._dir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    this.camera.position.copy(TARGET).addScaledVector(this._dir, d);
    this.camera.lookAt(TARGET);
    const e = this.camera.projectionMatrix.elements;
    e[8] = this.shiftX;
    e[9] = this.shiftY;
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();

    // Anchored tag: the runtime projects tagAnchor every frame and keeps the
    // label off the text column and, with `avoid`, off the vessel itself.
    // Passing null clears it (on touch a tapped tag stays until the next tap).
    let over = false;
    if (pointer.inside) {
      this._ndc.set(pointer.x, pointer.y);
      this._ray.setFromCamera(this._ndc, this.camera);
      over = this._ray.ray.intersectsSphere(this._hit);
    }
    if (over && !this.hovering) this.ctx.sound.cue('touch');
    this.hovering = over;
    this.ctx.tags.set(over ? this.names[scroll.chapter] || null : null, this.tagAnchor, { avoid: this.turntable });
    this.time = time;
  }

  render() {
    this.post?.render(this.time);
  }

  dispose() {
    this.post?.dispose();
    this.studio?.dispose();
    this.rough?.dispose();
    this.speck?.dispose();
    disposeObject(this.group);
  }
}
