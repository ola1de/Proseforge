// Refinement modes and academic disciplines. Single source of truth for
// both the API (validation) and the frontend (select options via /api/config).
export interface ModeDef { id: string; label: string; description: string; instruction: string; }

export const MODES: ModeDef[] = [
  { id: "natural", label: "Natural & Fluent", description: "Improve naturalness without unnecessarily changing the original vocabulary.", instruction: "Minimal-edit mode: fix only what sounds robotic, stiff, or unclear. Keep the author's words wherever they work; change wording only where a sentence sounds mechanical, repetitive, or awkward. Preserve the author's rhythm and sentence lengths — do not smooth short sentences away." },
  { id: "academic", label: "Academic", description: "Refine scholarly writing while maintaining academic conventions.", instruction: "Refine this as scholarly writing in precise, plain academic English. Keep an academic register and exact terminology, but avoid stilted or inflated diction — clear and direct beats grand and wordy. Improve argument flow and paragraph development without dumbing the content down." },
  { id: "advanced-academic", label: "Advanced Academic", description: "Sophisticated research writing, argumentation, terminology, and analytical expression.", instruction: "Refine this as sophisticated research writing — sophisticated in argument and analysis, not in fancy words. Strengthen analytical expression, argumentation, and discipline-appropriate terminology, keeping the diction precise and plain. Improve the precision of claims and the logical progression of the argument." },
  { id: "professional", label: "Professional", description: "Business reports, corporate communication, and professional documents.", instruction: "Refine this as professional business writing. Make it clear, direct, and polished for a workplace audience, in plain language — do not dress simple points up in formal wording. Remove jargon that adds no meaning; keep terms of art that do." },
  { id: "conversational", label: "Conversational", description: "Sound natural, relaxed, and engaging.", instruction: "Make this sound natural, relaxed, and engaging, as if written by a confident person speaking to a reader. Keep it clear and warm; do not make it slangy or sloppy." },
  { id: "technical", label: "Technical", description: "Preserve technical accuracy while improving clarity.", instruction: "Improve clarity while preserving every technical term, value, identifier, and specification exactly. Do not simplify away precision. Shorten convoluted explanations without losing information." },
  { id: "concise", label: "Concise", description: "Eliminate unnecessary wording while retaining essential information.", instruction: "Make this concise. Cut filler, repetition, and redundant explanation. Keep every essential fact, number, and qualification. Do not cut meaning to save words." },
  { id: "expanded", label: "Expanded", description: "Develop incomplete explanations and improve paragraph depth without inventing facts.", instruction: "Develop this writing: expand thin explanations, make implicit connections explicit, and deepen paragraphs, in the author's own voice and without added imagery or invented examples. Only elaborate on what is already in the text — do not invent new facts, examples, statistics, or claims." },
  { id: "formal", label: "Formal", description: "Polished and appropriately formal writing.", instruction: "Produce polished, appropriately formal writing. Use a dignified register, complete sentences, and precise diction — formal means correct and respectful, not fancy or inflated. Keep the text readable rather than stiff." },
  { id: "custom", label: "Custom Voice", description: "Describe your preferred writing style and the engine follows it.", instruction: "Follow the user's custom voice description below as the style target, while preserving the original meaning." },
];

export const INTENSITIES: { id: string; label: string; instruction: string }[] = [
  { id: "light", label: "Light", instruction: "Make only the smallest changes needed: fix awkward phrasing and clear errors, and leave everything else untouched." },
  { id: "balanced", label: "Balanced", instruction: "Fix what is actually weak and leave the rest alone. Improve flow and clarity where a sentence is genuinely stiff or muddled, keep the author's voice and structure recognisable, and do not rewrite sentences that already work." },
  { id: "thorough", label: "Thorough", instruction: "Rework sentences and paragraphs substantially for the best possible reading experience, while preserving meaning, facts, and the author's intent exactly. Even when reworking heavily, stay within the author's voice: keep their rhythm, plain words, and sentence lengths wherever they serve the text." },
];

export const DISCIPLINES: string[] = [
  "General", "Social Sciences", "Political Science", "Public Administration",
  "Business Administration", "Management", "Economics", "Law", "Education",
  "Sociology", "Psychology", "Computer Science", "Engineering",
  "Information Technology", "Public Health", "Natural Sciences", "Humanities",
];

export function findMode(id: string | undefined): ModeDef | undefined {
  return MODES.find((m) => m.id === (id ?? "natural"));
}
export function findIntensity(id: string | undefined) {
  return INTENSITIES.find((i) => i.id === (id ?? "balanced"));
}
export function isDiscipline(value: string | undefined): boolean {
  return !!value && DISCIPLINES.includes(value);
}
