// Research document pipeline (Milestone 2).
// Orchestrates: upload validation -> structure analysis -> batched,
// context-aware refinement -> in-place reinsertion -> round-trip
// validation -> report. Document content is never logged; errors never
// contain document text. The AI provider is injected (never faked): when
// no provider is configured the job ends as "needs-provider" with the
// honest setup message, and nothing is presented as refined.

import { countWords, splitIntoChunks, terminologyNote } from "./chunking";
import { analyseDocx, refineDocx } from "./docx";
import { analyseOdt, refineOdt } from "./odt";
import { extractPdfText } from "./pdf";
import { parseRtf, rtfToText, writeRtf, RTF_LIMITATION } from "./rtf";
import { buildSystemPrompt } from "./prompts";
import { findInjectionSpans, sanitiseFilename } from "./security";
import { type JobRecord, type JobStore } from "./store";
import type { AIProvider } from "./providers";
import type { Intensity } from "./types";

export type DocFormat = "docx" | "odt" | "pdf" | "rtf" | "txt";

export const SUPPORTED_FORMATS: Record<DocFormat, { mime: string; label: string }> = {
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", label: "Word (.docx)" },
  odt: { mime: "application/vnd.oasis.opendocument.text", label: "OpenDocument Text (.odt)" },
  pdf: { mime: "application/pdf", label: "PDF (.pdf)" },
  rtf: { mime: "application/rtf", label: "Rich Text Format (.rtf)" },
  txt: { mime: "text/plain", label: "Plain Text (.txt)" },
};

export const MAX_DOC_BYTES_DEFAULT = 20_000_000; // 20 MB upload cap (configurable via DOC_MAX_BYTES)
export const MAX_EXPANDED_BYTES = 100_000_000; // zip-bomb guard: expanded ZIP contents
export const MAX_ZIP_ENTRIES = 2000;

export interface DocumentReport {
  jobId: string;
  format: DocFormat;
  originalFilename: string;
  refinedFilename: string;
  originalWords: number;
  refinedWords: number;
  paragraphsTotal: number;
  paragraphsRefined: number;
  paragraphsProtected: number;
  paragraphsSkipped: number;
  chapters: { level: number; title: string; kind: string }[];
  protectedCounts: Record<string, number>;
  limitations: string[];
  warnings: string[];
  injectionSpans: string[];
  scannedPdf: boolean;
  deletedAt: string;
}

export interface ProcessOptions {
  mode: string;
  intensity: Intensity;
  customVoice?: string;
  discipline?: string;
  protectCitations: boolean;
  protectTables: boolean;
}

/** Detect format from extension + magic bytes (never the extension alone). */
export function detectFormat(filename: string, bytes: Uint8Array): { format: DocFormat } | { error: string } {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  if (ext === "docm") return { error: "Macro-enabled Word files (.docm) are rejected: macros can carry malicious code. Save the document as .docx (macros removed) and upload that." };
  if (ext === "doc") return { error: "Legacy .doc files are not supported. Open the file in Word or LibreOffice and save it as .docx, then upload that." };
  if (!(ext in SUPPORTED_FORMATS)) {
    return { error: `Unsupported file type ".${ext}". Supported formats: .docx, .odt, .pdf, .rtf, .txt.` };
  }
  const format = ext as DocFormat;
  const isZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if ((format === "docx" || format === "odt") && !isZip) {
    return { error: `The file is named .${ext} but its contents are not a ZIP-based Office document. It may be corrupt or renamed — please re-save it in its original application and try again.` };
  }
  if (format === "pdf") {
    const head = new TextDecoder().decode(bytes.slice(0, 5));
    if (head !== "%PDF-") return { error: "The file is named .pdf but does not start with a PDF header. It may be corrupt or renamed." };
  }
  if (format === "rtf") {
    const head = new TextDecoder().decode(bytes.slice(0, 6));
    if (!head.startsWith("{\\rtf")) return { error: "The file is named .rtf but does not start with an RTF header. It may be corrupt or renamed." };
  }
  if (format === "txt") {
    // Reject binary masquerading as text.
    const sample = bytes.slice(0, 8192);
    if (sample.includes(0)) return { error: "The file is named .txt but contains binary data. Please upload a real plain-text file." };
    try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { return { error: "The .txt file is not valid UTF-8 text. Save it as UTF-8 and try again." }; }
  }
  return { format };
}

