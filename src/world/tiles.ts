import type { NodeKind } from '../data/schema';
import { hash32 } from '../util/hash';
import { makeRng } from './generator/prng';

type Ctx = CanvasRenderingContext2D;

const KIND_COLOR: Record<NodeKind, string> = {
  folder: '#c79a4b', image: '#4a6fa5', video: '#6a4a8f', audio: '#2f7f6f', text: '#8a8f99', markdown: '#c9b88a', pdf: '#b5524a', model3d: '#5a8f4a', link: '#3d7fbf', tool: '#c79a4b', other: '#6a6f78',
};

export const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

function caption(ctx: Ctx, w: number, h: number, name: string) {
  ctx.fillStyle = 'rgba(10,8,14,0.72)';
  ctx.fillRect(0, h - 30, w, 30);
  ctx.fillStyle = '#f2ecf7';
  ctx.font = '600 15px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const max = 30;
  const label = name.length > max ? name.slice(0, max - 1) + '…' : name;
  ctx.fillText(label, 10, h - 15);
}

/** Instant placeholder: flat average colour. Shown until the real thumbnail arrives. */
export function paintPlaceholder(ctx: Ctx, w: number, h: number, color: number | undefined, kind: NodeKind) {
  ctx.fillStyle = color !== undefined ? hex(color) : KIND_COLOR[kind];
  ctx.fillRect(0, 0, w, h);
}

export function paintImage(ctx: Ctx, w: number, h: number, bitmap: ImageBitmap | HTMLImageElement) {
  const bw = (bitmap as ImageBitmap).width;
  const bh = (bitmap as ImageBitmap).height;
  const s = Math.max(w / bw, h / bh);
  const dw = bw * s;
  const dh = bh * s;
  ctx.drawImage(bitmap, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

export function paintDocument(ctx: Ctx, w: number, h: number, name: string, kind: NodeKind, lines: string[]) {
  const dark = kind === 'text';
  ctx.fillStyle = dark ? '#23272e' : '#f3ecdc';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = dark ? '#8fd0a2' : '#3a3226';
  ctx.font = '13px ui-monospace, monospace';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  let y = 10;
  for (const raw of lines.slice(0, 7)) {
    const heading = raw.startsWith('#');
    ctx.font = heading ? '700 15px system-ui, sans-serif' : '12px ui-monospace, monospace';
    const t = raw.replace(/^#+\s*/, '').slice(0, 34);
    ctx.fillText(t, 12, y);
    y += heading ? 22 : 15;
  }
  caption(ctx, w, h, name);
}

export function paintAudio(ctx: Ctx, w: number, h: number, name: string, id: string) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#12332e');
  g.addColorStop(1, '#1f5e52');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const rng = makeRng(hash32(id));
  ctx.fillStyle = '#7fe0c4';
  const bars = 36;
  for (let i = 0; i < bars; i++) {
    const env = Math.sin((i / bars) * Math.PI);
    const bh = 10 + env * 70 * (0.35 + rng.next() * 0.65);
    ctx.fillRect(10 + i * 6.7, 62 - bh / 2, 4, bh);
  }
  caption(ctx, w, h, name);
}

export function paintVideo(ctx: Ctx, w: number, h: number, name: string, color?: number) {
  ctx.fillStyle = color !== undefined ? hex(color) : '#3a3060';
  ctx.fillRect(0, 0, w, h);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.moveTo(w / 2 - 16, h / 2 - 28);
  ctx.lineTo(w / 2 + 22, h / 2 - 8);
  ctx.lineTo(w / 2 - 16, h / 2 + 12);
  ctx.closePath();
  ctx.fill();
  caption(ctx, w, h, name);
}

export function paintGeneric(ctx: Ctx, w: number, h: number, name: string, kind: NodeKind) {
  ctx.fillStyle = KIND_COLOR[kind];
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '700 54px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const ext = name.includes('.') ? name.split('.').pop()!.toUpperCase().slice(0, 5) : kind.toUpperCase().slice(0, 5);
  ctx.fillText(ext, w / 2, h / 2 - 12);
  ctx.textAlign = 'left';
  caption(ctx, w, h, name);
}

export function paintFolder(ctx: Ctx, w: number, h: number, name: string) {
  ctx.fillStyle = '#2b2433';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#d6a94f';
  ctx.beginPath();
  ctx.roundRect(60, 38, 136, 80, 8);
  ctx.fill();
  ctx.fillRect(60, 30, 56, 14);
  caption(ctx, w, h, name);
}

/** A tool on the Hall shelf: big glyph on brass, name underneath. */
export function paintTool(ctx: Ctx, w: number, h: number, name: string, icon: string) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#6b4f1e');
  g.addColorStop(1, '#c79a4b');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = '700 64px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(icon, w / 2, h / 2 - 14);
  ctx.textAlign = 'left';
  caption(ctx, w, h, name);
}
