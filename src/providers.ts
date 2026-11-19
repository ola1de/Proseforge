// Provider-independent AI adapter system.
// Workers AI is the default (no separate key needed on Cloudflare).
// OpenAI-compatible APIs are supported via env vars.
// The mock provider exists ONLY in tests/ and is never imported here.
import type { Env, ProviderKind } from "./types";

export interface AIProvider {
  name: ProviderKind;
  complete(opts: { system: string; user: string; maxTokens: number; timeoutMs: number }): Promise<string>;
}

export const PROVIDER_NOT_CONFIGURED_SETUP = [
  "No AI provider is configured for this Proseforge installation.",
  "On Cloudflare: deploy with the Workers AI binding (already declared in wrangler.jsonc) — no extra key is needed. Just set AI_MODEL if you want a different model.",
  "Optional fallback only: set AI_PROVIDER=openai-compatible with AI_BASE_URL and the AI_API_KEY secret (npx wrangler secret put AI_API_KEY). This is never required.",
  "See docs/DEPLOYMENT.md for the exact steps.",
];

export function resolveProviderKind(env: Env): ProviderKind {
  const explicit = (env.AI_PROVIDER ?? "").trim().toLowerCase();
  if (explicit === "openai-compatible") {
    return env.AI_BASE_URL && env.AI_API_KEY ? "openai-compatible" : "none";
  }
  if (explicit === "workers-ai" || explicit === "") {
    if (env.AI) return "workers-ai";
    if (env.AI_BASE_URL && env.AI_API_KEY) return "openai-compatible";
    return "none";
  }
  return "none";
}

export function getModel(env: Env): string {
  return (env.AI_MODEL ?? "").trim() || "@cf/meta/llama-3.1-8b-instruct-fp8";
}

function timeoutSignal(ms: number): { signal: AbortSignal; cancel: () => void } {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, cancel: () => clearTimeout(t) };
}

export class WorkersAIProvider implements AIProvider {
  name: ProviderKind = "workers-ai";
  constructor(private env: Env) {}
  async complete(opts: { system: string; user: string; maxTokens: number; timeoutMs: number }): Promise<string> {
    const ai = this.env.AI;
    if (!ai) throw Object.assign(new Error("Workers AI binding is not available"), { code: "PROVIDER_NOT_CONFIGURED" });
    const { signal, cancel } = timeoutSignal(opts.timeoutMs);
    try {
      // The binding call is network-bound; the timeout guards a hung model.
      // workerd ignores the signal for env.AI.run, so we race it ourselves.
      const result = await Promise.race([
        ai.run(getModel(this.env), {
          messages: [
            { role: "system", content: opts.system },
            { role: "user", content: opts.user },
          ],
          max_tokens: opts.maxTokens,
          // Steadier, more faithful output (matches the OpenAI-compatible
          // adapter). Without this the model drifts toward showier wording.
          temperature: 0.3,
        }) as Promise<unknown>,
        new Promise<never>((_, reject) => {
          signal.addEventListener("abort", () => reject(Object.assign(new Error("AI request timed out"), { code: "AI_TIMEOUT" })), { once: true });
        }),
      ]);
      const text = extractWorkersAIText(result);
      if (!text.trim()) throw Object.assign(new Error("AI provider returned an empty response"), { code: "AI_EMPTY" });
      return text.trim();
    } catch (e) {
      // Local `wrangler dev` cannot reach Workers AI without a remote session
      // (no login here): surface that as "not configured" with setup guidance
      // rather than a generic 502, so the UI can explain what to do.
      const msg = e instanceof Error ? e.message : "";
      if (/not supported|unauthori|authentication|remote/i.test(msg) && (e as { code?: string }).code !== "AI_TIMEOUT") {
        throw Object.assign(new Error("Workers AI is not reachable from this environment. Deploy to Cloudflare, or run wrangler dev --remote while logged in."), { code: "PROVIDER_NOT_CONFIGURED" });
      }
      throw e;
    } finally { cancel(); }
  }
}

export function extractWorkersAIText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.response === "string") return r.response;
    if (typeof r.result === "string") return r.result;
    // Chat-style shape: { choices: [{ message: { content } }] }
    const choices = r.choices as Array<{ message?: { content?: string } }> | undefined;
    if (Array.isArray(choices) && choices[0]?.message?.content) return choices[0].message.content;
  }
  return "";
}

export class OpenAICompatibleProvider implements AIProvider {
  name: ProviderKind = "openai-compatible";
  constructor(private env: Env) {}
  async complete(opts: { system: string; user: string; maxTokens: number; timeoutMs: number }): Promise<string> {
    const base = (this.env.AI_BASE_URL ?? "").replace(/\/+$/, "");
    const { signal, cancel } = timeoutSignal(opts.timeoutMs);
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.env.AI_API_KEY ?? ""}` },
        body: JSON.stringify({
          model: getModel(this.env),
          messages: [
            { role: "system", content: opts.system },
            { role: "user", content: opts.user },
          ],
          max_tokens: opts.maxTokens,
          temperature: 0.3,
        }),
      });
      if (res.status === 429) throw Object.assign(new Error("AI provider rate limit reached. Please wait a moment and try again."), { code: "AI_RATE_LIMITED", status: 429 });
      if (!res.ok) throw Object.assign(new Error(`AI provider error (${res.status}). Please try again later.`), { code: "AI_PROVIDER_ERROR", status: 502 });
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = data.choices?.[0]?.message?.content ?? "";
      if (!text.trim()) throw Object.assign(new Error("AI provider returned an empty response"), { code: "AI_EMPTY" });
      return text.trim();
    } catch (err) {
      if (err instanceof Error && (err.name === "AbortError" || (err as { code?: string }).code === "AI_TIMEOUT")) {
        throw Object.assign(new Error("AI request timed out"), { code: "AI_TIMEOUT" });
      }
      throw err;
    } finally { cancel(); }
  }
}

export function resolveProvider(env: Env): AIProvider | null {
  const kind = resolveProviderKind(env);
  if (kind === "workers-ai") return new WorkersAIProvider(env);
  if (kind === "openai-compatible") return new OpenAICompatibleProvider(env);
  return null;
}
