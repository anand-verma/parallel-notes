/** Core AppUI class handling layout, pane management, and interactions. */
import { saveState, activeDocument, createDocument, deleteDocument, loadSettings, saveSettings, clearWorkspaceStorage, getStorageUsage, ensureUniqueTitle } from "./state.js";
import { createEditor, editorText, wordCount } from "./editor.js";
import { AIController } from "./ai/controller.js";
import { createSourcePackage } from "./ai/source-package.js";
import { markdownToHtml } from "./services/markdown.js";
import { copyRichText } from "./services/clipboard.js";
import { exportDocument } from "./services/export.js";
import { ImportService } from "./services/import/import-service.js";
import { getCredential, setCredential, setCustomCredential as setStoredCustomCredential, removeCustomCredential as removeStoredCustomCredential } from "./storage/credentials.js";
import { clearAllModelCaches } from "./ai/providers/webllm.js";
import { SettingsUI } from "./ui/settings-ui.js";
import { renderModelPickerMenu, updatePickerTrigger, renderCacheList } from "./ui/ai-ui.js";

function assertEditorContent(editor) {
  const html = editor?.getHTML?.() || "";
  if (!html.trim() || html === "<p></p>" || html === "<p><br></p>") throw new Error("Nothing to export.");
  return html;
}

export class AppUI {
  constructor(state) {
    this.state = state;
    this.settings = loadSettings();
    this.editors = {};
    this.saveTimer = null;
    this.maximizedPane = null;
    this.generatingDocId = null;
    this.sidebar = document.querySelector("#sidebar");
    this.customDialog = document.querySelector("#customDialog");
    this.modelDialog = document.querySelector("#modelDialog");
    this.toastRegion = document.querySelector("#toastRegion");
    this.ai = new AIController({ ui: this, settings: this.settings });
    this.settingsUI = new SettingsUI({ ui: this, settings: this.settings });
    this.modelLoadWaiters = [];
    this.importDialog = document.querySelector("#importDialog");
    this.exportDialog = document.querySelector("#exportDialog");
    this.exportPaneId = null;
    this.importController = null;
    this.progressRenderTimer = null;
    this.progressRenderToken = 0;
    this.progressRenderInFlight = false;
  }

  init() {
    this.bind();
    this.restoreTheme();
    this.renderDocs();
    this.loadActiveDocument();
    this.applyPaneRatio();
    this.setMode(this.state.mode);
    this.customInstruction = document.querySelector("#customInstruction");
    this.customInstruction.value = this.state.customInstruction || "";
    this.updateCustomPreview();
    this.initAI();
    
    if (window.innerWidth <= 700) {
      this.sidebar.classList.add("collapsed");
      const btn = document.querySelector("#sidebarToggleBtn");
      if (btn) {
        btn.textContent = "▸";
        btn.title = "Expand sidebar";
        btn.setAttribute("aria-label", btn.title);
      }
    }
  }

