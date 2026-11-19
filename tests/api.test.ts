// API tests. The "AI" used here is a TEST-ONLY fake of the Workers AI
// binding (a canned response), clearly labelled as such. It proves the
// wiring, validation, and error paths — it is NOT a real refinement and
// must never be presented as one.
import { describe, it, expect } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/types";

const noProviderEnv = { MAX_TEXT_CHARS: "100000", RATE_LIMIT_PER_MINUTE: "1000" } as unknown as Env;
const fakeAIEnv = {
  ...noProviderEnv,
  AI: { run: async () => ({ response: "Refined test output." }) },
} as unknown as Env;

function req(path: string, init?: RequestInit): Request {
  return new Request(`https://proseforge.test${path}`, init);
}
async function post(path: string, body: unknown, env: Env, ip = "10.0.0.1") {
  return worker.fetch(req(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }), env);
}

describe("health & config", () => {
  it("health returns ok + provider kind", async () => {
    const res = await worker.fetch(req("/api/health"), noProviderEnv);
    expect(res.status).toBe(200);
    const data = await res.json() as { ok: boolean; provider: string };
    expect(data.ok).toBe(true);
    expect(data.provider).toBe("none");
  });
  it("config lists 10 modes, 16 disciplines, and no secrets", async () => {
    const res = await worker.fetch(req("/api/config"), noProviderEnv);
    const data = await res.json() as { modes: unknown[]; disciplines: string[] };
    expect(data.modes).toHaveLength(10);
    expect(data.disciplines.length).toBeGreaterThanOrEqual(16);
    expect(JSON.stringify(data)).not.toContain("API_KEY");
  });
  it("security headers are present", async () => {
    const res = await worker.fetch(req("/api/health"), noProviderEnv);
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });
});

describe("refine — honest no-provider behaviour", () => {
  it("returns 503 with setup guidance when no provider is configured (never fake output)", async () => {
    const res = await post("/api/refine", { text: "Some robotic text here.", mode: "natural" }, noProviderEnv, "10.0.0.2");
    expect(res.status).toBe(503);
    const data = await res.json() as { error: string; setup: string[] };
    expect(data.error).toBe("PROVIDER_NOT_CONFIGURED");
    expect(data.setup.join(" ")).toContain("AI_API_KEY");
  });
  it("refine works end-to-end with the TEST-ONLY fake AI binding", async () => {
    const res = await post("/api/refine", { text: "Some robotic text here.", mode: "academic", intensity: "balanced", discipline: "Political Science" }, fakeAIEnv, "10.0.0.3");
    expect(res.status).toBe(200);
    const data = await res.json() as { refined: string; mode: string };
    expect(data.refined).toBe("Refined test output.");
    expect(data.mode).toBe("academic");
  });
  it("rejects empty text, unknown mode, and missing custom voice", async () => {
    expect((await post("/api/refine", { text: "   " }, fakeAIEnv, "10.0.0.4")).status).toBe(400);
    expect((await post("/api/refine", { text: "x", mode: "nope" }, fakeAIEnv, "10.0.0.5")).status).toBe(400);
    expect((await post("/api/refine", { text: "x", mode: "custom" }, fakeAIEnv, "10.0.0.6")).status).toBe(400);
  });
  it("rejects oversized text with 413", async () => {
    const env = { MAX_TEXT_CHARS: "10", RATE_LIMIT_PER_MINUTE: "1000" } as unknown as Env;
    const res = await post("/api/refine", { text: "this text is far too long for a 10-char limit" }, env, "10.0.0.7");
    expect(res.status).toBe(413);
  });
  it("rejects malformed JSON with 400", async () => {
    const res = await post("/api/refine", "{not json", fakeAIEnv, "10.0.0.8");
    expect(res.status).toBe(400);
  });
});

describe("analyse — works without any AI provider", () => {
  it("returns deterministic analysis + the not-a-validated-score note", async () => {
    const res = await post("/api/analyse", { text: "The cat sat. The dog ran fast." }, noProviderEnv, "10.0.0.9");
    expect(res.status).toBe(200);
    const data = await res.json() as { original: { words: number }; note: string };
    expect(data.original.words).toBe(7);
    expect(data.note).toContain("not scientifically validated");
  });
});

describe("academic & construct", () => {
  it("academic rejects unknown sections, accepts known ones with the fake binding", async () => {
    expect((await post("/api/academic", { text: "x", section: "nope" }, fakeAIEnv, "10.0.0.10")).status).toBe(400);
    const res = await post("/api/academic", { text: "Studies show turnout falls.", section: "abstract" }, fakeAIEnv, "10.0.0.11");
    expect(res.status).toBe(200);
    const data = await res.json() as { unsupportedClaims: string[] };
    expect(data.unsupportedClaims).toHaveLength(1);
  });
  it("construct parses numbered alternatives from the fake binding", async () => {
    const env = { ...noProviderEnv, AI: { run: async () => ({ response: "1. First alternative.\n2. Second alternative.\n3. Third alternative." }) } } as unknown as Env;
    const res = await post("/api/construct", { text: "A basic sentence." }, env, "10.0.0.12");
    expect(res.status).toBe(200);
    const data = await res.json() as { alternatives: string[] };
    expect(data.alternatives).toHaveLength(3);
    expect(data.alternatives[0]).toBe("First alternative.");
  });
});

describe("documents — Milestone 2 (see tests/api-documents.test.ts for full coverage)", () => {
  it("config reports documents as available (the 501 stub is gone)", async () => {
    const res = await worker.fetch(req("/api/config"), noProviderEnv);
    const data = await res.json() as { documentsAvailable: boolean; documentFormats: { id: string }[] };
    expect(data.documentsAvailable).toBe(true);
    expect(data.documentFormats.map((f) => f.id)).toContain("docx");
  });
});

describe("rate limiting", () => {
  it("blocks after the per-minute limit for one IP", async () => {
    const env = { MAX_TEXT_CHARS: "100000", RATE_LIMIT_PER_MINUTE: "2" } as unknown as Env;
    const ip = "10.9.9.9";
    expect((await post("/api/analyse", { text: "hello world" }, env, ip)).status).toBe(200);
    expect((await post("/api/analyse", { text: "hello world" }, env, ip)).status).toBe(200);
    expect((await post("/api/analyse", { text: "hello world" }, env, ip)).status).toBe(429);
  });
});
