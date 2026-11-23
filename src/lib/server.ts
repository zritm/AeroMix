export const TRACK_FIELDS = [
  "id", "title", "artist", "filename", "format", "sizeBytes", "duration", "bpm", "bpmConfidence", "key", "camelot",
  "keyConfidence", "energy", "hasVocals", "vocalConfidence", "density", "dryness", "genre", "tags", "playlist",
  "priority", "noStretch", "firstDownbeat", "gridConfidence", "totalBars", "rmsDb", "sections", "cues", "waveform", "edits",
] as const;

export const PROJECT_FIELDS = ["id", "name", "settings", "plan"] as const;

export function getOwner(req: Request): string | null {
  const o = req.headers.get("x-owner");
  if (!o || o.length < 8 || o.length > 80) return null;
  return o;
}

export function pick(body: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) if (f in body && body[f] !== undefined) out[f] = body[f];
  return out;
}

export const noOwner = () => Response.json({ error: "x-owner header required" }, { status: 400 });
