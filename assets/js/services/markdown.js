let parserPromise;
async function loadParser() {
  if (!parserPromise) parserPromise = Promise.all([
    import("https://esm.sh/marked@16.1.1"),
    import("https://esm.sh/dompurify@3.2.6")
  ]);
  return parserPromise;
}
export async function markdownToHtml(markdown) {
  const [{ marked }, { default: DOMPurify }] = await loadParser();
  return DOMPurify.sanitize(marked.parse(markdown, { gfm: true, breaks: false }));
}
