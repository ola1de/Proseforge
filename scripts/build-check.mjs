// Build check: verifies the public assets and worker entry exist and are non-empty.
// Real bundling is done by Wrangler at deploy time (`npx wrangler deploy`).
import { statSync, readdirSync } from "node:fs";
const required = ["src/index.ts", "public/index.html", "public/styles.css", "public/app.js", "wrangler.jsonc", "package.json"];
for (const f of required) {
  const s = statSync(new URL(`../${f}`, import.meta.url));
  if (s.size === 0) throw new Error(`Empty required file: ${f}`);
}
console.log(`build-check ok: ${readdirSync(new URL("../public", import.meta.url)).join(", ")} present; worker entry present.`);
