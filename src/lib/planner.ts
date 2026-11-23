import { camelotRelation } from "./camelot";
import { TempoMap, beatsForRamp, type TempoCfg } from "./tempo";
import type { BlockType, Bounds, Issue, MixSettings, Plan, PlanItem, Report, Track, Transition, TransitionType } from "./types";

export const PROFILES: Record<string, { label: string; patch: Partial<MixSettings>; note: string }> = {
  cardio: {
    label: "Кардио / Hi-Lo",
    note: "Классическая аэробика: основная часть 132–138 BPM, высокая стабильная энергия.",
    patch: { bpmStart: 118, bpmTarget: 135, bpmEnd: 95, energyStart: 35, energyMain: 72, energyEnd: 22, transBars: { warmup: 16, main: 16, cooldown: 16 } },
  },
  step: {
    label: "Step",
    note: "Степ: основная часть 126–132 BPM (безопасный темп для платформы), средне-высокая энергия.",
    patch: { bpmStart: 110, bpmTarget: 128, bpmEnd: 90, energyStart: 30, energyMain: 66, energyEnd: 20, transBars: { warmup: 16, main: 16, cooldown: 16 } },
  },
  strength: {
    label: "Силовая / круговая",
    note: "Силовая: ниже темп и энергия, длиннее переходы — музыка не должна «гнать» повторения.",
    patch: { bpmStart: 100, bpmTarget: 120, bpmEnd: 85, energyStart: 28, energyMain: 55, energyEnd: 18, transBars: { warmup: 16, main: 32, cooldown: 32 } },
  },
  hiit: {
    label: "HIIT / интервальная",
    note: "Интервалы: высокий темп 140–148 BPM, максимум энергии, короткие жёсткие переходы.",
    patch: { bpmStart: 120, bpmTarget: 145, bpmEnd: 100, energyStart: 40, energyMain: 82, energyEnd: 25, transBars: { warmup: 8, main: 8, cooldown: 16 } },
  },
};

export const TEMPLATES: Record<string, { label: string; warmupMin: number; mainMin: number; cooldownMin: number }> = {
  "30": { label: "30 мин (экспресс / демо)", warmupMin: 6, mainMin: 18, cooldownMin: 6 },
  "45": { label: "45 мин", warmupMin: 8, mainMin: 30, cooldownMin: 7 },
  "60": { label: "60 мин", warmupMin: 10, mainMin: 40, cooldownMin: 10 },
  "90": { label: "90 мин", warmupMin: 12, mainMin: 65, cooldownMin: 13 },
};

export const DEFAULT_SETTINGS: MixSettings = {
  profile: "cardio",
  template: "30",
  warmupMin: 6,
  mainMin: 18,
  cooldownMin: 6,
  bpmStart: 118,
  bpmTarget: 135,
  bpmEnd: 95,
  curveShape: "linear",
  maxStretch: 8,
  energyStart: 35,
  energyMain: 72,
  energyEnd: 22,
  transBars: { warmup: 16, main: 16, cooldown: 16 },
  allowRepeat: false,
  avoidVocalClash: true,
  strictHarmonic: false,
  pins: { start: [], middle: [], end: [] },
  pairs: [],
  excluded: [],
};

export const TRANSITION_INFO: Record<TransitionType, { label: string; short: string; desc: string }> = {
  drum_to_drum: { label: "Drum-to-drum", short: "D2D", desc: "Сухие ударные B входят поверх сухих ударных A; мелодика A приглушается, затем бас переключается на фразе." },
  bass_swap: { label: "Bass swap", short: "BSW", desc: "Оба трека играют полным составом, но басы не пересекаются: на середине перехода (граница фразы) низ A меняется на низ B." },
  eq_blend: { label: "EQ-переход", short: "EQ", desc: "Плавное перетекание по полосам: низ и верх A затухают, B нарастает. Мягкий вариант для разминки и заминки." },
  loop_roll: { label: "Loop roll", short: "ROLL", desc: "Последние доли A зацикливаются с укорочением петли (1 → ½ → ¼ доли), затем резкий вход B на первую долю такта." },
  cut: { label: "Cut", short: "CUT", desc: "Жёсткая смена на первой доле такта (граница фразы). Применяется, когда перекрытие недопустимо." },
  filter: { label: "Filter", short: "FLT", desc: "A уходит через highpass-свип, B открывается lowpass-свипом: маскирует гармонический диссонанс." },
  fade: { label: "Fade", short: "FADE", desc: "Простое кроссфейд-затухание. Резервный вариант, не рекомендуется для основной части." },
};

