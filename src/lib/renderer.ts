import { loadAudioBuffer, SAMPLE_RATE } from "./audio";
import { makeTempoMap } from "./planner";
import type { TempoMap } from "./tempo";
import { wsolaStretch } from "./stretch";
import type { MixSettings, Plan, Track } from "./types";

const SR = SAMPLE_RATE;
type Pt = { t: number; v: number };
interface Env {
  gain: Pt[];
  low: Pt[];
  mid: Pt[];
  hp: Pt[];
  lp: Pt[];
  rollFrom: number | null;
}
interface Stretched {
  chans: Float32Array[];
  t0: number;
  t1: number;
}

const baseGain = (t: Track) => Math.min(2.5, Math.max(0.35, Math.pow(10, (-17 - t.rmsDb) / 20)));
const dbToLin = (d: number) => Math.pow(10, d / 20);

function valueAt(pts: Pt[], t: number, exp: boolean): number {
  if (t <= pts[0].t) return pts[0].v;
  const last = pts[pts.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i].t) {
      const a = pts[i - 1];
      const b = pts[i];
      const x = (t - a.t) / Math.max(1e-9, b.t - a.t);
      return exp ? a.v * Math.pow(b.v / a.v, x) : a.v + (b.v - a.v) * x;
    }
  }
  return last.v;
}

function applyEnv(param: AudioParam, pts: Pt[], rs: number, re: number, def: number, exp = false) {
  if (!pts.length) {
    param.setValueAtTime(def, 0);
    return;
  }
  const s = [...pts].sort((a, b) => a.t - b.t);
  param.setValueAtTime(valueAt(s, rs, exp), 0);
  let lastT = 0;
  for (const p of s) {
    if (p.t <= rs + 1e-4 || p.t >= re) continue;
    const rel = Math.max(lastT + 1e-4, p.t - rs);
    if (exp) param.exponentialRampToValueAtTime(Math.max(1e-4, p.v), rel);
    else param.linearRampToValueAtTime(p.v, rel);
    lastT = rel;
  }
  const endRel = re - rs;
  if (endRel > lastT + 1e-4) {
    const v = valueAt(s, re, exp);
    if (exp) param.exponentialRampToValueAtTime(Math.max(1e-4, v), endRel);
    else param.linearRampToValueAtTime(v, endRel);
  }
}

function startClip(src: AudioBufferSourceNode, when: number, offset: number, dur: number) {
  if (when < 0) {
    offset -= when;
    dur += when;
    when = 0;
  }
  if (dur <= 0.001) return false;
  src.start(when, offset, dur);
  return true;
}

export class MixRenderer {
  plan: Plan;
  tm: TempoMap;
  times: { start: number; end: number }[];
  totalSec: number;
  private tracks: Map<string, Track>;
  private full = new Map<number, Stretched>();
  private signal?: AbortSignal;

  constructor(plan: Plan, settings: MixSettings, tracks: Map<string, Track>, signal?: AbortSignal) {
    this.plan = plan;
    this.tracks = tracks;
    this.signal = signal;
    this.tm = makeTempoMap(settings, plan.bounds);
    this.times = plan.items.map((i) => ({ start: this.tm.timeAtBeat(i.startBeat), end: this.tm.timeAtBeat(i.endBeat) }));
    this.totalSec = this.times.length ? this.times[this.times.length - 1].end : 0;
  }

  private track(i: number) {
    return this.tracks.get(this.plan.items[i].trackId)!;
  }

  private srcSecAt(i: number, t: number): number {
    const it = this.plan.items[i];
    const tr = this.track(i);
    const srcIn = tr.firstDownbeat + (it.inBar * 240) / tr.bpm;
    if (tr.noStretch) return srcIn + (t - this.times[i].start);
    return srcIn + ((this.tm.beatAtTime(t) - it.startBeat) * 60) / tr.bpm;
  }

