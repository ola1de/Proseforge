// DOCX structural engine (Milestone 2).
// Strategy (see docs/01-discovery.md §5): a .docx is a ZIP of OOXML parts.
// We unzip, edit ONLY the `w:t` text nodes of eligible body paragraphs in
// `word/document.xml` *in place* (byte offsets — everything else in the
// file stays byte-identical), then re-zip. We never rebuild the document
// from extracted plain text: styles, numbering, headers/footers, footnotes,
// media, charts, tables, hyperlinks, TOC field codes, page/section breaks
// all survive untouched because we never touch their XML.
//
// Run-level protection: text inside field results (citations), hyperlinks,
// equations/objects, and footnote/endnote markers is never refined — the
// runs that carry them are left alone, and only the first *eligible* run
// of a refined paragraph receives the new text.

import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

export type DocxParaKind =
  | "title" | "heading" | "body" | "list"
  | "caption" | "toc" | "bibliography" | "protected" | "empty";

export interface DocxParagraph {
  index: number;
  kind: DocxParaKind;
  styleId: string;
  styleName: string;
  text: string;
  eligible: boolean;
  protectedReason?: string;
  section: string;
  sectionKind: string;
  level: number; // heading level (1-9) or 0
  /** Absolute [start, end) offsets of each w:t inner-text span in document.xml. */
  spans: { start: number; end: number; eligible: boolean }[];
}

export interface DocxChapter {
  level: number;
  title: string;
  paragraphIndex: number;
  kind: string;
}

export interface DocxAnalysis {
  paragraphs: DocxParagraph[];
  chapters: DocxChapter[];
  totalWords: number;
  eligibleWords: number;
  protectedCounts: Record<string, number>;
  entryNames: string[];
}

export interface DocxRefineResult {
  bytes: Uint8Array;
  refined: number;
  protected: number;
  skipped: number;
  validation: { valid: boolean; issues: string[] };
}

const XML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => XML_ESCAPES[c] as string);
}
export function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

/** styleId -> display name, from word/styles.xml (read-only parse; never re-serialised). */
export function parseStyleNames(stylesXml: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!stylesXml) return map;
  try {
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
    const doc = parser.parse(stylesXml) as Record<string, unknown>;
    const styles = (doc["w:styles"] as Record<string, unknown> | undefined)?.["w:style"];
    const list = Array.isArray(styles) ? styles : styles ? [styles] : [];
    for (const st of list as Record<string, unknown>[]) {
      const id = st["@_w:styleId"] as string | undefined;
      const nameNode = st["w:name"] as Record<string, unknown> | undefined;
      const name = nameNode?.["@_w:val"] as string | undefined;
      if (id && name) map.set(id, name);
    }
  } catch {
    // Styles unreadable: fall back to styleIds only. Never fatal.
  }
  return map;
}

interface TagEvent {
  kind: "w:t" | "m:t" | "hyperlink-open" | "hyperlink-close" | "fld-begin" | "fld-separate" | "fld-end" | "instr-open" | "instr-close" | "object" | "omath" | "tab" | "br" | "other";
  start: number;
  end: number;
  textStart?: number;
  textEnd?: number;
}

/** Scan one paragraph's inner XML in document order, tracking field/hyperlink state. */
function scanParagraph(inner: string, base: number): { events: TagEvent[]; hasEquation: boolean; hasTocField: boolean } {
  const events: TagEvent[] = [];
  let hasEquation = false;
  let hasTocField = false;
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<m:t(?:\s[^>]*)?>([\s\S]*?)<\/m:t>|<w:hyperlink(?:\s[^>]*)?>|<\/w:hyperlink>|<w:fldChar[^>]*>|<w:instrText(?:\s[^>]*)?>([\s\S]*?)<\/w:instrText>|<w:object(?:\s[^>]*)?>|<m:oMath(?:\s[^>]*)?>|<w:tab\s*\/>|<w:br\s*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner)) !== null) {
    const tok = m[0];
    const start = base + m.index;
    const end = start + tok.length;
    if (tok.startsWith("<w:t")) {
      const innerStart = start + tok.indexOf(">") + 1;
      const innerEnd = end - "</w:t>".length;
      events.push({ kind: "w:t", start, end, textStart: innerStart, textEnd: innerEnd });
    } else if (tok.startsWith("<m:t")) {
      // Math text: extracted so the paragraph reads completely, but its
      // span is never eligible (equations are protected as a whole).
      const innerStart = start + tok.indexOf(">") + 1;
      const innerEnd = end - "</m:t>".length;
      events.push({ kind: "m:t", start, end, textStart: innerStart, textEnd: innerEnd });
    } else if (tok.startsWith("<w:hyperlink")) events.push({ kind: "hyperlink-open", start, end });
    else if (tok === "</w:hyperlink>") events.push({ kind: "hyperlink-close", start, end });
    else if (tok.startsWith("<w:fldChar")) {
      const type = /w:fldCharType="(\w+)"/.exec(tok)?.[1];
      if (type === "begin") events.push({ kind: "fld-begin", start, end });
      else if (type === "separate") events.push({ kind: "fld-separate", start, end });
      else if (type === "end") events.push({ kind: "fld-end", start, end });
      else events.push({ kind: "other", start, end });
    } else if (tok.startsWith("<w:instrText")) {
      const body = m[3] ?? "";
      if (/\bTOC\b/.test(body)) hasTocField = true;
      events.push({ kind: "instr-open", start, end });
      events.push({ kind: "instr-close", start, end });
    } else if (tok.startsWith("<w:object")) { hasEquation = true; events.push({ kind: "object", start, end }); }
    else if (tok.startsWith("<m:oMath")) { hasEquation = true; events.push({ kind: "omath", start, end }); }
    else if (tok.startsWith("<w:tab")) events.push({ kind: "tab", start, end });
    else if (tok.startsWith("<w:br")) events.push({ kind: "br", start, end });
  }
  return { events, hasEquation, hasTocField };
}

