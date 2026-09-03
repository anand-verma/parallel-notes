import { saveState, activeDocument, createDocument, deleteDocument, loadSettings, saveSettings, clearWorkspaceStorage } from "./state.js";
import { createEditor, editorText, wordCount } from "./editor.js";
import { AIController } from "./ai/controller.js";
import { createSourcePackage } from "./ai/source-package.js";
import { markdownToHtml } from "./services/markdown.js";
import { copyRichText } from "./services/clipboard.js";
import { exportHtmlDocument } from "./services/export.js";
import { getCredential, setCredential } from "./storage/credentials.js";
import { clearAllModelCaches } from "./ai/providers/webllm.js";
import { SettingsUI } from "./ui/settings-ui.js";
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
    this.modelLoadWaiters = [];
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
    $("#themeBtn").onclick = () => this.toggleTheme();
    $("#settingsBtn").onclick = () => this.settingsUI.open();
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
    this.settings.customCredentials ||= {};
    sessionStorage.removeItem(`pns.session.${id}`);
    if (remember) this.settings.customCredentials[id] = value;
    else {
      delete this.settings.customCredentials[id];
      if (value) sessionStorage.setItem(`pns.session.${id}`, value);
    }
  }
  getCredential(provider, model) {
    if (model?.credentialId) return this.settings.customCredentials?.[model.credentialId] || sessionStorage.getItem(`pns.session.${model.credentialId}`) || "";
    return getCredential(provider, this.settings);
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
        this.stopGeneration();
        const started = Date.now();
        while (this.ai.busy && Date.now() - started < 3000) await new Promise(resolve => setTimeout(resolve, 40));
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

  /* ── Editor ──────────────────────────────────── */
  loadActiveDocument() {
    const doc = activeDocument(this.state);
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
    try {
      saveState(this.state);
      const el = document.querySelector("#saveState");
      el.textContent = `Saved · ${new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"})}`;
      el.className = "save-state";
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
      if (!isCancelled) this.toast(err.message || "Generation failed.", "error");
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
  action(action) { if (action === "copy-source") this.copyEditor(this.editors.source); if (action === "copy-result") this.copyEditor(this.editors.result); if (action === "export-source") this.exportDoc("source"); if (action === "export-result") this.exportDoc("result"); }
  async copyEditor(editor) { try { const type = await copyRichText(editor); this.toast(type === "rich" ? "Copied rich text to clipboard" : "Copied plain text", "success"); } catch (err) { this.toast(err.message, "error"); } }
  exportDoc(paneId) { try { const doc = activeDocument(this.state); exportHtmlDocument({ title: doc.title, content: paneId === "source" ? doc.source : doc.result, suffix: paneId === "source" ? "Notes" : "Draft" }); this.toast("Document exported successfully.", "success"); } catch (err) { this.toast(err.message, "error"); } }

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
      delBtn.onclick = e => { e.stopPropagation(); dropdown.classList.remove("visible"); menuBtn.classList.remove("open"); if (confirm(`Delete "${doc.title}"?`)) { if (deleteDocument(this.state, doc.id)) { this.loadActiveDocument(); this.renderDocs(); this.toast("Document deleted", "success"); } else this.toast("Cannot delete the last document", "error"); } };

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
    const newTitle = prompt("Rename document:", doc.title);
    if (newTitle === null || !newTitle.trim()) return;
    doc.title = newTitle.trim();
    doc.updatedAt = Date.now();
    saveState(this.state);
    this.renderDocs();
    this.toast("Document renamed.", "success");
  }

  newDoc() { this.saveNow(); createDocument(this.state); this.loadActiveDocument(); this.renderDocs(); this.toast("New document created.", "success"); }

  /* ── Layout ──────────────────────────────────── */
  toggleSidebar() {
    const isCollapsed = this.sidebar.classList.toggle("collapsed");
    const btn = document.querySelector("#sidebarToggleBtn");
    if (btn) {
      btn.textContent = isCollapsed ? "▸" : "◂";
      btn.title = isCollapsed ? "Expand sidebar" : "Collapse sidebar";
      btn.setAttribute("aria-label", btn.title);
    }
  }
  toggleMaximizePane(paneId, btnEl) {
    if (this.maximizedPane === paneId) { this.maximizedPane = null; document.querySelector("#sourcePane").classList.remove("hidden"); document.querySelector("#resultPane").classList.remove("hidden"); document.querySelector("#splitter").classList.remove("hidden"); this.applyPaneRatio(); btnEl.textContent = "⤢"; btnEl.title = "Maximize pane"; return; }
    this.maximizedPane = paneId; document.querySelector("#sourcePane").classList.toggle("hidden", paneId !== "sourcePane"); document.querySelector("#resultPane").classList.toggle("hidden", paneId !== "resultPane"); document.querySelector("#splitter").classList.add("hidden"); this.applyPaneRatio();
    const other = paneId === "sourcePane" ? document.querySelector("#maxResultBtn") : document.querySelector("#maxSourceBtn"); other.textContent = "⤢"; other.title = "Maximize pane"; btnEl.textContent = "◫"; btnEl.title = "Restore split view";
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
  toast(message, type = "") { const el = document.createElement("div"); el.className = `toast ${type}`; el.textContent = message; this.toastRegion.appendChild(el); setTimeout(() => el.remove(), 4200); }
}
