/** Settings dialog UI class managing all configuration forms and tabs. */
import { renderCacheList, renderCustomModels, renderLocalModelCards, renderApiModelList } from "./ai-ui.js";
import { clearWorkspaceStorage, deleteDatabase } from "../storage/workspace-store.js";
import { lookupWebLLMModel } from "../ai/model-registry.js";
import { API_MODELS } from "../config.js";

export class SettingsUI {
  constructor({ ui, settings }) {
    this.ui = ui;
    this.settings = settings;
    this._bindTabs();
    this._bindAddToggles();
    this._bindAddButtons();
    this._bindDataActions();
    this._bindLocalModelValidation();
  }

  updateSettings(settings) { this.settings = settings; }

  /* ── Tab system ──────────────────────────────── */
  _bindTabs() {
    const tabs = document.querySelector("#settingsTabs");
    if (!tabs) return;
    tabs.addEventListener("click", e => {
      const btn = e.target.closest(".settings-tab");
      if (!btn) return;
      this.switchTab(btn.dataset.tab);
    });
  }

  switchTab(tabName) {
    document.querySelectorAll(".settings-tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tabName));
    document.querySelectorAll(".settings-panel").forEach(p => p.classList.toggle("active", p.id === `settingsPanel-${tabName}`));
  }

  /* ── Open settings dialog ────────────────────── */
  open(tabName = "models") {
    const $ = id => document.querySelector(id);
    // API keys
    $("#openaiKey").value = this.settings.apiKeys?.openai || "";
    $("#geminiKey").value = this.settings.apiKeys?.gemini || "";
    $("#rememberApiKeys").checked = this.settings.rememberApiKeys !== false;

    // Models tab
    this._renderLocalModelCards();
    this._renderGeminiModels();
    this._renderOpenaiModels();
    renderCustomModels($("#customModelList"), this.settings.customApiModels || [], model => this.removeCustomModel(model));

    // Data tab
    renderCacheList($("#localModelCacheList"), this.ui.ai.models.filter(m => m.type === "local"));

    // Reset add forms
    this._closeAllAddForms();
    $("#customApiLabel").value = $("#customApiModelId").value = $("#customApiBaseUrl").value = $("#customApiKey").value = "";

    this.switchTab(tabName);
    $("#settingsDialog").showModal();
  }

  /* ── Save (API keys from form) ───────────────── */
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

  /* ── Models Tab: Local LLM cards ─────────────── */
  _renderLocalModelCards() {
    renderLocalModelCards(document.querySelector("#localModelCards"), this.ui.ai.models, {
      onDownload: id => this._downloadLocalModel(id),
      onRemove: id => this.removeLocalModel(id)
    });
  }

  async _downloadLocalModel(modelId) {
    try {
      document.querySelector("#settingsDialog")?.close();
      await this.ui.ai.downloadModel(modelId);
      this.ui.toast("Model downloaded successfully.", "success");
    } catch (err) {
      this.ui.toast(err.message || "Model download failed.", "error");
    }
  }

  removeLocalModel(modelId) {
    if (!confirm(`Remove "${modelId}" from your model list?`)) return;
    this.settings.enabledLocalModels = (this.settings.enabledLocalModels || []).filter(id => id !== modelId);
    this.ui.persistSettings();
    this.ui.ai.rebuildRegistry();
    this._renderLocalModelCards();
    renderCacheList(document.querySelector("#localModelCacheList"), this.ui.ai.models.filter(m => m.type === "local"));
    this.ui.toast("Model removed from list.", "success");
  }

  /* ── Models Tab: Gemini / OpenAI model lists ─── */
  _renderGeminiModels() {
    renderApiModelList(document.querySelector("#geminiModelList"), this.ui.ai.models, "gemini", {
      onRemove: id => this._removeApiModel("gemini", id)
    });
  }

  _renderOpenaiModels() {
    renderApiModelList(document.querySelector("#openaiModelList"), this.ui.ai.models, "openai", {
      onRemove: id => this._removeApiModel("openai", id)
    });
  }

  _removeApiModel(provider, modelId) {
    // Check if it's a default
    const isDefault = API_MODELS.some(m => m.id === modelId && m.isDefault);
    if (isDefault) {
      this.ui.toast("This is a default model and cannot be removed.", "error");
      return;
    }
    if (!confirm(`Remove "${modelId}"?`)) return;

    // Check if it's a user-added model
    const added = this.settings.addedApiModels?.[provider] || [];
    if (added.includes(modelId)) {
      this.settings.addedApiModels[provider] = added.filter(id => id !== modelId);
    } else {
      // It's a built-in non-default model — mark as removed
      this.settings.removedApiModels = [...new Set([...(this.settings.removedApiModels || []), modelId])];
    }

    this.ui.persistSettings();
    this.ui.ai.rebuildRegistry();
    if (provider === "gemini") this._renderGeminiModels();
    else this._renderOpenaiModels();
    this.ui.toast("Model removed.", "success");
  }

  /* ── Add model toggles ──────────────────────── */
  _bindAddToggles() {
    const toggles = [
      ["addLocalModelToggle", "addLocalModelForm"],
      ["addGeminiModelToggle", "addGeminiModelForm"],
      ["addOpenaiModelToggle", "addOpenaiModelForm"]
    ];
    for (const [toggleId, formId] of toggles) {
      document.querySelector(`#${toggleId}`)?.addEventListener("click", () => {
        const form = document.querySelector(`#${formId}`);
        if (form) form.classList.toggle("open");
      });
    }
  }

  _closeAllAddForms() {
    document.querySelectorAll(".add-model-form").forEach(f => f.classList.remove("open"));
  }

  /* ── Add model buttons ──────────────────────── */
  _bindAddButtons() {
    document.querySelector("#addLocalModelBtn")?.addEventListener("click", () => this._addLocalModel());
    document.querySelector("#addGeminiModelBtn")?.addEventListener("click", () => this._addApiModel("gemini"));
    document.querySelector("#addOpenaiModelBtn")?.addEventListener("click", () => this._addApiModel("openai"));
  }

  _addLocalModel() {
    const input = document.querySelector("#addLocalModelId");
    const modelId = input?.value.trim();
    if (!modelId) { this.ui.toast("Enter a WebLLM Model ID.", "error"); return; }

    // Check if already enabled
    if ((this.settings.enabledLocalModels || []).includes(modelId)) {
      this.ui.toast("This model is already in your list.", "error");
      return;
    }

    // Validate against WebLLM catalog
    const config = this.ui.ai.getWebLLMConfig();
    if (!config) {
      this.ui.toast("WebLLM is not available in this browser (requires WebGPU).", "error");
      return;
    }
    const record = lookupWebLLMModel(config, modelId);
    if (!record) {
      this.ui.toast(`"${modelId}" was not found in the WebLLM model catalog.`, "error");
      return;
    }

    this.settings.enabledLocalModels = [...(this.settings.enabledLocalModels || []), modelId];
    this.ui.persistSettings();
    this.ui.ai.rebuildRegistry();
    this._renderLocalModelCards();
    input.value = "";
    document.querySelector("#addLocalModelForm")?.classList.remove("open");
    document.querySelector("#addLocalModelValidation").textContent = "";
    document.querySelector("#addLocalModelBtn").disabled = true;
    this.ui.toast(`"${modelId}" added to your model list.`, "success");
  }

  _addApiModel(provider) {
    const inputId = provider === "gemini" ? "#addGeminiModelId" : "#addOpenaiModelId";
    const formId = provider === "gemini" ? "#addGeminiModelForm" : "#addOpenaiModelForm";
    const input = document.querySelector(inputId);
    const modelId = input?.value.trim();
    if (!modelId) { this.ui.toast("Enter a model ID.", "error"); return; }

    // Check duplicates
    const existing = this.ui.ai.models.some(m => m.id === modelId);
    if (existing) { this.ui.toast("This model already exists.", "error"); return; }

    // Un-remove if it was previously removed
    this.settings.removedApiModels = (this.settings.removedApiModels || []).filter(id => id !== modelId);
    // Add to user models
    this.settings.addedApiModels ||= { gemini: [], openai: [] };
    this.settings.addedApiModels[provider] = [...(this.settings.addedApiModels[provider] || []), modelId];

    this.ui.persistSettings();
    this.ui.ai.rebuildRegistry();
    if (provider === "gemini") this._renderGeminiModels();
    else this._renderOpenaiModels();
    input.value = "";
    document.querySelector(formId)?.classList.remove("open");
    this.ui.toast(`"${modelId}" added.`, "success");
  }

  /* ── Local model validation (live feedback) ──── */
  _bindLocalModelValidation() {
    const input = document.querySelector("#addLocalModelId");
    const validation = document.querySelector("#addLocalModelValidation");
    const btn = document.querySelector("#addLocalModelBtn");
    if (!input || !validation || !btn) return;

    input.addEventListener("input", () => {
      const id = input.value.trim();
      if (!id) { validation.textContent = ""; validation.className = "add-model-validation"; btn.disabled = true; return; }

      const config = this.ui.ai.getWebLLMConfig();
      if (!config) {
        validation.textContent = "WebLLM unavailable (no WebGPU).";
        validation.className = "add-model-validation invalid";
        btn.disabled = true;
        return;
      }

      const record = lookupWebLLMModel(config, id);
      if (!record) {
        validation.textContent = "Model not found in WebLLM catalog.";
        validation.className = "add-model-validation invalid";
        btn.disabled = true;
      } else if ((this.settings.enabledLocalModels || []).includes(id)) {
        validation.textContent = "Already in your model list.";
        validation.className = "add-model-validation invalid";
        btn.disabled = true;
      } else {
        const parts = [];
        if (record.paramSize && record.paramSize !== "—") parts.push(`Params: ${record.paramSize}`);
        if (record.vram) parts.push(`VRAM: ~${Math.round(record.vram)} MB`);
        if (record.quantization && record.quantization !== "—") parts.push(`Quant: ${record.quantization}`);
        validation.textContent = `✓ Found — ${parts.join(" · ") || record.id}`;
        validation.className = "add-model-validation valid";
        btn.disabled = false;
      }
    });
  }

  /* ── Custom models (existing feature) ────────── */
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
    this.settings.customApiModels.push({ id, label, model: id, type: "api", protocol: "openai-compatible", baseUrl, credentialId, provider: "custom" });
    this.ui.setCustomCredential(credentialId, key, this.settings.rememberApiKeys !== false);
    this.ui.persistSettings();
    this.ui.ai.rebuildRegistry();
    this.ui.renderModelPicker(this.ui.ai.models, this.ui.ai.selectedModel);
    renderCustomModels($("#customModelList"), this.settings.customApiModels, model => this.removeCustomModel(model));
    $("#customApiLabel").value = $("#customApiModelId").value = $("#customApiBaseUrl").value = $("#customApiKey").value = "";
  }

