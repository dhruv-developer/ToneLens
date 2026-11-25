import type {
  Analysis, AnalysisSummary, AppConfig, CompareItem, DrillResult, Evaluation, Interpretation, Kind, Mode, Profile, Stats,
} from "./types";

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

export class ApiError extends Error {
  constructor(public status: number, public detail: unknown) {
    super(typeof detail === "string" ? detail : (detail as { message?: string })?.message ?? `HTTP ${status}`);
  }
  get code(): string | undefined {
    return (this.detail as { code?: string } | undefined)?.code;
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(BASE + path, init);
  if (!r.ok) {
    let detail: unknown = r.statusText;
    try {
      detail = (await r.json()).detail;
    } catch {
      /* not json */
    }
    throw new ApiError(r.status, detail);
  }
  if (r.status === 204) return undefined as T;
  return r.json() as Promise<T>;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export interface UploadOptions {
  context?: string;
  title?: string;
  kind?: Kind;
  profileId?: string | null;
  referenceId?: string | null;
  modelSize?: string;
  language?: string | null;
}

export const api = {
  config: () => req<AppConfig>("/api/config"),
  stats: () => req<Stats>("/api/stats"),
  list: (p: { q?: string; kind?: Kind | "all"; status?: string; labeled?: boolean; limit?: number; offset?: number } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(p).forEach(([k, v]) => v !== undefined && v !== "" && qs.set(k, String(v)));
    return req<{ total: number; items: AnalysisSummary[] }>(`/api/analyses?${qs}`);
  },
  get: (id: string) => req<Analysis>(`/api/analyses/${id}`),
  upload: (file: Blob, filename: string, o: UploadOptions = {}) => {
    const fd = new FormData();
    fd.append("file", file, filename);
    if (o.context) fd.append("context", o.context);
    if (o.title) fd.append("title", o.title);
    fd.append("kind", o.kind ?? "analysis");
    if (o.profileId) fd.append("profile_id", o.profileId);
    if (o.referenceId) fd.append("reference_id", o.referenceId);
    if (o.modelSize) fd.append("model_size", o.modelSize);
    if (o.language) fd.append("language", o.language);
    return req<{ id: string }>("/api/analyses", { method: "POST", body: fd });
  },
  patch: (id: string, body: Partial<Pick<Analysis, "title" | "tags" | "label" | "context">>) =>
    req<Analysis>(`/api/analyses/${id}`, json("PATCH", body)),
  remove: (id: string) => req<void>(`/api/analyses/${id}`, { method: "DELETE" }),
  interpret: (id: string, mode: Mode, context?: string, force = false) =>
    req<Interpretation>(`/api/analyses/${id}/interpret`, json("POST", { mode, context, force })),
  similar: (id: string) => req<{ items: (AnalysisSummary & { similarity: number })[] }>(`/api/analyses/${id}/similar`),
  compare: (ids: string[]) =>
    req<{ items: CompareItem[]; pairs: { a: string; b: string; similarity: number }[] }>("/api/compare", json("POST", { ids })),
  profiles: () => req<Profile[]>("/api/profiles"),
  createProfile: (name: string) => req<Profile>("/api/profiles", json("POST", { name })),
  resetProfile: (id: string) => req<Profile>(`/api/profiles/${id}/reset`, { method: "POST" }),
  deleteProfile: (id: string) => req<void>(`/api/profiles/${id}`, { method: "DELETE" }),
  drillAttempts: (refId: string) => req<AnalysisSummary[]>(`/api/drills/${refId}/attempts`),
  drillScore: (reference_id: string, attempt_id: string) => req<DrillResult>("/api/drills/score", json("POST", { reference_id, attempt_id })),
  evaluation: () => req<Evaluation>("/api/evaluation"),
  runEvaluation: () => req<{ ran: number; errors: unknown[] }>("/api/evaluation/run", { method: "POST" }),
  exportUrl: (id: string, format: "json" | "csv" | "md") => `${BASE}/api/analyses/${id}/export?format=${format}`,
  audioUrl: (id: string) => `${BASE}/api/analyses/${id}/audio`,
};

export interface ProgressEvent { status: string; stage: string; progress: number; error: string | null }

/** Server-sent progress events for one analysis. Returns an unsubscribe fn. */
export function subscribeProgress(id: string, onEvent: (e: ProgressEvent) => void): () => void {
  const es = new EventSource(`${BASE}/api/analyses/${id}/events`);
  es.addEventListener("progress", (m) => {
    const e = JSON.parse((m as MessageEvent).data) as ProgressEvent;
    onEvent(e);
    if (e.status === "done" || e.status === "failed") es.close();
  });
  es.onerror = () => es.close();
  return () => es.close();
}
