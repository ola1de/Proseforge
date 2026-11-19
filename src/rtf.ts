// Minimal RTF reader/writer for Proseforge documents.
// RTF has no verified Workers-safe library (see docs/01-discovery.md §6),
// so this is a small hand-rolled parser for the common subset Word and
// LibreOffice emit: \par paragraph breaks, \b / \i runs, \'hh hex escapes,
// \uN Unicode escapes. It preserves bold/italic per run and paragraph
// breaks. It does NOT preserve fonts, colours, tables, images, headers or
// footers — that limitation is stated in the processing report and the UI,
// and the original file is always kept for download alongside the refined
// RTF. Never silently downgrade a document.
export interface RtfRun { text: string; bold: boolean; italic: boolean; }
export interface RtfParagraph { runs: RtfRun[]; }
export interface RtfDocument { paragraphs: RtfParagraph[]; }

export function parseRtf(input: string): RtfDocument {
  const paragraphs: RtfParagraph[] = [];
  let runs: RtfRun[] = [];
  let cur: RtfRun = { text: "", bold: false, italic: false };
  const flushRun = () => {
    if (cur.text) runs.push(cur);
    cur = { text: "", bold: cur.bold, italic: cur.italic };
  };
  const flushPara = () => {
    flushRun();
    paragraphs.push({ runs });
    runs = [];
    cur = { text: "", bold: false, italic: false };
  };
  let i = 0;
  let depth = 0;
  let skipGroup = false; // inside a destination group (fonttbl, colortbl, stylesheet, info, pict)
  let skipDepth = -1;
  const destWords = new Set(["fonttbl", "colortbl", "stylesheet", "info", "pict", "header", "footer", "footnote"]);
  while (i < input.length) {
    const ch = input[i] as string;
    if (ch === "{") {
      depth++;
      // Peek at the control word right after "{" to detect destinations.
      const m = /^\\([a-z]+)/.exec(input.slice(i + 1, i + 24));
      if (m && destWords.has(m[1] as string) && skipDepth === -1) { skipGroup = true; skipDepth = depth; }
      i++;
      continue;
    }
    if (ch === "}") {
      if (skipGroup && depth === skipDepth) { skipGroup = false; skipDepth = -1; }
      depth--;
      i++;
      continue;
    }
    if (skipGroup) { i++; continue; }
    if (ch === "\\") {
      const rest = input.slice(i);
      let m = /^\\'([0-9a-fA-F]{2})/.exec(rest);
      if (m) {
        const byte = parseInt(m[1] as string, 16);
        cur.text += String.fromCharCode(byte);
        i += m[0].length;
        continue;
      }
      m = /^\\u(-?\d+)\??/.exec(rest);
      if (m) {
        let code = parseInt(m[1] as string, 10);
        if (code < 0) code += 65536;
        cur.text += String.fromCharCode(code);
        i += m[0].length;
        continue;
      }
      m = /^\\([a-z]+)(-?\d+)?\s?/.exec(rest);
      if (m) {
        const word = m[1] as string;
        if (word === "par" || word === "line") { flushPara(); }
        else if (word === "b") { flushRun(); cur.bold = m[2] !== "0"; }
        else if (word === "i") { flushRun(); cur.italic = m[2] !== "0"; }
        else if (word === "tab") { cur.text += "\t"; }
        else if (word === "emdash") { cur.text += "—"; }
        else if (word === "endash") { cur.text += "–"; }
        else if (word === "ldblquote") { cur.text += "“"; }
        else if (word === "rdblquote") { cur.text += "”"; }
        // All other control words (fonts, sizes, margins…) are dropped:
        // this writer emits its own minimal formatting.
        i += m[0].length;
        continue;
      }
      if (rest[1] === "\\" || rest[1] === "{" || rest[1] === "}") { cur.text += rest[1]; i += 2; continue; }
      if (rest[1] === "\n" || rest[1] === "\r") { i += rest[1] === "\r" && rest[2] === "\n" ? 3 : 2; continue; }
      i++;
      continue;
    }
    if (ch === "\n" || ch === "\r") { i++; continue; }
    cur.text += ch;
    i++;
  }
  flushPara();
  // Drop trailing empty paragraphs produced by the final \par.
  while (paragraphs.length > 1 && paragraphs[paragraphs.length - 1]?.runs.every((r) => !r.text.trim())) {
    paragraphs.pop();
  }
  return { paragraphs };
}

function escapeRtfText(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) as number;
    if (ch === "\\") out += "\\\\";
    else if (ch === "{") out += "\\{";
    else if (ch === "}") out += "\\}";
    else if (code < 128) out += ch;
    else if (code <= 0xffff) out += `\\u${code}?`;
    else out += `\\u${code - 0x10000}?`;
  }
  return out;
}

export function writeRtf(doc: RtfDocument): string {
  const parts: string[] = ["{\\rtf1\\ansi\\deff0", "{\\fonttbl{\\f0\\fnil Calibri;}}", "\\viewkind4\\uc1\\pard\\f0\\fs22 "];
  for (const para of doc.paragraphs) {
    for (const run of para.runs) {
      if (!run.text) continue;
      let prefix = "";
      if (run.bold) prefix += "\\b ";
      if (run.italic) prefix += "\\i ";
      const suffix = (run.bold ? "\\b0 " : "") + (run.italic ? "\\i0 " : "");
      parts.push(prefix + escapeRtfText(run.text) + suffix);
    }
    parts.push("\\par\n");
  }
  parts.push("}");
  return parts.join("");
}

/** Plain text of an RTF document, one paragraph per line. */
export function rtfToText(doc: RtfDocument): string {
  return doc.paragraphs.map((p) => p.runs.map((r) => r.text).join("")).join("\n\n");
}

export const RTF_LIMITATION =
  "RTF output preserves paragraph breaks; each refined paragraph is written as a single run carrying the first run's formatting, so word-level bold/italic inside a refined paragraph is not preserved. Original fonts, colours, tables, images, headers, and footers are not carried into the refined RTF; the original file is kept unchanged and remains downloadable from the report.";
