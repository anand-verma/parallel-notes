/**
 * Parallel Notes — Export Service (Vector + Raster Hybrid)
 *
 */

// ============================================================================
// STATE & CONFIGURATION
// ============================================================================

const State = {
  pdfLibLoaded: false,     // pdfmake + vfs_fonts + html-to-pdfmake scripts
  rasterLibLoaded: false,  // html2canvas + jsPDF scripts
  docxLibLoaded: false,
  hindiFontLoaded: false,  // becomes true only once the Devanagari font
                           // has actually been fetched and installed into
                           // pdfMake's vfs. Independent of pdfLibLoaded so
                           // it can be retried.
  customFonts: null,
};

const DEVANAGARI_RE = /[\u0900-\u097F]/;

function hasDevanagari(html) {
  return DEVANAGARI_RE.test(String(html || "").replace(/<[^>]*>/g, ""));
}

// Standardized CSS for DOCX. Font stack is chosen per-document based on
// whether it contains Devanagari, since font order affects which font
// Word's HTML converter picks for the run.
function buildDocxStyles(devanagari) {
  const bodyFontStack = devanagari
    ? "'Mangal', 'Noto Sans Devanagari', 'Arial', sans-serif"
    : "'Arial', 'Mangal', 'Noto Sans Devanagari', sans-serif";

  return `
    body { font-family: ${bodyFontStack}; font-size: 11pt; line-height: 1.4; color: #000; }
    h1 { font-size: 20pt; margin-bottom: 10pt; margin-top: 16pt; font-family: ${bodyFontStack}; }
    h2 { font-size: 16pt; margin-bottom: 8pt; margin-top: 14pt; font-family: ${bodyFontStack}; }
    h3 { font-size: 13pt; margin-bottom: 6pt; margin-top: 12pt; font-family: ${bodyFontStack}; }
    p { margin-bottom: 8pt; margin-top: 0; }
    ul, ol { margin-top: 0; margin-bottom: 8pt; margin-left: 0; padding-left: 18pt; }
    li { margin-bottom: 4pt; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 10pt; }
    th, td { border: 1px solid #999; padding: 6px; text-align: left; }
    th { background-color: #f0f0f0; font-weight: bold; }
    blockquote { border-left: 3px solid #ccc; margin: 0 0 10pt 0; padding-left: 10pt; color: #555; }
    code, pre { font-family: 'Courier New', monospace; background-color: #f5f5f5; font-size: 10pt; }
    pre { padding: 10px; }
    img { max-width: 100%; height: auto; vertical-align: middle; }
  `;
}

// ============================================================================
// UTILITIES
// ============================================================================

