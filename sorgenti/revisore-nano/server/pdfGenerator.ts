import PDFDocument from "pdfkit";

/**
 * Genera un PDF strutturato dai dati del fascicolo usando pdfkit.
 * Non richiede Chromium o browser — funziona in qualsiasi ambiente di produzione.
 */
export async function generatePdfFromData(data: {
  cliente: any;
  incarico: any;
  documenti: any[];
  accettazione: any;
  comprensione: any;
  rischio: any;
  materialita: any;
  piano: any;
  dataGenerazione: string;
  schede?: any;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const { cliente, incarico, accettazione, comprensione, rischio, materialita, piano, dataGenerazione } = data;

    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 40, bottom: 40, left: 50, right: 50 },
      info: {
        Title: `Fascicolo Revisione — ${cliente?.ragioneSociale || ""} ${incarico?.annoEsercizio || ""}`,
        Author: "RevisoreNano — ISA Italia",
        Creator: "RevisoreNano",
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const BLU = "#1e3a5f";
    const BLU_CHIARO = "#2563eb";
    const GRIGIO = "#6b7280";
    const VERDE = "#16a34a";
    const ROSSO = "#dc2626";
    const ARANCIO = "#d97706";
    const PAGE_W = doc.page.width - 100;

    function fmt(val: unknown): string {
      if (val === null || val === undefined) return "—";
      const n = Number(val);
      if (isNaN(n)) return String(val);
      return n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " \u20ac";
    }

    function semaforoRischio(livello: number | null | undefined): string {
      if (!livello) return "—";
      if (livello === 1) return "Basso";
      if (livello === 2) return "Medio";
      if (livello === 3) return "Alto";
      return String(livello);
    }

    function semaforoColore(livello: number | null | undefined): string {
      if (!livello) return GRIGIO;
      if (livello === 1) return VERDE;
      if (livello === 2) return ARANCIO;
      return ROSSO;
    }

    function addPageHeader() {
      doc.rect(0, 0, doc.page.width, 8).fill(BLU);
      doc.fontSize(7).fillColor(GRIGIO)
        .text(`RevisoreNano — ISA Italia  |  ${cliente?.ragioneSociale || ""}  |  Fascicolo ${incarico?.annoEsercizio || ""}`, 50, 15, { align: "left", width: PAGE_W / 2 });
      doc.text(dataGenerazione, 50 + PAGE_W / 2, 15, { align: "right", width: PAGE_W / 2 });
      doc.moveTo(50, 28).lineTo(50 + PAGE_W, 28).strokeColor("#e5e7eb").lineWidth(0.5).stroke();
      doc.y = 38;
    }

    function sectionTitle(title: string, subtitle?: string) {
      if (doc.y > doc.page.height - 120) doc.addPage();
      doc.moveDown(0.5);
      const y = doc.y;
      doc.rect(50, y, PAGE_W, 22).fill(BLU).stroke();
      doc.fontSize(11).fillColor("white").font("Helvetica-Bold")
        .text(title, 58, y + 5, { width: PAGE_W - 16 });
      doc.y = y + 28;
      if (subtitle) {
        doc.fontSize(8).fillColor(GRIGIO).font("Helvetica")
          .text(subtitle, 50, doc.y, { width: PAGE_W });
        doc.moveDown(0.3);
      }
    }

    function row(label: string, value: string, color?: string) {
      if (doc.y > doc.page.height - 60) { doc.addPage(); addPageHeader(); }
      const y = doc.y;
      doc.fontSize(9).fillColor(GRIGIO).font("Helvetica").text(label, 50, y, { width: PAGE_W * 0.45 });
      doc.fontSize(9).fillColor(color || "#1a1a2e").font("Helvetica-Bold")
        .text(value, 50 + PAGE_W * 0.45, y, { width: PAGE_W * 0.55 });
      doc.moveDown(0.35);
    }

    function checkRow(label: string, val: boolean | null | undefined) {
      if (doc.y > doc.page.height - 60) { doc.addPage(); addPageHeader(); }
      const y = doc.y;
      const mark = val ? "\u2713" : "\u2717";
      const col = val ? VERDE : ROSSO;
      doc.fontSize(9).fillColor(GRIGIO).font("Helvetica").text(label, 58, y, { width: PAGE_W * 0.8 });
      doc.fontSize(9).fillColor(col).font("Helvetica-Bold")
        .text(mark, 58 + PAGE_W * 0.8, y, { width: 20, align: "center" });
      doc.moveDown(0.35);
    }

    function separator() {
      doc.moveDown(0.2);
      doc.moveTo(50, doc.y).lineTo(50 + PAGE_W, doc.y).strokeColor("#e5e7eb").lineWidth(0.5).stroke();
      doc.moveDown(0.3);
    }

    // ─── COPERTINA ──────────────────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, doc.page.height).fill(BLU);
    doc.rect(0, doc.page.height - 80, doc.page.width, 80).fill("#0f2240");
    doc.fontSize(9).fillColor("rgba(255,255,255,0.5)").font("Helvetica")
      .text("FASCICOLO DI REVISIONE LEGALE", 0, 120, { align: "center", width: doc.page.width });
    doc.fontSize(26).fillColor("white").font("Helvetica-Bold")
      .text(cliente?.ragioneSociale || "Cliente", 50, 150, { align: "center", width: PAGE_W });
    doc.moveDown(0.4);
    doc.fontSize(16).fillColor("#93c5fd").font("Helvetica")
      .text(`Esercizio ${incarico?.annoEsercizio || "—"}`, { align: "center", width: doc.page.width });
    doc.moveDown(2);
    doc.fontSize(10).fillColor("rgba(255,255,255,0.7)").font("Helvetica");
    [
      `P.IVA / C.F.: ${cliente?.partitaIva || cliente?.codiceFiscale || "—"}`,
      `Forma giuridica: ${cliente?.formaGiuridica || "—"}`,
      `Settore: ${cliente?.settore || "—"}`,
    ].forEach(line => { doc.text(line, { align: "center", width: doc.page.width }); doc.moveDown(0.3); });
    doc.fontSize(8).fillColor("rgba(255,255,255,0.4)")
      .text(`Generato il ${dataGenerazione}  |  ISA Italia  |  Riservato e confidenziale`,
        0, doc.page.height - 55, { align: "center", width: doc.page.width });

    // ─── PAGINA 2: RIEPILOGO ────────────────────────────────────────────────
    doc.addPage();
    addPageHeader();
    sectionTitle("Riepilogo Incarico");
    doc.moveDown(0.5);
    row("Ragione sociale", cliente?.ragioneSociale || "—");
    row("P.IVA / C.F.", cliente?.partitaIva || cliente?.codiceFiscale || "—");
    row("Forma giuridica", cliente?.formaGiuridica || "—");
    row("Settore", cliente?.settore || "—");
    separator();
    row("Anno esercizio", String(incarico?.annoEsercizio || "—"));
    row("Stato incarico", incarico?.stato || "—");
    row("Data apertura", incarico?.createdAt ? new Date(incarico.createdAt).toLocaleDateString("it-IT") : "—");

    // ─── MODULO 1: ACCETTAZIONE ─────────────────────────────────────────────
    sectionTitle("Modulo 1 — Accettazione Incarico", "ISA Italia 210/220");
    doc.moveDown(0.5);
    if (accettazione) {
      row("Esito accettazione",
        accettazione.esitoAccettazione === "accettato" ? "Accettato" :
        accettazione.esitoAccettazione === "rifiutato" ? "Rifiutato" : "In valutazione",
        accettazione.esitoAccettazione === "accettato" ? VERDE :
        accettazione.esitoAccettazione === "rifiutato" ? ROSSO : ARANCIO);
      separator();
      doc.fontSize(9).fillColor(GRIGIO).font("Helvetica").text("Checklist:", 50, doc.y);
      doc.moveDown(0.4);
      const checks = (accettazione.checklist as Record<string, boolean>) || {};
      const checkLabels: Record<string, string> = {
        indipendenza: "Indipendenza verificata",
        competenza: "Competenza professionale adeguata",
        etica: "Principi etici rispettati",
        conflittiInteresse: "Nessun conflitto di interesse",
        continuazione: "Continuazione incarico valutata",
      };
      Object.entries(checkLabels).forEach(([key, label]) => checkRow(label, checks[key]));
      if (accettazione.noteAccettazione) {
        doc.moveDown(0.3);
        doc.fontSize(8).fillColor(GRIGIO).font("Helvetica-Oblique")
          .text(`Note: ${accettazione.noteAccettazione}`, 58, doc.y, { width: PAGE_W - 16 });
        doc.moveDown(0.3);
      }
    } else {
      doc.fontSize(9).fillColor(GRIGIO).font("Helvetica-Oblique").text("Modulo non ancora compilato.", 58, doc.y);
      doc.moveDown(0.5);
    }

    // ─── MODULO 2: COMPRENSIONE ─────────────────────────────────────────────
    sectionTitle("Modulo 2 — Comprensione dell'Impresa", "ISA Italia 315");
    doc.moveDown(0.5);
    if (comprensione) {
      const dati = (comprensione.datiEstrattiImpresa as Record<string, any>) || {};
      row("Ricavi netti", fmt(dati.ricavi || dati.ricaviNetti));
      row("Totale attivo", fmt(dati.totaleAttivo));
      row("Patrimonio netto", fmt(dati.patrimonioNetto));
      row("Utile / Perdita", fmt(dati.utileNetto || dati.risultatoEsercizio));
      row("Dipendenti", String(dati.numeroDipendenti || "—"));
      separator();
      row("Nano impresa (art. 2435-ter)", comprensione.isNanoImpresa ? "Si" : "No",
        comprensione.isNanoImpresa ? VERDE : ARANCIO);
      if (comprensione.sintesiAi) {
        doc.moveDown(0.3);
        doc.fontSize(8).fillColor(GRIGIO).font("Helvetica").text("Sintesi AI:", 50, doc.y);
        doc.moveDown(0.2);
        const sintesi = String(comprensione.sintesiAi);
        doc.fontSize(8).fillColor("#374151").font("Helvetica-Oblique")
          .text(sintesi.substring(0, 600) + (sintesi.length > 600 ? "…" : ""), 58, doc.y, { width: PAGE_W - 16 });
        doc.moveDown(0.5);
      }
    } else {
      doc.fontSize(9).fillColor(GRIGIO).font("Helvetica-Oblique").text("Modulo non ancora compilato.", 58, doc.y);
      doc.moveDown(0.5);
    }

    // ─── MODULO 3: RISCHIO ──────────────────────────────────────────────────
    sectionTitle("Modulo 3 — Valutazione del Rischio", "ISA Italia 315/330");
    doc.moveDown(0.5);
    if (rischio) {
      row("Rischio inerente", semaforoRischio(rischio.livelloRischioInerente), semaforoColore(rischio.livelloRischioInerente));
      row("Rischio di controllo", semaforoRischio(rischio.livelloRischioControllo), semaforoColore(rischio.livelloRischioControllo));
      row("Rischio di individuazione", semaforoRischio(rischio.livelloRischioIndividuazione), semaforoColore(rischio.livelloRischioIndividuazione));
      row("RMM complessivo", semaforoRischio(rischio.livelloRmmComplessivo), semaforoColore(rischio.livelloRmmComplessivo));
      separator();
      const aree = (rischio.areeRischio as any[]) || [];
      if (aree.length > 0) {
        doc.fontSize(9).fillColor(GRIGIO).font("Helvetica").text("Aree di rischio:", 50, doc.y);
        doc.moveDown(0.3);
        aree.forEach((a: any) => {
          if (doc.y > doc.page.height - 60) { doc.addPage(); addPageHeader(); }
          const col = a.livello === "alto" ? ROSSO : a.livello === "medio" ? ARANCIO : VERDE;
          doc.fontSize(8).fillColor(col).font("Helvetica-Bold")
            .text(`[${(a.livello || "—").toUpperCase()}] `, 58, doc.y, { continued: true, width: 60 });
          doc.fillColor("#374151").font("Helvetica")
            .text(`${a.area || "—"} — ${a.motivazione || ""}`, { width: PAGE_W - 70 });
          doc.moveDown(0.25);
        });
      }
    } else {
      doc.fontSize(9).fillColor(GRIGIO).font("Helvetica-Oblique").text("Modulo non ancora compilato.", 58, doc.y);
      doc.moveDown(0.5);
    }

    // ─── MODULO 4: MATERIALITA ──────────────────────────────────────────────
    sectionTitle("Modulo 4 — Materialita", "ISA Italia 320");
    doc.moveDown(0.5);
    if (materialita) {
      row("Benchmark selezionato", materialita.benchmarkSelezionato || "—");
      row("Valore benchmark", fmt(materialita.valoreBenchmark));
      row("Percentuale applicata", materialita.percentualeApplicata ? `${materialita.percentualeApplicata}%` : "—");
      separator();
      row("Overall Materiality (OM)", fmt(materialita.overallMateriality), BLU_CHIARO);
      row("Performance Materiality (PM)", fmt(materialita.performanceMateriality), BLU_CHIARO);
      row("Clearly Trivial Threshold (CTT)", fmt(materialita.clearlyTrivialThreshold), GRIGIO);
      if (materialita.motivazione) {
        doc.moveDown(0.3);
        doc.fontSize(8).fillColor(GRIGIO).font("Helvetica-Oblique")
          .text(`Motivazione: ${materialita.motivazione}`, 58, doc.y, { width: PAGE_W - 16 });
        doc.moveDown(0.3);
      }
    } else {
      doc.fontSize(9).fillColor(GRIGIO).font("Helvetica-Oblique").text("Modulo non ancora compilato.", 58, doc.y);
      doc.moveDown(0.5);
    }

    // ─── MODULO 5: PIANO ────────────────────────────────────────────────────
    sectionTitle("Modulo 5 — Piano di Revisione", "ISA Italia 300");
    doc.moveDown(0.5);
    if (piano) {
      const procedure = (piano.procedurePianificate as any[]) || [];
      if (procedure.length > 0) {
        procedure.forEach((p: any) => {
          if (doc.y > doc.page.height - 80) { doc.addPage(); addPageHeader(); }
          const col = p.priorita === "alta" ? ROSSO : p.priorita === "media" ? ARANCIO : VERDE;
          doc.fontSize(9).fillColor(col).font("Helvetica-Bold")
            .text(p.area || "—", 58, doc.y, { width: PAGE_W - 16 });
          doc.moveDown(0.2);
          const procs = Array.isArray(p.procedure) ? p.procedure : [];
          procs.forEach((proc: string) => {
            if (doc.y > doc.page.height - 50) { doc.addPage(); addPageHeader(); }
            doc.fontSize(8).fillColor("#374151").font("Helvetica")
              .text(`• ${proc}`, 66, doc.y, { width: PAGE_W - 30 });
            doc.moveDown(0.2);
          });
          doc.moveDown(0.2);
        });
      } else {
        doc.fontSize(9).fillColor(GRIGIO).font("Helvetica-Oblique").text("Piano non ancora generato.", 58, doc.y);
        doc.moveDown(0.5);
      }
    } else {
      doc.fontSize(9).fillColor(GRIGIO).font("Helvetica-Oblique").text("Modulo non ancora compilato.", 58, doc.y);
      doc.moveDown(0.5);
    }

    // ─── FOOTER ─────────────────────────────────────────────────────────────
    doc.moveDown(1);
    separator();
    doc.fontSize(8).fillColor(GRIGIO).font("Helvetica")
      .text("RevisoreNano — Piattaforma di Revisione Legale ISA Italia", 50, doc.y, { align: "center", width: PAGE_W });
    doc.moveDown(0.2);
    doc.text(`Fascicolo generato il ${dataGenerazione}  |  Riservato e confidenziale`, { align: "center", width: PAGE_W });

    doc.end();
  });
}

/**
 * @deprecated Usa generatePdfFromData invece.
 * Mantenuta per compatibilità ma lancia un errore chiaro.
 */
export async function generatePdfFromHtml(_html: string): Promise<Buffer> {
  throw new Error("generatePdfFromHtml e' deprecata: Chromium non disponibile in produzione. Usa generatePdfFromData.");
}
