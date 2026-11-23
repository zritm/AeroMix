// Хранилище аудио (IndexedDB), декодирование и чтение ID3-тегов. Аудио не покидает браузер.

const DB_NAME = "aeromix-audio";
const STORE = "files";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const r = fn(db.transaction(STORE, mode).objectStore(STORE));
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      }),
  );
}

export const putAudio = (id: string, blob: Blob) => tx("readwrite", (s) => s.put(blob, id));
export const getAudio = (id: string) => tx<Blob | undefined>("readonly", (s) => s.get(id) as IDBRequest<Blob | undefined>);
export const delAudio = (id: string) => tx("readwrite", (s) => s.delete(id));
export const listAudioIds = () => tx<IDBValidKey[]>("readonly", (s) => s.getAllKeys()).then((k) => new Set(k.map(String)));

export const SAMPLE_RATE = 44100;

export async function decodeBlob(blob: Blob): Promise<AudioBuffer> {
  const arr = await blob.arrayBuffer();
  const ctx = new OfflineAudioContext(2, 1, SAMPLE_RATE);
  return await ctx.decodeAudioData(arr);
}

const cache: { id: string; buf: AudioBuffer }[] = [];
export async function loadAudioBuffer(id: string): Promise<AudioBuffer> {
  const hit = cache.find((c) => c.id === id);
  if (hit) return hit.buf;
  const blob = await getAudio(id);
  if (!blob) throw new Error("Аудиофайл не найден в этом браузере. Загрузите трек заново.");
  const buf = await decodeBlob(blob);
  cache.push({ id, buf });
  if (cache.length > 3) cache.shift();
  return buf;
}
export function dropAudioCache(id: string) {
  const i = cache.findIndex((c) => c.id === id);
  if (i >= 0) cache.splice(i, 1);
}

function decodeText(bytes: Uint8Array): string {
  if (!bytes.length) return "";
  const enc = bytes[0];
  const body = bytes.slice(1);
  try {
    if (enc === 0) return new TextDecoder("windows-1251").decode(body).replace(/\0+$/g, "");
    if (enc === 1) return new TextDecoder("utf-16").decode(body).replace(/\0+$/g, "");
    if (enc === 2) return new TextDecoder("utf-16be").decode(body).replace(/\0+$/g, "");
    return new TextDecoder("utf-8").decode(body).replace(/\0+$/g, "");
  } catch {
    return "";
  }
}

export async function readId3(file: Blob): Promise<{ title?: string; artist?: string; genre?: string }> {
  try {
    const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    if (String.fromCharCode(head[0], head[1], head[2]) !== "ID3") return {};
    const ver = head[3];
    const size = (head[6] << 21) | (head[7] << 14) | (head[8] << 7) | head[9];
    const data = new Uint8Array(await file.slice(10, 10 + Math.min(size, 400000)).arrayBuffer());
    const res: { title?: string; artist?: string; genre?: string } = {};
    let p = 0;
    while (p + 10 < data.length) {
      const id = String.fromCharCode(data[p], data[p + 1], data[p + 2], data[p + 3]);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      const sz =
        ver === 4
          ? (data[p + 4] << 21) | (data[p + 5] << 14) | (data[p + 6] << 7) | data[p + 7]
          : (data[p + 4] * 2 ** 24) + (data[p + 5] << 16) + (data[p + 6] << 8) + data[p + 7];
      if (sz <= 0 || p + 10 + sz > data.length) break;
      const text = () => decodeText(data.slice(p + 10, p + 10 + sz)).trim();
      if (id === "TIT2") res.title = text();
      if (id === "TPE1") res.artist = text();
      if (id === "TCON") res.genre = text().replace(/^\(\d+\)/, "");
      p += 10 + sz;
    }
    return res;
  } catch {
    return {};
  }
}
