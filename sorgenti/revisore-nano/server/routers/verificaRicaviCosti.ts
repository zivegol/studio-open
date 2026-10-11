import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { getDocumentiByIncarico, getIncaricoById, getClienteById } from "../db";

// ─── TIPI ─────────────────────────────────────────────────────────────────────

export interface VoceCE {
  chiave: string;
  label: string;
  gruppo: string;
  valoreN: number | null;
  valoreN1: number | null;
  variazAssoluta: number | null;
  variazPerc: number | null;
  incidenzaRicaviN: number | null;
  incidenzaRicaviN1: number | null;
  semaforo: "verde" | "giallo" | "rosso" | "grigio";
  note: string;
}

export interface CheckAnomalia {
  area: string;
  descrizione: string;
  valore: string;
  riferimento: string;
  semaforo: "verde" | "giallo" | "rosso" | "grigio";
  proceduraSuggerita: string;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function perc(v: number | null, tot: number | null): number | null {
  if (v == null || tot == null || tot === 0) return null;
  return Math.round((v / tot) * 1000) / 10;
}

function variazPerc(vN: number | null, vN1: number | null): number | null {
  if (vN == null || vN1 == null || vN1 === 0) return null;
  return Math.round(((vN - vN1) / Math.abs(vN1)) * 1000) / 10;
}

function semaforoVariaz(percVar: number | null, soglia1 = 15, soglia2 = 30): "verde" | "giallo" | "rosso" | "grigio" {
  if (percVar == null) return "grigio";
  const abs = Math.abs(percVar);
  if (abs <= soglia1) return "verde";
  if (abs <= soglia2) return "giallo";
  return "rosso";
}

/** Estrae i valori CE dal datiStrutturati di un bilancio (CEE o analitico) */
function estraiCE(dati: Record<string, any>, tipoDoc: string): Record<string, number | null> {
  if (tipoDoc === "bilancio_analitico") {
    const ric = dati.ricavi ?? {};
    const cos = dati.costi ?? {};
    const ris = dati.risultato ?? {};
    return {
      ricaviVendite: ric.ricaviVendite ?? ric.totaleRicavi ?? null,
      altriRicavi: ric.altriRicavi ?? null,
      acquistiBeni: cos.acquistiMerci ?? cos.acquistiBeni ?? null,
      costiServizi: cos.costiServizi ?? null,
      costiPersonale: cos.costiPersonale ?? null,
      ammortamentiSvalutazioni: cos.ammortamenti ?? cos.ammortamentiSvalutazioni ?? null,
      altriCostiOperativi: cos.altriCosti ?? cos.altriCostiOperativi ?? null,
      proventiFinanziari: ris.proventiFinanziari ?? null,
      oneriFinanziari: ris.oneriFinanziari ?? null,
      imposteSulReddito: ris.imposte ?? ris.imposteSulReddito ?? null,
      utileNetto: ris.utileNetto ?? null,
    };
  }
  // Bilancio CEE: cerca in vociCE, contoEconomico o root
  const vociCE = dati.vociCE ?? dati.contoEconomico ?? {};
  return {
    ricaviVendite: vociCE.ricaviVendite ?? dati.ricavi ?? dati.ricaviVendite ?? null,
    altriRicavi: vociCE.altriRicavi ?? dati.altriRicavi ?? null,
    acquistiBeni: vociCE.acquistiBeni ?? dati.acquistiBeni ?? null,
    costiServizi: vociCE.costiServizi ?? dati.costiServizi ?? null,
    costiPersonale: vociCE.costiPersonale ?? dati.costiPersonale ?? null,
    ammortamentiSvalutazioni: vociCE.ammortamentiSvalutazioni ?? dati.ammortamenti ?? dati.ammortamentiSvalutazioni ?? null,
    altriCostiOperativi: vociCE.altriCostiOperativi ?? dati.altriCostiOperativi ?? null,
    proventiFinanziari: vociCE.proventiFinanziari ?? dati.proventiFinanziari ?? null,
    oneriFinanziari: vociCE.oneriFinanziari ?? dati.oneriFinanziari ?? null,
    imposteSulReddito: vociCE.imposteSulReddito ?? dati.imposteSulReddito ?? null,
    utileNetto: vociCE.utileNetto ?? dati.utile ?? dati.utileNetto ?? null,
  };
}

/** Estrae i valori SP dal datiStrutturati di un bilancio */
function estraiSP(dati: Record<string, any>, tipoDoc: string): Record<string, number | null> {
  if (tipoDoc === "bilancio_analitico") {
    const deb = dati.debiti ?? {};
    const imm = dati.immobilizzazioni ?? {};
    return {
      immobilizzazioniLorde: imm.totaleImmobilizzazioni ?? null,
      debitiBancariCT: deb.debitiBancariCT ?? null,
      debitiBancariLT: deb.debitiBancariLT ?? null,
      creditiClienti: (dati.crediti ?? {}).creditiClienti ?? null,
    };
  }
  const vociSP = dati.vociSP ?? dati.statoPatrimoniale ?? {};
  return {
    immobilizzazioniLorde: vociSP.immobilizzazioniMateriali ?? dati.immobilizzazioniMateriali ?? null,
    debitiBancariCT: vociSP.debitiBancariCT ?? dati.debitiBancariCT ?? null,
    debitiBancariLT: vociSP.debitiBancariLT ?? dati.debitiBancariLT ?? null,
    creditiClienti: vociSP.creditiClienti ?? dati.creditiClienti ?? null,
  };
}

// ─── DEFINIZIONE VOCI CE ──────────────────────────────────────────────────────

const VOCI_CE = [
  { chiave: "ricaviVendite", label: "Ricavi da vendite e prestazioni", gruppo: "Valore della produzione" },
  { chiave: "altriRicavi", label: "Altri ricavi e proventi", gruppo: "Valore della produzione" },
  { chiave: "acquistiBeni", label: "Acquisti beni e materie", gruppo: "Costi della produzione" },
  { chiave: "costiServizi", label: "Costi per servizi", gruppo: "Costi della produzione" },
  { chiave: "costiPersonale", label: "Costi del personale", gruppo: "Costi della produzione" },
  { chiave: "ammortamentiSvalutazioni", label: "Ammortamenti e svalutazioni", gruppo: "Costi della produzione" },
  { chiave: "altriCostiOperativi", label: "Altri costi operativi", gruppo: "Costi della produzione" },
  { chiave: "proventiFinanziari", label: "Proventi finanziari", gruppo: "Proventi e oneri finanziari" },
  { chiave: "oneriFinanziari", label: "Oneri finanziari", gruppo: "Proventi e oneri finanziari" },
  { chiave: "imposteSulReddito", label: "Imposte sul reddito", gruppo: "Imposte" },
  { chiave: "utileNetto", label: "Utile / Perdita netto", gruppo: "Risultato" },
];

// ─── ROUTER ───────────────────────────────────────────────────────────────────

export const verificaRicaviCostiRouter = router({

  /** Analisi comparativa CE + check anomalie */
  getAnalisi: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .query(async ({ input }) => {
      const docs = await getDocumentiByIncarico(input.incaricoId);
      const incarico = await getIncaricoById(input.incaricoId);

      // Cerca bilancio anno N (oggetto di revisione) e anno N-1 (storico)
      const annoN = incarico?.annoEsercizio ?? new Date().getFullYear() - 1;
      const annoN1 = annoN - 1;

      const tuttiiBilanci = docs.filter(d =>
        (d.tipoDocumento === "bilancio_revisione" ||
         d.tipoDocumento === "bilancio_storico" ||
         d.tipoDocumento === "bilancio" ||
         d.tipoDocumento === "bilancio_analitico") &&
        d.datiStrutturati && d.statoParsing === "completato"
      );

      // Priorità: bilancio_analitico > bilancio_revisione > bilancio generico
      const bilancioN =
        tuttiiBilanci.find(d => d.tipoDocumento === "bilancio_analitico" && d.annoRiferimento === annoN) ??
        tuttiiBilanci.find(d => d.tipoDocumento === "bilancio_revisione" && d.annoRiferimento === annoN) ??
        tuttiiBilanci.find(d => d.annoRiferimento === annoN) ??
        tuttiiBilanci.find(d => d.tipoDocumento === "bilancio_revisione" || d.tipoDocumento === "bilancio_analitico");

      const bilancioN1 =
        tuttiiBilanci.find(d => d.tipoDocumento === "bilancio_analitico" && d.annoRiferimento === annoN1) ??
        tuttiiBilanci.find(d => d.tipoDocumento === "bilancio_storico" && d.annoRiferimento === annoN1) ??
        tuttiiBilanci.find(d => d.annoRiferimento === annoN1);

      if (!bilancioN) {
        return { disponibile: false as const, motivo: "Nessun bilancio dell'anno di revisione trovato. Carica il bilancio CEE o il bilancio analitico nel fascicolo documenti." };
      }

      const datiN = bilancioN.datiStrutturati as Record<string, any>;
      const datiN1 = bilancioN1 ? bilancioN1.datiStrutturati as Record<string, any> : null;

      const ceN = estraiCE(datiN, bilancioN.tipoDocumento ?? "bilancio");
      const ceN1 = datiN1 ? estraiCE(datiN1, bilancioN1!.tipoDocumento ?? "bilancio") : null;
      const spN = estraiSP(datiN, bilancioN.tipoDocumento ?? "bilancio");

      const ricaviN = (ceN.ricaviVendite ?? 0) + (ceN.altriRicavi ?? 0);
      const ricaviN1 = ceN1 ? ((ceN1.ricaviVendite ?? 0) + (ceN1.altriRicavi ?? 0)) : null;

      // ─── ANALISI COMPARATIVA CE ───────────────────────────────────────────
      const vociCE: VoceCE[] = VOCI_CE.map(v => {
        const vN = ceN[v.chiave] ?? null;
        const vN1 = ceN1 ? (ceN1[v.chiave] ?? null) : null;
        const varPerc = variazPerc(vN, vN1);
        const sem = semaforoVariaz(varPerc, 15, 30);

        let nota = "";
        if (sem === "rosso" && varPerc !== null) {
          nota = `Variazione significativa del ${varPerc > 0 ? "+" : ""}${varPerc.toFixed(1)}% rispetto all'anno precedente — verificare la causa.`;
        } else if (sem === "giallo" && varPerc !== null) {
          nota = `Variazione del ${varPerc > 0 ? "+" : ""}${varPerc.toFixed(1)}% — monitorare.`;
        } else if (vN1 == null) {
          nota = "Dato anno precedente non disponibile.";
        }

        return {
          chiave: v.chiave,
          label: v.label,
          gruppo: v.gruppo,
          valoreN: vN,
          valoreN1: vN1,
          variazAssoluta: vN != null && vN1 != null ? vN - vN1 : null,
          variazPerc: varPerc,
          incidenzaRicaviN: perc(vN, ricaviN > 0 ? ricaviN : null),
          incidenzaRicaviN1: perc(vN1, ricaviN1 && ricaviN1 > 0 ? ricaviN1 : null),
          semaforo: sem,
          note: nota,
        };
      }).filter(v => v.valoreN != null || v.valoreN1 != null);

      // ─── CHECK ANOMALIE ───────────────────────────────────────────────────
      const anomalie: CheckAnomalia[] = [];

      // 1. Tasso ammortamento implicito
      const ammN = ceN.ammortamentiSvalutazioni;
      const immN = spN.immobilizzazioniLorde;
      if (ammN != null && immN != null && immN > 0) {
        const tassoAmm = (ammN / immN) * 100;
        const sem = tassoAmm < 3 ? "rosso" : tassoAmm > 30 ? "giallo" : "verde";
        anomalie.push({
          area: "Ammortamenti",
          descrizione: "Tasso di ammortamento implicito",
          valore: `${tassoAmm.toFixed(1)}%`,
          riferimento: "Range tipico: 3%–25% (varia per categoria)",
          semaforo: sem,
          proceduraSuggerita: sem === "rosso"
            ? "Verificare le aliquote applicate — tasso molto basso potrebbe indicare ammortamenti insufficienti o immobilizzazioni già completamente ammortizzate."
            : sem === "giallo"
            ? "Tasso elevato — verificare se ci sono svalutazioni straordinarie o accelerazioni non giustificate."
            : "Tasso nella norma.",
        });
      }

      // 2. Tasso oneri finanziari su debiti bancari
      const ofN = ceN.oneriFinanziari;
      const debBancariN = (spN.debitiBancariCT ?? 0) + (spN.debitiBancariLT ?? 0);
      if (ofN != null && debBancariN > 0) {
        const tassoOf = (ofN / debBancariN) * 100;
        const sem = tassoOf > 8 ? "rosso" : tassoOf > 5 ? "giallo" : "verde";
        anomalie.push({
          area: "Oneri finanziari",
          descrizione: "Tasso implicito oneri finanziari su debiti bancari",
          valore: `${tassoOf.toFixed(1)}%`,
          riferimento: "Tasso di mercato atteso: 3%–6% (2024)",
          semaforo: sem,
          proceduraSuggerita: sem === "rosso"
            ? "Tasso anomalo — verificare se ci sono interessi di mora, commissioni straordinarie o debiti non bancari inclusi nel calcolo."
            : sem === "giallo"
            ? "Tasso leggermente superiore al mercato — richiedere estratto del conto interessi alla banca."
            : "Tasso coerente con i tassi di mercato.",
        });
      }

      // 3. Incidenza costi personale su ricavi
      const cpN = ceN.costiPersonale;
      if (cpN != null && ricaviN > 0) {
        const incCp = (cpN / ricaviN) * 100;
        const sem = incCp > 60 ? "rosso" : incCp > 40 ? "giallo" : "verde";
        anomalie.push({
          area: "Costi del personale",
          descrizione: "Incidenza costi personale su ricavi",
          valore: `${incCp.toFixed(1)}%`,
          riferimento: "Soglia attenzione: >40% (servizi), >25% (commercio/industria)",
          semaforo: sem,
          proceduraSuggerita: sem === "rosso"
            ? "Incidenza molto elevata — verificare la congruità del costo del personale con il numero di dipendenti e le retribuzioni di mercato."
            : sem === "giallo"
            ? "Incidenza rilevante — confrontare con anno precedente e con benchmark di settore."
            : "Incidenza nella norma.",
        });
      }

      // 4. Variazione ricavi anno su anno
      if (ricaviN > 0 && ricaviN1 != null && ricaviN1 > 0) {
        const varRic = ((ricaviN - ricaviN1) / ricaviN1) * 100;
        const sem = Math.abs(varRic) > 30 ? "rosso" : Math.abs(varRic) > 15 ? "giallo" : "verde";
        anomalie.push({
          area: "Ricavi",
          descrizione: "Variazione ricavi anno su anno",
          valore: `${varRic > 0 ? "+" : ""}${varRic.toFixed(1)}%`,
          riferimento: "Soglia attenzione: variazione > ±15%",
          semaforo: sem,
          proceduraSuggerita: sem === "rosso"
            ? "Variazione molto significativa — verificare le cause (nuovi clienti, perdita clienti, variazione prezzi, operazioni straordinarie). Applicare procedure di cut-off."
            : sem === "giallo"
            ? "Variazione rilevante — richiedere spiegazione alla direzione e verificare la coerenza con il partitario clienti."
            : "Variazione nella norma.",
        });
      }

      // 5. Incidenza acquisti/costi servizi su ricavi (margine lordo)
      const acqN = ceN.acquistiBeni;
      const srvN = ceN.costiServizi;
      if ((acqN != null || srvN != null) && ricaviN > 0) {
        const costiVariabili = (acqN ?? 0) + (srvN ?? 0);
        const margine = ((ricaviN - costiVariabili) / ricaviN) * 100;
        const margineN1 = (ricaviN1 && ceN1)
          ? (((ceN1.ricaviVendite ?? 0) + (ceN1.altriRicavi ?? 0) - (ceN1.acquistiBeni ?? 0) - (ceN1.costiServizi ?? 0)) /
             ((ceN1.ricaviVendite ?? 0) + (ceN1.altriRicavi ?? 0))) * 100
          : null;
        const varMargine = margineN1 != null ? margine - margineN1 : null;
        const sem = varMargine != null && Math.abs(varMargine) > 5 ? "giallo" : "verde";
        anomalie.push({
          area: "Margine lordo",
          descrizione: "Margine lordo (ricavi - acquisti - servizi)",
          valore: `${margine.toFixed(1)}%${margineN1 != null ? ` (anno prec.: ${margineN1.toFixed(1)}%)` : ""}`,
          riferimento: "Variazione > 5 punti percentuali richiede spiegazione",
          semaforo: sem,
          proceduraSuggerita: sem === "giallo"
            ? `Margine variato di ${varMargine != null ? (varMargine > 0 ? "+" : "") + varMargine.toFixed(1) : "n.d."}% — verificare variazioni di prezzi di vendita, costo delle materie prime o mix di prodotti/servizi.`
            : "Margine stabile rispetto all'anno precedente.",
        });
      }

      // 6. Utile netto su ricavi (ROS)
      const utileN = ceN.utileNetto;
      if (utileN != null && ricaviN > 0) {
        const ros = (utileN / ricaviN) * 100;
        const sem = utileN < 0 ? "rosso" : ros < 1 ? "giallo" : "verde";
        anomalie.push({
          area: "Redditività",
          descrizione: "ROS — Utile netto su ricavi",
          valore: `${ros.toFixed(1)}%`,
          riferimento: "Perdita = rosso; ROS < 1% = attenzione continuità aziendale",
          semaforo: sem,
          proceduraSuggerita: sem === "rosso"
            ? "Perdita d'esercizio — valutare la continuità aziendale (ISA 570). Verificare se la perdita è strutturale o straordinaria."
            : sem === "giallo"
            ? "Margine netto molto ridotto — verificare la sostenibilità economica e la copertura degli oneri finanziari."
            : "Redditività positiva.",
        });
      }

      // ─── CHECKLIST PROCEDURE ──────────────────────────────────────────────
      const checklist = [
        {
          area: "Ricavi — Esistenza/Occorrenza",
          procedura: "Selezionare un campione di fatture emesse e verificare la corrispondenza con ordini, DDT e incassi sull'estratto conto.",
          priorita: "alta" as const,
          riferimentoISA: "ISA 500, ISA 330",
        },
        {
          area: "Ricavi — Cut-off",
          procedura: "Verificare le fatture emesse negli ultimi 15 giorni di dicembre e nei primi 15 di gennaio: controllare che la competenza sia corretta.",
          priorita: "alta" as const,
          riferimentoISA: "ISA 500",
        },
        {
          area: "Ricavi — Completezza",
          procedura: "Riconciliare il totale ricavi CE con la dichiarazione IVA annuale (volume d'affari). Scostamenti > significatività richiedono spiegazione.",
          priorita: "alta" as const,
          riferimentoISA: "ISA 500, ISA 330",
        },
        {
          area: "Costi — Completezza debiti",
          procedura: "Verificare che i costi di competenza dicembre siano stati registrati (fatture ricevute a gennaio per servizi/forniture di dicembre).",
          priorita: "alta" as const,
          riferimentoISA: "ISA 500",
        },
        {
          area: "Costi personale — Accuratezza",
          procedura: "Riconciliare il costo del personale CE con i cedolini paga annuali e i versamenti F24 (già verificati nell'estratto conto).",
          priorita: "alta" as const,
          riferimentoISA: "ISA 500",
        },
        {
          area: "Ammortamenti — Accuratezza",
          procedura: "Ricalcolare gli ammortamenti su un campione di cespiti: verificare aliquote, base ammortizzabile e data di inizio ammortamento.",
          priorita: "media" as const,
          riferimentoISA: "ISA 500, ISA 540",
        },
        {
          area: "Costi per servizi — Esistenza",
          procedura: "Verificare i costi per consulenze e servizi professionali: richiedere contratti o lettere di incarico per importi superiori alla soglia di significatività.",
          priorita: "media" as const,
          riferimentoISA: "ISA 500, ISA 550",
        },
        {
          area: "Oneri finanziari — Accuratezza",
          procedura: "Riconciliare gli oneri finanziari CE con gli estratti conto bancari (già disponibili). Verificare la corrispondenza con le comunicazioni della banca.",
          priorita: "media" as const,
          riferimentoISA: "ISA 500",
        },
        {
          area: "Imposte — Accuratezza",
          procedura: "Verificare la coerenza tra le imposte CE e il modello Redditi/IRAP. Richiedere la dichiarazione dei redditi o il prospetto calcolo imposte al commercialista.",
          priorita: "media" as const,
          riferimentoISA: "ISA 500, ISA 540",
        },
      ];

      return {
        disponibile: true as const,
        annoN,
        annoN1: bilancioN1 ? annoN1 : null,
        nomeFileN: bilancioN.nomeFile,
        nomeFileN1: bilancioN1?.nomeFile ?? null,
        ricaviN,
        ricaviN1,
        vociCE,
        anomalie,
        checklist,
      };
    }),

  // Export Excel carta di lavoro CE
  exportCartaLavoroCE: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .query(async ({ input, ctx }) => {
      const incarico = await getIncaricoById(input.incaricoId);
      if (!incarico || incarico.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const docs = await getDocumentiByIncarico(input.incaricoId);
      const tipiBilancio = ["bilancio", "bilancio_revisione", "bilancio_storico", "bilancio_analitico"];
      const bilanci = docs
        .filter(d => tipiBilancio.includes(d.tipoDocumento || "") && d.statoParsing === "completato" && d.datiStrutturati)
        .sort((a, b) => (b.annoRiferimento ?? 0) - (a.annoRiferimento ?? 0));

      if (bilanci.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Nessun bilancio analizzato trovato" });
      }

      const bilancioN = bilanci[0];
      const bilancioN1 = bilanci[1];
      const annoN = bilancioN.annoRiferimento ?? new Date().getFullYear() - 1;
      const annoN1 = bilancioN1?.annoRiferimento ?? annoN - 1;

      const ceN = estraiCE(bilancioN.datiStrutturati as Record<string, any>, bilancioN.tipoDocumento || "bilancio");
      const ceN1 = bilancioN1 ? estraiCE(bilancioN1.datiStrutturati as Record<string, any>, bilancioN1.tipoDocumento || "bilancio") : {};

      const ricaviN = (ceN.ricaviVendite ?? 0) + (ceN.altriRicavi ?? 0);
      const ricaviN1 = bilancioN1 ? (ceN1.ricaviVendite ?? 0) + (ceN1.altriRicavi ?? 0) : null;

      // Costruisci voci CE inline
      const vociCEExport = VOCI_CE
        .map(v => ({
          gruppo: v.gruppo,
          voce: v.label,
          annoN: ceN[v.chiave] ?? null,
          annoN1: ceN1[v.chiave] ?? null,
          variazAssoluta: ceN[v.chiave] != null && ceN1[v.chiave] != null ? (ceN[v.chiave]! - ceN1[v.chiave]!) : null,
          variazPerc: variazPerc(ceN[v.chiave] ?? null, ceN1[v.chiave] ?? null),
          incidenzaN: perc(ceN[v.chiave] ?? null, ricaviN > 0 ? ricaviN : null),
          incidenzaN1: perc(ceN1[v.chiave] ?? null, ricaviN1 && ricaviN1 > 0 ? ricaviN1 : null),
          semaforo: semaforoVariaz(variazPerc(ceN[v.chiave] ?? null, ceN1[v.chiave] ?? null)),
        }))
        .filter(v => v.annoN != null || v.annoN1 != null);

      // Recupera nome cliente
      const cliente = incarico ? await getClienteById(incarico.clienteId) : null;
      const nomeCliente = cliente?.ragioneSociale ?? "Cliente";

      return {
        nomeCliente,
        annoN,
        annoN1,
        righeTabella: vociCEExport,
        righeAnomalie: [] as Array<{ area: string; descrizione: string; valore: string; riferimento: string; semaforo: string; procedura: string }>,
      };
    }),

  // Riconciliazione ricavi vs volume d'affari IVA
  riconciliazioneIVA: protectedProcedure
    .input(z.object({
      incaricoId: z.number(),
      volumeAffariIva: z.number().positive("Inserire un importo positivo"),
      annoRiferimento: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const incarico = await getIncaricoById(input.incaricoId);
      if (!incarico || incarico.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const docs = await getDocumentiByIncarico(input.incaricoId);
      const tipiBilancio = ["bilancio", "bilancio_revisione", "bilancio_storico", "bilancio_analitico"];
      const bilanci = docs.filter(d =>
        tipiBilancio.includes(d.tipoDocumento || "") &&
        d.statoParsing === "completato" &&
        d.datiStrutturati
      );

      if (bilanci.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Nessun bilancio analizzato trovato per questo incarico" });
      }

      // Trova il bilancio dell'anno di riferimento (o il più recente)
      const annoTarget = input.annoRiferimento ?? Math.max(...bilanci.map(b => b.annoRiferimento ?? 0));
      const bilancio = bilanci.find(b => b.annoRiferimento === annoTarget) ?? bilanci[0];
      const dati = bilancio.datiStrutturati as Record<string, any>;

      // Estrai ricavi dal bilancio
      const ceVoci = estraiCE(dati, bilancio.tipoDocumento || "bilancio");
      const ricaviBilancio = (ceVoci.ricaviVendite ?? 0) + (ceVoci.altriRicavi ?? 0);

      const volumeIva = input.volumeAffariIva;
      const scostamentoAssoluto = volumeIva - ricaviBilancio;
      const scostamentoPerc = ricaviBilancio > 0
        ? Math.round((scostamentoAssoluto / ricaviBilancio) * 1000) / 10
        : null;

      // Semaforo: verde ±5%, giallo ±10%, rosso oltre
      let semaforo: "verde" | "giallo" | "rosso" | "grigio" = "grigio";
      if (scostamentoPerc != null) {
        const abs = Math.abs(scostamentoPerc);
        semaforo = abs <= 5 ? "verde" : abs <= 10 ? "giallo" : "rosso";
      }

      // Nota interpretativa
      let nota = "";
      if (semaforo === "verde") {
        nota = "La riconciliazione è soddisfacente. Lo scostamento rientra nella soglia di tolleranza (±5%).";
      } else if (semaforo === "giallo") {
        nota = `Scostamento moderato (${scostamentoPerc}%). Verificare la presenza di ricavi esenti IVA, operazioni intracomunitarie o note di credito non incluse nel volume d'affari.`;
      } else if (semaforo === "rosso") {
        nota = `Scostamento significativo (${scostamentoPerc}%). Richiedere il dettaglio della dichiarazione IVA e riconciliare con i registri IVA. Possibili cause: ricavi fuori campo IVA, operazioni non registrate, errori di classificazione.`;
      }

      return {
        annoRiferimento: bilancio.annoRiferimento ?? annoTarget,
        nomeFile: bilancio.nomeFile,
        ricaviBilancio,
        volumeAffariIva: volumeIva,
        scostamentoAssoluto,
        scostamentoPerc,
        semaforo,
        nota,
      };
    }),
});
