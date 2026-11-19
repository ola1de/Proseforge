# Proseforge — Deployment Guide (docs/DEPLOYMENT.md)

Date: 2026-11-19. Wrangler pinned: `^4.165.0` (project devDependency — never assume a global install).

## The happy path: Cloudflare Workers AI — no extra key

Proseforge's **only required AI provider is Cloudflare Workers AI**. There is no API key to obtain, no key to paste, and nothing to ask the user for. When the Worker is deployed on Cloudflare with the `ai` binding (already declared in `wrangler.jsonc`), refinement works. The default model is `@cf/meta/llama-3.1-8b-instruct-fp8`; change it with the `AI_MODEL` variable.

The OpenAI-compatible adapter (`AI_PROVIDER=openai-compatible`, `AI_BASE_URL`, `AI_API_KEY`) exists in `src/providers.ts` as an **optional fallback for operators** who prefer a different provider. It is never required. If it is ever used, the key must be set as a Cloudflare secret — never in code, never in a file, never in chat:

```bash
npx wrangler secret put AI_API_KEY
```

## Prerequisites

- Node.js 20+ and npm.
- A Cloudflare account (only needed for deployment, not for local development or tests).
- **No Cloudflare password or token is ever collected or stored by this project.** Login happens only through Cloudflare's official browser OAuth flow, and only when the operator chooses to deploy: `npx wrangler login` opens the official Cloudflare authorisation page in the browser. Never paste a Cloudflare API token into a chat, file, or script.

## Local development (no Cloudflare account needed)

```bash
cd proseforge-platform
npm install
npm test          # 50 tests
npm run build     # typecheck + asset check
npx wrangler dev  # http://localhost:8787 — local workerd with simulated bindings
```

Local `wrangler dev` has **no AI provider** by default, so `/api/refine` returns HTTP 503 with the setup message — that is the correct, honest behaviour locally. `/api/analyse`, `/api/health`, and `/api/config` work fully without a provider. To test refinement locally against real Workers AI, deploy to a Cloudflare account (below) or use `wrangler dev --remote` while logged in. Local D1 starts empty: apply migrations locally with `npx wrangler d1 migrations apply proseforge-db --local` before testing the scheduled cleanup.

## Deploy

```bash
cd proseforge-platform
npm install
npm run build
npx wrangler deploy
```

Verify the deployment with a real request — a successful deploy command alone is not verification:

```bash
curl https://<your-worker>.workers.dev/api/health
# expect: {"ok":true,"service":"proseforge","provider":"workers-ai",...}
curl -X POST https://<your-worker>.workers.dev/api/health -d '{}'  # (health is GET; use the UI instead)
```

Then open the site, paste the sample paragraph on the homepage, and run one live refinement. If refinement returns 503 `PROVIDER_NOT_CONFIGURED`, the `ai` binding is missing from the deployed Worker — check `wrangler.jsonc` and redeploy.

## Milestone 2 provisioning (required before deploying Milestone 2)

The `wrangler.jsonc` in this repo declares R2, D1, and Queues bindings for the Milestone 2 document engine. **Before deploying Milestone 2**, provision them (these commands create real resources in your Cloudflare account):

```bash
npx wrangler r2 bucket create proseforge-docs
npx wrangler d1 create proseforge-db        # copy the returned database_id into wrangler.jsonc
npx wrangler d1 migrations apply proseforge-db --remote
npx wrangler queues create proseforge-doc-jobs
```

The D1 schema is in `migrations/`: `0001_jobs.sql` (job metadata) plus `0002_jobs_columns.sql` (progress, refined-file key, report, download-token hash, error). Apply both with the migrations command above; local dev uses `npx wrangler d1 migrations apply proseforge-db --local`.

For Milestone 1, if Wrangler complains about the placeholder `database_id` or the unprovisioned queue during `wrangler dev`/`deploy`, remove the `d1_databases` and `queues` blocks from `wrangler.jsonc` (they are documented here and in `docs/02-architecture.md`) and re-add them when provisioning Milestone 2. The Worker code treats missing D1/R2 bindings as "not provisioned" and the cleanup job reports that honestly.

Optional configuration (all via `wrangler.jsonc` vars or secrets):

| Variable | Default | Purpose |
|---|---|---|
| `AI_MODEL` | `@cf/meta/llama-3.1-8b-instruct-fp8` | Workers AI model (re-check the live catalogue: model IDs are retired — see `docs/01-discovery.md`) |
| `AI_PROVIDER` | `workers-ai` | `workers-ai` (default) or `openai-compatible` (optional fallback only) |
| `AI_BASE_URL` / `AI_API_KEY` | — | Optional OpenAI-compatible fallback; key via `wrangler secret put` only |
| `MAX_TEXT_CHARS` | `100000` | Max characters per refine request |
| `DOC_MAX_BYTES` | `20000000` | Max uploaded document size in bytes (20 MB) |
| `RATE_LIMIT_PER_MINUTE` | `30` | Per-IP refine rate limit |
| `AI_TIMEOUT_MS` | `60000` | AI request timeout |
| `ALLOWED_ORIGINS` | (empty = same-origin) | Comma-separated CORS allowlist |

## 48-hour deletion (Milestone 2)

The Worker runs an hourly cron (`0 * * * *` in `wrangler.jsonc`) that deletes R2 objects and D1 rows for jobs uploaded more than 48 hours ago. Add an R2 lifecycle rule expiring objects after 2 days as a backstop (exact rule syntax is still unverified against the official R2 docs — see `docs/01-discovery.md`; the cron is the mechanism of record and does not depend on it). Deletion is measured from upload time.

## Updating and redeploying

```bash
cd proseforge-platform
git pull
npm install
npm test && npm run build
npx wrangler deploy
curl https://<your-worker>.workers.dev/api/health
```

## Troubleshooting

- `PROVIDER_NOT_CONFIGURED` (503) on refine: the deployed Worker has no `ai` binding. Redeploy from this repo; do not paste a key anywhere — Workers AI needs no key.
- `wrangler dev` fails on the D1 placeholder id: remove the `d1_databases`/`queues` blocks until Milestone 2 provisioning (see above).
- Model errors after a Cloudflare catalogue change: update `AI_MODEL` to a live model id (check the Workers AI catalogue first) — a config change, not a code change.
- Tests failing after a dependency update: pin the previous working versions in `package.json` and record the change in `CHANGELOG.md`.
