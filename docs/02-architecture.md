# Proseforge — Phase 1: Architecture (02-architecture.md)

Date: 2026-11-19. Status: Milestone 1 architecture (text platform). Milestone 2 (document engine) is designed here but not yet built.

## 1. Overview

```
Browser (no login, no account)
  │  Static Assets (HTML/CSS/JS, hash-routed SPA)
  ▼
Cloudflare Worker (TypeScript, single Worker, `src/index.ts`)
  ├─ /api/health, /api/config        (no secrets, no doc content)
  ├─ /api/refine, /api/academic, /api/construct   (AI-bound)
  ├─ /api/analyse                    (local, deterministic — no AI call)
  ├─ /api/documents/*                (M2 — upload/status/report/download/retry; see §5)
  ├─ Scheduled handler (cron)        (48 h deletion sweep over D1+R2, M2 live)
  └─ Bindings: ai (Workers AI), DOCS_BUCKET (R2, M2), DB (D1, M2)
```

No framework build step for the frontend: plain HTML + CSS + vanilla JS in `public/`, served as Workers Static Assets. Rationale: fastest load on small Android devices, zero framework churn, no build-tool failure modes. If a framework is ever justified, that is a deliberate M2+ decision, not drift.

Backend: TypeScript, bundled by Wrangler (esbuild under the hood). `wrangler.jsonc`, `compatibility_date = "2026-11-19"`, Wrangler `^4.165.0` as a project devDependency.

## 2. AI provider adapter system (provider-independent)

`src/providers.ts` — one interface, three implementations:

```ts
interface AIProvider {
  name: string;                 // "workers-ai" | "openai-compatible" | "mock" (tests only)
  available(env: Env): boolean;
  complete(env: Env, opts: { system: string; user: string; maxTokens: number }): Promise<string>;
}
```

| Provider | How configured | Key needed? |
|---|---|---|
| Workers AI (default) | `ai` binding + `AI_MODEL` var (default `@cf/meta/llama-3.1-8b-instruct-fp8`) | No — no separate key on Cloudflare |
| OpenAI-compatible | `AI_BASE_URL`, `AI_API_KEY` (secret), `AI_MODEL` | Yes, via `wrangler secret put AI_API_KEY` — never in code, never in client JS, never in git |
| Mock | only constructed inside Vitest | Never in production code paths |

Selection order: explicit `AI_PROVIDER` env (`workers-ai` | `openai-compatible`) → Workers AI if `ai` binding present → OpenAI-compatible if `AI_BASE_URL` + `AI_API_KEY` set → **no provider**.

**No-provider behaviour (hard rule):** the API returns HTTP **503** with a clear, actionable setup message (`PROVIDER_NOT_CONFIGURED`, naming the exact env vars/secrets to set and linking to `docs/DEPLOYMENT.md`). The UI surfaces that message verbatim. The system **never** fabricates a refinement, **never** presents a mock/simulated refinement as real, and **never** falls back to find-and-replace synonym swapping as "AI". A test-only mock provider exists in `tests/` and is labelled as such; it is not importable by `src/`.

Failure handling: provider timeouts (AbortController, configurable `AI_TIMEOUT_MS`, default 60 s), rate limits (HTTP 429 → 429 with `Retry-After` guidance), model errors (502 with a generic message, no provider internals leaked), malformed output (validate non-empty string, else 502). No document content in logs or error responses.

## 3. Prompt engineering (`src/prompts.ts`, `src/modes.ts`)

- Ten modes: Natural & Fluent, Academic, Advanced Academic, Professional, Conversational, Technical, Concise, Expanded, Formal, Custom Voice. Each mode is a system-prompt template with a distinct instruction set; intensity (`light` | `balanced` | `thorough`) scales how much restructuring is invited, never how much invention is allowed.
- Sixteen disciplines (Social Sciences, Political Science, Public Administration, Business Administration, Management, Economics, Law, Education, Sociology, Psychology, Computer Science, Engineering, Information Technology, Public Health, Natural Sciences, Humanities) select a discipline note appended to the system prompt (vocabulary + conventions); the discipline is user-selected, default "General".
- **Invariant block in every system prompt:** preserve meaning; do not invent facts, statistics, quotations, research findings or references; do not alter numbers, dates, names, citations or quoted material; do not add citations; if the input contains an unsupported factual claim, leave the claim intact and flag it separately (Academic Assistant) rather than inventing support; return only the refined text, no preamble.
- Academic Assistant (`/api/academic`): section-specific prompts (abstract, introduction, problem statement, objectives, questions, hypotheses, methodology, results, discussion, conclusion, recommendations) + a terminology explainer. Same invariant block.
- Constructor (`/api/construct`): returns 3 alternative constructions of the input (different sentence structures, same meaning), plus a terminology note.
- **Chunking (`src/chunking.ts`):** long text is split on paragraph boundaries into ~1,500-word chunks with a one-paragraph overlap for context; a short terminology-consistency note (key terms seen so far) is carried between chunks. Chunks are processed sequentially to bound cost and stay inside model context. The API caps input at a configurable `MAX_TEXT_CHARS` (default 100,000 chars ≈ a long chapter); above that the API returns 413 with guidance to use the document flow (M2).

## 4. Writing analysis (`src/analysis.ts`) — local, no AI

