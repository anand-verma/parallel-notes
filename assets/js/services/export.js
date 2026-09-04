/**
 * Parallel Notes export service v0.9.4
 *
 * Design goals:
 * - The current Tiptap editor is the source of truth.
 * - PDF rendering is PAGE-BY-PAGE, never one giant canvas.
 * - Export dimensions are independent of the live pane/window size.
 * - Page boundaries prefer real text-line boundaries.
 * - DOCX and PDF share the same normalized export DOM and typography contract.
 * - Export progress is observable and cancellation-safe at the UI layer.
 */

const PDF = {
  widthMm: 210,
  heightMm: 297,
  marginMm: 20, // Standard ISO A4 margin (20 mm)
  bodyPt: 11, // Modern document publishing standard (11 pt)
  h1Pt: 22,
  h2Pt: 16,
  h3Pt: 13.5,
  h4Pt: 12,
  codePt: 9.5, // Typically 85–90% of body text
  tablePt: 9.5,
  lineHeight: 1.45, // Optimal readability ratio for print/paged media
  font: "Arial, Helvetica, sans-serif",
  scale: 1.0, // 1:1 true print scale (prevents clipping/zoomed layout)
};

const DOCX = {
  bodyPt: 11, // Standard default body size for Word/Office documents
  h1Pt: 22,
  h2Pt: 16,
  h3Pt: 13.5,
  h4Pt: 12,
  codePt: 9.5,
  font: "Arial",
  lineSpacing: 276, // 1.15x line spacing (276 / 240 in OpenXML twips)
  paragraphAfter: 6, // Standard 6 pt paragraph spacing
  headingBefore: { 1: 12, 2: 9, 3: 6, 4: 4 }, // Standard hierarchical spacing before (pt)
  headingAfter: { 1: 4, 2: 3, 3: 2, 4: 2 }, // Standard spacing after (pt)
};

let jsPdfModulePromise;
let html2canvasModulePromise;
let docxModulePromise;

const MM_TO_CSS_PX = 96 / 25.4;
const PT_TO_PX = 96 / 72;

