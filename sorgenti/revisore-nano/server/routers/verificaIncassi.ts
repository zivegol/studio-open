import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb, getDocumentiByIncarico, getIncaricoById, createAlert } from "../db";
import {
  verificaIncassiSessioni,
  verificaIncassiPartite,
  circolarizzazioneSessioni,
  circolarizzazioneDestinatari,
  alerts as alertsTable,
} from "../../drizzle/schema";
import { eq, and, like } from "drizzle-orm";
import { invokeLLM } from "../_core/llm";
import * as XLSX from "xlsx";
import { analyzeRevisionFolderLocally, downloadNextcloudFile } from "../nextcloud";
import { parseStandardCounterpartyBalances } from "../standardAuditEngine";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ─── TIPI ─────────────────────────────────────────────────────────────────────

interface PartitaInput {
  tipo: "cliente" | "fornitore";
  codice?: string;
  ragioneSociale: string;
  saldoPartita: number;
  estero?: boolean;
}

type PartitarioEstratto = {
  clienti: PartitaInput[];
  fornitori: PartitaInput[];
  metodo: string;
};

interface MovimentoBancario {
  data: string;
  importo: number;       // positivo = entrata, negativo = uscita
  descrizione: string;
  segno: "dare" | "avere";
}

type MatchMovimento = MovimentoBancario & {
  originalIndex: number;
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

/** Normalizza stringa per confronto: lowercase, rimuove forme giuridiche e punteggiatura */
function normalizza(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(s\.?r\.?l\.?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|s\.?c\.?a\.?r\.?l\.?|s\.?r\.?l\.?s\.?|di|del|dei|della|delle|degli|e|&)\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Similarità Jaccard su bigrammi */
function similarita(a: string, b: string): number {
  const bigrammi = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const na = normalizza(a);
  const nb = normalizza(b);
  if (na.length < 2 || nb.length < 2) return 0;
  const ba = bigrammi(na);
  const bb = bigrammi(nb);
  if (ba.size === 0 || bb.size === 0) return 0;
  let inter = 0;
  ba.forEach(g => { if (bb.has(g)) inter++; });
  return inter / (ba.size + bb.size - inter);
}

const TOKEN_NON_SIGNIFICATIVI = new Set([
  "bonif",
  "bon",
  "favore",
  "fatt",
  "fattura",
  "fatture",
  "pag",
  "pagamento",
  "saldo",
  "acconto",
  "ordine",
  "ord",
  "rif",
  "vs",
  "disp",
  "disposizione",
  "beneficiari",
  "vari",
  "distinta",
  "add",
  "tot",
  "comm",
  "spese",
  "sdd",
  "b2b",
]);

function tokenSignificativi(value: string): string[] {
  return normalizza(value)
    .split(" ")
    .map(token => token.trim())
    .filter(token =>
      token.length >= 2 &&
      !/^\d+$/.test(token) &&
      !TOKEN_NON_SIGNIFICATIVI.has(token)
    );
}

function valutaCompatibilitaNome(ragioneSociale: string, descrizione: string, percDiff: number): {
  compatibile: boolean;
  scoreNome: number;
  tokenComuni: number;
  hasTokenForte: boolean;
} {
  const partitaTokens = Array.from(new Set(tokenSignificativi(ragioneSociale)));
  const descrizioneTokens = new Set(tokenSignificativi(descrizione));
  const tokenComuni = partitaTokens.filter(token => descrizioneTokens.has(token));
  const simNome = similarita(ragioneSociale, descrizione);
  const hasTokenForte = tokenComuni.some(token => token.length >= 5 || (partitaTokens.length === 1 && token.length >= 2));
  const compatibile =
    tokenComuni.length >= 2 ||
    (tokenComuni.length >= 1 && hasTokenForte && percDiff <= 0.02) ||
    simNome >= 0.28;

  const coperturaToken = partitaTokens.length > 0 ? tokenComuni.length / partitaTokens.length : 0;
  const scoreNome = Math.max(simNome, Math.min(1, coperturaToken));

  return {
    compatibile,
    scoreNome,
    tokenComuni: tokenComuni.length,
    hasTokenForte,
  };
}

/** Parsa numero: supporta formato italiano (1.234,56), anglosassone (1,234.56) e semplice */
function parseNumeroIT(s: string): number {
  if (!s || s === "") return NaN;
  let clean = String(s).trim().replace(/[€$\s]/g, "");
  // Formato anglosassone con virgola come migliaia: 2,190.82 → 2190.82
  if (/^\d{1,3}(,\d{3})*(\.\d+)?$/.test(clean)) {
    clean = clean.replace(/,/g, "");
  } else if (/^\d{1,3}(\.\d{3})*(,\d+)?$/.test(clean)) {
    // Formato italiano: 2.190,82 → 2190.82
    clean = clean.replace(/\./g, "").replace(",", ".");
  } else {
    // Formato semplice con virgola decimale: 1234,56
    clean = clean.replace(",", ".");
  }
  return parseFloat(clean);
}

function decodeCsvLine(line: string, sep: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === sep && !inQuotes) {
      result.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  result.push(current.trim());
  return result.map(value => value.replace(/^"|"$/g, "").trim());
}

function normalizzaData(value: string): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const isoMatch = raw.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const slashMatch = raw.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (slashMatch) {
    const [, day, month, yearRaw] = slashMatch;
    const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const dotMatch = raw.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b/);
  if (dotMatch) {
    const [, day, month, yearRaw] = dotMatch;
    const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const dashMatch = raw.match(/\b(\d{1,2})-(\d{1,2})-(\d{2,4})\b/);
  if (dashMatch) {
    const [, day, month, yearRaw] = dashMatch;
    const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  return raw;
}

function truncateDb(value: string | null | undefined, maxLength: number): string | null {
  const clean = String(value ?? "").trim();
  if (!clean) return null;
  return clean.length > maxLength ? clean.slice(0, maxLength) : clean;
}

function decimalDb(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  return (Math.round(n * 100) / 100).toFixed(2);
}

function buildPartitaKey(partita: Pick<PartitaInput, "tipo" | "codice" | "ragioneSociale">): string {
  const codice = String(partita.codice ?? "").trim();
  const base = codice || normalizza(partita.ragioneSociale);
  return `${partita.tipo}::${base}`;
}

export function dedupPartite(rows: PartitaInput[]): PartitaInput[] {
  const map = new Map<string, PartitaInput>();

  for (const row of rows) {
    const normalized: PartitaInput = {
      ...row,
      codice: String(row.codice ?? "").trim() || undefined,
      ragioneSociale: String(row.ragioneSociale ?? "").trim(),
      saldoPartita: Math.abs(Number(row.saldoPartita ?? 0)),
      estero: Boolean(row.estero),
    };

    if (!normalized.ragioneSociale || !Number.isFinite(normalized.saldoPartita) || normalized.saldoPartita <= 0) {
      continue;
    }

    const key = buildPartitaKey(normalized);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, normalized);
      continue;
    }

    const existingAbs = Math.abs(existing.saldoPartita);
    const currentAbs = Math.abs(normalized.saldoPartita);
    const keepCurrent =
      currentAbs > existingAbs ||
      (currentAbs === existingAbs && !existing.codice && Boolean(normalized.codice));

    if (keepCurrent) {
      map.set(key, {
        ...normalized,
        estero: Boolean(existing.estero || normalized.estero),
      });
    } else if (normalized.estero && !existing.estero) {
      existing.estero = true;
    }
  }

  return Array.from(map.values());
}

function excelSerialToDate(value: number): string {
  const utcDays = Math.floor(value - 25569);
  const utcValue = utcDays * 86400;
  const dateInfo = new Date(utcValue * 1000);
  return `${dateInfo.getUTCFullYear()}-${String(dateInfo.getUTCMonth() + 1).padStart(2, "0")}-${String(dateInfo.getUTCDate()).padStart(2, "0")}`;
}

function cellToString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number" && value > 20000 && value < 80000) {
    return excelSerialToDate(value);
  }
  return String(value).trim();
}

function normalizzaHeader(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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

function parsaPartitarioNormalizzato(wb: XLSX.WorkBook): { clienti: PartitaInput[]; fornitori: PartitaInput[] } {
  const targetSheetName = wb.SheetNames.find(name => name.toLowerCase().includes("riepilogo"));
  if (!targetSheetName) return { clienti: [], fornitori: [] };

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[targetSheetName], { defval: "" });
  const clienti: PartitaInput[] = [];
  const fornitori: PartitaInput[] = [];

  for (const row of rows) {
    const tipoRaw = String(row["Tipo"] ?? "").trim().toLowerCase();
    const codice = String(row["Codice conto"] ?? "").trim();
    const ragioneSociale = String(row["Anagrafica"] ?? "").trim();
    const saldoRaw =
      row["Saldo da Dare-Avere"] ??
      row["Saldo_finale"] ??
      row["Saldo finale"] ??
      row["Saldo"];
    const saldo = typeof saldoRaw === "number" ? saldoRaw : parseNumeroIT(String(saldoRaw ?? ""));

    if (!tipoRaw || !ragioneSociale || !Number.isFinite(saldo) || saldo === 0) continue;

    const tipo = tipoRaw.includes("forn")
      ? "fornitore"
      : tipoRaw.includes("client")
        ? "cliente"
        : null;
    if (!tipo) continue;

    const partita: PartitaInput = {
      tipo,
      codice,
      ragioneSociale,
      saldoPartita: Math.abs(saldo),
      estero: false,
    };

    if (tipo === "cliente") clienti.push(partita);
    else fornitori.push(partita);
  }

  return { clienti, fornitori };
}

/**
 * Parsa il file XLS/XLSX del partitario clienti/fornito/**
 * Formato Hermete: workbook con fogli separati "Clienti" e "Fornitori".
 * Struttura per foglio:
 *   Riga 1: titolo (es. "MASTRO CLIENTI")
 *   Riga 2: periodo (es. "Situazione dal 01/01/2025 al 31/12/2025")
 *   Riga 3: header colonne: Conto | Nominativo | Saldo Finale (€)
 *   Riga 4+: dati
 * I saldi fornitori sono negativi nel file — usiamo il valore assoluto.
 */
function parsaPartitarioHermete(wb: XLSX.WorkBook): { clienti: PartitaInput[]; fornitori: PartitaInput[] } {
  const clienti: PartitaInput[] = [];
  const fornitori: PartitaInput[] = [];

  for (const sheetName of wb.SheetNames) {
    const nameUp = sheetName.trim().toUpperCase();
    const isCli = nameUp.includes("CLIENTI");
    const isForn = nameUp.includes("FORNITORI");
    if (!isCli && !isForn) continue;

    const ws = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" }) as unknown[][];

    // Trova la riga header (quella con "Nominativo" o "Conto")
    let headerRow = -1;
    let colCodice = 0, colNome = 1, colSaldo = 2;
    for (let r = 0; r < Math.min(10, aoa.length); r++) {
      const row = (aoa[r] as unknown[]).map(v => String(v ?? "").toLowerCase().trim());
      const hasNom = row.some(v => v.includes("nominativo") || v.includes("nome") || v.includes("ragione"));
      const hasSaldo = row.some(v => v.includes("saldo") || v.includes("importo"));
      if (hasNom && hasSaldo) {
        headerRow = r;
        for (let c = 0; c < row.length; c++) {
          if (row[c].includes("conto") || row[c].includes("codice")) colCodice = c;
          if (row[c].includes("nominativo") || row[c].includes("nome") || row[c].includes("ragione")) colNome = c;
          if (row[c].includes("saldo") || row[c].includes("importo")) colSaldo = c;
        }
        break;
      }
    }
    if (headerRow < 0) continue;

    for (let r = headerRow + 1; r < aoa.length; r++) {
      const row = aoa[r] as unknown[];
      const codice = String(row[colCodice] ?? "").trim();
      const nome = String(row[colNome] ?? "").trim();
      const saldoRaw = row[colSaldo];
      // Accetta sia numeri che stringhe formattate
      const saldo = typeof saldoRaw === "number" ? Math.abs(saldoRaw) : parseNumeroIT(String(saldoRaw ?? ""));

      if (!nome || isNaN(saldo) || saldo <= 0) continue;
      // Salta righe di totale (es. "Totale", "SALDO NETTO")
      if (nome.toLowerCase().startsWith("total") || nome.toLowerCase().startsWith("saldo")) continue;

      const partita: PartitaInput = {
        tipo: isForn ? "fornitore" : "cliente",
        codice,
        ragioneSociale: nome,
        saldoPartita: saldo,
        estero: false,
      };
      if (isForn) fornitori.push(partita);
      else clienti.push(partita);
    }
  }

  return { clienti, fornitori };
}

/**
 * Struttura reale: foglio unico con layout a due colonne affiancate.
 * - CLIENTI: col 1 (codice), col 4 (ragione sociale), col 12 (saldo)
 * - FORNITORI: col 15 (codice), col 17 (ragione sociale), col 32 (saldo)
 * I codici dei singoli nominativi iniziano con 4 spazi ("    00241").
 * I codici dei gruppi/sottogruppi non hanno spazi iniziali ("01.23", "01.23.001").
 */
