// Self-reporting hook for automated QA. The critic reads window.__openwebx
// from the browser instead of guessing: readiness, FPS, errors, chapter.
//
// With ?ox-qa in the page URL (and only then, so visitors pay nothing) the
// probe also carries the beauty-check measurements:
//   probe.layout[chapter] = { subject: {x,y,w,h}, text: [{x,y,w,h}], overlap, visible, paper, frame }
//                           or { covered: true, paper, frame } while paper hides the world
//   probe.light[chapter]  = { mean, p05, p95 }   relative luminance, 32x18 downsample
//                           or { covered: true } when the world was never drawn there

export const RUNTIME_VERSION = '0.2.0';

export const QA = typeof location !== 'undefined' && /[?&]ox-qa(?:[=&]|$)/.test(location.search || '');

export function createProbe() {
  const probe = {
    version: RUNTIME_VERSION,
    ready: false,
    webgl: null,
    tier: null,
    dpr: null,
    fps: 0,
    frames: 0,
    chapter: 0,
    story: 0,
    reducedMotion: false,
    errors: [],
    warnings: [],
  };
  if (QA) {
    probe.qa = true;
    probe.layout = {};
    probe.light = {};
  }
  const push = (list, msg) => list.length < 50 && list.push(String(msg).slice(0, 500));
  addEventListener('error', (e) => push(probe.errors, e.message || e.error || 'error'));
  addEventListener('unhandledrejection', (e) => push(probe.errors, e.reason?.message || e.reason || 'rejection'));
  probe.warn = (msg) => push(probe.warnings, msg);
  window.__openwebx = probe;
  return probe;
}
