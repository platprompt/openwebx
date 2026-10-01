# Runtime API: the builder's contract

A scaffolded site looks like this:

```
index.html              generated: never hand-edit (re-run scaffold --site)
css/tokens.css          generated from brief.palette/fonts/type
css/openwebx.css        runtime base (kit-owned)
css/theme.css           BUILDER-OWNED: art direction
src/main.js             kit-owned
src/core/*.js           kit-owned: import from here, do not edit
src/scene/scene.js      BUILDER-OWNED: export default class Scene
src/scene/*.js          BUILDER-OWNED: split actors into modules
media/                  content images, brief assets, cc0/ (Poly Haven HDRIs, textures, models)
present.html            single-file presentation (bundle.py) for Artifacts / Canvas
serve.py                local server with correct MIME types
_openwebx/              brief.json, brief.md, content.json, manifest.json
```

Kit-owned files are refreshed by `scaffold.py --site`. Builder-owned files are
never overwritten.

## Scene lifecycle
```js
export default class Scene {
  constructor(ctx) {}              // build nothing heavy here
  async load(progress) {}          // create geometry/materials/textures; call progress(0..1, label?)
  resize(size) {}                  // {width, height, dpr, aspect}; update camera + DPR uniforms
  update(frame) {}                 // every frame; no allocations
  render() {}                      // optional; default renders this.scene with this.camera
  onReady() {}                     // optional; the world has arrived, start intro choreography
  dispose() {}                     // free everything (disposeObject(root))
}
```
The scene must expose `this.scene` (THREE.Scene) and `this.camera`. The
camera is also what `ctx.tags` projects anchors with.

The article is readable before the runtime starts; `load()` never gates
reading. The loop runs from the moment the scene is constructed: page state
(chapters, scroll) is live during `load()`, and `update()`/`render()` start
after `load()` resolves, except with `chrome.arrival: "scene"`, where they
also run while `load()` is in progress so the scene can draw its own loading
state. In that mode `update()` must cope with resources that do not exist yet
(return early until they do).

### `ctx`
| key | what |
|---|---|
| `THREE` | the three module (or `import * as THREE from 'three'`) |
| `renderer.gl` | the `WebGLRenderer` (ACES tone mapping, sRGB output, alpha on) |
| `size` | live `{width, height, dpr, aspect}` |
| `brief` | runtime brief: `palette`, `reading`, `chapters[] {name, composition, side, tone, frame, beat, interaction, params}`, `look` (with `quiet`), `scene`, `intensity`, `lang` |
| `layout` | where the text is: `layout.free`, `layout.frame()`, `layout.subject()`, `layout.stage`, `layout.paused` (see **Layout**) |
| `device` | `{tier: 'high'|'mid'|'low', scale, dprMax, coarse, touch, webgl}`. Multiply counts by `device.scale` |
| `motion.reduced` | live prefers-reduced-motion flag |
| `bus` | events: see **Bus events** below |
| `tags` | `tags.set(text \| null, anchor, { kind, avoid })`: anchored labels for scene targets (see **Tags**) |
| `sound` | `sound.cue(name, { intensity, pitch })`: named cues (see **Sound**) |
| `arrival` | `{ mode, progress }`: the brief's arrival mode and load progress 0..1 (read-only) |
| `pointer`, `scroll` | live objects (prefer the `frame` snapshots) |
| `sections` | the chapter `<section>` elements (for DOM-anchored effects) |
| `yieldTask()` | `await ctx.yieldTask()` between chunks of heavy `load()` work. It uses MessageChannel, so it is never throttled in background tabs |

Runtime gotchas:
- Toggling `light.castShadow` (or adding or removing lights) at runtime
  recompiles every program. Decide shadows once in `load()`.
- Import each CDN helper (e.g. `BufferGeometryUtils`) the same way
  everywhere. The bundler merges imports per module, but one local name must
  not refer to two different things.

### `frame`
```js
{
  time, dt,                       // seconds; dt is clamped to 1/20
  reduced,                        // boolean
  scroll: { progress, raw, story, velocity, chapter, chapterProgress, chapterCount },
  pointer: { x, y, sx, sy, vx, vy, px, py, down, hold, idle, inside }
}
```
- `scroll.story` is the smoothed chapter coordinate (`2.5` = halfway through
  chapter 2). Drive cameras and morphs from it.
