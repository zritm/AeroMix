import type { MixSettings, Plan, Track } from "./types";

export function ownerId(): string {
  let id = localStorage.getItem("aeromix-owner");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("aeromix-owner", id);
  }
  return id;
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", "x-owner": ownerId(), ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
  return (await res.json()) as T;
}

export interface Project {
  id: string;
  name: string;
  settings: MixSettings;
  plan: Plan | null;
  updatedAt: string;
}

export const api = {
  listTracks: () => req<Track[]>("/api/tracks"),
  getTrack: (id: string) => req<Track>(`/api/tracks/${id}`),
  createTrack: (t: Track) => req<Track>("/api/tracks", { method: "POST", body: JSON.stringify(t) }),
  updateTrack: (id: string, patch: Partial<Track>) => req<Track>(`/api/tracks/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteTrack: (id: string) => req<{ ok: boolean }>(`/api/tracks/${id}`, { method: "DELETE" }),
  listProjects: () => req<Project[]>("/api/projects"),
  getProject: (id: string) => req<Project>(`/api/projects/${id}`),
  createProject: (p: { id: string; name: string; settings: MixSettings; plan: Plan | null }) =>
    req<Project>("/api/projects", { method: "POST", body: JSON.stringify(p) }),
  updateProject: (id: string, p: { name: string; settings: MixSettings; plan: Plan | null }) =>
    req<Project>(`/api/projects/${id}`, { method: "PUT", body: JSON.stringify(p) }),
  deleteProject: (id: string) => req<{ ok: boolean }>(`/api/projects/${id}`, { method: "DELETE" }),
};
