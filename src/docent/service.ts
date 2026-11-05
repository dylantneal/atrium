import { createStore } from '../core/store';
import { rearrangeCmd } from '../core/handCommands';
import { setTagsCmd } from '../core/commands';
import { ui } from '../core/uiState';
import { putThread } from '../data/idb';
import type { Id, Side } from '../data/schema';
import { uuid } from '../util/hash';
import type { Session } from '../world/session';
import type { DocentProvider, Proposal, SortRule, ToolCall } from './provider';
import { HELP, RuleProvider, sortItems, suggestThreadPairs, summarizeItems, type DocItem } from './rules-fallback';

export interface Message {
  id: number;
  role: 'user' | 'docent';
  text: string;
  proposal?: { title: string; lines: string[]; status: 'pending' | 'applied' | 'cancelled' };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The docent: understands a request, runs a typed tool, and answers. It proposes and the user confirms:
 * anything that moves, retags or re-hangs files is shown as a preview first and is undoable.
 */
export class DocentService {
  readonly store = createStore<{ messages: Message[]; touring: boolean }>({ messages: [], touring: false });
  private next = 1;
  private proposals = new Map<number, Proposal>();
  private abortTour = false;

  constructor(
    private session: Session,
    readonly provider: DocentProvider = new RuleProvider(),
  ) {}

  private post(m: Omit<Message, 'id'>): number {
    const id = this.next++;
    this.store.set((s) => ({ messages: [...s.messages, { ...m, id }] }));
    return id;
  }

  async ask(text: string) {
    const t = text.trim();
    if (!t) return;
    this.post({ role: 'user', text: t });
    const call = this.provider.interpret(t);
    if (!call) return void this.post({ role: 'docent', text: `I did not understand that. ${HELP}` });
    try {
      await this.run(call);
    } catch (e) {
      this.post({ role: 'docent', text: `Something went wrong: ${e instanceof Error ? e.message : e}` });
    }
  }

  private reply(text: string, proposal?: Proposal) {
    const id = this.post({ role: 'docent', text, proposal: proposal ? { title: proposal.title, lines: proposal.lines, status: 'pending' } : undefined });
    if (proposal) this.proposals.set(id, proposal);
  }

  async confirm(id: number, ok: boolean) {
    const p = this.proposals.get(id);
    if (!p) return;
    this.proposals.delete(id);
    const setStatus = (status: 'applied' | 'cancelled') =>
      this.store.set((s) => ({ messages: s.messages.map((m) => (m.id === id && m.proposal ? { ...m, proposal: { ...m.proposal, status } } : m)) }));
    if (!ok) return setStatus('cancelled');
    try {
      await p.apply();
      setStatus('applied');
    } catch (e) {
      this.post({ role: 'docent', text: `That did not work: ${e instanceof Error ? e.message : e}` });
    }
  }

  private docItems(): DocItem[] {
    return [...this.session.items.values()].map((i) => ({ id: i.id, name: i.name, kind: i.kind, size: i.size, mtime: i.mtime, color: i.color }));
  }

  private async run(call: ToolCall) {
    const s = this.session;
    switch (call.tool) {
      case 'search': {
        const ok = await s.enterSearch(call.query);
        this.reply(ok ? `Here are the results for "${call.query}", laid out as a room. Keep it if you want to come back.` : `I found nothing for "${call.query}".`);
        return;
      }
      case 'summarize': {
        const name = s.view?.room.title ?? 'This room';
        this.reply(summarizeItems(name, this.docItems(), s.activity.get(s.currentId)?.idleDays ?? null));
        return;
      }
      case 'arrange':
        return this.arrange(call.wall, call.rule);
      case 'suggestThreads':
        return this.threads();
      case 'tagItems':
        return this.tag(call.tags, call.scope);
      case 'tour':
        return void this.tour();
    }
  }

  private arrange(wall: Side | 'aimed' | 'all', rule: SortRule) {
    const s = this.session;
    const room = s.view?.room;
    if (!room) return;
    let sides: Side[] = room.walls.map((w) => w.side);
    if (wall === 'aimed') {
      const aimed = s.aimedSide();
      if (!aimed) return void this.reply('Look at a wall first (point the crosshair at it), or say "sort everything by color".');
      sides = [aimed];
    }
    const byId = new Map(this.docItems().map((i) => [i.id, i]));
    const next: Partial<Record<Side, (Id | null)[]>> = {};
    const lines: string[] = [];
    let moved = 0;
    let uncolored = 0;
    for (const side of sides) {
      const w = room.walls.find((x) => x.side === side)!;
      const occupied = w.slots.filter((x) => x.itemId && byId.has(x.itemId));
      if (occupied.length < 2) continue;
      const sorted = sortItems(occupied.map((x) => byId.get(x.itemId!)!), rule);
      if (rule === 'color') uncolored += sorted.filter((x) => x.color === undefined).length;
      const ids = w.slots.map((x) => x.itemId);
      occupied.forEach((slot, i) => {
        if (ids[slot.index] !== sorted[i].id) moved++;
        ids[slot.index] = sorted[i].id;
      });
      next[side] = ids;
      lines.push(`${side} wall: ${sorted.slice(0, 6).map((x) => x.name).join(', ')}${sorted.length > 6 ? ', …' : ''}`);
    }
    if (moved === 0) return void this.reply(`Already in that order. Nothing to change.`);
    const label = `Sorted ${wall === 'all' ? 'the room' : `the ${sides[0]} wall`} by ${rule}`;
    const note = rule === 'color' && uncolored ? ` (${uncolored} item${uncolored === 1 ? ' has' : 's have'} no colour yet and go last.)` : '';
    this.reply(`I would re-hang ${moved} item${moved === 1 ? '' : 's'}${note} Nothing moves until you apply it.`, {
      title: label,
      lines,
      apply: async () => void (await s.bus.dispatch(rearrangeCmd(s.handCtx, room.id, label, next))),
    });
  }