const Utils = {
  cleanTitle(value) {
    return String(value || "Untitled Notes").replace(/[<>:"/\\|?*]+/g, " ").replace(/\s+/g, " ").trim() || "Untitled Notes";
  },

  fileStem(title, suffix = "") {
    const base = this.cleanTitle(title).replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "export";
    const tail = String(suffix || "").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase();
    return tail ? `${base.toLowerCase()}_${tail}` : base.toLowerCase();
  },

  report(onProgress, phase, percent, detail = "") {
    try { onProgress?.({ phase, percent: Math.max(0, Math.min(100, percent)), detail }); }
    catch { /* Safe fail */ }
  },

  downloadBlob(blob, filename) {
    if (!(blob instanceof Blob) || blob.size === 0) throw new Error("Export produced an empty file.");
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.cssText = "position:fixed; left:-10000px; top:0;";
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(() => { anchor.remove(); URL.revokeObjectURL(url); }, 10000);
  },

  loadScript(src, globalCheckFn) {
    return new Promise((resolve, reject) => {
      if (globalCheckFn()) return resolve();
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => {
        if (globalCheckFn()) resolve();
        else reject(new Error(`Validation failed for: ${src}`));
      };
      script.onerror = () => reject(new Error(`Failed to load: ${src}`));
      document.head.appendChild(script);
    });
  }
};

// ============================================================================
// DEPENDENCY & PRE-PROCESSING ENGINE
// ============================================================================

// Fetches and installs the Devanagari font into pdfMake's vfs.
// IMPORTANT: throws on failure (instead of only logging) so callers can
// decide whether to retry, and does NOT get gated behind a flag that
// locks in permanently — State.hindiFontLoaded is only set true on actual
// success, so a failed attempt is retried on the next export call.
async function loadHindiPdfFont() {
  if (State.hindiFontLoaded) return;

  const fontUrl = './assets/vendor/fonts/NotoSansDevanagari-Regular.ttf';

  const response = await fetch(fontUrl, { mode: 'cors' });
  if (!response.ok) throw new Error(`Font fetch failed: ${response.status}`);
  const buffer = await response.arrayBuffer();

  const base64Font = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('Failed to base64-encode font.'));
    reader.readAsDataURL(new Blob([buffer]));
  });

  window.pdfMake.vfs = window.pdfMake.vfs || {};
  window.pdfMake.vfs['NotoSansDevanagari-Regular.ttf'] = base64Font;

  State.customFonts = {
    Roboto: {
      normal: 'Roboto-Regular.ttf',
      bold: 'Roboto-Medium.ttf',
      italics: 'Roboto-Italic.ttf',
      bolditalics: 'Roboto-MediumItalic.ttf'
    },
    NotoSans: {
      normal: 'NotoSansDevanagari-Regular.ttf',
      bold: 'NotoSansDevanagari-Regular.ttf',
      italics: 'NotoSansDevanagari-Regular.ttf',
      bolditalics: 'NotoSansDevanagari-Regular.ttf'
    }
  };

  State.hindiFontLoaded = true;
}

// needsHindiFont: only pass true when THIS specific export actually
// contains Devanagari text. Pure-English exports must never touch the
// Hindi font — loading it globally was what caused Latin glyphs (curly
// quotes, em-dashes, accented characters) to render as tofu boxes, since
// Noto Sans Devanagari doesn't carry full Latin/typographic coverage.
async function loadPdfVectorDependencies(needsHindiFont = false) {
  if (!State.pdfLibLoaded) {
    await Utils.loadScript('./assets/vendor/pdfmake/pdfmake.min.js', () => window.pdfMake);
    await Utils.loadScript('./assets/vendor/pdfmake/vfs_fonts.js', () => window.pdfMake && window.pdfMake.vfs);
    await Utils.loadScript('./assets/vendor/html-to-pdfmake/browser.js', () => window.htmlToPdfmake);
    State.pdfLibLoaded = true;
  }

  // Only fetched when this document actually needs it (in practice: the
  // raster-engine-failed fallback below, since Devanagari docs normally
  // go through exportPdfRaster instead). Independent of pdfLibLoaded so a
  // failed attempt is retried on the next call that needs it, rather than
  // being locked in — or out — permanently.
  if (needsHindiFont && !State.hindiFontLoaded) {
    try {
      await loadHindiPdfFont();
    } catch (err) {
      console.warn('Devanagari font load failed, will retry on next export:', err);
    }
  }
}

async function loadPdfRasterDependencies() {
  if (State.rasterLibLoaded) return;
  await Utils.loadScript('./assets/vendor/html2canvas/html2canvas.min.js', () => window.html2canvas);
  await Utils.loadScript('./assets/vendor/jspdf/jspdf.umd.min.js', () => window.jspdf && window.jspdf.jsPDF);
  State.rasterLibLoaded = true;
}

async function loadDependencies(format) {
  // Preloading only warms the base pdfmake scripts, not the Hindi font —
  // that's fetched lazily, only for a document that actually needs it.
  if (format === 'pdf') return loadPdfVectorDependencies(false);
  if (format === 'pdf-raster') return loadPdfRasterDependencies();
  if (format === 'docx' && !State.docxLibLoaded) {
    await Utils.loadScript('./assets/vendor/html-docx-js/html-docx.js', () => window.htmlDocx);
    State.docxLibLoaded = true;
  }
}

