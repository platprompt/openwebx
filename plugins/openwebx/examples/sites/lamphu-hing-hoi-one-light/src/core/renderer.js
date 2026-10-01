import * as THREE from 'three';

// Owns the WebGLRenderer, its size, and the device-pixel-ratio budget.
// The DPR is capped by device tier and lowered further when frames drop.

export class Renderer {
  constructor(canvas, device, bus) {
    this.canvas = canvas;
    this.device = device;
    this.bus = bus;
    this.dprCap = device.dprMax;
    this.dprFloor = 0.75;

    this.gl = new THREE.WebGLRenderer({
      canvas,
      antialias: device.tier !== 'low',
      alpha: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1;
    this.gl.setClearColor(0x000000, 0);

    this.size = { width: 1, height: 1, dpr: 1, aspect: 1 };
    this.resize();

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      document.documentElement.classList.add('ox-gl-lost');
      bus.emit('context-lost');
    });
    canvas.addEventListener('webglcontextrestored', () => {
      document.documentElement.classList.remove('ox-gl-lost');
      bus.emit('context-restored');
    });
  }

  get pixelRatio() {
    return Math.min(window.devicePixelRatio || 1, this.dprCap);
  }

  // The canvas CSS box decides the size (full viewport, or one side of the
  // page with reading "beside").
  resize() {
    const width = Math.max(1, Math.round(this.canvas.clientWidth || window.innerWidth));
    const height = Math.max(1, Math.round(this.canvas.clientHeight || window.innerHeight));
    const dpr = this.pixelRatio;
    this.gl.setPixelRatio(dpr);
    this.gl.setSize(width, height, false);
    this.size = { width, height, dpr, aspect: width / Math.max(1, height) };
    return this.size;
  }

  // Called by the loop when sustained FPS is low. Returns true if it changed.
  degrade() {
    const next = Math.max(this.dprFloor, +(this.dprCap - 0.25).toFixed(2));
    if (next === this.dprCap) return false;
    this.dprCap = next;
    this.resize();
    this.bus.emit('quality', { dpr: this.size.dpr });
    return true;
  }

  dispose() {
    this.gl.dispose();
    this.gl.forceContextLoss?.();
  }
}
