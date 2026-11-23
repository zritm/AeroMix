/**
 * WSOLA time-stretch без изменения высоты тона, со скоростью, меняющейся во времени
 * (нужно для кривой темпа разминки/заминки). speedAt(n) — скорость чтения исходника
 * (>1 — быстрее) в выходном сэмпле n.
 */
export interface StretchOpts {
  channels: Float32Array[];
  startSample: number;
  outSamples: number;
  speedAt: (outSample: number) => number;
  signal?: AbortSignal;
}

const N = 2048;
const HS = 1024;
const SEARCH = 512;
const D = 4;

export async function wsolaStretch(o: StretchOpts): Promise<Float32Array[]> {
  const nch = o.channels.length;
  const len = o.channels[0].length;
  const out = o.channels.map(() => new Float32Array(o.outSamples + 3 * N));
  const OFF = HS;
  // децимированное моно для поиска лучшей фазы
  const monoLen = Math.ceil(len / D);
  const mono = new Float32Array(monoLen);
  const lo = Math.max(0, Math.floor((o.startSample - 4 * N) / D));
  const hi = Math.min(monoLen, Math.ceil((o.startSample + o.outSamples * 1.8 + 6 * N) / D));
  for (let i = lo; i < hi; i++) {
    let s = 0;
    for (let c = 0; c < nch; c++) {
      const ch = o.channels[c];
      const b = i * D;
      for (let j = 0; j < D; j++) s += ch[b + j] ?? 0;
    }
    mono[i] = s / (nch * D);
  }
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const L = HS / D;
  let nominal = o.startSample - HS * o.speedAt(0);
  let prevPos = Math.round(nominal);
  for (let k = 0; ; k++) {
    const ok = (k - 1) * HS;
    if (ok >= o.outSamples) break;
    let pos: number;
    if (k === 0) {
      pos = Math.round(nominal);
    } else {
      const c = Math.round(nominal);
      const tp = Math.round((prevPos + HS) / D);
      let best = -Infinity;
      let bestD = 0;
      if (tp >= 0 && tp + L < monoLen) {
        for (let dl = -SEARCH; dl <= SEARCH; dl += D) {
          const qd = Math.round((c + dl) / D);
          if (qd < 0 || qd + L >= monoLen) continue;
          let dot = 0;
          let en = 1e-9;
          for (let i = 0; i < L; i++) {
            const q = mono[qd + i];
            dot += mono[tp + i] * q;
            en += q * q;
          }
          const sc = dot / Math.sqrt(en);
          if (sc > best) {
            best = sc;
            bestD = qd * D - c;
          }
        }
      }
      pos = c + bestD;
    }
    for (let ch = 0; ch < nch; ch++) {
      const src = o.channels[ch];
      const dst = out[ch];
      const base = OFF + ok;
      for (let i = 0; i < N; i++) {
        const idx = pos + i;
        if (idx >= 0 && idx < len) dst[base + i] += src[idx] * win[i];
      }
    }
    prevPos = pos;
    nominal += HS * o.speedAt(Math.max(0, ok + HS / 2));
    if (k % 120 === 0) {
      if (o.signal?.aborted) throw new DOMException("Отменено", "AbortError");
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }
  return out.map((a) => a.slice(OFF, OFF + o.outSamples));
}
