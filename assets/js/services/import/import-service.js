/** Generic document import facade. New input formats should register an importer here. */
import { PDFImporter } from "./pdf/pdf-importer.js";
import { DOCXImporter } from "./docx/docx-importer.js";

const importers = [new PDFImporter(), new DOCXImporter()];

export class ImportService {
  static getImporter(file) {
    return importers.find(importer => importer.canHandle(file));
  }

  static async import(file, options = {}) {
    if (!file) throw new Error("No file was selected.");
    const importer = this.getImporter(file);
    if (!importer) throw new Error("This file type is not supported yet. Supported formats: PDF and DOCX.");
    return importer.import(file, options);
  }
}
