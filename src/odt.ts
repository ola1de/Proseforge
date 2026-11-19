// ODT structural engine (Milestone 2).
// Same preservation strategy as the DOCX engine: an .odt is a ZIP of XML.
// We edit only the text chunks of eligible paragraphs in content.xml in
// place (offsets — all tags, styles, tables, images and metadata stay
// byte-identical) and re-zip. We never rebuild the document from plain
// text. Text inside footnotes (<text:note>), hyperlinks (<text:a>) and
// tables is never refined. RTF has no equivalent structure, so it lives
// in src/rtf.ts; PDF text extraction lives in src/pdf.ts.

import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

export type OdtParaKind = "title" | "heading" | "body" | "list" | "caption" | "toc" | "bibliography" | "protected" | "empty";

export interface OdtParagraph {
  index: number;
  kind: OdtParaKind;
  styleName: string;
  text: string;
  eligible: boolean;
  protectedReason?: string;
  section: string;
  sectionKind: string;
  level: number;
  /** Absolute [start, end) offsets of each text chunk in content.xml. */
  chunks: { start: number; end: number; eligible: boolean }[];
}

export interface OdtChapter { level: number; title: string; paragraphIndex: number; kind: string; }

export interface OdtAnalysis {
  paragraphs: OdtParagraph[];
  chapters: OdtChapter[];
  totalWords: number;
  eligibleWords: number;
  protectedCounts: Record<string, number>;
  entryNames: string[];
}

export interface OdtRefineResult {
  bytes: Uint8Array;
  refined: number;
  protected: number;
  skipped: number;
  validation: { valid: boolean; issues: string[] };
}

export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c] as string));
}
export function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/** style:name -> display name, from content.xml automatic + named styles (read-only). */
export function parseOdtStyleNames(contentXml: string): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
    const doc = parser.parse(contentXml) as Record<string, unknown>;
    const office = doc["office:document-content"] as Record<string, unknown> | undefined;
    const collect = (node: unknown) => {
      if (!node) return;
      const list = Array.isArray(node) ? node : [node];
      for (const st of list as Record<string, unknown>[]) {
        const name = st["@_style:name"] as string | undefined;
        const display = st["@_style:display-name"] as string | undefined;
        if (name) map.set(name, display ?? name);
      }
    };
    collect((office?.["office:styles"] as Record<string, unknown> | undefined)?.["style:style"]);
    collect((office?.["office:automatic-styles"] as Record<string, unknown> | undefined)?.["style:style"]);
  } catch {
    // Fall back to raw style names. Never fatal.
  }
  return map;
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

