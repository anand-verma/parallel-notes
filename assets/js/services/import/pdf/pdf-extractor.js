const PDFJS_URL = "../../../../vendor/pdfjs/pdf.min.mjs";
const PDFJS_WORKER_URL = "../../../../vendor/pdfjs/pdf.worker.min.mjs";

let pdfjsPromise = null;

const getPdfJs = () => {
  if (!pdfjsPromise) {
    pdfjsPromise = import(PDFJS_URL).then(pdfjs => {
      pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return pdfjs;
    });
  }
  return pdfjsPromise;
};

const checkAbort = (signal) => {
  if (signal?.aborted) throw new DOMException("Import cancelled", "AbortError");
};

const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1; // Bitwise shift for fast Math.floor(length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const escapeHtml = (text) => 
  String(text || "").replace(/[&<>]/g, m => m === "&" ? "&amp;" : m === "<" ? "&lt;" : "&gt;");

const RE_PUNC_START = /^[.,;:!?%)\]}]/;
const RE_PUNC_END = /[([{\/-]$/;
const RE_SPACE_START = /^\s/;
const RE_SPACE_END = /\s$/;
const RE_MULTI_SPACE = /\s+/g;

const needsSpace = (prevStr, currStr, gap, fontSize) => {
  if (!prevStr || RE_PUNC_START.test(currStr) || RE_PUNC_END.test(prevStr)) return false;
  if (RE_SPACE_END.test(prevStr) || RE_SPACE_START.test(currStr)) return false;
  return gap > Math.max(1.5, fontSize * 0.12);
};

function groupItemsIntoLines(items, styles) {
  const fontCache = new Map();
  
  const getFontFlags = (fontName) => {
    if (fontCache.has(fontName)) return fontCache.get(fontName);
    const style = styles?.[fontName] || {};
    const family = `${style.fontFamily || ""} ${fontName || ""}`.toLowerCase();
    const flags = {
      bold: /bold|black|heavy|semibold|demi/.test(family),
      italic: /italic|oblique/.test(family)
    };
    fontCache.set(fontName, flags);
    return flags;
  };

  const processedItems = [];
  for (const item of items) {
    if (!item.str?.trim()) continue;
    
    const [scaleX, skewY, , , x, y] = item.transform || [1, 0, 0, 1, 0, 0];
    const fontSize = Math.max(1, Math.hypot(scaleX, skewY));
    const flags = getFontFlags(item.fontName);
    
    let html = escapeHtml(item.str);
    if (flags.bold) html = `<strong>${html}</strong>`;
    if (flags.italic) html = `<em>${html}</em>`;

    processedItems.push({ ...item, x, y, fontSize, html, flags, str: item.str });
  }

  // PDF.js origin is bottom-left, sorting Y descending puts top lines first
  processedItems.sort((a, b) => b.y - a.y);

  const lines = [];
  for (const item of processedItems) {
    const tolerance = Math.max(2.2, item.fontSize * 0.32);
    const currentGroup = lines[lines.length - 1];

    if (currentGroup && Math.abs(currentGroup.y - item.y) <= tolerance) {
      currentGroup.items.push(item);
    } else {
      lines.push({ y: item.y, items: [item] });
    }
  }

  return lines.map(group => {
    group.items.sort((a, b) => a.x - b.x);
    
    let text = "", html = "", prev = null;
    let boldCount = 0, italicCount = 0;
    let xEnd = group.items[0]?.x || 0;

    for (const item of group.items) {
      const gap = prev ? item.x - prev.xEnd : 0;
      const maxFontSize = prev ? Math.max(prev.fontSize, item.fontSize) : item.fontSize;

      if (needsSpace(prev?.str, item.str, gap, maxFontSize)) {
        text += " "; html += " ";
      }

      text += item.str;
      html += item.html;
      item.xEnd = item.x + (item.width || 0);
      xEnd = Math.max(xEnd, item.xEnd);
      prev = item;

      if (item.flags.bold) boldCount++;
      if (item.flags.italic) italicCount++;
    }

    return {
      text: text.replace(RE_MULTI_SPACE, " ").trim(),
      html,
      x: group.items[0]?.x || 0,
      xEnd,
      y: group.y,
      fontSize: median(group.items.map(i => i.fontSize)),
      boldRatio: boldCount / group.items.length,
      italicRatio: italicCount / group.items.length,
      items: group.items
    };
  }).filter(line => line.text);
}

function addIndentation(lines) {
  if (!lines.length) return lines;
  
  let minX = Infinity;
  const fontSizes = [];
  for (const line of lines) {
    if (line.x < minX) minX = line.x;
    fontSizes.push(line.fontSize);
  }

  const step = Math.max(14, median(fontSizes) * 1.6);

  return lines.map(line => {
    const rawOffset = Math.max(0, line.x - minX);
    const indent = rawOffset < step * 0.45 ? 0 : Math.min(200, Math.round(rawOffset / step) * 20);
    return { ...line, indent, indentLevel: indent / 20 };
  });
}

function removeRepeatedHeadersFooters(pages) {
  if (pages.length < 3) return pages;

  const counts = new Map();
  for (const page of pages) {
    const edgeLines = [...page.lines.slice(0, 3), ...page.lines.slice(-3)];
    const seen = new Set(edgeLines.map(l => l.text.toLowerCase()));
    for (const text of seen) {
      counts.set(text, (counts.get(text) || 0) + 1);
    }
  }

  const threshold = Math.max(2, Math.ceil(pages.length * 0.6));
  const repeated = new Set();
  
  for (const [text, count] of counts.entries()) {
    if (count >= threshold) repeated.add(text);
  }

  if (!repeated.size) return pages;

  return pages.map(page => ({
    ...page,
    lines: page.lines.filter(line => !repeated.has(line.text.toLowerCase()))
  }));
}

function detectColumns(lines, pageWidth) {
  if (lines.length < 10 || !pageWidth) return null;

  const starts = lines.map(l => l.x)
    .filter(x => x > pageWidth * 0.03 && x < pageWidth * 0.85)
    .sort((a, b) => a - b);

  if (starts.length < 10) return null;

  let bestGap = 0;
  let bestSplit = 0;

  for (let i = 1; i < starts.length; i++) {
    const gap = starts[i] - starts[i - 1];
    if (gap > pageWidth * 0.08 && gap > bestGap) {
      bestGap = gap;
      bestSplit = (starts[i] + starts[i - 1]) / 2;
    }
  }

  if (!bestSplit || bestSplit < pageWidth * 0.2 || bestSplit > pageWidth * 0.8) return null;

  const left = [], right = [];
  for (const line of lines) {
    if (line.x < bestSplit) left.push(line);
    else right.push(line);
  }

  const minSide = lines.length * 0.2;
  if (left.length < minSide || right.length < minSide) return null;

  return { split: bestSplit, left, right };
}

export async function extractPdf(file, { onProgress, signal } = {}) {
  checkAbort(signal);

  const pdfjs = await getPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  
  checkAbort(signal);
  
  const loadingTask = pdfjs.getDocument({ data });
  const pdf = await loadingTask.promise;
  const pages = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      checkAbort(signal);
      
      const page = await pdf.getPage(pageNumber);
      try {
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent({ 
          normalizeWhitespace: true, 
          disableCombineTextItems: true 
        });

        let lines = groupItemsIntoLines(content.items, content.styles);
        const columns = detectColumns(lines, viewport.width);

        if (columns) {
          lines = [
            ...columns.left.sort((a, b) => b.y - a.y), 
            ...columns.right.sort((a, b) => b.y - a.y)
          ];
        }

        pages.push({
          pageNumber,
          width: viewport.width,
          height: viewport.height,
          lines: addIndentation(lines),
          columns: !!columns
        });

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