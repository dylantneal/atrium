/**
 * Local search: BM25 over fields (name x3, tags x2, path x1.5, content x1), trigram fuzzy match on names,
 * and a small recency boost. Pure and dependency-free, so it runs in a worker and in unit tests.
 */

export interface SearchDoc {
  id: string;
  name: string;
  /** Folder names from the root, e.g. "Crow Short Film / Storyboards". */
  path: string;
  kind: string;
  tags: string[];
  /** First part of the text content (empty for binary files). */
  text: string;
  mtime: number;
}

export interface SearchHit {
  id: string;
  score: number;
}

export interface Query {
  terms: string[];
  kind?: string;
  tag?: string;
  raw: string;
}

const W = { name: 3, tags: 2, path: 1.5, text: 1 } as const;
const K1 = 1.2;
const B = 0.75;
const DAY = 86400000;

/** Lowercase word pieces; splits on non-alphanumerics and on camelCase and letter/digit boundaries. */
export function tokenize(s: string): string[] {
  return s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function parseQuery(raw: string): Query {
  const terms: string[] = [];
  let kind: string | undefined;
  let tag: string | undefined;
  for (const part of raw.trim().split(/\s+/)) {
    const m = /^(kind|type|tag):(.+)$/i.exec(part);
    if (m) {
      if (m[1].toLowerCase() === 'tag') tag = m[2].toLowerCase();
      else kind = m[2].toLowerCase();
    } else terms.push(...tokenize(part));
  }
  return { terms, kind, tag, raw };
}

function trigrams(s: string): Set<string> {
  const t = `  ${s.toLowerCase().replace(/[^a-z0-9]+/g, '')} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3));
  return out;
}

/** Overlap of the smaller set; 0 unless at least 3 trigrams are shared (stops short accidental matches). */
export function trigramSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter >= 3 ? inter / Math.min(a.size, b.size) : 0;
}

type Field = keyof typeof W;

interface Posting {
  doc: number;
  tf: number;
}

export class SearchIndex {
  private docs: SearchDoc[] = [];
  private index = new Map<string, number>();
  private postings: Record<Field, Map<string, Posting[]>> = { name: new Map(), tags: new Map(), path: new Map(), text: new Map() };
  private lengths: Record<Field, number[]> = { name: [], tags: [], path: [], text: [] };
  private avg: Record<Field, number> = { name: 1, tags: 1, path: 1, text: 1 };
  private grams: Set<string>[] = [];
  private dirty = true;

  get size() {
    return this.docs.length;
  }

  /** Replace everything (cheap for thousands of docs). */
  load(docs: SearchDoc[]) {
    this.docs = [];
    this.index.clear();
    for (const d of docs) this.upsert(d, false);
    this.rebuild();
  }

  upsert(doc: SearchDoc, rebuild = true) {
    const at = this.index.get(doc.id);
    if (at === undefined) {
      this.index.set(doc.id, this.docs.length);
      this.docs.push(doc);
    } else this.docs[at] = doc;
    this.dirty = true;
    if (rebuild) this.rebuild();
  }

  remove(id: string) {
    const at = this.index.get(id);
    if (at === undefined) return;
    this.docs.splice(at, 1);
    this.index.clear();
    this.docs.forEach((d, i) => this.index.set(d.id, i));
    this.dirty = true;
    this.rebuild();
  }

  private rebuild() {
    if (!this.dirty) return;
    for (const f of Object.keys(W) as Field[]) {
      this.postings[f] = new Map();
      this.lengths[f] = [];
    }
    this.grams = [];
    this.docs.forEach((d, i) => {
      const fields: Record<Field, string[]> = { name: tokenize(d.name), tags: d.tags.flatMap(tokenize), path: tokenize(d.path), text: tokenize(d.text) };
      for (const f of Object.keys(W) as Field[]) {
        const counts = new Map<string, number>();
        for (const t of fields[f]) counts.set(t, (counts.get(t) ?? 0) + 1);
        for (const [t, tf] of counts) {
          const list = this.postings[f].get(t) ?? [];
          list.push({ doc: i, tf });
          this.postings[f].set(t, list);
        }
        this.lengths[f][i] = fields[f].length;
      }
      this.grams[i] = trigrams(d.name);
    });
    for (const f of Object.keys(W) as Field[]) {
      const l = this.lengths[f];
      this.avg[f] = l.length ? Math.max(1, l.reduce((a, b) => a + b, 0) / l.length) : 1;
    }
    this.dirty = false;
  }

  /** Ranked hits, best first. Prefix matches count (so "anim" finds "animation"); typos fall back to trigram similarity on names. */
  search(raw: string, limit = 60, now = Date.now()): SearchHit[] {
    const q = parseQuery(raw);
    const N = this.docs.length;
    const scores = new Map<number, number>();
    const add = (doc: number, s: number) => scores.set(doc, (scores.get(doc) ?? 0) + s);

    for (const term of q.terms) {
      let matched = false;
      for (const f of Object.keys(W) as Field[]) {
        // exact term first, then any indexed term that starts with it
        const lists: [Posting[], number][] = [];
        const exact = this.postings[f].get(term);
        if (exact) lists.push([exact, 1]);
        if (term.length >= 3) for (const [t, l] of this.postings[f]) if (t !== term && t.startsWith(term)) lists.push([l, 0.7]);
        for (const [list, factor] of lists) {
          matched = true;
          const idf = Math.log(1 + (N - list.length + 0.5) / (list.length + 0.5));
          for (const p of list) {
            const len = this.lengths[f][p.doc] || 1;
            const bm = (idf * p.tf * (K1 + 1)) / (p.tf + K1 * (1 - B + (B * len) / this.avg[f]));
            add(p.doc, bm * W[f] * factor);
          }
        }
      }
      if (!matched && term.length >= 3) {
        const g = trigrams(term);
        this.grams.forEach((dg, i) => {
          const sim = trigramSimilarity(g, dg);
          if (sim >= 0.4) add(i, sim * 3);
        });
      }
    }
    // joined multi-word typo ("crowanim" for "crow anim")
    if (q.terms.length > 0 && scores.size === 0) {
      const g = trigrams(q.terms.join(''));
      this.grams.forEach((dg, i) => {
        const sim = trigramSimilarity(g, dg);
        if (sim >= 0.4) add(i, sim * 3);
      });
    }
    const out: SearchHit[] = [];
    const filterOnly = q.terms.length === 0 && (q.kind || q.tag);
    const candidates = filterOnly ? this.docs.map((_, i) => i) : [...scores.keys()];
    for (const i of candidates) {
      const d = this.docs[i];
      if (q.kind && d.kind !== q.kind) continue;
      if (q.tag && !d.tags.some((t) => t.toLowerCase() === q.tag)) continue;
      let s = scores.get(i) ?? 1;
      if (now - d.mtime < 30 * DAY) s *= 1.2;
      out.push({ id: d.id, score: s });
    }
    out.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
    return out.slice(0, limit);
  }
}