/** [start, end) ranges of every <w:tbl>…</w:tbl> region (nested tables counted). */
function tableRanges(xml: string): [number, number][] {
  const ranges: [number, number][] = [];
  const re = /<w:tbl(?:\s[^>]*)?>|<\/w:tbl>/g;
  let depth = 0;
  let start = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (m[0].startsWith("</")) {
      depth--;
      if (depth === 0 && start >= 0) { ranges.push([start, m.index + m[0].length]); start = -1; }
    } else {
      if (depth === 0) start = m.index;
      depth++;
    }
  }
  return ranges;
}

function sectionKindFor(heading: string): string {
  const h = heading.trim().toLowerCase();
  if (/^abstract/.test(h)) return "abstract";
  if (/^(references|bibliography|works cited)/.test(h)) return "references";
  if (/^appendix/.test(h) || /^appendices/.test(h)) return "appendix";
  if (/questionnaire/.test(h)) return "questionnaire";
  if (/acknowledg/.test(h)) return "acknowledgements";
  if (/dedication/.test(h)) return "dedication";
  if (/table of contents/.test(h)) return "toc";
  if (/list of (tables|figures)/.test(h)) return "list";
  return "body";
}

export interface LoadedDocx {
  zip: JSZip;
  documentXml: string;
  entryNames: string[];
  paragraphs: DocxParagraph[];
  chapters: DocxChapter[];
  totalWords: number;
  eligibleWords: number;
  protectedCounts: Record<string, number>;
}

