import { API_MODELS, PREFERRED_MODEL_IDS } from "../config.js";

/* ── Metadata helpers ───────────────────────────── */
function parseParamSize(id) {
  const m = id.match(/(\d+(?:\.\d+)?)\s*B/i);
  return m ? `${m[1]}B` : "—";
}

function parseQuantization(id) {
  const m = id.match(/(q\d+f\d+(?:_\d+)?)/i);
  return m ? m[1] : "—";
}

function localModel(record) {
  const id = record.model_id;
  return {
    id,
    label: id,
    type: "local",
    protocol: "webllm",
    provider: "local",
    vram: record.vram_required_MB || 0,
    paramSize: parseParamSize(id),
    quantization: parseQuantization(id),
    lowMemory: /0\.5B|1B|1\.5B|2B|3B|Phi-3\.5-mini|Qwen2\.5-1\.5B/i.test(id),
    webllmRecord: record,
    isCached: false
  };
}

/* ── Discovery ──────────────────────────────────── */
export function discoverLocalModels(webllmConfig, enabledIds = null) {
  const records = webllmConfig?.model_list || [];
  const allowed = new Set(enabledIds || PREFERRED_MODEL_IDS);
  return records.filter(r => allowed.has(r.model_id)).map(localModel);
}

/** Look up a model ID in the full WebLLM catalog and return its local model record if valid. */
export function lookupWebLLMModel(webllmConfig, modelId) {
  const records = webllmConfig?.model_list || [];
  const record = records.find(r => r.model_id === modelId);
  return record ? localModel(record) : null;
}

/* ── Registry ───────────────────────────────────── */
export function buildModelRegistry({ localModels = [], customModels = [], settings = {} } = {}) {
  const removed = new Set(settings.removedApiModels || []);
  const addedGemini = (settings.addedApiModels?.gemini || []).map(id => ({
    id, label: id, provider: "gemini", type: "api", protocol: "gemini"
  }));
  const addedOpenai = (settings.addedApiModels?.openai || []).map(id => ({
    id, label: id, provider: "openai", type: "api", protocol: "openai-compatible",
    baseUrl: "https://api.openai.com/v1"
  }));

  const builtInApi = API_MODELS.filter(m => !removed.has(m.id));
  const allModels = [...builtInApi, ...addedGemini, ...addedOpenai, ...customModels, ...localModels];

  const byId = new Map();
  allModels.forEach(model => {
    if (model?.id && !byId.has(model.id)) byId.set(model.id, model);
  });
  return [...byId.values()];
}

/* ── Grouping ───────────────────────────────────── */
export function groupModelsByProvider(models) {
  const groups = { local: [], gemini: [], openai: [], custom: [] };
  for (const m of models) {
    const key = m.type === "local" ? "local"
      : m.provider === "gemini" ? "gemini"
      : m.provider === "openai" ? "openai"
      : "custom";
    groups[key].push(m);
  }
  return groups;
}

/* ── Selection ──────────────────────────────────── */
export function preferredModel(models) {
  const local = models.filter(m => m.type === "local");
  const cached = local.find(m => m.isCached);
  if (cached) return cached.id;
  const preferred = PREFERRED_MODEL_IDS.find(id => local.some(m => m.id === id));
  if (preferred) return preferred;
  const low = local.find(m => m.lowMemory);
  return low?.id || local[0]?.id || models[0]?.id || "";
}

export function modelReady(model, credentials) {
  if (!model) return false;
  if (model.type === "local") return !!model.isCached;
  return !!credentials(model.provider, model);
}

