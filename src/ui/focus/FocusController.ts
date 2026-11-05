import type { ActionBus } from '../../core/actions';
import { recordOpen } from '../../core/commands';
import { ui } from '../../core/uiState';
import type { Id } from '../../data/schema';
import type { VFS } from '../../vfs/vfs';
import type { Session } from '../../world/session';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Flat focus mode: fly the camera to the item, cross-fade to a DOM viewer, pause the 3D loop.
 * Closing flies back to exactly where the player stood.
 */
export class FocusController {
  private saved: { pos: import('three').Vector3; quat: import('three').Quaternion } | null = null;
  private flushers = new Set<() => Promise<void>>();
  private busy = false;

  constructor(
    readonly session: Session,
    readonly vfs: VFS,
    readonly bus: ActionBus,
  ) {
    session.onItemActivate = (id) => void this.open(id);
  }

  get isOpen() {
    return ui.get().focus !== null;
  }

  /** Editors register a function that saves pending changes. */
  registerFlush(fn: () => Promise<void>) {
    this.flushers.add(fn);
    return () => this.flushers.delete(fn);
  }

  async flush() {
    await Promise.all([...this.flushers].map((f) => f()));
  }

  async open(id: Id) {
    if (this.busy) return;
    if (this.isOpen) return this.show(id);
    this.busy = true;
    try {
      const s = this.session;
      s.input.reset();
      s.input.enabled = false;
      this.saved = s.playerPose();
      const pose = s.framePoseFor(id);
      if (pose && !reduced()) await s.flyTo(pose.pos, pose.quat, 300);
      s.paused = true;
      ui.set({ focus: { id }, aim: null });
      s.world.setPaused(true);
      void recordOpen(id).then(() => this.session.refreshActivitySoon());
      this.session.events.emit('focus');
    } finally {
      this.busy = false;
    }
  }

  /** Switch the open viewer to another item without leaving focus mode. */
  async show(id: Id) {
    await this.flush();
    ui.set({ focus: { id } });
    void recordOpen(id);
  }

  async step(dir: 1 | -1) {
    const cur = ui.get().focus?.id;
    const order = this.session.view?.itemOrder() ?? [];
    if (!cur || order.length === 0) return;
    const i = order.indexOf(cur);
    const next = order[(i + dir + order.length) % order.length];
    if (next && next !== cur) await this.show(next);
  }

  async close() {
    if (this.busy || !this.isOpen) return;
    this.busy = true;
    try {
      await this.flush();
      const s = this.session;
      ui.set({ focus: null });
      s.world.setPaused(false);
      if (this.saved && !reduced()) await s.flyTo(this.saved.pos, this.saved.quat, 250);
      s.paused = false;
      s.input.enabled = true;
      this.saved = null;
      s.world.canvas.focus();
    } finally {
      this.busy = false;
    }
  }
}