  private async stretched(i: number, from: number, to: number, keep: boolean): Promise<Stretched | null> {
    const cached = this.full.get(i);
    if (cached && cached.t0 <= from + 1e-3 && cached.t1 >= to - 1e-3) return cached;
    const tr = this.track(i);
    const t0 = Math.max(this.times[i].start, from);
    const t1 = Math.min(this.times[i].end, to);
    if (t1 <= t0 + 0.01) return null;
    const ab = await loadAudioBuffer(tr.id);
    const ch0 = ab.getChannelData(0);
    const chans = [ch0, ab.numberOfChannels > 1 ? ab.getChannelData(1) : ch0];
    const startSample = this.srcSecAt(i, t0) * SR;
    const outSamples = Math.ceil((t1 - t0) * SR);
    const speedAt = tr.noStretch ? () => 1 : (n: number) => this.tm.bpmAtBeat(this.tm.beatAtTime(t0 + n / SR)) / tr.bpm;
    const out = await wsolaStretch({ channels: chans, startSample, outSamples, speedAt, signal: this.signal });
    const res = { chans: out, t0, t1 };
    if (keep) this.full.set(i, res);
    return res;
  }

  private buildEnv(i: number): Env {
    const items = this.plan.items;
    const it = items[i];
    const tr = this.track(i);
    const base = baseGain(tr);
    const e: Env = { gain: [], low: [], mid: [], hp: [], lp: [], rollFrom: null };
    const tS = this.times[i].start;
    const tE = this.times[i].end;
    const tm = this.tm;
    // входящий переход (этот трек = B)
    if (i > 0 && items[i - 1].trans) {
      const t = items[i - 1].trans!;
      const N = t.bars;
      const at = (x: number) => tm.timeAtBeat(it.startBeat + x * N * 4);
      if (N === 0 || t.type === "cut" || t.type === "loop_roll") {
        e.gain.push({ t: tS, v: 0 }, { t: tS + 0.006, v: base });
      } else {
        const swapT = at(0.5);
        switch (t.type) {
          case "fade":
            for (let k = 0; k <= 8; k++) e.gain.push({ t: at(k / 8), v: base * Math.sin((k / 8) * Math.PI * 0.5) });
            break;
          case "eq_blend":
            e.gain.push({ t: at(0), v: 0 }, { t: at(0.5), v: base });
            e.low.push({ t: at(0), v: -24 }, { t: at(0.25), v: -24 }, { t: at(0.75), v: 0 });
            break;
          case "filter":
            e.gain.push({ t: at(0), v: 0 }, { t: at(0.3), v: base });
            e.lp.push({ t: at(0), v: 400 }, { t: at(0.1), v: 400 }, { t: at(0.8), v: 20000 });
            break;
          default: // bass_swap, drum_to_drum
            e.gain.push({ t: at(0), v: 0 }, { t: at(0.25), v: base });
            e.low.push({ t: at(0), v: -30 }, { t: swapT, v: -30 }, { t: swapT + 0.03, v: 0 });
            if (t.type === "drum_to_drum") e.mid.push({ t: at(0), v: -10 }, { t: at(0.5), v: -10 }, { t: at(0.9), v: 0 });
        }
      }
    }
    // исходящий переход (этот трек = A)
    if (i < items.length - 1 && it.trans) {
      const t = it.trans;
      const N = t.bars;
      const nb = items[i + 1].startBeat;
      const at = (x: number) => tm.timeAtBeat(nb + x * N * 4);
      if (t.type === "cut") {
        e.gain.push({ t: tE - 0.006, v: base }, { t: tE, v: 0 });
      } else if (t.type === "loop_roll") {
        const rs = tm.timeAtBeat(it.endBeat - 8);
        e.rollFrom = rs;
        e.gain.push({ t: tE - 0.006, v: base }, { t: tE, v: 0 });
      } else if (N > 0) {
        const swapT = at(0.5);
        switch (t.type) {
          case "fade":
            for (let k = 0; k <= 8; k++) e.gain.push({ t: at(k / 8), v: base * Math.cos((k / 8) * Math.PI * 0.5) });
            break;
          case "eq_blend":
            e.gain.push({ t: at(0), v: base }, { t: at(0.5), v: base }, { t: at(1), v: 0 });
            e.low.push({ t: at(0), v: 0 }, { t: at(0.25), v: 0 }, { t: at(0.75), v: -24 });
            break;
          case "filter":
            e.gain.push({ t: at(0), v: base }, { t: at(0.6), v: base }, { t: at(1), v: 0 });
            e.hp.push({ t: at(0), v: 20 }, { t: at(0.9), v: 2500 });
            break;
          default:
            e.gain.push({ t: at(0), v: base }, { t: at(0.75), v: base }, { t: at(1), v: 0 });
            e.low.push({ t: at(0), v: 0 }, { t: swapT, v: 0 }, { t: swapT + 0.03, v: -30 });
            if (t.type === "drum_to_drum") e.mid.push({ t: at(0), v: 0 }, { t: at(0.3), v: 0 }, { t: at(0.7), v: -12 });
        }
      }
    }
    if (i === items.length - 1) {
      const fs = tm.timeAtBeat(Math.max(it.startBeat, it.endBeat - 16));
      e.gain.push({ t: fs, v: base }, { t: tE, v: 0 });
    }
    if (!e.gain.length) e.gain.push({ t: tS, v: base });
    return e;
  }