/** [start, end) ranges of <table:table>…</table:table> regions. */
function tableRanges(xml: string): [number, number][] {
  const ranges: [number, number][] = [];
  const re = /<table:table(?:\s[^>]*)?>|<\/table:table>/g;
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

export interface LoadedOdt {
  zip: JSZip;
  contentXml: string;
  entryNames: string[];
  paragraphs: OdtParagraph[];
  chapters: OdtChapter[];
  totalWords: number;
  eligibleWords: number;
  protectedCounts: Record<string, number>;
}

export async function loadOdt(bytes: Uint8Array): Promise<LoadedOdt> {
  const zip = await JSZip.loadAsync(bytes);
  const entryNames = Object.keys(zip.files);
  const contentFile = zip.file("content.xml");
  if (!contentFile) throw new Error("Not an OpenDocument text file: content.xml is missing.");
  const contentXml = await contentFile.async("string");
  const styleNames = parseOdtStyleNames(contentXml);
  const tblRanges = tableRanges(contentXml);

  const paragraphs: OdtParagraph[] = [];
  const chapters: OdtChapter[] = [];
  const protectedCounts: Record<string, number> = {};
  const bump = (reason: string) => { protectedCounts[reason] = (protectedCounts[reason] ?? 0) + 1; };

  let currentSection = "";
  let currentSectionKind = "front-matter";
  let totalWords = 0;
  let eligibleWords = 0;

  // text:h = heading paragraph; text:p = body paragraph. Neither nests.
  const pRe = /<(text:[hp])(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  let index = 0;
  while ((m = pRe.exec(contentXml)) !== null) {
    const tag = m[1] as string;
    const inner = m[2] as string;
    const pStart = m.index;
    const innerBase = pStart + m[0].indexOf(">") + 1;
    const styleAttr = /text:style-name="([^"]*)"/.exec(m[0].slice(0, m[0].indexOf(">") + 1))?.[1] ?? "";
    const styleName = styleNames.get(styleAttr) || styleAttr || "Standard";
    const styleLower = styleName.toLowerCase();
    const inTable = tblRanges.some(([s, e]) => pStart >= s && pStart < e);

    // Split inner XML into tags and text chunks, tracking note/link depth.
    // text:s (space) and text:tab become whitespace in the extracted text.
    let text = "";
    const chunks: OdtParagraph["chunks"] = [];
    let noteDepth = 0;
    let linkDepth = 0;
    const tokRe = /<text:note(?:\s[^>]*)?>|<\/text:note>|<text:a(?:\s[^>]*)?>|<\/text:a>|<text:s(?:\s[^>]*)?(?:\/)?>|<text:tab\s*\/>|<[^>]+>|[^<]+/g;
    let t: RegExpExecArray | null;
    while ((t = tokRe.exec(inner)) !== null) {
      const tok = t[0];
      const tokStart = innerBase + t.index;
      if (tok.startsWith("<text:note")) noteDepth++;
      else if (tok === "</text:note>") noteDepth = Math.max(0, noteDepth - 1);
      else if (tok.startsWith("<text:a")) linkDepth++;
      else if (tok === "</text:a>") linkDepth = Math.max(0, linkDepth - 1);
      else if (tok.startsWith("<text:s")) text += " ";
      else if (tok.startsWith("<text:tab")) text += "\t";
      else if (tok.startsWith("<")) { /* other tags: spans, styles — preserved */ }
      else {
        text += decodeXmlEntities(tok);
        chunks.push({ start: tokStart, end: tokStart + tok.length, eligible: noteDepth === 0 && linkDepth === 0 });
      }
    }
    const words = countWords(text);
    totalWords += words;

    let kind: OdtParaKind = "body";
    let protectedReason: string | undefined;
    let level = 0;
    const headingMatch = /^heading\s+(\d)$/i.exec(styleName);
    if (!text.trim()) kind = "empty";
    else if (inTable) { kind = "protected"; protectedReason = "table cell"; }
    else if (tag === "text:h" || headingMatch) {
      kind = "heading";
      level = headingMatch ? Number(headingMatch[1]) : Number(/text:outline-level="(\d)"/.exec(m[0])?.[1] ?? 1);
    } else if (/^title$/i.test(styleName) || /^subtitle$/i.test(styleName)) kind = "title";
    else if (/^caption/i.test(styleName)) { kind = "caption"; protectedReason = "figure/table caption"; }
    else if (/contents/i.test(styleName) || /table of contents/i.test(text)) { kind = "toc"; protectedReason = "table of contents"; }
    else if (/^(bibliography|reference)/i.test(styleName)) { kind = "bibliography"; protectedReason = "bibliography entry"; }
    else if (currentSectionKind === "references") { kind = "bibliography"; protectedReason = "reference list"; }
    else if (currentSectionKind === "appendix" || currentSectionKind === "questionnaire") {
      kind = "protected"; protectedReason = currentSectionKind === "appendix" ? "appendix" : "research instrument (questionnaire)";
    } else if (/<text:list(?:\s[^>]*)?>[^]*$/.test(contentXml.slice(0, pStart)) && isInList(contentXml, pStart)) kind = "list";
    else kind = "body";

    if (kind === "heading") {
      currentSection = text.trim();
      currentSectionKind = sectionKindFor(currentSection);
      chapters.push({ level, title: currentSection, paragraphIndex: index, kind: currentSectionKind });
    }

    const eligible = (kind === "body" || kind === "list") && chunks.some((c) => c.eligible) && text.trim().length > 0;
    if (eligible) eligibleWords += words;
    if (protectedReason) bump(protectedReason);
    else if (kind === "heading" || kind === "title") bump("heading/title");

    paragraphs.push({
      index, kind, styleName, text, eligible, protectedReason,
      section: currentSection, sectionKind: currentSectionKind, level, chunks,
    });
    index++;
  }

  return { zip, contentXml, entryNames, paragraphs, chapters, totalWords, eligibleWords, protectedCounts };
}

