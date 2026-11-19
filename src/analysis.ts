// Deterministic, local writing analysis. These are transparent editorial
// indicators computed from the text itself — NOT scientifically validated
// scores, and the UI must label them as such.
export interface Analysis {
  words: number; characters: number; charactersNoSpaces: number;
  sentences: number; paragraphs: number;
  avgSentenceLength: number; sentenceLengthVariation: number;
  longSentenceShare: number; lexicalDiversity: number;
  fleschReadingEase: number; fleschKincaidGrade: number;
  readingTimeMinutes: number;
  repeatedWords: { word: string; count: number }[];
  fillerCount: number; transitionCoverage: number;
  tone: { contractions: number; formalWords: number; label: string };
}

const FILLERS = ["very", "really", "just", "actually", "basically", "literally", "in fact", "of course", "needless to say", "it is important to note", "as a matter of fact"];
export const TRANSITIONS = ["however", "therefore", "moreover", "furthermore", "consequently", "nevertheless", "in addition", "in contrast", "for example", "for instance", "in conclusion", "meanwhile", "similarly", "although", "despite", "thus", "hence", "accordingly"];
const FORMAL_WORDS = ["therefore", "furthermore", "moreover", "consequently", "notwithstanding", "henceforth", "utilise", "utilize", "demonstrate", "establish", "furthermore"];
const STOP = new Set("the a an and or of to in on for with is are was were be been it its this that these those as at by from not but we our their his her they he she you i am has have had will would can could should may might do does did".split(" "));

export function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}
export function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w.replace(/e$/, "").match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 1);
}

export function analyseText(text: string): Analysis {
  const trimmed = text.trim();
  const wordsArr = trimmed ? trimmed.split(/\s+/).filter(Boolean) : [];
  const words = wordsArr.length;
  const sentencesArr = splitSentences(trimmed);
  const sentences = sentencesArr.length;
  const paragraphs = trimmed ? trimmed.split(/\n\s*\n/).filter((p) => p.trim()).length : 0;
  const sentenceLengths = sentencesArr.map((s) => s.split(/\s+/).filter(Boolean).length);
  const avg = sentences ? sentenceLengths.reduce((a, b) => a + b, 0) / sentences : 0;
  const variance = sentences ? sentenceLengths.reduce((a, l) => a + (l - avg) ** 2, 0) / sentences : 0;
  const long = sentenceLengths.filter((l) => l > 30).length;
  const lower = wordsArr.map((w) => w.toLowerCase().replace(/[^a-z'-]/g, "")).filter(Boolean);
  const unique = new Set(lower);
  const lexicalDiversity = words ? Math.round((unique.size / words) * 1000) / 1000 : 0;
  const syllables = lower.reduce((a, w) => a + countSyllables(w), 0);
  const wordsPerSentence = sentences ? words / sentences : 0;
  const syllablesPerWord = words ? syllables / words : 0;
  const fleschReadingEase = words && sentences ? Math.round((206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord) * 10) / 10 : 0;
  const fleschKincaidGrade = words && sentences ? Math.round((0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59) * 10) / 10 : 0;
  const freq = new Map<string, number>();
  for (const w of lower) {
    if (w.length < 4 || STOP.has(w)) continue;
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  const repeatedWords = [...freq.entries()].filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([word, count]) => ({ word, count }));
  const lowText = ` ${trimmed.toLowerCase()} `;
  const fillerCount = FILLERS.reduce((n, f) => n + (lowText.split(f).length - 1), 0);
  const transitionsFound = TRANSITIONS.filter((t) => lowText.includes(` ${t} `) || lowText.includes(` ${t},`)).length;
  const transitionCoverage = paragraphs ? Math.round((transitionsFound / Math.max(paragraphs, 1)) * 100) / 100 : 0;
  const contractions = (trimmed.match(/\b\w+['’](re|ve|ll|d|t|s|m)\b/gi) ?? []).length;
  const formalWords = FORMAL_WORDS.reduce((n, f) => n + (lowText.split(f).length - 1), 0);
  const toneLabel = contractions > formalWords ? "Conversational" : formalWords > 0 ? "Formal" : "Neutral";
  return {
    words, characters: text.length, charactersNoSpaces: text.replace(/\s/g, "").length,
    sentences, paragraphs,
    avgSentenceLength: Math.round(avg * 10) / 10,
    sentenceLengthVariation: Math.round(Math.sqrt(variance) * 10) / 10,
    longSentenceShare: sentences ? Math.round((long / sentences) * 1000) / 1000 : 0,
    lexicalDiversity, fleschReadingEase, fleschKincaidGrade,
    readingTimeMinutes: Math.round((words / 200) * 10) / 10,
    repeatedWords, fillerCount, transitionCoverage,
    tone: { contractions, formalWords, label: toneLabel },
  };
}

/** Flags factual-looking claims that have no citation in the text, for verification — never invents a source. */
export function flagUnsupportedClaims(text: string): string[] {
  const flags: string[] = [];
  const sentences = splitSentences(text);
  const claimPattern = /\b(studies show|research shows|researchers found|according to|it is proven|it is well known|statistics show|data shows|experts agree|scientists (have )?(found|shown|proved)|surveys show)\b/i;
  const citationPattern = /\(\s*[^)]*\d{4}[^)]*\)|\[\d+\]|et al\./;
  for (const s of sentences) {
    if (claimPattern.test(s) && !citationPattern.test(s)) flags.push(s);
  }
  return flags;
}
