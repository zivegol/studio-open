import crypto from "node:crypto";
import XLSX from "xlsx";
import { parseXbrlBilancio } from "./routers/documenti";

export type StandardSource = { path: string; name: string; extension?: string };

type LedgerKind = "general" | "customers" | "suppliers";

type LedgerRow = {
  accountCode: string;
  accountName: string;
  entityCode: string;
  entityName: string;
  date: Date | null;
  description: string;
  documentReference: string;
  debit: number;
  credit: number;
  balance: number;
  rowNumber: number;
};

const numberValue = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const normalized = String(value ?? "").trim().replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const excelDate = (value: unknown): Date | null => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number" && value > 20000 && value < 100000) {
    const parsed = XLSX.SSF.parse_date_code(value);
    return parsed ? new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d)) : null;
  }
  const match = String(value ?? "").match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (!match) return null;
  const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
  const date = new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[1])));
  return Number.isNaN(date.getTime()) ? null : date;
};

function parseLedger(buffer: Buffer, kind: LedgerKind, engagementYear: number) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false, cellText: false });
  const rows: LedgerRow[] = [];
  for (const sheetName of workbook.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: "", raw: true });
    matrix.forEach((raw, index) => {
      if (!Array.isArray(raw) || raw.length < 17) return;
      const accountCode = String(raw[2] ?? "").trim();
      const accountName = String(raw[3] ?? "").trim();
      const entityCode = String(raw[4] ?? "").trim();
      const entityName = String(raw[5] ?? "").trim();
      const date = excelDate(raw[10]);
      if (!accountCode || !date) return;
      rows.push({
        accountCode, accountName, entityCode, entityName, date,
        description: String(raw[12] ?? "").trim(),
        documentReference: String(raw[13] ?? "").trim(),
        debit: numberValue(raw[14]), credit: numberValue(raw[15]), balance: numberValue(raw[16]),
        rowNumber: index + 1,
      });
    });
  }

  const inPeriodRows = rows.filter(row => row.date?.getUTCFullYear() === engagementYear);
  const closingByKey = new Map<string, LedgerRow>();
  for (const row of inPeriodRows) {
    const meaningfulEntity = row.entityCode && row.entityCode !== "0" ? row.entityCode : row.entityName;
    const key = meaningfulEntity ? `${row.accountCode}::${meaningfulEntity}` : row.accountCode;
    const existing = closingByKey.get(key);
    if (!existing || (row.date?.getTime() ?? 0) > (existing.date?.getTime() ?? 0) ||
      ((row.date?.getTime() ?? 0) === (existing.date?.getTime() ?? 0) && row.rowNumber > existing.rowNumber)) {
      closingByKey.set(key, row);
    }
  }
  const closing = Array.from(closingByKey.values());
  const dates = inPeriodRows.map(row => row.date?.getTime()).filter((value): value is number => typeof value === "number");
  return {
    rowsCount: inPeriodRows.length,
    excludedRows: rows.length - inPeriodRows.length,
    accountsCount: new Set(inPeriodRows.map(row => row.accountCode)).size,
    entitiesCount: new Set(inPeriodRows.map(row => row.entityCode || row.entityName).filter(value => value && value !== "0")).size,
    firstDate: dates.length ? new Date(Math.min(...dates)).toISOString().slice(0, 10) : null,
    lastDate: dates.length ? new Date(Math.max(...dates)).toISOString().slice(0, 10) : null,
    debitTotal: inPeriodRows.reduce((sum, row) => sum + row.debit, 0),
    creditTotal: inPeriodRows.reduce((sum, row) => sum + row.credit, 0),
    closingBalance: closing.reduce((sum, row) => sum + row.balance, 0),
    closing,
  };
}