function parsaPartitarioXLS(buffer: Buffer): { clienti: PartitaInput[]; fornitori: PartitaInput[] } {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false, cellText: true });

  const normalized = parsaPartitarioNormalizzato(wb);
  if (normalized.clienti.length > 0 || normalized.fornitori.length > 0) {
    return normalized;
  }

  // ── Rilevamento formato Hermete (fogli separati Clienti / Fornitori) ──────────
  // Il file Hermete ha fogli distinti con nomi "Clienti" e "Fornitori"
  // e header su riga 3: Conto | Nominativo | Saldo Finale (€)
  const sheetNamesUpper = wb.SheetNames.map(n => n.trim().toUpperCase());
  const hasClientiSheet = sheetNamesUpper.some(n => n.includes("CLIENTI"));
  const hasForniSheet = sheetNamesUpper.some(n => n.includes("FORNITORI"));
  if (hasClientiSheet || hasForniSheet) {
    return parsaPartitarioHermete(wb);
  }

  const ws = wb.Sheets[wb.SheetNames[0]];

  // Leggi il range del foglio
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1:A1");

  // Costruisci array di array leggendo il testo della cella (preserva spazi iniziali)
  const aoa: string[][] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      // Usa .w (testo formattato) se disponibile, altrimenti .v (valore raw)
      const val = cell ? (cell.w !== undefined ? String(cell.w) : String(cell.v ?? "")) : "";
      row.push(val);
    }
    aoa.push(row);
  }

  const clienti: PartitaInput[] = [];
  const fornitori: PartitaInput[] = [];

  // Cerca le intestazioni di sezione per determinare se usare layout affiancato o lineare
  let layoutAffiancato = false;
  // Indici verificati sul file reale (Esplosoclientiefornitori.xls):
  // Clienti: col 0 = codice, col 3 = ragione sociale, col 11 = saldo
  // Fornitori: col 14 = codice, col 16 = ragione sociale, col 31 = saldo
  let colCodiceClienti = 0, colNomeClienti = 3, colSaldoClienti = 11;
  let colCodiceFornitori = 14, colNomeFornitori = 16, colSaldoFornitori = 31;

  // Verifica se il file ha il layout affiancato rilevando "CLIENTI" e "FORNITORI"
  // Struttura reale: CLIENTI in col 4, FORNITORI in col 17 della stessa riga
  for (const row of aoa.slice(0, 30)) {
    const vals = row.map(v => String(v ?? "").trim().toUpperCase());
    const hasClienti = vals.some(v => v === "CLIENTI");
    const hasFornitori = vals.some(v => v === "FORNITORI");
    if (hasClienti && hasFornitori) {
      layoutAffiancato = true;
      // Determina le colonne esatte
      for (let c = 0; c < vals.length; c++) {
        if (vals[c] === "CLIENTI") {
          // Cerca saldo nella stessa riga (numero più grande)
          // Layout reale: CLIENTI in col 4, saldo in col 12
          colNomeClienti = c;
          colCodiceClienti = c - 3 >= 0 ? c - 3 : 1; // col 1 per codice
        }
        if (vals[c] === "FORNITORI") {
          colNomeFornitori = c;
          colCodiceFornitori = c - 2 >= 0 ? c - 2 : 15; // col 15 per codice
        }
      }
      break;
    }
    if (hasClienti || hasFornitori) {
      layoutAffiancato = true;
      break;
    }
  }

  // Determina automaticamente le colonne cercando le intestazioni
  for (let r = 0; r < Math.min(20, aoa.length); r++) {
    const row = aoa[r];
    for (let c = 0; c < row.length; c++) {
      const val = String(row[c] ?? "").trim().toUpperCase();
      if (val === "CLIENTI") {
        // Cerca il saldo nella stessa riga (primo numero)
        for (let cc = c + 1; cc < row.length; cc++) {
          const n = parseNumeroIT(String(row[cc] ?? ""));
          if (!isNaN(n) && n > 0) { colSaldoClienti = cc; break; }
        }
      }
    }
  }

  for (const row of aoa) {
    const getVal = (idx: number) => String(row[idx] ?? "").trim();

    // ── CLIENTI (colonne sinistra) ──
    const codiceC = getVal(colCodiceClienti);
    const nomeC = getVal(colNomeClienti);
    const saldoCStr = getVal(colSaldoClienti);

    // È un singolo nominativo se il codice (raw) inizia con spazi o se il valore numerico ha spazi
    const codiceRawC = String(row[colCodiceClienti] ?? "");
    if (codiceRawC.startsWith("    ") || /^\s{2,}/.test(codiceRawC) || codiceC.startsWith("    ")) {
      const saldoC = parseNumeroIT(saldoCStr);
      if (nomeC && !isNaN(saldoC) && saldoC > 0) {
        clienti.push({
          tipo: "cliente",
          codice: codiceC.trim(),
          ragioneSociale: nomeC,
          saldoPartita: saldoC,
          estero: false,
        });
      }
    }

    // ── FORNITORI (colonne destra, layout affiancato) ──
    if (layoutAffiancato && row.length > colCodiceFornitori) {
      const codiceF = getVal(colCodiceFornitori);
      const codiceRawF = String(row[colCodiceFornitori] ?? "");
      const nomeF = getVal(colNomeFornitori);
      const saldoFStr = getVal(colSaldoFornitori);

      if (codiceRawF.startsWith("    ") || /^\s{2,}/.test(codiceRawF) || codiceF.startsWith("    ")) {
        const saldoF = parseNumeroIT(saldoFStr);
        if (nomeF && !isNaN(saldoF) && saldoF > 0) {
          fornitori.push({
            tipo: "fornitore",
            codice: codiceF.trim(),
            ragioneSociale: nomeF,
            saldoPartita: saldoF,
            estero: false,
          });
        }
      }
    }

    // Marca estero basandosi sul sottogruppo precedente
    // (Clienti Estero / Fornitori Estero)
    const nomeRiga = getVal(colNomeClienti).toLowerCase();
    if (nomeRiga.includes("estero") && clienti.length > 0) {
      // Le righe successive fino al prossimo gruppo sono estero
      // Gestito implicitamente: non critico per il matching
    }
  }

  // Fallback: se non trovati con layout affiancato, prova layout lineare
  if (clienti.length === 0 && fornitori.length === 0) {
    return parsaPartitarioLineare(aoa);
  }

  return { clienti, fornitori };
}

/** Fallback: layout lineare con header row */
function parsaPartitarioLineare(aoa: unknown[][]): { clienti: PartitaInput[]; fornitori: PartitaInput[] } {
  const clienti: PartitaInput[] = [];
  const fornitori: PartitaInput[] = [];

  // Cerca riga header
  let headerRow = -1;
  let colCodice = -1, colNome = -1, colSaldo = -1, colTipo = -1;

  for (let r = 0; r < Math.min(10, aoa.length); r++) {
    const row = aoa[r].map(v => String(v ?? "").toLowerCase().trim());
    for (let c = 0; c < row.length; c++) {
      if (row[c].includes("codice") || row[c].includes("cod")) colCodice = c;
      if (row[c].includes("ragione") || row[c].includes("denominaz") || row[c].includes("nome")) colNome = c;
      if (row[c].includes("saldo") || row[c].includes("importo")) colSaldo = c;
      if (row[c].includes("tipo") || row[c].includes("cliente") || row[c].includes("fornitore")) colTipo = c;
    }
    if (colNome >= 0 && colSaldo >= 0) { headerRow = r; break; }
  }

  if (headerRow < 0) return { clienti, fornitori };

  for (let r = headerRow + 1; r < aoa.length; r++) {
    const row = aoa[r];
    const nome = String(row[colNome] ?? "").trim();
    const saldo = parseNumeroIT(String(row[colSaldo] ?? ""));
    const tipo = colTipo >= 0 ? String(row[colTipo] ?? "").toLowerCase() : "cliente";
    const codice = colCodice >= 0 ? String(row[colCodice] ?? "").trim() : "";

    if (!nome || isNaN(saldo) || saldo <= 0) continue;

    const partita: PartitaInput = { tipo: tipo.includes("forn") ? "fornitore" : "cliente", codice, ragioneSociale: nome, saldoPartita: saldo };
    if (partita.tipo === "fornitore") fornitori.push(partita);
    else clienti.push(partita);
  }

  return { clienti, fornitori };
}

/**
 * Parsa uno o più file CSV di movimenti bancari.
 * Struttura reale: Data contabile;Data valuta;Importo;Divisa;Causale;Descrizione;Canale
 * Separatore ";", importo con virgola decimale, negativo = uscita.
 */
function parsaMovimentiBancari(csvContents: string[]): MovimentoBancario[] {
  const movimenti: MovimentoBancario[] = [];

  for (const csv of csvContents) {
    // Determina separatore
    const sep = csv.includes(";") ? ";" : ",";
    const lines = csv.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

    if (lines.length < 2) continue;

    // Riga header
    const header = decodeCsvLine(lines[0], sep).map(h => normalizzaHeader(h.replace(/"/g, "")));

    // Mappa colonne
    const iDataContabile = header.findIndex(h =>
      h.includes("data contabile") ||
      h.includes("data operazione") ||
      h.includes("data registrazione") ||
      h.includes("data") ||
      h.includes("date")
    );
    const iImporto = header.findIndex(h => h === "importo" || h === "amount" || h.includes("importo") || h.includes("amount"));
    const descrizioneCols = header
      .map((h, idx) => ({ h, idx }))
      .filter(({ h }) =>
        h.includes("descriz") ||
        h.includes("causale") ||
        h.includes("note") ||
        h.includes("beneficiario") ||
        h.includes("ordinante") ||
        h.includes("dettaglio") ||
        h.includes("narrative")
      )
      .map(({ idx }) => idx);
    const iDare = header.findIndex(h => h === "dare" || h.includes("uscita") || h.includes("debit") || h.includes("addebito"));
    const iAvere = header.findIndex(h => h === "avere" || h.includes("entrata") || h.includes("credit") || h.includes("accredito"));

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const cols = decodeCsvLine(line, sep);
      if (cols.length < 2) continue;

      // Data
      const data = normalizzaData(iDataContabile >= 0 ? cols[iDataContabile] : cols[0]);
      if (!data || data === "") continue;

      // Descrizione: usa colonna descrizione o concatena causale + descrizione
      let descrizione = descrizioneCols.length > 0
        ? descrizioneCols.map(idx => cols[idx] ?? "").join(" ")
        : cols.slice(1).filter(c => isNaN(parseNumeroIT(c))).join(" ");
      descrizione = descrizione.toLowerCase().trim();
      if (
        descrizione.includes("saldo iniziale") ||
        descrizione.includes("saldo contabile") ||
        descrizione.includes("saldo finale") ||
        descrizione.includes("saldo disponibile")
      ) continue;

      // Importo
      let importo = 0;
      if (iImporto >= 0) {
        importo = parseNumeroIT(cols[iImporto]);
      } else if (iDare >= 0 || iAvere >= 0) {
        const dare = iDare >= 0 ? parseNumeroIT(cols[iDare]) : NaN;
        const avere = iAvere >= 0 ? parseNumeroIT(cols[iAvere]) : NaN;
        if (!isNaN(avere) && avere > 0) importo = avere;
        else if (!isNaN(dare) && dare > 0) importo = -dare;
      }

      if (isNaN(importo) || importo === 0) continue;
      if (!descrizione) descrizione = "movimento bancario";

      movimenti.push({
        data,
        importo,
        descrizione,
        segno: importo > 0 ? "avere" : "dare",
      });
    }
  }

  return movimenti;
}

export function parsaMovimentiDaExcel(buffer: Buffer): MovimentoBancario[] {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false, cellText: true });
  const movimenti: MovimentoBancario[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" }) as unknown[][];
    if (rows.length < 2) continue;

    const firstNonEmpty = rows.find(row => row.some(cell => cellToString(cell).trim()));
    if (firstNonEmpty?.length === 1 && cellToString(firstNonEmpty[0]).includes(";")) {
      const csv = rows
        .map(row => cellToString(row[0]))
        .filter(line => line.trim())
        .join("\n");
      movimenti.push(...parsaMovimentiBancari([csv]));
      continue;
    }

    let headerRow = -1;
    let iData = -1;
    let iImporto = -1;
    let iDescrizione = -1;
    let iDare = -1;
    let iAvere = -1;

    for (let r = 0; r < Math.min(40, rows.length); r++) {
      const row = rows[r].map(cell => normalizzaHeader(cellToString(cell)));
      const hasData = row.some(h => h.includes("data"));
      const hasImporto =
        row.some(h => h.includes("importo") || h.includes("amount")) ||
        row.some(h => h === "dare" || h === "avere" || h.includes("addebito") || h.includes("accredito"));
      if (!hasData || !hasImporto) continue;

      headerRow = r;
      iData = row.findIndex(h =>
        h.includes("data contabile") ||
        h.includes("data operazione") ||
        h.includes("data registrazione") ||
        h.includes("data valuta") ||
        h === "data"
      );
      iImporto = row.findIndex(h => h === "importo" || h.includes("importo") || h.includes("amount"));
      iDescrizione = row.findIndex(h =>
        h.includes("descriz") ||
        h.includes("causale") ||
        h.includes("note") ||
        h.includes("beneficiario") ||
        h.includes("ordinante") ||
        h.includes("dettaglio") ||
        h.includes("narrative")
      );
      iDare = row.findIndex(h => h === "dare" || h.includes("uscita") || h.includes("addebito") || h.includes("debit"));
      iAvere = row.findIndex(h => h === "avere" || h.includes("entrata") || h.includes("accredito") || h.includes("credit"));
      break;
    }

    if (headerRow < 0) continue;

    for (let r = headerRow + 1; r < rows.length; r++) {
      const row = rows[r];
      const data = normalizzaData(iData >= 0 ? cellToString(row[iData]) : cellToString(row[0]));
      if (!data) continue;

      let descrizione = (
        iDescrizione >= 0
          ? cellToString(row[iDescrizione])
          : row.map(cell => cellToString(cell)).filter(cell => cell && isNaN(parseNumeroIT(cell))).join(" ")
      ).toLowerCase().trim();
      if (
        descrizione.includes("saldo iniziale") ||
        descrizione.includes("saldo contabile") ||
        descrizione.includes("saldo finale") ||
        descrizione.includes("saldo disponibile")
      ) continue;

      let importo = 0;
      if (iImporto >= 0) {
        const raw = row[iImporto];
        importo = typeof raw === "number" ? raw : parseNumeroIT(cellToString(raw));
      } else {
        const dareRaw = iDare >= 0 ? row[iDare] : "";
        const avereRaw = iAvere >= 0 ? row[iAvere] : "";
        const dare = typeof dareRaw === "number" ? dareRaw : parseNumeroIT(cellToString(dareRaw));
        const avere = typeof avereRaw === "number" ? avereRaw : parseNumeroIT(cellToString(avereRaw));
        if (!isNaN(avere) && avere > 0) importo = avere;
        else if (!isNaN(dare) && dare > 0) importo = -dare;
      }

      if (!Number.isFinite(importo) || importo === 0) continue;
      if (!descrizione) descrizione = `movimento bancario ${sheetName}`.toLowerCase();

      movimenti.push({
        data,
        importo,
        descrizione,
        segno: importo > 0 ? "avere" : "dare",
      });
    }

    if (headerRow < 0) {
      const csv = rows
        .map(row => row.map(cell => cellToString(cell)).join(";"))
        .filter(line => line.replace(/;/g, "").trim())
        .join("\n");
      movimenti.push(...parsaMovimentiBancari([csv]));
    }
  }

  return movimenti;
}

