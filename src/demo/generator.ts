import type { Id, Node, NodeKind } from '../data/schema';
import { hash32 } from '../util/hash';
import { kindFromName, mimeFromName } from '../vfs/kind';
import { fingerprintOf } from '../vfs/vfs';
import type { DemoSeed } from '../vfs/demo';
import { ROOT_ID } from '../vfs/demo';
import { makeRng, type Rng } from '../world/generator/prng';
import { makeArt, makeWav } from './synth';

const DAY = 24 * 3600 * 1000;

export type Content =
  | { t: 'art'; hue: number; seed: number }
  | { t: 'wav'; seed: number }
  | { t: 'text'; body: string }
  | { t: 'bytes'; body: string };

export interface SpecFile {
  path: string; // "Project/Sub/file.png"
  kind: NodeKind;
  mtime: number;
  content: Content;
  tags: string[];
}

export interface SpecFolder {
  path: string;
  mtime: number;
}

export interface DemoSpec {
  folders: SpecFolder[];
  files: SpecFile[];
}

interface Project {
  name: string;
  /** Days since the project was last touched. */
  ageDays: number;
  hue: number;
  groups: { dir: string; kind: 'art' | 'wav' | 'md' | 'txt' | 'mp4' | 'pdf' | 'csv'; count: number; stem: string }[];
  tags: string[];
}

const PROJECTS: Project[] = [
  {
    name: 'Crow Short Film', ageDays: 0.2, hue: 265, tags: ['film', 'crow'],
    groups: [
      { dir: 'Storyboards', kind: 'art', count: 10, stem: 'crow_sb' },
      { dir: 'Renders', kind: 'art', count: 12, stem: 'crow_render' },
      { dir: 'Scripts', kind: 'md', count: 4, stem: 'crow_script' },
      { dir: 'Audio Cues', kind: 'wav', count: 5, stem: 'crow_cue' },
      { dir: 'Animatic', kind: 'mp4', count: 2, stem: 'crow_animatic' },
    ],
  },
  {
    name: 'Night Static (Band)', ageDays: 1.1, hue: 190, tags: ['music', 'band'],
    groups: [
      { dir: 'Stems', kind: 'wav', count: 8, stem: 'stem' },
      { dir: 'Mixes', kind: 'wav', count: 3, stem: 'mix_v' },
      { dir: 'Lyrics', kind: 'md', count: 6, stem: 'lyrics' },
      { dir: 'Artwork', kind: 'art', count: 8, stem: 'cover_option' },
    ],
  },
  {
    name: 'Portfolio Site', ageDays: 12, hue: 20, tags: ['web', 'portfolio'],
    groups: [
      { dir: 'Pages', kind: 'txt', count: 6, stem: 'page' },
      { dir: 'Images', kind: 'art', count: 10, stem: 'hero' },
      { dir: 'Copy', kind: 'md', count: 3, stem: 'copy' },
    ],
  },
  {
    name: 'Reference', ageDays: 26, hue: 140, tags: ['reference'],
    groups: [
      { dir: 'Moodboards', kind: 'art', count: 22, stem: 'ref' },
      { dir: 'Notes', kind: 'md', count: 4, stem: 'ref_notes' },
    ],
  },
  {
    name: 'Taxes & Admin', ageDays: 140, hue: 50, tags: ['admin'],
    groups: [
      { dir: 'Receipts', kind: 'pdf', count: 8, stem: 'receipt' },
      { dir: 'Ledgers', kind: 'csv', count: 4, stem: 'ledger' },
      { dir: 'Letters', kind: 'md', count: 3, stem: 'letter' },
    ],
  },
  {
    name: 'Archive 2022', ageDays: 420, hue: 330, tags: ['archive'],
    groups: [
      { dir: 'Old Renders', kind: 'art', count: 15, stem: 'old_render' },
      { dir: 'Old Mixes', kind: 'wav', count: 3, stem: 'old_mix' },
      { dir: 'Misc', kind: 'txt', count: 4, stem: 'misc' },
    ],
  },
];

const WORDS = ['crow', 'static', 'moon', 'signal', 'glass', 'ember', 'tide', 'orbit', 'paper', 'velvet', 'wire', 'harbor', 'neon', 'dust', 'echo', 'rail'];

function sentence(rng: Rng): string {
  const n = rng.int(6, 12);
  const w = Array.from({ length: n }, () => rng.pick(WORDS));
  return w.join(' ').replace(/^./, (c) => c.toUpperCase()) + '.';
}

function mdBody(title: string, rng: Rng): string {
  const paras = Array.from({ length: rng.int(2, 4) }, () => Array.from({ length: rng.int(2, 4) }, () => sentence(rng)).join(' '));
  return `# ${title}\n\n${paras.join('\n\n')}\n\n- ${sentence(rng)}\n- ${sentence(rng)}\n`;
}

