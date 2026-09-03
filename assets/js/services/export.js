/** Parallel Notes export service. */
const PDF = {
  width: 210,
  height: 297,
  margin: 16,
  cssPxPerMm: 96 / 25.4,
  bodyPt: 12,
  h1Pt: 21,
  h2Pt: 17,
  h3Pt: 14,
  codePt: 11,
  tablePt: 11,
  lineHeight: 1.7,
  font: "Inter, Arial, sans-serif",
};
let jsPdfModulePromise;
let html2canvasModulePromise;
let docxModulePromise;

function cleanTitle(value) {
  return String(value || "Untitled Notes").replace(/[<>:"/\\|?*]+/g, " ").replace(/\s+/g, " ").trim() || "Untitled Notes";
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
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.style.display = "none";
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
}
async function loadJsPdf() {
  if (!jsPdfModulePromise) jsPdfModulePromise = import("https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm");
  const mod = await jsPdfModulePromise; return mod.jsPDF || mod.default?.jsPDF || mod.default;
}
async function loadHtml2Canvas() {
  if (!html2canvasModulePromise) html2canvasModulePromise = import("https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/+esm");
  const mod = await html2canvasModulePromise; return mod.default || mod;
}
async function loadDocx() {
  if (!docxModulePromise) docxModulePromise = import("https://esm.sh/docx@9.5.1");
  return docxModulePromise;
}
function parseHtml(html) {
  const parser = new DOMParser();
  return parser.parseFromString(`<div data-export-root="true">${assertContent(html)}</div>`, "text/html").body.firstElementChild;
}
function cloneEditorDom(editorElement) {
  if (!editorElement) return null;
  const clone = editorElement.cloneNode(true);
  clone.removeAttribute("contenteditable"); clone.removeAttribute("spellcheck");
  clone.querySelectorAll(".ProseMirror-gapcursor,.ProseMirror-selectednode,.column-resize-handle,.selectedCell").forEach(el => {
    el.classList.remove("selectedCell");
    if (el.matches(".ProseMirror-gapcursor,.column-resize-handle")) el.remove();
  });
  clone.querySelectorAll("[data-placeholder]").forEach(el => el.removeAttribute("data-placeholder"));
  return clone;
}
function getLatexFromMathElement(element) {
  if (!element) return "";
  const direct = element.getAttribute?.("data-latex");
  if (direct) return direct;
  const annotation = element.querySelector?.("annotation");
  if (annotation?.textContent) return annotation.textContent;
  const annotationXml = element.querySelector?.("annotation[encoding='application/x-tex']");
  if (annotationXml?.textContent) return annotationXml.textContent;
  return "";
}

function normalizeMathToLatex(root) {
  const nodes = [...root.querySelectorAll("[data-latex],.math-inline,.math-block")];
  for (const el of nodes) {
    // Export mathematical nodes exactly as their stored LaTeX source. Do not
    // ask KaTeX, html2canvas, or Word to reinterpret the formula.
    const latex = getLatexFromMathElement(el);
    if (!latex) continue;
    const isBlock = el.classList.contains("math-block") || el.classList.contains("katex-display") || !!el.closest?.(".math-block");
    const replacement = document.createElement(isBlock ? "div" : "span");
    replacement.className = isBlock ? "math-block export-math-latex" : "math-inline export-math-latex";
    replacement.setAttribute("data-latex", latex);
    replacement.textContent = latex;
    if (isBlock) {
      replacement.style.display = "block";
      replacement.style.whiteSpace = "pre-wrap";
    }
    el.replaceWith(replacement);
  }
}

function injectPdfTypography(root) {
  const style = document.createElement("style");
  style.setAttribute("data-pdf-typography", "true");
  style.textContent = `
    [data-export-root] {
      box-sizing: border-box !important;
      font-family: ${PDF.font} !important;
      font-size: ${PDF.bodyPt}pt !important;
      line-height: ${PDF.lineHeight} !important;
      color: #202124 !important;
    }
    [data-export-root] p,
    [data-export-root] li,
    [data-export-root] blockquote,
    [data-export-root] td,
    [data-export-root] th { font-size: ${PDF.bodyPt}pt !important; line-height: ${PDF.lineHeight} !important; }
    [data-export-root] h1 { font-size: ${PDF.h1Pt}pt !important; line-height: 1.2 !important; }
    [data-export-root] h2 { font-size: ${PDF.h2Pt}pt !important; line-height: 1.25 !important; }
    [data-export-root] h3 { font-size: ${PDF.h3Pt}pt !important; line-height: 1.3 !important; }
    [data-export-root] h4,
    [data-export-root] h5,
    [data-export-root] h6 { font-size: ${PDF.bodyPt}pt !important; line-height: 1.4 !important; }
    [data-export-root] code,
    [data-export-root] pre { font-size: ${PDF.codePt}pt !important; }
    [data-export-root] table { font-size: ${PDF.tablePt}pt !important; }
    [data-export-root] strong, [data-export-root] b { font-weight: 800 !important; }
    [data-export-root] em, [data-export-root] i { font-style: italic !important; }
    [data-export-root] u { text-decoration: underline !important; }
  `;
  root.prepend(style);
}
async function mountForExport({ editorElement, content }) {
  const root = cloneEditorDom(editorElement) || parseHtml(content);
  normalizeMathToLatex(root);
  const sourceWidth = Math.max(1, Math.round(editorElement?.getBoundingClientRect?.().width || root.getBoundingClientRect?.().width || 672));
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${sourceWidth}px;min-height:0;background:#fff;visibility:visible;z-index:-1;overflow:visible;`;
  root.style.width = `${sourceWidth}px`; root.style.height = "auto"; root.style.minHeight = "0"; root.style.overflow = "visible";
  host.appendChild(root); document.body.appendChild(host);
  injectPdfTypography(root);
  if (document.fonts?.ready) await document.fonts.ready;
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return { root, sourceWidth, dispose: () => host.remove() };
}

async function exportPdf({ title, content, suffix = "Notes", editorElement }) {
  const JsPDF = await loadJsPdf();
  const html2canvas = await loadHtml2Canvas();
  const mounted = await mountForExport({ editorElement, content });
  try {
    const { root, sourceWidth } = mounted;
    const scale = 2;
    const canvas = await html2canvas(root, {
      scale, width: sourceWidth, height: Math.ceil(root.scrollHeight), windowWidth: sourceWidth,
      backgroundColor: "#fff", useCORS: true, allowTaint: false, logging: false, imageTimeout: 0, scrollX: 0, scrollY: 0
    });
    const doc = new JsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
    const printableHeightMm = PDF.height - PDF.margin * 2;
    const nativePxToMm = 25.4 / 96;
    const imageWidthMm = canvas.width / scale * nativePxToMm;
    const pageWidthMm = Math.min(imageWidthMm, PDF.width - PDF.margin * 2);
    const x = PDF.margin;
    const pageHeightPx = Math.floor(printableHeightMm / nativePxToMm * scale);
    const widthScale = pageWidthMm < imageWidthMm ? pageWidthMm / imageWidthMm : 1;
    const effectivePageHeightPx = Math.floor(pageHeightPx / widthScale);
    let sourceY = 0, page = 0;
    while (sourceY < canvas.height - 1) {
      const end = Math.min(canvas.height, sourceY + effectivePageHeightPx);
      const sliceHeight = end - sourceY;
      const pageCanvas = document.createElement("canvas"); pageCanvas.width = canvas.width; pageCanvas.height = sliceHeight;
      const ctx = pageCanvas.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, sliceHeight);
      ctx.drawImage(canvas, 0, sourceY, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
      if (page++) doc.addPage();
      const w = imageWidthMm * widthScale;
      const h = sliceHeight / scale * nativePxToMm * widthScale;
      doc.addImage(pageCanvas.toDataURL("image/jpeg", 0.96), "JPEG", x, PDF.margin, w, h, undefined, "FAST");
      sourceY = end;
    }
    doc.setProperties({ title: cleanTitle(title), subject: `${suffix} export from Parallel Notes` });
    downloadBlob(doc.output("blob"), `${fileStem(title, suffix)}.pdf`);
  } finally { mounted.dispose(); }
}

/* DOCX exporter: build a real OOXML document from the live Tiptap DOM.
 * The editor DOM remains the source of truth for structure and marks, but the
 * Word document uses an explicit, stable typography contract: 12pt body text,
 * predictable heading sizes, controlled spacing, and real list indentation. */
const DOCX = {
  bodyPt: 12,
  h1Pt: 21,
  h2Pt: 17,
  h3Pt: 14,
  font: "Inter",
  lineSpacing: 276, // 1.15 line spacing in twentieths of a point
  paragraphAfter: 6,
  headingBefore: { 1: 10, 2: 8, 3: 6 },
  headingAfter: { 1: 5, 2: 4, 3: 3 },
  pageMarginIn: 0.63,
  pxPerPt: 96 / 72,
  twipsPerPt: 20,
};
function px(value, fallback = 0) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}
function ptFromPx(value, fallback = DOCX.bodyPt) { return Math.max(1, px(value, fallback / 0.75) * 0.75); }
function twips(pt) { return Math.round(pt * DOCX.twipsPerPt); }
function indentTwipsFromPx(value) { return Math.max(0, Math.round(px(value) * 15)); }
function elementStyle(el) { try { return getComputedStyle(el); } catch { return null; } }
function directIndentPx(el) {
  let total = 0, cur = el;
  while (cur && cur.nodeType === 1) {
    const style = elementStyle(cur);
    // getComputedStyle already includes the element's inline margin-left;
    // never add the inline value a second time.
    if (style) total += Math.max(0, px(style.marginLeft));
    cur = cur.parentElement;
    if (cur?.matches?.("[data-export-root]")) break;
  }
  return total;
}
function paragraphBaseOptions(style, headingLevel = 0, extra = {}) {
  const alignmentMap = { left: "left", center: "center", right: "right", justify: "both" };
  const align = alignmentMap[style?.textAlign] || "left";
  const lineHeightPx = style ? px(style.lineHeight, 0) : 0;
  const lineSpacing = lineHeightPx > 0 ? Math.max(180, Math.min(600, Math.round(lineHeightPx / (DOCX.bodyPt / 0.75) * 240))) : DOCX.lineSpacing;
  const marginTop = headingLevel ? DOCX.headingBefore[headingLevel] : 0;
  const marginBottom = headingLevel ? DOCX.headingAfter[headingLevel] : DOCX.paragraphAfter;
  const indent = directIndentPx(extra.sourceElement || document.body);
  return {
    alignment: align,
    spacing: { before: twips(marginTop), after: twips(marginBottom), line: lineSpacing, lineRule: "auto" },
    indent: indent ? { left: indentTwipsFromPx(indent) } : undefined,
  };
}
function runOptionsFromStyle(style, marks = {}) {
  const fontSize = marks.fontSizePt || (style ? ptFromPx(style.fontSize, DOCX.bodyPt) : DOCX.bodyPt);
  const family = marks.fontFamily || DOCX.font;
  const out = { font: family, size: Math.round(fontSize * 2), bold: !!marks.bold, italics: !!marks.italics, underline: marks.underline ? {} : undefined };
  if (style?.color && /^#[0-9a-f]{6}$/i.test(style.color)) out.color = style.color.slice(1);
  return out;
}
function collectMarks(node) {
  const marks = { bold: false, italics: false, underline: false, fontFamily: DOCX.font };
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
function textRun(docx, text, inherited = {}) {
  return new docx.TextRun({ text, ...runOptionsFromStyle(null, inherited) });
}
function mathLatexRun(docx, element, inherited = {}) {
  const latex = getLatexFromMathElement(element) || element.textContent || "";
  if (!latex) return null;
  // Mathematical content is intentionally exported as literal LaTeX source.
  // This keeps the formula intact and avoids unreliable image/renderer paths.
  return new docx.TextRun({
    text: latex,
    ...runOptionsFromStyle(null, { ...inherited, fontFamily: "Courier New", fontSizePt: DOCX.bodyPt }),
  });
}

async function inlineChildren(docx, element, inherited = {}) {
  const runs = [];
  for (const child of [...element.childNodes]) {
    if (child.nodeType === Node.TEXT_NODE) {
      if (child.nodeValue) runs.push(textRun(docx, child.nodeValue, inherited));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child;
    if (el.matches(".math-inline,.math-block,[data-latex]")) {
      const mathRun = mathLatexRun(docx, el, inherited);
      if (mathRun) runs.push(mathRun);
      continue;
    }
    if (el.tagName.toLowerCase() === "br") { runs.push(new docx.TextRun({ break: 1, ...runOptionsFromStyle(null, inherited) })); continue; }
    const next = { ...inherited, ...collectMarks(el) };
    const childRuns = await inlineChildren(docx, el, next);
    runs.push(...childRuns);
  }
  return runs;
}
function headingLevel(tag) { const m = /^h([1-6])$/.exec(tag); return m ? Math.min(3, Number(m[1])) : 0; }
function listDepth(el) {
  let depth = 0, cur = el.parentElement;
  while (cur) { if (cur.tagName?.toLowerCase() === "ul" || cur.tagName?.toLowerCase() === "ol") depth++; cur = cur.parentElement; }
  return Math.max(0, depth - 1);
}
function listType(el) {
  const list = el.closest("ul,ol");
  return list?.tagName?.toLowerCase() === "ol" ? "number" : "bullet";
}
function buildNumbering(docx) {
  return {
    config: [
      { reference: "pn-bullets", levels: Array.from({ length: 9 }, (_, level) => ({ level, format: docx.LevelFormat.BULLET, text: "•", alignment: docx.AlignmentType.LEFT, style: { paragraph: { indent: { left: 720 + level * 360, hanging: 360 } } } })) },
      { reference: "pn-numbers", levels: Array.from({ length: 9 }, (_, level) => ({ level, format: docx.LevelFormat.DECIMAL, text: `%${level + 1}.`, alignment: docx.AlignmentType.LEFT, style: { paragraph: { indent: { left: 720 + level * 360, hanging: 360 } } } })) },
    ]
  };
}
async function elementToParagraph(docx, el) {
  const tag = el.tagName.toLowerCase();
  const level = headingLevel(tag);
  const style = elementStyle(el);
  const size = level === 1 ? DOCX.h1Pt : level === 2 ? DOCX.h2Pt : level === 3 ? DOCX.h3Pt : DOCX.bodyPt;
  // Typography is explicit: 12pt body, 21/17/14pt headings. This prevents
  // Word or the browser's CSS from silently changing export sizes.
  const headingMarks = level ? { bold: true, fontFamily: DOCX.font, fontSizePt: size } : { fontFamily: DOCX.font, fontSizePt: DOCX.bodyPt };
  const runs = await inlineChildren(docx, el, headingMarks);
  if (!runs.length) runs.push(new docx.TextRun({ text: "", font: DOCX.font, size: size * 2, bold: level > 0 }));
  const opts = paragraphBaseOptions(style, level, { sourceElement: el });
  return new docx.Paragraph({ ...opts, children: runs, keepNext: level > 0 });
}
async function listItemToParagraph(docx, el) {
  const type = listType(el), level = Math.min(8, listDepth(el));
  const style = elementStyle(el);
  const runs = [];
  for (const child of [...el.childNodes]) {
    if (child.nodeType === Node.ELEMENT_NODE && ["ul", "ol"].includes(child.tagName.toLowerCase())) continue;
    if (child.nodeType === Node.TEXT_NODE) { if (child.nodeValue) runs.push(textRun(docx, child.nodeValue, collectMarks(el))); }
    else if (child.nodeType === Node.ELEMENT_NODE) runs.push(...await inlineChildren(docx, child, collectMarks(child)));
  }
  if (!runs.length) runs.push(new docx.TextRun({ text: "", font: DOCX.font, size: DOCX.bodyPt * 2 }));
  const opts = paragraphBaseOptions(style, 0, { sourceElement: el });
  opts.numbering = { reference: type === "number" ? "pn-numbers" : "pn-bullets", level };
  opts.spacing.after = twips(3);
  return new docx.Paragraph({ ...opts, children: runs });
}
async function tableToDocx(docx, tableEl) {
  const rows = [];
  for (const tr of [...tableEl.querySelectorAll(":scope > tbody > tr, :scope > tr")]) {
    const cells = [];
    for (const cell of [...tr.children]) {
      const runs = await inlineChildren(docx, cell);
      if (!runs.length) runs.push(new docx.TextRun({ text: "", font: DOCX.font, size: DOCX.bodyPt * 2 }));
      const isHeader = cell.tagName.toLowerCase() === "th";
      cells.push(new docx.TableCell({ children: [new docx.Paragraph({ children: runs, spacing: { after: twips(2), line: DOCX.lineSpacing }, indent: { left: 0 } })], shading: isHeader ? { fill: "EDEFF3" } : undefined, margins: { top: 80, bottom: 80, left: 100, right: 100 } }));
    }
    if (cells.length) rows.push(new docx.TableRow({ children: cells }));
  }
  if (!rows.length) return null;
  return new docx.Table({ rows, width: { size: 100, type: docx.WidthType.PERCENTAGE }, borders: { top: { style: docx.BorderStyle.SINGLE, size: 4, color: "B8BEC8" }, bottom: { style: docx.BorderStyle.SINGLE, size: 4, color: "B8BEC8" }, left: { style: docx.BorderStyle.SINGLE, size: 4, color: "B8BEC8" }, right: { style: docx.BorderStyle.SINGLE, size: 4, color: "B8BEC8" }, insideHorizontal: { style: docx.BorderStyle.SINGLE, size: 4, color: "D0D4DB" }, insideVertical: { style: docx.BorderStyle.SINGLE, size: 4, color: "D0D4DB" } } });
}
async function convertDomToDocx(docx, root) {
  const children = [];
  const visit = async el => {
    if (el.nodeType !== Node.ELEMENT_NODE) return;
    const tag = el.tagName.toLowerCase();
    if (tag === "table") { const table = await tableToDocx(docx, el); if (table) children.push(table); return; }
    if (tag === "li") { children.push(await listItemToParagraph(docx, el)); return; }
    if (/^h[1-6]$/.test(tag) || ["p", "blockquote", "pre"].includes(tag)) { children.push(await elementToParagraph(docx, el)); return; }
    if (tag === "hr") { children.push(new docx.Paragraph({ border: { bottom: { style: docx.BorderStyle.SINGLE, size: 4, color: "B8BEC8" } }, spacing: { before: twips(6), after: twips(6) } })); return; }
    if (["ul", "ol"].includes(tag)) { for (const li of [...el.children]) await visit(li); return; }
    for (const child of [...el.children]) await visit(child);
  };
  for (const child of [...root.children]) await visit(child);
  return children;
}
async function exportDocx({ title, content, suffix = "Notes", editorElement }) {
  const docx = await loadDocx();
  const mounted = await mountForExport({ editorElement, content });
  try {
    const { root } = mounted;
    const children = await convertDomToDocx(docx, root);
    if (!children.length) throw new Error("Nothing to export.");
    const doc = new docx.Document({
      creator: "Parallel Notes",
      title: cleanTitle(title),
      subject: `${suffix} export from Parallel Notes`,
      numbering: buildNumbering(docx),
      styles: {
        default: { document: { run: { font: DOCX.font, size: DOCX.bodyPt * 2 }, paragraph: { spacing: { line: DOCX.lineSpacing, after: twips(DOCX.paragraphAfter) } } } },
      },
      sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } }, children }],
    });
    const blob = await docx.Packer.toBlob(doc);
    downloadBlob(blob, `${fileStem(title, suffix)}.docx`);
  } finally { mounted.dispose(); }
}

export async function exportDocument({ format, title, content, suffix = "Notes", editorElement }) {
  const normalized = String(format || "").toLowerCase();
  if (normalized === "pdf") return exportPdf({ title, content, suffix, editorElement });
  if (normalized === "docx") return exportDocx({ title, content, suffix, editorElement });
  throw new Error("Unsupported export format.");
}
export async function exportHtmlDocument(args) { return exportDocument({ ...args, format: "docx" }); }
