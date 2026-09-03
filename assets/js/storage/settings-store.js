import { PREFERRED_MODEL_IDS } from "../config.js";

const KEY = "pns.settings.v3";
const LEGACY_KEYS = ["pns.settings.v2", "pns.settings.v1"];
const VERSION = 3;

const defaults = () => ({
  version: VERSION,
  apiKeys: { openai: "", gemini: "" },
  rememberApiKeys: true,
  customApiModels: [],
  customCredentials: {},
  theme: "system",
  // v3: user-driven model management
  enabledLocalModels: [...PREFERRED_MODEL_IDS],
  addedApiModels: { gemini: [], openai: [] },
  removedApiModels: []
});

function normalize(value = {}) {
  const base = defaults();
  return {
    ...base,
    ...value,
    version: VERSION,
    apiKeys: { ...base.apiKeys, ...(value.apiKeys || {}) },
    customApiModels: Array.isArray(value.customApiModels) ? value.customApiModels : [],
    customCredentials: { ...(value.customCredentials || {}) },
    enabledLocalModels: Array.isArray(value.enabledLocalModels) ? value.enabledLocalModels : [...PREFERRED_MODEL_IDS],
    addedApiModels: {
      gemini: Array.isArray(value.addedApiModels?.gemini) ? value.addedApiModels.gemini : [],
      openai: Array.isArray(value.addedApiModels?.openai) ? value.addedApiModels.openai : []
    },
    removedApiModels: Array.isArray(value.removedApiModels) ? value.removedApiModels : []
  };
}

function migrate(raw) {
  if (!raw || typeof raw !== "object") return defaults();
  if (raw.version === VERSION) return normalize(raw);
  // v1/v2 → v3: carry over existing keys, initialize new fields from defaults
  return normalize({
    apiKeys: raw.apiKeys || {},
    rememberApiKeys: raw.rememberApiKeys !== false,
    customApiModels: raw.customApiModels || [],
    customCredentials: raw.customCredentials || {}
  });
}

export function loadSettings() {
  try {
    const current = localStorage.getItem(KEY);
    if (current) return migrate(JSON.parse(current));
    // Try legacy keys in order
    for (const legacyKey of LEGACY_KEYS) {
      const legacy = localStorage.getItem(legacyKey);
      if (legacy) {
        const migrated = migrate(JSON.parse(legacy));
        localStorage.setItem(KEY, JSON.stringify(migrated));
        localStorage.removeItem(legacyKey);
        return migrated;
      }
    }
    return defaults();
  } catch {
    return defaults();
  }
}

export function saveSettings(settings) {
  const normalized = normalize(settings);
  try {
    localStorage.setItem(KEY, JSON.stringify(normalized));
  } catch (error) {
    const message = error?.name === "QuotaExceededError"
      ? "Settings could not be saved because browser storage is full."
      : "Settings could not be saved in this browser.";
    const wrapped = new Error(message);
    wrapped.cause = error;
    throw wrapped;
  }
  return normalized;
}

export function clearPersistedApiKey(provider, settings) {
  settings.apiKeys ||= {};
  settings.apiKeys[provider] = "";
  saveSettings(settings);
}

