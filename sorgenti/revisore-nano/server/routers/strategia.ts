import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  incarichi,
  documenti,
  strategiaRevisione,
  areeControllo,
  moduloMaterialita,
  moduloRischio,
} from "../../drizzle/schema";
import { invokeLLM } from "../_core/llm";

// ─── TIPI INTERNI ─────────────────────────────────────────────────────────────

const AREE_BILANCIO = [
  { area: "crediti_clienti", label: "Crediti verso clienti", isa: "ISA Italia 505" },
  { area: "debiti_fornitori", label: "Debiti verso fornitori", isa: "ISA Italia 500" },
  { area: "rimanenze", label: "Rimanenze di magazzino", isa: "ISA Italia 501" },
  { area: "immobilizzazioni_mat", label: "Immobilizzazioni materiali", isa: "ISA Italia 500/501" },
  { area: "immobilizzazioni_immat", label: "Immobilizzazioni immateriali", isa: "ISA Italia 500" },
  { area: "disponibilita_liquide", label: "Disponibilità liquide", isa: "ISA Italia 500/505" },
  { area: "patrimonio_netto", label: "Patrimonio netto", isa: "ISA Italia 500" },
  { area: "ricavi_costi", label: "Ricavi e costi operativi", isa: "ISA Italia 240/315" },
  { area: "debiti_tributari", label: "Debiti tributari e previdenziali", isa: "ISA Italia 500" },
  { area: "fondi_rischi", label: "Fondi rischi e oneri", isa: "ISA Italia 500" },
  { area: "parti_correlate", label: "Parti correlate", isa: "ISA Italia 550" },
  { area: "continuita_aziendale", label: "Continuità aziendale", isa: "ISA Italia 570" },
] as const;

/** Estrae i dati strutturati dai bilanci storici caricati */
async function getDatiStorici(incaricoId: number) {
  const db = await getDb();
  if (!db) return [];
  const docs = await db
    .select()
    .from(documenti)
    .where(
      and(
        eq(documenti.incaricoId, incaricoId),
        eq(documenti.statoParsing, "completato")
      )
    )
    .orderBy(documenti.annoRiferimento);

  // Raccoglie solo bilanci storici e di revisione con dati strutturati
  return docs
    .filter(d => ["bilancio_storico", "bilancio_revisione", "bilancio"].includes(d.tipoDocumento ?? ""))
    .filter(d => d.datiStrutturati != null)
    .map(d => ({
      anno: d.annoRiferimento,
      tipo: d.tipoDocumento,
      dati: d.datiStrutturati as Record<string, any>,
    }));
}

/** Costruisce un riepilogo testuale dei bilanci storici per il prompt AI */
function riepilogoBilanciPerPrompt(storici: { anno: number | null; tipo: string | null; dati: Record<string, any> }[]): string {
  if (storici.length === 0) return "Nessun bilancio disponibile.";
  return storici
    .sort((a, b) => (a.anno ?? 0) - (b.anno ?? 0))
    .map(s => {
      const d = s.dati;
      const flat = d.flat ?? d;
      const ricavi = flat.ricavi_netti ?? flat.ricavi ?? flat.A1 ?? flat.valore_produzione ?? "n.d.";
      const attivo = flat.totale_attivo ?? flat.totale_attivo_netto ?? "n.d.";
      const pn = flat.patrimonio_netto ?? flat.totale_patrimonio_netto ?? "n.d.";
      const utile = flat.utile_perdita ?? flat.utile_netto ?? flat.risultato_esercizio ?? "n.d.";
      const debiti = flat.totale_debiti ?? flat.debiti ?? "n.d.";
      return `Anno ${s.anno ?? "n.d."} (${s.tipo}): Ricavi=${ricavi}, Attivo=${attivo}, PN=${pn}, Utile=${utile}, Debiti=${debiti}`;
    })
    .join("\n");
}

// ─── ROUTER PRINCIPALE ────────────────────────────────────────────────────────

