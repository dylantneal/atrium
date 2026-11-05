import { getInventory, putInventory } from '../data/idb';
import { INVENTORY_SLOTS, type Id } from '../data/schema';
import { createStore, type Store } from './store';

export interface InvState {
  slots: (Id | null)[];
  selected: number;
  /** When on, placing copies instead of moves. */
  copy: boolean;
}

/** The hotbar: eight slots of item references. The files themselves never move until you place them. */
export class Inventory {
  readonly store: Store<InvState> = createStore<InvState>({ slots: Array<Id | null>(INVENTORY_SLOTS).fill(null), selected: 0, copy: false });

  async load(exists: (id: Id) => Promise<boolean>) {
    const inv = await getInventory();
    const slots = await Promise.all(inv.slots.map(async (id) => (id && (await exists(id)) ? id : null)));
    this.store.set({ slots });
  }

  get slots() {
    return this.store.get().slots;
  }
  get selectedId(): Id | null {
    const s = this.store.get();
    return s.slots[s.selected] ?? null;
  }
  has(id: Id) {
    return this.slots.includes(id);
  }
  get heldIds(): Set<Id> {
    return new Set(this.slots.filter((x): x is Id => !!x));
  }
  get isFull() {
    return this.slots.every(Boolean);
  }

  /** Adds to the first free slot and selects it. Returns false when full. */
  pickUp(id: Id): boolean {
    if (this.has(id)) {
      this.store.set({ selected: this.slots.indexOf(id) });
      return true;
    }
    const i = this.slots.findIndex((s) => !s);
    if (i < 0) return false;
    const slots = [...this.slots];
    slots[i] = id;
    this.store.set({ slots, selected: i });
    void this.persist();
    return true;
  }

  remove(id: Id) {
    const i = this.slots.indexOf(id);
    if (i < 0) return;
    const slots = [...this.slots];
    slots[i] = null;
    this.store.set({ slots });
    void this.persist();
  }

  select(i: number) {
    if (i >= 0 && i < INVENTORY_SLOTS) this.store.set({ selected: i });
  }

  toggleCopy() {
    this.store.set((s) => ({ copy: !s.copy }));
  }

  private saving: Promise<void> = Promise.resolve();

  /** Writes are chained so the last state always wins, even when picks come in quick succession. */
  private persist() {
    const snapshot = [...this.slots];
    this.saving = this.saving.then(() => putInventory({ slots: snapshot })).catch(() => undefined);
    return this.saving;
  }

  /** Resolves when every pending write has landed (call before navigating away or in tests). */
  flush(): Promise<void> {
    return this.saving;
  }
}
