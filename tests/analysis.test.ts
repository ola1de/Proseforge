import { describe, it, expect } from "vitest";
import { analyseText, flagUnsupportedClaims, countSyllables } from "../src/analysis";

describe("analysis (deterministic, hand-computed expectations)", () => {
  it("counts words, sentences, paragraphs on a known text", () => {
    const a = analyseText("The cat sat. The dog ran fast.\n\nA new paragraph begins here.");
    expect(a.words).toBe(12);
    expect(a.sentences).toBe(3);
    expect(a.paragraphs).toBe(2);
    expect(a.charactersNoSpaces).toBe("Thecatsat.Thedogranfast.Anewparagraphbeginshere.".length);
  });
  it("empty text yields zeros, not NaN", () => {
    const a = analyseText("   ");
    expect(a.words).toBe(0);
    expect(a.fleschReadingEase).toBe(0);
    expect(Number.isFinite(a.avgSentenceLength)).toBe(true);
  });
  it("lexical diversity is 1.0 for all-unique words", () => {
    const a = analyseText("Alpha beta gamma delta epsilon.");
    expect(a.lexicalDiversity).toBe(1);
  });
  it("flags repeated content words (3+ occurrences)", () => {
    const a = analyseText("Governance matters. Governance shapes policy. Governance requires accountability. Governance endures.");
    expect(a.repeatedWords.find((r) => r.word === "governance")?.count).toBe(4);
  });
  it("counts syllables for common words", () => {
    expect(countSyllables("cat")).toBe(1);
    expect(countSyllables("beautiful")).toBe(3);
  });
  it("flesch scores move in the expected direction", () => {
    const simple = analyseText("The cat sat on the mat. The dog ran. Birds sang.");
    const dense = analyseText("The institutionalisation of administrative accountability mechanisms necessitates comprehensive conceptualisation of bureaucratic rationalisation processes within governmental organisations.");
    expect(simple.fleschReadingEase).toBeGreaterThan(dense.fleschReadingEase);
  });
  it("flags unsupported claims but not cited ones", () => {
    const flagged = flagUnsupportedClaims("Studies show that turnout falls when trust declines. Research shows the opposite (Adeyemi, 2021).");
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toContain("Studies show");
  });
  it("tone labels contractions as conversational", () => {
    const a = analyseText("We don't think it's fair, and we can't accept it. It's not right.");
    expect(a.tone.label).toBe("Conversational");
  });
});
