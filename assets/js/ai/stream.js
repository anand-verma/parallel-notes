/** Async stream chunk processing and progressive markdown parsing. */
export async function consumeSSE(response, parseEvent, { onToken, signal } = {}) {
  if (!response.body) throw new Error("The API returned an empty response stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  const processLine = async (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return false;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") return payload === "[DONE]";
    let parsed;
    try { parsed = JSON.parse(payload); } catch { return false; }
    const delta = parseEvent(parsed) || "";
    if (delta) {
      full += delta;
      onToken?.(delta, full);
    }
    return false;
  };

  while (true) {
    if (signal?.aborted) throw new DOMException("Generation cancelled.", "AbortError");
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (await processLine(line)) {
        await reader.cancel();
        return full.trim();
      }
    }
    if (done) break;
  }

  const final = decoder.decode();
  buffer += final;
  if (buffer.trim()) await processLine(buffer);
  return full.trim();
}
