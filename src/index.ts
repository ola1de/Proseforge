// Proseforge Worker — text refinement platform (Milestone 1) + research
// document engine (Milestone 2).
// No login anywhere. Text is processed in memory and never persisted.
// Uploaded documents live in private R2 (or in-memory locally) and are
// deleted by the scheduled cleanup 48 hours after upload.
import { analyseText, flagUnsupportedClaims } from "./analysis";
import { splitIntoChunks, terminologyNote, countWords } from "./chunking";
import { ACADEMIC_SECTIONS, buildAcademicPrompt, buildConstructPrompt, buildSystemPrompt } from "./prompts";
import { DISCIPLINES, MODES, INTENSITIES, findIntensity, findMode } from "./modes";
import { PROVIDER_NOT_CONFIGURED_SETUP, getModel, resolveProvider, resolveProviderKind, type AIProvider } from "./providers";
import { RateLimiter, applySecurityHeaders, clientIp, corsHeaders, sanitiseFilename } from "./security";
import { MAX_DOC_BYTES_DEFAULT, SUPPORTED_FORMATS, checkZipExpandedSize, processDocumentJob, publicJobView, validateUpload, type DocFormat, type ProcessOptions } from "./documents";
import { hashToken, newDownloadToken, newJobId, purgeExpiredJobs, resolveJobStore, type JobRecord } from "./store";
import type { ApiErrorBody, Env, Intensity } from "./types";

const VERSION = "0.1.0";
const limiters = new Map<number, RateLimiter>();
function limiterFor(perMinute: number): RateLimiter {
  let l = limiters.get(perMinute);
  if (!l) { l = new RateLimiter(perMinute); limiters.set(perMinute, l); }
  return l;
}

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...extraHeaders } });
}
function err(error: string, message: string, status: number, setup?: string[]): Response {
  const body: ApiErrorBody = { error, message, ...(setup ? { setup } : {}) };
  return json(body, status);
}
function maxTextChars(env: Env): number {
  const n = Number(env.MAX_TEXT_CHARS ?? "100000");
  return Number.isFinite(n) && n > 0 ? n : 100000;
}
function timeoutMs(env: Env): number {
  const n = Number(env.AI_TIMEOUT_MS ?? "60000");
  return Number.isFinite(n) && n > 0 ? n : 60000;
}
function rateLimit(env: Env): number {
  const n = Number(env.RATE_LIMIT_PER_MINUTE ?? "30");
  return Number.isFinite(n) && n > 0 ? n : 30;
}
function maxDocBytes(env: Env): number {
  const n = Number(env.DOC_MAX_BYTES ?? String(MAX_DOC_BYTES_DEFAULT));
  return Number.isFinite(n) && n > 0 ? n : MAX_DOC_BYTES_DEFAULT;
}
function docOptions(form: FormData): ProcessOptions {
  const str = (k: string) => { const v = form.get(k); return typeof v === "string" ? v : ""; };
  const mode = findMode(str("mode") || "academic")?.id ?? "academic";
  const intensity = (findIntensity(str("intensity") || "balanced")?.id ?? "balanced") as Intensity;
  const discipline = DISCIPLINES.includes(str("discipline")) ? str("discipline") : "General";
  const customVoice = str("customVoice").slice(0, 2000);
  return {
    mode, intensity, customVoice, discipline,
    protectCitations: str("protectCitations") !== "false",
    protectTables: str("protectTables") !== "false",
  };
}
async function kickOffProcessing(env: Env, job: JobRecord, opts: ProcessOptions, waitUntil?: (p: Promise<unknown>) => void): Promise<void> {
  const store = resolveJobStore(env);
  const run = processDocumentJob(store, resolveProvider(env), job, opts, timeoutMs(env));
  if (waitUntil) waitUntil(run);
  else await run;
}