Deterministic heuristics computed in the Worker (and mirrored nowhere else): word/character/sentence counts, average sentence length, sentence-length variation (standard deviation), lexical diversity (type–token ratio), repetition (most-repeated content words), estimated reading time, Flesch Reading Ease + Flesch–Kincaid grade (standard formulas, labelled as estimates), filler-word count, long-sentence share, transition-word coverage, tone signals (contraction/formal-word balance). Every score is presented in the UI as an **editorial indicator, not a scientifically validated score**; before/after comparison re-runs the same functions on both texts. No AI call is spent on analysis.

## 5. Storage, privacy, 48-hour deletion

- **M1:** no documents are uploaded (text only, processed in memory, never persisted). No accounts, no email, no profiles, no cookies for identity. No public document URLs exist.
- **M2 (built 2026-11-19):** uploads go to a private R2 bucket (`DOCS_BUCKET`), object key = random UUID (never the original filename), no public access, download only via a short-lived token rotated by the status endpoint (15-min expiry, stored hashed in D1). D1 holds **only job metadata** (job id, upload timestamp, status, original filename, size, mime) — never document content.
- **Deletion (M2, live):** a scheduled Worker (cron, hourly, `scheduled()` handler) lists D1 jobs with `uploaded_at < now − 48 h` and deletes the R2 object + the D1 row (via `purgeExpiredJobs` in `src/store.ts`); an R2 lifecycle rule (expire after 2 days) is a backstop only — the cron is the mechanism of record. Deletion is measured from upload time. Abandoned sessions are swept by the same job. A `GET /api/documents/:id/status` endpoint reports "deleted" honestly after expiry.
- Logs/errors never contain document content, filenames are truncated in logs, and API keys never appear in client-side code.

## 6. Security

- Security headers on every response: `Content-Security-Policy` (default-src 'self'; no inline scripts except the app's own hashed inline bootstrap — in M1 the app uses external `app.js` only, so CSP can be strict), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Permissions-Policy` minimal. Implemented in `src/security.ts`.
- CORS: same-origin only by default; `ALLOWED_ORIGINS` env allowlist for any cross-origin deployment.
- Rate limiting: in-memory per-IP token bucket in the Worker (configurable `RATE_LIMIT_PER_MINUTE`, default 30 refine calls/min/IP; analysis is cheaper, default 120/min). Honest note: in-memory limiting is per-isolate and approximate at the edge — a Durable-Object-backed limiter is the documented upgrade path if abuse is observed, not a silent claim of precision.
- File validation (M2): MIME allowlist + magic-bytes check (`PK\x03\x04` for ZIP-based DOCX/ODT, `%PDF` for PDF, `{\rtf` for RTF), size cap (default 10 MB), filename sanitisation (strip paths, control chars), macro-bearing `.docm` rejected, legacy `.doc` rejected with guidance.
- Prompt-injection guardrails: uploaded document text is always passed as *data* inside a delimited user-message block, never concatenated into the system prompt; a pre-filter strips common injection patterns (`Ignore previous instructions`, etc.) from *instruction-like* spans only when they appear outside quoted content — the original text is never silently altered for refinement; suspicious spans are flagged in the processing report (M2).
- Request size limits: JSON body cap enforced before parsing (default 200 KB for text endpoints); timeouts on all outbound fetches.

## 7. Frontend architecture

- `public/index.html` — single HTML shell, hash routing (`#/`, `#/humanise`, `#/research`, `#/academic`, `#/constructor`, `#/analysis`, `#/about`, `#/privacy`).
- `public/styles.css` — restrained palette (ink `#0f172a`, paper `#ffffff`, muted `#64748b`, accent teal `#0d9488`, hairline borders), system font stack + Inter via system fallback (no webfont dependency that blocks first paint on slow connections), responsive breakpoints at 720 px / 1024 px, touch targets ≥ 44 px.
- `public/app.js` — vanilla JS, no dependencies: router, API client with honest error surfacing, undo/redo stacks for the Humanise workspace, copy/download/clear, local analysis rendering, demo (original vs refined) using **real sample text** refined only when a provider is configured — if no provider, the demo shows the original sample and states plainly that live refinement needs a configured provider (the demo never shows a fake "refined" version).
- Every button does what it says or is not rendered. No placeholder dashboards.

## 8. Testing & quality gates

- Vitest, `tests/` mirroring `src/`: all 10 modes produce distinct system prompts; intensity changes the prompt; invariant block present in every prompt; analysis metrics on known inputs (exact expected values for crafted texts); chunking preserves paragraph order and overlap; provider selection order; 503 when no provider; timeout/429 mapping; security (oversized body → 413, bad JSON → 400, disallowed mode → 400, prompt-injection strings are not executed as instructions); rate-limit behaviour.
- `npm test` must pass; `npx tsc --noEmit` must be clean; `npm run build` must succeed before any deploy claim.
- CI (`.github/workflows/ci.yml`): install → test → typecheck → build on every push/PR.

## 9. What is deliberately NOT in M1

Document upload/processing (M2), OCR (M2, client-side first), Queues-based background processing (M2), Turnstile (M2, optional), D1/R2 provisioning (declared in `wrangler.jsonc` as optional bindings so local dev works without them; provisioning steps live in `docs/DEPLOYMENT.md`).
