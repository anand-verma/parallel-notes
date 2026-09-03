import { escapeHtml } from "../import-utils.js";

const BULLET_RE = /^(?:[•●▪◦‣⁃–—-])\s+/;
const NUMBER_RE = /^(\d+|[A-Za-z])[.)]\s+/;

function classify(line, medianFont) {
  const text = line.text.trim();
  const bullet = BULLET_RE.test(text);
  const numbered = NUMBER_RE.test(text);
  const clean = text.replace(BULLET_RE, "").replace(NUMBER_RE, "").trim();
  const heading = !bullet && !numbered && clean.length <= 140 && (
    line.fontSize >= medianFont * 1.28 ||
    (line.boldRatio >= 0.72 && clean.length <= 90)
  );
  return { bullet, numbered, heading, clean };
}

function lineHtml(line, classification) {
  let html = line.html;
  if (classification.bullet) html = html.replace(/^[•●▪◦‣⁃–—-]\s*/, "");
  if (classification.numbered) html = html.replace(/^(?:\d+|[A-Za-z])[.)]\s*/, "");
  return html || escapeHtml(classification.clean);
}

function blockStyle(line) {
  return line?.indent ? ` style="margin-left:${Math.min(200, Math.max(0, line.indent))}px"` : "";
}

function average(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function clusterPositions(values, tolerance = 12) {
  const sorted = [...values].sort((a, b) => a - b);
  const clusters = [];
  for (const value of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && value - last.mean <= tolerance) {
      last.values.push(value);
      last.mean = average(last.values);
    } else clusters.push({ values: [value], mean: value });
  }
  return clusters;
}

function tableCandidate(lines) {
  if (lines.length < 2) return null;
  const usable = lines.filter(l => l.items.length >= 2);
  if (usable.length < 2 || usable.length < lines.length * 0.6) return null;

  // Tables usually expose repeated cell starts across rows. Paragraphs generally do not.
  const clusters = clusterPositions(usable.flatMap(l => l.items.map(i => i.x)), 10);
  const anchors = clusters.filter(c => c.values.length >= 2).map(c => c.mean);
  if (anchors.length < 2 || anchors.length > 10) return null;

  const rowMaps = usable.map(line => {
    const cells = [];
    for (const item of line.items) {
      const nearest = anchors.reduce((best, x, idx) => {
        const d = Math.abs(item.x - x);
        return d < best.d ? { d, idx } : best;
      }, { d: Infinity, idx: -1 });
      if (nearest.d <= 16) cells.push({ idx: nearest.idx, item });
    }
    const present = new Set(cells.map(c => c.idx));
    return { line, cells, count: present.size };
  });

  const consistentRows = rowMaps.filter(r => r.count >= 2).length;
  if (consistentRows < Math.max(2, Math.ceil(lines.length * 0.7))) return null;
  const activeAnchors = anchors.map((x, idx) => rowMaps.filter(r => r.cells.some(c => c.idx === idx)).length >= Math.max(2, Math.ceil(lines.length * 0.5)));
  const cols = activeAnchors.filter(Boolean).length;
  if (cols < 2) return null;
  return { anchors: anchors.filter((_, i) => activeAnchors[i]), rowMaps };
}

function cellHtml(items) {
  if (!items?.length) return "";
  const sorted = [...items].sort((a, b) => a.x - b.x);
  let html = "";
  let prev = null;
  for (const item of sorted) {
    if (prev && item.x - (prev.x + (prev.width || 0)) > Math.max(2, item.fontSize * 0.12)) html += " ";
    html += item.html || escapeHtml(item.str || "");
    prev = item;
  }
  return html.trim();
}

function tableHtml(lines, candidate) {
  if (!candidate) return null;
  const cols = candidate.anchors.length;
  const body = candidate.rowMaps.map((row, rowIndex) => {
    const cells = Array.from({ length: cols }, () => []);
    for (const cell of row.cells) {
      const idx = candidate.anchors.reduce((best, x, i) => Math.abs(x - row.line.items.find(it => it === cell.item)?.x) < Math.abs(candidate.anchors[best] - row.line.items.find(it => it === cell.item)?.x) ? i : best, 0);
      if (idx >= 0 && idx < cols) cells[idx].push(cell.item);
    }
    const tag = rowIndex === 0 ? "th" : "td";
    return `<tr>${cells.map(items => `<${tag}>${cellHtml(items)}</${tag}>`).join("")}</tr>`;
  }).join("");
  return `<table><tbody>${body}</tbody></table>`;
}

