import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildAcademicPrompt, buildConstructPrompt, MEANING_PRESERVATION_INVARIANT, HUMAN_WRITING_RULES, ACADEMIC_SECTIONS } from "../src/prompts";
import { MODES, INTENSITIES } from "../src/modes";

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

  it("every system prompt (all modes x intensities) carries the human writing rules", () => {
    for (const m of MODES) {
      for (const i of INTENSITIES) {
        const p = buildSystemPrompt({ modeId: m.id, intensity: i.id as "light" | "balanced" | "thorough", discipline: "General" });
        // Minimal-change rule: good sentences must come back untouched.
        expect(p).toContain("return it UNCHANGED");
        // Banned AI-tell phrases are listed explicitly in the prompt.
        expect(p).toContain("NEVER use these AI-tell words and phrases");
        expect(p).toContain("at my fingertips");
        expect(p).toContain("in today's fast-paced world");
        // Plain-word rule: no fancy upgrades of simple words.
        expect(p).toContain("NEVER replace a simple word with a fancier one");
        // The meaning invariant is still there, verbatim.
        expect(p).toContain(MEANING_PRESERVATION_INVARIANT);
      }
    }
  });
  it("academic and construct prompts carry the human writing rules", () => {
    for (const section of Object.keys(ACADEMIC_SECTIONS)) {
      const p = buildAcademicPrompt(section, "Education");
      expect(p).toContain(HUMAN_WRITING_RULES);
      expect(p).toContain(MEANING_PRESERVATION_INVARIANT);
    }
    const c = buildConstructPrompt("Law");
    expect(c).toContain(HUMAN_WRITING_RULES);
    expect(c).toContain(MEANING_PRESERVATION_INVARIANT);
  });
  it("mode ids, labels, and descriptions are unchanged", () => {
    expect(MODES.map((m) => ({ id: m.id, label: m.label, description: m.description }))).toEqual([
      { id: "natural", label: "Natural & Fluent", description: "Improve naturalness without unnecessarily changing the original vocabulary." },
      { id: "academic", label: "Academic", description: "Refine scholarly writing while maintaining academic conventions." },
      { id: "advanced-academic", label: "Advanced Academic", description: "Sophisticated research writing, argumentation, terminology, and analytical expression." },
      { id: "professional", label: "Professional", description: "Business reports, corporate communication, and professional documents." },
      { id: "conversational", label: "Conversational", description: "Sound natural, relaxed, and engaging." },
      { id: "technical", label: "Technical", description: "Preserve technical accuracy while improving clarity." },
      { id: "concise", label: "Concise", description: "Eliminate unnecessary wording while retaining essential information." },
      { id: "expanded", label: "Expanded", description: "Develop incomplete explanations and improve paragraph depth without inventing facts." },
      { id: "formal", label: "Formal", description: "Polished and appropriately formal writing." },
      { id: "custom", label: "Custom Voice", description: "Describe your preferred writing style and the engine follows it." },
    ]);
  });
  it("balanced intensity fixes only what is weak; natural is minimal-edit", () => {
    const balanced = INTENSITIES.find((i) => i.id === "balanced")!;
    expect(balanced.instruction).toContain("leave the rest alone");
    expect(balanced.instruction).not.toContain("throughout");
    const natural = MODES.find((m) => m.id === "natural")!;
    expect(natural.instruction).toContain("Minimal-edit mode");
    const thorough = INTENSITIES.find((i) => i.id === "thorough")!;
    expect(thorough.instruction).toContain("stay within the author's voice");
  });
  it("system prompt no longer asks for 'sophisticated' prose", () => {
    const p = buildSystemPrompt({ modeId: "natural", intensity: "balanced" });
    expect(p).not.toContain("natural, sophisticated");
  });
});
