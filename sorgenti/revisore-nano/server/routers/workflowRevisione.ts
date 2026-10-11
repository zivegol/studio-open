import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db";
import {
  documenti,
  moduloAccettazione,
  moduloComprensione,
  moduloRischio,
  moduloMaterialita,
  moduloPiano,
  circolarizzazioneSessioni,
  verificaIncassiSessioni,
  schedaRimanenze,
  schedaImmobilizzazioni,
  schedaDisponibilitaLiquide,
  schedaPatrimonioNetto,
  schedaRicavi,
  strategiaRevisione,
  areeControllo,
  incarichi,
  roadmapStepCompletati,
  roadmapStepNote,
} from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";

// ─── TIPI ─────────────────────────────────────────────────────────────────────

export type StatoStep = "completato" | "in_corso" | "disponibile" | "bloccato";
export type PrioritaStep = "critica" | "alta" | "media" | "bassa";
export type FaseWorkflow = "pianificazione" | "raccolta_dati" | "verifiche" | "completamento";

export interface StepWorkflow {
  id: string;
  fase: FaseWorkflow;
  ordine: number;
  titolo: string;
  descrizione: string;
  riferimentoISA: string;
  stato: StatoStep;
  priorita: PrioritaStep;
  href: string;
  dipendeDa: string[];          // id degli step che devono essere completati prima
  notaRevisore: string;         // suggerimento contestuale basato sui dati
  percentualeCompletamento: number; // 0–100
}

// ─── DEFINIZIONE STEP ─────────────────────────────────────────────────────────