function cleanTitle(value) {
  return String(value || "Untitled Notes")
    .replace(/[<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "Untitled Notes";
}

function fileStem(title, suffix = "") {
  const base = cleanTitle(title).replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "export";
  const tail = String(suffix || "").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase();
  return tail ? `${base.toLowerCase()}_${tail}` : base.toLowerCase();
}

function assertContent(content) {
  const html = String(content || "").trim();
  if (!html || html === "<p></p>" || html === "<p><br></p>") throw new Error("Nothing to export.");
  return html;
}

function report(onProgress, phase, percent, detail = "") {
  try { onProgress?.({ phase, percent: Math.max(0, Math.min(100, percent)), detail }); } catch { /* UI progress must never break export */ }
}

function downloadBlob(blob, filename) {
  if (!(blob instanceof Blob) || blob.size === 0) throw new Error("Export produced an empty file.");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.position = "fixed";
  a.style.left = "-10000px";
  document.body.appendChild(a);
  try { a.click(); }
  finally {
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}

async function loadJsPdf() {
  if (!jsPdfModulePromise) jsPdfModulePromise = import("https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm");
  const mod = await jsPdfModulePromise;
  return mod.jsPDF || mod.default?.jsPDF || mod.default;
}

async function loadHtml2Canvas() {
  if (!html2canvasModulePromise) html2canvasModulePromise = import("https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/+esm");
  const mod = await html2canvasModulePromise;
  return mod.default || mod;
}

async function loadDocx() {
  if (!docxModulePromise) docxModulePromise = import("https://esm.sh/docx@9.5.1");
  return docxModulePromise;
}

function parseHtml(html) {
  const parser = new DOMParser();
  return parser.parseFromString(`<div data-export-root="true">${assertContent(html)}</div>`, "text/html").body.firstElementChild;
}

function cloneEditorDom(editorElement, content) {
  if (editorElement) {
    const clone = editorElement.cloneNode(true);
    clone.removeAttribute("contenteditable");
    clone.removeAttribute("spellcheck");
    clone.classList.add("tiptap", "export-document");
    clone.setAttribute("data-export-root", "true");
    clone.querySelectorAll(".ProseMirror-gapcursor,.ProseMirror-selectednode,.column-resize-handle,.selectedCell").forEach(el => {
      el.classList.remove("selectedCell");
      if (el.matches(".ProseMirror-gapcursor,.column-resize-handle")) el.remove();
    });
    clone.querySelectorAll("[data-placeholder]").forEach(el => el.removeAttribute("data-placeholder"));
    return clone;
  }
  return parseHtml(content);
}

function getLatexFromMathElement(element) {
  if (!element) return "";
  const direct = element.getAttribute?.("data-latex");
  if (direct) return direct;
  const annotation = element.querySelector?.("annotation[encoding='application/x-tex'],annotation");
  return annotation?.textContent || "";
}

function normalizeMathToLatex(root) {
  const nodes = [...root.querySelectorAll("[data-latex],.math-inline,.math-block,.katex,.katex-display")];
  for (const el of nodes) {
    const latex = getLatexFromMathElement(el);
    if (!latex) continue;
    const isBlock = el.classList.contains("math-block") || el.classList.contains("katex-display") || !!el.closest?.(".math-block");
    const replacement = document.createElement(isBlock ? "div" : "span");
    replacement.className = isBlock ? "math-block export-math-latex" : "math-inline export-math-latex";
    replacement.setAttribute("data-latex", latex);
    replacement.textContent = latex;
    el.replaceWith(replacement);
  }
}

function injectTypography(root) {
  const style = document.createElement("style");
  style.dataset.exportTypography = "true";
  style.textContent = `
    [data-export-root] { box-sizing:border-box!important; width:100%!important; margin:0!important; padding:0!important; font-family:${PDF.font}!important; font-size:${PDF.bodyPt}pt!important; line-height:${PDF.lineHeight}!important; color:#202124!important; background:#fff!important; }
    [data-export-root] p,[data-export-root] li,[data-export-root] blockquote,[data-export-root] td,[data-export-root] th { font-size:${PDF.bodyPt}pt!important; line-height:${PDF.lineHeight}!important; }
    [data-export-root] h1 { font-size:${PDF.h1Pt}pt!important; line-height:1.2!important; margin-top:0.2em!important; margin-bottom:0.5em!important; }
    [data-export-root] h2 { font-size:${PDF.h2Pt}pt!important; line-height:1.25!important; margin-top:0.7em!important; margin-bottom:0.4em!important; }
    [data-export-root] h3 { font-size:${PDF.h3Pt}pt!important; line-height:1.3!important; margin-top:0.6em!important; margin-bottom:0.35em!important; }
    [data-export-root] h4,[data-export-root] h5,[data-export-root] h6 { font-size:${PDF.h4Pt}pt!important; line-height:1.35!important; }
    [data-export-root] code,[data-export-root] pre { font-size:${PDF.codePt}pt!important; }
    [data-export-root] table { font-size:${PDF.tablePt}pt!important; }
    [data-export-root] img { max-width:100%!important; height:auto!important; }
    [data-export-root] strong,[data-export-root] b { font-weight:700!important; }
    [data-export-root] .export-math-latex { font-family:"Courier New",monospace!important; white-space:pre-wrap!important; }
    [data-export-root] pre { white-space:pre-wrap!important; overflow-wrap:anywhere!important; }
  `;
  root.prepend(style);
}

async function mountForExport({ editorElement, content, purpose = "pdf" }) {
  const root = purpose === "docx" ? parseHtml(content) : cloneEditorDom(editorElement, content);
  if (!root) throw new Error("Could not prepare document for export.");
  normalizeMathToLatex(root);

  const sourceWidth = Math.round((PDF.widthMm - PDF.marginMm * 2) * MM_TO_CSS_PX);
  const host = document.createElement("div");
  host.dataset.exportHost = purpose;
  host.style.cssText = `position:fixed;left:0;top:0;width:${sourceWidth}px;padding:0;margin:0;background:#fff;visibility:visible;pointer-events:none;z-index:-1000;overflow:visible;`;
  root.style.cssText += `;width:${sourceWidth}px!important;max-width:none!important;height:auto!important;min-height:0!important;overflow:visible!important;box-sizing:border-box!important;background:#fff!important;`;
  host.appendChild(root);
  document.body.appendChild(host);
  injectTypography(root);

  if (purpose === "pdf" && document.fonts?.ready) await document.fonts.ready;
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  const height = Math.ceil(root.getBoundingClientRect().height || root.scrollHeight || 0);
  if (!height) throw new Error("The document has no renderable content.");
  return { root, host, sourceWidth, height, dispose: () => host.remove() };
}

function textLineCandidates(root) {
  const rootRect = root.getBoundingClientRect();
  const values = [];
  const add = rect => {
    if (!rect || rect.height <= 0) return;
    const y = Math.round(rect.bottom - rootRect.top);
    if (y > 0) values.push(y);
  };

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (!node.nodeValue?.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) add(rect);
  }

  // Block boundaries are a fallback for empty blocks, headings, tables and
  // images. Text-line bottoms remain preferred because they never split glyphs.
  root.querySelectorAll("p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,table,tr,hr,img").forEach(el => add(el.getBoundingClientRect()));
  return [...new Set(values)].sort((a, b) => a - b);
}

function choosePageEnd(startCss, targetCss, candidates, totalCss) {
  const MIN_ADVANCE = 4;
  let chosen = 0;
  for (const candidate of candidates) {
    if (candidate <= startCss + MIN_ADVANCE) continue;
    if (candidate > targetCss + 0.5) break;
    chosen = candidate;
  }
  return Math.min(totalCss, Math.max(startCss + 1, chosen || targetCss));
}

async function renderPage(html2canvas, root, sourceWidth, startCss, heightCss) {
  // Crucial design choice: render only one page-sized bitmap. A large source
  // document can exceed Chromium's canvas dimension limits if rendered as one
  // giant canvas, which was the cause of blank PDFs for large Source panes.
  return html2canvas(root, {
    scale: PDF.scale,
    x: 0,
    y: startCss,
    width: sourceWidth,
    height: Math.max(1, Math.ceil(heightCss)),
    windowWidth: sourceWidth,
    windowHeight: Math.max(1, Math.ceil(heightCss)),
    backgroundColor: "#fff",
    useCORS: true,
    allowTaint: false,
    logging: false,
    imageTimeout: 2500,
    scrollX: 0,
    scrollY: 0,
    removeContainer: true,
  });
}

async function exportPdf({ title, content, suffix = "Notes", editorElement, onProgress }) {
  report(onProgress, "prepare", 3, "Loading PDF renderer…");
  const [JsPDF, html2canvas] = await Promise.all([loadJsPdf(), loadHtml2Canvas()]);
  report(onProgress, "prepare", 12, "Preparing document…");
  const mounted = await mountForExport({ editorElement, content, purpose: "pdf" });

  try {
    const { root, sourceWidth, height: totalCssHeight } = mounted;
    const printableHeightMm = PDF.heightMm - PDF.marginMm * 2;
    const printableWidthMm = PDF.widthMm - PDF.marginMm * 2;
    const pageHeightCss = printableHeightMm * MM_TO_CSS_PX;
    const candidates = textLineCandidates(root);
    const totalPages = Math.max(1, Math.ceil(totalCssHeight / pageHeightCss));
    const doc = new JsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });

    let startCss = 0;
    let pageIndex = 0;
    while (startCss < totalCssHeight - 1) {
      const targetEnd = Math.min(totalCssHeight, startCss + pageHeightCss);
      const endCss = choosePageEnd(startCss, targetEnd, candidates, totalCssHeight);
      const sliceCss = Math.max(1, endCss - startCss);

      report(onProgress, "render", 15 + (pageIndex / totalPages) * 65, `Rendering page ${pageIndex + 1} of ${totalPages}…`);
      const canvas = await renderPage(html2canvas, root, sourceWidth, startCss, sliceCss);

      if (!canvas.width || !canvas.height) throw new Error(`PDF page ${pageIndex + 1} could not be rendered.`);
      if (pageIndex > 0) doc.addPage();
      const imageHeightMm = Math.min(printableHeightMm, sliceCss / MM_TO_CSS_PX);
      doc.addImage(canvas, "JPEG", PDF.marginMm, PDF.marginMm, printableWidthMm, imageHeightMm, undefined, "FAST");

      // Release the page bitmap immediately; never accumulate all pages in RAM.
      canvas.width = 1;
      canvas.height = 1;
      startCss = endCss;
      pageIndex += 1;
    }

    report(onProgress, "package", 86, "Building PDF file…");
    doc.setProperties({ title: cleanTitle(title), subject: `${suffix} download from Parallel Notes` });
    const blob = doc.output("blob");
    report(onProgress, "download", 96, "Starting download…");
    downloadBlob(blob, `${fileStem(title, suffix)}.pdf`);
    report(onProgress, "done", 100, "PDF download started.");
  } finally {
    mounted.dispose();
  }
}

