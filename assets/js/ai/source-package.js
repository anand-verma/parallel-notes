export function createSourcePackage(editor) {
  if (!editor) throw new Error("Source editor is unavailable.");
  const { from, to, empty } = getSelection(editor);
  const fullText = editor.getText({ blockSeparator: "\n" }) || "";
  if (!fullText.trim()) return null;

  if (empty) {
    return {
      scope: "document",
      primary: fullText.trim(),
      contextBefore: "",
      contextAfter: "",
      selectionStart: 0,
      selectionEnd: fullText.length,
      label: "Full source"
    };
  }

  const primary = editor.state.doc.textBetween(from, to, "\n\n").trim();
  if (!primary) return { scope: "document", primary: fullText.trim(), contextBefore: "", contextAfter: "", label: "Full source" };

  const before = editor.state.doc.textBetween(Math.max(0, from - 500), from, "\n\n").trim();
  const after = editor.state.doc.textBetween(to, Math.min(editor.state.doc.content.size, to + 500), "\n\n").trim();
  return {
    scope: "selection",
    primary,
    contextBefore: before,
    contextAfter: after,
    selectionStart: from,
    selectionEnd: to,
    label: "Selected passage"
  };
}

function getSelection(editor) {
  const { from, to } = editor.state.selection;
  return { from, to, empty: from === to };
}
