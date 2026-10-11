import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  getDocumentiByIncarico,
  getDocumentoById,
  createDocumento,
  updateDocumento,
  deleteDocumento,
  getIncaricoById,
  createAlert,
} from "../db";
import { storagePut, storageGet, resolveStoragePath } from "../storage";
import { invokeLLM } from "../_core/llm";
import { notifyOwner } from "../_core/notification";
import fs from "fs/promises";
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

function parseNumeroBilancio(value: string | undefined): number | null {
  if (!value) return null;
  const compact = value.replace(/\s/g, "");
  const normalized = compact.includes(",")
    ? compact.replace(/\./g, "").replace(",", ".")
    : compact;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function normalizzaXmlText(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

export function parseXbrlBilancio(buffer: Buffer): Record<string, unknown> {
  const xml = buffer.toString("utf-8");
  const contexts = new Map<string, number>();
  const contextRe = /<[^:>\s]*:?context\b[^>]*\bid=["']([^"']+)["'][\s\S]*?<\/[^:>\s]*:?context>/gi;
  for (const match of Array.from(xml.matchAll(contextRe))) {
    const id = match[1];
    const block = match[0];
    const endDate = block.match(/<[^:>\s]*:?endDate>(\d{4})-\d{2}-\d{2}<\/[^:>\s]*:?endDate>/i)?.[1];
    const instant = block.match(/<[^:>\s]*:?instant>(\d{4})-\d{2}-\d{2}<\/[^:>\s]*:?instant>/i)?.[1];
    const year = Number(endDate ?? instant);
    if (Number.isFinite(year)) contexts.set(id, year);
  }

  const anni = Array.from(new Set(contexts.values()))
    .filter(year => Number.isFinite(year) && year > 0)
    .sort((a, b) => a - b);
  const latestYear = anni[anni.length - 1] ?? 0;
  const previousYear = anni.filter(year => year < latestYear).at(-1) ?? null;

  const pickForYear = (names: string[], targetYear: number | null): number | null => {
    const rows: Array<{ value: number; year: number }> = [];
    for (const name of names) {
      const factRe = new RegExp(
        `<(?:[A-Za-z0-9_\\-]+:)?${name}\\b([^>]*)>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_\\-]+:)?${name}>`,
        "gi"
      );
      for (const match of Array.from(xml.matchAll(factRe))) {
        const attrs = match[1] ?? "";
        const contextRef = attrs.match(/\bcontextRef=["']([^"']+)["']/i)?.[1] ?? "";
        const rawValue = normalizzaXmlText(String(match[2] ?? "").trim());
        let value = parseNumeroBilancio(rawValue);
        if (value == null) continue;
        rows.push({ value, year: contexts.get(contextRef) ?? 0 });
      }
    }
    const ordered = rows.sort((a, b) => (b.year - a.year) || Math.abs(b.value) - Math.abs(a.value));
    return ordered.find(row => !targetYear || row.year === targetYear)?.value ?? ordered[0]?.value ?? null;
  };

  const text = (names: string[]): string | null => {
    for (const name of names) {
      const re = new RegExp(`<(?:[A-Za-z0-9_\\-]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_\\-]+:)?${name}>`, "i");
      const value = xml.match(re)?.[1]?.trim();
      if (value) return normalizzaXmlText(value);
    }
    return null;
  };

  const ragioneSociale = text(["Denominazione", "NomeImpresa", "DatiAnagraficiDenominazione"]);

  const buildYearData = (year: number | null): Record<string, unknown> => {
    const pick = (names: string[]) => pickForYear(names, year);
    const ricavi = pick([
      "RicaviDelleVenditeEDellePrestazioni",
      "ValoreProduzioneRicaviVenditePrestazioni",
      "TotaleValoreDellaProduzione",
    ]);
    const totaleAttivo = pick(["TotaleAttivo", "Attivo"]);
    const immobilizzazioni = pick(["TotaleImmobilizzazioni"]);
    const rimanenze = pick(["TotaleRimanenze"]);
    const creditiTotali = pick(["TotaleCrediti"]);
    const rateiRiscontiAttivo = pick(["AttivoRateiRisconti"]);
    const patrimonioNetto = pick(["TotalePatrimonioNetto", "PatrimonioNetto"]);
    const utile = pick([
      "UtilePerditaDEsercizio",
      "UtilePerditaDellEsercizio",
      "UtilePerditaEsercizio",
      "PatrimonioNettoUtilePerditaEsercizio",
    ]);
    const debitiTotali = pick(["TotaleDebiti", "Debiti"]);
    const tfr = pick(["TrattamentoFineRapportoLavoroSubordinato"]);
    const rateiRiscontiPassivo = pick(["PassivoRateiRisconti"]);
    const debitiBancariTotale = pick([
      "DebitiDebitiVersoBancheTotaleDebitiVersoBanche",
      "DebitiVersoBanche",
      "TotaleDebitiVersoBanche",
    ]);
    const debitiBancariCT = pick([
      "DebitiDebitiVersoBancheEsigibiliEntroEsercizioSuccessivo",
      "DebitiVersoBancheEsigibiliEntroEsercizioSuccessivo",
      "DebitiVersoBancheEntroEsercizioSuccessivo",
    ]);
    const debitiBancariLT = pick([
      "DebitiDebitiVersoBancheEsigibiliOltreEsercizioSuccessivo",
      "DebitiVersoBancheEsigibiliOltreEsercizioSuccessivo",
      "DebitiVersoBancheOltreEsercizioSuccessivo",
    ]);
    const creditiClienti = pick([
      "CreditiVersoClienti",
      "CreditiVersoClientiIscrittiNellAttivoCircolante",
      "CreditiVersoClientiTotaleCreditiVersoClienti",
      "CreditiVersoClientiEsigibiliEntroEsercizioSuccessivo",
    ]);
    const disponibilitaLiquide = pick([
      "DisponibilitaLiquide",
      "TotaleDisponibilitaLiquide",
    ]);
    const depositiBancari = pick(["DisponibilitaLiquideDepositiBancariPostali"]);
    const denaroCassa = pick(["DisponibilitaLiquideDanaroValoriCassa"]);
    const disponibilitaLiquideCalcolate = disponibilitaLiquide ?? (
      depositiBancari != null || denaroCassa != null
        ? (depositiBancari ?? 0) + (denaroCassa ?? 0)
        : null
    );
    const costiPersonale = pick([
      "CostiPerIlPersonale",
      "CostiProduzionePersonaleTotaleCostiPersonale",
    ]) ?? (() => {
      const salari = pick(["CostiProduzionePersonaleSalariStipendi"]);
      const oneriSociali = pick(["CostiProduzionePersonaleOneriSociali"]);
      const tfr = pick(["CostiProduzionePersonaleTrattamentoFineRapporto"]);
      return salari != null || oneriSociali != null || tfr != null ? (salari ?? 0) + (oneriSociali ?? 0) + (tfr ?? 0) : null;
    })();
    const ammortamenti = pick([
      "AmmortamentiESvalutazioni",
      "CostiProduzioneAmmortamentiSvalutazioniTotaleAmmortamentiSvalutazioni",
    ]);
    const oneriFinanziari = pick([
      "InteressiEAltriOneriFinanziari",
      "OneriFinanziari",
      "ProventiOneriFinanziariInteressiAltriOneriFinanziariTotaleInteressiAltriOneriFinanziari",
    ]);
    const valoreProduzione = pick(["TotaleValoreProduzione"]);
    const altriRicavi = pick(["ValoreProduzioneAltriRicaviProventiTotaleAltriRicaviProventi"]);
    const acquisti = pick(["CostiProduzioneMateriePrimeSussidiarieConsumoMerci"]);
    const servizi = pick(["CostiProduzioneServizi"]);
    const godimentoBeniTerzi = pick(["CostiProduzioneGodimentoBeniTerzi"]);
    const variazioneRimanenze = pick(["CostiProduzioneVariazioniRimanenzeMateriePrimeSussidiarieConsumoMerci"]);
    const oneriDiversiGestione = pick(["CostiProduzioneOneriDiversiGestione"]);
    const totaleCostiProduzione = pick(["TotaleCostiProduzione"]);
    const differenzaValoreCostiProduzione = pick(["DifferenzaValoreCostiProduzione"]);
    const risultatoPrimaImposte = pick(["RisultatoPrimaImposte"]);
    const imposte = pick(["ImposteRedditoEsercizioCorrentiDifferiteAnticipateTotaleImposteRedditoEsercizioCorrentiDifferite"]);

    return {
      anno: year,
      ragioneSociale,
      ricavi,
      totaleAttivo,
      immobilizzazioni,
      rimanenze,
      creditiTotali,
      rateiRiscontiAttivo,
      patrimonioNetto,
      utile,
      debitiTotali,
      tfr,
      rateiRiscontiPassivo,
      debitiBancariTotale,
      debitiBancariCT,
      debitiBancariLT,
      creditiClienti,
      disponibilitaLiquide: disponibilitaLiquideCalcolate,
      costiPersonale,
      ammortamenti,
      oneriFinanziari,
      valoreProduzione,
      altriRicavi,
      acquisti,
      servizi,
      godimentoBeniTerzi,
      variazioneRimanenze,
      oneriDiversiGestione,
      totaleCostiProduzione,
      differenzaValoreCostiProduzione,
      risultatoPrimaImposte,
      imposte,
      sintesi: year ? `Bilancio XBRL ${year} importato automaticamente.` : "Bilancio XBRL importato automaticamente.",
      vociSP: {
        immobilizzazioni,
        rimanenze,
        creditiTotali,
        creditiClienti,
        disponibilitaLiquide: disponibilitaLiquideCalcolate,
        rateiRiscontiAttivo,
        patrimonioNetto,
        tfr,
        debitiTotali,
        rateiRiscontiPassivo,
        debitiBancariCT,
        debitiBancariLT,
        altriDebiti: debitiTotali,
        utileEsercizio: utile,
      },
      vociCE: {
        ricaviVendite: ricavi,
        altriRicavi,
        valoreProduzione,
        acquisti,
        servizi,
        godimentoBeniTerzi,
        costiPersonale,
        ammortamentiSvalutazioni: ammortamenti,
        variazioneRimanenze,
        oneriDiversiGestione,
        totaleCostiProduzione,
        differenzaValoreCostiProduzione,
        oneriFinanziari,
        risultatoPrimaImposte,
        imposte,
        utileNetto: utile,
      },
    };
  };

  const datiCorrenti = buildYearData(latestYear || null);
  const comparativo = Object.fromEntries(anni.map(year => [String(year), buildYearData(year)]));

  return {
    ...datiCorrenti,
    anno: latestYear || null,
    anni,
    annoPrecedente: previousYear ? buildYearData(previousYear) : null,
    comparativo,
    ragioneSociale,
    sintesi: latestYear ? `Bilancio XBRL ${latestYear} importato automaticamente.` : "Bilancio XBRL importato automaticamente.",
  };
}

function parseNumeroItaliano(value: string | undefined): number | null {
  if (!value) return null;
  const clean = value.trim().replace(/\s/g, "");
  if (!clean) return null;
  const normalized = /^\d{1,3}(\.\d{3})*(,\d+)?$/.test(clean)
    ? clean.replace(/\./g, "").replace(",", ".")
    : clean.replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function parsePartitarioPdfText(testo: string, nomeFile: string): Record<string, unknown> {
  const headerRe = /Conto\s+([0-9.\s]+)\s+([\s\S]+?)\s+Partitario\s+Dal\s+\d{2}\/\d{2}\/\d{2}\s+Al\s+\d{2}\/\d{2}\/\d{2}/gi;
  const saldoRe = /([\-]?\d[\d.,]*)\s+Saldo alla data\.\.:/gi;
  const rows: Array<{ tipo: "cliente" | "fornitore"; codice: string; ragioneSociale: string; saldoPartita: number; estero: boolean }> = [];
  const headers = Array.from(testo.matchAll(headerRe));
  const filename = nomeFile.toLowerCase();

  for (let index = 0; index < headers.length; index++) {
    const match = headers[index];
    const start = match.index ?? 0;
    const end = index + 1 < headers.length ? headers[index + 1].index ?? testo.length : testo.length;
    const block = testo.slice(start, end);
    const saldi = Array.from(block.matchAll(saldoRe));
    if (saldi.length === 0) continue;

    const saldo = Math.abs(parseNumeroItaliano(saldi[saldi.length - 1][1]) ?? 0);
    if (saldo <= 0) continue;

    const codice = match[1].replace(/\s+/g, " ").trim();
    const ragioneSociale = match[2].replace(/\s+/g, " ").trim();
    const compactCode = codice.replace(/\s+/g, "");
    const tipo =
      compactCode.startsWith("53.") ? "fornitore" :
      compactCode.startsWith("3.") ? "cliente" :
      filename.includes("forn") ? "fornitore" :
      "cliente";

    rows.push({
      tipo,
      codice,
      ragioneSociale,
      saldoPartita: saldo,
      estero: /gmbh|bv|sas|corp|ireland|ltd|uc|julich/i.test(ragioneSociale),
    });
  }

  const deduped = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = `${row.tipo}::${row.codice || row.ragioneSociale.toLowerCase()}`;
    const existing = deduped.get(key);
    if (!existing || row.saldoPartita > existing.saldoPartita) deduped.set(key, row);
  }

  const partite = Array.from(deduped.values());
  const clienti = partite.filter(row => row.tipo === "cliente").map(({ tipo, ...row }) => row);
  const fornitori = partite.filter(row => row.tipo === "fornitore").map(({ tipo, ...row }) => row);
  const totaleCreditiClienti = clienti.reduce((sum, row) => sum + row.saldoPartita, 0);
  const totaleDebitiFornitori = fornitori.reduce((sum, row) => sum + row.saldoPartita, 0);

  return {
    metodo: "pdf_locale",
    clienti,
    fornitori,
    totaleCreditiClienti,
    totaleDebitiFornitori,
    concentrazioneCrediti: clienti.slice().sort((a, b) => b.saldoPartita - a.saldoPartita).slice(0, 10),
    concentrazioneDebiti: fornitori.slice().sort((a, b) => b.saldoPartita - a.saldoPartita).slice(0, 10),
    sintesi: `Partitario PDF letto localmente: ${clienti.length} clienti e ${fornitori.length} fornitori.`,
  };
}

function parseBilancioPdfText(testo: string, nomeFile: string): Record<string, unknown> {
  const findAmountAfter = (labels: string[]): number | null => {
    for (const label of labels) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`${escaped}[\\s\\S]{0,160}?([\\-]?\\d{1,3}(?:[\\.\\s]\\d{3})*(?:,\\d+)?)`, "i");
      const value = parseNumeroItaliano(testo.match(re)?.[1]);
      if (value != null) return value;
    }
    return null;
  };

  const anno = Number(testo.match(/\b(20\d{2})\b/)?.[1]) || null;
  const ricavi = findAmountAfter(["ricavi delle vendite", "ricavi vendite", "totale valore della produzione"]);
  const totaleAttivo = findAmountAfter(["totale attivo"]);
  const patrimonioNetto = findAmountAfter(["totale patrimonio netto", "patrimonio netto"]);
  const utile = findAmountAfter(["utile (perdita) dell'esercizio", "utile dell'esercizio", "perdita dell'esercizio"]);
  const debitiTotali = findAmountAfter(["totale debiti", "debiti"]);
  const disponibilitaLiquide = findAmountAfter(["disponibilita liquide", "disponibilita' liquide"]);
  const costiPersonale = findAmountAfter(["costi per il personale"]);
  const ammortamenti = findAmountAfter(["ammortamenti e svalutazioni"]);

  return {
    metodo: "pdf_locale",
    anno,
    nomeFile,
    ricavi,
    totaleAttivo,
    patrimonioNetto,
    utile,
    debitiTotali,
    disponibilitaLiquide,
    costiPersonale,
    ammortamenti,
    sintesi: `Bilancio PDF letto localmente. Valori estratti: ricavi=${ricavi ?? "n.d."}, attivo=${totaleAttivo ?? "n.d."}, patrimonio netto=${patrimonioNetto ?? "n.d."}, utile=${utile ?? "n.d."}.`,
    vociSP: { totaleAttivo, patrimonioNetto, debitiTotali, disponibilitaLiquide },
    vociCE: { ricaviVendite: ricavi, costiPersonale, ammortamenti, utileNetto: utile },
  };
}

