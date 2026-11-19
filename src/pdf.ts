// Minimal, Workers-safe PDF text extraction.
// No pdf.js / unpdf dependency: those pull in a large bundle and unpredictable
// memory in a 128 MB isolate. This parser handles the common cases —
// uncompressed and FlateDecode streams with Tj / TJ text operators — which
// covers the text layer of ordinary Word/LaTeX-exported PDFs.
// It deliberately does NOT reconstruct layout: extraction yields text in
// stream order, not a faithful page layout. Scanned (image-only) PDFs have
// no text layer and are reported as such, never as empty output.
export interface PdfExtractResult {
  text: string;
  pageCount: number;
  scanned: boolean;
  streamsExamined: number;
}

const latin1 = (bytes: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] as number);
  return s;
};

/** Decode a PDF literal string body (contents between parentheses). */
export function decodePdfString(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i] as string;
    if (ch !== "\\") { out += ch; continue; }
    const n = raw[i + 1];
    if (n === undefined) break;
    if (n === "n") { out += "\n"; i++; }
    else if (n === "r") { out += "\r"; i++; }
    else if (n === "t") { out += "\t"; i++; }
    else if (n === "b") { out += "\b"; i++; }
    else if (n === "f") { out += "\f"; i++; }
    else if (n === "(" || n === ")" || n === "\\") { out += n; i++; }
    else if (n >= "0" && n <= "7") {
      // Octal escape, up to 3 digits.
      let oct = "";
      let j = i + 1;
      while (j < raw.length && oct.length < 3 && (raw[j] as string) >= "0" && (raw[j] as string) <= "7") { oct += raw[j]; j++; }
      out += String.fromCharCode(parseInt(oct, 8));
      i = j - 1;
    } else if (n === "\n") { i++; } // line continuation
    else if (n === "\r") { i += raw[i + 2] === "\n" ? 2 : 1; }
    else { out += n; i++; }
  }
  // UTF-16BE with BOM (common for metadata / some producers).
  if (out.charCodeAt(0) === 0xfe && out.charCodeAt(1) === 0xff) {
    let decoded = "";
    for (let i = 2; i + 1 < out.length; i += 2) decoded += String.fromCharCode((out.charCodeAt(i) << 8) | out.charCodeAt(i + 1));
    return decoded;
  }
  return out;
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

/** Extract Tj / TJ text from one content-stream's decoded text. */
export function extractTextFromContent(content: string): string {
  const parts: string[] = [];
  // (string) Tj
  const tjRe = /\((?:\\.|[^\\()])*\)\s*Tj/g;
  for (const m of content.matchAll(tjRe)) {
    const inner = m[0].slice(1, m[0].lastIndexOf(")"));
    parts.push(decodePdfString(inner));
  }
  // [(...) -123 (...) ...] TJ — elements are strings or kerning numbers.
  const tjArrayRe = /\[((?:[^\[\]]|\((?:\\.|[^\\()])*\))*)\]\s*TJ/g;
  for (const m of content.matchAll(tjArrayRe)) {
    const body = m[1] as string;
    const tokens = [...body.matchAll(/\((?:\\.|[^\\()])*\)|-?\d+(?:\.\d+)?/g)];
    let line = "";
    for (const t of tokens) {
      const tok = t[0];
      if (tok.startsWith("(")) line += decodePdfString(tok.slice(1, -1));
      else if (Number(tok) < -100) line += " "; // large negative kern = word gap
    }
    if (line) parts.push(line);
  }
  return parts.join(" ").replace(/[ \t]+/g, " ").trim();
}

export async function extractPdfText(bytes: Uint8Array): Promise<PdfExtractResult> {
  const raw = latin1(bytes);
  const pageCount = (raw.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  const texts: string[] = [];
  let streamsExamined = 0;
  for (const m of raw.matchAll(streamRe)) {
    streamsExamined++;
    // Group 1 is the stream body in the latin1 string (1 char = 1 byte).
    const body = (m[1] as string).replace(/\r?\n$/, "");
    const streamBytes = new Uint8Array(body.length);
    for (let i = 0; i < body.length; i++) streamBytes[i] = body.charCodeAt(i) & 0xff;
    const inflated = await inflate(streamBytes);
    const content = latin1(inflated ?? streamBytes);
    const text = extractTextFromContent(content);
    if (text) texts.push(text);
  }
  const text = texts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text, pageCount, scanned: text.length === 0, streamsExamined };
}
