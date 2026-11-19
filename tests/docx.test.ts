// DOCX structural engine tests (Milestone 2).
// Proves, on a real multi-chapter sample DOCX: structure detection,
// protection of tables/citations/footnotes/equations/captions/bibliography/
// appendices, run-joining, and byte-level preservation of everything else.
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { analyseDocx, loadDocx, refineDocx } from "../src/docx";
import { refineParagraphTexts } from "../src/documents";
import { buildSystemPrompt } from "../src/prompts";
import {
  buildSampleDocx, SAMPLE_ABSTRACT,
} from "./fixtures/sample-docx";
import { fakeRefineProvider } from "./fixtures/fake-provider";

describe("DOCX analysis", () => {
  it("detects chapters, headings, and structure", async () => {
    const bytes = await buildSampleDocx();
    const analysis = await analyseDocx(bytes);
    const headings = analysis.paragraphs.filter((p) => p.kind === "heading");
    expect(headings.map((p) => p.text)).toContain("Chapter One: Introduction");
    expect(headings.map((p) => p.text)).toContain("Chapter Two: Literature Review");
    expect(headings.map((p) => p.text)).toContain("References");
    expect(headings.map((p) => p.text)).toContain("Appendix A: Questionnaire");
    expect(analysis.chapters.length).toBeGreaterThanOrEqual(5);
    expect(analysis.paragraphs.find((p) => p.kind === "title")?.text).toContain("Digital Governance");
  });

  it("protects tables, citations, equations, captions, bibliography, appendices", async () => {
    const bytes = await buildSampleDocx();
    const analysis = await analyseDocx(bytes);
    const byText = (t: string) => analysis.paragraphs.find((p) => p.text.includes(t));
    expect(byText("Merged header cell")?.eligible).toBe(false);
    expect(byText("Merged header cell")?.protectedReason).toBe("table cell");
    expect(byText("78 percent satisfaction")?.eligible).toBe(false);
    expect(byText("Table 1: Citizen satisfaction")?.kind).toBe("caption");
    expect(byText("Adeyemi, T. (2021)")?.kind).toBe("bibliography");
    expect(byText("How often do you use the government service portal")?.eligible).toBe(false);
    expect(byText("y = a + bx")?.eligible).toBe(false);
    // The citation paragraph keeps its visible citation text protected…
    const cite = analysis.paragraphs.find((p) => p.text.includes("(Adeyemi, 2021)"));
    expect(cite).toBeDefined();
    expect(cite?.spans.some((s) => !s.eligible)).toBe(true);
    // …but the paragraph is still refinable (its non-citation runs are eligible).
    expect(cite?.eligible).toBe(true);
    // Hyperlink text is protected…
    const link = analysis.paragraphs.find((p) => p.text.includes("National Bureau of Statistics portal"));
    expect(link?.spans.some((s) => !s.eligible)).toBe(true);
    // …and the run-split paragraph is joined into one text.
    const split = analysis.paragraphs.find((p) => p.text.includes("deliberately split"));
    expect(split?.text).toContain("This paragraph is deliberately split across several runs");
    expect(split?.eligible).toBe(true);
    expect(analysis.protectedCounts["table cell"]).toBeGreaterThanOrEqual(2);
  });

  it("counts eligible body text and lists list items as eligible", async () => {
    const bytes = await buildSampleDocx();
    const analysis = await analyseDocx(bytes);
    expect(analysis.eligibleWords).toBeGreaterThan(50);
    expect(analysis.paragraphs.filter((p) => p.kind === "list" && p.eligible).length).toBe(2);
    expect(analysis.paragraphs.filter((p) => p.eligible).length).toBeGreaterThanOrEqual(8);
  });
});

