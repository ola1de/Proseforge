import { describe, it, expect } from "vitest";
import { resolveProviderKind, extractWorkersAIText, PROVIDER_NOT_CONFIGURED_SETUP, WorkersAIProvider } from "../src/providers";
import type { Env } from "../src/types";

describe("provider resolution", () => {
  it("no bindings and no env => none", () => { expect(resolveProviderKind({} as Env)).toBe("none"); });
  it("AI binding present => workers-ai", () => {
    expect(resolveProviderKind({ AI: { run: async () => ({}) } } as unknown as Env)).toBe("workers-ai");
  });
  it("explicit openai-compatible with base + key => openai-compatible", () => {
    expect(resolveProviderKind({ AI_PROVIDER: "openai-compatible", AI_BASE_URL: "https://x.example/v1", AI_API_KEY: "k" } as Env)).toBe("openai-compatible");
  });
  it("explicit openai-compatible without a key => none (never half-configured)", () => {
    expect(resolveProviderKind({ AI_PROVIDER: "openai-compatible", AI_BASE_URL: "https://x.example/v1" } as Env)).toBe("none");
  });
  it("setup guidance names the exact steps", () => {
    expect(PROVIDER_NOT_CONFIGURED_SETUP.join(" ")).toContain("wrangler secret put AI_API_KEY");
    expect(PROVIDER_NOT_CONFIGURED_SETUP.join(" ")).toContain("DEPLOYMENT.md");
  });
  it("extracts Workers AI text from known response shapes", () => {
    expect(extractWorkersAIText({ response: "hello" })).toBe("hello");
    expect(extractWorkersAIText("plain")).toBe("plain");
    expect(extractWorkersAIText({ choices: [{ message: { content: "c" } }] })).toBe("c");
    expect(extractWorkersAIText({})).toBe("");
  });
  it("maps an unreachable Workers AI binding (e.g. local dev without a remote session) to PROVIDER_NOT_CONFIGURED", async () => {
    const env = { AI: { run: async () => { throw new Error("AI binding is not supported in this environment"); } } } as unknown as Env;
    const p = new WorkersAIProvider(env);
    await expect(p.complete({ system: "s", user: "u", maxTokens: 10, timeoutMs: 5000 })).rejects.toMatchObject({ code: "PROVIDER_NOT_CONFIGURED" });
  });
  it("Workers AI call passes temperature 0.3 (steadier, more faithful output)", async () => {
    let captured: unknown;
    const env = {
      AI: {
        run: async (_model: string, opts: unknown) => {
          captured = opts;
          return { response: "ok" };
        },
      },
    } as unknown as Env;
    const p = new WorkersAIProvider(env);
    await expect(p.complete({ system: "s", user: "u", maxTokens: 10, timeoutMs: 5000 })).resolves.toBe("ok");
    expect(captured).toMatchObject({ temperature: 0.3, max_tokens: 10 });
  });
  it("the timeout race actually fires when the binding hangs (Milestone 7)", async () => {
    // A binding whose run() never settles: complete() must still reject
    // with AI_TIMEOUT at the timeout, not hang forever. The race is the
    // only thing standing between a hung model call and a frozen job.
    const env = { AI: { run: () => new Promise(() => { /* never settles */ }) } } as unknown as Env;
    const p = new WorkersAIProvider(env);
    const started = Date.now();
    await expect(p.complete({ system: "s", user: "u", maxTokens: 10, timeoutMs: 100 })).rejects.toMatchObject({ code: "AI_TIMEOUT" });
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
