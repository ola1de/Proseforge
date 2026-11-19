# Changelog

## 0.1.0 — 2026-11-19 (Milestone 1)

- Initial release: core text refinement platform.
- Frontend SPA (Home, Humanise Text, Research Document, Academic Assistant, Writing Constructor, Writing Analysis, About, Privacy) — vanilla JS, responsive, no login.
- Worker API: `/api/health`, `/api/config`, `/api/refine`, `/api/academic`, `/api/construct`, `/api/analyse`; document routes return honest HTTP 501 until Milestone 2.
- Provider-independent AI adapters: Cloudflare Workers AI is the default and only required provider (no extra key); OpenAI-compatible adapter kept as an optional fallback. Honest HTTP 503 with setup guidance when no provider is configured — never faked output.
- 10 refinement modes, 3 intensities, 16 disciplines; meaning-preservation prompt invariant (no invented facts, statistics, quotations, or references).
- Context-aware paragraph chunking with terminology consistency.
- Local deterministic writing analysis, labelled as editorial indicators, not validated scores.
- Security headers/CSP, CORS allowlist, per-IP rate limiting, request-size limits, prompt-injection span detection.
- 49 Vitest tests passing; TypeScript clean; `wrangler.jsonc` with ai binding, R2 + D1 + Queues declared for Milestone 2, hourly cleanup cron.
- Phase 1 docs: `docs/01-discovery.md`, `docs/02-architecture.md`, `docs/03-roadmap.md`, `docs/DEPLOYMENT.md`.