describe("DOCX refinement round-trip", () => {
  it("refines only eligible paragraphs and keeps everything else byte-identical in meaning", async () => {
    const original = await buildSampleDocx();
    const before = await analyseDocx(original);
    const result = await refineDocx(original, (texts) => refineViaFake(texts));
    expect(result.validation.valid).toBe(true);
    expect(result.validation.issues).toEqual([]);
    expect(result.refined).toBe(before.paragraphs.filter((p) => p.eligible).length);

    const after = await analyseDocx(result.bytes);
    expect(after.paragraphs.length).toBe(before.paragraphs.length);
    // Eligible paragraphs changed (fake provider prefixes "Refined: ").
    const afterBody1 = after.paragraphs.find((p) => p.text.includes("Digital governance has changed"));
    expect(afterBody1?.text.startsWith("Refined:")).toBe(true);
    // Split-run paragraph was refined into a single run.
    const afterSplit = after.paragraphs.find((p) => p.text.includes("deliberately split"));
    expect(afterSplit?.text.startsWith("Refined:")).toBe(true);
    // Protected content is text-identical.
    expect(after.paragraphs.find((p) => p.text.includes("Merged header cell"))?.text)
      .toBe(before.paragraphs.find((p) => p.text.includes("Merged header cell"))?.text);
    expect(after.paragraphs.find((p) => p.text.includes("(Adeyemi, 2021)"))?.text)
      .toContain("(Adeyemi, 2021)");
    expect(after.paragraphs.find((p) => p.text.includes("Adeyemi, T. (2021)"))?.text)
      .toBe(before.paragraphs.find((p) => p.text.includes("Adeyemi, T. (2021)"))?.text);
    expect(after.paragraphs.find((p) => p.text.includes("How often do you use"))?.text)
      .toBe(before.paragraphs.find((p) => p.text.includes("How often do you use"))?.text);
    expect(after.paragraphs.find((p) => p.text.includes("Table 1:"))?.text)
      .toBe(before.paragraphs.find((p) => p.text.includes("Table 1:"))?.text);
    // Headings identical.
    for (const h of before.paragraphs.filter((p) => p.kind === "heading")) {
      expect(after.paragraphs[h.index]?.text).toBe(h.text);
    }
    // Abstract refined, title untouched.
    expect(after.paragraphs.find((p) => p.text.includes(SAMPLE_ABSTRACT.slice(0, 20)))?.text.startsWith("Refined:")).toBe(true);
    expect(after.paragraphs.find((p) => p.kind === "title")?.text)
      .toBe(before.paragraphs.find((p) => p.kind === "title")?.text);

    // Untouched parts are byte-identical in the ZIP.
    const zipBefore = await JSZip.loadAsync(original);
    const zipAfter = await JSZip.loadAsync(result.bytes);
    expect(Object.keys(zipAfter.files).sort()).toEqual(Object.keys(zipBefore.files).sort());
    for (const name of ["word/styles.xml", "word/numbering.xml", "word/header1.xml", "word/footer1.xml", "word/footnotes.xml", "word/media/image1.png", "[Content_Types].xml", "word/_rels/document.xml.rels"]) {
      const a = await zipBefore.file(name)?.async("uint8array");
      const b = await zipAfter.file(name)?.async("uint8array");
      expect(b).toEqual(a);
    }
    // Footnote text survives untouched.
    const footnotes = await zipAfter.file("word/footnotes.xml")?.async("string");
    expect(footnotes).toContain("Footnote text that must never be refined or moved.");
  });

  it("rejects a non-DOCX file and a truncated DOCX", async () => {
    await expect(loadDocx(new TextEncoder().encode("not a zip at all"))).rejects.toThrow();
    const good = await buildSampleDocx();
    await expect(loadDocx(good.slice(0, 100))).rejects.toThrow();
  });
});

async function refineViaFake(texts: string[]): Promise<string[]> {
  // Route through the same batch helper the pipeline uses.
  return refineParagraphTexts(fakeRefineProvider, buildSystemPrompt({ modeId: "academic", intensity: "balanced" }), texts, 5000);
}
