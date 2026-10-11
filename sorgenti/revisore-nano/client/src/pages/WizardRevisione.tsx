/**
 * Wizard Avvio Revisione Annuale
 *
 * Guida il revisore attraverso 5 step sequenziali:
 *   1. Upload documenti (bilancio, estratto conto, partitario, documenti societari)
 *   2. Analisi AI bilancio
 *   3. Analisi AI estratto conto
 *   4. Analisi AI partitario + documenti societari
 *   5. Riepilogo e popolamento schede
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { useParams, Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2,
  Circle,
  Upload,
  FileText,
  BarChart3,
  CreditCard,
  BookOpen,
  ChevronRight,
  AlertTriangle,
  Loader2,
  X,
  ArrowLeft,
  Sparkles,
  FileSpreadsheet,
  CheckCheck,
  Info,
  RefreshCw,
} from "lucide-react";

// ─── TIPI ─────────────────────────────────────────────────────────────────────

type TipoDocumento =
  | "bilancio_revisione"
  | "bilancio_analitico"
  | "estratto_conto"
  | "partitario"
  | "verbale_assemblea"
  | "nota_integrativa"
  | "altro";

interface FileCaricato {
  file: File;
  tipoDocumento: TipoDocumento;
  annoRiferimento?: number;
  documentoId?: number;
  stato: "in_attesa" | "caricamento" | "caricato" | "errore";
  errore?: string;
}

interface ConfigDocumento {
  tipo: TipoDocumento;
  label: string;
  descrizione: string;
  formatiAccettati: string;
  obbligatorio: boolean;
  icona: React.ComponentType<{ className?: string }>;
  colore: string;
  usoSistema: string;
}

const DOCUMENTI_RICHIESTI: ConfigDocumento[] = [
  {
    tipo: "bilancio_revisione",
    label: "Bilancio CEE",
    descrizione: "Bilancio di esercizio (Stato Patrimoniale + Conto Economico) — PDF, XBRL o Excel",
    formatiAccettati: ".pdf,.xbrl,.xml,.xlsx,.xls",
    obbligatorio: true,
    icona: BarChart3,
    colore: "blue",
    usoSistema: "Modulo 2, materialità, analisi verticale e confronto pluriennale",
  },
  {
    tipo: "bilancio_analitico",
    label: "Bilancio Analitico / Mastro",
    descrizione: "Bilancio di verifica con saldi conti esplosi — PDF o Excel",
    formatiAccettati: ".pdf,.xlsx,.xls,.csv",
    obbligatorio: false,
    icona: FileSpreadsheet,
    colore: "indigo",
    usoSistema: "Schede di controllo, analisi verticale e matching contabile",
  },
  {
    tipo: "estratto_conto",
    label: "Estratto Conto Bancario",
    descrizione: "Movimenti bancari dell'esercizio — Excel preferito",
    formatiAccettati: ".xlsx,.xls,.csv,.pdf",
    obbligatorio: true,
    icona: CreditCard,
    colore: "emerald",
    usoSistema: "Verifica incassi e pagamenti successivi",
  },
  {
    tipo: "partitario",
    label: "Partitario Clienti/Fornitori",
    descrizione: "Elenco crediti e debiti con aging — PDF o Excel",
    formatiAccettati: ".pdf,.xlsx,.xls,.csv",
    obbligatorio: false,
    icona: BookOpen,
    colore: "violet",
    usoSistema: "Verifica incassi/pagamenti, clienti/fornitori e circolarizzazione",
  },
  {
    tipo: "verbale_assemblea",
    label: "Verbali Assemblea / Documenti Societari",
    descrizione: "Verbali CdA, assemblee, visura camerale — PDF",
    formatiAccettati: ".pdf",
    obbligatorio: false,
    icona: FileText,
    colore: "amber",
    usoSistema: "Contesto societario del fascicolo e analisi qualitativa",
  },
];

type DocumentoFascicolo = {
  id: number;
  nomeFile: string;
  tipoDocumento: string | null;
  statoParsing: string | null;
  annoRiferimento?: number | null;
};

function documentoUsatoNelleAnalisi(doc: DocumentoFascicolo): boolean {
  return doc.statoParsing === "completato" && [
    "bilancio",
    "bilancio_revisione",
    "bilancio_storico",
    "bilancio_analitico",
    "estratto_conto",
    "partitario",
    "verbale_assemblea",
    "nota_integrativa",
  ].includes(doc.tipoDocumento ?? "");
}

function statoDocumentoLabel(stato: string | null) {
  if (stato === "completato") return "analizzato";
  if (stato === "in_corso") return "analisi in corso";
  if (stato === "errore") return "errore analisi";
  return "caricato, non analizzato";
}

// ─── STEPPER ──────────────────────────────────────────────────────────────────

const STEP_CONFIG = [
  { id: 1, label: "Carica documenti", icona: Upload },
  { id: 2, label: "Analisi bilancio", icona: BarChart3 },
  { id: 3, label: "Analisi estratto conto", icona: CreditCard },
  { id: 4, label: "Analisi partitario", icona: BookOpen },
  { id: 5, label: "Riepilogo", icona: CheckCheck },
];

function parseNumeroItaliano(value: string): number | null {
  const clean = String(value ?? "").trim().replace(/\s/g, "");
  if (!clean) return null;
  const normalized = /^\d{1,3}(\.\d{3})*(,\d+)?$/.test(clean)
    ? clean.replace(/\./g, "").replace(",", ".")
    : clean.replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

async function loadPdfJs() {
  const dynamicImport = new Function(
    "url",
    "return import(/* @vite-ignore */ url);"
  ) as (url: string) => Promise<any>;
  const pdfjs = await dynamicImport("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.mjs";
  return pdfjs;
}

