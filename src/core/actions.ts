import type { Command } from './undo';
import { UndoStack } from './undo';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
  /** When set, the toast offers Undo for the command that produced it. */
  undoable: boolean;
  expires: number;
}

/**
 * Every state change goes through `dispatch`. World and UI never mutate files or data directly;
 * they build a Command (which carries its own reverse) and hand it here.
 */
export class ActionBus {
  readonly undoStack = new UndoStack(50);
  private toasts: Toast[] = [];
  private toastListeners = new Set<(t: Toast[]) => void>();
  private nextToast = 1;
  private busy: Promise<unknown> = Promise.resolve();

  /** Commands run one at a time so concurrent taps cannot interleave file operations. */
  dispatch(cmd: Command, opts: { toast?: boolean } = {}): Promise<boolean> {
    const result = this.busy.then(async () => {
      try {
        await cmd.run();
        this.undoStack.push(cmd);
        if (opts.toast !== false) this.pushToast({ text: cmd.label, kind: 'info', undoable: true, ttl: 8000 });
        return true;
      } catch (e) {
        this.pushToast({ text: errorText(cmd.label, e), kind: 'error', undoable: false, ttl: 6000 });
        return false;
      }
    });
    this.busy = result.catch(() => undefined);
    return result;
  }

  undo(): Promise<boolean> {
    const result = this.busy.then(async () => {
      const label = this.undoStack.lastLabel;
      try {
        const ok = await this.undoStack.undo();
        if (ok) this.pushToast({ text: `Undid: ${label}`, kind: 'info', undoable: false, ttl: 3000 });
        return ok;
      } catch (e) {
        this.pushToast({ text: errorText('Undo', e), kind: 'error', undoable: false, ttl: 6000 });
        return false;
      }
    });
    this.busy = result.catch(() => undefined);
    return result;
  }

  redo(): Promise<boolean> {
    const result = this.busy.then(() => this.undoStack.redo().catch(() => false));
    this.busy = result.catch(() => undefined);
    return result;
  }

  get currentToasts() {
    return this.toasts;
  }

  onToasts(l: (t: Toast[]) => void) {
    this.toastListeners.add(l);
    return () => this.toastListeners.delete(l);
  }

  dismissToast(id: number) {
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.emitToasts();
  }

  toast(text: string, kind: 'info' | 'error' = 'info') {
    this.pushToast({ text, kind, undoable: false, ttl: kind === 'error' ? 6000 : 3000 });
  }

  private pushToast(t: { text: string; kind: 'info' | 'error'; undoable: boolean; ttl: number }) {
    const toast: Toast = { id: this.nextToast++, text: t.text, kind: t.kind, undoable: t.undoable, expires: Date.now() + t.ttl };
    this.toasts = [...this.toasts.filter((x) => x.expires > Date.now()), toast].slice(-4);
    this.emitToasts();
    setTimeout(() => this.dismissToast(toast.id), t.ttl);
  }

  private emitToasts() {
    for (const l of [...this.toastListeners]) l(this.toasts);
  }
}

function errorText(label: string, e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return `${label} failed: ${msg}`;
}
