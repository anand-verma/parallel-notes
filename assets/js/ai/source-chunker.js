/**
 * Long-source safety layer.
 *
 * Goal: prevent a single generation request from silently terminating at the
 * model's output ceiling. The source is split only at paragraph/list/table
 * boundaries whenever possible, preserving order and all source text.
 *
 * Token counts are deliberately estimated rather than tokenizer-specific so
 * the same layer works across Gemini, OpenAI-compatible APIs and WebLLM.
 */

const DEFAULT_CONTEXT = 16384;
const MIN_CHUNK_TOKENS = 1200;
const PROMPT_RESERVE_TOKENS = 1800;
const CHARS_PER_TOKEN = 4;

export function estimateTokens(text = "") {
  const value = String(text || "");
  if (!value) return 0;
  // Slightly conservative for mixed UPSC prose, markdown and Indian names.
  return Math.ceil(value.length / CHARS_PER_TOKEN);
}

export function splitSourceForGeneration(sourcePackage, settings = {}, mode = "short") {
  if (!sourcePackage?.primary?.trim()) throw new Error("PRIMARY SOURCE cannot be empty.");

  const ai = settings.aiGeneration || {};
  const enabled = ai.autoChunkLongDocuments !== false;
  if (!enabled) return [makeChunk(sourcePackage, sourcePackage.primary.trim(), 1, 1, false)];

  const contextTokens = normalizeContext(ai.contextTokens || ai.localContextTokens || DEFAULT_CONTEXT);
  const sourceTokens = estimateTokens(sourcePackage.primary);

  // Leave space for system prompt + user task + output. 0.55 is intentionally
  // conservative: short notes can expand around dense factual blocks.
  const targetInputTokens = Math.max(
    MIN_CHUNK_TOKENS,
    Math.floor(contextTokens * 0.55) - PROMPT_RESERVE_TOKENS
  );

  // If the source fits comfortably, don't chunk it. This preserves the best
  // global coherence for ordinary notes.
  if (sourceTokens <= targetInputTokens) {
    return [makeChunk(sourcePackage, sourcePackage.primary.trim(), 1, 1, false)];
  }

  const units = splitIntoUnits(sourcePackage.primary);
  if (!units.length) return [makeChunk(sourcePackage, sourcePackage.primary.trim(), 1, 1, false)];

  const chunks = [];
  let current = [];
  let currentTokens = 0;

  const flush = () => {
    if (!current.length) return;
    const text = current.join("\n\n").trim();
    if (text) chunks.push(text);
    current = [];
    currentTokens = 0;
  };

  for (const unit of units) {
    const unitTokens = estimateTokens(unit);
    if (current.length && currentTokens + unitTokens > targetInputTokens) flush();

    // A single giant paragraph/table cannot be split semantically. Hard-split
    // only this unit, preserving every character and order.
    if (unitTokens > targetInputTokens) {
      flush();
      chunks.push(...hardSplitText(unit, targetInputTokens));
      continue;
    }

    current.push(unit);
    currentTokens += unitTokens;
  }
  flush();

  return chunks.map((text, index) => makeChunk(sourcePackage, text, index + 1, chunks.length, true));
}

function makeChunk(sourcePackage, primary, index, total, chunked) {
  return {
    ...sourcePackage,
    primary,
    // Repeating the entire document-level structure hint defeats the purpose
    // of chunking. The actual chunk text already contains the source headings.
    structureHint: chunked ? "" : sourcePackage.structureHint,
    chunked,
    chunkIndex: index,
    chunkCount: total,
    label: chunked ? `Full source · part ${index}/${total}` : sourcePackage.label
  };
}

function normalizeContext(value) {
  const allowed = [4096, 8192, 16384, 32768, 65536, 131072, 262144];
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_CONTEXT;
  return allowed.reduce((best, current) =>
    Math.abs(current - n) < Math.abs(best - n) ? current : best, allowed[0]);
}

function splitIntoUnits(text) {
  // Keep markdown tables together row-by-row and headings with their following
  // paragraph/list content as independent units. Blank-line splitting is a
  // robust common denominator for Tiptap's editor output.
  const raw = String(text || "").replace(/\r\n?/g, "\n").trim();
  if (!raw) return [];

  const paragraphs = raw.split(/\n{2,}/).map(x => x.trim()).filter(Boolean);
  const units = [];

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    // Markdown table may have each row on its own line without blank lines.
    if (/^\s*\|.*\|\s*$/.test(p)) {
      units.push(p);
      continue;
    }
    units.push(p);
  }
  return units;
}

function hardSplitText(text, targetTokens) {
  const targetChars = Math.max(1000, targetTokens * CHARS_PER_TOKEN);
  const out = [];
  let rest = String(text || "");

  while (rest.length > targetChars) {
    let cut = rest.lastIndexOf("\n", targetChars);
    if (cut < targetChars * 0.55) cut = rest.lastIndexOf(". ", targetChars);
    if (cut < targetChars * 0.55) cut = targetChars;
    else if (rest[cut] === ".") cut += 1;

    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}
