# Security Policy

## Reporting a vulnerability

Please report security issues privately through the repository's issue tracker using a private/security advisory, or by contacting the repository owner. Do not open a public issue with exploit details. We will acknowledge within 5 working days.

## What is in place (Milestone 1)

- Strict Content-Security-Policy, `X-Frame-Options: DENY`, `nosniff`, `no-referrer`, minimal Permissions-Policy on every response.
- Same-origin by default; CORS only for origins listed in `ALLOWED_ORIGINS`.
- Per-IP rate limiting on API routes; request-size limits (250 KB JSON bodies, 100,000 characters of text by default).
- Input validation on every endpoint (mode, intensity, discipline, section allowlists).
- No secrets in code or client-side JavaScript. AI keys are Cloudflare secrets only.
- No document content in logs or error responses; errors are generic.
- File validation (Milestone 2): MIME allowlist + magic-bytes check, 10 MB cap, filename sanitisation, `.docm` rejected.
- Prompt-injection guardrails: uploaded document text is passed as data, never as instructions; suspicious spans are flagged, never silently executed.

## Known limitations

- In-memory rate limiting is per-isolate and approximate at the edge; a Durable-Object-backed limiter is the documented upgrade if abuse is observed.
- The AI provider is instructed not to retain or train on inputs; that is a request to the provider, not something Proseforge can technically enforce.
