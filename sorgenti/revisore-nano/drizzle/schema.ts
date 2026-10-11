import {
  int,
  mysqlEnum,
  mysqlTable,
  mediumtext,
  text,
  timestamp,
  varchar,
  decimal,
  boolean,
  json,
  date,
} from "drizzle-orm/mysql-core";

// ─── USERS ────────────────────────────────────────────────────────────────────
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── CLIENTI ──────────────────────────────────────────────────────────────────
export const clienti = mysqlTable("clienti", {
  id: int("id").autoincrement().primaryKey(),
  studioClientId: varchar("studioClientId", { length: 36 }).unique(),
  userId: int("userId").notNull(),
  ragioneSociale: varchar("ragioneSociale", { length: 255 }).notNull(),
  codiceFiscale: varchar("codiceFiscale", { length: 16 }),
  partitaIva: varchar("partitaIva", { length: 11 }),
  formaGiuridica: mysqlEnum("formaGiuridica", [
    "srl",
    "srl_unipersonale",
    "snc",
    "sas",
    "spa",
    "ditta_individuale",
    "altro",
  ]).default("srl"),
  settore: varchar("settore", { length: 100 }),
  comune: varchar("comune", { length: 100 }),
  provincia: varchar("provincia", { length: 2 }),
  note: text("note"),
  nextcloudFolder: varchar("nextcloudFolder", { length: 1000 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Cliente = typeof clienti.$inferSelect;
export type InsertCliente = typeof clienti.$inferInsert;

// ─── INCARICHI ────────────────────────────────────────────────────────────────
export const incarichi = mysqlTable("incarichi", {
  id: int("id").autoincrement().primaryKey(),
  studioDossierId: varchar("studioDossierId", { length: 36 }).unique(),
  nextcloudFolder: varchar("nextcloudFolder", { length: 1000 }),
  clienteId: int("clienteId").notNull(),
  userId: int("userId").notNull(),
  annoEsercizio: int("annoEsercizio").notNull(),
  tipoIncarico: mysqlEnum("tipoIncarico", [
    "revisione_legale",
    "revisione_volontaria",
    "continuazione",
  ]).default("revisione_legale"),
  stato: mysqlEnum("stato", [
    "bozza",
    "in_corso",
    "completato",
    "archiviato",
  ]).default("bozza"),
  // Fase corrente dell'incarico
  faseCorrente: mysqlEnum("faseCorrente", ["accettazione", "revisione"]).default("accettazione"),
  // Stato avanzamento moduli (0=non iniziato, 1=in corso, 2=completato)
  statoModulo1: int("statoModulo1").default(0),
  statoModulo2: int("statoModulo2").default(0),
  statoModulo3: int("statoModulo3").default(0),
  statoModulo4: int("statoModulo4").default(0),
  statoModulo5: int("statoModulo5").default(0),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Incarico = typeof incarichi.$inferSelect;
export type InsertIncarico = typeof incarichi.$inferInsert;

// ─── DOCUMENTI ────────────────────────────────────────────────────────────────
export const documenti = mysqlTable("documenti", {
  id: int("id").autoincrement().primaryKey(),
  studioSourceId: varchar("studioSourceId", { length: 36 }).unique(),
  incaricoId: int("incaricoId").notNull(),
  nomeFile: varchar("nomeFile", { length: 255 }).notNull(),
  tipoFile: mysqlEnum("tipoFile", ["pdf", "xml", "xbrl", "xlsx", "csv", "altro"]).notNull(),
  tipoDocumento: mysqlEnum("tipoDocumento", [
    "bilancio_revisione",   // bilancio CEE oggetto di revisione (anno corrente)
    "bilancio_storico",    // bilanci CEE anni precedenti per comparativa
    "bilancio_analitico",  // bilancio di verifica / mastro analitico con saldi conti esplosi
    "bilancio",            // generico (retrocompatibilità)
    "nota_integrativa",
    "verbale_assemblea",
    "contratto",
    "estratto_conto",
    "libro_mastro",
    "partitario",
    "altro",
  ]).default("altro"),
  annoRiferimento: int("annoRiferimento"),  // anno di riferimento del bilancio (es. 2023, 2022)
  s3Key: varchar("s3Key", { length: 500 }).notNull(),
  s3Url: text("s3Url").notNull(),
  dimensioneBytes: int("dimensioneBytes"),
  contentHash: varchar("contentHash", { length: 71 }),
  sourceEtag: varchar("sourceEtag", { length: 255 }),
  classification: mysqlEnum("classification", ["internal", "confidential", "restricted"]).default("restricted"),
  statoParsing: mysqlEnum("statoParsing", [
    "in_attesa",
    "in_corso",
    "completato",
    "errore",
  ]).default("in_attesa"),
  testoEstrattoChunks: json("testoEstrattoChunks"), // array di chunk per RAG
  datiStrutturati: json("datiStrutturati"), // dati bilancio estratti
  erroreParser: text("erroreParser"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Documento = typeof documenti.$inferSelect;
export type InsertDocumento = typeof documenti.$inferInsert;

// Studio Core v1: registri additivi condivisi. Gli ID numerici storici restano invariati.
export const studioJobs = mysqlTable("studio_jobs", {
  jobId: varchar("jobId", { length: 36 }).primaryKey(),
  correlationId: varchar("correlationId", { length: 36 }).notNull(),
  incaricoId: int("incaricoId").notNull(),
  appId: varchar("appId", { length: 64 }).notNull(),
  jobType: varchar("jobType", { length: 80 }).notNull(),
  state: mysqlEnum("state", ["queued", "processing", "ready", "partial", "failed", "stale"]).default("queued").notNull(),
  parameters: json("parameters"),
  metrics: json("metrics"),
  errorCode: varchar("errorCode", { length: 100 }),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const studioEvidence = mysqlTable("studio_evidence", {
  evidenceId: varchar("evidenceId", { length: 36 }).primaryKey(),
  jobId: varchar("jobId", { length: 36 }),
  incaricoId: int("incaricoId").notNull(),
  documentoId: int("documentoId"),
  kind: varchar("kind", { length: 80 }).notNull(),
  statement: text("statement").notNull(),
  sourceReference: json("sourceReference").notNull(),
  confidence: decimal("confidence", { precision: 5, scale: 4 }),
  status: mysqlEnum("status", ["extracted", "verified", "rejected"]).default("extracted").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const studioResults = mysqlTable("studio_results", {
  resultId: varchar("resultId", { length: 36 }).primaryKey(),
  jobId: varchar("jobId", { length: 36 }),
  incaricoId: int("incaricoId").notNull(),
  resultType: varchar("resultType", { length: 80 }).notNull(),
  status: mysqlEnum("status", ["draft", "completed", "approved", "rejected"]).default("draft").notNull(),
  payload: json("payload"),
  provenance: json("provenance").notNull(),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const studioAuditEvents = mysqlTable("studio_audit_events", {
  eventId: varchar("eventId", { length: 36 }).primaryKey(),
  correlationId: varchar("correlationId", { length: 36 }).notNull(),
  actorUserId: int("actorUserId").notNull(),
  appId: varchar("appId", { length: 64 }).notNull(),
  eventType: varchar("eventType", { length: 100 }).notNull(),
  outcome: mysqlEnum("outcome", ["started", "success", "failure", "denied"]).notNull(),
  targetType: varchar("targetType", { length: 80 }).notNull(),
  targetId: varchar("targetId", { length: 100 }).notNull(),
  metrics: json("metrics"),
  reasonCode: varchar("reasonCode", { length: 100 }),
  privacyClass: mysqlEnum("privacyClass", ["internal", "confidential", "restricted"]).default("restricted").notNull(),
  occurredAt: timestamp("occurredAt").defaultNow().notNull(),
});

// ─── MODULO 1: ACCETTAZIONE INCARICO ─────────────────────────────────────────
export const moduloAccettazione = mysqlTable("modulo_accettazione", {
  id: int("id").autoincrement().primaryKey(),
  incaricoId: int("incaricoId").notNull().unique(),
  // Checklist ISA Italia 210/220
  indipendenzaVerificata: boolean("indipendenzaVerificata").default(false),
  competenzaVerificata: boolean("competenzaVerificata").default(false),
  integritaManagementVerificata: boolean("integritaManagementVerificata").default(false),
  rischioIncaricoPrecedente: boolean("rischioIncaricoPrecedente").default(false),
  conflittiInteresseVerificati: boolean("conflittiInteresseVerificati").default(false),
  onorarioDefinito: boolean("onorarioDefinito").default(false),
  letteraIncaricoFirmata: boolean("letteraIncaricoFirmata").default(false),
  // Risultato analisi AI
  analisiAi: text("analisiAi"),
  flagRischiAi: json("flagRischiAi"), // array di rischi identificati dall'AI
  // Esito
  esito: mysqlEnum("esito", ["accettato", "rifiutato", "sospeso", "in_valutazione"]).default("in_valutazione"),
  motivazioneEsito: text("motivazioneEsito"),
  completato: boolean("completato").default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ModuloAccettazione = typeof moduloAccettazione.$inferSelect;
export type InsertModuloAccettazione = typeof moduloAccettazione.$inferInsert;

// ─── MODULO 2: COMPRENSIONE IMPRESA ──────────────────────────────────────────
export const moduloComprensione = mysqlTable("modulo_comprensione", {
  id: int("id").autoincrement().primaryKey(),
  incaricoId: int("incaricoId").notNull().unique(),
  // Dati bilancio estratti
  totaleAttivo: decimal("totaleAttivo", { precision: 15, scale: 2 }),
  ricaviNetti: decimal("ricaviNetti", { precision: 15, scale: 2 }),
  patrimonioNetto: decimal("patrimonioNetto", { precision: 15, scale: 2 }),
  utilePerditaEsercizio: decimal("utilePerditaEsercizio", { precision: 15, scale: 2 }),
  numeroDipendenti: int("numeroDipendenti"),
  debitiTotali: decimal("debitiTotali", { precision: 15, scale: 2 }),
  creditiTotali: decimal("creditiTotali", { precision: 15, scale: 2 }),
  disponibilitaLiquide: decimal("disponibilitaLiquide", { precision: 15, scale: 2 }),
  // Verifica nano impresa
  isNanoImpresa: boolean("isNanoImpresa"),
  motivazioneNano: text("motivazioneNano"),
  // Indici di bilancio calcolati
  indici: json("indici"), // { liquidita, solidita, redditivita, ... }
  // Contesto impresa
  sintesiAi: text("sintesiAi"),
  settoreAttivita: varchar("settoreAttivita", { length: 100 }),
  principaliRischiSettore: json("principaliRischiSettore"),
  altriDatiRilevanti: json("altriDatiRilevanti"),
  completato: boolean("completato").default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ModuloComprensione = typeof moduloComprensione.$inferSelect;
export type InsertModuloComprensione = typeof moduloComprensione.$inferInsert;

// ─── MODULO 3: VALUTAZIONE RISCHIO ───────────────────────────────────────────
export const moduloRischio = mysqlTable("modulo_rischio", {
  id: int("id").autoincrement().primaryKey(),
  incaricoId: int("incaricoId").notNull().unique(),
  // Rischio inerente (1=basso, 2=medio, 3=alto)
  rischioInerentePunteggio: int("rischioInerentePunteggio"),
  rischioInerenteNote: text("rischioInerenteNote"),
  // Rischio di controllo (1=basso, 2=medio, 3=alto)
  rischioControlloPunteggio: int("rischioControlloPunteggio"),
  rischioControlloNote: text("rischioControlloNote"),
  // Rischio di individuazione (calcolato: basso se RI+RC alti)
  rischioIndividuazionePunteggio: int("rischioIndividuazionePunteggio"),
  // Rischio di errore significativo (RMM = RI × RC)
  rmmPunteggio: int("rmmPunteggio"),
  // Aree di rischio specifiche
  areeRischio: json("areeRischio"), // array di { area, livello, descrizione }
  // Analisi AI
  analisiAiRischi: text("analisiAiRischi"),
  flagRischiCritici: json("flagRischiCritici"),
  // Going concern indicators
  indicatoriGoingConcern: json("indicatoriGoingConcern"),
  goingConcernRischio: boolean("goingConcernRischio").default(false),
  completato: boolean("completato").default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ModuloRischio = typeof moduloRischio.$inferSelect;
export type InsertModuloRischio = typeof moduloRischio.$inferInsert;

// ─── MODULO 4: MATERIALITÀ ────────────────────────────────────────────────────
export const moduloMaterialita = mysqlTable("modulo_materialita", {
  id: int("id").autoincrement().primaryKey(),
  incaricoId: int("incaricoId").notNull().unique(),
  // Benchmark selezionato
  benchmarkTipo: mysqlEnum("benchmarkTipo", [
    "ricavi_netti",
    "totale_attivo",
    "patrimonio_netto",
    "utile_ante_imposte",
    "costo_venduto",
  ]),
  benchmarkValore: decimal("benchmarkValore", { precision: 15, scale: 2 }),
  benchmarkPercentuale: decimal("benchmarkPercentuale", { precision: 5, scale: 2 }),
  motivazioneBenchmark: text("motivazioneBenchmark"),
  // Materialità calcolata (ISA Italia 320)
  overallMateriality: decimal("overallMateriality", { precision: 15, scale: 2 }),
  performanceMateriality: decimal("performanceMateriality", { precision: 15, scale: 2 }),
  pmFattoreRiduzione: decimal("pmFattoreRiduzione", { precision: 3, scale: 2 }),
  clearlyTrivialThreshold: decimal("clearlyTrivialThreshold", { precision: 15, scale: 2 }),
  // Fattori di riduzione PM
  primoIncarico: boolean("primoIncarico").default(false),
  erroriAnniPrecedenti: boolean("erroriAnniPrecedenti").default(false),
  controlliDeboli: boolean("controlliDeboli").default(false),
  // Materialità specifiche per voci particolari
  materialitaSpecifiche: json("materialitaSpecifiche"),
  completato: boolean("completato").default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ModuloMaterialita = typeof moduloMaterialita.$inferSelect;
export type InsertModuloMaterialita = typeof moduloMaterialita.$inferInsert;

// ─── MODULO 5: PIANO DI REVISIONE ────────────────────────────────────────────
export const moduloPiano = mysqlTable("modulo_piano", {
  id: int("id").autoincrement().primaryKey(),
  incaricoId: int("incaricoId").notNull().unique(),
  // Piano generato
  procedurePianificate: json("procedurePianificate"), // array di { area, procedure, priorita, responsabile }
  areeRevisione: json("areeRevisione"), // array di { area, livelloRischio, materialita }
  sintesiPianoAi: text("sintesiPianoAi"),
  // Tempistiche
  dataInizioRevisione: timestamp("dataInizioRevisione"),
  dataFineRevisione: timestamp("dataFineRevisione"),
  completato: boolean("completato").default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ModuloPiano = typeof moduloPiano.$inferSelect;
export type InsertModuloPiano = typeof moduloPiano.$inferInsert;

// ─── ALERT ────────────────────────────────────────────────────────────────────
export const alerts = mysqlTable("alerts", {
  id: int("id").autoincrement().primaryKey(),
  incaricoId: int("incaricoId").notNull(),
  modulo: mysqlEnum("modulo", ["accettazione", "comprensione", "rischio", "materialita", "piano", "sistema"]),
  tipoAlert: mysqlEnum("tipoAlert", [
    "rischio_elevato",
    "going_concern",
    "anomalia_bilancio",
    "variazione_anomala",
    "checklist_incompleta",
    "info",
  ]).notNull(),
  severita: mysqlEnum("severita", ["info", "warning", "critical"]).default("warning"),
  titolo: varchar("titolo", { length: 255 }).notNull(),
  messaggio: text("messaggio").notNull(),
  datiContesto: json("datiContesto"),
  letto: boolean("letto").default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Alert = typeof alerts.$inferSelect;
export type InsertAlert = typeof alerts.$inferInsert;

// ─── CIRCOLARIZZAZIONE SALDI (ISA Italia 505) ─────────────────────────────────
export const circolarizzazioneSessioni = mysqlTable("circolarizzazione_sessioni", {
  id: int("id").autoincrement().primaryKey(),
  incaricoId: int("incaricoId").notNull(),
  // Parametri sessione
  dataRiferimento: timestamp("dataRiferimento").notNull(), // data saldo da confermare
  emailRevisore: varchar("emailRevisore", { length: 320 }).notNull(), // risposte tornano al revisore
  tipoCircolarizzazione: mysqlEnum("tipoCircolarizzazione", ["clienti", "fornitori", "entrambi"]).default("entrambi"),
  // Parametri selezione campione
  livelloRischioModulo3: int("livelloRischioModulo3"), // 1=basso, 2=medio, 3=alto (da Modulo 3)
  percentualeCoperturaMinimaCalcolata: decimal("percentualeCoperturaMinimaCalcolata", { precision: 5, scale: 2 }), // % calcolata in base al rischio
  totaleCreditiClienti: decimal("totaleCreditiClienti", { precision: 15, scale: 2 }),
  totaleDebitiFornitori: decimal("totaleDebitiFornitori", { precision: 15, scale: 2 }),
  // Copertura effettiva raggiunta
  coperturaCampioneCl: decimal("coperturaCampioneCl", { precision: 5, scale: 2 }),
  coperturaCampioneFo: decimal("coperturaCampioneFo", { precision: 5, scale: 2 }),
  // Stato sessione
  stato: mysqlEnum("stato", ["bozza", "lettere_generate", "inviate", "follow_up", "chiusa"]).default("bozza"),
  noteRevisore: text("noteRevisore"),
  analisiAiSelezione: text("analisiAiSelezione"), // motivazione AI della selezione
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CircolarizzazioneSessione = typeof circolarizzazioneSessioni.$inferSelect;
export type InsertCircolarizzazioneSessione = typeof circolarizzazioneSessioni.$inferInsert;

export const circolarizzazioneDestinatari = mysqlTable("circolarizzazione_destinatari", {
  id: int("id").autoincrement().primaryKey(),
  sessioneId: int("sessioneId").notNull(),
  incaricoId: int("incaricoId").notNull(),
  // Dati nominativo
  codice: varchar("codice", { length: 20 }), // codice contabile (es. 00241)
  ragioneSociale: varchar("ragioneSociale", { length: 255 }).notNull(),
  tipo: mysqlEnum("tipo", ["cliente", "fornitore"]).notNull(),
  saldo: decimal("saldo", { precision: 15, scale: 2 }).notNull(),
  isEstero: boolean("isEstero").default(false),
  // Motivo selezione
  motivazioneSelezione: mysqlEnum("motivazioneSelezione", [
    "saldo_elevato_pareto",       // top 80% per valore
    "supera_materialita",         // saldo > Performance Materiality
    "estero",                     // cliente/fornitore estero
    "anomalia_ai",                // anomalia rilevata dall'AI
    "campione_casuale",           // selezione casuale per completare copertura
    "manuale_revisore",           // aggiunto manualmente dal revisore
  ]).notNull(),
  priorita: mysqlEnum("priorita", ["alta", "media", "bassa"]).default("media"),
  noteMotivazione: text("noteMotivazione"), // spiegazione AI o nota manuale
  // Inclusione nel campione (il revisore può escludere con motivazione)
  incluso: boolean("incluso").default(true),
  motivazioneEsclusione: text("motivazioneEsclusione"),
  // Stato lettera e follow-up
  statoLettera: mysqlEnum("statoLettera", [
    "da_generare",
    "generata",
    "inviata",
    "risposta_ricevuta",
    "risposta_discordante",
    "nessuna_risposta",
    "procedura_alternativa",
  ]).default("da_generare"),
  dataInvio: timestamp("dataInvio"),
  dataRisposta: timestamp("dataRisposta"),
  saldoConfermato: decimal("saldoConfermato", { precision: 15, scale: 2 }), // saldo dichiarato dal terzo
  differenza: decimal("differenza", { precision: 15, scale: 2 }), // saldoConfermato - saldo
  noteFollowUp: text("noteFollowUp"),
  proceduraAlternativa: text("proceduraAlternativa"), // se nessuna risposta
  s3KeyLettera: varchar("s3KeyLettera", { length: 500 }), // chiave S3 del file Word generato
  s3UrlLettera: text("s3UrlLettera"),
  s3KeyRisposta: varchar("s3KeyRisposta", { length: 500 }),
  s3UrlRisposta: text("s3UrlRisposta"),
  nomeFileRisposta: varchar("nomeFileRisposta", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CircolarizzazioneDestinatario = typeof circolarizzazioneDestinatari.$inferSelect;
export type InsertCircolarizzazioneDestinatario = typeof circolarizzazioneDestinatari.$inferInsert;

// ─── VERIFICA INCASSI/PAGAMENTI SUCCESSIVI (ISA Italia 560) ──────────────────
export const verificaIncassiSessioni = mysqlTable("verifica_incassi_sessioni", {
  id: int("id").autoincrement().primaryKey(),
  incaricoId: int("incaricoId").notNull(),
  annoEsercizio: int("annoEsercizio").notNull(),        // anno di chiusura bilancio (es. 2024)
  trimestreVerifica: int("trimestreVerifica").default(1), // trimestre estratto conto (1=Q1 anno succ.)
  // Statistiche riepilogative
  totalePartiteClienti: int("totalePartiteClienti").default(0),
  totalePartiteFornitori: int("totalePartiteFornitori").default(0),
  partiteClienteIncassate: int("partiteClienteIncassate").default(0),
  partiteFornitoriPagate: int("partiteFornitoriPagate").default(0),
  importoClienteIncassato: decimal("importoClienteIncassato", { precision: 15, scale: 2 }),
  importoFornitorePagato: decimal("importoFornitorePagato", { precision: 15, scale: 2 }),
  percCoperturaCl: decimal("percCoperturaCl", { precision: 5, scale: 2 }),
  percCoperturaFo: decimal("percCoperturaFo", { precision: 5, scale: 2 }),
  stato: mysqlEnum("stato", ["in_elaborazione", "completata", "errore"]).default("in_elaborazione"),
  noteRevisore: text("noteRevisore"),
  // Movimenti bancari in formato JSON (per analisi pagamenti obbligatori)
  movimentiBancariJson: mediumtext("movimentiBancariJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type VerificaIncassiSessione = typeof verificaIncassiSessioni.$inferSelect;

export const verificaIncassiPartite = mysqlTable("verifica_incassi_partite", {
  id: int("id").autoincrement().primaryKey(),
  sessioneId: int("sessioneId").notNull(),
  // Dati partita dal partitario
  tipo: mysqlEnum("tipo", ["cliente", "fornitore"]).notNull(),
  codice: varchar("codice", { length: 30 }),
  ragioneSociale: varchar("ragioneSociale", { length: 255 }).notNull(),
  numeroFattura: varchar("numeroFattura", { length: 50 }),
  dataFattura: varchar("dataFattura", { length: 20 }),
  saldoPartita: decimal("saldoPartita", { precision: 15, scale: 2 }).notNull(),
  // Risultato matching con estratto conto
  statoMatching: mysqlEnum("statoMatching", [
    "non_verificata",
    "incassata_pagata",       // corrispondenza esatta trovata
    "parzialmente_coperta",   // corrispondenza parziale (es. acconto)
    "non_trovata",            // nessun movimento bancario corrispondente
  ]).default("non_verificata"),
  importoCoperto: decimal("importoCoperto", { precision: 15, scale: 2 }),   // importo trovato nell'estratto conto
  residuo: decimal("residuo", { precision: 15, scale: 2 }),                  // saldoPartita - importoCoperto
  dataMovimentoBancario: varchar("dataMovimentoBancario", { length: 20 }),
  descrizioneMovimento: text("descrizioneMovimento"),
  criterioMatching: varchar("criterioMatching", { length: 60 }),
  confidenzaMatching: decimal("confidenzaMatching", { precision: 4, scale: 3 }), // 0.0 - 1.0
  noteRevisore: text("noteRevisore"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type VerificaIncassiPartita = typeof verificaIncassiPartite.$inferSelect;

// ─── STRATEGIA DI REVISIONE (Fase Accettazione + Fase Revisione) ──────────────
export const strategiaRevisione = mysqlTable("strategia_revisione", {
  id: int("id").autoincrement().primaryKey(),
  incaricoId: int("incaricoId").notNull(),
  fase: mysqlEnum("fase", ["accettazione", "revisione"]).notNull(),
  // Analisi AI dei bilanci storici (fase accettazione) o del bilancio corrente (fase revisione)
  analisiTrendStorici: text("analisiTrendStorici"),         // sintesi trend pluriennale
  indicatoriRischio: json("indicatoriRischio"),             // array { indicatore, valore, semaforo, nota }
  areeRischioIdentificate: json("areeRischioIdentificate"), // array { area, livello, motivazione }
  // Piano strategico
  pianoStrategico: text("pianoStrategico"),                 // testo narrativo del piano
  prioritaControlli: json("prioritaControlli"),             // array { area, priorita, procedureSuggerite }
  // Confronto storico vs corrente (solo fase revisione)
  variazioniSignificative: json("variazioniSignificative"), // array { voce, valoreStorico, valoreCorrente, delta, segnalazione }
  noteRevisore: text("noteRevisore"),
  generataConAi: boolean("generataConAi").default(false),
  completata: boolean("completata").default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type StrategiaRevisione = typeof strategiaRevisione.$inferSelect;
export type InsertStrategiaRevisione = typeof strategiaRevisione.$inferInsert;

// ─── AREE DI CONTROLLO (Fase Revisione Effettiva) ────────────────────────────
export const areeControllo = mysqlTable("aree_controllo", {
  id: int("id").autoincrement().primaryKey(),
  incaricoId: int("incaricoId").notNull(),
  // Identificazione area
  area: mysqlEnum("area", [
    "crediti_clienti",          // ISA Italia 505 + verifica incassi
    "debiti_fornitori",         // ISA Italia 500 + verifica pagamenti
    "rimanenze",                // ISA Italia 501
    "immobilizzazioni_mat",     // ISA Italia 500/501
    "immobilizzazioni_immat",   // ISA Italia 500
    "disponibilita_liquide",    // ISA Italia 500/505
    "patrimonio_netto",         // ISA Italia 500
    "ricavi_costi",             // ISA Italia 240/315
    "debiti_tributari",         // ISA Italia 500
    "fondi_rischi",             // ISA Italia 500
    "parti_correlate",          // ISA Italia 550
    "continuita_aziendale",     // ISA Italia 570
  ]).notNull(),
  // Valori contabili dal bilancio corrente
  valoreBilancio: decimal("valoreBilancio", { precision: 15, scale: 2 }),
  valoreStorico: decimal("valoreStorico", { precision: 15, scale: 2 }),  // anno precedente
  deltaPercentuale: decimal("deltaPercentuale", { precision: 7, scale: 2 }),
  // Valutazione rischio
  livelloRischio: mysqlEnum("livelloRischio", ["basso", "medio", "alto", "critico"]).default("medio"),
  motivazioneRischio: text("motivazioneRischio"),
  // Procedure di controllo
  procedureSuggerite: json("procedureSuggerite"),  // array { procedura, isa, priorita, completata }
  // Stato
  stato: mysqlEnum("stato", ["da_iniziare", "in_corso", "completata", "non_applicabile"]).default("da_iniziare"),
  noteRevisore: text("noteRevisore"),
  evidenze: json("evidenze"),  // array { tipo, descrizione, riferimento }
  // Collegamento a moduli specifici
  sessioneCircolarizzazioneId: int("sessioneCircolarizzazioneId"),  // link a circolarizzazione
  sessioneVerificaIncassiId: int("sessioneVerificaIncassiId"),      // link a verifica incassi
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type AreaControllo = typeof areeControllo.$inferSelect;
export type InsertAreaControllo = typeof areeControllo.$inferInsert;

// ─── SCHEDA RIMANENZE (ISA Italia 501) ────────────────────────────────────────

export const schedaRimanenze = mysqlTable("scheda_rimanenze", {
  id: int("id").autoincrement().primaryKey(),
  incaricoId: int("incaricoId").notNull(),
  areaControlloId: int("areaControlloId"),
  // Dati generali
  metodoValorizzazione: mysqlEnum("metodoValorizzazione", ["lifo", "fifo", "cmp", "specifico", "altro"]),
  metodoValorizzazioneNote: text("metodoValorizzazioneNote"),
  // Conteggio fisico
  conteggioFisicoEseguito: boolean("conteggioFisicoEseguito").default(false),
  dataConteggio: date("dataConteggio"),
  noteConteggio: text("noteConteggio"),
  // Valori
  valoreContabile: decimal("valoreContabile", { precision: 15, scale: 2 }),
  valoreConteggio: decimal("valoreConteggio", { precision: 15, scale: 2 }),
  differenzaConteggio: decimal("differenzaConteggio", { precision: 15, scale: 2 }),
  // Obsolescenza
  percentualeObsolescenza: decimal("percentualeObsolescenza", { precision: 5, scale: 2 }),
  fondoObsolescenza: decimal("fondoObsolescenza", { precision: 15, scale: 2 }),
  noteObsolescenza: text("noteObsolescenza"),
  // Categorie rimanenze
  categorieRimanenze: json("categorieRimanenze"), // [{ categoria, valore, percObsolescenza, note }]
  // Checklist ISA 501
  checklistIsa: json("checklistIsa"), // [{ voce, completata, note }]
  // Conclusioni
  conclusioni: text("conclusioni"),
  rischioValutazione: mysqlEnum("rischioValutazione", ["basso", "medio", "alto", "critico"]).default("medio"),
  noteRevisore: text("noteRevisore"),
  stato: mysqlEnum("stato", ["da_iniziare", "in_corso", "completata"]).default("da_iniziare"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type SchedaRimanenze = typeof schedaRimanenze.$inferSelect;

// ─── SCHEDA IMMOBILIZZAZIONI (ISA Italia 500/501) ─────────────────────────────

export const schedaImmobilizzazioni = mysqlTable("scheda_immobilizzazioni", {
  id: int("id").autoincrement().primaryKey(),
  incaricoId: int("incaricoId").notNull(),
  areaControlloId: int("areaControlloId"),
  // Valori totali
  valoreImmobiliMat: decimal("valoreImmobiliMat", { precision: 15, scale: 2 }),
  valoreImmobiliImmat: decimal("valoreImmobiliImmat", { precision: 15, scale: 2 }),
  fondiAmmortamentoMat: decimal("fondiAmmortamentoMat", { precision: 15, scale: 2 }),
  fondiAmmortamentoImmat: decimal("fondiAmmortamentoImmat", { precision: 15, scale: 2 }),
  // Cespiti
  registroCespitiVerificato: boolean("registroCespitiVerificato").default(false),
  noteRegistroCespiti: text("noteRegistroCespiti"),
  // Ammortamenti
  aliquoteAmmortamento: json("aliquoteAmmortamento"), // [{ categoria, aliquota, note }]
  ammortamentiCalcolatiCorrettamente: boolean("ammortamentiCalcolatiCorrettamente"),
  noteAmmortamenti: text("noteAmmortamenti"),
  // Acquisizioni e dismissioni
  acquisizioni: decimal("acquisizioni", { precision: 15, scale: 2 }),
  dismissioni: decimal("dismissioni", { precision: 15, scale: 2 }),
  noteAcquisizioni: text("noteAcquisizioni"),
  noteDismissioni: text("noteDismissioni"),
  // Rivalutazioni e svalutazioni
  rivalutazioni: decimal("rivalutazioni", { precision: 15, scale: 2 }),
  svalutazioni: decimal("svalutazioni", { precision: 15, scale: 2 }),
  noteRivalutazioni: text("noteRivalutazioni"),
  // Leasing
  beniInLeasing: boolean("beniInLeasing").default(false),
  noteLeasingIFRS16: text("noteLeasingIFRS16"),
  // Checklist
  checklistIsa: json("checklistIsa"),
  // Conclusioni
  conclusioni: text("conclusioni"),
  rischioValutazione: mysqlEnum("rischioValutazione", ["basso", "medio", "alto", "critico"]).default("medio"),
  noteRevisore: text("noteRevisore"),
  stato: mysqlEnum("stato", ["da_iniziare", "in_corso", "completata"]).default("da_iniziare"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type SchedaImmobilizzazioni = typeof schedaImmobilizzazioni.$inferSelect;

// ─── SCHEDA DISPONIBILITÀ LIQUIDE (ISA Italia 500/505) ───────────────────────

export const schedaDisponibilitaLiquide = mysqlTable("scheda_disponibilita_liquide", {
  id: int("id").autoincrement().primaryKey(),
  incaricoId: int("incaricoId").notNull(),
  areaControlloId: int("areaControlloId"),
  // Conti correnti bancari
  contiCorrenti: json("contiCorrenti"), // [{ banca, iban, saldoBilancio, saldoEstrattoConto, differenza, riconciliato, note }]
  // Cassa
  saldoCassaBilancio: decimal("saldoCassaBilancio", { precision: 15, scale: 2 }),
  saldoCassaConteggio: decimal("saldoCassaConteggio", { precision: 15, scale: 2 }),
  differenzaCassa: decimal("differenzaCassa", { precision: 15, scale: 2 }),
  noteCassa: text("noteCassa"),
  // Riconciliazione bancaria
  riconciliazioneEseguita: boolean("riconciliazioneEseguita").default(false),
  dataRiconciliazione: date("dataRiconciliazione"),
  noteRiconciliazione: text("noteRiconciliazione"),
  // Estratti conto
  estrattiContoAcquisiti: boolean("estrattiContoAcquisiti").default(false),
  noteEstrattoConto: text("noteEstrattoConto"),
    // Circolarizzazione bancaria
    circolarizzazioneBancaria: boolean("circolarizzazioneBancaria").default(false),
    noteCircolarizzazioneBancaria: text("noteCircolarizzazioneBancaria"),
    // Centrale Rischi Banca d'Italia
    centraleRischi: json("centraleRischi"),
    // Checklist
    checklistIsa: json("checklistIsa"),
  // Conclusioni
  conclusioni: text("conclusioni"),
  rischioValutazione: mysqlEnum("rischioValutazione", ["basso", "medio", "alto", "critico"]).default("medio"),
  noteRevisore: text("noteRevisore"),
  stato: mysqlEnum("stato", ["da_iniziare", "in_corso", "completata"]).default("da_iniziare"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type SchedaDisponibilitaLiquide = typeof schedaDisponibilitaLiquide.$inferSelect;

// ─── SCHEDA PATRIMONIO NETTO (ISA Italia 500) ─────────────────────────────────
export const schedaPatrimonioNetto = mysqlTable("scheda_patrimonio_netto", {
  id: int("id").autoincrement().primaryKey(),
  incaricoId: int("incaricoId").notNull(),
  areaControlloId: int("areaControlloId"),
  // Composizione PN
  capitalesociale: decimal("capitalesociale", { precision: 15, scale: 2 }),
  riservaLegale: decimal("riservaLegale", { precision: 15, scale: 2 }),
  riserveStatutarie: decimal("riserveStatutarie", { precision: 15, scale: 2 }),
  riserveAltro: decimal("riserveAltro", { precision: 15, scale: 2 }),
  utileEsercizio: decimal("utileEsercizio", { precision: 15, scale: 2 }),
  utileAnniPrec: decimal("utileAnniPrec", { precision: 15, scale: 2 }),
  totalePN: decimal("totalePN", { precision: 15, scale: 2 }),
  // Variazioni dell'esercizio
  aumentoCapitale: boolean("aumentoCapitale").default(false),
  noteAumentoCapitale: text("noteAumentoCapitale"),
  distribuzioneUtili: boolean("distribuzioneUtili").default(false),
  importoDividendi: decimal("importoDividendi", { precision: 15, scale: 2 }),
  noteDividendi: text("noteDividendi"),
  coperturaPerdite: boolean("coperturaPerdite").default(false),
  noteCoperturaPerdite: text("noteCoperturaPerdite"),
  // Verifica coerenza
  pnAnnoPrec: decimal("pnAnnoPrec", { precision: 15, scale: 2 }),
  variazionePN: decimal("variazionePN", { precision: 15, scale: 2 }),
  variazioneSpiegata: boolean("variazioneSpiegata").default(false),
  // Checklist ISA 500
  checklistIsa: json("checklistIsa"), // [{ voce, completata, nota }]
  // Analisi AI
  analisiAi: text("analisiAi"),
  // Conclusioni
  conclusioni: text("conclusioni"),
  rischioValutazione: mysqlEnum("rischioValutazione", ["basso", "medio", "alto", "critico"]).default("medio"),
  noteRevisore: text("noteRevisore"),
  stato: mysqlEnum("stato", ["da_iniziare", "in_corso", "completata"]).default("da_iniziare"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type SchedaPatrimonioNetto = typeof schedaPatrimonioNetto.$inferSelect;
export type InsertSchedaPatrimonioNetto = typeof schedaPatrimonioNetto.$inferInsert;

// ─── SCHEDA RICAVI (ISA Italia 240/315) ───────────────────────────────────────
export const schedaRicavi = mysqlTable("scheda_ricavi", {
  id: int("id").autoincrement().primaryKey(),
  incaricoId: int("incaricoId").notNull(),
  areaControlloId: int("areaControlloId"),
  // Dati ricavi
  ricaviTotali: decimal("ricaviTotali", { precision: 15, scale: 2 }),
  ricaviAnnoPrec: decimal("ricaviAnnoPrec", { precision: 15, scale: 2 }),
  variazioneRicavi: decimal("variazioneRicavi", { precision: 15, scale: 2 }),
  variazionePercRicavi: decimal("variazionePercRicavi", { precision: 7, scale: 2 }),
  // Categorie ricavi (JSON array: [{categoria, importo, percentuale, note}])
  categorieRicavi: json("categorieRicavi"),
  // Test di completezza
  completezzaVerificata: boolean("completezzaVerificata").default(false),
  noteCompletezza: text("noteCompletezza"),
  // Cut-off
  cutOffVerificato: boolean("cutOffVerificato").default(false),
  noteCutOff: text("noteCutOff"),
  periodoVerificaCutOff: text("periodoVerificaCutOff"), // es. "dicembre-gennaio"
  // Anomalie
  anomalieRilevate: boolean("anomalieRilevate").default(false),
  descrizioneAnomalie: text("descrizioneAnomalie"),
  // Concentrazione clienti (rischio ISA 315)
  concentrazioneClienti: boolean("concentrazioneClienti").default(false),
  noteConcentrazione: text("noteConcentrazione"),
  // Ricavi straordinari / non ricorrenti
  ricaviNonRicorrenti: decimal("ricaviNonRicorrenti", { precision: 15, scale: 2 }),
  noteRicaviNonRicorrenti: text("noteRicaviNonRicorrenti"),
  // Checklist ISA 240/315
  checklistIsa: json("checklistIsa"), // [{ voce, completata, nota }]
  // Analisi AI
  analisiAi: text("analisiAi"),
  // Conclusioni
  conclusioni: text("conclusioni"),
  rischioValutazione: mysqlEnum("rischioValutazione", ["basso", "medio", "alto", "critico"]).default("medio"),
  noteRevisore: text("noteRevisore"),
  stato: mysqlEnum("stato", ["da_iniziare", "in_corso", "completata"]).default("da_iniziare"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type SchedaRicavi = typeof schedaRicavi.$inferSelect;
export type InsertSchedaRicavi = typeof schedaRicavi.$inferInsert;

// ─── ROADMAP STEP COMPLETATI (override manuale) ───────────────────────────────
// Permette al revisore di segnare come completato uno step della roadmap
// che non ha stato automatico (es. eventi_successivi, continuita_aziendale)
export const roadmapStepCompletati = mysqlTable("roadmap_step_completati", {
  id: int("id").autoincrement().primaryKey(),
  incaricoId: int("incaricoId").notNull(),
  stepId: varchar("stepId", { length: 64 }).notNull(),
  completato: boolean("completato").default(true).notNull(),
  noteRevisore: text("noteRevisore"),
  dataCompletamento: timestamp("dataCompletamento").defaultNow(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type RoadmapStepCompletato = typeof roadmapStepCompletati.$inferSelect;
export type InsertRoadmapStepCompletato = typeof roadmapStepCompletati.$inferInsert;

// ─── ROADMAP STEP NOTE (storico note revisore per step) ───────────────────────
// Ogni volta che il revisore aggiunge/modifica una nota su uno step, viene
// inserita una riga in questa tabella per conservare la cronologia completa.
export const roadmapStepNote = mysqlTable("roadmap_step_note", {
  id: int("id").autoincrement().primaryKey(),
  incaricoId: int("incaricoId").notNull(),
  stepId: varchar("stepId", { length: 64 }).notNull(),
  nota: text("nota").notNull(),
  autore: varchar("autore", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type RoadmapStepNota = typeof roadmapStepNote.$inferSelect;
export type InsertRoadmapStepNota = typeof roadmapStepNote.$inferInsert;

// ─── WIZARD AVVIO REVISIONE ───────────────────────────────────────────────────
// Sessione del wizard di avvio revisione annuale.
// Tiene traccia dello step corrente, dei documenti caricati e dei risultati AI.
export const wizardSessioni = mysqlTable("wizard_sessioni", {
  id: int("id").autoincrement().primaryKey(),
  incaricoId: int("incaricoId").notNull(),
  stepCorrente: int("stepCorrente").default(1).notNull(), // 1=upload, 2=bilancio, 3=estratto_conto, 4=partitario, 5=riepilogo
  stato: mysqlEnum("stato_wizard", ["in_corso", "completato", "annullato"]).default("in_corso").notNull(),
  // Risultati analisi AI per ogni step (JSON)
  risultatiBilancio: json("risultatiBilancio"),
  risultatiEstrattoConto: json("risultatiEstrattoConto"),
  risultatiPartitario: json("risultatiPartitario"),
  risultatiDocumentiSocietari: json("risultatiDocumentiSocietari"),
  // Riepilogo finale e azioni eseguite
  riepilogoFinale: json("riepilogoFinale"),
  azioniEseguite: json("azioniEseguite"), // array di {azione, esito, timestamp}
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type WizardSessione = typeof wizardSessioni.$inferSelect;
export type InsertWizardSessione = typeof wizardSessioni.$inferInsert;
