/** A reversible unit of work. `run` does it, `undo` reverses it exactly. */
export interface Command {
  label: string;
  run(): Promise<void>;
  undo(): Promise<void>;
}

export class UndoStack {
  private done: Command[] = [];
  private undone: Command[] = [];
  private listeners = new Set<() => void>();
  constructor(private cap = 50) {}

  push(cmd: Command) {
    this.done.push(cmd);
    if (this.done.length > this.cap) this.done.shift();
    this.undone.length = 0;
    this.emit();
  }

  get canUndo() {
    return this.done.length > 0;
  }
  get canRedo() {
    return this.undone.length > 0;
  }
  get size() {
    return this.done.length;
  }
  get lastLabel(): string | null {
    return this.done.at(-1)?.label ?? null;
  }

  async undo(): Promise<boolean> {
    const cmd = this.done.pop();
    if (!cmd) return false;
    try {
      await cmd.undo();
    } catch (e) {
      this.done.push(cmd);
      throw e;
    }
    this.undone.push(cmd);
    this.emit();
    return true;
  }

  async redo(): Promise<boolean> {
    const cmd = this.undone.pop();
    if (!cmd) return false;
    try {
      await cmd.run();
    } catch (e) {
      this.undone.push(cmd);
      throw e;
    }
    this.done.push(cmd);
    this.emit();
    return true;
  }

  subscribe(l: () => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emit() {
    for (const l of [...this.listeners]) l();
  }
}
