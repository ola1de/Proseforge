# Proseforge — Phase 1: Discovery (01-discovery.md)

Date verified: 2026-11-19 (Africa/Lagos). All claims below were checked against live web sources on this date. Where a claim could not be verified from a primary/official source, it is marked **UNVERIFIED**.

## 1. Cloudflare Workers — platform limits

| Item | Free | Paid (Standard, $5/mo min) | Source |
|---|---|---|---|
| Requests | 100,000/day, resets midnight UTC | 10M/month included, then $0.30/M | Cloudflare Workers Limits docs, via api-docs mirror, updated 2026-11-18; also AnyGen pricing summary, updated 2026-08-28 |
| CPU time per HTTP request | 10 ms | 30 s default, configurable to 5 min | Same as above |
| CPU time per Cron Trigger | 10 ms | 30 s (<1 h interval) / 15 min (≥1 h interval) | Same as above |
| Memory per isolate | 128 MB | 128 MB | Same as above |
| Worker script size | 64 MiB (uncompressed) | 64 MiB | Same as above |
| Static asset file size | 25 MiB | 25 MiB | Same as above |
| Max request body (Free/Pro zone) | 100 MB | 100 MB (Pro) / 200 MB (Business) | Same as above |
| Subrequests per invocation | 50 | 10,000 | Secondary summaries, Oct 2026 |

Consequences for Proseforge: the Free tier's 10 ms CPU budget is **not** enough for heavy in-Worker document parsing; CPU time excludes time waiting on network/AI calls, so AI-bound refinement is viable, but CPU-heavy ZIP/XML work must be chunked and kept small. Long documents belong in Queues + R2 (Milestone 2), not in a single synchronous request. Recommend Workers Paid for production use.

Sources:
- https://api-docs.dnstools.im/workers/platform/limits/ (mirror of Cloudflare Workers Limits docs, updated 2026-11-18)
- https://www.anygen.io/showcase/cloudflare-workers-pricing/index.html

## 2. Workers AI — models available now

- Free allowance: **10,000 neurons/day** on both Free and Paid plans, resetting 00:00 UTC; overage on Paid $0.011/1,000 neurons. Text generation rate limit ~300 RPM; frontier models ~20 RPM.
- Text models confirmed live in the catalogue (checked Nov 2026, catalogue total ~75 models, updated 2026-11-18):
  - `@cf/meta/llama-3.1-8b-instruct-fp8` — context 32K, small/fast, default choice for Proseforge M1.
  - `@cf/meta/llama-3.3-70b-instruct-fp8-fast` — context 24K, higher quality, higher neuron cost (~6× the 8B model per reply in independent testing 2026-10-11).
  - `@cf/meta/llama-3.2-3b-instruct` — context 80K.
  - `@cf/meta/llama-4-scout-17b-16e-instruct` — context 131K.
  - `@cf/openai/gpt-oss-20b` — reasoning-capable.
  - Also in catalogue: Gemma 3/4, Qwen3, Mistral Small, DeepSeek V4, GLM, Kimi.
- **Deprecations are real and frequent:** 18 models were deprecated on 30 May 2026, including the plain `@cf/meta/llama-3.1-8b-instruct` (non-fp8). Model IDs must be re-checked against the live catalogue before any release; Proseforge makes the model ID an env var (`AI_MODEL`) so a retirement is a config change, not a code change.
- Workers AI is invoked from a Worker via the `ai` binding (`env.AI.run(model, {...})`) — **no separate API key is needed** when running on Cloudflare.

Sources:
- https://ai.flared.au/llms.txt (live catalogue mirror, updated 2026-11-18)
- https://freeapihub.com/blog/cloudflare-workers-ai-tutorial-free-neurons (checked against Cloudflare docs Nov 2026)
- https://toolfreebie.com/cloudflare-workers-ai/ (tested 2026-10-11: ~490 Llama 3.1 8B replies/day on the free neuron allowance)

## 3. Wrangler

- Latest stable at verification: **Wrangler 4.164.0, released 17 Nov 2026 (npm resolved 4.165.0 on install, 19 Nov 2026)** (workers-sdk releases). Wrangler 4 is the current major (GA March 2025); v3 is bug-fix-only until Q1 2026, security-only until Q1 2027.
- Cloudflare recommends `wrangler.jsonc` over `wrangler.toml` for new projects; some newer features are JSON-only.
- Default compatibility date in recent releases: 2026-11-01 (per 4.156.1 notes). Proseforge pins `compatibility_date = "2026-11-19"` and `wrangler ^4.165.0` as a project devDependency — never assume a global install.
- `wrangler dev` runs locally on workerd/Miniflare and simulates bindings locally (empty local D1/R2 to start).

