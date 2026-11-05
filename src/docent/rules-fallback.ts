import type { Id } from '../data/schema';
import { tokenize } from '../core/search';
import type { DocentProvider, SortRule, ThreadSuggestion, ToolCall } from './provider';

export interface DocItem {
  id: Id;
  name: string;
  kind: string;
  size: number;
  mtime: number;
  color?: number;
}

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

function hsl(color: number): [number, number, number] {
  const r = ((color >> 16) & 255) / 255, g = ((color >> 8) & 255) / 255, b = (color & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

/** Stable sort by rule. Items without a colour sort last for "color". */
export function sortItems<T extends DocItem>(items: T[], rule: SortRule): T[] {
  const out = [...items];
  const byName = (a: T, b: T) => natural(a.name, b.name);
  switch (rule) {
    case 'name':
      return out.sort(byName);
    case 'date':
      return out.sort((a, b) => b.mtime - a.mtime || byName(a, b));
    case 'size':
      return out.sort((a, b) => b.size - a.size || byName(a, b));
    case 'kind':
      return out.sort((a, b) => a.kind.localeCompare(b.kind) || byName(a, b));
    case 'color':
      return out.sort((a, b) => {
        if (a.color === undefined || b.color === undefined) return a.color === b.color ? byName(a, b) : a.color === undefined ? 1 : -1;
        const [ha, sa, la] = hsl(a.color);
        const [hb, sb, lb] = hsl(b.color);
        // greys (no real hue) first by lightness, then the colour wheel
        const ga = sa < 0.12, gb = sb < 0.12;
        if (ga !== gb) return ga ? -1 : 1;
        if (ga) return la - lb;
        return ha - hb || la - lb;
      });
  }
}

const KIND_WORD: Record<string, [string, string]> = {
  image: ['image', 'images'], video: ['video', 'videos'], audio: ['audio file', 'audio files'], text: ['text file', 'text files'],
  markdown: ['note', 'notes'], pdf: ['PDF', 'PDFs'], model3d: ['3D model', '3D models'], other: ['other file', 'other files'], folder: ['folder', 'folders'],
};

const STOP = new Set(['v', 'png', 'md', 'mp', 'wav', 'txt', 'pdf', 'csv', 'jpg', 'copy', 'untitled', 'final', 'new']);

/** A plain-language overview of a set of items (names and metadata only). */
export function summarizeItems(roomName: string, items: DocItem[], idleDays: number | null, now = Date.now()): string {
  if (items.length === 0) return `${roomName} is empty. Pick something up and place it on a wall, or add a note.`;
  const byKind = new Map<string, number>();
  for (const i of items) byKind.set(i.kind, (byKind.get(i.kind) ?? 0) + 1);
  const parts = [...byKind].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${KIND_WORD[k]?.[n === 1 ? 0 : 1] ?? k}`);
  const total = items.reduce((n, i) => n + i.size, 0);
  const words = new Map<string, number>();
  for (const i of items) for (const t of new Set(tokenize(i.name))) if (t.length > 2 && !/^\d+$/.test(t) && !STOP.has(t)) words.set(t, (words.get(t) ?? 0) + 1);
  const themes = [...words].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || natural(a[0], b[0])).slice(0, 4).map(([w]) => w);
  const newest = [...items].sort((a, b) => b.mtime - a.mtime)[0];
  const oldest = [...items].sort((a, b) => a.mtime - b.mtime)[0];
  const age = (t: number) => {
    const d = Math.floor((now - t) / 86400000);
    return d < 1 ? 'today' : d === 1 ? 'yesterday' : d < 60 ? `${d} days ago` : `${Math.round(d / 30)} months ago`;
  };
  const lines = [`${roomName} holds ${items.length} item${items.length === 1 ? '' : 's'}: ${parts.join(', ')} (${(total / 1024).toFixed(total < 1048576 ? 1 : 0)} KB${total >= 1048576 ? '+' : ''}).`];
  if (themes.length) lines.push(`Recurring names: ${themes.join(', ')}.`);
  lines.push(`Most recent change: ${newest.name}, ${age(newest.mtime)}. Oldest: ${oldest.name}, ${age(oldest.mtime)}.`);
  if (idleDays !== null) lines.push(idleDays >= 60 ? `Nothing here has been touched for ${idleDays} days, so it is dim and dusty.` : idleDays <= 2 ? 'It is in active use, so the room is lit.' : `Last touched ${idleDays} days ago.`);
  return lines.join(' ');
}

const tail = (name: string) => /(\d+)(?=\.[a-z0-9]+$|$)/i.exec(name)?.[1];

/** Pairs of items that look related: shared name words, and the same trailing number across kinds. */
export function suggestThreadPairs(items: DocItem[], limit = 6): ThreadSuggestion[] {
  const toks = items.map((i) => new Set(tokenize(i.name).filter((t) => t.length > 2 && !/^\d+$/.test(t) && !STOP.has(t))));
  const out: (ThreadSuggestion & { score: number })[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      const shared = [...toks[i]].filter((t) => toks[j].has(t));
      const num = tail(a.name) && tail(a.name) === tail(b.name);
      if (shared.length === 0 || (a.kind === b.kind && !num && shared.length < 2)) continue;
      const score = shared.length + (num ? 1 : 0) + (a.kind !== b.kind ? 0.5 : 0);
      const reason = `both mention "${shared.slice(0, 2).join('", "')}"${num ? ` and end in ${tail(a.name)}` : ''}`;
      out.push({ a: a.id, b: b.id, reason, type: a.kind !== b.kind ? 'project' : 'derived', score });
    }
  }
  return out.sort((x, y) => y.score - x.score).slice(0, limit).map(({ score: _s, ...t }) => t);
}

const RULE_WORDS: [RegExp, SortRule][] = [
  [/colou?r|hue|rainbow/, 'color'],
  [/alphab|name|a-z|title/, 'name'],
  [/date|recent|newest|latest|oldest|modified|time/, 'date'],
  [/size|big|large|small/, 'size'],
  [/type|kind|format/, 'kind'],
];

/** Understands a handful of phrasings without any model. Anything else falls back to search. */
export class RuleProvider implements DocentProvider {
  readonly name = 'Rule-based docent';

  interpret(raw: string): ToolCall | null {
    const text = raw.trim();
    const t = text.toLowerCase();
    if (!t) return null;
    if (/\btour\b|show me around|walk me|guide me/.test(t)) return { tool: 'tour' };
    if (/\bthreads?\b|related|connect|link (these|them|items)/.test(t)) return { tool: 'suggestThreads' };
    if (/\bsummari[sz]e\b|summary|overview|what('s| is) (in|here)|describe (this|the) room|tell me about/.test(t)) return { tool: 'summarize' };
    const tag = /\btag\b.*?\b(?:as|with)\b\s+(.+)$/i.exec(text);
    if (tag) {
      const tags = tag[1].split(/,|\band\b/).map((x) => x.trim()).filter(Boolean);
      if (tags.length) return { tool: 'tagItems', tags, scope: /\b(this wall|these|aimed|here)\b/.test(t) ? 'aimed' : 'room' };
    }
    if (/\b(sort|arrange|order|organi[sz]e|rearrange)\b/.test(t)) {
      const rule = RULE_WORDS.find(([re]) => re.test(t))?.[1] ?? 'name';
      const wall = /\b(this|that|aimed|current)\b.*\bwall\b|\bwall\b.*\b(i'm|i am) (looking|facing)/.test(t) || /\bthis wall\b/.test(t) ? 'aimed' : 'all';
      return { tool: 'arrange', wall, rule };
    }
    const find = /^(?:find|search(?: for)?|show me|look for|where(?:'s| is))\s+(.+)$/i.exec(text);
    if (find) return { tool: 'search', query: find[1].replace(/^(the|my|all)\s+/i, '') };
    if (text.split(/\s+/).length <= 6) return { tool: 'search', query: text };
    return null;
  }
}

export const HELP = 'I can sort a wall ("sort this wall by color"), summarize a room, suggest threads between related files, tag items ("tag these as film, draft"), give a tour of the building, or search ("find crow animation").';
