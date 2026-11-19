// AI Checker tests (Milestone 6). The checker is local and
// deterministic — these tests pin its behaviour, including the two
// acceptance fixtures from the brief. If a fixture fails, TUNE THE
// WEIGHTS in src/checker.ts — do not weaken the fixtures.
import { describe, it, expect } from "vitest";
import { checkText, bandForScore, MIN_WORDS_FOR_VERDICT } from "../src/checker";
import { AI_TELL_PHRASES, aiTellPhrasesSentence, countAiTellPhrases } from "../src/ai-phrases";
import { buildSystemPrompt } from "../src/prompts";
import worker from "../src/index";
import type { Env } from "../src/types";

// The robotic sample shown on the homepage (public/app.js SAMPLE_ORIGINAL).
const ROBOTIC_SAMPLE = "In today's fast-paced world, it is very important to note that effective communication is very crucial for success. Moreover, it is a well-known fact that many people struggle with writing. This is due to the fact that writing is a very difficult task. In conclusion, it is important to improve writing skills in order to achieve success in today's world.";

// The plain human paragraph from the Milestone 5 brief.
const HUMAN_PARAGRAPH = "I've been trying to get this chapter done for weeks, but every time I sit down to write, something else comes up. The data is there. I know what I want to say. It's just hard to put it in order without it sounding like a list. My supervisor keeps telling me to be more direct, and she's right. I keep hiding behind long sentences when a short one would do.";

const noProviderEnv = { MAX_TEXT_CHARS: "100000", RATE_LIMIT_PER_MINUTE: "1000" } as unknown as Env;

function req(path: string, init?: RequestInit): Request {
  return new Request(`https://proseforge.test${path}`, init);
}
async function post(path: string, body: unknown, env: Env, ip = "10.0.0.1") {
  return worker.fetch(req(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }), env);
}

describe("AI-tell phrase list (shared by prompts and checker)", () => {
  it("contains the Milestone 5 phrases", () => {
    for (const p of ["moreover", "furthermore", "in conclusion", "in today's fast-paced world", "it is important to note", "delve", "tapestry", "crucial", "paramount", "at my fingertips", "a testament to", "in order to"]) {
      expect(AI_TELL_PHRASES).toContain(p);
    }
  });
  it("renders the prompt sentence byte-identically to Milestone 5", () => {
    expect(aiTellPhrasesSentence()).toBe(
      "NEVER use these AI-tell words and phrases: moreover, furthermore, additionally, in conclusion, in today's fast-paced world, it is important to note, it is worth noting, delve, tapestry, landscape, crucial, paramount, \"at my fingertips\", \"a testament to\", \"in the realm of\", \"plays a crucial role\", \"shed light on\", \"a wide range of\", \"in order to\" (write \"to\" instead). Never add idioms, metaphors, or filler transitions the author did not write.",
    );
    expect(buildSystemPrompt({ modeId: "natural", intensity: "balanced" })).toContain(aiTellPhrasesSentence());
  });
  it("counts occurrences case-insensitively, whole phrases only", () => {
    const found = countAiTellPhrases("Moreover, moreover! And in conclusion, moreover.");
    expect(found).toEqual([{ phrase: "moreover", count: 3 }, { phrase: "in conclusion", count: 1 }]);
    expect(countAiTellPhrases("The landscape painter delved into colour.")).toEqual([{ phrase: "landscape", count: 1 }]);
    // "delved" is not "delve" — only whole-word matches count.
  });
});

describe("checker bands", () => {
  it("maps scores to the three documented bands", () => {
    expect(bandForScore(0)).toBe("Reads human");
    expect(bandForScore(30)).toBe("Reads human");
    expect(bandForScore(31)).toBe("Mixed signals");
    expect(bandForScore(60)).toBe("Mixed signals");
    expect(bandForScore(61)).toBe("Reads AI-generated");
    expect(bandForScore(100)).toBe("Reads AI-generated");
  });
});

