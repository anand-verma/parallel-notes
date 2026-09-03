const PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
const PDFJS_WORKER_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
let pdfjsPromise;

async function getPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(PDFJS_URL).then(pdfjs => {
      pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

function median(values) {
  if (!values.length) return 0;
  const a = [...values].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function normalizeLineText(text) {
  return text.replace(/\s+/g, " ").trim();
}

function escapeHtml(text) {
  return String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fontFlags(item, styles) {
  const style = styles?.[item.fontName] || {};
  const family = `${style.fontFamily || ""} ${item.fontName || ""}`.toLowerCase();
  return {
    bold: /bold|black|heavy|semibold|demi/.test(family),
    italic: /italic|oblique/.test(family)
  };
}

function itemHtml(item, styles) {
  let text = item.str || "";
  if (!text) return "";
  const flags = fontFlags(item, styles);
  text = escapeHtml(text);
  if (flags.bold) text = `<strong>${text}</strong>`;
  if (flags.italic) text = `<em>${text}</em>`;
  return text;
}

function needsSpace(previous, current, gap, fontSize) {
  if (!previous) return false;
  if (/^[,.;:!?%)\]}]/.test(current)) return false;
  if (/[([\{\/-]$/.test(previous)) return false;
  if (/\s$/.test(previous) || /^\s/.test(current)) return false;
  return gap > Math.max(1.5, fontSize * 0.12);
}

function joinItems(items) {
  let text = "";
  let html = "";
  let previous = null;
  for (const item of items) {
    const current = item.str || "";
    if (!current) continue;
    const gap = previous ? item.x - previous.xEnd : 0;
    const space = previous && needsSpace(previous.str, current, gap, Math.max(previous.fontSize, item.fontSize));
    if (space) { text += " "; html += " "; }
    text += current;
    html += item.html;
    previous = { ...item, str: current, xEnd: item.x + (item.width || 0) };
  }
  return { text: normalizeLineText(text), html };
}

function groupItemsIntoLines(items, styles) {
  const usable = items.filter(item => item.str && item.str.trim());
  const lineGroups = [];
  for (const item of usable) {
    const transform = item.transform || [1, 0, 0, 1, 0, 0];
    const x = transform[4] || 0;
    const y = transform[5] || 0;
    const fontSize = Math.max(1, Math.hypot(transform[0] || 1, transform[1] || 0));
    const tolerance = Math.max(2.2, fontSize * 0.32);
    let group = lineGroups.find(g => Math.abs(g.y - y) <= tolerance);
    if (!group) {
      group = { y, items: [] };
      lineGroups.push(group);
    }
    group.items.push({ ...item, x, y, fontSize, html: itemHtml(item, styles) });
  }
  return lineGroups
    .sort((a, b) => b.y - a.y)
    .map(group => {
      group.items.sort((a, b) => a.x - b.x);
      const joined = joinItems(group.items);
      const x = group.items[0]?.x || 0;
      const xEnd = group.items.reduce((max, i) => Math.max(max, i.x + (i.width || 0)), x);
      const fontSize = median(group.items.map(i => i.fontSize));
      const boldRatio = group.items.length ? group.items.filter(i => fontFlags(i, styles).bold).length / group.items.length : 0;
      const italicRatio = group.items.length ? group.items.filter(i => fontFlags(i, styles).italic).length / group.items.length : 0;
      return { text: joined.text, html: joined.html, x, xEnd, y: group.y, fontSize, boldRatio, italicRatio, items: group.items };
    })
    .filter(line => line.text);
}

function addIndentation(lines) {
  if (!lines.length) return lines;
  const left = Math.min(...lines.map(l => l.x));
  const step = Math.max(14, median(lines.map(l => l.fontSize)) * 1.6);
  return lines.map(line => {
    const raw = Math.max(0, line.x - left);
    // Preserve meaningful PDF indentation while avoiding tiny coordinate noise.
    const indent = raw < step * 0.45 ? 0 : Math.min(200, Math.round(raw / step) * 20);
    return { ...line, indent, indentLevel: Math.round(indent / 20) };
  });
}

function removeRepeatedHeadersFooters(pages) {
  const counts = new Map();
  for (const page of pages) {
    const seen = new Set(page.lines.slice(0, 3).concat(page.lines.slice(-3)).map(l => l.text.toLowerCase()));
    seen.forEach(text => counts.set(text, (counts.get(text) || 0) + 1));
  }
  const threshold = Math.max(2, Math.ceil(pages.length * 0.6));
  const repeated = new Set([...counts.entries()].filter(([, count]) => count >= threshold).map(([text]) => text));
  if (!repeated.size || pages.length < 3) return pages;
  return pages.map(page => ({ ...page, lines: page.lines.filter(line => !repeated.has(line.text.toLowerCase())) }));
}

function detectColumns(lines, pageWidth) {
  if (lines.length < 10 || !pageWidth) return null;
  const starts = lines.map(l => l.x).filter(x => x > pageWidth * 0.03 && x < pageWidth * 0.85);
  if (starts.length < 10) return null;
  const sorted = [...starts].sort((a, b) => a - b);
  let best = null;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap > pageWidth * 0.08 && (!best || gap > best.gap)) best = { gap, split: (sorted[i] + sorted[i - 1]) / 2 };
  }
  if (!best || best.split < pageWidth * 0.2 || best.split > pageWidth * 0.8) return null;
  const left = lines.filter(l => l.x < best.split);
  const right = lines.filter(l => l.x >= best.split);
  if (left.length < lines.length * 0.2 || right.length < lines.length * 0.2) return null;
  return { split: best.split, left, right };
}

export async function extractPdf(file, { onProgress, signal } = {}) {
  if (signal?.aborted) throw new DOMException("Import cancelled", "AbortError");
  const pdfjs = await getPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  if (signal?.aborted) throw new DOMException("Import cancelled", "AbortError");
  const loadingTask = pdfjs.getDocument({ data });
  const pdf = await loadingTask.promise;
  const pages = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      if (signal?.aborted) throw new DOMException("Import cancelled", "AbortError");
      const page = await pdf.getPage(pageNumber);
      try {
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: true });
        let lines = groupItemsIntoLines(content.items, content.styles);
        const columns = detectColumns(lines, viewport.width);
        const orderedLines = columns
          ? [...columns.left.sort((a, b) => b.y - a.y), ...columns.right.sort((a, b) => b.y - a.y)]
          : lines;
        lines = addIndentation(orderedLines);
        pages.push({ pageNumber, width: viewport.width, height: viewport.height, lines, columns: !!columns });
        onProgress?.({ page: pageNumber, pages: pdf.numPages, phase: "extract" });
      } finally {
        page.cleanup?.();
      }
    }
    return { pages: removeRepeatedHeadersFooters(pages), pageCount: pdf.numPages };
  } finally {
    await pdf.destroy();
  }
}