/** Pure and deterministic: same (seed, now) always gives the same spec. */
export function buildDemoSpec(seed: number, now: number): DemoSpec {
  const rng = makeRng(hash32(`demo:${seed}`));
  const folders: SpecFolder[] = [];
  const files: SpecFile[] = [];
  for (const p of PROJECTS) {
    const newest = now - p.ageDays * DAY;
    folders.push({ path: p.name, mtime: newest });
    for (const g of p.groups) {
      folders.push({ path: `${p.name}/${g.dir}`, mtime: newest - rng.range(0, 3) * DAY });
      for (let i = 1; i <= g.count; i++) {
        const spread = Math.min(p.ageDays + 40, 60 + p.ageDays * 0.3);
        const mtime = Math.round(i === 1 && g === p.groups[0] ? newest : newest - rng.range(0, spread) * DAY);
        const num = String(i).padStart(2, '0');
        const tags = rng.chance(0.3) ? [rng.pick(p.tags)] : [];
        const base = `${p.name}/${g.dir}`;
        switch (g.kind) {
          case 'art':
            files.push({ path: `${base}/${g.stem}_${num}.png`, kind: 'image', mtime, tags, content: { t: 'art', hue: p.hue + rng.range(-30, 30), seed: rng.int(1, 1e9) } });
            break;
          case 'wav':
            files.push({ path: `${base}/${g.stem}_${num}.wav`, kind: 'audio', mtime, tags, content: { t: 'wav', seed: rng.int(1, 1e9) } });
            break;
          case 'md':
            files.push({ path: `${base}/${g.stem}_${num}.md`, kind: 'markdown', mtime, tags, content: { t: 'text', body: mdBody(`${g.stem.replace(/_/g, ' ')} ${num}`, rng) } });
            break;
          case 'txt':
            files.push({ path: `${base}/${g.stem}_${num}.txt`, kind: 'text', mtime, tags, content: { t: 'text', body: Array.from({ length: rng.int(4, 9) }, () => sentence(rng)).join('\n') } });
            break;
          case 'csv':
            files.push({ path: `${base}/${g.stem}_${num}.csv`, kind: 'text', mtime, tags, content: { t: 'text', body: 'date,item,amount\n' + Array.from({ length: 8 }, (_, k) => `2024-0${(k % 9) + 1}-1${k},${rng.pick(WORDS)},${rng.int(5, 400)}.00`).join('\n') + '\n' } });
            break;
          case 'mp4':
            files.push({ path: `${base}/${g.stem}_${num}.mp4`, kind: 'video', mtime, tags, content: { t: 'bytes', body: 'placeholder video' } });
            break;
          case 'pdf':
            files.push({ path: `${base}/${g.stem}_${num}.pdf`, kind: 'pdf', mtime, tags, content: { t: 'bytes', body: '%PDF-1.4\n%%EOF\n' } });
            break;
        }
      }
    }
    // loose project notes at the project root
    files.push({
      path: `${p.name}/README.md`, kind: 'markdown', mtime: Math.round(newest - rng.range(0, 5) * DAY), tags: [],
      content: { t: 'text', body: mdBody(`${p.name}`, rng) },
    });
  }
  files.push({ path: 'Welcome to Atrium.md', kind: 'markdown', mtime: now, tags: [], content: { t: 'text', body: WELCOME } });
  return { folders, files };
}

const WELCOME = `# Welcome to Atrium

Each folder is a room. Walk through the doors to explore.

- **Light** shows activity: bright rooms are in use, dim and dusty ones are neglected.
- **Pick things up** and carry them to another room to move them.
- **Open any item** to read or edit it in a flat, full-screen view.
- **Search** (Ctrl+K or /) builds a room from the results.
`;

/** Turns a spec into nodes and blobs. Image and audio bytes are synthesized here. */
export async function materializeDemo(spec: DemoSpec): Promise<DemoSeed> {
  const nodes: Node[] = [];
  const blobs = new Map<Id, Blob>();
  const idOf = new Map<string, Id>();
  idOf.set('', ROOT_ID);
  let counter = 0;
  const mkId = (path: string) => `n_${hash32(path).toString(16)}_${counter++}`;
  const ensureFolder = (path: string, mtime: number): Id => {
    const existing = idOf.get(path);
    if (existing) return existing;
    const slash = path.lastIndexOf('/');
    const parent = ensureFolder(slash < 0 ? '' : path.slice(0, slash), mtime);
    const name = slash < 0 ? path : path.slice(slash + 1);
    const id = mkId(path);
    idOf.set(path, id);
    nodes.push({ id, parent, kind: 'folder', name, size: 0, mtime, tags: [], fingerprint: fingerprintOf(name, 0, mtime) });
    return id;
  };
  for (const f of spec.folders) ensureFolder(f.path, f.mtime);
  for (const f of spec.files) {
    const slash = f.path.lastIndexOf('/');
    const parent = ensureFolder(slash < 0 ? '' : f.path.slice(0, slash), f.mtime);
    const name = f.path.slice(slash + 1);
    const id = mkId(f.path);
    let blob: Blob;
    let color: number | undefined;
    const c = f.content;
    if (c.t === 'art') {
      const art = await makeArt({ seed: c.seed, hue: c.hue });
      blob = new Blob([art.png as BlobPart], { type: 'image/png' });
      color = art.color;
    } else if (c.t === 'wav') {
      blob = new Blob([makeWav(c.seed) as BlobPart], { type: 'audio/wav' });
    } else {
      blob = new Blob([c.body], { type: mimeFromName(name) });
    }
    if (f.kind === 'video') color = 0x2a3550 + (hash32(name) & 0x3f3f3f);
    nodes.push({ id, parent, kind: f.kind ?? kindFromName(name), name, size: blob.size, mtime: f.mtime, tags: f.tags, color, fingerprint: fingerprintOf(name, blob.size, f.mtime) });
    blobs.set(id, blob);
  }
  return { nodes, blobs };
}

export async function buildDemoSeed(seed = 1, now = Date.now()): Promise<DemoSeed> {
  return materializeDemo(buildDemoSpec(seed, now));
}
