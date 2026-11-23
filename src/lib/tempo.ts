export interface TempoCfg {
  bpmStart: number;
  bpmTarget: number;
  bpmEnd: number;
  warmEnd: number; // beat
  coolStart: number; // beat
  end: number; // beat
  shape: "linear" | "ease";
}

const shapeFn = (shape: "linear" | "ease", x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return shape === "ease" ? c * c * (3 - 2 * c) : c;
};

/** Карта темпа: BPM как функция музыкальной доли микса. Время = ∫ 60/BPM db. */
export class TempoMap {
  cfg: TempoCfg;
  private cum: Float64Array;
  private maxBeat: number;

  constructor(cfg: TempoCfg) {
    this.cfg = cfg;
    this.maxBeat = Math.ceil(cfg.end) + 512;
    this.cum = new Float64Array(this.maxBeat + 1);
    const sub = 4;
    for (let i = 0; i < this.maxBeat; i++) {
      let t = 0;
      for (let s = 0; s < sub; s++) t += 60 / this.bpmAtBeat(i + (s + 0.5) / sub) / sub;
      this.cum[i + 1] = this.cum[i] + t;
    }
  }

  bpmAtBeat(b: number): number {
    const c = this.cfg;
    if (b >= c.end) return c.bpmEnd;
    if (b < c.warmEnd && c.warmEnd > 0) return c.bpmStart + (c.bpmTarget - c.bpmStart) * shapeFn(c.shape, b / c.warmEnd);
    if (b >= c.coolStart && c.end > c.coolStart)
      return c.bpmTarget + (c.bpmEnd - c.bpmTarget) * shapeFn(c.shape, (b - c.coolStart) / (c.end - c.coolStart));
    return c.bpmTarget;
  }

  timeAtBeat(b: number): number {
    if (b <= 0) return (b * 60) / this.bpmAtBeat(0);
    if (b >= this.maxBeat) return this.cum[this.maxBeat] + ((b - this.maxBeat) * 60) / this.bpmAtBeat(this.maxBeat);
    const i = Math.floor(b);
    return this.cum[i] + (b - i) * (this.cum[i + 1] - this.cum[i]);
  }

  beatAtTime(t: number): number {
    if (t <= 0) return (t * this.bpmAtBeat(0)) / 60;
    const last = this.cum[this.maxBeat];
    if (t >= last) return this.maxBeat + ((t - last) * this.bpmAtBeat(this.maxBeat)) / 60;
    let lo = 0;
    let hi = this.maxBeat;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= t) lo = mid;
      else hi = mid;
    }
    return lo + (t - this.cum[lo]) / (this.cum[lo + 1] - this.cum[lo]);
  }
}

/** Количество долей на отрезке с линейным по долям изменением BPM за заданное время. */
export function beatsForRamp(minutes: number, t0: number, t1: number): number {
  if (minutes <= 0) return 0;
  if (Math.abs(t1 - t0) < 0.01) return minutes * t0;
  return (minutes * (t1 - t0)) / Math.log(t1 / t0);
}
