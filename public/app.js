/* Proseforge frontend — vanilla JS, no dependencies, no login anywhere. */
"use strict";

const $ = (sel, el) => (el || document).querySelector(sel);
const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const view = $("#view");

const state = {
  config: null,
  provider: "unknown",
  undoStack: [],
  redoStack: [],
  lastRefined: "",
  lastOriginal: "",
  checkText: "",
};

const SAMPLE_ORIGINAL = "In today's fast-paced world, it is very important to note that effective communication is very crucial for success. Moreover, it is a well-known fact that many people struggle with writing. This is due to the fact that writing is a very difficult task. In conclusion, it is important to improve writing skills in order to achieve success in today's world.";

/* Hand-written "after" version of the sample, for the hero visual only.
   It was written by hand to show the style of improvement — it is labelled as an
   illustrative example on the page and is never presented as live AI output. */
const HERO_AFTER = "Clear communication is essential to success, yet many people find writing difficult. The challenge is rarely a lack of ideas — it is turning them into sentences that hold a reader's attention. Word choice, rhythm, and structure are the craft, and they can be practised like any other skill.";
const FILLERS = ["In today's fast-paced world, it is very important to note that", "Moreover, it is a well-known fact that", "This is due to the fact that", "In conclusion, it is important to"];
function highlightFillers(text) {
  let out = esc(text);
  for (const f of FILLERS) out = out.split(esc(f)).join(`<mark class="hl">${esc(f)}</mark>`);
  return out;
}

/* ---------------- Inline SVG icon set (hand-written, feather-style) ---------------- */
const ICONS = {
  home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
  fileText: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  chart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  undo: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
  redo: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  checkCircle: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  arrowRight: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
  alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  xCircle: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  file: '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>',
};
function icon(name, label) {
  const inner = ICONS[name] || "";
  const aria = label ? ` role="img" aria-label="${esc(label)}"` : ' aria-hidden="true"';
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false"${aria}>${inner}</svg>`;
}
/* Set a button's visible label without wiping its inline icon (labels live in .btn-text). */
function setBtnLabel(btn, text) {
  const span = btn.querySelector(".btn-text");
  if (span) span.textContent = text; else btn.textContent = text;
}

/* POST a JSON API request with a timeout so a hung request surfaces a
   friendly error instead of hanging forever. Pass { signal } to make the
   request cancellable (e.g. a Cancel button); pass { timeoutMs } to
   override the 180-second default. Returns { ok, status, data } as
   before, plus cancelled: true when the caller's signal aborted it. */
async function api(path, body, options) {
  const timeoutMs = (options && options.timeoutMs) || 180000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let externalAbort = null;
  if (options && options.signal) {
    if (options.signal.aborted) controller.abort();
    else { externalAbort = () => controller.abort(); options.signal.addEventListener("abort", externalAbort, { once: true }); }
  }
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
      signal: controller.signal,
    });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    if (e && e.name === "AbortError") {
      if (options && options.signal && options.signal.aborted) return { ok: false, status: 0, cancelled: true, data: null };
      return { ok: false, status: 0, data: { message: "The request took too long (over 3 minutes). Please try again with shorter text, or split a long document into smaller parts." } };
    }
    return { ok: false, status: 0, data: null };
  } finally {
    clearTimeout(timer);
    if (externalAbort && options.signal) options.signal.removeEventListener("abort", externalAbort);
  }
}

/* Run a refine request with a Cancel button and a live elapsed-time line
   so a long refine visibly stays alive. `requestFn` receives the abort
   signal to pass to api(). Returns the api() result, or null if the user
   cancelled (the caller then shows "Cancelled."). The button label is
   restored and the Cancel button hidden on every exit path. */
async function runCancellableRefine(btn, cancelBtn, statusEl, requestFn) {
  const controller = new AbortController();
  const originalLabel = (btn.querySelector(".btn-text") || btn).textContent;
  btn.disabled = true; setBtnLabel(btn, "Refining…");
  cancelBtn.style.display = "";
  const onCancel = () => controller.abort();
  cancelBtn.addEventListener("click", onCancel);
  const startedAt = Date.now();
  const tick = () => {
    const s = Math.floor((Date.now() - startedAt) / 1000);
    statusEl.innerHTML = statusHtml("info", `Refining… ${s}s — long texts can take up to a minute.`);
  };
  tick();
  const timer = setInterval(tick, 1000);
  try {
    const r = await requestFn(controller.signal);
    if (r && r.cancelled) return null;
    return r;
  } finally {
    clearInterval(timer);
    cancelBtn.removeEventListener("click", onCancel);
    cancelBtn.style.display = "none";
    btn.disabled = false;
    setBtnLabel(btn, originalLabel);
  }
}

function counts(text) {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return { words, chars: text.length };
}

function statusHtml(kind, message) {
  const ic = kind === "error" ? "xCircle" : kind === "warn" ? "alert" : "checkCircle";
  return `<div class="status show ${kind}" role="status">${icon(ic)}<span>${esc(message)}</span></div>`;
}

function providerBanner() {
  if (state.provider !== "none") return "";
  return `<div class="setup-banner" role="note"><strong>Live refinement is not configured on this installation yet.</strong><br>
  Proseforge runs on <strong>Cloudflare Workers AI — no extra key is needed</strong>. The deployment just needs the Workers AI binding enabled (it is already declared in <code>wrangler.jsonc</code>). Until a provider is configured, refinement returns a clear setup message instead of invented output — Proseforge never fakes a refinement. See the Deployment guide in the repository for the one-command deploy.</div>`;
}

function modeOptions(selected) {
  const modes = (state.config && state.config.modes) || [];
  return modes.map((m) => `<option value="${esc(m.id)}" ${m.id === selected ? "selected" : ""}>${esc(m.label)}</option>`).join("");
}
function disciplineOptions(selected) {
  const list = (state.config && state.config.disciplines) || ["General"];
  return list.map((d) => `<option ${d === selected ? "selected" : ""}>${esc(d)}</option>`).join("");
}
function intensityOptions(selected) {
  const list = (state.config && state.config.intensities) || [{ id: "balanced", label: "Balanced" }];
  return list.map((i) => `<option value="${esc(i.id)}" ${i.id === selected ? "selected" : ""}>${esc(i.label)}</option>`).join("");
}
function sectionOptions(selected) {
  const list = (state.config && state.config.academicSections) || [];
  return list.map((s) => `<option value="${esc(s.id)}" ${s.id === selected ? "selected" : ""}>${esc(s.label)}</option>`).join("");
}

function setActiveRoute(route) {
  $$(".nav-links a").forEach((a) => a.classList.toggle("active", (a.dataset.route || "") === route));
}

async function loadConfig() {
  if (state.config) return state.config;
  try {
    const res = await fetch("/api/config");
    state.config = await res.json();
    state.provider = state.config.provider || "unknown";
  } catch {
    state.config = { provider: "unknown", modes: [], disciplines: ["General"], intensities: [], academicSections: [], documentsAvailable: false };
    state.provider = "unknown";
  }
  return state.config;
}