  bind() {
    const $ = s => document.querySelector(s);
    $("#sidebarNewBtn").onclick = () => this.newDoc();
    $("#sidebarImportBtn").onclick = () => this.openImportDialog();
    $("#chooseImportFileBtn").onclick = () => $("#importFile").click();
    $("#importFile").onchange = e => {
      const file = e.target.files?.[0];
      $("#importFileName").textContent = file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB` : "No file selected";
      this.updateImportFileUI(file);
    };
    $("#cancelImportBtn").onclick = () => { this.cancelImport(); if (this.importDialog.open) this.importDialog.close(); };
    $("#importForm").onsubmit = e => { e.preventDefault(); void this.importDocument(); };
    document.querySelectorAll("input[name=importMode]").forEach(input => input.addEventListener("change", () => this.updateImportModelVisibility()));
    this.importDialog.addEventListener("close", () => { if (this.importController) this.cancelImport(); });
    $("#themeBtn").onclick = () => this.toggleTheme();
    $("#settingsBtn").onclick = () => this.settingsUI.open();
    
    // Laptop collapsed sidebar click-to-expand
    this.sidebar.addEventListener("click", (e) => {
      // If collapsed and we clicked the empty space of the sidebar (not a button)
      if (this.sidebar.classList.contains("collapsed") && window.innerWidth > 700) {
        if (!e.target.closest("button") && !e.target.closest("a")) {
          this.toggleSidebar();
        }
      }
    });

    // Mobile sidebar overlay click-to-collapse
    const overlay = document.querySelector("#sidebarOverlay");
    if (overlay) {
      overlay.addEventListener("click", () => {
        if (window.innerWidth <= 700 && !this.sidebar.classList.contains("collapsed")) {
          this.toggleSidebar();
        }
      });
    }
    $("#settingsForm").onsubmit = e => {
      e.preventDefault();
      try {
        this.settingsUI.saveFromForm();
        $("#settingsDialog").close();
        this.toast("Settings saved", "success");
        this.ai.updateSettings(this.settings);
        this.ai.rebuildRegistry();
        void this.ai.refreshCacheStatus();
      } catch (error) {
        this.toast(error.message || "Settings could not be saved.", "error");
      }
    };
    $("#addCustomModelBtn").onclick = () => this.settingsUI.addCustomModel();
    $("#clearCacheBtn").onclick = () => this.clearLocalModels();
    $("#clearWorkspaceBtn")?.addEventListener("click", () => this.settingsUI.clearWorkspace());
    $("#sidebarToggleBtn").onclick = () => this.toggleSidebar();
    $("#maxSourceBtn").onclick = e => this.toggleMaximizePane("sourcePane", e.currentTarget);
    $("#maxResultBtn").onclick = e => this.toggleMaximizePane("resultPane", e.currentTarget);
    $("#modeSelect").onchange = e => { this.state.mode = e.target.value; saveState(this.state); this.updateCustomPreview(); };

    // Model picker toggle
    $("#modelPickerBtn").onclick = () => this.toggleModelPicker();
    // Close picker on outside click
    document.addEventListener("click", e => {
      if (!e.target.closest("#modelPicker")) this.closeModelPicker();
    });

    $("#customPromptBtn").onclick = () => this.openCustomDialog();
    $("#editCustomBtn").onclick = () => this.openCustomDialog();
    $("#customForm").onsubmit = e => { e.preventDefault(); this.state.customInstruction = this.customInstruction.value.trim(); saveState(this.state); this.updateCustomPreview(); this.customDialog.close(); this.toast("Custom instruction applied.", "success"); };
    $("#loadModelBtn").onclick = async () => { try { await this.ai.loadSelectedModel(); this.resolveModelLoad(true); } catch (err) { this.resolveModelLoad(false); this.toast(err.message, "error"); } };
    this.modelDialog.addEventListener("close", () => { if (this.modelDialog.returnValue !== "load") this.resolveModelLoad(false); });
    $("#summarizeBtn").onclick = () => this.ai.busy ? this.stopGeneration() : this.summarize();
    document.querySelectorAll("[data-action]").forEach(btn => btn.onclick = () => this.action(btn.dataset.action));
    document.querySelectorAll("[data-export-format]").forEach(btn => btn.onclick = () => { void this.runExport(btn.dataset.exportFormat); });
    this.exportDialog?.addEventListener("close", () => { this.exportPaneId = null; });
    
    // Document rename from pane
    const sourceNameInput = $("#sourceDocName");
    if (sourceNameInput) {
      const handleRename = () => {
        let newTitle = sourceNameInput.value.trim();
        const doc = activeDocument(this.state);
        
        if (newTitle) {
          if (newTitle !== doc.title) {
            newTitle = ensureUniqueTitle(this.state, newTitle, doc.id);
            doc.title = newTitle;
            doc.updatedAt = Date.now();
            saveState(this.state);
            this.renderDocs();
          }
          sourceNameInput.value = newTitle;
          const resultSpan = document.querySelector("#resultDocName");
          if (resultSpan) resultSpan.textContent = `Draft - ${newTitle}`;
        } else {
          sourceNameInput.value = doc.title; // Revert if empty
        }
      };
      sourceNameInput.addEventListener("blur", handleRename);
      sourceNameInput.addEventListener("keydown", e => {
        if (e.key === "Enter") {
          e.preventDefault();
          sourceNameInput.blur();
        }
      });
    }

    this.setupSplitter();
    // Close any open doc menu when clicking outside
    document.addEventListener("click", e => {
      if (!e.target.closest(".doc-item-row")) {
        document.querySelectorAll(".doc-item-dropdown.visible").forEach(m => m.classList.remove("visible"));
        document.querySelectorAll(".doc-item-menu-btn.open").forEach(b => b.classList.remove("open"));
      }
    });
    window.addEventListener("resize", () => {
      this.applyPaneRatio();
    });
  }

  setCredential(provider, value, remember) { setCredential(provider, value, { persist: remember, settings: this.settings }); }
  setCustomCredential(id, value, remember) {
    setStoredCustomCredential(id, value, { persist: remember, settings: this.settings });
  }

  removeCustomCredential(id) {
    removeStoredCustomCredential(id, this.settings);
  }
  getCredential(provider, model) {
    return getCredential(provider, this.settings, model);
  }
  persistSettings() { this.settings = saveSettings(this.settings); this.settingsUI.updateSettings(this.settings); this.ai.updateSettings(this.settings); }

  /* ── Model Picker ────────────────────────────── */
  renderModelPicker(models, selectedId) {
    const menu = document.querySelector("#modelPickerMenu");
    const credentialReady = (provider, model) => !!this.getCredential(provider, model);
    renderModelPickerMenu(menu, models, selectedId, {
      onSelect: id => {
        this.ai.setModel(id);
        this.renderModelPicker(models, id);
        this.closeModelPicker();
      },
      onDownload: id => {
        this.closeModelPicker();
        this.ai.downloadModel(id).then(() => {
          this.toast("Model downloaded.", "success");
        }).catch(err => {
          this.toast(err.message || "Download failed.", "error");
        });
      },
      credentialReady
    });
    updatePickerTrigger(models, selectedId);
  }

  toggleModelPicker() {
    const menu = document.querySelector("#modelPickerMenu");
    const btn = document.querySelector("#modelPickerBtn");
    const isOpen = menu.classList.toggle("open");
    btn.classList.toggle("open", isOpen);
  }

  closeModelPicker() {
    document.querySelector("#modelPickerMenu")?.classList.remove("open");
    document.querySelector("#modelPickerBtn")?.classList.remove("open");
  }

  /* ── Local model cache ───────────────────────── */
  async clearLocalModels() {
    if (!confirm("Delete all downloaded local model files? They will need to be downloaded again.")) return;
    try {
      if (this.ai.busy) {
        this.setAIStatus("Stopping…", "loading");
        await this.ai.cancelGeneration();
      }
      const count = await clearAllModelCaches(this.ai.models.filter(m => m.type === "local").map(m => m.id));
      await this.ai.refreshCacheStatus();
      renderCacheList(document.querySelector("#localModelCacheList"), this.ai.models.filter(m => m.type === "local"));
      this.toast(count ? `${count} local model cache(s) deleted.` : "No cached local models found.", "success");
    } catch (err) {
      this.toast(err.message || "Failed to clear local model cache.", "error");
    }
  }

  clearWorkspaceDocuments() {
    try {
      if (this.ai.busy) this.stopGeneration();
      this.stopProgressiveResult();
      this.state = clearWorkspaceStorage();
      if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
      this.loadActiveDocument();
      this.renderDocs();
      this.setMode(this.state.mode);
      this.customInstruction.value = this.state.customInstruction;
      this.updateCustomPreview();
      document.querySelector("#saveState").textContent = "Workspace cleared";
    } catch (err) {
      this.toast(err.message || "Failed to clear workspace.", "error");
    }
  }

  /* ── AI status ───────────────────────────────── */
  async initAI() { try { await this.ai.init(); } catch (err) { this.setAIStatus("AI unavailable", "error"); this.toast(err.message, "error"); } }
  setAIStatus(text, type = "") { document.querySelector("#aiStatus").textContent = text; document.querySelector("#aiDot").className = `status-dot ${type}`; }
  disableAI(disabled) {
    const btn = document.querySelector("#summarizeBtn");
    btn.disabled = disabled;
  }
  setGeneratingUI(active) {
    const btn = document.querySelector("#summarizeBtn");
    if (!btn) return;
    btn.classList.toggle("stop-btn", active);
    btn.setAttribute("aria-label", active ? "Stop AI generation" : "Summarize notes");
    btn.title = active ? "Stop AI generation" : "Summarize notes";
    btn.innerHTML = active ? '<span class="stop-icon" aria-hidden="true">■</span> Stop' : '<span class="spark">✦</span> Summarize';
    btn.disabled = false;
  }
  stopGeneration() {
    if (!this.ai.busy) return;
    this.ai.cancelGeneration();
    this.setAIStatus("Stopping…", "loading");
    document.querySelector("#generationMeta").textContent = "Stopping…";
  }

  openModelDialog(modelId) { document.querySelector("#modelInfo").textContent = `Selected: ${modelId}. WebLLM manages the model cache for this browser.`; document.querySelector("#modelProgress").style.width = "0%"; document.querySelector("#modelProgressLabel").textContent = "Ready to download on demand."; document.querySelector("#modelProgressPercent").textContent = "0%"; if (!this.modelDialog.open) this.modelDialog.showModal(); }
  waitForModelLoad() { return new Promise(resolve => this.modelLoadWaiters.push(resolve)); }
  resolveModelLoad(value) { const waiters = this.modelLoadWaiters.splice(0); waiters.forEach(resolve => resolve(value)); }
  closeModelDialog() { if (this.modelDialog.open) { this.modelDialog.returnValue = "load"; this.modelDialog.close(); } }
  updateModelProgress(pct, text) {
    const bar = document.querySelector("#modelProgress");
    const label = document.querySelector("#modelProgressLabel");
    if (pct != null && Number.isFinite(pct)) {
      const value = Math.max(0, Math.min(100, pct));
      const rounded = Math.round(value);
      bar.style.width = `${rounded}%`;
      document.querySelector("#modelProgressPercent").textContent = `${rounded}%`;
      if (this.ai.busy) this.setAIStatus(`Loading local model · ${rounded}%`, "loading");
    }
    if (text) label.textContent = text;
  }

  /* ── Document import ─────────────────────────── */
  renderImportModelOptions() {
    const select = document.querySelector("#importAiModel");
    if (!select) return;
    const models = this.ai.models || [];
    const previous = select.value;
    select.replaceChildren();
    const groups = [
      ["Local LLM", models.filter(m => m.type === "local")],
      ["Gemini", models.filter(m => m.provider === "gemini")],
      ["OpenAI", models.filter(m => m.provider === "openai")],
      ["Custom API", models.filter(m => m.type === "api" && !["gemini", "openai"].includes(m.provider))]
    ];
    let firstReady = "";
    const credentialReady = (provider, model) => !!this.getCredential(provider, model);
    for (const [label, group] of groups) {
      if (!group.length) continue;
      const optgroup = document.createElement("optgroup");
      optgroup.label = label;
      for (const model of group) {
        const option = document.createElement("option");
        option.value = model.id;
        option.textContent = model.label || model.id;
        const ready = model.type === "local" ? !!model.isCached : credentialReady(model.provider, model);
        if (!firstReady && ready) firstReady = model.id;
        if (!ready) {
          option.disabled = true;
          option.textContent += model.type === "local" ? " · not downloaded" : " · configure API key";
        }
        optgroup.appendChild(option);
      }
      select.appendChild(optgroup);
    }
    const preferred = previous && models.some(m => m.id === previous && !select.querySelector(`option[value=\"${CSS.escape(previous)}\"]`)?.disabled)
      ? previous
      : (models.some(m => m.id === this.ai.selectedModel && !select.querySelector(`option[value=\"${CSS.escape(this.ai.selectedModel)}\"]`)?.disabled) ? this.ai.selectedModel : firstReady);
    if (preferred) select.value = preferred;
    const hint = document.querySelector("#importAiModelHint");
    if (hint) hint.textContent = "Only configured or downloaded models can be used. This choice affects import assistance only; it does not change your main AI model.";
  }

  getImportType(file) {
    if (!file) return null;
    if (file.type === "application/pdf" || /\.pdf$/i.test(file.name || "")) return "pdf";
    if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || /\.docx$/i.test(file.name || "")) return "docx";
    return null;
  }

  updateImportFileUI(file = document.querySelector("#importFile")?.files?.[0]) {
    const type = this.getImportType(file);
    const options = document.querySelector("#importModeOptions");
    const modelRow = document.querySelector("#importAiModelRow");
    const chooseBtn = document.querySelector("#chooseImportFileBtn");
    const startBtn = document.querySelector("#startImportBtn");
    const standardInput = document.querySelector("input[name=importMode][value=standard]");
    const enhancedInput = document.querySelector("input[name=importMode][value=enhanced]");
    const standardLabelEl = standardInput ? standardInput.closest("label") : null;
    const enhancedLabelEl = enhancedInput ? enhancedInput.closest("label") : null;
    const standardLabel = standardLabelEl ? standardLabelEl.querySelector("strong") : null;
    const standardDesc = standardLabelEl ? standardLabelEl.querySelector("small") : null;
    const enhancedLabel = enhancedLabelEl ? enhancedLabelEl.querySelector("strong") : null;
    const enhancedDesc = enhancedLabelEl ? enhancedLabelEl.querySelector("small") : null;

    if (chooseBtn) chooseBtn.textContent = type === "pdf" ? "Choose PDF" : type === "docx" ? "Choose DOCX" : "Choose file";
    if (startBtn) startBtn.textContent = type === "pdf" ? "Import PDF" : type === "docx" ? "Import DOCX" : "Import";

    if (type === "docx") {
      options?.classList.add("hidden");
      modelRow?.classList.add("hidden");
      if (standardLabel) standardLabel.textContent = "Standard DOCX conversion";
      if (standardDesc) standardDesc.textContent = "Preserves Word headings, paragraphs, lists, tables, emphasis, and links.";
      if (enhancedLabel) enhancedLabel.textContent = "Enhanced structure assist";
      if (enhancedDesc) enhancedDesc.textContent = "Available for PDF imports; DOCX already uses Word's semantic structure.";
      const standard = document.querySelector("input[name=importMode][value=standard]");
      if (standard) standard.checked = true;
      return;
    }

    options?.classList.remove("hidden");
    if (standardLabel) standardLabel.textContent = "Standard extraction";
    if (standardDesc) standardDesc.textContent = "Fast, deterministic PDF text and formatting reconstruction.";
    if (enhancedLabel) enhancedLabel.textContent = "Enhanced structure assist";
    if (enhancedDesc) enhancedDesc.textContent = "Uses the selected AI only to classify ambiguous structure. Extracted text remains the source of truth.";
    this.updateImportModelVisibility();
  }

  updateImportModelVisibility() {
    const row = document.querySelector("#importAiModelRow");
    const file = document.querySelector("#importFile")?.files?.[0];
    const enhanced = this.getImportType(file) === "pdf" && document.querySelector("input[name=importMode]:checked")?.value === "enhanced";
    row?.classList.toggle("hidden", !enhanced);
    if (enhanced) this.renderImportModelOptions();
  }

  openImportDialog() {
    if (this.ai.busy) { this.toast("Finish the current AI operation before importing.", "error"); return; }
    const form = document.querySelector("#importForm");
    const file = document.querySelector("#importFile");
    if (form) form.reset();
    if (file) file.value = "";
    document.querySelector("#importFileName").textContent = "No file selected";
    document.querySelector("#importProgress")?.classList.add("hidden");
    document.querySelector("#importWarning")?.classList.add("hidden");
    document.querySelector("#startImportBtn").disabled = false;
    document.querySelector("#chooseImportFileBtn").disabled = false;
    this.renderImportModelOptions();
    this.updateImportFileUI(null);
    if (!this.importDialog.open) this.importDialog.showModal();
  }

  cancelImport() {
    this.importController?.abort();
    this.importController = null;
  }

  async importDocument() {
    const file = document.querySelector("#importFile")?.files?.[0];
    const type = this.getImportType(file);
    if (!file) { this.toast("Choose a PDF or DOCX file to import.", "error"); return; }
    if (!type) { this.toast("Only PDF and DOCX files are supported.", "error"); return; }
    if (this.ai.busy) { this.toast("Finish the current AI operation before importing.", "error"); return; }
    const mode = document.querySelector("input[name=importMode]:checked")?.value || "standard";
    const importModelId = document.querySelector("#importAiModel")?.value || "";
    if (type !== "pdf" && mode !== "standard") {
      this.toast("Enhanced Structure Assist is currently available for PDF imports only.", "error");
      return;
    }
    if (mode === "enhanced" && !importModelId) {
      this.toast("Choose a configured or downloaded AI model for Enhanced Structure Assist.", "error");
      return;
    }
    const startBtn = document.querySelector("#startImportBtn");
    const chooseBtn = document.querySelector("#chooseImportFileBtn");
    const progress = document.querySelector("#importProgress");
    const warning = document.querySelector("#importWarning");
    const bar = document.querySelector("#importProgressBar");
    const label = document.querySelector("#importProgressLabel");
    const pct = document.querySelector("#importProgressPercent");
    const controller = new AbortController();
    this.importController = controller;
    startBtn.disabled = true; chooseBtn.disabled = true; progress.classList.remove("hidden"); warning.classList.add("hidden");
    const setProgress = (progressOrValue = {}, text = "") => {
      if (typeof progressOrValue === "object") {
        const { page, pages, phase } = progressOrValue;
        const value = pages ? (page / pages) * 80 : 0;
        bar.style.width = `${Math.round(value)}%`; pct.textContent = `${Math.round(value)}%`;
        label.textContent = type === "pdf"
          ? (phase === "extract" ? `Extracting PDF · page ${page} of ${pages}` : "Processing import…")
          : (phase === "extract" ? "Reading DOCX…" : "Processing DOCX…");
      } else {
        const value = 80 + Math.max(0, Math.min(20, Number(progressOrValue) || 0)) * 0.2;
        bar.style.width = `${Math.round(value)}%`; pct.textContent = `${Math.round(value)}%`;
        label.textContent = text || "Processing import…";
      }
    };
    try {
      const result = await ImportService.import(file, { mode, ai: mode === "enhanced" ? this.ai : null, modelId: mode === "enhanced" ? importModelId : null, signal: controller.signal, onProgress: setProgress });
      if (controller.signal.aborted) throw new DOMException("Import cancelled", "AbortError");
      bar.style.width = "100%"; pct.textContent = "100%"; label.textContent = "Creating document…";
      this.saveNow();
      const doc = createDocument(this.state, result.title);
      doc.source = result.html || "<p></p>";
      doc.result = "<p></p>";
      doc.updatedAt = Date.now();
      saveState(this.state);
      this.loadActiveDocument();
      this.renderDocs();
      this.importController = null;
      this.importDialog.close();
      if (result.metadata?.warnings?.length) {
        warning.textContent = result.metadata.warnings.join(" ");
        warning.classList.remove("hidden");
        this.toast(`${type.toUpperCase()} imported with a formatting limitation.`, "success");
      } else {
        this.toast(type === "pdf" ? `PDF imported · ${result.metadata?.pageCount || 0} pages` : "DOCX imported", "success");
      }
    } catch (err) {
      if (err?.name === "AbortError") this.toast("PDF import cancelled.", "success");
      else this.toast(err.message || "PDF import failed.", "error");
    } finally {
      if (this.importController === controller) this.importController = null;
      startBtn.disabled = false; chooseBtn.disabled = false;
    }
  }

  /* ── Editor ──────────────────────────────────── */
  loadActiveDocument() {
    const doc = activeDocument(this.state);
    
    // Update pane titles
    const sourceInput = document.querySelector("#sourceDocName");
    const resultSpan = document.querySelector("#resultDocName");
    if (sourceInput) sourceInput.value = doc.title || "Document Name";
    if (resultSpan) resultSpan.textContent = `Draft - ${doc.title || "Document Name"}`;

    for (const key of ["source", "result"]) {
      const host = document.querySelector(`#${key}Editor`); this.editors[key]?.destroy(); host.innerHTML = "";
      this.editors[key] = createEditor(host, doc[key], () => this.onEditorUpdate(key));
    }
    this.updateCounts(); this.toggleEmptyResult();
  }
  onEditorUpdate(key) { const doc = activeDocument(this.state); doc[key] = this.editors[key].getHTML(); doc.updatedAt = Date.now(); this.markDirty(); this.scheduleCountUpdate(); if (key === "result") this.toggleEmptyResult(); }
  scheduleCountUpdate() {
    if (this.countFrame) return;
    this.countFrame = requestAnimationFrame(() => { this.countFrame = null; this.updateCounts(); });
  }
  markDirty() { const el = document.querySelector("#saveState"); el.textContent = "Unsaved"; el.className = "save-state saving"; clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => this.saveNow(), 700); }
  saveNow() {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    try {
      saveState(this.state);
      const el = document.querySelector("#saveState");
      el.textContent = `Saved · ${new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"})}`;
      el.className = "save-state";
      
      const usage = getStorageUsage();
      if (usage > 4000000 && !this.storageWarned) {
        this.storageWarned = true;
        this.toast("Storage is nearly full (over 4MB). Delete old documents to prevent data loss.", "error");
      } else if (usage < 3500000) {
        this.storageWarned = false;
      }
    } catch (error) {
      const el = document.querySelector("#saveState");
      el.textContent = "Storage full";
      el.className = "save-state error";
      this.toast(error.message || "Could not save workspace.", "error");
    }
  }

