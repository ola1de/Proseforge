// Milestone 4 — speed & responsiveness tests.
// Proves the parallel paths actually overlap (concurrency counter on a
// delayed fake provider), that output order is preserved, that the
// per-batch progress callback fires once per batch, that a multi-batch
// document job completes end to end through the real waitUntil path,
// and that /api/refine runs its chunks concurrently. The fake providers
// are TEST-ONLY and never presented as real refinement.
import { describe, it, expect } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/types";
import { refineLongText, refineParagraphTexts } from "../src/documents";
import { buildSystemPrompt } from "../src/prompts";
import { fakeRefineProvider } from "./fixtures/fake-provider";
import type { AIProvider } from "../src/providers";

const SYSTEM = buildSystemPrompt({ modeId: "academic", intensity: "balanced" });

/** Wrap a provider with an artificial delay and a concurrency counter. */
function trackingProvider(base: AIProvider, delayMs: number): { provider: AIProvider; stats: { calls: number; maxActive: number } } {
  const stats = { calls: 0, maxActive: 0 };
  let active = 0;
  const provider: AIProvider = {
    name: base.name,
    complete: async (opts) => {
      stats.calls += 1;
      active += 1;
      stats.maxActive = Math.max(stats.maxActive, active);
      try {
        await new Promise((r) => setTimeout(r, delayMs));
        return await base.complete(opts);
      } finally {
        active -= 1;
      }
    },
  };
  return { provider, stats };
}

const SENTENCE = "The committee reviewed the proposal carefully and noted several areas where the argument could be strengthened with additional evidence from recent studies. ";
function para(marker: string, repeats: number): string {
  return `${marker} ` + SENTENCE.repeat(repeats);
}

