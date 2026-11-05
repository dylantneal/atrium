import { describe, expect, it } from 'vitest';
import { parseQuery, SearchIndex, tokenize, type SearchDoc } from '../src/core/search';

const NOW = 1_800_000_000_000;
const DAY = 86400000;
const doc = (id: string, name: string, over: Partial<SearchDoc> = {}): SearchDoc => ({ id, name, path: '', kind: 'text', tags: [], text: '', mtime: NOW - 400 * DAY, ...over });

const corpus: SearchDoc[] = [
  doc('a', 'crow_animation_v3.mp4', { kind: 'video', path: 'Crow Short Film / Animatic' }),
  doc('b', 'crow_script_01.md', { kind: 'markdown', path: 'Crow Short Film / Scripts', text: 'The crow lands on the wire at dusk' }),
  doc('c', 'receipt_03.pdf', { kind: 'pdf', path: 'Taxes & Admin / Receipts', tags: ['admin'] }),
  doc('d', 'night_static_mix_v2.wav', { kind: 'audio', path: 'Night Static (Band) / Mixes' }),
  doc('e', 'lyrics_04.md', { kind: 'markdown', path: 'Night Static (Band) / Lyrics', text: 'static on the line, the crow is calling' }),
  doc('f', 'moodboard_ref_07.png', { kind: 'image', path: 'Reference / Moodboards', tags: ['crow', 'reference'] }),
];

describe('tokenize', () => {
  it('splits separators, camelCase and digit boundaries', () => {
    expect(tokenize('crow_animation_v3.mp4')).toEqual(['crow', 'animation', 'v', '3', 'mp', '4']);
    expect(tokenize('NightStaticMix2')).toEqual(['night', 'static', 'mix', '2']);
  });
  it('parses kind and tag filters out of the query', () => {
    expect(parseQuery('crow kind:image tag:Reference')).toMatchObject({ terms: ['crow'], kind: 'image', tag: 'reference' });
  });
});

describe('SearchIndex', () => {
  const idx = new SearchIndex();
  idx.load(corpus);

  it('ranks name matches above content-only matches', () => {
    const hits = idx.search('crow', 10, NOW).map((h) => h.id);
    expect(hits.slice(0, 2).sort()).toEqual(['a', 'b']); // names with "crow"
    expect(hits).toContain('e'); // content mention
    expect(hits.indexOf('e')).toBeGreaterThan(hits.indexOf('a'));
    expect(hits).toContain('f'); // tag
  });
  it('finds by path, prefix, and tag', () => {
    expect(idx.search('receipts', 5, NOW)[0].id).toBe('c');
    expect(idx.search('anim', 5, NOW)[0].id).toBe('a');
    expect(idx.search('admin', 5, NOW)[0].id).toBe('c');
  });
  it('tolerates typos and joined words through trigram similarity', () => {
    expect(idx.search('crowanim', 5, NOW)[0].id).toBe('a');
    expect(idx.search('animtion', 5, NOW)[0].id).toBe('a');
    expect(idx.search('moodbord', 5, NOW)[0].id).toBe('f');
  });
  it('filters by kind and returns nothing for gibberish', () => {
    expect(idx.search('crow kind:image', 10, NOW).map((h) => h.id)).toEqual(['f']);
    expect(idx.search('kind:audio', 10, NOW).map((h) => h.id)).toEqual(['d']);
    expect(idx.search('zzzzqqq', 10, NOW)).toEqual([]);
  });
  it('boosts recently changed files by 1.2x', () => {
    const i2 = new SearchIndex();
    i2.load([doc('old', 'crow plan'), doc('new', 'crow plan', { mtime: NOW - DAY })]);
    const [a, b] = i2.search('crow', 5, NOW);
    expect(a.id).toBe('new');
    expect(a.score / b.score).toBeCloseTo(1.2, 5);
  });
  it('updates incrementally', () => {
    const i3 = new SearchIndex();
    i3.load(corpus);
    i3.upsert(doc('g', 'crow_final_cut.mp4', { kind: 'video' }));
    expect(i3.search('final', 3, NOW)[0].id).toBe('g');
    i3.remove('g');
    expect(i3.search('final', 3, NOW)).toEqual([]);
    expect(i3.size).toBe(corpus.length);
  });
});
