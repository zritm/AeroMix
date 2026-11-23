"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { btn, btnDanger, Panel } from "@/components/ui";
import { api, type Project } from "@/lib/api";
import { fmtTime } from "@/lib/planner";

export default function ProjectsPage() {
  const [list, setList] = useState<Project[] | null>(null);
  const [err, setErr] = useState("");
  const load = () => api.listProjects().then(setList).catch((e) => setErr(e.message));
  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Проекты</h1>
          <p className="text-sm text-slate-400">Сохранённые миксы: настройки, порядок треков, ручные правки переходов.</p>
        </div>
        <Link href="/mix" className={btn}>＋ Новый микс</Link>
      </div>
      {err && <p className="text-rose-400">{err}</p>}
      {list === null ? (
        <p className="text-slate-500">Загрузка…</p>
      ) : list.length === 0 ? (
        <Panel><p className="py-8 text-center text-slate-400">Проектов пока нет. Соберите микс и нажмите «Сохранить проект».</p></Panel>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => (
            <Panel key={p.id}>
              <h3 className="text-lg font-semibold">{p.name}</h3>
              <p className="mt-1 text-xs text-slate-500">Обновлён: {new Date(p.updatedAt).toLocaleString("ru-RU")}</p>
              <p className="mt-2 text-sm text-slate-300">
                {p.plan ? `${p.plan.report.trackCount} треков · ${fmtTime(p.plan.report.totalSec)} · качество ${p.plan.report.score}/100` : "План не собран"}
              </p>
              <p className="text-xs text-slate-500">{p.settings.warmupMin}/{p.settings.mainMin}/{p.settings.cooldownMin} мин · {p.settings.bpmStart}→{p.settings.bpmTarget}→{p.settings.bpmEnd} BPM</p>
              <div className="mt-3 flex gap-2">
                <Link href={`/mix?project=${p.id}`} className={btn}>Открыть</Link>
                <button className={btnDanger} onClick={async () => { if (confirm("Удалить проект?")) { await api.deleteProject(p.id); void load(); } }}>Удалить</button>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
