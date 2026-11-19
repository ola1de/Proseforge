// Document job storage.
// Production: D1 holds job metadata ONLY (never document content); R2 holds
// the original and refined files under random UUID keys, never the original
// filename, never at a public URL. Local development / tests: when the D1/R2
// bindings are absent, a module-level in-memory store is used instead — it
// behaves the same way for the API, but it is per-isolate and not durable,
// so it must never be mistaken for production storage. The API reports
// which store is in use via /api/config (storage: "d1-r2" | "memory").

export type JobStatus =
  | "uploaded"
  | "analysing"
  | "refining"
  | "done"
  | "needs-provider"
  | "failed"
  | "deleted";

export interface JobRecord {
  id: string;
  format: string;
  originalFilename: string;
  mime: string;
  sizeBytes: number;
  status: JobStatus;
  stage: string;
  progress: number; // 0–100
  uploadedAt: string; // ISO
  deletedAt?: string;
  r2Key: string;
  refinedR2Key?: string;
  reportJson?: string;
  downloadTokenHash?: string;
  tokenExpiresAt?: string;
  error?: string;
}

export interface JobStore {
  kind: "d1-r2" | "memory";
  create(job: JobRecord, originalBytes: Uint8Array): Promise<void>;
  get(id: string): Promise<JobRecord | null>;
  update(id: string, patch: Partial<JobRecord>): Promise<void>;
  putRefined(id: string, key: string, bytes: Uint8Array): Promise<void>;
  getBytes(key: string): Promise<Uint8Array | null>;
  listExpired(cutoffIso: string): Promise<JobRecord[]>;
  purge(id: string): Promise<void>;
}

