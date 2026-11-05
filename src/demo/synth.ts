import { makeRng } from '../world/generator/prng';

/** Dependency-free PNG encoder (uses CompressionStream, present in browsers and Node 22). */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodePng(width: number, height: number, rgb: Uint8Array): Promise<Uint8Array> {
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', await deflate(raw)), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export interface ArtParams {
  seed: number;
  /** Base hue 0..360. */
  hue: number;
  width?: number;
  height?: number;
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/** Procedural gradient-and-shapes art. Returns PNG bytes plus the average color (0xRRGGBB). */
export async function makeArt(p: ArtParams): Promise<{ png: Uint8Array; color: number }> {
  const w = p.width ?? 192;
  const h = p.height ?? 120;
  const rng = makeRng(p.seed);
  const rgb = new Uint8Array(w * h * 3);
  const c1 = hsl(p.hue, 0.55, 0.28);
  const c2 = hsl(p.hue + rng.range(30, 90), 0.6, 0.55);
  const angle = rng.range(0, Math.PI * 2);
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const shapes = Array.from({ length: rng.int(2, 4) }, () => ({
    x: rng.range(0.1, 0.9) * w,
    y: rng.range(0.1, 0.9) * h,
    r: rng.range(0.1, 0.3) * w,
    c: hsl(p.hue + rng.range(-40, 160), 0.7, rng.range(0.4, 0.8)),
  }));
  let sr = 0, sg = 0, sb = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = Math.min(1, Math.max(0, 0.5 + ((x / w - 0.5) * ca + (y / h - 0.5) * sa)));
      let r = c1[0] + (c2[0] - c1[0]) * t;
      let g = c1[1] + (c2[1] - c1[1]) * t;
      let b = c1[2] + (c2[2] - c1[2]) * t;
      for (const s of shapes) {
        const d = Math.hypot(x - s.x, y - s.y);
        if (d < s.r) {
          const a = 0.55 * (1 - d / s.r);
          r += (s.c[0] - r) * a;
          g += (s.c[1] - g) * a;
          b += (s.c[2] - b) * a;
        }
      }
      const i = (y * w + x) * 3;
      rgb[i] = r;
      rgb[i + 1] = g;
      rgb[i + 2] = b;
      sr += rgb[i];
      sg += rgb[i + 1];
      sb += rgb[i + 2];
    }
  }
  const n = w * h;
  const color = (Math.round(sr / n) << 16) | (Math.round(sg / n) << 8) | Math.round(sb / n);
  return { png: await encodePng(w, h, rgb), color };
}

/** 8-bit mono WAV: a short loop built from a few sine partials. */
export function makeWav(seed: number, seconds = 2, rate = 8000): Uint8Array {
  const rng = makeRng(seed);
  const n = Math.floor(seconds * rate);
  const base = 110 * Math.pow(2, rng.int(0, 12) / 12);
  const partials = [1, 2, 3, 4].map((k) => ({ f: base * k * (k === 1 ? 1 : rng.range(0.99, 1.01)), a: 1 / (k * k) }));
  const out = new Uint8Array(44 + n);
  const dv = new DataView(out.buffer);
  const str = (o: number, s: string) => [...s].forEach((ch, i) => (out[o + i] = ch.charCodeAt(0)));
  str(0, 'RIFF');
  dv.setUint32(4, 36 + n, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate, true);
  dv.setUint16(32, 1, true);
  dv.setUint16(34, 8, true);
  str(36, 'data');
  dv.setUint32(40, n, true);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = Math.min(1, i / 400, (n - i) / 400);
    let v = 0;
    for (const p of partials) v += p.a * Math.sin(2 * Math.PI * p.f * t);
    out[44 + i] = Math.round(128 + 100 * env * v * 0.6);
  }
  return out;
}
