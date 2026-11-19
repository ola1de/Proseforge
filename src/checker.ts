// AI Checker (Milestone 6). A built-in, local, deterministic indicator
// of whether writing reads as AI-generated or human — computed entirely
// from statistical signals in the text itself. No external service, no
// model call, no stored text.
//
// HONESTY: no detector is perfectly accurate, and this one is not a
// verdict. It is a transparent multi-signal indicator: the score is
// always shown with its band AND the per-signal breakdown that produced
// it, so the reader can see WHY. Short texts, edited text, and
// non-native English can all mislead it — below MIN_WORDS_FOR_VERDICT
// words the verdict is withheld ("Too short to judge reliably") while
// the signals are still shown.
//
// Signals and weights (fixed and documented — do not tune silently;
// the acceptance fixtures in tests/checker.test.ts pin the behaviour):
//   1. AI-tell phrase density ......... 35% — banned phrases per 1,000 words
//   2. Burstiness (sentence rhythm) ... 25% — variation in sentence length
//   3. Lexical diversity .............. 15% — type-token ratio vs length
//   4. Repetition ..................... 15% — repeated words + openers
//   5. Sentence shape .................  5% — very long, uniform sentences
//   6. Filler-transition density ......  5% — moreover/furthermore/etc.
// Each signal scores 0–100 (higher = more AI-like); the total is the
// weighted sum, rounded to a whole number.
import { analyseText, splitSentences, TRANSITIONS } from "./analysis";
import { countAiTellPhrases, normaliseForMatching } from "./ai-phrases";
import { countWords } from "./chunking";

export const MIN_WORDS_FOR_VERDICT = 100;
export const MAX_FLAGGED_SENTENCES = 10;

export type CheckerBand = "Reads human" | "Mixed signals" | "Reads AI-generated";

export interface CheckerSignal {
  id: string;
  label: string;
  value: string;
  score: number;
  weight: number;
  contribution: number;
  detail: string;
}

export interface CheckerResult {
  score: number;
  band: CheckerBand;
  label: string;
  tooShort: boolean;
  words: number;
  sentences: number;
  signals: CheckerSignal[];
  flaggedPhrases: { phrase: string; count: number }[];
  flaggedSentences: string[];
  note: string;
}

export const CHECKER_NOTE =
  "An indicator, not proof — short texts, edited text, and non-native English can all mislead it. Best on passages of 100+ words. Use it to judge whether a refinement still reads as AI, not as a verdict on who wrote a text.";