  /* ── Summarize ───────────────────────────────── */
  async summarize() {
    if (this.ai.busy) return;
    const sourcePackage = createSourcePackage(this.editors.source);
    if (!sourcePackage) { this.toast("There is no source content to summarize.", "error"); return; }
    // Move active doc to top of stack and highlight it
    const doc = activeDocument(this.state);
    const idx = this.state.documents.indexOf(doc);
    if (idx > 0) {
      this.state.documents.splice(idx, 1);
      this.state.documents.unshift(doc);
      saveState(this.state);
    }
    this.generatingDocId = doc.id;
    this.renderDocs();
    const btn = document.querySelector("#summarizeBtn"); this.setGeneratingUI(true);
    document.querySelector("#generationMeta").textContent = sourcePackage.label;
    this.startProgressiveResult();
    try {
      const result = await this.ai.run({
        mode: this.state.mode,
        custom: this.state.customInstruction,
        sourcePackage,
        onToken: (delta, full) => this.queueProgressiveResult(full)
      });
      if (result === null) {
        document.querySelector("#generationMeta").textContent = "Cancelled";
        // Save any partial content that was streamed before cancellation
        this.onEditorUpdate("result");
        return;
      }
      if (!result) throw new Error("The AI returned an empty result.");
      await this.flushProgressiveResult(result);
      const html = await markdownToHtml(result);
      this.editors.result.commands.setContent(html, { emitUpdate: false });
      this.onEditorUpdate("result");
      this.toggleEmptyResult();
      document.querySelector("#generationMeta").textContent = `Generated · ${wordCount(result)} words`;
      this.toast("Draft generated. Review and edit it before using it.", "success");
    } catch (err) {
      const isCancelled = err?.name === "AbortError";
      document.querySelector("#generationMeta").textContent = isCancelled ? "Cancelled" : "Generation failed";
      
      const msg = err.message || "";
      if (!isCancelled) {
        if (msg.includes("Download this model first")) {
          this.showInstruction(
            "Model Not Downloaded",
            "This local AI model needs to be downloaded before it can be used. This usually only takes a few minutes.",
            [
              { text: "Download from Settings", action: () => { document.querySelector("#instructionDialog").close(); document.querySelector("#settingsDialog").showModal(); } }
            ]
          );
        } else if (msg.includes("API key is missing") || msg.includes("Gemini API key is missing")) {
          const isGemini = msg.includes("Gemini");
          const links = [
            { text: "Add API key in Settings", action: () => { document.querySelector("#instructionDialog").close(); document.querySelector("#settingsDialog").showModal(); } }
          ];
          if (isGemini) {
            links.push({ text: "Get Gemini API Key", href: "https://aistudio.google.com/app/apikey" });
          } else {
            links.push({ text: "Get OpenAI API Key", href: "https://platform.openai.com/api-keys" });
          }
          this.showInstruction("API Key Required", "You must configure an API key to use this cloud model.", links);
        } else {
          this.toast(msg || "Generation failed.", "error");
        }
      }
      
      // Save any partial content that was streamed before the error
      this.onEditorUpdate("result");
    } finally {
      this.generatingDocId = null;
      this.renderDocs();
      this.stopProgressiveResult();
      this.setGeneratingUI(false);
      // Always persist source pane as well to ensure both sides are saved
      this.onEditorUpdate("source");
    }
  }