const align4Down = (x: number) => Math.floor(x / 4) * 4;
const align4Up = (x: number) => Math.ceil(x / 4) * 4;
const uid = () => Math.random().toString(36).slice(2, 10);
const lerp = (a: number, b: number, x: number) => a + (b - a) * Math.min(1, Math.max(0, x));

export function usableBars(t: Track): number {
  return Math.max(4, align4Down(t.totalBars));
}
export function mainStartBar(t: Track): number {
  if (t.cues.in != null) return t.cues.in;
  const s = t.sections.find((x) => x.type === "main");
  return s ? s.startBar : 0;
}
export function outroStartBar(t: Track): number {
  if (t.cues.out != null) return t.cues.out;
  const o = [...t.sections].reverse().find((x) => x.type === "outro");
  if (o) return o.startBar;
  return Math.max(0, usableBars(t) - 8);
}

export function nominalBounds(s: MixSettings): Bounds {
  const warmEnd = s.warmupMin > 0 ? beatsForRamp(s.warmupMin, s.bpmStart, s.bpmTarget) : 0;
  const coolStart = warmEnd + s.mainMin * s.bpmTarget;
  const end = coolStart + (s.cooldownMin > 0 ? beatsForRamp(s.cooldownMin, s.bpmTarget, s.bpmEnd) : 0);
  return { warmEnd, coolStart, end };
}

export function tempoCfg(s: MixSettings, b: Bounds): TempoCfg {
  return {
    bpmStart: b.warmEnd > 0 ? s.bpmStart : s.bpmTarget,
    bpmTarget: s.bpmTarget,
    bpmEnd: b.end > b.coolStart ? s.bpmEnd : s.bpmTarget,
    warmEnd: b.warmEnd,
    coolStart: b.coolStart,
    end: b.end,
    shape: s.curveShape,
  };
}
export const makeTempoMap = (s: MixSettings, b: Bounds) => new TempoMap(tempoCfg(s, b));

export function energyTarget(beat: number, s: MixSettings, b: Bounds): number {
  if (b.warmEnd > 0 && beat < b.warmEnd) return lerp(s.energyStart, s.energyMain, beat / b.warmEnd);
  if (b.end > b.coolStart && beat >= b.coolStart) return lerp(s.energyMain, s.energyEnd, (beat - b.coolStart) / (b.end - b.coolStart));
  return s.energyMain;
}

function blockAt(beat: number, b: Bounds, s: MixSettings): BlockType {
  if (s.warmupMin > 0 && beat < b.warmEnd) return "warmup";
  if (s.cooldownMin > 0 && beat >= b.coolStart) return "cooldown";
  return "main";
}

function defaultSegment(t: Track, nIn: number, nOut: number, block: BlockType, first: boolean, last: boolean) {
  const ub = usableBars(t);
  const ms = mainStartBar(t);
  const extra = first ? 16 : block === "main" ? 0 : 8;
  const inBar = Math.max(0, ms - nIn - extra);
  const os = outroStartBar(t);
  let outBar = Math.min(ub, last ? align4Up(os + 16) : os + nOut);
  if (outBar < inBar + 16) outBar = Math.min(ub, inBar + 16);
  return { inBar, outBar };
}

function vocalInRange(t: Track, a: number, b: number): boolean {
  if (!t.sections.length) return t.hasVocals;
  return t.sections.some((s) => s.vocal && s.startBar < b && s.endBar > a);
}

function dryEdges(a: Track, b: Track): boolean {
  const la = a.sections[a.sections.length - 1];
  const fb = b.sections[0];
  return !!la?.dry && !!fb?.dry;
}