export function bandForScore(score: number): CheckerBand {
  if (score <= 30) return "Reads human";
  if (score <= 60) return "Mixed signals";
  return "Reads AI-generated";
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function sentenceLengths(text: string): number[] {
  return splitSentences(text).map((s) => s.split(/\s+/).filter(Boolean).length);
}

function repeatedOpeners(text: string): number {
  const seen = new Map<string, number>();
  for (const s of splitSentences(text)) {
    const words = normaliseForMatching(s).trim().split(" ").filter(Boolean);
    if (words.length < 2) continue;
    const opener = `${words[0]} ${words[1]}`;
    seen.set(opener, (seen.get(opener) ?? 0) + 1);
  }
  let groups = 0;
  for (const c of seen.values()) if (c >= 2) groups += 1;
  return groups;
}

export function checkText(text: string): CheckerResult {
  const trimmed = (text ?? "").trim();
  const words = countWords(trimmed);
  const a = analyseText(trimmed);
  const sentences = a.sentences;
  const flaggedPhrases = countAiTellPhrases(trimmed);
  const totalPhraseHits = flaggedPhrases.reduce((n, f) => n + f.count, 0);
  const signals: CheckerSignal[] = [];

  // 1. AI-tell phrase density (weight 0.35).
  const phraseDensity = words ? (totalPhraseHits / words) * 1000 : 0;
  const phraseScore = Math.min(100, Math.round(phraseDensity * 5));
  signals.push({
    id: "ai-tell-phrases",
    label: "AI-tell phrases",
    value: totalPhraseHits === 0 ? "none found" : `${totalPhraseHits} hit${totalPhraseHits === 1 ? "" : "s"} · ${round1(phraseDensity)} per 1,000 words`,
    score: phraseScore,
    weight: 0.35,
    contribution: round1(phraseScore * 0.35),
    detail: totalPhraseHits === 0
      ? "No banned AI-tell phrases found. Human writing rarely stacks phrases like “moreover”, “in conclusion”, or “in today's fast-paced world”."
      : `${totalPhraseHits} AI-tell phrase${totalPhraseHits === 1 ? "" : "s"} found. These phrases are rare in plain human writing but routine in model output.`,
  });

  // 2. Burstiness — coefficient of variation of sentence lengths (0.25).
  // Human writing mixes short and long sentences; model output is uniform.
  const lengths = sentenceLengths(trimmed);
  let burstScore = 50;
  let burstValue = "too few sentences to judge rhythm";
  let burstDetail = "Fewer than 3 sentences, so rhythm cannot be judged — treated as neutral.";
  if (lengths.length >= 3) {
    const mean = lengths.reduce((x, y) => x + y, 0) / lengths.length;
    const variance = lengths.reduce((x, l) => x + (l - mean) ** 2, 0) / lengths.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
    burstScore = clamp(Math.round(((0.55 - cv) / (0.55 - 0.15)) * 100), 0, 100);
    burstValue = `CV ${round1(cv)} · sentences ${lengths.join(", ")} words`;
    burstDetail = cv >= 0.55
      ? "Sentence lengths vary a lot — the uneven rhythm of a human writer."
      : cv <= 0.2
        ? "Sentence lengths are strikingly uniform — the even rhythm typical of model output."
        : "Sentence lengths vary moderately.";
  }
  signals.push({
    id: "burstiness",
    label: "Sentence rhythm (burstiness)",
    value: burstValue,
    score: burstScore,
    weight: 0.25,
    contribution: round1(burstScore * 0.25),
    detail: burstDetail,
  });

  // 3. Lexical diversity vs length (0.15). Type-token ratio falls as
  // texts get longer, so the expectation is length-adjusted; a text far
  // below its expected diversity is repeating a narrow vocabulary.
  const expectedTtr = clamp(0.92 - 0.0011 * words, 0.35, 0.92);
  const lexScore = clamp(Math.round((expectedTtr - a.lexicalDiversity) * 400), 0, 100);
  signals.push({
    id: "lexical-diversity",
    label: "Vocabulary diversity",
    value: `type-token ratio ${a.lexicalDiversity} (expected ≈ ${round1(expectedTtr)} for ${words} words)`,
    score: lexScore,
    weight: 0.15,
    contribution: round1(lexScore * 0.15),
    detail: a.lexicalDiversity >= expectedTtr
      ? "Vocabulary is varied for a text of this length."
      : "Vocabulary is narrower than expected for a text of this length — repeated words where a human writer would vary them.",
  });

  // 4. Repetition (0.15): words repeated 3+ times + repeated openers.
  const openerGroups = repeatedOpeners(trimmed);
  const repScore = Math.min(100, 30 * a.repeatedWords.length + 20 * openerGroups);
  signals.push({
    id: "repetition",
    label: "Repetition",
    value: a.repeatedWords.length === 0 && openerGroups === 0
      ? "no word repeated 3+ times, no repeated sentence openers"
      : [
          ...(a.repeatedWords.length ? [`${a.repeatedWords.map((r) => `${r.word} (×${r.count})`).join(", ")}`] : []),
          ...(openerGroups ? [`${openerGroups} repeated sentence opener${openerGroups === 1 ? "" : "s"}`] : []),
        ].join(" · "),
    score: repScore,
    weight: 0.15,
    contribution: round1(repScore * 0.15),
    detail: repScore === 0
      ? "No notable repetition."
      : "The same words and sentence starts recur — model output leans on a small set of stock phrasings.",
  });

  // 5. Sentence shape (0.05): very long average + many long sentences.
  const shapeScore = Math.min(
    100,
    (a.avgSentenceLength > 26 ? 70 : a.avgSentenceLength > 20 ? 40 : a.avgSentenceLength > 16 ? 20 : 0) +
      Math.round(a.longSentenceShare * 30),
  );
  signals.push({
    id: "sentence-shape",
    label: "Sentence shape",
    value: `avg ${a.avgSentenceLength} words/sentence · ${Math.round(a.longSentenceShare * 100)}% over 30 words`,
    score: shapeScore,
    weight: 0.05,
    contribution: round1(shapeScore * 0.05),
    detail: a.avgSentenceLength > 20
      ? "Sentences run long on average — long, uniform sentences are a common model habit."
      : "Sentence lengths are in the normal range.",
  });

  // 6. Filler-transition density (0.05): moreover/furthermore/in
  // conclusion/in addition and similar, per 1,000 words.
  const haystack = normaliseForMatching(trimmed);
  let transitionHits = 0;
  for (const t of TRANSITIONS) {
    const needle = ` ${normaliseForMatching(t).trim()} `;
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(needle, from);
      if (at === -1) break;
      transitionHits += 1;
      // Keep the trailing space (see countAiTellPhrases).
      from = at + needle.length - 1;
    }
  }
  const transitionDensity = words ? (transitionHits / words) * 1000 : 0;
  const transitionScore = Math.min(100, Math.round(transitionDensity * 2));
  signals.push({
    id: "filler-transitions",
    label: "Filler transitions",
    value: transitionHits === 0 ? "none found" : `${transitionHits} hit${transitionHits === 1 ? "" : "s"} · ${round1(transitionDensity)} per 1,000 words`,
    score: transitionScore,
    weight: 0.05,
    contribution: round1(transitionScore * 0.05),
    detail: transitionHits === 0
      ? "No filler transitions (moreover, furthermore, in conclusion…) found."
      : "Heavy use of formal filler transitions — a classic sign of text that was assembled rather than written.",
  });

  const score = Math.round(signals.reduce((n, s) => n + s.contribution, 0));
  const band = bandForScore(score);
  const tooShort = words < MIN_WORDS_FOR_VERDICT;
  // The score and band are still computed and shown for short texts —
  // the signals are real — but the VERDICT label is withheld: below
  // 100 words no detector can judge reliably.
  const label = tooShort ? "Too short to judge reliably" : band;

  // Sentences containing an AI-tell phrase, in original wording, capped.
  const flaggedSentences: string[] = [];
  if (flaggedPhrases.length) {
    for (const s of splitSentences(trimmed)) {
      const norm = normaliseForMatching(s);
      if (flaggedPhrases.some((f) => norm.includes(` ${normaliseForMatching(f.phrase).trim()} `))) {
        flaggedSentences.push(s.trim());
        if (flaggedSentences.length >= MAX_FLAGGED_SENTENCES) break;
      }
    }
  }

  return {
    score, band, label, tooShort, words, sentences, signals,
    flaggedPhrases, flaggedSentences, note: CHECKER_NOTE,
  };
}
