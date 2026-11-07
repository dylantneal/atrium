import { getSetting, setSetting } from '../data/idb';

/**
 * Minimal sound: a rain bed whose loudness follows the weather. Browsers only allow audio after a user gesture,
 * so nothing starts until `unlock()` is called from the Enter button. `rainLevel` is the requested level whether or
 * not the audio context exists, so tests and the UI can read it without sound hardware.
 */
export class AudioService {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private _rain = 0;
  private _enabled = true;

  get rainLevel() {
    return this._rain;
  }
  get enabled() {
    return this._enabled;
  }
  get running() {
    return this.ctx?.state === 'running';
  }

  async load() {
    this._enabled = (await getSetting<boolean>('sound')) ?? true;
  }

  async setEnabled(on: boolean) {
    this._enabled = on;
    await setSetting('sound', on);
    this.apply();
  }

  unlock() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    void this.ctx.resume();
    // brown-ish noise through a band filter reads as steady rain on glass
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.04 * white) / 1.04;
      d[i] = last * 3.2 + white * 0.25;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = 'bandpass';
    this.filter.frequency.value = 2400;
    this.filter.Q.value = 0.5;
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;
    src.connect(this.filter).connect(this.gain).connect(this.ctx.destination);
    src.start();
    this.apply();
  }

  /** 0 for no rain up to 1 for a downpour. Snow and fog are quiet. */
  setRain(level: number) {
    this._rain = Math.min(1, Math.max(0, level));
    this.apply();
  }

  private apply() {
    if (!this.ctx || !this.gain) return;
    const target = this._enabled ? this._rain * 0.22 : 0;
    this.gain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.6);
  }
}