// Parsing Excel bilancio (struttura Fornaser: CE + SP + fogli analitici)
async function parseExcelBilancio(filePreview: string): Promise<Record<string, unknown>> {
  // Usa LLM per estrarre dati strutturati dal contenuto Excel convertito in testo
  const prompt = `Sei un esperto contabile italiano. Analizza questo file Excel di bilancio aziendale italiano e estrai i dati strutturati nel seguente formato JSON.

Il file può contenere fogli come:
- CE (Conto Economico): ricavi, costi, utile/perdita
- SP (Stato Patrimoniale): attivo (immobilizzazioni, circolante), passivo (PN, debiti)
- Fogli analitici per voce (mutui, crediti, rimanenze, immobilizzazioni, ecc.)

Restituisci SOLO un JSON valido con questa struttura:
{
  "anno": number,
  "ragioneSociale": string,
  "statoPatrimoniale": {
    "totaleAttivo": number,
    "immobilizzazioniImmateriali": number,
    "immobilizzazioniMateriali": number,
    "immobilizzazioniFinanziarie": number,
    "totaleImmobilizzazioni": number,
    "rimanenze": number,
    "creditiEntro12Mesi": number,
    "disponibilitaLiquide": number,
    "totaleAttivoCircolante": number,
    "rateiRiscontiAttivo": number,
    "patrimoniNetto": number,
    "capitale": number,
    "riserve": number,
    "utileEsercizio": number,
    "debitiEntro12Mesi": number,
    "debitiOltre12Mesi": number,
    "totalDebiti": number,
    "tfr": number
  },
  "contoEconomico": {
    "ricaviVendite": number,
    "altriRicavi": number,
    "totaleValoreProduzione": number,
    "acquistiMateriePrime": number,
    "costiServizi": number,
    "costiPersonale": number,
    "ammortamenti": number,
    "altriCostiOperativi": number,
    "totaleCostiProduzione": number,
    "risultatoOperativo": number,
    "oneriFinanziari": number,
    "proventiFinanziari": number,
    "risultatoPrimaImposte": number,
    "imposte": number,
    "utileNetto": number
  },
  "indici": {
    "liquidita": number,
    "disponibilita": number,
    "adeguatezzaPatrimoniale": number,
    "sostenibilitaOneriFinanziari": number,
    "ebitda": number,
    "ritornoLiquidoAttivo": number
  },
  "vociAnalitiche": {
    "mutui": [{"descrizione": string, "importo2023": number, "importo2024": number, "variazione": number}],
    "crediti": [{"descrizione": string, "importo": number}],
    "debiti": [{"descrizione": string, "importo": number}]
  },
  "anniPrecedenti": {
    "2022": {"totaleAttivo": number, "ricavi": number, "utile": number},
    "2023": {"totaleAttivo": number, "ricavi": number, "utile": number}
  }
}

Dati del file Excel (in formato testo):
${filePreview.substring(0, 12000)}

Se un valore non è disponibile, usa null. Restituisci SOLO il JSON, senza testo aggiuntivo.`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: "Sei un esperto contabile. Restituisci SOLO JSON valido, senza markdown o testo aggiuntivo." },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" } as any,
    });
    const rawContent = response.choices[0]?.message?.content;
    return parseJsonFromLlmContent(rawContent);
  } catch {
    return {};
  }
}

