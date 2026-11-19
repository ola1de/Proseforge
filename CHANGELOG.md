# Changelog

## 0.2.0 — 2026-11-19 (Milestone 2)

- Research document engine: DOCX structural preservation (edits only `w:t` text of eligible body paragraphs in place; styles, numbering, headers/footers, footnotes, tables incl. merged cells, images, charts, hyperlinks, TOC fields, page/section breaks untouched), ODT (same in-place approach on `content.xml`), RTF (bold/italic paragraph structure), TXT, and text-layer PDF extraction.
- Document workflow API: `POST /api/documents/upload` (multipart, MIME + magic-bytes validation, 20 MB cap, zip-bomb guards), `GET /api/documents/:id/status` (live progress + rotating 15-minute download token), `/report` (chapters, refined/protected counts, limitations, injection flags), `/download` (refined or original, token-gated), `POST /:id/retry`.
- Protection by default: tables, citations, equations, footnotes, captions, bibliography, appendices, questionnaires, headings, and hyperlinks are never rewritten; prompt-injection spans are flagged in the report, never executed.
- Honest PDF limits: text-layer PDFs return refined text (layout is not rebuilt); scanned PDFs fail with a clear message about OCR, never empty output.
- 48-hour deletion now live end to end: D1 job metadata + R2 objects purged by the hourly scheduled cleanup (verified by a backdated-job test); R2 lifecycle rule remains an optional backstop (exact syntax still unverified — see `docs/01-discovery.md`).
- Research workspace UI: drag-and-drop upload, mode/intensity/discipline options, live progress, structure tree, before/after word counts, protected-content table, limitations, and downloads.
- 78 Vitest tests passing (was 50 in M1); TypeScript clean.

## 0.1.0 — 2026-11-19 (Milestone 1)

- Initial release: core text refinement platform.
- Frontend SPA (Home, Humanise Text, Research Document, Academic Assistant, Writing Constructor, Writing Analysis, About, Privacy) — vanilla JS, responsive, no login.
- Worker API: `/api/health`, `/api/config`, `/api/refine`, `/api/academic`, `/api/construct`, `/api/analyse`; document routes return honest HTTP 501 until Milestone 2 (removed in 0.2.0).
- Provider-independent AI adapters: Cloudflare Workers AI is the default and only required provider (no extra key); OpenAI-compatible adapter kept as an optional fallback. Honest HTTP 503 with setup guidance when no provider is configured — never faked output.
- 10 refinement modes, 3 intensities, 16 disciplines; meaning-preservation prompt invariant (no invented facts, statistics, quotations, or references).
- Context-aware paragraph chunking with terminology consistency.
- Local deterministic writing analysis, labelled as editorial indicators, not validated scores.
- Security headers/CSP, CORS allowlist, per-IP rate limiting, request-size limits, prompt-injection span detection.
- 49 Vitest tests passing; TypeScript clean; `wrangler.jsonc` with ai binding, R2 + D1 + Queues declared for Milestone 2, hourly cleanup cron.
- Phase 1 docs: `docs/01-discovery.md`, `docs/02-architecture.md`, `docs/03-roadmap.md`, `docs/DEPLOYMENT.md`.