export const strategiaRouter = router({

  /** Recupera la strategia corrente per una fase */
  get: protectedProcedure
    .input(z.object({ incaricoId: z.number(), fase: z.enum(["accettazione", "revisione"]) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const rows = await db
        .select()
        .from(strategiaRevisione)
        .where(
          and(
            eq(strategiaRevisione.incaricoId, input.incaricoId),
            eq(strategiaRevisione.fase, input.fase)
          )
        )
        .orderBy(desc(strategiaRevisione.createdAt))
        .limit(1);
      return rows[0] ?? null;
    }),

  /** Genera la strategia di accettazione analizzando i bilanci storici */
  generaAccettazione: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database non disponibile");

      const storici = await getDatiStorici(input.incaricoId);
      const riepilogo = riepilogoBilanciPerPrompt(storici);

      // Recupera dati incarico
      const [inc] = await db.select().from(incarichi).where(eq(incarichi.id, input.incaricoId));
      if (!inc) throw new Error("Incarico non trovato");

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `Sei un esperto revisore legale italiano specializzato in nano-imprese (art. 2435-ter c.c.).
Analizza i dati di bilancio storici forniti e produci una valutazione per la fase di ACCETTAZIONE dell'incarico di revisione.
Applica ISA Italia 210, 220, 300, 315, 320, 570.
Rispondi ESCLUSIVAMENTE con JSON valido, senza testo aggiuntivo.`,
          },
          {
            role: "user",
            content: `Incarico di revisione legale per l'esercizio ${inc.annoEsercizio}.
Tipo: ${inc.tipoIncarico}.

BILANCI STORICI DISPONIBILI:
${riepilogo}

Genera la valutazione per l'accettazione con questo schema JSON esatto:
{
  "analisiTrendStorici": "Testo narrativo (3-5 frasi) sull'andamento storico dell'impresa",
  "indicatoriRischio": [
    { "indicatore": "nome", "valore": "valore o descrizione", "semaforo": "verde|giallo|rosso", "nota": "spiegazione breve" }
  ],
  "areeRischioIdentificate": [
    { "area": "nome area ISA", "livello": "basso|medio|alto|critico", "motivazione": "spiegazione" }
  ],
  "pianoStrategico": "Testo narrativo del piano strategico preliminare (5-8 frasi): approccio di revisione suggerito, aree prioritarie, procedure chiave da pianificare, avvertenze ISA 510 per saldi di apertura se primo incarico",
  "prioritaControlli": [
    { "area": "nome area", "priorita": 1, "procedureSuggerite": ["procedura 1", "procedura 2"], "motivazione": "perché è prioritaria" }
  ],
  "raccomandazioneAccettazione": "accetta|accetta_con_riserva|rifiuta",
  "motivazioneAccettazione": "Spiegazione della raccomandazione"
}
Ordina prioritaControlli per priorità crescente (1=massima priorità). Includi almeno 5 aree.`,
          },
        ],
      });

      const rawContent = response.choices[0]?.message?.content ?? "{}";
      const content = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);
      let parsed: Record<string, any> = {};
      try {
        parsed = JSON.parse(content);
      } catch {
        // Estrai JSON dal testo se necessario
        const match = content.match(/\{[\s\S]*\}/);
        if (match) {
          try { parsed = JSON.parse(match[0]); } catch { parsed = {}; }
        }
      }

      // Salva o aggiorna la strategia di accettazione
      const existing = await db
        .select()
        .from(strategiaRevisione)
        .where(
          and(
            eq(strategiaRevisione.incaricoId, input.incaricoId),
            eq(strategiaRevisione.fase, "accettazione")
          )
        )
        .limit(1);

      const datiSalvataggio = {
        incaricoId: input.incaricoId,
        fase: "accettazione" as const,
        analisiTrendStorici: parsed.analisiTrendStorici ?? null,
        indicatoriRischio: parsed.indicatoriRischio ?? [],
        areeRischioIdentificate: parsed.areeRischioIdentificate ?? [],
        pianoStrategico: parsed.pianoStrategico ?? null,
        prioritaControlli: parsed.prioritaControlli ?? [],
        variazioniSignificative: null,
        noteRevisore: null,
        generataConAi: true,
        completata: false,
      };

      if (existing.length > 0) {
        await db.update(strategiaRevisione).set(datiSalvataggio).where(eq(strategiaRevisione.id, existing[0].id));
      } else {
        await db.insert(strategiaRevisione).values(datiSalvataggio);
      }

      return {
        ...parsed,
        bilancipresenti: storici.length,
      };
    }),

  /** Avanza l'incarico dalla fase accettazione alla fase revisione */
  avanzaARevisione: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database non disponibile");
      await db
        .update(incarichi)
        .set({ faseCorrente: "revisione", stato: "in_corso" })
        .where(eq(incarichi.id, input.incaricoId));
      return { success: true };
    }),

  /** Genera la strategia aggiornata per la fase di revisione effettiva */
  generaRevisione: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database non disponibile");

      const [inc] = await db.select().from(incarichi).where(eq(incarichi.id, input.incaricoId));
      if (!inc) throw new Error("Incarico non trovato");

      // Recupera tutti i bilanci (storici + corrente)
      const tuttiBilanci = await getDatiStorici(input.incaricoId);
      const bilanciStorici = tuttiBilanci.filter(b => b.tipo === "bilancio_storico");
      const bilancioCorrente = tuttiBilanci.find(b => b.tipo === "bilancio_revisione" || (b.tipo === "bilancio" && b.anno === inc.annoEsercizio));

      // Recupera materialità e rischio se disponibili
      const [materialita] = await db.select().from(moduloMaterialita).where(eq(moduloMaterialita.incaricoId, input.incaricoId));
      const [rischio] = await db.select().from(moduloRischio).where(eq(moduloRischio.incaricoId, input.incaricoId));

      // Recupera strategia di accettazione per continuità
      const [stratAccettazione] = await db
        .select()
        .from(strategiaRevisione)
        .where(and(eq(strategiaRevisione.incaricoId, input.incaricoId), eq(strategiaRevisione.fase, "accettazione")))
        .limit(1);

      const riepilogoStorici = riepilogoBilanciPerPrompt(bilanciStorici);
      const riepilogoCorrente = bilancioCorrente
        ? riepilogoBilanciPerPrompt([bilancioCorrente])
        : "Bilancio corrente non ancora caricato.";

      const pmText = materialita?.performanceMateriality
        ? `Performance Materiality: ${parseFloat(materialita.performanceMateriality).toLocaleString("it-IT")} €`
        : "Materialità non ancora calcolata";

      const rmmText = rischio?.rmmPunteggio
        ? `RMM: ${rischio.rmmPunteggio}/9 (RI=${rischio.rischioInerentePunteggio}, RC=${rischio.rischioControlloPunteggio})`
        : "Rischio non ancora valutato";

      const pianoPreliminare = stratAccettazione?.pianoStrategico ?? "Non disponibile";

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `Sei un esperto revisore legale italiano specializzato in nano-imprese.
Stai conducendo la FASE DI REVISIONE EFFETTIVA. Hai già completato la fase di accettazione.
Analizza il bilancio corrente confrontandolo con gli storici e genera la strategia di revisione aggiornata.
Applica ISA Italia 300, 315, 330, 500, 501, 505, 240, 320, 570.
Rispondi ESCLUSIVAMENTE con JSON valido.`,
          },
          {
            role: "user",
            content: `Revisione esercizio ${inc.annoEsercizio}.
${pmText}
${rmmText}

PIANO STRATEGICO PRELIMINARE (fase accettazione):
${pianoPreliminare}

BILANCI STORICI:
${riepilogoStorici}

BILANCIO CORRENTE (${inc.annoEsercizio}):
${riepilogoCorrente}

Genera la strategia di revisione aggiornata con questo schema JSON esatto:
{
  "analisiTrendStorici": "Confronto narrativo storico vs corrente (3-5 frasi): variazioni significative, conferme o nuovi rischi emersi",
  "variazioniSignificative": [
    { "voce": "nome voce", "valoreStorico": 0, "valoreCorrente": 0, "delta": 0, "deltaPerc": 0, "segnalazione": "normale|attenzione|critica", "nota": "commento" }
  ],
  "indicatoriRischio": [
    { "indicatore": "nome", "valore": "valore", "semaforo": "verde|giallo|rosso", "nota": "spiegazione" }
  ],
  "areeRischioIdentificate": [
    { "area": "nome area", "livello": "basso|medio|alto|critico", "motivazione": "spiegazione aggiornata con dati correnti" }
  ],
  "pianoStrategico": "Piano di revisione aggiornato (6-10 frasi): approccio definitivo, procedure chiave per area, tempistica suggerita, priorità assolute",
  "prioritaControlli": [
    {
      "area": "nome area",
      "areaDb": "crediti_clienti|debiti_fornitori|rimanenze|immobilizzazioni_mat|immobilizzazioni_immat|disponibilita_liquide|patrimonio_netto|ricavi_costi|debiti_tributari|fondi_rischi|parti_correlate|continuita_aziendale",
      "priorita": 1,
      "livelloRischio": "basso|medio|alto|critico",
      "valoreBilancio": 0,
      "valoreStorico": 0,
      "procedureSuggerite": [
        { "procedura": "descrizione procedura", "isa": "ISA riferimento", "priorita": "alta|media|bassa" }
      ],
      "motivazione": "perché è prioritaria"
    }
  ]
}
Includi TUTTE le aree rilevanti. Ordina prioritaControlli per priorità crescente (1=massima).`,
          },
        ],
      });

      const rawContent2 = response.choices[0]?.message?.content ?? "{}";
      const content = typeof rawContent2 === "string" ? rawContent2 : JSON.stringify(rawContent2);
      let parsed: Record<string, any> = {};
      try {
        parsed = JSON.parse(content);
      } catch {
        const match = content.match(/\{[\s\S]*\}/);
        if (match) {
          try { parsed = JSON.parse(match[0]); } catch { parsed = {}; }
        }
      }

      // Salva strategia di revisione
      const existing = await db
        .select()
        .from(strategiaRevisione)
        .where(and(eq(strategiaRevisione.incaricoId, input.incaricoId), eq(strategiaRevisione.fase, "revisione")))
        .limit(1);

      const datiSalvataggio = {
        incaricoId: input.incaricoId,
        fase: "revisione" as const,
        analisiTrendStorici: parsed.analisiTrendStorici ?? null,
        indicatoriRischio: parsed.indicatoriRischio ?? [],
        areeRischioIdentificate: parsed.areeRischioIdentificate ?? [],
        pianoStrategico: parsed.pianoStrategico ?? null,
        prioritaControlli: parsed.prioritaControlli ?? [],
        variazioniSignificative: parsed.variazioniSignificative ?? [],
        noteRevisore: null,
        generataConAi: true,
        completata: false,
      };

      if (existing.length > 0) {
        await db.update(strategiaRevisione).set(datiSalvataggio).where(eq(strategiaRevisione.id, existing[0].id));
      } else {
        await db.insert(strategiaRevisione).values(datiSalvataggio);
      }

      // Crea/aggiorna le aree di controllo nel DB
      const priorita = (parsed.prioritaControlli ?? []) as any[];
      for (const p of priorita) {
        if (!p.areaDb) continue;
        const existingArea = await db
          .select()
          .from(areeControllo)
          .where(and(eq(areeControllo.incaricoId, input.incaricoId), eq(areeControllo.area, p.areaDb)))
          .limit(1);

        const datiArea = {
          incaricoId: input.incaricoId,
          area: p.areaDb,
          valoreBilancio: p.valoreBilancio ? String(p.valoreBilancio) : null,
          valoreStorico: p.valoreStorico ? String(p.valoreStorico) : null,
          deltaPercentuale: p.valoreStorico && p.valoreBilancio && p.valoreStorico !== 0
            ? String(((p.valoreBilancio - p.valoreStorico) / Math.abs(p.valoreStorico) * 100).toFixed(2))
            : null,
          livelloRischio: p.livelloRischio ?? "medio",
          motivazioneRischio: p.motivazione ?? null,
          procedureSuggerite: p.procedureSuggerite ?? [],
          stato: "da_iniziare" as const,
        };

        if (existingArea.length > 0) {
          await db.update(areeControllo).set(datiArea).where(eq(areeControllo.id, existingArea[0].id));
        } else {
          await db.insert(areeControllo).values(datiArea);
        }
      }

      return { ...parsed, areeCreate: priorita.length };
    }),

  /** Recupera tutte le aree di controllo per un incarico */
  getAreeControllo: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(areeControllo)
        .where(eq(areeControllo.incaricoId, input.incaricoId))
        .orderBy(areeControllo.livelloRischio);
    }),

  /** Aggiorna lo stato e le note di un'area di controllo */
  aggiornaAreaControllo: protectedProcedure
    .input(z.object({
      areaId: z.number(),
      stato: z.enum(["da_iniziare", "in_corso", "completata", "non_applicabile"]).optional(),
      noteRevisore: z.string().optional(),
      evidenze: z.array(z.object({ tipo: z.string(), descrizione: z.string(), riferimento: z.string().optional() })).optional(),
      sessioneCircolarizzazioneId: z.number().optional(),
      sessioneVerificaIncassiId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database non disponibile");
      const { areaId, ...updates } = input;
      await db.update(areeControllo).set(updates).where(eq(areeControllo.id, areaId));
      return { success: true };
    }),

  /** Aggiorna le note della strategia */
  aggiornaNote: protectedProcedure
    .input(z.object({ strategiaId: z.number(), noteRevisore: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database non disponibile");
      await db.update(strategiaRevisione).set({ noteRevisore: input.noteRevisore }).where(eq(strategiaRevisione.id, input.strategiaId));
      return { success: true };
    }),

  /** Recupera metadati incarico inclusa faseCorrente */
  getFaseIncarico: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const [inc] = await db.select().from(incarichi).where(eq(incarichi.id, input.incaricoId));
      return inc ? { faseCorrente: inc.faseCorrente, stato: inc.stato, annoEsercizio: inc.annoEsercizio } : null;
    }),
});
