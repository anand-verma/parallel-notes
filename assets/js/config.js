/** Global configuration constants and default settings. */
export const APP_VERSION = "0.7.1";
export const SHELL_CACHE = `pns-shell-v${APP_VERSION}`;
export const WEBLLM_VERSION = "0.2.84";

// Curated local models. WebLLM availability is checked at runtime.
export const PREFERRED_MODEL_IDS = [
  "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
  "Llama-3.2-1B-Instruct-q4f16_1-MLC",
  "SmolLM2-1.7B-Instruct-q4f16_1-MLC"
];

export const API_MODELS = [
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite", provider: "gemini", type: "api", protocol: "gemini", isDefault: true },
  { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite", provider: "gemini", type: "api", protocol: "gemini" },
  { id: "gpt-5-nano", label: "GPT-5 Nano", provider: "openai", type: "api", protocol: "openai-compatible", baseUrl: "https://api.openai.com/v1", isDefault: true },
  { id: "gpt-4.1-mini", label: "GPT-4.1 Mini", provider: "openai", type: "api", protocol: "openai-compatible", baseUrl: "https://api.openai.com/v1" }
];

// Display labels for provider groups in the model picker and settings
export const PROVIDER_LABELS = {
  local: "Local LLM",
  gemini: "Gemini",
  openai: "OpenAI",
  custom: "Custom API"
};

export const MODELS_STORAGE_VERSION = 1;
export const WORKSPACE_STORAGE_VERSION = 2;
export const SETTINGS_STORAGE_VERSION = 3;