- `pointer.sx/sy` are smoothed NDC for parallax; `x/y` are raw values for
  picking.
- `pointer.hold` is seconds held (for charge interactions). `idle` is seconds
  since the last move (for evolve-when-idle behaviour). `inside` is the
  hover flag: on touch it turns false 0.5 s after the finger lifts (time for a
  tap to name what it touched) and at once when the touch becomes a scroll.

Presses on links, buttons and form fields never reach the scene. Mark other
DOM that should swallow presses with `data-no-scene`.

## Layout
The kit tells the scene where the text is, so the camera frames the subject
in the free space. No boxes behind text by default.

```js
ctx.layout.free      // { x, y, w, h } CSS px + ndc: { x0, y0, x1, y1 } (stage NDC, y up)
ctx.layout.stage     // { x, y, w, h } the canvas rect (one side of the page with reading "beside")
ctx.layout.frame(camera, target, { fill = 0.55, bleed = false })  // -> { shiftX, shiftY, distanceScale }
ctx.layout.subject(target)   // declare this chapter's subject (Object3D, Box3 or Sphere)
ctx.layout.paused    // true while opaque paper covers the viewport
```
- `free` is the current chapter's free area: the stage minus the text
  column(s), paper sections and a 24 px margin. It is recomputed on chapter
  change, resize, font load and at most every 100 ms while scrolling; never
  per frame. Read it; do not measure the DOM yourself.
- `frame()` returns the lens shift and the distance factor that put `target`
  (an `Object3D`, `Box3` or `Sphere`) in the centre of the free area, filling
  `fill` of it (`bleed: true` lets the subject fill the larger side and run
  past the smaller; use it for chapters with `frame: "bleed"`). It allocates
  nothing and can be called every frame. The scene damps toward the values
  and writes the lens shift itself:
  ```js
  const f = ctx.layout.frame(this.camera, this.subject, { fill: 0.55, bleed: chapter.frame === 'bleed' });
  this.shiftX = damp(this.shiftX, f.shiftX, 3, dt);
  this.shiftY = damp(this.shiftY, f.shiftY, 3, dt);
  this.dist = damp(this.dist, currentDistance * f.distanceScale, 3, dt);   // move the camera to this distance
  const e = this.camera.projectionMatrix.elements;
  e[8] = this.shiftX; e[9] = this.shiftY;                                   // after lookAt
  this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
  ```
  `updateProjectionMatrix()` (e.g. in `resize()`) resets the shift, so write
  it every frame. `distanceScale` assumes a perspective camera and the camera
  aimed at the target.
- `subject(target)`: call once per chapter (or once, if one subject carries
  the whole piece). With `?ox-qa` the runtime projects it every 250 ms for
  the critic's framing gate (overlap with text ≤ 0.12, visible ≥ 0.85).
- Quiet zone: `createPost(..., { quiet })` softens, desaturates and darkens
  (bright areas the most, toward about 4.5:1 for the ink) the frame only under text that sits over the world (up to 3 feathered
  rects from `ctx.layout`; strength `brief.look.quiet`, default 0.6). With
  `palette.scheme: "light"` (dark ink) it lightens there instead.
  It cannot rescue light text over a frame that goes white (a glare, a
  flash, a transition into paper): the scene must fade that text out, or
  hold the bright frame back, while it lasts.
  Scenes without `createPost` get the CSS fallback `.ox-quiet` (a feathered
  gradient behind the text column, on with `html.ox-quiet-css`).
- Paper pause: while paper (paper, spread, ledger chapters) covers the whole
  viewport the runtime skips `render()`; `update()` still runs, so the scene
  is in the right state when the world comes back.
- The pointer's `x/y` and the tag projection are relative to `layout.stage`.

## Probe (QA)
`window.__openwebx` always reports `version, ready, webgl, tier, dpr, fps,
frames, chapter, story, reducedMotion, errors, warnings`. Only when the page
URL has `?ox-qa` (visitors pay nothing) it also carries:
- `probe.layout[chapter] = { subject: {x,y,w,h}, text: [{x,y,w,h}], overlap, visible, paper, frame }`
  (or `{ covered: true, paper, frame }` while paper hides the world),
  where `overlap` = subject area covered by text or paper / subject area and
  `visible` = subject area inside the viewport / subject area;
