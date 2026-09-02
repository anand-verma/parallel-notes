const KEY = "rns.settings.v2";
const LEGACY_KEY = "rns.settings.v1";
const VERSION = 2;

const defaults = () => ({
  version: VERSION,
  apiKeys: { openai: "", gemini: "" },
  rememberApiKeys: true,
  customApiModels: [],
  customCredentials: {},
  theme: "system"
});

function normalize(value = {}) {
  const base = defaults();
  return {
    ...base,
    ...value,
    version: VERSION,
    apiKeys: { ...base.apiKeys, ...(value.apiKeys || {}) },
    customApiModels: Array.isArray(value.customApiModels) ? value.customApiModels : [],
    customCredentials: { ...(value.customCredentials || {}) }
  };
}

function migrate(raw) {
  if (!raw || typeof raw !== "object") return defaults();
  if (raw.version === VERSION) return normalize(raw);
  return normalize({
    apiKeys: raw.apiKeys || {},
    rememberApiKeys: raw.rememberApiKeys !== false,
    customApiModels: raw.customApiModels || []
  });
}

export function loadSettings() {
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
