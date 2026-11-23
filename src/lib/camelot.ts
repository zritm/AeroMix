const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MAJ = ["8B", "3B", "10B", "5B", "12B", "7B", "2B", "9B", "4B", "11B", "6B", "1B"];
const MIN = ["5A", "12A", "7A", "2A", "9A", "4A", "11A", "6A", "1A", "8A", "3A", "10A"];

export function keyToCamelot(pc: number, minor: boolean): string {
  return (minor ? MIN : MAJ)[((pc % 12) + 12) % 12];
}

export function keyName(pc: number, minor: boolean): string {
  return `${NAMES[((pc % 12) + 12) % 12]} ${minor ? "minor" : "major"}`;
}

export const ALL_KEYS: { key: string; camelot: string }[] = [
  ...NAMES.map((_, i) => ({ key: keyName(i, true), camelot: keyToCamelot(i, true) })),
  ...NAMES.map((_, i) => ({ key: keyName(i, false), camelot: keyToCamelot(i, false) })),
].sort((a, b) => {
  const pa = parseCamelot(a.camelot)!;
  const pb = parseCamelot(b.camelot)!;
  return pa.n - pb.n || pa.l.localeCompare(pb.l);
});

export function camelotFromKey(key: string): string {
  return ALL_KEYS.find((k) => k.key === key)?.camelot ?? "";
}

export function parseCamelot(c: string): { n: number; l: "A" | "B" } | null {
  const m = /^(\d{1,2})([AB])$/.exec((c || "").trim().toUpperCase());
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (n < 1 || n > 12) return null;
  return { n, l: m[2] as "A" | "B" };
}

export function camelotColor(c: string): string {
  const p = parseCamelot(c);
  if (!p) return "hsl(220 10% 40%)";
  return `hsl(${(p.n * 30 + 200) % 360} ${p.l === "A" ? 62 : 78}% ${p.l === "A" ? 42 : 50}%)`;
}

export type RelationLevel = "perfect" | "good" | "boost" | "risky" | "clash" | "unknown";

export interface Relation {
  level: RelationLevel;
  label: string;
  explain: string;
  cost: number;
}

export function camelotRelation(a: string, b: string): Relation {
  const pa = parseCamelot(a);
  const pb = parseCamelot(b);
  if (!pa || !pb) {
    return { level: "unknown", label: `${a || "?"} → ${b || "?"}`, explain: "Тональность одного из треков не определена — гармоническая совместимость не оценена.", cost: 3 };
  }
  let d = (pb.n - pa.n + 12) % 12;
  if (d > 6) d -= 12;
  const lab = `${a} → ${b}`;
  if (pa.l === pb.l) {
    if (d === 0) return { level: "perfect", label: lab, explain: `${lab}: одинаковая тональность — идеальное гармоническое смешивание.`, cost: 0 };
    if (Math.abs(d) === 1)
      return { level: "good", label: lab, explain: `${lab}: соседние коды (${d > 0 ? "+1, лёгкий подъём" : "−1, лёгкий спад"} энергии) — гармонично.`, cost: 0.5 };
    if (d === 2) return { level: "boost", label: lab, explain: `${lab}: +2 — «энергетический буст», допустим при росте энергии.`, cost: 1.5 };
    if (d === -5) return { level: "boost", label: lab, explain: `${lab}: +7 (полутон вверх) — яркий буст, допустим при росте энергии и с коротким переходом.`, cost: 2 };
    return { level: "clash", label: lab, explain: `${lab}: коды далеко друг от друга — тональности конфликтуют.`, cost: 9 };
  }
  if (d === 0) return { level: "good", label: lab, explain: `${lab}: параллельные тональности (мажор/минор того же номера) — гармонично.`, cost: 0.5 };
  if (Math.abs(d) === 1) return { level: "risky", label: lab, explain: `${lab}: диагональный переход — допустим только с фильтром/коротким переходом.`, cost: 4 };
  return { level: "clash", label: lab, explain: `${lab}: несовместимые тональности — гармонический конфликт.`, cost: 9 };
}