async function preProcessDocument(html) {
  const container = document.createElement('div');
  container.innerHTML = html;

  // 1. SAFEGUARD: Fix unbalanced tables (Causes 90% of pdfmake crashes)
  container.querySelectorAll('table').forEach(table => {
    let maxCols = 0;

    table.querySelectorAll('tr').forEach(tr => {
      let cols = 0;
      tr.querySelectorAll('td, th').forEach(cell => {
        cols += parseInt(cell.getAttribute('colspan') || '1', 10);
      });
      maxCols = Math.max(maxCols, cols);
    });

    if (maxCols > 0) {
      const widths = Array(maxCols).fill('*');
      table.setAttribute('data-pdfmake', JSON.stringify({ widths }));

      table.querySelectorAll('tr').forEach(tr => {
        let cols = 0;
        tr.querySelectorAll('td, th').forEach(cell => {
          cols += parseInt(cell.getAttribute('colspan') || '1', 10);
        });

        while (cols < maxCols) {
          const emptyTd = document.createElement('td');
          emptyTd.innerHTML = " ";
          tr.appendChild(emptyTd);
          cols++;
        }
      });
    }
  });

  // 2. SAFEGUARD: Strip empty lists (Causes pdfmake crashes)
  container.querySelectorAll('ul, ol').forEach(list => {
    if (list.children.length === 0 || list.textContent.trim() === "") {
      list.remove();
    }
  });

  // 3. SAFEGUARD: Remove remote images (pdfmake hangs trying to fetch them)
  container.querySelectorAll('img').forEach(img => {
    if (!img.src.startsWith('data:image')) {
      const fallbackText = document.createElement('p');
      fallbackText.style.fontStyle = 'italic';
      fallbackText.style.color = '#888';
      fallbackText.innerText = '[External Image Removed for PDF Export]';
      img.replaceWith(fallbackText);
    }
  });

  // 4. SAFEGUARD: Clean up orphaned empty paragraphs
  container.querySelectorAll('p').forEach(p => {
    if (p.innerHTML.trim() === "" || p.innerHTML === "<br>") {
      p.remove();
    }
  });

  return container.innerHTML;
}

// ============================================================================
// PDF — VECTOR ENGINE (fast, selectable text; safe for Latin-script content)
// ============================================================================