/* ---------------- Home ---------------- */
function renderHome() {
  view.innerHTML = `
  <section class="hero">
    <span class="eyebrow">AI writing &amp; research refinement</span>
    <h1>Write like a human.<br>Read like a pro.</h1>
    <p class="lede">Proseforge turns robotic, repetitive, unnatural writing into natural, sophisticated, genuinely readable prose — from a single paragraph to an entire dissertation. No login. No account.</p>
    <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
      <a class="btn btn-accent" href="#/humanise">${icon("zap")}<span class="btn-text">Refine text — free</span></a>
      <a class="btn" href="#/research">${icon("fileText")}<span class="btn-text">Refine a research document</span></a>
    </div>
    <div class="chips" aria-label="Key facts">
      <span class="chip">${icon("lock")} No login</span>
      <span class="chip">${icon("clock")} Deleted after 48 hours</span>
      <span class="chip">${icon("zap")} Powered by Cloudflare Workers AI</span>
    </div>
  </section>
  <section class="hero-visual" aria-label="Before and after example">
    <div class="hv-panel hv-before">
      <div class="hv-head"><span class="badge">Before</span><span class="hv-note">Robotic, filler-heavy</span></div>
      <p>${highlightFillers(SAMPLE_ORIGINAL)}</p>
    </div>
    <div class="hv-arrow" aria-hidden="true">${icon("arrowRight", "becomes")}</div>
    <div class="hv-panel hv-after">
      <div class="hv-head"><span class="badge teal">After</span><span class="hv-note">Natural, direct</span></div>
      <p>${esc(HERO_AFTER)}</p>
    </div>
    <p class="hv-caption small muted">Illustrative example — the “after” text was written by hand to show the style of improvement. Live refinement happens in the workspace below.</p>
  </section>
  ${providerBanner()}
  <section class="section" style="padding-top:16px">
    <div class="card">
      <h2 style="font-size:1.25rem">Try it now</h2>
      <p class="muted">Paste your text, pick a mode, and refine. Your text is processed in memory and never stored.</p>
      <div class="toolbar">
        <div class="field"><label for="home-mode">Refinement mode</label><select id="home-mode">${modeOptions("natural")}</select></div>
        <div class="field"><label for="home-discipline">Discipline</label><select id="home-discipline">${disciplineOptions("General")}</select></div>
        <button class="btn btn-primary" id="home-refine">${icon("zap")}<span class="btn-text">Refine this text</span></button>
        <button class="btn" id="home-cancel" style="display:none">${icon("xCircle")}<span class="btn-text">Cancel</span></button>
      </div>
      <div class="panels">
        <div class="panel"><div class="panel-head"><span>Original</span><span class="muted" id="home-counts">0 words · 0 characters</span></div>
          <div class="panel-body"><textarea id="home-input" rows="8" placeholder="Paste your paragraph here…">${esc(SAMPLE_ORIGINAL)}</textarea></div></div>
        <div class="panel"><div class="panel-head"><span>Refined</span><button class="btn btn-sm btn-ghost" id="home-copy" disabled>${icon("copy")}<span class="btn-text">Copy</span></button></div>
          <div class="panel-body"><div class="readonly placeholder" id="home-output">Your refined text will appear here.</div></div></div>
      </div>
      <div id="home-status"></div>
    </div>
  </section>
  <section class="section">
    <h2>Original vs. refined — a real example</h2>
    <p class="sub">The original below is real, deliberately robotic text. Press the button to refine it live with the configured provider. If no provider is configured, you will see the honest setup message — never a faked refinement.</p>
    <div class="grid grid-2">
      <div><div class="badge">Original</div><div class="demo-orig" style="margin-top:8px">${esc(SAMPLE_ORIGINAL)}</div></div>
      <div><div class="badge teal">Refined — live</div><div class="demo-ref" style="margin-top:8px" id="demo-refined">Press “Refine this sample” to see a live refinement.</div></div>
    </div>
    <div style="margin-top:14px"><button class="btn" id="demo-refine">${icon("zap")}<span class="btn-text">Refine this sample</span></button></div>
    <div id="demo-status"></div>
  </section>
  <section class="section alt">
    <div class="wrap" style="padding:0">
    <h2>What Proseforge does</h2>
    <p class="sub">Not a synonym swapper. The engine reads the whole passage, then improves sentence construction, vocabulary, transitions, and terminology — while preserving your meaning, facts, and voice.</p>
    <div class="grid grid-3">
      <div class="card feature"><div class="icon-tile">${icon("pen")}</div><h3>Humanise Text</h3><p>Ten refinement modes — Natural, Academic, Advanced Academic, Professional, Conversational, Technical, Concise, Expanded, Formal, and your own Custom Voice — with three intensities.</p><a class="feature-link" href="#/humanise">Refine text ${icon("arrowRight")}</a></div>
      <div class="card feature"><div class="icon-tile">${icon("fileText")}</div><h3>Research Documents</h3><p>Whole dissertations and theses, refined section by section with formatting preserved. DOCX, ODT, RTF, TXT, and text-layer PDF supported.</p><a class="feature-link" href="#/research">Refine a document ${icon("arrowRight")}</a></div>
      <div class="card feature"><div class="icon-tile">${icon("book")}</div><h3>Academic Assistant</h3><p>Abstracts, introductions, problem statements, objectives, methodology, results, discussion, conclusions, and recommendations — with unsupported claims flagged, never invented.</p><a class="feature-link" href="#/academic">Refine a section ${icon("arrowRight")}</a></div>
      <div class="card feature"><div class="icon-tile">${icon("layers")}</div><h3>Writing Constructor</h3><p>Turn a basic sentence or a pile of ideas into well-constructed writing, with three alternative constructions to compare.</p><a class="feature-link" href="#/constructor">Build alternatives ${icon("arrowRight")}</a></div>
      <div class="card feature"><div class="icon-tile">${icon("chart")}</div><h3>Writing Analysis</h3><p>Readability, vocabulary diversity, repetition, sentence variation, and tone — transparent editorial indicators, honestly labelled, before and after.</p><a class="feature-link" href="#/analysis">Analyse writing ${icon("arrowRight")}</a></div>
      <div class="card feature"><div class="icon-tile">${icon("search")}</div><h3>AI Checker</h3><p>Paste any text and see whether it reads as AI-generated or human — a transparent score with the six signals behind it, honestly labelled as an indicator, not proof.</p><a class="feature-link" href="#/checker">Check text ${icon("arrowRight")}</a></div>
      <div class="card feature"><div class="icon-tile">${icon("shield")}</div><h3>Private by design</h3><p>No login, no email, no profiles. Text is never stored. Uploaded documents are deleted automatically after 48 hours.</p><a class="feature-link" href="#/privacy">How privacy works ${icon("arrowRight")}</a></div>
    </div>
    </div>
  </section>
  <section class="section">
    <h2>Document compatibility</h2>
    <div class="grid grid-2">
      <div class="card"><h3>Now — text</h3><p>Any text you paste: paragraphs, essays, emails, reports, and academic sections. Up to 100,000 characters per request (configurable).</p></div>
      <div class="card"><h3>Documents — now</h3><p>DOCX with structural preservation (styles, tables, headers, footers, citations, footnotes intact), plus ODT, RTF, TXT, and text-layer PDF. Scanned PDFs cannot be OCRed inside a Worker — the limitation is documented, not hidden.</p></div>
    </div>
  </section>
  <section class="section">
    <h2>Frequently asked questions</h2>
    <details><summary>Do I need an account?</summary><p>No. There is no login, no email address, and no profile. Open the site and refine.</p></details>
    <details><summary>What happens to my text and documents?</summary><p>Text you paste is processed in memory and never stored. Uploaded documents are kept in private temporary storage and deleted automatically 48 hours after upload.</p></details>
    <details><summary>Will this make my writing undetectable by AI detectors?</summary><p>No — and Proseforge never claims that. The goal is genuinely better writing: natural rhythm, precise vocabulary, and coherent argument. Detector-evasion is not a feature.</p></details>
    <details><summary>How accurate is the AI Checker?</summary><p>It is an indicator, not proof. The checker looks at six local signals — AI-tell phrases, sentence rhythm, vocabulary diversity, repetition, sentence shape, and filler transitions — and shows you the score with the breakdown behind it, so you can see why. No detector is perfectly accurate: short texts, edited text, and non-native English can all mislead it, and it works best on passages of 100 words or more. Use it to judge whether a refinement still reads as AI, not as a verdict on who wrote something.</p></details>
    <details><summary>Does Proseforge invent facts or references?</summary><p>No. The engine is instructed to preserve meaning and never invent facts, statistics, quotations, or references. Unsupported factual claims are flagged for you to verify.</p></details>
    <details><summary>What AI does it use?</summary><p>Cloudflare Workers AI — no extra key is needed. The model is configurable, and an optional OpenAI-compatible adapter exists for operators who prefer a different provider. Nothing is ever sent to a provider without the operator configuring one.</p></details>
    <details><summary>What does it cost to run?</summary><p>Workers AI includes a free daily allowance (10,000 neurons/day at the time of writing); beyond that, usage is metered. Operators can set request and text-size limits in configuration.</p></details>
  </section>`;

  const input = $("#home-input"), output = $("#home-output"), countsEl = $("#home-counts");
  const updateCounts = () => { const c = counts(input.value); countsEl.textContent = `${c.words.toLocaleString()} words · ${c.chars.toLocaleString()} characters`; };
  input.addEventListener("input", updateCounts); updateCounts();
  $("#home-refine").addEventListener("click", async () => {
    const r = await runCancellableRefine($("#home-refine"), $("#home-cancel"), $("#home-status"), (signal) =>
      api("/api/refine", { text: input.value, mode: $("#home-mode").value, intensity: "balanced", discipline: $("#home-discipline").value }, { signal }));
    if (r === null) { $("#home-status").innerHTML = statusHtml("warn", "Cancelled."); return; }
    if (r.ok) {
      output.classList.remove("placeholder"); output.textContent = r.data.refined;
      state.lastRefined = r.data.refined; state.lastOriginal = input.value;
      $("#home-copy").disabled = false;
      $("#home-status").innerHTML = "";
    } else {
      $("#home-status").innerHTML = statusHtml("error", errorMessage(r));
    }
  });
  $("#home-copy").addEventListener("click", async () => { await navigator.clipboard.writeText(output.textContent); setBtnLabel($("#home-copy"), "Copied"); setTimeout(() => { setBtnLabel($("#home-copy"), "Copy"); }, 1500); });
  $("#demo-refine").addEventListener("click", async () => {
    const btn = $("#demo-refine"); btn.disabled = true; setBtnLabel(btn, "Refining…");
    const r = await api("/api/refine", { text: SAMPLE_ORIGINAL, mode: "natural", intensity: "balanced", discipline: "General" });
    btn.disabled = false; setBtnLabel(btn, "Refine this sample");
    if (r.ok) { $("#demo-refined").textContent = r.data.refined; $("#demo-status").innerHTML = ""; }
    else { $("#demo-status").innerHTML = statusHtml("warn", errorMessage(r)); }
  });
}

