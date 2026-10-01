import * as THREE from 'three';
import { damp, clamp, lerp, smoothstep, noise3 } from '../core/math.js';
import { disposeObject } from '../core/dispose.js';
import { useHDRI } from '../core/realism.js';
import { createPost } from '../core/post.js';
import { media } from '../core/assets.js';
import { buildWatch, HC } from './watch.js';
import { bracelet, strapGeometry, lugPath, keeperGeometry, buckleFrameGeometry, rubberBump } from './straps.js';
import { createSweep, createSlab, createSlabMaterial, contactShadow, createLights, createLamp, bakeStudioEnv, FLOOR_Y } from './studio.js';
import { createBranch } from './fireflies.js';
import { Meter } from './meter.js';
import { loadImage } from './maps.js';

// One Light, One Night. A night product shoot of one watch on a slate slab
// in a dark green studio. The reader holds the only light: the pointer moves
// the strip softbox round the watch, holding charges the lume, letting go
// dips the light so the dots answer. Scroll walks the shoot: hero, dial
// macro, lights out (dots, hands and the fireflies on the lamphu branch glow
// the same yellow-green), the watch turned over, the profile, the straps in
// a row, the catalogue frame beside the spec ledger, a calm low light, and
// one warm lamp at the end.
//
// Actors: watch.js (the procedural watch), straps.js (leather / steel /
// rubber), studio.js (sweep, slab, lights, lamp), fireflies.js (branch and
// bokeh), meter.js (the camera's light meter, which rides exposure so every
// shot stays inside the brief's light target), maps.js (canvas textures).

const D2R = Math.PI / 180;

// Camera and staging per chapter, on top of the brief's params (key, rim,
// fireflies, lume, practical). yaw 0 = from six o'clock; pitch from the slab.
const STAGE = [
  { yaw: 0.55, pitch: 0.36, fill: 0.62, subject: 'head', pool: 1.0, aperture: 0.0014 },
  { yaw: 0.12, pitch: 1.0, fill: 0.72, subject: 'dial', pool: 0.85, aperture: 0.006 },
  { yaw: 0.2, pitch: 0.3, fill: 0.58, subject: 'head', pool: 0.0, swell: 1.1, pulse: 0.22, aperture: 0.0016 },
  { yaw: 0.35, pitch: 0.92, fill: 0.7, subject: 'head', flip: 1, pool: 1.0, aperture: 0.004 },
  // Profile: camera a little above the slab so the wall stays in the top third; the case fills the frame.
  { yaw: 1.35, pitch: 0.2, fill: 0.9, subject: 'head', pool: 0.85, aperture: 0.003 },
  { yaw: 0.0, pitch: 1.3, fill: 1.0, subject: 'row', sep: 1, row: 1, pool: 0.9, aperture: 0.0012 },
  // Catalogue: frontal three-quarter, everything sharp, the most even light (no DOF, no haze, more fill).
  { yaw: 0.15, pitch: 0.72, fill: 0.56, subject: 'watch', pool: 1.0, aperture: 0, haze: 0, fillL: 0.65 },
  // Calm: low and close from the nine o'clock side, the seconds hand sweeping across the dial.
  { yaw: -0.45, pitch: 0.26, fill: 0.8, subject: 'head', pool: 0.7, swell: 1.1, aperture: 0.002 },
  { yaw: 0.55, pitch: 0.36, fill: 0.62, subject: 'head', pool: 0.7, swell: 1.15, pulse: 0.3, aperture: 0.0014, bloomT: 1.6 },
];

const KEY_AREA = 9; // strip softbox radiance at level 1
const RIM_AREA = 12;
const LAMP = 650; // practical (candela at cm scale)
const FF = 2.4; // firefly bokeh brightness at level 1
const POOL = 4.2; // background-light pool gain at level 1
const LUME = 3.4; // lume emission at full glow
const HEAD_PARTS = new Set(['lume', 'crystal', 'crown', 'rotor', 'balance', 'movement', 'case', 'watch']);
const DAMPED = ['keyI', 'rim', 'ff', 'lume', 'lamp', 'fillL', 'pool', 'swell', 'pulse', 'aperture', 'night', 'fill', 'haze', 'bloomT'];