const STEP_DEFINIZIONI: Omit<StepWorkflow, "stato" | "priorita" | "notaRevisore" | "percentualeCompletamento">[] = [
  // ── FASE 1: PIANIFICAZIONE ──────────────────────────────────────────────────
  {
    id: "accettazione",
    fase: "pianificazione",
    ordine: 1,
    titolo: "Accettazione incarico",
    descrizione: "Verifica indipendenza, competenza e formalizzazione lettera di incarico.",
    riferimentoISA: "ISA Italia 210/220",
    href: "/modulo/1",
    dipendeDa: [],
  },
  {
    id: "comprensione",
    fase: "pianificazione",
    ordine: 2,
    titolo: "Comprensione dell'impresa",
    descrizione: "Analisi del modello di business, settore, rischi operativi e struttura organizzativa.",
    riferimentoISA: "ISA Italia 315",
    href: "/modulo/2",
    dipendeDa: ["accettazione"],
  },
  {
    id: "valutazione_rischio",
    fase: "pianificazione",
    ordine: 3,
    titolo: "Valutazione del rischio",
    descrizione: "Identificazione aree di rischio significativo, rischio intrinseco e di controllo.",
    riferimentoISA: "ISA Italia 315/330",
    href: "/modulo/3",
    dipendeDa: ["comprensione"],
  },
  {
    id: "materialita",
    fase: "pianificazione",
    ordine: 4,
    titolo: "Definizione della significatività",
    descrizione: "Calcolo significatività per il bilancio, significatività operativa e soglia errori trascurabili.",
    riferimentoISA: "ISA Italia 320",
    href: "/modulo/4",
    dipendeDa: ["bilancio_caricato"],
  },
  {
    id: "piano_revisione",
    fase: "pianificazione",
    ordine: 5,
    titolo: "Piano di revisione",
    descrizione: "Definizione delle procedure di revisione per ogni area di bilancio.",
    riferimentoISA: "ISA Italia 300",
    href: "/modulo/5",
    dipendeDa: ["valutazione_rischio", "materialita"],
  },

  // ── FASE 2: RACCOLTA DATI ───────────────────────────────────────────────────
  {
    id: "bilancio_caricato",
    fase: "raccolta_dati",
    ordine: 6,
    titolo: "Caricamento bilancio",
    descrizione: "Carica il bilancio CEE o il bilancio analitico/di verifica per abilitare tutte le verifiche automatiche.",
    riferimentoISA: "ISA Italia 500",
    href: "",  // link alla sezione documenti dell'incarico
    dipendeDa: [],
  },
  {
    id: "bilancio_storico",
    fase: "raccolta_dati",
    ordine: 7,
    titolo: "Caricamento bilancio anno precedente",
    descrizione: "Carica il bilancio dell'anno precedente per abilitare l'analisi comparativa e la verifica saldi di apertura.",
    riferimentoISA: "ISA Italia 510",
    href: "",
    dipendeDa: ["bilancio_caricato"],
  },
  {
    id: "partitario",
    fase: "raccolta_dati",
    ordine: 8,
    titolo: "Caricamento partitario clienti/fornitori",
    descrizione: "Carica il partitario (Excel o CSV) per la circolarizzazione e la verifica incassi.",
    riferimentoISA: "ISA Italia 505",
    href: "",
    dipendeDa: ["bilancio_caricato"],
  },
  {
    id: "estratto_conto",
    fase: "raccolta_dati",
    ordine: 9,
    titolo: "Caricamento estratto conto bancario",
    descrizione: "Carica l'estratto conto del primo trimestre dell'anno successivo per la verifica incassi e pagamenti.",
    riferimentoISA: "ISA Italia 560",
    href: "",
    dipendeDa: ["bilancio_caricato"],
  },

  // ── FASE 3: VERIFICHE ───────────────────────────────────────────────────────
  {
    id: "analisi_verticale",
    fase: "verifiche",
    ordine: 10,
    titolo: "Analisi verticale e comparativa",
    descrizione: "Analisi della struttura del bilancio (incidenze percentuali) e confronto con anno precedente.",
    riferimentoISA: "ISA Italia 520",
    href: "/analisi-verticale",
    dipendeDa: ["bilancio_caricato"],
  },
  {
    id: "verifica_ricavi_costi",
    fase: "verifiche",
    ordine: 11,
    titolo: "Verifica ricavi e costi",
    descrizione: "Analisi comparativa CE, check anomalie (margine, ammortamenti, oneri finanziari) e checklist procedure.",
    riferimentoISA: "ISA Italia 500/330",
    href: "/verifica-ricavi-costi",
    dipendeDa: ["bilancio_caricato"],
  },
  {
    id: "circolarizzazione",
    fase: "verifiche",
    ordine: 12,
    titolo: "Circolarizzazione saldi",
    descrizione: "Selezione campione AI, invio lettere di conferma a clienti e fornitori, follow-up risposte.",
    riferimentoISA: "ISA Italia 505",
    href: "/circolarizzazione",
    dipendeDa: ["partitario"],
  },
  {
    id: "verifica_incassi",
    fase: "verifiche",
    ordine: 13,
    titolo: "Verifica incassi e pagamenti successivi",
    descrizione: "Matching partitario con estratto conto Q1 anno successivo, verifica pagamenti obbligatori.",
    riferimentoISA: "ISA Italia 560",
    href: "/verifica-incassi",
    dipendeDa: ["partitario", "estratto_conto"],
  },
  {
    id: "scheda_rimanenze",
    fase: "verifiche",
    ordine: 14,
    titolo: "Scheda rimanenze",
    descrizione: "Verifica conteggio fisico, valorizzazione e obsolescenza delle rimanenze di magazzino.",
    riferimentoISA: "ISA Italia 501",
    href: "/scheda-rimanenze",
    dipendeDa: ["bilancio_caricato"],
  },
  {
    id: "scheda_immobilizzazioni",
    fase: "verifiche",
    ordine: 15,
    titolo: "Scheda immobilizzazioni",
    descrizione: "Verifica esistenza, completezza e valutazione delle immobilizzazioni materiali e immateriali.",
    riferimentoISA: "ISA Italia 500",
    href: "/scheda-immobilizzazioni",
    dipendeDa: ["bilancio_caricato"],
  },
  {
    id: "scheda_disponibilita_liquide",
    fase: "verifiche",
    ordine: 16,
    titolo: "Scheda disponibilità liquide",
    descrizione: "Verifica cassa e banche: riconciliazione con estratti conto, conferma saldi.",
    riferimentoISA: "ISA Italia 500",
    href: "/scheda-disponibilita-liquide",
    dipendeDa: ["bilancio_caricato"],
  },
  {
    id: "scheda_patrimonio_netto",
    fase: "verifiche",
    ordine: 17,
    titolo: "Scheda patrimonio netto",
    descrizione: "Verifica composizione PN, variazioni dell'esercizio, distribuzione utili e copertura perdite.",
    riferimentoISA: "ISA Italia 500",
    href: "/scheda-patrimonio-netto",
    dipendeDa: ["bilancio_caricato"],
  },
  {
    id: "scheda_ricavi",
    fase: "verifiche",
    ordine: 18,
    titolo: "Scheda ricavi",
    descrizione: "Verifica completezza, cut-off, concentrazione clienti e ricavi non ricorrenti.",
    riferimentoISA: "ISA Italia 240/315",
    href: "/scheda-ricavi",
    dipendeDa: ["bilancio_caricato"],
  },

  // ── FASE 4: COMPLETAMENTO ───────────────────────────────────────────────────
  {
    id: "eventi_successivi",
    fase: "completamento",
    ordine: 19,
    titolo: "Revisione eventi successivi",
    descrizione: "Identificare eventi dopo la data di chiusura che potrebbero influenzare il bilancio.",
    riferimentoISA: "ISA Italia 560",
    href: "/modulo/5",
    dipendeDa: ["verifica_incassi", "verifica_ricavi_costi"],
  },
  {
    id: "continuita_aziendale",
    fase: "completamento",
    ordine: 20,
    titolo: "Valutazione continuità aziendale",
    descrizione: "Verificare la capacità dell'impresa di continuare ad operare per i prossimi 12 mesi.",
    riferimentoISA: "ISA Italia 570",
    href: "/modulo/3",
    dipendeDa: ["verifica_ricavi_costi"],
  },
];