/** Converte il partitario contabile standard a 21 colonne in saldi per controparte. */
export function parseStandardCounterpartyBalances(
  buffer: Buffer,
  kind: "customers" | "suppliers",
  engagementYear: number,
) {
  const ledger = parseLedger(buffer, kind, engagementYear);
  const grouped = new Map<string, { codice: string; ragioneSociale: string; saldoPartita: number }>();
  for (const row of ledger.closing) {
    const codice = row.entityCode && row.entityCode !== "0" ? row.entityCode : "";
    const key = codice || row.entityName.toLocaleLowerCase("it-IT").trim();
    if (!key) continue;
    const current = grouped.get(key);
    if (current) current.saldoPartita += row.balance;
    else grouped.set(key, {
      codice,
      ragioneSociale: row.entityName || `Controparte ${codice}`,
      saldoPartita: row.balance,
    });
  }
  return Array.from(grouped.values())
    .map(row => ({ ...row, saldoPartita: round2(row.saldoPartita), estero: false }))
    .filter(row => Math.abs(row.saldoPartita) > 0.01)
    .sort((a, b) => Math.abs(b.saldoPartita) - Math.abs(a.saldoPartita));
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const outcome = (difference: number, tolerance = 0.05) => Math.abs(difference) <= tolerance ? "quadrato" : "differenza";
const rowKey = (row: LedgerRow) => `${row.accountCode}::${row.entityCode && row.entityCode !== "0" ? row.entityCode : row.entityName}`;

function comparisonExceptions(source: LedgerRow[], target: LedgerRow[], accountPrefix: RegExp) {
  const sourceMap = new Map(source.filter(row => accountPrefix.test(row.accountCode)).map(row => [rowKey(row), row]));
  const targetMap = new Map(target.filter(row => accountPrefix.test(row.accountCode)).map(row => [rowKey(row), row]));
  const keys = new Set([...Array.from(sourceMap.keys()), ...Array.from(targetMap.keys())]);
  return Array.from(keys).map(key => {
    const sourceRow = sourceMap.get(key);
    const targetRow = targetMap.get(key);
    const difference = round2((sourceRow?.balance ?? 0) - (targetRow?.balance ?? 0));
    return {
      key,
      accountCode: sourceRow?.accountCode ?? targetRow?.accountCode,
      entityCode: sourceRow?.entityCode ?? targetRow?.entityCode,
      entityName: sourceRow?.entityName ?? targetRow?.entityName,
      sourceBalance: round2(sourceRow?.balance ?? 0),
      targetBalance: round2(targetRow?.balance ?? 0),
      difference,
      sourceRow: sourceRow?.rowNumber ?? null,
      targetRow: targetRow?.rowNumber ?? null,
    };
  }).filter(item => Math.abs(item.difference) > 0.05)
    .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference))
    .slice(0, 25);
}