async function readJsonBody(req: Request, maxBytes: number): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; response: Response }> {
  const len = Number(req.headers.get("Content-Length") ?? "0");
  if (len > maxBytes) return { ok: false, response: err("REQUEST_TOO_LARGE", `Request body exceeds the ${maxBytes}-byte limit.`, 413) };
  let raw: string;
  try { raw = await req.text(); } catch { return { ok: false, response: err("BAD_REQUEST", "Could not read the request body.", 400) }; }
  if (raw.length > maxBytes) return { ok: false, response: err("REQUEST_TOO_LARGE", `Request body exceeds the ${maxBytes}-byte limit.`, 413) };
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, response: err("BAD_REQUEST", "Request body must be a JSON object.", 400) };
    return { ok: true, value };
  } catch {
    return { ok: false, response: err("BAD_REQUEST", "Request body is not valid JSON.", 400) };
  }
}

function validateText(text: unknown, env: Env): { ok: true; text: string } | { ok: false; response: Response } {
  if (typeof text !== "string" || !text.trim()) return { ok: false, response: err("BAD_REQUEST", "Provide non-empty text to refine.", 400) };
  if (text.length > maxTextChars(env)) {
    return { ok: false, response: err("TEXT_TOO_LONG", `Text exceeds the ${maxTextChars(env).toLocaleString()}-character limit for this endpoint. For whole documents, use the Research Document workspace (Milestone 2).`, 413) };
  }
  return { ok: true, text };
}

function requireProvider(env: Env): { ok: true; provider: AIProvider } | { ok: false; response: Response } {
  const provider = resolveProvider(env);
  if (!provider) {
    return { ok: false, response: err("PROVIDER_NOT_CONFIGURED", PROVIDER_NOT_CONFIGURED_SETUP[0] ?? "No AI provider is configured.", 503, PROVIDER_NOT_CONFIGURED_SETUP) };
  }
  return { ok: true, provider };
}

function providerErrorResponse(e: unknown): Response {
  const code = (e as { code?: string })?.code;
  const message = e instanceof Error ? e.message : "AI provider error.";
  if (code === "AI_TIMEOUT") return err("AI_TIMEOUT", "The AI provider took too long to respond. Please try again with shorter text.", 504);
  if (code === "AI_RATE_LIMITED") return err("AI_RATE_LIMITED", message, 429);
  if (code === "PROVIDER_NOT_CONFIGURED") return err("PROVIDER_NOT_CONFIGURED", message, 503, PROVIDER_NOT_CONFIGURED_SETUP);
  // Never leak provider internals.
  return err("AI_PROVIDER_ERROR", "The AI provider could not complete this request. Please try again later.", 502);
}

async function refineWithChunks(provider: AIProvider, env: Env, text: string, system: string): Promise<string> {
  const chunks = splitIntoChunks(text);
  const out: string[] = [];
  let seen = "";
  for (const chunk of chunks) {
    const context = seen ? `${terminologyNote(seen)}\n\n` : "";
    const user = `${context}${chunk.overlap && chunk.index > 0 ? `Previous paragraph (for context only, do not repeat it): ${chunk.overlap}\n\n` : ""}Refine the following text:\n\n${chunk.text}`;
    const refined = await provider.complete({ system, user, maxTokens: 4096, timeoutMs: timeoutMs(env) });
    out.push(refined);
    seen += `\n${chunk.text}`;
  }
  return out.join("\n\n");
}