export function validateUpload(
  filename: string,
  bytes: Uint8Array,
  maxBytes: number,
): { ok: true; format: DocFormat } | { ok: false; error: string } {
  if (!filename || !bytes.length) return { ok: false, error: "No file was uploaded." };
  if (bytes.length > maxBytes) {
    return { ok: false, error: `File is ${(bytes.length / 1_000_000).toFixed(1)} MB, over the ${(maxBytes / 1_000_000).toFixed(0)} MB upload limit. Split the document into chapters and upload them one at a time.` };
  }
  const detected = detectFormat(filename, bytes);
  if ("error" in detected) return { ok: false, error: detected.error };
  return { ok: true, format: detected.format };
}

/** Best-effort expanded-size check for ZIP-based formats (zip-bomb guard). */
export async function checkZipExpandedSize(bytes: Uint8Array): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(bytes);
    const entries = Object.values(zip.files);
    if (entries.length > MAX_ZIP_ENTRIES) {
      return { ok: false, error: `The archive contains ${entries.length} entries (limit ${MAX_ZIP_ENTRIES}). It may be malformed — please re-save the document and try again.` };
    }
    let total = 0;
    for (const f of entries) {
      const internal = (f as unknown as { _data?: { uncompressedSize?: number } })._data;
      if (typeof internal?.uncompressedSize === "number") total += internal.uncompressedSize;
    }
    if (total > MAX_EXPANDED_BYTES) {
      return { ok: false, error: `The document expands to more than ${(MAX_EXPANDED_BYTES / 1_000_000).toFixed(0)} MB uncompressed. Split it into smaller documents and upload them one at a time.` };
    }
  } catch {
    // If the size check itself fails, the format parsers will reject the file below.
  }
  return { ok: true };
}

/**
 * Run `fn` over `items` with at most `limit` calls in flight at once.
 * Results are returned in input order, whatever order they complete in.
 * A rejection fails the whole run (the remaining in-flight calls still
 * finish, but their results are discarded) — callers treat a failed
 * chunk/batch as a provider error, exactly as the sequential code did.
 */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  const cap = Math.max(1, Math.floor(limit) || 1);
  let next = 0;
  const workers = new Array(Math.min(cap, items.length)).fill(null).map(async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T, i);
    }
  });
  await Promise.all(workers);
  return results;
}

export type BatchProgressCallback = (done: number, total: number) => Promise<void> | void;

/**
 * Refine a list of paragraphs with the provider, in context-aware batches.
 * Each batch is sent as one call with an explicit paragraph count; the
 * result is accepted only if the paragraph count matches, otherwise the
 * batch is retried paragraph-by-paragraph. This keeps the mapping between
 * original and refined paragraphs exact — a paragraph is never silently
 * merged, split, or dropped.
 *
 * Batches run CONCURRENTLY (up to 4 in flight) so a long document does
 * not wait on each batch in turn; results are written back by batch
 * index, so paragraph order is always preserved. The terminology note is
 * computed once from the whole text up front and shared by every batch
 * (there is no running "seen" state to race on). `onProgress` fires
 * once per completed batch.
 */
export async function refineParagraphTexts(
  provider: AIProvider,
  system: string,
  texts: string[],
  timeoutMs: number,
  onProgress?: BatchProgressCallback,
): Promise<string[]> {
  const out: string[] = new Array<string>(texts.length).fill("");
  // Group into batches of at most ~1,500 words / 12 paragraphs.
  const batches: { start: number; items: string[] }[] = [];
  let cur: string[] = [];
  let curWords = 0;
  let curStart = 0;
  texts.forEach((t, i) => {
    const w = countWords(t);
    if (cur.length > 0 && (curWords + w > 1500 || cur.length >= 12)) {
      batches.push({ start: curStart, items: cur });
      cur = [];
      curWords = 0;
      curStart = i;
    }
    cur.push(t);
    curWords += w;
  });
  if (cur.length) batches.push({ start: curStart, items: cur });
  if (batches.length === 0) return out;

  const context = terminologyNote(texts.join("\n"));
  const contextPrefix = context ? `${context}\n\n` : "";
  let done = 0;
  const refineBatch = async (batch: { start: number; items: string[] }): Promise<void> => {
    const joined = batch.items.map((t, j) => `Paragraph ${j + 1}:\n${t}`).join("\n\n");
    const user = `${contextPrefix}Refine each of the following ${batch.items.length} paragraph(s). Return exactly ${batch.items.length} paragraph(s), in the same order, separated by a single blank line. Do not merge, split, reorder, or renumber paragraphs. Do not add headings, labels, or commentary.\n\n${joined}`;
    let refined: string[] | null = null;
    try {
      const raw = await provider.complete({ system, user, maxTokens: 4096, timeoutMs });
      const parts = raw.split(/\n\s*\n/).map((p) => p.replace(/^Paragraph \d+:\s*/i, "").trim()).filter(Boolean);
      if (parts.length === batch.items.length) refined = parts;
    } catch {
      refined = null; // fall through to the per-paragraph retry below
    }
    if (!refined) {
      refined = [];
      for (const t of batch.items) {
        const raw = await provider.complete({ system, user: `${contextPrefix}Refine the following text:\n\n${t}`, maxTokens: 4096, timeoutMs });
        refined.push(raw.trim());
      }
    }
    batch.items.forEach((_, j) => { out[batch.start + j] = refined?.[j] ?? batch.items[j] as string; });
    done += 1;
    if (onProgress) await onProgress(done, batches.length);
  };
  await mapWithConcurrency(batches, 4, refineBatch);
  return out;
}

