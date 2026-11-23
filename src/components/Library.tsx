"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { delAudio, getAudio, listAudioIds } from "@/lib/audio";
import { parseCamelot } from "@/lib/camelot";
import { DEMO_SPECS, synthDemo, toWavBlob } from "@/lib/demo";
import { ingestFile, LIMITS } from "@/lib/ingest";
import { fmtTime } from "@/lib/planner";
import type { Track } from "@/lib/types";
import { btn, btnDanger, btnPrimary, CamelotBadge, Conf, EnergyBar, Panel } from "./ui";
import { camelotColor } from "@/lib/camelot";

interface QItem {
  id: number;
  name: string;
  p: number;
  label: string;
  error?: string;
  done?: boolean;
}

function arc(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number) {
  const pt = (r: number, a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = pt(r1, a0);
  const [x1, y1] = pt(r1, a1);
  const [x2, y2] = pt(r0, a1);
  const [x3, y3] = pt(r0, a0);
  return `M${x0},${y0} A${r1},${r1} 0 0 1 ${x1},${y1} L${x2},${y2} A${r0},${r0} 0 0 0 ${x3},${y3} Z`;
}

function CamelotWheel({ counts, selected, onSelect }: { counts: Record<string, number>; selected: string; onSelect: (c: string) => void }) {
  const cells: React.ReactNode[] = [];
  for (let n = 1; n <= 12; n++) {
    for (const l of ["B", "A"] as const) {
      const code = `${n}${l}`;
      const mid = ((n - 1) * 30 - 90) * (Math.PI / 180);
      const a0 = mid - (14.2 * Math.PI) / 180;
      const a1 = mid + (14.2 * Math.PI) / 180;
      const [r0, r1] = l === "B" ? [74, 104] : [42, 72];
      const rm = (r0 + r1) / 2;
      const c = counts[code] ?? 0;
      cells.push(
        <g key={code} onClick={() => onSelect(selected === code ? "" : code)} style={{ cursor: "pointer" }}>
          <path d={arc(110, 110, r0, r1, a0, a1)} fill={camelotColor(code)} opacity={c ? (selected && selected !== code ? 0.35 : 1) : 0.18} stroke={selected === code ? "#fff" : "#0a0e14"} strokeWidth={selected === code ? 2 : 1} />
          <text x={110 + rm * Math.cos(mid)} y={110 + rm * Math.sin(mid) - 1} textAnchor="middle" fontSize="8.5" fill="#fff" fontWeight="700">{code}</text>
          <text x={110 + rm * Math.cos(mid)} y={110 + rm * Math.sin(mid) + 9} textAnchor="middle" fontSize="8" fill="#fff" opacity={0.85}>{c || ""}</text>
        </g>,
      );
    }
  }
  return (
    <svg viewBox="0 0 220 220" className="mx-auto w-full max-w-[230px]">
      {cells}
      <text x="110" y="107" textAnchor="middle" fontSize="9" fill="#94a3b8">Camelot</text>
      <text x="110" y="119" textAnchor="middle" fontSize="7.5" fill="#64748b">клик — фильтр</text>
    </svg>
  );
}

export default function Library() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [audioIds, setAudioIds] = useState<Set<string>>(new Set());
  const [queue, setQueue] = useState<QItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [cam, setCam] = useState("");
  const [bpmMin, setBpmMin] = useState("");
  const [bpmMax, setBpmMax] = useState("");
  const [enMin, setEnMin] = useState("");
  const [enMax, setEnMax] = useState("");
  const [voc, setVoc] = useState("");
  const [pl, setPl] = useState("");
  const [tag, setTag] = useState("");
  const [sort, setSort] = useState("added");
  const [desc, setDesc] = useState(true);
  const [group, setGroup] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkPl, setBulkPl] = useState("");
  const [bulkTag, setBulkTag] = useState("");
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const dropRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      setTracks(await api.listTracks());
      setAudioIds(await listAudioIds());
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка загрузки библиотеки");
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const upd = (id: number, patch: Partial<QItem>) => setQueue((qq) => qq.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  async function process(items: { file: File; demo?: (typeof DEMO_SPECS)[number] }[]) {
    setBusy(true);
    const base = Date.now();
    setQueue((qq) => [...qq.filter((x) => !x.done), ...items.map((it, i) => ({ id: base + i, name: it.file.name, p: 0, label: "В очереди" }))]);
    for (let i = 0; i < items.length; i++) {
      const id = base + i;
      try {
        await ingestFile(items[i].file, (p, label) => upd(id, { p, label }), items[i].demo);
        upd(id, { p: 1, label: "Готово", done: true });
      } catch (e) {
        upd(id, { error: e instanceof Error ? e.message : "Ошибка анализа", label: "Ошибка" });
      }
      await reload();
    }
    setBusy(false);
  }

  async function addDemo() {
    const files: { file: File; demo: (typeof DEMO_SPECS)[number] }[] = [];
    setBusy(true);
    setQueue([{ id: 1, name: "Синтез демо-треков…", p: 0.1, label: "Генерация аудио" }]);
    for (const [i, spec] of DEMO_SPECS.entries()) {
      await new Promise((r) => setTimeout(r, 0));
      const blob = toWavBlob(synthDemo(spec));
      files.push({ file: new File([blob], `${spec.artist} - ${spec.title}.wav`, { type: "audio/wav" }), demo: spec });
      setQueue([{ id: 1, name: "Синтез демо-треков…", p: (i + 1) / DEMO_SPECS.length, label: `Сгенерировано ${i + 1}/${DEMO_SPECS.length}` }]);
    }
    await process(files);
  }

  async function play(t: Track) {
    if (playing === t.id) {
      audioRef.current?.pause();
      setPlaying(null);
      return;
    }
    const blob = await getAudio(t.id);
    if (!blob) return alert("Аудиофайл этого трека не найден в данном браузере.");
    audioRef.current?.pause();
    const a = new Audio(URL.createObjectURL(blob));
    a.onended = () => setPlaying(null);
    audioRef.current = a;
    void a.play();
    setPlaying(t.id);
  }
  useEffect(() => () => audioRef.current?.pause(), []);

  const playlists = useMemo(() => [...new Set(tracks.map((t) => t.playlist).filter(Boolean))], [tracks]);
  const allTags = useMemo(() => [...new Set(tracks.flatMap((t) => t.tags))], [tracks]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    tracks.forEach((t) => (c[t.camelot] = (c[t.camelot] ?? 0) + 1));
    return c;
  }, [tracks]);

  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase();
    let r = tracks.filter((t) => {
      if (ql && !`${t.title} ${t.artist} ${t.genre} ${t.tags.join(" ")}`.toLowerCase().includes(ql)) return false;
      if (cam && t.camelot !== cam) return false;
      if (bpmMin && t.bpm < +bpmMin) return false;
      if (bpmMax && t.bpm > +bpmMax) return false;
      if (enMin && t.energy < +enMin) return false;
      if (enMax && t.energy > +enMax) return false;
      if (voc === "yes" && !t.hasVocals) return false;
      if (voc === "no" && t.hasVocals) return false;
      if (pl && t.playlist !== pl) return false;
      if (tag && !t.tags.includes(tag)) return false;
      return true;
    });
    const camKey = (c: string) => {
      const p = parseCamelot(c);
      return p ? p.n * 2 + (p.l === "B" ? 1 : 0) : 99;
    };
    const val = (t: Track): number | string =>
      sort === "title" ? t.title.toLowerCase() : sort === "bpm" ? t.bpm : sort === "camelot" ? camKey(t.camelot) : sort === "energy" ? t.energy : sort === "duration" ? t.duration : sort === "priority" ? t.priority : t.createdAt ?? "";
    r = [...r].sort((a, b) => {
      if (group) {
        const d = camKey(a.camelot) - camKey(b.camelot);
        if (d) return d;
      }
      const x = val(a);
      const y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * (desc ? -1 : 1);
    });
    return r;
  }, [tracks, q, cam, bpmMin, bpmMax, enMin, enMax, voc, pl, tag, sort, desc, group]);

  const toggleSel = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function bulk(fn: (t: Track) => Partial<Track> | null) {
    for (const t of tracks.filter((x) => sel.has(x.id))) {
      const patch = fn(t);
      if (patch) await api.updateTrack(t.id, patch);
    }
    await reload();
  }
  async function remove(ids: string[]) {
    if (!confirm(`Удалить ${ids.length} трек(ов) из библиотеки и из браузера?`)) return;
    for (const id of ids) {
      await api.deleteTrack(id);
      await delAudio(id).catch(() => {});
    }
    setSel(new Set());
    await reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Библиотека треков</h1>
          <p className="text-sm text-slate-400">Загрузите свои треки — сервис определит BPM, тональность (Camelot), сетку долей, секции, энергию и вокал.</p>
        </div>
        <div className="flex gap-2">
          <button className={btn} disabled={busy} onClick={addDemo} title="Синтетический набор из 20 треков для проверки всей цепочки без своей музыки">
            ✨ Демо-набор (20 треков)
          </button>
          <button className={btnPrimary} disabled={busy} onClick={() => dropRef.current?.click()}>
            ＋ Загрузить аудио
          </button>
          <input ref={dropRef} type="file" accept={LIMITS.exts.map((e) => "." + e).join(",")} multiple hidden onChange={(e) => e.target.files && void process([...e.target.files].map((file) => ({ file })))} />
        </div>
      </div>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!busy) void process([...e.dataTransfer.files].map((file) => ({ file })));
        }}
        className="rounded-2xl border-2 border-dashed border-slate-700 bg-slate-900/30 p-4 text-center text-sm text-slate-400"
      >
        Перетащите файлы сюда ({LIMITS.exts.join(", ")}; до {LIMITS.maxBytes / 1048576} МБ и {LIMITS.maxDurationSec / 60} мин). Анализ выполняется локально в браузере.
      </div>

      {queue.length > 0 && (
        <Panel title="Очередь анализа" right={<button className="text-xs text-slate-500 underline" onClick={() => setQueue([])}>очистить</button>}>
          <ul className="space-y-2">
            {queue.map((x) => (
              <li key={x.id} className="text-sm">
                <div className="flex justify-between gap-2">
                  <span className="truncate">{x.name}</span>
                  <span className={x.error ? "text-rose-400" : "text-slate-400"}>{x.error ?? x.label}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-800">
                  <div className={`h-full ${x.error ? "bg-rose-500" : "bg-cyan-400"}`} style={{ width: `${Math.round((x.error ? 1 : x.p) * 100)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {err && <div className="rounded-xl border border-rose-900 bg-rose-950/40 p-3 text-sm text-rose-300">{err}</div>}

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="space-y-4">
          <Panel title="Камелот-колесо">
            <CamelotWheel counts={counts} selected={cam} onSelect={setCam} />
            <p className="mt-2 text-center text-xs text-slate-500">Всего треков: {tracks.length}</p>
          </Panel>
          <Panel title="Фильтры">
            <div className="grid gap-2">
              <input placeholder="Поиск: название, артист, тег…" value={q} onChange={(e) => setQ(e.target.value)} />
              <div className="grid grid-cols-2 gap-2">
                <input placeholder="BPM от" type="number" value={bpmMin} onChange={(e) => setBpmMin(e.target.value)} />
                <input placeholder="BPM до" type="number" value={bpmMax} onChange={(e) => setBpmMax(e.target.value)} />
                <input placeholder="Энергия от" type="number" value={enMin} onChange={(e) => setEnMin(e.target.value)} />
                <input placeholder="Энергия до" type="number" value={enMax} onChange={(e) => setEnMax(e.target.value)} />
              </div>
              <select value={voc} onChange={(e) => setVoc(e.target.value)}>
                <option value="">Вокал: любой</option>
                <option value="yes">С вокалом</option>
                <option value="no">Инструментал</option>
              </select>
              <select value={pl} onChange={(e) => setPl(e.target.value)}>
                <option value="">Плейлист: все</option>
                {playlists.map((p) => <option key={p}>{p}</option>)}
              </select>
              <select value={tag} onChange={(e) => setTag(e.target.value)}>
                <option value="">Тег: любой</option>
                {allTags.map((p) => <option key={p}>{p}</option>)}
              </select>
              <button className={btn} onClick={() => { setQ(""); setCam(""); setBpmMin(""); setBpmMax(""); setEnMin(""); setEnMax(""); setVoc(""); setPl(""); setTag(""); }}>Сбросить</button>
            </div>
          </Panel>
        </div>

        <Panel
          title={`Треки (${shown.length})`}
          right={
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <label className="flex items-center gap-1"><input type="checkbox" checked={group} onChange={(e) => setGroup(e.target.checked)} /> группировать по Camelot</label>
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="added">Добавлено</option>
                <option value="title">Название</option>
                <option value="bpm">BPM</option>
                <option value="camelot">Camelot</option>
                <option value="energy">Энергия</option>
                <option value="duration">Длительность</option>
                <option value="priority">Приоритет</option>
              </select>
              <button className={btn} onClick={() => setDesc((d) => !d)}>{desc ? "↓" : "↑"}</button>
            </div>
          }
        >
          {sel.size > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-slate-800/60 p-2 text-sm">
              <span>Выбрано: {sel.size}</span>
              <input placeholder="Плейлист…" list="pls" className="w-36" value={bulkPl} onChange={(e) => setBulkPl(e.target.value)} />
              <datalist id="pls">{playlists.map((p) => <option key={p} value={p} />)}</datalist>
              <button className={btn} onClick={() => bulk(() => ({ playlist: bulkPl }))}>В плейлист</button>
              <input placeholder="Тег…" className="w-28" value={bulkTag} onChange={(e) => setBulkTag(e.target.value)} />
              <button className={btn} onClick={() => bulkTag && bulk((t) => (t.tags.includes(bulkTag) ? null : { tags: [...t.tags, bulkTag] }))}>+ тег</button>
              <button className={btnDanger} onClick={() => remove([...sel])}>Удалить</button>
            </div>
          )}
          {loading ? (
            <p className="py-10 text-center text-slate-500">Загрузка…</p>
          ) : shown.length === 0 ? (
            <div className="py-12 text-center text-slate-400">
              <p className="text-lg">Библиотека пуста</p>
              <p className="mt-1 text-sm">Загрузите аудио или нажмите «Демо-набор», чтобы сразу попробовать сборку микса.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="w-8"><input type="checkbox" checked={sel.size === shown.length} onChange={(e) => setSel(e.target.checked ? new Set(shown.map((t) => t.id)) : new Set())} /></th>
                    <th className="w-8" />
                    <th>Трек</th>
                    <th>Время</th>
                    <th>BPM</th>
                    <th>Camelot</th>
                    <th>Энергия</th>
                    <th>Вокал</th>
                    <th>Теги / плейлист</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((t) => (
                    <tr key={t.id} className="border-t border-slate-800/80 hover:bg-slate-800/30">
                      <td><input type="checkbox" checked={sel.has(t.id)} onChange={() => toggleSel(t.id)} /></td>
                      <td>
                        <button className="text-lg text-cyan-300 disabled:opacity-30" disabled={!audioIds.has(t.id)} title={audioIds.has(t.id) ? "Прослушать" : "Файла нет в этом браузере"} onClick={() => play(t)}>
                          {playing === t.id ? "⏸" : "▶"}
                        </button>
                      </td>
                      <td className="max-w-[260px] py-2">
                        <Link href={`/track/${t.id}`} className="block truncate font-medium hover:text-cyan-300">{t.title || t.filename}</Link>
                        <span className="block truncate text-xs text-slate-500">{t.artist || "—"}{t.genre ? ` · ${t.genre}` : ""}</span>
                      </td>
                      <td className="tabular-nums text-slate-400">{fmtTime(t.duration)}</td>
                      <td>
                        <div className="flex flex-col gap-0.5">
                          <span className="font-semibold tabular-nums">{t.bpm.toFixed(1)}</span>
                          <Conf v={t.bpmConfidence} />
                        </div>
                      </td>
                      <td>
                        <div className="flex flex-col gap-0.5">
                          <CamelotBadge code={t.camelot} />
                          <Conf v={t.keyConfidence} />
                        </div>
                      </td>
                      <td><EnergyBar v={t.energy} /></td>
                      <td title={`Уверенность ${Math.round(t.vocalConfidence * 100)}%`}>{t.hasVocals ? "🎤" : <span className="text-slate-600">инстр.</span>}</td>
                      <td className="max-w-[200px]">
                        <div className="flex flex-wrap gap-1">
                          {t.playlist && <span className="rounded bg-indigo-500/20 px-1.5 text-xs text-indigo-300">≡ {t.playlist}</span>}
                          {t.tags.map((g) => <span key={g} className="rounded bg-slate-700/60 px-1.5 text-xs text-slate-300">{g}</span>)}
                          {t.noStretch && <span className="rounded bg-amber-500/20 px-1.5 text-xs text-amber-300">без stretch</span>}
                          {!audioIds.has(t.id) && <span className="rounded bg-rose-500/20 px-1.5 text-xs text-rose-300">нет аудио</span>}
                        </div>
                      </td>
                      <td className="text-right"><Link href={`/track/${t.id}`} className="text-xs text-slate-400 hover:text-cyan-300">анализ →</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