export async function handleApi(req: Request, env: Env, url: URL, waitUntil?: (p: Promise<unknown>) => void): Promise<Response> {
  const path = url.pathname;
  const cors = corsHeaders(req, env);
  if (req.method === "OPTIONS") return json({}, 204, cors);

  if (path === "/api/health" && req.method === "GET") {
    return json({ ok: true, service: "proseforge", version: VERSION, provider: resolveProviderKind(env), model: getModel(env), timestamp: new Date().toISOString() }, 200, cors);
  }
  if (path === "/api/config" && req.method === "GET") {
    return json({
      provider: resolveProviderKind(env), model: getModel(env), maxTextChars: maxTextChars(env),
      modes: MODES.map((m) => ({ id: m.id, label: m.label, description: m.description })),
      intensities: INTENSITIES, disciplines: DISCIPLINES,
      academicSections: Object.entries(ACADEMIC_SECTIONS).map(([id, s]) => ({ id, label: s.label })),
      documentsAvailable: true,
      documentsNote: "Document upload and processing are available. DOCX/ODT preserve structure; PDF returns refined text (layout is not rebuilt); scanned PDFs cannot be OCRed in a Worker.",
      documentFormats: Object.entries(SUPPORTED_FORMATS).map(([id, f]) => ({ id, label: f.label, mime: f.mime })),
      maxDocBytes: maxDocBytes(env),
      storage: resolveJobStore(env).kind,
    }, 200, cors);
  }

  // ---- Research document routes (Milestone 2) ----
  if (path.startsWith("/api/documents")) {
    return handleDocuments(req, env, url, waitUntil);
  }

  if (req.method !== "POST") return err("NOT_FOUND", "Unknown endpoint.", 404);

  // Rate limiting (per-IP, approximate at the edge — see 02-architecture.md).
  const limit = rateLimit(env);
  const key = `${clientIp(req)}:${path}`;
  if (!limiterFor(limit).allow(key)) return err("RATE_LIMITED", "Too many requests. Please wait a minute and try again.", 429);

  const body = await readJsonBody(req, 250_000);
  if (!body.ok) return body.response;

  if (path === "/api/analyse") {
    const v = validateText(body.value.text, env);
    if (!v.ok) return v.response;
    const refined = typeof body.value.refinedText === "string" && body.value.refinedText.trim() ? body.value.refinedText : undefined;
    return json({
      original: analyseText(v.text),
      ...(refined ? { refined: analyseText(refined) } : {}),
      note: "These are transparent editorial indicators computed from the text itself. They are not scientifically validated scores.",
    }, 200, cors);
  }

  if (path === "/api/refine") {
    const v = validateText(body.value.text, env);
    if (!v.ok) return v.response;
    const mode = findMode(typeof body.value.mode === "string" ? body.value.mode : "natural");
    if (!mode) return err("BAD_REQUEST", `Unknown refinement mode: ${String(body.value.mode)}.`, 400);
    const intensity = (findIntensity(typeof body.value.intensity === "string" ? body.value.intensity : "balanced")?.id ?? "balanced") as Intensity;
    const discipline = typeof body.value.discipline === "string" && DISCIPLINES.includes(body.value.discipline) ? body.value.discipline : "General";
    const customVoice = typeof body.value.customVoice === "string" ? body.value.customVoice.slice(0, 2000) : "";
    if (mode.id === "custom" && !customVoice.trim()) return err("BAD_REQUEST", "Custom Voice mode needs a description of your preferred writing style.", 400);
    const p = requireProvider(env);
    if (!p.ok) return p.response;
    try {
      const system = buildSystemPrompt({ modeId: mode.id, intensity, customVoice, discipline });
      const refined = await refineWithChunks(p.provider, env, v.text, system);
      return json({ refined, mode: mode.id, intensity, discipline, words: countWords(v.text), chunks: splitIntoChunks(v.text).length }, 200, cors);
    } catch (e) { return providerErrorResponse(e); }
  }

  if (path === "/api/academic") {
    const v = validateText(body.value.text, env);
    if (!v.ok) return v.response;
    const section = typeof body.value.section === "string" ? body.value.section : "";
    if (!ACADEMIC_SECTIONS[section]) return err("BAD_REQUEST", `Unknown academic section: ${section}.`, 400);
    const discipline = typeof body.value.discipline === "string" && DISCIPLINES.includes(body.value.discipline) ? body.value.discipline : "General";
    const p = requireProvider(env);
    if (!p.ok) return p.response;
    try {
      const refined = await refineWithChunks(p.provider, env, v.text, buildAcademicPrompt(section, discipline));
      const unsupportedClaims = flagUnsupportedClaims(v.text);
      return json({ refined, section, discipline, unsupportedClaims, claimNote: unsupportedClaims.length ? "These sentences make factual claims without a citation in the text. Verify them and add a source yourself — Proseforge never invents citations." : "No unsupported factual claims were flagged in this text." }, 200, cors);
    } catch (e) { return providerErrorResponse(e); }
  }

  if (path === "/api/construct") {
    const v = validateText(body.value.text, env);
    if (!v.ok) return v.response;
    const discipline = typeof body.value.discipline === "string" && DISCIPLINES.includes(body.value.discipline) ? body.value.discipline : "General";
    const p = requireProvider(env);
    if (!p.ok) return p.response;
    try {
      const raw = await p.provider.complete({ system: buildConstructPrompt(discipline), user: v.text, maxTokens: 2048, timeoutMs: timeoutMs(env) });
      const alternatives = raw.split(/\n/).map((l) => l.replace(/^\s*\d+[.)]\s*/, "").trim()).filter(Boolean).slice(0, 3);
      if (alternatives.length === 0) return err("AI_PROVIDER_ERROR", "The AI provider returned an unusable response. Please try again.", 502);
      return json({ alternatives, original: v.text, discipline }, 200, cors);
    } catch (e) { return providerErrorResponse(e); }
  }

  return err("NOT_FOUND", "Unknown endpoint.", 404);
}

