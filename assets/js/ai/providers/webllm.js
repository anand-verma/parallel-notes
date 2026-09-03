/** Local WebLLM integration for on-device inference using WebGPU. */
import { WEBLLM_VERSION, PREFERRED_MODEL_IDS } from "../../config.js";

let modPromise = null;
let engine = null;
let activeModel = null;
let initPromise = null;
let activeGeneration = false;

export function isWebGPUSupported() { return !!navigator.gpu; }

export async function loadWebLLM() {
  if (!modPromise) modPromise = import(`https://esm.run/@mlc-ai/web-llm@${WEBLLM_VERSION}`);
  return modPromise;
}

export async function discoverWebLLMModels() {
  const mod = await loadWebLLM();
  return (mod.prebuiltAppConfig?.model_list || []).filter(m => PREFERRED_MODEL_IDS.includes(m.model_id));
}

export async function isModelCached(modelId) {
  const mod = await loadWebLLM();
  try { return !!(await mod.hasModelInCache?.(modelId, mod.prebuiltAppConfig)); } catch { return false; }
}

export async function deleteModelCache(modelId) {
  const mod = await loadWebLLM();
  if (typeof mod.deleteModelAllInfoInCache !== "function") throw new Error("This WebLLM version does not expose model cache deletion.");
  await mod.deleteModelAllInfoInCache(modelId, mod.prebuiltAppConfig);
}

export async function clearAllModelCaches(modelIds = null) {
  const mod = await loadWebLLM();
  const knownIds = new Set([
    ...PREFERRED_MODEL_IDS,
    ...((mod.prebuiltAppConfig?.model_list || []).map(record => record.model_id))
  ]);
  (modelIds || []).forEach(id => knownIds.add(id));
  const ids = [...knownIds].filter(Boolean);
  const statuses = await Promise.all(ids.map(async id => [id, await isModelCached(id)]));
  const cached = statuses.filter(([, present]) => present).map(([id]) => id);
  if (engine && typeof engine.unload === "function") {
    try { await engine.unload(); } catch {}
  }
  await Promise.all(cached.map(id => deleteModelCache(id)));
  engine = null;
  activeModel = null;
  return cached.length;
}

export async function interruptGeneration() {
  activeGeneration = false;
  if (engine && typeof engine.interruptGenerate === "function") {
    try { engine.interruptGenerate(); } catch {}
  }
}

export function isGenerating() { return activeGeneration; }

export async function loadModel(modelId, onProgress) {
  if (engine && activeModel === modelId) return engine;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const mod = await loadWebLLM();
    const progress = report => {
      const text = typeof report === "string" ? report : String(report?.text || "");
      let pct = typeof report?.progress === "number" ? report.progress : null;
      if (pct != null) pct = pct <= 1 ? pct * 100 : pct;
      if (pct == null) {
        const match = text.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*%/);
        pct = match ? Number(match[1]) : null;
      }
      if (pct != null && Number.isFinite(pct)) pct = Math.max(0, Math.min(100, pct));
      onProgress?.(pct, text);
    };
    try {
      engine = await mod.CreateMLCEngine(modelId, {
        appConfig: mod.prebuiltAppConfig,
        initProgressCallback: progress,
        engineConfig: { requestAdapterOptions: { powerPreference: "high-performance" } }
      });
      activeModel = modelId;
      return engine;
    } catch (error) {
      engine = null; activeModel = null;
      throw new Error(`Model "${modelId}" failed to load: ${error?.message || String(error)}`);
    }
  })();
  try { return await initPromise; } finally { initPromise = null; }
}

export function currentModel() { return activeModel; }

export async function generateWebLLM(modelId, messages, { onToken, onProgress, signal } = {}) {
  if (signal?.aborted) throw new DOMException("Generation cancelled.", "AbortError");
  const e = await loadModel(modelId, onProgress);
  if (signal?.aborted) throw new DOMException("Generation cancelled.", "AbortError");

  let interrupted = false;
  const abort = () => {
    interrupted = true;
    try { e.interruptGenerate?.(); } catch {}
  };
  signal?.addEventListener("abort", abort, { once: true });
  activeGeneration = true;

  try {
    const stream = await e.chat.completions.create({
      messages, temperature: 0.15, top_p: 0.9, max_tokens: 2048, stream: true
    });
    let full = "";
    for await (const chunk of stream) {
      if (signal?.aborted || interrupted) throw new DOMException("Generation cancelled.", "AbortError");
      const delta = chunk?.choices?.[0]?.delta?.content || "";
      if (delta) { full += delta; onToken?.(delta, full); }
    }
    return full.trim();
  } finally {
    activeGeneration = false;
    signal?.removeEventListener("abort", abort);
  }
}