  private async renderChunk(c0: number, c1: number, keepFull: boolean): Promise<Float32Array[]> {
    const pre = c0 > 0 ? 0.6 : 0;
    const rs = c0 - pre;
    const len = Math.ceil((c1 - rs) * SR);
    const oac = new OfflineAudioContext(2, len, SR);
    const comp = oac.createDynamicsCompressor();
    comp.threshold.value = -2;
    comp.knee.value = 0;
    comp.ratio.value = 20;
    comp.attack.value = 0.002;
    comp.release.value = 0.08;
    const master = oac.createGain();
    master.gain.value = 0.85;
    master.connect(comp);
    comp.connect(oac.destination);
    const items = this.plan.items;
    for (let i = 0; i < items.length; i++) {
      const { start, end } = this.times[i];
      if (end <= rs || start >= c1) continue;
      const st = await this.stretched(i, keepFull ? start : rs, keepFull ? end : c1, keepFull);
      if (!st) continue;
      const env = this.buildEnv(i);
      const input = oac.createGain();
      const hp = oac.createBiquadFilter();
      hp.type = "highpass";
      hp.Q.value = 0.7;
      const lp = oac.createBiquadFilter();
      lp.type = "lowpass";
      lp.Q.value = 0.7;
      const low = oac.createBiquadFilter();
      low.type = "lowshelf";
      low.frequency.value = 220;
      const mid = oac.createBiquadFilter();
      mid.type = "peaking";
      mid.frequency.value = 1400;
      mid.Q.value = 0.6;
      const g = oac.createGain();
      input.connect(hp);
      hp.connect(lp);
      lp.connect(low);
      low.connect(mid);
      mid.connect(g);
      g.connect(master);
      applyEnv(hp.frequency, env.hp, rs, c1, 10, true);
      applyEnv(lp.frequency, env.lp, rs, c1, 22000, true);
      applyEnv(low.gain, env.low, rs, c1, 0);
      applyEnv(mid.gain, env.mid, rs, c1, 0);
      applyEnv(g.gain, env.gain, rs, c1, 1);
      // линейная шкала для dB-параметров уже учтена в BiquadFilter (gain в dB)
      void dbToLin;
      const srcAt = (from: number, to: number, when: number, dest: AudioNode, fade = 0) => {
        const a = Math.max(0, Math.floor(from * SR));
        const b = Math.min(st.chans[0].length, Math.ceil(to * SR));
        if (b - a < 8) return;
        const buf = oac.createBuffer(2, b - a, SR);
        buf.copyToChannel(st.chans[0].subarray(a, b) as Float32Array<ArrayBuffer>, 0);
        buf.copyToChannel(st.chans[1].subarray(a, b) as Float32Array<ArrayBuffer>, 1);
        const s = oac.createBufferSource();
        s.buffer = buf;
        let out: AudioNode = s;
        if (fade > 0) {
          const cg = oac.createGain();
          const d = (b - a) / SR;
          cg.gain.setValueAtTime(0, Math.max(0, when));
          cg.gain.linearRampToValueAtTime(1, Math.max(0, when) + Math.min(fade, d / 2));
          cg.gain.setValueAtTime(1, Math.max(0, when + d - fade));
          cg.gain.linearRampToValueAtTime(0, Math.max(0, when + d));
          s.connect(cg);
          out = cg;
        }
        out.connect(dest);
        startClip(s, when, 0, (b - a) / SR);
      };
      // основной поток: может быть обрезан началом цепи рендера или loop roll
      const playFrom = Math.max(st.t0, rs);
      const playTo = Math.min(env.rollFrom ?? st.t1, st.t1, c1);
      srcAt(playFrom - st.t0, playTo - st.t0, playFrom - rs, input);
      if (env.rollFrom != null) {
        // loop roll: последние 8 долей A заменяются укорачивающейся петлёй последней доли
        const it = items[i];
        const tb0 = this.tm.timeAtBeat(it.endBeat - 9) - st.t0;
        const plan: [number, number, number][] = [
          [0, 1, 4],
          [4, 0.5, 4],
          [6, 0.25, 4],
          [7, 0.125, 8],
        ];
        for (const [bo, lenB, reps] of plan) {
          for (let r = 0; r < reps; r++) {
            const b0 = it.endBeat - 8 + bo + r * lenB;
            const at = this.tm.timeAtBeat(b0);
            const dur = this.tm.timeAtBeat(b0 + lenB) - at;
            if (at + dur <= rs || at >= c1) continue;
            const sliceEnd = tb0 + dur;
            // отрезок буфера: первая часть последней доли
            const whenAbs = at - rs;
            if (whenAbs < 0) continue;
            srcAt(tb0, sliceEnd, whenAbs, input, 0.003);
          }
        }
      }
    }
    const rendered = await oac.startRendering();
    const skip = Math.round(pre * SR);
    const n = Math.round((c1 - c0) * SR);
    return [rendered.getChannelData(0).slice(skip, skip + n), rendered.getChannelData(1).slice(skip, skip + n)];
  }

