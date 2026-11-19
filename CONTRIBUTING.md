# Contributing to Proseforge

## Ground rules

- **Never fake AI output.** If no provider is configured, the API must return the honest 503 setup message. No mock, placeholder, or synonym-swap fallback may ever be presented as a refinement. Test-only fakes live in `tests/` and are labelled as such.
- **Never invent facts.** Prompts must carry the meaning-preservation invariant (`src/prompts.ts`). Never add a feature that invents citations, statistics, or references.
- **Never claim detector evasion.** Do not add copy claiming text will be undetectable by AI detectors.
- **Privacy first.** No accounts, no personal data collection, no document content in logs or errors, no public document URLs.
- **No secrets in git.** Keys go through `wrangler secret put`, never into code, `.env` files, or chat.

## Workflow

1. `npm install`
2. Make the change; add or update tests in `tests/` first where behaviour changes.
3. `npm test` — all tests must pass. `npx tsc --noEmit` must be clean. `npm run build` must succeed.
4. Keep the frontend dependency-free (vanilla JS/CSS) unless a dependency is justified in the PR description.
5. Update `CHANGELOG.md` and the relevant doc in `docs/` when behaviour or limits change.

## Release checklist

- [ ] Tests + typecheck + build green
- [ ] `wrangler dev` smoke test (health, config, refine-without-provider → 503, analyse)
- [ ] No "undetectable" language anywhere (`grep -ri undetectable src public`)
- [ ] CHANGELOG entry
