/**
 * Parallel Notes — Export Service (Vector-Based & Math-Hardened)
 *
 * Drop-in replacement for the existing export service.
 */

// ============================================================================
// STATE & CONFIGURATION
// ============================================================================

const State = {
  pdfLibLoaded: false,
  docxLibLoaded: false,
  mathJaxLoaded: false,
};

// Standardized CSS for DOCX to fix massive indentations and set Arial font.
const DOCX_STYLES = `
  body { font-family: 'Arial', sans-serif; font-size: 11pt; line-height: 1.4; color: #000; }
  h1 { font-size: 20pt; margin-bottom: 10pt; margin-top: 16pt; font-family: 'Arial', sans-serif; }
  h2 { font-size: 16pt; margin-bottom: 8pt; margin-top: 14pt; font-family: 'Arial', sans-serif; }
  h3 { font-size: 13pt; margin-bottom: 6pt; margin-top: 12pt; font-family: 'Arial', sans-serif; }
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

async function loadDependencies(format) {
  // 1. MathJax for parsing LaTeX to Math Equations
  if (!State.mathJaxLoaded) {
    window.MathJax = {
      tex: { inlineMath: [['$', '$'], ['\\(', '\\)']], displayMath: [['$$', '$$'], ['\\[', '\\]']] },
      svg: { fontCache: 'global' },
      startup: { typeset: false } 
    };
    await Utils.loadScript('https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js', () => window.MathJax && window.MathJax.typesetPromise);
    State.mathJaxLoaded = true;
  }

  // 2. Load requested export libraries
  if (format === 'pdf' && !State.pdfLibLoaded) {
    await Utils.loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/pdfmake.min.js', () => window.pdfMake);
    await Utils.loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/vfs_fonts.js', () => window.pdfMake && window.pdfMake.vfs);
    await Utils.loadScript('https://cdn.jsdelivr.net/npm/html-to-pdfmake@2.4.25/browser.js', () => window.htmlToPdfmake);
    State.pdfLibLoaded = true;
  }
  
  if (format === 'docx' && !State.docxLibLoaded) {
    await Utils.loadScript('https://unpkg.com/html-docx-js@0.3.1/dist/html-docx.js', () => window.htmlDocx);
    State.docxLibLoaded = true;
  }
}


// Scans HTML, fixes table sizing, and transforms math logic to print-safe formats
async function preProcessDocument(html) {
  const container = document.createElement('div');
  container.innerHTML = html;

  // 1. Force Tables to stretch 100% horizontally
  container.querySelectorAll('table').forEach(table => {
    let maxCols = 0;
    table.querySelectorAll('tr').forEach(tr => { maxCols = Math.max(maxCols, tr.children.length); });
    if (maxCols > 0) {
      const widths = Array(maxCols).fill('*');
      table.setAttribute('data-pdfmake', JSON.stringify({ widths }));
    }
  });

  return container.innerHTML;
}

// ============================================================================
// EXPORT HANDLERS
// ============================================================================

async function exportPdf({ title, content, suffix, onProgress }) {
  Utils.report(onProgress, "prepare", 10, "Loading PDF engine...");
  await loadDependencies('pdf');

  Utils.report(onProgress, "model", 30, "Processing tables and math equations...");
  const processedHtml = await preProcessDocument(content);

  Utils.report(onProgress, "render", 60, "Generating high-fidelity PDF layout...");

  const pdfMakeAst = window.htmlToPdfmake(processedHtml, {
    defaultStyles: {
      p: { margin: [0, 0, 0, 8] },
      h1: { fontSize: 20, bold: true, margin: [0, 14, 0, 8] },
      h2: { fontSize: 16, bold: true, margin: [0, 12, 0, 6] },
      h3: { fontSize: 13, bold: true, margin: [0, 10, 0, 4] },
      ul: { margin: [0, 0, 0, 8] },
      ol: { margin: [0, 0, 0, 8] },
      table: { margin: [0, 0, 0, 10] },
      blockquote: { margin: [10, 5, 0, 5], italics: true, color: '#555555' },
      code: { background: '#f5f5f5' }
    }
  });

  const documentDefinition = {
    info: { title: Utils.cleanTitle(title), author: 'Parallel Notes' },
    pageSize: 'A4',
    pageMargins: [50, 50, 50, 50],
    content: pdfMakeAst,
    defaultStyle: {
      font: 'Roboto', 
      fontSize: 11,
      lineHeight: 1.4,
      color: '#111111'
    },
    // Allows tables to cleanly jump to next page rather than slicing text in half
    pageBreakBefore: (currentNode) => currentNode.id === 'page-break'
  };

  // Wrapped in a Promise to FORCE the progress bar to wait for actual completion.
  // Previously, massive files would take 5 seconds to build the blob, causing sync issues.
  await new Promise((resolve, reject) => {
    try {
      const pdfDocGenerator = window.pdfMake.createPdf(documentDefinition);
      pdfDocGenerator.getBlob((blob) => {
        Utils.report(onProgress, "package", 90, "Packaging PDF...");
        Utils.downloadBlob(blob, `${Utils.fileStem(title, suffix)}.pdf`);
        Utils.report(onProgress, "done", 100, "PDF download started.");
        resolve();
      });
    } catch (error) {
      reject(new Error("Failed during PDF generation: " + error.message));
    }
  });
}

async function exportDocx({ title, content, suffix, onProgress }) {
  Utils.report(onProgress, "prepare", 10, "Loading Word engine...");
  await loadDependencies('docx');

  Utils.report(onProgress, "model", 30, "Processing tables and math equations...");
  const processedHtml = await preProcessDocument(content);

  Utils.report(onProgress, "render", 60, "Applying Word formatting styles...");

  const finalHtmlString = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>${Utils.cleanTitle(title)}</title>
      <style>${DOCX_STYLES}</style>
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
// PUBLIC API (UNCHANGED)
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