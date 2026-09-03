/** Application state management and workspace document tracking. */
export { loadWorkspace as loadState, saveWorkspace as saveState, activeDocument, createDocument, deleteDocument, clearWorkspaceStorage, getStorageUsage, ensureUniqueTitle } from "./storage/workspace-store.js";
export { loadSettings, saveSettings } from "./storage/settings-store.js";