  private threads() {
    const items = this.docItems();
    const pairs = suggestThreadPairs(items);
    if (pairs.length === 0) return void this.reply('I do not see related files here yet. Threads need shared names or numbers, like crow_sb_03 and crow_render_03.');
    const name = (id: Id) => items.find((i) => i.id === id)?.name ?? id;
    this.reply(`I found ${pairs.length} pair${pairs.length === 1 ? '' : 's'} that look related. Saving them stores the links; strings between items are drawn in a later milestone.`, {
      title: `Save ${pairs.length} thread${pairs.length === 1 ? '' : 's'}`,
      lines: pairs.map((p) => `${name(p.a)} ↔ ${name(p.b)}: ${p.reason}`),
      apply: async () => {
        for (const p of pairs) await putThread({ id: uuid(), a: p.a, b: p.b, type: p.type, note: p.reason });
        this.session.bus.toast(`Saved ${pairs.length} thread${pairs.length === 1 ? '' : 's'}`);
      },
    });
  }

  private tag(tags: string[], scope: 'aimed' | 'room') {
    const s = this.session;
    const room = s.view?.room;
    if (!room) return;
    let ids: Id[];
    if (scope === 'aimed') {
      const side = s.aimedSide();
      ids = side ? room.walls.find((w) => w.side === side)!.slots.map((x) => x.itemId).filter((x): x is Id => !!x && s.items.has(x)) : [];
      if (!side) return void this.reply('Point the crosshair at a wall first, or say "tag everything as …".');
    } else ids = [...s.items.keys()];
    if (ids.length === 0) return void this.reply('There is nothing to tag here.');
    this.reply(`I would add ${tags.map((t) => `"${t}"`).join(', ')} to ${ids.length} item${ids.length === 1 ? '' : 's'}.`, {
      title: `Tag ${ids.length} item${ids.length === 1 ? '' : 's'}`,
      lines: ids.slice(0, 8).map((id) => `${s.items.get(id)!.name} → ${[...new Set([...(s.items.get(id)!.tags ?? []), ...tags])].join(', ')}`).concat(ids.length > 8 ? [`… and ${ids.length - 8} more`] : []),
      apply: async () => {
        for (const id of ids) {
          const merged = [...new Set([...(s.items.get(id)!.tags ?? []), ...tags])];
          await s.bus.dispatch(setTagsCmd(s.vfs, id, merged), { toast: false });
        }
        s.bus.toast(`Tagged ${ids.length} item${ids.length === 1 ? '' : 's'}. Undo to revert each.`);
      },
    });
  }

  /** A guided walk: Home, then each top-level room, with a caption for each. Stops on request. */
  async tour() {
    if (this.store.get().touring) return;
    const s = this.session;
    const root = s.vfs.rootId;
    const rooms = (await s.vfs.list(root)).filter((n) => n.kind === 'folder');
    this.abortTour = false;
    this.store.set({ touring: true });
    this.reply(`Starting a tour of ${rooms.length} rooms. Press Stop at any time.`);
    const all = await s.vfs.all();
    const subtree = (id: Id): DocItem[] => {
      const out: DocItem[] = [];
      const stack = [id];
      while (stack.length) {
        const cur = stack.pop()!;
        for (const n of all.filter((x) => x.parent === cur)) {
          if (n.kind === 'folder') stack.push(n.id);
          else out.push({ id: n.id, name: n.name, kind: n.kind, size: n.size, mtime: n.mtime, color: n.color });
        }
      }
      return out;
    };
    try {
      await s.enter(root, null, false);
      ui.set({ caption: 'Home: every folder in the building is a door.' });
      await this.wait(3500);
      for (const r of rooms) {
        if (this.abortTour) break;
        await s.enter(r.id, root, false);
        ui.set({ caption: summarizeItems(r.name, subtree(r.id), s.activity.get(r.id)?.idleDays ?? null) });
        await this.wait(5000);
      }
    } finally {
      ui.set({ caption: null });
      this.store.set({ touring: false });
      if (!this.abortTour) await s.enter(root, null, false);
      this.post({ role: 'docent', text: this.abortTour ? 'Tour stopped.' : 'That is the building. Ask me to sort a wall, summarize a room, or find something.' });
    }
  }

  stopTour() {
    this.abortTour = true;
  }

  private async wait(ms: number) {
    const end = Date.now() + ms;
    while (Date.now() < end && !this.abortTour) await sleep(100);
  }
}
