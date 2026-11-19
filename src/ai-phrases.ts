// AI-tell phrases (Milestone 6). Single source of truth, shared by the
// prompt system (src/prompts.ts — the Milestone 5 HUMAN_WRITING_RULES
// block tells the model never to use these) and the AI Checker
// (src/checker.ts — which counts them). The two can never drift apart:
// add a phrase here and it is banned in prompts AND counted by the
// checker at the same time.
//
// The list is the exact Milestone 5 list. It is deliberately short and
// specific: these are phrases that are rare in plain human writing but
// routine in model output. Common words are NOT on the list — "in order
// to" is the plainest entry and it only counts as one hit among many.

export const AI_TELL_PHRASES: readonly string[] = [
  "moreover",
  "furthermore",
  "additionally",
  "in conclusion",
  "in today's fast-paced world",
  "it is important to note",
  "it is worth noting",
  "delve",
  "tapestry",
  "landscape",
  "crucial",
  "paramount",
  "at my fingertips",
  "a testament to",
  "in the realm of",
  "plays a crucial role",
  "shed light on",
  "a wide range of",
  "in order to",
];

// Phrases rendered with quotes in the prompt sentence (idioms and
// multi-word expressions), matching the Milestone 5 wording exactly.
const QUOTED_IN_PROMPT = new Set([
  "at my fingertips",
  "a testament to",
  "in the realm of",
  "plays a crucial role",
  "shed light on",
  "a wide range of",
  "in order to",
]);

/** Renders the banned-phrase sentence used in every system prompt.
 *  Kept byte-identical to the Milestone 5 wording — tests assert it. */
export function aiTellPhrasesSentence(): string {
  const rendered = AI_TELL_PHRASES.map((p) => {
    let out = QUOTED_IN_PROMPT.has(p) ? `"${p}"` : p;
    if (p === "in order to") out += ` (write "to" instead)`;
    return out;
  }).join(", ");
  return `NEVER use these AI-tell words and phrases: ${rendered}. Never add idioms, metaphors, or filler transitions the author did not write.`;
}

/** Normalise text for phrase matching: lowercase, non-alphanumerics
 *  become single spaces. The same normalisation is applied to the
 *  phrases, so "today's" and "fast-paced" match on both sides. */
export function normaliseForMatching(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

/** Count non-overlapping occurrences of each phrase in the text.
 *  Returns one entry per phrase that occurs at least once. */
export function countAiTellPhrases(text: string): { phrase: string; count: number }[] {
  const haystack = normaliseForMatching(text);
  const found: { phrase: string; count: number }[] = [];
  for (const phrase of AI_TELL_PHRASES) {
    const needle = normaliseForMatching(phrase).trim();
    if (!needle) continue;
    const padded = ` ${needle} `;
    let count = 0;
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(padded, from);
      if (at === -1) break;
      count += 1;
      // Advance past the phrase but keep its trailing space: it is the
      // leading space of a possible immediately following occurrence
      // ("moreover, moreover" has two hits sharing one space).
      from = at + padded.length - 1;
    }
    if (count > 0) found.push({ phrase, count });
  }
  return found;
}
