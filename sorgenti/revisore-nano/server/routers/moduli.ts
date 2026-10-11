import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  getModuloAccettazione, upsertModuloAccettazione,
  getModuloComprensione, upsertModuloComprensione,
  getModuloRischio, upsertModuloRischio,
  getModuloMaterialita, upsertModuloMaterialita,
  getModuloPiano, upsertModuloPiano,
  getDocumentiByIncarico,
  getIncaricoById,
  getClienteById,
  updateIncarico,
  createAlert,
} from "../db";
import { invokeLLM } from "../_core/llm";
import { notifyOwner } from "../_core/notification";

// ─── Helper: costruisce il contesto bilancio per l'AI ────────────────────────
async function buildContextoBilancio(incaricoId: number): Promise<string> {
  const docs = await getDocumentiByIncarico(incaricoId);
  const docsConDati = docs.filter(d => d.datiStrutturati && d.statoParsing === "completato");
  if (docsConDati.length === 0) return "Nessun documento di bilancio disponibile.";
  const contesti = docsConDati.map(d => `Documento: ${d.nomeFile}\n${JSON.stringify(d.datiStrutturati, null, 2)}`);
  return contesti.join("\n\n---\n\n").substring(0, 4000);
}

// ─── Helper: calcola materialità ─────────────────────────────────────────────
function calcolaMaterialita(
  valore: number,
  percentuale: number,
  primoIncarico: boolean,
  erroriPrecedenti: boolean,
  controlliDeboli: boolean
) {
  const om = valore * (percentuale / 100);
  let fattore = 0.70;
  if (primoIncarico) fattore -= 0.10;
  if (erroriPrecedenti) fattore -= 0.10;
  if (controlliDeboli) fattore -= 0.05;
  fattore = Math.max(fattore, 0.50);
  const pm = om * fattore;
  const ctt = om * 0.05;
  return { om: Math.round(om * 100) / 100, pm: Math.round(pm * 100) / 100, ctt: Math.round(ctt * 100) / 100, fattore };
}

// ─── MODULO 1: ACCETTAZIONE ───────────────────────────────────────────────────
const accettazioneRouter = router({
  get: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .query(async ({ input }) => getModuloAccettazione(input.incaricoId)),

  save: protectedProcedure
    .input(z.object({
      incaricoId: z.number(),
      indipendenzaVerificata: z.boolean().optional(),
      competenzaVerificata: z.boolean().optional(),
      integritaManagementVerificata: z.boolean().optional(),
      rischioIncaricoPrecedente: z.boolean().optional(),
      conflittiInteresseVerificati: z.boolean().optional(),
      onorarioDefinito: z.boolean().optional(),
      letteraIncaricoFirmata: z.boolean().optional(),
      esito: z.enum(["accettato", "rifiutato", "sospeso", "in_valutazione"]).optional(),
      motivazioneEsito: z.string().optional(),
      completato: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { incaricoId, completato, ...rest } = input;
      const result = await upsertModuloAccettazione({ incaricoId, ...rest, completato: completato ?? false });
      if (completato) await updateIncarico(incaricoId, { statoModulo1: 2 });
      return result;
    }),

  analisiAi: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .mutation(async ({ input }) => {
      const incarico = await getIncaricoById(input.incaricoId);
      if (!incarico) throw new TRPCError({ code: "NOT_FOUND" });
      const cliente = await getClienteById(incarico.clienteId);
      const contestoBilancio = await buildContextoBilancio(input.incaricoId);

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `Sei un esperto revisore legale italiano. Analizza l'incarico di revisione e fornisci una valutazione per l'accettazione/continuazione conforme a ISA Italia 210 e 220. Sii conciso e pratico.`,
          },
          {
            role: "user",
            content: `Cliente: ${cliente?.ragioneSociale || "N/D"} | Forma giuridica: ${cliente?.formaGiuridica || "N/D"} | Settore: ${cliente?.settore || "N/D"} | Anno esercizio: ${incarico.annoEsercizio} | Tipo incarico: ${incarico.tipoIncarico}

Dati bilancio disponibili:
${contestoBilancio}

Fornisci:
1. Valutazione rischi di accettazione (max 3 punti critici)
2. Elementi da verificare prima dell'accettazione (ISA Italia 210/220)
3. Raccomandazione: ACCETTARE / APPROFONDIRE / NON ACCETTARE
4. Motivazione sintetica (max 3 righe)`,
          },
        ],
      });

      const analisi = typeof response.choices[0]?.message?.content === 'string'
        ? response.choices[0].message.content
        : "Analisi non disponibile.";

      // Salva l'analisi AI
      await upsertModuloAccettazione({ incaricoId: input.incaricoId, analisiAi: analisi });
      await updateIncarico(input.incaricoId, { statoModulo1: 1 });

      return { analisi };
    }),
});

