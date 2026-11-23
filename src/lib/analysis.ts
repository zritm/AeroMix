import { keyName, keyToCamelot } from "./camelot";
import type { HotCue, Section, SectionType } from "./types";

export interface AnalysisResult {
  bpm: number;
  bpmConfidence: number;
  gridConfidence: number;
  firstDownbeat: number;
  totalBars: number;
  key: string;
  camelot: string;
  keyConfidence: number;
  energy: number;
  density: number;
  dryness: number;
  hasVocals: boolean;
  vocalConfidence: number;
  rmsDb: number;
  sections: Section[];
  waveform: number[];
  hot: HotCue[];
}

export type Progress = (p: number, label: string) => void;

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const db = (x: number) => 10 * Math.log10(x + 1e-12);
const FRAME = 1024;
const HOP = 128;
/** Смещение момента атаки относительно начала окна STFT (в сэмплах децимированного сигнала). */
const ONSET_OFFSET = 700;

function percentile(arr: ArrayLike<number>, p: number): number {
  const s = Array.from(arr).sort((a, b) => a - b);
  if (!s.length) return 0;
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
}

export class FFT {
  n: number;
  cos: Float64Array;
  sin: Float64Array;
  rev: Uint32Array;
  constructor(n: number) {
    this.n = n;
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      this.rev[i] = r;
    }
  }
  transform(re: Float64Array, im: Float64Array) {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const j = this.rev[i];
      if (j > i) {
        const tr = re[i];
        re[i] = re[j];
        re[j] = tr;
        const ti = im[i];
        im[i] = im[j];
        im[j] = ti;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0, t = 0; k < half; k++, t += step) {
          const a = start + k;
          const b = a + half;
          const wr = this.cos[t];
          const wi = -this.sin[t];
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
        }
      }
    }
  }
}

function decimate(x: Float32Array, f: number): Float32Array {
  if (f <= 1) return x;
  const n = Math.floor(x.length / f);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < f; j++) s += x[i * f + j];
    out[i] = s / f;
  }
  return out;
}

interface Feat {
  fps: number;
  fs: number;
  frames: number;
  rms: Float32Array;
  low: Float32Array;
  mid: Float32Array;
  high: Float32Array;
  all: Float32Array;
  peak: Float32Array;
  flux: Float32Array;
  fluxLow: Float32Array;
}

