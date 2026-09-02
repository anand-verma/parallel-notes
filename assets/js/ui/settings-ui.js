import { renderCacheList, renderCustomModels } from "./ai-ui.js";
import { clearWorkspaceStorage } from "../storage/workspace-store.js";

export class SettingsUI {
  constructor({ ui, settings }) { this.ui = ui; this.settings = settings; }
  updateSettings(settings) { this.settings = settings; }

  open() {
    const $ = id => document.querySelector(id);
    $("#openaiKey").value = this.settings.apiKeys?.openai || "";
    $("#geminiKey").value = this.settings.apiKeys?.gemini || "";
    $("#rememberApiKeys").checked = this.settings.rememberApiKeys !== false;
    $("#customApiLabel").value = "";
    $("#customApiModelId").value = "";
    $("#customApiBaseUrl").value = "";
    $("#customApiKey").value = "";
    renderCustomModels($("#customModelList"), this.settings.customApiModels || [], id => this.removeCustomModel(id));
    renderCacheList($("#localModelCacheList"), this.ui.ai.models.filter(m => m.type === "local"));
    $("#settingsDialog").showModal();
  }

  saveFromForm() {
    const $ = id => document.querySelector(id);
    const remember = $("#rememberApiKeys").checked;
    this.settings.rememberApiKeys = remember;
    const openai = $("#openaiKey").value.trim();
    const gemini = $("#geminiKey").value.trim();
    this.ui.setCredential("openai", openai, remember);
    this.ui.setCredential("gemini", gemini, remember);
    this.ui.persistSettings();
  }

  addCustomModel() {
    const $ = id => document.querySelector(id);
    const id = $("#customApiModelId").value.trim();
    const baseUrl = $("#customApiBaseUrl").value.trim().replace(/\/$/, "");
    const label = $("#customApiLabel").value.trim() || id;
    const key = $("#customApiKey").value.trim();
    if (!id || !baseUrl) { this.ui.toast("Model ID and base URL are required.", "error"); return; }
    const credentialId = `custom:${crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`}`;
    this.settings.customApiModels ||= [];
    if (this.settings.customApiModels.some(m => m.id === id && m.baseUrl === baseUrl)) { this.ui.toast("That custom model already exists.", "error"); return; }
    this.settings.customApiModels.push({ id, label, model: id, type: "api", protocol: "openai-compatible", baseUrl, credentialId });
    this.ui.setCustomCredential(credentialId, key, this.settings.rememberApiKeys !== false);
    this.ui.persistSettings();
    this.ui.ai.updateCustomModels(this.settings.customApiModels);
    this.ui.populateModels(this.ui.ai.models, this.ui.ai.selectedModel);
    renderCustomModels($("#customModelList"), this.settings.customApiModels, x => this.removeCustomModel(x));
    $("#customApiLabel").value = $("#customApiModelId").value = $("#customApiBaseUrl").value = $("#customApiKey").value = "";
  }

  clearWorkspace() {
    if (!confirm("Delete ALL workspace documents? This cannot be undone. API keys, settings, and downloaded local models will not be deleted.")) return;
    this.ui.clearWorkspaceDocuments();
    this.ui.toast("All workspace documents deleted.", "success");
    document.querySelector("#settingsDialog")?.close();
  }

  removeCustomModel(id) {
    this.settings.customApiModels = (this.settings.customApiModels || []).filter(m => m.id !== id);
    this.ui.persistSettings();
    this.ui.ai.updateCustomModels(this.settings.customApiModels);
    this.ui.populateModels(this.ui.ai.models, this.ui.ai.selectedModel);
    renderCustomModels(document.querySelector("#customModelList"), this.settings.customApiModels, x => this.removeCustomModel(x));
  }
}
