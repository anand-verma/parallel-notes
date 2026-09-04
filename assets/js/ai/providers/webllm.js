/** Local WebLLM integration for on-device inference using WebGPU. */
import { WEBLLM_VERSION, PREFERRED_MODEL_IDS } from "../../config.js";

let modPromise = null;
let engine = null;
let activeModel = null;
let initPromise = null;
let initModelId = null;
let generationPromise = null;
let activeGeneration = false;

export function isWebGPUSupported() { return !!navigator.gpu; }

export async function getWebGPUStatus() {
  if (!navigator.gpu) return { supported: false, adapter: null, reason: "WebGPU is not exposed by this browser." };
  try {
    // Prefer the browser's default compatible adapter. This is deliberately
    // less restrictive than forcing a discrete/high-performance GPU.
    const adapter = await navigator.gpu.requestAdapter();
    if (adapter) return { supported: true, adapter, powerPreference: "default" };
  } catch {}
  try {
    const preferred = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (preferred) return { supported: true, adapter: preferred, powerPreference: "high-performance" };
  } catch {}
  return { supported: false, adapter: null, reason: "WebGPU is exposed, but the browser could not obtain a compatible GPU adapter." };
}

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

/**
 * Wait until any active local generation has fully unwound. Interrupting the
 * engine is not enough: cache deletion/model switching must happen only after
 * the streaming iterator has reached its finally block.
 */
export async function waitForGenerationIdle() {
  if (generationPromise) {
    try { await generationPromise; } catch { /* caller owns the generation error */ }
  }
}

export async function clearAllModelCaches(modelIds = null) {
  if (activeGeneration || generationPromise) {
    throw new Error("Local AI is still generating. Stop the generation and try again.");
  }
  // A model may still be loading even when generation has not started. Never
  // delete caches while a load is in flight.
  if (initPromise) {
    try { await initPromise; } catch { /* failed load is safe to clean up */ }
  }

  const mod = await loadWebLLM();
  const knownIds = new Set([
    ...PREFERRED_MODEL_IDS,
    ...((mod.prebuiltAppConfig?.model_list || []).map(record => record.model_id))
  ]);
  (modelIds || []).forEach(id => knownIds.add(id));
  const ids = [...knownIds].filter(Boolean);
  const statuses = await Promise.all(ids.map(async id => [id, await isModelCached(id)]));
  const cached = statuses.filter(([, present]) => present).map(([id]) => id);

  await unloadModel();
  await Promise.all(cached.map(id => deleteModelCache(id)));
  return cached.length;
}

export async function interruptGeneration() {
  if (!generationPromise && !activeGeneration) return false;
  if (engine && typeof engine.interruptGenerate === "function") {
    try { engine.interruptGenerate(); } catch { /* generation cleanup will follow */ }
  }
  return true;
}

export function isGenerating() { return activeGeneration; }

/** Explicitly release the current WebLLM engine and its GPU/WASM resources. */
export async function unloadModel() {
  if (activeGeneration || generationPromise) {
    throw new Error("Cannot unload the local model while generation is active.");
  }
  if (initPromise) {
    try { await initPromise; } catch { /* allow cleanup after failed initialization */ }
  }
  const oldEngine = engine;
  engine = null;
  activeModel = null;
  initModelId = null;
  if (oldEngine && typeof oldEngine.unload === "function") {
    try { await oldEngine.unload(); } catch { /* resource cleanup is best-effort */ }
  }
}

export async function loadModel(modelId, onProgress) {
  if (engine && activeModel === modelId) return engine;
  if (!modelId) throw new Error("A local model ID is required.");
  if (activeGeneration || generationPromise) {
    throw new Error("Stop the current local AI generation before switching models.");
  }

  // If another model is loaded, release its GPU/WASM resources before creating
  // the next engine. Do this before assigning initPromise so switching is
  // serialized and never leaves two heavyweight engines resident.
  if (engine && activeModel !== modelId) await unloadModel();

  if (initPromise) {
    // A concurrent request for the same model can share the in-flight load.
    if (initModelId === modelId) return initPromise;
    await initPromise.catch(() => {});
    if (engine && activeModel === modelId) return engine;
    if (engine && activeModel !== modelId) await unloadModel();
  }

  initModelId = modelId;
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
    let createdEngine = null;
    try {
      // Keep the v0.8 WebLLM initialization path. WebLLM itself selects the
      // compatible adapter; an extra requestAdapter preflight can reject GPU
      // configurations that WebLLM was able to initialize successfully.
      createdEngine = await mod.CreateMLCEngine(modelId, {
        appConfig: mod.prebuiltAppConfig,
        initProgressCallback: progress,
        engineConfig: { requestAdapterOptions: { powerPreference: "high-performance" } }
      });
      engine = createdEngine;
      activeModel = modelId;
      return createdEngine;
    } catch (error) {
      if (createdEngine?.unload) {
        try { await createdEngine.unload(); } catch {}
      }
      engine = null;
      activeModel = null;
      throw new Error(`Model "${modelId}" failed to load: ${error?.message || String(error)}. If WebGPU worked previously, fully reload the page after this update and verify the browser is using the same GPU/driver profile.`);
    }
  })();

  try { return await initPromise; }
  finally {
    initPromise = null;
    initModelId = null;
  }
}

export function currentModel() { return activeModel; }

export async function generateWebLLM(modelId, messages, { onToken, onProgress, signal } = {}) {
  if (signal?.aborted) throw new DOMException("Generation cancelled.", "AbortError");
  const e = await loadModel(modelId, onProgress);
  if (signal?.aborted) throw new DOMException("Generation cancelled.", "AbortError");

  if (activeGeneration || generationPromise) throw new Error("A local AI generation is already running.");

  let interrupted = false;
  const abort = () => {
    interrupted = true;
    try { e.interruptGenerate?.(); } catch {}
  };
  signal?.addEventListener("abort", abort, { once: true });
  activeGeneration = true;

  const operation = (async () => {
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
  })();

  generationPromise = operation;
  try { return await operation; }
  finally {
    if (generationPromise === operation) generationPromise = null;
  }
}
