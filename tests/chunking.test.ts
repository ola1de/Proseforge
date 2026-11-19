import { describe, it, expect } from "vitest";
import { splitIntoChunks, countWords, terminologyNote, adaptiveMaxTokens } from "../src/chunking";

describe("chunking", () => {
  it("keeps paragraphs whole and preserves order", () => {
    const text = ["Para one is here.", "Para two follows it.", "Para three ends it."].join("\n\n");
    const chunks = splitIntoChunks(text, 5);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.text).join("\n\n")).toBe(text);
  });
  it("single short text is one chunk", () => {
    expect(splitIntoChunks("Hello world.", 1500)).toHaveLength(1);
  });
  it("default chunk size is 800 words (Milestone 7: smaller chunks time out less)", () => {
    // Two ~500-word paragraphs: over 800 together, so two chunks by default.
    const para = (m: string) => `${m} ` + "word ".repeat(500).trim();
    expect(splitIntoChunks(`${para("A")}\n\n${para("B")}`)).toHaveLength(2);
    // The same text fits in one chunk when the caller asks for a bigger cap.
    expect(splitIntoChunks(`${para("A")}\n\n${para("B")}`, 1500)).toHaveLength(1);
  });
  it("an explicit maxWords still works", () => {
    const text = ["Para one is here.", "Para two follows it.", "Para three ends it."].join("\n\n");
    expect(splitIntoChunks(text, 5).length).toBeGreaterThan(1);
    expect(splitIntoChunks(text, 100)).toHaveLength(1);
  });
  it("empty text yields no chunks", () => { expect(splitIntoChunks("   ")).toHaveLength(0); });
  it("overlap carries the previous paragraph for context", () => {
    const text = Array.from({ length: 6 }, (_, i) => `Paragraph number ${i} with several words in it here.`).join("\n\n");
    const chunks = splitIntoChunks(text, 10);
    expect(chunks[1]?.overlap).toContain("Paragraph number");
  });
  it("terminology note lists frequent content words", () => {
    const note = terminologyNote("governance governance governance policy policy administration");
    expect(note).toContain("governance");
  });
  it("countWords handles whitespace", () => {
    expect(countWords("  one   two\nthree ")).toBe(3);
    expect(countWords("")).toBe(0);
  });
});

describe("adaptiveMaxTokens", () => {
  it("floors at 768 for short inputs", () => {
    expect(adaptiveMaxTokens(0)).toBe(768);
    expect(adaptiveMaxTokens(10)).toBe(768);
    expect(adaptiveMaxTokens(384)).toBe(768);
  });
  it("scales at roughly twice the input words", () => {
    expect(adaptiveMaxTokens(400)).toBe(800);
    expect(adaptiveMaxTokens(1000)).toBe(2000);
  });
  it("caps at 4096 for long inputs", () => {
    expect(adaptiveMaxTokens(2048)).toBe(4096);
    expect(adaptiveMaxTokens(5000)).toBe(4096);
  });
});
