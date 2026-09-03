import { createImportResult } from "../import-types.js";
import { stripExtension } from "../import-utils.js";

/** DOCX -> semantic HTML importer using Mammoth's browser build. */
export class DOCXImporter {
  canHandle(file) {
    return file?.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      || /\.docx$/i.test(file?.name || "");
  }

  async import(file, options = {}) {
    if (!window.mammoth?.convertToHtml) {
      throw new Error("DOCX support could not be loaded. Please reload the app and try again.");
    }
    if (options.signal?.aborted) throw new DOMException("Import cancelled", "AbortError");

    options.onProgress?.({ phase: "extract", value: 15, label: "Reading DOCX…" });
    const arrayBuffer = await file.arrayBuffer();
    if (options.signal?.aborted) throw new DOMException("Import cancelled", "AbortError");

    options.onProgress?.({ phase: "convert", value: 45, label: "Converting Word structure…" });
    const result = await window.mammoth.convertToHtml(
      { arrayBuffer },
      {
        ignoreEmptyParagraphs: false,
        styleMap: [
          "p[style-name='Title'] => h1:fresh",
          "p[style-name='Subtitle'] => h2:fresh",
          "p[style-name='Heading 1'] => h1:fresh",
          "p[style-name='Heading 2'] => h2:fresh",
          "p[style-name='Heading 3'] => h3:fresh",
          "p[style-name='Heading 4'] => h4:fresh",
          "p[style-name='Heading 5'] => h5:fresh",
          "p[style-name='Heading 6'] => h6:fresh"
        ]
      }
    );
    if (options.signal?.aborted) throw new DOMException("Import cancelled", "AbortError");

    options.onProgress?.({ phase: "clean", value: 80, label: "Preparing source content…" });
    const rawHtml = result?.value || "";
    const hadImages = /<img\b/i.test(rawHtml);
    const html = sanitizeDocxHtml(rawHtml);
    const warnings = (result?.messages || [])
      .filter(message => message?.type === "warning" || message?.type === "error")
      .map(message => message.message)
      .filter(Boolean);
    if (hadImages) warnings.push("Embedded DOCX images were omitted because the current source editor does not store image nodes.");

    options.onProgress?.({ phase: "done", value: 100, label: "DOCX ready" });

    return createImportResult({
      type: "docx",
      title: stripExtension(file.name),
      html: html || "<p></p>",
      metadata: {
        warnings,
        messageCount: result?.messages?.length || 0,
        enhanced: false
      }
    });
  }
}

function sanitizeDocxHtml(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return "";

  // Tiptap does not currently expose an image node. Do not persist embedded
  // DOCX images/data URIs into the workspace.
  root.querySelectorAll("script, style, iframe, object, embed, img, svg, video, audio, form, input, textarea, select, button")
    .forEach(node => node.remove());

  const allowed = new Set([
    "P", "H1", "H2", "H3", "H4", "H5", "H6", "STRONG", "B", "EM", "I", "U", "S",
    "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "CODE", "BR", "HR", "A",
    "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TH", "TD"
  ]);
  const allowedAttrs = new Set(["href", "target", "rel", "colspan", "rowspan"]);

  root.querySelectorAll("*").forEach(el => {
    if (!allowed.has(el.tagName)) {
      el.replaceWith(...Array.from(el.childNodes));
      return;
    }
    Array.from(el.attributes).forEach(attr => {
      const name = attr.name.toLowerCase();
      if (!allowedAttrs.has(name) || name.startsWith("on")) el.removeAttribute(attr.name);
    });
    if (el.tagName === "A") {
      const href = el.getAttribute("href") || "";
      if (!/^https?:\/\//i.test(href) && !/^mailto:/i.test(href) && !/^#/.test(href)) {
        el.removeAttribute("href");
      } else {
        el.setAttribute("rel", "noopener noreferrer");
        el.setAttribute("target", "_blank");
      }
    }
  });

  return root.innerHTML.trim();
}
