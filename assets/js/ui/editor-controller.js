/** Editor lifecycle controller: owns Tiptap instances, editor-derived UI state, and animation scheduling. */
import { activeDocument } from "../state.js";
import { createEditor, editorText, wordCount } from "../editor.js";

export class EditorController {
  constructor(ui) { this.ui = ui; }

  loadActiveDocument() {
    const doc = activeDocument(this.ui.state);
    if (!doc) return;

    const sourceInput = document.querySelector("#sourceDocName");
    const resultSpan = document.querySelector("#resultDocName");
    if (sourceInput) sourceInput.value = doc.title || "Document Name";
    if (resultSpan) resultSpan.textContent = `Draft - ${doc.title || "Document Name"}`;

    for (const key of ["source", "result"]) {
      const host = document.querySelector(`#${key}Editor`);
      if (!host) continue;
      this.ui.editors[key]?.destroy();
      host.replaceChildren();
      let createdEditor = null;
      createdEditor = createEditor(host, doc[key] || "<p></p>", () => this.onEditorUpdate(key, doc.id, createdEditor));
      this.ui.editors[key] = createdEditor;
    }

    this.updateCounts();
    this.toggleEmptyResult();
  }

  onEditorUpdate(key, documentId, editorInstance) {
    const doc = activeDocument(this.ui.state);
    const editor = this.ui.editors[key];
    // A destroyed editor from the previous document must never write into the
    // newly active document. This is especially important while AI streaming
    // is still active during a document switch.
    if (!doc || doc.id !== documentId || !editor || editor !== editorInstance) return;
    doc[key] = editor.getHTML();
    doc.updatedAt = Date.now();
    this.ui.documents.markDirty();
    this.scheduleCountUpdate();
    if (key === "result") this.toggleEmptyResult();
  }

  scheduleCountUpdate() {
    if (this.ui.countFrame) return;
    this.ui.countFrame = requestAnimationFrame(() => {
      this.ui.countFrame = null;
      this.updateCounts();
    });
  }

  updateCounts() {
    for (const key of ["source", "result"]) {
      const target = document.querySelector(`#${key}Meta`);
      const editor = this.ui.editors[key];
      if (target) target.textContent = `${wordCount(editorText(editor)).toLocaleString()} words`;
    }
  }

  toggleEmptyResult() {
    const empty = document.querySelector("#emptyResult");
    const editor = this.ui.editors.result;
    if (empty) empty.classList.toggle("hidden", !!editorText(editor).trim());
  }
}
