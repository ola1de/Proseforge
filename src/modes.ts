// Refinement modes and academic disciplines. Single source of truth for
// both the API (validation) and the frontend (select options via /api/config).
export interface ModeDef { id: string; label: string; description: string; instruction: string; }

export const MODES: ModeDef[] = [
  { id: "natural", label: "Natural & Fluent", description: "Improve naturalness without unnecessarily changing the original vocabulary.", instruction: "Improve the naturalness and fluency of the writing. Keep the author's vocabulary wherever it already works; change wording only where it sounds stiff, repetitive, or mechanical. Vary sentence rhythm naturally." },
  { id: "academic", label: "Academic", description: "Refine scholarly writing while maintaining academic conventions.", instruction: "Refine this as scholarly writing. Keep an academic register, precise terminology, and formal conventions. Improve argument flow and paragraph development without dumbing the content down." },
  { id: "advanced-academic", label: "Advanced Academic", description: "Sophisticated research writing, argumentation, terminology, and analytical expression.", instruction: "Refine this as sophisticated research writing. Strengthen analytical expression, argumentation, and discipline-appropriate terminology. Improve the precision of claims and the logical progression of the argument." },
  { id: "professional", label: "Professional", description: "Business reports, corporate communication, and professional documents.", instruction: "Refine this as professional business writing. Make it clear, direct, and polished for a workplace audience. Remove jargon that adds no meaning; keep terms of art that do." },
  { id: "conversational", label: "Conversational", description: "Sound natural, relaxed, and engaging.", instruction: "Make this sound natural, relaxed, and engaging, as if written by a confident person speaking to a reader. Keep it clear and warm; do not make it slangy or sloppy." },
  { id: "technical", label: "Technical", description: "Preserve technical accuracy while improving clarity.", instruction: "Improve clarity while preserving every technical term, value, identifier, and specification exactly. Do not simplify away precision. Shorten convoluted explanations without losing information." },
  { id: "concise", label: "Concise", description: "Eliminate unnecessary wording while retaining essential information.", instruction: "Make this concise. Cut filler, repetition, and redundant explanation. Keep every essential fact, number, and qualification. Do not cut meaning to save words." },
  { id: "expanded", label: "Expanded", description: "Develop incomplete explanations and improve paragraph depth without inventing facts.", instruction: "Develop this writing: expand thin explanations, make implicit connections explicit, and deepen paragraphs. Only elaborate on what is already in the text — do not invent new facts, examples, statistics, or claims." },
  { id: "formal", label: "Formal", description: "Polished and appropriately formal writing.", instruction: "Produce polished, appropriately formal writing. Use a dignified register, complete sentences, and precise diction, while keeping the text readable rather than stiff." },
  { id: "custom", label: "Custom Voice", description: "Describe your preferred writing style and the engine follows it.", instruction: "Follow the user's custom voice description below as the style target, while preserving the original meaning." },
];

export const INTENSITIES: { id: string; label: string; instruction: string }[] = [
  { id: "light", label: "Light", instruction: "Make only the smallest changes needed: fix awkward phrasing and clear errors, and leave everything else untouched." },
  { id: "balanced", label: "Balanced", instruction: "Make a solid pass: improve flow, variety, and word choice throughout, while keeping the author's voice and structure recognisable." },
  { id: "thorough", label: "Thorough", instruction: "Rework sentences and paragraphs substantially for the best possible reading experience, while preserving meaning, facts, and the author's intent exactly." },
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
