"use client";
import { useEffect, useRef, useState } from "react";
import type { Section } from "@/lib/types";
import { SECTION_COLORS, SECTION_LABELS } from "./ui";

interface Props {
  peaks: number[];
  duration: number;
  from?: number;
  to?: number;
  height?: number;
  color?: string;
  sections?: Section[];
  bpm?: number;
  firstDownbeat?: number;
  markers?: { bar: number; label: string; color?: string }[];
  playhead?: number | null;
  onSeek?: (sec: number) => void;
  showGrid?: boolean;
  fixedWidth?: number;
}

export default function Waveform(p: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(p.fixedWidth ?? 800);
  const h = p.height ?? 80;
  const from = p.from ?? 0;
  const to = p.to ?? p.duration;

  useEffect(() => {
    if (p.fixedWidth) {
      setW(p.fixedWidth);
      return;
    }
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(100, el.clientWidth)));
    ro.observe(el);
    setW(Math.max(100, el.clientWidth));
    return () => ro.disconnect();
  }, [p.fixedWidth]);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const width = Math.min(4000, Math.max(2, Math.round(w)));
    c.width = width;
    c.height = h;
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, width, h);
    const span = Math.max(0.01, to - from);
    const x = (t: number) => ((t - from) / span) * width;
    const bar = p.bpm ? 240 / p.bpm : 0;
    const barT = (b: number) => (p.firstDownbeat ?? 0) + b * bar;
    if (p.sections && bar) {
      for (const s of p.sections) {
        const x0 = x(barT(s.startBar));
        const x1 = x(barT(s.endBar));
        if (x1 < 0 || x0 > width) continue;
        g.fillStyle = SECTION_COLORS[s.type] + "26";
        g.fillRect(x0, 0, x1 - x0, h);
        g.fillStyle = SECTION_COLORS[s.type];
        g.fillRect(x0, 0, Math.max(1, x1 - x0), 3);
        if (x1 - x0 > 46) {
          g.font = "10px sans-serif";
          g.fillText(SECTION_LABELS[s.type], Math.max(2, x0) + 3, 14);
        }
      }
    }
    if (p.showGrid !== false && bar) {
      const pxBar = (bar / span) * width;
      const step = pxBar > 14 ? 1 : pxBar > 4 ? 4 : 16;
      if (pxBar * step > 5) {
        const b0 = Math.max(0, Math.floor((from - (p.firstDownbeat ?? 0)) / bar));
        for (let b = b0; barT(b) < to; b += 1) {
          if (b % step) continue;
          const xx = Math.round(x(barT(b))) + 0.5;
          g.strokeStyle = b % 16 === 0 ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.09)";
          g.beginPath();
          g.moveTo(xx, h - (b % 16 === 0 ? 14 : 8));
          g.lineTo(xx, h);
          g.stroke();
        }
      }
    }
    const n = p.peaks.length;
    if (n) {
      g.fillStyle = p.color ?? "#67e8f9";
      for (let px = 0; px < width; px++) {
        const t = from + (px / width) * span;
        const idx = Math.min(n - 1, Math.max(0, Math.floor((t / p.duration) * n)));
        const idx2 = Math.min(n - 1, Math.max(idx, Math.floor(((from + ((px + 1) / width) * span) / p.duration) * n)));
        let m = 0;
        for (let i = idx; i <= idx2; i++) m = Math.max(m, p.peaks[i]);
        const a = (Math.sqrt(m / 100) * (h - 18)) / 2;
        g.fillRect(px, h / 2 - a, 1, Math.max(1, a * 2));
      }
    }
    for (const m of p.markers ?? []) {
      if (!bar) break;
      const xx = Math.round(x(barT(m.bar))) + 0.5;
      if (xx < 0 || xx > width) continue;
      g.strokeStyle = m.color ?? "#facc15";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(xx, 0);
      g.lineTo(xx, h);
      g.stroke();
      g.lineWidth = 1;
      g.fillStyle = m.color ?? "#facc15";
      g.font = "bold 10px sans-serif";
      g.fillText(m.label, xx + 3, h - 4);
    }
    if (p.playhead != null) {
      const xx = x(p.playhead);
      g.strokeStyle = "#fff";
      g.beginPath();
      g.moveTo(xx, 0);
      g.lineTo(xx, h);
      g.stroke();
    }
  }, [p.peaks, p.duration, from, to, w, h, p.sections, p.bpm, p.firstDownbeat, p.markers, p.playhead, p.color, p.showGrid]);

  return (
    <div ref={wrap} className="w-full" style={p.fixedWidth ? { width: p.fixedWidth } : undefined}>
      <canvas
        ref={ref}
        style={{ width: "100%", height: h, cursor: p.onSeek ? "pointer" : "default", display: "block" }}
        onClick={(e) => {
          if (!p.onSeek) return;
          const r = e.currentTarget.getBoundingClientRect();
          p.onSeek(from + ((e.clientX - r.left) / r.width) * (to - from));
        }}
      />
    </div>
  );
}
