// TEST-ONLY fake AI provider for document tests. It deterministically
// prefixes refined text with "Refined: " so tests can prove the pipeline
// moved text through the engine and back into the document — it is NOT a
// real refinement and must never be presented as one.
import type { AIProvider } from "../../src/providers";

export const fakeRefineProvider: AIProvider = {
  name: "mock",
  complete: async ({ user }: { user: string }): Promise<string> => {
    const batch = /Return exactly (\d+) paragraph/.exec(user);
    if (batch) {
      const parts = user.split(/Paragraph \d+:\n/).slice(1);
      return parts.map((p) => `Refined: ${p.trim()}`).join("\n\n");
    }
    const marker = "Refine the following text:\n\n";
    const idx = user.indexOf(marker);
    if (idx >= 0) return `Refined: ${user.slice(idx + marker.length).trim()}`;
    return `Refined: ${user.trim()}`;
  },
};

/** Fake Workers AI binding shape for HTTP-level tests. */
export function fakeAIEnv(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    MAX_TEXT_CHARS: "100000",
    RATE_LIMIT_PER_MINUTE: "1000",
    AI: { run: async () => ({ response: "Refined test output." }) },
    ...extra,
  };
}