- `probe.light[chapter] = { mean, p05, p95 }`: relative luminance of a 32×18
  downsample of the canvas taken right after a render, once per second.
The critic's gates on these (`G-frame`, `G-light`) are in `quality-bar.md`.

## Bus events
| event | payload | when |
|---|---|---|
| `press` / `release` | `{x, y, px, py}` / `{x, y, hold}` | primary press and release on the scene (not on UI) |
| `cancel` | `{x, y}` | a touch press became a scroll: no release effect |
| `chapter` | `{index, prev, id, name}` | the chapter being read changed (`prev` is -1 the first time) |
| `navigate` | `{id}` | the reader used a contents link, a folio or `[data-go]` |
| `arrival:progress` | number 0..1 | load progress, monotonic, in steps of at least 1% (always emitted; the `scene` arrival relies on it) |
| `arrival:ready` | `{world}` | loading finished; `world` is false when no world is shown (no WebGL or the scene failed). A world that arrives after the failsafe is still shown |
| `ready` | none | after `arrival:ready`, just before `scene.onReady()` |
| `sound` | `{on}` | the reader accepted or declined the sound offer |
| `quality` | `{dpr}` | the loop lowered the pixel ratio |
| `reduced-motion` | boolean | the preference changed |
| `context-lost` / `context-restored` | none | WebGL context events |

The runtime itself plays `turn` on `chapter`, `pass` on `navigate`, `grip`
on `press` and `let-go` on `release` (intensity grows with hold time).

## Tags
```js
ctx.tags.set(text | null, anchor, { kind: 'target' | 'hint', avoid })
```
- One small label beside a scene target: `anchor` is a `THREE.Vector3`
  (world space) or a `THREE.Object3D` (its world position is read every
  frame, so the tag follows a moving object). Never beside the pointer.
- One tag at a time. Calling `set` again with new text or a new anchor
  replaces it; `null` clears it. Calling it every frame with the same text is
  cheap (the usual pattern is: raycast in `update()`, then
  `tags.set(hit ? name : null, anchor)`).
- The runtime projects the anchor with `scene.camera` after every render,
  keeps the tag inside the stage (the canvas rect), and puts it on the side
  (right, left, above, below) that stays off the current chapter's text
  column. It keeps its current side while that side still works. An anchor
  behind the camera or outside the view hides the tag, and so does a spot
  where every side would cover text. Place anchors just outside the
  object's silhouette (toward the free side) so the tag never covers the
  part it names.
- `kind: 'hint'` marks an instruction ("drag to turn") rather than a name;
  the element gets `data-kind="hint"` for theme.css.
- `avoid` (optional): an `Object3D`, `Box3` or `Sphere` the tag should not
  cover, usually the object the named part belongs to (the watch head, the
  vessel). Covering it costs by area, so the tag takes a free side or is
  pushed along the edge first. Each new text starts from the right side.
- Touch: a tag opened by a tap stays until the next tap (a `null` before
  that is ignored); tags shown for other reasons (scroll, a ledger row)
  clear as on desktop, and a chapter change clears any tag. A touch that
  travels more than 10 px is a scroll, not a tap. Every new tag text is announced through the
  visually hidden polite live region `.ox-tag-live`. The `.ox-tag` element is
  `aria-hidden`.
- With `chrome.tags: "none"` the element is not written and `set` does
  nothing. Tag words are authored copy: take them from the brief
  (`chapters[].name`, `scene.*`), never invent facts.
- Replaces `ctx.cursor` / `setSceneTarget` (removed in 0.2.0). The kit never
  hides or replaces the system cursor.

## Sound
```js
ctx.sound.cue(name, { intensity, pitch })
```
- Named cues: `touch` (hover), `grip` (press), `let-go` (release), `turn`
  (chapter change), `pass` (fast travel), `tick`, `open` (played when the
  reader accepts the offer).
- `intensity` 0..1.5 scales the level (default 1); `pitch` is a playback-rate
  factor for this call (default 1). Identical cues closer than 50 ms apart are
  dropped.
- Each cue is a small recipe (sine partials, or a noise band that opens
  upward, shaped by an attack/release envelope) rendered once into an
  `AudioBuffer` with an `OfflineAudioContext` when the reader accepts the
  offer, then replayed. All output passes one gain and a soft-clip
  `WaveShaperNode` limiter.
