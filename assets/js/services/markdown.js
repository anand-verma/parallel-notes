let parserPromise;
async function loadParser() {
  if (!parserPromise) parserPromise = Promise.all([
    import("https://esm.sh/marked@16.1.1"),
    import("https://esm.sh/dompurify@3.2.6"),
    import("https://esm.sh/marked-katex-extension@5.1.2")
  ]);
  return parserPromise;
}
export async function markdownToHtml(markdown) {
  const [{ marked }, { default: DOMPurify }, { default: markedKatex }] = await loadParser();
  marked.use(markedKatex({ throwOnError: false, nonStandard: true }));
  
  // Pre-process AI-style LaTeX delimiters ( \[ \] and \( \) ) into Marked-compatible delimiters ( $$ and $ )
  const processed = markdown
    .replace(/\\\[([\s\S]*?)\\\]/g, '$$$$$1$$$$')
    .replace(/\\\(([\s\S]*?)\\\)/g, '$$$1$$');

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
