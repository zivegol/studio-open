import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb, getIncaricoById } from "../db";
import {
  circolarizzazioneSessioni,
  circolarizzazioneDestinatari,
  moduloRischio,
  moduloMaterialita,
  incarichi,
  clienti,
  verificaIncassiPartite,
  verificaIncassiSessioni,
} from "../../drizzle/schema";
import { invokeLLM } from "../_core/llm";
import { storagePut } from "../storage";
import { downloadNextcloudFile, listNextcloudFiles } from "../nextcloud";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  BorderStyle,
  Table,
  TableRow,
  TableCell,
  WidthType,
  HeadingLevel,
  ShadingType,
} from "docx";

// ─── HELPERS ──────────────────────────────────────────────────────────────────

/** Calcola la percentuale di copertura minima in base al livello di rischio (ISA Italia 505) */
function calcolaCoperturaMinimaPerRischio(livelloRischio: number | null): number {
  // Rischio basso (1): 50%, medio (2): 65%, alto (3): 80%
  if (!livelloRischio) return 65;
  if (livelloRischio === 1) return 50;
  if (livelloRischio === 2) return 65;
  return 80; // alto
}

interface Nominativo {
  codice?: string;
  ragioneSociale: string;
  saldo: number;
  isEstero?: boolean;
}

interface NominativoSelezionato extends Nominativo {
  motivazioneSelezione:
    | "saldo_elevato_pareto"
    | "supera_materialita"
    | "estero"
    | "anomalia_ai"
    | "campione_casuale"
    | "manuale_revisore";
  priorita: "alta" | "media" | "bassa";
  noteMotivazione: string;
}

const parseImportoItaliano = (value: string) => {
  const result = Number(value.replace(/\s/g, "").replace(/\./g, "").replace(",", ".").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(result) ? Math.abs(result) : null;
};

const normalizzaNome = (value: string) => value
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/\.(pdf)$/i, "")
  .replace(/\beuro\b.*$/i, "").replace(/\bestratto\s+conto\b/gi, "")
  .replace(/\b(s\.?r\.?l\.?|s\.?p\.?a\.?|societa|di|ditta)\b/gi, " ")
  .replace(/[^a-z0-9]+/g, " ").trim();

function punteggioNome(fileName: string, ragioneSociale: string) {
  const a = new Set(normalizzaNome(fileName).split(" ").filter(token => token.length > 2));
  const b = new Set(normalizzaNome(ragioneSociale).split(" ").filter(token => token.length > 2));
  if (!a.size || !b.size) return 0;
  const comuni = [...a].filter(token => b.has(token)).length;
  return comuni / Math.min(a.size, b.size);
}

