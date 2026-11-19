// HTTP-level document API tests (Milestone 2).
// Uploads go through the real Worker fetch handler with the TEST-ONLY
// fake AI binding (canned response) — proving wiring, validation, and
// error paths. It is NOT a real refinement and must never be presented
// as one. Note: tests call worker.fetch without a ctx, so processing runs
// inline (awaited) instead of via waitUntil — the upload response already
// carries the finished job.
import { describe, it, expect } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/types";
import { memoryStore, newJobId } from "../src/store";
import { buildSampleDocx, buildScannedPdf } from "./fixtures/sample-docx";

const fakeAIEnv = {
  MAX_TEXT_CHARS: "100000",
  RATE_LIMIT_PER_MINUTE: "1000",
  AI: { run: async () => ({ response: "Refined test output." }) },
} as unknown as Env;
const noProviderEnv = { MAX_TEXT_CHARS: "100000", RATE_LIMIT_PER_MINUTE: "1000" } as unknown as Env;

function uploadReq(file: File, ip: string, extra: Record<string, string> = {}): Request {
  const form = new FormData();
  form.append("file", file);
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return new Request("https://proseforge.test/api/documents/upload", {
    method: "POST",
    headers: { "CF-Connecting-IP": ip },
    body: form,
  });
}

describe("documents API", () => {
  it("config reports documents available with formats and limits", async () => {
    const res = await worker.fetch(new Request("https://proseforge.test/api/config"), fakeAIEnv);
    const data = await res.json() as { documentsAvailable: boolean; documentFormats: { id: string }[]; maxDocBytes: number };
    expect(data.documentsAvailable).toBe(true);
    expect(data.documentFormats.map((f) => f.id).sort()).toEqual(["docx", "odt", "pdf", "rtf", "txt"]);
    expect(data.maxDocBytes).toBeGreaterThan(0);
  });

  it("uploads a DOCX and finishes it inline in tests (fake AI)", async () => {
    const bytes = await buildSampleDocx();
    const file = new File([bytes as unknown as BlobPart], "thesis.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const res = await worker.fetch(uploadReq(file, "10.1.0.1"), fakeAIEnv);
    expect(res.status).toBe(202);
    const data = await res.json() as { job: { id: string; status: string; format: string } };
    expect(data.job.format).toBe("docx");
    // Inline processing already finished (no ctx in tests).
    expect(data.job.status).toBe("done");
    const id = data.job.id;

    const status = await worker.fetch(new Request(`https://proseforge.test/api/documents/${id}/status`), fakeAIEnv);
    expect(status.status).toBe(200);
    const statusData = await status.json() as { job: { status: string; downloadToken: string; refinedFilename: string; summary: { paragraphsRefined: number } } };
    expect(statusData.job.status).toBe("done");
    expect(statusData.job.downloadToken).toBeTruthy();
    expect(statusData.job.summary.paragraphsRefined).toBeGreaterThan(0);

    const report = await worker.fetch(new Request(`https://proseforge.test/api/documents/${id}/report`), fakeAIEnv);
    expect(report.status).toBe(200);
    const reportData = await report.json() as { chapters: unknown[]; paragraphsProtected: number };
    expect(reportData.chapters.length).toBeGreaterThanOrEqual(5);
    expect(reportData.paragraphsProtected).toBeGreaterThan(0);

    const token = statusData.job.downloadToken;
    const dl = await worker.fetch(new Request(`https://proseforge.test/api/documents/${id}/download?token=${token}`), fakeAIEnv);
    expect(dl.status).toBe(200);
    expect(dl.headers.get("Content-Disposition") ?? "").toContain("thesis.refined.docx");
    const out = new Uint8Array(await dl.arrayBuffer());
    expect(out[0]).toBe(0x50); // ZIP magic: a real .docx
    expect(out[1]).toBe(0x4b);

    // Original download works with the same token.
    const orig = await worker.fetch(new Request(`https://proseforge.test/api/documents/${id}/download?token=${token}&kind=original`), fakeAIEnv);
    expect(orig.status).toBe(200);
    expect(new Uint8Array(await orig.arrayBuffer())).toEqual(bytes);
  });

  it("rejects downloads without a token or with a wrong token", async () => {
    const bytes = await buildSampleDocx();
    const file = new File([bytes as unknown as BlobPart], "thesis.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const res = await worker.fetch(uploadReq(file, "10.1.0.2"), fakeAIEnv);
    const data = await res.json() as { job: { id: string } };
    const id = data.job.id;
    expect((await worker.fetch(new Request(`https://proseforge.test/api/documents/${id}/download`), fakeAIEnv)).status).toBe(401);
    expect((await worker.fetch(new Request(`https://proseforge.test/api/documents/${id}/download?token=deadbeef`), fakeAIEnv)).status).toBe(401);
  });

  it("rejects bad uploads: wrong extension, renamed content, .docm, missing file", async () => {
    const exe = new File([new Uint8Array([0x4d, 0x5a])], "app.exe", { type: "application/octet-stream" });
    expect((await worker.fetch(uploadReq(exe, "10.1.0.3"), fakeAIEnv)).status).toBe(400);
    const fake = new File([new TextEncoder().encode("hello")], "thesis.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const fakeRes = await worker.fetch(uploadReq(fake, "10.1.0.4"), fakeAIEnv);
    expect(fakeRes.status).toBe(400);
    const fakeData = await fakeRes.json() as { message: string };
    expect(fakeData.message).toContain("not a ZIP-based");
    const docm = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], "evil.docm", { type: "application/octet-stream" });
    expect((await worker.fetch(uploadReq(docm, "10.1.0.5"), fakeAIEnv)).status).toBe(400);
    const empty = new Request("https://proseforge.test/api/documents/upload", { method: "POST", headers: { "CF-Connecting-IP": "10.1.0.6" }, body: new FormData() });
    expect((await worker.fetch(empty, fakeAIEnv)).status).toBe(400);
  });

  it("reports needs-provider honestly when no AI is configured", async () => {
    const bytes = await buildSampleDocx();
    const file = new File([bytes as unknown as BlobPart], "thesis.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const res = await worker.fetch(uploadReq(file, "10.1.0.7"), noProviderEnv);
    expect(res.status).toBe(202);
    const data = await res.json() as { job: { id: string; status: string; error: string } };
    expect(data.job.status).toBe("needs-provider");
    expect(data.job.error).toContain("No AI provider is configured");
    // …and retry is possible once a provider exists.
    const retry = await worker.fetch(new Request(`https://proseforge.test/api/documents/${data.job.id}/retry`, { method: "POST", headers: { "CF-Connecting-IP": "10.1.0.7" } }), fakeAIEnv);
    expect(retry.status).toBe(202);
    const retryData = await retry.json() as { job: { status: string } };
    expect(retryData.job.status).toBe("done");
  });

  it("retries a stuck refining job (background task died without failing it)", async () => {
    // Fabricate the exact state the live site showed: a job frozen in
    // "refining" at 35% because its background task died. Retry must
    // accept it and the re-run must complete.
    const bytes = await buildSampleDocx();
    const id = newJobId();
    await memoryStore.create({
      id, format: "docx", originalFilename: "thesis.docx",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: bytes.length, status: "refining",
      stage: "Refining batch 1 of 4…", progress: 35,
      uploadedAt: new Date().toISOString(), r2Key: `original/${id}`,
    }, bytes);
    const retry = await worker.fetch(new Request(`https://proseforge.test/api/documents/${id}/retry`, { method: "POST", headers: { "CF-Connecting-IP": "10.1.0.9" } }), fakeAIEnv);
    expect(retry.status).toBe(202);
    const retryData = await retry.json() as { job: { status: string } };
    // Inline processing in tests: the retried job finishes.
    expect(retryData.job.status).toBe("done");

    // …while a finished job still cannot be retried.
    const doneRetry = await worker.fetch(new Request(`https://proseforge.test/api/documents/${id}/retry`, { method: "POST", headers: { "CF-Connecting-IP": "10.1.0.9" } }), fakeAIEnv);
    expect(doneRetry.status).toBe(400);
  });

  it("fails honestly on a scanned PDF through the API", async () => {
    const bytes = buildScannedPdf();
    const file = new File([bytes as unknown as BlobPart], "scan.pdf", { type: "application/pdf" });
    const res = await worker.fetch(uploadReq(file, "10.1.0.8"), fakeAIEnv);
    const data = await res.json() as { job: { status: string; error: string } };
    expect(data.job.status).toBe("failed");
    expect(data.job.error).toContain("no extractable text layer");
  });

  it("returns 404 for unknown job ids and 410-style handling for missing jobs", async () => {
    const id = "a".repeat(32);
    expect((await worker.fetch(new Request(`https://proseforge.test/api/documents/${id}/status`), fakeAIEnv)).status).toBe(404);
    expect((await worker.fetch(new Request("https://proseforge.test/api/documents/not-a-job/status"), fakeAIEnv)).status).toBe(404);
  });
});
