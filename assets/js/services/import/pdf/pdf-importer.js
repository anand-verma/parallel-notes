import { createImportResult } from "../import-types.js";
import { stripExtension } from "../import-utils.js";
import { extractPdf } from "./pdf-extractor.js";
import { buildHtml, buildHtmlWithAI } from "./pdf-structure.js";
import { repairStructureWithAI } from "./pdf-ai-repair.js";

export class PDFImporter {
  canHandle(file) {
    return file?.type === "application/pdf" || /\.pdf$/i.test(file?.name || "");
  }

  async import(file, options = {}) {
    const extraction = await extractPdf(file, options);
    let finalExtraction = extraction;
    const warnings = [];
    if (options.mode === "enhanced") {
      try {
        finalExtraction = await repairStructureWithAI({ extraction, ai: options.ai, modelId: options.modelId, signal: options.signal, onProgress: options.onProgress });
        // v0.5.0 keeps the deterministic text as the source of truth. The validated AI map is advisory
        // for future structure improvements; if it cannot be applied safely, standard HTML is retained.
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        warnings.push(error.message || "AI structure assistance was unavailable; deterministic extraction was used.");
      }
    }
    const html = finalExtraction.aiStructure ? buildHtmlWithAI(finalExtraction) : buildHtml(finalExtraction);
    return createImportResult({
      type: "pdf",
      title: stripExtension(file.name),
      html,
      metadata: { pageCount: extraction.pageCount, extractedPages: extraction.pages.length, warnings, enhanced: !!finalExtraction.aiStructure }
    });
  }
}
