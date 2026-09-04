/** Core AppUI class handling layout, pane management, and interactions. */
import { saveState, saveDocument, loadSettings, saveSettings, clearWorkspaceStorage, getStorageUsage, subscribeWorkspaceChanges, reloadWorkspace, activeDocument, ensureUniqueTitle } from "./state.js";
import { wordCount } from "./editor.js";

import { AIController } from "./ai/controller.js";
import { createSourcePackage } from "./ai/source-package.js";
import { markdownToHtml } from "./services/markdown.js";
import { copyRichText } from "./services/clipboard.js";
import { getCredential, setCredential, setCustomCredential as setStoredCustomCredential, removeCustomCredential as removeStoredCustomCredential } from "./storage/credentials.js";
import { clearAllModelCaches } from "./ai/providers/webllm.js";
import { SettingsUI } from "./ui/settings-ui.js";
import { DocumentController } from "./ui/document-controller.js";
import { ImportController } from "./ui/import-controller.js";
import { ExportController } from "./ui/export-controller.js";
import { renderModelPickerMenu, updatePickerTrigger, renderCacheList } from "./ui/ai-ui.js";

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
    this.documents = new DocumentController(this);
    this.imports = new ImportController(this);
    this.exports = new ExportController(this);
    this.modelLoadWaiters = [];
    this.importDialog = document.querySelector("#importDialog");
    this.exportDialog = document.querySelector("#exportDialog");
    this.exportPaneId = null;
    this.isDirty = false;
    this.workspaceConflict = false;
    this.workspaceUnsubscribe = null;
  }

  async init() {
    this.bind();
    this.restoreTheme();
    this.renderDocs();
    this.loadActiveDocument();
    this.applyPaneRatio();
    this.setMode(this.state.mode);
    this.customInstruction = document.querySelector("#customInstruction");
    this.customInstruction.value = this.state.customInstruction || "";
    this.updateCustomPreview();
    this.workspaceUnsubscribe = subscribeWorkspaceChanges(event => { void this.handleWorkspaceExternalChange(event); });
    await this.initAI();
    
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
    $("#cancelImportBtn").onclick = e => { e.preventDefault(); this.cancelImport(); if (this.importDialog.open) this.importDialog.close(); };
    this.importDialog.querySelector(".modal-head button")?.addEventListener("click", e => { e.preventDefault(); this.cancelImport(); this.importDialog.close(); });
    this.exportDialog?.querySelector(".modal-head button")?.addEventListener("click", e => { e.preventDefault(); if (this.exportDialog.open) this.exportDialog.close(); });
    $("#importForm").onsubmit = e => { e.preventDefault(); void this.importDocument(); };
    document.querySelectorAll("input[name=importMode]").forEach(input => input.addEventListener("change", () => this.updateImportModelVisibility()));
    this.importDialog.addEventListener("close", () => { if (this.imports.controller) this.cancelImport(); });
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
    $("#modeSelect").onchange = e => { this.state.mode = e.target.value; void this.persistWorkspaceMeta(); this.updateCustomPreview(); };

    // Model picker toggle
    $("#modelPickerBtn").onclick = () => this.toggleModelPicker();
    // Close picker on outside click
    document.addEventListener("click", e => {
      if (!e.target.closest("#modelPicker")) this.closeModelPicker();
    });

    $("#customPromptBtn").onclick = () => this.openCustomDialog();
    $("#editCustomBtn").onclick = () => this.openCustomDialog();
    $("#customForm").onsubmit = e => { e.preventDefault(); this.state.customInstruction = this.customInstruction.value.trim(); void this.persistWorkspaceMeta(); this.updateCustomPreview(); this.customDialog.close(); this.toast("Custom instruction applied.", "success"); };
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
            void this.persistActiveDocument();
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

  async clearWorkspaceDocuments() {
    try {
      if (this.ai.busy) await this.ai.cancelGeneration();
      this.stopProgressiveResult();
      this.state = await clearWorkspaceStorage();
      this.isDirty = false;
      this.workspaceConflict = false;
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

  /* ── Import lifecycle ───────────────────────── */
  renderImportModelOptions() { return this.imports.renderImportModelOptions(); }
  getImportType(file) { return this.imports.getImportType(file); }
  updateImportFileUI(file) { return this.imports.updateImportFileUI(file); }
  updateImportModelVisibility() { return this.imports.updateImportModelVisibility(); }
  openImportDialog() { return this.imports.openImportDialog(); }
  cancelImport() { return this.imports.cancelImport(); }
  async importDocument() { return this.imports.importDocument(); }

  /* ── Document lifecycle ─────────────────────── */
  loadActiveDocument() { return this.documents.loadActiveDocument(); }
  onEditorUpdate(key) { return this.documents.onEditorUpdate(key); }
  scheduleCountUpdate() { return this.documents.scheduleCountUpdate(); }
  markDirty() { return this.documents.markDirty(); }
  async persistWorkspaceMeta() { return this.documents.persistWorkspaceMeta(); }
  async persistActiveDocument() { return this.documents.persistActiveDocument(); }
  async saveNow() { return this.documents.saveNow(); }
  async handleWorkspaceExternalChange(event) { return this.documents.handleWorkspaceExternalChange(event); }

  /* ── Summarize ───────────────────────────────── */
  async summarize() {
    if (this.ai.busy) return;
    const sourceEditor = this.editors.source;
    const resultEditor = this.editors.result;
    const doc = activeDocument(this.state);
    if (!doc || !sourceEditor || !resultEditor) { this.toast("The active document is not ready.", "error"); return; }

    const sourcePackage = createSourcePackage(sourceEditor);
    if (!sourcePackage) { this.toast("There is no source content to summarize.", "error"); return; }

    // Capture the document/editor instances at generation start. Document
    // switching destroys and recreates editors; streaming callbacks must never
    // follow the new active editor by accident.
    const session = {
      docId: doc.id,
      sourceEditor,
      resultEditor,
      progressText: "",
      renderTimer: null,
      renderInFlight: false,
    };
    this.generationSession = session;
    this.generatingDocId = doc.id;

    // Keep the existing v0.8 recency behavior.
    const idx = this.state.documents.indexOf(doc);
    if (idx > 0) {
      this.state.documents.splice(idx, 1);
      this.state.documents.unshift(doc);
      await saveState(this.state);
    }
    this.renderDocs();
    this.setGeneratingUI(true);
    document.querySelector("#generationMeta").textContent = sourcePackage.label;

    const isSessionVisible = () => this.generationSession === session && this.state.activeId === session.docId && this.editors.result === session.resultEditor;
    const queue = full => this.queueProgressiveResult(full, session);

    try {
      const result = await this.ai.run({
        mode: this.state.mode,
        custom: this.state.customInstruction,
        sourcePackage,
        onToken: (delta, full) => queue(full)
      });

      if (result === null) {
        if (isSessionVisible()) document.querySelector("#generationMeta").textContent = "Cancelled";
        await this.commitGenerationResult(session, session.progressText, { partial: true });
        return;
      }
      if (!result) throw new Error("The AI returned an empty result.");

      await this.flushProgressiveResult(result, session);
      await this.commitGenerationResult(session, result, { partial: false });
      if (isSessionVisible()) {
        document.querySelector("#generationMeta").textContent = `Generated · ${wordCount(result)} words`;
        this.toast("Draft generated. Review and edit it before using it.", "success");
      }
    } catch (err) {
      const isCancelled = err?.name === "AbortError";
      if (isSessionVisible()) document.querySelector("#generationMeta").textContent = isCancelled ? "Cancelled" : "Generation failed";
      const msg = err.message || "";
      if (!isCancelled && isSessionVisible()) {
        if (msg.includes("Download this model first")) {
          this.showInstruction("Model Not Downloaded", "This local AI model needs to be downloaded before it can be used. This usually only takes a few minutes.", [
            { text: "Download from Settings", action: () => { document.querySelector("#instructionDialog").close(); document.querySelector("#settingsDialog").showModal(); } }
          ]);
        } else if (msg.includes("API key is missing") || msg.includes("Gemini API key is missing")) {
          const isGemini = msg.includes("Gemini");
          const links = [{ text: "Add API key in Settings", action: () => { document.querySelector("#instructionDialog").close(); document.querySelector("#settingsDialog").showModal(); } }];
          if (isGemini) links.push({ text: "Get Gemini API Key", href: "https://aistudio.google.com/app/apikey" });
          else links.push({ text: "Get OpenAI API Key", href: "https://platform.openai.com/api-keys" });
          this.showInstruction("API Key Required", "You must configure an API key to use this cloud model.", links);
        } else this.toast(msg || "Generation failed.", "error");
      }

      if (session.progressText) await this.commitGenerationResult(session, session.progressText, { partial: true });
    } finally {
      if (this.generationSession === session) {
        this.generationSession = null;
        this.generatingDocId = null;
      }
      this.renderDocs();
      if (this.generationSession !== session) this.stopProgressiveResult(session);
      this.setGeneratingUI(false);
    }
  }

  async commitGenerationResult(session, markdown, { partial = false } = {}) {
    if (!markdown?.trim()) return;
    const doc = this.state.documents.find(item => item.id === session.docId);
    if (!doc) return;
    const html = await markdownToHtml(markdown);
    doc.result = html;
    doc.updatedAt = Date.now();
    const docIndex = this.state.documents.findIndex(item => item.id === doc.id);
    if (docIndex > 0) {
      this.state.documents.splice(docIndex, 1);
      this.state.documents.unshift(doc);
      if (this.generationSession === session) this.renderDocs();
    }
    if (this.state.activeId === session.docId && this.editors.result === session.resultEditor) {
      session.resultEditor.commands.setContent(html, { emitUpdate: false });
      this.toggleEmptyResult();
    }
    try { await saveDocument(this.state, session.docId); } catch (error) { this.toast(error.message || "Could not save generated draft.", "error"); }
  }

  /* ── Progressive result streaming ────────────── */
  queueProgressiveResult(full, session = this.generationSession) {
    if (!session || this.generationSession !== session) return;
    session.progressText = full;
    const words = wordCount(full);
    const meta = document.querySelector("#generationMeta");
    if (meta && this.state.activeId === session.docId) {
      if (!this.progressMetaFrame) {
        this.progressMetaFrame = requestAnimationFrame(() => {
          this.progressMetaFrame = null;
          if (this.generationSession === session && this.state.activeId === session.docId) meta.textContent = `Generating · ${words} words`;
        });
      }
    }
    if (session.renderTimer || session.renderInFlight || this.state.activeId !== session.docId || this.editors.result !== session.resultEditor) return;
    session.renderTimer = setTimeout(() => {
      session.renderTimer = null;
      void this.renderProgressiveResult(session);
    }, 120);
  }

  async renderProgressiveResult(session = this.generationSession) {
    if (!session || this.generationSession !== session || !session.progressText) return;
    if (this.state.activeId !== session.docId || this.editors.result !== session.resultEditor) return;
    session.renderInFlight = true;
    const text = session.progressText;
    try {
      const html = await markdownToHtml(text);
      if (this.generationSession === session && this.state.activeId === session.docId && this.editors.result === session.resultEditor && text === session.progressText) {
        session.resultEditor.commands.setContent(html, { emitUpdate: false });
        this.toggleEmptyResult();
      }
    } finally {
      session.renderInFlight = false;
      if (session.progressText !== text && !session.renderTimer && this.generationSession === session && this.state.activeId === session.docId && this.editors.result === session.resultEditor) {
        session.renderTimer = setTimeout(() => { session.renderTimer = null; void this.renderProgressiveResult(session); }, 120);
      }
    }
  }

  async flushProgressiveResult(finalText, session = this.generationSession) {
    if (!session || this.generationSession !== session) return;
    session.progressText = finalText;
    if (session.renderTimer) { clearTimeout(session.renderTimer); session.renderTimer = null; }
    while (session.renderInFlight) await new Promise(resolve => setTimeout(resolve, 16));
    if (this.state.activeId === session.docId && this.editors.result === session.resultEditor) await this.renderProgressiveResult(session);
  }

  stopProgressiveResult(session = this.generationSession) {
    if (!session) return;
    if (session.renderTimer) { clearTimeout(session.renderTimer); session.renderTimer = null; }
    if (this.progressMetaFrame) { cancelAnimationFrame(this.progressMetaFrame); this.progressMetaFrame = null; }
    session.progressText = "";
    session.renderInFlight = false;
    if (this.generationSession === session) this.generationSession = null;
  }

  /* ── Actions ─────────────────────────────────── */
  action(action) {
    if (action === "copy-source") this.copyEditor(this.editors.source);
    if (action === "copy-result") this.copyEditor(this.editors.result);
    if (action === "download-source") this.openExportDialog("source");
    if (action === "download-draft") this.openExportDialog("result");
  }
  async copyEditor(editor) { try { const type = await copyRichText(editor); this.toast(type === "rich" ? "Copied rich text to clipboard" : "Copied plain text", "success"); } catch (err) { this.toast(err.message, "error"); } }
  openExportDialog(paneId) { return this.exports.openExportDialog(paneId); }
  async runExport(format) { return this.exports.runExport(format); }

  updateCounts() { return this.documents.updateCounts(); }
  toggleEmptyResult() { return this.documents.toggleEmptyResult(); }

  /* ── Document lifecycle / list ──────────────── */
  renderDocs() { return this.documents.renderDocs(); }
  async renameDoc(doc) { return this.documents.renameDoc(doc); }
  async newDoc() { return this.documents.newDoc(); }

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
      void this.persistWorkspaceMeta();
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
  clearModalError(dialog = null) {
    const target = dialog || document.querySelector("dialog[open]");
    if (!target) return;
    const el = target.querySelector(".modal-error");
    if (el) { el.textContent = ""; el.classList.add("hidden"); }
  }

  showModalError(message, dialog = null) {
    const target = dialog || document.querySelector("dialog[open]");
    if (!target) return false;
    let el = target.querySelector(".modal-error");
    if (!el) {
      el = document.createElement("div");
      el.className = "modal-error";
      el.setAttribute("role", "alert");
      target.querySelector("form")?.prepend(el);
    }
    el.textContent = String(message || "Something went wrong.");
    el.classList.remove("hidden");
    return true;
  }

  showExportStatus(visible, text = "", percent = 0, autoHide = false) {
    const box = document.querySelector("#exportStatus");
    const label = document.querySelector("#exportStatusLabel");
    const pct = document.querySelector("#exportStatusPercent");
    const bar = document.querySelector("#exportStatusBar");
    if (!box) return;
    if (!visible) { box.hidden = true; return; }
    box.hidden = false;
    if (label) label.textContent = text || "Exporting…";
    const value = Math.max(0, Math.min(100, Number(percent) || 0));
    if (pct) pct.textContent = `${Math.round(value)}%`;
    if (bar) bar.style.width = `${value}%`;
    if (autoHide) setTimeout(() => { box.hidden = true; }, 2200);
  }

  toast(message, type = "") {
    if (type === "error" && document.querySelector("dialog[open]") && this.showModalError(message)) return;
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = message;
    this.toastRegion.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }
}