async function computeFeatures(d: Float32Array, fs: number, onP: (p: number) => void): Promise<Feat> {
  const N = FRAME;
  const bw = fs / N;
  const kL1 = Math.max(3, Math.round(150 / bw));
  const kM0 = Math.round(300 / bw);
  const kM1 = Math.round(3400 / bw);
  const kH0 = Math.round(2000 / bw);
  const kA1 = Math.min(N / 2 - 1, Math.round(5400 / bw));
  const frames = Math.max(0, Math.floor((d.length - N) / HOP) + 1);
  const fft = new FFT(N);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const mk = () => new Float32Array(frames);
  const F: Feat = { fps: fs / HOP, fs, frames, rms: mk(), low: mk(), mid: mk(), high: mk(), all: mk(), peak: mk(), flux: mk(), fluxLow: mk() };
  const prev = new Float64Array(N / 2);
  const mag = new Float64Array(N / 2);
  for (let f = 0; f < frames; f++) {
    const o = f * HOP;
    let pw = 0;
    for (let i = 0; i < N; i++) {
      const v = d[o + i];
      pw += v * v;
      re[i] = v * win[i];
      im[i] = 0;
    }
    fft.transform(re, im);
    for (let k = 0; k < N / 2; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    let low = 0;
    let mid = 0;
    let high = 0;
    let all = 0;
    let flux = 0;
    let fluxLow = 0;
    for (let k = 1; k <= kA1; k++) {
      const e = mag[k] * mag[k];
      all += e;
      if (k <= kL1) low += e;
      if (k >= kM0 && k <= kM1) mid += e;
      if (k >= kH0) high += e;
      const lg = Math.log1p(mag[k]);
      const df = lg - prev[k];
      if (df > 0) {
        flux += df;
        if (k <= kL1) fluxLow += df;
      }
      prev[k] = lg;
    }
    // тональная («пиковая») энергия средней полосы — прокси вокала/мелодики
    let peak = 0;
    for (let k = kM0; k <= kM1; k++) {
      let s = 0;
      for (let j = -5; j <= 5; j++) s += mag[k + j];
      const loc = s / 11;
      if (mag[k] > 2.2 * loc && mag[k] >= mag[k - 1] && mag[k] >= mag[k + 1]) peak += mag[k] * mag[k];
    }
    F.rms[f] = pw / N;
    F.low[f] = low;
    F.mid[f] = mid;
    F.high[f] = high;
    F.all[f] = all;
    F.peak[f] = peak;
    F.flux[f] = flux;
    F.fluxLow[f] = fluxLow;
    if (f % 3000 === 0) {
      onP(f / frames);
      await tick();
    }
  }
  return F;
}

function mean(a: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return a.length ? s / a.length : 0;
}

function onsetEnvelope(F: Feat): Float32Array {
  const ma = mean(F.flux) + 1e-9;
  const ml = mean(F.fluxLow) + 1e-9;
  const raw = new Float32Array(F.frames);
  for (let i = 0; i < F.frames; i++) raw[i] = F.flux[i] / ma + F.fluxLow[i] / ml;
  // вычитаем локальное среднее (~1 c), оставляем положительную часть
  const w = Math.round(F.fps);
  const out = new Float32Array(F.frames);
  let acc = 0;
  const pre = new Float64Array(F.frames + 1);
  for (let i = 0; i < F.frames; i++) {
    acc += raw[i];
    pre[i + 1] = acc;
  }
  for (let i = 0; i < F.frames; i++) {
    const a = Math.max(0, i - w);
    const b = Math.min(F.frames, i + w + 1);
    const loc = (pre[b] - pre[a]) / (b - a);
    out[i] = Math.max(0, raw[i] - loc);
  }
  return out;
}

function estimateTempo(env: Float32Array, fps: number): { bpm: number; conf: number } {
  const n = env.length;
  const maxLag = Math.ceil((4 * fps * 60) / 70) + 2;
  const ac = new Float64Array(maxLag + 2);
  for (let lag = 0; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += env[i] * env[i + lag];
    ac[lag] = s / Math.max(1, n - lag);
  }
  const a0 = ac[0] + 1e-12;
  const getAc = (L: number) => {
    if (L >= maxLag) return 0;
    const i = Math.floor(L);
    const fr = L - i;
    return (ac[i] * (1 - fr) + ac[i + 1] * fr) / a0;
  };
  const scores: number[] = [];
  let best = -1;
  let bestBpm = 120;
  for (let bpm = 70; bpm <= 180; bpm += 0.25) {
    const L = (fps * 60) / bpm;
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 122) / 0.7, 2));
    const s = (getAc(L) + 0.5 * getAc(2 * L) + 0.25 * getAc(4 * L)) * prior;
    scores.push(s);
    if (s > best) {
      best = s;
      bestBpm = bpm;
    }
  }
  const med = percentile(scores, 0.5) + 1e-9;
  return { bpm: bestBpm, conf: clamp((best / med - 1) / 4) };
}

function gridSearch(env: Float32Array, fps: number, bpm: number, phases: number): { score: number; phase: number } {
  const P = (fps * 60) / bpm;
  let best = -1;
  let bp = 0;
  const n = env.length;
  for (let j = 0; j < phases; j++) {
    const ph = (j * P) / phases;
    let s = 0;
    let c = 0;
    for (let pos = ph; pos < n - 1; pos += P) {
      const i = Math.floor(pos);
      const fr = pos - i;
      s += env[i] * (1 - fr) + env[i + 1] * fr;
      c++;
    }
    s /= Math.max(1, c);
    if (s > best) {
      best = s;
      bp = ph;
    }
  }
  return { score: best, phase: bp };
}

