/**
 * Packages editor content for AI while retaining useful structural signals.
 * The plain text PRIMARY SOURCE remains the factual payload. A compact
 * structure hint helps the model preserve headings/lists/tables without making
 * HTML itself a second factual source.
 */
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
      label: "Full source",
      structureHint: buildStructureHint(editor.getJSON?.())
    };
  }

  const primary = editor.state.doc.textBetween(from, to, "\n\n").trim();
  if (!primary) {
    return {
      scope: "document",
      primary: fullText.trim(),
      contextBefore: "",
      contextAfter: "",
      label: "Full source",
      structureHint: buildStructureHint(editor.getJSON?.())
    };
  }

  const before = editor.state.doc.textBetween(Math.max(0, from - 700), from, "\n\n").trim();
  const after = editor.state.doc.textBetween(to, Math.min(editor.state.doc.content.size, to + 700), "\n\n").trim();

  return {
    scope: "selection",
    primary,
    contextBefore: before,
    contextAfter: after,
    selectionStart: from,
    selectionEnd: to,
    label: "Selected passage",
    structureHint: "Selection mode: preserve the local structure already visible in the selected text."
  };
}

function getSelection(editor) {
  const { from, to } = editor.state.selection;
  return { from, to, empty: from === to };
}

function buildStructureHint(json) {
  if (!json?.content?.length) return "";
  const lines = [];
  walkNodes(json, lines, 0);
  return lines.slice(0, 120).join("\n");
}

function walkNodes(node, lines, depth) {
  if (!node) return;
  const pad = "  ".repeat(Math.min(depth, 6));
  switch (node.type) {
    case "heading":
      lines.push(`${pad}[HEADING level=${node.attrs?.level || 1}]`);
      break;
    case "bulletList":
      lines.push(`${pad}[BULLET LIST]`);
      break;
    case "orderedList":
      lines.push(`${pad}[ORDERED LIST]`);
      break;
    case "table":
      lines.push(`${pad}[TABLE]`);
      break;
    case "tableRow":
      lines.push(`${pad}[TABLE ROW]`);
      break;
    default:
      break;
  }
  if (Array.isArray(node.content)) node.content.forEach(child => walkNodes(child, lines, depth + 1));
}