function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export async function loadDocx(bytes: Uint8Array): Promise<LoadedDocx> {
  const zip = await JSZip.loadAsync(bytes);
  const entryNames = Object.keys(zip.files);
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("Not a Word document: word/document.xml is missing.");
  const documentXml = await docFile.async("string");
  const stylesFile = zip.file("word/styles.xml");
  const styleNames = parseStyleNames(stylesFile ? await stylesFile.async("string") : "");
  const tblRanges = tableRanges(documentXml);

  const paragraphs: DocxParagraph[] = [];
  const chapters: DocxChapter[] = [];
  const protectedCounts: Record<string, number> = {};
  const bump = (reason: string) => { protectedCounts[reason] = (protectedCounts[reason] ?? 0) + 1; };

  let currentSection = "";
  let currentSectionKind = "front-matter";
  let totalWords = 0;
  let eligibleWords = 0;

  // Paragraphs do not nest: a linear scan for <w:p …>…</w:p> is exact.
  const pRe = /<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g;
  let m: RegExpExecArray | null;
  let index = 0;
  while ((m = pRe.exec(documentXml)) !== null) {
    const inner = m[1] as string;
    const pStart = m.index;
    const innerBase = pStart + m[0].indexOf(">") + 1;

    const pPr = /<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(inner)?.[1] ?? "";
    const styleId = /<w:pStyle\s+w:val="([^"]*)"/.exec(pPr)?.[1] ?? "";
    const styleName = (styleId && styleNames.get(styleId)) || styleId || "Normal";
    const styleLower = styleName.toLowerCase();
    const hasNumPr = /<w:numPr[\s>]/.test(pPr);
    const outlineLvl = Number(/<w:outlineLvl\s+w:val="(\d+)"/.exec(pPr)?.[1] ?? NaN);
    const inTable = tblRanges.some(([s, e]) => pStart >= s && pStart < e);

    const { events, hasEquation, hasTocField } = scanParagraph(inner, innerBase);

    // Walk events in order: build text, span list, and per-span protection.
    let hyperlinkDepth = 0;
    let fieldActive = false;
    let fieldResult = false;
    let inInstr = false;
    let text = "";
    const spans: DocxParagraph["spans"] = [];
    for (const ev of events) {
      switch (ev.kind) {
        case "hyperlink-open": hyperlinkDepth++; break;
        case "hyperlink-close": hyperlinkDepth = Math.max(0, hyperlinkDepth - 1); break;
        case "fld-begin": fieldActive = true; fieldResult = false; break;
        case "fld-separate": fieldResult = true; break;
        case "fld-end": fieldActive = false; fieldResult = false; break;
        case "instr-open": inInstr = true; break;
        case "instr-close": inInstr = false; break;
        case "tab": text += "\t"; break;
        case "br": text += "\n"; break;
        case "w:t": {
          const raw = documentXml.slice(ev.textStart as number, ev.textEnd as number);
          text += decodeXmlEntities(raw);
          const spanProtected = hyperlinkDepth > 0 || fieldActive || inInstr;
          spans.push({ start: ev.textStart as number, end: ev.textEnd as number, eligible: !spanProtected });
          break;
        }
        case "m:t": {
          // Equation text: readable in the paragraph, never refinable.
          const raw = documentXml.slice(ev.textStart as number, ev.textEnd as number);
          text += decodeXmlEntities(raw);
          spans.push({ start: ev.textStart as number, end: ev.textEnd as number, eligible: false });
          break;
        }
        default: break;
      }
    }
    const words = countWords(text);
    totalWords += words;

    // Classification.
    let kind: DocxParaKind = "body";
    let protectedReason: string | undefined;
    let level = 0;
    const headingMatch = /^heading\s+(\d)$/i.exec(styleName) ?? /^heading(\d)$/i.exec(styleId);
    if (!text.trim()) kind = "empty";
    else if (inTable) { kind = "protected"; protectedReason = "table cell"; }
    else if (hasEquation) { kind = "protected"; protectedReason = "equation or embedded object"; }
    else if (hasTocField || styleLower.startsWith("toc")) { kind = "toc"; protectedReason = "table of contents"; }
    else if (/^(title|subtitle)$/i.test(styleName)) kind = "title";
    else if (headingMatch) {
      kind = "heading";
      level = Number(headingMatch[1]);
    } else if (!Number.isNaN(outlineLvl) && outlineLvl <= 8) {
      kind = "heading";
      level = outlineLvl + 1;
    } else if (/^caption/i.test(styleName)) { kind = "caption"; protectedReason = "figure/table caption"; }
    else if (/^(bibliography|reference)/i.test(styleName)) { kind = "bibliography"; protectedReason = "bibliography entry"; }
    else if (currentSectionKind === "references") { kind = "bibliography"; protectedReason = "reference list"; }
    else if (currentSectionKind === "appendix" || currentSectionKind === "questionnaire") {
      kind = "protected"; protectedReason = currentSectionKind === "appendix" ? "appendix" : "research instrument (questionnaire)";
    } else if (hasNumPr) kind = "list";
    else kind = "body";

    if (kind === "heading") {
      currentSection = text.trim();
      currentSectionKind = sectionKindFor(currentSection);
      chapters.push({ level, title: currentSection, paragraphIndex: index, kind: currentSectionKind });
      if (currentSectionKind === "references" || currentSectionKind === "toc") {
        // Headings themselves are structure, never refined.
      }
    }

    const eligible = (kind === "body" || kind === "list") && spans.some((s) => s.eligible) && text.trim().length > 0;
    if (eligible) eligibleWords += words;
    if (protectedReason) bump(protectedReason);
    else if (kind === "heading" || kind === "title") bump("heading/title");
    else if (kind === "toc") bump("table of contents");
    else if (kind === "caption") bump("figure/table caption");
    else if (kind === "bibliography") bump("bibliography entry");

    paragraphs.push({
      index, kind, styleId, styleName, text,
      eligible, protectedReason, section: currentSection,
      sectionKind: currentSectionKind, level, spans,
    });
    index++;
  }

  return { zip, documentXml, entryNames, paragraphs, chapters, totalWords, eligibleWords, protectedCounts };
}