// ─── MODULO 2: COMPRENSIONE IMPRESA ──────────────────────────────────────────
const comprensionRouter = router({
  get: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .query(async ({ input }) => getModuloComprensione(input.incaricoId)),

  save: protectedProcedure
    .input(z.object({
      incaricoId: z.number(),
      totaleAttivo: z.number().optional(),
      ricaviNetti: z.number().optional(),
      patrimonioNetto: z.number().optional(),
      utilePerditaEsercizio: z.number().optional(),
      numeroDipendenti: z.number().optional(),
      debitiTotali: z.number().optional(),
      creditiTotali: z.number().optional(),
      disponibilitaLiquide: z.number().optional(),
      settoreAttivita: z.string().optional(),
      completato: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { incaricoId, completato, totaleAttivo, ricaviNetti, ...rest } = input;

      // Calcola automaticamente se è nano impresa
      let isNanoImpresa: boolean | undefined;
      let motivazioneNano: string | undefined;
      if (totaleAttivo !== undefined && ricaviNetti !== undefined && input.numeroDipendenti !== undefined) {
        const limiti = [
          totaleAttivo <= 175000,
          ricaviNetti <= 350000,
          input.numeroDipendenti <= 5,
        ];
        const superati = limiti.filter(Boolean).length;
        isNanoImpresa = superati >= 2;
        motivazioneNano = `Supera ${3 - superati} su 3 limiti nano impresa (art. 2435-ter c.c.): Attivo ≤175k€ [${limiti[0] ? "OK" : "NO"}], Ricavi ≤350k€ [${limiti[1] ? "OK" : "NO"}], Dipendenti ≤5 [${limiti[2] ? "OK" : "NO"}]`;
      }

      // Calcola indici di bilancio se disponibili
      let indici: Record<string, number | null> = {};
      if (totaleAttivo && ricaviNetti && input.patrimonioNetto && input.debitiTotali) {
        indici = {
          adeguatezzaPatrimoniale: input.debitiTotali > 0 ? Math.round((input.patrimonioNetto! / input.debitiTotali) * 1000) / 1000 : null,
          incidenzaDebiti: totaleAttivo > 0 ? Math.round((input.debitiTotali / totaleAttivo) * 1000) / 1000 : null,
          redditivitaVendite: ricaviNetti > 0 && input.utilePerditaEsercizio !== undefined ? Math.round((input.utilePerditaEsercizio / ricaviNetti) * 1000) / 1000 : null,
        } as Record<string, number | null>;
      }

      const result = await upsertModuloComprensione({
        incaricoId,
        totaleAttivo: totaleAttivo?.toString(),
        ricaviNetti: ricaviNetti?.toString(),
        ...Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, typeof v === 'number' ? v.toString() : v])),
        isNanoImpresa,
        motivazioneNano,
        indici,
        completato: completato ?? false,
      });

      if (completato) await updateIncarico(incaricoId, { statoModulo2: 2 });

      // Alert going concern se perdita
      if (input.utilePerditaEsercizio !== undefined && input.utilePerditaEsercizio < 0) {
        await createAlert({
          incaricoId,
          modulo: "comprensione",
          tipoAlert: "going_concern",
          severita: "warning",
          titolo: "Perdita di esercizio — verificare continuità aziendale",
          messaggio: `L'impresa presenta una perdita di ${Math.abs(input.utilePerditaEsercizio).toLocaleString("it-IT")} €. Applicare le procedure ISA Italia 570 per la valutazione della continuità aziendale.`,
          datiContesto: { utile: input.utilePerditaEsercizio, ricavi: ricaviNetti },
        });
      }

      return result;
    }),

  estraiDaBilancio: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .mutation(async ({ input }) => {
      const docs = await getDocumentiByIncarico(input.incaricoId);
      const bilanci = docs.filter(d => d.tipoDocumento === "bilancio" && d.datiStrutturati && d.statoParsing === "completato");

      if (bilanci.length === 0) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Nessun bilancio analizzato disponibile. Carica e analizza prima un documento di bilancio." });

      // Prende i dati dal bilancio più recente
      const bilancio = bilanci[0];
      const dati = bilancio.datiStrutturati as Record<string, any>;

      return {
        totaleAttivo: dati.totaleAttivo || dati.statoPatrimoniale?.totaleAttivo,
        ricaviNetti: dati.ricavi || dati.contoEconomico?.ricaviVendite,
        patrimonioNetto: dati.patrimonioNetto || dati.statoPatrimoniale?.patrimoniNetto,
        utilePerditaEsercizio: dati.utile || dati.contoEconomico?.utileNetto,
        debitiTotali: dati.debitiTotali || dati.statoPatrimoniale?.totalDebiti,
        disponibilitaLiquide: dati.statoPatrimoniale?.disponibilitaLiquide,
        creditiTotali: dati.statoPatrimoniale?.creditiEntro12Mesi,
        fonte: bilancio.nomeFile,
      };
    }),

  sintesiAi: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .mutation(async ({ input }) => {
      const incarico = await getIncaricoById(input.incaricoId);
      const cliente = await getClienteById(incarico!.clienteId);
      const comprensione = await getModuloComprensione(input.incaricoId);
      const contestoBilancio = await buildContextoBilancio(input.incaricoId);

      const response = await invokeLLM({
        messages: [
          { role: "system", content: "Sei un esperto revisore legale italiano. Fornisci una sintesi professionale e concisa del contesto aziendale per il fascicolo di revisione." },
          {
            role: "user",
            content: `Azienda: ${cliente?.ragioneSociale} | Settore: ${cliente?.settore || comprensione?.settoreAttivita || "N/D"} | Anno: ${incarico?.annoEsercizio}

Dati bilancio:
- Totale attivo: ${comprensione?.totaleAttivo || "N/D"} €
- Ricavi netti: ${comprensione?.ricaviNetti || "N/D"} €
- Patrimonio netto: ${comprensione?.patrimonioNetto || "N/D"} €
- Utile/perdita: ${comprensione?.utilePerditaEsercizio || "N/D"} €
- Dipendenti: ${comprensione?.numeroDipendenti || "N/D"}
- Nano impresa: ${comprensione?.isNanoImpresa ? "Sì" : "No"}

Contesto documenti:
${contestoBilancio}

Fornisci (max 200 parole):
1. Descrizione sintetica dell'attività e del contesto
2. Principali caratteristiche economico-patrimoniali
3. Rischi specifici del settore rilevanti per la revisione (ISA Italia 315)`,
          },
        ],
      });

      const sintesi = typeof response.choices[0]?.message?.content === 'string'
        ? response.choices[0].message.content
        : "Sintesi non disponibile.";

      await upsertModuloComprensione({ incaricoId: input.incaricoId, sintesiAi: sintesi });
      await updateIncarico(input.incaricoId, { statoModulo2: 1 });

      return { sintesi };
    }),
});

