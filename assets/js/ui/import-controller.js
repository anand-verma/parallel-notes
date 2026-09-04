/** Import controller: file validation, import workflow, progress, and cancellation. */
import { ImportService } from "../services/import/import-service.js";
import { saveState, createDocument } from "../state.js";

export class ImportController {
  constructor(ui) { this.ui = ui; this.controller = null; }

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
    const preferred = previous && models.some(m => m.id === previous && !select.querySelector(`option[value=\"${CSS.escape(previous)}\"]`)?.disabled)
      ? previous
      : (models.some(m => m.id === this.ui.ai.selectedModel && !select.querySelector(`option[value=\"${CSS.escape(this.ui.ai.selectedModel)}\"]`)?.disabled) ? this.ui.ai.selectedModel : firstReady);
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
    const row = document.querySelector("#importAiModelRow");
    const file = document.querySelector("#importFile")?.files?.[0];
    const enhanced = this.getImportType(file) === "pdf" && document.querySelector("input[name=importMode]:checked")?.value === "enhanced";
    row?.classList.toggle("hidden", !enhanced);
    if (enhanced) this.renderImportModelOptions();
  }

  openImportDialog() {
    if (this.ui.ai.busy) { this.ui.toast("Finish the current AI operation before importing.", "error"); return; }
    const form = document.querySelector("#importForm");
    const file = document.querySelector("#importFile");
    if (form) form.reset();
    if (file) file.value = "";
    document.querySelector("#importFileName").textContent = "No file selected";
    document.querySelector("#importProgress")?.classList.add("hidden");
    document.querySelector("#importWarning")?.classList.add("hidden");
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

  async importDocument() {
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
    const progress = document.querySelector("#importProgress");
    const warning = document.querySelector("#importWarning");
    const bar = document.querySelector("#importProgressBar");
    const label = document.querySelector("#importProgressLabel");
    const pct = document.querySelector("#importProgressPercent");
    const controller = new AbortController();
    this.controller = controller;
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
      const result = await ImportService.import(file, { mode, ai: mode === "enhanced" ? this.ui.ai : null, modelId: mode === "enhanced" ? importModelId : null, signal: controller.signal, onProgress: setProgress });
      if (controller.signal.aborted) throw new DOMException("Import cancelled", "AbortError");
      bar.style.width = "100%"; pct.textContent = "100%"; label.textContent = "Creating document…";
      await this.ui.saveNow();
      const doc = createDocument(this.ui.state, result.title);
      doc.source = result.html || "<p></p>";
      doc.result = "<p></p>";
      doc.updatedAt = Date.now();
      await saveState(this.ui.state);
      this.ui.isDirty = false;
      this.ui.loadActiveDocument();
      this.ui.renderDocs();
      this.controller = null;
      this.ui.importDialog.close();
      if (result.metadata?.warnings?.length) {
        warning.textContent = result.metadata.warnings.join(" ");
        warning.classList.remove("hidden");
        this.ui.toast(`${type.toUpperCase()} uploaded with a formatting limitation.`, "success");
      } else {
        this.ui.toast(type === "pdf" ? `PDF uploaded · ${result.metadata?.pageCount || 0} pages` : "DOCX uploaded", "success");
      }
    } catch (err) {
      if (err?.name === "AbortError") this.ui.toast("PDF import cancelled.", "success");
      else this.ui.toast(err.message || "PDF import failed.", "error");
    } finally {
      if (this.controller === controller) this.controller = null;
      startBtn.disabled = false; chooseBtn.disabled = false;
    }
  }
}
