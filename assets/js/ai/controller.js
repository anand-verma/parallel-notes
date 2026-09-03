import { buildModelRegistry, discoverLocalModels, preferredModel, groupModelsByProvider } from "./model-registry.js";
import { isWebGPUSupported, isModelCached, loadModel, currentModel } from "./providers/webllm.js";
import { AIService } from "./ai-service.js";

export class AIController {
  constructor({ ui, settings }) {
    this.ui = ui;
    this.settings = settings;
    this.models = [];
    this.selectedModel = "";
    this.busy = false;
    this.abortController = null;
    this.service = new AIService({ settings });
    this.webllmConfig = null;
  }

  async init() {
    this.ui.setAIStatus("Detecting models…", "loading");
    let localModels = [];
    if (isWebGPUSupported()) {
      const config = await (await import("./providers/webllm.js")).loadWebLLM();
      this.webllmConfig = config.prebuiltAppConfig;
      const enabledIds = this.settings.enabledLocalModels;
      localModels = discoverLocalModels(this.webllmConfig, enabledIds);
    }
    this.models = buildModelRegistry({
      localModels,
      customModels: this.settings.customApiModels || [],
      settings: this.settings
    });
    if (!this.models.length) throw new Error("No AI models were found.");
    const next = this.selectedModel && this.models.some(m => m.id === this.selectedModel) ? this.selectedModel : preferredModel(this.models);
    this.selectedModel = next;
    this.ui.renderModelPicker(this.models, this.selectedModel);
    this.ui.setAIStatus("AI ready", "ready");
    // Cache status is informational; don't block the initial UI on storage reads.
    void this.refreshCacheStatus();
    return { models: this.models };
  }

  async refreshCacheStatus() {
    const local = this.models.filter(m => m.type === "local");
    const statuses = await Promise.all(local.map(async model => [model.id, await isModelCached(model.id)]));
    const statusMap = new Map(statuses);
    local.forEach(model => { model.isCached = !!statusMap.get(model.id); });
    this.ui.renderModelPicker(this.models, this.selectedModel);
  }

  /** Rebuild the full model registry from settings. Call after any model add/remove. */
  rebuildRegistry() {
    const localModels = this.webllmConfig
      ? discoverLocalModels(this.webllmConfig, this.settings.enabledLocalModels)
      : [];
    // Carry over isCached from existing models
    const oldMap = new Map(this.models.map(m => [m.id, m]));
    localModels.forEach(m => { if (oldMap.has(m.id)) m.isCached = oldMap.get(m.id).isCached; });

    this.models = buildModelRegistry({
      localModels,
      customModels: this.settings.customApiModels || [],
      settings: this.settings
    });
    if (!this.models.some(m => m.id === this.selectedModel)) {
      this.selectedModel = preferredModel(this.models);
    }
    this.ui.renderModelPicker(this.models, this.selectedModel);
  }

  getWebLLMConfig() { return this.webllmConfig; }

  setModel(id) { if (this.models.some(m => m.id === id)) this.selectedModel = id; }
  getModelDef() { return this.models.find(m => m.id === this.selectedModel); }

  async loadSelectedModel() {
    const model = this.getModelDef();
    if (!model || model.type !== "local") return true;
    this.ui.setAIStatus("Loading local model · 0%", "loading");
    const cached = !!model.isCached;
    this.ui.updateModelProgress(0, cached ? "Loading from local cache…" : "Downloading model…");
    await loadModel(model.id, (pct, text) => this.ui.updateModelProgress(pct, text));
    this.ui.closeModelDialog();
    model.isCached = true;
    this.ui.renderModelPicker(this.models, this.selectedModel);
    this.ui.setAIStatus("Local AI ready", "ready");
    return true;
  }

  /** Download a specific model by ID (used from model picker download button). */
  async downloadModel(modelId) {
    const model = this.models.find(m => m.id === modelId);
    if (!model || model.type !== "local") return;
    const prev = this.selectedModel;
    this.selectedModel = modelId;
    this.ui.openModelDialog(modelId);
    try {
      await this.loadSelectedModel();
      this.ui.resolveModelLoad(true);
    } catch (err) {
      this.selectedModel = prev;
      this.ui.resolveModelLoad(false);
      throw err;
    }
  }

  async run(args) {
    if (this.busy) throw new Error("A generation is already running.");
    this.busy = true;
    this.abortController = new AbortController();
    try {
      const model = this.getModelDef();
      if (!model) throw new Error("Choose an AI model first.");
      // Download guard: local models must be downloaded first via the ⬇ button
      if (model.type === "local" && currentModel() !== model.id) {
        if (!model.isCached) {
          throw new Error("Download this model first using the ⬇ button in the model selector.");
        }
        // Cached but not loaded into WASM memory — auto-load silently
        this.ui.setAIStatus("Loading local model…", "loading");
        await loadModel(model.id, (pct, text) => this.ui.updateModelProgress(pct, text));
      }
      this.ui.setAIStatus("Generating…", "loading");
      const result = await this.service.generate({ ...args, model, onProgress: (p, t) => this.ui.updateModelProgress(p, t), signal: this.abortController.signal });
      this.ui.setAIStatus(`${model.type === "local" ? "Local" : "Cloud"} · ${AIService.label(args.mode)}`, "ready");
      return result;
    } catch (err) {
      // Reset AI status chip on failure so it doesn't stay stuck on "Generating…"
      if (err?.name === "AbortError") {
        this.ui.setAIStatus("AI ready", "ready");
      } else {
        this.ui.setAIStatus("Generation failed", "error");
      }
      throw err;
    } finally {
      this.busy = false;
      this.abortController = null;
    }
  }

  cancelGeneration() {
    if (!this.busy) return false;
    this.abortController?.abort();
    void this.service.cancelLocalGeneration();
    return true;
  }
  updateSettings(settings) { this.settings = settings; this.service.updateSettings(settings); }
}

