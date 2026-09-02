export async function copyRichText(editor) {
  const html = editor?.getHTML?.() || "";
  const text = editor?.getText?.() || "";
  if (!text.trim()) throw new Error("Nothing to copy.");
  try {
    if (navigator.clipboard?.write && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({
        "text/plain": new Blob([text], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" })
      })]);
      return "rich";
    }
  } catch {}
  await navigator.clipboard.writeText(text);
  return "plain";
}
