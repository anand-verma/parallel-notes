/** Robust Markdown-to-HTML parser with AI-delimiters and KaTeX sanitization. */
let parserPromise;
async function loadParser() {
  if (!parserPromise) parserPromise = Promise.all([
    import("../../vendor/marked/marked.esm.js"),
    import("../../vendor/dompurify/purify.es.mjs"),
    import("../../vendor/marked-katex-extension/index.mjs")
  ]);
  return parserPromise;
}
export async function markdownToHtml(markdown) {
  const [{ marked }, { default: DOMPurify }, { default: markedKatex }] = await loadParser();
  marked.use(markedKatex({ throwOnError: false, nonStandard: true }));
  
  let processed = markdown.trim();

  // 1. Unwrap global markdown code blocks (e.g. if the LLM wrapped the entire response in ```markdown ... ```)
  const codeBlockRegex = /^\s*```(?:markdown|html)?\s*\n([\s\S]*?)```\s*$/i;
  if (codeBlockRegex.test(processed)) {
    processed = processed.replace(codeBlockRegex, '$1').trim();
  }

  // 2. Parse <think> tags (from reasoning models) into blockquotes so they aren't stripped by DOMPurify
  processed = processed.replace(/<think>([\s\S]*?)<\/think>/gi, (match, thoughts) => {
    const quoted = thoughts.trim().split('\n').map(line => `> ${line}`).join('\n');
    return `> **Thought Process:**\n${quoted}\n\n`;
  });

  // 3. Pre-process AI-style LaTeX delimiters. 
  // We match either a single backslash ( \[ ) or double backslashes ( \\[ ) common in JSON API payloads.
  processed = processed
    .replace(/\\{1,2}\[([\s\S]*?)\\{1,2}\]/g, '$$$$$1$$$$')
    .replace(/\\{1,2}\(([\s\S]*?)\\{1,2}\)/g, '$$$1$$');

  let html = marked.parse(processed, { gfm: true, breaks: false });
  
  // Bulletproof fallback: Inject data-latex attribute BEFORE DOMPurify sanitizes and potentially strips MathML
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  tempDiv.querySelectorAll('.katex').forEach(el => {
    const ann = el.querySelector('annotation');
    if (ann && ann.textContent) {
      const wrapper = el.parentElement && el.parentElement.classList.contains('katex-display') ? el.parentElement : el;
      wrapper.setAttribute('data-latex', ann.textContent);
    }
  });
  
  return DOMPurify.sanitize(tempDiv.innerHTML, { 
    USE_PROFILES: { html: true, mathMl: true },
    ADD_ATTR: ['encoding', 'data-latex', 'class']
  });
}
