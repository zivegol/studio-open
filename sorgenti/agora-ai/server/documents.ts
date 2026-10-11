import * as XLSX from "xlsx";

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENTS_PER_SESSION = 5;
export const MAX_DOCUMENT_EXCERPT_CHARS = 6_000;
export const MAX_DOCUMENT_CONTEXT_CHARS = 12_000;

const canonicalMimeByExtension: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export type SupportedDocument = {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
};

function extensionFor(fileName: string) {
  return fileName.trim().toLowerCase().split(".").pop() ?? "";
}

export function validateDocument(input: { fileName: string; mimeType: string; buffer: Buffer }): SupportedDocument {
  const fileName = input.fileName.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 180);
  const extension = extensionFor(fileName);
  const canonicalMime = canonicalMimeByExtension[extension];
  if (!fileName || !canonicalMime) throw new Error("Formato non supportato. Sono ammessi PDF, DOCX, TXT e XLSX.");
  if (!input.buffer.length || input.buffer.length > MAX_DOCUMENT_BYTES) throw new Error("Ogni allegato deve avere una dimensione compresa tra 1 byte e 10 MB.");
  if (extension === "pdf" && !input.buffer.subarray(0, 5).toString("utf8").startsWith("%PDF-")) throw new Error("Il file dichiarato come PDF non contiene una firma PDF valida.");
  return { fileName, mimeType: canonicalMime, buffer: input.buffer };
}

function compactText(value: string) {
  return value.replace(/\u0000/g, "").replace(/\s{3,}/g, "\n\n").trim();
}

export async function extractDocumentText(document: SupportedDocument) {
  let text = "";
  if (document.mimeType === "text/plain") {
    text = document.buffer.toString("utf8");
  } else if (document.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: document.buffer });
    text = result.value;
  } else if (document.mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    const workbook = XLSX.read(document.buffer, { type: "buffer", cellText: true, cellFormula: false });
    text = workbook.SheetNames.map(name => `Foglio: ${name}\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name])}`).join("\n\n");
  } else {
    const module = await import("pdf-parse") as unknown as { PDFParse: new (input: { data: Buffer }) => { getText: () => Promise<{ text: string }>; destroy?: () => Promise<void> } };
    const parser = new module.PDFParse({ data: document.buffer });
    try {
      text = (await parser.getText()).text;
    } finally {
      await parser.destroy?.();
    }
  }
  const cleaned = compactText(text);
  if (!cleaned) throw new Error("Non è stato possibile estrarre testo leggibile dal documento.");
  return cleaned.slice(0, MAX_DOCUMENT_EXCERPT_CHARS);
}

export function documentContext(attachments: Array<{ fileName: string; textExcerpt: string }>) {
  let remaining = MAX_DOCUMENT_CONTEXT_CHARS;
  const sections: string[] = [];
  for (const attachment of attachments) {
    if (remaining <= 0) break;
    const excerpt = attachment.textExcerpt.slice(0, remaining);
    remaining -= excerpt.length;
    sections.push(`Documento allegato: ${attachment.fileName}\n${excerpt}`);
  }
  return sections.length ? `\n\n--- Contesto documentale selezionato ---\n${sections.join("\n\n")}\n--- Fine contesto documentale ---` : "";
}