- While sound is off, `cue()` returns at once: call it freely.
- Sound starts off on every visit and nothing is persisted. The only switch
  is the in-flow offer button in chapter 0 (`chrome.sound: "offer"`).
- Tuning: `brief.sound.pitch` shifts every recipe (0.5 = an octave down);
  `brief.sound.cues.<name>` overrides recipe fields: `f` (Hz), `partials`
  (`[[ratio, level], …]`), `glide` (end frequency factor), `noise`
  (`[lowHz, highHz]`), `q`, `attack`, `release` (seconds), `level` (0..1).
  A new name with `partials` or `noise` defines an extra cue.
- Replaces `ctx.sound.play` (removed in 0.2.0).

## Helpers
```js
import { damp, spring, lerp, clamp, smoothstep, mapRange, mulberry32, noise3, easeOutExpo } from '../core/math.js';
import { GLSL } from '../core/glsl.js';             // simplex3, fbm (needs simplex3), hash, fresnel, softPoint, grain
import { textTexture, glowTexture, gradientTexture, loadTexture } from '../core/textures.js';
import { disposeObject, disposeMaterial } from '../core/dispose.js';
import { createPost } from '../core/post.js';       // camera finish: bloom, dof, grade, grain, vignette, chroma
import { useHDRI, useSky, useStudio, loadPBR, createTerrain, createMist, loadModel, softShadows, atmosphere } from '../core/realism.js';
import { media } from '../core/assets.js';          // ALWAYS wrap media paths: media('media/cc0/...')
import { gsap } from 'gsap';                        // timelines, camera flights
```
- The realism toolkit and recipes are in `rendering.md`. With
  `look.fidelity: cinematic-real`, every frame needs environment light,
  PBR/lit surfaces, atmosphere and `createPost`.
- `createPost(ctx, scene, camera, { bloom, dof, grain, vignette, chroma, grade, quiet })`
  (`quiet` 0..1, default `brief.look.quiet` or 0.6: the quiet zone under the text)
  degrades by tier on its own (no DOF below high, no bloom on low). Call
  `post.render(time)` from `render()`, and `post.resize(size)` from
  `resize()`. The DOF depth pass skips points, sprites and transparent
  materials with `depthWrite: false` (haze, dust, glows, bokeh), so they
  never turn into solid depth.
- Any file under `media/` must be loaded through `media()` (the kit loaders
  already do this). Otherwise the single-file presentation cannot embed it.
- `damp(current, target, lambda, dt)` is the default for everything that
  moves. It is frame-rate independent.
- `textTexture(text, {font, color})` renders type into the scene. Fonts are
  loaded before `load()` runs, so theme fonts and Thai fonts rasterise
  correctly.
- `loadTexture('media/x.webp')` loads brief assets or content images.
- GSAP is good for one-off camera flights and intro choreography. Kill tweens
  in `dispose()`.

## CSS hooks for theme.css
- `html[data-chapter="3"]` is the current chapter (restyle atmosphere per chapter).
- `html[data-tier="low"]`, `.ox-reduced`, `.ox-no-webgl`, `.ox-failsafe`, `.ox-late` (the world arrived after the failsafe and faded in).
- `.ox-chapter.is-in`, `.ox-chapter.is-current` for per-chapter entrances.
- `--ox-atmos` sets a fixed overlay gradient above the canvas and below the
  text (vignette, grain, mist). `--ox-fallback-bg` is the background used when
  WebGL is unavailable. Make it a themed gradient.
- Arrival: `html[data-arrival="veil|scene|hold-title"]` (from the brief, present
  from the first paint), `html.ox-live` (runtime running: reveal choreography
  active), `html.ox-arrived` (the world is shown; the canvas fades in under
  `veil`/`hold-title`), `html.ox-hold` (hold-title: the hero headline waits).
- Reading and composition: `html[data-reading="interleave|overlay|beside"]`;
  each chapter is `section.ox-chapter.ox-chapter--<composition>` with
  `data-composition`, `data-side="left|right|center"`, and optionally
  `data-tone="night|bright"` and `data-frame="bleed"`. Paper chapters use
  `--ox-paper` / `--ox-paper-ink` (from `palette.paper` / `palette.paper_ink`).
  `.ox-numeral` is the large chapter numeral of paper and dossier chapters
  (aria-hidden; the folio value when it is short, at most 6 characters, else
  the chapter number); `.ox-quiet` is the quiet-zone fallback layer; `--ox-quiet`
  its strength. The type scale is 1.333 (`--ox-s1` … `--ox-s5`).
