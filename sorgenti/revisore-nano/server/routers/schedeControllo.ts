import { z } from "zod";
import { eq } from "drizzle-orm";
import { execFileSync } from "node:child_process";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import {
  schedaRimanenze,
  schedaImmobilizzazioni,
  schedaDisponibilitaLiquide,
  schedaPatrimonioNetto,
  schedaRicavi,
  areeControllo,
} from "../../drizzle/schema";
import { invokeLLM } from "../_core/llm";
import { getIncaricoById } from "../db";
import { downloadNextcloudFile, listNextcloudFiles } from "../nextcloud";
import { parseRegistroCespiti } from "../cespitiParser";

// ─── CHECKLIST DEFAULT ────────────────────────────────────────────────────────

const CHECKLIST_RIMANENZE = [
  { voce: "Ottenuto il prospetto delle rimanenze per categoria al 31/12", completata: false, note: "" },
  { voce: "Verificata la coerenza del metodo di valorizzazione con l'anno precedente (ISA 501.13)", completata: false, note: "" },
  { voce: "Partecipato o esaminato i verbali del conteggio fisico (ISA 501.4)", completata: false, note: "" },
  { voce: "Verificata la cut-off delle movimentazioni di magazzino a fine esercizio", completata: false, note: "" },
  { voce: "Valutata l'adeguatezza del fondo obsolescenza (OIC 13)", completata: false, note: "" },
  { voce: "Verificata la valorizzazione al minore tra costo e valore di realizzazione", completata: false, note: "" },
  { voce: "Confrontato il valore contabile con i dati dell'anno precedente (variazione > PM?)", completata: false, note: "" },
  { voce: "Verificata l'esistenza di pegni o vincoli sulle rimanenze", completata: false, note: "" },
];

const CHECKLIST_IMMOBILIZZAZIONI = [
  { voce: "Ottenuto e verificato il registro dei cespiti aggiornato al 31/12", completata: false, note: "" },
  { voce: "Verificata la coerenza delle aliquote di ammortamento con l'anno precedente e con le norme fiscali", completata: false, note: "" },
  { voce: "Esaminata la documentazione delle acquisizioni dell'esercizio (fatture, contratti)", completata: false, note: "" },
  { voce: "Verificata la corretta contabilizzazione delle dismissioni (plusvalenze/minusvalenze)", completata: false, note: "" },
  { voce: "Verificata l'esistenza fisica di un campione di cespiti significativi", completata: false, note: "" },
  { voce: "Verificata la corretta classificazione (materiali vs immateriali vs finanziarie)", completata: false, note: "" },
  { voce: "Valutata la necessità di svalutazioni per perdite durevoli di valore (OIC 9)", completata: false, note: "" },
  { voce: "Verificato il trattamento contabile di eventuali rivalutazioni (L. 342/2000 e successive)", completata: false, note: "" },
  { voce: "Verificata la corretta contabilizzazione dei beni in leasing (OIC 12 / IFRS 16)", completata: false, note: "" },
  { voce: "Verificata la corretta iscrizione dei costi di sviluppo e avviamento (OIC 24)", completata: false, note: "" },
];

const CHECKLIST_DISPONIBILITA = [
  { voce: "Ottenuti gli estratti conto bancari al 31/12 per tutti i conti correnti", completata: false, note: "" },
  { voce: "Eseguita la riconciliazione tra saldo contabile e saldo estratto conto per ogni c/c", completata: false, note: "" },
  { voce: "Verificato il saldo di cassa con conteggio fisico o con evidenza documentale", completata: false, note: "" },
  { voce: "Verificata la cut-off degli incassi e pagamenti a fine esercizio", completata: false, note: "" },
  { voce: "Inviata circolarizzazione bancaria per i conti significativi (ISA 505)", completata: false, note: "" },
  { voce: "Verificata l'assenza di restrizioni sull'utilizzo delle disponibilità (pegni, vincoli)", completata: false, note: "" },
  { voce: "Verificata la corretta classificazione delle disponibilità vincolate", completata: false, note: "" },
  { voce: "Verificata la coerenza con il rendiconto finanziario (OIC 10)", completata: false, note: "" },
];