Sources:
- https://dev-news.anonyfox.com/wrangler/ (4.164.0, 17 Nov 2026)
- https://github.com/cloudflare/workers-sdk (release feed; 4.161.0 confirmed 12 Nov 2026)

## 4. R2, D1, Queues (free-tier snapshot, mid/late 2026)

| Service | Free tier | Paid overage |
|---|---|---|
| R2 storage | 10 GB-month | $0.015/GB-month; Class A $4.50/M, Class B $0.36/M; egress free |
| D1 | 5M rows read/day, 100k rows written/day, 5 GB total; DB size cap 10 GB paid / 500 MB free (per D1 limits summary, verified 2026-11-02) | 25B reads / 50M writes per month included |
| Queues | 10,000 operations/day (free since Feb 2026) | 1M/month included, then $0.40/M |

Sources: https://tinbox.dev/blog/cloudflare-email-free-tier-limits/, https://ployz.dev/blog/cloudflare-workers-pricing (checked 2026-10-08), https://sokurenko.dev/pdf/cloudflare-d1-kindle-large.pdf (verified 2026-11-02). **UNVERIFIED from an official Cloudflare page in this pass:** the exact R2 object-lifecycle-rule syntax for auto-expiry — to be confirmed against the official R2 lifecycle docs before M2 wires it; the scheduled Worker cleanup in M1 is the primary mechanism and does not depend on it.

## 5. DOCX / OOXML structure

A `.docx` file is a ZIP archive (ECMA-376 / ISO/IEC 29500) containing WordprocessingML parts:

| Part | Purpose |
|---|---|
| `[Content_Types].xml` | MIME-type registry for parts |
| `_rels/.rels` | Package-level relationships |
| `word/document.xml` | Main body: `w:p` (paragraph) → `w:r` (run) → `w:t` (text); formatting via `w:pPr` / `w:rPr` |
| `word/styles.xml` | Paragraph/character/table style definitions (`w:styleId`, `w:type`, `w:basedOn`) |
| `word/numbering.xml` | List definitions: `w:abstractNum` templates + `w:num` instances; paragraphs reference via `w:numPr` / `w:numId` / `w:ilvl` |
| `word/header*.xml`, `word/footer*.xml` | Headers/footers, linked from `w:sectPr` via `w:headerReference` / `w:footerReference` |
| `word/footnotes.xml`, `word/endnotes.xml` | Footnote/endnote bodies; referenced by `w:footnoteReference` |
| `word/media/` | Embedded images |
| `word/theme/theme1.xml`, `word/fontTable.xml`, `word/settings.xml` | Theme, fonts, settings |
| `word/_rels/document.xml.rels` | Part relationships |

Key engineering rules (verified across multiple sources): text is frequently split across multiple runs — never assume one word/sentence lives in one XML node; page layout (margins, orientation, headers/footers, page numbering) lives in `w:sectPr`; styles layer (paragraph style → character style → direct formatting) must be respected; list numbering is its own system, never pasted Unicode bullets. **Preservation strategy for M2:** unzip, edit only `w:t` text nodes of eligible body paragraphs in place, re-zip byte-identically otherwise; never rebuild the document from extracted plain text.

Sources:
- https://deepwiki.com/jcp-tech/jcp-tech/4.2-docx-document-architecture
- https://www.docx-editor.dev/blog/edit-docx-files-in-browser-javascript
- https://skilldb.dev/skills/file-formats-skills/docx
- https://skills.cowagent.ai/en/word-docx (updated 2026-03-30)

## 6. Libraries that actually run in a Workers runtime

- **No Node `fs`, no native modules.** Anything depending on `fs`, `stream` (Node), `canvas`, or native bindings will fail at build or runtime in Workers.
- **JSZip:** pure JavaScript, no Node dependencies, runs in browsers, Web Workers and Node; `loadAsync` / `generateAsync`, in-memory. **Verified suitable** for DOCX ZIP handling in Workers, with the caveat that it holds the whole archive in memory — combined with the 128 MB isolate limit, this caps practical DOCX size in M2 (configurable limit, default 10 MB upload).
- **fflate:** smaller/faster streaming alternative (~3 kB gzipped extra), also Workers-safe; candidate if JSZip memory proves limiting. **UNVERIFIED in this pass against the Workers runtime directly** — listed as an M2 evaluation item, not a claim.
- **fast-xml-parser:** pure JS, no Node deps, Workers-safe for parsing/editing `document.xml` — planned M2 dependency. **UNVERIFIED in this pass** (not test-installed yet); M2 will verify before depending on it.
- **docx / mammoth (Node-oriented):** `docx` (creation) and `mammoth` (extraction) are Node-first; `docx` rebuilds documents rather than editing in place, which violates the preservation requirement. **Do not use as the M2 editing engine.** `python-docx` is irrelevant (no Python in Workers).
- **PDF extraction:** `pdf-parse` **fails** in serverless/edge runtimes — it depends on `pdfjs-dist` + optional native `canvas`. `unpdf` is a pure-JS wrapper around pdf.js with zero native dependencies, explicitly tested against Cloudflare Workers and Vercel Edge — **planned M2 choice** for text-layer PDFs. `pdfjs-dist` standard build can work with the worker disabled, but `unpdf` is the cleaner path.
- **RTF/ODT:** no verified Workers-safe library was established in this pass — **UNVERIFIED**; M2 will evaluate (likely: minimal RTF text extraction by hand-rolled parser, ODT as ZIP+XML like DOCX). Do not claim support until tested.