const AREA_RULES: Record<string, { documentRoles: string[]; standards: string[]; procedures: Array<{ title: string; mode: "automatico" | "assistito" | "manuale" }> }> = {
  ricavi: { documentRoles: ["bilancioXbrl", "bilancioAnalitico", "partitarioGenerale", "clienti", "estrattiContoSuccessivi"], standards: ["ISA Italia 240", "ISA Italia 315", "ISA Italia 330", "ISA Italia 520", "OIC 12"], procedures: [{ title: "Analisi trend, mensilità e contropartite", mode: "automatico" }, { title: "Cut-off fatture a cavallo d'anno", mode: "assistito" }, { title: "Incassi successivi e note di credito", mode: "automatico" }, { title: "Test documentale sul campione", mode: "manuale" }] },
  creditiTotali: { documentRoles: ["bilancioXbrl", "notaIntegrativa", "clienti", "estrattiContoSuccessivi"], standards: ["ISA Italia 505", "ISA Italia 530", "OIC 15"], procedures: [{ title: "Quadratura saldi clienti", mode: "automatico" }, { title: "Aging, concentrazione e saldi anomali", mode: "automatico" }, { title: "Incassi successivi", mode: "automatico" }, { title: "Circolarizzazioni e procedure alternative", mode: "assistito" }, { title: "Valutazione fondo svalutazione", mode: "manuale" }] },
  debitiTotali: { documentRoles: ["bilancioXbrl", "notaIntegrativa", "fornitori", "partitarioGenerale", "estrattiContoSuccessivi"], standards: ["ISA Italia 505", "ISA Italia 530", "OIC 19"], procedures: [{ title: "Quadratura saldi fornitori", mode: "automatico" }, { title: "Pagamenti successivi", mode: "automatico" }, { title: "Ricerca passività non registrate", mode: "assistito" }, { title: "Circolarizzazioni fornitori", mode: "assistito" }] },
  acquisti: { documentRoles: ["bilancioAnalitico", "partitarioGenerale", "fornitori", "estrattiContoSuccessivi"], standards: ["ISA Italia 330", "ISA Italia 500", "OIC 12"], procedures: [{ title: "Analisi mensile e per fornitore", mode: "automatico" }, { title: "Cut-off acquisti", mode: "assistito" }, { title: "Pagamenti successivi", mode: "automatico" }, { title: "Test documentale sul campione", mode: "manuale" }] },
  rimanenze: { documentRoles: ["bilancioXbrl", "notaIntegrativa", "partitarioGenerale"], standards: ["ISA Italia 501", "ISA Italia 530", "OIC 13"], procedures: [{ title: "Quadratura contabilità-inventario", mode: "automatico" }, { title: "Analisi variazioni e rotazione", mode: "automatico" }, { title: "Presenza all'inventario fisico", mode: "manuale" }, { title: "Test costo e valore di realizzo", mode: "assistito" }] },
  variazioneRimanenze: { documentRoles: ["bilancioXbrl", "partitarioGenerale"], standards: ["ISA Italia 520", "OIC 12", "OIC 13"], procedures: [{ title: "Coerenza con rimanenze iniziali e finali", mode: "automatico" }, { title: "Analisi variazione anomala", mode: "automatico" }, { title: "Riconciliazione con inventario", mode: "assistito" }] },
  immobilizzazioni: { documentRoles: ["bilancioXbrl", "notaIntegrativa", "partitarioGenerale"], standards: ["ISA Italia 500", "ISA Italia 530", "OIC 16", "OIC 24"], procedures: [{ title: "Roll-forward costo e fondi", mode: "automatico" }, { title: "Selezione incrementi e dismissioni", mode: "automatico" }, { title: "Verifica documenti e ammortamenti", mode: "assistito" }, { title: "Indicatori di perdita durevole", mode: "manuale" }] },
  disponibilitaLiquide: { documentRoles: ["bilancioXbrl", "partitarioGenerale", "estrattiContoSuccessivi"], standards: ["ISA Italia 505", "ISA Italia 500", "OIC 14"], procedures: [{ title: "Quadratura saldi contabili", mode: "automatico" }, { title: "Riconciliazioni bancarie", mode: "assistito" }, { title: "Conferme esterne", mode: "manuale" }, { title: "Cut-off e movimenti successivi", mode: "automatico" }] },
  patrimonioNetto: { documentRoles: ["bilancioXbrl", "notaIntegrativa", "partitarioGenerale"], standards: ["ISA Italia 500", "OIC 28"], procedures: [{ title: "Raccordo risultato e patrimonio netto", mode: "automatico" }, { title: "Movimenti delle riserve", mode: "automatico" }, { title: "Verifica verbali e destinazione utile", mode: "manuale" }] },
  ammortamenti: { documentRoles: ["bilancioXbrl", "notaIntegrativa", "partitarioGenerale"], standards: ["ISA Italia 540", "OIC 16", "OIC 24"], procedures: [{ title: "Confronto storico e con immobilizzazioni", mode: "automatico" }, { title: "Ricalcolo aliquote sul campione", mode: "assistito" }, { title: "Valutazione vite utili", mode: "manuale" }] },
  imposte: { documentRoles: ["bilancioXbrl", "notaIntegrativa", "partitarioGenerale"], standards: ["ISA Italia 540", "OIC 25"], procedures: [{ title: "Riconciliazione aliquota teorica-effettiva", mode: "automatico" }, { title: "Quadratura debiti e crediti tributari", mode: "automatico" }, { title: "Verifica dichiarazioni e calcolo imposte", mode: "assistito" }] },
};

