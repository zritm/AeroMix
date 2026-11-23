import { SPEC } from "@/content/spec";

export const metadata = { title: "ТЗ / PRD — AeroMix" };

export default function SpecPage() {
  return (
    <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Содержание</p>
        <ul className="space-y-1 text-sm">
          {SPEC.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="block rounded px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-white">
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      </aside>
      <article className="min-w-0 space-y-10">
        <header>
          <h1 className="text-3xl font-bold">AeroMix — ТЗ / PRD</h1>
          <p className="mt-2 text-slate-400">
            Веб-сервис автоматической сборки аэробических миксов из треков пользователя: разминка → основная часть → заминка, Camelot, подгонка темпа и DJ-переходы по фразам.
          </p>
        </header>
        {SPEC.map((s) => (
          <section key={s.id} id={s.id} className="scroll-mt-20 space-y-4">
            <h2 className="border-b border-slate-800 pb-2 text-xl font-bold text-cyan-300">{s.title}</h2>
            {s.blocks.map((b, i) => {
              if ("p" in b) return <p key={i} className="leading-relaxed text-slate-300">{b.p}</p>;
              if ("h" in b) return <h3 key={i} className="pt-2 text-base font-semibold text-white">{b.h}</h3>;
              if ("ul" in b)
                return (
                  <ul key={i} className="list-disc space-y-1.5 pl-6 text-sm leading-relaxed text-slate-300">
                    {b.ul.map((x, k) => <li key={k}>{x}</li>)}
                  </ul>
                );
              return (
                <div key={i} className="overflow-x-auto rounded-xl border border-slate-800">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="bg-slate-800/60 text-xs uppercase text-slate-400">
                      <tr>{b.table.head.map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {b.table.rows.map((r, ri) => (
                        <tr key={ri} className="border-t border-slate-800 align-top">
                          {r.map((c, ci) => <td key={ci} className={`px-3 py-2 text-slate-300 ${ci === 0 ? "font-semibold text-white" : ""}`}>{c}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </section>
        ))}
      </article>
    </div>
  );
}
