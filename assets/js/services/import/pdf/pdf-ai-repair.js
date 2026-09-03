export async function repairStructureWithAI({ extraction, ai, modelId, signal, onProgress }) {
  if (!ai) throw new Error("AI is unavailable for Enhanced PDF import.");
  const lines = extraction.pages.flatMap(page => page.lines.map(line => line.text));
  if (!lines.length) return extraction;
  const numbered = lines.map((text, i) => `${i + 1}: ${text}`).join("\n");
  const system = `You are a document-structure classifier. You MUST preserve every supplied line exactly and must never summarize, paraphrase, correct, add, delete, or reorder text. Your only job is to group numbered lines into structural blocks.`;
  const user = `Classify these numbered PDF text lines. Return JSON only, no markdown fences: [{"start":1,"end":2,"type":"paragraph|heading|bullet|numbered|table","level":1}]. Every line must belong to exactly one block. Blocks must be contiguous, non-overlapping, cover all lines from 1 through ${lines.length}, and preserve line order. Use table only when adjacent lines clearly form table rows.\n\n${numbered}`;
  const result = await ai.runRaw({ system, user, modelId, onProgress, signal });
  let parsed;
  try { parsed = JSON.parse(result.replace(/^```json\s*|\s*```$/g, "").trim()); } catch { throw new Error("Enhanced PDF import could not validate the AI structure response."); }
  if (!Array.isArray(parsed) || !parsed.length) throw new Error("Enhanced PDF import returned an invalid structure.");
  const total = lines.length;
  let cursor = 1;
  const valid = parsed.every(block => {
    const ok = Number.isInteger(block.start) && Number.isInteger(block.end) && block.start === cursor && block.end >= block.start && block.end <= total && /^(paragraph|heading|bullet|numbered|table)$/.test(block.type);
    if (ok) cursor = block.end + 1;
    return ok;
  }) && cursor === total + 1;
  if (!valid) throw new Error("Enhanced PDF import returned unsafe or incomplete line ranges.");
  return { ...extraction, aiStructure: parsed };
}