function errorMessage(r) {
  if (!r.data) return `Request failed (HTTP ${r.status}). Please try again.`;
  let msg = r.data.message || `Request failed (HTTP ${r.status}).`;
  if (r.data.setup && r.data.setup.length) msg += " " + r.data.setup.join(" ");
  return msg;
}

/* ---------------- Humanise workspace ---------------- */
function renderHumanise() {
  view.innerHTML = `
  <section class="workspace">
    <h1 class="page-title">${icon("pen")} Humanise Text</h1>
    <p class="muted">Refine any text into natural, sophisticated prose. Meaning, facts, numbers, and citations are preserved; nothing is invented.</p>
    ${providerBanner()}
    <div class="toolbar">
      <div class="field"><label for="h-mode">Mode</label><select id="h-mode">${modeOptions("natural")}</select></div>
      <div class="field"><label for="h-intensity">Intensity</label><select id="h-intensity">${intensityOptions("balanced")}</select></div>
      <div class="field"><label for="h-discipline">Discipline</label><select id="h-discipline">${disciplineOptions("General")}</select></div>
      <div class="field" id="h-voice-field" style="display:none;flex:1;min-width:220px"><label for="h-voice">Custom voice — describe your preferred style</label><input type="text" id="h-voice" placeholder="e.g. Clear newspaper editorial, confident but plain"></div>
    </div>
    <div class="panels">
      <div class="panel"><div class="panel-head"><span>Original</span><span class="muted" id="h-counts">0 words · 0 characters</span></div>
        <div class="panel-body"><textarea id="h-input" rows="12" placeholder="Paste your text here…"></textarea></div></div>
      <div class="panel"><div class="panel-head"><span>Refined</span><span><button class="btn btn-sm btn-ghost" id="h-copy" disabled>${icon("copy")}<span class="btn-text">Copy</span></button> <button class="btn btn-sm btn-ghost" id="h-download" disabled>${icon("download")}<span class="btn-text">Download .txt</span></button></span></div>
        <div class="panel-body"><div class="readonly placeholder" id="h-output">Your refined text will appear here.</div></div></div>
    </div>
    <div class="actions">
      <button class="btn btn-accent" id="h-refine">${icon("zap")}<span class="btn-text">Refine</span></button>
      <button class="btn" id="h-cancel" style="display:none">${icon("xCircle")}<span class="btn-text">Cancel</span></button>
      <button class="btn" id="h-check" disabled>${icon("search")}<span class="btn-text">Check refined text</span></button>
      <button class="btn" id="h-undo" disabled>${icon("undo")}<span class="btn-text">Undo</span></button>
      <button class="btn" id="h-redo" disabled>${icon("redo")}<span class="btn-text">Redo</span></button>
      <button class="btn" id="h-clear">${icon("trash")}<span class="btn-text">Clear</span></button>
    </div>
    <div id="h-status"></div>
    <p class="small muted">Tip: long texts are processed in paragraph-sized chunks with terminology carried between chunks, so a long essay stays consistent. Limit: 100,000 characters per request.</p>
  </section>`;

  const input = $("#h-input"), output = $("#h-output");
  const updateCounts = () => { const c = counts(input.value); $("#h-counts").textContent = `${c.words.toLocaleString()} words · ${c.chars.toLocaleString()} characters`; };
  input.addEventListener("input", updateCounts);
  const pushUndo = () => { state.undoStack.push({ input: input.value, output: output.textContent }); if (state.undoStack.length > 30) state.undoStack.shift(); state.redoStack = []; syncUndo(); };
  const syncUndo = () => { $("#h-undo").disabled = state.undoStack.length === 0; $("#h-redo").disabled = state.redoStack.length === 0; };
  $("#h-mode").addEventListener("change", (e) => { $("#h-voice-field").style.display = e.target.value === "custom" ? "flex" : "none"; });
  $("#h-refine").addEventListener("click", async () => {
    if (!input.value.trim()) { $("#h-status").innerHTML = statusHtml("warn", "Paste some text first."); return; }
    pushUndo();
    const r = await runCancellableRefine($("#h-refine"), $("#h-cancel"), $("#h-status"), (signal) =>
      api("/api/refine", { text: input.value, mode: $("#h-mode").value, intensity: $("#h-intensity").value, discipline: $("#h-discipline").value, customVoice: $("#h-voice").value }, { signal }));
    if (r === null) { $("#h-status").innerHTML = statusHtml("warn", "Cancelled."); return; }
    if (r.ok) {
      output.classList.remove("placeholder"); output.textContent = r.data.refined;
      state.lastRefined = r.data.refined; state.lastOriginal = input.value;
      $("#h-copy").disabled = false; $("#h-download").disabled = false; $("#h-check").disabled = false;
      $("#h-status").innerHTML = statusHtml("info", `Refined in ${r.data.chunks} chunk${r.data.chunks === 1 ? "" : "s"} · ${r.data.words.toLocaleString()} words · mode: ${esc(r.data.mode)}. Review before use — meaning is preserved, but you are the author.`);
    } else { $("#h-status").innerHTML = statusHtml("error", errorMessage(r)); }
  });
  $("#h-check").addEventListener("click", () => { state.checkText = output.textContent; location.hash = "#/checker"; });
  $("#h-copy").addEventListener("click", async () => { await navigator.clipboard.writeText(output.textContent); $("#h-status").innerHTML = statusHtml("info", "Copied to clipboard."); });
  $("#h-download").addEventListener("click", () => downloadText("proseforge-refined.txt", output.textContent));
  $("#h-clear").addEventListener("click", () => { pushUndo(); input.value = ""; output.textContent = "Your refined text will appear here."; output.classList.add("placeholder"); $("#h-copy").disabled = true; $("#h-download").disabled = true; updateCounts(); $("#h-status").innerHTML = ""; });
  $("#h-undo").addEventListener("click", () => {
    const prev = state.undoStack.pop(); if (!prev) return;
    state.redoStack.push({ input: input.value, output: output.textContent });
    input.value = prev.input; output.textContent = prev.output; updateCounts(); syncUndo();
  });
  $("#h-redo").addEventListener("click", () => {
    const next = state.redoStack.pop(); if (!next) return;
    state.undoStack.push({ input: input.value, output: output.textContent });
    input.value = next.input; output.textContent = next.output; updateCounts(); syncUndo();
  });
  if (state.lastOriginal) { input.value = state.lastOriginal; }
  if (state.lastRefined) {
    output.classList.remove("placeholder"); output.textContent = state.lastRefined;
    $("#h-copy").disabled = false; $("#h-download").disabled = false; $("#h-check").disabled = false;
  }
  updateCounts();
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ---------------- Research document (Milestone 2: DOCX/ODT/RTF/TXT/PDF) ---------------- */
function renderResearch() {
  const formats = (state.config && state.config.documentFormats) || [];
  const maxBytes = (state.config && state.config.maxDocBytes) || 20000000;
  let job = null;         // latest job view from the status endpoint
  let pollTimer = null;
  let report = null;
  // Stall detection: the last time the job's progress/stage actually
  // changed. A job whose background task died sits frozen forever, so
  // if nothing changes for 3 minutes we stop polling and offer a retry
  // instead of polling forever.
  let lastProgressAt = 0;
  let lastProgressKey = "";
  const STALL_MS = 180000;
  function progressKey(j) { return `${j.status}|${j.stage || ""}|${j.progress || 0}`; }

  view.innerHTML = `
  <section class="workspace">
    <h1 class="page-title">${icon("fileText")} Research Document</h1>
    <p class="muted">Refine a whole dissertation, thesis, or journal manuscript — section by section, with your structure and formatting preserved. Tables, citations, equations, footnotes, and references are never rewritten.</p>
    ${providerBanner()}
    <div class="toolbar">
      <div class="field"><label for="d-mode">Mode</label><select id="d-mode">${modeOptions("academic")}</select></div>
      <div class="field"><label for="d-intensity">Intensity</label><select id="d-intensity">${intensityOptions("balanced")}</select></div>
      <div class="field"><label for="d-discipline">Discipline</label><select id="d-discipline">${disciplineOptions("General")}</select></div>
      <div class="field" id="d-voice-field" style="display:none;flex:1;min-width:220px"><label for="d-voice">Custom voice — describe your preferred style</label><input type="text" id="d-voice" placeholder="e.g. Clear newspaper editorial, confident but plain"></div>
    </div>
    <div class="dropzone" id="dropzone" tabindex="0" role="button" aria-label="Upload a research document">
      <div class="dz-icon">${icon("upload")}</div>
      <strong>Drag &amp; drop a document here, or click to browse</strong>
      <p class="small" style="margin:8px 0 0">.docx · .odt · .pdf · .rtf · .txt — up to ${(maxBytes / 1000000).toFixed(0)} MB · private temporary storage, deleted automatically 48 hours after upload</p>
      <input type="file" id="file-input" accept=".docx,.odt,.pdf,.rtf,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.oasis.opendocument.text,application/pdf,application/rtf,text/plain">
    </div>
    <div id="d-status"></div>
    <div id="d-progress" style="margin-top:16px"></div>
    <div id="d-result" style="margin-top:16px"></div>
    <h2 style="margin-top:32px">How document refinement works</h2>
    <ul class="steps">
      <li><span class="step-icon">${icon("upload")}</span><div><strong>1. Upload</strong> — DOCX, ODT, PDF, RTF, or TXT, validated by type and content (not just the file extension).</div></li>
      <li><span class="step-icon">${icon("search")}</span><div><strong>2. Structure analysis</strong> — chapters, sections, tables, figures, equations, citations, and references are identified; protected content is marked and never rewritten.</div></li>
      <li><span class="step-icon">${icon("refresh")}</span><div><strong>3. Section-by-section refinement</strong> — eligible paragraphs are refined in context-aware batches, with terminology kept consistent across chapters.</div></li>
      <li><span class="step-icon">${icon("checkCircle")}</span><div><strong>4. Reinsertion &amp; validation</strong> — improved text goes back into the original document structure; the file is re-opened and validated before download.</div></li>
      <li><span class="step-icon">${icon("download")}</span><div><strong>5. Download &amp; report</strong> — a refined document plus a processing report. The original is never altered and stays downloadable.</div></li>
      <li><span class="step-icon">${icon("clock")}</span><div><strong>6. Automatic deletion</strong> — the uploaded file and all temporary data are deleted 48 hours after upload.</div></li>
    </ul>
    <h2 style="margin-top:32px"><span class="h-icon">${icon("shield")} What is protected — always</span></h2>
    <p class="muted">Research findings, numerical results, statistical values, hypotheses, quotations, citations, bibliographic entries, equations, variable names, tables, captions, footnotes, headers, footers, and research instruments are never rewritten.</p>
    <h2 style="margin-top:32px"><span class="h-icon">${icon("alert")} Known limitations — stated, not hidden</span></h2>
    <ul class="clean">
      <li><strong>PDF:</strong> only the text layer is refined; the refined output is a plain-text file and the original PDF's layout is not rebuilt. The original PDF stays downloadable.</li>
      <li><strong>Scanned PDFs:</strong> a PDF with no text layer cannot be processed — full OCR cannot run inside a Cloudflare Worker. You will get a clear message, never empty output.</li>
      <li><strong>RTF:</strong> each refined paragraph is written as a single run, so word-level bold/italic inside a refined paragraph is not preserved.</li>
    </ul>
  </section>`;

  const dz = $("#dropzone"), fi = $("#file-input");
  $("#d-mode").addEventListener("change", (e) => { $("#d-voice-field").style.display = e.target.value === "custom" ? "flex" : "none"; });
  dz.addEventListener("click", () => fi.click());
  dz.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") fi.click(); });
  ["dragover", "dragenter"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("over"); }));
  dz.addEventListener("drop", (e) => { if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]); });
  fi.addEventListener("change", () => { if (fi.files.length) handleFile(fi.files[0]); fi.value = ""; });

  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  /* Upload via XMLHttpRequest (not fetch) so upload.onprogress can show
     a real upload percentage — a large file on a slow connection
     otherwise sits on "Uploading…" with no feedback. Returns the same
     { ok, status, data } shape the old fetch path produced. */
  function uploadDocument(form, name, sizeBytes) {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/documents/upload");
      xhr.timeout = 120000;
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          $("#d-status").innerHTML = statusHtml("info", `Uploading "${name}" (${(sizeBytes / 1000).toFixed(0)} KB)… ${pct}%`);
        }
      };
      xhr.onload = () => {
        let data = null;
        try { data = JSON.parse(xhr.responseText); } catch { data = null; }
        resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, data });
      };
      xhr.onerror = () => resolve({ ok: false, status: 0, data: null });
      xhr.ontimeout = () => resolve({ ok: false, status: 0, data: { message: "Upload timed out after 2 minutes. Check your connection and try again, or split the document into smaller parts." } });
      xhr.send(form);
    });
  }

  async function handleFile(file) {
    stopPolling(); job = null; report = null;
    $("#d-result").innerHTML = ""; $("#d-progress").innerHTML = "";
    const name = file.name || "document";
    if (file.size > maxBytes) {
      $("#d-status").innerHTML = statusHtml("error", `"${name}" is ${(file.size / 1000000).toFixed(1)} MB — over the ${(maxBytes / 1000000).toFixed(0)} MB upload limit. Split the document into chapters and upload them one at a time.`);
      return;
    }
    const form = new FormData();
    form.append("file", file);
    form.append("mode", $("#d-mode").value);
    form.append("intensity", $("#d-intensity").value);
    form.append("discipline", $("#d-discipline").value);
    form.append("customVoice", $("#d-voice").value || "");
    $("#d-status").innerHTML = statusHtml("info", `Uploading "${name}" (${(file.size / 1000).toFixed(0)} KB)…`);
    const res = await uploadDocument(form, name, file.size);
    if (!res.ok || !res.data || !res.data.job) {
      $("#d-status").innerHTML = statusHtml("error", (res.data && res.data.message) || (res.status ? `Upload failed (HTTP ${res.status}).` : "Upload failed — the server could not be reached. Please try again."));
      return;
    }
    job = res.data.job;
    $("#d-status").innerHTML = "";
    lastProgressAt = Date.now();
    lastProgressKey = progressKey(job);
    renderProgress();
    pollTimer = setInterval(pollStatus, 2000);
    pollStatus();
  }

  async function pollStatus() {
    if (!job) { stopPolling(); return; }
    let res;
    try { res = await fetch(`/api/documents/${job.id}/status`); }
    catch { return; } // transient network error: keep polling
    if (!res.ok) {
      if (res.status === 404 || res.status === 410) {
        stopPolling();
        $("#d-status").innerHTML = statusHtml("error", "This document job is no longer available. It may have been deleted 48 hours after upload — please upload it again.");
      }
      return;
    }
    const data = await res.json();
    job = data.job;
    const key = progressKey(job);
    if (key !== lastProgressKey) { lastProgressKey = key; lastProgressAt = Date.now(); }
    renderProgress();
    if (job.status === "done") { stopPolling(); await loadReport(); }
    else if (job.status === "failed" || job.status === "needs-provider") { stopPolling(); renderFailed(); }
    else if (Date.now() - lastProgressAt > STALL_MS) { stopPolling(); renderStuck(); }
  }

  function renderProgress() {
    if (!job) return;
    const pct = Math.max(0, Math.min(100, job.progress || 0));
    const elapsed = Math.max(0, Math.floor((Date.now() - new Date(job.uploadedAt).getTime()) / 1000));
    $("#d-progress").innerHTML = `<div class="card">
      <h3>${esc(job.originalFilename)}</h3>
      <p class="small muted">${esc(job.stage || job.status)} · ${pct}% · ${(job.sizeBytes / 1000).toFixed(0)} KB · ${elapsed}s elapsed · deleted ${esc(new Date(job.deletedAt).toLocaleString())}</p>
      <div class="progress"><div style="width:${pct}%"></div></div>
      <p class="small muted">Job ${esc(job.id.slice(0, 8))}… — you can leave this page; the file is deleted automatically 48 hours after upload either way.</p>
    </div>`;
  }

  /* A job whose progress/stage has not changed for 3 minutes is treated
     as stuck (the background task may have died without marking the job
     failed). Stop polling and offer a retry — the server accepts retries
     for stuck jobs, not just failed ones. */
  function renderStuck() {
    $("#d-progress").innerHTML = `<div class="card"><h3>${esc(job ? job.originalFilename : "Document")}</h3>
      <p>This job seems stuck — it hasn't made progress in 3 minutes. The background task may have stopped; your original file was not altered.</p>
      <p style="margin-top:12px"><button class="btn btn-accent" id="d-retry">${icon("refresh")}<span class="btn-text">Retry processing</span></button></p></div>`;
    attachRetry($("#d-retry"));
  }

  /* Shared retry handler for the failed/needs-provider and stuck cards:
     re-kicks processing for the same job and resumes polling. */
  function attachRetry(btn) {
    if (!btn) return;
    btn.addEventListener("click", async () => {
      const originalLabel = (btn.querySelector(".btn-text") || btn).textContent;
      btn.disabled = true; setBtnLabel(btn, "Retrying…");
      const res = await fetch(`/api/documents/${job.id}/retry`, { method: "POST" });
      if (!res.ok) { btn.disabled = false; setBtnLabel(btn, originalLabel); return; }
      const data = await res.json();
      job = data.job;
      lastProgressAt = Date.now();
      lastProgressKey = progressKey(job);
      renderProgress();
      pollTimer = setInterval(pollStatus, 2000);
      pollStatus();
    });
  }

  function renderFailed() {
    const msg = (job && job.error) || "Processing failed.";
    const retry = job && job.status === "needs-provider"
      ? `<p style="margin-top:12px"><button class="btn" id="d-retry">${icon("refresh")}<span class="btn-text">Retry now</span></button> <span class="small muted">Use this after a provider has been configured.</span></p>` : "";
    $("#d-progress").innerHTML = `<div class="card"><h3>${esc(job ? job.originalFilename : "Document")}</h3>
      <p>${esc(msg)}</p>${retry}</div>`;
    attachRetry($("#d-retry"));
  }

  async function loadReport() {
    const res = await fetch(`/api/documents/${job.id}/report`);
    if (!res.ok) { $("#d-status").innerHTML = statusHtml("error", "Processing finished, but the report could not be loaded. The refined file is still available below."); return; }
    report = await res.json();
    const s = report;
    const chapterRows = (s.chapters || []).map((c) => `<tr><td>${"—".repeat(Math.max(0, c.level - 1))} ${esc(c.title)}</td><td>${esc(c.kind)}</td></tr>`).join("");
    const protectedRows = Object.entries(s.protectedCounts || {}).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join("");
    const limitList = (s.limitations || []).map((l) => `<li>${esc(l)}</li>`).join("");
    const warnList = (s.warnings || []).map((w) => `<li>${esc(w)}</li>`).join("");
    $("#d-result").innerHTML = `<div class="card">
      <h3>Refined document ready</h3>
      <p class="small muted">Original: ${esc(s.originalFilename)} · Refined file: ${esc(s.refinedFilename)} · Deleted ${esc(new Date(s.deletedAt).toLocaleString())}</p>
      <table>
        <tr><th>Measure</th><th>Before</th><th>After</th></tr>
        <tr><td>Words</td><td>${s.originalWords.toLocaleString()}</td><td>${s.refinedWords.toLocaleString()}</td></tr>
        <tr><td>Paragraphs refined</td><td colspan="2">${s.paragraphsRefined} of ${s.paragraphsTotal}</td></tr>
        <tr><td>Paragraphs protected (never rewritten)</td><td colspan="2">${s.paragraphsProtected}</td></tr>
        <tr><td>Paragraphs skipped (empty)</td><td colspan="2">${s.paragraphsSkipped}</td></tr>
      </table>
      <div class="actions">
        <button class="btn btn-accent" id="d-download">${icon("download")}<span class="btn-text">Download refined document</span></button>
        <button class="btn" id="d-download-orig">${icon("download")}<span class="btn-text">Download original</span></button>
        <button class="btn" id="d-again">${icon("refresh")}<span class="btn-text">Refine another document</span></button>
      </div>
      ${chapterRows ? `<h3 style="margin-top:20px">Structure found</h3><table><tr><th>Section</th><th>Type</th></tr>${chapterRows}</table>` : ""}
      ${protectedRows ? `<h3 style="margin-top:20px">Protected content (left untouched)</h3><table><tr><th>What</th><th>Count</th></tr>${protectedRows}</table>` : ""}
      ${limitList ? `<h3 style="margin-top:20px">Limitations that applied</h3><ul class="clean">${limitList}</ul>` : ""}
      ${warnList ? `<h3 style="margin-top:20px">Warnings</h3><ul class="clean">${warnList}</ul>` : ""}
      ${(s.injectionSpans && s.injectionSpans.length) ? `<p class="small muted" style="margin-top:12px">The document contained ${s.injectionSpans.length} instruction-like span(s); they were treated as ordinary text and never executed as instructions.</p>` : ""}
    </div>`;
    $("#d-download").addEventListener("click", () => downloadJob("refined"));
    $("#d-download-orig").addEventListener("click", () => downloadJob("original"));
    $("#d-again").addEventListener("click", () => { stopPolling(); job = null; report = null; $("#d-result").innerHTML = ""; $("#d-progress").innerHTML = ""; $("#d-status").innerHTML = ""; });
  }

  async function downloadJob(kind) {
    if (!job || !job.downloadToken) { $("#d-status").innerHTML = statusHtml("error", "Download token expired. Poll the status again for a fresh token."); return; }
    const res = await fetch(`/api/documents/${job.id}/download?token=${encodeURIComponent(job.downloadToken)}&kind=${kind}`);
    if (!res.ok) {
      let data = null; try { data = await res.json(); } catch { data = null; }
      $("#d-status").innerHTML = statusHtml("error", (data && data.message) || `Download failed (HTTP ${res.status}).`);
      return;
    }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = kind === "original" ? job.originalFilename : (report ? report.refinedFilename : job.originalFilename);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
}