function buildCoherenceAndPriorities(xbrl: Record<string, any>, engagementYear: number, documents: Record<string, StandardSource[]>) {
  const current = (xbrl.comparativo?.[String(engagementYear)] ?? xbrl) as Record<string, any>;
  const previous = (xbrl.comparativo?.[String(engagementYear - 1)] ?? xbrl.annoPrecedente ?? {}) as Record<string, any>;
  const previousPrevious = (xbrl.comparativo?.[String(engagementYear - 2)] ?? {}) as Record<string, any>;
  const revenue = numberValue(current.ricavi ?? current.valoreProduzione);
  const productionValue = numberValue(current.valoreProduzione) || revenue;
  const totalAssets = numberValue(current.totaleAttivo);
  const profitBeforeTax = numberValue(current.risultatoPrimaImposte);
  const materiality = round2(revenue * 0.01);
  const operatingMateriality = round2(materiality * 0.75);
  const trivialThreshold = round2(materiality * 0.05);
  const definitions = [
    ["immobilizzazioni", "Immobilizzazioni", "SP", "esistenza, valutazione, diritti e obblighi"],
    ["rimanenze", "Rimanenze", "SP", "esistenza, completezza, valutazione"],
    ["creditiTotali", "Crediti", "SP", "esistenza, valutazione, competenza", null],
    ["creditiClienti", "Crediti verso clienti", "SP", "esistenza, valutazione, competenza", "creditiTotali"],
    ["disponibilitaLiquide", "Disponibilità liquide", "SP", "esistenza, completezza, diritti"],
    ["rateiRiscontiAttivo", "Ratei e risconti attivi", "SP", "competenza, valutazione"],
    ["patrimonioNetto", "Patrimonio netto", "SP", "completezza, classificazione"],
    ["tfr", "TFR", "SP", "completezza, valutazione"],
    ["debitiTotali", "Debiti", "SP", "completezza, competenza, classificazione", null],
    ["debitiBancariTotale", "Debiti verso banche", "SP", "completezza, classificazione, valutazione", "debitiTotali"],
    ["rateiRiscontiPassivo", "Ratei e risconti passivi", "SP", "completezza, competenza"],
    ["ricavi", "Ricavi delle vendite", "CE", "manifestazione, completezza, competenza"],
    ["altriRicavi", "Altri ricavi", "CE", "manifestazione, classificazione"],
    ["acquisti", "Acquisti", "CE", "completezza, competenza, accuratezza"],
    ["servizi", "Costi per servizi", "CE", "completezza, competenza"],
    ["godimentoBeniTerzi", "Godimento beni di terzi", "CE", "completezza, competenza"],
    ["costiPersonale", "Costo del personale", "CE", "completezza, accuratezza"],
    ["ammortamenti", "Ammortamenti e svalutazioni", "CE", "valutazione, accuratezza"],
    ["variazioneRimanenze", "Variazione rimanenze", "CE", "esistenza, valutazione, competenza"],
    ["oneriDiversiGestione", "Oneri diversi di gestione", "CE", "completezza, classificazione"],
    ["oneriFinanziari", "Oneri finanziari", "CE", "completezza, accuratezza"],
    ["imposte", "Imposte sul reddito", "CE", "completezza, valutazione"],
  ] as ReadonlyArray<readonly [string, string, "SP" | "CE", string, string?]>;
  const inherentRisk = new Set(["rimanenze", "creditiTotali", "ricavi", "variazioneRimanenze", "imposte"]);
  const areas = definitions.map(([key, label, statement, assertions, parentKey]) => {
    const value = numberValue(current[key]);
    const previousValue = numberValue(previous[key]);
    const previousPreviousValue = numberValue(previousPrevious[key]);
    if (value === 0 && previousValue === 0 && previousPreviousValue === 0) return null;
    const delta = round2(value - previousValue);
    const deltaPercent = previousValue !== 0 ? round2((delta / Math.abs(previousValue)) * 100) : null;
    const base = statement === "SP" ? totalAssets : productionValue;
    const incidencePercent = base ? round2((Math.abs(value) / Math.abs(base)) * 100) : null;
    const valueMultiple = materiality ? Math.abs(value) / materiality : 0;
    const deltaMultiple = materiality ? Math.abs(delta) / materiality : 0;
    const score = Math.round(
      Math.min(50, valueMultiple * 4) + Math.min(25, deltaMultiple * 5) +
      (deltaPercent != null && Math.abs(deltaPercent) >= 25 ? 15 : 0) +
      (inherentRisk.has(key) ? 10 : 0)
    );
    const priority = score >= 65 ? "molto_alta" : score >= 40 ? "alta" : score >= 20 ? "media" : "bassa";
    const reasons = [
      Math.abs(value) >= materiality ? "saldo superiore alla significatività" : null,
      Math.abs(delta) >= materiality ? "variazione assoluta significativa" : null,
      deltaPercent != null && Math.abs(deltaPercent) >= 25 ? `variazione ${deltaPercent}%` : null,
      inherentRisk.has(key) ? "natura intrinsecamente sensibile" : null,
    ].filter(Boolean);
    const rule = AREA_RULES[key] ?? { documentRoles: ["bilancioXbrl", "bilancioAnalitico", "partitarioGenerale"], standards: ["ISA Italia 315", "ISA Italia 330", "ISA Italia 500"], procedures: [{ title: "Analisi comparativa e di coerenza", mode: "automatico" as const }, { title: "Verifica documentale sul campione", mode: "manuale" as const }] };
    const missingDocumentRoles = rule.documentRoles.filter(role => !(documents[role]?.length));
    return { key, label, statement, parentKey, isSubaccount: Boolean(parentKey), value: round2(value), previousValue: round2(previousValue), previousPreviousValue: round2(previousPreviousValue), delta, deltaPercent, incidencePercent, benchmarkValue: round2(base), benchmarkLabel: statement === "SP" ? "Totale attivo" : "Valore della produzione", score, priority, assertions, reasons,
      controlPlan: { ...rule, executedProcedures: rule.procedures.filter(item => item.mode === "automatico"), suggestedProcedures: rule.procedures.filter(item => item.mode !== "automatico"), missingDocumentRoles, status: missingDocumentRoles.length ? "documenti_mancanti" : "predisposto" } };
  }).filter(Boolean).sort((a, b) => (b!.score - a!.score)) as Array<Record<string, any>>;
  return {
    years: [engagementYear - 2, engagementYear - 1, engagementYear],
    benchmarks: { SP: { label: "Totale attivo", value: round2(totalAssets) }, CE: { label: "Valore della produzione", value: round2(productionValue) } },
    materialityProposal: {
      benchmark: "ricavi",
      benchmarkValue: round2(revenue),
      ratePercent: 1,
      materiality,
      operatingMateriality,
      trivialThreshold,
      rationale: "Ricavi scelti come benchmark preliminare perché più stabili del risultato ante imposte; proposta soggetta a conferma del revisore.",
      profitBeforeTax: round2(profitBeforeTax),
    },
    areas,
    anomalies: areas.filter(area => area.deltaPercent != null && Math.abs(area.deltaPercent) >= 25),
  };
}

