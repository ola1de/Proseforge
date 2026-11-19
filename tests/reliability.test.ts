// Milestone 7 — long-text reliability tests.
// Proves: a chunk/batch the provider cannot finish falls back to the
// ORIGINAL text instead of failing the whole request; /api/refine reports
// partial: true with the failed chunk indexes; maxTokens adapts to the
// input size; and a document job with a failing batch still reaches
// "done" with the failure recorded in its report warnings (and the
// failed paragraphs NOT counted as refined). The fake providers are
// TEST-ONLY and never presented as real refinement.
import { describe, it, expect } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/types";
import { refineParagraphTexts, refineLongText } from "../src/documents";
import { buildSystemPrompt } from "../src/prompts";
import { fakeRefineProvider } from "./fixtures/fake-provider";
import type { AIProvider } from "../src/providers";

const SYSTEM = buildSystemPrompt({ modeId: "academic", intensity: "balanced" });

const SENTENCE = "The committee reviewed the proposal carefully and noted several areas where the argument could be strengthened with additional evidence from recent studies. ";
function para(marker: string, repeats: number): string {
  return `${marker} ` + SENTENCE.repeat(repeats);
}

/** Wrap the fake provider so every call whose user text contains `marker`
 * throws (simulating a provider timeout on that piece of text). */
function failingProvider(marker: string): { provider: AIProvider; calls: { maxTokens: number }[] } {
  const calls: { maxTokens: number }[] = [];
  const provider: AIProvider = {
    name: "mock",
    complete: async (opts) => {
      calls.push({ maxTokens: opts.maxTokens });
      if (opts.user.includes(marker)) throw Object.assign(new Error("AI request timed out"), { code: "AI_TIMEOUT" });
      return fakeRefineProvider.complete(opts);
    },
  };
  return { provider, calls };
}

/** Fake Workers AI binding that throws for any call whose user message
 * contains `marker` (simulating a provider timeout), and otherwise
 * answers batch calls with the right paragraph count (mirrors the
 * test-only fake provider, at the binding level). */
function failingAIEnv(marker: string): Env {
  let callNo = 0;
  const AI = {
    run: async (_model: string, opts: { messages?: { role: string; content: string }[] }) => {
      const n = ++callNo;
      const user = opts.messages?.find((m) => m.role === "user")?.content ?? "";
      if (user.includes(marker)) throw new Error("AI request timed out");
      const batch = /Return exactly (\d+) paragraph/.exec(user);
      if (batch) {
        const count = Number(batch[1]);
        const parts = user.split(/Paragraph \d+:\n/).slice(1);
        return { response: parts.slice(0, count).map((p) => `Refined: ${p.trim()}`).join("\n\n") };
      }
      const m = "Refine the following text:\n\n";
      const idx = user.indexOf(m);
      if (idx >= 0) return { response: `Refined chunk ${n}` };
      return { response: "Refined test output." };
    },
  };
  return { MAX_TEXT_CHARS: "100000", RATE_LIMIT_PER_MINUTE: "1000", AI } as unknown as Env;
}

describe("partial batch failure", () => {
  it("one failing paragraph falls back to its original text and is counted, the rest still refine", async () => {
    const texts = Array.from({ length: 10 }, (_, i) => para(`Para${i}.`, 2));
    texts[3] = para("FAILMARKER.", 2);
    const { provider } = failingProvider("FAILMARKER");
    const { texts: out, failedBatches, failedParagraphs } = await refineParagraphTexts(provider, SYSTEM, texts, 5000);
    expect(out.length).toBe(10);
    expect(out[3]).toBe(texts[3]); // unchanged original, never presented as refined
    out.forEach((r, i) => { if (i !== 3) expect(r).toBe(`Refined: ${texts[i]?.trim()}`); });
    expect(failedBatches).toBe(1);
    expect(failedParagraphs).toBe(1);
  });

  it("a failing chunk falls back to its original text and is counted", async () => {
    // Three ~660-word paragraphs -> three chunks at the 800-word default;
    // the marker is in the LAST chunk so no later chunk's overlap context
    // can pick it up.
    const text = [para("FIRST", 30), para("THIRD", 30), para("FAILMARKER", 30)].join("\n\n");
    const { provider } = failingProvider("FAILMARKER");
    const { text: out, failedChunks, failedParagraphs } = await refineLongText(provider, SYSTEM, text, 5000);
    expect(failedChunks).toBe(1);
    expect(failedParagraphs).toBe(1);
    expect(out).toContain("Refined: FIRST");
    expect(out).toContain("Refined: THIRD");
    expect(out).toContain("FAILMARKER"); // original chunk text kept
    expect(out).not.toContain("Refined: FAILMARKER");
  });
});