export default class Scene {
  constructor(ctx) {
    this.ctx = ctx;
    const brief = ctx.brief || {};
    this.brief = brief;
    this.chapters = brief.chapters || [];
    this.sceneBrief = brief.scene || {};
    this.tagWords = this.sceneBrief.tags || {};
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#060908');
    const fov = brief.look?.camera?.fov ?? 30;
    this.camera = new THREE.PerspectiveCamera(fov, ctx.size.aspect, 0.5, 500);
    this.camera.position.set(8, 9, 22);
    this.camera.lookAt(0, 0.6, 0);
    this.root = new THREE.Group();
    this.scene.add(this.root);

    // Shot state (damped toward the current chapter).
    const s0 = this._shot(0);
    this.s = { ...s0 };
    this.T = new THREE.Vector3(0, 0.6, 0);
    this.dist = 24;
    this.shiftX = 0;
    this.shiftY = 0;
    this.aim = new THREE.Vector3(0, 0.6, 0);
    this.ptrYaw = 0;
    this.ptrEl = 0;
    this.heat = 0;
    this.dip = 0;
    this.dipTimer = 0;
    this.charge = 1; // the dots show first, in the dark, on arrival
    this.glow = 1;
    this.arrive = 0;
    this.time = 0;
    this.clock = 0;
    this.tickAcc = 0;
    this.rotorAngle = 0.9;
    this.chapter = -1;
    this.exp = 1;
    this.expTarget = 1;
    this.litExp = 1;
    this.nightExp = 1.7;
    this.punch = 0;
    this.memory = [];
    this.lastMeter = 0;
    this.chapterAt = 0;
    this.hover = null;
    this.ffDraw = 1;
    this._ffOpts = { level: 0, swell: 1, pulseDepth: 0.5, reduced: false };
    this._tickSoft = { intensity: 0.35 };
    this._tickFull = { intensity: 1 };

    this.subjectBox = new THREE.Box3(new THREE.Vector3(-2, 0, -2.3), new THREE.Vector3(2.4, 1.2, 2.3));
    ctx.layout.subject(this.subjectBox);
    // Straps row plus the head set down above it (the strap tails may run out of frame below).
    this.rowBox = new THREE.Box3(new THREE.Vector3(-6, 0, -14.9), new THREE.Vector3(6, 1.2, 14));

    // Scratch objects (no allocation in update).
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._c = new THREE.Vector3();
    this._ndc = new THREE.Vector2();
    this._ray = new THREE.Raycaster();
    this._lray = new THREE.Ray();
    this._inv = new THREE.Matrix4();
    this._sph = new THREE.Sphere();
    this._box = new THREE.Box3();
    this._hit = new THREE.Vector3();
    this._planeUp = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.9);
    this._planeDown = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    this.tagAnchor = new THREE.Vector3();
    this.amber = new THREE.Color('#ffb46b');
    this.poolBase = new THREE.Color('#55604f');
    this.poolWarm = new THREE.Color('#7a5a3c');
    this.keyCool = new THREE.Color(this.sceneBrief.lights?.key?.color || '#fff3e2');
    this.keyWarm = new THREE.Color('#ffc98f');
    this.lumeGreen = new THREE.Color(this.sceneBrief.lume?.glow || '#c9f06c');
    this.lumeCream = new THREE.Color('#fff0cf');
    this.tint = 0;

    // Per-chapter light bands for the meter (brief light_target, kept inside the G-light gate).
    this.bands = this.chapters.map((c) => {
      const t = c.params?.light_target?.mean || [0.14, 0.3];
      const floor = c.tone === 'night' ? 0.05 : 0.1;
      // Margin above the gate floor; more on mid/low tiers (smaller frames, no bloom).
      const lo = Math.max(t[0], floor + (ctx.device.tier === 'high' ? 0.035 : 0.06));
      return { lo, hi: Math.max(lo + 0.04, Math.min(0.8, t[1])), contrast: 0.36 };
    });

