/** Export controller: dialog state, progress feedback, and document export. */
import { activeDocument } from "../state.js";
import { exportDocument, prepareExport } from "../services/export.js";

function assertEditorContent(editor) {
  const html = editor?.getHTML?.() || "";
  if (!html.trim() || html === "<p></p>" || html === "<p><br></p>") throw new Error("Nothing to export.");
  return html;
}

export class ExportController {
  constructor(ui) { this.ui = ui; }

  openExportDialog(paneId) {
    const editor = this.ui.editors[paneId];
    if (!editor) { this.ui.toast("This pane is not available.", "error"); return; }
    try { this.assertEditorContent(editor); } catch (err) { this.ui.toast(err.message, "error"); return; }
    this.ui.exportPaneId = paneId;
    const label = paneId === "source" ? "Source" : "Draft";
    const title = document.querySelector("#exportDialogTitle");
    const copy = document.querySelector("#exportDialogCopy");
    if (title) title.textContent = `Download ${label}`;
    if (copy) copy.textContent = `Download the current ${label.toLowerCase()} editor content. Choose a format below.`;
    document.querySelector("#exportProgress")?.classList.add("hidden");
    this.ui.clearModalError?.(this.ui.exportDialog);
    if (!this.ui.exportDialog.open) this.ui.exportDialog.showModal();
    void Promise.all([prepareExport("pdf"), prepareExport("docx")]).catch(() => {});
  }

  async runExport(format) {
    const paneId = this.ui.exportPaneId;
    const editor = paneId ? this.ui.editors[paneId] : null;
    const doc = activeDocument(this.ui.state);
    if (!editor || !doc) { this.ui.toast("The selected document is not ready for download.", "error"); return; }

    try {
      const content = this.assertEditorContent(editor);
      // Capture the exact document/editor at click time. Export must never
      // follow a later document switch.
      const snapshot = {
        docId: doc.id,
        title: doc.title,
        content,
        editorElement: editor.view?.dom || null,
        prefix: paneId === "source" ? "Notes" : "Draft",
      };

      if (this.ui.exportDialog.open) this.ui.exportDialog.close();
      this.ui.showExportStatus?.(true, format === "pdf" ? "Preparing PDF…" : "Preparing Word document…", 2);

      await exportDocument({
        format,
        title: snapshot.title,
        content: snapshot.content,
        editorElement: snapshot.editorElement,
        prefix: snapshot.prefix,
        onProgress: ({ percent, detail }) => {
          this.ui.showExportStatus?.(true, detail || (format === "pdf" ? "Creating PDF…" : "Creating Word document…"), percent);
        },
      });

      this.ui.showExportStatus?.(true, format === "pdf" ? "PDF download started" : "Word download started", 100, true);
      this.ui.toast(`${format.toUpperCase()} downloaded successfully.`, "success");
    } catch (err) {
      this.ui.showExportStatus?.(false);
      this.ui.toast(err.message || "Export failed.", "error");
    }
  }

  assertEditorContent(editor) { return assertEditorContent(editor); }
}