// ─── ROUTER ───────────────────────────────────────────────────────────────────

export const schedeControlloRouter = router({

  // ── RIMANENZE ───────────────────────────────────────────────────────────────

  getSchedaRimanenze: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const [scheda] = await db
        .select()
        .from(schedaRimanenze)
        .where(eq(schedaRimanenze.incaricoId, input.incaricoId))
        .limit(1);
      if (!scheda) return null;
      return {
        ...scheda,
        checklistIsa: (scheda.checklistIsa as any[]) ?? CHECKLIST_RIMANENZE,
        categorieRimanenze: (scheda.categorieRimanenze as any[]) ?? [],
      };
    }),

  salvaSchedaRimanenze: protectedProcedure
    .input(z.object({
      incaricoId: z.number(),
      metodoValorizzazione: z.enum(["lifo", "fifo", "cmp", "specifico", "altro"]).optional(),
      metodoValorizzazioneNote: z.string().optional(),
      conteggioFisicoEseguito: z.boolean().optional(),
      dataConteggio: z.string().optional(),
      noteConteggio: z.string().optional(),
      valoreContabile: z.string().optional(),
      valoreConteggio: z.string().optional(),
      percentualeObsolescenza: z.string().optional(),
      fondoObsolescenza: z.string().optional(),
      noteObsolescenza: z.string().optional(),
      categorieRimanenze: z.array(z.object({
        categoria: z.string(),
        valore: z.number(),
        percObsolescenza: z.number().optional(),
        note: z.string().optional(),
      })).optional(),
      checklistIsa: z.array(z.object({
        voce: z.string(),
        completata: z.boolean(),
        note: z.string().optional(),
      })).optional(),
      conclusioni: z.string().optional(),
      rischioValutazione: z.enum(["basso", "medio", "alto", "critico"]).optional(),
      noteRevisore: z.string().optional(),
      stato: z.enum(["da_iniziare", "in_corso", "completata"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database non disponibile");
      const { incaricoId, ...dati } = input;
      // Calcola differenza conteggio
      const differenzaConteggio = dati.valoreContabile && dati.valoreConteggio
        ? String(parseFloat(dati.valoreConteggio) - parseFloat(dati.valoreContabile))
        : undefined;
      const payload = { ...dati, differenzaConteggio };
      const [existing] = await db.select({ id: schedaRimanenze.id }).from(schedaRimanenze).where(eq(schedaRimanenze.incaricoId, incaricoId)).limit(1);
      if (existing) {
        await db.update(schedaRimanenze).set(payload as any).where(eq(schedaRimanenze.id, existing.id));
        return { id: existing.id };
      } else {
        const [result] = await db.insert(schedaRimanenze).values({ incaricoId, ...payload } as any);
        return { id: (result as any).insertId };
      }
    }),

  analizzaRimanenzeConAI: protectedProcedure
    .input(z.object({
      incaricoId: z.number(),
      valoreContabile: z.number().optional(),
      valoreStorico: z.number().optional(),
      metodoValorizzazione: z.string().optional(),
      percentualeObsolescenza: z.number().optional(),
      categorieRimanenze: z.array(z.object({ categoria: z.string(), valore: z.number(), percObsolescenza: z.number().optional() })).optional(),
    }))
    .mutation(async ({ input }) => {
      const prompt = `Sei un revisore legale esperto in ISA Italia 501 (Rimanenze).
Analizza i seguenti dati di rimanenze per una nano impresa e fornisci:
1. Valutazione del rischio di revisione (basso/medio/alto/critico)
2. Principali aree di attenzione
3. Procedure di revisione prioritarie
4. Conclusioni preliminari

Dati:
- Valore contabile rimanenze: ${input.valoreContabile ? input.valoreContabile.toLocaleString("it-IT") + " €" : "non disponibile"}
- Valore anno precedente: ${input.valoreStorico ? input.valoreStorico.toLocaleString("it-IT") + " €" : "non disponibile"}
- Metodo valorizzazione: ${input.metodoValorizzazione ?? "non specificato"}
- % obsolescenza stimata: ${input.percentualeObsolescenza ?? "non specificata"}%
- Categorie: ${input.categorieRimanenze?.map(c => `${c.categoria}: ${c.valore.toLocaleString("it-IT")} €`).join(", ") ?? "non specificate"}

Rispondi in JSON con questa struttura:
{
  "rischioValutazione": "basso|medio|alto|critico",
  "areePrincipali": ["area1", "area2"],
  "procedurePrioritarie": ["procedura1", "procedura2", "procedura3"],
  "conclusioni": "testo conclusioni (3-5 frasi)"
}`;

      const response = await invokeLLM({
        messages: [
          { role: "system", content: "Sei un revisore legale esperto. Rispondi sempre in JSON valido." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      });
      const content = response.choices[0].message.content as string;
      return JSON.parse(content);
    }),

  // ── IMMOBILIZZAZIONI ────────────────────────────────────────────────────────

  getSchedaImmobilizzazioni: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const [scheda] = await db
        .select()
        .from(schedaImmobilizzazioni)
        .where(eq(schedaImmobilizzazioni.incaricoId, input.incaricoId))
        .limit(1);
      if (!scheda) return null;
      return {
        ...scheda,
        checklistIsa: (scheda.checklistIsa as any[]) ?? CHECKLIST_IMMOBILIZZAZIONI,
        aliquoteAmmortamento: (scheda.aliquoteAmmortamento as any[]) ?? [],
      };
    }),

  analizzaRegistroCespitiDaDossier: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .query(async ({ input }) => {
      const incarico = await getIncaricoById(input.incaricoId);
      if (!incarico) throw new Error("Incarico non trovato");
      if (!incarico.nextcloudFolder) throw new Error("Cartella dossier non collegata");
      const files = await listNextcloudFiles(incarico.nextcloudFolder);
      const candidates = files
        .filter(file => /\.(pdf)$/i.test(file.name) && /(registro.*cespit|beni.*ammortizz)/i.test(file.name))
        .sort((a, b) => Number(/2025/.test(b.path)) - Number(/2025/.test(a.path)) || String(b.lastModified).localeCompare(String(a.lastModified)));
      const source = candidates.find(file => file.path.includes(String(incarico.annoEsercizio))) ?? candidates[0];
      if (!source) return null;
      const buffer = await downloadNextcloudFile(source.path);
      let text = "";
      try {
        text = execFileSync("pdftotext", ["-layout", "-", "-"], { input: buffer, maxBuffer: 40 * 1024 * 1024 }).toString("utf-8");
      } catch {
        throw new Error("Il registro cespiti non contiene testo leggibile");
      }
      return { ...parseRegistroCespiti(text, source.name), sourcePath: source.path, lastModified: source.lastModified };
    }),

  salvaSchedaImmobilizzazioni: protectedProcedure
    .input(z.object({
      incaricoId: z.number(),
      valoreImmobiliMat: z.string().optional(),
      valoreImmobiliImmat: z.string().optional(),
      fondiAmmortamentoMat: z.string().optional(),
      fondiAmmortamentoImmat: z.string().optional(),
      registroCespitiVerificato: z.boolean().optional(),
      noteRegistroCespiti: z.string().optional(),
      aliquoteAmmortamento: z.array(z.object({
        categoria: z.string(),
        aliquota: z.number(),
        note: z.string().optional(),
      })).optional(),
      ammortamentiCalcolatiCorrettamente: z.boolean().optional(),
      noteAmmortamenti: z.string().optional(),
      acquisizioni: z.string().optional(),
      dismissioni: z.string().optional(),
      noteAcquisizioni: z.string().optional(),
      noteDismissioni: z.string().optional(),
      rivalutazioni: z.string().optional(),
      svalutazioni: z.string().optional(),
      noteRivalutazioni: z.string().optional(),
      beniInLeasing: z.boolean().optional(),
      noteLeasingIFRS16: z.string().optional(),
      checklistIsa: z.array(z.object({
        voce: z.string(),
        completata: z.boolean(),
        note: z.string().optional(),
      })).optional(),
      conclusioni: z.string().optional(),
      rischioValutazione: z.enum(["basso", "medio", "alto", "critico"]).optional(),
      noteRevisore: z.string().optional(),
      stato: z.enum(["da_iniziare", "in_corso", "completata"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database non disponibile");
      const { incaricoId, ...dati } = input;
      const [existing] = await db.select({ id: schedaImmobilizzazioni.id }).from(schedaImmobilizzazioni).where(eq(schedaImmobilizzazioni.incaricoId, incaricoId)).limit(1);
      if (existing) {
        await db.update(schedaImmobilizzazioni).set(dati as any).where(eq(schedaImmobilizzazioni.id, existing.id));
        return { id: existing.id };
      } else {
        const [result] = await db.insert(schedaImmobilizzazioni).values({ incaricoId, ...dati } as any);
        return { id: (result as any).insertId };
      }
    }),

  analizzaImmobilizzazioniConAI: protectedProcedure
    .input(z.object({
      incaricoId: z.number(),
      valoreImmobiliMat: z.number().optional(),
      valoreImmobiliImmat: z.number().optional(),
      valoreStoricoMat: z.number().optional(),
      acquisizioni: z.number().optional(),
      dismissioni: z.number().optional(),
      rivalutazioni: z.number().optional(),
      beniInLeasing: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const prompt = `Sei un revisore legale esperto in ISA Italia 500/501 (Immobilizzazioni).
Analizza i seguenti dati di immobilizzazioni per una nano impresa:

- Immobilizzazioni materiali nette: ${input.valoreImmobiliMat ? input.valoreImmobiliMat.toLocaleString("it-IT") + " €" : "n.d."}
- Immobilizzazioni immateriali nette: ${input.valoreImmobiliImmat ? input.valoreImmobiliImmat.toLocaleString("it-IT") + " €" : "n.d."}
- Valore storico materiali: ${input.valoreStoricoMat ? input.valoreStoricoMat.toLocaleString("it-IT") + " €" : "n.d."}
- Acquisizioni esercizio: ${input.acquisizioni ? input.acquisizioni.toLocaleString("it-IT") + " €" : "n.d."}
- Dismissioni esercizio: ${input.dismissioni ? input.dismissioni.toLocaleString("it-IT") + " €" : "n.d."}
- Rivalutazioni: ${input.rivalutazioni ? input.rivalutazioni.toLocaleString("it-IT") + " €" : "n.d."}
- Beni in leasing: ${input.beniInLeasing ? "Sì" : "No"}

Fornisci un'analisi in JSON:
{
  "rischioValutazione": "basso|medio|alto|critico",
  "areePrincipali": ["area1", "area2"],
  "procedurePrioritarie": ["procedura1", "procedura2", "procedura3"],
  "conclusioni": "testo (3-5 frasi)"
}`;

      const response = await invokeLLM({
        messages: [
          { role: "system", content: "Sei un revisore legale esperto. Rispondi sempre in JSON valido." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      });
      return JSON.parse(response.choices[0].message.content as string);
    }),

  // ── DISPONIBILITÀ LIQUIDE ───────────────────────────────────────────────────

  getSchedaDisponibilitaLiquide: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const [scheda] = await db
        .select()
        .from(schedaDisponibilitaLiquide)
        .where(eq(schedaDisponibilitaLiquide.incaricoId, input.incaricoId))
        .limit(1);
      if (!scheda) return null;
      return {
        ...scheda,
        checklistIsa: (scheda.checklistIsa as any[]) ?? CHECKLIST_DISPONIBILITA,
        contiCorrenti: (scheda.contiCorrenti as any[]) ?? [],
        centraleRischi: scheda.centraleRischi ?? null,
      };
    }),

  salvaSchedaDisponibilitaLiquide: protectedProcedure
    .input(z.object({
      incaricoId: z.number(),
      contiCorrenti: z.array(z.object({
        banca: z.string(),
        iban: z.string().optional(),
        saldoBilancio: z.number(),
        saldoEstrattoConto: z.number().optional(),
        differenza: z.number().optional(),
        riconciliato: z.boolean().optional(),
        note: z.string().optional(),
      })).optional(),
      saldoCassaBilancio: z.string().optional(),
      saldoCassaConteggio: z.string().optional(),
      noteCassa: z.string().optional(),
      riconciliazioneEseguita: z.boolean().optional(),
      dataRiconciliazione: z.string().optional(),
      noteRiconciliazione: z.string().optional(),
      estrattiContoAcquisiti: z.boolean().optional(),
      noteEstrattoConto: z.string().optional(),
      circolarizzazioneBancaria: z.boolean().optional(),
      noteCircolarizzazioneBancaria: z.string().optional(),
      centraleRischi: z.record(z.string(), z.unknown()).nullable().optional(),
      checklistIsa: z.array(z.object({
        voce: z.string(),
        completata: z.boolean(),
        note: z.string().optional(),
      })).optional(),
      conclusioni: z.string().optional(),
      rischioValutazione: z.enum(["basso", "medio", "alto", "critico"]).optional(),
      noteRevisore: z.string().optional(),
      stato: z.enum(["da_iniziare", "in_corso", "completata"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database non disponibile");
      const { incaricoId, ...dati } = input;
      // Calcola differenza cassa
      const differenzaCassa = dati.saldoCassaBilancio && dati.saldoCassaConteggio
        ? String(parseFloat(dati.saldoCassaConteggio) - parseFloat(dati.saldoCassaBilancio))
        : undefined;
      const payload = { ...dati, differenzaCassa };
      const [existing] = await db.select({ id: schedaDisponibilitaLiquide.id }).from(schedaDisponibilitaLiquide).where(eq(schedaDisponibilitaLiquide.incaricoId, incaricoId)).limit(1);
      if (existing) {
        await db.update(schedaDisponibilitaLiquide).set(payload as any).where(eq(schedaDisponibilitaLiquide.id, existing.id));
        return { id: existing.id };
      } else {
        const [result] = await db.insert(schedaDisponibilitaLiquide).values({ incaricoId, ...payload } as any);
        return { id: (result as any).insertId };
      }
    }),

  analizzaDisponibilitaConAI: protectedProcedure
    .input(z.object({
      incaricoId: z.number(),
      totaleLiquide: z.number().optional(),
      valoreStorico: z.number().optional(),
      numeroCc: z.number().optional(),
      differenzeTotali: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const prompt = `Sei un revisore legale esperto in ISA Italia 500/505 (Disponibilità liquide).
Analizza i seguenti dati per una nano impresa:

- Totale disponibilità liquide: ${input.totaleLiquide ? input.totaleLiquide.toLocaleString("it-IT") + " €" : "n.d."}
- Valore anno precedente: ${input.valoreStorico ? input.valoreStorico.toLocaleString("it-IT") + " €" : "n.d."}
- Numero conti correnti: ${input.numeroCc ?? "n.d."}
- Differenze riconciliazione: ${input.differenzeTotali ? input.differenzeTotali.toLocaleString("it-IT") + " €" : "n.d."}

Fornisci un'analisi in JSON:
{
  "rischioValutazione": "basso|medio|alto|critico",
  "areePrincipali": ["area1", "area2"],
  "procedurePrioritarie": ["procedura1", "procedura2", "procedura3"],
  "conclusioni": "testo (3-5 frasi)"
}`;

      const response = await invokeLLM({
        messages: [
          { role: "system", content: "Sei un revisore legale esperto. Rispondi sempre in JSON valido." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      });
      return JSON.parse(response.choices[0].message.content as string);
    }),

  // ── PATRIMONIO NETTO ────────────────────────────────────────────────────────

  getSchedaPatrimonioNetto: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const rows = await db.select().from(schedaPatrimonioNetto).where(eq(schedaPatrimonioNetto.incaricoId, input.incaricoId)).limit(1);
      if (rows.length > 0) return rows[0];
      return {
        checklistIsa: [
          { voce: "Verificata la coerenza del capitale sociale con l'atto costitutivo e le delibere assembleari", completata: false, note: "" },
          { voce: "Verificato che le variazioni del PN siano supportate da delibere assembleari (aumenti, riduzioni, distribuzione utili)", completata: false, note: "" },
          { voce: "Verificata la corretta destinazione dell'utile dell'anno precedente (riserve, dividendi, riporto a nuovo)", completata: false, note: "" },
          { voce: "Verificata la corretta alimentazione della riserva legale (min. 5% utile fino a 1/5 capitale)", completata: false, note: "" },
          { voce: "Verificata la coerenza del PN con il bilancio dell'anno precedente (riconciliazione)", completata: false, note: "" },
          { voce: "Verificata l'assenza di distribuzione di utili in presenza di perdite pregresse non coperte", completata: false, note: "" },
          { voce: "Verificata la corretta contabilizzazione di eventuali rivalutazioni di attivo (L. 342/2000 e successive)", completata: false, note: "" },
          { voce: "Verificata la corretta iscrizione di riserve da rivalutazione e relative imposte differite", completata: false, note: "" },
        ],
        stato: "da_iniziare",
      };
    }),

  saveSchedaPatrimonioNetto: protectedProcedure
    .input(z.object({
      incaricoId: z.number(),
      capitalesociale: z.number().optional(),
      riservaLegale: z.number().optional(),
      riserveStatutarie: z.number().optional(),
      riserveAltro: z.number().optional(),
      utileEsercizio: z.number().optional(),
      utileAnniPrec: z.number().optional(),
      totalePN: z.number().optional(),
      aumentoCapitale: z.boolean().optional(),
      noteAumentoCapitale: z.string().optional(),
      distribuzioneUtili: z.boolean().optional(),
      importoDividendi: z.number().optional(),
      noteDividendi: z.string().optional(),
      coperturaPerdite: z.boolean().optional(),
      noteCoperturaPerdite: z.string().optional(),
      pnAnnoPrec: z.number().optional(),
      variazionePN: z.number().optional(),
      variazioneSpiegata: z.boolean().optional(),
      checklistIsa: z.array(z.object({ voce: z.string(), completata: z.boolean(), note: z.string().optional() })).optional(),
      conclusioni: z.string().optional(),
      rischioValutazione: z.enum(["basso", "medio", "alto", "critico"]).optional(),
      noteRevisore: z.string().optional(),
      stato: z.enum(["da_iniziare", "in_corso", "completata"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database non disponibile");
      const { incaricoId, ...rest } = input;
      const toSave: Record<string, any> = { incaricoId };
      for (const [k, v] of Object.entries(rest)) {
        if (v !== undefined) toSave[k] = typeof v === "number" ? String(v) : v;
      }
      const existing = await db.select().from(schedaPatrimonioNetto).where(eq(schedaPatrimonioNetto.incaricoId, incaricoId)).limit(1);
      if (existing.length > 0) {
        await db.update(schedaPatrimonioNetto).set(toSave).where(eq(schedaPatrimonioNetto.incaricoId, incaricoId));
      } else {
        await db.insert(schedaPatrimonioNetto).values(toSave as any);
      }
      return { success: true };
    }),

  analizzaPatrimonioNettoConAI: protectedProcedure
    .input(z.object({
      incaricoId: z.number(),
      totalePN: z.number().optional(),
      pnAnnoPrec: z.number().optional(),
      utileEsercizio: z.number().optional(),
      aumentoCapitale: z.boolean().optional(),
      distribuzioneUtili: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const variazione = input.totalePN && input.pnAnnoPrec && input.pnAnnoPrec !== 0
        ? ((input.totalePN - input.pnAnnoPrec) / Math.abs(input.pnAnnoPrec) * 100).toFixed(1)
        : null;
      const prompt = `Sei un revisore legale esperto in ISA Italia 500 (Patrimonio Netto).
Analizza i seguenti dati per una nano impresa:
- Totale PN corrente: ${input.totalePN?.toLocaleString("it-IT") ?? "n.d."} €
- Totale PN anno precedente: ${input.pnAnnoPrec?.toLocaleString("it-IT") ?? "n.d."} €
- Variazione: ${variazione ? variazione + "%" : "n.d."}
- Utile esercizio: ${input.utileEsercizio?.toLocaleString("it-IT") ?? "n.d."} €
- Aumento di capitale nell'esercizio: ${input.aumentoCapitale ? "Sì" : "No"}
- Distribuzione utili/dividendi: ${input.distribuzioneUtili ? "Sì" : "No"}
Fornisci analisi in JSON:
{
  "rischioValutazione": "basso|medio|alto|critico",
  "areePrincipali": ["area1", "area2"],
  "procedurePrioritarie": ["procedura1", "procedura2"],
  "conclusioni": "testo (3-5 frasi)"
}`;
      const response = await invokeLLM({
        messages: [
          { role: "system", content: "Sei un revisore legale esperto. Rispondi sempre in JSON valido." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      });
      return JSON.parse(response.choices[0].message.content as string);
    }),

  // ── RICAVI ──────────────────────────────────────────────────────────────────

  getSchedaRicavi: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const rows = await db.select().from(schedaRicavi).where(eq(schedaRicavi.incaricoId, input.incaricoId)).limit(1);
      if (rows.length > 0) return rows[0];
      return {
        checklistIsa: [
          { voce: "Verificata la completezza dei ricavi: tutti i ricavi di competenza dell'esercizio sono stati registrati (ISA 315)", completata: false, note: "" },
          { voce: "Eseguito il test di cut-off: esaminati i documenti di vendita di dicembre e gennaio per verificare la corretta imputazione per competenza", completata: false, note: "" },
          { voce: "Verificata la coerenza dei ricavi con i dati di vendita (ordini, DDT, fatture) per un campione significativo", completata: false, note: "" },
          { voce: "Analizzata la variazione dei ricavi rispetto all'anno precedente e ottenuta spiegazione per variazioni > PM", completata: false, note: "" },
          { voce: "Verificata l'assenza di ricavi fittizi o anticipati (ISA 240 — rischio frode)", completata: false, note: "" },
          { voce: "Verificata la corretta classificazione tra ricavi ordinari e proventi straordinari/non ricorrenti", completata: false, note: "" },
          { voce: "Verificata la concentrazione dei ricavi: i principali clienti sono stati circolarizzati?", completata: false, note: "" },
          { voce: "Verificata la corretta contabilizzazione di resi, sconti e abbuoni", completata: false, note: "" },
        ],
        stato: "da_iniziare",
      };
    }),

  saveSchedaRicavi: protectedProcedure
    .input(z.object({
      incaricoId: z.number(),
      ricaviTotali: z.number().optional(),
      ricaviAnnoPrec: z.number().optional(),
      variazioneRicavi: z.number().optional(),
      variazionePercRicavi: z.number().optional(),
      categorieRicavi: z.array(z.object({ categoria: z.string(), importo: z.number(), percentuale: z.number().optional(), note: z.string().optional() })).optional(),
      completezzaVerificata: z.boolean().optional(),
      noteCompletezza: z.string().optional(),
      cutOffVerificato: z.boolean().optional(),
      noteCutOff: z.string().optional(),
      periodoVerificaCutOff: z.string().optional(),
      anomalieRilevate: z.boolean().optional(),
      descrizioneAnomalie: z.string().optional(),
      concentrazioneClienti: z.boolean().optional(),
      noteConcentrazione: z.string().optional(),
      ricaviNonRicorrenti: z.number().optional(),
      noteRicaviNonRicorrenti: z.string().optional(),
      checklistIsa: z.array(z.object({ voce: z.string(), completata: z.boolean(), note: z.string().optional() })).optional(),
      conclusioni: z.string().optional(),
      rischioValutazione: z.enum(["basso", "medio", "alto", "critico"]).optional(),
      noteRevisore: z.string().optional(),
      stato: z.enum(["da_iniziare", "in_corso", "completata"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database non disponibile");
      const { incaricoId, ...rest } = input;
      const toSave: Record<string, any> = { incaricoId };
      for (const [k, v] of Object.entries(rest)) {
        if (v !== undefined) toSave[k] = typeof v === "number" ? String(v) : v;
      }
      const existing = await db.select().from(schedaRicavi).where(eq(schedaRicavi.incaricoId, incaricoId)).limit(1);
      if (existing.length > 0) {
        await db.update(schedaRicavi).set(toSave).where(eq(schedaRicavi.incaricoId, incaricoId));
      } else {
        await db.insert(schedaRicavi).values(toSave as any);
      }
      return { success: true };
    }),

  analizzaRicaviConAI: protectedProcedure
    .input(z.object({
      incaricoId: z.number(),
      ricaviTotali: z.number().optional(),
      ricaviAnnoPrec: z.number().optional(),
      anomalieRilevate: z.boolean().optional(),
      concentrazioneClienti: z.boolean().optional(),
      ricaviNonRicorrenti: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const variazione = input.ricaviTotali && input.ricaviAnnoPrec && input.ricaviAnnoPrec !== 0
        ? ((input.ricaviTotali - input.ricaviAnnoPrec) / Math.abs(input.ricaviAnnoPrec) * 100).toFixed(1)
        : null;
      const prompt = `Sei un revisore legale esperto in ISA Italia 240/315 (Ricavi).
Analizza i seguenti dati per una nano impresa:
- Ricavi correnti: ${input.ricaviTotali?.toLocaleString("it-IT") ?? "n.d."} €
- Ricavi anno precedente: ${input.ricaviAnnoPrec?.toLocaleString("it-IT") ?? "n.d."} €
- Variazione: ${variazione ? variazione + "%" : "n.d."}
- Anomalie rilevate: ${input.anomalieRilevate ? "Sì" : "No"}
- Concentrazione clienti: ${input.concentrazioneClienti ? "Sì" : "No"}
- Ricavi non ricorrenti: ${input.ricaviNonRicorrenti?.toLocaleString("it-IT") ?? "0"} €
Fornisci analisi in JSON:
{
  "rischioValutazione": "basso|medio|alto|critico",
  "areePrincipali": ["area1", "area2"],
  "procedurePrioritarie": ["procedura1", "procedura2", "procedura3"],
  "conclusioni": "testo (3-5 frasi)"
}`;
      const response = await invokeLLM({
        messages: [
          { role: "system", content: "Sei un revisore legale esperto. Rispondi sempre in JSON valido." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      });
      return JSON.parse(response.choices[0].message.content as string);
    }),
});