export function newJobId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function newDownloadToken(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function hashToken(token: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function cloneJob(j: JobRecord): JobRecord {
  return { ...j };
}

/** In-memory store: local dev + tests only. */
export class InMemoryJobStore implements JobStore {
  kind: "memory" = "memory";
  private jobs = new Map<string, JobRecord>();
  private blobs = new Map<string, Uint8Array>();

  async create(job: JobRecord, originalBytes: Uint8Array): Promise<void> {
    this.jobs.set(job.id, cloneJob(job));
    this.blobs.set(job.r2Key, originalBytes);
  }
  async get(id: string): Promise<JobRecord | null> {
    const j = this.jobs.get(id);
    return j ? cloneJob(j) : null;
  }
  async update(id: string, patch: Partial<JobRecord>): Promise<void> {
    const j = this.jobs.get(id);
    if (j) this.jobs.set(id, { ...j, ...patch });
  }
  async putRefined(id: string, key: string, bytes: Uint8Array): Promise<void> {
    this.blobs.set(key, bytes);
    await this.update(id, { refinedR2Key: key });
  }
  async getBytes(key: string): Promise<Uint8Array | null> {
    return this.blobs.get(key) ?? null;
  }
  async listExpired(cutoffIso: string): Promise<JobRecord[]> {
    return [...this.jobs.values()].filter((j) => j.uploadedAt < cutoffIso && j.status !== "deleted").map(cloneJob);
  }
  async purge(id: string): Promise<void> {
    const j = this.jobs.get(id);
    if (!j) return;
    this.blobs.delete(j.r2Key);
    if (j.refinedR2Key) this.blobs.delete(j.refinedR2Key);
    this.jobs.set(id, { ...j, status: "deleted", deletedAt: new Date().toISOString(), r2Key: "", refinedR2Key: undefined, reportJson: undefined, downloadTokenHash: undefined, tokenExpiresAt: undefined });
  }
}

/** Single in-memory store shared by requests in one isolate (local dev). */
export const memoryStore = new InMemoryJobStore();

// ---- D1 + R2 store (production) ----

interface D1Like {
  prepare: (sql: string) => {
    bind: (...args: unknown[]) => {
      run: () => Promise<unknown>;
      all: () => Promise<{ results?: Record<string, unknown>[] }>;
      first: () => Promise<Record<string, unknown> | null>;
    };
  };
}
interface R2Like {
  put: (key: string, value: Uint8Array | ArrayBuffer) => Promise<unknown>;
  get: (key: string) => Promise<{ arrayBuffer: () => Promise<ArrayBuffer> } | null>;
  delete: (key: string | string[]) => Promise<void>;
}

function rowToJob(row: Record<string, unknown>): JobRecord {
  return {
    id: String(row.id ?? ""),
    format: String(row.format ?? ""),
    originalFilename: String(row.original_filename ?? ""),
    mime: String(row.mime ?? ""),
    sizeBytes: Number(row.size_bytes ?? 0),
    status: (row.status as JobStatus) ?? "uploaded",
    stage: String(row.progress_stage ?? ""),
    progress: Number(row.progress ?? 0),
    uploadedAt: String(row.uploaded_at ?? ""),
    deletedAt: row.deleted_at ? String(row.deleted_at) : undefined,
    r2Key: String(row.r2_key ?? ""),
    refinedR2Key: row.refined_r2_key ? String(row.refined_r2_key) : undefined,
    reportJson: row.report_json ? String(row.report_json) : undefined,
    downloadTokenHash: row.download_token_hash ? String(row.download_token_hash) : undefined,
    tokenExpiresAt: row.token_expires_at ? String(row.token_expires_at) : undefined,
    error: row.error ? String(row.error) : undefined,
  };
}

export class D1R2JobStore implements JobStore {
  kind: "d1-r2" = "d1-r2";
  constructor(private db: D1Like, private bucket: R2Like) {}

  async create(job: JobRecord, originalBytes: Uint8Array): Promise<void> {
    await this.bucket.put(job.r2Key, originalBytes);
    await this.db.prepare(
      "INSERT INTO jobs (id, r2_key, original_filename, mime, size_bytes, status, progress_stage, progress, uploaded_at, format) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(job.id, job.r2Key, job.originalFilename, job.mime, job.sizeBytes, job.status, job.stage, job.progress, job.uploadedAt, job.format).run();
  }
  async get(id: string): Promise<JobRecord | null> {
    const row = await this.db.prepare("SELECT * FROM jobs WHERE id = ?").bind(id).first();
    return row ? rowToJob(row) : null;
  }
  async update(id: string, patch: Partial<JobRecord>): Promise<void> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    const map: Record<string, unknown> = {
      status: patch.status, progress_stage: patch.stage, progress: patch.progress,
      deleted_at: patch.deletedAt, refined_r2_key: patch.refinedR2Key,
      report_json: patch.reportJson, download_token_hash: patch.downloadTokenHash,
      token_expires_at: patch.tokenExpiresAt, error: patch.error, r2_key: patch.r2Key,
    };
    for (const [col, v] of Object.entries(map)) {
      if (v !== undefined) { sets.push(`${col} = ?`); vals.push(v); }
    }
    if (!sets.length) return;
    await this.db.prepare(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id).run();
  }
  async putRefined(id: string, key: string, bytes: Uint8Array): Promise<void> {
    await this.bucket.put(key, bytes);
    await this.update(id, { refinedR2Key: key });
  }
  async getBytes(key: string): Promise<Uint8Array | null> {
    const obj = await this.bucket.get(key);
    if (!obj) return null;
    return new Uint8Array(await obj.arrayBuffer());
  }
  async listExpired(cutoffIso: string): Promise<JobRecord[]> {
    const res = await this.db.prepare("SELECT * FROM jobs WHERE uploaded_at < ? AND status != 'deleted'").bind(cutoffIso).all();
    return (res.results ?? []).map(rowToJob);
  }
  async purge(id: string): Promise<void> {
    const job = await this.get(id);
    if (!job) return;
    const keys = [job.r2Key, job.refinedR2Key].filter(Boolean) as string[];
    if (keys.length) await this.bucket.delete(keys);
    await this.db.prepare("UPDATE jobs SET status = 'deleted', deleted_at = ?, r2_key = '', refined_r2_key = NULL, report_json = NULL, download_token_hash = NULL, token_expires_at = NULL WHERE id = ?")
      .bind(new Date().toISOString(), id).run();
  }
}

/** Resolve the store for this environment. D1+R2 when both bindings exist, else in-memory. */
export function resolveJobStore(env: { DB?: unknown; DOCS_BUCKET?: unknown }): JobStore {
  if (env.DB && env.DOCS_BUCKET) {
    return new D1R2JobStore(env.DB as D1Like, env.DOCS_BUCKET as R2Like);
  }
  return memoryStore;
}

/** Delete every job older than 48 h (measured from upload time). Used by the scheduled handler. */
export async function purgeExpiredJobs(store: JobStore, nowMs = Date.now()): Promise<{ deleted: number; note: string }> {
  const cutoff = new Date(nowMs - 48 * 60 * 60 * 1000).toISOString();
  try {
    const expired = await store.listExpired(cutoff);
    for (const job of expired) await store.purge(job.id);
    return { deleted: expired.length, note: `Deleted ${expired.length} document job(s) older than 48 hours.` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return { deleted: 0, note: `Cleanup skipped: jobs store unavailable (${msg}).` };
  }
}
