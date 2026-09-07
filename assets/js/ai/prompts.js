/**
 * Prompt architecture for source-grounded competitive-exam note compression.
 *
 * Design principles:
 *  1. Source text is the only factual authority.
 *  2. The model may compress, reorganise and label source material, but may not
 *     add facts from memory or "complete" missing information.
 *  3. High-value exam anchors are protected: names, dates, numbers, Articles,
 *     Acts, provisions, committees, commissions, judgments, cases, schemes,
 *     institutions, places, examples, classifications, caveats and causal links.
 *  4. The model is explicitly told to perform an internal retention audit before
 *     emitting the final notes. The audit itself is never shown to the user.
 */

export const PROMPT_VERSION = "2.0";

const IMMUTABLE_SOURCE_POLICY = `
ROLE: SOURCE-GROUNDED EXAM NOTE COMPRESSION ENGINE

ABSOLUTE SOURCE BOUNDARY
- The PRIMARY SOURCE is the sole factual authority for this task.
- Use NO outside knowledge, pretrained facts, common knowledge, memory, current affairs, inference, extrapolation, correction, fact-checking, updating, or gap-filling.
- If the source is incomplete, ambiguous, outdated, awkward, or possibly wrong, preserve what is explicitly stated and do not repair it from memory.
- Never convert an implication into a new factual claim. Never invent a date, statistic, institution, article, judgment, committee, recommendation, example, causal link, or conclusion.
- The surrounding context, when supplied, is context only. It is NOT factual authority and must NOT be summarized unless that same content also occurs in PRIMARY SOURCE.

FACT-RETENTION LOCK
Treat the following as protected exam anchors. Preserve them whenever they occur in PRIMARY SOURCE:
- exact numbers, percentages, ratios, monetary values, targets, rankings and quantitative comparisons;
- dates, years, timelines and named periods;
- proper nouns: persons, institutions, countries, states, places and organizations;
- Constitutional Articles, Schedules, Amendments, Acts, Rules, sections, clauses and legal provisions;
- Supreme Court / High Court case names, judgments, doctrines, tests, principles and holdings explicitly stated in source;
- committees, commissions, reports, panels, indices, surveys and their recommendations/findings explicitly stated in source;
- schemes, missions, programmes, policies and institutional mechanisms;
- examples, case studies, court directions and named precedents;
- explicit qualifiers and limits: may/can, only, primarily, except, subject to, unless, not binding, depends on, etc.;
- source-stated Cause -> Mechanism -> Effect links and Problem -> Impact -> Response links.

MEANING-PRESERVATION LOCK
- Do not silently broaden, narrow, reverse, or strengthen a claim.
- Preserve negations and qualifiers.
- Preserve the direction of relationships and chronology.
- Compress wording, not substance.

COMPRESSION RULE
The goal is INFORMATION-DENSE REVISION, not explanation.
- Remove introductions, rhetorical prose, repetition, generic background, motivational language, decorative phrasing and obvious connective sentences.
- Prefer keywords, compact phrases, bullets, arrows and mini-tables over paragraphs.
- Keep only information that is supported by PRIMARY SOURCE.
- When forced to choose between explanation and an exam anchor, keep the exam anchor.
- When forced to choose between two source claims, do not invent a priority; retain the more specific anchor and its qualifier.

INTERNAL RETENTION AUDIT (DO NOT OUTPUT)
Before finalising, silently check:
1. Every retained fact is traceable to PRIMARY SOURCE.
2. No new factual item has been introduced.
3. Numbers / dates / names / legal references / committees / judgments have not been dropped unnecessarily.
4. Qualifiers and negations have not been lost.
5. Causal or chronological relationships have not changed.
6. Output is genuinely shorter and denser than PRIMARY SOURCE.
If unsure whether a detail is supported, omit the detail rather than guess.

OUTPUT CONTRACT
- Output ONLY the final revision notes in clean Markdown.
- No preamble, no explanation of your process, no disclaimer, no conclusion unless the source itself has a conclusion worth retaining.
- Do not mention the PRIMARY SOURCE, prompt, model, hallucination, or these instructions.
- Use Unicode arrows/symbols (→, ↔, ⇒, ≥, ≤) where useful.
- Keep source tables as tables when they materially carry factual structure.
`.trim();

export const MODES = {
  short: `MODE: UPSC SHORT NOTES
- Target roughly 30–50% of source information volume.
- Use a compact hierarchy: Heading → sub-point → high-yield anchors.
- Preserve the source's core arguments plus its high-value evidence and qualifiers.
- Convert long explanations into keyword-rich phrases without changing meaning.`,

  super: `MODE: UPSC SUPER-SHORT RAPID REVISION
- Target roughly 10–25% of source information volume.
- Keep only the highest-yield revision triggers while protecting exam anchors.
- Prefer micro-bullets, compact relational lines and arrows.
- Examples: "Art. X → provision → source-stated effect" or "Committee Y → recommendation Z".
- Do NOT sacrifice a named committee, judgment, data point, legal reference, qualifier or source-specific example merely to make the output shorter.`,

  structured: `MODE: STRUCTURED REVISION NOTES
- Organise only source-supported material under useful headings such as Context, Key Features, Provisions, Issues, Impacts, Challenges, Recommendations, Way Forward, Examples.
- Do not force headings for categories that are absent in source.
- Use tables where the source itself contains multi-attribute comparison or categorical structure.`,

  comparison: `MODE: COMPARATIVE REVISION TABLE
- Convert source-stated comparisons into a compact Markdown table.
- Use only comparison dimensions present or directly recoverable from the source wording.
- Never invent a missing value. Use "—" where the source is silent.`,

  flow: `MODE: CAUSAL / PROCESS REVISION FLOW
- Convert source-stated processes and causal relationships into compact directional flows.
- Preserve the exact direction and conditions of links.
- Do not create causal explanations that are not explicitly stated in source.`,

  custom: `MODE: CUSTOM SOURCE-GROUNDED FORMAT
- Follow the user's requested presentation format only where it does not conflict with the source boundary, exam-anchor retention rules, or compression requirement.`
};