  /** Предпросмотр произвольного диапазона (например, перехода). */
  async renderRange(c0: number, c1: number, onProgress?: (p: number) => void): Promise<Float32Array[]> {
    this.full.clear();
    const chunk = 20;
    const outs: Float32Array[][] = [];
    let total = 0;
    for (let a = c0; a < c1 - 1e-6; a += chunk) {
      const b = Math.min(c1, a + chunk);
      const part = await this.renderChunk(a, b, false);
      outs.push(part);
      total += part[0].length;
      onProgress?.((b - c0) / (c1 - c0));
    }
    const L = new Float32Array(total);
    const R = new Float32Array(total);
    let o = 0;
    for (const p of outs) {
      L.set(p[0], o);
      R.set(p[1], o);
      o += p[0].length;
    }
    return [L, R];
  }

  previewRangeForTransition(i: number): [number, number] {
    const it = this.plan.items[i];
    const next = this.plan.items[i + 1];
    const c0 = Math.max(0, this.tm.timeAtBeat(next.startBeat - 16));
    const c1 = Math.min(this.totalSec, this.tm.timeAtBeat(it.endBeat + 16));
    return [c0, Math.max(c0 + 2, c1)];
  }

  /** Полный рендер в WAV 16-bit stereo 44.1 кГц, кусками (экономит память). */
  async exportWav(onProgress: (p: number, label: string) => void): Promise<Blob> {
    this.full.clear();
    const chunk = 20;
    const total = this.totalSec + 0.5;
    const parts: BlobPart[] = [];
    let samples = 0;
    for (let a = 0; a < total; a += chunk) {
      if (this.signal?.aborted) throw new DOMException("Отменено", "AbortError");
      const b = Math.min(total, a + chunk);
      for (const k of [...this.full.keys()]) if (this.times[k].end < a - 3) this.full.delete(k);
      const [L, R] = await this.renderChunk(a, b, true);
      const pcm = new Int16Array(L.length * 2);
      for (let i = 0; i < L.length; i++) {
        pcm[2 * i] = Math.max(-1, Math.min(1, L[i])) * 32767;
        pcm[2 * i + 1] = Math.max(-1, Math.min(1, R[i])) * 32767;
      }
      parts.push(pcm.buffer);
      samples += L.length;
      onProgress(b / total, `Рендер ${Math.round((b / total) * 100)}%`);
      await new Promise((r) => setTimeout(r, 0));
    }
    const header = new ArrayBuffer(44);
    const v = new DataView(header);
    const w = (o: number, s: string) => {
      for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
    };
    w(0, "RIFF");
    v.setUint32(4, 36 + samples * 4, true);
    w(8, "WAVE");
    w(12, "fmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 2, true);
    v.setUint32(24, SR, true);
    v.setUint32(28, SR * 4, true);
    v.setUint16(32, 4, true);
    v.setUint16(34, 16, true);
    w(36, "data");
    v.setUint32(40, samples * 4, true);
    this.full.clear();
    return new Blob([header, ...parts], { type: "audio/wav" });
  }
}
