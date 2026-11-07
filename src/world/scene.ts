import * as THREE from 'three';
import { ScaleController, TIERS, type Tier } from './quality';

export interface PerfStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  textures: number;
  geometries: number;
  heapMB: number | null;
  scale: number;
}

type FrameHook = (dt: number, t: number) => void;

/** Owns the renderer, camera, and loop. Rooms plug in through `root` and `onFrame`. */
export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.05, 80);
  /** Everything belonging to the current room lives under this group. */
  readonly root = new THREE.Group();
  /** Things held in the player's hand are drawn in a second pass so they never clip into walls. */
  readonly handScene = new THREE.Scene();
  readonly stats: PerfStats = { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, textures: 0, geometries: 0, heapMB: null, scale: 1 };

  private hooks = new Set<FrameHook>();
  private scaler = new ScaleController();
  private raf = 0;
  private last = 0;
  private running = false;
  private paused = false;
  private emaMs = 16;
  private fpsFrames = 0;
  private fpsT = 0;
  private tier: Tier = 'high';
  /** In auto mode the tier steps down when resolution scaling alone cannot keep up. */
  autoTier = true;
  private slowAtMin = 0;
  onTierChange: (t: Tier) => void = () => {};
  readonly sun = new THREE.DirectionalLight(0xfff1dd, 1.0);
  readonly ambient = new THREE.HemisphereLight(0xcfd8ff, 0x3a3340, 0.55);

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false });
    this.renderer.shadowMap.enabled = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color(0x14121a);
    this.scene.fog = new THREE.Fog(0x14121a, 12, 34);
    this.sun.position.set(3, 8, 2);
    this.scene.add(this.ambient, this.sun, this.root);
    this.handScene.add(new THREE.HemisphereLight(0xffffff, 0x666677, 1.1));
    const handSun = new THREE.DirectionalLight(0xffffff, 1.4);
    handSun.position.set(0.5, 1, 0.8);
    this.handScene.add(handSun);
    this.renderer.info.autoReset = false;
    this.camera.position.set(0, 1.6, 0);
    this.camera.rotation.order = 'YXZ';
    this.setTier('high');
    this.resize();
    addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stopLoop();
      else if (this.running) this.startLoop();
    });
  }

  setTier(tier: Tier) {
    this.tier = tier;
    this.scaler.setMax(TIERS[tier].maxScale);
    this.applyScale();
  }
  get currentTier() {
    return this.tier;
  }

  onFrame(h: FrameHook): () => void {
    this.hooks.add(h);
    return () => this.hooks.delete(h);
  }

  /** While paused (e.g. flat focus mode) nothing is drawn; the last frame stays on screen. */
  setPaused(p: boolean) {
    this.paused = p;
    this.last = performance.now();
  }

  start() {
    this.running = true;
    this.startLoop();
  }

  /** Test hook: render exactly one frame with a fixed dt. */
  renderOnce(dt = 1 / 60) {
    for (const h of this.hooks) h(dt, performance.now() / 1000);
    this.renderAll();
  }

  /** The room, then (only when something is held) the hand pass on a cleared depth buffer. */
  private renderAll() {
    this.renderer.info.reset();
    this.renderer.render(this.scene, this.camera);
    if (this.handScene.children.some((c) => c.visible && (c as THREE.Group).children.length > 0 && !(c as THREE.Light).isLight)) {
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.handScene, this.camera);
      this.renderer.autoClear = true;
    }
  }

  private startLoop() {
    cancelAnimationFrame(this.raf);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }
  private stopLoop() {
    cancelAnimationFrame(this.raf);
  }

  private tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick);
    const ms = now - this.last;
    this.last = now;
    if (this.paused) return;
    const dt = Math.min(0.1, ms / 1000);
    for (const h of this.hooks) h(dt, now / 1000);
    this.renderAll();

    this.emaMs = this.emaMs * 0.9 + ms * 0.1;
    this.fpsFrames++;
    this.fpsT += ms;
    if (this.fpsT >= 500) {
      this.stats.fps = Math.round((this.fpsFrames * 1000) / this.fpsT);
      this.fpsFrames = 0;
      this.fpsT = 0;
    }
    const info = this.renderer.info;
    this.stats.frameMs = Math.round(this.emaMs * 10) / 10;
    this.stats.drawCalls = info.render.calls;
    this.stats.triangles = info.render.triangles;
    this.stats.textures = info.memory.textures;
    this.stats.geometries = info.memory.geometries;
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    this.stats.heapMB = mem ? Math.round(mem.usedJSHeapSize / 1048576) : null;
    const changed = this.scaler.frame(ms);
    if (changed !== null) this.applyScale();
    if (this.autoTier && this.scaler.scale <= 0.6001 && ms > 45) {
      if (++this.slowAtMin >= 90) {
        this.slowAtMin = 0;
        const next: Tier | null = this.tier === 'high' ? 'medium' : this.tier === 'medium' ? 'low' : null;
        if (next) {
          this.setTier(next);
          this.onTierChange(next);
        }
      }
    } else if (ms <= 45) this.slowAtMin = 0;
  };

  private applyScale() {
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    this.renderer.setPixelRatio(dpr * this.scaler.scale);
    this.stats.scale = this.scaler.scale;
    this.resize();
  }

  resize() {
    const w = Math.max(1, innerWidth);
    const h = Math.max(1, innerHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