  /* ── Progressive result streaming ────────────── */
  startProgressiveResult() {
    this.progressRenderToken += 1;
    this.progressRenderInFlight = false;
    this.progressText = "";
  }

  queueProgressiveResult(full) {
    this.progressText = full;
    const words = wordCount(full);
    const meta = document.querySelector("#generationMeta");
    if (meta && !this.progressMetaFrame) {
      this.progressMetaFrame = requestAnimationFrame(() => {
        this.progressMetaFrame = null;
        meta.textContent = `Generating · ${words} words`;
      });
    }
    if (this.progressRenderTimer || this.progressRenderInFlight) return;
    this.progressRenderTimer = setTimeout(() => {
      this.progressRenderTimer = null;
      void this.renderProgressiveResult();
    }, 120);
  }

  async renderProgressiveResult() {
    if (!this.progressText || !this.editors.result) return;
    this.progressRenderInFlight = true;
    const text = this.progressText;
    try {
      const html = await markdownToHtml(text);
      if (text === this.progressText && this.editors.result) {
        this.editors.result.commands.setContent(html, { emitUpdate: false });
        this.toggleEmptyResult();
      }
    } finally {
      this.progressRenderInFlight = false;
      if (this.progressText !== text && !this.progressRenderTimer) {
        this.progressRenderTimer = setTimeout(() => {
          this.progressRenderTimer = null;
          void this.renderProgressiveResult();
        }, 120);
      }
    }
  }