/* ------------------------------ DOCX ---------------------------------- */

function px(value, fallback = 0) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}
function twips(pt) { return Math.round(pt * 20); }
function elementStyle(el) { try { return getComputedStyle(el); } catch { return null; } }
function ptFromPx(value, fallback) { return Math.max(1, px(value, fallback * PT_TO_PX) / PT_TO_PX); }

function collectMarks(node) {
  const marks = { bold: false, italics: false, underline: false, fontFamily: DOCX.font, fontSizePt: DOCX.bodyPt };
  let cur = node.nodeType === 3 ? node.parentElement : node;
  while (cur && cur.nodeType === 1) {
    const tag = cur.tagName.toLowerCase();
    if (tag === "strong" || tag === "b") marks.bold = true;
    if (tag === "em" || tag === "i") marks.italics = true;
    if (tag === "u") marks.underline = true;
    const style = elementStyle(cur);
    if (style) {
      if (style.fontWeight === "bold" || parseInt(style.fontWeight, 10) >= 600) marks.bold = true;
      if (style.fontStyle === "italic") marks.italics = true;
      if (style.textDecorationLine?.includes("underline")) marks.underline = true;
      const family = String(style.fontFamily || "").split(",")[0].trim().replace(/^['"]|['"]$/g, "");
      if (family) marks.fontFamily = family;
    }
    cur = cur.parentElement;
    if (cur?.matches?.("[data-export-root]")) break;
  }
  return marks;
}

function runOptions(style, marks = {}) {
  const fontSize = marks.fontSizePt || (style ? ptFromPx(style.fontSize, DOCX.bodyPt) : DOCX.bodyPt);
  const family = marks.fontFamily || DOCX.font;
  const out = { font: family, size: Math.round(fontSize * 2), bold: !!marks.bold, italics: !!marks.italics, underline: marks.underline ? {} : undefined };
  if (style?.color && /^#[0-9a-f]{6}$/i.test(style.color)) out.color = style.color.slice(1);
  return out;
}

function textRun(docx, text, inherited = {}) {
  return new docx.TextRun({ text, ...runOptions(null, inherited) });
}

function mathRun(docx, el, inherited = {}) {
  const latex = getLatexFromMathElement(el) || el.textContent || "";
  if (!latex) return null;
  return new docx.TextRun({ text: latex, ...runOptions(null, { ...inherited, fontFamily: "Courier New", fontSizePt: DOCX.bodyPt }) });
}

async function inlineChildren(docx, element, inherited = {}) {
  const runs = [];
  for (const child of element.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      if (child.nodeValue) runs.push(textRun(docx, child.nodeValue, inherited));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child;
    if (el.matches(".math-inline,.math-block,[data-latex],.katex,.katex-display")) {
      const run = mathRun(docx, el, inherited);
      if (run) runs.push(run);
      continue;
    }
    if (el.tagName.toLowerCase() === "br") {
      runs.push(new docx.TextRun({ break: 1, ...runOptions(null, inherited) }));
      continue;
    }
    runs.push(...await inlineChildren(docx, el, { ...inherited, ...collectMarks(el) }));
  }
  return runs;
}

function headingLevel(tag) {
  const m = /^h([1-6])$/.exec(tag);
  return m ? Math.min(4, Number(m[1])) : 0;
}
function listDepth(el) {
  let depth = 0, cur = el.parentElement;
  while (cur) { if (["ul", "ol"].includes(cur.tagName?.toLowerCase())) depth++; cur = cur.parentElement; }
  return Math.max(0, depth - 1);
}
function listType(el) { return el.closest("ol") ? "number" : "bullet"; }

function buildNumbering(docx) {
  return { config: [
    { reference: "pn-bullets", levels: Array.from({ length: 9 }, (_, level) => ({ level, format: docx.LevelFormat.BULLET, text: "•", alignment: docx.AlignmentType.LEFT, style: { paragraph: { indent: { left: 720 + level * 360, hanging: 360 } } } })) },
    { reference: "pn-numbers", levels: Array.from({ length: 9 }, (_, level) => ({ level, format: docx.LevelFormat.DECIMAL, text: `%${level + 1}.`, alignment: docx.AlignmentType.LEFT, style: { paragraph: { indent: { left: 720 + level * 360, hanging: 360 } } } })) },
  ] };
}

function paragraphOptions(style, level = 0) {
  const align = { left: "left", center: "center", right: "right", justify: "both" }[style?.textAlign] || "left";
  const before = level ? DOCX.headingBefore[level] : 0;
  const after = level ? DOCX.headingAfter[level] : DOCX.paragraphAfter;
  return { alignment: align, spacing: { before: twips(before), after: twips(after), line: DOCX.lineSpacing, lineRule: "auto" } };
}

async function elementToParagraph(docx, el) {
  const tag = el.tagName.toLowerCase();
  const level = headingLevel(tag);
  const size = level === 1 ? DOCX.h1Pt : level === 2 ? DOCX.h2Pt : level === 3 ? DOCX.h3Pt : level === 4 ? DOCX.h4Pt : DOCX.bodyPt;
  const style = elementStyle(el);
  const runs = await inlineChildren(docx, el, { fontFamily: DOCX.font, fontSizePt: size, bold: level > 0 });
  if (!runs.length) runs.push(new docx.TextRun({ text: "", font: DOCX.font, size: size * 2, bold: level > 0 }));
  return new docx.Paragraph({ ...paragraphOptions(style, level), children: runs, keepNext: level > 0 });
}

async function listItemToParagraph(docx, el) {
  const runs = [];
  const inherited = { fontFamily: DOCX.font, fontSizePt: DOCX.bodyPt, ...collectMarks(el) };
  for (const child of el.childNodes) {
    if (child.nodeType === Node.ELEMENT_NODE && ["ul", "ol"].includes(child.tagName.toLowerCase())) continue;
    if (child.nodeType === Node.TEXT_NODE) { if (child.nodeValue) runs.push(textRun(docx, child.nodeValue, inherited)); }
    else if (child.nodeType === Node.ELEMENT_NODE) runs.push(...await inlineChildren(docx, child, inherited));
  }
  if (!runs.length) runs.push(new docx.TextRun({ text: "", font: DOCX.font, size: DOCX.bodyPt * 2 }));
  const p = new docx.Paragraph({ ...paragraphOptions(elementStyle(el)), children: runs });
  p.numbering = { reference: listType(el) === "number" ? "pn-numbers" : "pn-bullets", level: Math.min(8, listDepth(el)) };
  return p;
}

async function tableToDocx(docx, tableEl) {
  const rows = [];
  for (const tr of tableEl.querySelectorAll(":scope > tbody > tr, :scope > tr")) {
    const cells = [];
    for (const cell of tr.children) {
      const runs = await inlineChildren(docx, cell, { fontFamily: DOCX.font, fontSizePt: DOCX.bodyPt });
      if (!runs.length) runs.push(new docx.TextRun({ text: "", font: DOCX.font, size: DOCX.bodyPt * 2 }));
      const isHeader = cell.tagName.toLowerCase() === "th";
      cells.push(new docx.TableCell({
        children: [new docx.Paragraph({ children: runs, spacing: { after: twips(2), line: DOCX.lineSpacing } })],
        shading: isHeader ? { fill: "EDEFF3" } : undefined,
        margins: { top: 80, bottom: 80, left: 100, right: 100 },
      }));
    }
    if (cells.length) rows.push(new docx.TableRow({ children: cells }));
  }
  if (!rows.length) return null;
  return new docx.Table({ rows, width: { size: 100, type: docx.WidthType.PERCENTAGE }, borders: {
    top: { style: docx.BorderStyle.SINGLE, size: 4, color: "B8BEC8" }, bottom: { style: docx.BorderStyle.SINGLE, size: 4, color: "B8BEC8" },
    left: { style: docx.BorderStyle.SINGLE, size: 4, color: "B8BEC8" }, right: { style: docx.BorderStyle.SINGLE, size: 4, color: "B8BEC8" },
    insideHorizontal: { style: docx.BorderStyle.SINGLE, size: 4, color: "D0D4DB" }, insideVertical: { style: docx.BorderStyle.SINGLE, size: 4, color: "D0D4DB" },
  } });
}

async function convertDomToDocx(docx, root, onProgress) {
  const children = [];
  const nodes = [...root.children].filter(el => !el.matches("style[data-export-typography]"));
  let processed = 0;
  const visit = async el => {
    const tag = el.tagName.toLowerCase();
    if (tag === "table") { const table = await tableToDocx(docx, el); if (table) children.push(table); return; }
    if (tag === "li") { children.push(await listItemToParagraph(docx, el)); return; }
    if (/^h[1-6]$/.test(tag) || ["p", "blockquote", "pre"].includes(tag)) { children.push(await elementToParagraph(docx, el)); return; }
    if (tag === "hr") { children.push(new docx.Paragraph({ border: { bottom: { style: docx.BorderStyle.SINGLE, size: 4, color: "B8BEC8" } }, spacing: { before: twips(6), after: twips(6) } })); return; }
    if (["ul", "ol"].includes(tag)) { for (const li of el.children) await visit(li); return; }
    for (const child of el.children) await visit(child);
  };
  for (const child of nodes) {
    await visit(child);
    processed += 1;
    report(onProgress, "convert", 10 + (processed / Math.max(1, nodes.length)) * 65, `Formatting ${processed} of ${nodes.length}…`);
  }
  return children;
}

async function exportDocx({ title, content, suffix = "Notes", editorElement, onProgress }) {
  report(onProgress, "prepare", 4, "Loading Word exporter…");
  const docx = await loadDocx();
  report(onProgress, "prepare", 12, "Preparing document…");
  const mounted = await mountForExport({ editorElement, content, purpose: "docx" });
  try {
    const children = await convertDomToDocx(docx, mounted.root, onProgress);
    if (!children.length) throw new Error("Nothing to export.");
    report(onProgress, "package", 82, "Building Word document…");
    const doc = new docx.Document({
      creator: "Parallel Notes",
      title: cleanTitle(title),
      subject: `${suffix} download from Parallel Notes`,
      numbering: buildNumbering(docx),
      styles: {
        default: {
          document: {
            run: { font: DOCX.font, size: DOCX.bodyPt * 2 },
            paragraph: { spacing: { line: DOCX.lineSpacing, after: twips(DOCX.paragraphAfter) } },
          },
        },
      },
      sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } }, children }],
    });
    const blob = await docx.Packer.toBlob(doc);
    report(onProgress, "download", 96, "Starting download…");
    downloadBlob(blob, `${fileStem(title, suffix)}.docx`);
    report(onProgress, "done", 100, "Word download started.");
  } finally {
    mounted.dispose();
  }
}

export function prepareExport(format) {
  const normalized = String(format || "").toLowerCase();
  if (normalized === "pdf") return Promise.all([loadJsPdf(), loadHtml2Canvas()]);
  if (normalized === "docx") return loadDocx();
  return Promise.reject(new Error("Unsupported export format."));
}

export async function exportDocument({ format, title, content, suffix = "Notes", editorElement, onProgress }) {
  const normalized = String(format || "").toLowerCase();
  if (normalized === "pdf") return exportPdf({ title, content, suffix, editorElement, onProgress });
  if (normalized === "docx") return exportDocx({ title, content, suffix, editorElement, onProgress });
  throw new Error("Unsupported export format.");
}

export async function exportHtmlDocument(args) {
  return exportDocument({ ...args, format: "docx" });
}