function buildCounterpartyRanking(rows: LedgerRow[], kind: "customers" | "suppliers", operatingMateriality: number, trivialThreshold: number) {
  const grouped = new Map<string, LedgerRow>();
  for (const row of rows.filter(row => row.entityCode && row.entityCode !== "0")) {
    const existing = grouped.get(row.entityCode);
    if (existing) {
      existing.balance += row.balance;
      existing.accountCode = `${existing.accountCode}, ${row.accountCode}`;
    } else {
      grouped.set(row.entityCode, { ...row });
    }
  }
  const relevant = Array.from(grouped.values());
  const exposure = (row: LedgerRow) => kind === "customers" ? Math.max(row.balance, 0) : Math.max(-row.balance, 0);
  const isContra = (row: LedgerRow) => kind === "customers" ? row.balance < 0 : row.balance > 0;
  const totalExposure = relevant.reduce((sum, row) => sum + exposure(row), 0);
  let cumulative = 0;
  const ranked = relevant.slice().sort((a, b) => exposure(b) - exposure(a)).map((row, index) => {
    const amount = exposure(row);
    const incidencePercent = totalExposure ? round2(amount / totalExposure * 100) : 0;
    const previousCumulativePercent = totalExposure ? cumulative / totalExposure * 100 : 0;
    cumulative += amount;
    const cumulativePercent = totalExposure ? round2(cumulative / totalExposure * 100) : 0;
    const contraSign = isContra(row);
    const contributesToCoverage = previousCumulativePercent < 80 && amount > 0;
    const reasons = [
      amount >= operatingMateriality ? "supera la significatività operativa" : null,
      contributesToCoverage ? "contribuisce alla copertura dell'80%" : null,
      contraSign ? "saldo di segno anomalo" : null,
      Math.abs(row.balance) >= trivialThreshold && amount < operatingMateriality ? "supera la soglia trascurabile" : null,
    ].filter(Boolean);
    return {
      rank: index + 1,
      accountCode: row.accountCode,
      entityCode: row.entityCode,
      entityName: row.entityName || `Controparte ${row.entityCode}`,
      balance: round2(row.balance),
      exposure: round2(amount),
      incidencePercent,
      cumulativePercent,
      contraSign,
      preliminaryPriority: amount >= operatingMateriality || contributesToCoverage || contraSign,
      reasons,
      sourceRow: row.rowNumber,
    };
  });
  return {
    totalExposure: round2(totalExposure),
    totalCounterparties: relevant.length,
    priorityCounterparties: ranked.filter(row => row.preliminaryPriority).length,
    ranked,
  };
}

