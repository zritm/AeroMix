"use client";
import { useMemo } from "react";
import { energyTarget, fmtTime, itemTimes, TRANSITION_INFO } from "@/lib/planner";
import type { MixSettings, Plan, Track } from "@/lib/types";
import Waveform from "../Waveform";
import { BLOCK_COLORS, BLOCK_LABELS } from "../ui";

export type Sel = { kind: "item"; i: number } | { kind: "trans"; i: number } | null;

const LANE_H = 86;
const GAP = 6;

export default function Timeline({ plan, settings, tracks, sel, onSel, zoom }: { plan: Plan; settings: MixSettings; tracks: Map<string, Track>; sel: Sel; onSel: (s: Sel) => void; zoom: number }) {
  const { tm, times } = useMemo(() => itemTimes(plan, settings), [plan, settings]);
  const total = Math.max(60, plan.report.totalSec);
  const px = zoom;
  const width = Math.round(total * px + 60);
  const b = plan.bounds;
  const tWarm = tm.timeAtBeat(b.warmEnd);
  const tCool = tm.timeAtBeat(b.coolStart);

  const curves = useMemo(() => {
    const pts: { t: number; bpm: number; e: number }[] = [];
    for (let beat = 0; beat <= b.end + 1; beat += Math.max(4, b.end / 400)) pts.push({ t: tm.timeAtBeat(beat), bpm: tm.bpmAtBeat(beat), e: energyTarget(beat, settings, b) });
    const bpms = pts.map((p) => p.bpm);
    return { pts, lo: Math.min(...bpms) - 6, hi: Math.max(...bpms) + 6 };
  }, [tm, b, settings]);

  const CH = 96;
  const yBpm = (v: number) => CH - 8 - ((v - curves.lo) / (curves.hi - curves.lo)) * (CH - 20);
  const yEn = (v: number) => CH - 8 - (v / 100) * (CH - 20);
  const tick = px > 0.7 ? 30 : px > 0.25 ? 60 : 300;
  const ticks: number[] = [];
  for (let t = 0; t <= total + 30; t += tick) ticks.push(t);

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800 bg-[#0b1017]">
      <div className="relative" style={{ width, paddingBottom: 8 }}>
        {/* ruler */}
        <div className="relative h-6 border-b border-slate-800 text-[10px] text-slate-500">
          {ticks.map((t) => (
            <span key={t} className="absolute top-0 h-full border-l border-slate-800 pl-1 pt-1" style={{ left: t * px }}>{fmtTime(t)}</span>
          ))}
        </div>
        {/* blocks */}
        <div className="relative h-5">
          {([["warmup", 0, tWarm], ["main", tWarm, tCool], ["cooldown", tCool, total]] as const).map(([k, a, z]) =>
            z - a > 1 ? (
              <div key={k} className="absolute flex h-full items-center overflow-hidden whitespace-nowrap px-2 text-[10px] font-bold uppercase tracking-wide text-slate-950" style={{ left: a * px, width: (z - a) * px, background: BLOCK_COLORS[k] }}>
                {BLOCK_LABELS[k]} · {fmtTime(z - a)}
              </div>
            ) : null,
          )}
        </div>
        {/* curves */}
        <svg width={width} height={CH} className="block border-b border-slate-800">
          <text x={4} y={11} fontSize="9" fill="#fb923c">BPM {Math.round(curves.lo + 6)}…{Math.round(curves.hi - 6)}</text>
          <text x={90} y={11} fontSize="9" fill="#a3e635">энергия: цель (пунктир) / треки</text>
          <polyline fill="none" stroke="#fb923c" strokeWidth={2} points={curves.pts.map((p) => `${p.t * px},${yBpm(p.bpm)}`).join(" ")} />
          <polyline fill="none" stroke="#a3e635" strokeWidth={1.5} strokeDasharray="4 3" points={curves.pts.map((p) => `${p.t * px},${yEn(p.e)}`).join(" ")} />
          {plan.items.map((it, i) => {
            const tr = tracks.get(it.trackId);
            if (!tr) return null;
            const x0 = times[i].start * px;
            const x1 = (plan.items[i + 1] ? times[i + 1].start : times[i].end) * px;
            return <line key={it.uid} x1={x0} x2={x1} y1={yEn(tr.energy)} y2={yEn(tr.energy)} stroke="#d9f99d" strokeWidth={3} strokeLinecap="round" />;
          })}
        </svg>
        {/* lanes */}
        <div className="relative" style={{ height: LANE_H * 2 + GAP + 14, marginTop: 8 }}>
          {plan.items.map((it, i) => {
            const tr = tracks.get(it.trackId);
            if (!tr) return null;
            const x = times[i].start * px;
            const w = Math.max(8, (times[i].end - times[i].start) * px);
            const isSel = sel?.kind === "item" && sel.i === i;
            const srcFrom = tr.firstDownbeat + (it.inBar * 240) / tr.bpm;
            const srcTo = tr.firstDownbeat + (it.outBar * 240) / tr.bpm;
            const mixBpm = tm.bpmAtBeat((it.startBeat + it.endBeat) / 2);
            const hasIssue = it.issues.some((x) => x.level !== "info");
            return (
              <div
                key={it.uid}
                onClick={() => onSel({ kind: "item", i })}
                className="absolute cursor-pointer overflow-hidden rounded-lg bg-[#121b27]"
                style={{ left: x, width: w, top: (i % 2) * (LANE_H + GAP), height: LANE_H, border: `2px solid ${isSel ? "#fff" : hasIssue && it.issues.some((x) => x.level === "error") ? "#f43f5e" : BLOCK_COLORS[it.block] + "aa"}` }}
              >
                <div className="absolute inset-x-0 bottom-0">
                  <Waveform peaks={tr.waveform} duration={tr.duration} from={srcFrom} to={srcTo} height={LANE_H - 28} fixedWidth={Math.max(8, Math.round(w) - 4)} sections={tr.sections} bpm={tr.bpm} firstDownbeat={tr.firstDownbeat} color={BLOCK_COLORS[it.block]} showGrid={px > 0.4} />
                </div>
                <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-1.5 overflow-hidden whitespace-nowrap bg-gradient-to-b from-black/70 to-transparent px-1.5 pb-2 pt-0.5 text-[11px]">
                  <b className="text-white">{i + 1}.</b>
                  <span className="truncate text-slate-100">{tr.title}</span>
                  <span className="rounded bg-black/50 px-1 text-[10px] text-slate-300">{tr.bpm.toFixed(0)}→{mixBpm.toFixed(0)}</span>
                  <span className="rounded px-1 text-[10px] font-bold text-white" style={{ background: "#334155" }}>{tr.camelot}</span>
                  <span className="rounded bg-black/50 px-1 text-[10px] text-lime-300">E{tr.energy}</span>
                  {tr.hasVocals && <span>🎤</span>}
                  {hasIssue && <span className="text-amber-400">⚠</span>}
                </div>
              </div>
            );
          })}
          {plan.items.slice(0, -1).map((it, i) => {
            if (!it.trans) return null;
            const x0 = times[i + 1].start * px;
            const x1 = times[i].end * px;
            const w = Math.max(20, x1 - x0);
            const info = TRANSITION_INFO[it.trans.type];
            const isSel = sel?.kind === "trans" && sel.i === i;
            const bad = it.trans.issues.some((x) => x.level === "error");
            const warn = it.trans.issues.some((x) => x.level === "warn");
            return (
              <div
                key={"t" + it.uid}
                onClick={() => onSel({ kind: "trans", i })}
                title={`${info.label}, ${it.trans.bars} тактов`}
                className="absolute z-10 flex cursor-pointer flex-col items-center justify-center rounded-md text-[10px] font-bold text-white backdrop-blur-[1px]"
                style={{ left: x0 - (it.trans.bars === 0 ? 10 : 0), width: w, top: 0, height: LANE_H * 2 + GAP, background: isSel ? "rgba(34,211,238,0.35)" : "rgba(255,255,255,0.12)", border: `2px dashed ${bad ? "#f43f5e" : warn ? "#fbbf24" : isSel ? "#22d3ee" : "rgba(255,255,255,0.45)"}` }}
              >
                <span className="rounded bg-black/60 px-1">{info.short}</span>
                <span className="mt-1 rounded bg-black/60 px-1">{it.trans.bars ? `${it.trans.bars} т.` : "на фразе"}</span>
                {(bad || warn) && <span className="mt-1">{bad ? "⛔" : "⚠️"}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
