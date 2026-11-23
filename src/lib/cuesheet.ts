import { fmtTime, itemTimes, TRANSITION_INFO } from "./planner";
import type { MixSettings, Plan, Track } from "./types";

const srcTime = (t: Track, bar: number) => fmtTime(t.firstDownbeat + (bar * 240) / t.bpm);

export function cueRows(plan: Plan, settings: MixSettings, tracks: Map<string, Track>) {
  const { tm, times } = itemTimes(plan, settings);
  return plan.items.map((it, i) => {
    const t = tracks.get(it.trackId)!;
    const next = plan.items[i + 1];
    return {
      n: i + 1,
      start: fmtTime(times[i].start),
      end: fmtTime(times[i].end),
      artist: t.artist,
      title: t.title,
      block: it.block,
      srcBpm: t.bpm,
      mixBpmStart: tm.bpmAtBeat(it.startBeat),
      mixBpmEnd: tm.bpmAtBeat(it.endBeat),
      camelot: t.camelot,
      key: t.key,
      energy: t.energy,
      inBar: it.inBar,
      outBar: it.outBar,
      inSrc: srcTime(t, it.inBar),
      outSrc: srcTime(t, it.outBar),
      stretch: `${((it.stretchMin - 1) * 100).toFixed(1)}…${((it.stretchMax - 1) * 100).toFixed(1)}%`,
      trans: it.trans ? `${TRANSITION_INFO[it.trans.type].label}, ${it.trans.bars} т.` : "—",
      transAt: next ? fmtTime(times[i + 1].start) : "",
      warnings: [...it.issues, ...(it.trans?.issues ?? [])].filter((x) => x.level !== "info").map((x) => x.text),
    };
  });
}

export function cueSheetText(name: string, plan: Plan, settings: MixSettings, tracks: Map<string, Track>): string {
  const rows = cueRows(plan, settings, tracks);
  const L: string[] = [];
  L.push(`CUE SHEET — ${name}`);
  L.push(`Создано: ${new Date().toLocaleString("ru-RU")}   Длительность: ${fmtTime(plan.report.totalSec)}   Треков: ${rows.length}`);
  L.push(`Кривая темпа: разминка ${settings.bpmStart} → основная ${settings.bpmTarget} → заминка ${settings.bpmEnd} BPM (${settings.curveShape === "ease" ? "S-кривая" : "линейная"}), лимит растяжения ±${settings.maxStretch}%`);
  L.push(`Качество микса: ${plan.report.score}/100`);
  L.push("=".repeat(100));
  for (const r of rows) {
    L.push(`${String(r.n).padStart(2, "0")}  ${r.start}–${r.end}  [${r.block}]  ${r.artist ? r.artist + " — " : ""}${r.title}`);
    L.push(`    BPM ${r.srcBpm.toFixed(1)} → ${r.mixBpmStart.toFixed(1)}…${r.mixBpmEnd.toFixed(1)} (stretch ${r.stretch})  Camelot ${r.camelot || "?"} (${r.key || "?"})  Energy ${r.energy}`);
    L.push(`    Вход: такт ${r.inBar} (${r.inSrc} в исходнике)   Выход: такт ${r.outBar} (${r.outSrc} в исходнике)`);
    if (r.transAt) L.push(`    Переход → ${r.trans}, начало микса в ${r.transAt}`);
    for (const w of r.warnings) L.push(`    ! ${w}`);
  }
  L.push("=".repeat(100));
  L.push("Внимание: используйте треки только при наличии прав/лицензий на публичное исполнение и сведение.");
  return L.join("\n");
}

export function cueSheetCsv(plan: Plan, settings: MixSettings, tracks: Map<string, Track>): string {
  const rows = cueRows(plan, settings, tracks);
  const head = ["#", "start", "end", "block", "artist", "title", "src_bpm", "mix_bpm_start", "mix_bpm_end", "camelot", "key", "energy", "in_bar", "out_bar", "in_src", "out_src", "stretch", "transition", "transition_at", "warnings"];
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  return [head.join(","), ...rows.map((r) => [r.n, r.start, r.end, r.block, r.artist, r.title, r.srcBpm, r.mixBpmStart.toFixed(2), r.mixBpmEnd.toFixed(2), r.camelot, r.key, r.energy, r.inBar, r.outBar, r.inSrc, r.outSrc, r.stretch, r.trans, r.transAt, r.warnings.join(" | ")].map(esc).join(","))].join("\n");
}

export function download(name: string, data: Blob | string, type = "text/plain") {
  const blob = typeof data === "string" ? new Blob([data], { type: type + ";charset=utf-8" }) : data;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