export function chooseTransition(a: Track, b: Track, blockA: BlockType, blockB: BlockType, s: MixSettings): Transition {
  const rel = camelotRelation(a.camelot, b.camelot);
  const why: string[] = [rel.explain];
  const de = b.energy - a.energy;
  const desired = blockB === "cooldown" ? s.transBars.cooldown : blockB === "warmup" ? s.transBars.warmup : s.transBars.main;
  const aAvail = Math.max(8, usableBars(a) - outroStartBar(a));
  const bAvail = mainStartBar(b);
  const limit = Math.min(desired, aAvail, Math.max(bAvail, 8));
  let bars = [32, 16, 8, 4].find((x) => x <= limit) ?? 4;
  if (bars < desired) why.push(`Длина сокращена с ${desired} до ${bars} тактов: outro A — ${aAvail} т., интро B — ${bAvail} т.`);
  const mismatch = (a.noStretch || b.noStretch) && Math.abs(a.bpm - b.bpm) / a.bpm > 0.02;
  const dry = dryEdges(a, b);
  const segA = defaultSegment(a, bars, bars, blockA, false, false);
  const segB = defaultSegment(b, bars, bars, blockB, false, false);
  const clash = vocalInRange(a, segA.outBar - Math.max(bars, 4), segA.outBar) && vocalInRange(b, segB.inBar, segB.inBar + Math.max(bars, 4));
  let type: TransitionType;
  if (mismatch) {
    type = "cut";
    bars = 0;
    why.push("Один из треков помечен «не подгонять», а BPM различаются >2% — доли разойдутся, поэтому cut на границе фразы.");
  } else if (clash && s.avoidVocalClash) {
    type = "cut";
    bars = 0;
    why.push("Вокал в зоне выхода A и в зоне входа B пересёкся бы — выбран cut на границе фразы, чтобы голоса не накладывались.");
  } else if (rel.level === "clash" || rel.level === "risky" || rel.level === "unknown") {
    type = "filter";
    bars = Math.min(bars, 8);
    why.push("Тональности не совместимы — filter-переход с коротким перекрытием маскирует диссонанс.");
  } else if (blockB === "warmup") {
    type = dry ? "drum_to_drum" : "eq_blend";
    why.push(type === "drum_to_drum" ? "Разминка: сухие ударные на стыке — drum-to-drum без конфликта мелодий." : "Разминка: мягкий EQ-переход без резких акцентов.");
  } else if (blockB === "cooldown") {
    type = dry ? "drum_to_drum" : "eq_blend";
    why.push("Заминка: длинный плавный переход без нарастания энергии.");
  } else if (blockA === "warmup") {
    type = "bass_swap";
    why.push("Стык разминки и основной части: bass swap на фразе — бит не проваливается, энергия растёт.");
  } else if (de >= 12) {
    type = "loop_roll";
    bars = 0;
    why.push(`Энергия растёт на ${de} пунктов: loop roll подводит к «дропу» B на первой доле фразы.`);
  } else if (dry) {
    type = "drum_to_drum";
    why.push("Сухие outro/intro — drum-to-drum сохраняет драйв без наложения мелодий.");
  } else {
    type = "bass_swap";
    why.push("Основная часть: bass swap на середине перехода — энергия не проседает, басы не конфликтуют.");
  }
  if (type !== "cut" && type !== "loop_roll" && bars < 4) bars = 4;
  return { type, bars, manual: false, relation: rel.level, why, issues: [] };
}

// ───────────── выбор треков ─────────────

interface Cand {
  t: Track;
  cost: number;
  why: string[];
}

function effN(t: Track, n: number): number {
  if (n <= 0) return 0;
  const limit = Math.min(n, Math.max(8, usableBars(t) - outroStartBar(t)), Math.max(mainStartBar(t), 8));
  return [32, 16, 8, 4].find((x) => x <= limit) ?? 4;
}

function estLen(t: Track, block: BlockType, n: number, first: boolean): number {
  const e = effN(t, n);
  const seg = defaultSegment(t, e, e, block, first, false);
  return Math.max(16, seg.outBar - seg.inBar - e) * 4;
}