async function handleDocuments(req: Request, env: Env, url: URL, waitUntil?: (p: Promise<unknown>) => void): Promise<Response> {
  const cors = corsHeaders(req, env);
  const store = resolveJobStore(env);
  const parts = url.pathname.split("/").filter(Boolean); // ["api","documents",...]
  const action = parts[2] ?? "";

  // POST /api/documents/upload (multipart form, field "file")
  if (action === "upload" && req.method === "POST") {
    const limit = 10; // uploads are expensive: 10/min/IP
    if (!limiterFor(limit).allow(`${clientIp(req)}:/api/documents/upload`)) {
      return err("RATE_LIMITED", "Too many uploads. Please wait a minute and try again.", 429);
    }
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return err("BAD_REQUEST", "Upload must be a multipart form with a file field named \"file\".", 400);
    }
    const file = form.get("file");
    if (!file || typeof file === "string" || !(file instanceof File)) {
      return err("BAD_REQUEST", "No file was uploaded. Attach a .docx, .odt, .pdf, .rtf, or .txt file.", 400);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const filename = sanitiseFilename(file.name || "document");
    const valid = validateUpload(filename, bytes, maxDocBytes(env));
    if (!valid.ok) return err("INVALID_DOCUMENT", valid.error, 400);
    if (valid.format === "docx" || valid.format === "odt") {
      const zipCheck = await checkZipExpandedSize(bytes);
      if (!zipCheck.ok) return err("INVALID_DOCUMENT", zipCheck.error, 400);
    }
    const jobId = newJobId();
    const job: JobRecord = {
      id: jobId, format: valid.format, originalFilename: filename,
      mime: file.type || SUPPORTED_FORMATS[valid.format].mime, sizeBytes: bytes.length,
      status: "uploaded", stage: "Uploaded — queued for analysis", progress: 5,
      uploadedAt: new Date().toISOString(), r2Key: `original/${jobId}`,
    };
    try {
      await store.create(job, bytes);
    } catch (e) {
      return err("STORAGE_ERROR", `Could not store the upload (${e instanceof Error ? e.message : "storage unavailable"}). Please try again.`, 500);
    }
    const opts = docOptions(form);
    await kickOffProcessing(env, job, opts, waitUntil);
    const current = (await store.get(job.id)) ?? job;
    return json({ job: publicJobView(current), note: "Processing runs in the background. Poll the status endpoint for progress; the file is deleted automatically 48 hours after upload." }, 202, cors);
  }

  const id = action;
  if (!id || !/^[0-9a-f]{32}$/.test(id)) return err("NOT_FOUND", "Unknown document endpoint.", 404);
  const sub = parts[3] ?? "";
  const job = await store.get(id);
  if (!job) return err("NOT_FOUND", "No document job with that id. It may have been deleted after 48 hours.", 404);
  if (job.status === "deleted") return err("GONE", "This document was deleted 48 hours after upload, as stated in the privacy policy. Please upload it again.", 410);

  // POST /api/documents/:id/retry — re-run a needs-provider or failed job.
  if (sub === "retry" && req.method === "POST") {
    if (job.status !== "needs-provider" && job.status !== "failed") {
      return err("BAD_REQUEST", `Job is ${job.status} and cannot be retried.`, 400);
    }
    const opts: ProcessOptions = { mode: "academic", intensity: "balanced", discipline: "General", protectCitations: true, protectTables: true };
    await store.update(id, { status: "uploaded", stage: "Retrying", progress: 5, error: undefined });
    await kickOffProcessing(env, { ...job, status: "uploaded" }, opts, waitUntil);
    const current = (await store.get(id)) ?? job;
    return json({ job: publicJobView(current) }, 202, cors);
  }

  // GET /api/documents/:id/status — includes a fresh short-lived download
  // token (rotated on each poll) once the job is done.
  if (sub === "status" && req.method === "GET") {
    const view = publicJobView(job);
    if (job.status === "done") {
      const token = newDownloadToken();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      await store.update(id, { downloadTokenHash: await hashToken(token), tokenExpiresAt: expiresAt });
      view.downloadToken = token;
      view.downloadExpiresAt = expiresAt;
    }
    return json({ job: view }, 200, cors);
  }

  // GET /api/documents/:id/report
  if (sub === "report" && req.method === "GET") {
    if (!job.reportJson) return err("NOT_FOUND", "No processing report yet — the job has not finished.", 404);
    return json(JSON.parse(job.reportJson) as unknown, 200, cors);
  }

  // GET /api/documents/:id/download?token=…&kind=refined|original
  if (sub === "download" && req.method === "GET") {
    if (job.status !== "done") return err("BAD_REQUEST", `Document is ${job.status}; there is nothing to download yet.`, 400);
    const token = url.searchParams.get("token") ?? "";
    const kind = url.searchParams.get("kind") === "original" ? "original" : "refined";
    if (!token || !job.downloadTokenHash || !job.tokenExpiresAt || new Date(job.tokenExpiresAt).getTime() < Date.now()) {
      return err("UNAUTHORIZED", "A valid, unexpired download token is required. Poll the status endpoint for a fresh token (valid 15 minutes).", 401);
    }
    if ((await hashToken(token)) !== job.downloadTokenHash) return err("UNAUTHORIZED", "Invalid download token.", 401);
    const key = kind === "original" ? job.r2Key : (job.refinedR2Key ?? "");
    const data = key ? await store.getBytes(key) : null;
    if (!data) return err("NOT_FOUND", "The requested file is no longer available.", 404);
    const report = job.reportJson ? (JSON.parse(job.reportJson) as { refinedFilename?: string }) : {};
    const name = kind === "original" ? job.originalFilename : (report.refinedFilename ?? job.originalFilename);
    const mime = kind === "original" ? job.mime : (name.endsWith(".txt") ? "text/plain" : job.mime);
    return new Response(data as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Disposition": `attachment; filename="${sanitiseFilename(name).replace(/"/g, "")}"`,
        "Content-Length": String(data.length),
        ...cors,
      },
    });
  }

  return err("NOT_FOUND", "Unknown document endpoint.", 404);
}

async function cleanupExpiredJobs(env: Env): Promise<{ deleted: number; note: string }> {
  // D1 holds job metadata only, R2 holds the files; the store knows both.
  // When the bindings are absent (local dev), the in-memory store is swept.
  const store = resolveJobStore(env);
  return purgeExpiredJobs(store);
}

export default {
  async fetch(req: Request, env: Env, ctx?: { waitUntil: (p: Promise<unknown>) => void }): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith("/api/")) {
        return applySecurityHeaders(await handleApi(req, env, url, ctx?.waitUntil.bind(ctx)));
      }
      // Static assets (SPA). In local dev without the assets binding, serve a minimal shell.
      if (env.ASSETS) {
        const res = await env.ASSETS.fetch(req);
        return applySecurityHeaders(res);
      }
      return applySecurityHeaders(new Response("Proseforge — static assets are served by the Workers Static Assets binding. Run `npx wrangler dev` or deploy to see the full interface. API: /api/health", { status: 200, headers: { "Content-Type": "text/plain" } }));
    } catch (e) {
      // Never expose internals or document content in errors.
      console.error("Proseforge worker error:", e instanceof Error ? e.message : "unknown");
      return applySecurityHeaders(err("INTERNAL_ERROR", "Something went wrong. Please try again.", 500));
    }
  },
  async scheduled(_event: unknown, env: Env): Promise<void> {
    const result = await cleanupExpiredJobs(env);
    console.log(`Proseforge cleanup: ${result.note}`);
  },
};