describe("acceptance fixtures", () => {
  it("the robotic sample scores in the 'Reads AI-generated' band (61+)", () => {
    const r = checkText(ROBOTIC_SAMPLE);
    expect(r.score).toBeGreaterThanOrEqual(61);
    expect(r.band).toBe("Reads AI-generated");
    expect(r.flaggedPhrases.length).toBeGreaterThan(0);
    expect(r.flaggedPhrases.map((f) => f.phrase)).toContain("moreover");
    expect(r.flaggedSentences.length).toBeGreaterThan(0);
    // Six signals, weights sum to 1.
    expect(r.signals).toHaveLength(6);
    expect(r.signals.reduce((n, s) => n + s.weight, 0)).toBeCloseTo(1, 5);
    expect(r.note).toContain("indicator, not proof");
  });
  it("the plain human paragraph scores in the 'Reads human' band (0–30)", () => {
    const r = checkText(HUMAN_PARAGRAPH);
    expect(r.score).toBeLessThanOrEqual(30);
    expect(r.band).toBe("Reads human");
    expect(r.flaggedPhrases).toEqual([]);
    expect(r.flaggedSentences).toEqual([]);
  });
  it("short text is labelled too short to judge reliably", () => {
    const r = checkText("Hello world, this is a short test of the checker.");
    expect(r.words).toBeLessThan(MIN_WORDS_FOR_VERDICT);
    expect(r.tooShort).toBe(true);
    expect(r.label).toBe("Too short to judge reliably");
    // The signals are still computed and shown — only the verdict is withheld.
    expect(r.signals).toHaveLength(6);
  });
  it("a longer human passage stays in the human band", () => {
    const text = [
      "I got up early on Tuesday because the bus leaves at half past six and I did not want to miss it again.",
      "The queue at the park was already long when I arrived, so I bought a bottle of water and waited under the small tree near the gate.",
      "My cousin called while I was still in line. She wanted to know if I had finished the form for her sister, and I told her I would do it that evening.",
      "By noon the sun was too strong to keep walking, so we stopped at a kiosk, shared a plate of rice, and talked about the new term.",
      "Nothing about the day was planned in advance. We just kept going until we were tired, then took the bus home.",
    ].join(" ");
    const r = checkText(text);
    expect(r.words).toBeGreaterThanOrEqual(MIN_WORDS_FOR_VERDICT);
    expect(r.tooShort).toBe(false);
    expect(r.label).toBe("Reads human");
    expect(r.score).toBeLessThanOrEqual(30);
  });
  it("a longer AI-style passage scores in the AI band", () => {
    const text = [
      "In today's fast-paced world, it is important to note that effective leadership is crucial for organisational success.",
      "Moreover, it is a well-known fact that many organisations struggle with change management, and furthermore, it is worth noting that this is due to the fact that leaders often lack a clear vision.",
      "In conclusion, it is important to note that organisations must embrace innovation in order to achieve sustainable growth, and in addition, they must leverage technology to stay competitive in the modern landscape.",
      "Furthermore, it is crucial to understand that a wide range of stakeholders plays a crucial role in shaping the future, and moreover, it is a testament to the power of collaboration that progress is possible.",
      "In today's fast-paced world, leaders must delve into data-driven decision making, and in conclusion, it is important to note that success depends on adaptability.",
    ].join(" ");
    const r = checkText(text);
    expect(r.words).toBeGreaterThanOrEqual(MIN_WORDS_FOR_VERDICT);
    expect(r.tooShort).toBe(false);
    expect(r.score).toBeGreaterThanOrEqual(61);
    expect(r.band).toBe("Reads AI-generated");
  });
});

describe("POST /api/check", () => {
  it("works with no AI provider configured (the checker is local)", async () => {
    const res = await post("/api/check", { text: HUMAN_PARAGRAPH }, noProviderEnv, "10.0.0.91");
    expect(res.status).toBe(200);
    const data = await res.json() as { score: number; band: string; signals: unknown[] };
    expect(data.band).toBe("Reads human");
    expect(data.signals).toHaveLength(6);
  });
  it("rejects empty text with 400 and overlong text with 413", async () => {
    expect((await post("/api/check", { text: "   " }, noProviderEnv, "10.0.0.92")).status).toBe(400);
    const env = { MAX_TEXT_CHARS: "10", RATE_LIMIT_PER_MINUTE: "1000" } as unknown as Env;
    expect((await post("/api/check", { text: "this text is far too long for a 10-char limit" }, env, "10.0.0.93")).status).toBe(413);
  });
  it("rejects malformed JSON with 400", async () => {
    const res = await post("/api/check", "{not json", noProviderEnv, "10.0.0.94");
    expect(res.status).toBe(400);
  });
});
