export interface DemoSpec {
  title: string;
  artist: string;
  bpm: number;
  root: number; // pitch class
  minor: boolean;
  energy: number; // 0..1
  vocal: boolean;
  bars?: number;
}

export const DEMO_SPECS: DemoSpec[] = [
  { title: "Warm Sunrise", artist: "Demo Lab", bpm: 112, root: 9, minor: true, energy: 0.35, vocal: false },
  { title: "Slow Stretch", artist: "Demo Lab", bpm: 116, root: 4, minor: true, energy: 0.4, vocal: true },
  { title: "Easy Pulse", artist: "Demo Lab", bpm: 120, root: 0, minor: false, energy: 0.5, vocal: false },
  { title: "Rising Tide", artist: "Demo Lab", bpm: 124, root: 9, minor: true, energy: 0.6, vocal: false },
  { title: "Neon Steps", artist: "Demo Lab", bpm: 128, root: 4, minor: true, energy: 0.7, vocal: true },
  { title: "Power Hour", artist: "Demo Lab", bpm: 130, root: 7, minor: false, energy: 0.8, vocal: false },
  { title: "Stadium Run", artist: "Demo Lab", bpm: 132, root: 11, minor: true, energy: 0.85, vocal: true },
  { title: "Hi-Lo Hero", artist: "Demo Lab", bpm: 134, root: 0, minor: false, energy: 0.8, vocal: false },
  { title: "Turbo Pump", artist: "Demo Lab", bpm: 136, root: 2, minor: true, energy: 0.9, vocal: false },
  { title: "Sweat Engine", artist: "Demo Lab", bpm: 138, root: 9, minor: true, energy: 0.9, vocal: true },
  { title: "Final Push", artist: "Demo Lab", bpm: 134, root: 4, minor: true, energy: 0.85, vocal: false },
  { title: "Cool Breeze", artist: "Demo Lab", bpm: 104, root: 2, minor: true, energy: 0.3, vocal: false },
  { title: "Slow Down", artist: "Demo Lab", bpm: 96, root: 9, minor: true, energy: 0.22, vocal: false },
  { title: "Stretch & Breathe", artist: "Demo Lab", bpm: 88, root: 0, minor: false, energy: 0.15, vocal: false },
  { title: "Bright Lights", artist: "Demo Lab", bpm: 126, root: 9, minor: true, energy: 0.62, vocal: false },
  { title: "Crowd Control", artist: "Demo Lab", bpm: 130, root: 4, minor: true, energy: 0.78, vocal: true },
  { title: "Core Burn", artist: "Demo Lab", bpm: 134, root: 7, minor: false, energy: 0.85, vocal: false },
  { title: "Last Lap", artist: "Demo Lab", bpm: 132, root: 0, minor: false, energy: 0.8, vocal: false },
  { title: "Gentle Start", artist: "Demo Lab", bpm: 108, root: 9, minor: true, energy: 0.28, vocal: false },
  { title: "Wind Down", artist: "Demo Lab", bpm: 100, root: 4, minor: true, energy: 0.2, vocal: false },
];

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

