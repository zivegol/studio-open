/**
 * Router Wizard Avvio Revisione Annuale
 *
 * Guida il revisore attraverso 5 step sequenziali:
 *   1. Upload documenti (bilancio, estratto conto, partitario, documenti societari)
 *   2. Analisi AI bilancio → estrazione voci CE/SP, indici, anomalie
 *   3. Analisi AI estratto conto → classificazione movimenti, riconciliazione
 *   4. Analisi AI partitario → aging crediti/debiti, concentrazioni
 *   5. Riepilogo e popolamento automatico schede
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { eq, and } from "drizzle-orm";
import {
  wizardSessioni,
  documenti,
  incarichi,
  moduloComprensione,
  moduloRischio,
  strategiaRevisione,
} from "../../drizzle/schema";
import { invokeLLM } from "../_core/llm";
import fs from "fs/promises";
import { resolveStoragePath } from "../storage";
import * as XLSX from "xlsx";

function parseJsonFromLlmContent<T>(content: unknown): T {
  if (typeof content !== "string") return (content ?? {}) as T;
  const trimmed = content.trim();
  const withoutFence = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(withoutFence) as T;
  } catch {
    const objectStart = withoutFence.indexOf("{");
    const arrayStart = withoutFence.indexOf("[");
    const startCandidates = [objectStart, arrayStart].filter(index => index >= 0);
    const start = startCandidates.length > 0 ? Math.min(...startCandidates) : -1;
    const objectEnd = withoutFence.lastIndexOf("}");
    const arrayEnd = withoutFence.lastIndexOf("]");
    const end = Math.max(objectEnd, arrayEnd);

    if (start >= 0 && end > start) {
      return JSON.parse(withoutFence.slice(start, end + 1)) as T;
    }

    throw new Error("Risposta LLM non contiene JSON valido");
  }
}

function buildSpreadsheetPreview(nomeFile: string, buffer: Buffer): string {
  const lower = nomeFile.toLowerCase();
  if (lower.endsWith(".csv")) {
    return buffer.toString("utf-8").slice(0, 12000);
  }

  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false, cellText: true });
  return workbook.SheetNames.slice(0, 4)
    .map(sheetName => {
      const rows = XLSX.utils
        .sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: "" })
        .slice(0, 80)
        .map(row => (row as unknown[]).map(cell => String(cell ?? "").trim()).join("\t"))
        .filter(Boolean);
      return rows.length > 0 ? `=== Foglio: ${sheetName} ===\n${rows.join("\n")}` : "";
    })
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 12000);
}

// ─── HELPER: recupera sessione wizard o lancia errore ─────────────────────────
async function getSessioneOrThrow(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, sessioneId: number) {
  const rows = await db.select().from(wizardSessioni).where(eq(wizardSessioni.id, sessioneId)).limit(1);
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Sessione wizard non trovata" });
  return rows[0];
}

// ─── HELPER: analisi LLM generica con retry ───────────────────────────────────
async function analizzaConLLM(systemPrompt: string, userPrompt: string): Promise<Record<string, unknown>> {
  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" } as any,
    });
    const raw = response.choices[0]?.message?.content;
    return parseJsonFromLlmContent(raw);
  } catch {
    return { errore: "Analisi AI non disponibile" };
  }
}

// ─── HELPER: analisi LLM con file URL (PDF/Excel su S3) ──────────────────────
async function analizzaFileConLLM(
  nomeFile: string,
  fileBuffer: Buffer,
  tipoFile: string,
  systemPrompt: string,
  textPrompt: string
): Promise<Record<string, unknown>> {
  try {
    const isPdfLike = tipoFile === "pdf";
    const response = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: isPdfLike
            ? [
                { type: "document", source: { type: "base64", media_type: "application/pdf", data: fileBuffer.toString("base64") } },
                { type: "text", text: textPrompt },
              ]
            : [
                { type: "text", text: `${textPrompt}\n\nAnteprima file ${nomeFile}:\n${
                  tipoFile === "xml" || tipoFile === "xbrl"
                    ? fileBuffer.toString("utf-8").slice(0, 12000)
                    : buildSpreadsheetPreview(nomeFile, fileBuffer)
                }` },
              ],
        },
      ],
      response_format: { type: "json_object" } as any,
    });
    const raw = response.choices[0]?.message?.content;
    return parseJsonFromLlmContent(raw);
  } catch {
    return { errore: "Analisi AI non disponibile" };
  }
}

function numeroBilancio(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function formatEuro(value: number | null): string {
  if (value == null) return "n.d.";
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value);
}

function buildAnalisiBilancioDaDati(dati: Record<string, unknown>): Record<string, unknown> {
  const sp = (dati.statoPatrimoniale as Record<string, unknown>) || {};
  const ce = (dati.contoEconomico as Record<string, unknown>) || {};
  const vociSP = (dati.vociSP as Record<string, unknown>) || {};
  const vociCE = (dati.vociCE as Record<string, unknown>) || {};
  const anno = numeroBilancio(dati.anno);
  const ragioneSociale = String(dati.ragioneSociale ?? "La societa'");
  const ricavi = numeroBilancio(dati.ricavi ?? ce.ricaviVendite ?? ce.totaleValoreProduzione ?? vociCE.ricaviVendite);
  const totaleAttivo = numeroBilancio(dati.totaleAttivo ?? sp.totaleAttivo);
  const patrimonioNetto = numeroBilancio(dati.patrimonioNetto ?? sp.patrimonioNetto ?? sp.patrimoniNetto);
  const utile = numeroBilancio(dati.utile ?? sp.utileEsercizio ?? ce.utileNetto ?? vociCE.utileNetto);
  const debitiTotali = numeroBilancio(dati.debitiTotali ?? sp.totaleDebiti ?? sp.totalDebiti ?? vociSP.altriDebiti);
  const disponibilitaLiquide = numeroBilancio(dati.disponibilitaLiquide ?? sp.disponibilitaLiquide ?? vociSP.disponibilitaLiquide);
  const creditiClienti = numeroBilancio(dati.creditiClienti ?? sp.creditiClienti ?? vociSP.creditiClienti);
  const costiPersonale = numeroBilancio(dati.costiPersonale ?? ce.costiPersonale ?? vociCE.costiPersonale);
  const oneriFinanziari = numeroBilancio(dati.oneriFinanziari ?? ce.oneriFinanziari ?? vociCE.oneriFinanziari);

  const anomalie: Array<{ area: string; descrizione: string; severita: "alta" | "media" | "bassa"; riferimentoISA: string }> = [];
  const areeAttenzione: Array<{ area: string; nota: string }> = [];
  const mancanti = [
    ["ricavi", ricavi],
    ["utile/perdita", utile],
    ["disponibilita' liquide", disponibilitaLiquide],
    ["crediti verso clienti", creditiClienti],
    ["costi del personale", costiPersonale],
  ].filter(([, valore]) => valore == null).map(([label]) => String(label));

  if (mancanti.length > 0) {
    anomalie.push({
      area: "Completezza dati",
      descrizione: `Mancano dai dati strutturati: ${mancanti.join(", ")}.`,
      severita: mancanti.length >= 3 ? "media" : "bassa",
      riferimentoISA: "ISA 315",
    });
  }

  const indebitamento = totaleAttivo && debitiTotali != null
    ? Math.round((debitiTotali / totaleAttivo) * 1000) / 10
    : null;
  if (indebitamento != null && indebitamento > 75) {
    anomalie.push({
      area: "Struttura finanziaria",
      descrizione: `Rapporto debiti/totale attivo elevato (${indebitamento}%).`,
      severita: "alta",
      riferimentoISA: "ISA 570",
    });
  }
  if (patrimonioNetto != null && patrimonioNetto <= 0) {
    anomalie.push({
      area: "Patrimonio netto",
      descrizione: "Patrimonio netto nullo o negativo: valutare continuita' aziendale e copertura perdite.",
      severita: "alta",
      riferimentoISA: "ISA 570",
    });
  } else if (totaleAttivo && patrimonioNetto != null && patrimonioNetto / totaleAttivo < 0.08) {
    areeAttenzione.push({
      area: "Patrimonializzazione",
      nota: `Patrimonio netto pari al ${Math.round((patrimonioNetto / totaleAttivo) * 1000) / 10}% del totale attivo.`,
    });
  }
  if (ricavi != null && utile != null && ricavi !== 0 && utile / ricavi < -0.05) {
    anomalie.push({
      area: "Redditivita'",
      descrizione: `Perdita significativa rispetto ai ricavi (${Math.round((utile / ricavi) * 1000) / 10}%).`,
      severita: "alta",
      riferimentoISA: "ISA 315",
    });
  }
  if (disponibilitaLiquide != null && debitiTotali != null && debitiTotali > 0 && disponibilitaLiquide / debitiTotali < 0.05) {
    areeAttenzione.push({
      area: "Liquidita'",
      nota: `Disponibilita' liquide pari al ${Math.round((disponibilitaLiquide / debitiTotali) * 1000) / 10}% dei debiti totali.`,
    });
  }

  const redditivita = ricavi && ricavi !== 0 && utile != null ? Math.round((utile / ricavi) * 1000) / 10 : null;
  const continuitaRischio = anomalie.some(a => a.severita === "alta" && a.riferimentoISA === "ISA 570")
    ? "alto"
    : areeAttenzione.length > 0 ? "medio" : "basso";

  return {
    anno,
    ragioneSociale,
    ricavi,
    totaleAttivo,
    patrimonioNetto,
    utile,
    debitiTotali,
    disponibilitaLiquide,
    creditiClienti,
    costiPersonale,
    oneriFinanziari,
    sintesi: `${ragioneSociale} presenta un bilancio ${anno ?? ""} con ricavi ${formatEuro(ricavi)}, utile/perdita ${formatEuro(utile)}, totale attivo ${formatEuro(totaleAttivo)}, patrimonio netto ${formatEuro(patrimonioNetto)} e disponibilita' liquide ${formatEuro(disponibilitaLiquide)}. I dati principali risultano ${mancanti.length === 0 ? "presenti" : "parziali"}; l'attenzione principale riguarda ${indebitamento != null && indebitamento > 75 ? "l'elevato indebitamento" : "gli indicatori di continuita' e liquidita'"}${indebitamento != null ? ` (debiti/attivo ${indebitamento}%)` : ""}.`,
    anomalie,
    areeAttenzione,
    indiciCalcolati: {
      liquidita: disponibilitaLiquide,
      indebitamento,
      redditivita,
      ebitdaMargin: redditivita,
    },
    continuitaAziendale: {
      rischio: continuitaRischio,
      note: continuitaRischio === "alto"
        ? "Approfondire la sostenibilita' finanziaria, la posizione debitoria e le fonti di supporto alla continuita'."
        : "Valutazione da completare con informazioni qualitative, budget e posizione finanziaria aggiornata.",
    },
    datiEstesi: dati,
  };
}

// ─── ROUTER ───────────────────────────────────────────────────────────────────
export const wizardRouter = router({

  /** Avvia una nuova sessione wizard per un incarico (o restituisce quella esistente in_corso) */
  avvia: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database non disponibile" });

      // Verifica incarico
      const inc = await db.select().from(incarichi).where(eq(incarichi.id, input.incaricoId)).limit(1);
      if (!inc[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Incarico non trovato" });

      // Se esiste già una sessione in_corso, restituiscila
      const esistente = await db
        .select()
        .from(wizardSessioni)
        .where(and(eq(wizardSessioni.incaricoId, input.incaricoId), eq(wizardSessioni.stato, "in_corso")))
        .limit(1);
      if (esistente[0]) return { sessione: esistente[0], nuova: false };

      // Crea nuova sessione
      const [result] = await db.insert(wizardSessioni).values({
        incaricoId: input.incaricoId,
        stepCorrente: 1,
        stato: "in_corso",
      });
      const nuova = await db.select().from(wizardSessioni).where(eq(wizardSessioni.id, (result as any).insertId)).limit(1);
      return { sessione: nuova[0], nuova: true };
    }),

  /** Recupera la sessione wizard corrente (o l'ultima completata) */
  getSessione: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database non disponibile" });

      const rows = await db
        .select()
        .from(wizardSessioni)
        .where(eq(wizardSessioni.incaricoId, input.incaricoId))
        .orderBy(wizardSessioni.updatedAt);
      // Preferisci quella in_corso, altrimenti l'ultima
      const inCorso = rows.find(r => r.stato === "in_corso");
      return inCorso ?? rows[rows.length - 1] ?? null;
    }),

  /** Step 2: Analizza il bilancio caricato con LLM */
  analizzaBilancio: protectedProcedure
    .input(z.object({ sessioneId: z.number(), documentoId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database non disponibile" });

      const sessione = await getSessioneOrThrow(db, input.sessioneId);

      // Recupera documento
      const docRows = await db.select().from(documenti).where(eq(documenti.id, input.documentoId)).limit(1);
      const doc = docRows[0];
      if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Documento non trovato" });

      // Se il documento ha già dati strutturati dal parsing, usali; altrimenti ri-analizza
      let risultati: Record<string, unknown>;
      if (doc.datiStrutturati && Object.keys(doc.datiStrutturati as object).length > 0 && !(doc.datiStrutturati as any).errore) {
        // Arricchisci con analisi rischi e anomalie
        risultati = await analizzaConLLM(
          "Sei un revisore legale italiano esperto. Analizza i dati di bilancio e identifica rischi, anomalie e aree di attenzione per la revisione ISA Italia. Rispondi SOLO con JSON valido.",
          `Dati bilancio già estratti:\n${JSON.stringify(doc.datiStrutturati, null, 2).substring(0, 4000)}\n\nRestituisci JSON con:\n{\n  "sintesi": "sintesi in 3-4 frasi",\n  "anomalie": [{"area": string, "descrizione": string, "severita": "alta"|"media"|"bassa", "riferimentoISA": string}],\n  "areeAttenzione": [{"area": string, "nota": string}],\n  "indiciCalcolati": {"liquidita": number, "indebitamento": number, "redditività": number, "ebitdaMargin": number},\n  "continuitaAziendale": {"rischio": "basso"|"medio"|"alto", "note": string},\n  "datiEstesi": ${JSON.stringify(doc.datiStrutturati).substring(0, 2000)}\n}`
        );
      } else {
        const fileBuffer = await fs.readFile(resolveStoragePath(doc.s3Key));
        risultati = await analizzaFileConLLM(
          doc.nomeFile,
          fileBuffer,
          doc.tipoFile,
          "Sei un revisore legale italiano esperto. Analizza il bilancio e restituisci SOLO JSON valido senza markdown.",
          `Analizza questo bilancio aziendale italiano (${doc.nomeFile}) per la revisione legale ISA Italia.\nRestituisci JSON:\n{\n  "anno": number,\n  "ragioneSociale": string,\n  "ricavi": number,\n  "totaleAttivo": number,\n  "patrimonioNetto": number,\n  "utile": number,\n  "costiPersonale": number,\n  "disponibilitaLiquide": number,\n  "sintesi": string,\n  "anomalie": [{"area": string, "descrizione": string, "severita": "alta"|"media"|"bassa", "riferimentoISA": string}],\n  "areeAttenzione": [{"area": string, "nota": string}],\n  "continuitaAziendale": {"rischio": "basso"|"medio"|"alto", "note": string},\n  "vociSP": {},\n  "vociCE": {}\n}`
        );
      }

      if (doc.datiStrutturati && Object.keys(doc.datiStrutturati as object).length > 0 && !(doc.datiStrutturati as any).errore) {
        const datiEstratti = doc.datiStrutturati as Record<string, unknown>;
        risultati = buildAnalisiBilancioDaDati(datiEstratti);
      }

      // Salva risultati nella sessione
      await db.update(wizardSessioni)
        .set({ risultatiBilancio: risultati, stepCorrente: 3, updatedAt: new Date() })
        .where(eq(wizardSessioni.id, input.sessioneId));

      return { ok: true, risultati };
    }),

  /** Step 3: Analizza l'estratto conto con LLM */
  analizzaEstrattoConto: protectedProcedure
    .input(z.object({ sessioneId: z.number(), documentoId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database non disponibile" });

      await getSessioneOrThrow(db, input.sessioneId);

      const docRows = await db.select().from(documenti).where(eq(documenti.id, input.documentoId)).limit(1);
      const doc = docRows[0];
      if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Documento non trovato" });

      let risultati: Record<string, unknown>;
      if (doc.datiStrutturati && Object.keys(doc.datiStrutturati as object).length > 0 && !(doc.datiStrutturati as any).errore) {
        risultati = await analizzaConLLM(
          "Sei un revisore legale italiano esperto. Analizza i dati dell'estratto conto bancario e identifica anomalie, pattern e aree di attenzione. Rispondi SOLO con JSON valido.",
          `Dati estratto conto già estratti:\n${JSON.stringify(doc.datiStrutturati, null, 2).substring(0, 3000)}\n\nRestituisci JSON:\n{\n  "saldoIniziale": number,\n  "saldoFinale": number,\n  "totaleEntrate": number,\n  "totaleUscite": number,\n  "numerMovimenti": number,\n  "classificazione": {"stipendi": number, "inps_inail": number, "fornitori": number, "clienti": number, "banche": number, "altro": number},\n  "anomalie": [{"tipo": string, "descrizione": string, "importo": number, "severita": "alta"|"media"|"bassa"}],\n  "mesiAnomalii": [string],\n  "sintesi": string\n}`
        );
      } else {
        const fileBuffer = await fs.readFile(resolveStoragePath(doc.s3Key));
        risultati = await analizzaFileConLLM(
          doc.nomeFile,
          fileBuffer,
          doc.tipoFile,
          "Sei un revisore legale italiano esperto. Analizza l'estratto conto e restituisci SOLO JSON valido.",
          `Analizza questo estratto conto bancario (${doc.nomeFile}) per la revisione legale.\nRestituisci JSON:\n{\n  "saldoIniziale": number,\n  "saldoFinale": number,\n  "totaleEntrate": number,\n  "totaleUscite": number,\n  "numeroMovimenti": number,\n  "classificazione": {"stipendi": number, "inps_inail": number, "fornitori": number, "clienti": number, "banche": number, "altro": number},\n  "anomalie": [{"tipo": string, "descrizione": string, "importo": number, "severita": "alta"|"media"|"bassa"}],\n  "mesiAnomalii": [string],\n  "sintesi": string\n}`
        );
      }

      await db.update(wizardSessioni)
        .set({ risultatiEstrattoConto: risultati, stepCorrente: 4, updatedAt: new Date() })
        .where(eq(wizardSessioni.id, input.sessioneId));

      return { ok: true, risultati };
    }),

  /** Step 4: Analizza il partitario con LLM */
  analizzaPartitario: protectedProcedure
    .input(z.object({ sessioneId: z.number(), documentoId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database non disponibile" });

      await getSessioneOrThrow(db, input.sessioneId);

      const docRows = await db.select().from(documenti).where(eq(documenti.id, input.documentoId)).limit(1);
      const doc = docRows[0];
      if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Documento non trovato" });

      let risultati: Record<string, unknown>;
      if (doc.datiStrutturati && Object.keys(doc.datiStrutturati as object).length > 0 && !(doc.datiStrutturati as any).errore) {
        risultati = await analizzaConLLM(
          "Sei un revisore legale italiano esperto. Analizza il partitario e identifica concentrazioni, crediti scaduti e anomalie. Rispondi SOLO con JSON valido.",
          `Dati partitario:\n${JSON.stringify(doc.datiStrutturati, null, 2).substring(0, 3000)}\n\nRestituisci JSON:\n{\n  "totaleCreditiClienti": number,\n  "totaleDebitiFornitori": number,\n  "creditiScaduti": [{"cliente": string, "importo": number, "giorniScaduto": number}],\n  "concentrazioneCrediti": [{"cliente": string, "importo": number, "percSuTotale": number}],\n  "concentrazioneDebiti": [{"fornitore": string, "importo": number, "percSuTotale": number}],\n  "anomalie": [{"tipo": string, "descrizione": string, "severita": "alta"|"media"|"bassa"}],\n  "candidatiCircolarizzazione": [{"nome": string, "importo": number, "tipo": "cliente"|"fornitore"}],\n  "sintesi": string\n}`
        );
      } else {
        const fileBuffer = await fs.readFile(resolveStoragePath(doc.s3Key));
        risultati = await analizzaFileConLLM(
          doc.nomeFile,
          fileBuffer,
          doc.tipoFile,
          "Sei un revisore legale italiano esperto. Analizza il partitario e restituisci SOLO JSON valido.",
          `Analizza questo partitario (${doc.nomeFile}) per la revisione legale ISA Italia.\nRestituisci JSON:\n{\n  "totaleCreditiClienti": number,\n  "totaleDebitiFornitori": number,\n  "creditiScaduti": [{"cliente": string, "importo": number, "giorniScaduto": number}],\n  "concentrazioneCrediti": [{"cliente": string, "importo": number, "percSuTotale": number}],\n  "concentrazioneDebiti": [{"fornitore": string, "importo": number, "percSuTotale": number}],\n  "anomalie": [{"tipo": string, "descrizione": string, "severita": "alta"|"media"|"bassa"}],\n  "candidatiCircolarizzazione": [{"nome": string, "importo": number, "tipo": "cliente"|"fornitore"}],\n  "sintesi": string\n}`
        );
      }

      await db.update(wizardSessioni)
        .set({ risultatiPartitario: risultati, stepCorrente: 5, updatedAt: new Date() })
        .where(eq(wizardSessioni.id, input.sessioneId));

      return { ok: true, risultati };
    }),

  /** Step 4b: Analizza documenti societari (verbali, visura) con LLM */
  analizzaDocumentiSocietari: protectedProcedure
    .input(z.object({ sessioneId: z.number(), documentoIds: z.array(z.number()) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database non disponibile" });

      await getSessioneOrThrow(db, input.sessioneId);

      const risultatiPerDoc: Record<string, unknown>[] = [];
      for (const docId of input.documentoIds) {
        const docRows = await db.select().from(documenti).where(eq(documenti.id, docId)).limit(1);
        const doc = docRows[0];
        if (!doc) continue;

        const fileBuffer = await fs.readFile(resolveStoragePath(doc.s3Key));
        const res = await analizzaFileConLLM(
          doc.nomeFile,
          fileBuffer,
          doc.tipoFile,
          "Sei un revisore legale italiano esperto. Analizza il documento societario e restituisci SOLO JSON valido.",
          `Analizza questo documento societario (${doc.tipoDocumento}, file: ${doc.nomeFile}) per la revisione legale ISA Italia.\nRestituisci JSON:\n{\n  "tipoDocumento": string,\n  "dataDocumento": string,\n  "sintesi": string,\n  "eventiRilevanti": [{"tipo": string, "descrizione": string, "data": string}],\n  "rischioIdentificato": [{"tipo": string, "descrizione": string, "severita": "alta"|"media"|"bassa"}],\n  "noteRevisore": string\n}`
        );
        risultatiPerDoc.push({ documentoId: docId, nomeFile: doc.nomeFile, ...res });
      }

      const risultatiFinali = { documenti: risultatiPerDoc, sintesiGlobale: `Analizzati ${risultatiPerDoc.length} documenti societari` };

      await db.update(wizardSessioni)
        .set({ risultatiDocumentiSocietari: risultatiFinali, updatedAt: new Date() })
        .where(eq(wizardSessioni.id, input.sessioneId));

      return { ok: true, risultati: risultatiFinali };
    }),

  /** Step 5: Completa il wizard e popola automaticamente le schede */
  completaWizard: protectedProcedure
    .input(z.object({
      sessioneId: z.number(),
      confermaPopola: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database non disponibile" });

      const sessione = await getSessioneOrThrow(db, input.sessioneId);
      const incaricoId = sessione.incaricoId;

      const azioniEseguite: Array<{ azione: string; esito: string; timestamp: string }> = [];

      if (input.confermaPopola) {
        // ── Popola modulo comprensione con dati bilancio ──────────────────────
        const bil = sessione.risultatiBilancio as any;
        if (bil && !bil.errore) {
          try {
            const esistente = await db.select({ id: moduloComprensione.id })
              .from(moduloComprensione)
              .where(eq(moduloComprensione.incaricoId, incaricoId))
              .limit(1);

            const datiComprensione = {
              incaricoId,
              ricaviNetti: bil.ricavi ?? bil.vociCE?.ricaviVendite ?? null,
              totaleAttivo: bil.totaleAttivo ?? null,
              patrimonioNetto: bil.patrimonioNetto ?? null,
              utilePerditaEsercizio: bil.utile ?? bil.vociCE?.utileNetto ?? null,
              numeroDipendenti: bil.dipendenti ?? null,
              debitiTotali: bil.debitiTotali ?? bil.vociSP?.altriDebiti ?? null,
              creditiTotali: bil.creditiClienti ?? bil.vociSP?.creditiClienti ?? null,
              disponibilitaLiquide: bil.disponibilitaLiquide ?? bil.vociSP?.disponibilitaLiquide ?? null,
              indici: bil.indiciCalcolati ?? bil.indici ?? null,
              sintesiAi: bil.sintesi ?? null,
            };

            if (esistente[0]) {
              await db.update(moduloComprensione).set({ ...datiComprensione, updatedAt: new Date() }).where(eq(moduloComprensione.id, esistente[0].id));
              azioniEseguite.push({ azione: "Aggiornato modulo comprensione con dati bilancio", esito: "ok", timestamp: new Date().toISOString() });
            } else {
              await db.insert(moduloComprensione).values(datiComprensione as any);
              azioniEseguite.push({ azione: "Creato modulo comprensione con dati bilancio", esito: "ok", timestamp: new Date().toISOString() });
            }
          } catch (e: any) {
            azioniEseguite.push({ azione: "Popolamento modulo comprensione", esito: `errore: ${e.message}`, timestamp: new Date().toISOString() });
          }
        }

        // ── Popola modulo rischio con anomalie identificate ───────────────────
        const anomalieBilancio = bil?.anomalie ?? [];
        const anomalieEC = (sessione.risultatiEstrattoConto as any)?.anomalie ?? [];
        const anomaliePartitario = (sessione.risultatiPartitario as any)?.anomalie ?? [];
        const tutteAnomalieAlt = [...anomalieBilancio, ...anomalieEC, ...anomaliePartitario].filter((a: any) => a.severita === "alta");

        if (tutteAnomalieAlt.length > 0) {
          try {
            const esistenteRischio = await db.select({ id: moduloRischio.id })
              .from(moduloRischio)
              .where(eq(moduloRischio.incaricoId, incaricoId))
              .limit(1);

            const noteRischio = tutteAnomalieAlt.map((a: any) => `[${a.area ?? a.tipo ?? "Anomalia"}] ${a.descrizione}`).join("\n");

            if (esistenteRischio[0]) {
              await db.update(moduloRischio)
                .set({ analisiAiRischi: noteRischio, updatedAt: new Date() })
                .where(eq(moduloRischio.id, esistenteRischio[0].id));
            } else {
              await db.insert(moduloRischio).values({ incaricoId, analisiAiRischi: noteRischio });
            }
            azioniEseguite.push({ azione: `Popolato modulo rischio con ${tutteAnomalieAlt.length} anomalie ad alta severità`, esito: "ok", timestamp: new Date().toISOString() });
          } catch (e: any) {
            azioniEseguite.push({ azione: "Popolamento modulo rischio", esito: `errore: ${e.message}`, timestamp: new Date().toISOString() });
          }
        }

        // ── Popola strategia revisione con aree di attenzione ────────────────
        const areeAttenzione = bil?.areeAttenzione ?? [];
        if (areeAttenzione.length > 0) {
          try {
            const esistenteStrategia = await db.select({ id: strategiaRevisione.id })
              .from(strategiaRevisione)
              .where(eq(strategiaRevisione.incaricoId, incaricoId))
              .limit(1);

            const noteStrategia = areeAttenzione.map((a: any) => `${a.area}: ${a.nota}`).join("\n");

            if (esistenteStrategia[0]) {
              await db.update(strategiaRevisione)
                .set({ noteRevisore: noteStrategia, updatedAt: new Date() })
                .where(eq(strategiaRevisione.id, esistenteStrategia[0].id));
            } else {
              await db.insert(strategiaRevisione).values({ incaricoId, fase: "revisione", noteRevisore: noteStrategia });
            }
            azioniEseguite.push({ azione: `Popolata strategia revisione con ${areeAttenzione.length} aree di attenzione`, esito: "ok", timestamp: new Date().toISOString() });
          } catch (e: any) {
            azioniEseguite.push({ azione: "Popolamento strategia revisione", esito: `errore: ${e.message}`, timestamp: new Date().toISOString() });
          }
        }
      }

      // Riepilogo finale
      const riepilogo = {
        incaricoId,
        dataCompletamento: new Date().toISOString(),
        documentiAnalizzati: {
          bilancio: !!sessione.risultatiBilancio,
          estrattoConto: !!sessione.risultatiEstrattoConto,
          partitario: !!sessione.risultatiPartitario,
          societari: !!sessione.risultatiDocumentiSocietari,
        },
        azioniEseguite: azioniEseguite.length,
        anomalieTotali: [
          ...((sessione.risultatiBilancio as any)?.anomalie ?? []),
          ...((sessione.risultatiEstrattoConto as any)?.anomalie ?? []),
          ...((sessione.risultatiPartitario as any)?.anomalie ?? []),
        ].length,
      };

      // Marca sessione come completata
      await db.update(wizardSessioni)
        .set({ stato: "completato", stepCorrente: 5, riepilogoFinale: riepilogo, azioniEseguite, updatedAt: new Date() })
        .where(eq(wizardSessioni.id, input.sessioneId));

      return { ok: true, riepilogo, azioniEseguite };
    }),

  /** Aggiorna lo step corrente della sessione */
  aggiornaStep: protectedProcedure
    .input(z.object({ sessioneId: z.number(), step: z.number().min(1).max(5) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database non disponibile" });
      await db.update(wizardSessioni)
        .set({ stepCorrente: input.step, updatedAt: new Date() })
        .where(eq(wizardSessioni.id, input.sessioneId));
      return { ok: true };
    }),
});
