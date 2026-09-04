/** Application state facade: document persistence lives in the IndexedDB workspace repository. */
export {
  loadWorkspace as loadState,
  saveWorkspace as saveState,
  saveWorkspaceMeta,
  saveDocument,
  activeDocument,
  createDocument,
  deleteDocument,
  clearWorkspaceStorage,
  getStorageUsage,
  ensureUniqueTitle,
  subscribeWorkspaceChanges,
  reloadWorkspace,
  deleteDatabase
} from "./storage/workspace-store.js";
export { loadSettings, saveSettings } from "./storage/settings-store.js";