describe("adaptive maxTokens", () => {
  it("caps batch calls from the input size: 768 floor, 4096 cap", async () => {
    const { provider, calls } = failingProvider("ZZZNEVER");
    // One tiny paragraph: the batch call uses the 768 floor.
    await refineParagraphTexts(provider, SYSTEM, ["A short paragraph here."], 5000);
    expect(calls.map((c) => c.maxTokens)).toEqual([768]);
    // One 2,500-word paragraph: the batch call caps at 4096.
    calls.length = 0;
    await refineParagraphTexts(provider, SYSTEM, ["word ".repeat(2500).trim()], 5000);
    expect(calls.map((c) => c.maxTokens)).toEqual([4096]);
    // One 400-word paragraph: roughly twice the input words.
    calls.length = 0;
    await refineParagraphTexts(provider, SYSTEM, ["word ".repeat(400).trim()], 5000);
    expect(calls.map((c) => c.maxTokens)).toEqual([800]);
  });
});

describe("partial /api/refine response", () => {
  it("returns 200 with partial: true and failedChunks when one chunk times out", async () => {
    // Two ~880-word paragraphs -> two chunks; the second fails.
    const text = [para("FIRST", 40), para("FAILMARKER", 40)].join("\n\n");
    const env = failingAIEnv("FAILMARKER");
    const res = await worker.fetch(new Request("https://proseforge.test/api/refine", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "10.3.0.1" },
      body: JSON.stringify({ text, mode: "natural", intensity: "balanced" }),
    }), env);
    expect(res.status).toBe(200);
    const data = await res.json() as { refined: string; chunks: number; partial?: boolean; failedChunks?: number[] };
    expect(data.chunks).toBe(2);
    expect(data.partial).toBe(true);
    expect(data.failedChunks).toEqual([1]);
    expect(data.refined).toContain("Refined chunk 1");
    expect(data.refined).toContain("FAILMARKER"); // original second chunk kept
    expect(data.refined).not.toContain("Refined chunk 2");
  });

  it("a fully successful refine has no partial flag", async () => {
    const text = [para("FIRST", 40), para("SECOND", 40)].join("\n\n");
    const env = failingAIEnv("ZZZNEVER");
    const res = await worker.fetch(new Request("https://proseforge.test/api/refine", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "10.3.0.2" },
      body: JSON.stringify({ text, mode: "natural", intensity: "balanced" }),
    }), env);
    expect(res.status).toBe(200);
    const data = await res.json() as { refined: string; partial?: boolean; failedChunks?: number[] };
    expect(data.partial).toBeUndefined();
    expect(data.failedChunks).toBeUndefined();
    expect(data.refined).toBe("Refined chunk 1\n\nRefined chunk 2");
  });
});

describe("document job with a failing batch", () => {
  it("a TXT job completes to done, records the failure in warnings, and does not count failed paragraphs as refined", async () => {
    const paras = Array.from({ length: 10 }, (_, i) => para(`Paragraph ${i + 1}.`, 2));
    paras[3] = para("FAILMARKER.", 2);
    const text = paras.join("\n\n");
    const file = new File([text], "chapter.txt", { type: "text/plain" });
    const form = new FormData();
    form.append("file", file);
    form.append("mode", "academic");
    form.append("intensity", "balanced");
    form.append("discipline", "General");
    const env = failingAIEnv("FAILMARKER");
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); } };
    const res = await worker.fetch(new Request("https://proseforge.test/api/documents/upload", {
      method: "POST",
      headers: { "CF-Connecting-IP": "10.3.0.3" },
      body: form,
    }), env, ctx as never);
    expect(res.status).toBe(202);
    const data = await res.json() as { job: { id: string } };
    await Promise.all(pending);
    const status = await worker.fetch(new Request(`https://proseforge.test/api/documents/${data.job.id}/status`), env);
    const statusData = await status.json() as { job: { status: string; progress: number; summary?: { paragraphsRefined: number; paragraphsTotal: number } } };
    expect(statusData.job.status).toBe("done");
    expect(statusData.job.progress).toBe(100);
    expect(statusData.job.summary?.paragraphsTotal).toBe(10);
    expect(statusData.job.summary?.paragraphsRefined).toBe(9);
    const report = await worker.fetch(new Request(`https://proseforge.test/api/documents/${data.job.id}/report`), env);
    const reportData = await report.json() as { warnings: string[]; paragraphsSkipped: number };
    expect(reportData.paragraphsSkipped).toBe(1);
    expect(reportData.warnings.join(" ")).toContain("could not be refined in time");
  });
});
