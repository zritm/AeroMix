"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { analyzeBuffer, hotCuesFromSections } from "@/lib/analysis";
import { api } from "@/lib/api";
import { decodeBlob, getAudio } from "@/lib/audio";
import { ALL_KEYS, camelotFromKey } from "@/lib/camelot";
import { fmtTime, mainStartBar, outroStartBar } from "@/lib/planner";
import type { Section, SectionType, Track } from "@/lib/types";
import Waveform from "./Waveform";
import { btn, btnPrimary, CamelotBadge, Conf, EnergyBar, Field, Panel, SECTION_COLORS, SECTION_LABELS } from "./ui";

const TYPES: SectionType[] = ["intro", "buildup", "main", "breakdown", "outro"];

export default function TrackView({ id }: { id: string }) {
  const [orig, setOrig] = useState<Track | null>(null);
  const [t, setT] = useState<Track | null>(null);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState("");
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    api.getTrack(id).then((x) => { setOrig(x); setT(x); }).catch((e) => setErr(e.message));
    let u: string | null = null;
    getAudio(id).then((b) => { if (b) { u = URL.createObjectURL(b); setUrl(u); } });
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [id]);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      if (audio.current && !audio.current.paused) setPlayhead(audio.current.currentTime);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const dirty = useMemo(() => JSON.stringify(orig) !== JSON.stringify(t), [orig, t]);
  if (err) return <p className="text-rose-400">Ошибка: {err}</p>;
  if (!t) return <p className="text-slate-500">Загрузка…</p>;

  const set = (patch: Partial<Track>, edit?: string) =>
    setT((cur) => (cur ? { ...cur, ...patch, edits: edit && !cur.edits.includes(edit) ? [...cur.edits, edit] : cur.edits } : cur));
  const barDur = 240 / t.bpm;
  const ms = mainStartBar(t);
  const os = outroStartBar(t);
  const setSections = (s: Section[]) => set({ sections: [...s].sort((a, b) => a.startBar - b.startBar) }, "sections");
  const updSec = (i: number, p: Partial<Section>) => setSections(t.sections.map((s, k) => (k === i ? { ...s, ...p } : s)));

  const seekBar = (bar: number) => {
    if (!audio.current) return;
    audio.current.currentTime = t.firstDownbeat + bar * barDur;
    void audio.current.play();
  };

  async function save() {
    setSaving(true);
    try {
      const { id: _i, createdAt: _c, updatedAt: _u, ...patch } = t!;
      const saved = await api.updateTrack(id, patch);
      setOrig(saved);
      setT(saved);
      setMsg("Сохранено");
    } catch (e) {
      setMsg("Ошибка сохранения: " + (e instanceof Error ? e.message : ""));
    }
    setSaving(false);
    setTimeout(() => setMsg(""), 3000);
  }

  async function reanalyze() {
    const blob = await getAudio(id);
    if (!blob) return setMsg("Аудиофайл не найден в браузере — повторный анализ невозможен");
    setBusy("Анализ…");
    try {
      const r = await analyzeBuffer(await decodeBlob(blob), (p, l) => setBusy(`${l} ${Math.round(p * 100)}%`));
      set({
        bpm: r.bpm, bpmConfidence: r.bpmConfidence, key: r.key, camelot: r.camelot, keyConfidence: r.keyConfidence, energy: r.energy,
        density: r.density, dryness: r.dryness, hasVocals: r.hasVocals, vocalConfidence: r.vocalConfidence, firstDownbeat: r.firstDownbeat,
        gridConfidence: r.gridConfidence, totalBars: r.totalBars, rmsDb: r.rmsDb, sections: r.sections, cues: { in: null, out: null, hot: r.hot }, edits: [],
      });
    } catch (e) {
      setMsg("Ошибка анализа: " + (e instanceof Error ? e.message : ""));
    }
    setBusy("");
  }

  const markers = [
    ...t.cues.hot.map((h) => ({ bar: h.bar, label: h.name, color: "#facc15" })),
    { bar: ms, label: "IN", color: "#22d3ee" },
    { bar: os, label: "OUT", color: "#f472b6" },
  ];
  const setBpm = (v: number) => set({ bpm: Math.max(40, Math.min(240, Math.round(v * 100) / 100)), bpmConfidence: Math.max(t.bpmConfidence, 0.5) }, "bpm");
  const shiftGrid = (sec: number) => set({ firstDownbeat: Math.max(0, Math.round((t.firstDownbeat + sec) * 1000) / 1000) }, "grid");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/" className="text-xs text-slate-500 hover:text-slate-300">← Библиотека</Link>
          <h1 className="text-2xl font-bold">{t.title || t.filename}</h1>
          <p className="text-sm text-slate-400">{t.artist || "Без исполнителя"} · {fmtTime(t.duration)} · {t.format.toUpperCase()} · {(t.sizeBytes / 1048576).toFixed(1)} МБ</p>
        </div>
        <div className="flex items-center gap-2">
          {msg && <span className="text-sm text-emerald-400">{msg}</span>}
          <button className={btn} onClick={reanalyze} disabled={!!busy}>{busy || "↻ Пере-анализ"}</button>
          <button className={btn} onClick={() => setT(orig)} disabled={!dirty}>Отменить правки</button>
          <button className={btnPrimary} onClick={save} disabled={!dirty || saving}>{saving ? "Сохранение…" : "Сохранить"}</button>
        </div>
      </div>

      <Panel
        title="Волна, секции, сетка тактов и cue-точки"
        right={
          <div className="flex items-center gap-2">
            <button className={btn} onClick={() => { if (!audio.current) return; if (audio.current.paused) void audio.current.play(); else audio.current.pause(); }} disabled={!url}>{playing ? "⏸ Пауза" : "▶ Играть"}</button>
            <button className={btn} onClick={() => seekBar(ms)} disabled={!url}>▶ с IN</button>
            <button className={btn} onClick={() => seekBar(Math.max(0, os - 8))} disabled={!url}>▶ перед OUT</button>
          </div>
        }
      >
        <Waveform peaks={t.waveform} duration={t.duration} height={150} sections={t.sections} bpm={t.bpm} firstDownbeat={t.firstDownbeat} markers={markers} playhead={playhead} onSeek={(s) => { if (audio.current) { audio.current.currentTime = s; setPlayhead(s); } }} />
        {url ? <audio ref={(el) => { audio.current = el; }} src={url} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} /> : <p className="mt-2 text-xs text-amber-400">Аудиофайл не найден в этом браузере: прослушивание и пере-анализ недоступны.</p>}
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-400">
          {TYPES.map((k) => <span key={k} className="flex items-center gap-1"><i className="inline-block h-2 w-3 rounded-sm" style={{ background: SECTION_COLORS[k] }} />{SECTION_LABELS[k]}</span>)}
          <span><i className="mr-1 inline-block h-2 w-3 bg-cyan-400" />IN — вход (начало main/дропа)</span>
          <span><i className="mr-1 inline-block h-2 w-3 bg-pink-400" />OUT — начало зоны выхода</span>
          <span><i className="mr-1 inline-block h-2 w-3 bg-yellow-400" />hot cue</span>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Результаты анализа">
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2.5 text-sm">
            <dt className="text-slate-400">BPM</dt>
            <dd className="flex items-center gap-2"><b className="text-lg tabular-nums">{t.bpm.toFixed(2)}</b><Conf v={t.bpmConfidence} label={`${Math.round(t.bpmConfidence * 100)}%`} /></dd>
            <dt className="text-slate-400">Тональность</dt>
            <dd className="flex items-center gap-2"><CamelotBadge code={t.camelot} /> <span>{t.key}</span><Conf v={t.keyConfidence} label={`${Math.round(t.keyConfidence * 100)}%`} /></dd>
            <dt className="text-slate-400">Сетка / даунбит</dt>
            <dd className="flex items-center gap-2">с {t.firstDownbeat.toFixed(3)} с · {t.totalBars} тактов<Conf v={t.gridConfidence} label={`${Math.round(t.gridConfidence * 100)}%`} /></dd>
            <dt className="text-slate-400">Энергия</dt>
            <dd><EnergyBar v={t.energy} /></dd>
            <dt className="text-slate-400">Плотность</dt>
            <dd className="tabular-nums">{t.density}%</dd>
            <dt className="text-slate-400">«Сухость»</dt>
            <dd className="tabular-nums" title="Доля тактов с малым количеством тональной мелодики (барабаны/бит)">{t.dryness}%</dd>
            <dt className="text-slate-400">Вокал</dt>
            <dd className="flex items-center gap-2">{t.hasVocals ? "🎤 есть" : "инструментал"}<Conf v={t.vocalConfidence} label="эвристика" /></dd>
            <dt className="text-slate-400">Громкость (RMS)</dt>
            <dd className="tabular-nums">{t.rmsDb.toFixed(1)} dBFS</dd>
          </dl>
          <p className="mt-3 rounded-lg bg-slate-800/50 p-2 text-xs leading-relaxed text-slate-400">
            Уверенность — это оценка надёжности алгоритма, а не гарантия. Для BPM/сетки низкая уверенность (&lt;40%) означает, что стоит проверить на слух и поправить. Определение вокала — упрощённая эвристика по тональной энергии средних частот: отметьте вокал вручную, если ошибка.
          </p>
          {t.edits.length > 0 && <p className="mt-2 text-xs text-amber-300">Исправлено вручную: {t.edits.join(", ")}</p>}
        </Panel>

        <Panel title="Метаданные и ручная коррекция">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Название"><input value={t.title} onChange={(e) => set({ title: e.target.value })} /></Field>
            <Field label="Исполнитель"><input value={t.artist} onChange={(e) => set({ artist: e.target.value })} /></Field>
            <Field label="Жанр"><input value={t.genre} onChange={(e) => set({ genre: e.target.value })} /></Field>
            <Field label="Плейлист"><input value={t.playlist} onChange={(e) => set({ playlist: e.target.value })} /></Field>
            <Field label="Теги (через запятую)" hint="«разминка», «заминка», «main» влияют на подбор">
              <input defaultValue={t.tags.join(", ")} key={t.id + t.updatedAt} onBlur={(e) => set({ tags: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
            </Field>
            <Field label={`Приоритет: ${t.priority}`} hint="1 — реже, 5 — чаще попадает в микс">
              <input type="range" min={1} max={5} value={t.priority} onChange={(e) => set({ priority: +e.target.value })} />
            </Field>
            <Field label={`Энергия: ${t.energy}`}>
              <input type="range" min={0} max={100} value={t.energy} onChange={(e) => set({ energy: +e.target.value }, "energy")} />
            </Field>
            <Field label="Тональность">
              <select value={t.key} onChange={(e) => set({ key: e.target.value, camelot: camelotFromKey(e.target.value), keyConfidence: Math.max(t.keyConfidence, 0.6) }, "key")}>
                {!ALL_KEYS.some((k) => k.key === t.key) && <option value={t.key}>{t.key || "—"}</option>}
                {ALL_KEYS.map((k) => <option key={k.key} value={k.key}>{k.camelot} · {k.key}</option>)}
              </select>
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={t.hasVocals} onChange={(e) => set({ hasVocals: e.target.checked, vocalConfidence: 1 }, "vocal")} /> Есть вокал</label>
            <label className="flex items-center gap-2" title="Трек играет в оригинальном темпе, без time-stretch"><input type="checkbox" checked={t.noStretch} onChange={(e) => set({ noStretch: e.target.checked })} /> Не подгонять под общий темп</label>
          </div>
          <div className="mt-4 space-y-2 rounded-xl bg-slate-800/40 p-3">
            <p className="text-xs font-semibold uppercase text-slate-400">BPM</p>
            <div className="flex flex-wrap items-center gap-2">
              <input type="number" step={0.01} className="w-24" value={t.bpm} onChange={(e) => setBpm(+e.target.value)} />
              <button className={btn} onClick={() => setBpm(t.bpm / 2)}>÷2</button>
              <button className={btn} onClick={() => setBpm(t.bpm * 2)}>×2</button>
              <button className={btn} onClick={() => setBpm(t.bpm - 0.05)}>−0.05</button>
              <button className={btn} onClick={() => setBpm(t.bpm + 0.05)}>+0.05</button>
            </div>
            <p className="text-xs font-semibold uppercase text-slate-400">Сетка (первый даунбит)</p>
            <div className="flex flex-wrap items-center gap-2">
              <button className={btn} onClick={() => shiftGrid(-60 / t.bpm)}>◀ −1 доля</button>
              <button className={btn} onClick={() => shiftGrid(-0.01)}>−10 мс</button>
              <button className={btn} onClick={() => shiftGrid(0.01)}>+10 мс</button>
              <button className={btn} onClick={() => shiftGrid(60 / t.bpm)}>+1 доля ▶</button>
            </div>
            <p className="text-[11px] text-slate-500">Сетка предполагает постоянный темп. Если даунбит определён на неверной доле — сдвиньте на ±1 долю (кнопки «▶ с IN» помогают проверить на слух).</p>
          </div>
        </Panel>

        <Panel title="Cue-точки">
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <Field label={`IN — вход (такт), авто: ${t.sections.find((s) => s.type === "main")?.startBar ?? 0}`} hint="Сюда попадает «дроп» при входе в микс">
                <div className="flex gap-1"><input type="number" className="w-20" value={t.cues.in ?? ""} placeholder="авто" onChange={(e) => set({ cues: { ...t.cues, in: e.target.value === "" ? null : +e.target.value } }, "cues")} /><button className={btn} onClick={() => set({ cues: { ...t.cues, in: null } })}>авто</button></div>
              </Field>
              <Field label="OUT — начало зоны выхода (такт)" hint="Переход на следующий трек начинается около этой зоны">
                <div className="flex gap-1"><input type="number" className="w-20" value={t.cues.out ?? ""} placeholder="авто" onChange={(e) => set({ cues: { ...t.cues, out: e.target.value === "" ? null : +e.target.value } }, "cues")} /><button className={btn} onClick={() => set({ cues: { ...t.cues, out: null } })}>авто</button></div>
              </Field>
            </div>
            <div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase text-slate-400">Hot cues / memory cues</p><button className="text-xs text-cyan-300 underline" onClick={() => set({ cues: { ...t.cues, hot: hotCuesFromSections(t.sections) } }, "cues")}>из секций</button></div>
            <ul className="space-y-1.5">
              {t.cues.hot.map((h, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  <input className="w-32" value={h.name} onChange={(e) => set({ cues: { ...t.cues, hot: t.cues.hot.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)) } }, "cues")} />
                  <input type="number" className="w-16" value={h.bar} onChange={(e) => set({ cues: { ...t.cues, hot: t.cues.hot.map((x, k) => (k === i ? { ...x, bar: +e.target.value } : x)) } }, "cues")} />
                  <span className="text-xs text-slate-500">{fmtTime(t.firstDownbeat + h.bar * barDur)}</span>
                  <button className="text-slate-400 hover:text-cyan-300" disabled={!url} onClick={() => seekBar(h.bar)}>▶</button>
                  <button className="text-slate-500 hover:text-rose-400" onClick={() => set({ cues: { ...t.cues, hot: t.cues.hot.filter((_, k) => k !== i) } }, "cues")}>✕</button>
                </li>
              ))}
            </ul>
            <button className={btn} onClick={() => set({ cues: { ...t.cues, hot: [...t.cues.hot, { name: `Cue ${t.cues.hot.length + 1}`, bar: 0 }] } }, "cues")}>＋ hot cue</button>
          </div>
        </Panel>
      </div>

      <Panel title="Секции (границы в тактах от первого даунбита)" right={<button className={btn} onClick={() => setSections([...t.sections, { type: "main", startBar: t.sections.at(-1)?.endBar ?? 0, endBar: t.totalBars, energy: t.energy, vocal: false, dry: false }])}>＋ секция</button>}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="text-left text-xs uppercase text-slate-500"><tr><th>Тип</th><th>Начало (т.)</th><th>Конец (т.)</th><th>Длина</th><th>Время</th><th>Энергия</th><th>Вокал</th><th>Сухо</th><th /></tr></thead>
            <tbody>
              {t.sections.map((s, i) => (
                <tr key={i} className="border-t border-slate-800/70">
                  <td className="py-1.5"><select value={s.type} onChange={(e) => updSec(i, { type: e.target.value as SectionType })} style={{ borderLeft: `4px solid ${SECTION_COLORS[s.type]}` }}>{TYPES.map((k) => <option key={k} value={k}>{SECTION_LABELS[k]}</option>)}</select></td>
                  <td><input type="number" className="w-20" value={s.startBar} onChange={(e) => updSec(i, { startBar: +e.target.value })} /></td>
                  <td><input type="number" className="w-20" value={s.endBar} onChange={(e) => updSec(i, { endBar: +e.target.value })} /></td>
                  <td className="tabular-nums text-slate-400">{s.endBar - s.startBar} т.</td>
                  <td className="tabular-nums text-slate-400">{fmtTime(t.firstDownbeat + s.startBar * barDur)}</td>
                  <td><EnergyBar v={s.energy} /></td>
                  <td><input type="checkbox" checked={s.vocal} onChange={(e) => updSec(i, { vocal: e.target.checked })} /></td>
                  <td><input type="checkbox" checked={s.dry} onChange={(e) => updSec(i, { dry: e.target.checked })} /></td>
                  <td className="text-right"><button className="text-slate-500 hover:text-rose-400" onClick={() => setSections(t.sections.filter((_, k) => k !== i))}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">Секции задают, где у трека «интро» (его можно сократить при входе), где main/дроп (сюда выравнивается вход), где outro (зона выхода). «Вокал» и «сухо» в секциях используются для проверки вокальных конфликтов и выбора drum-to-drum.</p>
      </Panel>
    </div>
  );
}
