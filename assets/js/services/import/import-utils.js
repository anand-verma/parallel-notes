export function stripExtension(name = "") {
  return name.replace(/\.[^.]+$/, "").trim() || "Imported Document";
}

export function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function normalizeWhitespace(value = "") {
  return String(value).replace(/[ \t]+/g, " ").trim();
}
