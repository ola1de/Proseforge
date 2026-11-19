// Shared types for the Proseforge Worker.
export interface Env {
  AI?: { run: (model: string, input: unknown) => Promise<unknown> };
  DOCS_BUCKET?: unknown;
  DB?: { prepare: (sql: string) => { bind: (...args: unknown[]) => { run: () => Promise<unknown>; all: () => Promise<{ results?: Record<string, unknown>[] }>; first: () => Promise<Record<string, unknown> | null> } } };
  DOC_QUEUE?: unknown;
  AI_PROVIDER?: string;
  AI_MODEL?: string;
  AI_BASE_URL?: string;
  AI_API_KEY?: string;
  MAX_TEXT_CHARS?: string;
  DOC_MAX_BYTES?: string;
  RATE_LIMIT_PER_MINUTE?: string;
  AI_TIMEOUT_MS?: string;
  ALLOWED_ORIGINS?: string;
  ASSETS?: { fetch: (req: Request) => Promise<Response> };
}

export type Intensity = "light" | "balanced" | "thorough";
export type ProviderKind = "workers-ai" | "openai-compatible" | "none" | "mock"; // "mock" is test-only (Vitest); resolveProviderKind never returns it.

export interface RefineRequest {
  text: string;
  mode?: string;
  intensity?: Intensity;
  customVoice?: string;
  discipline?: string;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  setup?: string[];
}