function parsaEstrattoContoDaBuffer(buffer: Buffer): MovimentoBancario[] {
  const isZipWorkbook = buffer[0] === 0x50 && buffer[1] === 0x4b;
  const isOleWorkbook = buffer[0] === 0xd0 && buffer[1] === 0xcf;

  if (isZipWorkbook || isOleWorkbook) {
    return parsaMovimentiDaExcel(buffer);
  }

  if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
    return parsaMovimentiDaPdfLocale(buffer);
  }

  return parsaMovimentiBancari([buffer.toString("utf-8")]);
}

function estraiTestoPdfLocale(buffer: Buffer): string {
  let text = "";
  try {
    text = execFileSync("pdftotext", ["-layout", "-", "-"], { input: buffer, maxBuffer: 30 * 1024 * 1024 }).toString("utf-8");
  } catch { /* passa all'OCR */ }
  if ((text.match(/\d{2}[./-]\d{2}[./-]\d{2,4}/g) ?? []).length >= 3) return text;

  const folder = mkdtempSync(join(tmpdir(), "revisore-ec-"));
  try {
    const pdfPath = join(folder, "source.pdf");
    const prefix = join(folder, "page");
    writeFileSync(pdfPath, buffer);
    execFileSync("pdftoppm", ["-jpeg", "-r", "220", pdfPath, prefix], { maxBuffer: 10 * 1024 * 1024 });
    const pages = readdirSync(folder).filter(name => name.endsWith(".jpg")).sort();
    return pages.map(name => {
      try {
        return execFileSync("tesseract", [join(folder, name), "stdout", "-l", "ita"], { maxBuffer: 20 * 1024 * 1024 }).toString("utf-8");
      } catch { return ""; }
    }).join("\n");
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

export function parsaMovimentiDaPdfLocale(buffer: Buffer): MovimentoBancario[] {
  const extractedText = estraiTestoPdfLocale(buffer);
  const detailStart = extractedText.search(/dettaglio movimenti del conto corrente/i);
  const relativeEnd = detailStart >= 0 ? extractedText.slice(detailStart).search(/\n\s*totali\s/i) : -1;
  const text = detailStart >= 0 && relativeEnd > 0
    ? extractedText.slice(detailStart, detailStart + relativeEnd)
    : extractedText;
  const records: Array<{ data: string; amount: number; description: string }> = [];
  const dateAtStart = /^\s*(\d{2}[./-]\d{2}[./-]\d{2,4})\s+(.*)$/;
  const amountPattern = /(-\s*)?(\d{1,3}(?:\.\d{3})*|\d+),\s*([0-9]{2})/g;

  for (const rawLine of text.split(/\r?\n/)) {
    const match = rawLine.match(dateAtStart);
    if (!match) {
      if (records.length && rawLine.trim() && !/pagina \d|index:/i.test(rawLine)) {
        records[records.length - 1].description += ` ${rawLine.trim()}`;
      }
      continue;
    }
    let rest = match[2].replace(/^\d{2}[./-]\d{2}[./-]\d{2,4}\s+/, "").replace(/^\d{2}[./-]\d{2}[./-]\d{2,4}\s+/, "");
    const amounts = Array.from(rest.matchAll(amountPattern));
    if (amounts.length === 0 || /saldo iniziale|saldo finale|totali/i.test(rest)) continue;
    const amountMatch = amounts[0];
    const numeric = parseNumeroIT(`${amountMatch[2]},${amountMatch[3]}`);
    const debitWords = /bonifico da voi disposto|addeb|uscit|spese|imposta|commission|competenze|canone|pagamento|vs\.disp/i.test(rest);
    const creditWords = /accredit|bon\.da|bonifico (?:ricevuto|a vostro favore)|entrate/i.test(rest);
    const negative = Boolean(amountMatch[1]) || (debitWords && !creditWords);
    const description = rest.replace(amountMatch[0], " ").replace(/\s+/g, " ").trim();
    records.push({ data: normalizzaData(match[1]), amount: negative ? -numeric : numeric, description });
  }

  return records
    .filter(row => row.data && Number.isFinite(row.amount) && row.amount !== 0)
    .map(row => ({
      data: row.data,
      importo: row.amount,
      descrizione: row.description.toLowerCase().slice(0, 1000),
      segno: row.amount > 0 ? "avere" as const : "dare" as const,
    }));
}

/**
 * Matching tra una partita e i movimenti bancari.
 * Clienti → cerca entrate (importo > 0)
 * Fornitori → cerca uscite (importo < 0)
 */
export function matchPartita(
  partita: PartitaInput,
  movimenti: MatchMovimento[],
  usedIndexes: Set<number>,
): {
  importoCoperto: number;
  residuo: number;
  dataMovimento: string;
  descrizioneMovimento: string;
  confidenza: number;
  stato: "incassata_pagata" | "parzialmente_coperta" | "non_trovata";
  criterio: "quadrato_esatto" | "quadrato_somma" | "parziale" | "nome_importo_diverso" | "segno_incoerente" | "possibile_importo" | "non_trovato";
} {
  const segnoAtteso = partita.tipo === "cliente" ? "avere" : "dare";
  const saldo = Math.abs(partita.saldoPartita);

  const scoreCandidati = (segno: "dare" | "avere", soloCompatibili = true) => {
    const mapped = movimenti
      .filter(m => m.segno === segno && !usedIndexes.has(m.originalIndex))
      .map(mov => {
      const importoMov = Math.abs(mov.importo);
      const percDiff = saldo > 0 ? Math.abs(importoMov - saldo) / saldo : 1;
      const nome = valutaCompatibilitaNome(partita.ragioneSociale, mov.descrizione, percDiff);
      const scoreImporto = percDiff <= 0.02 ? 1.0 : percDiff <= 0.10 ? 0.4 : percDiff <= 0.30 ? 0.1 : 0;
      const scoreFinale = nome.scoreNome * 0.65 + scoreImporto * 0.35;
      const isPossibileRata =
        importoMov < saldo * 0.98 &&
        nome.tokenComuni >= 1 &&
        (nome.hasTokenForte || nome.scoreNome >= 0.18);
      return { mov, scoreFinale, percDiff, nome, isPossibileRata };
      });

    return (soloCompatibili ? mapped.filter(item => item.nome.compatibile || item.isPossibileRata) : mapped)
      .sort((a, b) => {
      if (b.scoreFinale !== a.scoreFinale) return b.scoreFinale - a.scoreFinale;
      return a.percDiff - b.percDiff;
    });
  };

  type ScoredMovimento = ReturnType<typeof scoreCandidati>[number];

  const creaRisultato = (
    selectedItems: ScoredMovimento[],
    importoCopertoRaw: number,
    options?: {
      consuma?: boolean;
      criterio?: "quadrato_esatto" | "quadrato_somma" | "parziale" | "nome_importo_diverso" | "segno_incoerente" | "possibile_importo" | "non_trovato";
      descrizionePrefix?: string;
      stato?: "incassata_pagata" | "parzialmente_coperta" | "non_trovata";
    }
  ) => {
    const importoCoperto = Math.round(importoCopertoRaw * 100) / 100;
    if (options?.consuma !== false) {
      selectedItems.forEach(item => usedIndexes.add(item.mov.originalIndex));
    }

    const residuo = Math.max(0, Math.round((saldo - importoCoperto) * 100) / 100);
    const percResiduo = saldo > 0 ? residuo / saldo : 0;
    const dateSelezionate = Array.from(new Set(selectedItems.map(item => normalizzaData(item.mov.data)).filter(Boolean)));
    const dataMovimento = dateSelezionate.length > 1
      ? `${dateSelezionate[0]} +${dateSelezionate.length - 1}`
      : (dateSelezionate[0] ?? "");
    const righeMovimenti = selectedItems.map(item => `${normalizzaData(item.mov.data) || item.mov.data} - ${item.mov.descrizione}`);
    const descrizioneMovimento = [
      options?.descrizionePrefix,
      ...righeMovimenti,
    ].filter(Boolean).join(" | ").substring(0, 500);
    const confidenza = selectedItems.length > 0
      ? Math.round((selectedItems.reduce((sum, item) => sum + item.scoreFinale, 0) / selectedItems.length) * 100) / 100
      : 0;

    return {
      importoCoperto,
      residuo,
      dataMovimento,
      descrizioneMovimento,
      confidenza,
      stato: options?.stato ?? (percResiduo <= 0.02 ? "incassata_pagata" as const : residuo > 0 ? "parzialmente_coperta" as const : "incassata_pagata" as const),
      criterio: options?.criterio ?? (percResiduo <= 0.02 ? (selectedItems.length > 1 ? "quadrato_somma" as const : "quadrato_esatto" as const) : "parziale" as const),
    };
  };

  const tuttiSegnoAtteso = scoreCandidati(segnoAtteso, false);
  const importiPrecisi = tuttiSegnoAtteso
    .filter(item => Math.abs(Math.abs(item.mov.importo) - saldo) <= 0.01)
    .sort((a, b) => {
      if (Number(b.nome.compatibile) !== Number(a.nome.compatibile)) return Number(b.nome.compatibile) - Number(a.nome.compatibile);
      return b.nome.scoreNome - a.nome.scoreNome;
    });
  const importoPrecisoCoerente = importiPrecisi.find(item => item.nome.compatibile);
  if (importoPrecisoCoerente) {
    return creaRisultato([importoPrecisoCoerente], Math.abs(importoPrecisoCoerente.mov.importo), {
      criterio: "quadrato_esatto",
      descrizionePrefix: "Importo preciso e nominativo coerente",
    });
  }

  const importoPrecisoIncoerente = importiPrecisi[0] ?? null;
  const scored = tuttiSegnoAtteso
    .filter(item => item.nome.compatibile || item.isPossibileRata)
    .sort((a, b) => {
      if (b.scoreFinale !== a.scoreFinale) return b.scoreFinale - a.scoreFinale;
      return a.percDiff - b.percDiff;
    });
  const segnoOpposto = segnoAtteso === "avere" ? "dare" : "avere";
  const creaSegnalazioneSegnoOpposto = () => {
    const opposti = scoreCandidati(segnoOpposto).slice(0, 6);
    if (opposti.length === 0) return null;
    const totaleOpposto = Math.round(opposti.reduce((sum, item) => sum + Math.abs(item.mov.importo), 0) * 100) / 100;
    if (totaleOpposto <= 0) return null;
    const dateOpposte = Array.from(new Set(opposti.map(item => normalizzaData(item.mov.data)).filter(Boolean)));
    const dataMovimento = dateOpposte.length > 1
      ? `${dateOpposte[0]} +${dateOpposte.length - 1}`
      : (dateOpposte[0] ?? "");
    const verso = segnoOpposto === "avere" ? "entrata" : "uscita";
    const descrizioneMovimento = [
      `Nominativo trovato con segno non coerente (${verso}, totale ${totaleOpposto.toFixed(2)} euro)`,
      ...opposti.map(item => `${normalizzaData(item.mov.data) || item.mov.data} - ${item.mov.descrizione}`),
    ].join(" | ").substring(0, 500);
    const confidenza = Math.round((opposti.reduce((sum, item) => sum + item.scoreFinale, 0) / opposti.length) * 100) / 100;
    return {
      importoCoperto: 0,
      residuo: saldo,
      dataMovimento,
      descrizioneMovimento,
      confidenza,
      stato: "non_trovata" as const,
      criterio: "segno_incoerente" as const,
    };
  };

  if (scored.length === 0) {
    if (importoPrecisoIncoerente) {
      return creaRisultato([importoPrecisoIncoerente], 0, {
        consuma: false,
        criterio: "possibile_importo",
        stato: "non_trovata",
        descrizionePrefix: "Importo preciso trovato, ma nominativo non coerente",
      });
    }
    return creaSegnalazioneSegnoOpposto() ?? { importoCoperto: 0, residuo: saldo, dataMovimento: "", descrizioneMovimento: "", confidenza: 0, stato: "non_trovata", criterio: "non_trovato" };
  }

  let selected: Array<(typeof scored)[number]> = [];
  let importoCoperto = 0;
  const sogliaAlta = saldo * 1.02;

  const miglioriCandidati = scored.slice(0, 14);
  let best: { selected: Array<(typeof scored)[number]>; totale: number; rank: number } | null = null;

  function valutaCombinazione(combo: Array<(typeof scored)[number]>, totale: number) {
    if (combo.length === 0 || totale > sogliaAlta) return;
    const coverage = saldo > 0 ? totale / saldo : 0;
    const nomeForte = combo.some(item => item.nome.tokenComuni >= 1 && (item.nome.hasTokenForte || item.nome.scoreNome >= 0.5));
    if (coverage < 0.25 && !(nomeForte && (coverage >= 0.01 || totale >= 100))) return;
    const distanza = Math.abs(saldo - totale);
    const scoreMedio = combo.reduce((sum, item) => sum + item.scoreFinale, 0) / combo.length;
    const fullBonus = coverage >= 0.98 && coverage <= 1.02 ? 10 : 0;
    const rateBonus = combo.length > 1 ? 1 : 0;
    const rank = fullBonus + rateBonus + scoreMedio - distanza / Math.max(saldo, 1);
    if (!best || rank > best.rank) {
      best = { selected: [...combo], totale, rank };
    }
  }

  function cercaCombinazioni(index: number, combo: Array<(typeof scored)[number]>, totale: number) {
    valutaCombinazione(combo, totale);
    if (index >= miglioriCandidati.length || combo.length >= 8 || totale >= saldo * 0.98) return;

    for (let i = index; i < miglioriCandidati.length; i++) {
      const candidate = miglioriCandidati[i];
      if (combo.some(item => item.mov.originalIndex === candidate.mov.originalIndex)) continue;
      const nuovoTotale = Math.round((totale + Math.abs(candidate.mov.importo)) * 100) / 100;
      if (nuovoTotale > sogliaAlta) continue;
      combo.push(candidate);
      cercaCombinazioni(i + 1, combo, nuovoTotale);
      combo.pop();
    }
  }

  cercaCombinazioni(0, [], 0);

  if (best) {
    selected = best.selected;
    importoCoperto = best.totale;
  }

  if (selected.length === 0) {
    if (importoPrecisoIncoerente) {
      return creaRisultato([importoPrecisoIncoerente], 0, {
        consuma: false,
        criterio: "possibile_importo",
        stato: "non_trovata",
        descrizionePrefix: "Importo preciso trovato, ma nominativo non coerente",
      });
    }
    return { importoCoperto: 0, residuo: saldo, dataMovimento: "", descrizioneMovimento: "", confidenza: 0, stato: "non_trovata", criterio: "non_trovato" };
  }

  return creaRisultato(selected, importoCoperto);
}

/**
 * Parser universale LLM per il partitario clienti/fornitori.
 * Funziona con qualsiasi formato Excel/CSV indipendentemente dalla struttura.
 * Fallback automatico al parser rigido se l'LLM non è disponibile.
 */
async function parsaPartitarioConLLM(buffer: Buffer): Promise<{ clienti: PartitaInput[]; fornitori: PartitaInput[]; metodo: string }> {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false, cellText: true });

  // Costruisci rappresentazione testuale del file (max 150 righe per foglio, max 3 fogli)
  const fogli: string[] = [];
  for (const sheetName of wb.SheetNames.slice(0, 3)) {
    const ws = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" }) as unknown[][];
    const righe = aoa.slice(0, 150).map(row =>
      (row as unknown[]).map(v => String(v ?? "").trim()).join("\t")
    ).filter(r => r.replace(/\t/g, "").trim() !== "");
    if (righe.length > 0) {
      fogli.push(`=== Foglio: ${sheetName} ===\n${righe.join("\n")}`);
    }
  }

  const testoFile = fogli.join("\n\n");

  try {
    const resp = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `Sei un esperto contabile italiano. Analizza il file partitario e identifica i saldi aperti di clienti e fornitori.

Regole:
- Estrai SOLO i singoli nominativi con saldo (non i totali, non le intestazioni di gruppo)
- Classifica ogni riga come "cliente" o "fornitore" in base al foglio, alla colonna tipo, al prefisso del codice conto (es. 1xxx/2xxx = clienti, 3xxx/4xxx = fornitori), o al contesto
- Se il tipo non è chiaro, usa "cliente" come default
- I saldi possono essere negativi nel file (fornitori): usa sempre il valore assoluto
- Ignora righe con saldo zero o vuoto
- Ignora righe di totale ("Totale", "TOTALE", "Saldo netto", ecc.)
- Il codice conto può essere numerico o alfanumerico
- Restituisci SOLO JSON valido, nessun testo aggiuntivo`,
        },
        {
          role: "user",
          content: `Analizza questo file partitario ed estrai tutti i nominativi con i loro saldi:\n\n${testoFile.substring(0, 12000)}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "partitario",
          strict: true,
          schema: {
            type: "object",
            properties: {
              clienti: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    codice: { type: "string" },
                    ragioneSociale: { type: "string" },
                    saldoPartita: { type: "number" },
                    estero: { type: "boolean" },
                  },
                  required: ["codice", "ragioneSociale", "saldoPartita", "estero"],
                  additionalProperties: false,
                },
              },
              fornitori: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    codice: { type: "string" },
                    ragioneSociale: { type: "string" },
                    saldoPartita: { type: "number" },
                    estero: { type: "boolean" },
                  },
                  required: ["codice", "ragioneSociale", "saldoPartita", "estero"],
                  additionalProperties: false,
                },
              },
            },
            required: ["clienti", "fornitori"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = (resp as any).choices?.[0]?.message?.content ?? "{}";
    const parsed = parseJsonFromLlmContent<{
      clienti?: unknown[];
      fornitori?: unknown[];
    }>(content);

    const clienti: PartitaInput[] = (parsed.clienti ?? []).map((c: any) => ({
      tipo: "cliente" as const,
      codice: String(c.codice ?? ""),
      ragioneSociale: String(c.ragioneSociale ?? ""),
      saldoPartita: Math.abs(Number(c.saldoPartita ?? 0)),
      estero: Boolean(c.estero),
    })).filter((c: PartitaInput) => c.ragioneSociale && c.saldoPartita > 0);

    const fornitori: PartitaInput[] = (parsed.fornitori ?? []).map((f: any) => ({
      tipo: "fornitore" as const,
      codice: String(f.codice ?? ""),
      ragioneSociale: String(f.ragioneSociale ?? ""),
      saldoPartita: Math.abs(Number(f.saldoPartita ?? 0)),
      estero: Boolean(f.estero),
    })).filter((f: PartitaInput) => f.ragioneSociale && f.saldoPartita > 0);

    if (clienti.length === 0 && fornitori.length === 0) {
      throw new Error("LLM non ha trovato partite");
    }

    console.log(`[parsaPartitarioConLLM] LLM: ${clienti.length} clienti, ${fornitori.length} fornitori`);
    return { clienti, fornitori, metodo: "llm" };

  } catch (err) {
    // Fallback al parser rigido
    console.warn("[parsaPartitarioConLLM] Fallback al parser rigido:", err);
    const result = parsaPartitarioXLS(buffer);
    return { ...result, metodo: "rigido" };
  }
}

function normalizePartitaArray(
  tipo: "cliente" | "fornitore",
  rows: unknown[]
): PartitaInput[] {
  return dedupPartite(rows
    .map((row: any) => ({
      tipo,
      codice: String(row?.codice ?? "").trim(),
      ragioneSociale: String(row?.ragioneSociale ?? "").trim(),
      saldoPartita: Math.abs(Number(row?.saldoPartita ?? 0)),
      estero: Boolean(row?.estero),
    }))
    .filter(row => row.ragioneSociale && Number.isFinite(row.saldoPartita) && row.saldoPartita > 0));
}

function normalizePartitarioEstratto(value: unknown): PartitarioEstratto {
  const raw = (value ?? {}) as {
    clienti?: unknown[];
    fornitori?: unknown[];
    metodo?: unknown;
  };

  return {
    clienti: normalizePartitaArray("cliente", Array.isArray(raw.clienti) ? raw.clienti : []),
    fornitori: normalizePartitaArray("fornitore", Array.isArray(raw.fornitori) ? raw.fornitori : []),
    metodo: typeof raw.metodo === "string" && raw.metodo ? raw.metodo : "json",
  };
}

function mergePartitariEstratti(values: Array<PartitarioEstratto | null | undefined>): PartitarioEstratto {
  const clienti = dedupPartite(values.flatMap((value) => value?.clienti ?? []));
  const fornitori = dedupPartite(values.flatMap((value) => value?.fornitori ?? []));
  const metodi = Array.from(
    new Set(values.map((value) => value?.metodo).filter((value): value is string => Boolean(value)))
  );

  return {
    clienti,
    fornitori,
    metodo: metodi.length > 0 ? metodi.join("+") : "merged",
  };
}

const creaSessioneInputSchema = z.object({
      incaricoId: z.number(),
      annoEsercizio: z.number(),
      trimestreVerifica: z.number().min(1).max(4).default(1),
      // Partitario: uno o piu' file oppure JSON gia' estratti
      partitarioBase64: z.string().optional(),
      partitarioEstrattoJson: z.string().optional(),
      partitariBase64: z.array(z.string()).optional(),
      partitariEstrattiJson: z.array(z.string()).optional(),
      partitarioNomeFile: z.string().default("partitario.xls"),
      // Estratti conto: array di CSV base64 (uno per mese)
      estrattiContoBase64: z.array(z.string()).min(1),
});

async function creaSessioneHandler(input: z.infer<typeof creaSessioneInputSchema>) {
      const db = await getDb();
      if (!db) throw new Error("Database non disponibile");

      // 1. Parsa il partitario solo con parser locali deterministici
      let clienti: PartitaInput[] = [];
      let fornitori: PartitaInput[] = [];
      let metodo = "sconosciuto";

      const jsonSources = [
        ...(input.partitariEstrattiJson ?? []),
        ...(input.partitarioEstrattoJson ? [input.partitarioEstrattoJson] : []),
      ];
      const fileSources = [
        ...(input.partitariBase64 ?? []),
        ...(input.partitarioBase64 ? [input.partitarioBase64] : []),
      ];

      if (jsonSources.length > 0) {
        const merged = mergePartitariEstratti(
          jsonSources.map((value) => normalizePartitarioEstratto(JSON.parse(value)))
        );
        clienti = merged.clienti;
        fornitori = merged.fornitori;
        metodo = merged.metodo;
      } else if (fileSources.length > 0) {
        const parsedList = fileSources.map((base64) => {
          const partitarioBuffer = Buffer.from(base64, "base64");
          const parsed = parsaPartitarioXLS(partitarioBuffer);
          return { ...parsed, metodo: "xlsx_locale" };
        });
        const merged = mergePartitariEstratti(parsedList);
        clienti = merged.clienti;
        fornitori = merged.fornitori;
        metodo = merged.metodo;
      } else {
        throw new Error("Carica un partitario Excel/CSV oppure parsalo prima in PDF.");
      }
      console.log(`[creaSessione] Partitario parsato con metodo: ${metodo} — ${clienti.length} clienti, ${fornitori.length} fornitori`);

      if (clienti.length === 0 && fornitori.length === 0) {
        throw new Error("Nessuna partita trovata nel file partitario. Il file potrebbe essere vuoto, protetto o in un formato non riconoscibile. Prova a salvarlo come .xlsx e ricaricarlo.");
      }

      // 2. Parsa i movimenti bancari da CSV o Excel
      const estrattiBuffers = input.estrattiContoBase64.map(b64 =>
        Buffer.from(b64, "base64")
      );
      estrattiBuffers.forEach((buffer, i) => {
        const lines = buffer.toString("utf-8").split("\n").slice(0, 3);
        console.log(`[verificaIncassi] Estratto[${i}] prime righe:`, lines);
      });
      const movimenti = estrattiBuffers.flatMap(parsaEstrattoContoDaBuffer);
      console.log(`[verificaIncassi] movimenti parsati: ${movimenti.length}`);

      if (movimenti.length === 0) {
        const primaRiga = estrattiBuffers[0]?.toString("utf-8").split("\n")[0] ?? "(vuoto)";
        throw new Error(`Nessun movimento trovato nei file estratto conto. Prima riga rilevata: "${primaRiga.substring(0, 100)}". Verifica il formato del file.`);
      }

      movimenti.sort((a, b) => {
        const dataA = normalizzaData(a.data);
        const dataB = normalizzaData(b.data);
        if (dataA === dataB) return Math.abs(b.importo) - Math.abs(a.importo);
        return dataA.localeCompare(dataB);
      });
      const movimentiConIndice: MatchMovimento[] = movimenti.map((mov, originalIndex) => ({
        ...mov,
        originalIndex,
      }));
      const usedIndexes = new Set<number>();

      // 3. Crea la sessione
      const [ins] = await db.insert(verificaIncassiSessioni).values({
        incaricoId: input.incaricoId,
        annoEsercizio: input.annoEsercizio,
        trimestreVerifica: input.trimestreVerifica,
        stato: "in_elaborazione",
        totalePartiteClienti: clienti.length,
        totalePartiteFornitori: fornitori.length,
      });
      const sessioneId = (ins as any).insertId as number;

      // 4. Matching e inserimento partite
      const tuttePartite = [...clienti, ...fornitori].sort(
        (a, b) => b.saldoPartita - a.saldoPartita
      );
      let clientiTrovati = 0, fornitoriTrovati = 0;
      let importoClienteVerificato = 0, importoFornitoreVerificato = 0;

      const partiteDb = tuttePartite.map(partita => {
        const match = matchPartita(partita, movimentiConIndice, usedIndexes);

        if (match.stato !== "non_trovata") {
          if (partita.tipo === "cliente") { clientiTrovati++; importoClienteVerificato += match.importoCoperto; }
          else { fornitoriTrovati++; importoFornitoreVerificato += match.importoCoperto; }
        }

        return {
          sessioneId,
          tipo: partita.tipo,
          codice: truncateDb(partita.codice, 30) ?? "",
          ragioneSociale: truncateDb(partita.ragioneSociale, 255) ?? "Soggetto non identificato",
          saldoPartita: decimalDb(partita.saldoPartita),
          importoCoperto: decimalDb(match.importoCoperto),
          residuo: decimalDb(match.residuo),
          dataMovimentoBancario: truncateDb(match.dataMovimento, 20),
          descrizioneMovimento: match.descrizioneMovimento || null,
          criterioMatching: match.criterio,
          confidenzaMatching: String(Math.min(1, Math.max(0, Math.round(match.confidenza * 1000) / 1000))),
          statoMatching: match.stato,
          noteRevisore: null,
        };
      });

      // Inserisci in batch
      if (partiteDb.length > 0) {
        try {
          await db.insert(verificaIncassiPartite).values(partiteDb);
        } catch (error) {
          console.error("[verificaIncassi] errore salvataggio partite", error);
          throw new Error("La verifica ha letto i file ma non e' riuscita a salvare i risultati. Ho bloccato il dettaglio tecnico: riprova dopo aver ricaricato i file; se il problema persiste, controlla che i nominativi e le date dei movimenti non contengano valori anomali.");
        }
      }

      // 5. Calcola statistiche e aggiorna sessione
      const totaleClienteImporto = clienti.reduce((s, p) => s + p.saldoPartita, 0);
      const totaleFornitoreImporto = fornitori.reduce((s, p) => s + p.saldoPartita, 0);
      const percClienti = clienti.length > 0 ? Math.round((clientiTrovati / clienti.length) * 100) : 0;
      const percFornitori = fornitori.length > 0 ? Math.round((fornitoriTrovati / fornitori.length) * 100) : 0;

      // Serializza i movimenti bancari per la verifica pagamenti obbligatori
      const movimentiPerDb = movimentiConIndice.map(m => ({
        data: m.data,
        descrizione: m.descrizione,
        importo: m.importo,
        segno: m.segno,
        originalIndex: m.originalIndex,
        utilizzato: usedIndexes.has(m.originalIndex),
      }));

      await db.update(verificaIncassiSessioni)
        .set({
          stato: "completata",
          partiteClienteIncassate: clientiTrovati,
          partiteFornitoriPagate: fornitoriTrovati,
          importoClienteIncassato: String(Math.round(importoClienteVerificato * 100) / 100),
          importoFornitorePagato: String(Math.round(importoFornitoreVerificato * 100) / 100),
          percCoperturaCl: String(percClienti),
          percCoperturaFo: String(percFornitori),
          movimentiBancariJson: JSON.stringify(movimentiPerDb),
        })
        .where(eq(verificaIncassiSessioni.id, sessioneId));

      return {
        sessioneId,
        clientiParsati: clienti.length,
        fornitoriParsati: fornitori.length,
        movimentiParsati: movimenti.length,
        clientiTrovati,
        fornitoriTrovati,
        percCoperturaCreditiPerc: percClienti,
        percCoperturaDibitiPerc: percFornitori,
      };
}

// ─── ROUTER ───────────────────────────────────────────────────────────────────

export const verificaIncassiRouter = router({

  /** Crea una sessione dai file caricati manualmente. */
  creaSessione: protectedProcedure
    .input(creaSessioneInputSchema)
    .mutation(({ input }) => creaSessioneHandler(input)),

  /** Legge partitari ed estratti successivi direttamente dal dossier Nextcloud. */
  creaSessioneDaDossier: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const incarico = await getIncaricoById(input.incaricoId);
      if (!incarico) throw new Error("Incarico non trovato");
      if (!incarico.nextcloudFolder) throw new Error("Collega prima la cartella Revisioni del cliente");

      const analysis = await analyzeRevisionFolderLocally(incarico.nextcloudFolder, incarico.annoEsercizio);
      const documents = analysis.standardPackage?.documents ?? {};
      const documentiClienti = documents.clienti ?? [];
      const documentiFornitori = documents.fornitori ?? [];
      const partitari = [...documentiClienti, ...documentiFornitori];
      const estratti = documents.estrattiContoSuccessivi ?? [];
      if (partitari.length === 0) throw new Error("Nel dossier non sono stati individuati i partitari clienti/fornitori");
      if (estratti.length === 0) throw new Error(`Nel dossier non sono stati individuati estratti conto del ${incarico.annoEsercizio + 1}`);

      const normalizePath = (value: string) => value.startsWith("Revisioni/") ? value : `Revisioni/${value}`;
      const [partitariBuffers, estrattiBuffers] = await Promise.all([
        Promise.all(partitari.map((doc: any) => downloadNextcloudFile(normalizePath(doc.path)))),
        Promise.all(estratti.map((doc: any) => downloadNextcloudFile(normalizePath(doc.path)))),
      ]);
      const clientiCount = documentiClienti.length;
      const clienti = partitariBuffers.slice(0, clientiCount).flatMap(buffer =>
        parseStandardCounterpartyBalances(buffer, "customers", incarico.annoEsercizio)
      );
      const fornitori = partitariBuffers.slice(clientiCount).flatMap(buffer =>
        parseStandardCounterpartyBalances(buffer, "suppliers", incarico.annoEsercizio)
      );
      if (clienti.length === 0 && fornitori.length === 0) {
        throw new Error("I partitari sono stati trovati ma non contengono saldi dell'esercizio selezionato");
      }
      const result = await creaSessioneHandler({
        incaricoId: input.incaricoId,
        annoEsercizio: incarico.annoEsercizio,
        trimestreVerifica: 1,
        partitariEstrattiJson: [JSON.stringify({ clienti, fornitori, metodo: "partitario_standard_21_colonne" })],
        partitarioNomeFile: partitari.map((doc: any) => doc.name).join(" + "),
        estrattiContoBase64: estrattiBuffers.map(buffer => buffer.toString("base64")),
      });
      return {
        ...result,
        automatico: true,
        fonti: {
          partitari: partitari.map((doc: any) => doc.name),
          estrattiConto: estratti.map((doc: any) => doc.name),
        },
      };
    }),

  /** Lista sessioni di un incarico */
  listSessioni: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(verificaIncassiSessioni)
        .where(eq(verificaIncassiSessioni.incaricoId, input.incaricoId));
    }),

  /** Partite di una sessione con filtri */
  listPartite: protectedProcedure
    .input(z.object({
      sessioneId: z.number(),
      tipo: z.enum(["cliente", "fornitore", "tutti"]).default("tutti"),
      stato: z.enum(["incassata_pagata", "parzialmente_coperta", "non_trovata", "tutti"]).default("tutti"),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db.select().from(verificaIncassiPartite)
        .where(eq(verificaIncassiPartite.sessioneId, input.sessioneId));

      return rows.filter(r => {
        if (input.tipo !== "tutti" && r.tipo !== input.tipo) return false;
        if (input.stato !== "tutti" && r.statoMatching !== input.stato) return false;
        return true;
      });
    }),

  /** Aggiorna nota revisore su una partita */
  aggiornaNota: protectedProcedure
    .input(z.object({
      partitaId: z.number(),
      noteRevisore: z.string(),
      statoManuale: z.enum(["incassata_pagata", "parzialmente_coperta", "non_trovata"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database non disponibile");
      const upd: Record<string, unknown> = { noteRevisore: input.noteRevisore };
      if (input.statoManuale) upd.stato = input.statoManuale;
      await db.update(verificaIncassiPartite).set(upd).where(eq(verificaIncassiPartite.id, input.partitaId));
      return { ok: true };
    }),

  /** Crea una sessione di circolarizzazione dalle partite non quadrate */
  riportaNonQuadrateInCircolarizzazione: protectedProcedure
    .input(z.object({
      sessioneId: z.number(),
      incaricoId: z.number(),
      emailRevisore: z.string().email(),
      partitaIds: z.array(z.number()).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database non disponibile");

      const partite = await db
        .select()
        .from(verificaIncassiPartite)
        .where(eq(verificaIncassiPartite.sessioneId, input.sessioneId));

      const selectedIds = input.partitaIds?.length ? new Set(input.partitaIds) : null;
      const nonQuadrate = partite.filter((p) => {
        const residuo = Math.abs(parseFloat(String(p.residuo ?? "0")));
        return (!selectedIds || selectedIds.has(p.id)) && (p.statoMatching !== "incassata_pagata" || residuo > 0.01);
      });

      if (nonQuadrate.length === 0) {
        throw new Error("Non ci sono partite non quadrate da riportare in circolarizzazione.");
      }

      const totaleClienti = nonQuadrate
        .filter(p => p.tipo === "cliente")
        .reduce((sum, p) => sum + Math.abs(parseFloat(String(p.residuo ?? p.saldoPartita ?? "0"))), 0);
      const totaleFornitori = nonQuadrate
        .filter(p => p.tipo === "fornitore")
        .reduce((sum, p) => sum + Math.abs(parseFloat(String(p.residuo ?? p.saldoPartita ?? "0"))), 0);
      const tipoCircolarizzazione =
        totaleClienti > 0 && totaleFornitori > 0 ? "entrambi" :
        totaleClienti > 0 ? "clienti" : "fornitori";

      const [sessioneResult] = await db.insert(circolarizzazioneSessioni).values({
        incaricoId: input.incaricoId,
        emailRevisore: input.emailRevisore,
        dataRiferimento: new Date(new Date().getFullYear(), 11, 31),
        tipoCircolarizzazione,
        percentualeCoperturaMinimaCalcolata: "100.00",
        totaleCreditiClienti: decimalDb(totaleClienti),
        totaleDebitiFornitori: decimalDb(totaleFornitori),
        coperturaCampioneCl: totaleClienti > 0 ? "100.00" : "0.00",
        coperturaCampioneFo: totaleFornitori > 0 ? "100.00" : "0.00",
        analisiAiSelezione: "Sessione generata automaticamente dalla verifica incassi e pagamenti successivi: sono state incluse le partite non quadrate per conferma saldo e/o procedure alternative.",
      });

      const nuovaSessioneId = (sessioneResult as any).insertId as number;

      await db.insert(circolarizzazioneDestinatari).values(
        nonQuadrate.map((p) => {
          const residuo = Math.abs(parseFloat(String(p.residuo ?? "0")));
          const saldo = residuo > 0.01 ? residuo : Math.abs(parseFloat(String(p.saldoPartita ?? "0")));
          return {
            sessioneId: nuovaSessioneId,
            incaricoId: input.incaricoId,
            codice: truncateDb(p.codice, 20),
            ragioneSociale: truncateDb(p.ragioneSociale, 255) ?? "Soggetto non identificato",
            tipo: p.tipo,
            saldo: decimalDb(saldo),
            isEstero: false,
            motivazioneSelezione: "manuale_revisore" as const,
            priorita: p.statoMatching === "non_trovata" ? "alta" as const : "media" as const,
            noteMotivazione: `Riportato dalla verifica incassi/pagamenti: ${p.statoMatching === "non_trovata" ? "nessun movimento bancario trovato" : "partita parzialmente coperta o con differenza residua"}.`,
            incluso: true,
          };
        })
      );

      return {
        sessioneId: nuovaSessioneId,
        destinatari: nonQuadrate.length,
        clienti: nonQuadrate.filter(p => p.tipo === "cliente").length,
        fornitori: nonQuadrate.filter(p => p.tipo === "fornitore").length,
      };
    }),

  /** Analisi AI procedure alternative per partite non trovate */
  analisiAiProcedureAlternative: protectedProcedure
    .input(z.object({ sessioneId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database non disponibile");

      const partiteNonTrovate = await db.select().from(verificaIncassiPartite)
        .where(eq(verificaIncassiPartite.sessioneId, input.sessioneId));

      const nonTrovate = partiteNonTrovate.filter(p => p.statoMatching === "non_trovata");
      if (nonTrovate.length === 0) return { analisi: "Tutte le partite hanno trovato corrispondenza nei movimenti bancari." };

      const elenco = nonTrovate.slice(0, 20).map(p =>
        `- ${p.tipo === "cliente" ? "Cliente" : "Fornitore"}: ${p.ragioneSociale} — Saldo: €${parseFloat(p.saldoPartita ?? "0").toFixed(2)}`
      ).join("\n");

      const resp = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `Sei un revisore legale esperto in ISA Italia. Suggerisci procedure alternative di revisione per le partite aperte non riscontrate negli estratti conto bancari del primo trimestre successivo, in conformità con ISA Italia 505 e 560. Sii conciso e operativo.`,
          },
          {
            role: "user",
            content: `Le seguenti partite aperte al 31/12 non hanno trovato corrispondenza nei movimenti bancari del Q1 successivo:\n\n${elenco}\n\nSuggerisci procedure alternative di revisione per ciascuna categoria (clienti/fornitori).`,
          },
        ],
      });

      return { analisi: (resp as any).choices?.[0]?.message?.content ?? "Analisi non disponibile." };
    }),

  /**
   * Parsa un estratto conto bancario in formato PDF usando LLM.
   * Restituisce il CSV base64 nel formato interno (compatibile con parsaMovimentiBancari).
   */
  parsaEstrattoContoPDF: protectedProcedure
    .input(z.object({
      pdfBase64: z.string().min(1),
      nomeFile: z.string().default("estratto_conto.pdf"),
    }))
    .mutation(async ({ input }) => {
      const resp = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `Sei un assistente specializzato nell'estrazione di dati da estratti conto bancari italiani.
Estrai TUTTI i movimenti presenti nel documento e restituisci SOLO un JSON con questa struttura:
{
  "movimenti": [{"data":"DD/MM/YYYY","descrizione":"testo","importo":1234.56,"segno":"dare"}],
  "saldoIniziale": 0,
  "saldoFinale": 0,
  "banca": "nome banca",
  "periodo": "es. Gennaio 2025"
}
Regole:
- segno "avere" = entrata (incasso da clienti)
- segno "dare" = uscita (pagamento a fornitori)
- importo sempre positivo
- includi TUTTI i movimenti
- restituisci SOLO il JSON, nessun testo aggiuntivo`,
          },
          {
            role: "user",
            content: [
              {
                type: "document" as const,
                source: {
                  type: "base64" as const,
                  media_type: "application/pdf",
                  data: input.pdfBase64,
                },
              },
              { type: "text" as const, text: "Estrai tutti i movimenti da questo estratto conto bancario." },
            ],
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "estratto_conto",
            strict: true,
            schema: {
              type: "object",
              properties: {
                movimenti: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      data: { type: "string" },
                      descrizione: { type: "string" },
                      importo: { type: "number" },
                      segno: { type: "string" },
                    },
                    required: ["data", "descrizione", "importo", "segno"],
                    additionalProperties: false,
                  },
                },
                saldoIniziale: { type: "number" },
                saldoFinale: { type: "number" },
                banca: { type: "string" },
                periodo: { type: "string" },
              },
              required: ["movimenti", "saldoIniziale", "saldoFinale", "banca", "periodo"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = (resp as any).choices?.[0]?.message?.content ?? "{}";
      let parsed: {
        movimenti: Array<{ data: string; descrizione: string; importo: number; segno: string }>;
        saldoIniziale: number;
        saldoFinale: number;
        banca: string;
        periodo: string;
      };
      try {
        parsed = parseJsonFromLlmContent(content);
      } catch {
        throw new Error("L'AI non ha restituito un JSON valido. Riprova o usa il formato CSV.");
      }

      if (!parsed.movimenti || parsed.movimenti.length === 0) {
        throw new Error("Nessun movimento trovato nel PDF. Verifica che sia un estratto conto bancario.");
      }

      // Converti in formato CSV interno compatibile con parsaMovimentiBancari
      const csvLines = ["Data contabile;Data valuta;Importo;Divisa;Causale;Descrizione;Canale"];
      for (const m of parsed.movimenti) {
        const importoSegnato = m.segno === "dare" ? -Math.abs(m.importo) : Math.abs(m.importo);
        const importoStr = importoSegnato.toFixed(2).replace(".", ",");
        const desc = (m.descrizione ?? "").replace(/;/g, " ");
        csvLines.push(`${m.data};${m.data};${importoStr};EUR;BONIF;${desc};PDF`);
      }
      const csvContent = csvLines.join("\n");

      return {
        csvBase64: Buffer.from(csvContent).toString("base64"),
        movimentiEstratti: parsed.movimenti.length,
        banca: parsed.banca,
        periodo: parsed.periodo,
        saldoIniziale: parsed.saldoIniziale,
        saldoFinale: parsed.saldoFinale,
      };
    }),

  /**
   * Parsa un partitario clienti/fornitori in formato PDF usando LLM.
   * Restituisce i dati già normalizzati per la riconciliazione.
   */
  parsaPartitarioPDF: protectedProcedure
    .input(z.object({
      pdfBase64: z.string().min(1),
      nomeFile: z.string().default("partitario.pdf"),
    }))
    .mutation(async ({ input }) => {
      const resp = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `Sei un assistente specializzato nell'estrazione di dati da partitari clienti e fornitori italiani.
Estrai SOLO i saldi aperti rilevanti per la riconciliazione bancaria e restituisci SOLO un JSON con questa struttura:
{
  "clienti": [{"codice":"", "ragioneSociale":"", "saldoPartita":1234.56, "estero":false}],
  "fornitori": [{"codice":"", "ragioneSociale":"", "saldoPartita":1234.56, "estero":false}],
  "azienda": "nome azienda",
  "anno": 2025
}
Regole:
- includi solo le righe di dettaglio con saldo diverso da zero
- ignora totali, subtotali, intestazioni e numeri di pagina
- usa sempre saldoPartita positivo anche se nel PDF il fornitore è mostrato con segno negativo
 - se il PDF contiene solo clienti o solo fornitori, lascia l'altro array vuoto
 - se il PDF e' un mastrino "scheda conto", ogni blocco inizia con "Conto ..." e il valore corretto da estrarre e' il saldo finale riportato nella riga "Saldo alla data..:"
 - lo stesso conto puo' continuare su piu' pagine: in quel caso restituisci una sola voce finale per conto, usando il saldo finale al 31.12 e non i saldi intermedi di pagina
 - conserva il codice conto e la ragione sociale come compaiono nella riga "Conto ..."
 - se il codice conto inizia con "3." trattalo come cliente; se inizia con "53." trattalo come fornitore
 - restituisci SOLO JSON valido, nessun testo aggiuntivo`,
          },
          {
            role: "user",
            content: [
              {
                type: "document" as const,
                source: {
                  type: "base64" as const,
                  media_type: "application/pdf",
                  data: input.pdfBase64,
                },
              },
              { type: "text" as const, text: "Estrai le partite clienti e fornitori da questo PDF partitario." },
            ],
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "partitario_pdf",
            strict: true,
            schema: {
              type: "object",
              properties: {
                clienti: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      codice: { type: "string" },
                      ragioneSociale: { type: "string" },
                      saldoPartita: { type: "number" },
                      estero: { type: "boolean" },
                    },
                    required: ["codice", "ragioneSociale", "saldoPartita", "estero"],
                    additionalProperties: false,
                  },
                },
                fornitori: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      codice: { type: "string" },
                      ragioneSociale: { type: "string" },
                      saldoPartita: { type: "number" },
                      estero: { type: "boolean" },
                    },
                    required: ["codice", "ragioneSociale", "saldoPartita", "estero"],
                    additionalProperties: false,
                  },
                },
                azienda: { type: "string" },
                anno: { type: "number" },
              },
              required: ["clienti", "fornitori", "azienda", "anno"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = (resp as any).choices?.[0]?.message?.content ?? "{}";
      let parsed: {
        clienti: unknown[];
        fornitori: unknown[];
        azienda: string;
        anno: number;
      };

      try {
        parsed = parseJsonFromLlmContent(content);
      } catch {
        throw new Error("L'AI non ha restituito un JSON valido per il partitario PDF.");
      }

      const normalized = normalizePartitarioEstratto({
        clienti: parsed.clienti,
        fornitori: parsed.fornitori,
        metodo: "pdf_llm",
      });

      if (normalized.clienti.length === 0 && normalized.fornitori.length === 0) {
        throw new Error("Nessuna partita trovata nel PDF. Verifica che sia un partitario clienti/fornitori leggibile.");
      }

      return {
        partitarioEstrattoJson: JSON.stringify(normalized),
        clientiEstratti: normalized.clienti.length,
        fornitoriEstratti: normalized.fornitori.length,
        azienda: parsed.azienda,
        anno: parsed.anno,
      };
    }),

  /** Elimina una sessione */
  eliminaSessione: protectedProcedure
    .input(z.object({ sessioneId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database non disponibile");
      await db.delete(verificaIncassiPartite).where(eq(verificaIncassiPartite.sessioneId, input.sessioneId));
      await db.delete(verificaIncassiSessioni).where(eq(verificaIncassiSessioni.id, input.sessioneId));
      return { ok: true };
    }),

  /**
   * Analizza i movimenti bancari di una sessione e classifica i pagamenti obbligatori:
   * stipendi, INPS/INAIL, F24/imposte, TFR, altri.
   * Restituisce una griglia mese × categoria con importi e flag anomalie.
   */
  getVerificaPagamentiObbligatori: protectedProcedure
    .input(z.object({ sessioneId: z.number(), incaricoId: z.number().optional() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database non disponibile");

      // Recupera la sessione e le partite
      const [sessione] = await db
        .select()
        .from(verificaIncassiSessioni)
        .where(eq(verificaIncassiSessioni.id, input.sessioneId))
        .limit(1);
      if (!sessione) throw new Error("Sessione non trovata");

      // Recupera movimenti bancari dalla sessione (campo movimentiBancariJson)
      // MySQL può restituire il JSON già deserializzato come array, oppure come stringa
      let movimentiBancari: Array<{ data: string; descrizione: string; importo: number; segno: string; utilizzato?: boolean }> = [];
      try {
        const raw = (sessione as any).movimentiBancariJson;
        if (raw) {
          if (typeof raw === "string") {
            movimentiBancari = JSON.parse(raw);
          } else if (Array.isArray(raw)) {
            movimentiBancari = raw;
          }
        }
      } catch {
        movimentiBancari = [];
      }

      if (movimentiBancari.length === 0) {
        // movimentiBancariJson è null: sessione creata prima dell'aggiornamento
        return {
          disponibile: false as const,
          mesi: [],
          totali: null,
          anomalie: [],
          messaggioIndisponibile: "I movimenti bancari non sono disponibili per questa sessione. Per utilizzare la verifica pagamenti obbligatori, elimina questa sessione e ricreala caricando di nuovo il partitario e l'estratto conto."
        };
      }

      // ─── CLASSIFICAZIONE MOVIMENTI ────────────────────────────────────────────
      type Categoria = "stipendi" | "inps_inail" | "f24_imposte" | "altri_uscite";

      // Riclassifica con priorità (stipendi > inps > f24 > altri)
      const PRIORITA: Categoria[] = ["stipendi", "inps_inail", "f24_imposte", "altri_uscite"];

      function classificaMovimento(desc: string, segno: string): Categoria | null {
        if (segno !== "dare") return null; // solo uscite
        const d = desc.toLowerCase();
        // Stipendi: include emolumenti, competenze, mensilità, compensi dipendenti, paghe
        if (/stipend|salari|retribuz|pagamento\s+dipend|busta\s*paga|competenz|emolument|mensil|paga\s+dipend|compensi\s+dipend|compensi\s+lav|paghe|cedolino/.test(d)) return "stipendi";
        if (/inps|inail|contribut|previdenz|assistenz/.test(d)) return "inps_inail";
        if (/f24|agenzia\s+entrate|erario|irpef|ires|iva\s+period|acconto\s+imp|saldo\s+imp|tribut/.test(d)) return "f24_imposte";
        return null; // non classificato come obbligatorio
      }

      // ─── AGGREGAZIONE PER MESE ────────────────────────────────────────────────
      type MeseRecord = {
        mese: string; // "YYYY-MM"
        meseLabel: string; // "Gennaio 2025"
        stipendi: number;
        inps_inail: number;
        f24_imposte: number;
        movimentiClassificati: Array<{ data: string; descrizione: string; importo: number; categoria: Categoria }>;
      };

      const mesiMap = new Map<string, MeseRecord>();

      const MESI_IT = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno",
        "Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];

      for (const m of movimentiBancari) {
        const cat = classificaMovimento(m.descrizione, m.segno);
        if (!cat) continue;

        // Parsing data (DD/MM/YYYY o YYYY-MM-DD)
        let anno = 0, mese = 0;
        const partiSlash = m.data.split("/");
        const partiDash = m.data.split("-");
        if (partiSlash.length === 3) {
          anno = parseInt(partiSlash[2]);
          mese = parseInt(partiSlash[1]);
        } else if (partiDash.length === 3) {
          anno = parseInt(partiDash[0]);
          mese = parseInt(partiDash[1]);
        }
        if (!anno || !mese) continue;

        const chiave = `${anno}-${String(mese).padStart(2, "0")}`;
        const label = `${MESI_IT[mese - 1]} ${anno}`;

        if (!mesiMap.has(chiave)) {
          mesiMap.set(chiave, { mese: chiave, meseLabel: label, stipendi: 0, inps_inail: 0, f24_imposte: 0, movimentiClassificati: [] });
        }
        const rec = mesiMap.get(chiave)!;
        const importo = Math.abs(m.importo);
        if (cat === "stipendi") rec.stipendi += importo;
        else if (cat === "inps_inail") rec.inps_inail += importo;
        else if (cat === "f24_imposte") rec.f24_imposte += importo;
        rec.movimentiClassificati.push({ data: m.data, descrizione: m.descrizione, importo, categoria: cat });
      }

      const mesi = Array.from(mesiMap.values()).sort((a, b) => a.mese.localeCompare(b.mese));

      // ─── ANOMALIE ─────────────────────────────────────────────────────────────
      const anomalie: Array<{ tipo: string; mese: string; messaggio: string; severita: "alta" | "media" }> = [];

      // Mesi con stipendi ma senza INPS (anomalia: pagato stipendio ma non contributi)
      for (const r of mesi) {
        if (r.stipendi > 0 && r.inps_inail === 0) {
          anomalie.push({
            tipo: "contributi_mancanti",
            mese: r.meseLabel,
            messaggio: `${r.meseLabel}: stipendi pagati (${r.stipendi.toFixed(2)} €) ma nessun versamento INPS/INAIL rilevato`,
            severita: "alta",
          });
        }
        // Mesi senza stipendi (possibile mancato pagamento)
        if (r.stipendi === 0 && r.inps_inail > 0) {
          anomalie.push({
            tipo: "stipendi_mancanti",
            mese: r.meseLabel,
            messaggio: `${r.meseLabel}: versamento INPS/INAIL rilevato ma nessuno stipendio — verificare se il pagamento è avvenuto con altra modalità`,
            severita: "media",
          });
        }
      }

      // Totali complessivi
      const totali = {
        stipendi: mesi.reduce((s, r) => s + r.stipendi, 0),
        inps_inail: mesi.reduce((s, r) => s + r.inps_inail, 0),
        f24_imposte: mesi.reduce((s, r) => s + r.f24_imposte, 0),
        mesiConStipendi: mesi.filter(r => r.stipendi > 0).length,
        mesiConContributi: mesi.filter(r => r.inps_inail > 0).length,
        mesiConF24: mesi.filter(r => r.f24_imposte > 0).length,
      };

      // ─── CONFRONTO CON BILANCIO ──────────────────────────────────────────────
      let costoPersonaleBilancio: number | null = null;
      let numeroDipendentiBilancio: number | null = null;
      let annoBilancio: number | null = null;

      // ─── SALDI SP DAL BILANCIO ────────────────────────────────────────────────
      // Struttura per il matching per importo
      type SaldoSP = {
        voce: string;       // es. "Debiti verso dipendenti"
        importo: number;    // valore assoluto del saldo SP
        categoriaAttesa: Categoria; // categoria di pagamento attesa
      };
      let saldiSP: SaldoSP[] = [];

      if (input.incaricoId) {
        try {
          const incarico = await getIncaricoById(input.incaricoId);
          const docs = await getDocumentiByIncarico(input.incaricoId);
          const annoTarget = incarico?.annoEsercizio ?? sessione.annoEsercizio;

          // Priorità: bilancio_analitico > bilancio_revisione > bilancio generico
          const bilancioAnalitico = docs.find(d =>
            d.tipoDocumento === "bilancio_analitico" &&
            d.datiStrutturati && d.statoParsing === "completato"
          );
          const bilancioStandard = docs.filter(d =>
            (d.tipoDocumento === "bilancio" || d.tipoDocumento === "bilancio_revisione") &&
            d.datiStrutturati && d.statoParsing === "completato"
          );
          const bilancio = bilancioAnalitico ??
            (bilancioStandard.find(b => b.annoRiferimento === annoTarget) ?? bilancioStandard[0]);

          if (bilancio) {
            const dati = bilancio.datiStrutturati as Record<string, any>;
            annoBilancio = bilancio.annoRiferimento ?? annoTarget;

            if (bilancio.tipoDocumento === "bilancio_analitico") {
              // Struttura analitica: sezioni esplicite debiti, costi, ecc.
              costoPersonaleBilancio = dati.costi?.costiPersonale ?? null;
              numeroDipendentiBilancio = dati.dipendenti ?? null;
              const deb = dati.debiti ?? {};
              const candidatiAn: Array<{ val: number | null; voce: string; cat: Categoria }> = [
                { val: deb.debitiVersDipendenti ?? null, voce: "Debiti verso dipendenti", cat: "stipendi" },
                { val: deb.debitiTributari ?? null, voce: "Debiti tributari", cat: "f24_imposte" },
                { val: deb.debitiPrevidenziali ?? null, voce: "Debiti previdenziali (INPS/INAIL)", cat: "inps_inail" },
              ];
              for (const c of candidatiAn) {
                if (c.val != null && !isNaN(Number(c.val)) && Number(c.val) > 0) {
                  saldiSP.push({ voce: c.voce, importo: Math.abs(Number(c.val)), categoriaAttesa: c.cat });
                }
              }
            } else {
              // Struttura CEE: cerca in vociSP, statoPatrimoniale o root
              costoPersonaleBilancio = dati.costiPersonale ?? dati.vociCE?.costiPersonale ?? null;
              numeroDipendentiBilancio = dati.dipendenti ?? null;
              const sp = dati.vociSP ?? dati.statoPatrimoniale ?? dati;
              const candidatiCEE: Array<{ chiavi: string[]; voce: string; cat: Categoria }> = [
                { chiavi: ["debitiVersDipendenti", "debitiDipendenti", "debitiVersoDipendenti", "debiti_dipendenti"], voce: "Debiti verso dipendenti", cat: "stipendi" },
                { chiavi: ["debitiTributari", "debitiTrib", "debitiVersoErario", "debiti_tributari"], voce: "Debiti tributari", cat: "f24_imposte" },
                { chiavi: ["debitiPrevidenziali", "debitiIstitPrevidenz", "debitiVersoIstitPrevidenz", "debiti_previdenziali"], voce: "Debiti previdenziali (INPS/INAIL)", cat: "inps_inail" },
              ];
              for (const c of candidatiCEE) {
                for (const k of c.chiavi) {
                  const val = sp[k] ?? dati[k];
                  if (val != null && !isNaN(Number(val)) && Number(val) > 0) {
                    saldiSP.push({ voce: c.voce, importo: Math.abs(Number(val)), categoriaAttesa: c.cat });
                    break;
                  }
                }
              }
            }
          }
        } catch {
          // ignora errori nel recupero bilancio
        }
      }

      // Calcola scostamento stipendi estratto conto vs bilancio
      let confrontoBilancio: {
        costoPersonaleBilancio: number | null;
        stipendiEstrattoConto: number;
        scostamentoAssoluto: number | null;
        scostamentoPerc: number | null;
        semaforo: "verde" | "giallo" | "rosso" | "grigio";
        nota: string;
        annoBilancio: number | null;
        numeroDipendenti: number | null;
      } | null = null;

      if (costoPersonaleBilancio !== null && costoPersonaleBilancio > 0) {
        const stipendiEC = totali.stipendi;
        const scostamentoAss = stipendiEC - costoPersonaleBilancio;
        const scostamentoPerc = (scostamentoAss / costoPersonaleBilancio) * 100;
        // Semaforo: verde ±10%, giallo ±25%, rosso oltre
        const percAss = Math.abs(scostamentoPerc);
        const semaforo = percAss <= 10 ? "verde" : percAss <= 25 ? "giallo" : "rosso";
        const nota = semaforo === "verde"
          ? `Coerente: gli stipendi rilevati (${stipendiEC.toFixed(0)} €) sono in linea con il costo del personale a bilancio (${costoPersonaleBilancio.toFixed(0)} €, scostamento ${scostamentoPerc.toFixed(1)}%).`
          : semaforo === "giallo"
          ? `Attenzione: scostamento del ${scostamentoPerc.toFixed(1)}% tra stipendi rilevati e costo personale a bilancio — verificare se ci sono pagamenti non intercettati o competenze di competenza diversa.`
          : `Anomalia significativa: scostamento del ${scostamentoPerc.toFixed(1)}% — investigare la differenza tra stipendi rilevati (${stipendiEC.toFixed(0)} €) e costo personale a bilancio (${costoPersonaleBilancio.toFixed(0)} €).`;
        confrontoBilancio = {
          costoPersonaleBilancio,
          stipendiEstrattoConto: stipendiEC,
          scostamentoAssoluto: scostamentoAss,
          scostamentoPerc,
          semaforo,
          nota,
          annoBilancio,
          numeroDipendenti: numeroDipendentiBilancio,
        };
      }

      // ─── MATCHING PER IMPORTO: MOVIMENTI BANCARI vs SALDI SP ────────────────────
      // Per ogni saldo SP, cerca nei movimenti bancari in uscita un importo simile (tolleranza ±2% o ±100€)
      type MatchImporto = {
        voce: string;                // es. "Debiti verso dipendenti"
        importoSP: number;           // saldo SP
        categoriaAttesa: Categoria;  // categoria di pagamento attesa
        movimentiAbbinati: Array<{
          data: string;
          descrizione: string;
          importo: number;
          scostamentoAss: number;
          scostamentoPerc: number;
          classificatoTestuale: boolean; // già riconosciuto dai pattern testuali?
        }>;
        statoMatch: "trovato" | "trovato_parziale" | "non_trovato";
      };

      const matchImporti: MatchImporto[] = [];

      if (saldiSP.length > 0) {
        // Tutti i movimenti in uscita (dare)
        const uscite = movimentiBancari.filter(m => m.segno === "dare");

        for (const saldo of saldiSP) {
          const TOLLERANZA_PERC = 0.02; // 2%
          const TOLLERANZA_ABS = 100;   // 100€ fisso
          const soglia = Math.max(saldo.importo * TOLLERANZA_PERC, TOLLERANZA_ABS);

          const abbinati = uscite
            .filter(m => {
              const imp = Math.abs(m.importo);
              return Math.abs(imp - saldo.importo) <= soglia;
            })
            .map(m => {
              const imp = Math.abs(m.importo);
              const scostAss = imp - saldo.importo;
              const scostPerc = saldo.importo > 0 ? (scostAss / saldo.importo) * 100 : 0;
              const classificatoTestuale = classificaMovimento(m.descrizione, m.segno) !== null;
              return {
                data: m.data,
                descrizione: m.descrizione,
                importo: imp,
                scostamentoAss: scostAss,
                scostamentoPerc: scostPerc,
                classificatoTestuale,
              };
            })
            .sort((a, b) => Math.abs(a.scostamentoAss) - Math.abs(b.scostamentoAss)); // più vicini prima

          const statoMatch: MatchImporto["statoMatch"] =
            abbinati.length === 0 ? "non_trovato" :
            abbinati[0].scostamentoAss === 0 ? "trovato" : "trovato_parziale";

          matchImporti.push({
            voce: saldo.voce,
            importoSP: saldo.importo,
            categoriaAttesa: saldo.categoriaAttesa,
            movimentiAbbinati: abbinati,
            statoMatch,
          });

          // Se il movimento abbinato non era classificato testualmente, aggiungilo come anomalia informativa
          for (const ma of abbinati) {
            if (!ma.classificatoTestuale) {
              anomalie.push({
                tipo: "match_importo_non_classificato",
                mese: ma.data,
                messaggio: `Movimento del ${ma.data} "${ma.descrizione}" (${ma.importo.toFixed(2)} €) corrisponde per importo al saldo SP "${saldo.voce}" (${saldo.importo.toFixed(2)} €, scostamento ${ma.scostamentoAss >= 0 ? "+" : ""}${ma.scostamentoAss.toFixed(2)} €) — non classificato dai pattern testuali`,
                severita: "media",
              });
            }
          }
        }
      }

      // ─── ALERT AUTOMATICO: scostamento costo personale > 25% ──────────────────
      if (
        confrontoBilancio &&
        confrontoBilancio.semaforo === "rosso" &&
        confrontoBilancio.scostamentoPerc !== null &&
        Math.abs(confrontoBilancio.scostamentoPerc) > 25
      ) {
        const incaricoIdAlert = sessione.incaricoId;
        try {
          const db2 = await getDb();
          if (db2) {
            // Evita duplicati: non creare alert se ne esiste già uno non letto dello stesso tipo
            const existing = await db2
              .select({ id: alertsTable.id })
              .from(alertsTable)
              .where(
                and(
                  eq(alertsTable.incaricoId, incaricoIdAlert),
                  eq(alertsTable.tipoAlert, "variazione_anomala"),
                  eq(alertsTable.letto, false),
                  like(alertsTable.titolo, "%costo del personale%")
                )
              )
              .limit(1);
            if (existing.length === 0) {
              await createAlert({
                incaricoId: incaricoIdAlert,
                modulo: "sistema",
                tipoAlert: "variazione_anomala",
                severita: "critical",
                titolo: "Anomalia costo del personale",
                messaggio: `Scostamento del ${Math.abs(confrontoBilancio.scostamentoPerc).toFixed(1)}% tra stipendi rilevati dall'estratto conto (${confrontoBilancio.stipendiEstrattoConto.toFixed(0)} €) e costo del personale a bilancio (${confrontoBilancio.costoPersonaleBilancio!.toFixed(0)} €). Investigare la differenza: potrebbero esserci pagamenti non intercettati, competenze di altro esercizio o errori di classificazione contabile.`,
                datiContesto: {
                  stipendiEC: confrontoBilancio.stipendiEstrattoConto,
                  costoPersonaleBilancio: confrontoBilancio.costoPersonaleBilancio,
                  scostamentoPerc: confrontoBilancio.scostamentoPerc,
                  scostamentoAssoluto: confrontoBilancio.scostamentoAssoluto,
                  annoBilancio: confrontoBilancio.annoBilancio,
                },
              });
            }
          }
        } catch {
          // Non bloccare la risposta se la creazione dell'alert fallisce
        }
      }

      // ─── ALERT AUTOMATICO: mancato versamento INPS/INAIL ─────────────────────
      const mesiContributiMancanti = anomalie.filter(a => a.tipo === "contributi_mancanti");
      if (mesiContributiMancanti.length > 0) {
        const incaricoIdInps = sessione.incaricoId;
        try {
          const db3 = await getDb();
          if (db3) {
            // Evita duplicati: non creare alert se ne esiste già uno non letto dello stesso tipo
            const existingInps = await db3
              .select({ id: alertsTable.id })
              .from(alertsTable)
              .where(
                and(
                  eq(alertsTable.incaricoId, incaricoIdInps),
                  eq(alertsTable.tipoAlert, "variazione_anomala"),
                  eq(alertsTable.letto, false),
                  like(alertsTable.titolo, "%INPS/INAIL%")
                )
              )
              .limit(1);
            if (existingInps.length === 0) {
              const mesiList = mesiContributiMancanti.map(a => a.mese).join(", ");
              await createAlert({
                incaricoId: incaricoIdInps,
                modulo: "sistema",
                tipoAlert: "variazione_anomala",
                severita: "warning",
                titolo: `Mancato versamento INPS/INAIL (${mesiContributiMancanti.length} ${mesiContributiMancanti.length === 1 ? "mese" : "mesi"})`,
                messaggio: `Nei seguenti mesi sono stati rilevati stipendi pagati ma nessun versamento INPS/INAIL: ${mesiList}. Verificare se i contributi sono stati versati con altra modalità o se vi sono omissioni contributive. Riferimento: art. 2114 c.c., ISA Italia 240.`,
                datiContesto: {
                  mesiAnomalii: mesiContributiMancanti.map(a => ({ mese: a.mese, messaggio: a.messaggio })),
                  totaleStipendi: totali.stipendi,
                  totaleInpsInail: totali.inps_inail,
                },
              });
            }
          }
        } catch {
          // Non bloccare la risposta se la creazione dell'alert fallisce
        }
      }

      return { disponibile: true as const, mesi, totali, anomalie, confrontoBilancio, matchImporti };
    }),

  /**
   * Genera un file Excel carta di lavoro ISA 560.
   * Foglio 1: Partite + matching
   * Foglio 2: Statistiche riepilogative
   * Foglio 3: Movimenti bancari classificati
   */
  exportISA560: protectedProcedure
    .input(z.object({ sessioneId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database non disponibile");

      // Recupera sessione
      const [sessione] = await db
        .select()
        .from(verificaIncassiSessioni)
        .where(eq(verificaIncassiSessioni.id, input.sessioneId))
        .limit(1);
      if (!sessione) throw new Error("Sessione non trovata");

      // Recupera partite
      const partite = await db
        .select()
        .from(verificaIncassiPartite)
        .where(eq(verificaIncassiPartite.sessioneId, input.sessioneId));

      // Recupera movimenti bancari
      let movimentiBancari: Array<{ data: string; descrizione: string; importo: number; segno: string }> = [];
      try {
        const jsonStr = (sessione as any).movimentiBancariJson;
        if (jsonStr) movimentiBancari = JSON.parse(jsonStr);
      } catch { /* ignora */ }

      const criterioLabel = (value: unknown) => ({
        quadrato_esatto: "Quadrato esatto",
        quadrato_somma: "Quadrato per somma movimenti",
        parziale: "Parzialmente coperto",
        nome_importo_diverso: "Nome presente, importo diverso",
        segno_incoerente: "Nome presente ma segno incoerente",
        possibile_importo: "Possibile match per importo",
        non_trovato: "Non trovato",
      } as Record<string, string>)[String(value ?? "")] ?? String(value ?? "");

      // ─── FOGLIO 1: PARTITE ────────────────────────────────────────────────
      const righePartite = [
        [
          "Tipo", "Codice", "Ragione Sociale", "N. Fattura", "Data Fattura",
          "Saldo Partita (€)", "Importo Coperto (€)", "Residuo (€)",
          "Stato Matching", "Data Movimento Bancario", "Descrizione Movimento",
          "Confidenza Matching", "Criterio", "Note Revisore",
        ],
        ...partite.map(p => [
          p.tipo === "cliente" ? "Cliente" : "Fornitore",
          p.codice ?? "",
          p.ragioneSociale,
          p.numeroFattura ?? "",
          p.dataFattura ?? "",
          parseFloat(String(p.saldoPartita ?? 0)),
          parseFloat(String(p.importoCoperto ?? 0)),
          parseFloat(String(p.residuo ?? 0)),
          p.statoMatching === "incassata_pagata" ? "Incassata/Pagata" :
            p.statoMatching === "parzialmente_coperta" ? "Parzialmente coperta" :
            p.statoMatching === "non_trovata" ? "Non trovata" : "Non verificata",
          p.dataMovimentoBancario ?? "",
          p.descrizioneMovimento ?? "",
          parseFloat(String(p.confidenzaMatching ?? 0)),
          criterioLabel((p as any).criterioMatching),
          p.noteRevisore ?? "",
        ]),
      ];

      // ─── FOGLIO 2: STATISTICHE ────────────────────────────────────────────
      const clienti = partite.filter(p => p.tipo === "cliente");
      const fornitori = partite.filter(p => p.tipo === "fornitore");
      const clientiIncassati = clienti.filter(p => p.statoMatching === "incassata_pagata").length;
      const fornitoriPagati = fornitori.filter(p => p.statoMatching === "incassata_pagata").length;
      const importoClientiVerificato = clienti.reduce((s, p) => s + parseFloat(String(p.importoCoperto ?? 0)), 0);
      const importoFornitoriVerificato = fornitori.reduce((s, p) => s + parseFloat(String(p.importoCoperto ?? 0)), 0);
      const importoClientiTotale = clienti.reduce((s, p) => s + parseFloat(String(p.saldoPartita ?? 0)), 0);
      const importoFornitoriTotale = fornitori.reduce((s, p) => s + parseFloat(String(p.saldoPartita ?? 0)), 0);

      const righeStatistiche = [
        ["Carta di Lavoro ISA Italia 560 — Verifica Incassi e Pagamenti Successivi"],
        [""],
        ["Anno esercizio", sessione.annoEsercizio],
        ["Trimestre verifica", `Q${sessione.trimestreVerifica}`],
        ["Data elaborazione", new Date().toLocaleDateString("it-IT")],
        [""],
        ["CLIENTI", ""],
        ["Totale partite clienti", clienti.length],
        ["Partite incassate", clientiIncassati],
        ["Copertura %", clienti.length > 0 ? ((clientiIncassati / clienti.length) * 100).toFixed(1) + "%" : "N/D"],
        ["Importo totale partite clienti (€)", importoClientiTotale],
        ["Importo verificato clienti (€)", importoClientiVerificato],
        [""],
        ["FORNITORI", ""],
        ["Totale partite fornitori", fornitori.length],
        ["Partite pagate", fornitoriPagati],
        ["Copertura %", fornitori.length > 0 ? ((fornitoriPagati / fornitori.length) * 100).toFixed(1) + "%" : "N/D"],
        ["Importo totale partite fornitori (€)", importoFornitoriTotale],
        ["Importo verificato fornitori (€)", importoFornitoriVerificato],
        [""],
        ["MOVIMENTI BANCARI", ""],
        ["Totale movimenti estratto conto", movimentiBancari.length],
        ["Movimenti in entrata (avere)", movimentiBancari.filter(m => m.segno === "avere").length],
        ["Movimenti in uscita (dare)", movimentiBancari.filter(m => m.segno === "dare").length],
      ];

      // ─── FOGLIO 3: MOVIMENTI BANCARI ──────────────────────────────────────
      const righeMovimenti = [
        ["Data", "Descrizione", "Importo (€)", "Segno", "Utilizzato"],
        ...movimentiBancari.map(m => [
          m.data,
          m.descrizione,
          Math.abs(m.importo),
          m.segno === "avere" ? "Entrata" : "Uscita",
          m.utilizzato ? "Si" : "No",
        ]),
      ];

      // ─── GENERA XLSX ──────────────────────────────────────────────────────
      const wb = XLSX.utils.book_new();

      const ws1 = XLSX.utils.aoa_to_sheet(righePartite);
      // Larghezze colonne foglio 1
      ws1["!cols"] = [8, 12, 35, 15, 12, 16, 16, 14, 20, 18, 45, 12, 30].map(w => ({ wch: w }));
      XLSX.utils.book_append_sheet(wb, ws1, "Partite ISA 560");

      const ws2 = XLSX.utils.aoa_to_sheet(righeStatistiche);
      ws2["!cols"] = [{ wch: 40 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(wb, ws2, "Statistiche");

      const ws3 = XLSX.utils.aoa_to_sheet(righeMovimenti);
      ws3["!cols"] = [{ wch: 14 }, { wch: 55 }, { wch: 14 }, { wch: 10 }];
      XLSX.utils.book_append_sheet(wb, ws3, "Movimenti Bancari");

      const xlsxBuffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      const base64 = Buffer.from(xlsxBuffer).toString("base64");

      return {
        base64,
        nomeFile: `ISA560_verifica_${sessione.annoEsercizio}_Q${sessione.trimestreVerifica}_sessione${input.sessioneId}.xlsx`,
      };
    }),
});
