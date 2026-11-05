import * as THREE from 'three';

export const TILE_W = 256;
export const TILE_H = 160;

/**
 * One texture holds every picture in a room, so a whole wall is a single instanced draw call.
 * Tiles are painted into a CPU canvas and copied to the GPU one at a time (no full re-upload).
 */
export class Atlas {
  readonly texture: THREE.Texture;
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  readonly tw: number;
  readonly th: number;
  readonly cols: number;
  readonly rows: number;
  readonly capacity: number;
  private used = 0;
  private scratch: HTMLCanvasElement;
  private scratchCtx: CanvasRenderingContext2D;
  private scratchTex: THREE.Texture;
  private gpuReady = false;

  constructor(
    private renderer: THREE.WebGLRenderer,
    count: number,
  ) {
    // Big rooms use half-size tiles so one 2048-wide texture still holds everything.
    const half = count > 96;
    this.tw = half ? TILE_W / 2 : TILE_W;
    this.th = half ? TILE_H / 2 : TILE_H;
    this.cols = Math.floor(2048 / this.tw);
    const rowsNeeded = Math.max(1, Math.ceil(Math.max(count, 1) / this.cols));
    this.rows = Math.min(rowsNeeded, Math.floor(2048 / this.th));
    this.capacity = this.cols * this.rows;
    const c = document.createElement('canvas');
    c.width = this.cols * this.tw;
    c.height = this.rows * this.th;
    this.canvas = c;
    this.ctx = c.getContext('2d')!;
    this.ctx.fillStyle = '#222';
    this.ctx.fillRect(0, 0, c.width, c.height);
    this.texture = new THREE.Texture(c);
    this.texture.flipY = false;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.needsUpdate = true;
    this.scratch = document.createElement('canvas');
    this.scratch.width = this.tw;
    this.scratch.height = this.th;
    this.scratchCtx = this.scratch.getContext('2d')!;
    this.scratchTex = new THREE.Texture(this.scratch);
    this.scratchTex.flipY = false;
    this.scratchTex.generateMipmaps = false;
    this.scratchTex.colorSpace = THREE.SRGBColorSpace;
  }

  allocate(): number | null {
    return this.used < this.capacity ? this.used++ : null;
  }

  /** [offsetX, offsetY, scaleX, scaleY] for the instanced UV remap (V runs down because flipY is off). */
  uvRect(tile: number, aspectCrop = 1): [number, number, number, number] {
    const px = (tile % this.cols) * this.tw;
    const py = Math.floor(tile / this.cols) * this.th;
    const W = this.cols * this.tw;
    const H = this.rows * this.th;
    const sx = (this.tw / W) * aspectCrop;
    const ox = px / W + ((this.tw / W) * (1 - aspectCrop)) / 2;
    return [ox, (py + this.th) / H, sx, -this.th / H];
  }

  /** Paint a tile. `draw` receives a ctx sized to one tile in tile pixels (always 256x160 logical units). */
  paint(tile: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
    const s = this.scratchCtx;
    s.save();
    s.clearRect(0, 0, this.tw, this.th);
    s.scale(this.tw / TILE_W, this.th / TILE_H);
    draw(s, TILE_W, TILE_H);
    s.restore();
    const px = (tile % this.cols) * this.tw;
    const py = Math.floor(tile / this.cols) * this.th;
    this.ctx.drawImage(this.scratch, px, py);
    if (!this.gpuReady) return; // initial upload will include it
    this.scratchTex.needsUpdate = true;
    const region = new THREE.Box2(new THREE.Vector2(0, 0), new THREE.Vector2(this.tw, this.th));
    this.renderer.copyTextureToTexture(this.scratchTex, this.texture, region, new THREE.Vector2(px, py));
  }

  /** Call once the placeholder tiles are painted: uploads the whole atlas a single time. */
  commit() {
    this.texture.needsUpdate = true;
    this.renderer.initTexture(this.texture);
    this.gpuReady = true;
  }

  dispose() {
    this.texture.dispose();
    this.scratchTex.dispose();
  }
}
