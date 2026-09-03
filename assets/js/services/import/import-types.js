/** Shared contracts for document importers. */
export const IMPORT_TYPES = Object.freeze({ PDF: "pdf", DOCX: "docx" });

export function createImportResult({ type, title, html, metadata = {} }) {
  return { type, title, html, metadata };
}