- Never centre body text: `text-align: center` may reach headings and the
  interlude line only (`qa.py` Q-center).
- Chrome (see `chrome.md`); all of it is in the content flow, restyle freely:
  - contents: `nav#contents.ox-contents[data-contents="list|sentence"]`,
    `.ox-contents__label`, `.ox-contents__value`, `.ox-contents__name`,
    `.ox-contents__sentence`, `a[aria-current="true"]` for the current chapter;
  - folio: `.ox-folio[data-folio="name|number-name|value-name"]` (at the
    head of its section, not sticky), `.ox-folio__num`, `.ox-folio__sep`, `.ox-folio__value`,
    `.ox-folio__name`;
  - sound offer: `button.ox-sound[aria-pressed]`, `.ox-sound__label` (hidden
    until the runtime can play sound);
  - tag: `.ox-tag`, `.ox-tag.is-shown`, `.ox-tag[data-kind="hint"]`. The runtime
    owns its `transform`; style everything else.
- Never add an element fixed to the viewport (only the skip link, canvas,
  atmosphere and tag layer are), never hide or replace the system cursor
  (`cursor: none`), never write "Sound on/off" labels: `qa.py`'s originality
  lint fails the site.
- Never hide content text with CSS. Never set `letter-spacing` on Thai text or
  `line-height < 1.25` on Thai display text.

## Page structure (scaffold output)
```html
<html lang data-arrival="veil" data-reading="interleave">   <!-- head script: .js, .ox-hold, aria-busy, failsafe -->
  <a class="ox-skip" href="#content">       <!-- fixed only while focused -->
  <canvas class="ox-stage">  <div class="ox-atmos">
  <div class="ox-tag" aria-hidden="true"></div>          <!-- chrome.tags: anchored -->
  <p class="ox-tag-live ox-sr-only" aria-live="polite"></p>
  <main id="content">                       <!-- the head script adds aria-busy; cleared on ready -->
    <section class="ox-chapter ox-chapter--opening" id="ch-0" data-chapter="0"
             data-composition="opening" data-side="left">
      <a class="ox-folio" href="#contents">…</a>          <!-- chrome.folio -->
      <div class="ox-chapter__inner ox-prose">
        <div class="ox-quiet" aria-hidden="true"></div>    <!-- text over the world only -->
        eyebrow · <h1> · lede · verbatim content ·
        <nav id="contents">…#ch-N links…</nav>          <!-- chrome.contents -->
        <button class="ox-sound" aria-pressed="false" hidden>…</button>  <!-- chrome.sound -->
    <section id="ch-1" class="ox-chapter ox-chapter--paper" data-composition="paper" data-side="left">
      <a class="ox-folio">…</a>
      <div class="ox-chapter__inner ox-prose"><span class="ox-numeral" aria-hidden="true">2</span> …
  </main>
  <p class="ox-status ox-sr-only" role="status"></p>     <!-- receives arrival_status -->
```
Without JavaScript and in the failsafe path the whole article shows with no
canvas and no busy state; the sound offer stays hidden (it cannot play).
Interludes are not listed in the contents and their folio is plain text (they
are aria-hidden).

## Performance budget
| | high | mid | low |
|---|---|---|---|
| Draw calls | ≤ 80 | ≤ 50 | ≤ 30 |
| Points/particles | ≤ 30k | × 0.55 | × 0.3 |
| Postprocessing | ≤ 1 pass besides output | optional | none |
| Shadow maps | 1 × 1024 | 1 × 512 | none |
| Target | 60 fps | 60 fps | 30+ fps |

The loop lowers DPR when FPS stays under 40. Listen to `bus.on('quality')` to
reduce particle counts too (e.g. `geometry.setDrawRange`).

## Reduced motion
With `frame.reduced === true` there is no camera drift, no ambient animation
and no idle evolution. Transitions happen instantly, but the scene still
reflects the current chapter (a static composition per chapter), and clicks
still give feedback (a static state change instead of an animation).
