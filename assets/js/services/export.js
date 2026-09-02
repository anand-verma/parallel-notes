export function exportHtmlDocument({ title, content, suffix = "Notes" }) {
  if (!content || content === "<p></p>") throw new Error("Nothing to export.");
  const safeTitle = String(title || "Untitled Notes").replace(/[<>]/g, "");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${safeTitle} - ${suffix}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.6;max-width:800px;margin:0 auto;padding:40px;color:#333}h1,h2,h3{color:#111}table{border-collapse:collapse;width:100%;margin:1.5em 0}th,td{border:1px solid #ddd;padding:12px;text-align:left}th{background:#f9f9f9}blockquote{border-left:4px solid #ddd;padding-left:1em;color:#666}</style></head><body><h1>${safeTitle} - ${suffix}</h1>${content}</body></html>`;
  const blob = new Blob([html], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeTitle.replace(/[^a-z0-9]/gi, "_").toLowerCase() || "export"}_${suffix.toLowerCase()}.doc`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