async function exportPdfVector({ title, content, suffix, onProgress }) {
  // Devanagari documents are normally routed to exportPdfRaster before
  // this function is ever called. This only comes back true here in the
  // fallback path (raster engine threw) — everyday English exports get
  // false and never load or reference the Hindi font.
  const needsHindiFont = hasDevanagari(content);

  try {
    Utils.report(onProgress, "prepare", 10, "Loading PDF engine and fonts...");
    await loadPdfVectorDependencies(needsHindiFont);

    Utils.report(onProgress, "model", 30, "Processing document structure...");
    const processedHtml = await preProcessDocument(content);

    Utils.report(onProgress, "render", 60, "Generating high-fidelity PDF layout...");

    const baseFont = (needsHindiFont && State.hindiFontLoaded) ? 'NotoSans' : 'Roboto';

    // Applied to every element type html-to-pdfmake commonly emits, not
    // just block-level tags — otherwise inline runs (li/td/th/a/strong/em)
    // can silently fall through to the built-in Roboto font.
    const fontedDefaults = {};
    ['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'table', 'th', 'td',
     'blockquote', 'a', 'strong', 'b', 'em', 'i', 'span'].forEach(tag => {
      fontedDefaults[tag] = { font: baseFont };
    });
    fontedDefaults.h1 = { fontSize: 20, bold: true, margin: [0, 14, 0, 8], font: baseFont };
    fontedDefaults.h2 = { fontSize: 16, bold: true, margin: [0, 12, 0, 6], font: baseFont };
    fontedDefaults.h3 = { fontSize: 13, bold: true, margin: [0, 10, 0, 4], font: baseFont };
    fontedDefaults.p = { margin: [0, 0, 0, 8], font: baseFont };
    fontedDefaults.ul = { margin: [0, 0, 0, 8], font: baseFont };
    fontedDefaults.ol = { margin: [0, 0, 0, 8], font: baseFont };
    fontedDefaults.table = { margin: [0, 0, 0, 10], font: baseFont };
    fontedDefaults.blockquote = { margin: [10, 5, 0, 5], italics: true, color: '#555555', font: baseFont };
    fontedDefaults.code = { background: '#f5f5f5' };

    let pdfMakeAst;
    try {
      pdfMakeAst = window.htmlToPdfmake(processedHtml, { defaultStyles: fontedDefaults });
    } catch (parseError) {
      console.error("HTML parsing error:", parseError);
      throw new Error("Failed to parse HTML layout. The document might contain unsupported styling.");
    }

    const documentDefinition = {
      info: { title: Utils.cleanTitle(title), author: 'Parallel Notes' },
      pageSize: 'A4',
      pageMargins: [50, 50, 50, 50],
      content: pdfMakeAst,
      defaultStyle: { font: baseFont, fontSize: 11, lineHeight: 1.4, color: '#111111' },
      pageBreakBefore: (currentNode) => currentNode.id === 'page-break'
    };

    await new Promise((resolve, reject) => {
      try {
        const pdfDocGenerator = window.pdfMake.createPdf(
          documentDefinition,
          null,
          State.customFonts || null,
          window.pdfMake.vfs
        );

        pdfDocGenerator.getBlob((blob) => {
          Utils.report(onProgress, "package", 90, "Packaging PDF...");
          Utils.downloadBlob(blob, `${Utils.fileStem(title, suffix)}.pdf`);
          Utils.report(onProgress, "done", 100, "PDF download started.");
          resolve();
        });
      } catch (pdfError) {
        reject(new Error("Failed during PDF generation: " + pdfError.message));
      }
    });

  } catch (globalError) {
    console.error("PDF Export Pipeline Failed:", globalError);
    Utils.report(onProgress, "error", 100, "Export failed. Please check the console.");
    throw globalError;
  }
}

// ============================================================================
// PDF — RASTER ENGINE (used automatically for Devanagari content)
//
// pdfMake/PDFKit has no complex-script shaping engine, so it cannot
// correctly reorder matras or form conjuncts even with the right font
// loaded. The browser's own rendering engine handles this correctly, so
// for Hindi content we render the HTML off-screen, capture it, and
// paginate the capture into a PDF as images. Text will not be
// selectable/searchable in the resulting pages, but glyphs render
// correctly.
// ============================================================================

async function exportPdfRaster({ title, content, suffix, onProgress }) {
  Utils.report(onProgress, "prepare", 10, "Loading high-fidelity renderer...");
  await loadPdfRasterDependencies();

  Utils.report(onProgress, "model", 25, "Processing document structure...");
  const processedHtml = await preProcessDocument(content);

  const PAGE_WIDTH_PX = 794;   // A4 @ 96dpi
  const PAGE_HEIGHT_PX = 1123; // A4 @ 96dpi
  const MARGIN_PX = 56;        // ~15mm

  const wrapper = document.createElement('div');
  wrapper.setAttribute('lang', 'hi');
  wrapper.style.cssText = `position:fixed; left:-99999px; top:0; width:${PAGE_WIDTH_PX - MARGIN_PX * 2}px; background:#fff; font-family:'Noto Sans Devanagari','Mangal',Arial,sans-serif; font-size:14px; line-height:1.6; color:#000;`;
  wrapper.innerHTML = `<style>${buildDocxStyles(true).replace(/11pt/g, '14px')}</style>${processedHtml}`;
  document.body.appendChild(wrapper);

  try {
    Utils.report(onProgress, "render", 45, "Rendering Devanagari text natively...");
    const canvas = await window.html2canvas(wrapper, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      windowWidth: PAGE_WIDTH_PX
    });

    Utils.report(onProgress, "package", 75, "Paginating and assembling PDF...");
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'px', format: [PAGE_WIDTH_PX, PAGE_HEIGHT_PX], compress: true });

    const usableHeightPx = PAGE_HEIGHT_PX - MARGIN_PX * 2;
    const scale = canvas.width / (PAGE_WIDTH_PX - MARGIN_PX * 2);
    const sliceHeightPx = Math.floor(usableHeightPx * scale);
    const totalSlices = Math.max(1, Math.ceil(canvas.height / sliceHeightPx));

    for (let i = 0; i < totalSlices; i++) {
      const sliceCanvas = document.createElement('canvas');
      sliceCanvas.width = canvas.width;
      sliceCanvas.height = Math.min(sliceHeightPx, canvas.height - i * sliceHeightPx);
      const ctx = sliceCanvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
      ctx.drawImage(canvas, 0, i * sliceHeightPx, canvas.width, sliceCanvas.height, 0, 0, canvas.width, sliceCanvas.height);

      const imgData = sliceCanvas.toDataURL('image/jpeg', 0.92);
      if (i > 0) pdf.addPage([PAGE_WIDTH_PX, PAGE_HEIGHT_PX]);
      const renderHeightPx = sliceCanvas.height / scale;
      pdf.addImage(imgData, 'JPEG', MARGIN_PX, MARGIN_PX, PAGE_WIDTH_PX - MARGIN_PX * 2, renderHeightPx);
    }

    const blob = pdf.output('blob');
    Utils.downloadBlob(blob, `${Utils.fileStem(title, suffix)}.pdf`);
    Utils.report(onProgress, "done", 100, "PDF download started.");
  } finally {
    wrapper.remove();
  }
}

