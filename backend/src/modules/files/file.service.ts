import type { Request, Response } from "express";
import mammoth from "mammoth";
// pdf-parse@1.x no trae types propios ni export ESM default limpio -- se
// importa con require via createRequire para evitar el warning de
// "esModuleInterop" con este paquete puntual.
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse") as (buffer: Buffer) => Promise<{ text: string }>;

const SUPPORTED_EXTENSIONS = ["txt", "docx", "pdf"] as const;

function getExtension(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

export async function extractText(req: Request, res: Response) {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "file is required" });
    }

    const extension = getExtension(file.originalname);
    if (!SUPPORTED_EXTENSIONS.includes(extension as (typeof SUPPORTED_EXTENSIONS)[number])) {
      return res.status(400).json({
        error: `Formato no soportado (.${extension || "?"}). Usa .txt, .docx o .pdf.`,
      });
    }

    let text: string;
    if (extension === "txt") {
      text = file.buffer.toString("utf-8");
    } else if (extension === "docx") {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      text = result.value;
    } else {
      const result = await pdfParse(file.buffer);
      text = result.text;
    }

    return res.status(200).json({ text: text.trim() });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "No se pudo extraer el texto del archivo",
    });
  }
}
