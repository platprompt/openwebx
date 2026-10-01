import { createApp } from './core/app.js';
import Scene from './scene/scene.js';

// Runtime brief: the subset of brief.json the page needs (palette, chapter
// names, chrome choices, the ready sentence, sound tuning, free-form `scene`
// parameters).
function readBrief() {
  try {
    return JSON.parse(document.getElementById('openwebx-brief')?.textContent || '{}');
  } catch {
    return {};
  }
}

createApp({ Scene, brief: readBrief() }).catch((err) => {
  console.error('[openwebx] fatal', err);
  // The article was never hidden; drop the world and anything still waiting on it.
  const root = document.documentElement;
  root.classList.add('ox-no-webgl', 'ox-failsafe');
  root.classList.remove('ox-hold');
  document.getElementById('content')?.removeAttribute('aria-busy');
});