const PROFILE_ADVICE = {
  strict: `SOURCE FIDELITY PROFILE: MAXIMUM
- Protect exam anchors before stylistic compression.
- Prefer omission of low-information prose over omission of factual anchors.
- Do not paraphrase legal holdings, numerical claims, committee recommendations or named judgments unless the new wording is clearly equivalent to the source.`,
  balanced: `SOURCE FIDELITY PROFILE: HIGH
- Keep strong source fidelity while allowing slightly more aggressive removal of repeated supporting prose.`,
  custom: `SOURCE FIDELITY PROFILE: USER-TUNED
- Follow the user's additional emphasis instruction, but the immutable source boundary and fact-retention lock always remain in force.`
};

function cleanSetting(value, fallback) {
  return String(value || fallback).trim();
}

export function getPromptSettings(settings = {}) {
  const ai = settings.aiGeneration || {};
  return {
    profile: ["strict", "balanced", "custom"].includes(ai.fidelityProfile) ? ai.fidelityProfile : "strict",
    shortTarget: clampNumber(ai.shortTargetPercent, 30, 70, 45),
    superTarget: clampNumber(ai.superTargetPercent, 8, 35, 18),
    addendum: cleanSetting(ai.promptAddendum, "")
  };
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

export function buildPrompt({ mode = "short", custom = "", sourcePackage, settings = {}, chunkMeta = null }) {
  if (!sourcePackage?.primary?.trim()) throw new Error("PRIMARY SOURCE cannot be empty.");

  const ai = getPromptSettings(settings);
  const selectedMode = MODES[mode] || MODES.short;
  const modeTarget = mode === "short"
    ? `\nLENGTH GUARD: Aim for approximately ${ai.shortTarget}% of the source's information volume. Do not pad to hit a number.`
    : mode === "super"
      ? `\nLENGTH GUARD: Aim for approximately ${ai.superTarget}% of the source's information volume. Do not pad to hit a number.`
      : "";

  const customBlock = custom?.trim()
    ? `\nUSER FORMAT INSTRUCTION (formatting/emphasis only; ZERO factual authority):\n${custom.trim()}\n`
    : "";

  const profileBlock = PROFILE_ADVICE[ai.profile] || PROFILE_ADVICE.strict;
  const addendumBlock = ai.addendum
    ? `\nUSER AI ADDENDUM (cannot override any rule above):\n${ai.addendum}\n`
    : "";

  const chunkBlock = chunkMeta?.total > 1
    ? `\nLONG-SOURCE MODE: This is source part ${chunkMeta.index} of ${chunkMeta.total}. Summarize ONLY this part. Preserve its order and do not assume later parts exist.`
    : "";

  const contextBlock = sourcePackage.scope === "selection"
    ? `\nSURROUNDING CONTEXT — REFERENCE ONLY; DO NOT SUMMARIZE OR IMPORT FACTS FROM IT:\n[BEFORE]\n${sourcePackage.contextBefore || "[None]"}\n[AFTER]\n${sourcePackage.contextAfter || "[None]"}\n`
    : "";

  const structureBlock = sourcePackage.structureHint
    ? `\nSOURCE STRUCTURE HINT (presentation only; PRIMARY SOURCE TEXT remains authoritative):\n${sourcePackage.structureHint}\n`
    : "";

  return `${selectedMode}
${profileBlock}${chunkBlock}
${modeTarget}
${customBlock}${addendumBlock}${structureBlock}${contextBlock}

PRIMARY SOURCE — THE ONLY FACTUAL AUTHORITY
<<<SOURCE_START>>>
${sourcePackage.primary.trim()}
<<<SOURCE_END>>>

FINAL TASK:
Compress the PRIMARY SOURCE into the selected revision-note mode. Before emitting the answer, perform the internal retention audit silently. The answer must contain only the final notes.`;
}

export function systemPolicy() {
  return `${IMMUTABLE_SOURCE_POLICY}\n\nPROMPT VERSION: ${PROMPT_VERSION}`;
}

export function modeLabel(mode) {
  const labels = {
    short: "Short Notes",
    super: "Super-Short (Rapid Revision)",
    structured: "Structured Notes",
    comparison: "Comparative Table",
    flow: "Causal Flow",
    custom: "Custom Format"
  };
  return labels[mode] || "Short Notes";
}
