export interface TapEvent {
  x: number;
  y: number;
  /** Normalized device coordinates, -1..1, y up. */
  ndcX: number;
  ndcY: number;
  /** True when the tap came from a pointer that is not a touch (mouse/pen). */
  mouse: boolean;
}

interface Ptr {
  mode: 'stick' | 'look';
  sx: number;
  sy: number;
  lx: number;
  ly: number;
  t0: number;
  moved: number;
  touch: boolean;
  timer?: number;
  long?: boolean;
}

const STICK_RADIUS = 70;

/**
 * Touch, mouse and keyboard in one place. Left 40% of the screen on touch is a movement stick;
 * everything else drags to look; a short still press is a tap.
 */
export class Input {
  /** Strafe (+right) and forward (+ahead), each -1..1. */
  moveX = 0;
  moveY = 0;
  turn = 0;
  sprint = false;
  enabled = true;
  onLook: (dx: number, dy: number) => void = () => {};
  onTap: (e: TapEvent) => void = () => {};
  /** Right-click or long-press: the contextual hand action (pick up, place, drop). */
  onPrimary: (ndcX: number, ndcY: number, shift: boolean) => void = () => {};
  onKey: (key: string, e: KeyboardEvent) => void = () => {};

  private keys = new Set<string>();
  private ptrs = new Map<number, Ptr>();
  private stickBase: HTMLDivElement;
  private stickKnob: HTMLDivElement;

  constructor(private el: HTMLElement, ui: HTMLElement) {
    this.stickBase = document.createElement('div');
    this.stickBase.className = 'stick-base';
    this.stickKnob = document.createElement('div');
    this.stickKnob.className = 'stick-knob';
    this.stickBase.style.display = this.stickKnob.style.display = 'none';
    ui.append(this.stickBase, this.stickKnob);

    addEventListener('keydown', this.keyDown);
    addEventListener('keyup', this.keyUp);
    addEventListener('blur', () => this.keys.clear());
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.up);
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.enabled) this.onPrimary((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1, e.shiftKey);
    });
  }

  /** Call every frame to fold keys into the move vector. */
  poll() {
    let mx = 0, my = 0, tn = 0;
    if (this.enabled) {
      if (this.keys.has('w') || this.keys.has('arrowup')) my += 1;
      if (this.keys.has('s') || this.keys.has('arrowdown')) my -= 1;
      if (this.keys.has('d')) mx += 1;
      if (this.keys.has('a')) mx -= 1;
      if (this.keys.has('arrowright') || this.keys.has('e')) tn -= 0; // E is interact, not turn
      if (this.keys.has('arrowright')) tn -= 1;
      if (this.keys.has('arrowleft')) tn += 1;
    }
    this.sprint = this.keys.has('shift');
    this.turn = tn;
    const stick = this.stickVec();
    return { x: clamp(mx + stick.x), y: clamp(my + stick.y) };
  }

  private stickVec() {
    for (const p of this.ptrs.values()) {
      if (p.mode === 'stick') return { x: clamp((p.lx - p.sx) / STICK_RADIUS), y: clamp(-(p.ly - p.sy) / STICK_RADIUS) };
    }
    return { x: 0, y: 0 };
  }

  private typing(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  private keyDown = (e: KeyboardEvent) => {
    if (this.typing(e)) return;
    const k = e.key.toLowerCase();
    if (this.enabled && ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(k)) {
      this.keys.add(k);
      if (k.startsWith('arrow')) e.preventDefault();
    }
    if (!e.repeat) this.onKey(k, e);
  };
  private keyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase());
  };

  private down = (e: PointerEvent) => {
    if (!this.enabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.el.setPointerCapture(e.pointerId);
    const touch = e.pointerType === 'touch';
    const hasStick = [...this.ptrs.values()].some((p) => p.mode === 'stick');
    const mode = touch && !hasStick && e.clientX < innerWidth * 0.4 && e.clientY > innerHeight * 0.3 ? 'stick' : 'look';
    const ptr: Ptr = { mode, sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, t0: performance.now(), moved: 0, touch };
    this.ptrs.set(e.pointerId, ptr);
    if (mode === 'stick') this.showStick(e.clientX, e.clientY, e.clientX, e.clientY);
    else if (touch) {
      // long press on touch = the hand action
      ptr.timer = window.setTimeout(() => {
        if (this.ptrs.get(e.pointerId) === ptr && ptr.moved < 8) {
          ptr.long = true;
          this.onPrimary((ptr.lx / innerWidth) * 2 - 1, -(ptr.ly / innerHeight) * 2 + 1, false);
        }
      }, 500);
    }
  };

  private move = (e: PointerEvent) => {
    const p = this.ptrs.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.lx;
    const dy = e.clientY - p.ly;
    p.moved += Math.abs(dx) + Math.abs(dy);
    p.lx = e.clientX;
    p.ly = e.clientY;
    if (p.mode === 'look') this.onLook(dx, dy);
    else this.showStick(p.sx, p.sy, e.clientX, e.clientY);
  };

  private up = (e: PointerEvent) => {
    const p = this.ptrs.get(e.pointerId);
    if (!p) return;
    this.ptrs.delete(e.pointerId);
    clearTimeout(p.timer);
    if (p.mode === 'stick') this.hideStick();
    if (p.long) return;
    const dt = performance.now() - p.t0;
    if (p.moved < 8 && dt < 450 && e.type === 'pointerup') {
      this.onTap({ x: e.clientX, y: e.clientY, ndcX: (e.clientX / innerWidth) * 2 - 1, ndcY: -(e.clientY / innerHeight) * 2 + 1, mouse: !p.touch });
    }
  };

  private showStick(sx: number, sy: number, x: number, y: number) {
    const dx = clampLen(x - sx, STICK_RADIUS);
    const dy = clampLen(y - sy, STICK_RADIUS);
    this.stickBase.style.display = this.stickKnob.style.display = 'block';
    this.stickBase.style.left = `${sx}px`;
    this.stickBase.style.top = `${sy}px`;
    this.stickKnob.style.left = `${sx + dx}px`;
    this.stickKnob.style.top = `${sy + dy}px`;
  }
  private hideStick() {
    this.stickBase.style.display = this.stickKnob.style.display = 'none';
  }

  /** Drop all held input (used when a modal view takes over). */
  reset() {
    this.keys.clear();
    this.ptrs.clear();
    this.hideStick();
  }
}

const clamp = (n: number) => Math.max(-1, Math.min(1, n));
const clampLen = (n: number, m: number) => Math.max(-m, Math.min(m, n));