export function makeItem(t: Track, block: BlockType, why: string[] = []): PlanItem {
  return { uid: uid(), trackId: t.id, block, inBar: 0, outBar: 0, manualPoints: false, startBeat: 0, endBeat: 0, trans: null, why, issues: [], stretchMin: 1, stretchMax: 1 };
}

export function buildPlan(all: Track[], s: MixSettings): Plan {
  const nb = nominalBounds(s);
  const tm = makeTempoMap(s, nb);
  const extra: Issue[] = [];
  const byId = new Map(all.map((t) => [t.id, t]));
  const alive = (ids: string[]) => ids.map((i) => byId.get(i)).filter((t): t is Track => !!t && !s.excluded.includes(t.id));
  const startPins = alive(s.pins.start);
  const midPins = alive(s.pins.middle);
  const endPins = alive(s.pins.end);
  const pinIds = new Set([...startPins, ...midPins, ...endPins].map((t) => t.id));
  const pool = all.filter((t) => !s.excluded.includes(t.id));
  const used = new Set<string>();
  type Seq = { t: Track; block: BlockType; why: string[] };
  const N = (blk: BlockType) => s.transBars[blk];
  let shortage = false;

  const score = (t: Track, block: BlockType, prev: Track | null, first: boolean, cursor: number): Cand => {
    const n = N(block);
    const len = estLen(t, block, n, first);
    const mid = cursor + len / 2;
    const T = tm.bpmAtBeat(mid);
    const speed = T / t.bpm;
    const dev = Math.max(Math.abs(speed - 1), Math.abs(tm.bpmAtBeat(cursor) / t.bpm - 1), Math.abs(tm.bpmAtBeat(cursor + len) / t.bpm - 1)) * 100;
    const why: string[] = [];
    let cost = 0;
    if (t.noStretch) {
      cost += dev > 3 ? 25 : dev;
      why.push(`BPM ${t.bpm.toFixed(1)} (не подгоняется), кривая ≈ ${T.toFixed(1)}`);
    } else {
      cost += dev > s.maxStretch ? 20 + (dev - s.maxStretch) * 3 : dev * 0.9;
      why.push(`BPM ${t.bpm.toFixed(1)} → ${T.toFixed(1)} (растяжение ${speed >= 1 ? "+" : "−"}${dev.toFixed(1)}%)`);
    }
    const et = energyTarget(mid, s, nb);
    cost += Math.abs(t.energy - et) / 8;
    why.push(`энергия ${t.energy} при цели ${Math.round(et)}`);
    if (block === "warmup" && t.energy > et + 15) cost += 2;
    if (block === "cooldown" && prev && t.energy > prev.energy + 3) cost += 2;
    if (block === "warmup" && prev && t.energy < prev.energy - 6) cost += 1.5;
    if (prev) {
      const rel = camelotRelation(prev.camelot, t.camelot);
      const de = t.energy - prev.energy;
      let hc = rel.cost;
      if (rel.level === "boost" && de < 5) hc += 1.5;
      if (s.strictHarmonic && (rel.level === "clash" || rel.level === "risky")) hc *= 2;
      cost += hc;
      why.push(rel.label + " · " + (rel.level === "perfect" ? "тот же ключ" : rel.level === "good" ? "гармонично" : rel.level === "boost" ? "энергетический буст" : rel.level === "unknown" ? "ключ неизвестен" : "конфликт"));
      const jump = Math.abs(de);
      cost += jump / 10 + (jump > 15 ? 3 : 0);
      if (prev.hasVocals && t.hasVocals) cost += 0.8;
      if (s.avoidVocalClash) {
        const sa = prev.sections[prev.sections.length - 1];
        const sb = t.sections[0];
        if (sa?.vocal && sb?.vocal) cost += 4;
      }
      if (prev.artist && prev.artist === t.artist) cost += 1;
    }
    cost -= (t.priority - 3) * 0.8;
    const tags = t.tags.map((x) => x.toLowerCase());
    const hasTag = (...k: string[]) => tags.some((x) => k.includes(x));
    if (hasTag("разминка", "warmup") && block !== "warmup") cost += 3;
    if (hasTag("заминка", "cooldown") && block !== "cooldown") cost += 3;
    if (hasTag("main", "основа", "основная") && block !== "main") cost += 2;
    if (block === "warmup" && hasTag("разминка", "warmup")) cost -= 1.5;
    if (block === "cooldown" && hasTag("заминка", "cooldown")) cost -= 1.5;
    return { t, cost, why };
  };

  /** Жадный набор треков для блока в диапазоне долей [from, to). */
  const run = (
    block: BlockType,
    from: number,
    to: number,
    prevIn: Track | null,
    first: boolean,
    o: { start?: Track[]; mid?: Track[]; restrict?: Track[]; exhaust?: boolean; midAt?: number } = {},
  ): Seq[] => {
    const seq: Seq[] = [];
    let cursor = from;
    let prev = prevIn;
    const start = [...(o.start ?? [])];
    const mid = [...(o.mid ?? [])];
    while (cursor < to - 32 || (o.exhaust && (o.restrict ?? []).some((t) => !used.has(t.id)))) {
      let chosen: Track | null = null;
      let why: string[] = [];
      const fresh = (o.restrict ?? pool).filter((t) => !used.has(t.id) && !pinIds.has(t.id));
      if (start.length) {
        chosen = start.shift()!;
        why = ["Закреплён в начале"];
      } else if (prev && s.pairs.some((p) => p.from === prev!.id && byId.has(p.to) && !used.has(p.to) && !s.excluded.includes(p.to))) {
        chosen = byId.get(s.pairs.find((p) => p.from === prev!.id && byId.has(p.to) && !used.has(p.to))!.to)!;
        why = ["Обязательный переход: пара задана пользователем"];
      } else if (mid.length && o.midAt != null && cursor >= o.midAt) {
        chosen = mid.shift()!;
        why = ["Закреплён в середине"];
      } else {
        let cands = fresh;
        if (!cands.length && s.allowRepeat && !o.restrict) {
          used.clear();
          cands = pool.filter((t) => !pinIds.has(t.id) && t.id !== prev?.id);
          extra.push({ level: "info", text: "Библиотека закончилась — включены повторы треков (разрешены в настройках)." });
        }
        if (!cands.length) {
          if (!o.restrict) shortage = true;
          break;
        }
        const best = cands.map((t) => score(t, block, prev, first && !seq.length, cursor)).sort((x, y) => x.cost - y.cost)[0];
        const len = estLen(best.t, block, N(block), first && !seq.length);
        if (!o.exhaust && seq.length && cursor + len * 0.5 > to) break;
        chosen = best.t;
        why = best.why;
      }
      used.add(chosen.id);
      seq.push({ t: chosen, block, why });
      cursor += estLen(chosen, block, N(block), first && seq.length === 1);
      prev = chosen;
    }
    return seq;
  };

  // 1) резерв заминки (самые «медленные» кандидаты), 2) разминка, 3) основная часть, 4) заминка в порядке цепочки
  let reserved: Track[] = [];
  if (s.cooldownMin > 0) reserved = run("cooldown", nb.coolStart, nb.end, null, false).map((x) => x.t);
  const warm = s.warmupMin > 0 ? run("warmup", 0, nb.warmEnd, null, true, { start: startPins }) : [];
  const warmStartPinsLeft = s.warmupMin > 0 ? [] : startPins;
  const warmLen = warm.reduce((a, x, i) => a + estLen(x.t, "warmup", N("warmup"), i === 0), 0);
  const mainFrom = Math.max(0, warm.length ? warmLen : 0);
  const main = run("main", mainFrom, nb.coolStart, warm.length ? warm[warm.length - 1].t : null, !warm.length, {
    start: warmStartPinsLeft,
    mid: midPins,
    midAt: mainFrom + (nb.coolStart - mainFrom) / 2,
  });
  for (const t of reserved) used.delete(t.id);
  const lastBefore = main.length ? main[main.length - 1].t : warm.length ? warm[warm.length - 1].t : null;
  const cool = reserved.length ? run("cooldown", nb.coolStart, nb.end, lastBefore, false, { restrict: reserved, exhaust: true }) : [];
  const tailPins: Seq[] = endPins.map((t) => ({ t, block: s.cooldownMin > 0 ? ("cooldown" as BlockType) : ("main" as BlockType), why: ["Закреплён в конце"] }));
  // нераспределённые закрепления «середина» (если основная часть пуста)
  const leftMid: Seq[] = midPins.filter((t) => !used.has(t.id)).map((t) => ({ t, block: "main" as BlockType, why: ["Закреплён в середине"] }));
  const seq: Seq[] = [...warm, ...main, ...leftMid, ...cool, ...tailPins];
  if (shortage) {
    const got = tm.timeAtBeat(seq.reduce((a, x, i) => a + estLen(x.t, x.block, N(x.block), i === 0), 0)) / 60;
    extra.push({ level: "warn", text: `Не хватает подходящих треков: набрано ≈${got.toFixed(0)} из ${s.warmupMin + s.mainMin + s.cooldownMin} мин. Добавьте треки в библиотеку или разрешите повторы.` });
  }
  if (!seq.length) extra.push({ level: "error", text: "В библиотеке нет треков для сборки микса." });
  const items = seq.map((x) => makeItem(x.t, x.block, x.why));
  return fitPlan(items, all, s, extra);
}

