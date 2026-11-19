// Security headers, CORS, rate limiting, and input validation.
import type { Env } from "./types";

export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cache-Control": "no-store",
};

export function applySecurityHeaders(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (origin && allowed.includes(origin)) {
    return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Vary": "Origin" };
  }
  return {};
}

/** Small in-memory per-IP token bucket. Approximate at the edge (per isolate) — see 02-architecture.md §6. */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; resetAt: number }>();
  constructor(private perMinute: number) {}
  allow(key: string): boolean {
    const now = Date.now();
    const b = this.buckets.get(key) ?? { tokens: this.perMinute, resetAt: now + 60_000 };
    if (now > b.resetAt) { b.tokens = this.perMinute; b.resetAt = now + 60_000; }
    if (b.tokens <= 0) return false;
    b.tokens -= 1;
    this.buckets.set(key, b);
    return true;
  }
}

export function clientIp(req: Request): string {
  return req.headers.get("CF-Connecting-IP") ?? req.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ?? "unknown";
}

export function sanitiseFilename(name: string): string {
  return name.replace(/[\\/<>:"|?*\x00-\x1f]/g, "_").replace(/^\.+/, "").slice(0, 120) || "document";
}

/** Detect instruction-like spans in uploaded text (M2). Returns the spans; the caller flags them, never silently rewrites. */
export function findInjectionSpans(text: string): string[] {
  const patterns = [
    /ignore (all )?(previous|prior|above) instructions/gi,
    /disregard (all )?(previous|prior|above) instructions/gi,
    /you are now [a-z ]{0,40}(assistant|chatgpt|dan|jailbreak)/gi,
    /system prompt/gi,
  ];
  const found: string[] = [];
  for (const p of patterns) {
    for (const m of text.matchAll(p)) found.push(m[0]);
  }
  return [...new Set(found)];
}
