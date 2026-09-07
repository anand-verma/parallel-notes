/** High-level AI service wrapper for routing requests to specific providers. */
import { buildPrompt, modeLabel, systemPolicy } from "./prompts.js";
import { generateGemini } from "./providers/gemini.js";
import { generateOpenAICompatible } from "./providers/openai-compatible.js";
import { generateWebLLM, loadModel, currentModel, isWebGPUSupported, interruptGeneration } from "./providers/webllm.js";
import { getCredential } from "../storage/credentials.js";
import { splitSourceForGeneration, estimateTokens } from "./source-chunker.js";

export class AIService {
  constructor({ settings }) { this.settings = settings || {}; }
  updateSettings(settings) { this.settings = settings || {}; }
  cancelLocalGeneration() { return interruptGeneration(); }

  getGenerationSettings() {
    return this.settings?.aiGeneration || {};
  }

  async ensureLocalModel(model, { onProgress } = {}) {
    if (!model || model.type !== "local") return true;
    if (!isWebGPUSupported()) throw new Error("This browser does not expose WebGPU for local models.");
    await loadModel(model.id, onProgress, this.getGenerationSettings());
    return true;
  }

  async generateRaw({ model, messages, onToken, onProgress, signal }) {
    if (!model) throw new Error("Choose an AI model first.");
    if (model.type === "local") {
      if (!isWebGPUSupported()) throw new Error("WebGPU is unavailable in this browser.");
      if (!currentModel() || currentModel() !== model.id) await this.ensureLocalModel(model, { onProgress });
      return generateWebLLM(model.id, messages, { onToken, onProgress, signal, settings: this.getGenerationSettings() });
    }

    const key = getCredential(model.provider, this.settings, model);
    if (model.protocol === "gemini") {
      return generateGemini(model, messages, key, { onToken, signal, settings: this.getGenerationSettings() });
    }
    if (model.protocol === "openai-compatible") {
      return generateOpenAICompatible(model, messages, key, { onToken, signal, settings: this.getGenerationSettings() });
    }
    throw new Error(`Unsupported AI protocol: ${model.protocol || "unknown"}`);
  }

  async generate({ model, mode, custom, sourcePackage, onToken, onProgress, signal }) {
    if (!model) throw new Error("Choose an AI model first.");
    if (!sourcePackage?.primary?.trim()) throw new Error("There is no source content to summarize.");

    const settings = this.settings || {};
    const chunks = splitSourceForGeneration(sourcePackage, settings, mode);
    const total = chunks.length;

    let combined = "";
    for (let i = 0; i < total; i++) {
      if (signal?.aborted) throw new DOMException("Generation cancelled.", "AbortError");

      const chunk = chunks[i];
      const prompt = buildPrompt({
        mode,
        custom,
        sourcePackage: chunk,
        settings,
        chunkMeta: total > 1 ? { index: i + 1, total } : null
      });

      const messages = [
        { role: "system", content: systemPolicy() },
        { role: "user", content: prompt }
      ];

      const prefix = combined ? `${combined}\n\n` : "";
      let chunkResult = "";
      const result = await this._generateOne({
        model,
        messages,
        onProgress: (p, text) => {
          const local = Number.isFinite(Number(p)) ? Number(p) : 0;
          const overall = ((i + local / 100) / total) * 100;
          onProgress?.(overall, total > 1 ? `Summarizing source part ${i + 1} of ${total}…` : text);
        },
        onToken: (delta) => {
          chunkResult += delta || "";
          onToken?.(delta || "", prefix + chunkResult);
        },
        signal
      });

      if (!result?.trim()) throw new Error(`AI returned no content for source part ${i + 1}.`);
      combined += (combined ? "\n\n" : "") + result.trim();
      onToken?.("", combined);
    }

    onProgress?.(100, total > 1 ? `Completed ${total} source parts.` : "Generation complete.");
    return combined.trim();
  }

  async _generateOne({ model, messages, onToken, onProgress, signal }) {
    const settings = this.getGenerationSettings();
    if (model.type === "local") {
      if (!isWebGPUSupported()) throw new Error("WebGPU is unavailable in this browser.");
      if (!currentModel() || currentModel() !== model.id) await this.ensureLocalModel(model, { onProgress });
      return generateWebLLM(model.id, messages, { onToken, onProgress, signal, settings });
    }

    const key = getCredential(model.provider, this.settings, model);
    if (model.protocol === "gemini") {
      return generateGemini(model, messages, key, { onToken, signal, settings });
    }
    if (model.protocol === "openai-compatible") {
      return generateOpenAICompatible(model, messages, key, { onToken, signal, settings });
    }
    throw new Error(`Unsupported AI protocol: ${model.protocol || "unknown"}`);
  }

  static label(mode) { return modeLabel(mode); }
}