Sources:
- https://npm-compare.com/adm-zip,archiver,jszip,zip-local and https://deepwiki.com/clientIO/jszip/5.2-browser-and-node.js-compatibility
- https://dev.to/chudi_nnorukam/serverless-pdf-processing-why-unpdf-beats-pdf-parse-2jji
- https://www.pkgpulse.com/guides/unpdf-vs-pdf-parse-vs-pdfjs-dist-pdf-2026

## 7. PDF extraction limits in Workers

- Text-layer PDFs: extractable with `unpdf` in-Worker, page by page, within CPU/memory limits. Encrypted/password-protected PDFs are not readable by that parser — users must remove the password first.
- Layout fidelity: extraction yields text + page order, **not** reliable layout reconstruction. Exact PDF reconstruction (editing a PDF in place while preserving layout) is **not reliably possible** in a Worker; M2's honest workflow is: extract → refine text → return a refined DOCX/TXT plus the untouched original, with the limitation stated in the UI. Never silently damage a PDF.
- Large PDFs: memory is unpredictable with `pdfjs-dist`; `unpdf` keeps it more predictable, but a hard upload cap (default 10 MB, configurable) and page cap apply.

Source: https://www.bananaslides.com/tools/pdf-to-ppt-converter (Workers-native `unpdf` pipeline, scanned-PDF limitation stated), plus the `unpdf` comparisons above.

## 8. OCR for scanned PDFs — honest limitation

- **Full Tesseract cannot run inside a Worker request.** Tesseract.js needs its WASM core (~2–4 MB) plus language traineddata (~10 MB for English, ~14 MB for Japanese) and ~300–500 MB RAM per worker — far above the Workers 128 MB isolate limit and the 64 MiB script-size limit. No server-side OCR engine fits a Worker isolate.
- **Viable alternatives (M2):**
  1. **Client-side OCR (preferred for privacy):** Tesseract.js in the user's browser (Web Worker), render scanned PDF pages to canvas via pdf.js at ~180 DPI, OCR locally, send only extracted text to the Worker. First run downloads the model once and caches it. Document never leaves the device for the OCR step.
  2. **External OCR API (optional, opt-in, key required):** e.g. a cloud vision/OCR provider called from the Worker/Queue. Not built in M1; M2 will add it only as an explicitly configured adapter with the privacy cost stated.
  3. **Honest fallback:** if a PDF has no text layer and the user declines client-side OCR, say so plainly and offer to OCR first with a free desktop tool — never return empty/garbled output as if it worked.
- Handwriting: Tesseract is effectively unusable on cursive/handwriting (<60% accuracy per sources); vision-language models are the only real option there, out of scope for M2.

Sources:
- https://www.zro7.com/blog/tesseract-browser-ocr-zero-uploads/ (2026-10-29; RAM ~300–500 MB per worker)
- https://dev.to/omermirza09/run-ocr-100-in-the-browser-images-scanned-pdfs-to-text-no-server-48lm (2026-06-20)
- https://www.pennyocr.com/tesseract-alternative/ (updated 2026-10-19; Tesseract handwriting/table limits)

## 9. Things marked UNVERIFIED (do not claim until checked)

1. Exact R2 lifecycle-rule syntax/behaviour for auto-expiry (M2 backstop).
2. `fast-xml-parser` and `unpdf` behaviour inside `workerd` under the pinned Wrangler 4.165 — to be verified by an M2 test install.
3. RTF/ODT Workers-safe parsing libraries.
4. Exact Workers AI neuron cost for Proseforge's actual prompts (depends on prompt + output length; the 10,000/day free allowance is verified, per-prompt cost is not).
5. Turnstile free-tier request limits (not quoted anywhere in this doc — deliberately not stated).
