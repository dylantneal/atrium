export type Tier = 'low' | 'medium' | 'high';

export interface TierSettings {
  /** Upper bound of the render resolution scale. */
  maxScale: number;
  anisotropy: number;
  /** 0..1 multiplier for prop density (dust motes, cobwebs, small decor). */
  props: number;
  textureTier: 1 | 2 | 3;
}

export const TIERS: Record<Tier, TierSettings> = {
  low: { maxScale: 0.7, anisotropy: 1, props: 0.3, textureTier: 1 },
  medium: { maxScale: 0.85, anisotropy: 2, props: 0.7, textureTier: 2 },
  high: { maxScale: 1, anisotropy: 4, props: 1, textureTier: 3 },
};

/**
 * Adaptive resolution. Steps the render scale down after sustained slow frames
 * (30 frames over 40 ms) and back up after a long stretch of fast ones.
 * Pure so it can be unit tested without a GPU.
 */
export class ScaleController {
  scale: number;
  private slow = 0;
  private fast = 0;
  constructor(
    private min = 0.6,
    public max = 1,
    private step = 0.1,
  ) {
    this.scale = max;
  }

  setMax(max: number) {
    this.max = max;
    this.scale = Math.min(this.scale, max);
  }

  /** Returns the new scale if it changed, else null. */
  frame(ms: number): number | null {
    if (ms > 40) {
      this.slow++;
      this.fast = 0;
    } else if (ms < 20) {
      this.fast++;
      this.slow = 0;
    } else {
      this.slow = 0;
      this.fast = 0;
    }
    if (this.slow >= 30 && this.scale > this.min + 1e-6) {
      this.slow = 0;
      this.scale = Math.max(this.min, round(this.scale - this.step));
      return this.scale;
    }
    if (this.fast >= 180 && this.scale < this.max - 1e-6) {
      this.fast = 0;
      this.scale = Math.min(this.max, round(this.scale + this.step));
      return this.scale;
    }
    return null;
  }
}

const round = (n: number) => Math.round(n * 100) / 100;