  async flushProgressiveResult(finalText) {
    this.progressText = finalText;
    if (this.progressRenderTimer) { clearTimeout(this.progressRenderTimer); this.progressRenderTimer = null; }
    while (this.progressRenderInFlight) await new Promise(resolve => setTimeout(resolve, 16));
    await this.renderProgressiveResult();
  }

  stopProgressiveResult() {
    if (this.progressRenderTimer) { clearTimeout(this.progressRenderTimer); this.progressRenderTimer = null; }
    if (this.progressMetaFrame) { cancelAnimationFrame(this.progressMetaFrame); this.progressMetaFrame = null; }
    this.progressText = "";
  }

  /* ── Actions ─────────────────────────────────── */
  action(action) {
    if (action === "copy-source") this.copyEditor(this.editors.source);
    if (action === "copy-result") this.copyEditor(this.editors.result);
    if (action === "export-source") this.openExportDialog("source");
    if (action === "export-result") this.openExportDialog("result");
  }
  async copyEditor(editor) { try { const type = await copyRichText(editor); this.toast(type === "rich" ? "Copied rich text to clipboard" : "Copied plain text", "success"); } catch (err) { this.toast(err.message, "error"); } }
  openExportDialog(paneId) {
    const editor = this.editors[paneId];
    if (!editor) { this.toast("This pane is not available.", "error"); return; }
    try { assertEditorContent(editor); } catch (err) { this.toast(err.message, "error"); return; }
    this.exportPaneId = paneId;
    const doc = activeDocument(this.state);
    const label = paneId === "source" ? "Source" : "Draft";
    document.querySelector("#exportDialogTitle").textContent = `Export ${label}`;
    document.querySelector("#exportDialogCopy").textContent = `Export the current ${label.toLowerCase()} editor content. Choose a format below.`;
    document.querySelector("#exportProgress").classList.add("hidden");
    if (!this.exportDialog.open) this.exportDialog.showModal();
  }
  async runExport(format) {
    const paneId = this.exportPaneId;
    const editor = paneId ? this.editors[paneId] : null;
    if (!editor) return;
    const progress = document.querySelector("#exportProgress");
    const label = document.querySelector("#exportProgressLabel");
    const bar = document.querySelector("#exportProgressBar");
    try {
      assertEditorContent(editor);
      const doc = activeDocument(this.state);
      const content = editor.getHTML();
      progress.classList.remove("hidden");
      label.textContent = format === "pdf" ? "Creating PDF…" : "Creating Word document…";
      bar.style.width = "25%";
      await exportDocument({ format, title: doc.title, content, editorElement: editor.view?.dom, suffix: paneId === "source" ? "Notes" : "Draft" });
      bar.style.width = "100%";
      if (this.exportDialog.open) this.exportDialog.close();
      this.toast(`${format.toUpperCase()} exported successfully.`, "success");
    } catch (err) {
      progress.classList.add("hidden");
      this.toast(err.message || "Export failed.", "error");
    }
  }

