import { describe, expect, it } from 'vitest';
import { ActionBus } from '../src/core/actions';
import { createStore } from '../src/core/store';
import type { Command } from '../src/core/undo';
import { UndoStack } from '../src/core/undo';

function counterCmd(state: { n: number }, by: number): Command {
  return {
    label: `add ${by}`,
    run: async () => void (state.n += by),
    undo: async () => void (state.n -= by),
  };
}

describe('store', () => {
  it('notifies with next and prev, and skips no-op sets', () => {
    const s = createStore({ a: 1, b: 2 });
    const calls: [number, number][] = [];
    s.subscribe((n, p) => calls.push([n.a, p.a]));
    s.set({ a: 2 });
    s.set({ a: 2 });
    s.set((st) => ({ a: st.a + 1 }));
    expect(calls).toEqual([[2, 1], [3, 2]]);
  });
});

describe('undo stack', () => {
  it('undoes and redoes in order, and clears redo on new push', async () => {
    const st = { n: 0 };
    const u = new UndoStack();
    for (const c of [counterCmd(st, 1), counterCmd(st, 10)]) {
      await c.run();
      u.push(c);
    }
    expect(st.n).toBe(11);
    await u.undo();
    expect(st.n).toBe(1);
    await u.redo();
    expect(st.n).toBe(11);
    await u.undo();
    const c = counterCmd(st, 100);
    await c.run();
    u.push(c);
    expect(u.canRedo).toBe(false);
  });

  it('caps history at 50', async () => {
    const u = new UndoStack(50);
    const st = { n: 0 };
    for (let i = 0; i < 60; i++) u.push(counterCmd(st, 1));
    expect(u.size).toBe(50);
  });
});

describe('action bus', () => {
  it('serializes commands and records only successes', async () => {
    const bus = new ActionBus();
    const order: string[] = [];
    const slow: Command = { label: 'slow', run: async () => { await new Promise((r) => setTimeout(r, 20)); order.push('slow'); }, undo: async () => {} };
    const fast: Command = { label: 'fast', run: async () => void order.push('fast'), undo: async () => {} };
    const bad: Command = { label: 'bad', run: async () => { throw new Error('nope'); }, undo: async () => {} };
    const results = await Promise.all([bus.dispatch(slow), bus.dispatch(fast), bus.dispatch(bad)]);
    expect(order).toEqual(['slow', 'fast']);
    expect(results).toEqual([true, true, false]);
    expect(bus.undoStack.size).toBe(2);
    expect(bus.currentToasts.some((t) => t.kind === 'error' && t.text.includes('nope'))).toBe(true);
  });

  it('undo reverses the last command', async () => {
    const bus = new ActionBus();
    const st = { n: 0 };
    await bus.dispatch(counterCmd(st, 5));
    await bus.undo();
    expect(st.n).toBe(0);
  });
});
