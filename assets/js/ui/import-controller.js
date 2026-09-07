/** Import controller: file/URL validation, import workflow, progress, and cancellation. */
import { ImportService } from "../services/import/import-service.js";
import { saveState, createDocument } from "../state.js";

export class ImportController {
  constructor(ui) {
    this.ui = ui;
    this.controller = null;
    this.sourceMode = "file";
  }

  renderImportModelOptions() {
    const select = document.querySelector("#importAiModel");
    if (!select) return;
    const models = this.ui.ai.models || [];
    const previous = select.value;
    select.replaceChildren();
    const groups = [
      ["Local LLM", models.filter(m => m.type === "local")],
      ["Gemini", models.filter(m => m.provider === "gemini")],
      ["OpenAI", models.filter(m => m.provider === "openai")],
      ["Custom API", models.filter(m => m.type === "api" && !["gemini", "openai"].includes(m.provider))]
    ];
    let firstReady = "";
    const credentialReady = (provider, model) => !!this.ui.getCredential(provider, model);
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
    const preferred = previous && models.some(m => m.id === previous && !select.querySelector(`option[value="${CSS.escape(previous)}"]`)?.disabled)
      ? previous
      : (models.some(m => m.id === this.ui.ai.selectedModel && !select.querySelector(`option[value="${CSS.escape(this.ui.ai.selectedModel)}"]`)?.disabled) ? this.ui.ai.selectedModel : firstReady);
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

  ensureUrlImportUI() {
    const form = document.querySelector("#importForm");
    const fileRow = document.querySelector(".import-file-row");
    if (!form || !fileRow || document.querySelector("#importSourceTabs")) return;

    const tabs = document.createElement("div");
    tabs.id = "importSourceTabs";
    tabs.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:18px;padding:4px;border:1px solid var(--border);border-radius:10px;background:var(--surface-2);";

    const makeTab = (id, text) => {
      const button = document.createElement("button");
      button.type = "button";
      button.id = id;
      button.className = "secondary-btn";
      button.style.cssText = "border:0;width:100%;min-height:34px;";
      button.textContent = text;
      return button;
    };

    const fileTab = makeTab("importFileTab", "Upload File");
    const urlTab = makeTab("importUrlTab", "Import from URL");
    tabs.append(fileTab, urlTab);
    fileRow.parentNode.insertBefore(tabs, fileRow);

    const urlRow = document.createElement("div");
    urlRow.id = "importUrlRow";
    urlRow.className = "import-file-row hidden";
    urlRow.style.flexDirection = "column";
    urlRow.style.alignItems = "stretch";
    urlRow.innerHTML = `
      <label for="importUrlInput" style="font-size:11px;font-weight:700;color:var(--text);">Webpage URL</label>
      <input id="importUrlInput" type="url" inputmode="url" autocomplete="url" placeholder="https://example.com/article" style="width:100%;min-height:36px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);padding:8px 10px;font:inherit;font-size:11px;outline:0;box-sizing:border-box;">
      <small style="font-size:10px;color:var(--muted);line-height:1.45;">Direct browser fetch is tried first. If the site blocks it, the configured Cloudflare fallback is used.</small>
    `;
    fileRow.parentNode.insertBefore(urlRow, fileRow);

    const activate = mode => {
      this.sourceMode = mode;
      const isUrl = mode === "url";

      fileTab.classList.toggle("primary-btn", !isUrl);
      fileTab.classList.toggle("secondary-btn", isUrl);
      urlTab.classList.toggle("primary-btn", isUrl);
      urlTab.classList.toggle("secondary-btn", !isUrl);

      fileRow.classList.toggle("hidden", isUrl);
      urlRow.classList.toggle("hidden", !isUrl);
      document.querySelector("#importModeOptions")?.classList.toggle("hidden", isUrl);
      document.querySelector("#importAiModelRow")?.classList.toggle("hidden", isUrl);

      const chooseBtn = document.querySelector("#chooseImportFileBtn");
      if (chooseBtn) chooseBtn.textContent = isUrl ? "Choose file" : chooseBtn.textContent;
      const startBtn = document.querySelector("#startImportBtn");
      if (startBtn) startBtn.textContent = isUrl ? "Import URL" : "Upload";
    };

    fileTab.onclick = () => {
      activate("file");
      this.updateImportFileUI();
    };
    urlTab.onclick = () => activate("url");

    this._activateImportSource = activate;
  }

  updateImportFileUI(file = document.querySelector("#importFile")?.files?.[0]) {
    if (this.sourceMode === "url") return;

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
    if (startBtn) startBtn.textContent = type === "pdf" ? "Upload PDF" : type === "docx" ? "Upload DOCX" : "Upload";

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
    if (this.sourceMode === "url") return;
    const row = document.querySelector("#importAiModelRow");
    const file = document.querySelector("#importFile")?.files?.[0];
    const enhanced = this.getImportType(file) === "pdf" && document.querySelector("input[name=importMode]:checked")?.value === "enhanced";
    row?.classList.toggle("hidden", !enhanced);
    if (enhanced) this.renderImportModelOptions();
  }

  openImportDialog() {
    if (this.ui.ai.busy) {
      this.ui.toast("Finish the current AI operation before importing.", "error");
      return;
    }

    this.ensureUrlImportUI();

    const form = document.querySelector("#importForm");
    const file = document.querySelector("#importFile");
    if (form) form.reset();
    if (file) file.value = "";

    this.sourceMode = "file";
    this._activateImportSource?.("file");

    document.querySelector("#importFileName").textContent = "No file selected";
    document.querySelector("#importProgress")?.classList.add("hidden");
    document.querySelector("#importWarning")?.classList.add("hidden");
    document.querySelector("#importUrlInput").value = "";
    this.ui.clearModalError?.(this.ui.importDialog);
    document.querySelector("#startImportBtn").disabled = false;
    document.querySelector("#chooseImportFileBtn").disabled = false;
    this.renderImportModelOptions();
    this.updateImportFileUI(null);

    if (!this.ui.importDialog.open) this.ui.importDialog.showModal();
  }

  cancelImport() {
    this.controller?.abort();
    this.controller = null;
  }

  async finishImportedDocument(result, type, progress, warning) {
    if (this.controller?.signal.aborted) {
      throw new DOMException("Import cancelled", "AbortError");
    }

    progress.bar.style.width = "100%";
    progress.pct.textContent = "100%";
    progress.label.textContent = "Creating document…";

    await this.ui.saveNow();

    const doc = createDocument(this.ui.state, result.title);
    doc.source = result.html || "<p></p>";
    doc.result = "<p></p>";
    doc.updatedAt = Date.now();

    await saveState(this.ui.state);

    this.ui.isDirty = false;
    this.ui.loadActiveDocument();
    this.ui.renderDocs();

    if (result.metadata?.warnings?.length) {
      warning.textContent = result.metadata.warnings.join(" ");
      warning.classList.remove("hidden");
    }

    this.ui.importDialog.close();

    const method =
      result.metadata?.method === "cloudflare"
        ? " · Cloudflare fallback"
        : "";

    this.ui.toast(
      type === "url"
        ? `Web article imported${method}`
        : type === "pdf"
          ? `PDF uploaded · ${result.metadata?.pageCount || 0} pages`
          : "DOCX uploaded",
      "success"
    );
  }

  async importDocument() {
    if (this.sourceMode === "url") {
      await this.importUrl();
      return;
    }

    const file = document.querySelector("#importFile")?.files?.[0];
    const type = this.getImportType(file);
    if (!file) { this.ui.toast("Choose a PDF or DOCX file to import.", "error"); return; }
    if (!type) { this.ui.toast("Only PDF and DOCX files are supported.", "error"); return; }
    if (this.ui.ai.busy) { this.ui.toast("Finish the current AI operation before importing.", "error"); return; }

    const mode = document.querySelector("input[name=importMode]:checked")?.value || "standard";
    const importModelId = document.querySelector("#importAiModel")?.value || "";

    if (type !== "pdf" && mode !== "standard") {
      this.ui.toast("Enhanced Structure Assist is currently available for PDF imports only.", "error");
      return;
    }

    if (mode === "enhanced" && !importModelId) {
      this.ui.toast("Choose a configured or downloaded AI model for Enhanced Structure Assist.", "error");
      return;
    }

    const startBtn = document.querySelector("#startImportBtn");
    const chooseBtn = document.querySelector("#chooseImportFileBtn");
    const progressEl = document.querySelector("#importProgress");
    const warning = document.querySelector("#importWarning");
    const bar = document.querySelector("#importProgressBar");
    const label = document.querySelector("#importProgressLabel");
    const pct = document.querySelector("#importProgressPercent");
    const controller = new AbortController();

    this.controller = controller;
    startBtn.disabled = true;
    chooseBtn.disabled = true;
    progressEl.classList.remove("hidden");
    warning.classList.add("hidden");

    const setProgress = (progressOrValue = {}, text = "") => {
      if (typeof progressOrValue === "object") {
        const { page, pages, phase } = progressOrValue;
        const value = pages ? (page / pages) * 80 : 0;
        bar.style.width = `${Math.round(value)}%`;
        pct.textContent = `${Math.round(value)}%`;
        label.textContent = type === "pdf"
          ? (phase === "extract" ? `Extracting PDF · page ${page} of ${pages}` : "Processing import…")
          : (phase === "extract" ? "Reading DOCX…" : "Processing DOCX…");
      } else {
        const value = 80 + Math.max(0, Math.min(20, Number(progressOrValue) || 0)) * 0.2;
        bar.style.width = `${Math.round(value)}%`;
        pct.textContent = `${Math.round(value)}%`;
        label.textContent = text || "Processing import…";
      }
    };

    try {
      const result = await ImportService.import(file, {
        mode,
        ai: mode === "enhanced" ? this.ui.ai : null,
        modelId: mode === "enhanced" ? importModelId : null,
        signal: controller.signal,
        onProgress: setProgress
      });

      await this.finishImportedDocument(
        result,
        type,
        { bar, pct, label },
        warning
      );
    } catch (err) {
      if (err?.name === "AbortError") {
        this.ui.toast("Import cancelled.", "success");
      } else {
        this.ui.showModalError?.(err.message || "Import failed.", this.ui.importDialog);
        this.ui.toast(err.message || "Import failed.", "error");
      }
    } finally {
      if (this.controller === controller) this.controller = null;
      startBtn.disabled = false;
      chooseBtn.disabled = false;
    }
  }

  async importUrl() {
    if (this.ui.ai.busy) {
      this.ui.toast("Finish the current AI operation before importing.", "error");
      return;
    }

    const input = document.querySelector("#importUrlInput");
    const url = input?.value?.trim() || "";

    if (!url) {
      this.ui.toast("Enter a webpage URL to import.", "error");
      input?.focus();
      return;
    }

    const startBtn = document.querySelector("#startImportBtn");
    const chooseBtn = document.querySelector("#chooseImportFileBtn");
    const progressEl = document.querySelector("#importProgress");
    const warning = document.querySelector("#importWarning");
    const bar = document.querySelector("#importProgressBar");
    const label = document.querySelector("#importProgressLabel");
    const pct = document.querySelector("#importProgressPercent");
    const controller = new AbortController();

    this.controller = controller;
    startBtn.disabled = true;
    chooseBtn.disabled = true;
    progressEl.classList.remove("hidden");
    warning.classList.add("hidden");
    bar.style.width = "10%";
    pct.textContent = "10%";
    label.textContent = "Preparing webpage import…";
    this.ui.clearModalError?.(this.ui.importDialog);

    try {
      const result = await ImportService.importUrl(url, {
        signal: controller.signal,
        onProgress: text => {
          const isFallback = /cloudflare fallback/i.test(text || "");
          bar.style.width = isFallback ? "55%" : "30%";
          pct.textContent = isFallback ? "55%" : "30%";
          label.textContent = text || "Importing webpage…";
        }
      });

      await this.finishImportedDocument(
        result,
        "url",
        { bar, pct, label },
        warning
      );
    } catch (err) {
      if (err?.name === "AbortError") {
        this.ui.toast("URL import cancelled.", "success");
      } else {
        this.ui.showModalError?.(
          err.message || "URL import failed.",
          this.ui.importDialog
        );
        this.ui.toast(err.message || "URL import failed.", "error");
      }
    } finally {
      if (this.controller === controller) this.controller = null;
      startBtn.disabled = false;
      chooseBtn.disabled = false;
    }
  }
}
