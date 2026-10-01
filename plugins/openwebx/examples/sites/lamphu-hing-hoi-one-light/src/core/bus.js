// Minimal event bus. Every interaction the scene or UI cares about flows
// through here, which is what makes the experience "sound-ready": the sound
// layer just subscribes to the same events.

export class Bus {
  constructor() {
    this.map = new Map();
  }
  on(type, fn) {
    if (!this.map.has(type)) this.map.set(type, new Set());
    this.map.get(type).add(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) {
    this.map.get(type)?.delete(fn);
  }
  emit(type, payload) {
    this.map.get(type)?.forEach((fn) => {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[openwebx] listener for "${type}" failed`, err);
      }
    });
  }
  clear() {
    this.map.clear();
  }
}