/** True when the paragraph at offset pStart sits inside an open <text:list>. */
function isInList(xml: string, pStart: number): boolean {
  const head = xml.slice(0, pStart);
  const opens = (head.match(/<text:list(?:\s[^>]*)?>/g) ?? []).length;
  const closes = (head.match(/<\/text:list>/g) ?? []).length;
  return opens > closes;
}

export function analyseOdt(bytes: Uint8Array): Promise<OdtAnalysis> {
  return loadOdt(bytes).then(({ paragraphs, chapters, totalWords, eligibleWords, protectedCounts, entryNames }) => ({
    paragraphs, chapters, totalWords, eligibleWords, protectedCounts, entryNames,
  }));
}

export async function refineOdt(
  bytes: Uint8Array,
  refine: (texts: string[]) => Promise<string[]>,
): Promise<OdtRefineResult> {
  const loaded = await loadOdt(bytes);
  const eligible = loaded.paragraphs.filter((p) => p.eligible);
  const refinedTexts = eligible.length ? await refine(eligible.map((p) => p.text)) : [];
  if (refinedTexts.length !== eligible.length) {
    throw new Error(`Refinement returned ${refinedTexts.length} paragraphs for ${eligible.length} eligible ones.`);
  }

  let xml = loaded.contentXml;
  const edits: { start: number; end: number; replacement: string }[] = [];
  eligible.forEach((para, i) => {
    const refined = (refinedTexts[i] ?? "").trim();
    const targets = para.chunks.filter((c) => c.eligible);
    targets.forEach((chunk, j) => {
      edits.push({ start: chunk.start, end: chunk.end, replacement: j === 0 ? escapeXml(refined) : "" });
    });
  });
  edits.sort((a, b) => b.start - a.start);
  for (const e of edits) xml = xml.slice(0, e.start) + e.replacement + xml.slice(e.end);

  const zip = loaded.zip;
  zip.file("content.xml", xml);
  const out = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });

  const validation = await validateOdtRoundTrip(bytes, out, loaded.paragraphs);
  const refined = eligible.length;
  const prot = loaded.paragraphs.filter((p) => p.protectedReason || p.kind === "heading" || p.kind === "title" || p.kind === "toc" || p.kind === "caption" || p.kind === "bibliography").length;
  const skipped = loaded.paragraphs.length - refined - prot;
  return { bytes: out, refined, protected: prot, skipped, validation };
}

export async function validateOdtRoundTrip(
  originalBytes: Uint8Array,
  refinedBytes: Uint8Array,
  originalParas: OdtParagraph[],
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
    if (!zip.file("content.xml")) issues.push("content.xml is missing from the refined file.");
    else {
      try {
        new XMLParser({ ignoreAttributes: false }).parse(await zip.file("content.xml")!.async("string"));
      } catch {
        issues.push("content.xml is not well-formed XML after refinement.");
      }
    }
    const reloaded = await loadOdt(refinedBytes);
    if (reloaded.paragraphs.length !== originalParas.length) {
      issues.push(`Paragraph count changed (${originalParas.length} -> ${reloaded.paragraphs.length}).`);
    }
    originalParas.forEach((orig, i) => {
      if (!orig.protectedReason && orig.kind !== "heading" && orig.kind !== "title" && orig.kind !== "toc" && orig.kind !== "caption" && orig.kind !== "bibliography") return;
      if (reloaded.paragraphs[i]?.text !== orig.text) issues.push(`Protected paragraph ${i + 1} (${orig.kind}) changed during refinement.`);
    });
  } catch (e) {
    issues.push(`Refined file could not be re-opened: ${e instanceof Error ? e.message : "unknown error"}`);
  }
  return { valid: issues.length === 0, issues };
}
