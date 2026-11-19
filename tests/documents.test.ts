// ODT, RTF, PDF, TXT, and upload-validation tests (Milestone 2).
import { describe, it, expect } from "vitest";
import { analyseOdt, refineOdt } from "../src/odt";
import { parseRtf, writeRtf, rtfToText } from "../src/rtf";
import { extractPdfText } from "../src/pdf";
import { detectFormat, validateUpload } from "../src/documents";
import { refineParagraphTexts } from "../src/documents";
import { buildSystemPrompt } from "../src/prompts";
import {
  buildSampleOdt, buildSamplePdf, buildScannedPdf, SAMPLE_BODY_1, SAMPLE_RTF,
} from "./fixtures/sample-docx";
import { fakeRefineProvider } from "./fixtures/fake-provider";

describe("ODT round-trip", () => {
  it("detects headings and protects table cells and references", async () => {
    const bytes = await buildSampleOdt();
    const analysis = await analyseOdt(bytes);
    expect(analysis.paragraphs.filter((p) => p.kind === "heading").map((p) => p.text))
      .toContain("Chapter One: Introduction");
    expect(analysis.paragraphs.find((p) => p.text.includes("Cell text"))?.eligible).toBe(false);
    expect(analysis.paragraphs.find((p) => p.text.includes("Adeyemi, T. (2021)"))?.kind).toBe("bibliography");
    expect(analysis.paragraphs.filter((p) => p.eligible).length).toBeGreaterThanOrEqual(2);
  });

  it("refines body paragraphs and keeps protected text identical", async () => {
    const original = await buildSampleOdt();
    const before = await analyseOdt(original);
    const result = await refineOdt(original, (texts) =>
      refineParagraphTexts(fakeRefineProvider, buildSystemPrompt({ modeId: "academic", intensity: "balanced" }), texts, 5000));
    expect(result.validation.valid).toBe(true);
    expect(result.validation.issues).toEqual([]);
    const after = await analyseOdt(result.bytes);
    expect(after.paragraphs.length).toBe(before.paragraphs.length);
    expect(after.paragraphs.find((p) => p.text.includes(SAMPLE_BODY_1.slice(0, 20)))?.text.startsWith("Refined:")).toBe(true);
    expect(after.paragraphs.find((p) => p.text.includes("Cell text"))?.text)
      .toBe(before.paragraphs.find((p) => p.text.includes("Cell text"))?.text);
    expect(after.paragraphs.find((p) => p.text.includes("Adeyemi, T. (2021)"))?.text)
      .toBe(before.paragraphs.find((p) => p.text.includes("Adeyemi, T. (2021)"))?.text);
    expect(after.paragraphs.find((p) => p.text.includes("ODT Sample Dissertation"))?.text)
      .toBe("ODT Sample Dissertation");
  });
});

describe("RTF round-trip", () => {
  it("parses bold/italic runs and writes them back", () => {
    const doc = parseRtf(SAMPLE_RTF);
    expect(doc.paragraphs.length).toBe(2);
    expect(doc.paragraphs[0]?.runs.some((r) => r.bold && r.text.includes("bold"))).toBe(true);
    expect(doc.paragraphs[0]?.runs.some((r) => r.italic && r.text.includes("italic"))).toBe(true);
    expect(rtfToText(doc)).toContain("This is a bold and italic plain paragraph for testing.");
    const out = writeRtf(doc);
    expect(out.startsWith("{\\rtf1")).toBe(true);
    const reparsed = parseRtf(out);
    expect(reparsed.paragraphs.length).toBe(2);
    expect(rtfToText(reparsed)).toContain("A second paragraph with strong wording to refine.");
  });
});

describe("PDF extraction", () => {
  it("extracts text from a text-layer PDF", async () => {
    const bytes = buildSamplePdf();
    const res = await extractPdfText(bytes);
    expect(res.scanned).toBe(false);
    expect(res.pageCount).toBe(1);
    expect(res.text).toContain("Digital governance has changed how citizens interact");
    expect(res.text).toContain("response times improved");
  });

  it("reports a scanned PDF as scanned, never as empty output", async () => {
    const bytes = buildScannedPdf();
    const res = await extractPdfText(bytes);
    expect(res.scanned).toBe(true);
    expect(res.text).toBe("");
  });
});

describe("upload validation", () => {
  it("accepts real formats by magic bytes, not extension alone", async () => {
    const docx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    expect(validateUpload("thesis.docx", docx, 20_000_000)).toEqual({ ok: true, format: "docx" });
    expect(detectFormat("thesis.docx", new TextEncoder().encode("hello world"))).toMatchObject({ error: expect.stringContaining("not a ZIP-based") });
    expect(detectFormat("paper.pdf", new TextEncoder().encode("hello"))).toMatchObject({ error: expect.stringContaining("PDF header") });
    expect(validateUpload("notes.txt", new TextEncoder().encode("plain text here"), 20_000_000)).toEqual({ ok: true, format: "txt" });
  });

  it("rejects macro files, legacy .doc, unknown types, and oversized files", () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    expect(validateUpload("evil.docm", zip, 20_000_000).ok).toBe(false);
    expect(validateUpload("old.doc", zip, 20_000_000).ok).toBe(false);
    expect(validateUpload("app.exe", new Uint8Array([0x4d, 0x5a]), 20_000_000).ok).toBe(false);
    expect(validateUpload("big.docx", new Uint8Array(11), 10).ok).toBe(false);
    expect(validateUpload("empty.docx", new Uint8Array(0), 20_000_000).ok).toBe(false);
  });

  it("rejects binary data masquerading as .txt", () => {
    const bin = new Uint8Array([104, 105, 0, 255, 254]);
    expect(validateUpload("fake.txt", bin, 20_000_000).ok).toBe(false);
  });
});