describe("parallel paragraph batches", () => {
  it("runs batches concurrently, preserves paragraph order, and reports progress per batch", async () => {
    const texts = Array.from({ length: 30 }, (_, i) => para(`Para${i}.`, 2)); // 30 short paras -> 4 batches of 8/8/8/6
    const { provider, stats } = trackingProvider(fakeRefineProvider, 30);
    const progress: { done: number; total: number }[] = [];
    const { texts: out, failedBatches, failedParagraphs } = await refineParagraphTexts(provider, SYSTEM, texts, 5000, (done, total) => {
      progress.push({ done, total });
    });
    // Batches overlapped instead of running one after another.
    expect(stats.maxActive).toBeGreaterThan(1);
    expect(stats.calls).toBe(4); // one call per batch, no per-paragraph fallback
    expect(failedBatches).toBe(0);
    expect(failedParagraphs).toBe(0);
    // Every paragraph came back in its original position.
    expect(out.length).toBe(30);
    out.forEach((r, i) => expect(r).toBe(`Refined: ${texts[i]?.trim()}`));
    // Progress fired exactly once per completed batch.
    expect(progress.length).toBe(4);
    expect(progress.map((p) => p.total)).toEqual([4, 4, 4, 4]);
    expect(progress.map((p) => p.done).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  });
});

describe("parallel long-text chunks", () => {
  it("runs chunks concurrently and keeps their order", async () => {
    // 5 paragraphs of ~600 words each -> 5 chunks (one per paragraph at
    // the 800-word default; two would not fit in a chunk together).
    const text = [0, 1, 2, 3, 4].map((i) => para(`MARKER${i}`, 30)).join("\n\n");
    const { provider, stats } = trackingProvider(fakeRefineProvider, 30);
    const progress: { done: number; total: number }[] = [];
    const { text: out, failedChunks } = await refineLongText(provider, SYSTEM, text, 5000, (done, total) => {
      progress.push({ done, total });
    });
    expect(stats.maxActive).toBeGreaterThan(1);
    expect(stats.calls).toBe(5);
    expect(failedChunks).toBe(0);
    // Chunk order preserved in the joined output.
    const i0 = out.indexOf("MARKER0");
    const i2 = out.indexOf("MARKER2");
    const i4 = out.indexOf("MARKER4");
    expect(i0).toBeGreaterThanOrEqual(0);
    expect(i2).toBeGreaterThan(i0);
    expect(i4).toBeGreaterThan(i2);
    expect(progress.length).toBe(5);
    expect(progress.map((p) => p.total)).toEqual([5, 5, 5, 5, 5]);
  });
});

/** Fake Workers AI binding: delayed, concurrency-tracked, and able to
    answer batch calls with the right paragraph count (mirrors the logic
    of the test-only fake provider, at the binding level). */
function delayedCountingAI(delayMs: number): { env: Env; stats: { calls: number; maxActive: number } } {
  const stats = { calls: 0, maxActive: 0 };
  let active = 0;
  let callNo = 0;
  const AI = {
    run: async (_model: string, opts: { messages?: { role: string; content: string }[] }) => {
      // Capture the call number synchronously at dispatch: with
      // concurrent calls the post-delay order is not deterministic.
      const n = ++callNo;
      stats.calls += 1;
      active += 1;
      stats.maxActive = Math.max(stats.maxActive, active);
      try {
        await new Promise((r) => setTimeout(r, delayMs));
        const user = opts.messages?.find((m) => m.role === "user")?.content ?? "";
        const batch = /Return exactly (\d+) paragraph/.exec(user);
        if (batch) {
          const count = Number(batch[1]);
          const parts = user.split(/Paragraph \d+:\n/).slice(1);
          return { response: parts.slice(0, count).map((p) => `Refined: ${p.trim()}`).join("\n\n") };
        }
        const marker = "Refine the following text:\n\n";
        const idx = user.indexOf(marker);
        if (idx >= 0) return { response: `Refined chunk ${n}` };
        return { response: "Refined test output." };
      } finally {
        active -= 1;
      }
    },
  };
  return {
    env: { MAX_TEXT_CHARS: "100000", RATE_LIMIT_PER_MINUTE: "1000", AI } as unknown as Env,
    stats,
  };
}

describe("parallel /api/refine chunks", () => {
  it("refines two chunks concurrently and returns them in order", async () => {
    // 2 paragraphs of ~800 words each -> 2 chunks.
    const text = [para("FIRST", 40), para("SECOND", 40)].join("\n\n");
    const { env, stats } = delayedCountingAI(30);
    const res = await worker.fetch(new Request("https://proseforge.test/api/refine", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "10.2.0.1" },
      body: JSON.stringify({ text, mode: "academic", intensity: "balanced" }),
    }), env);
    expect(res.status).toBe(200);
    const data = await res.json() as { refined: string; chunks: number };
    expect(data.chunks).toBe(2);
    expect(stats.maxActive).toBe(2); // both chunks in flight at once
    expect(data.refined).toBe("Refined chunk 1\n\nRefined chunk 2");
  });
});

describe("multi-batch document job through waitUntil", () => {
  it("a 40-paragraph TXT completes to done (not stuck at 35%)", async () => {
    const paras = Array.from({ length: 40 }, (_, i) => para(`Paragraph ${i + 1}.`, 2));
    const text = paras.join("\n\n");
    const file = new File([text], "chapter.txt", { type: "text/plain" });
    const form = new FormData();
    form.append("file", file);
    form.append("mode", "academic");
    form.append("intensity", "balanced");
    form.append("discipline", "General");
    const { env } = delayedCountingAI(20);
    // Capture the waitUntil promise exactly as the Worker runtime does,
    // so this exercises the real background-processing path.
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); } };
    const started = Date.now();
    const res = await worker.fetch(new Request("https://proseforge.test/api/documents/upload", {
      method: "POST",
      headers: { "CF-Connecting-IP": "10.2.0.2" },
      body: form,
    }), env, ctx as never);
    expect(res.status).toBe(202);
    const data = await res.json() as { job: { id: string; status: string } };
    const id = data.job.id;
    // The upload response returns before processing finishes; the job
    // must reach "done" once the background task completes.
    await Promise.all(pending);
    const elapsedMs = Date.now() - started;
    const status = await worker.fetch(new Request(`https://proseforge.test/api/documents/${id}/status`), env);
    const statusData = await status.json() as { job: { status: string; progress: number; summary?: { paragraphsRefined: number } } };
    expect(statusData.job.status).toBe("done");
    expect(statusData.job.progress).toBe(100);
    expect(statusData.job.summary?.paragraphsRefined).toBe(40);
    expect(elapsedMs).toBeLessThan(30000);
  });
});
