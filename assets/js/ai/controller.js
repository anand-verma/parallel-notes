import { buildModelRegistry, discoverLocalModels, preferredModel } from "./model-registry.js";
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
  }

  async init() {
    this.ui.setAIStatus("Detecting models…", "loading");
    let localModels = [];
    if (isWebGPUSupported()) {
      const config = await (await import("./providers/webllm.js")).loadWebLLM();
      localModels = discoverLocalModels(config.prebuiltAppConfig);
    }
    this.models = buildModelRegistry({ localModels, customModels: this.settings.customApiModels || [] });
    if (!this.models.length) throw new Error("No AI models were found.");
    const next = this.selectedModel && this.models.some(m => m.id === this.selectedModel) ? this.selectedModel : preferredModel(this.models);
    this.selectedModel = next;
    this.ui.populateModels(this.models, this.selectedModel);
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
    this.ui.populateModels(this.models, this.selectedModel);
  }

  updateCustomModels(customModels) {
    const locals = this.models.filter(m => m.type === "local");
    this.models = buildModelRegistry({ localModels: locals, customModels });
    if (!this.models.some(m => m.id === this.selectedModel)) this.selectedModel = preferredModel(this.models);
  }

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
    this.ui.populateModels(this.models, this.selectedModel);
    this.ui.setAIStatus("Local AI ready", "ready");
    return true;
  }

  async run(args) {
    if (this.busy) throw new Error("A generation is already running.");
    this.busy = true;
    this.abortController = new AbortController();
    let succeeded = false;
    try {
      const model = this.getModelDef();
      if (!model) throw new Error("Choose an AI model first.");
      if (model.type === "local" && currentModel() !== model.id) {
        this.ui.openModelDialog(model.id);
        const proceed = await this.ui.waitForModelLoad();
        if (!proceed) return null;
      }
      this.ui.setAIStatus("Generating…", "loading");
      const result = await this.service.generate({ ...args, model, onProgress: (p, t) => this.ui.updateModelProgress(p, t), signal: this.abortController.signal });
      this.ui.setAIStatus(`${model.type === "local" ? "Local" : "Cloud"} · ${AIService.label(args.mode)}`, "ready");
      succeeded = true;
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
