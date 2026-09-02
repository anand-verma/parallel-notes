import { WORKSPACE_STORAGE_VERSION } from "../config.js";

const KEY = "rns.workspace.v2";
const LEGACY_KEY = "rns.workspace.v1";
const CLEAR_MARKER = "rns.workspace.cleared.v1";

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const starter = () => ({
  id: uid(),
  title: "UPSC — Sample Notes",
  source: `<h2>Directive Principles of State Policy</h2><p>Directive Principles of State Policy (DPSP) are contained in Part IV of the Constitution, Articles 36–51. They are not enforceable by courts, but Article 37 states that they are fundamental in the governance of the country.</p><ul><li>Social and economic justice</li><li>Equal pay for equal work</li><li>Organisation of village panchayats</li><li>Promotion of international peace</li></ul><p>They guide the State in making laws and policies and complement Fundamental Rights.</p>`,
  result: `<p><strong>Try “Short Notes”</strong> to compress the sample source. The result stays fully editable.</p>`,
  single: `<h2>Standalone notes</h2><p>Use Single View when you want a normal rich-text workspace without a source/result split.</p>`,
  updatedAt: Date.now()
});

export function emptyWorkspace() {
  const doc = normalizeDoc({ title: "Untitled Notes", source: "<p></p>", result: "<p></p>", single: "<p></p>" });
  return { version: WORKSPACE_STORAGE_VERSION, documents: [doc], activeId: doc.id, view: "dual", mode: "short", customInstruction: "", paneRatio: 50 };
}

export function clearWorkspaceStorage() {
  localStorage.removeItem(KEY);
  localStorage.removeItem(LEGACY_KEY);
  localStorage.removeItem(CLEAR_MARKER);
  return emptyWorkspace();
}

function defaults() {
  const doc = starter();
  return { version: WORKSPACE_STORAGE_VERSION, documents: [doc], activeId: doc.id, view: "dual", mode: "short", customInstruction: "", paneRatio: 50 };
}

function normalizeDoc(doc) {
  return {
    id: doc?.id || uid(),
    title: doc?.title || "Untitled Notes",
    source: doc?.source || "<p></p>",
    result: doc?.result || "<p></p>",
    single: doc?.single || "<p></p>",
    updatedAt: doc?.updatedAt || Date.now()
  };
}

function migrate(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.documents) || !raw.documents.length) return defaults();
  return {
    ...defaults(),
    ...raw,
    version: WORKSPACE_STORAGE_VERSION,
    documents: raw.documents.map(normalizeDoc),
    paneRatio: Math.max(25, Math.min(75, Number(raw.paneRatio) || 50))
  };
}

export function loadWorkspace() {
  try {
    const current = localStorage.getItem(KEY);
    if (current) return migrate(JSON.parse(current));
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const migrated = migrate(JSON.parse(legacy));
      localStorage.setItem(KEY, JSON.stringify(migrated));
      localStorage.removeItem(LEGACY_KEY);
      return migrated;
    }
    return defaults();
  } catch {
    return defaults();
  }
}

export function saveWorkspace(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...state, version: WORKSPACE_STORAGE_VERSION }));
    return true;
  } catch (error) {
    const message = error?.name === "QuotaExceededError"
      ? "Workspace storage is full. Delete old documents or clear site data to continue saving."
      : "Workspace could not be saved in this browser.";
    const wrapped = new Error(message);
    wrapped.cause = error;
    throw wrapped;
  }
}

export function activeDocument(state) {
  return state.documents.find(d => d.id === state.activeId) || state.documents[0];
}

export function createDocument(state, title = "Untitled Notes") {
  const doc = normalizeDoc({ id: uid(), title, source: "<p></p>", result: "<p></p>", single: "<p></p>" });
  state.documents.unshift(doc);
  state.activeId = doc.id;
  saveWorkspace(state);
  return doc;
}

export function deleteDocument(state, id) {
  if (state.documents.length === 1) return false;
  state.documents = state.documents.filter(d => d.id !== id);
  if (state.activeId === id) state.activeId = state.documents[0].id;
  saveWorkspace(state);
  return true;
}