function detectKey(d: Float32Array, fs: number): { pc: number; minor: boolean; conf: number } {
  const N = 8192;
  if (d.length < N * 2) return { pc: 0, minor: true, conf: 0 };
  const fft = new FFT(N);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const bw = fs / N;
  const k0 = Math.floor(80 / bw);
  const k1 = Math.ceil(2000 / bw);
  const chroma = new Float64Array(12);
  const count = 140;
  const span = d.length - N;
  const mag = new Float64Array(N / 2);
  for (let c = 0; c < count; c++) {
    const o = Math.floor(span * (0.05 + (0.9 * c) / count));
    for (let i = 0; i < N; i++) {
      re[i] = d[o + i] * win[i];
      im[i] = 0;
    }
    fft.transform(re, im);
    let sum = 0;
    for (let k = k0 - 1; k <= k1 + 1; k++) {
      mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      sum += mag[k];
    }
    const thr = (3 * sum) / (k1 - k0 + 3);
    const fr = new Float64Array(12);
    let fsum = 0;
    for (let k = k0; k <= k1; k++) {
      const m = mag[k];
      if (m > thr && m > mag[k - 1] && m >= mag[k + 1]) {
        const a = mag[k - 1];
        const cc = mag[k + 1];
        const den = a - 2 * m + cc;
        const delta = den !== 0 ? (0.5 * (a - cc)) / den : 0;
        const f = (k + delta) * bw;
        const pitch = 69 + 12 * Math.log2(f / 440);
        const pc = ((Math.round(pitch) % 12) + 12) % 12;
        fr[pc] += m;
        fsum += m;
      }
    }
    if (fsum > 0) for (let i = 0; i < 12; i++) chroma[i] += fr[i] / fsum;
  }
  const MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  const corr = (prof: number[], t: number) => {
    const xs: number[] = [];
    for (let i = 0; i < 12; i++) xs.push(chroma[(t + i) % 12]);
    const mx = mean(xs);
    const my = mean(prof);
    let num = 0;
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < 12; i++) {
      num += (xs[i] - mx) * (prof[i] - my);
      dx += (xs[i] - mx) ** 2;
      dy += (prof[i] - my) ** 2;
    }
    return num / Math.sqrt(dx * dy + 1e-12);
  };
  const cands: { pc: number; minor: boolean; r: number }[] = [];
  for (let t = 0; t < 12; t++) {
    cands.push({ pc: t, minor: false, r: corr(MAJ, t) });
    cands.push({ pc: t, minor: true, r: corr(MIN, t) });
  }
  cands.sort((a, b) => b.r - a.r);
  const conf = clamp(0.5 * clamp((cands[0].r - cands[1].r) / 0.12) + 0.5 * clamp(cands[0].r / 0.9));
  return { pc: cands[0].pc, minor: cands[0].minor, conf };
}

function buildSections(level: number[], vocalBar: boolean[], dryBar: boolean[], totalBars: number, trackEnergy: number): Section[] {
  const chunks = Math.max(1, Math.ceil(totalBars / 4));
  const lv: number[] = [];
  for (let c = 0; c < chunks; c++) {
    const a = c * 4;
    const b = Math.min(totalBars, a + 4);
    let s = 0;
    for (let i = a; i < b; i++) s += level[i];
    lv.push(s / Math.max(1, b - a));
  }
  const label = lv.map((v) => (v >= 0.58 ? 2 : v >= 0.38 ? 1 : 0));
  const segs: { type: SectionType; a: number; b: number }[] = [];
  const firstH = label.indexOf(2);
  const lastH = label.lastIndexOf(2);
  if (firstH < 0) {
    segs.push({ type: "main", a: 0, b: chunks });
  } else {
    if (firstH > 0) {
      let b = firstH;
      while (b > 0 && label[b - 1] === 1) b--;
      if (b > 0) {
        segs.push({ type: "intro", a: 0, b });
        if (b < firstH) segs.push({ type: "buildup", a: b, b: firstH });
      } else {
        const mid = Math.ceil(firstH / 2);
        segs.push({ type: "intro", a: 0, b: mid });
        if (mid < firstH) segs.push({ type: "buildup", a: mid, b: firstH });
      }
    }
    let i = firstH;
    while (i <= lastH) {
      if (label[i] === 2) {
        let j = i;
        while (j <= lastH && label[j] === 2) j++;
        segs.push({ type: "main", a: i, b: j });
        i = j;
      } else {
        let j = i;
        while (j <= lastH && label[j] !== 2) j++;
        if (j - i >= 2) {
          let bb = j;
          while (bb > i && label[bb - 1] === 1) bb--;
          if (bb > i) segs.push({ type: "breakdown", a: i, b: bb });
          if (bb < j) segs.push({ type: "buildup", a: bb, b: j });
        } else {
          segs.push({ type: "main", a: i, b: j });
        }
        i = j;
      }
    }
    if (lastH < chunks - 1) segs.push({ type: "outro", a: lastH + 1, b: chunks });
  }
  // слить соседние одинаковые
  const merged: typeof segs = [];
  for (const s of segs) {
    const l = merged[merged.length - 1];
    if (l && l.type === s.type) l.b = s.b;
    else merged.push({ ...s });
  }
  return merged.map((s) => {
    const startBar = s.a * 4;
    const endBar = Math.min(totalBars, s.b * 4);
    let e = 0;
    let v = 0;
    let dr = 0;
    const n = Math.max(1, endBar - startBar);
    for (let i = startBar; i < endBar; i++) {
      e += level[i];
      if (vocalBar[i]) v++;
      if (dryBar[i]) dr++;
    }
    return {
      type: s.type,
      startBar,
      endBar,
      energy: Math.round(clamp(trackEnergy * (0.4 + 0.6 * (e / n)), 0, 100)),
      vocal: v / n >= 0.5,
      dry: dr / n >= 0.5,
    };
  });
}

