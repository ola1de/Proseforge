import { describe, it, expect } from "vitest";
import { MODES, INTENSITIES, DISCIPLINES, findMode } from "../src/modes";

describe("modes", () => {
  it("has exactly the 10 required modes", () => {
    expect(MODES.map((m) => m.id)).toEqual(["natural", "academic", "advanced-academic", "professional", "conversational", "technical", "concise", "expanded", "formal", "custom"]);
  });
  it("has unique ids and non-empty instructions", () => {
    expect(new Set(MODES.map((m) => m.id)).size).toBe(MODES.length);
    for (const m of MODES) expect(m.instruction.length).toBeGreaterThan(20);
  });
  it("has 3 intensities", () => { expect(INTENSITIES.map((i) => i.id)).toEqual(["light", "balanced", "thorough"]); });
  it("covers all 16 disciplines from the brief", () => {
    for (const d of ["Social Sciences", "Political Science", "Public Administration", "Business Administration", "Management", "Economics", "Law", "Education", "Sociology", "Psychology", "Computer Science", "Engineering", "Information Technology", "Public Health", "Natural Sciences", "Humanities"]) {
      expect(DISCIPLINES).toContain(d);
    }
  });
  it("findMode returns undefined for unknown ids", () => { expect(findMode("nope")).toBeUndefined(); });
});