/** Refine long free text (TXT / PDF extraction) in overlapping chunks. */
export async function refineLongText(
  provider: AIProvider,
  system: string,
  text: string,
  timeoutMs: number,
  onProgress?: BatchProgressCallback,
): Promise<string> {
  const chunks = splitIntoChunks(text);
  if (chunks.length === 0) return "";
  const contextPrefix = terminologyNote(text);
  const note = contextPrefix ? `${contextPrefix}\n\n` : "";
  let done = 0;
  const refined = await mapWithConcurrency(chunks, 4, async (chunk) => {
    const user = `${note}${chunk.overlap && chunk.index > 0 ? `Previous paragraph (for context only, do not repeat it): ${chunk.overlap}\n\n` : ""}Refine the following text:\n\n${chunk.text}`;
    const result = await provider.complete({ system, user, maxTokens: 4096, timeoutMs });
    done += 1;
    if (onProgress) await onProgress(done, chunks.length);
    return result;
  });
  return refined.join("\n\n");
}

function refinedFilename(original: string, format: DocFormat): string {
  const base = sanitiseFilename(original.replace(/\.[^.]+$/, "")) || "document";
  if (format === "pdf") return `${base}.refined.txt`;
  return `${base}.refined.${format}`;
}

function deletedAtFor(uploadedAt: string): string {
  return new Date(new Date(uploadedAt).getTime() + 48 * 60 * 60 * 1000).toISOString();
}

/**
 * Run one document job end to end. Updates the store at every stage so
 * the status endpoint can report real progress. Throws nothing — failures
 * are recorded on the job as status "failed" with a safe error message.
 */