/* ---------------- Academic Assistant ---------------- */
function renderAcademic() {
  view.innerHTML = `
  <section class="workspace">
    <h1 class="page-title">${icon("book")} Academic Assistant</h1>
    <p class="muted">Refine each part of a research project — abstracts to recommendations — in the conventions of your discipline. Unsupported factual claims are flagged for verification; sources are never invented.</p>
    ${providerBanner()}
    <div class="toolbar">
      <div class="field"><label for="a-section">Section</label><select id="a-section">${sectionOptions("abstract")}</select></div>
      <div class="field"><label for="a-discipline">Discipline</label><select id="a-discipline">${disciplineOptions("Political Science")}</select></div>
    </div>
    <div class="panels">
      <div class="panel"><div class="panel-head"><span>Your section draft</span><span class="muted" id="a-counts">0 words</span></div>
        <div class="panel-body"><textarea id="a-input" rows="12" placeholder="Paste your abstract, introduction, methodology…"></textarea></div></div>
      <div class="panel"><div class="panel-head"><span>Refined</span><button class="btn btn-sm btn-ghost" id="a-copy" disabled>${icon("copy")}<span class="btn-text">Copy</span></button></div>
        <div class="panel-body"><div class="readonly placeholder" id="a-output">Your refined section will appear here.</div></div></div>
    </div>
    <div class="actions"><button class="btn btn-accent" id="a-refine">${icon("zap")}<span class="btn-text">Refine section</span></button><button class="btn" id="a-cancel" style="display:none">${icon("xCircle")}<span class="btn-text">Cancel</span></button><button class="btn" id="a-clear">${icon("trash")}<span class="btn-text">Clear</span></button></div>
    <div id="a-status"></div>
    <div id="a-claims"></div>
    <div class="grid grid-3" style="margin-top:24px">
      <div class="card feature"><div class="icon-tile">${icon("book")}</div><h3>Terminology, in context</h3><p>Use the Writing Constructor to test alternative academic expressions for a sentence before committing to them.</p></div>
      <div class="card feature"><div class="icon-tile">${icon("arrowRight")}</div><h3>Transitions</h3><p>Prefer precise connectors — <em>however, therefore, consequently, in contrast</em> — over filler such as “it is important to note that”.</p></div>
      <div class="card feature"><div class="icon-tile">${icon("alert")}</div><h3>Claims need sources</h3><p>A sentence like “studies show…” with no citation is flagged below. Add the source yourself; Proseforge will not invent one.</p></div>
    </div>
  </section>`;
  const input = $("#a-input"), output = $("#a-output");
  input.addEventListener("input", () => { $("#a-counts").textContent = `${counts(input.value).words.toLocaleString()} words`; });
  $("#a-refine").addEventListener("click", async () => {
    if (!input.value.trim()) { $("#a-status").innerHTML = statusHtml("warn", "Paste your section draft first."); return; }
    const r = await runCancellableRefine($("#a-refine"), $("#a-cancel"), $("#a-status"), (signal) =>
      api("/api/academic", { text: input.value, section: $("#a-section").value, discipline: $("#a-discipline").value }, { signal }));
    if (r === null) { $("#a-status").innerHTML = statusHtml("warn", "Cancelled."); return; }
    if (r.ok) {
      output.classList.remove("placeholder"); output.textContent = r.data.refined;
      $("#a-copy").disabled = false;
      $("#a-status").innerHTML = statusHtml("info", `Section refined: ${esc(r.data.section)}. ${esc(r.data.claimNote)}`);
      $("#a-claims").innerHTML = r.data.unsupportedClaims.length
        ? `<div class="card" style="margin-top:12px"><h3>Flagged for verification (${r.data.unsupportedClaims.length})</h3><ul class="clean">${r.data.unsupportedClaims.map((c) => `<li>“${esc(c)}”</li>`).join("")}</ul><p class="small muted">These sentences make factual claims without a citation in your text. Verify them and add a real source — do not let any tool invent one.</p></div>` : "";
    } else { $("#a-status").innerHTML = statusHtml("error", errorMessage(r)); }
  });
  $("#a-copy").addEventListener("click", async () => { await navigator.clipboard.writeText(output.textContent); });
  $("#a-clear").addEventListener("click", () => { input.value = ""; output.textContent = "Your refined section will appear here."; output.classList.add("placeholder"); $("#a-claims").innerHTML = ""; $("#a-status").innerHTML = ""; });
}