  removeCustomModel(modelOrId) {
    const model = typeof modelOrId === "object" ? modelOrId : (this.settings.customApiModels || []).find(m => m.id === modelOrId);
    const targetCredentialId = model?.credentialId;
    this.settings.customApiModels = (this.settings.customApiModels || []).filter(m => targetCredentialId ? m.credentialId !== targetCredentialId : m.id !== modelOrId);
    // Clean up the credential before persisting the updated settings.
    if (model?.credentialId) this.ui.removeCustomCredential(model.credentialId);
    this.ui.persistSettings();
    this.ui.ai.rebuildRegistry();
    this.ui.renderModelPicker(this.ui.ai.models, this.ui.ai.selectedModel);
    renderCustomModels(document.querySelector("#customModelList"), this.settings.customApiModels, model => this.removeCustomModel(model));
  }

  /* ── Data tab actions ────────────────────────── */
  _bindDataActions() {
    document.querySelector("#clearWorkspaceBtn")?.addEventListener("click", () => this.clearWorkspace());
    document.querySelector("#masterResetBtn")?.addEventListener("click", () => this._masterReset());
    document.querySelector("#closeSettingsBtn")?.addEventListener("click", () => document.querySelector("#settingsDialog")?.close());
  }

  clearWorkspace() {
    if (!confirm("Delete ALL workspace documents? This cannot be undone. API keys, settings, and downloaded local models will not be deleted.")) return;
    this.ui.clearWorkspaceDocuments();
    this.ui.toast("All workspace documents deleted.", "success");
    document.querySelector("#settingsDialog")?.close();
  }

  async _masterReset() {
    if (!confirm("⚠ This will permanently delete ALL data stored by Parallel Notes:\n\n• All documents\n• All settings and API keys\n• All downloaded model caches\n• Service worker registration\n\nThis cannot be undone.")) return;
    if (!confirm("Are you absolutely sure? Everything will be erased and the page will reload.")) return;

    try {
      // 1. Clear IndexedDB workspace + legacy browser storage
      await deleteDatabase();
      localStorage.clear();
      // 2. Clear sessionStorage
      sessionStorage.clear();
      // 3. Clear all Cache API caches
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
      // 4. Unregister service workers
      if (navigator.serviceWorker) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
      // 5. Reload
      location.reload();
    } catch (err) {
      this.ui.toast("Reset failed: " + (err.message || "Unknown error"), "error");
    }
  }
}