// ───────────── раскладка, проверка, отчёт ─────────────

function transitionIssues(a: Track, b: Track, tr: Transition, ia: PlanItem, ib: PlanItem, s: MixSettings): Issue[] {
  const out: Issue[] = [];
  const rel = camelotRelation(a.camelot, b.camelot);
  const de = b.energy - a.energy;
  const cutLike = tr.type === "cut" || tr.type === "loop_roll";
  if (rel.level === "clash") out.push({ level: "warn", text: `Конфликт тональностей ${rel.label}.${tr.type === "filter" ? " Замаскирован фильтром, но слышимость диссонанса возможна." : " Рекомендуется filter/cut или другой трек."}` });
  else if (rel.level === "risky") out.push({ level: tr.type === "filter" || cutLike ? "info" : "warn", text: `Диагональный переход ${rel.label} — безопаснее filter/cut.` });
  else if (rel.level === "boost" && de <= 0) out.push({ level: "warn", text: `${rel.label}: буст-переход при падении энергии (${de}) — звучит как «подскок» тональности.` });
  else if (rel.level === "unknown") out.push({ level: "info", text: "Тональность одного из треков неизвестна — гармония не проверена." });
  if (Math.abs(de) > 35) out.push({ level: "error", text: `Очень резкий скачок энергии: ${a.energy} → ${b.energy}.` });
  else if (Math.abs(de) > 20) out.push({ level: "warn", text: `Резкий скачок энергии: ${a.energy} → ${b.energy}.` });
  const n = Math.max(tr.bars, 4);
  const clash = vocalInRange(a, ia.outBar - n, ia.outBar) && vocalInRange(b, ib.inBar, ib.inBar + n);
  if (clash) out.push({ level: cutLike ? "info" : "warn", text: cutLike ? "Вокалы A и B рядом, но переход без перекрытия — голоса не накладываются." : `Вокальный конфликт: голос в зоне выхода A и в зоне входа B перекрываются на ${tr.bars} т.` });
  if ((a.noStretch || b.noStretch) && Math.abs(a.bpm - b.bpm) / a.bpm > 0.02 && tr.bars > 0) out.push({ level: "warn", text: "Трек без time-stretch и разные BPM: при перекрытии доли разойдутся. Выберите cut/filter." });
  const aLen = ia.outBar - ia.inBar;
  const bLen = ib.outBar - ib.inBar;
  if (tr.bars * 2 > Math.min(aLen, bLen) + 4) out.push({ level: "warn", text: "Переход занимает почти весь фрагмент трека — слишком много перекрытия." });
  if (ia.outBar % 4 !== 0 || ib.inBar % 4 !== 0) out.push({ level: "info", text: "Точка входа/выхода не выровнена по фразе (4 такта) — проверьте на прослушивании." });
  if (tr.type === "fade") out.push({ level: "info", text: "Fade — вспомогательный переход, в основной части теряется динамика." });
  return out;
}