  updateCounts() { for (const key of ["source", "result"]) { const target = document.querySelector(`#${key}Meta`); if (target) target.textContent = `${wordCount(editorText(this.editors[key])).toLocaleString()} words`; } }
  toggleEmptyResult() { document.querySelector("#emptyResult").classList.toggle("hidden", !!editorText(this.editors.result).trim()); }

  /* ── Document list ───────────────────────────── */
  renderDocs() {
    const list = document.querySelector("#documentList"); list.replaceChildren();
    for (const doc of this.state.documents) {
      const row = document.createElement("div"); row.className = "doc-item-row";

      // Document button
      const btn = document.createElement("button");
      let cls = "doc-item";
      if (doc.id === this.state.activeId) cls += " active";
      if (doc.id === this.generatingDocId) cls += " generating";
      btn.className = cls;
      const icon = document.createElement("span"); icon.className = "doc-icon"; icon.textContent = "▤";
      const title = document.createElement("span"); title.className = "doc-item-title"; title.textContent = doc.title;
      btn.append(icon, title);
      btn.onclick = () => { if (doc.id === this.state.activeId) return; this.saveNow(); this.state.activeId = doc.id; saveState(this.state); this.loadActiveDocument(); this.renderDocs(); };

      // 3-dot menu button (visible on hover)
      const menuBtn = document.createElement("button"); menuBtn.className = "doc-item-menu-btn"; menuBtn.textContent = "⋯"; menuBtn.title = "Document options";
      const dropdown = document.createElement("div"); dropdown.className = "doc-item-dropdown";

      // Rename option
      const renameBtn = document.createElement("button"); renameBtn.textContent = "✎ Rename";
      renameBtn.onclick = e => { e.stopPropagation(); dropdown.classList.remove("visible"); menuBtn.classList.remove("open"); this.renameDoc(doc); };

      // Delete option
      const delBtn = document.createElement("button"); delBtn.className = "danger-option"; delBtn.textContent = "✕ Delete";
      delBtn.onclick = e => { 
        e.stopPropagation(); dropdown.classList.remove("visible"); menuBtn.classList.remove("open"); 
        if (confirm(`Delete "${doc.title}"?`)) { 
          try {
            if (deleteDocument(this.state, doc.id)) { this.loadActiveDocument(); this.renderDocs(); this.toast("Document deleted", "success"); } else this.toast("Cannot delete the last document", "error"); 
          } catch (err) {
            this.toast(err.message || "Could not delete document.", "error");
          }
        } 
      };

      dropdown.append(renameBtn, delBtn);
      menuBtn.onclick = e => {
        e.stopPropagation();
        // Close all other open menus first
        document.querySelectorAll(".doc-item-dropdown.visible").forEach(m => { if (m !== dropdown) m.classList.remove("visible"); });
        document.querySelectorAll(".doc-item-menu-btn.open").forEach(b => { if (b !== menuBtn) b.classList.remove("open"); });
        const isOpen = dropdown.classList.toggle("visible");
        menuBtn.classList.toggle("open", isOpen);
      };

      row.append(btn, menuBtn, dropdown); list.appendChild(row);
    }
  }