    // Ledger rows (spec chapter): which part each row names.
    this.ledger = { rows: [], centers: [], labels: [], at: -1e9, index: -1 };
  }

  _shot(i) {
    const c = this.chapters[i] || {};
    const p = c.params || {};
    const st = STAGE[i] || STAGE[0];
    const night = c.tone === 'night';
    return {
      yaw: st.yaw, pitch: st.pitch, fill: st.fill,
      keyI: p.key?.intensity ?? 1, keyAz: (p.key?.azimuth ?? -40) * D2R, keyEl: (p.key?.elevation ?? 35) * D2R,
      rim: Math.max(this.sceneBrief.lights?.rim?.min_intensity ?? 0.18, p.rim ?? 0.4),
      ff: p.fireflies ?? 0.2, lume: p.lume ?? 0, lamp: p.practical?.intensity ?? 0, fillL: st.fillL ?? p.fill ?? 0,
      pool: st.pool ?? 1, swell: st.swell ?? 1, pulse: st.pulse ?? 0.55, aperture: st.aperture ?? 0.0012,
      haze: st.haze ?? 1, bloomT: st.bloomT ?? (this.brief.look?.post?.bloom?.threshold ?? 0.9),
      flip: st.flip ?? 0, sep: st.sep ?? 0, row: st.row ?? 0, night: night ? 1 : 0,
    };
  }

  async load(progress) {
    const ctx = this.ctx;
    const tier = ctx.device.tier;
    const scale = ctx.device.scale;

    // Camera finish first, so the arrival can be drawn while the rest loads.
    this.post = createPost(ctx, this.scene, this.camera, {
      bloom: { strength: this.brief.look?.post?.bloom?.strength ?? 0.22, radius: 0.55, threshold: this.brief.look?.post?.bloom?.threshold ?? 0.9 },
      grain: this.brief.look?.post?.grain ?? 0.03,
      vignette: this.brief.look?.post?.vignette ?? 0.22,
      dof: { focus: 24, aperture: 0.0014, maxblur: 0.018 },
      grade: { warmth: this.brief.look?.post?.grade?.warmth ?? 0.08 },
    });
    // Keep the bokeh sprites and soft leaves out of the depth pass: they are
    // already out of focus, and points have no size in a depth material.
    if (this.post.bokeh) {
      const pass = this.post.bokeh;
      const run = pass.render.bind(pass);
      pass.render = (...args) => {
        const a = this.branch?.points;
        const b = this.branch?.leaves;
        if (a) a.visible = false;
        if (b) b.visible = false;
        run(...args);
        if (a) a.visible = true;
        if (b) b.visible = true;
      };
    }

    this.sweep = createSweep(ctx, this.sceneBrief.set?.sweep || {});
    this.root.add(this.sweep.mesh);
    this.lights = createLights(ctx, this.scene, {
      keyColor: this.sceneBrief.lights?.key?.color, rimColor: this.sceneBrief.lights?.rim?.color, lampColor: this.sceneBrief.lights?.practical?.color,
    });
    progress(0.08);

    // Media in parallel: HDRI (reflections only, never the background), leather, slate.
    const loader = new THREE.TextureLoader();
    const tex = (url) => loader.loadAsync(url).then((t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = tier === 'low' ? 2 : 8;
      return t;
    }).catch(() => null);
    // The HDRI is kept as a texture (background: true hands it back) so it can
    // be baked into the flagged studio environment below; never the backdrop.
    const hdriP = useHDRI(ctx, this.scene, 'media/cc0/hdri/studio_small_09_512.hdr', { background: true, intensity: 0.35 })
      .then((h) => {
        this.scene.background = new THREE.Color('#060908');
        return h;
      })
      .catch(() => null);
    const leatherP = Promise.all([
      loadImage(media('media/cc0/tex/brown_leather/brown_leather_diff_512.jpg')),
      tex(media('media/cc0/tex/brown_leather/brown_leather_nor_gl_512.jpg')),
    ]);

    const [img, nor] = await leatherP;
    const arm = null;
    if (nor) nor.repeat.set(0.3, 1.6);
    progress(0.3);
    await ctx.yieldTask();

    // The watch: the lume dots glow in the dark before the key light rises.
    const segs = tier === 'low' ? 72 : 128;
    this.watch = await buildWatch(ctx, { leather: { img, normal: nor, arm }, segs });
    this.root.add(this.watch.root);
    this.shadow = contactShadow();
    this.root.add(this.shadow.mesh);
    progress(0.5);
    await ctx.yieldTask();

    const hdri = await hdriP;
    this.scene.background = new THREE.Color('#060908');
    try {
      this.env = bakeStudioEnv(ctx, hdri?.background || null);
      // A second bake for the flat lay seen from above (straps shot): black flag overhead, one diagonal strip.
      this.envFlat = bakeStudioEnv(ctx, hdri?.background || null, { flatLay: true });
      this.scene.environment = this.env.texture;
      hdri?.dispose();
    } catch (err) {
      this.env = hdri; // fall back to the plain HDRI light
    }
    progress(0.65);

    const slab = createSlabMaterial();
    this.slabMat = slab.mat;
    this.slabUniforms = slab.uniforms;
    this.slab = createSlab(slab.mat);
    this.root.add(this.slab);
    progress(0.78);
    await ctx.yieldTask();

    // Accessory straps (parked at the slab edges until the straps shot).
    this.steelSatin = new THREE.MeshPhysicalMaterial({ color: '#a7abae', metalness: 1, roughness: 0.35, anisotropy: 0.35, anisotropyRotation: Math.PI / 2 });
    this.steelPolished = new THREE.MeshPhysicalMaterial({ color: '#a7abae', metalness: 1, roughness: 0.15 });
    this.bracelet = bracelet({ satin: this.steelSatin, polished: this.steelPolished });
    this.root.add(this.bracelet);
    // FKM rubber: rounded section, fine matte texture, a keeper loop and a steel buckle.
    this.rubberBump = rubberBump();
    const rubberMat = new THREE.MeshStandardMaterial({ color: '#1c201e', roughness: 0.6, vertexColors: true, bumpMap: this.rubberBump, bumpScale: 0.6 });
    this.rubberMat = rubberMat;
    this.rubber = new THREE.Group();
    const flat = lugPath({ z0: 1.95, yb: 0.17, yFlat: 0.17 });
    for (const [len, dir] of [[11.4, 1], [7.4, -1]]) {
      const m = new THREE.Mesh(strapGeometry({ len, w0: 2.0, w1: 1.7, t0: 0.36, t1: 0.32, paths: [flat], dir, edge: 0.85, round: 0.42 }), rubberMat);
      m.castShadow = m.receiveShadow = true;
      this.rubber.add(m);
    }
    const keeper = new THREE.Mesh(keeperGeometry(2.25, 0.62, 0.55), rubberMat);
    keeper.position.set(0, 0.2, 1.95 + 2.8);
    const [frame, tongue] = buckleFrameGeometry();
    const buckle = new THREE.Group();
    buckle.add(new THREE.Mesh(frame, this.steelPolished), new THREE.Mesh(tongue, this.steelPolished));
    buckle.position.set(0, 0.03, -(1.95 + 7.4 + 0.25));
    for (const m of [keeper, ...buckle.children]) m.castShadow = true;
    this.rubber.add(keeper, buckle);
    this.root.add(this.rubber);
    this.braceletBox = new THREE.Box3().setFromObject(this.bracelet);
    this.rubberBox = new THREE.Box3().setFromObject(this.rubber);
    // The spare straps stay off the set until the straps shot.
    this.bracelet.visible = this.rubber.visible = false;
    // Strap pieces in body space (the strap group sits at the body origin).
    this.leatherBox = new THREE.Box3().copy(this.watch.longPiece.geometry.boundingBox).union(this.watch.shortPiece.geometry.boundingBox);

    // The lamp (dark until the last shot) and the branch with its fireflies.
    this.lamp = createLamp();
    this.lamp.group.position.set(-20.5, FLOOR_Y, -17);
    this.lamp.group.scale.setScalar(0.85);
    this.lamp.group.updateMatrixWorld(true);
    this.lights.lamp.position.copy(this.lamp.light).applyMatrix4(this.lamp.group.matrixWorld);
    this.root.add(this.lamp.group);
    const ffBrief = this.sceneBrief.fireflies || {};
    const sizeComp = Math.pow(1 / Math.max(0.3, scale), 0.35);
    const sizes = ffBrief.bokeh_size || [0.02, 0.04];
    this.branch = createBranch(ctx, {
      leaves: Math.round((this.sceneBrief.set?.branch?.leaves ?? 160) * (tier === 'low' ? 0.6 : 1)),
      fireflies: Math.max(24, Math.round((ffBrief.count ?? 140) * scale)),
      color: ffBrief.color || '#d6ef7a',
      sizes: [sizes[0] * sizeComp, sizes[1] * sizeComp],
      // Without depth of field (mid / low tiers) big flat discs read as polka dots: draw soft cores instead.
      cores: tier !== 'high',
    });
    this._tagAvoid = { avoid: this.watch.head };
    this._caseBox = new THREE.Box3();
    this._caseAvoid = { avoid: this._caseBox };
    this.root.add(this.branch.group);
    this.sweep.uniforms.uGlowC.value.copy(this.branch.center);
    progress(0.95);

    ctx.bus.on('release', ({ hold }) => {
      const k = clamp(hold / (this.sceneBrief.lume?.charge?.full_after_hold_s ?? 1.6), 0.15, 1);
      this.dip = Math.max(this.dip, k);
      this.dipTimer = 1.6;
    });
    ctx.bus.on('quality', () => {
      this.ffDraw = Math.max(0.45, this.ffDraw * 0.8);
      this.branch?.setDraw(this.ffDraw);
    });
    this.meter = new Meter();
    this.resize(ctx.size);
    progress(1);
  }

  _enter(index) {
    // Remember how the meter settled for the shot we leave; restore it if we come back.
    const night = (i) => this.chapters[i]?.tone === 'night';
    if (this.chapter >= 0) {
      this.memory[this.chapter] = { exp: this.expTarget, punch: this.punch };
      if (night(this.chapter)) this.nightExp = this.expTarget;
      else this.litExp = this.expTarget;
    }
    const mem = this.memory[index];
    if (mem) {
      this.expTarget = mem.exp;
      this.punch = mem.punch;
    } else {
      this.expTarget = night(index) ? this.nightExp : this.litExp;
      this.punch = Math.min(this.punch, 0.5);
    }
    this.chapter = index;
    this.chapterAt = performance.now();
    if (index === 6) this._measureLedger();
  }

  _measureLedger() {
    const L = this.ledger;
    const sec = this.ctx.sections?.[6];
    if (!sec) return;
    if (!L.rows.length) {
      L.rows = [...sec.querySelectorAll('tbody tr')];
      L.labels = L.rows.map((r) => (r.cells[0]?.textContent || '').trim());
    }
    const y = scrollY;
    L.centers = L.rows.map((r) => {
      const b = r.getBoundingClientRect();
      return b.top + y + b.height / 2;
    });
    L.at = performance.now();
  }

  onReady() {
    this.ready = true;
  }

  resize(size) {
    this.camera.aspect = size.aspect;
    this.camera.updateProjectionMatrix();
    this.post?.resize(size);
    if (this.branch) this.branch.uniforms.uFrameH.value = size.height * size.dpr;
    if (this.chapter === 6) this._measureLedger();
  }

  update({ time, dt, scroll, pointer, reduced }) {
    this.time = time;
    if (!this.post) return;
    const ctx = this.ctx;
    const motion = reduced ? 0 : 1;
    const k = reduced ? 30 : 2.5;
    const idx = clamp(scroll.chapter, 0, Math.max(0, this.chapters.length - 1));
    if (idx !== this.chapter) this._enter(idx);
    const shot = this._shotCache?.[idx] || (this._shotCache = this.chapters.map((_, i) => this._shot(i)))[idx];
    const s = this.s;

    // ---------- arrival: the key rises with real load progress
    this.arrive = this.ready ? damp(this.arrive, 1, reduced ? 30 : 1.8, dt) : Math.max(this.arrive, ctx.arrival.progress * 0.85);
    const rise = smoothstep(0.42, 1, this.arrive);

    // ---------- shot values (damped, never cut)
    const kk = reduced ? 30 : 2.2;
    for (let i = 0; i < DAMPED.length; i++) {
      const key = DAMPED[i];
      s[key] = damp(s[key], shot[key], kk, dt);
    }
    s.keyAz = damp(s.keyAz, shot.keyAz, kk, dt);
    s.keyEl = damp(s.keyEl, shot.keyEl, kk, dt);
    s.yaw = damp(s.yaw, shot.yaw, reduced ? 30 : 2.0, dt);
    s.pitch = damp(s.pitch, shot.pitch, reduced ? 30 : 2.0, dt);
    s.flip = damp(s.flip, shot.flip, reduced ? 30 : 2.0, dt);
    s.sep = damp(s.sep, shot.sep, reduced ? 30 : 2.0, dt);
    s.row = damp(s.row, shot.row, reduced ? 30 : 2.4, dt);

    // ---------- the reader's light: pointer, hold, release
    const full = this.sceneBrief.lume?.charge?.full_after_hold_s ?? 1.6;
    const overStage = pointer.inside && pointer.x > -1.05 && pointer.x < 1.05 && pointer.y > -1.05 && pointer.y < 1.05;
    if (overStage) {
      this.ptrYaw = damp(this.ptrYaw, clamp(pointer.x, -1, 1) * 0.9, reduced ? 30 : 2.5, dt);
      this.ptrEl = damp(this.ptrEl, clamp(pointer.y, -1, 1) * 0.3, reduced ? 30 : 2.5, dt);
    } else {
      this.ptrYaw = damp(this.ptrYaw, 0, reduced ? 30 : 0.6, dt);
      this.ptrEl = damp(this.ptrEl, 0, reduced ? 30 : 0.6, dt);
    }
    const heatTarget = pointer.down ? clamp(pointer.hold / full, 0, 1) : 0;
    this.heat = reduced ? heatTarget : damp(this.heat, heatTarget, 4, dt);
    if (this.dipTimer > 0) this.dipTimer -= dt;
    if (reduced) this.dip = this.dipTimer > 0 ? this.dip : 0;
    else this.dip = damp(this.dip, 0, this.dipTimer > 0.6 ? 0.25 : 1.6, dt);
    const keyLevel = s.keyI * rise * (1 + 1.0 * this.heat) * (1 - 0.85 * this.dip) + 0.35 * this.heat * s.night;
    const keyFrac = clamp(keyLevel, 0, 1);
    // Lume: charges under light (fast while held), fades slowly in the dark, never to zero.
    const charge = this.sceneBrief.lume?.charge || {};
    const tau = charge.decay_tau_s ?? 9;
    const floorC = charge.floor ?? 0.18;
    if (pointer.down) this.charge = Math.min(1, this.charge + (dt / full) * (reduced ? 4 : 1));
    else if (keyFrac > 0.35) this.charge = Math.min(1, this.charge + dt * 0.05 * keyFrac);
    else this.charge = floorC + (this.charge - floorC) * Math.exp(-dt / tau);
    // Seen against the light in the room: the key, and at the end the warm lamp.
    const roomLight = clamp(keyFrac + 0.6 * s.lamp * rise, 0, 1);
    // While held, the dots visibly take the light (a charging cue, not hidden by the key).
    // The answer during the hold: the dots warm toward cream and brighten with the charge they take.
    const holding = pointer.down ? smoothstep(0, 0.2, pointer.hold) : 0;
    const holdGlow = holding * (0.2 + 0.4 * this.charge);
    const glowTarget = Math.max(s.lume, this.charge * (1 - 0.88 * roomLight), holdGlow, 0.5 * this.heat);
    this.glow = reduced ? glowTarget : damp(this.glow, glowTarget, pointer.down ? 6 : 3, dt);
    this.tint = reduced ? holding * 0.75 : damp(this.tint, holding * 0.75, pointer.down ? 6 : 2, dt);

    // ---------- the watch: turned over, lifted off its strap, straps in a row
    const w = this.watch;
    if (w) {
      const lift = Math.sin(Math.PI * clamp(s.flip, 0, 1)) * 2.2;
      w.root.position.set(0, HC + lift, 0);
      w.root.rotation.set(0, 0, s.flip * Math.PI);
      w.setFlip(s.flip);
      const sep = clamp(s.sep, 0, 1);
      w.head.position.set(0, Math.sin(Math.PI * sep) * 2.4, -13.4 * sep);
      w.root.updateMatrixWorld(true);
      if (this.bracelet) {
        const show = s.row > 0.02;
        this.bracelet.visible = this.rubber.visible = show;
        this.bracelet.position.x = lerp(9.6, 4.8, s.row);
        this.rubber.position.x = lerp(-9.6, -4.8, s.row);
      }
      // Hands, rotor, balance.
      if (!reduced) this.clock += dt;
      w.setTime(this.clock);
      const rotorTarget = 0.9 + scroll.story * 2.4;
      this.rotorAngle = reduced ? 0.9 + Math.round(scroll.story) * 2.4 : damp(this.rotorAngle, rotorTarget, 1.4, dt);
      w.rotor.rotation.y = this.rotorAngle;
      w.balance.rotation.y = reduced ? 0.6 : Math.sin(time * Math.PI * 2 * (this.sceneBrief.movement?.balance_hz ?? 4)) * 3.4;
      w.lume.emissiveIntensity = this.glow * LUME;
      w.lume.emissive.copy(this.lumeGreen).lerp(this.lumeCream, this.tint);
      // Contact shadow follows the head (fades while it is in the air).
      w.head.getWorldPosition(this._v);
      const air = clamp(this._v.y - 0.2, 0, 3);
      this.shadow.mesh.position.set(this._v.x, 0.006, this._v.z);
      this.shadow.mesh.material.opacity = 0.6 * (1 - air / 3) * (1 - 0.35 * s.night);
      this.shadow.mesh.scale.setScalar(1 + air * 0.25);
      if (this.slabUniforms) {
        this.slabUniforms.uSpillC.value.copy(this._v);
        this.slabUniforms.uSpill.value = this.glow * 0.09 * (1 - 0.7 * keyFrac);
        // Grazing warm lamp light exaggerates any grain: let the stone go smooth for the last shot.
        this.slabUniforms.uGrain.value = 1 - smoothstep(0.3, 0.7, s.lamp);
      }
    }

    // ---------- framing: the subject sits in the free area beside the text
    this._subject(shot.subject || STAGE[idx]?.subject || 'head');
    this.subjectBox.getCenter(this._c);
    this.T.x = damp(this.T.x, this._c.x, k, dt);
    this.T.y = damp(this.T.y, this._c.y, k, dt);
    this.T.z = damp(this.T.z, this._c.z, k, dt);
    const f = ctx.layout.frame(this.camera, this.subjectBox, { fill: s.fill, bleed: this.chapters[idx]?.frame === 'bleed' });
    this.shiftX = damp(this.shiftX, f.shiftX, k, dt);
    this.shiftY = damp(this.shiftY, f.shiftY, k, dt);
    const want = clamp(this.camera.position.distanceTo(this._c) * f.distanceScale, 6, 160);
    this.dist = damp(this.dist, want, k, dt);
    const drift = motion * (this.ready ? 1 : 0);
    const yaw = s.yaw + noise3(time * 0.05, 1.3, 0) * 0.02 * drift;
    const pitch = clamp(s.pitch + noise3(0, time * 0.05, 4.1) * 0.012 * drift, 0.03, 1.4);
    this._dir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    this.camera.position.copy(this.T).addScaledVector(this._dir, this.dist);
    this.camera.lookAt(this.T);
    this.camera.updateMatrixWorld();
    const e = this.camera.projectionMatrix.elements;
    e[8] = this.shiftX;
    e[9] = this.shiftY;
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();

    // ---------- hover / tap: name the part beside it; the ledger names rows
    const named = this._pick(pointer, idx);
    let text = null;
    let avoidHead = false;
    let avoidCase = false;
    if (named) {
      text = this.tagWords[named] || null;
      if (named === 'crown') {
        this._caseBox.copy(w.boxes.case).applyMatrix4(w.head.matrixWorld);
        avoidCase = true;
      } else if (HEAD_PARTS.has(named)) {
        this._besideHead(this.tagAnchor);
        avoidHead = true;
      }
      if (idx === 5 && (named === 'leather' || named === 'bracelet' || named === 'rubber')) this._aimAt(this.tagAnchor, dt, k);
    } else if (idx === 6 && w) {
      const row = this._ledgerRow();
      if (row >= 0) {
        const target = this.chapters[6]?.params?.row_targets?.[row] || 'watch';
        this._anchor(target === 'strap' ? 'leather' : target, this.tagAnchor);
        this._aimAt(this.tagAnchor, dt, k);
        if (target !== 'strap') {
          this._besideHead(this.tagAnchor);
          avoidHead = true;
        }
        text = this.ledger.labels[row] || null;
      }
    }
    if (!text) this._aimAt(this.T, dt, reduced ? 30 : 1.6);
    if (named !== this.hover && named) ctx.sound.cue('touch');
    this.hover = named;
    // `avoid`: the label keeps off the watch head's screen rect (kit option; ignored by older kits).
    ctx.tags.set(text, this.tagAnchor, avoidHead ? this._tagAvoid : avoidCase ? this._caseAvoid : undefined);

    // ---------- lights
    const L = this.lights;
    const punch = this.punch;
    const kyaw = yaw + s.keyAz + this.ptrYaw;
    const kel = clamp(s.keyEl + this.ptrEl, 6 * D2R, 82 * D2R);
    this._v.set(Math.sin(kyaw) * Math.cos(kel), Math.sin(kel), Math.cos(kyaw) * Math.cos(kel)).multiplyScalar(32).add(this.aim);
    L.target.position.copy(this.aim);
    L.keyDir.position.copy(this._v);
    L.keyDir.color.copy(this.keyCool).lerp(this.keyWarm, 0.7 * this.heat);
    if (L.keyArea) L.keyArea.color.copy(L.keyDir.color);
    if (L.keyArea) {
      L.keyArea.position.copy(this._v);
      L.keyArea.lookAt(this.aim);
      L.keyArea.intensity = KEY_AREA * keyLevel * (1 + 0.5 * punch);
      L.keyDir.intensity = 0.9 * keyLevel;
    } else {
      L.keyDir.intensity = 3.2 * keyLevel * (1 + 0.3 * punch);
    }
    // Rim strip behind and to the right, high enough that its reflection
    // crosses the rippled dial and the crystal (the bands), never off.
    const ryaw = yaw + 2.7;
    const rel = 40 * D2R;
    this._v2.set(Math.sin(ryaw) * Math.cos(rel), Math.sin(rel), Math.cos(ryaw) * Math.cos(rel)).multiplyScalar(30).add(this.T);
    L.rim.position.copy(this._v2);
    const rimLevel = s.rim * (0.4 + 0.6 * rise);
    if (L.area) {
      L.rim.lookAt(this.T);
      L.rim.intensity = RIM_AREA * rimLevel * (1 + 0.4 * punch);
    } else L.rim.intensity = 2.2 * rimLevel;
    L.lamp.intensity = LAMP * s.lamp * rise;
    if (this.lamp) {
      this.lamp.shadeMat.emissiveIntensity = 1.4 * s.lamp * rise;
      this.lamp.bulbMat.emissiveIntensity = 4 * s.lamp * rise;
    }
    // The flagged studio environment turns with the camera (flags move with the shot).
    if (this.scene.environmentRotation) this.scene.environmentRotation.set(0, yaw, 0);
    if (this.envFlat) this.scene.environment = s.row > 0.5 ? this.envFlat.texture : this.env.texture;
    // The studio's own bounce follows its lights (reflections only; never the backdrop).
    this.scene.environmentIntensity = (0.08 + 0.32 * clamp(keyLevel, 0, 1.2) + 0.25 * s.lamp + 0.5 * s.fillL) * (0.3 + 0.7 * rise);

    // ---------- backdrop: background light pool, firefly spill, haze in the beam
    const sw = this.sweep.uniforms;
    this._dir.copy(this.T).sub(this.camera.position).normalize();
    let tFloor = 60;
    if (this._dir.y < -0.02) tFloor = Math.min(60, (this.T.y - FLOOR_Y) / -this._dir.y);
    this._v.copy(this.T).addScaledVector(this._dir, Math.max(18, tFloor));
    sw.uPoolC.value.lerp(this._v, reduced ? 1 : 1 - Math.exp(-3 * dt));
    sw.uPoolR.value = 30 * (1 - 0.3 * punch);
    sw.uPoolGain.value = POOL * s.pool * (0.15 + 0.85 * rise) * (1 + 1.2 * punch) * (1 - 0.6 * this.dip);
    sw.uPoolCol.value.copy(this.poolBase).lerp(this.poolWarm, clamp(s.lamp, 0, 1));
    sw.uGlowGain.value = 0.35 * s.ff * (1 + punch);
    sw.uKeyPos.value.copy(L.keyDir.position);
    sw.uKeyDir.value.copy(this.aim).sub(L.keyDir.position).normalize();
    sw.uHaze.value = ctx.device.tier === 'high' ? (this.sceneBrief.set?.haze?.density ?? 0.015) * 4 * keyLevel * s.haze : 0;
    if (this.post.bloom) this.post.bloom.threshold = s.bloomT;

    // ---------- fireflies
    if (this.branch) {
      const o = this._ffOpts;
      const cores = ctx.device.tier !== 'high';
      // Quieter in the lit shots (they are background points there); full only in the dark.
      // Lit shots: quiet background points. Lights out: each disc stays below tone-map
      // saturation (overlaps keep the lume's yellow-green instead of going white).
      o.level = FF * s.ff * (1 + 0.6 * punch) * (0.5 + 0.5 * rise) * lerp(cores ? 0.55 : 0.75, 0.45, s.night);
      o.swell = s.swell * (1 + 0.2 * punch) * (cores ? lerp(0.55, 1, s.night) : 1);
      o.pulseDepth = s.pulse;
      o.reduced = reduced;
      this.branch.update(time, dt, o);
      this.branch.setDraw(this.ffDraw * lerp(1, 0.68, s.night));
      // Leaves glow through when the backdrop light and the fireflies are behind them.
      this.branch.setGlow((0.12 * s.pool + 0.3 * s.ff) * (0.3 + 0.7 * rise));
    }

    // ---------- depth of field on the dial (high tier)
    if (this.post.bokeh && w) {
      this._focus(idx, this._v);
      const u = this.post.bokeh.uniforms;
      u.focus.value = this.camera.position.distanceTo(this._v);
      u.aperture.value = s.aperture < 1e-4 ? 0 : s.aperture;
    }

    // ---------- exposure (the meter sets the target in render())
    this.exp = reduced ? this.expTarget : damp(this.exp, this.expTarget, 12, dt);
    ctx.renderer.gl.toneMappingExposure = this.exp;
    this.interacting = pointer.down || this.dip > 0.05 || this.heat > 0.05;

    // ---------- the movement's tick (only audible when the reader asked for sound)
    this.tickAcc += dt;
    if (this.tickAcc >= 0.125) {
      this.tickAcc %= 0.125;
      ctx.sound.cue('tick', idx === 3 ? this._tickFull : this._tickSoft);
    }
  }

  _subject(kind) {
    const w = this.watch;
    const b = this.subjectBox;
    if (!w) return;
    if (kind === 'row') b.copy(this.rowBox);
    else if (kind === 'dial') b.copy(w.boxes.dial).applyMatrix4(w.head.matrixWorld);
    else if (kind === 'watch') b.copy(w.boxes.watch).applyMatrix4(w.head.matrixWorld);
    else b.copy(w.boxes.head).applyMatrix4(w.head.matrixWorld);
  }

  _focus(idx, out) {
    const w = this.watch;
    if (idx === 5) return this.rowBox.getCenter(out);
    if (idx === 4) return w.head.localToWorld(out.copy(w.anchors.crown));
    out.set(0, this.s.flip > 0.5 ? 0.15 : 0.8, 0);
    return w.head.localToWorld(out);
  }

  _aimAt(p, dt, k) {
    this.aim.x = damp(this.aim.x, p.x, k, dt);
    this.aim.y = damp(this.aim.y, p.y, k, dt);
    this.aim.z = damp(this.aim.z, p.z, k, dt);
  }

  /** World anchor for a named part. */
  _anchor(name, out) {
    const w = this.watch;
    if (name === 'leather') {
      out.set(0, 0.5, 6.2);
      return w.body.localToWorld(out);
    }
    if (name === 'pin') return out.copy(w.leverPos[0]).applyMatrix4(w.strap.matrixWorld);
    if (name === 'bracelet') return out.set(this.bracelet.position.x, 0.6, 5.5);
    if (name === 'rubber') return out.set(this.rubber.position.x, 0.6, 5.5);
    const a = w.anchors[name] || w.anchors.watch;
    return w.head.localToWorld(out.copy(a));
  }

  /** Move a tag anchor to the right of the case silhouette (same height), so the label never sits on the dial. */
  _besideHead(out) {
    const w = this.watch;
    const cam = this.camera;
    const box = this._box.copy(w.boxes.head).applyMatrix4(w.head.matrixWorld);
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const v = this._v2;
    for (let k = 0; k < 8; k++) {
      v.set(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z).project(cam);
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
    v.copy(out).project(cam);
    const y = clamp(v.y, minY + 0.02, maxY - 0.02);
    out.set(Math.min(0.9, maxX + 0.03), y, v.z).unproject(cam);
    return out;
  }

  _ledgerRow() {
    const L = this.ledger;
    if (!L.rows.length || performance.now() - L.at > 1000) this._measureLedger();
    if (!L.centers.length) return -1;
    const probe = scrollY + innerHeight * 0.5;
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < L.centers.length; i++) {
      const d = Math.abs(L.centers[i] - probe);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  /** Raycast the pointer against small proxies; returns a tag key or null. */
  _pick(pointer, idx) {
    const w = this.watch;
    if (!w || !pointer.inside) return null;
    if (pointer.x < -1 || pointer.x > 1 || pointer.y < -1 || pointer.y > 1) return null;
    this._ndc.set(pointer.x, pointer.y);
    this._ray.setFromCamera(this._ndc, this.camera);
    const ray = this._ray.ray;
    const flipped = this.s.flip > 0.5;
    const sph = this._sph;
    // Crown.
    this._anchor('crown', sph.center);
    sph.radius = 0.55;
    if (ray.intersectsSphere(sph)) return this._anchor('crown', this.tagAnchor), 'crown';
    // Quick-release lever (visible with the watch turned over).
    if (flipped) {
      this._anchor('pin', sph.center);
      sph.radius = 0.5;
      if (ray.intersectsSphere(sph)) return this._anchor('pin', this.tagAnchor), 'pin';
    }
    // The face (or the back) of the head.
    if (this.s.sep < 0.5) {
      this._inv.copy(w.head.matrixWorld).invert();
      const lr = this._lray.copy(ray).applyMatrix4(this._inv);
      const hit = lr.intersectPlane(flipped ? this._planeDown : this._planeUp, this._hit);
      if (hit) {
        const r = Math.hypot(hit.x, hit.z);
        if (r < 1.65) {
          let name;
          if (!flipped) name = r > 1.08 ? 'lume' : 'crystal';
          else if (Math.hypot(hit.x - 0.6, hit.z + 0.62) < 0.45) name = 'balance';
          else if (r < 1.05) name = 'rotor';
          if (name) return this._anchor(name, this.tagAnchor), name;
        }
      }
    }
    // Straps.
    const box = this._box;
    if (ray.intersectsBox(box.copy(this.leatherBox).applyMatrix4(w.body.matrixWorld))) {
      if (!ray.intersectsBox(box.copy(w.boxes.head).applyMatrix4(w.head.matrixWorld)) || this.s.sep > 0.5) {
        return this._anchor('leather', this.tagAnchor), 'leather';
      }
    }
    if (this.bracelet && this.bracelet.visible && ray.intersectsBox(box.copy(this.braceletBox).translate(this.bracelet.position))) {
      return this._anchor('bracelet', this.tagAnchor), 'bracelet';
    }
    if (this.rubber && this.rubber.visible && ray.intersectsBox(box.copy(this.rubberBox).translate(this.rubber.position))) {
      return this._anchor('rubber', this.tagAnchor), 'rubber';
    }
    return null;
  }

  render() {
    if (!this.post) return;
    this.post.render(this.time);
    this._meter();
  }

  // The light meter: keep the shot inside its band (deadband; never while the reader is lighting it).
  _meter() {
    if (!this.meter || !this.ready || this.chapter < 0 || this.interacting) return;
    const now = performance.now();
    const since = now - this.chapterAt;
    if (now - this.lastMeter < (since < 3000 ? 200 : 700)) return;
    this.lastMeter = now;
    const m = this.meter.read(this.ctx.canvas);
    if (!m.ok) return;
    const band = this.bands[this.chapter] || { lo: 0.13, hi: 0.3, contrast: 0.36 };
    if (m.mean < band.lo || m.mean > band.hi) {
      const want = m.mean < band.lo ? band.lo * 1.18 : band.hi * 0.88;
      const r = clamp(Math.pow(want / Math.max(m.mean, 0.003), 0.85), 0.62, 1.6);
      this.expTarget = clamp(this.expTarget * r, 0.3, 6);
    }
    const contrast = m.p95 - m.p05;
    if (contrast < band.contrast) this.punch = Math.min(1, this.punch + 0.15);
    else if (contrast > band.contrast + 0.2 && this.punch > 0) this.punch = Math.max(0, this.punch - 0.03);
  }

  dispose() {
    this.post?.dispose();
    this.env?.dispose?.();
    this.envFlat?.dispose?.();
    this.watch?.dispose();
    this.branch?.dispose();
    this.shadow?.tex.dispose();
    this.steelSatin?.dispose();
    this.steelPolished?.dispose();
    this.rubberMat?.dispose();
    this.rubberBump?.dispose();
    this.slabMat?.dispose();
    if (this.lamp) {
      this.lamp.brass.dispose();
      this.lamp.shadeMat.dispose();
      this.lamp.bulbMat.dispose();
    }
    const L = this.lights;
    if (L) [L.keyArea, L.keyDir, L.rim, L.lamp].forEach((l) => l?.dispose?.());
    disposeObject(this.root);
  }
}
