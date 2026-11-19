# Privacy Policy — Proseforge

Last updated: 19 November 2026. This policy describes what the code actually does.

## No account

Proseforge has no login, no mandatory email address, no user profiles, and no permanent identifiers.

## What is processed

- **Text you paste** is sent to the Proseforge Worker and then to the configured AI provider (Cloudflare Workers AI by default) solely to refine or analyse that text. It is processed in memory and **never stored** by Proseforge.
- **Documents you upload** (Milestone 2) are stored temporarily in private object storage under a random identifier — never under your filename, never at a public URL — and are accessible only through a short-lived token issued for your session.
- **Job metadata** (Milestone 2) is limited to an upload timestamp, file type, size, and processing status. Document content is never stored in the metadata database.

## What the AI provider receives

When you refine text, the provider receives the text you submitted plus the refinement instructions (mode, discipline, intensity). It receives no name, email, or account information, because Proseforge does not collect any.

## Retention — 48 hours

Uploaded documents and temporary processing files are **automatically deleted 48 hours after upload**, measured from the upload time, by a scheduled server-side cleanup job, with an object-storage lifecycle rule as a backstop. Deletion happens on the server whether or not you return. Text you paste is never retained at all.

## Security

HTTPS everywhere, strict security headers, upload validation, size limits, rate limiting, and no document content in logs or error messages.

## Contact

For privacy questions, use the repository's issue tracker.
