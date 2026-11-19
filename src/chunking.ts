// Context-aware chunking for long text. Splits on paragraph boundaries so
// no paragraph is ever cut in half; carries a one-paragraph overlap and a
// running terminology note between chunks for consistency.
export interface TextChunk { index: number; text: string; overlap: string; }

export function countWords(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return text.trim() ? words.length : 0;
}

export function splitIntoChunks(text: string, maxWords = 1500): TextChunk[] {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return [];
  const chunks: TextChunk[] = [];
  let current: string[] = [];
  let currentWords = 0;
  let overlap = "";
  const flush = () => {
    if (current.length === 0) return;
    chunks.push({ index: chunks.length, text: current.join("\n\n"), overlap });
    overlap = current[current.length - 1] ?? "";
    current = [];
    currentWords = 0;
  };
  for (const p of paragraphs) {
    const w = countWords(p);
    if (currentWords + w > maxWords && current.length > 0) flush();
    current.push(p);
    currentWords += w;
  }
  flush();
  return chunks;
}

/** Short terminology note carried between chunks: the most frequent content words so far. */
export function terminologyNote(text: string, limit = 12): string {
  const stop = new Set("the a an and or of to in on for with is are was were be been it its this that these those as at by from not but we our their his her they he she you i".split(" "));
  const freq = new Map<string, number>();
  for (const w of text.toLowerCase().replace(/[^a-z\s-]/g, " ").split(/\s+/)) {
    if (w.length < 4 || stop.has(w)) continue;
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([w]) => w);
  return top.length ? `Key terms used so far (keep their wording consistent): ${top.join(", ")}.` : "";
}
