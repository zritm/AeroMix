import { analyzeBuffer } from "./analysis";
import { api } from "./api";
import { decodeBlob, putAudio, readId3 } from "./audio";
import type { DemoSpec } from "./demo";
import type { Track } from "./types";

export const LIMITS = {
  maxBytes: 150 * 1024 * 1024,
  maxDurationSec: 20 * 60,
  minDurationSec: 20,
  exts: ["mp3", "wav", "flac", "ogg", "oga", "m4a", "aac", "opus", "webm"],
};

export async function ingestFile(file: File, onProgress: (p: number, label: string) => void, demo?: DemoSpec): Promise<Track> {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (!LIMITS.exts.includes(ext)) throw new Error(`Формат .${ext || "?"} не поддерживается. Допустимо: ${LIMITS.exts.join(", ")}`);
  if (file.size > LIMITS.maxBytes) throw new Error(`Файл ${(file.size / 1048576).toFixed(0)} МБ больше лимита ${LIMITS.maxBytes / 1048576} МБ`);
  if (file.size < 10000) throw new Error("Файл слишком маленький или повреждён");
  onProgress(0.02, "Чтение тегов");
  const tags = await readId3(file);
  onProgress(0.05, "Декодирование");
  let buf: AudioBuffer;
  try {
    buf = await decodeBlob(file);
  } catch {
    throw new Error("Не удалось декодировать аудио: файл повреждён или кодек не поддерживается браузером. Конвертируйте в WAV/MP3.");
  }
  if (buf.duration > LIMITS.maxDurationSec) throw new Error(`Длительность ${(buf.duration / 60).toFixed(1)} мин больше лимита ${LIMITS.maxDurationSec / 60} мин`);
  if (buf.duration < LIMITS.minDurationSec) throw new Error("Трек короче 20 секунд — для микса не подходит");
  const r = await analyzeBuffer(buf, (p, l) => onProgress(0.1 + p * 0.85, l));
  const base = file.name.replace(/\.[^.]+$/, "");
  let artist = tags.artist ?? "";
  let title = tags.title ?? "";
  if (!title) {
    const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(base);
    if (m) {
      artist = artist || m[1];
      title = m[2];
    } else title = base;
  }
  const track: Track = {
    id: crypto.randomUUID(),
    title,
    artist,
    filename: file.name,
    format: ext,
    sizeBytes: file.size,
    duration: Math.round(buf.duration * 10) / 10,
    bpm: r.bpm,
    bpmConfidence: r.bpmConfidence,
    key: r.key,
    camelot: r.camelot,
    keyConfidence: r.keyConfidence,
    energy: r.energy,
    hasVocals: demo ? demo.vocal : r.hasVocals,
    vocalConfidence: demo ? 1 : r.vocalConfidence,
    density: r.density,
    dryness: r.dryness,
    genre: tags.genre ?? (demo ? "demo" : ""),
    tags: demo ? ["demo"] : [],
    playlist: demo ? "Демо" : "",
    priority: 3,
    noStretch: false,
    firstDownbeat: r.firstDownbeat,
    gridConfidence: r.gridConfidence,
    totalBars: r.totalBars,
    rmsDb: r.rmsDb,
    sections: demo ? r.sections.map((s) => ({ ...s, vocal: demo.vocal && s.type === "main" })) : r.sections,
    cues: { in: null, out: null, hot: r.hot },
    waveform: r.waveform,
    edits: demo ? ["vocal"] : [],
  };
  onProgress(0.97, "Сохранение");
  await putAudio(track.id, file);
  return await api.createTrack(track);
}