// Parsing PDF/XML tramite LLM con document base64
async function parseDocumentoConLLM(fileBase64: string, tipoDocumento: string, nomeFile: string): Promise<{ chunks: string[]; datiStrutturati: Record<string, unknown> }> {
  let datiStrutturati: Record<string, unknown> = {};
  let chunks: string[] = [];

  try {
    if (tipoDocumento === "bilancio_analitico") {
      // Bilancio di verifica / mastro analitico: estrae saldi conti esplosi
      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: "Sei un esperto contabile italiano. Analizza il bilancio di verifica/mastro analitico e restituisci SOLO JSON valido senza markdown."
          },
          {
            role: "user",
            content: [
              {
                type: "document",
                source: { type: "base64", media_type: "application/pdf", data: fileBase64 }
              },
              {
                type: "text",
                text: `Analizza questo bilancio di verifica / mastro analitico italiano (file: ${nomeFile}). Estrai i saldi dei singoli conti raggruppati per area. Restituisci SOLO questo JSON:\n{\n  "anno": number,\n  "ragioneSociale": string,\n  "sintesi": string,\n  "patrimonioNetto": {\n    "capitaleSociale": number,\n    "riservaLegale": number,\n    "altreRiserve": number,\n    "utileEsercizioPrec": number,\n    "utileEsercizioCorr": number,\n    "totalePatrimonioNetto": number\n  },\n  "immobilizzazioni": {\n    "immobilizzazioniImmateriali": [{ "conto": string, "saldo": number }],\n    "immobilizzazioniMateriali": [{ "conto": string, "saldo": number }],\n    "immobilizzazioniFinanziarie": [{ "conto": string, "saldo": number }],\n    "totaleImmobilizzazioni": number\n  },\n  "rimanenze": {\n    "merci": number,\n    "prodottiFiniti": number,\n    "materiePrime": number,\n    "altreRimanenze": number,\n    "totaleRimanenze": number\n  },\n  "crediti": {\n    "creditiClienti": number,\n    "creditiVersoBanche": number,\n    "altriCrediti": number,\n    "totaleCrediti": number\n  },\n  "disponibilitaLiquide": {\n    "cassa": number,\n    "bancheContiCorrenti": number,\n    "totaleDisponibilita": number\n  },\n  "debiti": {\n    "debitiVersDipendenti": number,\n    "debitiTributari": number,\n    "debitiPrevidenziali": number,\n    "debitiFornitori": number,\n    "debitiBancariCT": number,\n    "debitiBancariLT": number,\n    "altriDebiti": number,\n    "totaleDebiti": number\n  },\n  "ricavi": {\n    "ricaviVendite": number,\n    "altriRicavi": number,\n    "totaleRicavi": number\n  },\n  "costi": {\n    "acquistiMerci": number,\n    "costiServizi": number,\n    "costiPersonale": number,\n    "ammortamenti": number,\n    "altriCosti": number,\n    "totaleCosti": number\n  },\n  "risultato": {\n    "risultatoOperativo": number,\n    "oneriFinanziari": number,\n    "proventiFinanziari": number,\n    "risultatoPrimaImposte": number,\n    "imposte": number,\n    "utileNetto": number\n  }\n}\nSe un valore non \u00e8 presente usa null. Includi TUTTI i conti con saldo significativo.`
              }
            ]
          }
        ],
        response_format: { type: "json_object" } as any,
      });
      const rawContent = response.choices[0]?.message?.content;
      datiStrutturati = parseJsonFromLlmContent(rawContent);
      const d = datiStrutturati as any;
      chunks = [
        `Bilancio analitico ${nomeFile}: PN=${d.patrimonioNetto?.totalePatrimonioNetto}, debiti dipendenti=${d.debiti?.debitiVersDipendenti}, debiti tributari=${d.debiti?.debitiTributari}`,
        JSON.stringify(datiStrutturati).substring(0, 1000)
      ];
    } else if (tipoDocumento === "bilancio" || tipoDocumento === "bilancio_revisione" || tipoDocumento === "bilancio_storico") {
      // Usa file_url per leggere direttamente il PDF da S3
      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: "Sei un esperto contabile italiano. Analizza il bilancio e restituisci SOLO JSON valido senza markdown."
          },
          {
            role: "user",
            content: [
              {
                type: "document",
                source: { type: "base64", media_type: "application/pdf", data: fileBase64 }
              },
              {
                type: "text",
                text: `Analizza questo bilancio CEE aziendale italiano (file: ${nomeFile}) ed estrai le principali voci aggregate. Restituisci SOLO questo JSON:\n{\n  "anno": number,\n  "ragioneSociale": string,\n  "ricavi": number,\n  "totaleAttivo": number,\n  "patrimonioNetto": number,\n  "utile": number,\n  "debitiTotali": number,\n  "dipendenti": number,\n  "immobilizzazioniTotali": number,\n  "creditiClienti": number,\n  "disponibilitaLiquide": number,\n  "costiPersonale": number,\n  "ammortamenti": number,\n  "oneriFinanziari": number,\n  "ebitda": number,\n  "sintesi": "breve sintesi del bilancio in 2-3 frasi",\n  "vociSP": {\n    "immobilizzazioniImmateriali": number,\n    "immobilizzazioniMateriali": number,\n    "immobilizzazioniFinanziarie": number,\n    "rimanenze": number,\n    "creditiClienti": number,\n    "altriCrediti": number,\n    "disponibilitaLiquide": number,\n    "altreAttivita": number,\n    "capitalesociale": number,\n    "riserve": number,\n    "utileEsercizio": number,\n    "fondiRischi": number,\n    "tfr": number,\n    "debitiBancariLT": number,\n    "debitiBancariCT": number,\n    "debitiFornitori": number,\n    "debitiVersDipendenti": number,\n    "debitiTributari": number,\n    "debitiPrevidenziali": number,\n    "altriDebiti": number\n  },\n  "vociCE": {\n    "ricaviVendite": number,\n    "altriRicavi": number,\n    "acquistiBeni": number,\n    "costiServizi": number,\n    "costiPersonale": number,\n    "ammortamentiSvalutazioni": number,\n    "altriCostiOperativi": number,\n    "proventiFinanziari": number,\n    "oneriFinanziari": number,\n    "imposteSulReddito": number,\n    "utileNetto": number\n  }\n}\nSe un valore non \u00e8 presente usa null.`
              }
            ]
          }
        ],
        response_format: { type: "json_object" } as any,
      });
      const rawContent = response.choices[0]?.message?.content;
      datiStrutturati = parseJsonFromLlmContent(rawContent);
      chunks = [
        `Bilancio ${nomeFile}: ricavi=${(datiStrutturati as any).ricavi}, attivo=${(datiStrutturati as any).totaleAttivo}, PN=${(datiStrutturati as any).patrimonioNetto}, utile=${(datiStrutturati as any).utile}`,
        JSON.stringify(datiStrutturati).substring(0, 800)
      ];
    } else {
      // Per altri tipi di documento: estrai testo generico
      const response = await invokeLLM({
        messages: [
          { role: "system", content: "Sei un esperto revisore legale italiano. Analizza il documento e restituisci SOLO JSON valido." },
          {
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: fileBase64 } },
              { type: "text", text: `Analizza questo documento (${tipoDocumento}, file: ${nomeFile}) ed estrai le informazioni rilevanti per la revisione legale. Restituisci JSON: {"tipo": "${tipoDocumento}", "sintesi": string, "dataDocumento": string, "importiRilevanti": [number], "noteRevisore": string}` }
            ]
          }
        ],
        response_format: { type: "json_object" } as any,
      });
      const rawContent = response.choices[0]?.message?.content;
      datiStrutturati = parseJsonFromLlmContent(rawContent);
      chunks = [(datiStrutturati as any).sintesi || nomeFile, JSON.stringify(datiStrutturati).substring(0, 500)];
    }
  } catch (err: any) {
    console.error("[parseDocumentoConLLM] Errore:", err?.message);
    // Fallback: salva almeno il nome file come chunk
    chunks = [`Documento: ${nomeFile} (tipo: ${tipoDocumento})`];
    datiStrutturati = { errore: err?.message, nomeFile };
  }

  return { chunks, datiStrutturati };
}

