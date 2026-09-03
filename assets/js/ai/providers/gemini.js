/** Google Gemini API integration and streaming logic. */
function thinkingLevelFor(modelId) {
  const id = String(modelId || '').toLowerCase();
  // Gemini 3.6/3.5 Flash supports minimal; Gemini 3.1 Pro does not.
  if (/gemini-3\.(6|5)-flash/.test(id)) return 'minimal';
  if (/gemini-3\.1-pro/.test(id)) return 'low';
  if (/gemini-3.*flash/.test(id)) return 'minimal';
  return null;
}

export async function generateGemini(model, messages, apiKey, { onToken, signal } = {}) {
  if (!apiKey) throw new Error('Gemini API key is missing. Please configure it in settings.');

  const system = messages.find(m => m.role === 'system')?.content;
  const userMessages = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

  const generationConfig = {};
  const thinkingLevel = thinkingLevelFor(model.id);
  if (thinkingLevel) {
    generationConfig.thinkingConfig = { thinkingLevel };
  }

  // Gemini 3.x documentation currently recommends avoiding explicit sampling
  // parameters such as temperature for these models.
  const payload = {
    contents: userMessages,
    ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {})
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.id)}:streamGenerateContent?alt=sse`;
  const request = () => fetch(url, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify(payload)
  });

  let res = await request();

  // Some model/API combinations may reject thinking configuration. Retry once
  // without it so generation still works on compatible models.
  if (!res.ok && payload.generationConfig?.thinkingConfig) {
    const body = await res.clone().text().catch(() => '');
    if (/thinking|generation.?config|invalid argument|unsupported/i.test(body)) {
      delete payload.generationConfig;
      res = await request();
    }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let message = body;
    try { message = JSON.parse(body)?.error?.message || body; } catch {}
    throw new Error(`Gemini Error ${res.status}: ${message || res.statusText}`);
  }

  return consumeGeminiSSE(res, { onToken, signal });
}

async function consumeGeminiSSE(response, { onToken, signal } = {}) {
  if (!response.body) throw new Error('Gemini returned an empty response stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  while (true) {
    if (signal?.aborted) throw new DOMException('Generation cancelled.', 'AbortError');
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;

      let parsed;
      try { parsed = JSON.parse(data); } catch { continue; }
      const delta = parsed.candidates?.[0]?.content?.parts
        ?.map(part => part.text || '')
        .join('') || '';
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
