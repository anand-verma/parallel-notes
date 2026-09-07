/** OpenAI-compatible API integration with provider-safe generation settings. */
import { consumeSSE } from "../stream.js";

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").trim().replace(/\/$/, "");
}

function numeric(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function isReasoningFamily(modelId) {
  return /^(gpt-5(?:\.|-|$)|o[1-9](?:\.|-|$))/i.test(String(modelId || ""));
}

function buildPayload(model, messages, settings) {
  const modelId = model.model || model.id;
  const maxOutputTokens = Math.round(numeric(settings.maxOutputTokens, 2048, 128, 32768));
  const temperature = numeric(settings.temperature, 0.15, 0, 2);
  const topP = numeric(settings.topP, 0.9, 0.1, 1);
  const reasoning = String(settings.reasoningEffort || "minimal").toLowerCase();

  const payload = {
    model: modelId,
    messages,
    stream: true,
  };

  // Newer reasoning models generally use max_completion_tokens and may reject
  // legacy sampling knobs. Keep those knobs off unless the model is a normal
  // sampling model, then let the fallback handle provider-specific quirks.
  if (isReasoningFamily(modelId)) {
    payload.max_completion_tokens = maxOutputTokens;
    if (reasoning && ["none", "minimal", "low", "medium", "high"].includes(reasoning)) {
      payload.reasoning_effort = reasoning;
    }
  } else {
    payload.max_tokens = maxOutputTokens;
    payload.temperature = temperature;
    payload.top_p = topP;
  }

  return payload;
}

export async function generateOpenAICompatible(model, messages, apiKey, { onToken, signal, settings = {} } = {}) {
  if (!apiKey) throw new Error(`API key is missing for ${model.label || model.id}.`);
  const baseUrl = normalizeBaseUrl(model.baseUrl);
  if (!baseUrl) throw new Error("API base URL is missing for this model.");

  let payload = buildPayload(model, messages, settings);
  let res;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error(`Network error: Could not connect to ${baseUrl}. Please check your internet connection.`);
  }

  // Compatibility fallback for custom OpenAI-style servers that only accept
  // max_tokens or reject one of the sampling/reasoning parameters.
  if (!res.ok) {
    const body = await res.clone().text().catch(() => "");
    if (/max_completion_tokens|reasoning_effort|temperature|top_p|unsupported|unknown parameter/i.test(body)) {
      const fallback = { ...payload };
      delete fallback.reasoning_effort;
      if (fallback.max_completion_tokens != null) {
        fallback.max_tokens = fallback.max_completion_tokens;
        delete fallback.max_completion_tokens;
      }
      delete fallback.temperature;
      delete fallback.top_p;

      try {
        res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          signal,
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify(fallback)
        });
      } catch (error) {
        if (error.name === "AbortError") throw error;
        throw new Error(`Network error: Could not connect to ${baseUrl}. Please check your internet connection.`);
      }
    }
  }

  if (!res.ok) throw await apiError(res, "OpenAI-compatible API");
  return consumeSSE(res, data => data.choices?.[0]?.delta?.content || "", { onToken, signal });
}

async function apiError(res, label) {
  const body = await res.text().catch(() => "");
  let message = body;
  try {
    const parsed = JSON.parse(body);
    message = parsed?.error?.message || parsed?.message || body;
  } catch {}
  return new Error(`${label} Error ${res.status}: ${message || res.statusText}`);
}
