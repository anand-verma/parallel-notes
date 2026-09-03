/** System prompts and instruction templates for AI generation. */
export const SOURCE_POLICY = `
ROLE: SOURCE-BOUND UPSC GS NOTE COMPRESSION ENGINE

ABSOLUTE SOURCE AUTHORITY
- The supplied PRIMARY SOURCE is the sole factual authority.
- Strictly forbidden: pretrained knowledge, external data, common knowledge, extrapolation, or assumed context.
- Never correct, fact-check, update, or "complete" incomplete source text.
- If a piece of data is ambiguous or absent in the PRIMARY SOURCE, omit it. Never attempt to deduce or backfill it.

DATA & ENTITY RETENTION MANDATE
- Preserve all proper nouns, Constitutional Articles, Amendments, Acts, legal clauses, statutory bodies, commissions/committees, dates, ranks, and exact numeric statistics (%, ₹, $, ratios) verbatim.
- Preserve explicit qualifiers: "may", "can", "primarily", "subject to", "except", "not binding".
- Do NOT alter causal directions: maintain exact "Cause → Effect" and "Challenge → Solution" links.

COMPRESSION & OUTPUT RULES
- Condense by removing narrative prose, redundant transitions, and stylistic filler.
- Output ONLY the synthesized revision notes in clean Markdown.
- No meta-talk, preamble ("Here are the notes:"), conclusions, or evaluation.
- Retain tables: If the primary source contains tabular comparisons, retain them as clean Markdown tables.
- Use native Unicode symbols (e.g., →, ↔, ⇒) instead of LaTeX syntax.
`.trim();

export const MODES = {
  short: `TASK: UPSC Short Notes (30–50% source volume)
- High-yield revision format using tight bullet hierarchies and bold key phrases.
- Retain all core arguments, examples, and committee recommendations intact.`,

  super: `TASK: UPSC Super-Short Rapid Revision (10–25% source volume)
- Micro-triggers, high-density keywords, and compact relational lines (e.g., "Art. 356 → Pres. Rule → SR Bommai safeguards").
- Retain only core anchors, articles, data points, and outcomes.`,

  structured: `TASK: Structured GS Syllabus-Aligned Notes
- Categorize using explicit headings (Context / Provisions / Challenges / Way Forward).
- Use compact Markdown tables for multi-attribute comparisons.`,

  comparison: `TASK: Comparative Revision Table
- Synthesize all explicitly stated comparisons into a structured Markdown table.
- Do NOT invent comparison parameters or hallucinate values for missing cells; use "—" if unspecified in source.`,

  flow: `TASK: Causal Flow & Mechanism Map
- Represent processes using sequential directional flows (Step 1 → Step 2 → Outcome).
- Map causes, mechanisms, and consequences exactly as provided in the source.`,

  custom: `TASK: Custom Formatting
- Apply the USER CUSTOM INSTRUCTION strictly within the boundaries of the SOURCE AUTHORITY.`
};

export function buildPrompt({ mode = "short", custom = "", sourcePackage }) {
  if (!sourcePackage?.primary?.trim()) {
    throw new Error("PRIMARY SOURCE cannot be empty.");
  }

  const selectedMode = MODES[mode] || MODES.short;
  
  const customBlock = custom?.trim()
    ? `\nUSER FORMATTING OVERRIDE (Structure only; zero authority to introduce outside facts):\n${custom.trim()}\n`
    : "";

  const contextBlock = sourcePackage.scope === "selection"
    ? `SURROUNDING CONTEXT (For reference only; DO NOT summarize this):\n[BEFORE]: ${sourcePackage.contextBefore || "[None]"}\n[AFTER]: ${sourcePackage.contextAfter || "[None]"}\n`
    : "";

  return `${selectedMode}
${customBlock}
${contextBlock}
PRIMARY SOURCE TEXT TO CONDENSE (Absolute Boundary):
"""
${sourcePackage.primary.trim()}
"""`;
}

export function systemPolicy() {
  return SOURCE_POLICY;
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