async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const lineMap = new Map<number, Array<{ x: number; str: string }>>();

    for (const item of textContent.items as Array<{ str?: string; transform?: number[] }>) {
      const str = String(item?.str ?? "").trim();
      if (!str) continue;
      const x = item?.transform?.[4] ?? 0;
      const y = Math.round(item?.transform?.[5] ?? 0);
      const line = lineMap.get(y) ?? [];
      line.push({ x, str });
      lineMap.set(y, line);
    }

    pages.push(
      Array.from(lineMap.entries())
        .sort((a, b) => b[0] - a[0])
        .map(([, parts]) => parts.sort((a, b) => a.x - b.x).map(part => part.str).join(" "))
        .join("\n")
    );
  }

  return pages.join("\n");
}

function parsePartitarioPdfText(testo: string, nomeFile: string) {
  const headerRe = /Conto\s+([0-9.\s]+)\s+([\s\S]+?)\s+Partitario\s+Dal\s+\d{2}\/\d{2}\/\d{2}\s+Al\s+\d{2}\/\d{2}\/\d{2}/gi;
  const saldoRe = /([\-]?\d[\d.,]*)\s+Saldo alla data\.\.:/gi;
  const rows: Array<{ tipo: "cliente" | "fornitore"; codice: string; ragioneSociale: string; saldoPartita: number; estero: boolean }> = [];
  const headers = Array.from(testo.matchAll(headerRe));
  const filename = nomeFile.toLowerCase();

  for (let index = 0; index < headers.length; index++) {
    const match = headers[index];
    const start = match.index ?? 0;
    const end = index + 1 < headers.length ? headers[index + 1].index ?? testo.length : testo.length;
    const saldi = Array.from(testo.slice(start, end).matchAll(saldoRe));
    const saldo = Math.abs(parseNumeroItaliano(saldi[saldi.length - 1]?.[1] ?? "") ?? 0);
    if (saldo <= 0) continue;

    const codice = match[1].replace(/\s+/g, " ").trim();
    const ragioneSociale = match[2].replace(/\s+/g, " ").trim();
    const compactCode = codice.replace(/\s+/g, "");
    const tipo =
      compactCode.startsWith("53.") ? "fornitore" :
      compactCode.startsWith("3.") ? "cliente" :
      filename.includes("forn") ? "fornitore" :
      "cliente";
    rows.push({ tipo, codice, ragioneSociale, saldoPartita: saldo, estero: /gmbh|bv|sas|corp|ireland|ltd|uc|julich/i.test(ragioneSociale) });
  }

  const clienti = rows.filter(row => row.tipo === "cliente").map(({ tipo, ...row }) => row);
  const fornitori = rows.filter(row => row.tipo === "fornitore").map(({ tipo, ...row }) => row);
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

function parseBilancioPdfText(testo: string, nomeFile: string) {
  const findAmountAfter = (labels: string[]) => {
    for (const label of labels) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const value = parseNumeroItaliano(testo.match(new RegExp(`${escaped}[\\s\\S]{0,160}?([\\-]?\\d{1,3}(?:[\\.\\s]\\d{3})*(?:,\\d+)?)`, "i"))?.[1] ?? "");
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

function Stepper({ stepCorrente }: { stepCorrente: number }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {STEP_CONFIG.map((step, idx) => {
        const isCompletato = stepCorrente > step.id;
        const isCorrente = stepCorrente === step.id;
        const Icona = step.icona;
        return (
          <div key={step.id} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all ${
                isCompletato ? "bg-emerald-500 border-emerald-500 text-white" :
                isCorrente ? "bg-slate-800 border-slate-800 text-white" :
                "bg-white border-slate-200 text-slate-400"
              }`}>
                {isCompletato ? <CheckCircle2 className="w-5 h-5" /> : <Icona className="w-4 h-4" />}
              </div>
              <span className={`text-xs font-medium text-center leading-tight max-w-[70px] ${
                isCorrente ? "text-slate-800" : isCompletato ? "text-emerald-600" : "text-slate-400"
              }`}>{step.label}</span>
            </div>
            {idx < STEP_CONFIG.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1 mb-5 ${stepCorrente > step.id ? "bg-emerald-400" : "bg-slate-200"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── STEP 1: UPLOAD DOCUMENTI ─────────────────────────────────────────────────

function StepUpload({
  incaricoId,
  documentiIncarico,
  onAvanti,
}: {
  incaricoId: number;
  documentiIncarico: DocumentoFascicolo[];
  onAvanti: (files: FileCaricato[]) => void;
}) {
  const [files, setFiles] = useState<FileCaricato[]>([]);
  const [caricamentoGlobale, setCaricamentoGlobale] = useState(false);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const uploadMutation = trpc.documenti.upload.useMutation();

  const aggiungiFile = useCallback((tipo: TipoDocumento, fileList: FileList | null) => {
    if (!fileList) return;
    const nuovi: FileCaricato[] = Array.from(fileList).map(f => ({
      file: f,
      tipoDocumento: tipo,
      stato: "in_attesa" as const,
    }));
    setFiles(prev => {
      const esistenti = new Set(
        prev.map(f => `${f.tipoDocumento}|${f.file.name}|${f.file.size}|${f.file.lastModified}`)
      );
      const nuoviNonDuplicati = nuovi.filter(f =>
        !esistenti.has(`${f.tipoDocumento}|${f.file.name}|${f.file.size}|${f.file.lastModified}`)
      );
      return [...prev, ...nuoviNonDuplicati];
    });
  }, []);

  const rimuoviFile = useCallback((idx: number) => {
    setFiles(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const caricaTutti = async () => {
    const daeCaricare = files.filter(f => f.stato === "in_attesa");
    if (daeCaricare.length === 0) {
      toast.error("Nessun file da caricare");
      return;
    }
    setCaricamentoGlobale(true);

    const aggiornati = [...files];
    for (let i = 0; i < aggiornati.length; i++) {
      if (aggiornati[i].stato !== "in_attesa") continue;
      aggiornati[i] = { ...aggiornati[i], stato: "caricamento" };
      setFiles([...aggiornati]);

      try {
        const f = aggiornati[i].file;
        const base64 = await fileToBase64(f);
        const ext = f.name.split(".").pop()?.toLowerCase() ?? "altro";
        const tipoFile = ["pdf"].includes(ext) ? "pdf" :
          ["xml"].includes(ext) ? "xml" :
          ["xbrl"].includes(ext) ? "xbrl" :
          ["xlsx", "xls"].includes(ext) ? "xlsx" :
          ["csv"].includes(ext) ? "csv" : "altro";
        let testoEstratto: string | undefined;
        let datiStrutturatiClient: Record<string, unknown> | undefined;

        if (tipoFile === "pdf") {
          testoEstratto = await extractPdfText(f);
          datiStrutturatiClient = aggiornati[i].tipoDocumento === "partitario"
            ? parsePartitarioPdfText(testoEstratto, f.name)
            : parseBilancioPdfText(testoEstratto, f.name);
        }

        const result = await uploadMutation.mutateAsync({
          incaricoId,
          nomeFile: f.name,
          tipoFile: tipoFile as any,
          tipoDocumento: aggiornati[i].tipoDocumento,
          contenutoBase64: base64,
          testoEstratto,
          datiStrutturatiClient,
          dimensioneBytes: f.size,
        });

        aggiornati[i] = { ...aggiornati[i], stato: "caricato", documentoId: result.id };
      } catch (e: any) {
        aggiornati[i] = { ...aggiornati[i], stato: "errore", errore: e.message };
      }
      setFiles([...aggiornati]);
    }

    setCaricamentoGlobale(false);
    const caricati = aggiornati.filter(f => f.stato === "caricato");
    if (caricati.length > 0) {
      toast.success(`${caricati.length} file caricati con successo`);
      onAvanti(aggiornati);
    }
  };

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const tuttiCaricati = files.length > 0 && files.every(f => f.stato === "caricato");
  const documentoPresente = (tipo: TipoDocumento) =>
    files.some(f => f.tipoDocumento === tipo && f.stato === "caricato") ||
    documentiIncarico.some(d => d.tipoDocumento === tipo || (tipo === "bilancio_revisione" && d.tipoDocumento === "bilancio"));
  const obbligatoriMancanti = DOCUMENTI_RICHIESTI
    .filter(d => d.obbligatorio)
    .filter(d => !documentoPresente(d.tipo));
  const totaleDocumentiDisponibili = documentiIncarico.length + files.filter(f => f.stato === "caricato").length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900 mb-1">Carica i documenti dell'esercizio</h2>
        <p className="text-sm text-slate-500">
          Carica i documenti contabili e societari. I documenti obbligatori sono necessari per l'analisi AI.
          Puoi trascinare i file nelle aree sottostanti o cliccare per selezionarli dalla tua cartella.
        </p>
      </div>

      {/* Griglia documenti */}
      <div className="grid gap-3">
        {DOCUMENTI_RICHIESTI.map(doc => {
          const filesDoc = files.filter(f => f.tipoDocumento === doc.tipo);
          const documentiEsistenti = documentiIncarico.filter(d =>
            d.tipoDocumento === doc.tipo || (doc.tipo === "bilancio_revisione" && d.tipoDocumento === "bilancio")
          );
          const presente = filesDoc.some(f => f.stato === "caricato") || documentiEsistenti.length > 0;
          const inclusoAnalisi = documentiEsistenti.some(documentoUsatoNelleAnalisi) || filesDoc.some(f => f.stato === "caricato");
          const Icona = doc.icona;
          const colori: Record<string, string> = {
            blue: "border-blue-200 bg-blue-50/50",
            indigo: "border-indigo-200 bg-indigo-50/50",
            emerald: "border-emerald-200 bg-emerald-50/50",
            violet: "border-violet-200 bg-violet-50/50",
            amber: "border-amber-200 bg-amber-50/50",
          };
          const coloriIcona: Record<string, string> = {
            blue: "text-blue-600 bg-blue-100",
            indigo: "text-indigo-600 bg-indigo-100",
            emerald: "text-emerald-600 bg-emerald-100",
            violet: "text-violet-600 bg-violet-100",
            amber: "text-amber-600 bg-amber-100",
          };

          return (
            <div
              key={doc.tipo}
              className={`rounded-lg border-2 border-dashed p-4 transition-all ${
                presente ? "border-emerald-300 bg-emerald-50/30" :
                colori[doc.colore] ?? "border-slate-200 bg-slate-50"
              }`}
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault();
                aggiungiFile(doc.tipo, e.dataTransfer.files);
              }}
            >
              <div className="flex items-start gap-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${coloriIcona[doc.colore]}`}>
                  <Icona className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm text-slate-800">{doc.label}</span>
                    {doc.obbligatorio && (
                      <Badge className="bg-red-100 text-red-700 border-0 text-xs px-1.5">Obbligatorio</Badge>
                    )}
                    {presente && (
                      <Badge className="bg-emerald-100 text-emerald-700 border-0 text-xs px-1.5 gap-1">
                        <CheckCircle2 className="w-3 h-3" />Caricato
                      </Badge>
                    )}
                    {inclusoAnalisi && (
                      <Badge className="bg-blue-100 text-blue-700 border-0 text-xs px-1.5 gap-1">
                        <CheckCheck className="w-3 h-3" />Incluso nelle analisi
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{doc.descrizione}</p>
                  <p className="text-[11px] text-slate-400 mt-1">Uso nel sistema: {doc.usoSistema}</p>

                  {documentiEsistenti.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {documentiEsistenti.map(d => (
                        <div key={d.id} className="flex items-center gap-2 bg-white rounded px-2 py-1 border border-emerald-100">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                          <span className="text-xs text-slate-700 truncate flex-1">{d.nomeFile}</span>
                          {d.annoRiferimento && <span className="text-xs text-slate-400">{d.annoRiferimento}</span>}
                          <Badge className={`text-[11px] border-0 ${
                            d.statoParsing === "completato" ? "bg-emerald-100 text-emerald-700" :
                            d.statoParsing === "in_corso" ? "bg-blue-100 text-blue-700" :
                            d.statoParsing === "errore" ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"
                          }`}>
                            {statoDocumentoLabel(d.statoParsing)}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* File caricati per questo tipo */}
                  {filesDoc.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {filesDoc.map((f, idx) => {
                        const idxGlobale = files.indexOf(f);
                        return (
                          <div key={idx} className="flex items-center gap-2 bg-white rounded px-2 py-1 border border-slate-100">
                            <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span className="text-xs text-slate-700 truncate flex-1">{f.file.name}</span>
                            <span className="text-xs text-slate-400">{(f.file.size / 1024).toFixed(0)} KB</span>
                            {f.stato === "caricamento" && <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />}
                            {f.stato === "caricato" && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
                            {f.stato === "errore" && <AlertTriangle className="w-3.5 h-3.5 text-red-500" />}
                            {f.stato === "in_attesa" && (
                              <button onClick={() => rimuoviFile(idxGlobale)}>
                                <X className="w-3.5 h-3.5 text-slate-400 hover:text-red-500" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Pulsante seleziona file */}
                  <button
                    className="mt-2 text-xs text-slate-500 hover:text-slate-700 underline underline-offset-2"
                    onClick={() => inputRefs.current[doc.tipo]?.click()}
                  >
                    + Seleziona file ({doc.formatiAccettati})
                  </button>
                  <input
                    ref={el => { inputRefs.current[doc.tipo] = el; }}
                    type="file"
                    accept={doc.formatiAccettati}
                    multiple
                    className="hidden"
                    onChange={e => {
                      aggiungiFile(doc.tipo, e.target.files);
                      e.currentTarget.value = "";
                    }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Avvisi obbligatori mancanti */}
      {obbligatoriMancanti.length > 0 && (files.length > 0 || documentiIncarico.length > 0) && (
        <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700">
            Mancano i documenti obbligatori: <strong>{obbligatoriMancanti.map(d => d.label).join(", ")}</strong>.
            Puoi procedere comunque, ma l'analisi AI sarà parziale.
          </p>
        </div>
      )}

      {/* Azioni */}
      <div className="flex items-center justify-between gap-4 pt-2">
        <div className="text-xs text-slate-500">
          {files.filter(f => f.stato === "caricato").length} di {files.length} nuovi file caricati
          {documentiIncarico.length > 0 && ` - ${documentiIncarico.length} gia' nel fascicolo`}
        </div>
        <div className="flex gap-2">
          {files.some(f => f.stato === "in_attesa") && (
            <Button
              onClick={caricaTutti}
              disabled={caricamentoGlobale}
              className="gap-1 bg-slate-700 hover:bg-slate-800 text-white"
            >
              {caricamentoGlobale ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              Carica tutti
            </Button>
          )}
          <Button
            onClick={() => onAvanti(files)}
            disabled={totaleDocumentiDisponibili === 0}
            className="gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            Avanti — Analisi AI
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── STEP ANALISI AI ──────────────────────────────────────────────────────────

function BadgeSeverita({ severita }: { severita: string }) {
  if (severita === "alta") return <Badge className="bg-red-100 text-red-700 border-0 text-xs">Alta</Badge>;
  if (severita === "media") return <Badge className="bg-amber-100 text-amber-700 border-0 text-xs">Media</Badge>;
  return <Badge className="bg-slate-100 text-slate-600 border-0 text-xs">Bassa</Badge>;
}

function RisultatoAnalisi({ risultati, titolo }: { risultati: Record<string, unknown> | null; titolo: string }) {
  if (!risultati) return null;
  if ((risultati as any).errore) {
    return (
      <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
        Analisi non disponibile: {(risultati as any).errore}
      </div>
    );
  }

  const anomalie: any[] = (risultati as any).anomalie ?? [];
  const areeAttenzione: any[] = (risultati as any).areeAttenzione ?? [];
  const sintesi: string = (risultati as any).sintesi ?? "";
  const candidati: any[] = (risultati as any).candidatiCircolarizzazione ?? [];

  return (
    <div className="space-y-3">
      {sintesi && (
        <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg">
          <p className="text-sm text-blue-800 leading-relaxed">{sintesi}</p>
        </div>
      )}
      {anomalie.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">
            Anomalie rilevate ({anomalie.length})
          </h4>
          <div className="space-y-1.5">
            {anomalie.map((a, i) => (
              <div key={i} className="flex items-start gap-2 p-2 bg-white border border-slate-100 rounded">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium text-slate-700">{a.area ?? a.tipo ?? "Anomalia"}</span>
                    <BadgeSeverita severita={a.severita} />
                    {a.riferimentoISA && <span className="text-xs text-slate-400">{a.riferimentoISA}</span>}
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5">{a.descrizione}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {areeAttenzione.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">
            Aree di attenzione ({areeAttenzione.length})
          </h4>
          <div className="space-y-1">
            {areeAttenzione.map((a, i) => (
              <div key={i} className="flex items-start gap-2 p-2 bg-slate-50 border border-slate-100 rounded">
                <Info className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
                <div>
                  <span className="text-xs font-medium text-slate-700">{a.area}</span>
                  {a.nota && <p className="text-xs text-slate-500 mt-0.5">{a.nota}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {candidati.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">
            Candidati circolarizzazione ({candidati.length})
          </h4>
          <div className="space-y-1">
            {candidati.slice(0, 5).map((c, i) => (
              <div key={i} className="flex items-center justify-between gap-2 p-2 bg-violet-50 border border-violet-100 rounded text-xs">
                <span className="font-medium text-violet-800">{c.nome}</span>
                <div className="flex items-center gap-2">
                  <Badge className="bg-violet-100 text-violet-700 border-0 text-xs">{c.tipo}</Badge>
                  <span className="text-violet-600 font-mono">{c.importo?.toLocaleString("it-IT")} €</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StepAnalisi({
  titolo,
  descrizione,
  icona: Icona,
  documentoId,
  sessioneId,
  analizzaMutation,
  risultati,
  onAvanti,
  onIndietro,
  loading,
}: {
  titolo: string;
  descrizione: string;
  icona: React.ComponentType<{ className?: string }>;
  documentoId?: number;
  sessioneId: number;
  analizzaMutation: () => void;
  risultati: Record<string, unknown> | null;
  onAvanti: () => void;
  onIndietro: () => void;
  loading: boolean;
}) {
  const autoAnalisiAvviata = useRef(false);
  const risultatiObsoleti = !!risultati &&
    titolo.toLowerCase().includes("bilancio") &&
    JSON.stringify(risultati).toLowerCase().includes("mancano dati fondamentali");

  useEffect(() => {
    if (!documentoId || (risultati && !risultatiObsoleti) || loading || autoAnalisiAvviata.current) return;
    autoAnalisiAvviata.current = true;
    analizzaMutation();
  }, [documentoId, risultati, risultatiObsoleti, loading, analizzaMutation]);

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
          <Icona className="w-5 h-5 text-slate-600" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-900">{titolo}</h2>
          <p className="text-sm text-slate-500 mt-0.5">{descrizione}</p>
        </div>
      </div>

      {!documentoId && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
          <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-700">
            Nessun documento di questo tipo caricato. Puoi saltare questo step o tornare indietro per caricare il file.
          </p>
        </div>
      )}

      {documentoId && !risultati && !loading && (
        <div className="text-center py-8">
          <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
            <Sparkles className="w-8 h-8 text-slate-400" />
          </div>
          <p className="text-slate-600 text-sm mb-4">Analisi automatica in avvio...</p>
          <Button
            onClick={analizzaMutation}
            className="gap-2 bg-slate-800 hover:bg-slate-900 text-white"
          >
            <Sparkles className="w-4 h-4" />
            Avvia analisi AI
          </Button>
        </div>
      )}

      {loading && (
        <div className="text-center py-8">
          <Loader2 className="w-10 h-10 text-blue-500 animate-spin mx-auto mb-3" />
          <p className="text-slate-600 text-sm">Analisi AI in corso...</p>
          <p className="text-slate-400 text-xs mt-1">Potrebbe richiedere 10-30 secondi</p>
          <Progress value={undefined} className="mt-4 h-1.5 w-48 mx-auto" />
        </div>
      )}

      {risultati && (
        <div>
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <span className="text-sm font-medium text-emerald-700">
                {risultatiObsoleti ? "Analisi precedente da aggiornare" : "Analisi completata"}
              </span>
            </div>
            {documentoId && (
              <Button
                size="sm"
                variant="outline"
                onClick={analizzaMutation}
                disabled={loading}
                className="gap-1"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Ricalcola analisi
              </Button>
            )}
          </div>
          <RisultatoAnalisi risultati={risultati} titolo={titolo} />
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <Button variant="outline" onClick={onIndietro} className="gap-1">
          <ArrowLeft className="w-4 h-4" />Indietro
        </Button>
        <Button
          onClick={onAvanti}
          className="gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
          disabled={loading}
        >
          {risultati ? "Avanti" : "Salta"}
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

// ─── STEP 5: RIEPILOGO ────────────────────────────────────────────────────────

function StepRiepilogo({
  sessioneId,
  sessione,
  onCompletaWizard,
  onIndietro,
  loading,
  riepilogo,
}: {
  sessioneId: number;
  sessione: any;
  onCompletaWizard: () => void;
  onIndietro: () => void;
  loading: boolean;
  riepilogo: any;
}) {
  const analizzati = [
    { label: "Bilancio", ok: !!sessione?.risultatiBilancio },
    { label: "Estratto conto", ok: !!sessione?.risultatiEstrattoConto },
    { label: "Partitario", ok: !!sessione?.risultatiPartitario },
    { label: "Documenti societari", ok: !!sessione?.risultatiDocumentiSocietari },
  ];

  const tutteAnomalieAlt = [
    ...((sessione?.risultatiBilancio as any)?.anomalie ?? []),
    ...((sessione?.risultatiEstrattoConto as any)?.anomalie ?? []),
    ...((sessione?.risultatiPartitario as any)?.anomalie ?? []),
  ].filter((a: any) => a.severita === "alta");

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-slate-900 mb-1">Riepilogo analisi</h2>
        <p className="text-sm text-slate-500">
          Conferma il popolamento automatico delle schede di lavoro con i dati estratti dall'AI.
        </p>
      </div>

      {/* Documenti analizzati */}
      <Card className="border-slate-200">
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm text-slate-700">Documenti analizzati</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="grid grid-cols-2 gap-2">
            {analizzati.map(a => (
              <div key={a.label} className={`flex items-center gap-2 p-2 rounded border text-xs ${
                a.ok ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-slate-50 border-slate-200 text-slate-400"
              }`}>
                {a.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Circle className="w-3.5 h-3.5" />}
                {a.label}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Anomalie critiche */}
      {tutteAnomalieAlt.length > 0 && (
        <Card className="border-red-200 bg-red-50/50">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm text-red-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              {tutteAnomalieAlt.length} anomalie ad alta severità identificate
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-1.5">
            {tutteAnomalieAlt.slice(0, 5).map((a: any, i: number) => (
              <div key={i} className="text-xs text-red-700 flex items-start gap-1.5">
                <span className="shrink-0">•</span>
                <span><strong>{a.area ?? a.tipo}</strong>: {a.descrizione}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Azioni che verranno eseguite */}
      <Card className="border-blue-200 bg-blue-50/30">
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm text-blue-700 flex items-center gap-2">
            <Sparkles className="w-4 h-4" />
            Azioni automatiche al completamento
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-1.5">
          <p className="text-xs text-blue-700">• Aggiornamento modulo comprensione con dati bilancio (ricavi, attivo, PN, utile)</p>
          {tutteAnomalieAlt.length > 0 && (
            <p className="text-xs text-blue-700">• Popolamento modulo rischio con {tutteAnomalieAlt.length} anomalie ad alta severità</p>
          )}
          {(sessione?.risultatiBilancio as any)?.areeAttenzione?.length > 0 && (
            <p className="text-xs text-blue-700">• Aggiornamento strategia revisione con aree di attenzione</p>
          )}
        </CardContent>
      </Card>

      {/* Risultato completamento */}
      {riepilogo && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <CheckCheck className="w-5 h-5 text-emerald-600" />
            <span className="font-semibold text-emerald-800">Wizard completato!</span>
          </div>
          <p className="text-sm text-emerald-700">
            {riepilogo.azioniEseguite} azioni eseguite. Le schede di lavoro sono state aggiornate con i dati estratti dall'AI.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <Button variant="outline" onClick={onIndietro} disabled={loading || !!riepilogo} className="gap-1">
          <ArrowLeft className="w-4 h-4" />Indietro
        </Button>
        {!riepilogo ? (
          <Button
            onClick={onCompletaWizard}
            disabled={loading}
            className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCheck className="w-4 h-4" />}
            Completa e popola schede
          </Button>
        ) : (
          <Link href={`/incarichi/${sessione?.incaricoId}`}>
            <Button className="gap-2 bg-slate-800 hover:bg-slate-900 text-white">
              Vai all'incarico
              <ChevronRight className="w-4 h-4" />
            </Button>
          </Link>
        )}
      </div>
    </div>
  );
}

// ─── PAGINA PRINCIPALE ────────────────────────────────────────────────────────

export default function WizardRevisione() {
  const params = useParams<{ incaricoId: string }>();
  const incaricoId = parseInt(params.incaricoId ?? "0");

  const [sessioneId, setSessioneId] = useState<number | null>(null);
  const [stepCorrente, setStepCorrente] = useState(1);
  const [filesCaricati, setFilesCaricati] = useState<FileCaricato[]>([]);
  const [risultatiBilancio, setRisultatiBilancio] = useState<Record<string, unknown> | null>(null);
  const [risultatiEC, setRisultatiEC] = useState<Record<string, unknown> | null>(null);
  const [risultatiPartitario, setRisultatiPartitario] = useState<Record<string, unknown> | null>(null);
  const [riepilogoFinale, setRiepilogoFinale] = useState<any>(null);

  // Query sessione esistente
  const { data: sessioneEsistente } = trpc.wizard.getSessione.useQuery(
    { incaricoId },
    { enabled: incaricoId > 0 }
  );
  const { data: documentiIncarico } = trpc.documenti.listByIncarico.useQuery(
    { incaricoId },
    { enabled: incaricoId > 0 }
  );

  // Avvia wizard
  const avviaMutation = trpc.wizard.avvia.useMutation({
    onSuccess: (data) => {
      setSessioneId(data.sessione.id);
      setStepCorrente(data.sessione.stepCorrente ?? 1);
      if (data.sessione.risultatiBilancio) setRisultatiBilancio(data.sessione.risultatiBilancio as any);
      if (data.sessione.risultatiEstrattoConto) setRisultatiEC(data.sessione.risultatiEstrattoConto as any);
      if (data.sessione.risultatiPartitario) setRisultatiPartitario(data.sessione.risultatiPartitario as any);
    },
    onError: (e) => toast.error("Errore avvio wizard: " + e.message),
  });

  // Analisi bilancio
  const analizzaBilancioMutation = trpc.wizard.analizzaBilancio.useMutation({
    onSuccess: (data) => {
      setRisultatiBilancio(data.risultati);
      toast.success("Analisi bilancio completata");
    },
    onError: (e) => toast.error("Errore analisi bilancio: " + e.message),
  });

  // Analisi estratto conto
  const analizzaECMutation = trpc.wizard.analizzaEstrattoConto.useMutation({
    onSuccess: (data) => {
      setRisultatiEC(data.risultati);
      toast.success("Analisi estratto conto completata");
    },
    onError: (e) => toast.error("Errore analisi estratto conto: " + e.message),
  });

  // Analisi partitario
  const analizzaPartitarioMutation = trpc.wizard.analizzaPartitario.useMutation({
    onSuccess: (data) => {
      setRisultatiPartitario(data.risultati);
      toast.success("Analisi partitario completata");
    },
    onError: (e) => toast.error("Errore analisi partitario: " + e.message),
  });

  // Completa wizard
  const completaMutation = trpc.wizard.completaWizard.useMutation({
    onSuccess: (data) => {
      setRiepilogoFinale(data.riepilogo);
      toast.success("Wizard completato! Schede aggiornate.");
    },
    onError: (e) => toast.error("Errore completamento: " + e.message),
  });
  const aggiornaStepMutation = trpc.wizard.aggiornaStep.useMutation();

  // Helper: trova documentoId per tipo
  const getDocId = (tipo: TipoDocumento) =>
    filesCaricati.find(f => f.tipoDocumento === tipo && f.stato === "caricato")?.documentoId ??
    documentiIncarico?.find(d => d.tipoDocumento === tipo)?.id;

  // Se non c'è ancora una sessione, mostra la schermata di avvio
  const sessioneAttiva = sessioneId
    ? { id: sessioneId, incaricoId, stepCorrente, risultatiBilancio, risultatiEstrattoConto: risultatiEC, risultatiPartitario }
    : sessioneEsistente;

  if (!sessioneId && !avviaMutation.isPending) {
    return (
      <div className="container max-w-3xl py-10">
        <Link href={`/incarichi/${incaricoId}`}>
          <Button variant="outline" size="sm" className="mb-6 gap-1">
            <ArrowLeft className="w-4 h-4" />Torna all'incarico
          </Button>
        </Link>

        <div className="text-center py-12">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center mx-auto mb-6 shadow-lg">
            <Sparkles className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-3">Wizard Avvio Revisione</h1>
          <p className="text-slate-500 max-w-md mx-auto mb-8 leading-relaxed">
            Carica i documenti contabili e il sistema AI analizzerà automaticamente bilancio, estratto conto e
            partitario, identificando anomalie e popolando le schede di lavoro.
          </p>

          {sessioneEsistente && sessioneEsistente.stato === "in_corso" && (
            <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-xl max-w-sm mx-auto">
              <p className="text-sm text-blue-700 font-medium mb-2">Sessione precedente trovata</p>
              <p className="text-xs text-blue-600">Step {sessioneEsistente.stepCorrente} di 5 — avanzamento salvato</p>
            </div>
          )}

          <div className="flex gap-3 justify-center">
            {sessioneEsistente && sessioneEsistente.stato === "in_corso" && (
              <Button
                variant="outline"
                onClick={() => {
                  setSessioneId(sessioneEsistente.id);
                  setStepCorrente(sessioneEsistente.stepCorrente ?? 1);
                  if (sessioneEsistente.risultatiBilancio) setRisultatiBilancio(sessioneEsistente.risultatiBilancio as any);
                  if (sessioneEsistente.risultatiEstrattoConto) setRisultatiEC(sessioneEsistente.risultatiEstrattoConto as any);
                  if (sessioneEsistente.risultatiPartitario) setRisultatiPartitario(sessioneEsistente.risultatiPartitario as any);
                }}
                className="gap-2"
              >
                Riprendi sessione
              </Button>
            )}
            <Button
              onClick={() => avviaMutation.mutate({ incaricoId })}
              className="gap-2 bg-slate-800 hover:bg-slate-900 text-white px-8"
            >
              <Sparkles className="w-4 h-4" />
              {sessioneEsistente ? "Nuova sessione" : "Avvia wizard"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (avviaMutation.isPending) {
    return (
      <div className="container max-w-3xl py-10 text-center">
        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-slate-500" />
        <p className="text-slate-500">Avvio wizard...</p>
      </div>
    );
  }

  const sid = sessioneId!;
  const vaiAStep = (step: number) => {
    setStepCorrente(step);
    aggiornaStepMutation.mutate({ sessioneId: sid, step });
  };

  return (
    <div className="container max-w-3xl py-8">
      <div className="flex items-center justify-between mb-6">
        <Link href={`/incarichi/${incaricoId}`}>
          <Button variant="outline" size="sm" className="gap-1">
            <ArrowLeft className="w-4 h-4" />Incarico
          </Button>
        </Link>
        <span className="text-xs text-slate-400">Step {stepCorrente} di 5</span>
      </div>

      <Stepper stepCorrente={stepCorrente} />

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-6">
          {stepCorrente === 1 && (
            <StepUpload
              incaricoId={incaricoId}
              documentiIncarico={(documentiIncarico ?? []) as DocumentoFascicolo[]}
              onAvanti={(files) => {
                setFilesCaricati(files);
                vaiAStep(2);
              }}
            />
          )}

          {stepCorrente === 2 && (
            <StepAnalisi
              titolo="Analisi Bilancio CEE"
              descrizione="L'AI estrae le voci principali di Stato Patrimoniale e Conto Economico, calcola gli indici e identifica anomalie contabili."
              icona={BarChart3}
              documentoId={getDocId("bilancio_revisione") ?? getDocId("bilancio_analitico")}
              sessioneId={sid}
              analizzaMutation={() => {
                const docId = getDocId("bilancio_revisione") ?? getDocId("bilancio_analitico");
                if (docId) analizzaBilancioMutation.mutate({ sessioneId: sid, documentoId: docId });
              }}
              risultati={risultatiBilancio}
              loading={analizzaBilancioMutation.isPending}
              onAvanti={() => vaiAStep(3)}
              onIndietro={() => vaiAStep(1)}
            />
          )}

          {stepCorrente === 3 && (
            <StepAnalisi
              titolo="Analisi Estratto Conto"
              descrizione="L'AI classifica i movimenti bancari, identifica pagamenti stipendi/INPS/INAIL e rileva mesi anomali."
              icona={CreditCard}
              documentoId={getDocId("estratto_conto")}
              sessioneId={sid}
              analizzaMutation={() => {
                const docId = getDocId("estratto_conto");
                if (docId) analizzaECMutation.mutate({ sessioneId: sid, documentoId: docId });
              }}
              risultati={risultatiEC}
              loading={analizzaECMutation.isPending}
              onAvanti={() => vaiAStep(4)}
              onIndietro={() => vaiAStep(2)}
            />
          )}

          {stepCorrente === 4 && (
            <StepAnalisi
              titolo="Analisi Partitario"
              descrizione="L'AI analizza crediti e debiti, identifica concentrazioni, crediti scaduti e suggerisce i candidati per la circolarizzazione ISA 505."
              icona={BookOpen}
              documentoId={getDocId("partitario")}
              sessioneId={sid}
              analizzaMutation={() => {
                const docId = getDocId("partitario");
                if (docId) analizzaPartitarioMutation.mutate({ sessioneId: sid, documentoId: docId });
              }}
              risultati={risultatiPartitario}
              loading={analizzaPartitarioMutation.isPending}
              onAvanti={() => vaiAStep(5)}
              onIndietro={() => vaiAStep(3)}
            />
          )}

          {stepCorrente === 5 && (
            <StepRiepilogo
              sessioneId={sid}
              sessione={sessioneAttiva}
              onCompletaWizard={() => completaMutation.mutate({ sessioneId: sid, confermaPopola: true })}
              onIndietro={() => vaiAStep(4)}
              loading={completaMutation.isPending}
              riepilogo={riepilogoFinale}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
