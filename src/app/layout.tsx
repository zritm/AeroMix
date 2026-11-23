import type { Metadata } from "next";
import type { ReactNode } from "react";
import Nav from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "AeroMix — автосборка аэробических миксов",
  description: "Анализ треков, Camelot, подгонка темпа и DJ-переходы для аэробики и фитнеса.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-screen antialiased">
        <Nav />
        <main className="mx-auto w-full max-w-[1500px] px-4 pb-16 pt-5">{children}</main>
      </body>
    </html>
  );
}
