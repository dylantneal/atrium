/** Tiny typed event emitter (used by onboarding to watch what the player does). */
export class Emitter<E extends string> {
  private subs = new Map<E, Set<() => void>>();
  on(type: E, cb: () => void): () => void {
    const set = this.subs.get(type) ?? new Set();
    set.add(cb);
    this.subs.set(type, set);
    return () => set.delete(cb);
  }
  emit(type: E) {
    for (const cb of [...(this.subs.get(type) ?? [])]) cb();
  }
}

export type GameEvent = 'navigated' | 'pickup' | 'placed' | 'focus' | 'search' | 'live';