export async function runStandardReconciliation(args: {
  engagementYear: number;
  documents: Record<string, StandardSource[]>;
  download: (path: string) => Promise<Buffer>;
}) {
  const primary = (role: string) => args.documents[role]?.[0] ?? null;
  const sources = {
    xbrl: primary("bilancioXbrl"), general: primary("partitarioGenerale"),
    customers: primary("clienti"), suppliers: primary("fornitori"),
  };
  const missing = Object.entries(sources).filter(([, source]) => !source).map(([role]) => role);
  if (missing.length) return { available: false as const, missing };

  const [xbrlBuffer, generalBuffer, customersBuffer, suppliersBuffer] = await Promise.all([
    args.download(sources.xbrl!.path), args.download(sources.general!.path),
    args.download(sources.customers!.path), args.download(sources.suppliers!.path),
  ]);
  const xbrl = parseXbrlBilancio(xbrlBuffer) as Record<string, any>;
  const coherence = buildCoherenceAndPriorities(xbrl, args.engagementYear, args.documents);
  const general = parseLedger(generalBuffer, "general", args.engagementYear);
  const customers = parseLedger(customersBuffer, "customers", args.engagementYear);
  const suppliers = parseLedger(suppliersBuffer, "suppliers", args.engagementYear);

  const generalCustomers = general.closing.filter(row => /^23\./.test(row.accountCode)).reduce((sum, row) => sum + row.balance, 0);
  const generalSuppliers = general.closing.filter(row => /^57\./.test(row.accountCode)).reduce((sum, row) => sum + row.balance, 0);
  const customerDifference = round2(customers.closingBalance - generalCustomers);
  const supplierDifference = round2(suppliers.closingBalance - generalSuppliers);
  const ledgerMovementDifference = round2(general.debitTotal - general.creditTotal);
  const customerExceptions = comparisonExceptions(customers.closing, general.closing, /^23\./);
  const supplierExceptions = comparisonExceptions(suppliers.closing, general.closing, /^57\./);
  const fragmentedAreas = {
    customers: buildCounterpartyRanking(customers.closing, "customers", coherence.materialityProposal.operatingMateriality, coherence.materialityProposal.trivialThreshold),
    suppliers: buildCounterpartyRanking(suppliers.closing, "suppliers", coherence.materialityProposal.operatingMateriality, coherence.materialityProposal.trivialThreshold),
  };

  const checks = [
    { id: "clienti_partitario", title: "Clienti vs partitario generale", sourceValue: round2(customers.closingBalance), targetValue: round2(generalCustomers), difference: customerDifference, status: outcome(customerDifference), criterion: "Somma degli ultimi saldi per cliente confrontata con i conti 23.*", exceptions: customerExceptions },
    { id: "fornitori_partitario", title: "Fornitori vs partitario generale", sourceValue: round2(suppliers.closingBalance), targetValue: round2(generalSuppliers), difference: supplierDifference, status: outcome(supplierDifference), criterion: "Somma degli ultimi saldi per fornitore confrontata con i conti 57.*", exceptions: supplierExceptions },
    { id: "dare_avere", title: "Movimenti Dare/Avere del partitario generale", sourceValue: round2(general.debitTotal), targetValue: round2(general.creditTotal), difference: ledgerMovementDifference, status: outcome(ledgerMovementDifference), criterion: "Totale Dare meno totale Avere" },
    { id: "periodo", title: "Copertura temporale del partitario", sourceValue: general.firstDate, targetValue: `${args.engagementYear}-01-01 / ${args.engagementYear}-12-31`, difference: null, status: general.firstDate === `${args.engagementYear}-01-01` && general.lastDate === `${args.engagementYear}-12-31` ? "quadrato" : "da_verificare", criterion: "Prima e ultima data contabile dell'esercizio" },
  ];

  const hash = (buffer: Buffer) => `sha256:${crypto.createHash("sha256").update(buffer).digest("hex")}`;
  return {
    available: true as const,
    generatedAt: new Date().toISOString(),
    engineVersion: "standard-reconciliation-1.0",
    xbrl: { anno: xbrl.anno, ricavi: xbrl.ricavi, totaleAttivo: xbrl.totaleAttivo, patrimonioNetto: xbrl.patrimonioNetto, utile: xbrl.utile, debitiTotali: xbrl.debitiTotali, disponibilitaLiquide: xbrl.disponibilitaLiquide },
    coherence,
    fragmentedAreas,
    populations: {
      general: { rows: general.rowsCount, excludedRows: general.excludedRows, accounts: general.accountsCount, firstDate: general.firstDate, lastDate: general.lastDate },
      customers: { rows: customers.rowsCount, entities: customers.entitiesCount, closingBalance: round2(customers.closingBalance) },
      suppliers: { rows: suppliers.rowsCount, entities: suppliers.entitiesCount, closingBalance: round2(suppliers.closingBalance) },
    },
    checks,
    sources: [
      { role: "bilancioXbrl", ...sources.xbrl!, hash: hash(xbrlBuffer) },
      { role: "partitarioGenerale", ...sources.general!, hash: hash(generalBuffer) },
      { role: "clienti", ...sources.customers!, hash: hash(customersBuffer) },
      { role: "fornitori", ...sources.suppliers!, hash: hash(suppliersBuffer) },
    ],
  };
}