export function analyseDocx(bytes: Uint8Array): Promise<DocxAnalysis> {
  return loadDocx(bytes).then(({ paragraphs, chapters, totalWords, eligibleWords, protectedCounts, entryNames }) => ({
    paragraphs, chapters, totalWords, eligibleWords, protectedCounts, entryNames,
  }));
}

/**
 * Refine eligible paragraphs in place and re-zip.
 * `refine` receives the eligible paragraph texts in order and must return
 * the same number of refined texts in the same order.
 */
export async function refineDocx(
  bytes: Uint8Array,
  refine: (texts: string[]) => Promise<string[]>,
): Promise<DocxRefineResult> {
  const loaded = await loadDocx(bytes);
  const eligible = loaded.paragraphs.filter((p) => p.eligible);
  const refinedTexts = eligible.length ? await refine(eligible.map((p) => p.text)) : [];
  if (refinedTexts.length !== eligible.length) {
    throw new Error(`Refinement returned ${refinedTexts.length} paragraphs for ${eligible.length} eligible ones.`);
  }

  // Splice from the end so earlier offsets stay valid.
  let xml = loaded.documentXml;
  const edits: { start: number; end: number; replacement: string }[] = [];
  eligible.forEach((para, i) => {
    const refined = (refinedTexts[i] ?? "").trim();
    const targets = para.spans.filter((s) => s.eligible);
    targets.forEach((span, j) => {
      edits.push({ start: span.start, end: span.end, replacement: j === 0 ? escapeXml(refined) : "" });
    });
  });
  edits.sort((a, b) => b.start - a.start);
  for (const e of edits) xml = xml.slice(0, e.start) + e.replacement + xml.slice(e.end);

  const zip = loaded.zip;
  zip.file("word/document.xml", xml);
  const out = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });

  const validation = await validateDocxRoundTrip(bytes, out, loaded.paragraphs);
  const refined = eligible.length;
  const prot = loaded.paragraphs.filter((p) => p.protectedReason || p.kind === "heading" || p.kind === "title" || p.kind === "toc" || p.kind === "caption" || p.kind === "bibliography").length;
  const skipped = loaded.paragraphs.length - refined - prot;
  return { bytes: out, refined, protected: prot, skipped, validation };
}

/** Re-open the refined file and prove the structure survived. */
export async function validateDocxRoundTrip(
  originalBytes: Uint8Array,
  refinedBytes: Uint8Array,
  originalParas: DocxParagraph[],
): Promise<{ valid: boolean; issues: string[] }> {
  const issues: string[] = [];
  try {
    const zip = await JSZip.loadAsync(refinedBytes);
    const names = Object.keys(zip.files).sort();
    const origZip = await JSZip.loadAsync(originalBytes);
    const origNames = Object.keys(origZip.files).sort();
    if (JSON.stringify(names) !== JSON.stringify(origNames)) {
      issues.push(`ZIP entry list changed (was ${origNames.length} entries, now ${names.length}).`);
    }
    if (!zip.file("[Content_Types].xml")) issues.push("[Content_Types].xml is missing from the refined file.");
    const docFile = zip.file("word/document.xml");
    if (!docFile) { issues.push("word/document.xml is missing from the refined file."); return { valid: false, issues }; }
    const xml = await docFile.async("string");
    // Well-formedness spot check via the XML parser (read-only).
    try {
      new XMLParser({ ignoreAttributes: false }).parse(xml);
    } catch {
      issues.push("word/document.xml is not well-formed XML after refinement.");
    }
    const reloaded = await loadDocx(refinedBytes);
    if (reloaded.paragraphs.length !== originalParas.length) {
      issues.push(`Paragraph count changed (${originalParas.length} -> ${reloaded.paragraphs.length}).`);
    }
    // Every protected paragraph must be text-identical.
    originalParas.forEach((orig, i) => {
      if (!orig.protectedReason && orig.kind !== "heading" && orig.kind !== "title" && orig.kind !== "toc" && orig.kind !== "caption" && orig.kind !== "bibliography") return;
      const now = reloaded.paragraphs[i];
      if (!now) return;
      if (now.text !== orig.text) issues.push(`Protected paragraph ${i + 1} (${orig.kind}) changed during refinement.`);
    });
    // Headings must be identical (structure).
    originalParas.forEach((orig, i) => {
      if (orig.kind !== "heading") return;
      if (reloaded.paragraphs[i]?.text !== orig.text) issues.push(`Heading ${i + 1} changed during refinement.`);
    });
  } catch (e) {
    issues.push(`Refined file could not be re-opened: ${e instanceof Error ? e.message : "unknown error"}`);
  }
  return { valid: issues.length === 0, issues };
}