async function exportPdf(args) {
  if (hasDevanagari(args.content)) {
    try {
      return await exportPdfRaster(args);
    } catch (rasterError) {
      console.warn('Raster PDF export failed, falling back to vector engine (Devanagari glyphs may not render correctly):', rasterError);
      // Fall through to the vector engine as a last resort rather than
      // failing the export outright.
    }
  }
  return exportPdfVector(args);
}

// ============================================================================
// DOCX
// ============================================================================

async function exportDocx({ title, content, suffix, onProgress }) {
  Utils.report(onProgress, "prepare", 10, "Loading Word engine...");
  await loadDependencies('docx');

  Utils.report(onProgress, "model", 30, "Processing document structure...");
  const processedHtml = await preProcessDocument(content);
  const devanagari = hasDevanagari(content);

  Utils.report(onProgress, "render", 60, "Applying Word formatting styles...");

  const finalHtmlString = `
    <!DOCTYPE html>
    <html lang="${devanagari ? 'hi' : 'en'}">
    <head>
      <meta charset="UTF-8">
      <title>${Utils.cleanTitle(title)}</title>
      <style>${buildDocxStyles(devanagari)}</style>
    </head>
    <body>
      ${processedHtml}
    </body>
    </html>
  `;

  try {
    const docxBlob = window.htmlDocx.asBlob(finalHtmlString, {
      orientation: 'portrait',
      margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
    });

    Utils.report(onProgress, "package", 90, "Packaging DOCX...");
    Utils.downloadBlob(docxBlob, `${Utils.fileStem(title, suffix)}.docx`);
    Utils.report(onProgress, "done", 100, "Word download started.");
  } catch (error) {
    throw new Error("Failed during DOCX generation: " + error.message);
  }
}

// ============================================================================
// PUBLIC API
// ============================================================================

export function prepareExport(format) {
  const normalized = String(format || "").toLowerCase();
  if (normalized === "pdf" || normalized === "docx") {
    return loadDependencies(normalized);
  }
  return Promise.reject(new Error("Unsupported export format."));
}

export async function exportDocument({ format, title, content, suffix = "Notes", onProgress }) {
  if (!content || content.trim() === "" || content === "<p></p>") {
    throw new Error("Nothing to export.");
  }

  const normalized = String(format || "").toLowerCase();

  if (normalized === "pdf") {
    return exportPdf({ title, content, suffix, onProgress });
  }
  if (normalized === "docx") {
    return exportDocx({ title, content, suffix, onProgress });
  }
  throw new Error("Unsupported export format.");
}

export function exportHtmlDocument(args) {
  return exportDocument({ ...args, format: "docx" });
}