/** Синтез демо-трека (kick/hat/bass/pad/voice) со структурой intro-buildup-main-breakdown-main-outro. */
export function synthDemo(spec: DemoSpec, sr = 44100): Float32Array {
  const bpm = spec.bpm;
  const beat = 60 / bpm;
  const bars = spec.bars ?? 96;
  const total = Math.floor(bars * 4 * beat * sr) + sr;
  const out = new Float32Array(total);
  const rand = rng(Math.round(spec.bpm * 31 + spec.root * 7));
  const lead = 1.2; // небольшая тишина перед первой долей
  const e = spec.energy;
  const secOf = (bar: number): "intro" | "build" | "main" | "break" | "outro" => {
    if (bar < 8) return "intro";
    if (bar < 12) return "build";
    if (bar < 44) return "main";
    if (bar < 52) return "break";
    if (bar < bars - 8) return "main";
    return "outro";
  };
  const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
  const scale = spec.minor ? [0, 3, 7] : [0, 4, 7];
  const rootMidi = 48 + spec.root;
  const chordRoots = spec.minor ? [0, 0, 8, 10] : [0, 5, 7, 0];
  for (let bar = 0; bar < bars; bar++) {
    const sec = secOf(bar);
    const chordOff = chordRoots[Math.floor(bar / 2) % 4];
    for (let b = 0; b < 4; b++) {
      const t = lead + (bar * 4 + b) * beat;
      const i0 = Math.floor(t * sr);
      // kick
      if (sec !== "break") {
        const kv = sec === "intro" || sec === "outro" ? 0.55 : 0.9;
        const len = Math.floor(0.22 * sr);
        let ph = 0;
        for (let i = 0; i < len && i0 + i < total; i++) {
          const tt = i / sr;
          const fr = 45 + 110 * Math.exp(-tt * 38);
          ph += (2 * Math.PI * fr) / sr;
          out[i0 + i] += Math.sin(ph) * Math.exp(-tt * 11) * kv * (0.6 + 0.4 * e);
        }
      }
      // hat на off-beat (и 16-е в main)
      const hatPos = sec === "break" ? [] : sec === "main" ? [0.5, 0.25, 0.75] : [0.5];
      for (const hp of hatPos) {
        const h0 = Math.floor((t + hp * beat) * sr);
        const len = Math.floor(0.045 * sr);
        let prev = 0;
        for (let i = 0; i < len && h0 + i < total; i++) {
          const nz = rand() * 2 - 1;
          const hp1 = nz - prev;
          prev = nz;
          out[h0 + i] += hp1 * Math.exp(-i / (0.012 * sr)) * (hp === 0.5 ? 0.22 : 0.1) * (0.5 + 0.5 * e);
        }
      }
      // snare/clap на 2 и 4 в main + ролл в buildup
      if ((sec === "main" && (b === 1 || b === 3)) || (sec === "build" && (bar % 2 === 1 || b >= 2))) {
        const len = Math.floor(0.12 * sr);
        for (let i = 0; i < len && i0 + i < total; i++) out[i0 + i] += (rand() * 2 - 1) * Math.exp(-i / (0.03 * sr)) * 0.3 * (0.5 + 0.5 * e);
      }
      // бас на 8-х
      if (sec === "main" || sec === "build") {
        for (let h = 0; h < 2; h++) {
          const b0 = Math.floor((t + (h * 0.5 + (h ? 0 : 0)) * beat) * sr);
          const len = Math.floor(beat * 0.45 * sr);
          const f = midi(rootMidi - 12 + chordOff);
          for (let i = 0; i < len && b0 + i < total; i++) {
            const tt = i / sr;
            out[b0 + i] += Math.sin(2 * Math.PI * f * tt) * Math.exp(-tt * 5) * (h === 0 ? 0.42 : 0.3) * (0.6 + 0.4 * e);
          }
        }
      }
    }
    // pad/аккорд на такт
    const padOn = sec === "main" || sec === "break" || sec === "build" || (sec === "outro" && bar % 2 === 0);
    if (padOn) {
      const t0 = lead + bar * 4 * beat;
      const i0 = Math.floor(t0 * sr);
      const len = Math.floor(4 * beat * sr);
      const amp = sec === "break" ? 0.16 : 0.1;
      for (const iv of scale) {
        const f = midi(rootMidi + 12 + chordOff + iv);
        for (let i = 0; i < len && i0 + i < total; i++) {
          const tt = i / sr;
          const env = Math.min(1, tt * 6) * Math.min(1, (len - i) / (0.05 * sr));
          out[i0 + i] += Math.sin(2 * Math.PI * f * tt) * amp * env * 0.6 + Math.sin(2 * Math.PI * f * 2.003 * tt) * amp * env * 0.12;
        }
      }
    }
    // «голос»: гармонический тон с вибрато в main, фразы по 2 такта
    if (spec.vocal && sec === "main" && bar % 4 < 2) {
      const t0 = lead + bar * 4 * beat;
      const i0 = Math.floor(t0 * sr);
      const len = Math.floor(3.4 * beat * sr);
      const f0 = midi(rootMidi + 24 + (spec.minor ? 3 : 4) + (bar % 8 < 4 ? 0 : 2));
      for (let i = 0; i < len && i0 + i < total; i++) {
        const tt = i / sr;
        const vib = 1 + 0.012 * Math.sin(2 * Math.PI * 5.5 * tt);
        let s = 0;
        for (let h = 1; h <= 9; h++) s += Math.sin(2 * Math.PI * f0 * vib * h * tt) / (h * 1.1);
        out[i0 + i] += s * 0.13 * Math.min(1, tt * 20) * Math.min(1, (len - i) / (0.08 * sr));
      }
    }
  }
  let peak = 0;
  for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(out[i]));
  const g = (0.14 + 0.82 * e) / (peak || 1);
  for (let i = 0; i < total; i++) out[i] *= g;
  return out;
}

export function toWavBlob(samples: Float32Array, sr = 44100): Blob {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  w(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
  return new Blob([buf], { type: "audio/wav" });
}
