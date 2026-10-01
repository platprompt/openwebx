import * as THREE from 'three';
import { Bus } from './bus.js';
import { detectDevice, createMotionPreference } from './device.js';
import { Renderer } from './renderer.js';
import { Loop } from './loop.js';
import { Scroll } from './scroll.js';
import { Pointer } from './pointer.js';
import { Chapters } from './chapters.js';
import { setupReveal } from './reveal.js';
import { Sound } from './sound.js';
import { Tags } from './tags.js';
import { Arrival } from './arrival.js';
import { Layout, createLightMeter } from './layout.js';
import { createProbe, QA } from './probe.js';

// Wires the runtime together and drives the Scene through its lifecycle:
//   new Scene(ctx) -> await scene.load(progress) -> scene.resize(size)
//   -> every frame scene.update(frame) + scene.render() -> scene.dispose()
// The article is readable before any of this runs. The world joins it as the
// brief's arrival mode says (arrival.js). If WebGL is missing or the scene
// throws, the page simply stays the readable HTML story, with contents,
// folios, reveal and sound intact.

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function createApp({ Scene, brief = {} }) {
  const chrome = brief.chrome || {};
  const probe = createProbe();
  const bus = new Bus();
  const motion = createMotionPreference((reduced) => {
    probe.reducedMotion = reduced;
    bus.emit('reduced-motion', reduced);
  });
  probe.reducedMotion = motion.reduced;
  const device = detectDevice();
  probe.tier = device.tier;
  const root = document.documentElement;
  root.dataset.tier = device.tier;

  const sections = [...document.querySelectorAll('[data-chapter]')];
  const canvas = document.getElementById('ox-stage');
  setupReveal(sections, root.lang);
  const layout = new Layout({ sections, canvas, brief, probe, qa: QA });
  const meter = QA ? createLightMeter(probe) : null;
  const arrival = new Arrival({ mode: chrome.arrival, bus, sentence: brief.arrival_status });
  const pointer = new Pointer(bus, motion);
  const sound = new Sound(document.querySelector('.ox-sound'), { labels: chrome.sound_label, tuning: brief.sound, bus });
  const tags = new Tags(document.querySelector('.ox-tag'), document.querySelector('.ox-tag-live'), {
    enabled: chrome.tags !== 'none',
    coarse: device.coarse,
  });
  const chapters = new Chapters(sections, bus, motion);
  const scroll = new Scroll(sections, motion);
  pointer.area = layout.stage;
  tags.stage = layout.stage;

  bus.on('chapter', ({ index, prev }) => {
    layout.setChapter(index);
    tags.follow(sections[index]);
    if (prev >= 0) sound.cue('turn');
  });
  bus.on('navigate', () => sound.cue('pass'));
  bus.on('press', () => sound.cue('grip'));
  bus.on('release', ({ hold }) => sound.cue('let-go', { intensity: 0.6 + Math.min(1, hold) }));

  let renderer = null;
  let scene = null;
  let live = false; // scene loaded: update + render every frame
  let early = arrival.mode === 'scene'; // `scene` arrival: the scene draws while it loads

  const fallback = (reason, err) => {
    root.classList.add('ox-no-webgl');
    probe.webgl = false;
    if (err) {
      console.error('[openwebx]', reason, err);
      probe.errors.push(`${reason}: ${err?.message || err}`);
    }
    try {
      scene?.dispose?.();
    } catch {}
    scene = null;
    live = early = false;
    tags.attach(null);
    layout.attach(null);
    root.classList.remove('ox-quiet-css');
    renderer?.dispose();
    renderer = null;
    canvas?.remove();
  };

  const loop = new Loop(
    (time, dt) => {
      pointer.update(dt);
      scroll.update(dt);
      chapters.set(Math.min(sections.length - 1, Math.floor(scroll.storyTarget)));
      const now = performance.now();
      layout.tick(now);
      if (scene && (live || early)) {
        try {
          scene.update?.({ time, dt, scroll: scroll.snapshot(), pointer: pointer.snapshot(), reduced: motion.reduced });
          // Paper covers the whole viewport: keep updating, skip the render.
          if (!layout.paused) {
            if (scene.render) scene.render();
            else if (scene.scene && scene.camera) renderer.gl.render(scene.scene, scene.camera);
            tags.update();
            if (meter && live) meter(canvas, chapters.index, now);
          } else {
            tags.hide();
            if (meter && live && !probe.light[chapters.index]) probe.light[chapters.index] = { covered: true };
          }
        } catch (err) {
          fallback('frame-failed', err);
        }
      }
      if ((loop.frames & 15) === 0) {
        probe.fps = Math.round(loop.fps);
        probe.frames = loop.frames;
        probe.chapter = chapters.index;
        probe.story = +scroll.story.toFixed(3);
      }
    },
    {
      onSlow: (fps) => {
        if (renderer?.degrade()) {
          probe.dpr = renderer.size.dpr;
          probe.warn(`fps ${Math.round(fps)} -> dpr ${renderer.size.dpr}`);
          scene?.resize?.(renderer.size);
        }
      },
    }
  );

  arrival.set(0.05);
  await Promise.race([document.fonts?.ready, wait(3000)]);
  layout.measure();
  arrival.set(0.2);

  if (!device.webgl || !canvas) fallback('webgl-unavailable');
  else {
    try {
      renderer = new Renderer(canvas, device, bus);
      probe.webgl = true;
      probe.dpr = renderer.size.dpr;
      const ctx = {
        THREE, renderer, canvas, brief, device, motion, bus, sound, tags, layout, pointer, scroll, sections,
        arrival: { mode: arrival.mode, get progress() { return arrival.progress; } },
        // Yield inside long load() work. MessageChannel, unlike setTimeout, is
        // not throttled to ~1/min in background tabs.
        yieldTask: () => new Promise((r) => {
          const c = new MessageChannel();
          c.port1.onmessage = () => r();
          c.port2.postMessage(0);
        }),
        get size() {
          return renderer.size;
        },
      };
      scene = new Scene(ctx);
      if (early) {
        scene.resize?.(renderer.size);
        tags.attach(scene.camera);
        layout.attach(scene.camera);
      }
      loop.start();
      await scene.load?.((f) => arrival.set(0.2 + 0.75 * Math.min(1, Math.max(0, +f || 0))));
      if (scene) {
        if (scene.scene && scene.camera) renderer.gl.compile(scene.scene, scene.camera);
        scene.resize?.(renderer.size);
        tags.attach(scene.camera);
        layout.attach(scene.camera);
        live = true;
      }
    } catch (err) {
      fallback('scene-failed', err);
    }
  }
  loop.start();

  const onResize = () => {
    scroll.measure();
    layout.measure();
    tags.measure();
    if (renderer) {
      const size = renderer.resize();
      probe.dpr = size.dpr;
      scene?.resize?.(size);
    }
  };
  let resizeRaf = 0;
  addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(onResize);
  });
  // Content height changes when fonts swap or images load: re-measure.
  if ('ResizeObserver' in window) {
    new ResizeObserver(() => {
      scroll.measure();
      layout.measure();
      tags.measure();
    }).observe(document.querySelector('main') || document.body);
  }

  scroll.measure();
  probe.ready = true;
  const shown = arrival.ready(!!scene);
  // Quiet-zone fallback for text over the world when the scene has no camera finish.
  if (shown && layout.reading !== 'beside' && !layout.postQuiet) root.classList.add('ox-quiet-css');
  if (scene && arrival.wasLate) probe.warn('world arrived after the failsafe; faded in late');
  bus.emit('ready');
  scene?.onReady?.();

  addEventListener('pagehide', () => {
    loop.stop();
    try {
      scene?.dispose?.();
    } catch {}
    renderer?.dispose();
    sound.dispose();
    bus.clear();
  });

  return { bus, loop, scroll, pointer, tags, layout, sound, chapters, arrival, device, motion, probe };
}
