import { describe, expect, it } from "vitest";
import { documentContext, MAX_DOCUMENT_CONTEXT_CHARS, validateDocument } from "./documents";

describe("documenti allegati", () => {
  it("accetta un file di testo e normalizza il tipo MIME dall’estensione", () => {
    const document = validateDocument({ fileName: "appunti.txt", mimeType: "application/octet-stream", buffer: Buffer.from("Contenuto riservato") });
    expect(document.mimeType).toBe("text/plain");
    expect(document.fileName).toBe("appunti.txt");
  });

  it("rifiuta formati non ammessi e PDF senza firma valida", () => {
    expect(() => validateDocument({ fileName: "script.exe", mimeType: "application/octet-stream", buffer: Buffer.from("x") })).toThrow("Formato non supportato");
    expect(() => validateDocument({ fileName: "falso.pdf", mimeType: "application/pdf", buffer: Buffer.from("non è un PDF") })).toThrow("firma PDF valida");
  });

  it("compatta il contesto di più documenti entro il limite condiviso", () => {
    const context = documentContext([{ fileName: "uno.txt", textExcerpt: "A".repeat(MAX_DOCUMENT_CONTEXT_CHARS) }, { fileName: "due.txt", textExcerpt: "B".repeat(100) }]);
    expect(context).toContain("Documento allegato: uno.txt");
    expect(context).not.toContain("Documento allegato: due.txt");
    expect(context.length).toBeLessThan(MAX_DOCUMENT_CONTEXT_CHARS + 200);
  });
});