export const documentiRouter = router({
  listByIncarico: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .query(async ({ input }) => {
      return getDocumentiByIncarico(input.incaricoId);
    }),

  upload: protectedProcedure
    .input(
      z.object({
        incaricoId: z.number(),
        nomeFile: z.string(),
        tipoFile: z.enum(["pdf", "xml", "xbrl", "xlsx", "csv", "altro"]),
        tipoDocumento: z
          .enum(["bilancio_revisione", "bilancio_storico", "bilancio_analitico", "bilancio", "nota_integrativa", "verbale_assemblea", "contratto", "estratto_conto", "libro_mastro", "partitario", "altro"])
          .optional(),
        annoRiferimento: z.number().optional(), // anno di riferimento del bilancio
        contenutoBase64: z.string(), // file in base64
        testoEstratto: z.string().optional(),
        datiStrutturatiClient: z.record(z.string(), z.unknown()).optional(),
        dimensioneBytes: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const incarico = await getIncaricoById(input.incaricoId);
      if (!incarico) throw new TRPCError({ code: "NOT_FOUND", message: "Incarico non trovato" });

      // Upload su S3
      const buffer = Buffer.from(input.contenutoBase64, "base64");
      const s3Key = `incarichi/${input.incaricoId}/${Date.now()}-${input.nomeFile}`;
      const mimeTypes: Record<string, string> = {
        pdf: "application/pdf",
        xml: "application/xml",
        xbrl: "application/xml",
        xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        csv: "text/csv",
        altro: "application/octet-stream",
      };
      const { url } = await storagePut(s3Key, buffer, mimeTypes[input.tipoFile] || "application/octet-stream");

      // Crea record documento con stato in_corso (parsing parte subito)
      const doc = await createDocumento({
        incaricoId: input.incaricoId,
        nomeFile: input.nomeFile,
        tipoFile: input.tipoFile,
        tipoDocumento: input.tipoDocumento || "altro",
        annoRiferimento: input.annoRiferimento,
        s3Key,
        s3Url: url,
        dimensioneBytes: input.dimensioneBytes,
        statoParsing: "in_corso",
      });

      // Parsing automatico in background (non blocca la risposta)
      setImmediate(async () => {
        try {
          let chunks: string[] = [];
          let datiStrutturati: Record<string, unknown> = {};

          if (input.tipoFile === "xbrl" || input.tipoFile === "xml") {
            datiStrutturati = parseXbrlBilancio(buffer);
            chunks = [`Bilancio XBRL/XML: ${input.nomeFile}`, JSON.stringify(datiStrutturati).substring(0, 800)];
          } else if (input.tipoFile === "xlsx" || input.tipoFile === "csv") {
            const preview = buildSpreadsheetPreview(input.nomeFile, buffer);
            datiStrutturati = await parseExcelBilancio(preview);
            chunks = [`Bilancio Excel: ${input.nomeFile}`, JSON.stringify(datiStrutturati).substring(0, 500)];
          } else if (input.tipoFile === "pdf") {
            if (input.datiStrutturatiClient && Object.keys(input.datiStrutturatiClient).length > 0) {
              datiStrutturati = input.datiStrutturatiClient;
            } else if (input.testoEstratto) {
              datiStrutturati = input.tipoDocumento === "partitario"
                ? parsePartitarioPdfText(input.testoEstratto, input.nomeFile)
                : parseBilancioPdfText(input.testoEstratto, input.nomeFile);
            } else {
              datiStrutturati = {
                metodo: "pdf_locale_non_disponibile",
                nomeFile: input.nomeFile,
                sintesi: "PDF caricato. Per evitare invii all'IA, carica PDF testuale, XBRL/XML o Excel per il popolamento automatico.",
              };
            }
            chunks = [`PDF elaborato localmente: ${input.nomeFile}`, JSON.stringify(datiStrutturati).substring(0, 800)];
          }

          await updateDocumento(doc.id, {
            statoParsing: "completato",
            testoEstrattoChunks: chunks,
            datiStrutturati,
          });

          // Alert automatici su valori anomali
          if (datiStrutturati && (datiStrutturati as any).utile !== undefined) {
            const utile = (datiStrutturati as any).utile as number;
            const ricavi = (datiStrutturati as any).ricavi as number;
            if (utile < 0) {
              await createAlert({
                incaricoId: input.incaricoId,
                modulo: "comprensione",
                tipoAlert: "anomalia_bilancio",
                severita: "warning",
                titolo: "Perdita di esercizio rilevata",
                messaggio: `Il documento "${input.nomeFile}" evidenzia una perdita di esercizio (${utile?.toLocaleString("it-IT")} €). Valutare la continuità aziendale (ISA Italia 570).`,
                datiContesto: { utile, ricavi, nomeFile: input.nomeFile },
              });
            }
          }
        } catch (err: any) {
          console.error("[Auto-parse] Errore:", err?.message);
          await updateDocumento(doc.id, { statoParsing: "errore", erroreParser: err?.message });
        }
      });

      return { ...doc, statoParsing: "in_corso" as const };
    }),

  parse: protectedProcedure
    .input(z.object({ documentoId: z.number() }))
    .mutation(async ({ input }) => {
      const doc = await getDocumentoById(input.documentoId);
      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });

      await updateDocumento(doc.id, { statoParsing: "in_corso" });

      try {
        let chunks: string[] = [];
        let datiStrutturati: Record<string, unknown> = {};
        const buffer = await fs.readFile(resolveStoragePath(doc.s3Key));

        if (doc.tipoFile === "xbrl" || doc.tipoFile === "xml") {
          datiStrutturati = parseXbrlBilancio(buffer);
          chunks = [`Bilancio XBRL/XML: ${doc.nomeFile}`, JSON.stringify(datiStrutturati).substring(0, 800)];
        } else if (doc.tipoFile === "xlsx" || doc.tipoFile === "csv") {
          const preview = buildSpreadsheetPreview(doc.nomeFile, buffer);
          datiStrutturati = await parseExcelBilancio(preview);
          chunks = [`Bilancio Excel: ${doc.nomeFile}`, JSON.stringify(datiStrutturati).substring(0, 500)];
        } else if (doc.tipoFile === "pdf") {
          datiStrutturati = {
            metodo: "pdf_locale_non_disponibile",
            nomeFile: doc.nomeFile,
            sintesi: "PDF gia' caricato. Il parsing automatico locale avviene durante il caricamento dal browser; ricarica il PDF o usa XBRL/XML/Excel.",
          };
          chunks = [`PDF: ${doc.nomeFile}`, JSON.stringify(datiStrutturati).substring(0, 800)];
        }

        await updateDocumento(doc.id, {
          statoParsing: "completato",
          testoEstrattoChunks: chunks,
          datiStrutturati,
        });

        // Alert se dati bilancio estratti e valori anomali
        if (datiStrutturati && (datiStrutturati as any).utile !== undefined) {
          const utile = (datiStrutturati as any).utile as number;
          const ricavi = (datiStrutturati as any).ricavi as number;
          if (utile < 0) {
            await createAlert({
              incaricoId: doc.incaricoId,
              modulo: "comprensione",
              tipoAlert: "anomalia_bilancio",
              severita: "warning",
              titolo: "Perdita di esercizio rilevata",
              messaggio: `Il documento "${doc.nomeFile}" evidenzia una perdita di esercizio (${utile?.toLocaleString("it-IT")} €). Valutare l'impatto sulla continuità aziendale (ISA Italia 570).`,
              datiContesto: { utile, ricavi, nomeFile: doc.nomeFile },
            });
          }
          if (ricavi > 0 && Math.abs(utile) / ricavi > 0.3) {
            await createAlert({
              incaricoId: doc.incaricoId,
              modulo: "comprensione",
              tipoAlert: "variazione_anomala",
              severita: "warning",
              titolo: "Risultato anomalo rispetto ai ricavi",
              messaggio: `Il risultato d'esercizio (${utile?.toLocaleString("it-IT")} €) è superiore al 30% dei ricavi. Verificare la correttezza dei dati estratti.`,
              datiContesto: { utile, ricavi },
            });
          }
        }

        return { success: true, datiStrutturati, chunksCount: chunks.length };
      } catch (err: any) {
        await updateDocumento(doc.id, { statoParsing: "errore", erroreParser: err?.message || "Errore sconosciuto" });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err?.message });
      }
    }),

  // Ri-analizza un documento già caricato con LLM (forza re-parsing)
  rianalisaBilancio: protectedProcedure
    .input(z.object({ documentoId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const doc = await getDocumentoById(input.documentoId);
      if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Documento non trovato" });

      // Verifica che il documento appartenga all'utente
      const incarico = await getIncaricoById(doc.incaricoId);
      if (!incarico || incarico.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Accesso non autorizzato" });
      }

      // Solo per bilanci (non per altri tipi di documento)
      const tipiBilancio = ["bilancio", "bilancio_revisione", "bilancio_storico", "bilancio_analitico"];
      if (!tipiBilancio.includes(doc.tipoDocumento || "")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Ri-analisi disponibile solo per bilanci" });
      }

      await updateDocumento(doc.id, { statoParsing: "in_corso" });

      try {
        let chunks: string[] = [];
        let datiStrutturati: Record<string, unknown> = {};
        const buffer = await fs.readFile(resolveStoragePath(doc.s3Key));

        if (doc.tipoFile === "xlsx" || doc.tipoFile === "csv") {
          const preview = buildSpreadsheetPreview(doc.nomeFile, buffer);
          datiStrutturati = await parseExcelBilancio(preview);
          chunks = [`Bilancio Excel: ${doc.nomeFile}`, JSON.stringify(datiStrutturati).substring(0, 500)];
        } else if (doc.tipoFile === "pdf" || doc.tipoFile === "xml" || doc.tipoFile === "xbrl") {
          const result = await parseDocumentoConLLM(
            buffer.toString("base64"),
            doc.tipoDocumento || "bilancio",
            doc.nomeFile
          );
          chunks = result.chunks;
          datiStrutturati = result.datiStrutturati;
        } else {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Formato file non supportato per ri-analisi: ${doc.tipoFile}` });
        }

        await updateDocumento(doc.id, {
          statoParsing: "completato",
          testoEstrattoChunks: chunks,
          datiStrutturati,
        });

        return { success: true, datiStrutturati, chunksCount: chunks.length, nomeFile: doc.nomeFile };
      } catch (err: any) {
        await updateDocumento(doc.id, { statoParsing: "errore", erroreParser: err?.message || "Errore sconosciuto" });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err?.message });
      }
    }),

  // Query RAG: cerca nei chunk dei documenti dell'incarico
  ragQuery: protectedProcedure
    .input(z.object({ incaricoId: z.number(), query: z.string() }))
    .mutation(async ({ input }) => {
      const docs = await getDocumentiByIncarico(input.incaricoId);
      const docsConChunks = docs.filter(d => d.statoParsing === "completato" && d.testoEstrattoChunks);

      if (docsConChunks.length === 0) {
        return { contesto: "", fonti: [] };
      }

      // Raccoglie tutti i chunk disponibili
      const tuttiChunks: { testo: string; fonte: string }[] = [];
      for (const doc of docsConChunks) {
        const chunks = doc.testoEstrattoChunks as string[];
        if (Array.isArray(chunks)) {
          chunks.forEach(chunk => tuttiChunks.push({ testo: chunk, fonte: doc.nomeFile }));
        }
        // Aggiunge anche i dati strutturati come contesto
        if (doc.datiStrutturati) {
          tuttiChunks.push({
            testo: `Dati strutturati da ${doc.nomeFile}: ${JSON.stringify(doc.datiStrutturati).substring(0, 800)}`,
            fonte: doc.nomeFile,
          });
        }
      }

      // Selezione semplice: prende i primi N chunk rilevanti (in produzione si userebbe embedding)
      const contestoRilevante = tuttiChunks.slice(0, 5).map(c => c.testo).join("\n\n---\n\n");
      const fontiSet = new Set(tuttiChunks.slice(0, 5).map(c => c.fonte));
      const fonti = Array.from(fontiSet);

      return { contesto: contestoRilevante, fonti };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteDocumento(input.id);
      return { success: true };
    }),

  // Esporta tutti i dati strutturati estratti in formato CSV
  esportaCsv: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .query(async ({ input }) => {
      const docs = await getDocumentiByIncarico(input.incaricoId);
      const docsConDati = docs.filter(d => d.statoParsing === "completato" && d.datiStrutturati);

      if (docsConDati.length === 0) {
        return { csv: "", righe: 0 };
      }

      // Raccoglie tutte le chiavi uniche presenti nei datiStrutturati di tutti i documenti
      const tutteLeChiavi = new Set<string>();
      tutteLeChiavi.add("documento");
      tutteLeChiavi.add("tipoDocumento");
      tutteLeChiavi.add("tipoFile");
      tutteLeChiavi.add("statoParsing");

      for (const doc of docsConDati) {
        const dati = doc.datiStrutturati as Record<string, unknown>;
        for (const k of Object.keys(dati)) {
          // Esclude oggetti annidati complessi (array, oggetti profondi)
          const val = dati[k];
          if (val === null || val === undefined || typeof val !== "object") {
            tutteLeChiavi.add(k);
          } else if (Array.isArray(val) && val.length > 0 && typeof val[0] !== "object") {
            tutteLeChiavi.add(k);
          }
        }
      }

      const colonne = Array.from(tutteLeChiavi);

      // Funzione per sfuggire i valori CSV
      const escapeCsv = (val: unknown): string => {
        if (val === null || val === undefined) return "";
        const str = Array.isArray(val) ? val.join("; ") : String(val);
        if (str.includes(",") || str.includes('"') || str.includes("\n")) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      // Intestazione
      const righe: string[] = [colonne.map(escapeCsv).join(",")];

      // Una riga per documento
      for (const doc of docsConDati) {
        const dati = doc.datiStrutturati as Record<string, unknown>;
        const riga = colonne.map(col => {
          if (col === "documento") return escapeCsv(doc.nomeFile);
          if (col === "tipoDocumento") return escapeCsv(doc.tipoDocumento);
          if (col === "tipoFile") return escapeCsv(doc.tipoFile);
          if (col === "statoParsing") return escapeCsv(doc.statoParsing);
          return escapeCsv(dati[col]);
        });
        righe.push(riga.join(","));
      }

      const csv = righe.join("\n");
      return { csv, righe: docsConDati.length, colonne: colonne.length };
    }),

  // Presigned URL per download sicuro di un documento (scadenza ~15 min)
  getPresignedUrl: protectedProcedure
    .input(z.object({ documentoId: z.number() }))
    .query(async ({ input }) => {
      const doc = await getDocumentoById(input.documentoId);
      if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Documento non trovato" });
      try {
        const { url } = await storageGet(doc.s3Key);
        return { url, nomeFile: doc.nomeFile };
      } catch {
        // Fallback all'URL permanente se il presigned non è disponibile
        return { url: doc.s3Url, nomeFile: doc.nomeFile };
      }
    }),

  // Confronto pluriennale: bilancio revisione + bilanci storici affiancati
  getConfrontoBilanci: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .query(async ({ input }) => {
      const docs = await getDocumentiByIncarico(input.incaricoId);
      const bilanci = docs.filter(d =>
        (d.tipoDocumento === "bilancio_revisione" || d.tipoDocumento === "bilancio_storico" || d.tipoDocumento === "bilancio") &&
        d.statoParsing === "completato" &&
        d.datiStrutturati
      );

      if (bilanci.length === 0) return { disponibile: false as const, anni: [], confronto: null };

      const toNumber = (value: unknown): number | null => {
        if (typeof value === "number" && Number.isFinite(value)) return value;
        if (typeof value === "string") {
          const n = Number(value.replace(/\./g, "").replace(",", "."));
          return Number.isFinite(n) ? n : null;
        }
        return null;
      };

      const estraiDatiAnno = (
        d: Record<string, unknown>,
        meta: { anno: number | null; nomeFile: string; tipo: string }
      ) => {
        const sp = (d.statoPatrimoniale as Record<string, unknown>) || {};
        const ce = (d.contoEconomico as Record<string, unknown>) || {};
        const vociSP = (d.vociSP as Record<string, unknown>) || {};
        const vociCE = (d.vociCE as Record<string, unknown>) || {};
        return {
          anno: meta.anno,
          nomeFile: meta.nomeFile,
          tipo: meta.tipo,
          ricavi: toNumber(d.ricavi ?? ce.ricaviVendite ?? ce.totaleValoreProduzione ?? vociCE.ricaviVendite),
          totaleAttivo: toNumber(d.totaleAttivo ?? sp.totaleAttivo),
          patrimonioNetto: toNumber(d.patrimonioNetto ?? sp.patrimonioNetto ?? sp.patrimoniNetto),
          utile: toNumber(d.utile ?? sp.utileEsercizio ?? ce.utileNetto ?? vociSP.utileEsercizio ?? vociCE.utileNetto),
          debitiTotali: toNumber(d.debitiTotali ?? sp.totaleDebiti ?? sp.totalDebiti ?? vociSP.altriDebiti),
          costiPersonale: toNumber(d.costiPersonale ?? ce.costiPersonale ?? vociCE.costiPersonale),
          oneriFinanziari: toNumber(d.oneriFinanziari ?? ce.oneriFinanziari ?? vociCE.oneriFinanziari),
          ebitda: toNumber(d.ebitda ?? (ce as any)?.ebitda),
        };
      };

      // Un XBRL CEE spesso contiene due esercizi affiancati nello stesso file:
      // lo spacchettiamo in due righe, così Modulo 2 e analisi trend vedono il comparativo.
      const estrattiRaw = bilanci.flatMap(b => {
        const d = b.datiStrutturati as Record<string, unknown>;
        const comparativo = d.comparativo as Record<string, unknown> | undefined;
        if (comparativo && typeof comparativo === "object" && Object.keys(comparativo).length > 0) {
          return Object.entries(comparativo).map(([anno, datiAnno]) =>
            estraiDatiAnno((datiAnno as Record<string, unknown>) || {}, {
              anno: Number(anno) || null,
              nomeFile: b.nomeFile ?? "Bilancio",
              tipo: b.tipoDocumento ?? "bilancio",
            })
          );
        }

        return [estraiDatiAnno(d, {
          anno: b.annoRiferimento ?? (d.anno as number) ?? null,
          nomeFile: b.nomeFile ?? "Bilancio",
          tipo: b.tipoDocumento ?? "bilancio",
        })];
      });

      const scoreCompletezza = (row: (typeof estrattiRaw)[number]) =>
        ["ricavi", "totaleAttivo", "patrimonioNetto", "utile", "debitiTotali", "costiPersonale", "oneriFinanziari"]
          .filter(key => row[key as keyof typeof row] !== null).length;
      const prioritaTipo = (tipo: string) => tipo === "bilancio_revisione" ? 3 : tipo === "bilancio" ? 2 : 1;
      const perAnno = new Map<string, (typeof estrattiRaw)[number]>();
      for (const row of estrattiRaw) {
        const key = row.anno != null ? String(row.anno) : `${row.nomeFile}-${row.tipo}`;
        const existing = perAnno.get(key);
        if (
          !existing ||
          prioritaTipo(row.tipo) > prioritaTipo(existing.tipo) ||
          (prioritaTipo(row.tipo) === prioritaTipo(existing.tipo) && scoreCompletezza(row) > scoreCompletezza(existing))
        ) {
          perAnno.set(key, row);
        }
      }
      const estratti = Array.from(perAnno.values()).sort((a, b) => (a.anno ?? 0) - (b.anno ?? 0));

      // Calcola variazioni percentuali tra anni consecutivi
      const voci: Array<keyof typeof estratti[0]> = ["ricavi", "totaleAttivo", "patrimonioNetto", "utile", "debitiTotali", "costiPersonale", "oneriFinanziari"];
      const confronto: Record<string, Array<{ anno: number | null; valore: number | null; delta: number | null; deltaPerc: number | null }>> = {};

      for (const voce of voci) {
        confronto[voce as string] = estratti.map((b, i) => {
          const valore = b[voce] as number | null;
          let delta: number | null = null;
          let deltaPerc: number | null = null;
          if (i > 0) {
            const valPrecedente = estratti[i - 1][voce] as number | null;
            if (valore !== null && valPrecedente !== null && valPrecedente !== 0) {
              delta = valore - valPrecedente;
              deltaPerc = Math.round((delta / Math.abs(valPrecedente)) * 10000) / 100;
            }
          }
          return { anno: b.anno, valore, delta, deltaPerc };
        });
      }

      const anni = estratti.map(b => b.anno);
      return { disponibile: true as const, anni, estratti, confronto };
    }),

  // Dati dal bilancio di revisione per pre-popolare il Modulo 4 (materialità)
  getDatiPerMaterialita: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .query(async ({ input }) => {
      const docs = await getDocumentiByIncarico(input.incaricoId);
      const bilancio = docs.find(d =>
        d.tipoDocumento === "bilancio_revisione" &&
        d.statoParsing === "completato" &&
        d.datiStrutturati
      ) || docs.find(d =>
        (d.tipoDocumento === "bilancio" || d.tipoDocumento === "bilancio_storico") &&
        d.statoParsing === "completato" &&
        d.datiStrutturati
      );

      if (!bilancio || !bilancio.datiStrutturati) {
        return { disponibile: false as const, valori: null };
      }

      const d = bilancio.datiStrutturati as Record<string, unknown>;
      const sp = (d.statoPatrimoniale as Record<string, unknown>) || {};
      const ce = (d.contoEconomico as Record<string, unknown>) || {};

      const ricavi = ((d.ricavi ?? ce.ricaviVendite ?? ce.totaleValoreProduzione) ?? null) as number | null;
      const totaleAttivo = ((d.totaleAttivo ?? sp.totaleAttivo) ?? null) as number | null;
      const patrimonioNetto = ((d.patrimonioNetto ?? sp.patrimoniNetto) ?? null) as number | null;
      const utile = ((d.utile ?? sp.utileEsercizio ?? ce.utileNetto) ?? null) as number | null;

      // Suggerisci il benchmark ottimale
      let benchmarkConsigliato: "ricavi_netti" | "totale_attivo" | "patrimonio_netto" | "utile_ante_imposte" = "ricavi_netti";
      let percentualeConsigliata = 0.75;
      let motivazione = "Ricavi netti come benchmark principale (ISA Italia 320)";

      if (ricavi !== null && totaleAttivo !== null) {
        if (ricavi >= (totaleAttivo ?? 0) * 0.3) {
          benchmarkConsigliato = "ricavi_netti";
          percentualeConsigliata = 0.75;
          motivazione = "I ricavi sono il benchmark più rappresentativo. Percentuale 0,75% (ISA Italia 320).";
        } else if (totaleAttivo !== null && totaleAttivo > (ricavi ?? 0) * 2) {
          benchmarkConsigliato = "totale_attivo";
          percentualeConsigliata = 1.5;
          motivazione = "Il totale attivo è preponderante rispetto ai ricavi. Percentuale 1,5% (ISA Italia 320).";
        } else if (patrimonioNetto !== null && utile !== null && utile > 0) {
          benchmarkConsigliato = "utile_ante_imposte";
          percentualeConsigliata = 7.5;
          motivazione = "L'utile ante imposte è stabile e positivo. Percentuale 7,5% (ISA Italia 320).";
        }
      }

      return {
        disponibile: true as const,
        nomeFile: bilancio.nomeFile,
        annoRiferimento: bilancio.annoRiferimento,
        valori: { ricavi_netti: ricavi, totale_attivo: totaleAttivo, patrimonio_netto: patrimonioNetto, utile_ante_imposte: utile },
        benchmarkConsigliato,
        percentualeConsigliata,
        motivazione,
      };
    }),

  // Recupera i dati strutturati estratti dal bilancio oggetto di revisione
  getDatiBilancioRevisione: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .query(async ({ input }) => {
      const docs = await getDocumentiByIncarico(input.incaricoId);
      // Cerca prima bilancio_revisione, poi bilancio generico
      const bilancio = docs.find(d =>
        d.tipoDocumento === "bilancio_revisione" &&
        d.statoParsing === "completato" &&
        d.datiStrutturati
      ) || docs.find(d =>
        (d.tipoDocumento === "bilancio" || d.tipoDocumento === "bilancio_storico") &&
        d.statoParsing === "completato" &&
        d.datiStrutturati
      );
      if (!bilancio || !bilancio.datiStrutturati) {
        return { disponibile: false as const, dati: null, nomeFile: null, annoRiferimento: null };
      }
      const d = bilancio.datiStrutturati as Record<string, unknown>;
      // Supporta sia struttura piatta che struttura annidata (Excel con CE/SP separati)
      const sp = (d.statoPatrimoniale as Record<string, unknown>) || {};
      const ce = (d.contoEconomico as Record<string, unknown>) || {};
      return {
        disponibile: true as const,
        nomeFile: bilancio.nomeFile,
        annoRiferimento: bilancio.annoRiferimento,
        dati: {
          anno: (d.anno ?? null) as number | null,
          anni: (d.anni ?? null) as number[] | null,
          ragioneSociale: (d.ragioneSociale ?? null) as string | null,
          ricavi: ((d.ricavi ?? ce.ricaviVendite ?? ce.totaleValoreProduzione) ?? null) as number | null,
          totaleAttivo: ((d.totaleAttivo ?? sp.totaleAttivo) ?? null) as number | null,
          patrimonioNetto: ((d.patrimonioNetto ?? sp.patrimonioNetto ?? sp.patrimoniNetto) ?? null) as number | null,
          utile: ((d.utile ?? sp.utileEsercizio ?? ce.utileNetto) ?? null) as number | null,
          debitiTotali: ((d.debitiTotali ?? sp.totaleDebiti ?? sp.totalDebiti) ?? null) as number | null,
          debitiBancariTotale: ((d.debitiBancariTotale ?? sp.debitiBancariTotale) ?? null) as number | null,
          debitiBancariCT: ((d.debitiBancariCT ?? sp.debitiBancariCT) ?? null) as number | null,
          debitiBancariLT: ((d.debitiBancariLT ?? sp.debitiBancariLT) ?? null) as number | null,
          dipendenti: (d.dipendenti ?? null) as number | null,
          immobilizzazioniTotali: ((d.immobilizzazioniTotali ?? sp.totaleImmobilizzazioni) ?? null) as number | null,
          creditiClienti: ((d.creditiClienti ?? sp.creditiEntro12Mesi) ?? null) as number | null,
          disponibilitaLiquide: ((d.disponibilitaLiquide ?? sp.disponibilitaLiquide) ?? null) as number | null,
          costiPersonale: ((d.costiPersonale ?? ce.costiPersonale) ?? null) as number | null,
          ammortamenti: ((d.ammortamenti ?? ce.ammortamenti) ?? null) as number | null,
          oneriFinanziari: ((d.oneriFinanziari ?? ce.oneriFinanziari) ?? null) as number | null,
          ebitda: ((d.ebitda ?? (ce as any)?.ebitda) ?? null) as number | null,
          sintesi: (d.sintesi ?? null) as string | null,
          annoPrecedente: (d.annoPrecedente ?? null) as Record<string, unknown> | null,
          comparativo: (d.comparativo ?? null) as Record<string, unknown> | null,
        }
      };
    }),

  // Recupera dati dal bilancio analitico (bilancio di verifica con saldi conti esplosi)
  getDatiBilancioAnalitico: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .query(async ({ input }) => {
      const docs = await getDocumentiByIncarico(input.incaricoId);
      const bilancio = docs.find(d =>
        d.tipoDocumento === "bilancio_analitico" &&
        d.statoParsing === "completato" &&
        d.datiStrutturati
      );
      if (!bilancio || !bilancio.datiStrutturati) {
        return { disponibile: false as const, dati: null, nomeFile: null, annoRiferimento: null };
      }
      const d = bilancio.datiStrutturati as any;
      return {
        disponibile: true as const,
        nomeFile: bilancio.nomeFile,
        annoRiferimento: bilancio.annoRiferimento,
        dati: d,
      };
    }),

  // Analisi verticale: peso % di ogni voce SP e CE sul totale
  getAnalisiVerticale: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .query(async ({ input }) => {
      const docs = await getDocumentiByIncarico(input.incaricoId);
      // Priorità: bilancio_analitico > bilancio_revisione > bilancio generico
      const bilancio = docs.find(d =>
        d.tipoDocumento === "bilancio_revisione" &&
        d.statoParsing === "completato" &&
        d.datiStrutturati
      ) || docs.find(d =>
        (d.tipoDocumento === "bilancio" || d.tipoDocumento === "bilancio_storico") &&
        d.statoParsing === "completato" &&
        d.datiStrutturati
      ) || docs.find(d =>
        d.tipoDocumento === "bilancio_analitico" &&
        d.statoParsing === "completato" &&
        d.datiStrutturati
      );
      if (!bilancio || !bilancio.datiStrutturati) {
        return { disponibile: false as const, sp: null, ce: null, nomeFile: null, annoRiferimento: null };
      }

      const d = bilancio.datiStrutturati as Record<string, unknown>;
      const isBilancioAnalitico = bilancio.tipoDocumento === "bilancio_analitico";

      // Strutture per bilancio CEE (vecchio formato)
      const sp = (d.statoPatrimoniale as Record<string, unknown>) || {};
      const ce = (d.contoEconomico as Record<string, unknown>) || {};
      const vociSP = (d.vociSP as Record<string, unknown>) || {};
      const vociCE = (d.vociCE as Record<string, unknown>) || {};

      // Strutture per bilancio analitico (nuovo formato con sezioni esplicite)
      const anPn = (d.patrimonioNetto as Record<string, unknown>) || {};
      const anImm = (d.immobilizzazioni as Record<string, unknown>) || {};
      const anRim = (d.rimanenze as Record<string, unknown>) || {};
      const anCred = (d.crediti as Record<string, unknown>) || {};
      const anDisp = (d.disponibilitaLiquide as Record<string, unknown>) || {};
      const anDeb = (d.debiti as Record<string, unknown>) || {};
      const anRic = (d.ricavi as Record<string, unknown>) || {};
      const anCos = (d.costi as Record<string, unknown>) || {};
      const anRis = (d.risultato as Record<string, unknown>) || {};

      // Mapping unificato: bilancio_analitico ha priorità, poi CEE, poi root
      const rootSP: Record<string, unknown> = isBilancioAnalitico ? {
        immobilizzazioniImmateriali: anImm.totaleImmobilizzazioni ?? d.immobilizzazioniImmateriali ?? null, // somma
        immobilizzazioniMateriali: d.immobilizzazioniMateriali ?? null, // dettaglio nei conti
        immobilizzazioniFinanziarie: d.immobilizzazioniFinanziarie ?? null,
        rimanenze: anRim.totaleRimanenze ?? d.rimanenze ?? null,
        creditiClienti: anCred.creditiClienti ?? d.creditiClienti ?? null,
        altriCrediti: anCred.altriCrediti ?? d.altriCrediti ?? null,
        disponibilitaLiquide: (anDisp as any).totaleDisponibilita ?? (anDisp as any).bancheContiCorrenti ?? d.disponibilitaLiquide ?? null,
        altreAttivita: d.altreAttivita ?? null,
        capitalesociale: anPn.capitaleSociale ?? d.capitalesociale ?? d.capitale ?? null,
        riserve: (((anPn.riservaLegale as number ?? 0) + (anPn.altreRiserve as number ?? 0)) || d.riserve) ?? null,
        utileEsercizio: anPn.utileEsercizioCorr ?? d.utile ?? d.utileEsercizio ?? null,
        fondiRischi: null,
        tfr: null,
        debitiBancariLT: anDeb.debitiBancariLT ?? null,
        debitiBancariCT: anDeb.debitiBancariCT ?? null,
        debitiFornitori: anDeb.debitiFornitori ?? null,
        debitiVersDipendenti: anDeb.debitiVersDipendenti ?? null,
        debitiTributari: anDeb.debitiTributari ?? null,
        debitiPrevidenziali: anDeb.debitiPrevidenziali ?? null,
        altriDebiti: anDeb.altriDebiti ?? d.altriDebiti ?? d.debitiTotali ?? null,
      } : {
        immobilizzazioniImmateriali: d.immobilizzazioniImmateriali ?? null,
        immobilizzazioniMateriali: d.immobilizzazioniMateriali ?? null,
        immobilizzazioniFinanziarie: d.immobilizzazioniFinanziarie ?? null,
        rimanenze: d.rimanenze ?? null,
        creditiClienti: d.creditiClienti ?? null,
        altriCrediti: d.altriCrediti ?? null,
        disponibilitaLiquide: d.disponibilitaLiquide ?? null,
        altreAttivita: d.altreAttivita ?? null,
        capitalesociale: d.capitalesociale ?? d.capitale ?? null,
        riserve: d.riserve ?? null,
        utileEsercizio: d.utile ?? d.utileEsercizio ?? null,
        fondiRischi: d.fondiRischi ?? null,
        tfr: d.tfr ?? null,
        debitiBancariLT: d.debitiBancariLT ?? null,
        debitiBancariCT: d.debitiBancariCT ?? null,
        debitiFornitori: d.debitiFornitori ?? null,
        debitiVersDipendenti: (vociSP as any).debitiVersDipendenti ?? null,
        debitiTributari: (vociSP as any).debitiTributari ?? null,
        debitiPrevidenziali: (vociSP as any).debitiPrevidenziali ?? null,
        altriDebiti: d.altriDebiti ?? d.debitiTotali ?? null,
      };
      const rootCE: Record<string, unknown> = isBilancioAnalitico ? {
        ricaviVendite: anRic.ricaviVendite ?? d.ricavi ?? d.ricaviVendite ?? null,
        altriRicavi: anRic.altriRicavi ?? d.altriRicavi ?? null,
        acquistiBeni: anCos.acquistiMerci ?? d.acquistiBeni ?? null,
        costiServizi: anCos.costiServizi ?? d.costiServizi ?? null,
        costiPersonale: anCos.costiPersonale ?? d.costiPersonale ?? null,
        ammortamentiSvalutazioni: anCos.ammortamenti ?? d.ammortamenti ?? d.ammortamentiSvalutazioni ?? null,
        altriCostiOperativi: anCos.altriCosti ?? d.altriCostiOperativi ?? null,
        proventiFinanziari: anRis.proventiFinanziari ?? d.proventiFinanziari ?? null,
        oneriFinanziari: anRis.oneriFinanziari ?? d.oneriFinanziari ?? null,
        imposteSulReddito: anRis.imposte ?? d.imposteSulReddito ?? null,
        utileNetto: anRis.utileNetto ?? d.utile ?? d.utileNetto ?? null,
      } : {
        ricaviVendite: d.ricavi ?? d.ricaviVendite ?? null,
        altriRicavi: d.altriRicavi ?? null,
        acquistiBeni: d.acquistiBeni ?? null,
        costiServizi: d.costiServizi ?? null,
        costiPersonale: d.costiPersonale ?? null,
        ammortamentiSvalutazioni: d.ammortamenti ?? d.ammortamentiSvalutazioni ?? null,
        altriCostiOperativi: d.altriCostiOperativi ?? null,
        proventiFinanziari: d.proventiFinanziari ?? null,
        oneriFinanziari: d.oneriFinanziari ?? null,
        imposteSulReddito: d.imposteSulReddito ?? null,
        utileNetto: d.utile ?? d.utileNetto ?? null,
      };

      // Totali di riferimento
      const totaleAttivo = isBilancioAnalitico
        ? ((((d.totaleAttivo as number | null) ?? null) || ((anImm.totaleImmobilizzazioni as number ?? 0) + (anRim.totaleRimanenze as number ?? 0) + (anCred.totaleCrediti as number ?? 0) + ((anDisp as any).totaleDisponibilita as number ?? 0))) || null)
        : ((d.totaleAttivo ?? sp.totaleAttivo) as number | null) ?? null;
      const totaleRicavi = isBilancioAnalitico
        ? ((((anRic.totaleRicavi as number | null) ?? null) || ((d.ricavi ?? d.ricaviVendite) as number | null)) ?? null)
        : ((d.ricavi ?? vociCE.ricaviVendite ?? ce.ricaviVendite ?? ce.totaleValoreProduzione) as number | null) ?? null;

      const perc = (v: unknown, tot: number | null): number | null => {
        if (v == null || tot == null || tot === 0) return null;
        return Math.round((Number(v) / tot) * 1000) / 10; // 1 decimale
      };

      // Voci SP con peso su totale attivo
      const vocesSP = [
        { chiave: "immobilizzazioniImmateriali", label: "Immobilizzazioni immateriali", gruppo: "Attivo immobilizzato" },
        { chiave: "immobilizzazioniMateriali", label: "Immobilizzazioni materiali", gruppo: "Attivo immobilizzato" },
        { chiave: "immobilizzazioniFinanziarie", label: "Immobilizzazioni finanziarie", gruppo: "Attivo immobilizzato" },
        { chiave: "rimanenze", label: "Rimanenze", gruppo: "Attivo circolante" },
        { chiave: "creditiClienti", label: "Crediti verso clienti", gruppo: "Attivo circolante" },
        { chiave: "altriCrediti", label: "Altri crediti", gruppo: "Attivo circolante" },
        { chiave: "disponibilitaLiquide", label: "Disponibilità liquide", gruppo: "Attivo circolante" },
        { chiave: "altreAttivita", label: "Altre attività", gruppo: "Attivo circolante" },
        { chiave: "capitalesociale", label: "Capitale sociale", gruppo: "Patrimonio netto" },
        { chiave: "riserve", label: "Riserve", gruppo: "Patrimonio netto" },
        { chiave: "utileEsercizio", label: "Utile / Perdita d'esercizio", gruppo: "Patrimonio netto" },
        { chiave: "fondiRischi", label: "Fondi rischi e oneri", gruppo: "Passivo" },
        { chiave: "tfr", label: "TFR", gruppo: "Passivo" },
        { chiave: "debitiBancariLT", label: "Debiti bancari oltre 12 mesi", gruppo: "Passivo" },
        { chiave: "debitiBancariCT", label: "Debiti bancari entro 12 mesi", gruppo: "Passivo" },
        { chiave: "debitiFornitori", label: "Debiti verso fornitori", gruppo: "Passivo" },
        { chiave: "debitiVersDipendenti", label: "Debiti verso dipendenti", gruppo: "Passivo" },
        { chiave: "debitiTributari", label: "Debiti tributari", gruppo: "Passivo" },
        { chiave: "debitiPrevidenziali", label: "Debiti previdenziali", gruppo: "Passivo" },
        { chiave: "altriDebiti", label: "Altri debiti", gruppo: "Passivo" },
      ];

      const spResult = vocesSP.map(v => {
        const valore = (vociSP[v.chiave] ?? sp[v.chiave] ?? rootSP[v.chiave] ?? null) as number | null;
        return {
          chiave: v.chiave,
          label: v.label,
          gruppo: v.gruppo,
          valore,
          pesoSuTotaleAttivo: perc(valore, totaleAttivo),
        };
      }).filter(v => v.valore != null && v.valore !== 0);

      // Voci CE con peso su totale ricavi
      const vocesCE = [
        { chiave: "ricaviVendite", label: "Ricavi da vendite", gruppo: "Valore della produzione" },
        { chiave: "altriRicavi", label: "Altri ricavi", gruppo: "Valore della produzione" },
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

      const ceResult = vocesCE.map(v => {
        const valore = (vociCE[v.chiave] ?? ce[v.chiave] ?? rootCE[v.chiave] ?? null) as number | null;
        return {
          chiave: v.chiave,
          label: v.label,
          gruppo: v.gruppo,
          valore,
          pesoSuRicavi: perc(valore, totaleRicavi),
        };
      }).filter(v => v.valore != null && v.valore !== 0);

      return {
        disponibile: true as const,
        nomeFile: bilancio.nomeFile,
        annoRiferimento: bilancio.annoRiferimento,
        totaleAttivo,
        totaleRicavi,
        sp: spResult,
        ce: ceResult,
      };
    }),
});