export function fitPlan(itemsIn: PlanItem[], all: Track[] | Map<string, Track>, s: MixSettings, extra: Issue[] = []): Plan {
  const map = all instanceof Map ? all : new Map(all.map((t) => [t.id, t]));
  const items = itemsIn.filter((i) => map.has(i.trackId)).map((i) => ({ ...i }));
  const n = items.length;
  const tr = (i: PlanItem) => map.get(i.trackId)!;
  // 1. переходы
  for (let i = 0; i < n - 1; i++) {
    const a = tr(items[i]);
    const b = tr(items[i + 1]);
    const cur = items[i].trans;
    if (cur?.manual) {
      const rel = camelotRelation(a.camelot, b.camelot);
      items[i].trans = { ...cur, relation: rel.level, why: ["Задан вручную", rel.explain], issues: [] };
    } else {
      items[i].trans = chooseTransition(a, b, items[i].block, items[i + 1].block, s);
    }
  }
  if (n) items[n - 1].trans = null;
  // 2. сегменты
  for (let i = 0; i < n; i++) {
    const t = tr(items[i]);
    const nIn = i > 0 ? items[i - 1].trans!.bars : 0;
    const nOut = i < n - 1 ? items[i].trans!.bars : 0;
    const ub = usableBars(t);
    if (!items[i].manualPoints) {
      const seg = defaultSegment(t, nIn, nOut, items[i].block, i === 0, i === n - 1);
      items[i].inBar = seg.inBar;
      items[i].outBar = seg.outBar;
    } else {
      items[i].inBar = Math.max(0, Math.min(items[i].inBar, ub - 4));
      items[i].outBar = Math.max(items[i].inBar + 4, Math.min(items[i].outBar, ub));
    }
  }
  // 3. раскладка по долям
  let cur = 0;
  for (let i = 0; i < n; i++) {
    items[i].startBeat = cur;
    items[i].endBeat = cur + (items[i].outBar - items[i].inBar) * 4;
    const ov = i < n - 1 ? items[i].trans!.bars : 0;
    cur = items[i].endBeat - ov * 4;
  }
  // 4. границы кривой темпа
  let warmEnd = 0;
  let coolStart = n ? items[n - 1].endBeat : 0;
  const end = n ? items[n - 1].endBeat : 0;
  const lastOf = (b: BlockType) => {
    let k = -1;
    items.forEach((it, idx) => {
      if (it.block === b) k = idx;
    });
    return k;
  };
  const lw = lastOf("warmup");
  const lm = lastOf("main");
  if (lw >= 0) warmEnd = items[lw].endBeat;
  if (items.some((i) => i.block === "cooldown")) coolStart = lm >= 0 ? items[lm].endBeat : warmEnd;
  coolStart = Math.min(end, Math.max(warmEnd, coolStart));
  const bounds: Bounds = { warmEnd, coolStart, end };
  const tm = makeTempoMap(s, bounds);
  // 5. оценка
  const issues: Issue[] = [...extra];
  let keyClashes = 0;
  let vocalConflicts = 0;
  let energyJumps = 0;
  let maxStr = 0;
  for (let i = 0; i < n; i++) {
    const it = items[i];
    const t = tr(it);
    it.issues = [];
    let mn = Infinity;
    let mx = -Infinity;
    for (let j = 0; j <= 12; j++) {
      const sp = tm.bpmAtBeat(it.startBeat + ((it.endBeat - it.startBeat) * j) / 12) / t.bpm;
      mn = Math.min(mn, sp);
      mx = Math.max(mx, sp);
    }
    it.stretchMin = mn;
    it.stretchMax = mx;
    const dev = Math.max(mx - 1, 1 - mn) * 100;
    const mid = tm.bpmAtBeat((it.startBeat + it.endBeat) / 2);
    if (t.noStretch) {
      if (dev > 3) it.issues.push({ level: "warn", text: `Трек «не подгоняется»: его BPM ${t.bpm.toFixed(1)}, а кривая требует ≈${mid.toFixed(1)} — темп здесь будет отличаться на ${dev.toFixed(1)}%.` });
    } else {
      maxStr = Math.max(maxStr, dev);
      if (dev > s.maxStretch * 1.5) it.issues.push({ level: "error", text: `Растяжение до ${dev.toFixed(1)}% при лимите ${s.maxStretch}% — артефакты неизбежны. Замените трек на BPM ≈ ${mid.toFixed(0)} или отметьте «не подгонять».` });
      else if (dev > s.maxStretch) it.issues.push({ level: "warn", text: `Растяжение ${dev.toFixed(1)}% выше лимита ${s.maxStretch}%. Альтернатива: трек с BPM ≈ ${mid.toFixed(0)}.` });
      else if (t.bpm * 2 > 0 && Math.abs(mid / (t.bpm * 2) - 1) * 100 < 3 && dev > 12) it.issues.push({ level: "info", text: "BPM трека, возможно, определён в 2 раза неверно (проверьте ×2/÷2)." });
    }
    if (it.outBar - it.inBar < 16) it.issues.push({ level: "warn", text: "Очень короткий фрагмент трека (<16 тактов)." });
    if (t.bpmConfidence < 0.3 || t.gridConfidence < 0.25) it.issues.push({ level: "info", text: "Низкая уверенность анализа BPM/сетки — проверьте трек на экране анализа." });
    if (i < n - 1) {
      const nt = items[i].trans!;
      nt.issues = transitionIssues(t, tr(items[i + 1]), nt, it, items[i + 1], s);
      if (nt.issues.some((x) => x.text.startsWith("Конфликт тональностей"))) keyClashes++;
      if (nt.issues.some((x) => x.text.startsWith("Вокальный конфликт"))) vocalConflicts++;
      if (nt.issues.some((x) => x.text.includes("скачок энергии"))) energyJumps++;
      const prevE = t.energy;
      const nextE = tr(items[i + 1]).energy;
      if (items[i + 1].block === "cooldown" && items[i].block === "cooldown" && nextE > prevE + 8) it.issues.push({ level: "warn", text: "В заминке энергия растёт — нарушено правило плавного спада." });
      if (items[i + 1].block === "warmup" && items[i].block === "warmup" && nextE < prevE - 10) it.issues.push({ level: "warn", text: "В разминке энергия падает — нарушено правило постепенного нарастания." });
    }
    for (const x of it.issues) issues.push({ ...x, item: i });
    if (it.trans) for (const x of it.trans.issues) issues.push({ ...x, item: i });
  }
  if (new Set(items.map((i) => i.trackId)).size < n) issues.push({ level: "info", text: "Некоторые треки повторяются в плане." });
  // длительности блоков
  const tAt = (b: number) => tm.timeAtBeat(b);
  const dur = { warmup: 0, main: 0, cooldown: 0 };
  for (let i = 0; i < n; i++) {
    const a = tAt(items[i].startBeat);
    const b = i < n - 1 ? tAt(items[i + 1].startBeat) : tAt(items[i].endBeat);
    dur[items[i].block] += b - a;
  }
  const totalSec = n ? tAt(end) : 0;
  const planned = (s.warmupMin + s.mainMin + s.cooldownMin) * 60;
  if (n && Math.abs(totalSec - planned) / planned > 0.1)
    issues.push({ level: "warn", text: `Фактическая длительность ${(totalSec / 60).toFixed(1)} мин отличается от плана ${(planned / 60).toFixed(0)} мин (≥10%). Добавьте/уберите треки или измените точки выхода.` });
  const errors = issues.filter((x) => x.level === "error").length;
  const warns = issues.filter((x) => x.level === "warn").length;
  const report: Report = {
    score: Math.max(0, Math.round(100 - 14 * errors - 4 * warns)),
    issues,
    totalSec,
    warmupSec: dur.warmup,
    mainSec: dur.main,
    cooldownSec: dur.cooldown,
    maxStretchPct: maxStr,
    keyClashes,
    vocalConflicts,
    energyJumps,
    trackCount: n,
  };
  return { items, bounds, report };
}

/** Секунды начала/конца каждого элемента по карте темпа. */
export function itemTimes(plan: Plan, s: MixSettings) {
  const tm = makeTempoMap(s, plan.bounds);
  return { tm, times: plan.items.map((i) => ({ start: tm.timeAtBeat(i.startBeat), end: tm.timeAtBeat(i.endBeat) })) };
}

export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(r).padStart(2, "0")}`;
}
