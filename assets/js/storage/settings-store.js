/** LocalStorage wrappers for user settings and preferences. */
import { PREFERRED_MODEL_IDS } from "../config.js";

const KEY = "pns.settings.v4";
const LEGACY_KEYS = ["pns.settings.v3", "pns.settings.v2", "pns.settings.v1"];
const VERSION = 4;

export const defaults = () => ({
  version: VERSION,
  apiKeys: { openai: "", gemini: "" },
  rememberApiKeys: true,
  customApiModels: [],
  customCredentials: {},
  theme: "system",
  enabledLocalModels: [...PREFERRED_MODEL_IDS],
  addedApiModels: { gemini: [], openai: [] },
  removedApiModels: [],
  aiGeneration: {
    fidelityProfile: "strict",
    shortTargetPercent: 45,
    superTargetPercent: 18,
    temperature: 0.15,
    topP: 0.9,
    maxOutputTokens: 4096,
    localContextTokens: 16384,
    contextTokens: 16384,
    autoChunkLongDocuments: true,
    reasoningEffort: "minimal",
    geminiThinkingLevel: "minimal",
    promptAddendum: ""
  }
});

export function getDefaultAIGenerationSettings() {
  return { ...defaults().aiGeneration };
}

function normalize(value = {}) {
  const base = defaults();
  const ai = value.aiGeneration || {};
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
    removedApiModels: Array.isArray(value.removedApiModels) ? value.removedApiModels : [],
    aiGeneration: {
      ...base.aiGeneration,
      ...ai,
      fidelityProfile: ["strict", "balanced", "custom"].includes(ai.fidelityProfile) ? ai.fidelityProfile : base.aiGeneration.fidelityProfile,
      shortTargetPercent: numberInRange(ai.shortTargetPercent, 30, 70, base.aiGeneration.shortTargetPercent),
      superTargetPercent: numberInRange(ai.superTargetPercent, 8, 35, base.aiGeneration.superTargetPercent),
      temperature: numberInRange(ai.temperature, 0, 2, base.aiGeneration.temperature),
      topP: numberInRange(ai.topP, 0.1, 1, base.aiGeneration.topP),
      maxOutputTokens: integerInRange(ai.maxOutputTokens, 128, 32768, base.aiGeneration.maxOutputTokens),
      contextTokens: nearestContext(ai.contextTokens, base.aiGeneration.contextTokens),
      autoChunkLongDocuments: ai.autoChunkLongDocuments !== false,
      localContextTokens: nearestContext(ai.localContextTokens, base.aiGeneration.localContextTokens),
      reasoningEffort: ["none", "minimal", "low", "medium", "high"].includes(ai.reasoningEffort) ? ai.reasoningEffort : base.aiGeneration.reasoningEffort,
      geminiThinkingLevel: ["minimal", "low", "medium", "high"].includes(ai.geminiThinkingLevel) ? ai.geminiThinkingLevel : base.aiGeneration.geminiThinkingLevel,
      promptAddendum: typeof ai.promptAddendum === "string" ? ai.promptAddendum.slice(0, 4000) : ""
    }
  };
}

function numberInRange(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
function integerInRange(value, min, max, fallback) {
  return Math.round(numberInRange(value, min, max, fallback));
}
function nearestContext(value, fallback) {
  const allowed = [4096, 8192, 16384, 32768, 65536, 131072, 262144];
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return allowed.reduce((best, current) => Math.abs(current - n) < Math.abs(best - n) ? current : best, allowed[0]);
}

function migrate(raw) {
  if (!raw || typeof raw !== "object") return defaults();
  return normalize({
    apiKeys: raw.apiKeys || {},
    rememberApiKeys: raw.rememberApiKeys !== false,
    customApiModels: raw.customApiModels || [],
    customCredentials: raw.customCredentials || {},
    theme: raw.theme || "system",
    enabledLocalModels: raw.enabledLocalModels,
    addedApiModels: raw.addedApiModels,
    removedApiModels: raw.removedApiModels,
    aiGeneration: raw.aiGeneration || {}
  });
}

export function loadSettings() {
  try {
    const current = localStorage.getItem(KEY);
    if (current) return migrate(JSON.parse(current));
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