/* ---------------- Writing Constructor ---------------- */
function renderConstructor() {
  view.innerHTML = `
  <section class="workspace">
    <h1 class="page-title">${icon("layers")} Writing Constructor</h1>
    <p class="muted">Enter an ordinary sentence, a basic explanation, or a collection of ideas. Proseforge builds three alternative constructions — same meaning, different structure — so you can compare and choose.</p>
    ${providerBanner()}
    <div class="toolbar">
      <div class="field"><label for="c-discipline">Discipline</label><select id="c-discipline">${disciplineOptions("General")}</select></div>
    </div>
    <div class="card">
      <label for="c-input" style="font-weight:650;font-size:.9rem">Your sentence, explanation, or ideas</label>
      <textarea id="c-input" rows="5" placeholder="e.g. The government should do more about unemployment because many young people do not have jobs."></textarea>
      <div class="actions"><button class="btn btn-accent" id="c-build">${icon("layers")}<span class="btn-text">Build alternatives</span></button><button class="btn" id="c-clear">${icon("trash")}<span class="btn-text">Clear</span></button></div>
      <div id="c-status"></div>
    </div>
    <div id="c-results" style="margin-top:16px"></div>
  </section>`;
  $("#c-build").addEventListener("click", async () => {
    const input = $("#c-input").value;
    if (!input.trim()) { $("#c-status").innerHTML = statusHtml("warn", "Enter a sentence or some ideas first."); return; }
    const btn = $("#c-build"); btn.disabled = true; setBtnLabel(btn, "Building…");
    const r = await api("/api/construct", { text: input, discipline: $("#c-discipline").value });
    btn.disabled = false; setBtnLabel(btn, "Build alternatives");
    if (!r.ok) { $("#c-status").innerHTML = statusHtml("error", errorMessage(r)); return; }
    $("#c-status").innerHTML = "";
    $("#c-results").innerHTML = `
      <div class="card" style="margin-bottom:12px"><h3>Original</h3><p>${esc(r.data.original)}</p></div>
      ${r.data.alternatives.map((alt, i) => `
        <div class="alt-item"><div class="alt-text"><strong>Alternative ${i + 1}.</strong> ${esc(alt)}</div>
        <button class="btn btn-sm" data-copy="${esc(alt)}">${icon("copy")}<span class="btn-text">Copy this version</span></button></div>`).join("")}`;
    $$("#c-results [data-copy]").forEach((b) => b.addEventListener("click", async () => {
      await navigator.clipboard.writeText(b.dataset.copy);
      setBtnLabel(b, "Copied"); setTimeout(() => { setBtnLabel(b, "Copy this version"); }, 1500);
    }));
  });
  $("#c-clear").addEventListener("click", () => { $("#c-input").value = ""; $("#c-results").innerHTML = ""; $("#c-status").innerHTML = ""; });
}

