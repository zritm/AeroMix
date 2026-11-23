"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { listAudioIds } from "@/lib/audio";
import { camelotRelation } from "@/lib/camelot";
import { cueSheetCsv, cueSheetText, download } from "@/lib/cuesheet";
import { buildPlan, DEFAULT_SETTINGS, fitPlan, fmtTime, itemTimes, mainStartBar, makeItem, PROFILES, TEMPLATES, TRANSITION_INFO } from "@/lib/planner";
import { MixRenderer } from "@/lib/renderer";
import type { BlockType, MixSettings, Plan, PlanItem, Track, TransitionType } from "@/lib/types";
import { btn, btnDanger, btnPrimary, BLOCK_COLORS, BLOCK_LABELS, CamelotBadge, EnergyBar, Field, IssueList, Panel, SECTION_LABELS } from "../ui";
import Timeline, { type Sel } from "./Timeline";

const BARS = [0, 4, 8, 16, 32];
const BLOCKS: BlockType[] = ["warmup", "main", "cooldown"];

function Num({ label, value, onChange, step = 1, min, max, hint }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      <input type="number" value={value} step={step} min={min} max={max} onChange={(e) => onChange(+e.target.value)} />
    </Field>
  );
}

const secLabel = (t: Track, bar: number) => {
  const s = t.sections.find((x) => bar >= x.startBar && bar < x.endBar);
  return s ? SECTION_LABELS[s.type] : "—";
};

