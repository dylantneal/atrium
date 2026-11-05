import type { NodeKind } from '../data/schema';

const EXT: Record<string, NodeKind> = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', avif: 'image',
  mp4: 'video', webm: 'video', mov: 'video', mkv: 'video',
  mp3: 'audio', wav: 'audio', ogg: 'audio', flac: 'audio', m4a: 'audio',
  txt: 'text', json: 'text', csv: 'text', js: 'text', ts: 'text', py: 'text', html: 'text', css: 'text', fountain: 'text', log: 'text',
  md: 'markdown', markdown: 'markdown',
  pdf: 'pdf',
  glb: 'model3d', gltf: 'model3d',
};

export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

export function kindFromName(name: string): NodeKind {
  return EXT[extOf(name)] ?? 'other';
}

export function mimeFromName(name: string): string {
  switch (extOf(name)) {
    case 'png': return 'image/png';
    case 'jpg': case 'jpeg': return 'image/jpeg';
    case 'webp': return 'image/webp';
    case 'svg': return 'image/svg+xml';
    case 'wav': return 'audio/wav';
    case 'mp3': return 'audio/mpeg';
    case 'webm': return 'video/webm';
    case 'mp4': return 'video/mp4';
    case 'md': case 'markdown': return 'text/markdown';
    case 'json': return 'application/json';
    case 'pdf': return 'application/pdf';
    default: return kindFromName(name) === 'text' ? 'text/plain' : 'application/octet-stream';
  }
}
