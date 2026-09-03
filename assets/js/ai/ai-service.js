/** High-level AI service wrapper for routing requests to specific providers. */
import { buildPrompt, modeLabel, systemPolicy } from "./prompts.js";
import { generateGemini } from "./providers/gemini.js";
import { generateOpenAICompatible } from "./providers/openai-compatible.js";
import { generateWebLLM, loadModel, currentModel, isWebGPUSupported, interruptGeneration } from "./providers/webllm.js";
import { getCredential } from "../storage/credentials.js";

export class AIService {
  constructor({ settings }) { this.settings = settings; }
  updateSettings(settings) { this.settings = settings; }
  cancelLocalGeneration() { return interruptGeneration(); }

  async ensureLocalModel(model, { onProgress } = {}) {
    if (!model || model.type !== "local") return true;
    if (!isWebGPUSupported()) throw new Error("This browser does not expose WebGPU for local models.");
    await loadModel(model.id, onProgress);
    return true;
  }

  async generate({ model, mode, custom, sourcePackage, onToken, onProgress, signal }) {
    if (!model) throw new Error("Choose an AI model first.");
    const prompt = buildPrompt({ mode, custom, sourcePackage });
    const messages = [
      { role: "system", content: systemPolicy() },
      { role: "user", content: prompt }
    ];

    if (model.type === "local") {
      if (!isWebGPUSupported()) throw new Error("WebGPU is unavailable in this browser.");
      if (!currentModel() || currentModel() !== model.id) await this.ensureLocalModel(model, { onProgress });
      return generateWebLLM(model.id, messages, { onToken, onProgress, signal });
    }

    const key = getCredential(model.provider, this.settings, model);
    if (model.protocol === "gemini") return generateGemini(model, messages, key, { onToken, signal });
    if (model.protocol === "openai-compatible") return generateOpenAICompatible(model, messages, key, { onToken, signal });
    throw new Error(`Unsupported AI protocol: ${model.protocol || "unknown"}`);
  }

  static label(mode) { return modeLabel(mode); }
}