function estraiTestoRispostaPdf(buffer: Buffer) {
  let nativeText = "";
  try {
    nativeText = execFileSync("pdftotext", ["-layout", "-", "-"], { input: buffer, maxBuffer: 40 * 1024 * 1024 }).toString("utf-8");
  } catch { /* OCR sotto */ }
  const folder = mkdtempSync(join(tmpdir(), "revisore-risposta-circ-"));
  let ocrText = "";
  try {
    const pdfPath = join(folder, "risposta.pdf");
    writeFileSync(pdfPath, buffer);
    execFileSync("pdftoppm", ["-jpeg", "-r", "180", "-f", "1", "-l", "6", pdfPath, join(folder, "pagina")], { maxBuffer: 10 * 1024 * 1024 });
    const images = readdirSync(folder).filter(name => /\.jpg$/i.test(name)).sort();
    for (const image of images) {
      try {
        ocrText += "\n" + execFileSync("tesseract", [join(folder, image), "stdout", "-l", "ita+eng"], { maxBuffer: 20 * 1024 * 1024 }).toString("utf-8");
      } catch { /* conserva l'eventuale testo nativo */ }
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
  return `${nativeText}\n${ocrText}`;
}

function analizzaRispostaPdf(nomeFile: string, text: string, saldoContabile: number) {
  const clean = text.replace(/\r/g, " ").replace(/[ \t]+/g, " ");
  const importi: number[] = [];
  const patterns = [
    /nostro saldo a (?:CREDITO|DEBITO) per euro\s*_*(?:€\s*)?([0-9][0-9.\s]*,[0-9]{1,2})/gi,
    /saldo al 31\s*\/\s*12\s*\/\s*2025[\s\S]{0,180}?euro\s+([0-9][0-9.\s]*,[0-9]{1,2})/gi,
    /Saldi al 31\s*\/\s*12\s*\/\s*2025[^\n]*?([0-9][0-9.\s]*,[0-9]{1,2})/gi,
  ];
  for (const pattern of patterns) {
    for (const match of clean.matchAll(pattern)) {
      const amount = parseImportoItaliano(match[1]);
      if (amount !== null && amount > 0) importi.push(amount);
    }
  }
  const importoNome = parseImportoItaliano(nomeFile.match(/euro\s+([0-9.]+,[0-9]{1,2})/i)?.[1] ?? "");
  const candidate = importi.sort((a, b) => Math.abs(a - saldoContabile) - Math.abs(b - saldoContabile))[0] ?? importoNome;
  const trovatoNelDocumento = candidate !== null && importi.some(value => Math.abs(value - candidate) < 0.01);
  const differenza = candidate === null ? null : candidate - Math.abs(saldoContabile);
  const dataMatch = clean.match(/(?:Data|Osoppo,)\s*_*(\d{1,2})[\s/.\-]*(?:SET\.?|settembre|0?9)[\s/.\-]*(20\d{2})/i);
  const dataRisposta = dataMatch ? `${dataMatch[2]}-09-${dataMatch[1].padStart(2, "0")}` : null;
  const dataErrataNelModello = /data su indicata\s*\(31\.12\.2024\)/i.test(clean);
  const haFirmaOTimbro = /responsabile amministrativo|timbro e firma[\s\S]{0,180}(s\.?p\.?a|s\.?r\.?l)|partita\s+i\.?v\.?a[\s\S]{0,80}$/i.test(clean);
  const haSupporto = /mastrino|scheda contabile|saldi operazioni del periodo|estratto conto/i.test(clean);
  const anomalie = [
    ...(candidate === null ? ["Saldo confermato non riconosciuto automaticamente"] : []),
    ...(!trovatoNelDocumento && importoNome !== null ? ["Importo proposto dal nome del file: verificare visivamente il valore manoscritto"] : []),
    ...(dataErrataNelModello ? ["Nel corpo del modello compare 31.12.2024, mentre oggetto e documentazione si riferiscono al 31.12.2025"] : []),
    ...(!haFirmaOTimbro ? ["Firma o timbro non riconosciuti con sufficiente affidabilità"] : []),
  ];
  return {
    saldoConfermato: candidate,
    differenza,
    conforme: differenza !== null && Math.abs(differenza) <= 0.01,
    dataRisposta,
    trovatoNelDocumento,
    haFirmaOTimbro,
    haSupporto,
    confidenza: candidate === null ? "bassa" : trovatoNelDocumento && haFirmaOTimbro ? "alta" : "media",
    anomalie,
  };
}

/**
 * Selezione campione circolarizzazione conforme ISA Italia 505.
 * Applica in sequenza: Pareto 80%, soglia materialità, esteri, campione casuale.
 */
function selezionaCampione(
  lista: Nominativo[],
  performanceMateriality: number | null,
  coperturaMinimaPerc: number
): NominativoSelezionato[] {
  const totale = lista.reduce((s, n) => s + Math.abs(n.saldo), 0);
  const sogliaCopertura = (totale * coperturaMinimaPerc) / 100;
  const pm = performanceMateriality ?? 0;

  // Ordina per saldo decrescente
  const ordinati = [...lista].sort((a, b) => Math.abs(b.saldo) - Math.abs(a.saldo));

  const selezionati: NominativoSelezionato[] = [];
  let coperturaCumulata = 0;

  for (const n of ordinati) {
    const saldoAbs = Math.abs(n.saldo);
    const giaSelezionato = selezionati.some((s) => s.ragioneSociale === n.ragioneSociale);
    if (giaSelezionato) continue;

    let motivazione: NominativoSelezionato["motivazioneSelezione"] | null = null;
    let priorita: NominativoSelezionato["priorita"] = "media";
    let nota = "";

    // 1. Pareto: top che coprono l'80% del totale
    if (coperturaCumulata < totale * 0.8) {
      motivazione = "saldo_elevato_pareto";
      priorita = "alta";
      nota = `Incluso per copertura Pareto 80% (saldo ${saldoAbs.toLocaleString("it-IT", { style: "currency", currency: "EUR" })}, ${((saldoAbs / totale) * 100).toFixed(1)}% del totale)`;
    }
    // 2. Supera Performance Materiality
    else if (pm > 0 && saldoAbs >= pm) {
      motivazione = "supera_materialita";
      priorita = "alta";
      nota = `Saldo (${saldoAbs.toLocaleString("it-IT", { style: "currency", currency: "EUR" })}) supera la Performance Materiality (${pm.toLocaleString("it-IT", { style: "currency", currency: "EUR" })})`;
    }
    // 3. Estero
    else if (n.isEstero) {
      motivazione = "estero";
      priorita = "media";
      nota = "Incluso in quanto soggetto estero (rischio cambio e difficoltà di verifica alternativa)";
    }

    if (motivazione) {
      selezionati.push({ ...n, motivazioneSelezione: motivazione, priorita, noteMotivazione: nota });
      coperturaCumulata += saldoAbs;
    }
  }

  // 4. Campione casuale per raggiungere la copertura minima richiesta
  if (coperturaCumulata < sogliaCopertura) {
    const nonSelezionati = ordinati.filter(
      (n) => !selezionati.some((s) => s.ragioneSociale === n.ragioneSociale)
    );
    // Shuffle deterministico (basato sul nome per riproducibilità)
    const shuffled = nonSelezionati.sort((a, b) => a.ragioneSociale.localeCompare(b.ragioneSociale));
    for (const n of shuffled) {
      if (coperturaCumulata >= sogliaCopertura) break;
      selezionati.push({
        ...n,
        motivazioneSelezione: "campione_casuale",
        priorita: "bassa",
        noteMotivazione: `Selezionato a campione per raggiungere la copertura minima del ${coperturaMinimaPerc}%`,
      });
      coperturaCumulata += Math.abs(n.saldo);
    }
  }

  return selezionati;
}

// ─── GENERAZIONE LETTERA WORD ─────────────────────────────────────────────────

async function generaLetteraWord(params: {
  tipo: "cliente" | "fornitore";
  ragioneSociale: string;
  saldo: number;
  dataRiferimento: Date;
  emailRevisore: string;
  ragioneSocialeCliente: string; // nome della società revisionata
}): Promise<Buffer> {
  const { tipo, ragioneSociale, saldo, dataRiferimento, emailRevisore, ragioneSocialeCliente } = params;

  const dataFormatted = dataRiferimento.toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const saldoFormatted = Math.abs(saldo).toLocaleString("it-IT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const tipoSaldo = tipo === "cliente" ? "credito" : "debito";
  const intestazioneTipo = tipo === "cliente" ? "Spettabile Cliente" : "Spettabile Fornitore";

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          // Intestazione mittente (la società revisionata compila)
          new Paragraph({
            children: [
              new TextRun({
                text: ragioneSocialeCliente.toUpperCase(),
                bold: true,
                size: 28,
              }),
            ],
            alignment: AlignmentType.LEFT,
            spacing: { after: 100 },
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: "[Indirizzo — da completare]",
                italics: true,
                color: "888888",
                size: 20,
              }),
            ],
            spacing: { after: 400 },
          }),

          // Destinatario
          new Paragraph({
            children: [new TextRun({ text: intestazioneTipo, bold: true, size: 22 })],
            spacing: { after: 60 },
          }),
          new Paragraph({
            children: [new TextRun({ text: ragioneSociale, bold: true, size: 22 })],
            spacing: { after: 60 },
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: "[Indirizzo destinatario — da completare]",
                italics: true,
                color: "888888",
                size: 20,
              }),
            ],
            spacing: { after: 400 },
          }),

          // Luogo e data
          new Paragraph({
            children: [
              new TextRun({
                text: `[Luogo], ${new Date().toLocaleDateString("it-IT")}`,
                size: 20,
              }),
            ],
            alignment: AlignmentType.RIGHT,
            spacing: { after: 400 },
          }),

          // Oggetto
          new Paragraph({
            children: [
              new TextRun({
                text: `Oggetto: Conferma saldi al ${dataFormatted} — Richiesta del Revisore Legale`,
                bold: true,
                size: 22,
              }),
            ],
            spacing: { after: 400 },
          }),

          // Corpo lettera
          new Paragraph({
            children: [
              new TextRun({
                text: "Egregi Signori,",
                size: 22,
              }),
            ],
            spacing: { after: 200 },
          }),

          new Paragraph({
            children: [
              new TextRun({
                text: `La presente per informarVi che la società ${ragioneSocialeCliente} è assoggettata a revisione legale dei conti ai sensi del D.Lgs. 39/2010. Nell'ambito delle procedure di revisione, il Revisore Legale incaricato ha richiesto la conferma diretta dei saldi in essere alla data del ${dataFormatted}.`,
                size: 22,
              }),
            ],
            spacing: { after: 200 },
          }),

          new Paragraph({
            children: [
              new TextRun({
                text: `Secondo le risultanze contabili della nostra società, alla data del ${dataFormatted} risulta un saldo di ${tipoSaldo} nei Vostri confronti pari a:`,
                size: 22,
              }),
            ],
            spacing: { after: 200 },
          }),

          // Tabella saldo
          new Table({
            width: { size: 60, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: [new TextRun({ text: "Saldo al " + dataFormatted, bold: true, size: 22 })],
                        alignment: AlignmentType.CENTER,
                      }),
                    ],
                    shading: { type: ShadingType.CLEAR, fill: "E8F0FE" },
                  }),
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: [
                          new TextRun({
                            text: `€ ${saldoFormatted}`,
                            bold: true,
                            size: 26,
                          }),
                        ],
                        alignment: AlignmentType.CENTER,
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),

          new Paragraph({ children: [], spacing: { after: 300 } }),

          new Paragraph({
            children: [
              new TextRun({
                text: "Vi chiediamo cortesemente di confermare direttamente al Revisore Legale l'esattezza del saldo sopra indicato, oppure di comunicargli le eventuali differenze riscontrate, entro e non oltre ",
                size: 22,
              }),
              new TextRun({
                text: "30 giorni dal ricevimento della presente",
                bold: true,
                size: 22,
              }),
              new TextRun({
                text: ".",
                size: 22,
              }),
            ],
            spacing: { after: 200 },
          }),

          new Paragraph({
            children: [
              new TextRun({
                text: "La risposta dovrà essere inviata direttamente al Revisore Legale al seguente indirizzo e-mail:",
                size: 22,
              }),
            ],
            spacing: { after: 100 },
          }),

          new Paragraph({
            children: [
              new TextRun({
                text: emailRevisore,
                bold: true,
                size: 24,
                color: "1A56DB",
              }),
            ],
            spacing: { after: 300 },
          }),

          new Paragraph({
            children: [
              new TextRun({
                text: "In caso di mancata risposta entro il termine indicato, il Revisore Legale procederà all'applicazione di procedure alternative di revisione.",
                size: 20,
                italics: true,
                color: "666666",
              }),
            ],
            spacing: { after: 400 },
          }),

          new Paragraph({
            children: [new TextRun({ text: "Distinti saluti,", size: 22 })],
            spacing: { after: 400 },
          }),

          new Paragraph({
            children: [new TextRun({ text: ragioneSocialeCliente, bold: true, size: 22 })],
            spacing: { after: 60 },
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: "[Firma del Legale Rappresentante]",
                italics: true,
                color: "888888",
                size: 20,
              }),
            ],
            spacing: { after: 600 },
          }),

          // Sezione risposta (tagliando)
          new Paragraph({
            border: {
              top: { style: BorderStyle.DASHED, size: 6, color: "AAAAAA" },
            },
            children: [
              new TextRun({
                text: "─── SEZIONE DA RESTITUIRE AL REVISORE LEGALE ───────────────────────────────",
                color: "888888",
                size: 18,
              }),
            ],
            spacing: { before: 200, after: 200 },
          }),

          new Paragraph({
            children: [
              new TextRun({ text: "Conferma saldo al ", size: 20 }),
              new TextRun({ text: dataFormatted, bold: true, size: 20 }),
            ],
            spacing: { after: 200 },
          }),

          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: [new TextRun({ text: "Saldo indicato dalla società", bold: true, size: 20 })],
                      }),
                    ],
                    shading: { type: ShadingType.CLEAR, fill: "F3F4F6" },
                  }),
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: [new TextRun({ text: `€ ${saldoFormatted}`, bold: true, size: 20 })],
                      }),
                    ],
                  }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: [
                          new TextRun({
                            text: "☐  Il saldo è corretto",
                            size: 20,
                          }),
                        ],
                      }),
                    ],
                  }),
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: [
                          new TextRun({
                            text: "☐  Il saldo non è corretto. Saldo da noi risultante: € _______________",
                            size: 20,
                          }),
                        ],
                      }),
                    ],
                  }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: [
                          new TextRun({
                            text: "Note / Spiegazione differenze: _______________________________________________",
                            size: 20,
                          }),
                        ],
                      }),
                    ],
                    columnSpan: 2,
                  }),
                ],
              }),
            ],
          }),

          new Paragraph({ children: [], spacing: { after: 200 } }),

          new Paragraph({
            children: [
              new TextRun({ text: "Firma e timbro: ______________________________", size: 20 }),
              new TextRun({ text: "     Data: _______________", size: 20 }),
            ],
            spacing: { after: 100 },
          }),

          new Paragraph({
            children: [
              new TextRun({
                text: `Inviare a: ${emailRevisore}`,
                bold: true,
                size: 20,
                color: "1A56DB",
              }),
            ],
          }),
        ],
      },
    ],
  });

  return await Packer.toBuffer(doc);
}