function detectTableSpan(lines, start) {
  const max = Math.min(lines.length, start + 18);
  let best = null;
  for (let end = start + 2; end <= max; end++) {
    const candidate = tableCandidate(lines.slice(start, end));
    if (candidate) best = { end, candidate };
  }
  return best;
}

function listHtml(lines, ordered) {
  const tag = ordered ? "ol" : "ul";
  const items = lines.map((line, index) => {
    const c = classify(line, line.fontSize || 12);
    const style = blockStyle(line);
    return `<li${style}>${lineHtml(line, c)}</li>`;
  }).join("");
  return `<${tag}>${items}</${tag}>`;
}

export function buildHtml(extraction) {
  const blocks = [];
  for (const page of extraction.pages) {
    const lines = page.lines;
    if (!lines.length) continue;
    const medianFont = lines.map(l => l.fontSize).sort((a, b) => a - b)[Math.floor(lines.length / 2)] || 12;
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const c = classify(line, medianFont);

      const tableSpan = !c.heading && !c.bullet && !c.numbered ? detectTableSpan(lines, i) : null;
      if (tableSpan && tableSpan.end - i >= 2) {
        const table = tableHtml(lines.slice(i, tableSpan.end), tableSpan.candidate);
        if (table) { blocks.push(table); i = tableSpan.end; continue; }
      }

      if (c.bullet || c.numbered) {
        const ordered = c.numbered;
        const items = [];
        while (i < lines.length) {
          const next = classify(lines[i], medianFont);
          if ((ordered && !next.numbered) || (!ordered && !next.bullet)) break;
          items.push(lines[i]);
          i++;
        }
        blocks.push(listHtml(items, ordered));
        continue;
      }

      if (c.heading) {
        const level = line.fontSize >= medianFont * 1.65 ? 1 : line.fontSize >= medianFont * 1.38 ? 2 : 3;
        blocks.push(`<h${level}${blockStyle(line)}>${lineHtml(line, c)}</h${level}>`);
        i++;
        continue;
      }

      const paragraph = [line];
      i++;
      while (i < lines.length) {
        const next = classify(lines[i], medianFont);
        if (next.heading || next.bullet || next.numbered || detectTableSpan(lines, i)) break;
        paragraph.push(lines[i]);
        i++;
      }
      const indent = paragraph.reduce((max, l) => Math.max(max, l.indent || 0), 0);
      blocks.push(`<p${indent ? ` style="margin-left:${Math.min(200, indent)}px"` : ""}>${paragraph.map(l => lineHtml(l, classify(l, medianFont))).join(" ")}</p>`);
    }
    if (page.pageNumber < extraction.pageCount) blocks.push("<hr>");
  }
  return blocks.join("\n");
}

export function buildHtmlWithAI(extraction) {
  // AI chooses structural block boundaries; cell reconstruction remains deterministic so formatting stays faithful.
  const allLines = extraction.pages.flatMap(page => page.lines);
  const blocks = extraction.aiStructure || [];
  if (!blocks.length) return buildHtml(extraction);
  const out = [];
  for (const block of blocks) {
    const lines = allLines.slice(block.start - 1, block.end);
    if (!lines.length) continue;
    const content = lines.map(l => l.html).join(" ");
    const indent = Math.max(...lines.map(l => l.indent || 0));
    const style = indent ? ` style="margin-left:${Math.min(200, indent)}px"` : "";
    if (block.type === "heading") {
      const level = Math.min(3, Math.max(1, block.level || 2));
      out.push(`<h${level}${style}>${content}</h${level}>`);
    } else if (block.type === "bullet") {
      out.push(`<ul>${lines.map(l => `<li${l.indent ? ` style="margin-left:${Math.min(200, l.indent)}px"` : ""}>${l.html.replace(/^[•●▪◦‣⁃–—-]\s*/, "")}</li>`).join("")}</ul>`);
    } else if (block.type === "numbered") {
      out.push(`<ol>${lines.map(l => `<li${l.indent ? ` style="margin-left:${Math.min(200, l.indent)}px"` : ""}>${l.html.replace(/^(?:\d+|[A-Za-z])[.)]\s*/, "")}</li>`).join("")}</ol>`);
    } else if (block.type === "table") {
      const candidate = tableCandidate(lines);
      const table = tableHtml(lines, candidate);
      out.push(table || `<p${style}>${content}</p>`);
    } else {
      out.push(`<p${style}>${content}</p>`);
    }
  }
  return out.join("\n");
}