/* ---------------- Writing Analysis ---------------- */
function metricCard(label, value, hint, ic) {
  return `<div class="metric"><div class="m-head"><div class="value">${esc(String(value))}</div>${ic ? `<span class="m-icon">${icon(ic)}</span>` : ""}</div><div class="label">${esc(label)}</div><div class="hint">${esc(hint)}</div></div>`;
}
function analysisHtml(a, title) {
  return `<h3 style="margin-top:20px">${esc(title)}</h3><div class="metrics">
    ${metricCard("Words", a.words, "Total words", "fileText")}
    ${metricCard("Sentences", a.sentences, `Avg ${a.avgSentenceLength} words/sentence`, "layers")}
    ${metricCard("Reading ease", a.fleschReadingEase, "Flesch — higher is easier", "eye")}
    ${metricCard("Grade level", a.fleschKincaidGrade, "Flesch–Kincaid, US grade", "book")}
    ${metricCard("Vocabulary diversity", a.lexicalDiversity, "Unique words ÷ total words", "zap")}
    ${metricCard("Sentence variation", a.sentenceLengthVariation, "Std. dev. of sentence length", "refresh")}
    ${metricCard("Long sentences", `${Math.round(a.longSentenceShare * 100)}%`, "Share over 30 words", "alert")}
    ${metricCard("Reading time", `${a.readingTimeMinutes} min`, "At ~200 wpm", "clock")}
    ${metricCard("Filler words", a.fillerCount, "very, really, just, actually…", "trash")}
    ${metricCard("Tone", a.tone.label, `${a.tone.contractions} contractions · ${a.tone.formalWords} formal markers`, "info")}
  </div>
  ${a.repeatedWords.length ? `<p class="small" style="margin-top:12px"><strong>Most repeated words:</strong> ${a.repeatedWords.map((r) => `${esc(r.word)} (×${r.count})`).join(", ")}</p>` : `<p class="small muted" style="margin-top:12px">No word is repeated 3+ times — good variety.</p>`}`;
}
function renderAnalysis() {
  view.innerHTML = `
  <section class="workspace">
    <h1 class="page-title">${icon("chart")} Writing Analysis</h1>
    <p class="muted">Transparent editorial indicators for your writing — before and after refinement. These are computed directly from the text; they are <strong>not scientifically validated scores</strong>.</p>
    <div class="panels">
      <div class="panel"><div class="panel-head"><span>Original text</span></div>
        <div class="panel-body"><textarea id="an-input" rows="10" placeholder="Paste the original text…">${esc(state.lastOriginal)}</textarea></div></div>
      <div class="panel"><div class="panel-head"><span>Refined text (optional)</span></div>
        <div class="panel-body"><textarea id="an-refined" rows="10" placeholder="Paste the refined version to compare…">${esc(state.lastRefined)}</textarea></div></div>
    </div>
    <div class="actions"><button class="btn btn-accent" id="an-run">${icon("chart")}<span class="btn-text">Analyse</span></button><button class="btn" id="an-check-orig">${icon("search")}<span class="btn-text">Check original</span></button><button class="btn" id="an-check-ref" disabled>${icon("search")}<span class="btn-text">Check refined</span></button></div>
    <div id="an-status"></div>
    <div id="an-results"></div>
  </section>`;
  $("#an-check-orig").addEventListener("click", () => { state.checkText = $("#an-input").value; location.hash = "#/checker"; });
  $("#an-check-ref").addEventListener("click", () => { state.checkText = $("#an-refined").value; location.hash = "#/checker"; });
  if (state.lastRefined) { $("#an-check-ref").disabled = false; }
  $("#an-run").addEventListener("click", async () => {
    const text = $("#an-input").value, refined = $("#an-refined").value;
    if (!text.trim()) { $("#an-status").innerHTML = statusHtml("warn", "Paste the original text first."); return; }
    if (refined.trim()) { $("#an-check-ref").disabled = false; }
    const r = await api("/api/analyse", { text, refinedText: refined.trim() || undefined });
    if (!r.ok) { $("#an-status").innerHTML = statusHtml("error", errorMessage(r)); return; }
    $("#an-status").innerHTML = "";
    $("#an-results").innerHTML = analysisHtml(r.data.original, "Original") + (r.data.refined ? analysisHtml(r.data.refined, "Refined") : `<p class="muted" style="margin-top:16px">Paste a refined version above and press Analyse again to see a before/after comparison.</p>`);
  });
}