// ─── MODULO 3: VALUTAZIONE RISCHIO ───────────────────────────────────────────
const rischioRouter = router({
  get: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .query(async ({ input }) => getModuloRischio(input.incaricoId)),

  save: protectedProcedure
    .input(z.object({
      incaricoId: z.number(),
      rischioInerentePunteggio: z.number().min(1).max(3).optional(),
      rischioInerenteNote: z.string().optional(),
      rischioControlloPunteggio: z.number().min(1).max(3).optional(),
      rischioControlloNote: z.string().optional(),
      areeRischio: z.array(z.object({
        area: z.string(),
        livello: z.enum(["basso", "medio", "alto"]),
        descrizione: z.string(),
      })).optional(),
      goingConcernRischio: z.boolean().optional(),
      completato: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { incaricoId, completato, rischioInerentePunteggio, rischioControlloPunteggio, ...rest } = input;

      // Calcola RMM e rischio individuazione
      let rmmPunteggio: number | undefined;
      let rischioIndividuazionePunteggio: number | undefined;
      if (rischioInerentePunteggio && rischioControlloPunteggio) {
        rmmPunteggio = Math.round((rischioInerentePunteggio + rischioControlloPunteggio) / 2);
        // Rischio individuazione: inversamente proporzionale a RMM (ISA Italia 200)
        rischioIndividuazionePunteggio = rmmPunteggio >= 3 ? 1 : rmmPunteggio === 2 ? 2 : 3;
      }

      const result = await upsertModuloRischio({
        incaricoId,
        rischioInerentePunteggio,
        rischioControlloPunteggio,
        rmmPunteggio,
        rischioIndividuazionePunteggio,
        ...rest,
        completato: completato ?? false,
      });

      if (completato) await updateIncarico(incaricoId, { statoModulo3: 2 });

      // Alert per rischio elevato
      if (rmmPunteggio && rmmPunteggio >= 3) {
        await createAlert({
          incaricoId,
          modulo: "rischio",
          tipoAlert: "rischio_elevato",
          severita: "critical",
          titolo: "Rischio di errore significativo ELEVATO",
          messaggio: "Il rischio di errore significativo (RMM) è elevato. Aumentare la portata e l'intensità delle procedure di revisione (ISA Italia 330).",
          datiContesto: { rischioInerente: rischioInerentePunteggio, rischioControllo: rischioControlloPunteggio, rmm: rmmPunteggio },
        });
        await notifyOwner({ title: "⚠️ Rischio elevato rilevato", content: `Incarico ID ${incaricoId}: RMM elevato (${rmmPunteggio}/3). Verificare le procedure pianificate.` });
      }

      return result;
    }),

  analisiAiRischi: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .mutation(async ({ input }) => {
      const incarico = await getIncaricoById(input.incaricoId);
      const cliente = await getClienteById(incarico!.clienteId);
      const comprensione = await getModuloComprensione(input.incaricoId);
      const contestoBilancio = await buildContextoBilancio(input.incaricoId);

      const response = await invokeLLM({
        messages: [
          { role: "system", content: "Sei un esperto revisore legale italiano specializzato in ISA Italia 315 e 330. Identifica i rischi di revisione in modo pratico e concreto." },
          {
            role: "user",
            content: `Azienda: ${cliente?.ragioneSociale} | Settore: ${cliente?.settore || "N/D"} | Anno: ${incarico?.annoEsercizio}
Totale attivo: ${comprensione?.totaleAttivo || "N/D"} € | Ricavi: ${comprensione?.ricaviNetti || "N/D"} € | Utile: ${comprensione?.utilePerditaEsercizio || "N/D"} €
Nano impresa: ${comprensione?.isNanoImpresa ? "Sì" : "No"}

Contesto documenti:
${contestoBilancio}

Identifica (ISA Italia 315):
1. RISCHI INERENTI principali (max 4): area, livello (basso/medio/alto), motivazione
2. RISCHI DI CONTROLLO (struttura organizzativa nano impresa): livello generale e motivazione
3. AREE DI RISCHIO SIGNIFICATIVO che richiedono procedure specifiche
4. INDICATORI DI GOING CONCERN presenti (ISA Italia 570): sì/no e quali

Formato risposta: testo strutturato con sezioni numerate, max 300 parole.`,
          },
        ],
      });

      const analisi = typeof response.choices[0]?.message?.content === 'string'
        ? response.choices[0].message.content
        : "Analisi non disponibile.";

      await upsertModuloRischio({ incaricoId: input.incaricoId, analisiAiRischi: analisi });
      await updateIncarico(input.incaricoId, { statoModulo3: 1 });

      return { analisi };
    }),
});

// ─── MODULO 4: MATERIALITÀ ────────────────────────────────────────────────────
const materialitaRouter = router({
  get: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .query(async ({ input }) => getModuloMaterialita(input.incaricoId)),

  calcola: protectedProcedure
    .input(z.object({
      incaricoId: z.number(),
      benchmarkTipo: z.enum(["ricavi_netti", "totale_attivo", "patrimonio_netto", "utile_ante_imposte", "costo_venduto"]),
      benchmarkValore: z.number().positive(),
      benchmarkPercentuale: z.number().min(0.1).max(10),
      motivazioneBenchmark: z.string().optional(),
      primoIncarico: z.boolean().default(false),
      erroriAnniPrecedenti: z.boolean().default(false),
      controlliDeboli: z.boolean().default(false),
      completato: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { incaricoId, completato, benchmarkValore, benchmarkPercentuale, primoIncarico, erroriAnniPrecedenti, controlliDeboli, ...rest } = input;

      const { om, pm, ctt, fattore } = calcolaMaterialita(
        benchmarkValore, benchmarkPercentuale, primoIncarico, erroriAnniPrecedenti, controlliDeboli
      );

      const result = await upsertModuloMaterialita({
        incaricoId,
        benchmarkValore: benchmarkValore.toString(),
        benchmarkPercentuale: benchmarkPercentuale.toString(),
        overallMateriality: om.toString(),
        performanceMateriality: pm.toString(),
        pmFattoreRiduzione: fattore.toString(),
        clearlyTrivialThreshold: ctt.toString(),
        primoIncarico,
        erroriAnniPrecedenti,
        controlliDeboli,
        ...rest,
        completato: completato ?? false,
      });

      if (completato) await updateIncarico(incaricoId, { statoModulo4: 2 });

      return { ...result, om, pm, ctt, fattore };
    }),

  suggerisciBenchmark: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .mutation(async ({ input }) => {
      const comprensione = await getModuloComprensione(input.incaricoId);
      if (!comprensione) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Completa prima il Modulo 2 (Comprensione dell'impresa)" });

      const attivo = parseFloat(comprensione.totaleAttivo?.toString() || "0");
      const ricavi = parseFloat(comprensione.ricaviNetti?.toString() || "0");
      const pn = parseFloat(comprensione.patrimonioNetto?.toString() || "0");
      const utile = parseFloat(comprensione.utilePerditaEsercizio?.toString() || "0");

      // Logica di selezione benchmark ISA Italia 320
      let benchmarkConsigliato: string;
      let percentualeConsigliata: number;
      let motivazione: string;

      if (ricavi > 0 && ricavi >= attivo * 0.3) {
        benchmarkConsigliato = "ricavi_netti";
        percentualeConsigliata = 0.75;
        motivazione = "I ricavi sono il benchmark più rappresentativo per questa tipologia di impresa (commerciale/servizi). Percentuale 0,75% nella fascia ISA Italia 320.";
      } else if (attivo > ricavi * 2) {
        benchmarkConsigliato = "totale_attivo";
        percentualeConsigliata = 1.5;
        motivazione = "Il totale attivo è preponderante rispetto ai ricavi (impresa con forte patrimonio immobiliare/finanziario). Percentuale 1,5% nella fascia ISA Italia 320.";
      } else if (pn > 0 && utile > 0) {
        benchmarkConsigliato = "utile_ante_imposte";
        percentualeConsigliata = 7.5;
        motivazione = "L'utile ante imposte è stabile e positivo. Percentuale 7,5% nella fascia ISA Italia 320.";
      } else {
        benchmarkConsigliato = "ricavi_netti";
        percentualeConsigliata = 0.75;
        motivazione = "Default: ricavi netti come benchmark principale. Percentuale 0,75%.";
      }

      const valori: Record<string, number> = {
        ricavi_netti: ricavi,
        totale_attivo: attivo,
        patrimonio_netto: pn,
        utile_ante_imposte: utile,
      };

      const { om, pm, ctt } = calcolaMaterialita(
        valori[benchmarkConsigliato] || ricavi,
        percentualeConsigliata,
        false, false, false
      );

      return { benchmarkConsigliato, percentualeConsigliata, motivazione, om, pm, ctt, valori };
    }),
});

// ─── MODULO 5: PIANO DI REVISIONE ────────────────────────────────────────────
const pianoRouter = router({
  get: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .query(async ({ input }) => getModuloPiano(input.incaricoId)),

  save: protectedProcedure
    .input(z.object({
      incaricoId: z.number(),
      procedurePianificate: z.array(z.object({
        area: z.string(),
        procedure: z.array(z.string()),
        priorita: z.enum(["alta", "media", "bassa"]),
        responsabile: z.string().optional(),
      })).optional(),
      areeRevisione: z.array(z.object({
        area: z.string(),
        livelloRischio: z.enum(["basso", "medio", "alto"]),
        materialita: z.number().optional(),
      })).optional(),
      dataInizioRevisione: z.string().optional(),
      dataFineRevisione: z.string().optional(),
      completato: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { incaricoId, completato, dataInizioRevisione, dataFineRevisione, ...rest } = input;
      const result = await upsertModuloPiano({
        incaricoId,
        ...rest,
        dataInizioRevisione: dataInizioRevisione ? new Date(dataInizioRevisione) : undefined,
        dataFineRevisione: dataFineRevisione ? new Date(dataFineRevisione) : undefined,
        completato: completato ?? false,
      });
      if (completato) await updateIncarico(incaricoId, { statoModulo5: 2, stato: "in_corso" });
      return result;
    }),

  generaConAi: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .mutation(async ({ input }) => {
      const incarico = await getIncaricoById(input.incaricoId);
      const cliente = await getClienteById(incarico!.clienteId);
      const comprensione = await getModuloComprensione(input.incaricoId);
      const rischio = await getModuloRischio(input.incaricoId);
      const materialita = await getModuloMaterialita(input.incaricoId);

      const livelloRischio = ["", "basso", "medio", "alto"];

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: "Sei un esperto revisore legale italiano. Genera un piano di revisione pratico e conforme agli ISA Italia per una nano impresa. Rispondi SOLO con JSON valido.",
          },
          {
            role: "user",
            content: `Genera il piano di revisione per:
Azienda: ${cliente?.ragioneSociale} | Settore: ${cliente?.settore || "N/D"} | Anno: ${incarico?.annoEsercizio}
Ricavi: ${comprensione?.ricaviNetti || "N/D"} € | Totale attivo: ${comprensione?.totaleAttivo || "N/D"} €
Rischio inerente: ${livelloRischio[rischio?.rischioInerentePunteggio || 2]} | Rischio controllo: ${livelloRischio[rischio?.rischioControlloPunteggio || 2]}
Overall Materiality: ${materialita?.overallMateriality || "N/D"} € | Performance Materiality: ${materialita?.performanceMateriality || "N/D"} €
Aree di rischio: ${JSON.stringify(rischio?.areeRischio || [])}

Genera JSON con questa struttura:
{
  "procedurePianificate": [
    {
      "area": "Immobilizzazioni materiali",
      "procedure": ["Verifica esistenza fisica a campione", "Riconciliazione con registro cespiti", "Verifica ammortamenti"],
      "priorita": "alta"
    }
  ],
  "areeRevisione": [
    {"area": "Immobilizzazioni materiali", "livelloRischio": "medio", "motivazione": "..."}
  ],
  "sintesi": "Testo sintetico del piano (max 150 parole)"
}

Includi almeno 6 aree: Immobilizzazioni, Rimanenze, Crediti v/clienti, Disponibilità liquide, Debiti, Conto economico.`,
          },
        ],
        response_format: { type: "json_object" } as any,
      });

      const rawContent = response.choices[0]?.message?.content;
      const content = typeof rawContent === 'string' ? rawContent : '{}';
      let pianoGenerato: Record<string, any> = {};
      try { pianoGenerato = JSON.parse(content); } catch { pianoGenerato = {}; }

      await upsertModuloPiano({
        incaricoId: input.incaricoId,
        procedurePianificate: pianoGenerato.procedurePianificate || [],
        areeRevisione: pianoGenerato.areeRevisione || [],
        sintesiPianoAi: pianoGenerato.sintesi || "",
      });
      await updateIncarico(input.incaricoId, { statoModulo5: 1 });

      return pianoGenerato;
    }),
});

// ─── ROUTER PRINCIPALE MODULI ─────────────────────────────────────────────────
export const moduliRouter = router({
  accettazione: accettazioneRouter,
  comprensione: comprensionRouter,
  rischio: rischioRouter,
  materialita: materialitaRouter,
  piano: pianoRouter,
});
