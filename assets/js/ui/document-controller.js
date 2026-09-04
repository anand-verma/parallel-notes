/** Document lifecycle controller: editing, autosave, CRUD, and workspace synchronization. */
import { saveState, saveDocument, saveWorkspaceMeta, activeDocument, createDocument, deleteDocument, ensureUniqueTitle, getStorageUsage, reloadWorkspace } from "../state.js";
import { EditorController } from "./editor-controller.js";

export class DocumentController {
  constructor(ui) {
    this.ui = ui;
    this.editor = new EditorController(ui);
    this.lastTouchedDocumentId = null;
  }

  loadActiveDocument() { return this.editor.loadActiveDocument(); }
  onEditorUpdate(key) { return this.editor.onEditorUpdate(key); }
  scheduleCountUpdate() { return this.editor.scheduleCountUpdate(); }
  updateCounts() { return this.editor.updateCounts(); }
  toggleEmptyResult() { return this.editor.toggleEmptyResult(); }

  /**
   * A document is considered recently modified as soon as its editor changes.
   * Keep the most recently touched document at the top, matching the v0.8
   * workflow, but only re-render the sidebar when the ordering actually changes.
   */
  markDirty() {
    const doc = activeDocument(this.ui.state);
    if (doc) {
      doc.updatedAt = Date.now();
      const index = this.ui.state.documents.findIndex(item => item.id === doc.id);
      if (index > 0) {
        this.ui.state.documents.splice(index, 1);
        this.ui.state.documents.unshift(doc);
        this.lastTouchedDocumentId = doc.id;
        this.ui.renderDocs();
      } else if (this.lastTouchedDocumentId !== doc.id) {
        this.lastTouchedDocumentId = doc.id;
      }
    }

    this.ui.isDirty = true;
    const el = document.querySelector("#saveState");
    if (el) { el.textContent = "Unsaved"; el.className = "save-state saving"; }
    clearTimeout(this.ui.saveTimer);
    this.ui.saveTimer = setTimeout(() => { void this.saveNow(); }, 700);
  }

  async persistWorkspaceMeta() {
    try {
      await saveWorkspaceMeta(this.ui.state);
      this.ui.workspaceConflict = false;
    } catch (error) {
      this.ui.workspaceConflict = true;
      this.ui.toast(error.message || "Could not save workspace settings.", "error");
    }
  }

  async persistActiveDocument() {
    const doc = activeDocument(this.ui.state);
    if (!doc) return;
    await saveDocument(this.ui.state, doc.id);
    this.ui.isDirty = false;
    this.ui.workspaceConflict = false;
  }

  async saveNow() {
    if (this.ui.saveTimer) { clearTimeout(this.ui.saveTimer); this.ui.saveTimer = null; }
    try {
      await this.persistActiveDocument();
      const el = document.querySelector("#saveState");
      if (el) {
        el.textContent = `Saved · ${new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"})}`;
        el.className = "save-state";
      }
      const usage = await getStorageUsage();
      if (usage > 20_000_000 && !this.ui.storageWarned) {
        this.ui.storageWarned = true;
        this.ui.toast("Workspace is getting large. IndexedDB has more capacity than the old storage, but consider archiving unused documents.", "error");
      } else if (usage < 15_000_000) {
        this.ui.storageWarned = false;
      }
    } catch (error) {
      this.ui.isDirty = true;
      const el = document.querySelector("#saveState");
      if (el) {
        el.textContent = error.message?.includes("another tab") ? "Conflict" : "Save failed";
        el.className = "save-state error";
      }
      this.ui.toast(error.message || "Could not save workspace.", "error");
    }
  }

  async handleWorkspaceExternalChange() {
    if (this.ui.workspaceConflict) return;
    if (this.ui.isDirty) {
      this.ui.workspaceConflict = true;
      const el = document.querySelector("#saveState");
      if (el) { el.textContent = "Changed in another tab"; el.className = "save-state error"; }
      this.ui.toast("This workspace changed in another tab. Save your current edits elsewhere before reloading.", "error");
      return;
    }
    try {
      const next = await reloadWorkspace();
      this.ui.state = next;
      this.lastTouchedDocumentId = null;
      this.loadActiveDocument();
      this.renderDocs();
      this.ui.setMode(this.ui.state.mode);
      if (this.ui.customInstruction) this.ui.customInstruction.value = this.ui.state.customInstruction || "";
      this.ui.updateCustomPreview();
      const el = document.querySelector("#saveState");
      if (el) { el.textContent = "Updated from another tab"; el.className = "save-state"; }
    } catch (error) {
      this.ui.toast(error.message || "Could not refresh workspace changes.", "error");
    }
  }