// ─── ROUTER ───────────────────────────────────────────────────────────────────

export const workflowRevisioneRouter = router({

  /** Segna manualmente uno step come completato (o non completato) */
  segnaStepCompletato: protectedProcedure
    .input(
      z.object({
        incaricoId: z.number(),
        stepId: z.string(),
        completato: z.boolean(),
        noteRevisore: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database non disponibile");

      // Upsert: aggiorna se esiste, inserisce altrimenti
      const existing = await db
        .select({ id: roadmapStepCompletati.id })
        .from(roadmapStepCompletati)
        .where(
          and(
            eq(roadmapStepCompletati.incaricoId, input.incaricoId),
            eq(roadmapStepCompletati.stepId, input.stepId)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(roadmapStepCompletati)
          .set({
            completato: input.completato,
            noteRevisore: input.noteRevisore ?? null,
            dataCompletamento: input.completato ? new Date() : null,
          })
          .where(eq(roadmapStepCompletati.id, existing[0].id));
      } else {
        await db.insert(roadmapStepCompletati).values({
          incaricoId: input.incaricoId,
          stepId: input.stepId,
          completato: input.completato,
          noteRevisore: input.noteRevisore ?? null,
          dataCompletamento: input.completato ? new Date() : null,
        });
      }

      return { success: true, stepId: input.stepId, completato: input.completato };
    }),

  getWorkflow: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database non disponibile");
      const { incaricoId } = input;

      // Carica tutti i dati in parallelo
      const [
        incarico,
        docs,
        modAcc,
        modComp,
        modRischio,
        modMat,
        modPiano,
        circSessioni,
        verificaSessioni,
        sRimanenze,
        sImmobilizzazioni,
        sDisponibilita,
        sPatrimonio,
        sRicavi,
        strategia,
        stepOverrides,
      ] = await Promise.all([
        db.select().from(incarichi).where(eq(incarichi.id, incaricoId)).limit(1),
        db.select({
          id: documenti.id,
          tipoDocumento: documenti.tipoDocumento,
          statoParsing: documenti.statoParsing,
          annoRiferimento: documenti.annoRiferimento,
        }).from(documenti).where(eq(documenti.incaricoId, incaricoId)),
        db.select({ completato: moduloAccettazione.completato, esito: moduloAccettazione.esito })
          .from(moduloAccettazione).where(eq(moduloAccettazione.incaricoId, incaricoId)).limit(1),
        db.select({ id: moduloComprensione.id, completato: moduloComprensione.completato })
          .from(moduloComprensione).where(eq(moduloComprensione.incaricoId, incaricoId)).limit(1),
        db.select({ id: moduloRischio.id, completato: moduloRischio.completato })
          .from(moduloRischio).where(eq(moduloRischio.incaricoId, incaricoId)).limit(1),
        db.select({ id: moduloMaterialita.id, completato: moduloMaterialita.completato, significativita: moduloMaterialita.overallMateriality })
          .from(moduloMaterialita).where(eq(moduloMaterialita.incaricoId, incaricoId)).limit(1),
        db.select({ id: moduloPiano.id, completato: moduloPiano.completato })
          .from(moduloPiano).where(eq(moduloPiano.incaricoId, incaricoId)).limit(1),
        db.select({ id: circolarizzazioneSessioni.id, stato: circolarizzazioneSessioni.stato })
          .from(circolarizzazioneSessioni).where(eq(circolarizzazioneSessioni.incaricoId, incaricoId)),
        db.select({ id: verificaIncassiSessioni.id, stato: verificaIncassiSessioni.stato })
          .from(verificaIncassiSessioni).where(eq(verificaIncassiSessioni.incaricoId, incaricoId)),
        db.select({ id: schedaRimanenze.id, stato: schedaRimanenze.stato })
          .from(schedaRimanenze).where(eq(schedaRimanenze.incaricoId, incaricoId)).limit(1),
        db.select({ id: schedaImmobilizzazioni.id, stato: schedaImmobilizzazioni.stato })
          .from(schedaImmobilizzazioni).where(eq(schedaImmobilizzazioni.incaricoId, incaricoId)).limit(1),
        db.select({ id: schedaDisponibilitaLiquide.id, stato: schedaDisponibilitaLiquide.stato })
          .from(schedaDisponibilitaLiquide).where(eq(schedaDisponibilitaLiquide.incaricoId, incaricoId)).limit(1),
        db.select({ id: schedaPatrimonioNetto.id, stato: schedaPatrimonioNetto.stato })
          .from(schedaPatrimonioNetto).where(eq(schedaPatrimonioNetto.incaricoId, incaricoId)).limit(1),
        db.select({ id: schedaRicavi.id, stato: schedaRicavi.stato })
          .from(schedaRicavi).where(eq(schedaRicavi.incaricoId, incaricoId)).limit(1),
        db.select({ id: strategiaRevisione.id, completata: strategiaRevisione.completata })
          .from(strategiaRevisione).where(eq(strategiaRevisione.incaricoId, incaricoId)).limit(1),
        db.select({ stepId: roadmapStepCompletati.stepId, completato: roadmapStepCompletati.completato, noteRevisore: roadmapStepCompletati.noteRevisore })
          .from(roadmapStepCompletati).where(eq(roadmapStepCompletati.incaricoId, incaricoId)),
      ]);

      // Mappa degli step completati manualmente dal revisore (override)
      const stepOverridesMap: Record<string, { completato: boolean; noteRevisore: string | null }> = {};
      for (const ov of stepOverrides) {
        stepOverridesMap[ov.stepId] = { completato: ov.completato, noteRevisore: ov.noteRevisore };
      }

      const inc = incarico[0];
      const annoN = inc?.annoEsercizio ?? new Date().getFullYear() - 1;

      // ── Calcola stato di ogni step ──────────────────────────────────────────

      const bilancioN = docs.find(d =>
        (d.tipoDocumento === "bilancio_revisione" || d.tipoDocumento === "bilancio_analitico" || d.tipoDocumento === "bilancio") &&
        d.statoParsing === "completato" && d.annoRiferimento === annoN
      ) ?? docs.find(d =>
        (d.tipoDocumento === "bilancio_revisione" || d.tipoDocumento === "bilancio_analitico") &&
        d.statoParsing === "completato"
      );

      const bilancioN1 = docs.find(d =>
        (d.tipoDocumento === "bilancio_storico" || d.tipoDocumento === "bilancio_analitico") &&
        d.statoParsing === "completato" && d.annoRiferimento === annoN - 1
      );

      const hasPartitario = docs.some(d => d.tipoDocumento === "partitario" && d.statoParsing === "completato");
      const hasEstrattoConto = docs.some(d => d.tipoDocumento === "estratto_conto" && d.statoParsing === "completato");

      // Mappa id step → stato calcolato
      const statoMap: Record<string, { stato: StatoStep; perc: number; nota: string }> = {
        accettazione: {
          stato: modAcc[0]?.completato ? "completato" : modAcc[0] ? "in_corso" : "disponibile",
          perc: modAcc[0]?.completato ? 100 : modAcc[0] ? 50 : 0,
          nota: modAcc[0]?.esito === "rifiutato" ? "⚠️ Incarico rifiutato — verificare le motivazioni." :
                modAcc[0]?.completato ? "Accettazione completata." : "Compilare la checklist di accettazione e firmare la lettera di incarico.",
        },
        comprensione: {
          stato: modComp[0]?.completato ? "completato" : modComp[0] ? "in_corso" : "disponibile",
          perc: modComp[0]?.completato ? 100 : modComp[0] ? 40 : 0,
          nota: modComp[0]?.completato ? "Comprensione dell'impresa documentata." : "Raccogliere informazioni su modello di business, settore e struttura organizzativa.",
        },
        valutazione_rischio: {
          stato: modRischio[0]?.completato ? "completato" : modRischio[0] ? "in_corso" : "disponibile",
          perc: modRischio[0]?.completato ? 100 : modRischio[0] ? 40 : 0,
          nota: modRischio[0]?.completato ? "Valutazione del rischio completata." : "Identificare le aree di rischio significativo per ogni asserzione di bilancio.",
        },
        materialita: {
          stato: modMat[0]?.completato ? "completato" : modMat[0]?.significativita ? "in_corso" : bilancioN ? "disponibile" : "bloccato",
          perc: modMat[0]?.completato ? 100 : modMat[0]?.significativita ? 60 : 0,
          nota: !bilancioN ? "Carica prima il bilancio per calcolare la significatività." :
                modMat[0]?.completato ? `Significatività definita: € ${Number(modMat[0].significativita ?? 0).toLocaleString("it-IT")}.` :
                "Calcolare la significatività per il bilancio nel suo complesso e la significatività operativa.",
        },
        piano_revisione: {
          stato: modPiano[0]?.completato ? "completato" : modPiano[0] ? "in_corso" : "disponibile",
          perc: modPiano[0]?.completato ? 100 : modPiano[0] ? 50 : 0,
          nota: modPiano[0]?.completato ? "Piano di revisione definito." : "Definire le procedure di revisione per ogni area di bilancio identificata come rischiosa.",
        },
        bilancio_caricato: {
          stato: bilancioN ? "completato" : docs.some(d => d.tipoDocumento === "bilancio_revisione" || d.tipoDocumento === "bilancio_analitico") ? "in_corso" : "disponibile",
          perc: bilancioN ? 100 : docs.some(d => d.tipoDocumento === "bilancio_revisione" || d.tipoDocumento === "bilancio_analitico") ? 50 : 0,
          nota: bilancioN ? "Bilancio caricato e analizzato. Tutte le verifiche automatiche sono disponibili." :
                docs.some(d => d.tipoDocumento === "bilancio_revisione" || d.tipoDocumento === "bilancio_analitico") ? "Bilancio caricato ma parsing in corso — attendere il completamento." :
                "⚠️ Carica il bilancio CEE o il bilancio analitico per sbloccare tutte le verifiche automatiche.",
        },
        bilancio_storico: {
          stato: bilancioN1 ? "completato" : bilancioN ? "disponibile" : "bloccato",
          perc: bilancioN1 ? 100 : 0,
          nota: bilancioN1 ? "Bilancio anno precedente disponibile — analisi comparativa abilitata." :
                bilancioN ? "Carica il bilancio dell'anno precedente per abilitare l'analisi comparativa e la verifica saldi di apertura (ISA 510)." :
                "Carica prima il bilancio dell'anno corrente.",
        },
        partitario: {
          stato: hasPartitario ? "completato" : bilancioN ? "disponibile" : "bloccato",
          perc: hasPartitario ? 100 : 0,
          nota: hasPartitario ? "Partitario caricato — circolarizzazione e verifica incassi disponibili." :
                bilancioN ? "Carica il partitario clienti/fornitori (Excel o CSV) per abilitare circolarizzazione e verifica incassi." :
                "Carica prima il bilancio.",
        },
        estratto_conto: {
          stato: hasEstrattoConto ? "completato" : bilancioN ? "disponibile" : "bloccato",
          perc: hasEstrattoConto ? 100 : 0,
          nota: hasEstrattoConto ? "Estratto conto caricato — verifica pagamenti obbligatori disponibile." :
                bilancioN ? "Carica l'estratto conto bancario del primo trimestre dell'anno successivo." :
                "Carica prima il bilancio.",
        },
        analisi_verticale: {
          stato: bilancioN ? (bilancioN1 ? "completato" : "in_corso") : "bloccato",
          perc: bilancioN ? (bilancioN1 ? 100 : 60) : 0,
          nota: !bilancioN ? "Carica il bilancio per abilitare l'analisi verticale." :
                !bilancioN1 ? "Analisi verticale disponibile. Carica anche il bilancio anno precedente per l'analisi comparativa completa." :
                "Analisi verticale e comparativa disponibile con entrambi i bilanci.",
        },
        verifica_ricavi_costi: {
          stato: bilancioN ? "disponibile" : "bloccato",
          perc: bilancioN ? 50 : 0,
          nota: !bilancioN ? "Carica il bilancio per abilitare la verifica ricavi e costi." :
                "Analisi comparativa CE, check anomalie e checklist procedure disponibili.",
        },
        circolarizzazione: {
          stato: circSessioni.some(s => s.stato === "chiusa") ? "completato" :
                 circSessioni.length > 0 ? "in_corso" :
                 hasPartitario ? "disponibile" : "bloccato",
          perc: circSessioni.some(s => s.stato === "chiusa") ? 100 :
                circSessioni.length > 0 ? 50 : 0,
          nota: !hasPartitario ? "Carica il partitario per abilitare la circolarizzazione." :
                circSessioni.length === 0 ? "Avvia una sessione di circolarizzazione per selezionare il campione AI." :
                circSessioni.some(s => s.stato === "chiusa") ? "Circolarizzazione completata." :
                "Circolarizzazione in corso — verificare le risposte ricevute.",
        },
        verifica_incassi: {
          stato: verificaSessioni.some(s => s.stato === "completata") ? "completato" :
                 verificaSessioni.length > 0 ? "in_corso" :
                 (hasPartitario && hasEstrattoConto) ? "disponibile" :
                 hasPartitario ? "disponibile" : "bloccato",
          perc: verificaSessioni.some(s => s.stato === "completata") ? 100 :
                verificaSessioni.length > 0 ? 60 : 0,
          nota: !hasPartitario ? "Carica il partitario per abilitare la verifica incassi." :
                !hasEstrattoConto ? "Carica anche l'estratto conto per la verifica dei pagamenti obbligatori." :
                verificaSessioni.length === 0 ? "Avvia una sessione di verifica incassi." :
                "Verifica incassi in corso.",
        },
        scheda_rimanenze: {
          stato: sRimanenze[0]?.stato === "completata" ? "completato" :
                 sRimanenze[0]?.stato === "in_corso" ? "in_corso" :
                 bilancioN ? "disponibile" : "bloccato",
          perc: sRimanenze[0]?.stato === "completata" ? 100 : sRimanenze[0]?.stato === "in_corso" ? 50 : 0,
          nota: !bilancioN ? "Carica il bilancio per abilitare la scheda rimanenze." :
                sRimanenze[0]?.stato === "completata" ? "Scheda rimanenze completata." :
                "Verificare conteggio fisico, valorizzazione e obsolescenza.",
        },
        scheda_immobilizzazioni: {
          stato: sImmobilizzazioni[0]?.stato === "completata" ? "completato" :
                 sImmobilizzazioni[0]?.stato === "in_corso" ? "in_corso" :
                 bilancioN ? "disponibile" : "bloccato",
          perc: sImmobilizzazioni[0]?.stato === "completata" ? 100 : sImmobilizzazioni[0]?.stato === "in_corso" ? 50 : 0,
          nota: !bilancioN ? "Carica il bilancio per abilitare la scheda immobilizzazioni." :
                sImmobilizzazioni[0]?.stato === "completata" ? "Scheda immobilizzazioni completata." :
                "Verificare esistenza, completezza e ammortamenti dei cespiti.",
        },
        scheda_disponibilita_liquide: {
          stato: sDisponibilita[0]?.stato === "completata" ? "completato" :
                 sDisponibilita[0]?.stato === "in_corso" ? "in_corso" :
                 bilancioN ? "disponibile" : "bloccato",
          perc: sDisponibilita[0]?.stato === "completata" ? 100 : sDisponibilita[0]?.stato === "in_corso" ? 50 : 0,
          nota: !bilancioN ? "Carica il bilancio per abilitare la scheda disponibilità liquide." :
                sDisponibilita[0]?.stato === "completata" ? "Scheda disponibilità liquide completata." :
                "Riconciliare i saldi di cassa e banche con gli estratti conto.",
        },
        scheda_patrimonio_netto: {
          stato: sPatrimonio[0]?.stato === "completata" ? "completato" :
                 sPatrimonio[0]?.stato === "in_corso" ? "in_corso" :
                 bilancioN ? "disponibile" : "bloccato",
          perc: sPatrimonio[0]?.stato === "completata" ? 100 : sPatrimonio[0]?.stato === "in_corso" ? 50 : 0,
          nota: !bilancioN ? "Carica il bilancio per abilitare la scheda patrimonio netto." :
                sPatrimonio[0]?.stato === "completata" ? "Scheda patrimonio netto completata." :
                "Verificare composizione PN, variazioni e distribuzione utili.",
        },
        scheda_ricavi: {
          stato: sRicavi[0]?.stato === "completata" ? "completato" :
                 sRicavi[0]?.stato === "in_corso" ? "in_corso" :
                 bilancioN ? "disponibile" : "bloccato",
          perc: sRicavi[0]?.stato === "completata" ? 100 : sRicavi[0]?.stato === "in_corso" ? 50 : 0,
          nota: !bilancioN ? "Carica il bilancio per abilitare la scheda ricavi." :
                sRicavi[0]?.stato === "completata" ? "Scheda ricavi completata." :
                "Verificare completezza, cut-off e concentrazione clienti.",
        },
        eventi_successivi: {
          stato: stepOverridesMap["eventi_successivi"]?.completato ? "completato" : "disponibile",
          perc: stepOverridesMap["eventi_successivi"]?.completato ? 100 : 0,
          nota: stepOverridesMap["eventi_successivi"]?.completato
            ? `Revisione eventi successivi completata.${stepOverridesMap["eventi_successivi"].noteRevisore ? " Note: " + stepOverridesMap["eventi_successivi"].noteRevisore : ""}`
            : "Identificare eventi dopo la data di chiusura che potrebbero influenzare il bilancio (ISA 560).",
        },
        continuita_aziendale: {
          stato: stepOverridesMap["continuita_aziendale"]?.completato ? "completato" : "disponibile",
          perc: stepOverridesMap["continuita_aziendale"]?.completato ? 100 : 0,
          nota: stepOverridesMap["continuita_aziendale"]?.completato
            ? `Valutazione continuità aziendale completata.${stepOverridesMap["continuita_aziendale"].noteRevisore ? " Note: " + stepOverridesMap["continuita_aziendale"].noteRevisore : ""}`
            : "Valutare la capacità dell'impresa di continuare ad operare per i prossimi 12 mesi (ISA 570).",
        },
      };

      // ── Calcola priorità contestuale ────────────────────────────────────────
      const prioritaMap: Record<string, PrioritaStep> = {
        accettazione: "critica",
        bilancio_caricato: "critica",
        comprensione: "alta",
        valutazione_rischio: "alta",
        materialita: "alta",
        piano_revisione: "alta",
        bilancio_storico: "alta",
        partitario: "alta",
        estratto_conto: "media",
        analisi_verticale: "alta",
        verifica_ricavi_costi: "alta",
        circolarizzazione: "alta",
        verifica_incassi: "alta",
        scheda_rimanenze: "media",
        scheda_immobilizzazioni: "media",
        scheda_disponibilita_liquide: "media",
        scheda_patrimonio_netto: "media",
        scheda_ricavi: "alta",
        eventi_successivi: "media",
        continuita_aziendale: "media",
      };

         // ── Costruisce gli step finali ──────────────────────────────────────────
      const steps: (StepWorkflow & { completatoManualmente?: boolean })[] = STEP_DEFINIZIONI.map(def => {
        const s = statoMap[def.id] ?? { stato: "disponibile" as StatoStep, perc: 0, nota: "" };
        // Verifica dipendenze: se una dipendenza è bloccata, questo step è bloccato
        const dipendenzaBloccata = def.dipendeDa.some(dep => {
          const depStato = statoMap[dep]?.stato;
          return depStato === "bloccato";
        });
        // Calcola href completo
        const href = def.href ? `/incarichi/${incaricoId}${def.href}` : `/incarichi/${incaricoId}`;
        // Override manuale: se il revisore ha segnato manualmente lo step, ha precedenza
        // (ma non sovrascrive gli step già completati automaticamente)
        const override = stepOverridesMap[def.id];
        let statoFinale: StatoStep = dipendenzaBloccata ? "bloccato" : s.stato;
        let percFinale = s.perc;
        let notaFinale = s.nota;
        let completatoManualmente = false;
        if (override && !dipendenzaBloccata) {
          if (override.completato && s.stato !== "completato") {
            // Segna come completato manualmente (override)
            statoFinale = "completato";
            percFinale = 100;
            notaFinale = `Completato manualmente dal revisore.${override.noteRevisore ? " Note: " + override.noteRevisore : ""}`;
            completatoManualmente = true;
          } else if (!override.completato && s.stato === "completato" && completatoManualmente) {
            // Rimuovi override (torna allo stato automatico)
            statoFinale = s.stato;
            percFinale = s.perc;
            notaFinale = s.nota;
            completatoManualmente = false;
          }
          // Se override.completato ma lo step è già completato automaticamente: non cambia nulla
          if (override.completato && s.stato === "completato") {
            completatoManualmente = false; // già completato automaticamente
          }
        }
        return {
          ...def,
          href,
          stato: statoFinale,
          priorita: prioritaMap[def.id] ?? "bassa",
          notaRevisore: notaFinale,
          percentualeCompletamento: percFinale,
          completatoManualmente,
        };
      });

      // ── Calcola avanzamento globale ─────────────────────────────────────────
      const stepsConPeso = steps.filter(s => s.stato !== "bloccato");
      const percGlobale = stepsConPeso.length > 0
        ? Math.round(stepsConPeso.reduce((acc, s) => acc + s.percentualeCompletamento, 0) / stepsConPeso.length)
        : 0;

      const stepsCompletati = steps.filter(s => s.stato === "completato").length;
      const stepsDisponibili = steps.filter(s => s.stato === "disponibile" || s.stato === "in_corso");

      // Prossimo step consigliato: il primo disponibile/in_corso con priorità più alta
      const ordinePriorita: PrioritaStep[] = ["critica", "alta", "media", "bassa"];
      const prossimoStep = stepsDisponibili
        .sort((a, b) => {
          const pa = ordinePriorita.indexOf(a.priorita);
          const pb = ordinePriorita.indexOf(b.priorita);
          if (pa !== pb) return pa - pb;
          return a.ordine - b.ordine;
        })[0] ?? null;

      return {
        steps,
        percGlobale,
        stepsCompletati,
        stepsTotali: steps.length,
        prossimoStep: prossimoStep ? {
          id: prossimoStep.id,
          titolo: prossimoStep.titolo,
          href: prossimoStep.href,
          nota: prossimoStep.notaRevisore,
          priorita: prossimoStep.priorita,
        } : null,
        annoN,
        hasBilancio: !!bilancioN,
        hasBilancioStorico: !!bilancioN1,
        hasPartitario,
        hasEstrattoConto,
      };
    }),

  /** Recupera lo storico note di uno step specifico */
  getStepNote: protectedProcedure
    .input(z.object({ incaricoId: z.number(), stepId: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database non disponibile");
      const { desc } = await import("drizzle-orm");
      const note = await db
        .select()
        .from(roadmapStepNote)
        .where(
          and(
            eq(roadmapStepNote.incaricoId, input.incaricoId),
            eq(roadmapStepNote.stepId, input.stepId)
          )
        )
        .orderBy(desc(roadmapStepNote.createdAt));
      return note;
    }),

  /** Aggiunge una nota allo storico di uno step */
  aggiungiNotaStep: protectedProcedure
    .input(z.object({
      incaricoId: z.number(),
      stepId: z.string(),
      nota: z.string().min(1).max(2000),
      autore: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database non disponibile");
      await db.insert(roadmapStepNote).values({
        incaricoId: input.incaricoId,
        stepId: input.stepId,
        nota: input.nota,
        autore: input.autore ?? null,
      });
      return { ok: true };
    }),
});
