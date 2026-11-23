"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Библиотека" },
  { href: "/mix", label: "Сборка микса" },
  { href: "/projects", label: "Проекты" },
  { href: "/spec", label: "ТЗ / PRD" },
];

export default function Nav() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-slate-800 bg-[#0a0e14]/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1500px] items-center gap-6 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-cyan-400 to-fuchsia-500 text-sm text-slate-950">♫</span>
          AeroMix
        </Link>
        <nav className="flex gap-1 text-sm">
          {links.map((l) => {
            const active = l.href === "/" ? path === "/" || path.startsWith("/track") : path.startsWith(l.href);
            return (
              <Link key={l.href} href={l.href} className={`rounded-lg px-3 py-1.5 transition ${active ? "bg-slate-800 text-white" : "text-slate-400 hover:text-white"}`}>
                {l.label}
              </Link>
            );
          })}
        </nav>
        <span className="ml-auto hidden text-xs text-slate-500 md:block">🔒 Аудио остаётся в вашем браузере — на сервер уходят только метаданные</span>
      </div>
    </header>
  );
}
