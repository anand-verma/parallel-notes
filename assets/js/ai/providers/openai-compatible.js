/** OpenAI-compatible API integration for models like GPT-5. */
import { consumeSSE } from "../stream.js";

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").trim().replace(/\/$/, "");
}

export async function generateOpenAICompatible(model, messages, apiKey, { onToken, signal } = {}) {
  if (!apiKey) throw new Error(`API key is missing for ${model.label || model.id}.`);
  const baseUrl = normalizeBaseUrl(model.baseUrl);
  if (!baseUrl) throw new Error("API base URL is missing for this model.");

  let res;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ model: model.model || model.id, messages, temperature: 0.15, stream: true })
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error(`Network error: Could not connect to ${baseUrl}. Please check your internet connection.`);
  }
  if (!res.ok) throw await apiError(res, "OpenAI-compatible API");
  return consumeSSE(res, data => data.choices?.[0]?.delta?.content || "", { onToken, signal });
}

async function apiError(res, label) {
  const body = await res.text().catch(() => "");
  let message = body;
  try { message = JSON.parse(body)?.error?.message || JSON.parse(body)?.message || body; } catch {}
  return new Error(`${label} Error ${res.status}: ${message || res.statusText}`);
}