/* ---------------- AI Checker ---------------- */
function highlightPhrases(sentence, phrases) {
  let out = esc(sentence);
  for (const p of phrases) {
    const ep = esc(p.phrase || p).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!ep) continue;
    out = out.replace(new RegExp(`(${ep})`, "gi"), "<mark>$1</mark>");
  }
  return out;
}
function checkerHtml(r) {
  const bandClass = r.band === "Reads human" ? "teal" : r.band === "Mixed signals" ? "amber" : "red";
  const barColor = r.band === "Reads human" ? "#0d9488" : r.band === "Mixed signals" ? "#d97706" : "#b91c1c";
  const signalCards = r.signals.map((s) => metricCard(s.label, String(s.score), `${s.value}. ${s.detail} Weight ${Math.round(s.weight * 100)}% · contributes ${s.contribution} points.`, "search")).join("");
  const phraseRows = r.flaggedPhrases.length
    ? `<h3 style="margin-top:20px">AI-tell phrases found (${r.flaggedPhrases.length})</h3><table><tr><th>Phrase</th><th>Count</th></tr>${r.flaggedPhrases.map((f) => `<tr><td>“${esc(f.phrase)}”</td><td>${f.count}</td></tr>`).join("")}</table>`
    : `<p class="small muted" style="margin-top:16px">No AI-tell phrases found in this text.</p>`;
  const sentenceList = r.flaggedSentences.length
    ? `<h3 style="margin-top:20px">Flagged sentences</h3><ul class="clean">${r.flaggedSentences.map((s) => `<li>“${highlightPhrases(s, r.flaggedPhrases)}”</li>`).join("")}</ul>`
    : "";
  return `<div class="card">
    <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap">
      <span style="font-size:2.4rem;font-weight:750;letter-spacing:-0.02em">${r.score}<span class="muted" style="font-size:1.2rem"> / 100</span></span>
      <span class="badge ${bandClass}" style="font-size:.9rem">${esc(r.band)}</span>
      <span class="muted">${esc(r.label)} · ${r.words.toLocaleString()} words · ${r.sentences} sentences</span>
    </div>
    <div class="progress"><div style="width:${r.score}%;background:${barColor}"></div></div>
    <p class="small muted">0–30 reads human · 31–60 mixed signals · 61–100 reads AI-generated. The score is the weighted sum of the six signals below — read them to see why.</p>
    ${r.tooShort ? `<p class="small" style="margin-top:8px"><strong>Too short to judge reliably:</strong> this text is under 100 words, so the verdict above is withheld. The score and signals are still shown, but check a longer passage (100+ words) for a more reliable read.</p>` : ""}
    <p class="small muted" style="margin-top:8px">${esc(r.note)}</p>
  </div>
  <h3 style="margin-top:20px">Why this score — six signals</h3>
  <div class="metrics">${signalCards}</div>
  ${phraseRows}
  ${sentenceList}`;
}
function renderChecker() {
  view.innerHTML = `
  <section class="workspace">
    <h1 class="page-title">${icon("search")} AI Checker</h1>
    <p class="muted">Paste any writing and see whether it reads as AI-generated or human. The checker looks at six local signals — AI-tell phrases, sentence rhythm, vocabulary diversity, repetition, sentence shape, and filler transitions — and shows the score <strong>with the breakdown behind it</strong>, so you can see why.</p>
    <p class="small muted">An indicator, not proof — short texts, edited text, and non-native English can all mislead it. It works best on passages of 100 words or more. Your text is processed in memory and never stored.</p>
    <div class="card">
      <label for="ck-input" style="font-weight:650;font-size:.9rem">Text to check</label>
      <textarea id="ck-input" rows="10" placeholder="Paste the text to check…"></textarea>
      <div class="actions"><button class="btn btn-accent" id="ck-run">${icon("search")}<span class="btn-text">Check this text</span></button><button class="btn" id="ck-clear">${icon("trash")}<span class="btn-text">Clear</span></button></div>
      <div id="ck-status"></div>
    </div>
    <div id="ck-results" style="margin-top:16px"></div>
  </section>`;
  const input = $("#ck-input");
  const runCheck = async () => {
    if (!input.value.trim()) { $("#ck-status").innerHTML = statusHtml("warn", "Paste some text first."); return; }
    const btn = $("#ck-run"); btn.disabled = true; setBtnLabel(btn, "Checking…");
    const r = await api("/api/check", { text: input.value });
    btn.disabled = false; setBtnLabel(btn, "Check this text");
    if (!r.ok) { $("#ck-status").innerHTML = statusHtml("error", errorMessage(r)); return; }
    $("#ck-status").innerHTML = "";
    $("#ck-results").innerHTML = checkerHtml(r.data);
  };
  $("#ck-run").addEventListener("click", runCheck);
  $("#ck-clear").addEventListener("click", () => { input.value = ""; $("#ck-results").innerHTML = ""; $("#ck-status").innerHTML = ""; });
  if (state.checkText) { input.value = state.checkText; state.checkText = ""; runCheck(); }
}

