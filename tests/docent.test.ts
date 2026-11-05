import { describe, expect, it } from 'vitest';
import { RuleProvider, sortItems, suggestThreadPairs, summarizeItems, type DocItem } from '../src/docent/rules-fallback';

const NOW = 1_800_000_000_000;
const DAY = 86400000;
const it_ = (id: string, name: string, over: Partial<DocItem> = {}): DocItem => ({ id, name, kind: 'image', size: 100, mtime: NOW - DAY, ...over });

describe('RuleProvider.interpret', () => {
  const p = new RuleProvider();
  it('maps phrasings to tool calls', () => {
    expect(p.interpret('sort this wall by color')).toEqual({ tool: 'arrange', wall: 'aimed', rule: 'color' });
    expect(p.interpret('Sort everything by date')).toEqual({ tool: 'arrange', wall: 'all', rule: 'date' });
    expect(p.interpret('arrange alphabetically')).toEqual({ tool: 'arrange', wall: 'all', rule: 'name' });
    expect(p.interpret('summarize this room')).toEqual({ tool: 'summarize' });
    expect(p.interpret('what is in here?')).toEqual({ tool: 'summarize' });
    expect(p.interpret('suggest some threads')).toEqual({ tool: 'suggestThreads' });
    expect(p.interpret('give me a tour')).toEqual({ tool: 'tour' });
    expect(p.interpret('tag these as film, draft and crow')).toEqual({ tool: 'tagItems', tags: ['film', 'draft', 'crow'], scope: 'aimed' });
    expect(p.interpret('find crow animation')).toEqual({ tool: 'search', query: 'crow animation' });
    expect(p.interpret('moodboard')).toEqual({ tool: 'search', query: 'moodboard' });
  });
  it('declines long unintelligible requests instead of guessing', () => {
    expect(p.interpret('please compose a symphony about the weather in my files tomorrow morning')).toBeNull();
    expect(p.interpret('   ')).toBeNull();
  });
});

describe('sortItems', () => {
  const items = [
    it_('c', 'c.png', { color: 0x2040ff, size: 5, mtime: NOW - 3 * DAY }),
    it_('a', 'a.png', { color: 0xff2020, size: 50, mtime: NOW - 1 * DAY }),
    it_('b', 'b10.png', { color: 0x20ff20, size: 20, mtime: NOW - 2 * DAY }),
    it_('b2', 'b2.png', { size: 20, mtime: NOW - 2 * DAY }), // no colour
    it_('g', 'g.png', { color: 0x808080, size: 1, mtime: NOW }),
  ];
  const ids = (r: 'color' | 'name' | 'date' | 'size' | 'kind') => sortItems(items, r).map((i) => i.id);
  it('sorts by colour wheel with greys first and uncoloured last', () => expect(ids('color')).toEqual(['g', 'a', 'b', 'c', 'b2']));
  it('sorts by natural name', () => expect(ids('name')).toEqual(['a', 'b2', 'b', 'c', 'g']));
  it('sorts by newest first, and biggest first', () => {
    expect(ids('date')[0]).toBe('g');
    expect(ids('size')[0]).toBe('a');
  });
  it('does not mutate its input and is stable on ties', () => {
    const before = items.map((i) => i.id);
    ids('size');
    expect(items.map((i) => i.id)).toEqual(before);
    expect(ids('size').slice(1, 3)).toEqual(['b2', 'b']); // equal sizes fall back to name order
  });
});

describe('summaries and thread suggestions', () => {
  it('summarizes counts, themes, recency and neglect', () => {
    const items = [it_('1', 'crow_sb_01.png'), it_('2', 'crow_sb_02.png'), it_('3', 'crow_script_01.md', { kind: 'markdown', mtime: NOW - 90 * DAY })];
    const s = summarizeItems('Storyboards', items, 140, NOW);
    expect(s).toContain('3 items');
    expect(s).toContain('2 images');
    expect(s).toContain('1 note');
    expect(s).toContain('crow');
    expect(s).toContain('140 days');
    expect(summarizeItems('Empty', [], null, NOW)).toContain('empty');
  });
  it('suggests related files across kinds, favouring shared numbers', () => {
    const items = [
      it_('sb', 'crow_sb_03.png'),
      it_('rd', 'crow_render_03.png'),
      it_('sc', 'crow_script_03.md', { kind: 'markdown' }),
      it_('x', 'invoice_2024.pdf', { kind: 'pdf' }),
    ];
    const r = suggestThreadPairs(items);
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((t) => t.a !== 'x' && t.b !== 'x')).toBe(true);
    expect(r[0].reason).toContain('crow');
    expect(r.some((t) => t.type === 'project')).toBe(true);
  });
});
