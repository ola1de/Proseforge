import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildAcademicPrompt, buildConstructPrompt, MEANING_PRESERVATION_INVARIANT, ACADEMIC_SECTIONS } from "../src/prompts";
import { MODES } from "../src/modes";

describe("prompt engineering", () => {
  it("every mode produces a distinct system prompt containing the invariant", () => {
    const prompts = MODES.map((m) => buildSystemPrompt({ modeId: m.id, intensity: "balanced", discipline: "Political Science" }));
    expect(new Set(prompts).size).toBe(MODES.length);
    for (const p of prompts) {
      expect(p).toContain("Do not invent facts");
      expect(p).toContain("Do not add citations");
      expect(p).toContain("Return only the refined text");
      expect(p).not.toMatch(/undetectable|evade (an? )?detector|bypass (an? )?detector/i);
    }
  });
  it("intensity changes the prompt", () => {
    const light = buildSystemPrompt({ modeId: "natural", intensity: "light" });
    const thorough = buildSystemPrompt({ modeId: "natural", intensity: "thorough" });
    expect(light).not.toBe(thorough);
    expect(light).toContain("Light");
    expect(thorough).toContain("Thorough");
  });
  it("custom voice is included only for the custom mode with a voice", () => {
    const p = buildSystemPrompt({ modeId: "custom", intensity: "balanced", customVoice: "Write like a newspaper editorial." });
    expect(p).toContain("Write like a newspaper editorial.");
  });
  it("discipline notes differ per discipline", () => {
    const pol = buildSystemPrompt({ modeId: "academic", intensity: "balanced", discipline: "Political Science" });
    const eng = buildSystemPrompt({ modeId: "academic", intensity: "balanced", discipline: "Engineering" });
    expect(pol).not.toBe(eng);
    expect(pol).toContain("Political Science");
  });
  it("academic prompts cover all 11 sections and carry the invariant", () => {
    expect(Object.keys(ACADEMIC_SECTIONS).length).toBe(11);
    for (const section of Object.keys(ACADEMIC_SECTIONS)) {
      const p = buildAcademicPrompt(section, "Education");
      expect(p).toContain(MEANING_PRESERVATION_INVARIANT.slice(0, 40));
      expect(p).toContain("do not invent a citation");
    }
  });
  it("unknown academic section throws", () => { expect(() => buildAcademicPrompt("nope")).toThrow(); });
  it("construct prompt demands exactly 3 numbered alternatives", () => {
    const p = buildConstructPrompt("Law");
    expect(p).toContain("exactly three alternative constructions");
    expect(p).toContain("1. <alternative one>");
  });
});
