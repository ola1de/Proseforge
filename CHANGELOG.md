# Changelog

## 0.6.0 — 2026-11-19 (Milestone 6 — AI Checker)

- New AI Checker workspace (`#/checker`, nav item "Checker"): paste any text and see whether it reads as AI-generated or human. Built entirely from local, deterministic statistical signals — no external detector API, no key, no model call, no stored text.
- Six transparent signals with fixed, documented weights: AI-tell phrase density (35%), sentence rhythm / burstiness (25%), vocabulary diversity (15%), repetition (15%), sentence shape (5%), filler-transition density (5%). Every result shows the 0–100 score with its band and the per-signal breakdown that produced it, plus the exact phrases found and the flagged sentences.
- Bands: 0–30 "Reads human", 31–60 "Mixed signals", 61–100 "Reads AI-generated". Below 100 words the verdict is withheld ("Too short to judge reliably") while the score and signals are still shown.
- The banned-phrase list is now a shared export (`src/ai-phrases.ts`) used by both the prompt system and the checker, so the two can never drift apart. The prompt sentence it renders is byte-identical to Milestone 5.
- "Check this text" buttons in the Humanise workspace (refined text) and the Writing Analysis workspace (original or refined), plus a home-page FAQ entry on checker accuracy.
- Honest limit: no detector is perfectly accurate, and this one is an indicator, not proof — short texts, edited text, and non-native English can all mislead it. It is best used to judge whether a refinement still reads as AI. Acceptance fixtures pinned in tests: the robotic homepage sample scores 61+ and the plain human paragraph from Milestone 5 scores 0–30.
- 12 new tests (signal units, both acceptance fixtures, too-short case, API coverage); 101 Vitest tests passing; TypeScript clean.

## 0.5.0 — 2026-11-19 (Milestone 5 — write like a human, for real)

- Rewrote the prompt system around a minimal-change rule: if a sentence already sounds natural and clear, it is returned unchanged. The new HUMAN WRITING RULES block is appended to every system prompt (refine, academic sections, constructor): preserve the author's voice, rhythm, and sentence lengths (including short ones); prefer the plainest accurate word and never replace a simple word with a fancier one (say, not convey); keep contractions and the author's level of formality; never lengthen a sentence that is already clear; never add imagery, examples, or filler the author did not write.
- Banned AI-tell phrases are now named explicitly in the prompt: moreover, furthermore, additionally, in conclusion, "in today's fast-paced world", "it is important to note", delve, tapestry, landscape, crucial, paramount, "at my fingertips", "a testament to", "plays a crucial role", "shed light on", and more.
- Mode and intensity wording rewritten to match: "natural" is now a minimal-edit mode; academic modes ask for precise, plain academic English (sophisticated in argument, not in fancy words); "balanced" now means "fix what is actually weak and leave the rest alone". All mode ids, labels, descriptions, and disciplines unchanged.
- Workers AI calls now set temperature 0.3 explicitly (matching the OpenAI-compatible adapter) so output sticks closer to the author's text. Model, maxTokens, timeout, and error handling unchanged.
- 6 new tests (prompt rules present in every mode/intensity/section, mode metadata unchanged, temperature passed to the model); 89 Vitest tests passing; TypeScript clean.
- Honest limit: these are prompt-level guardrails on a small 8B model — they should sharply reduce fancy-word upgrades, clichés, and meaning drift, but they cannot guarantee the model never slips. Live quality must be judged on real output after deploy; if drift persists, the next lever is a larger/different model, not more prompt text.

## 0.4.0 — 2026-11-19 (Milestone 4 — fast & responsive)

- Parallel refinement: text chunks (`/api/refine`, `/api/academic`) and document batches now run concurrently (up to 4 AI calls in flight) instead of one after another, with output order preserved. The terminology note is computed once from the whole text up front and shared by every chunk/batch; the per-paragraph fallback for a batch whose paragraph count mismatches is unchanged.
- Live document progress: a job's status now moves 35→95% batch by batch ("Refining batch X of Y…", "Refining chunk X of Y…" for PDF text) instead of sitting frozen at 35% for the whole refine phase. One status write per completed batch/chunk.
- Refine controls: Cancel button on the Home, Humanise, and Academic refine actions, a live elapsed-time line while a refine is in flight ("Refining… 12s — long texts can take up to a minute"), and a 3-minute client timeout that surfaces a friendly error instead of hanging forever.
- Research upload: real upload percentage via XMLHttpRequest progress events, so a large file on a slow connection shows its progress instead of a frozen "Uploading…".
- Stall recovery: if a document job makes no progress for 3 minutes, polling stops and the UI says so ("This job seems stuck — it hasn't made progress in 3 minutes.") with a Retry button. The server retry endpoint now also accepts jobs stuck in uploaded/analysing/refining (previously only failed/needs-provider). A retried job re-runs the same document; if the old background task is somehow still alive, the last complete write wins.
- Research progress card now shows elapsed time alongside the stage and percentage.
- 5 new tests (parallel batches/chunks with order + progress, parallel `/api/refine`, a 40-paragraph document job completing through the real waitUntil path, retry of a stuck refining job); 89 Vitest tests passing; TypeScript clean.

## 0.3.0 — 2026-11-19 (Milestone 3 — presentation & UI polish)

- Hand-written inline SVG icon set (feather-style line icons, no emoji, no external CDN, no icon font): navigation, feature cards, workspace actions (copy, download, clear, undo/redo, upload, retry), status states, and analysis metrics.
- Richer homepage hero: trust chips (No login, Deleted after 48 hours, Powered by Cloudflare Workers AI) and a before/after product visual built from the real sample text — filler phrases highlighted, the "after" version hand-written and clearly labelled as an illustrative example, never presented as live AI output.
- Feature cards with icon tiles, hover lift, and links into each workspace; academic tip cards with icons; research pipeline as an icon step list; dropzone upload icon; page-title icons on every workspace.
- Header navigation compacted (icons + shorter labels) so all eight routes fit at desktop width; icon-only links on tablet widths; mobile collapse unchanged.
- Screenshots: `docs/screenshots/` (homepage, Humanise, Research, Analysis, Academic) embedded in a new README "Screenshots" section.
- All existing element ids, classes, routes, form fields, and JS behaviour hooks preserved; 78 Vitest tests passing; TypeScript clean.

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
