/** Google Gemini API integration and streaming logic. */
function thinkingLevelFor(modelId, settings = {}) {
  const id = String(modelId || "").toLowerCase();
  const requested = String(settings.geminiThinkingLevel || "minimal").toLowerCase();

  // Gemini 3.x supports named thinking levels; use the user preference when
  // compatible, otherwise fall back to minimal for latency-focused revision.
  if (/gemini-3\.[0-9]+.*(flash|pro)/.test(id)) {
    if (["minimal", "low", "medium", "high"].includes(requested)) return requested;
    return "minimal";
  }

  return null;
}

function numeric(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function buildGenerationConfig(model, settings = {}) {
  const id = String(model.id || "").toLowerCase();
  const generationConfig = {};
  const maxOutputTokens = Math.round(numeric(settings.maxOutputTokens, 2048, 128, 32768));
  generationConfig.maxOutputTokens = maxOutputTokens;

  // Current Gemini 3 guidance recommends leaving temperature at the model
  // default rather than forcing low temperatures. Older Gemini families can
  // still use the user's temperature/topP controls.
  if (!/^gemini-3(?:\.|-|$)/.test(id)) {
    generationConfig.temperature = numeric(settings.temperature, 0.15, 0, 2);
    generationConfig.topP = numeric(settings.topP, 0.9, 0.1, 1);
  }

  const thinkingLevel = thinkingLevelFor(model.id, settings);
  if (thinkingLevel) generationConfig.thinkingConfig = { thinkingLevel };
  return generationConfig;
}

export async function generateGemini(model, messages, apiKey, { onToken, signal, settings = {} } = {}) {
  if (!apiKey) throw new Error("Gemini API key is missing. Please configure it in settings.");

  const system = messages.find(m => m.role === "system")?.content;
  const userMessages = messages
    .filter(m => m.role !== "system")
    .map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    }));

  const payload = {
    contents: userMessages,
    generationConfig: buildGenerationConfig(model, settings),
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {})
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.id)}:streamGenerateContent?alt=sse`;
  const request = body => fetch(url, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify(body)
  });

  let res;
  try {
    res = await request(payload);
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error("Network error: Could not connect to Gemini API. Please check your internet connection.");
  }

  // Graceful compatibility fallback when a configured model does not accept
  // one of the optional generation fields.
  if (!res.ok) {
    const body = await res.clone().text().catch(() => "");
    if (/thinking|generationconfig|maxoutputtokens|temperature|topp|invalid argument|unsupported/i.test(body)) {
      const fallback = JSON.parse(JSON.stringify(payload));
      delete fallback.generationConfig.thinkingConfig;
      if (/gemini-3(?:\.|-|$)/i.test(model.id)) {
        delete fallback.generationConfig.temperature;
        delete fallback.generationConfig.topP;
      }
      try {
        res = await request(fallback);
      } catch (error) {
        if (error.name === "AbortError") throw error;
        throw new Error("Network error: Could not connect to Gemini API. Please check your internet connection.");
      }
    }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let message = body;
    try { message = JSON.parse(body)?.error?.message || body; } catch {}
    throw new Error(`Gemini Error ${res.status}: ${message || res.statusText}`);
  }

  return consumeGeminiSSE(res, { onToken, signal });
}

async function consumeGeminiSSE(response, { onToken, signal } = {}) {
  if (!response.body) throw new Error("Gemini returned an empty response stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    if (signal?.aborted) throw new DOMException("Generation cancelled.", "AbortError");
    let done, value;
    try {
      ({ done, value } = await reader.read());
    } catch (err) {
      if (err.name === "AbortError") throw err;
      throw new Error("Network error during stream: Connection lost.");
    }

    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    let idx;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;

      let parsed;
      try { parsed = JSON.parse(data); } catch { continue; }
      const delta = parsed.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("") || "";
      if (delta) {
        full += delta;
        onToken?.(delta, full);
      }
    }
    if (done) break;
  }

  buffer += decoder.decode();
  return full.trim();
}