export function hotCuesFromSections(sections: Section[]): HotCue[] {
  const names: Record<SectionType, string> = { intro: "Интро", buildup: "Подъём", main: "Дроп / Main", breakdown: "Брейк", outro: "Аутро" };
  const seen = new Set<string>();
  const out: HotCue[] = [];
  for (const s of sections) {
    const n = seen.has(s.type) ? `${names[s.type]} 2` : names[s.type];
    seen.add(s.type);
    out.push({ name: n, bar: s.startBar });
  }
  return out.slice(0, 8);
}

export async function analyzeMono(x: Float32Array, sr: number, onProgress: Progress = () => {}): Promise<AnalysisResult> {
  const duration = x.length / sr;
  onProgress(0.02, "Волновая форма");
  const W = 800;
  const waveform: number[] = [];
  const per = x.length / W;
  for (let i = 0; i < W; i++) {
    let m = 0;
    const a = Math.floor(i * per);
    const b = Math.min(x.length, Math.floor((i + 1) * per));
    for (let j = a; j < b; j += 2) {
      const v = Math.abs(x[j]);
      if (v > m) m = v;
    }
    waveform.push(Math.round(clamp(m) * 100));
  }
  const f = Math.max(1, Math.round(sr / 11025));
  const fs = sr / f;
  const d = decimate(x, f);
  await tick();
  const F = await computeFeatures(d, fs, (p) => onProgress(0.05 + 0.45 * p, "Спектральный анализ"));
  onProgress(0.5, "Темп и сетка долей");
  await tick();
  const env = onsetEnvelope(F);
  const tempo = estimateTempo(env, F.fps);
  // сглаживание для привязки к сетке
  const sm = new Float32Array(env.length);
  for (let i = 1; i < env.length - 1; i++) sm[i] = 0.25 * env[i - 1] + 0.5 * env[i] + 0.25 * env[i + 1];
  let bestBpm = tempo.bpm;
  let bestScore = -1;
  for (let bpm = tempo.bpm - 1.5; bpm <= tempo.bpm + 1.5; bpm += 0.02) {
    const g = gridSearch(sm, F.fps, bpm, 16);
    if (g.score > bestScore) {
      bestScore = g.score;
      bestBpm = bpm;
    }
  }
  const fine = gridSearch(sm, F.fps, bestBpm, 128);
  const bpm = Math.round(bestBpm * 100) / 100;
  const P = (F.fps * 60) / bpm;
  const beatSec = 60 / bpm;
  const envMean = mean(sm) + 1e-9;
  const gridConfidence = clamp((fine.score / envMean - 1) / 2.5);
  // даунбит: из 4 позиций выбираем с максимальной «тяжестью» (бас + атака)
  const strength = [0, 0, 0, 0];
  let k = 0;
  for (let pos = fine.phase; pos < F.frames - 3; pos += P, k++) {
    const i = Math.round(pos);
    let m = 0;
    for (let j = -2; j <= 2; j++) {
      const q = i + j;
      if (q >= 0 && q < F.frames) m = Math.max(m, F.flux[q] / (mean(F.flux) + 1e-9) + 2 * (F.fluxLow[q] / (mean(F.fluxLow) + 1e-9)));
    }
    strength[k % 4] += m;
  }
  let c = 0;
  for (let i = 1; i < 4; i++) if (strength[i] > strength[c]) c = i;
  const sorted = [...strength].sort((a, b) => b - a);
  const downbeatConf = sorted[0] > 0 ? clamp((sorted[0] - sorted[1]) / sorted[0] / 0.12) : 0;
  const firstBeat = (fine.phase * HOP + ONSET_OFFSET) / fs;
  const firstDownbeat = Math.max(0, firstBeat + c * beatSec);
  const barDur = 4 * beatSec;
  const totalBars = Math.max(1, Math.floor((duration - firstDownbeat) / barDur));

  onProgress(0.65, "Тональность");
  await tick();
  const key = detectKey(d, fs);

  onProgress(0.8, "Структура, энергия, вокал");
  await tick();
  const frameOf = (t: number) => Math.round((t * fs - FRAME / 2) / HOP);
  const barRms: number[] = [];
  const barLow: number[] = [];
  const barVoc: number[] = [];
  let hiSum = 0;
  let allSum = 0;
  for (let b = 0; b < totalBars; b++) {
    const i0 = clamp(frameOf(firstDownbeat + b * barDur), 0, F.frames - 1);
    const i1 = clamp(Math.max(i0 + 1, frameOf(firstDownbeat + (b + 1) * barDur)), i0 + 1, F.frames);
    let r = 0;
    let l = 0;
    let pk = 0;
    let al = 0;
    let hi = 0;
    for (let i = i0; i < i1; i++) {
      r += F.rms[i];
      l += F.low[i];
      pk += F.peak[i];
      al += F.all[i];
      hi += F.high[i];
    }
    const n = i1 - i0;
    barRms.push(db(r / n));
    barLow.push(db(l / n));
    barVoc.push(pk / (al + 1e-9));
    hiSum += hi;
    allSum += al;
  }
  const norm = (arr: number[]) => {
    const p10 = percentile(arr, 0.1);
    const p90 = percentile(arr, 0.9);
    const span = Math.max(3, p90 - p10);
    return arr.map((v) => clamp((v - p10) / span));
  };
  const nr = norm(barRms);
  const nl = norm(barLow);
  const level = nr.map((v, i) => 0.5 * v + 0.5 * nl[i]);
  // вокал/«сухость» — по доле тональной энергии средней полосы
  const vm = mean(barVoc);
  const vs = Math.sqrt(mean(barVoc.map((v) => (v - vm) ** 2)));
  const vthr = vm + 0.35 * vs;
  const rawVoc = barVoc.map((v) => v > vthr && v > 0.02);
  const vocalBar = rawVoc.map((v, i) => {
    const a = rawVoc[i - 1] ?? v;
    const b = rawVoc[i + 1] ?? v;
    return (Number(a) + Number(v) + Number(b)) >= 2;
  });
  const dthr = percentile(barVoc, 0.35);
  const dryBar = barVoc.map((v) => v <= dthr);
  const vocalPct = vocalBar.filter(Boolean).length / Math.max(1, totalBars);
  const vocalConfidence = clamp(vm > 0 ? (vs / vm) * 1.2 : 0.2, 0.15, 0.6);

  // энергия
  const sortedRms = [...barRms].sort((a, b) => b - a);
  const top = sortedRms.slice(0, Math.max(1, Math.floor(sortedRms.length / 2)));
  const rmsTop = mean(top); // дБ мощности
  const loud = clamp((rmsTop + 30) / 18);
  let peaks = 0;
  const ethr = 0.6 * (Math.sqrt(mean(Array.from(env).map((v) => v * v))) + 1e-9);
  for (let i = 2; i < env.length - 2; i++) if (env[i] > ethr && env[i] >= env[i - 1] && env[i] > env[i + 1] && env[i] >= env[i - 2] && env[i] > env[i + 2]) peaks++;
  const beats = Math.max(1, (duration * bpm) / 60);
  const dens = clamp(peaks / beats / 4);
  const bright = clamp((db(hiSum / (allSum + 1e-9)) + 25) / 15);
  const bpmF = clamp((bpm - 90) / 80);
  const energy = Math.round(100 * clamp(0.45 * loud + 0.25 * dens + 0.2 * bright + 0.1 * bpmF));
  const sections = buildSections(level, vocalBar, dryBar, totalBars, energy);

  onProgress(1, "Готово");
  const keyStr = keyName(key.pc, key.minor);
  return {
    bpm,
    bpmConfidence: Math.round(tempo.conf * 100) / 100,
    gridConfidence: Math.round(clamp(0.6 * gridConfidence + 0.4 * downbeatConf) * 100) / 100,
    firstDownbeat: Math.round(firstDownbeat * 1000) / 1000,
    totalBars,
    key: keyStr,
    camelot: keyToCamelot(key.pc, key.minor),
    keyConfidence: Math.round(key.conf * 100) / 100,
    energy,
    density: Math.round(dens * 100),
    dryness: Math.round((dryBar.filter(Boolean).length / Math.max(1, totalBars)) * 100),
    hasVocals: vocalPct >= 0.3,
    vocalConfidence: Math.round(vocalConfidence * 100) / 100,
    rmsDb: Math.round(rmsTop * 10) / 10,
    sections,
    waveform,
    hot: hotCuesFromSections(sections),
  };
}

export async function analyzeBuffer(buf: AudioBuffer, onProgress?: Progress): Promise<AnalysisResult> {
  const n = buf.length;
  const mono = new Float32Array(n);
  const chs = buf.numberOfChannels;
  for (let c = 0; c < chs; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += data[i] / chs;
  }
  return analyzeMono(mono, buf.sampleRate, onProgress);
}
