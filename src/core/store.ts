export type Listener<S> = (state: S, prev: S) => void;

export interface Store<S> {
  get(): S;
  set(patch: Partial<S> | ((s: S) => Partial<S>)): void;
  subscribe(l: Listener<S>): () => void;
}

/** Minimal immutable-update store. Listeners get (next, prev) so consumers can diff cheaply. */
export function createStore<S extends object>(initial: S): Store<S> {
  let state = initial;
  const listeners = new Set<Listener<S>>();
  return {
    get: () => state,
    set(patch) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      const keys = Object.keys(p) as (keyof S)[];
      if (keys.every((k) => Object.is(state[k], p[k]))) return;
      const prev = state;
      state = { ...state, ...p };
      for (const l of [...listeners]) l(state, prev);
    },
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}