export default function MixClient() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [audioIds, setAudioIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [settings, setSettings] = useState<MixSettings>(DEFAULT_SETTINGS);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [sel, setSel] = useState<Sel>(null);
  const [zoom, setZoom] = useState(0.3);
  const [stale, setStale] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [name, setName] = useState("Новый микс");
  const [msg, setMsg] = useState("");
  const [pickId, setPickId] = useState("");
  const [pairA, setPairA] = useState("");
  const [pairB, setPairB] = useState("");
  const [addId, setAddId] = useState("");
  const [prev, setPrev] = useState<{ i: number; p: number; playing: boolean } | null>(null);
  const [exp, setExp] = useState<{ p: number; label: string } | null>(null);
  const [expErr, setExpErr] = useState("");
  const [license, setLicense] = useState(false);
  const player = useRef<{ ctx: AudioContext; src: AudioBufferSourceNode } | null>(null);
  const abort = useRef<AbortController | null>(null);

  const trackMap = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);

  useEffect(() => {
    (async () => {
      try {
        const [ts, ids] = await Promise.all([api.listTracks(), listAudioIds()]);
        setTracks(ts);
        setAudioIds(ids);
        const pid = new URLSearchParams(location.search).get("project");
        if (pid) {
          const pr = await api.getProject(pid);
          setProjectId(pr.id);
          setName(pr.name);
          const s = { ...DEFAULT_SETTINGS, ...pr.settings };
          setSettings(s);
          if (pr.plan) {
            const m = new Map(ts.map((t) => [t.id, t]));
            const lost = pr.plan.items.filter((i) => !m.has(i.trackId)).length;
            setPlan(fitPlan(pr.plan.items, m, s, lost ? [{ level: "warn", text: `${lost} трек(ов) проекта удалены из библиотеки и убраны из плана.` }] : []));
          }
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Ошибка загрузки");
      }
      setLoading(false);
    })();
    return () => {
      player.current?.src.stop();
      abort.current?.abort();
    };
  }, []);

  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(""), 3500);
  };

  const updateSettings = (patch: Partial<MixSettings>) => {
    const ns = { ...settings, ...patch };
    setSettings(ns);
    setStale(true);
    if (plan) setPlan(fitPlan(plan.items, trackMap, ns, []));
  };
  const refit = (items: PlanItem[]) => setPlan(fitPlan(items, trackMap, settings, []));
  const patchItem = (i: number, patch: Partial<PlanItem>) => plan && refit(plan.items.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  const resetAutoNear = (items: PlanItem[], i: number) =>
    items.map((it, k) => (Math.abs(k - i) <= 2 && it.trans ? { ...it, trans: { ...it.trans, manual: false } } : it));

  const build = () => {
    const p = buildPlan(tracks, settings);
    setPlan(p);
    setSel(null);
    setStale(false);
  };
  const move = (i: number, d: number) => {
    if (!plan) return;
    const j = i + d;
    if (j < 0 || j >= plan.items.length) return;
    const items = [...plan.items];
    [items[i], items[j]] = [items[j], items[i]];
    refit(resetAutoNear(items, Math.min(i, j)));
    setSel({ kind: "item", i: j });
  };
  const removeItem = (i: number) => {
    if (!plan) return;
    refit(resetAutoNear(plan.items.filter((_, k) => k !== i), i));
    setSel(null);
  };
  const addTrack = () => {
    const t = trackMap.get(addId);
    if (!t || !plan) return;
    const at = sel ? sel.i + 1 : plan.items.length;
    const blk = (sel ? plan.items[sel.i]?.block : plan.items[plan.items.length - 1]?.block) ?? "main";
    const items = [...plan.items];
    items.splice(at, 0, makeItem(t, blk, ["Добавлен вручную"]));
    refit(resetAutoNear(items, at));
    setAddId("");
  };

  // ограничения
  const strip = (id: string): Partial<MixSettings> => ({
    pins: { start: settings.pins.start.filter((x) => x !== id), middle: settings.pins.middle.filter((x) => x !== id), end: settings.pins.end.filter((x) => x !== id) },
    excluded: settings.excluded.filter((x) => x !== id),
  });
  const pin = (kind: "start" | "middle" | "end" | "exclude") => {
    if (!pickId) return;
    const s = strip(pickId) as { pins: MixSettings["pins"]; excluded: string[] };
    if (kind === "exclude") s.excluded = [...s.excluded, pickId];
    else s.pins = { ...s.pins, [kind]: [...s.pins[kind], pickId] };
    updateSettings(s);
  };
  const title = (id: string) => trackMap.get(id)?.title ?? "(удалён)";

  const autoBpm = () => {
    if (!tracks.length) return;
    let best = 130;
    let bc = -1;
    for (let b = 100; b <= 160; b++) {
      const c = tracks.filter((t) => Math.abs(t.bpm / b - 1) * 100 <= settings.maxStretch).length - Math.abs(b - 132) * 0.01;
      if (c > bc) {
        bc = c;
        best = b;
      }
    }
    updateSettings({ bpmTarget: best, bpmStart: Math.round(best * 0.88), bpmEnd: Math.round(best * 0.72) });
  };

  const fitCount = tracks.filter((t) => !settings.excluded.includes(t.id) && Math.abs(t.bpm / settings.bpmTarget - 1) * 100 <= settings.maxStretch).length;
  const avgLen = tracks.length ? (tracks.reduce((a, t) => a + t.duration, 0) / tracks.length) * 0.92 : 180;
  const needMain = Math.ceil((settings.mainMin * 60) / avgLen);

  // предпросмотр
  function stopPreview() {
    try {
      player.current?.src.stop();
      void player.current?.ctx.close();
    } catch {}
    player.current = null;
    setPrev(null);
  }
  async function previewTransition(i: number) {
    if (!plan) return;
    stopPreview();
    const missing = [i, i + 1].map((k) => plan.items[k].trackId).filter((id) => !audioIds.has(id));
    if (missing.length) return flash("Нет аудиофайла в этом браузере для предпросмотра");
    try {
      const r = new MixRenderer(plan, settings, trackMap);
      const [c0, c1] = r.previewRangeForTransition(i);
      setPrev({ i, p: 0, playing: false });
      const [L, R] = await r.renderRange(c0, c1, (p) => setPrev({ i, p, playing: false }));
      const ctx = new AudioContext({ sampleRate: 44100 });
      const buf = ctx.createBuffer(2, L.length, 44100);
      buf.copyToChannel(L as Float32Array<ArrayBuffer>, 0);
      buf.copyToChannel(R as Float32Array<ArrayBuffer>, 1);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.onended = () => setPrev(null);
      src.start();
      player.current = { ctx, src };
      setPrev({ i, p: 1, playing: true });
    } catch (e) {
      setPrev(null);
      flash("Ошибка предпросмотра: " + (e instanceof Error ? e.message : ""));
    }
  }

  async function exportAudio() {
    if (!plan) return;
    setExpErr("");
    const missing = plan.items.filter((it) => !audioIds.has(it.trackId));
    if (missing.length) return setExpErr(`Нет аудиофайлов в этом браузере: ${missing.map((m) => title(m.trackId)).join(", ")}`);
    abort.current = new AbortController();
    setExp({ p: 0, label: "Подготовка…" });
    try {
      const r = new MixRenderer(plan, settings, trackMap, abort.current.signal);
      const blob = await r.exportWav((p, label) => setExp({ p, label }));
      download(`${name.replace(/[^\p{L}\p{N}_-]+/gu, "_") || "mix"}.wav`, blob, "audio/wav");
      flash("Микс экспортирован");
    } catch (e) {
      setExpErr(e instanceof DOMException && e.name === "AbortError" ? "Рендер отменён" : "Ошибка рендера: " + (e instanceof Error ? e.message : ""));
    }
    setExp(null);
  }

  async function save() {
    try {
      if (projectId) await api.updateProject(projectId, { name, settings, plan });
      else {
        const id = crypto.randomUUID();
        await api.createProject({ id, name, settings, plan });
        setProjectId(id);
        history.replaceState(null, "", `/mix?project=${id}`);
      }
      flash("Проект сохранён");
    } catch (e) {
      flash("Ошибка сохранения: " + (e instanceof Error ? e.message : ""));
    }
  }

  const times = useMemo(() => (plan ? itemTimes(plan, settings) : null), [plan, settings]);
  const selItem = sel?.kind === "item" && plan ? plan.items[sel.i] : null;
  const selTrans = sel?.kind === "trans" && plan ? plan.items[sel.i] : null;

  if (loading) return <p className="text-slate-500">Загрузка…</p>;
  if (err) return <p className="text-rose-400">Ошибка: {err}</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Сборка микса</h1>
          <p className="text-sm text-slate-400">Разминка → основная часть → заминка. Настройте кривую темпа, соберите план и поправьте вручную.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {msg && <span className="text-sm text-emerald-400">{msg}</span>}
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-52" aria-label="Название проекта" />
          <button className={btn} onClick={save} disabled={!plan}>💾 Сохранить проект</button>
          <Link href="/projects" className={btn}>Проекты</Link>
        </div>
      </div>

      {tracks.length === 0 && (
        <div className="rounded-xl border border-amber-800 bg-amber-950/30 p-4 text-sm text-amber-200">
          В библиотеке нет треков. <Link href="/" className="underline">Загрузите аудио или добавьте демо-набор</Link>, затем вернитесь сюда.
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[370px_1fr]">
        {/* ───── Настройки ───── */}
        <div className="space-y-4">
          <Panel title="Тренировка">
            <div className="grid gap-3">
              <Field label="Профиль" hint={PROFILES[settings.profile]?.note}>
                <select value={settings.profile} onChange={(e) => updateSettings({ profile: e.target.value, ...(PROFILES[e.target.value]?.patch ?? {}) })}>
                  {Object.entries(PROFILES).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
                  <option value="custom">Свой</option>
                </select>
              </Field>
              <Field label="Шаблон длительности">
                <select value={settings.template} onChange={(e) => { const tpl = TEMPLATES[e.target.value]; updateSettings(tpl ? { template: e.target.value, warmupMin: tpl.warmupMin, mainMin: tpl.mainMin, cooldownMin: tpl.cooldownMin } : { template: "custom" }); }}>
                  {Object.entries(TEMPLATES).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
                  <option value="custom">Свой</option>
                </select>
              </Field>
              <div className="grid grid-cols-3 gap-2">
                <Num label="Разминка, мин" value={settings.warmupMin} min={0} onChange={(v) => updateSettings({ warmupMin: v, template: "custom" })} />
                <Num label="Основа, мин" value={settings.mainMin} min={1} onChange={(v) => updateSettings({ mainMin: v, template: "custom" })} />
                <Num label="Заминка, мин" value={settings.cooldownMin} min={0} onChange={(v) => updateSettings({ cooldownMin: v, template: "custom" })} />
              </div>
            </div>
          </Panel>

          <Panel title="Кривая темпа" right={<button className="text-xs text-cyan-300 underline" onClick={autoBpm}>подобрать по библиотеке</button>}>
            <div className="grid grid-cols-3 gap-2">
              <Num label="Старт разминки" value={settings.bpmStart} onChange={(v) => updateSettings({ bpmStart: v, profile: "custom" })} />
              <Num label="Основа (BPM)" value={settings.bpmTarget} onChange={(v) => updateSettings({ bpmTarget: v, profile: "custom" })} />
              <Num label="Конец заминки" value={settings.bpmEnd} onChange={(v) => updateSettings({ bpmEnd: v, profile: "custom" })} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Field label="Форма кривой">
                <select value={settings.curveShape} onChange={(e) => updateSettings({ curveShape: e.target.value as "linear" | "ease" })}>
                  <option value="linear">Линейная</option>
                  <option value="ease">Плавная (S-образная)</option>
                </select>
              </Field>
              <Num label="Макс. растяжение, ±%" value={settings.maxStretch} min={1} max={20} step={0.5} hint="Дальше — предупреждение" onChange={(v) => updateSettings({ maxStretch: v })} />
            </div>
            <p className={`mt-3 rounded-lg p-2 text-xs ${fitCount >= needMain ? "bg-emerald-950/40 text-emerald-300" : "bg-amber-950/40 text-amber-300"}`}>
              В библиотеке {fitCount} треков в пределах ±{settings.maxStretch}% от {settings.bpmTarget} BPM; для основной части нужно ≈{needMain}.
              {fitCount < needMain && " Добавьте треки с близким BPM, расширьте лимит или снимите ограничение «не подгонять»."}
            </p>
          </Panel>

          <Panel title="Энергия и переходы">
            <div className="grid grid-cols-3 gap-2">
              <Num label="Энергия: старт" value={settings.energyStart} min={0} max={100} onChange={(v) => updateSettings({ energyStart: v, profile: "custom" })} />
              <Num label="Основа" value={settings.energyMain} min={0} max={100} onChange={(v) => updateSettings({ energyMain: v, profile: "custom" })} />
              <Num label="Финал" value={settings.energyEnd} min={0} max={100} onChange={(v) => updateSettings({ energyEnd: v, profile: "custom" })} />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {BLOCKS.map((b) => (
                <Field key={b} label={`Переход: ${BLOCK_LABELS[b].toLowerCase().split(" ")[0]}`}>
                  <select value={settings.transBars[b]} onChange={(e) => updateSettings({ transBars: { ...settings.transBars, [b]: +e.target.value } })}>
                    {[4, 8, 16, 32].map((x) => <option key={x} value={x}>{x} тактов</option>)}
                  </select>
                </Field>
              ))}
            </div>
            <div className="mt-3 space-y-1.5 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={settings.avoidVocalClash} onChange={(e) => updateSettings({ avoidVocalClash: e.target.checked })} /> Не накладывать вокалы (cut вместо перекрытия)</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={settings.strictHarmonic} onChange={(e) => updateSettings({ strictHarmonic: e.target.checked })} /> Строгая гармония (штраф за конфликты ×2)</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={settings.allowRepeat} onChange={(e) => updateSettings({ allowRepeat: e.target.checked })} /> Разрешить повторы треков</label>
            </div>
          </Panel>

          <Panel title="Ограничения компоновки">
            <Field label="Трек">
              <select value={pickId} onChange={(e) => setPickId(e.target.value)}>
                <option value="">— выберите —</option>
                {tracks.map((t) => <option key={t.id} value={t.id}>{t.title} · {t.bpm.toFixed(0)} · {t.camelot}</option>)}
              </select>
            </Field>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button className={btn} disabled={!pickId} onClick={() => pin("start")}>⇤ В начало</button>
              <button className={btn} disabled={!pickId} onClick={() => pin("middle")}>⇔ В середину</button>
              <button className={btn} disabled={!pickId} onClick={() => pin("end")}>⇥ В конец</button>
              <button className={btnDanger} disabled={!pickId} onClick={() => pin("exclude")}>⊘ Исключить</button>
            </div>
            <div className="mt-2 space-y-1 text-xs">
              {(["start", "middle", "end"] as const).flatMap((k) => settings.pins[k].map((id) => (
                <div key={k + id} className="flex items-center justify-between rounded bg-slate-800/60 px-2 py-1"><span>{{ start: "начало", middle: "середина", end: "конец" }[k]}: {title(id)}</span><button onClick={() => updateSettings(strip(id))}>✕</button></div>
              )))}
              {settings.excluded.map((id) => <div key={id} className="flex items-center justify-between rounded bg-rose-950/40 px-2 py-1 text-rose-300"><span>исключён: {title(id)}</span><button onClick={() => updateSettings(strip(id))}>✕</button></div>)}
            </div>
            <p className="mt-4 text-xs font-semibold uppercase text-slate-500">Обязательные переходы (A → B)</p>
            <div className="mt-1 flex gap-1">
              <select className="w-0 flex-1" value={pairA} onChange={(e) => setPairA(e.target.value)}><option value="">A</option>{tracks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select>
              <select className="w-0 flex-1" value={pairB} onChange={(e) => setPairB(e.target.value)}><option value="">B</option>{tracks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select>
              <button className={btn} disabled={!pairA || !pairB || pairA === pairB} onClick={() => { updateSettings({ pairs: [...settings.pairs, { from: pairA, to: pairB }] }); setPairA(""); setPairB(""); }}>＋</button>
            </div>
            <div className="mt-1 space-y-1 text-xs">
              {settings.pairs.map((p, i) => <div key={i} className="flex justify-between rounded bg-slate-800/60 px-2 py-1"><span>{title(p.from)} → {title(p.to)}</span><button onClick={() => updateSettings({ pairs: settings.pairs.filter((_, k) => k !== i) })}>✕</button></div>)}
            </div>
          </Panel>
        </div>

        {/* ───── Таймлайн и редактирование ───── */}
        <div className="min-w-0 space-y-4">
          <Panel
            title="Таймлайн микса"
            right={
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <label className="flex items-center gap-2">масштаб <input type="range" min={0.08} max={2} step={0.02} value={zoom} onChange={(e) => setZoom(+e.target.value)} /></label>
                <button className={btn} onClick={() => plan && refit(plan.items)} disabled={!plan}>↻ Пересчитать переходы</button>
                <button className={`${stale || !plan ? btnPrimary : btn}`} onClick={build} disabled={!tracks.length}>⚙ Собрать микс</button>
              </div>
            }
          >
            {stale && plan && <p className="mb-3 rounded-lg bg-amber-950/40 p-2 text-xs text-amber-300">Настройки изменились. Кривая темпа и предупреждения уже пересчитаны, но набор треков остался прежним — нажмите «Собрать микс», чтобы подобрать треки заново.</p>}
            {!plan ? (
              <div className="py-16 text-center text-slate-400">
                <p className="text-lg">План микса ещё не собран</p>
                <p className="mt-1 text-sm">Выберите профиль и длительность слева и нажмите «Собрать микс».</p>
              </div>
            ) : (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-4 text-sm">
                  <span className={`rounded-lg px-3 py-1 font-bold ${plan.report.score >= 80 ? "bg-emerald-500/20 text-emerald-300" : plan.report.score >= 55 ? "bg-amber-500/20 text-amber-300" : "bg-rose-500/20 text-rose-300"}`}>Качество {plan.report.score}/100</span>
                  <span>⏱ {fmtTime(plan.report.totalSec)}</span>
                  <span>🎵 {plan.report.trackCount} треков</span>
                  <span className="text-amber-400">разм. {fmtTime(plan.report.warmupSec)}</span>
                  <span className="text-red-400">основа {fmtTime(plan.report.mainSec)}</span>
                  <span className="text-sky-400">заминка {fmtTime(plan.report.cooldownSec)}</span>
                  <span className="text-slate-400">макс. растяжение {plan.report.maxStretchPct.toFixed(1)}%</span>
                </div>
                <Timeline plan={plan} settings={settings} tracks={trackMap} sel={sel} onSel={setSel} zoom={zoom} />
                <p className="mt-2 text-xs text-slate-500">Две «деки» чередуются; пунктирные зоны — переходы (клик = настройка и предпросмотр). Линия BPM — кривая темпа, зелёный пунктир — целевая энергия, плотные отрезки — энергия треков.</p>
              </>
            )}
          </Panel>

          {plan && (
            <div className="grid gap-4 2xl:grid-cols-2">
              <Panel title={selTrans ? `Переход ${sel!.i + 1} → ${sel!.i + 2}` : selItem ? `Трек №${sel!.i + 1}` : "Инспектор"}>
                {!sel && <p className="text-sm text-slate-500">Выберите трек или переход на таймлайне либо в списке ниже.</p>}
                {selItem && (() => {
                  const i = sel!.i;
                  const t = trackMap.get(selItem.trackId)!;
                  return (
                    <div className="space-y-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <b className="text-base">{t.title}</b><span className="text-slate-400">{t.artist}</span><CamelotBadge code={t.camelot} /><EnergyBar v={t.energy} />
                        <Link className="text-xs text-cyan-300 underline" href={`/track/${t.id}`}>анализ трека →</Link>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <Field label="Блок"><select value={selItem.block} onChange={(e) => patchItem(i, { block: e.target.value as BlockType })}>{BLOCKS.map((b) => <option key={b} value={b}>{BLOCK_LABELS[b]}</option>)}</select></Field>
                        <Num label="Вход (такт)" value={selItem.inBar} min={0} onChange={(v) => patchItem(i, { inBar: v, manualPoints: true })} />
                        <Num label="Выход (такт)" value={selItem.outBar} min={4} onChange={(v) => patchItem(i, { outBar: v, manualPoints: true })} />
                      </div>
                      <p className="text-xs text-slate-400">Вход: {secLabel(t, selItem.inBar)} · Выход: {secLabel(t, selItem.outBar - 1)} · фрагмент {selItem.outBar - selItem.inBar} т. ({fmtTime(((selItem.outBar - selItem.inBar) * 240) / t.bpm)} в оригинале) · растяжение {((selItem.stretchMin - 1) * 100).toFixed(1)}…{((selItem.stretchMax - 1) * 100).toFixed(1)}%{t.noStretch ? " (без подгонки)" : ""}</p>
                      <div className="flex flex-wrap gap-1.5">
                        <button className={btn} onClick={() => move(i, -1)} disabled={i === 0}>◀ Раньше</button>
                        <button className={btn} onClick={() => move(i, 1)} disabled={i === plan.items.length - 1}>Позже ▶</button>
                        {selItem.manualPoints && <button className={btn} onClick={() => patchItem(i, { manualPoints: false })}>Точки: авто</button>}
                        <select className="w-44" value="" onChange={(e) => { if (e.target.value) patchItem(i, { trackId: e.target.value, manualPoints: false, why: ["Заменён вручную"] }); }}>
                          <option value="">Заменить другим…</option>
                          {tracks.filter((x) => x.id !== t.id).map((x) => <option key={x.id} value={x.id}>{x.title} · {x.bpm.toFixed(0)} · {x.camelot}</option>)}
                        </select>
                        <button className={btnDanger} onClick={() => removeItem(i)}>Убрать</button>
                      </div>
                      {selItem.why.length > 0 && <div><p className="mb-1 text-xs font-semibold uppercase text-slate-500">Почему выбран</p><ul className="list-disc pl-5 text-xs text-slate-300">{selItem.why.map((w, k) => <li key={k}>{w}</li>)}</ul></div>}
                      <IssueList issues={selItem.issues} />
                    </div>
                  );
                })()}
                {selTrans && selTrans.trans && (() => {
                  const i = sel!.i;
                  const tr = selTrans.trans;
                  const B = plan.items[i + 1];
                  const ta = trackMap.get(selTrans.trackId)!;
                  const tb = trackMap.get(B.trackId)!;
                  const rel = camelotRelation(ta.camelot, tb.camelot);
                  const info = TRANSITION_INFO[tr.type];
                  const setTr = (p: Partial<typeof tr>) => refit(plan.items.map((it, k) => (k === i ? { ...it, trans: { ...tr, ...p, manual: true } } : it)));
                  return (
                    <div className="space-y-3 text-sm">
                      <div className="flex items-center gap-2"><CamelotBadge code={ta.camelot} /> → <CamelotBadge code={tb.camelot} /><span className="text-xs text-slate-400">{rel.explain}</span></div>
                      <div className="grid grid-cols-2 gap-2">
                        <Field label="Тип перехода"><select value={tr.type} onChange={(e) => setTr({ type: e.target.value as TransitionType, bars: ["cut", "loop_roll"].includes(e.target.value) ? 0 : tr.bars || 8 })}>{Object.entries(TRANSITION_INFO).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
                        <Field label="Длина (такты)"><select value={tr.bars} onChange={(e) => setTr({ bars: +e.target.value })}>{BARS.map((x) => <option key={x} value={x}>{x === 0 ? "0 (на фразе)" : `${x} т. (${x / 4} фраз${x === 4 ? "а" : ""})`}</option>)}</select></Field>
                      </div>
                      <p className="rounded-lg bg-slate-800/50 p-2 text-xs text-slate-300">{info.desc}</p>
                      <ul className="space-y-1 text-xs text-slate-300">
                        <li>▸ Выход A («{ta.title}»): такт <b>{selTrans.outBar}</b> · {secLabel(ta, selTrans.outBar - 1)}; перекрытие начинается с такта {selTrans.outBar - tr.bars}</li>
                        <li>▸ Вход B («{tb.title}»): такт <b>{B.inBar}</b> · {secLabel(tb, B.inBar)}; main/дроп B на такте {mainStartBar(tb)} {tr.bars ? "→ приходится на конец перехода" : "→ вход на первую долю фразы"}</li>
                        <li>▸ Начало перехода в миксе: {times ? fmtTime(times.times[i + 1].start) : ""} · темп {times ? times.tm.bpmAtBeat(B.startBeat).toFixed(1) : ""} BPM</li>
                        <li>▸ Выравнивание: beat-to-beat по сетке, старт на границе такта, длина кратна фразе (4 такта)</li>
                      </ul>
                      {tr.why.length > 0 && <div><p className="mb-1 text-xs font-semibold uppercase text-slate-500">Почему такой переход</p><ul className="list-disc pl-5 text-xs text-slate-300">{tr.why.map((w, k) => <li key={k}>{w}</li>)}</ul></div>}
                      <IssueList issues={tr.issues} />
                      <div className="flex flex-wrap items-center gap-2">
                        <button className={btnPrimary} onClick={() => previewTransition(i)} disabled={!!prev && !prev.playing}>▶ Предпросмотр перехода</button>
                        {prev?.i === i && prev.playing && <button className={btn} onClick={stopPreview}>■ Стоп</button>}
                        {prev?.i === i && !prev.playing && <span className="text-xs text-slate-400">Рендер… {Math.round(prev.p * 100)}%</span>}
                        {tr.manual && <button className={btn} onClick={() => refit(plan.items.map((it, k) => (k === i ? { ...it, trans: { ...tr, manual: false } } : it)))}>Вернуть авто</button>}
                      </div>
                    </div>
                  );
                })()}
              </Panel>

              <Panel title="Отчёт о качестве">
                <div className="mb-3 grid grid-cols-4 gap-2 text-center text-xs">
                  {[["Конфликты тональностей", plan.report.keyClashes], ["Вокальные конфликты", plan.report.vocalConflicts], ["Скачки энергии", plan.report.energyJumps], ["Макс. stretch %", plan.report.maxStretchPct.toFixed(1)]].map(([l, v]) => (
                    <div key={l as string} className="rounded-lg bg-slate-800/50 p-2"><div className="text-lg font-bold">{v}</div><div className="text-slate-500">{l}</div></div>
                  ))}
                </div>
                <div className="max-h-[300px] overflow-y-auto pr-1">
                  <IssueList issues={plan.report.issues} onPick={(i) => setSel({ kind: "item", i })} />
                </div>
              </Panel>
            </div>
          )}

          {plan && (
            <Panel title="Порядок треков" right={
              <div className="flex items-center gap-1.5 text-xs">
                <select className="w-56" value={addId} onChange={(e) => setAddId(e.target.value)}><option value="">Добавить трек…</option>{tracks.map((t) => <option key={t.id} value={t.id}>{t.title} · {t.bpm.toFixed(0)} · {t.camelot}</option>)}</select>
                <button className={btn} disabled={!addId} onClick={addTrack}>＋</button>
              </div>
            }>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-sm">
                  <thead className="text-left text-xs uppercase text-slate-500"><tr><th>#</th><th>Время</th><th>Трек</th><th>Блок</th><th>BPM → микс</th><th>Camelot</th><th>Энергия</th><th>Переход →</th><th /></tr></thead>
                  <tbody>
                    {plan.items.map((it, i) => {
                      const t = trackMap.get(it.trackId)!;
                      const tt = times!.times[i];
                      const bad = [...it.issues, ...(it.trans?.issues ?? [])].filter((x) => x.level !== "info");
                      return (
                        <tr key={it.uid} className={`cursor-pointer border-t border-slate-800/70 ${sel?.kind === "item" && sel.i === i ? "bg-slate-800/60" : "hover:bg-slate-800/30"}`} onClick={() => setSel({ kind: "item", i })}>
                          <td className="py-1.5 tabular-nums text-slate-500">{i + 1}</td>
                          <td className="tabular-nums text-slate-400">{fmtTime(tt.start)}</td>
                          <td className="max-w-[220px] truncate">{t.title}<span className="ml-1 text-xs text-slate-500">{t.artist}</span></td>
                          <td><span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-950" style={{ background: BLOCK_COLORS[it.block] }}>{BLOCK_LABELS[it.block].split(" ")[0]}</span></td>
                          <td className="tabular-nums">{t.bpm.toFixed(1)} → {times!.tm.bpmAtBeat((it.startBeat + it.endBeat) / 2).toFixed(1)}</td>
                          <td><CamelotBadge code={t.camelot} /></td>
                          <td><EnergyBar v={t.energy} /></td>
                          <td onClick={(e) => { e.stopPropagation(); if (it.trans) setSel({ kind: "trans", i }); }} className="text-cyan-300 hover:underline">{it.trans ? `${TRANSITION_INFO[it.trans.type].label} · ${it.trans.bars} т.` : "—"}{it.trans?.manual && " ✎"}</td>
                          <td className="whitespace-nowrap text-right">
                            {bad.length > 0 && <span className="mr-2 text-amber-400" title={bad.map((b) => b.text).join("\n")}>⚠ {bad.length}</span>}
                            <button className="px-1 text-slate-400 hover:text-white" onClick={(e) => { e.stopPropagation(); move(i, -1); }}>↑</button>
                            <button className="px-1 text-slate-400 hover:text-white" onClick={(e) => { e.stopPropagation(); move(i, 1); }}>↓</button>
                            <button className="px-1 text-slate-500 hover:text-rose-400" onClick={(e) => { e.stopPropagation(); removeItem(i); }}>✕</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}

          {plan && (
            <Panel title="Экспорт">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-3">
                  <div className="rounded-xl border border-amber-800/70 bg-amber-950/30 p-3 text-xs leading-relaxed text-amber-200">
                    <b>⚖ Лицензии.</b> Сервис не проверяет права на музыку. Вы отвечаете за то, что имеете право сводить, изменять темп и публично исполнять загруженные треки (лицензии ООПП/PRS/ASCAP и т. п. для студий и клубов, лицензия «для фитнеса» у дистрибьютора). Экспортированный микс нельзя распространять без согласия правообладателей.
                  </div>
                  <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={license} onChange={(e) => setLicense(e.target.checked)} /> Подтверждаю, что имею необходимые права на использование этих треков</label>
                  <div className="flex flex-wrap items-center gap-2">
                    <button className={btnPrimary} disabled={!license || !!exp} onClick={exportAudio}>⬇ Экспорт микса (WAV 16 бит / 44.1 кГц)</button>
                    {exp && <button className={btn} onClick={() => abort.current?.abort()}>Отменить</button>}
                  </div>
                  <p className="text-xs text-slate-500">Размер ≈ {((plan.report.totalSec * 44100 * 4) / 1048576).toFixed(0)} МБ. Рендер идёт в вашем браузере кусками по 20 с (time-stretch WSOLA без смены тональности, EQ/фильтры, лимитер); для 60 минут может занять несколько минут.</p>
                  {exp && (
                    <div>
                      <div className="flex justify-between text-xs text-slate-400"><span>{exp.label}</span><span>{Math.round(exp.p * 100)}%</span></div>
                      <div className="mt-1 h-2 overflow-hidden rounded bg-slate-800"><div className="h-full bg-gradient-to-r from-cyan-400 to-fuchsia-500" style={{ width: `${exp.p * 100}%` }} /></div>
                    </div>
                  )}
                  {expErr && <p className="text-sm text-rose-400">{expErr}</p>}
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase text-slate-500">Cue sheet / треклист</p>
                  <p className="text-xs text-slate-400">Порядок, BPM (исходный → в миксе), Camelot, точки входа/выхода, переходы, кривая темпа, предупреждения.</p>
                  <div className="flex flex-wrap gap-2">
                    <button className={btn} onClick={() => download(`${name}-cue.txt`, cueSheetText(name, plan, settings, trackMap))}>TXT</button>
                    <button className={btn} onClick={() => download(`${name}-cue.csv`, cueSheetCsv(plan, settings, trackMap), "text/csv")}>CSV</button>
                    <button className={btn} onClick={() => download(`${name}.json`, JSON.stringify({ name, settings, plan }, null, 2), "application/json")}>JSON проекта</button>
                  </div>
                </div>
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