// ─── ROUTER ───────────────────────────────────────────────────────────────────

export const circolarizzazioneRouter = router({
  /** Crea una nuova sessione di circolarizzazione e seleziona automaticamente il campione */
  creaSessione: protectedProcedure
    .input(
      z.object({
        incaricoId: z.number(),
        emailRevisore: z.string().email(),
        dataRiferimento: z.string(), // ISO date string
        tipoCircolarizzazione: z.enum(["clienti", "fornitori", "entrambi"]),
        listaClienti: z
          .array(
            z.object({
              codice: z.string().optional(),
              ragioneSociale: z.string(),
              saldo: z.number(),
              isEstero: z.boolean().optional(),
            })
          )
          .optional(),
        listaFornitori: z
          .array(
            z.object({
              codice: z.string().optional(),
              ragioneSociale: z.string(),
              saldo: z.number(),
              isEstero: z.boolean().optional(),
            })
          )
          .optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database non disponibile");

      // Recupera dati Modulo 3 (rischio) e Modulo 4 (materialità)
      const [rischioRows, materialitaRows, incaricoRows] = await Promise.all([
        db
          .select()
          .from(moduloRischio)
          .where(eq(moduloRischio.incaricoId, input.incaricoId))
          .limit(1),
        db
          .select()
          .from(moduloMaterialita)
          .where(eq(moduloMaterialita.incaricoId, input.incaricoId))
          .limit(1),
        db
          .select({ clienteId: incarichi.clienteId })
          .from(incarichi)
          .where(eq(incarichi.id, input.incaricoId))
          .limit(1),
      ]);

      const rischio = rischioRows[0];
      const materialita = materialitaRows[0];
      const incaricoData = incaricoRows[0];

      // Recupera ragione sociale del cliente revisionato
      let ragioneSocialeCliente = "Società";
      if (incaricoData) {
        const clienteRows = await db
          .select({ ragioneSociale: clienti.ragioneSociale })
          .from(clienti)
          .where(eq(clienti.id, incaricoData.clienteId))
          .limit(1);
        if (clienteRows[0]) ragioneSocialeCliente = clienteRows[0].ragioneSociale;
      }

      const livelloRischio = rischio?.rmmPunteggio ?? 2;
      const pm = materialita?.performanceMateriality
        ? parseFloat(materialita.performanceMateriality)
        : null;
      const coperturaMinimaPerc = calcolaCoperturaMinimaPerRischio(livelloRischio);

      const listaClienti = input.listaClienti ?? [];
      const listaFornitori = input.listaFornitori ?? [];

      const totaleClienti = listaClienti.reduce((s, n) => s + Math.abs(n.saldo), 0);
      const totaleFornitori = listaFornitori.reduce((s, n) => s + Math.abs(n.saldo), 0);

      // Selezione campione
      const campioneCl =
        input.tipoCircolarizzazione !== "fornitori"
          ? selezionaCampione(listaClienti, pm, coperturaMinimaPerc)
          : [];
      const campioneFo =
        input.tipoCircolarizzazione !== "clienti"
          ? selezionaCampione(listaFornitori, pm, coperturaMinimaPerc)
          : [];

      const coperturaCl =
        totaleClienti > 0
          ? (campioneCl.reduce((s, n) => s + Math.abs(n.saldo), 0) / totaleClienti) * 100
          : 0;
      const coperturFo =
        totaleFornitori > 0
          ? (campioneFo.reduce((s, n) => s + Math.abs(n.saldo), 0) / totaleFornitori) * 100
          : 0;

      // Analisi AI: motivazione della selezione
      const analisiAiResp = await invokeLLM({
        messages: [
          {
            role: "system" as const,
            content:
              "Sei un revisore legale esperto in ISA Italia 505. Fornisci una sintesi professionale della selezione del campione di circolarizzazione in 3-4 frasi, spiegando la logica applicata e il livello di copertura raggiunto.",
          },
          {
            role: "user" as const,
            content: `Sessione circolarizzazione per incarico ${input.incaricoId}.\nLivello rischio RMM: ${livelloRischio}/3. Performance Materiality: ${pm ? `€${pm.toLocaleString("it-IT")}` : "non definita"}.\nCopertura minima richiesta: ${coperturaMinimaPerc}%.\nClienti selezionati: ${campioneCl.length} su ${listaClienti.length} (copertura ${coperturaCl.toFixed(1)}%).\nFornitori selezionati: ${campioneFo.length} su ${listaFornitori.length} (copertura ${coperturFo.toFixed(1)}%).\nCriteri applicati: Pareto 80%, soglia materialità, esteri, campione casuale.`,
          },
        ],
      });

      const analisiTesto: string =
        (analisiAiResp?.choices?.[0]?.message?.content as string) ?? "Analisi non disponibile.";

      // Salva sessione
      const [sessioneResult] = await db.insert(circolarizzazioneSessioni).values({
        incaricoId: input.incaricoId,
        emailRevisore: input.emailRevisore,
        dataRiferimento: new Date(input.dataRiferimento),
        tipoCircolarizzazione: input.tipoCircolarizzazione,
        livelloRischioModulo3: livelloRischio,
        percentualeCoperturaMinimaCalcolata: coperturaMinimaPerc.toString(),
        totaleCreditiClienti: totaleClienti.toString(),
        totaleDebitiFornitori: totaleFornitori.toString(),
        coperturaCampioneCl: coperturaCl.toFixed(2),
        coperturaCampioneFo: coperturFo.toFixed(2),
        analisiAiSelezione: analisiTesto,
      });

      const sessioneId = (sessioneResult as any).insertId as number;

      // Salva destinatari
      const tuttiDestinatari = [
        ...campioneCl.map((n) => ({ ...n, tipo: "cliente" as const })),
        ...campioneFo.map((n) => ({ ...n, tipo: "fornitore" as const })),
      ];

      if (tuttiDestinatari.length > 0) {
        await db.insert(circolarizzazioneDestinatari).values(
          tuttiDestinatari.map((n) => ({
            sessioneId,
            incaricoId: input.incaricoId,
            codice: n.codice,
            ragioneSociale: n.ragioneSociale,
            tipo: n.tipo,
            saldo: n.saldo.toString(),
            isEstero: n.isEstero ?? false,
            motivazioneSelezione: n.motivazioneSelezione,
            priorita: n.priorita,
            noteMotivazione: n.noteMotivazione,
          }))
        );
      }

      return {
        sessioneId,
        campioneCl: campioneCl.length,
        campioneFo: campioneFo.length,
        coperturaCl: parseFloat(coperturaCl.toFixed(2)),
        coperturFo: parseFloat(coperturFo.toFixed(2)),
        coperturaMinimaRichiesta: coperturaMinimaPerc,
        analisiAi: analisiTesto,
        ragioneSocialeCliente,
      };
    }),

  /** Recupera una sessione con tutti i destinatari */
  getSessione: protectedProcedure
    .input(z.object({ sessioneId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database non disponibile");

      const [sessione] = await db
        .select()
        .from(circolarizzazioneSessioni)
        .where(eq(circolarizzazioneSessioni.id, input.sessioneId))
        .limit(1);

      if (!sessione) throw new Error("Sessione non trovata");

      const destinatari = await db
        .select()
        .from(circolarizzazioneDestinatari)
        .where(eq(circolarizzazioneDestinatari.sessioneId, input.sessioneId));

      return { sessione, destinatari };
    }),

  /** Lista sessioni per un incarico */
  listSessioni: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      return db
        .select()
        .from(circolarizzazioneSessioni)
        .where(eq(circolarizzazioneSessioni.incaricoId, input.incaricoId));
    }),

  /** Genera le lettere Word per tutti i destinatari inclusi di una sessione */
  generaLettere: protectedProcedure
    .input(z.object({ sessioneId: z.number(), ragioneSocialeCliente: z.string().optional() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database non disponibile");

      const [sessione] = await db
        .select()
        .from(circolarizzazioneSessioni)
        .where(eq(circolarizzazioneSessioni.id, input.sessioneId))
        .limit(1);

      if (!sessione) throw new Error("Sessione non trovata");

      // Recupera ragione sociale del cliente revisionato direttamente dal DB
      // (non dipende dal frontend, funziona anche riaprendo sessioni esistenti)
      let ragioneSocialeCliente = input.ragioneSocialeCliente || "Società";
      if (!input.ragioneSocialeCliente || input.ragioneSocialeCliente.trim() === "") {
        const [incaricoRow] = await db
          .select({ clienteId: incarichi.clienteId })
          .from(incarichi)
          .where(eq(incarichi.id, sessione.incaricoId))
          .limit(1);
        if (incaricoRow) {
          const [clienteRow] = await db
            .select({ ragioneSociale: clienti.ragioneSociale })
            .from(clienti)
            .where(eq(clienti.id, incaricoRow.clienteId))
            .limit(1);
          if (clienteRow) ragioneSocialeCliente = clienteRow.ragioneSociale;
        }
      }

      const destinatari = await db
        .select()
        .from(circolarizzazioneDestinatari)
        .where(
          and(
            eq(circolarizzazioneDestinatari.sessioneId, input.sessioneId),
            eq(circolarizzazioneDestinatari.incluso, true)
          )
        );

      const risultati: { id: number; ragioneSociale: string; url: string }[] = [];

      for (const dest of destinatari) {
        const buffer = await generaLetteraWord({
          tipo: dest.tipo,
          ragioneSociale: dest.ragioneSociale,
          saldo: parseFloat(dest.saldo),
          dataRiferimento: sessione.dataRiferimento,
          emailRevisore: sessione.emailRevisore,
          ragioneSocialeCliente,
        });

        const fileKey = `circolarizzazione/${input.sessioneId}/${dest.id}-${dest.ragioneSociale.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 30)}.docx`;
        const { url } = await storagePut(fileKey, buffer, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");

        await db
          .update(circolarizzazioneDestinatari)
          .set({ statoLettera: "generata", s3KeyLettera: fileKey, s3UrlLettera: url })
          .where(eq(circolarizzazioneDestinatari.id, dest.id));

        risultati.push({ id: dest.id, ragioneSociale: dest.ragioneSociale, url });
      }

      // Aggiorna stato sessione
      await db
        .update(circolarizzazioneSessioni)
        .set({ stato: "lettere_generate" })
        .where(eq(circolarizzazioneSessioni.id, input.sessioneId));

      return { generate: risultati.length, lettere: risultati };
    }),

  /** Aggiorna lo stato di inclusione di un destinatario (il revisore può escludere con motivazione) */
  aggiornaInclusione: protectedProcedure
    .input(
      z.object({
        destinatarioId: z.number(),
        incluso: z.boolean(),
        motivazioneEsclusione: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database non disponibile");

      await db
        .update(circolarizzazioneDestinatari)
        .set({
          incluso: input.incluso,
          motivazioneEsclusione: input.motivazioneEsclusione ?? null,
        })
        .where(eq(circolarizzazioneDestinatari.id, input.destinatarioId));

      return { success: true };
    }),

  /** Aggiunge manualmente un destinatario alla sessione */
  aggiungiManuale: protectedProcedure
    .input(
      z.object({
        sessioneId: z.number(),
        incaricoId: z.number(),
        codice: z.string().optional(),
        ragioneSociale: z.string(),
        tipo: z.enum(["cliente", "fornitore"]),
        saldo: z.number(),
        isEstero: z.boolean().optional(),
        noteMotivazione: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database non disponibile");

      await db.insert(circolarizzazioneDestinatari).values({
        sessioneId: input.sessioneId,
        incaricoId: input.incaricoId,
        codice: input.codice,
        ragioneSociale: input.ragioneSociale,
        tipo: input.tipo,
        saldo: input.saldo.toString(),
        isEstero: input.isEstero ?? false,
        motivazioneSelezione: "manuale_revisore",
        priorita: "media",
        noteMotivazione: input.noteMotivazione ?? "Aggiunto manualmente dal revisore",
      });

      return { success: true };
    }),

  /** Aggiorna il follow-up di un destinatario (risposta ricevuta, saldo confermato, ecc.) */
  aggiornaFollowUp: protectedProcedure
    .input(
      z.object({
        destinatarioId: z.number(),
        statoLettera: z.enum([
          "inviata",
          "risposta_ricevuta",
          "risposta_discordante",
          "nessuna_risposta",
          "procedura_alternativa",
        ]),
        dataInvio: z.string().optional(),
        dataRisposta: z.string().optional(),
        saldoConfermato: z.number().optional(),
        noteFollowUp: z.string().optional(),
        proceduraAlternativa: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database non disponibile");

      const [dest] = await db
        .select({ saldo: circolarizzazioneDestinatari.saldo })
        .from(circolarizzazioneDestinatari)
        .where(eq(circolarizzazioneDestinatari.id, input.destinatarioId))
        .limit(1);

      const differenza =
        input.saldoConfermato !== undefined && dest
          ? (input.saldoConfermato - parseFloat(dest.saldo)).toString()
          : null;

      await db
        .update(circolarizzazioneDestinatari)
        .set({
          statoLettera: input.statoLettera,
          dataInvio: input.dataInvio ? new Date(input.dataInvio) : undefined,
          dataRisposta: input.dataRisposta ? new Date(input.dataRisposta) : undefined,
          saldoConfermato: input.saldoConfermato?.toString(),
          differenza,
          noteFollowUp: input.noteFollowUp,
          proceduraAlternativa: input.proceduraAlternativa,
        })
        .where(eq(circolarizzazioneDestinatari.id, input.destinatarioId));

      // Aggiorna stato sessione a follow_up se almeno una lettera è inviata
      const [sessione] = await db
        .select({ sessioneId: circolarizzazioneDestinatari.sessioneId })
        .from(circolarizzazioneDestinatari)
        .where(eq(circolarizzazioneDestinatari.id, input.destinatarioId))
        .limit(1);

      if (sessione) {
        await db
          .update(circolarizzazioneSessioni)
          .set({ stato: "follow_up" })
          .where(
            and(
              eq(circolarizzazioneSessioni.id, sessione.sessioneId),
              eq(circolarizzazioneSessioni.stato, "lettere_generate")
            )
          );
      }

      return { success: true, differenza };
    }),

  caricaRisposta: protectedProcedure
    .input(z.object({
      destinatarioId: z.number(),
      nomeFile: z.string().min(1).max(255),
      mimeType: z.string().max(150).default("application/octet-stream"),
      fileBase64: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database non disponibile");
      const safeName = input.nomeFile.replace(/[^a-zA-Z0-9._-]/g, "_");
      const key = `circolarizzazione/risposte/${input.destinatarioId}/${Date.now()}-${safeName}`;
      const { url } = await storagePut(key, Buffer.from(input.fileBase64, "base64"), input.mimeType);
      await db.update(circolarizzazioneDestinatari).set({
        s3KeyRisposta: key,
        s3UrlRisposta: url,
        nomeFileRisposta: input.nomeFile,
        dataRisposta: new Date(),
        statoLettera: "risposta_ricevuta",
      }).where(eq(circolarizzazioneDestinatari.id, input.destinatarioId));
      return { ok: true, url, nomeFile: input.nomeFile };
    }),

  /** Cerca le risposte nel dossier, le associa ai destinatari e propone la quadratura del saldo. */
  acquisisciRisposteDalDossier: protectedProcedure
    .input(z.object({ sessioneId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database non disponibile");
      const [sessione] = await db.select().from(circolarizzazioneSessioni)
        .where(eq(circolarizzazioneSessioni.id, input.sessioneId)).limit(1);
      if (!sessione) throw new Error("Sessione non trovata");
      const incarico = await getIncaricoById(sessione.incaricoId);
      if (!incarico?.nextcloudFolder) throw new Error("Cartella dossier non collegata all'incarico");

      const allFiles = await listNextcloudFiles(incarico.nextcloudFolder);
      const files = allFiles.filter(file =>
        /\.pdf$/i.test(file.name) &&
        /(circolarizz|conferm|riscontro|clienti e fornitori)/i.test(file.path) &&
        file.path.includes(String(incarico.annoEsercizio))
      );
      if (!files.length) throw new Error("Nessuna risposta PDF trovata nella cartella circolarizzazioni del dossier");

      const destinatari = await db.select().from(circolarizzazioneDestinatari)
        .where(and(eq(circolarizzazioneDestinatari.sessioneId, input.sessioneId), eq(circolarizzazioneDestinatari.incluso, true)));
      const risultati: Array<Record<string, unknown>> = [];
      const usati = new Set<string>();

      for (const dest of destinatari) {
        const abbinati = files
          .map(file => ({ file, score: punteggioNome(file.name, dest.ragioneSociale) }))
          .filter(item => item.score >= 0.5)
          .sort((a, b) => b.score - a.score);
        if (!abbinati.length) continue;
        const bestScore = abbinati[0].score;
        const gruppo = abbinati.filter(item => item.score >= Math.max(0.5, bestScore - 0.15));
        const principale = gruppo.find(item => !/estratto\s+conto|mastrino|scheda\s+contabile/i.test(item.file.name)) ?? gruppo[0];
        const testi: string[] = [];
        for (const item of gruppo) {
          if (usati.has(item.file.path)) continue;
          const buffer = await downloadNextcloudFile(item.file.path);
          testi.push(estraiTestoRispostaPdf(buffer));
          usati.add(item.file.path);
        }
        if (!testi.length) continue;
        const analisi = analizzaRispostaPdf(principale.file.name, testi.join("\n"), Math.abs(parseFloat(dest.saldo)));
        const dataRisposta = analisi.dataRisposta ? new Date(`${analisi.dataRisposta}T12:00:00`) : new Date(principale.file.lastModified);
        const note = [
          `Analisi automatica dal dossier (${analisi.confidenza}) - da confermare dal revisore.`,
          analisi.haSupporto ? "Presente dettaglio contabile della controparte." : "",
          ...analisi.anomalie,
        ].filter(Boolean).join(" ");
        const statoLettera = analisi.saldoConfermato === null
          ? "risposta_ricevuta"
          : analisi.conforme ? "risposta_ricevuta" : "risposta_discordante";
        await db.update(circolarizzazioneDestinatari).set({
          statoLettera,
          dataRisposta,
          saldoConfermato: analisi.saldoConfermato?.toFixed(2),
          differenza: analisi.differenza?.toFixed(2),
          noteFollowUp: note,
          s3KeyRisposta: principale.file.path,
          nomeFileRisposta: gruppo.map(item => item.file.name).join("; ").slice(0, 255),
        }).where(eq(circolarizzazioneDestinatari.id, dest.id));
        risultati.push({
          destinatarioId: dest.id,
          ragioneSociale: dest.ragioneSociale,
          tipo: dest.tipo,
          saldoContabile: Math.abs(parseFloat(dest.saldo)),
          file: principale.file.name,
          allegati: gruppo.length,
          ...analisi,
        });
      }

      await db.update(circolarizzazioneSessioni).set({ stato: "follow_up" })
        .where(eq(circolarizzazioneSessioni.id, input.sessioneId));
      return {
        documentiPdf: files.length,
        associati: risultati.length,
        nonAssociati: files.filter(file => !usati.has(file.path)).map(file => file.name),
        risultati,
      };
    }),

  /** Riepilogo statistiche follow-up per una sessione */
  /** Recupera le partite non trovate dalla verifica incassi/pagamenti per pre-popolare la circolarizzazione */
  getNonTrovatiDaVerifica: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database non disponibile");

      // Recupera l'ultima sessione di verifica incassi per questo incarico
      const sessioni = await db
        .select()
        .from(verificaIncassiSessioni)
        .where(eq(verificaIncassiSessioni.incaricoId, input.incaricoId))
        .orderBy(verificaIncassiSessioni.createdAt);

      if (sessioni.length === 0) {
        return { disponibile: false, nonTrovati: [], totaleClienti: 0, totaleFornitori: 0, sessione: null };
      }

      // Usa l'ultima sessione
      const ultimaSessione = sessioni[sessioni.length - 1];

      // Recupera tutte le partite non trovate (statoMatching = 'non_trovata')
      const partiteNonTrovate = await db
        .select()
        .from(verificaIncassiPartite)
        .where(
          and(
            eq(verificaIncassiPartite.sessioneId, ultimaSessione.id),
            eq(verificaIncassiPartite.statoMatching, "non_trovata")
          )
        );

      // Raggruppa per ragione sociale (evita duplicati) e somma i saldi
      const aggregati = new Map<string, { ragioneSociale: string; tipo: "cliente" | "fornitore"; saldo: number; codice?: string }>();
      for (const p of partiteNonTrovate) {
        const key = `${p.tipo}::${p.ragioneSociale}`;
        const existing = aggregati.get(key);
        const saldo = parseFloat(p.saldoPartita);
        if (existing) {
          existing.saldo += saldo;
        } else {
          aggregati.set(key, {
            ragioneSociale: p.ragioneSociale,
            tipo: p.tipo,
            saldo,
            codice: p.codice ?? undefined,
          });
        }
      }

      const nonTrovati = Array.from(aggregati.values()).sort((a, b) => Math.abs(b.saldo) - Math.abs(a.saldo));
      const clienti = nonTrovati.filter(n => n.tipo === "cliente");
      const fornitori = nonTrovati.filter(n => n.tipo === "fornitore");

      return {
        disponibile: nonTrovati.length > 0,
        nonTrovati,
        totaleClienti: clienti.length,
        totaleFornitori: fornitori.length,
        saldoTotaleClienti: clienti.reduce((s, n) => s + Math.abs(n.saldo), 0),
        saldoTotaleFornitori: fornitori.reduce((s, n) => s + Math.abs(n.saldo), 0),
        sessione: {
          id: ultimaSessione.id,
          dataAnalisi: ultimaSessione.createdAt,
          annoEsercizio: ultimaSessione.annoEsercizio,
          partiteClienteIncassate: ultimaSessione.partiteClienteIncassate,
          partiteFornitoriPagate: ultimaSessione.partiteFornitoriPagate,
          totaleNonTrovate: partiteNonTrovate.length,
        },
      };
    }),

  riepilogoFollowUp: protectedProcedure
  .input(z.object({ sessioneId: z.number() }))
  .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database non disponibile");

      const destinatari = await db
        .select()
        .from(circolarizzazioneDestinatari)
        .where(
          and(
            eq(circolarizzazioneDestinatari.sessioneId, input.sessioneId),
            eq(circolarizzazioneDestinatari.incluso, true)
          )
        );

      const totale = destinatari.length;
      const inviate = destinatari.filter((d) => d.statoLettera !== "da_generare" && d.statoLettera !== "generata").length;
      const risposteRicevute = destinatari.filter((d) => d.statoLettera === "risposta_ricevuta").length;
      const risposteDiscordanti = destinatari.filter((d) => d.statoLettera === "risposta_discordante").length;
      const nessuna = destinatari.filter((d) => d.statoLettera === "nessuna_risposta").length;
      const procedureAlternative = destinatari.filter((d) => d.statoLettera === "procedura_alternativa").length;
      const daInviare = destinatari.filter((d) => d.statoLettera === "generata" || d.statoLettera === "da_generare").length;

      const differenzeTotali = destinatari
        .filter((d) => d.differenza && parseFloat(d.differenza) !== 0)
        .reduce((s, d) => s + Math.abs(parseFloat(d.differenza!)), 0);

      return {
        totale,
        inviate,
        risposteRicevute,
        risposteDiscordanti,
        nessuna,
        procedureAlternative,
        daInviare,
        differenzeTotali,
        percentualeRisposta: totale > 0 ? ((risposteRicevute + risposteDiscordanti) / inviate) * 100 : 0,
      };
    }),

  exportCartaLavoro: protectedProcedure
    .input(z.object({ sessioneId: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("DB non disponibile");

      const [sessione] = await db
        .select()
        .from(circolarizzazioneSessioni)
        .where(eq(circolarizzazioneSessioni.id, input.sessioneId));
      if (!sessione) throw new Error("Sessione non trovata");

      const [incarico] = await db
        .select({ id: incarichi.id, annoEsercizio: incarichi.annoEsercizio, clienteId: incarichi.clienteId })
        .from(incarichi)
        .where(eq(incarichi.id, sessione.incaricoId));

      const [cliente] = await db
        .select({ ragioneSociale: clienti.ragioneSociale })
        .from(clienti)
        .where(eq(clienti.id, incarico.clienteId));

      const destinatari = await db
        .select()
        .from(circolarizzazioneDestinatari)
        .where(
          and(
            eq(circolarizzazioneDestinatari.sessioneId, input.sessioneId),
            eq(circolarizzazioneDestinatari.incluso, true)
          )
        );

      type CampioneRow = {
        codice: string; ragioneSociale: string; tipo: string; saldo: number;
        motivazione: string; priorita: string; statoLettera: string;
        dataInvio: string; dataRisposta: string;
        saldoConfermato: number | null; differenza: number | null;
        noteFollowUp: string; proceduraAlternativa: string;
      };

      const campione: CampioneRow[] = destinatari.map((d) => ({
        codice: d.codice ?? "",
        ragioneSociale: d.ragioneSociale,
        tipo: d.tipo === "cliente" ? "Cliente" : "Fornitore",
        saldo: parseFloat(d.saldo),
        motivazione: d.motivazioneSelezione.replace(/_/g, " "),
        priorita: d.priorita ?? "media",
        statoLettera: d.statoLettera?.replace(/_/g, " ") ?? "da generare",
        dataInvio: d.dataInvio ? new Date(d.dataInvio).toLocaleDateString("it-IT") : "",
        dataRisposta: d.dataRisposta ? new Date(d.dataRisposta).toLocaleDateString("it-IT") : "",
        saldoConfermato: d.saldoConfermato ? parseFloat(d.saldoConfermato) : null,
        differenza: d.differenza ? parseFloat(d.differenza) : null,
        noteFollowUp: d.noteFollowUp ?? "",
        proceduraAlternativa: d.proceduraAlternativa ?? "",
      }));

      const totaleSaldo = campione.reduce((s: number, d: CampioneRow) => s + d.saldo, 0);
      const totaleRisposte = campione.filter((d: CampioneRow) =>
        d.statoLettera.includes("risposta")
      ).length;
      const totaleDiscordanti = campione.filter((d: CampioneRow) =>
        d.statoLettera.includes("discordante")
      ).length;
      const totaleDifferenze = campione
        .filter((d: CampioneRow) => d.differenza !== null)
        .reduce((s: number, d: CampioneRow) => s + Math.abs(d.differenza!), 0);

      return {
        nomeCliente: cliente?.ragioneSociale ?? "N/D",
        anno: incarico.annoEsercizio,
        dataEsportazione: new Date().toLocaleDateString("it-IT"),
        tipoCircolarizzazione: sessione.tipoCircolarizzazione,
        campione,
        statistiche: {
          totaleCampione: campione.length,
          totaleSaldo,
          totaleRisposte,
          totaleDiscordanti,
          totaleDifferenze,
          percentualeRisposta:
            campione.length > 0
              ? (totaleRisposte / campione.length) * 100
              : 0,
        },
      };
    }),
});
