// Device capability + user preference detection. Scenes read `device.tier`
// and `device.scale` to size particle counts and effects; never branch on UA.

export function supportsWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export function detectDevice() {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(innerWidth, innerHeight) < 700;
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 4;
  const saveData = !!(navigator.connection && navigator.connection.saveData);

  let tier = 'high';
  if (coarse || small || cores <= 4 || memory <= 4) tier = 'mid';
  if ((coarse && (cores <= 4 || memory <= 2)) || saveData) tier = 'low';

  const dprMax = { high: 2, mid: 1.5, low: 1 }[tier];
  // Multiplier scenes apply to particle counts, instance counts, segment counts.
  const scale = { high: 1, mid: 0.55, low: 0.3 }[tier];

  return { tier, dprMax, scale, coarse, touch: coarse, webgl: supportsWebGL() };
}

// Live prefers-reduced-motion flag with change notifications.
export function createMotionPreference(onChange) {
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  const state = { reduced: mq.matches };
  const handler = () => {
    state.reduced = mq.matches;
    document.documentElement.classList.toggle('ox-reduced', state.reduced);
    onChange && onChange(state.reduced);
  };
  mq.addEventListener ? mq.addEventListener('change', handler) : mq.addListener(handler);
  document.documentElement.classList.toggle('ox-reduced', state.reduced);
  return state;
}
