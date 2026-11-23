"use client";
import type { ReactNode } from "react";
import { camelotColor } from "@/lib/camelot";
import type { Issue } from "@/lib/types";

export function CamelotBadge({ code }: { code: string }) {
  return (
    <span style={{ background: camelotColor(code) }} className="inline-flex min-w-[2.4rem] items-center justify-center rounded-md px-1.5 py-0.5 text-xs font-bold text-white shadow">
      {code || "—"}
    </span>
  );
}

export function Conf({ v, label }: { v: number; label?: string }) {
  const c = v >= 0.7 ? "bg-emerald-400" : v >= 0.4 ? "bg-amber-400" : "bg-rose-400";
  return (
    <span className="inline-flex items-center gap-1.5" title={`Уверенность анализа: ${Math.round(v * 100)}%`}>
      <span className="h-1.5 w-8 overflow-hidden rounded bg-slate-700">
        <span className={`block h-full ${c}`} style={{ width: `${Math.round(v * 100)}%` }} />
      </span>
      {label && <span className="text-[10px] text-slate-500">{label}</span>}
    </span>
  );
}

export function EnergyBar({ v }: { v: number }) {
  const hue = 200 - v * 1.6;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2 w-14 overflow-hidden rounded bg-slate-800">
        <span className="block h-full rounded" style={{ width: `${v}%`, background: `hsl(${hue} 85% 55%)` }} />
      </span>
      <span className="w-6 text-xs tabular-nums text-slate-300">{v}</span>
    </span>
  );
}

export const btn = "rounded-lg border border-slate-700 bg-slate-800/70 px-3 py-1.5 text-sm text-slate-100 transition hover:border-cyan-500/60 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40";
export const btnPrimary = "rounded-lg bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-slate-950 shadow transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40";
export const btnDanger = "rounded-lg border border-rose-900 bg-rose-950/50 px-3 py-1.5 text-sm text-rose-300 transition hover:bg-rose-900/50 disabled:opacity-40";

export function Panel({ title, children, right, className = "" }: { title?: ReactNode; children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-slate-800 bg-[#0f151e] p-4 ${className}`}>
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">{title}</h2>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-400">
      <span>{label}</span>
      {children}
      {hint && <span className="text-[10px] leading-tight text-slate-600">{hint}</span>}
    </label>
  );
}

export function IssueList({ issues, onPick }: { issues: Issue[]; onPick?: (i: number) => void }) {
  if (!issues.length) return <p className="text-sm text-emerald-400">✓ Замечаний нет</p>;
  const icon = { error: "⛔", warn: "⚠️", info: "ℹ️" } as const;
  const cls = { error: "text-rose-300", warn: "text-amber-300", info: "text-sky-300" } as const;
  return (
    <ul className="space-y-1.5">
      {issues.map((x, k) => (
        <li key={k} className={`flex gap-2 text-sm ${cls[x.level]}`}>
          <span>{icon[x.level]}</span>
          <span className="flex-1">
            {x.text}
            {x.item != null && onPick && (
              <button className="ml-2 text-xs text-slate-500 underline hover:text-slate-300" onClick={() => onPick(x.item!)}>
                к треку №{x.item + 1}
              </button>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

export const SECTION_COLORS: Record<string, string> = {
  intro: "#38bdf8",
  buildup: "#fbbf24",
  main: "#f43f5e",
  breakdown: "#a78bfa",
  outro: "#2dd4bf",
};
export const SECTION_LABELS: Record<string, string> = {
  intro: "Интро",
  buildup: "Подъём",
  main: "Дроп / Main",
  breakdown: "Брейк",
  outro: "Аутро",
};
export const BLOCK_LABELS = { warmup: "Разминка", main: "Основная часть", cooldown: "Заминка" } as const;
export const BLOCK_COLORS = { warmup: "#f59e0b", main: "#ef4444", cooldown: "#38bdf8" } as const;
