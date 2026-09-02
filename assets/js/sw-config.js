const SW_APP_VERSION = "0.4.0";
const SW_SHELL_CACHE = `rns-shell-v${SW_APP_VERSION}`;
const SW_SHELL = [
  "./",
  "./index.html",
  "./assets/css/app.css",
  "./assets/js/config.js",
  "./assets/js/app.js",
  "./assets/js/state.js",
  "./assets/js/storage/workspace-store.js",
  "./assets/js/storage/settings-store.js",
  "./assets/js/storage/credentials.js",
  "./assets/js/editor.js",
  "./assets/js/ui.js",
  "./assets/js/ui/ai-ui.js",
  "./assets/js/ui/settings-ui.js",
  "./assets/js/ai/controller.js",
  "./assets/js/ai/ai-service.js",
  "./assets/js/ai/prompts.js",
  "./assets/js/ai/source-package.js",
  "./assets/js/ai/model-registry.js",
  "./assets/js/ai/stream.js",
  "./assets/js/ai/providers/webllm.js",
  "./assets/js/ai/providers/gemini.js",
  "./assets/js/ai/providers/openai-compatible.js",
  "./assets/js/services/markdown.js",
  "./assets/js/services/clipboard.js",
  "./assets/js/services/export.js"
];
