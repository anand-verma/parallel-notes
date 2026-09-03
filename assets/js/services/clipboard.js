export async function copyRichText(editor) {
  const html = editor?.getHTML?.() || "";
  const text = editor?.getText?.({ blockSeparator: "\n\n" }) || "";
  if (!text.trim()) throw new Error("Nothing to copy.");
  
  // Inject basic CSS and MS Office namespaces to ensure formatting (tables, blockquotes, math) 
  // is preserved when pasting into Word or OneNote.
  const styledHtml = `
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<style>
  body { font-family: Calibri, sans-serif; font-size: 11pt; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; }
  th, td { border: 1px solid #d3dae4; padding: 6px 10px; text-align: left; vertical-align: top; }
  th { background-color: #f8fafc; font-weight: bold; }
  blockquote { border-left: 3px solid #5b5bd6; padding-left: 10px; color: #718096; margin: 10px 0; }
  .math-inline, .math-block { font-family: "Cambria Math", serif; }
  ul[data-type="taskList"] { list-style: none; padding-left: 0; }
</style>
</head>
<body>
  ${html}
</body>
</html>
  `.trim();

  try {
    if (navigator.clipboard?.write && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({
        "text/plain": new Blob([text], { type: "text/plain" }),
        "text/html": new Blob([styledHtml], { type: "text/html" })
      })]);
      return "rich";
    }
  } catch {}
  await navigator.clipboard.writeText(text);
  return "plain";
}