  renderDocs() {
    const list = document.querySelector("#documentList");
    if (!list) return;
    list.replaceChildren();
    for (const doc of this.ui.state.documents) {
      const row = document.createElement("div");
      row.className = "doc-item-row";

      const btn = document.createElement("button");
      let cls = "doc-item";
      if (doc.id === this.ui.state.activeId) cls += " active";
      if (doc.id === this.ui.generatingDocId) cls += " generating";
      btn.className = cls;
      const icon = document.createElement("span");
      icon.className = "doc-icon";
      icon.textContent = "▤";
      const title = document.createElement("span");
      title.className = "doc-item-title";
      title.textContent = doc.title;
      btn.append(icon, title);
      btn.onclick = async () => {
        if (doc.id === this.ui.state.activeId) return;
        await this.saveNow();
        if (this.ui.workspaceConflict) return;
        this.ui.state.activeId = doc.id;
        await saveWorkspaceMeta(this.ui.state);
        this.lastTouchedDocumentId = null;
        this.loadActiveDocument();
        this.renderDocs();
      };

      const menuBtn = document.createElement("button");
      menuBtn.className = "doc-item-menu-btn";
      menuBtn.textContent = "⋯";
      menuBtn.title = "Document options";
      const dropdown = document.createElement("div");
      dropdown.className = "doc-item-dropdown";

      const renameBtn = document.createElement("button");
      renameBtn.textContent = "✎ Rename";
      renameBtn.onclick = e => {
        e.stopPropagation();
        dropdown.classList.remove("visible");
        menuBtn.classList.remove("open");
        void this.renameDoc(doc);
      };

      const delBtn = document.createElement("button");
      delBtn.className = "danger-option";
      delBtn.textContent = "✕ Delete";
      delBtn.onclick = async e => {
        e.stopPropagation();
        dropdown.classList.remove("visible");
        menuBtn.classList.remove("open");
        if (!confirm(`Delete "${doc.title}"?`)) return;
        try {
          if (deleteDocument(this.ui.state, doc.id)) {
            await saveState(this.ui.state);
            this.ui.isDirty = false;
            this.lastTouchedDocumentId = null;
            this.loadActiveDocument();
            this.renderDocs();
            this.ui.toast("Document deleted", "success");
          } else {
            this.ui.toast("Cannot delete the last document", "error");
          }
        } catch (err) {
          this.ui.toast(err.message || "Could not delete document.", "error");
        }
      };

      dropdown.append(renameBtn, delBtn);
      menuBtn.onclick = e => {
        e.stopPropagation();
        document.querySelectorAll(".doc-item-dropdown.visible").forEach(m => { if (m !== dropdown) m.classList.remove("visible"); });
        document.querySelectorAll(".doc-item-menu-btn.open").forEach(b => { if (b !== menuBtn) b.classList.remove("open"); });
        const isOpen = dropdown.classList.toggle("visible");
        menuBtn.classList.toggle("open", isOpen);
      };

      row.append(btn, menuBtn, dropdown);
      list.appendChild(row);
    }
  }

  async renameDoc(doc) {
    let newTitle = prompt("Rename document:", doc.title);
    if (newTitle === null || !newTitle.trim()) return;
    newTitle = newTitle.trim();
    if (newTitle === doc.title) return;

    try {
      newTitle = ensureUniqueTitle(this.ui.state, newTitle, doc.id);
      doc.title = newTitle;
      doc.updatedAt = Date.now();
      const index = this.ui.state.documents.findIndex(item => item.id === doc.id);
      if (index > 0) {
        this.ui.state.documents.splice(index, 1);
        this.ui.state.documents.unshift(doc);
      }
      await saveDocument(this.ui.state, doc.id);
      this.ui.isDirty = false;
      this.renderDocs();
      const current = activeDocument(this.ui.state);
      if (current?.id === doc.id) {
        const sourceInput = document.querySelector("#sourceDocName");
        const resultSpan = document.querySelector("#resultDocName");
        if (sourceInput) sourceInput.value = newTitle;
        if (resultSpan) resultSpan.textContent = `Draft - ${newTitle}`;
      }
      this.ui.toast("Document renamed.", "success");
    } catch (err) {
      this.ui.toast(err.message || "Could not save renamed document.", "error");
    }
  }

  async newDoc() {
    await this.saveNow();
    if (this.ui.workspaceConflict) return;
    try {
      createDocument(this.ui.state);
      await saveState(this.ui.state);
      this.ui.isDirty = false;
      this.lastTouchedDocumentId = null;
      this.loadActiveDocument();
      this.renderDocs();
      this.ui.toast("New document created.", "success");
    } catch (err) {
      this.ui.toast(err.message || "Could not create new document.", "error");
    }
  }
}