  renameDoc(doc) {
    let newTitle = prompt("Rename document:", doc.title);
    if (newTitle === null || !newTitle.trim()) return;
    newTitle = newTitle.trim();
    if (newTitle === doc.title) return;
    
    try {
      newTitle = ensureUniqueTitle(this.state, newTitle, doc.id);
      doc.title = newTitle;
      doc.updatedAt = Date.now();
      saveState(this.state);
      this.renderDocs();
      if (activeDocument(this.state).id === doc.id) {
        const sourceInput = document.querySelector("#sourceDocName");
        const resultSpan = document.querySelector("#resultDocName");
        if (sourceInput) sourceInput.value = newTitle;
        if (resultSpan) resultSpan.textContent = `Draft - ${newTitle}`;
      }
      this.toast("Document renamed.", "success");
    } catch (err) {
      this.toast(err.message || "Could not save renamed document.", "error");
    }
  }

  newDoc() { 
    this.saveNow(); 
    try {
      createDocument(this.state); 
      this.loadActiveDocument(); 
      this.renderDocs(); 
      this.toast("New document created.", "success"); 
    } catch (err) {
      this.toast(err.message || "Could not create new document.", "error");
    }
  }

  /* ── Layout ──────────────────────────────────── */
  toggleSidebar() {
    const isCollapsed = this.sidebar.classList.toggle("collapsed");
    const btn = document.querySelector("#sidebarToggleBtn");
    if (btn) {
      btn.classList.toggle("collapsed", isCollapsed);
      btn.title = isCollapsed ? "Expand sidebar" : "Collapse sidebar";
      btn.setAttribute("aria-label", btn.title);
    }
    const overlay = document.querySelector("#sidebarOverlay");
    if (overlay) overlay.classList.toggle("active", !isCollapsed);
  }
  toggleMaximizePane(paneId, btnEl) {
    const updateIcon = (btn, isMax) => {
      const imax = btn.querySelector('.icon-max'), imin = btn.querySelector('.icon-min');
      if (imax) imax.style.display = isMax ? 'none' : 'block';
      if (imin) imin.style.display = isMax ? 'block' : 'none';
    };
    if (this.maximizedPane === paneId) { this.maximizedPane = null; document.querySelector("#sourcePane").classList.remove("hidden"); document.querySelector("#resultPane").classList.remove("hidden"); document.querySelector("#splitter").classList.remove("hidden"); this.applyPaneRatio(); updateIcon(btnEl, false); btnEl.title = "Maximize pane"; return; }
    this.maximizedPane = paneId; document.querySelector("#sourcePane").classList.toggle("hidden", paneId !== "sourcePane"); document.querySelector("#resultPane").classList.toggle("hidden", paneId !== "resultPane"); document.querySelector("#splitter").classList.add("hidden"); this.applyPaneRatio();
    const other = paneId === "sourcePane" ? document.querySelector("#maxResultBtn") : document.querySelector("#maxSourceBtn"); if (other) { updateIcon(other, false); other.title = "Maximize pane"; } updateIcon(btnEl, true); btnEl.title = "Restore split view";
  }
  applyPaneRatio() {
    const r = this.state.paneRatio || 50;
    const stage = document.querySelector("#editorStage");
    if (!stage) return;
    if (this.maximizedPane) {
      stage.style.gridTemplateColumns = "1fr";
      stage.style.gridTemplateRows = "1fr";
    } else if (window.innerWidth <= 700) {
      stage.style.gridTemplateColumns = "1fr";
      stage.style.gridTemplateRows = `${r}% 8px ${100-r}%`;
    } else {
      stage.style.gridTemplateRows = "minmax(0, 1fr)";
      stage.style.gridTemplateColumns = `${r}% 8px ${100-r}%`;
    }
  }
  setMode(mode) { document.querySelector("#modeSelect").value = mode; }
  updateCustomPreview() { const strip = document.querySelector("#customStrip"), preview = document.querySelector("#customInstructionPreview"), has = !!this.state.customInstruction; strip.classList.toggle("hidden", !has); preview.textContent = has ? this.state.customInstruction : "Add an instruction to steer the selected mode."; }
  openCustomDialog() { this.customInstruction.value = this.state.customInstruction || ""; if (!this.customDialog.open) this.customDialog.showModal(); }
  setupSplitter() {
    const splitter = document.querySelector("#splitter");
    let dragging = false;
    splitter.addEventListener("pointerdown", e => {
      dragging = true;
      splitter.setPointerCapture(e.pointerId);
      document.body.style.cursor = window.innerWidth <= 700 ? "row-resize" : "col-resize";
    });
    splitter.addEventListener("pointermove", e => {
      if (!dragging) return;
      const stage = document.querySelector("#editorStage").getBoundingClientRect();
      if (window.innerWidth <= 700) {
        this.state.paneRatio = Math.max(10, Math.min(90, ((e.clientY - stage.top) / stage.height) * 100));
      } else {
        this.state.paneRatio = Math.max(10, Math.min(90, ((e.clientX - stage.left) / stage.width) * 100));
      }
      this.applyPaneRatio();
    });
    splitter.addEventListener("pointerup", () => {
      dragging = false;
      document.body.style.cursor = "";
      saveState(this.state);
    });
  }
  toggleTheme() { const root = document.documentElement; const next = root.dataset.theme === "dark" ? "light" : "dark"; root.dataset.theme = next; localStorage.setItem("pns.theme", next); }
  restoreTheme() { const saved = localStorage.getItem("pns.theme"); if (saved) document.documentElement.dataset.theme = saved; }
  showInstruction(title, message, links = []) {
    const dialog = document.querySelector("#instructionDialog");
    if (!dialog) return;
    document.querySelector("#instructionTitle").textContent = title;
    document.querySelector("#instructionMessage").textContent = message;
    
    const linksContainer = document.querySelector("#instructionLinks");
    linksContainer.innerHTML = "";
    links.forEach(link => {
      if (link.href) {
        const a = document.createElement("a");
        a.href = link.href;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.className = "secondary-btn";
        a.style.display = "block";
        a.style.textAlign = "center";
        a.textContent = link.text;
        linksContainer.appendChild(a);
      } else if (link.action) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "secondary-btn";
        btn.style.width = "100%";
        btn.textContent = link.text;
        btn.onclick = link.action;
        linksContainer.appendChild(btn);
      }
    });
    
    dialog.showModal();
  }
  toast(message, type = "") { const el = document.createElement("div"); el.className = `toast ${type}`; el.textContent = message; this.toastRegion.appendChild(el); setTimeout(() => el.remove(), 4200); }
}
