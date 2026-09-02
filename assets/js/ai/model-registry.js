import { API_MODELS, PREFERRED_MODEL_IDS } from "../config.js";

function localModel(record) {
  return {
    id: record.model_id,
    label: record.model_id,
    type: "local",
    protocol: "webllm",
    vram: record.vram_required_MB || 0,
    lowMemory: /0\.5B|1B|1\.5B|2B|3B|Phi-3\.5-mini|Qwen2\.5-1\.5B/i.test(record.model_id),
    webllmRecord: record,
    isCached: false
  };
}

export function discoverLocalModels(webllmConfig) {
  const records = webllmConfig?.model_list || [];
  const allowed = new Set(PREFERRED_MODEL_IDS);
  return records.filter(r => allowed.has(r.model_id)).map(localModel);
}

export function buildModelRegistry({ localModels = [], customModels = [] } = {}) {
  const byId = new Map();
  [...API_MODELS, ...customModels, ...localModels].forEach(model => {
    if (model?.id && !byId.has(model.id)) byId.set(model.id, model);
  });
  return [...byId.values()];
}

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
