# Proseforge — Roadmap (03-roadmap.md)

Date: 2026-11-19. Brand: Proseforge — "Write like a human. Read like a pro." Repo (to be created by the owner): `ola1de/Proseforge`. No deployment is claimed until a Cloudflare account is connected and `npx wrangler deploy` has been verified.

## Milestone 1 — Core text platform (DONE, 2026-11-19)

Scope: premium SPA (Home, Humanise Text, Academic Assistant, Writing Constructor, Writing Analysis, About, Privacy); Worker API (`/api/health`, `/api/config`, `/api/refine`, `/api/academic`, `/api/construct`, `/api/analyse`); provider-independent AI adapter (Workers AI default, OpenAI-compatible via env, honest 503 with setup guidance when unconfigured, never fake output); 10 refinement modes + intensity + 16 disciplines; context-aware chunking; local deterministic writing analysis labelled as editorial indicators; security headers/CSP, CORS allowlist, rate limiting, request-size limits; Vitest suite; full repo scaffolding (README, CONTRIBUTING, LICENSE MIT, SECURITY, PRIVACY, CHANGELOG, CI).

DONE criteria (verified by the parent, 2026-11-19):
- [x] `npm install`, `npm test` (50/50 pass), `npx tsc --noEmit` clean, `npm run build` succeeds.
- [x] Every UI control works or is omitted; no fake buttons, no placeholder dashboards.
- [x] `/api/refine` with no provider returns 503 + setup guidance (verified by test, not by assertion alone).
- [x] All 10 modes and all 16 disciplines produce distinct, meaning-preserving prompts (verified by test).
- [x] Analysis metrics match hand-computed values on crafted inputs (verified by test).
- [x] No "undetectable by AI detectors" claim anywhere in UI or docs (verified by grep).
- [x] `wrangler dev --local` smoke test passes (health/config/analyse 200; refine 503 with setup guidance when unconfigured).

## Milestone 2 — Research document engine (DONE, 2026-11-19)

Scope: DOCX structural preservation via JSZip + fast-xml-parser (both verified in `workerd` by the M2 test run); edit only `w:t` nodes of eligible body paragraphs in place; protect tables, citations, equations, references, footnotes, headers/footers, numbering, images, charts; chapter/section detection from heading styles + outline levels; section-based processing with terminology consistency carried between batches; processing report + before/after comparison; TXT, DOCX, ODT, RTF, and PDF text-layer extraction (hand-rolled Workers-safe PDF parser in `src/pdf.ts` — `unpdf` was evaluated and not needed; return refined text + untouched original, with the PDF limitation stated); RTF/ODT via hand-rolled Workers-safe parsers; R2 private temp storage + signed short-lived download tokens; D1 job metadata only; hourly cron 48-hour deletion sweep + R2 lifecycle backstop; upload validation (MIME + magic bytes + 20 MB cap, zip-bomb guards); sample-DOCX integrity test suite (multi-chapter, tables, merged cells, images, headers/footers, page numbers, citations, bibliography, footnotes, page/section breaks) verifying the output still opens and protected elements are untouched. Queues are declared in `wrangler.jsonc` but processing currently runs via `ctx.waitUntil` (inline when no context is available, e.g. tests); a Queues consumer is a documented M3 hardening item, not a silent gap.

DONE criteria (verified 2026-11-19):
- [x] A real multi-chapter sample DOCX round-trips: valid DOCX out, formatting/styles/tables/headers/footers intact, only eligible paragraph text changed (`tests/docx.test.ts` — untouched parts byte-identical in the ZIP).
- [x] Scanned PDF without a text layer produces an honest message + OCR guidance, never empty/garbled output (`tests/jobs.test.ts`, `tests/api-documents.test.ts`).
- [x] An object uploaded at T is gone from R2 and D1 by T+48 h (verified by a test that backdates a job and runs the scheduled-handler logic via `purgeExpiredJobs`).
- [x] No document content in logs/errors (verified by a test that fails a job mid-processing and inspects the error message).
- [x] `npm test` 78/78 pass; `npx tsc --noEmit` clean; `npm run build` succeeds; `wrangler dev --local` smoke test (upload → status → download → report) — see verification section in the M2 completion report.

## Milestone 3 — Hardening & scale

Scope: Turnstile (optional, env-gated); Durable-Object-backed rate limiting if abuse is observed; per-plan processing quotas; cost dashboard (neurons/tokens used, from provider responses only — never invented); accessibility audit (keyboard nav, contrast, screen-reader labels); mobile performance pass on a small Android device; load test of the refine path within Workers Paid CPU budgets.

DONE criteria:
- [ ] Accessibility issues rated critical/high: zero open.
- [ ] p95 refine latency and neuron cost per 1,000 words measured and documented (real numbers, not estimates).

## Milestone 4 — Polish & launch

Scope: custom domain + HTTPS verification; privacy policy legal review note (not legal advice — the policy describes what the code actually does); final end-to-end test on the deployed URL (health, refine with configured provider, analysis, document round-trip); CHANGELOG release entry; launch checklist in `docs/DEPLOYMENT.md` signed off.

DONE criteria:
- [ ] Production URL verified live (health + one real refinement) by an actual request, not by a deploy command's exit code alone.
- [ ] Every advertised feature on the homepage works on the production URL.

## Non-goals (explicit)

- No user accounts, login, or email collection — ever, unless the owner explicitly changes this.
- No "AI detector evasion" feature or claim.
- No training on uploaded documents.
- No PDF in-place layout-preserving editing (documented limitation, not a silent gap).
- No handwriting OCR.
