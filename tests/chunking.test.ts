import { describe, it, expect } from "vitest";
import { splitIntoChunks, countWords, terminologyNote } from "../src/chunking";

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