/* ---------------- About & Privacy ---------------- */
function renderAbout() {
  view.innerHTML = `
  <section class="workspace narrow">
    <h1 class="page-title">${icon("info")} About Proseforge</h1>
    <p>Proseforge is an AI-powered writing and research refinement platform. It turns robotic, repetitive, unnatural, and poorly constructed AI-assisted writing into natural, sophisticated, contextually appropriate, and genuinely readable prose — from a single paragraph to an entire academic dissertation.</p>
    <p>It is not a paraphrasing tool and not a synonym swapper. The engine reads the whole passage before improving it: sentence construction and rhythm, vocabulary and discipline-specific terminology, paragraph development, transitions, and argument flow — while preserving the author's meaning, facts, and voice.</p>
    <h2>What it will not do</h2>
    <ul>
      <li>Invent facts, statistics, quotations, research findings, or references.</li>
      <li>Change research results, numbers, citations, equations, or quoted material.</li>
      <li>Claim to make text undetectable by AI detectors. Detector-evasion is not a feature, and no such promise is made anywhere on this site.</li>
      <li>Train on your documents, sell your data, or require an account.</li>
    </ul>
    <h2>How it works</h2>
    <p>Proseforge runs on Cloudflare Workers AI — no extra key is needed to operate it. An optional OpenAI-compatible adapter exists for operators who prefer a different provider; it is never required and no key is ever requested from users. Text is processed in memory and never stored. Document handling uses private temporary storage with automatic deletion after 48 hours.</p>
    <h2>Disciplines</h2>
    <p>Social Sciences, Political Science, Public Administration, Business Administration, Management, Economics, Law, Education, Sociology, Psychology, Computer Science, Engineering, Information Technology, Public Health, Natural Sciences, and Humanities. A Political Science dissertation is not refined with the same conventions as an Engineering technical report.</p>
  </section>`;
}
function renderPrivacy() {
  view.innerHTML = `
  <section class="workspace narrow">
    <h1 class="page-title">${icon("shield")} Privacy</h1>
    <p class="muted">Last updated: 19 November 2026. This policy describes what the code actually does.</p>
    <h2>No account, no tracking profile</h2>
    <p>Proseforge has no login, no mandatory email address, no user profiles, and no permanent identifiers. There is nothing to sign up for.</p>
    <h2>What is processed</h2>
    <ul>
      <li><strong>Text you paste</strong> is sent to the Proseforge Worker and then to the configured AI provider (Cloudflare Workers AI by default) for the sole purpose of refining or analysing that text. It is processed in memory and <strong>never stored</strong> by Proseforge.</li>
      <li><strong>Documents you upload</strong> are stored temporarily in private object storage with a random identifier — never under your filename, never at a public URL — and are accessible only through a short-lived token issued for your session.</li>
      <li><strong>Job metadata</strong> is limited to an upload timestamp, file type, size, and processing status. Document content is never stored in the metadata database.</li>
    </ul>
    <h2>What the AI provider receives</h2>
    <p>When you refine text, the provider receives the text you submitted plus the refinement instructions (mode, discipline, intensity). It receives no name, email, or account information, because Proseforge does not collect any. The provider is instructed not to retain or train on the input; that instruction is a request to the provider, not something Proseforge can technically enforce — if that matters for your work, do not submit confidential material.</p>
    <h2>Retention — 48 hours</h2>
    <p>Uploaded documents and temporary processing files are <strong>automatically deleted 48 hours after upload</strong>, measured from the upload time, by a scheduled server-side cleanup job, with an object-storage lifecycle rule as a backstop. There is no client-side countdown: deletion happens on the server whether or not you return. Text you paste is never retained at all.</p>
    <h2>Security</h2>
    <p>All traffic is served over HTTPS with strict security headers. Uploads are validated by file type and content, size-limited, and never executed. Logs and error messages never contain document content. Rate limiting protects the service against abuse.</p>
    <h2>Contact</h2>
    <p>Proseforge is operated as a personal project. For privacy questions, use the repository's issue tracker (see the project README).</p>
  </section>`;
}

/* ---------------- Router ---------------- */
const routes = {
  "": renderHome,
  humanise: renderHumanise,
  research: renderResearch,
  academic: renderAcademic,
  constructor: renderConstructor,
  analysis: renderAnalysis,
  checker: renderChecker,
  about: renderAbout,
  privacy: renderPrivacy,
};
async function route() {
  await loadConfig();
  const hash = (location.hash || "#/").replace(/^#\//, "").split("?")[0];
  const fn = routes[hash];
  setActiveRoute(hash in routes ? hash : "");
  if (fn) { fn(); window.scrollTo(0, 0); }
  else { view.innerHTML = `<section class="workspace"><h1>Page not found</h1><p class="muted">That page does not exist. <a href="#/">Go home</a>.</p></section>`; }
}
window.addEventListener("hashchange", route);
document.addEventListener("DOMContentLoaded", route);