export async function processDocumentJob(
  store: JobStore,
  provider: AIProvider | null,
  job: JobRecord,
  opts: ProcessOptions,
  timeoutMs: number,
): Promise<void> {
  const fail = async (message: string) => {
    await store.update(job.id, { status: "failed", stage: "failed", progress: 100, error: message });
  };
  try {
    if (!provider) {
      await store.update(job.id, {
        status: "needs-provider",
        stage: "needs-provider",
        progress: 0,
        error: "No AI provider is configured for this Proseforge installation. Deploy with the Workers AI binding (no extra key is needed) — see docs/DEPLOYMENT.md. Your document was stored and will be deleted 48 hours after upload; nothing was refined.",
      });
      return;
    }
    const format = job.format as DocFormat;
    const originalBytes = await store.getBytes(job.r2Key);
    if (!originalBytes) {
      await fail("The uploaded file is no longer available. It may have been deleted after 48 hours — please upload it again.");
      return;
    }

    await store.update(job.id, { status: "analysing", stage: "Analysing document structure", progress: 10 });
    const system = buildSystemPrompt({
      modeId: opts.mode, intensity: opts.intensity,
      customVoice: opts.customVoice, discipline: opts.discipline,
    });
    const limitations: string[] = [];
    const warnings: string[] = [];
    let refinedBytes: Uint8Array;
    let outFilename = refinedFilename(job.originalFilename, format);
    let report: Omit<DocumentReport, "jobId" | "format" | "originalFilename" | "refinedFilename" | "deletedAt">;
    let fullTextForInjection = "";
    let scannedPdf = false;

    // Progress for the refining phase: 35% when analysis is done, 95% when
    // the last batch/chunk is refined; the final store update takes it to
    // 100%. One store write per completed batch/chunk, so the status
    // endpoint (and the client polling it) sees the job move instead of
    // sitting frozen at 35% for the whole refine phase.
    const refineProgress = (label: string): BatchProgressCallback => async (done, total) => {
      await store.update(job.id, {
        status: "refining",
        stage: `${label} ${done} of ${total}…`,
        progress: 35 + Math.round((60 * done) / total),
      });
    };
    const refineFn = (texts: string[]) =>
      refineParagraphTexts(provider, system, texts, timeoutMs, refineProgress("Refining batch"));

    if (format === "docx") {
      const analysis = await analyseDocx(originalBytes);
      fullTextForInjection = analysis.paragraphs.map((p) => p.text).join("\n");
      await store.update(job.id, { status: "refining", stage: `Refining ${analysis.paragraphs.filter((p) => p.eligible).length} paragraphs across ${analysis.chapters.length} sections`, progress: 35 });
      const result = await refineDocx(originalBytes, refineFn);
      refinedBytes = result.bytes;
      if (!result.validation.valid) warnings.push(...result.validation.issues);
      const refinedAnalysis = await analyseDocx(refinedBytes);
      report = {
        originalWords: analysis.totalWords, refinedWords: refinedAnalysis.totalWords,
        paragraphsTotal: analysis.paragraphs.length, paragraphsRefined: result.refined,
        paragraphsProtected: result.protected, paragraphsSkipped: result.skipped,
        chapters: analysis.chapters.map((c) => ({ level: c.level, title: c.title, kind: c.kind })),
        protectedCounts: analysis.protectedCounts, limitations, warnings,
        injectionSpans: [], scannedPdf: false,
      };
    } else if (format === "odt") {
      const analysis = await analyseOdt(originalBytes);
      fullTextForInjection = analysis.paragraphs.map((p) => p.text).join("\n");
      await store.update(job.id, { status: "refining", stage: `Refining ${analysis.paragraphs.filter((p) => p.eligible).length} paragraphs across ${analysis.chapters.length} sections`, progress: 35 });
      const result = await refineOdt(originalBytes, refineFn);
      refinedBytes = result.bytes;
      if (!result.validation.valid) warnings.push(...result.validation.issues);
      const refinedAnalysis = await analyseOdt(refinedBytes);
      report = {
        originalWords: analysis.totalWords, refinedWords: refinedAnalysis.totalWords,
        paragraphsTotal: analysis.paragraphs.length, paragraphsRefined: result.refined,
        paragraphsProtected: result.protected, paragraphsSkipped: result.skipped,
        chapters: analysis.chapters.map((c) => ({ level: c.level, title: c.title, kind: c.kind })),
        protectedCounts: analysis.protectedCounts, limitations, warnings,
        injectionSpans: [], scannedPdf: false,
      };
    } else if (format === "txt") {
      const text = new TextDecoder().decode(originalBytes);
      fullTextForInjection = text;
      const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
      await store.update(job.id, { status: "refining", stage: `Refining ${paras.length} paragraphs`, progress: 35 });
      const refined = await refineParagraphTexts(provider, system, paras, timeoutMs, refineProgress("Refining batch"));
      const refinedText = refined.join("\n\n");
      refinedBytes = new TextEncoder().encode(refinedText);
      report = {
        originalWords: countWords(text), refinedWords: countWords(refinedText),
        paragraphsTotal: paras.length, paragraphsRefined: paras.length,
        paragraphsProtected: 0, paragraphsSkipped: 0,
        chapters: [], protectedCounts: {}, limitations, warnings,
        injectionSpans: [], scannedPdf: false,
      };
    } else if (format === "rtf") {
      const rtfText = new TextDecoder().decode(originalBytes);
      const doc = parseRtf(rtfText);
      const paras = doc.paragraphs.map((p) => p.runs.map((r) => r.text).join(""));
      fullTextForInjection = paras.join("\n");
      const nonEmpty = paras.map((t, i) => ({ t, i })).filter((x) => x.t.trim());
      await store.update(job.id, { status: "refining", stage: `Refining ${nonEmpty.length} paragraphs`, progress: 35 });
      const refined = await refineParagraphTexts(provider, system, nonEmpty.map((x) => x.t), timeoutMs, refineProgress("Refining batch"));
      nonEmpty.forEach((x, j) => {
        const runs = doc.paragraphs[x.i]?.runs ?? [];
        const first = runs.find((r) => r.text);
        if (first) first.text = refined[j] ?? x.t;
        for (const r of runs) if (r !== first) r.text = "";
      });
      const out = writeRtf(doc);
      refinedBytes = new TextEncoder().encode(out);
      limitations.push(RTF_LIMITATION);
      report = {
        originalWords: countWords(rtfToText(doc)), refinedWords: countWords(refined.join(" ")),
        paragraphsTotal: paras.length, paragraphsRefined: nonEmpty.length,
        paragraphsProtected: 0, paragraphsSkipped: paras.length - nonEmpty.length,
        chapters: [], protectedCounts: {}, limitations, warnings,
        injectionSpans: [], scannedPdf: false,
      };
    } else {
      // PDF: extract the text layer, refine it, return refined text.
      // The original PDF layout is never rebuilt — see the limitation below.
      const extracted = await extractPdfText(originalBytes);
      if (extracted.scanned) {
        scannedPdf = true;
        await fail(
          "This PDF has no extractable text layer — it appears to be a scanned (image-only) PDF. Proseforge cannot run OCR inside a Cloudflare Worker, so the document was not refined. Options: run OCR first (for example with a free desktop tool, or client-side OCR in the browser), then upload the text or an OCR-produced PDF; or upload a Word (.docx) version of the document instead. Your original file was not altered and will be deleted 48 hours after upload.",
        );
        return;
      }
      fullTextForInjection = extracted.text;
      limitations.push(
        "PDF layout is not preserved: Proseforge extracted the PDF's text layer, refined the text, and returns it as a plain-text file. The original PDF is kept unchanged and remains downloadable from the report. Tables, figures, and page layout from the PDF are not carried into the refined text file.",
      );
      await store.update(job.id, { status: "refining", stage: `Refining extracted text (${extracted.pageCount} pages)`, progress: 35 });
      const refinedText = await refineLongText(provider, system, extracted.text, timeoutMs, refineProgress("Refining chunk"));
      refinedBytes = new TextEncoder().encode(refinedText);
      outFilename = refinedFilename(job.originalFilename, "pdf");
      report = {
        originalWords: countWords(extracted.text), refinedWords: countWords(refinedText),
        paragraphsTotal: extracted.text.split(/\n\s*\n/).filter(Boolean).length, paragraphsRefined: 0,
        paragraphsProtected: 0, paragraphsSkipped: 0,
        chapters: [], protectedCounts: {}, limitations, warnings,
        injectionSpans: [], scannedPdf: false,
      };
      // PDF has no paragraph structure to count: report refined words instead.
      report.paragraphsRefined = report.paragraphsTotal;
    }

    // Prompt-injection spans are flagged in the report, never silently edited.
    const injectionSpans = findInjectionSpans(fullTextForInjection);
    if (injectionSpans.length) {
      warnings.push(`The document contains ${injectionSpans.length} instruction-like span(s) (e.g. "${injectionSpans[0]}"). They were treated as ordinary text and never executed as instructions; review the document if you did not write them.`);
    }

    const fullReport: DocumentReport = {
      jobId: job.id, format, originalFilename: job.originalFilename,
      refinedFilename: outFilename,
      ...report,
      injectionSpans,
      scannedPdf,
      deletedAt: deletedAtFor(job.uploadedAt),
    };
    const refinedKey = `refined/${job.id}`;
    await store.putRefined(job.id, refinedKey, refinedBytes);
    await store.update(job.id, {
      status: "done", stage: "Done", progress: 100,
      reportJson: JSON.stringify(fullReport),
    });
    // The download token is issued by the status endpoint (rotated on each
    // poll, 15-minute expiry) — see src/index.ts. It is never persisted
    // in plaintext; only its hash is stored.
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    // Never include document content in the error: only the failure kind.
    await fail(`Document processing failed (${msg}). The original file was not altered; please try again or split the document into smaller parts.`);
  }
}

/** Download tokens are issued (and rotated) by the status endpoint — see src/index.ts. */

export function publicJobView(job: JobRecord): Record<string, unknown> {
  const report = job.reportJson ? (JSON.parse(job.reportJson) as DocumentReport) : null;
  return {
    id: job.id,
    format: job.format,
    originalFilename: job.originalFilename,
    sizeBytes: job.sizeBytes,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    uploadedAt: job.uploadedAt,
    deletedAt: deletedAtFor(job.uploadedAt),
    ...(job.error ? { error: job.error } : {}),
    ...(report ? { summary: { paragraphsTotal: report.paragraphsTotal, paragraphsRefined: report.paragraphsRefined, paragraphsProtected: report.paragraphsProtected, originalWords: report.originalWords, refinedWords: report.refinedWords, chapters: report.chapters } } : {}),
    ...(job.status === "done" && report ? { refinedFilename: report.refinedFilename } : {}),
  };
}
