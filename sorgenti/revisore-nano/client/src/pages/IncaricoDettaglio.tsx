import { useState, useRef, useEffect } from "react";
import RevisorLayout from "@/components/revisione/RevisorLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link, useParams } from "wouter";
import {
  ChevronLeft, Upload, FileText, AlertTriangle, CheckCircle,
  Clock, ArrowRight, Loader2, Bell, Trash2, RefreshCw, Download, ExternalLink,
  Package, Building2, Banknote, Shield, TrendingUp, BarChart3, PieChart, FolderOpen, LockKeyhole
} from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { REVISION_PHASES, basePhaseStates } from "@/lib/revisionWorkflow";

const DOCUMENTI_GUIDA = [
  {
    tipi: ["bilancio_revisione", "bilancio"],
    label: "Bilancio CEE oggetto di revisione",
    uso: "Modulo 2, materialita', analisi verticale, trend e dati di bilancio",
    obbligatorio: true,
  },
  {
    tipi: ["bilancio_analitico"],
    label: "Bilancio analitico / di verifica",
    uso: "Schede di controllo, dettagli contabili e matching con saldi",
    obbligatorio: false,
  },
  {
    tipi: ["estratto_conto"],
    label: "Estratti conto bancari",
    uso: "Verifica incassi e pagamenti successivi",
    obbligatorio: true,
  },
  {
    tipi: ["partitario"],
    label: "Partitari clienti / fornitori",
    uso: "Incassi/pagamenti successivi, clienti/fornitori e circolarizzazione",
    obbligatorio: false,
  },
  {
    tipi: ["verbale_assemblea"],
    label: "Documenti societari",
    uso: "Verbali assemblea/CdA, visure e altri documenti societari. La nota integrativa e' considerata inclusa nel bilancio CEE PDF/XBRL.",
    obbligatorio: false,
  },
];

const STANDARD_ROLE_LABELS: Record<string, string> = {
  bilancioXbrl: "Bilancio XBRL",
  bilancioCivilistico: "Bilancio civilistico PDF",
  bilancioAnalitico: "Bilancio analitico / di verifica",
  notaIntegrativa: "Nota integrativa",
  clienti: "Partitario clienti",
  fornitori: "Partitario fornitori",
  partitarioGenerale: "Partitario generale",
  estrattiContoSuccessivi: "Estratti conto successivi",
  durc: "DURC",
};

function parseNumeroItaliano(value: string): number | null {
  const clean = String(value ?? "").trim().replace(/\s/g, "");
  if (!clean) return null;
  const normalized = /^\d{1,3}(\.\d{3})*(,\d+)?$/.test(clean)
    ? clean.replace(/\./g, "").replace(",", ".")
    : clean.replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function euro(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })
    : "dato da verificare";
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

function docInclusoNelleAnalisi(doc: { tipoDocumento: string | null; statoParsing: string | null }) {
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

// Componente riga documento con download sicuro (presigned URL)
function DocRow({ doc, onParse, onDelete, parsing }: {
  doc: { id: number; nomeFile: string; tipoDocumento: string | null; statoParsing: string | null; annoRiferimento?: number | null };
  onParse: () => void;
  onDelete: () => void;
  parsing: boolean;
}) {
  const utils = trpc.useUtils();
  const [rianalizzando, setRianalizzando] = useState(false);
  const rianalisaBilancio = trpc.documenti.rianalisaBilancio.useMutation({
    onSuccess: () => {
      toast.success("Ri-analisi completata — dati aggiornati");
      utils.documenti.listByIncarico.invalidate();
      setRianalizzando(false);
    },
    onError: (e) => {
      toast.error(e.message || "Errore durante la ri-analisi");
      setRianalizzando(false);
    },
  });

  const tipiBilancio = ["bilancio", "bilancio_revisione", "bilancio_storico", "bilancio_analitico"];
  const isBilancio = tipiBilancio.includes(doc.tipoDocumento || "");
  const inclusoAnalisi = docInclusoNelleAnalisi(doc);

  async function handleRianalizza() {
    setRianalizzando(true);
    rianalisaBilancio.mutate({ documentoId: doc.id });
  }

  const [downloading, setDownloading] = useState(false);
  const getPresignedUrl = trpc.documenti.getPresignedUrl.useQuery(
    { documentoId: doc.id },
    { enabled: false } // non eseguire automaticamente
  );

  async function handleDownload() {
    setDownloading(true);
    try {
      const result = await getPresignedUrl.refetch();
      if (result.data?.url) {
        const a = document.createElement("a");
        a.href = result.data.url;
        a.download = result.data.nomeFile || doc.nomeFile;
        a.target = "_blank";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } catch {
      // fallback silenzioso
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground truncate">
            {doc.nomeFile}
            {doc.annoRiferimento && <span className="ml-2 text-xs text-muted-foreground">({doc.annoRiferimento})</span>}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <Badge variant="outline" className="text-xs">{doc.tipoDocumento?.replace(/_/g, " ")}</Badge>
            <Badge className={`text-xs flex items-center gap-1 ${
              doc.statoParsing === "completato" ? "bg-emerald-100 text-emerald-700" :
              doc.statoParsing === "in_corso" ? "bg-blue-100 text-blue-700" :
              doc.statoParsing === "errore" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"
            }`}>
              {doc.statoParsing === "in_corso" && <Loader2 className="w-3 h-3 animate-spin" />}
              {doc.statoParsing === "completato" ? "analizzato" : doc.statoParsing === "in_corso" ? "analisi in corso" : doc.statoParsing === "errore" ? "errore" : "in attesa"}
            </Badge>
            {inclusoAnalisi && (
              <Badge className="text-xs flex items-center gap-1 bg-blue-100 text-blue-700">
                <CheckCircle className="w-3 h-3" /> incluso nelle analisi
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground" onClick={handleDownload} disabled={downloading} title="Scarica documento">
            {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />}
          </Button>
          {doc.statoParsing === "in_attesa" && (
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onParse} disabled={parsing} title="Analizza documento">
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
          )}
          {isBilancio && doc.statoParsing === "completato" && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-blue-600 hover:text-blue-700"
              onClick={handleRianalizza}
              disabled={rianalizzando || rianalisaBilancio.isPending}
              title="Ri-analizza con AI (aggiorna dati strutturati)"
            >
              {rianalizzando || rianalisaBilancio.isPending
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <RefreshCw className="w-3.5 h-3.5" />}
            </Button>
          )}
          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={onDelete} title="Elimina documento">
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

const MODULI = [
  { n: 1, label: "Accettazione incarico", isa: "ISA Italia 210/220", desc: "Valutazione indipendenza, competenza e accettazione" },
  { n: 2, label: "Comprensione dell'impresa", isa: "ISA Italia 315", desc: "Analisi contesto, bilancio e caratteristiche aziendali" },
  { n: 3, label: "Valutazione del rischio", isa: "ISA Italia 315/330", desc: "Rischio inerente, controllo e RMM" },
  { n: 4, label: "Materialità", isa: "ISA Italia 320", desc: "Overall Materiality, Performance Materiality, CTT" },
  { n: 5, label: "Piano di revisione", isa: "ISA Italia 300", desc: "Procedure pianificate per area di rischio" },
];

function ModuloCard({ n, label, isa, desc, stato, incaricoId }: {
  n: number; label: string; isa: string; desc: string; stato: number; incaricoId: number;
}) {
  const icon = stato === 2 ? <CheckCircle className="w-5 h-5 text-emerald-500" /> :
    stato === 1 ? <Clock className="w-5 h-5 text-blue-500" /> :
      <div className="w-5 h-5 rounded-full border-2 border-gray-300 flex items-center justify-center text-xs text-gray-400 font-bold">{n}</div>;

  const borderClass = stato === 2 ? "border-emerald-200 bg-emerald-50/30" :
    stato === 1 ? "border-blue-200 bg-blue-50/30" : "border-border";

  return (
    <Link href={`/incarichi/${incaricoId}/modulo/${n}`}>
      <Card className={`cursor-pointer hover:shadow-md transition-all ${borderClass}`}>
        <CardContent className="p-4 flex items-center gap-4">
          <div className="flex-shrink-0">{icon}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-foreground text-sm">{label}</span>
              <Badge variant="outline" className="text-xs">{isa}</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
          </div>
          <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        </CardContent>
      </Card>
    </Link>
  );
}

export default function IncaricoDettaglio() {
  const params = useParams<{ id: string }>();
  const incaricoId = parseInt(params.id);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  type TipoDoc = "bilancio_revisione" | "bilancio_storico" | "bilancio_analitico" | "nota_integrativa" | "verbale_assemblea" | "contratto" | "estratto_conto" | "libro_mastro" | "partitario" | "altro";
  const [tipoDocumento, setTipoDocumento] = useState<TipoDoc>("bilancio_revisione");
  const [annoRiferimento, setAnnoRiferimento] = useState<string>(String(new Date().getFullYear() - 1));
  const [nextcloudFolder, setNextcloudFolder] = useState("Revisioni/");
  const [forceDossierRefresh, setForceDossierRefresh] = useState(false);

  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);

  const { data: incarico } = trpc.incarichi.get.useQuery({ id: incaricoId });
  const { data: sourceStatus } = trpc.dossierSource.status.useQuery({ incaricoId });
  const { data: sourceAnalysis, isLoading: loadingSourceAnalysis, error: sourceAnalysisError, refetch: refetchSourceAnalysis } =
    trpc.dossierSource.analysis.useQuery({ incaricoId, force: forceDossierRefresh }, { enabled: Boolean(sourceStatus?.folder) });
  const { data: reconciliation, isLoading: loadingReconciliation, error: reconciliationError, refetch: refetchReconciliation } =
    trpc.dossierSource.reconciliation.useQuery(
      { incaricoId, force: forceDossierRefresh },
      { enabled: Boolean(sourceAnalysis?.standardPackage) }
    );
  const { data: sourceScan, refetch: scanSource, isFetching: scanningSource } = trpc.dossierSource.scan.useQuery(
    { incaricoId },
    { enabled: false }
  );
  const { data: documenti, refetch: refetchDocs } = trpc.documenti.listByIncarico.useQuery({ incaricoId });
  const { data: alerts, refetch: refetchAlerts } = trpc.alerts.listByIncarico.useQuery({ incaricoId });
  const { data: csvData } = trpc.documenti.esportaCsv.useQuery({ incaricoId });
  const { refetch: fetchFascicolo } = trpc.esportazione.fascicolo.useQuery(
    { incaricoId },
    { enabled: false }
  );

  const parseDoc = trpc.documenti.parse.useMutation({
    onSuccess: () => { refetchDocs(); toast.success("Documento analizzato"); },
    onError: (e) => toast.error(e.message),
  });
  const deleteDoc = trpc.documenti.delete.useMutation({
    onSuccess: () => { refetchDocs(); toast.success("Documento eliminato"); },
  });
  const markAllRead = trpc.alerts.markAllRead.useMutation({
    onSuccess: () => refetchAlerts(),
  });
  const connectSource = trpc.dossierSource.connect.useMutation({
    onSuccess: async data => {
      setNextcloudFolder(data.folder);
      toast.success("Cartella Revisioni collegata");
      await scanSource();
    },
    onError: error => toast.error(error.message),
  });

  useEffect(() => {
    if (sourceStatus?.folder) setNextcloudFolder(sourceStatus.folder);
  }, [sourceStatus?.folder]);

  useEffect(() => {
    if (forceDossierRefresh && !loadingSourceAnalysis && !loadingReconciliation) setForceDossierRefresh(false);
  }, [forceDossierRefresh, loadingSourceAnalysis, loadingReconciliation]);

  // Polling automatico per documenti in analisi
  const hasDocInCorso = documenti?.some(d => d.statoParsing === "in_corso");
  useEffect(() => {
    if (!hasDocInCorso) return;
    const timer = setInterval(() => refetchDocs(), 3000);
    return () => clearInterval(timer);
  }, [hasDocInCorso]);

  const uploadDoc = trpc.documenti.upload.useMutation({
    onSuccess: () => {
      refetchDocs();
      toast.success("Documento caricato — analisi in corso...");
      // Polling ogni 3s finché almeno un doc è ancora in_corso
      const pollInterval = setInterval(async () => {
        const result = await refetchDocs();
        const stillParsing = result.data?.some(d => d.statoParsing === "in_corso");
        if (!stillParsing) clearInterval(pollInterval);
      }, 3000);
      setTimeout(() => clearInterval(pollInterval), 120000); // max 2 min
    },
    onError: (e) => toast.error(e.message),
  });

  const stati = incarico ? [
    incarico.statoModulo1 ?? 0,
    incarico.statoModulo2 ?? 0,
    incarico.statoModulo3 ?? 0,
    incarico.statoModulo4 ?? 0,
    incarico.statoModulo5 ?? 0,
  ] : [0, 0, 0, 0, 0];
  const completati = stati.filter(s => s === 2).length;
  const unreadAlerts = alerts?.filter(a => !a.letto).length || 0;
  const fasi = basePhaseStates(incarico);
  if (sourceStatus?.folder) fasi[1] = 2;
  if (sourceAnalysis?.auditPackage) fasi[2] = 2;
  if (reconciliation?.available) fasi[3] = 2;
  else if (sourceAnalysis?.standardPackage) fasi[3] = 1;
  const accettazioneCompletata = fasi[0] === 2;
  const prossimaFase = REVISION_PHASES.find(fase => fasi[fase.n - 1] !== 2) ?? REVISION_PHASES[9];
  const fasiCompletate = fasi.filter(stato => stato === 2).length;

  async function handleExportPdf() {
    setExportingPdf(true);
    try {
      // Download diretto dal server — nessuna finestra di stampa
      const response = await fetch(`/api/fascicolo-pdf/${incaricoId}`, {
        method: "GET",
        credentials: "include", // invia il cookie di sessione
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Errore sconosciuto" }));
        throw new Error(err.error || `Errore ${response.status}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // Usa il nome file dall'header Content-Disposition se disponibile
      const disposition = response.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="([^"]+)"/);
      a.download = match?.[1] || `fascicolo-incarico-${incaricoId}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Fascicolo PDF scaricato con successo");
    } catch (e: any) {
      toast.error(e.message || "Errore durante l'esportazione PDF");
    } finally {
      setExportingPdf(false);
    }
  }

  function handleExportCsv() {
    if (!csvData?.csv) { toast.error("Nessun dato estratto da esportare. Carica e analizza almeno un documento."); return; }
    setExportingCsv(true);
    try {
      const blob = new Blob([csvData.csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dati-estratti-incarico-${incaricoId}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`CSV esportato — ${csvData.righe} documento/i, ${csvData.colonne} colonne`);
    } catch (e: any) {
      toast.error(e.message || "Errore durante l'esportazione CSV");
    } finally {
      setExportingCsv(false);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    for (const file of files) {
      const ext = file.name.split(".").pop()?.toLowerCase() || "altro";
      const tipoFile = ["pdf", "xml", "xbrl", "xlsx", "csv"].includes(ext) ? ext as any : "altro";
      await new Promise<void>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (ev) => {
          try {
            const base64 = (ev.target?.result as string).split(",")[1];
            let testoEstratto: string | undefined;
            let datiStrutturatiClient: Record<string, unknown> | undefined;

            if (tipoFile === "pdf") {
              testoEstratto = await extractPdfText(file);
              datiStrutturatiClient = tipoDocumento === "partitario"
                ? parsePartitarioPdfText(testoEstratto, file.name)
                : parseBilancioPdfText(testoEstratto, file.name);
            }

            await uploadDoc.mutateAsync({
              incaricoId,
              nomeFile: file.name,
              tipoFile,
              tipoDocumento,
              annoRiferimento: ["bilancio_revisione", "bilancio_storico", "bilancio_analitico"].includes(tipoDocumento) && annoRiferimento ? parseInt(annoRiferimento) : undefined,
              contenutoBase64: base64,
              testoEstratto,
              datiStrutturatiClient,
              dimensioneBytes: file.size,
            });
            resolve();
          } catch (err) { reject(err); }
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
    setUploading(false);
  }

  const documentiFascicolo = documenti ?? [];
  const documentiAnalizzati = documentiFascicolo.filter(docInclusoNelleAnalisi).length;
  const documentiConErrore = documentiFascicolo.filter(d => d.statoParsing === "errore").length;

  return (
    <RevisorLayout incaricoId={incaricoId}>
      <div className="p-6 max-w-4xl mx-auto">
        {/* Back */}
        {incarico?.cliente && (
          <Link href={`/clienti/${incarico.clienteId}`}>
            <Button variant="ghost" size="sm" className="mb-4 -ml-2 text-muted-foreground">
              <ChevronLeft className="w-4 h-4 mr-1" /> {incarico.cliente.ragioneSociale}
            </Button>
          </Link>
        )}

        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Fascicolo {incarico?.annoEsercizio}
            </h1>
            <p className="text-muted-foreground mt-1">
              {incarico?.cliente?.ragioneSociale} · {incarico?.tipoIncarico?.replace(/_/g, " ")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {unreadAlerts > 0 && (
              <Button variant="outline" size="sm" className="gap-2" onClick={() => markAllRead.mutate({ incaricoId })}>
                <Bell className="w-4 h-4 text-amber-500" />
                <span className="text-amber-600 font-medium">{unreadAlerts} alert</span>
              </Button>
            )}
            <Button variant="outline" size="sm" className="gap-2" onClick={handleExportCsv} disabled={exportingCsv}>
              {exportingCsv ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              CSV
            </Button>
            <Button size="sm" className="gap-2 bg-[#1e3a5f] hover:bg-[#162d4a]" onClick={handleExportPdf} disabled={exportingPdf}>
              {exportingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              Esporta PDF
            </Button>
          </div>
        </div>

        {/* Percorso unico del fascicolo */}
        <Card className="mb-6 border-slate-300 overflow-hidden">
          <CardHeader className="bg-slate-50 border-b pb-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-lg">Percorso di revisione</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">Un solo iter sequenziale. Le funzioni già disponibili sono collocate nella relativa fase.</p>
              </div>
              <Badge className="bg-slate-900 text-white">{fasiCompletate}/10 completate</Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {!accettazioneCompletata && (
              <div className="m-4 rounded-lg border border-amber-300 bg-amber-50 p-3 flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-amber-900">Prima attività: completare l'accettazione dell'incarico</p>
                  <p className="text-xs text-amber-800 mt-1">Le altre fasi restano consultabili, ma non vengono considerate avviate finché il revisore non conferma l'accettazione.</p>
                </div>
                <Link href={`/incarichi/${incaricoId}/modulo/1`}><Button size="sm" className="whitespace-nowrap">Apri accettazione</Button></Link>
              </div>
            )}
            <div className="divide-y">
              {REVISION_PHASES.map(fase => {
                const stato = fasi[fase.n - 1] ?? 0;
                const bloccata = fase.n > 1 && !accettazioneCompletata;
                const statoLabel = bloccata ? "Consultabile" : stato === 2 ? "Completata" : stato === 1 ? "In corso" : "Da iniziare";
                return (
                  <Link key={fase.n} href={fase.href(incaricoId)}>
                    <div className={`px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-slate-50 ${bloccata ? "opacity-65" : ""}`}>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${stato === 2 && !bloccata ? "bg-emerald-100 text-emerald-700" : stato === 1 && !bloccata ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
                        {bloccata ? <LockKeyhole className="w-3.5 h-3.5" /> : stato === 2 ? <CheckCircle className="w-4 h-4" /> : fase.n}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap"><span className="text-sm font-medium">{fase.n}. {fase.title}</span><span className="text-[10px] text-slate-500">{fase.isa}</span></div>
                        <p className="text-xs text-muted-foreground mt-0.5">{fase.description}</p>
                      </div>
                      <Badge variant="outline" className={stato === 2 && !bloccata ? "border-emerald-200 text-emerald-700" : stato === 1 && !bloccata ? "border-blue-200 text-blue-700" : "text-slate-500"}>{statoLabel}</Badge>
                      <ArrowRight className="w-4 h-4 text-slate-400" />
                    </div>
                  </Link>
                );
              })}
            </div>
            {accettazioneCompletata && (
              <div className="border-t bg-blue-50 p-3 flex items-center justify-between gap-3">
                <div><p className="text-xs text-blue-700">Prossima attività</p><p className="text-sm font-semibold text-blue-950">{prossimaFase.n}. {prossimaFase.title}</p></div>
                <Link href={prossimaFase.href(incaricoId)}><Button size="sm">Continua</Button></Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Analisi automatica della cartella Revisioni */}
        {sourceStatus?.folder && (
          <Card id="analisi-preliminare" className="mb-6 border-indigo-200 bg-indigo-50/30 scroll-mt-4">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <FolderOpen className="w-4 h-4 text-indigo-600" />
                    Analisi preliminare automatica {incarico?.annoEsercizio}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    Lettura locale dei documenti presenti in {sourceStatus.folder}; ogni dato conserva il collegamento al file fonte.
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => refetchSourceAnalysis()} disabled={loadingSourceAnalysis}>
                  <RefreshCw className={`w-3.5 h-3.5 mr-2 ${loadingSourceAnalysis ? "animate-spin" : ""}`} />
                  Aggiorna
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {loadingSourceAnalysis ? (
                <div className="flex items-center gap-2 text-sm text-indigo-700"><Loader2 className="w-4 h-4 animate-spin" /> Lettura bilanci e DURC in corso…</div>
              ) : sourceAnalysisError ? (
                <p className="text-sm text-red-700">Analisi non disponibile: {sourceAnalysisError.message}</p>
              ) : sourceAnalysis?.auditPackage ? (
                <div className="space-y-4">
                  <div className="grid md:grid-cols-3 gap-3">
                    <div className="rounded-lg border bg-white p-3">
                      <p className="text-xs text-muted-foreground">Bilanci storici</p>
                      <p className="text-2xl font-semibold">{sourceAnalysis.auditPackage.historicalBalances?.length ?? 0}</p>
                      <p className="text-xs text-slate-500">approvati/depositati individuati</p>
                    </div>
                    <div className="rounded-lg border bg-white p-3">
                      <p className="text-xs text-muted-foreground">Situazioni infrannuali</p>
                      <p className="text-2xl font-semibold">{sourceAnalysis.auditPackage.interimBalances?.length ?? 0}</p>
                      <p className="text-xs text-slate-500">sempre marcate come provvisorie</p>
                    </div>
                    <div className="rounded-lg border bg-white p-3">
                      <p className="text-xs text-muted-foreground">DURC</p>
                      <p className="text-2xl font-semibold">{sourceAnalysis.auditPackage.durc?.length ?? 0}</p>
                      <p className="text-xs text-slate-500">documenti con validità rilevata</p>
                    </div>
                  </div>

                  {(sourceAnalysis.auditPackage.historicalBalances ?? []).length > 0 && (
                    <div>
                      <p className="text-sm font-medium mb-2">Storico economico-finanziario</p>
                      <div className="space-y-1.5">
                        {sourceAnalysis.auditPackage.historicalBalances.map((item: any) => (
                          <div key={item.path} className="rounded border bg-white px-3 py-2 text-xs flex flex-wrap gap-x-4 gap-y-1">
                            <span className="font-semibold">{item.year}</span>
                            <span>Ricavi: {euro(item.values?.ricavi)}</span>
                            <span>Attivo: {euro(item.values?.totaleAttivo)}</span>
                            <span>PN: {euro(item.values?.patrimonioNetto)}</span>
                            <span className="text-slate-500 truncate">Fonte: {item.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {(sourceAnalysis.auditPackage.interimBalances ?? []).length > 0 && (
                    <div>
                      <p className="text-sm font-medium mb-2">Andamento infrannuale — dati provvisori</p>
                      <div className="space-y-1.5">
                        {sourceAnalysis.auditPackage.interimBalances.map((item: any) => (
                          <div key={item.path} className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs flex flex-wrap gap-x-4 gap-y-1">
                            <Badge className="bg-amber-100 text-amber-800">Provvisorio</Badge>
                            <span>{item.referenceDate ? new Date(`${item.referenceDate}T00:00:00`).toLocaleDateString("it-IT") : item.year}</span>
                            <span>Ricavi: {euro(item.values?.ricavi)}</span>
                            <span className="text-slate-500 truncate">Fonte: {item.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {(sourceAnalysis.auditPackage.durc ?? []).map((item: any) => (
                    <div key={item.path} className={`rounded-lg border p-3 ${item.coversYearEnd ? "border-emerald-200 bg-emerald-50" : "border-amber-300 bg-amber-50"}`}>
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Shield className="w-4 h-4" /> DURC — scadenza {item.expiryDate ? new Date(`${item.expiryDate}T00:00:00`).toLocaleDateString("it-IT") : "da verificare"}
                      </div>
                      <p className="text-xs mt-1">{item.coversYearEnd ? "Copertura presente alla chiusura dell’esercizio." : `Non copre il 31/12/${incarico?.annoEsercizio}: occorre un documento successivo o altra evidenza.`}</p>
                      <p className="text-xs text-slate-500 mt-1">Fonte: {item.name}</p>
                    </div>
                  ))}

                  {(sourceAnalysis.auditPackage.missingDocuments ?? []).length > 0 && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                      <p className="text-sm font-medium text-red-800">Documenti/evidenze ancora necessari</p>
                      <ul className="mt-1 text-xs text-red-700 list-disc pl-5 space-y-0.5">
                        {sourceAnalysis.auditPackage.missingDocuments.map((name: string) => <li key={name}>{name}</li>)}
                      </ul>
                    </div>
                  )}

                  {sourceAnalysis.standardPackage && (
                    <div className="border-t border-indigo-200 pt-4 space-y-4">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">Pacchetto documentale standard</p>
                        <p className="text-xs text-slate-500 mt-0.5">Regole riutilizzabili per clienti che forniscono la stessa tipologia di documenti.</p>
                      </div>
                      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {Object.entries(sourceAnalysis.standardPackage.documents ?? {}).map(([role, docs]: [string, any]) => {
                          const items = Array.isArray(docs) ? docs : [];
                          const needsOcr = items.some((doc: any) => doc.requiresOcr);
                          return (
                            <div key={role} className={`rounded border px-3 py-2 ${items.length ? "bg-white border-emerald-200" : "bg-slate-50 border-slate-200"}`}>
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-medium">{STANDARD_ROLE_LABELS[role] ?? role}</span>
                                {items.length ? <CheckCircle className="w-3.5 h-3.5 text-emerald-600" /> : <Clock className="w-3.5 h-3.5 text-slate-400" />}
                              </div>
                              <p className="text-[11px] text-slate-500 mt-1">{items.length ? `${items.length} file riconosciuti` : "Non individuato"}{needsOcr ? " · OCR necessario" : ""}</p>
                            </div>
                          );
                        })}
                      </div>

                      <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                        Le procedure vengono predisposte automaticamente; conclusioni e completamento richiedono sempre la conferma del revisore.
                      </p>
                    </div>
                  )}
                </div>
              ) : null}
            </CardContent>
          </Card>
        )}

        {sourceAnalysis?.standardPackage && (
          <Card id="quadrature" className="mb-6 border-blue-200 scroll-mt-4">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-blue-600" />
                    Motore automatico di quadratura
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">XBRL, partitario generale, clienti e fornitori elaborati direttamente dalle fonti.</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setForceDossierRefresh(true)} disabled={loadingReconciliation}>
                  <RefreshCw className={`w-3.5 h-3.5 mr-2 ${loadingReconciliation ? "animate-spin" : ""}`} />Ricalcola
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {loadingReconciliation ? (
                <div className="flex items-center gap-2 text-sm text-blue-700"><Loader2 className="w-4 h-4 animate-spin" /> Quadrature automatiche in corso…</div>
              ) : reconciliationError ? (
                <p className="text-sm text-red-700">Errore nelle quadrature: {reconciliationError.message}</p>
              ) : reconciliation?.available ? (
                <div className="space-y-4">
                  <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
                    <div className="rounded border bg-slate-50 p-3"><p className="text-[11px] text-slate-500">Partitario generale</p><p className="font-semibold">{reconciliation.populations.general.rows.toLocaleString("it-IT")} movimenti</p><p className="text-[11px] text-slate-500">{reconciliation.populations.general.accounts} conti</p></div>
                    <div className="rounded border bg-slate-50 p-3"><p className="text-[11px] text-slate-500">Clienti</p><p className="font-semibold">{reconciliation.populations.customers.entities.toLocaleString("it-IT")} soggetti</p><p className="text-[11px] text-slate-500">{reconciliation.populations.customers.rows.toLocaleString("it-IT")} movimenti</p></div>
                    <div className="rounded border bg-slate-50 p-3"><p className="text-[11px] text-slate-500">Fornitori</p><p className="font-semibold">{reconciliation.populations.suppliers.entities.toLocaleString("it-IT")} soggetti</p><p className="text-[11px] text-slate-500">{reconciliation.populations.suppliers.rows.toLocaleString("it-IT")} movimenti</p></div>
                    <div className="rounded border bg-slate-50 p-3"><p className="text-[11px] text-slate-500">Bilancio XBRL</p><p className="font-semibold">{reconciliation.xbrl.anno}</p><p className="text-[11px] text-slate-500">Attivo {euro(reconciliation.xbrl.totaleAttivo)}</p></div>
                  </div>
                  <div className="space-y-2">
                    {reconciliation.checks.map((check: any) => (
                      <div key={check.id} className={`rounded-lg border p-3 ${check.status === "quadrato" ? "border-emerald-200 bg-emerald-50" : check.status === "differenza" ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-sm font-medium">{check.title}</span>
                          <Badge className={check.status === "quadrato" ? "bg-emerald-100 text-emerald-700" : check.status === "differenza" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}>
                            {check.status === "quadrato" ? "Quadrato" : check.status === "differenza" ? "Differenza rilevata" : "Da verificare"}
                          </Badge>
                        </div>
                        <p className="text-xs text-slate-600 mt-1">{check.criterion}</p>
                        {typeof check.difference === "number" && <p className="text-xs mt-1">Differenza: <strong>{euro(check.difference)}</strong></p>}
                        {(check.exceptions ?? []).length > 0 && (
                          <div className="mt-2 space-y-1">
                            {check.exceptions.slice(0, 5).map((item: any) => (
                              <div key={item.key} className="text-xs rounded bg-white/70 border px-2 py-1 flex flex-wrap gap-x-3">
                                <span>Conto {item.accountCode}</span>
                                {item.entityName && <span>{item.entityName}</span>}
                                <span>Differenza <strong>{euro(item.difference)}</strong></span>
                                {item.targetRow && <span className="text-slate-500">riga partitario {item.targetRow}</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {reconciliation.coherence && (
                    <div className="border-t pt-4 space-y-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">Coerenza storica e priorità delle poste</p>
                        <p className="text-xs text-slate-500 mt-0.5">Ordine proposto in base a saldo, significatività, variazione e natura della posta.</p>
                      </div>
                      <div className="grid sm:grid-cols-3 gap-2">
                        <div className="rounded border bg-blue-50 p-3"><p className="text-[11px] text-slate-500">Significatività proposta</p><p className="font-semibold">{euro(reconciliation.coherence.materialityProposal.materiality)}</p></div>
                        <div className="rounded border bg-blue-50 p-3"><p className="text-[11px] text-slate-500">Significatività operativa</p><p className="font-semibold">{euro(reconciliation.coherence.materialityProposal.operatingMateriality)}</p></div>
                        <div className="rounded border bg-blue-50 p-3"><p className="text-[11px] text-slate-500">Errore trascurabile</p><p className="font-semibold">{euro(reconciliation.coherence.materialityProposal.trivialThreshold)}</p></div>
                      </div>
                      <p className="text-xs rounded border border-amber-200 bg-amber-50 p-2 text-amber-800">{reconciliation.coherence.materialityProposal.rationale}</p>
                      {(["SP", "CE"] as const).map(statement => {
                        const benchmark = reconciliation.coherence.benchmarks?.[statement];
                        const areas = reconciliation.coherence.areas.filter((area: any) => area.statement === statement);
                        return (
                        <div key={statement} className="overflow-x-auto rounded border">
                          <div className="bg-slate-800 text-white px-3 py-2 flex justify-between gap-3"><span className="font-semibold text-sm">{statement === "SP" ? "Stato patrimoniale" : "Conto economico"}</span><span className="text-xs">{benchmark?.label}: {euro(benchmark?.value)} = 100%</span></div>
                          <table className="w-full text-xs">
                            <thead className="bg-slate-100 text-slate-600">
                              <tr><th className="text-left p-2">Ordine</th><th className="text-left p-2">Posta / procedure</th><th className="text-right p-2">{reconciliation.coherence.years[2]}</th><th className="text-right p-2">{reconciliation.coherence.years[1]}</th><th className="text-right p-2">{reconciliation.coherence.years[0]}</th><th className="text-right p-2">Peso</th><th className="text-left p-2">Priorità</th></tr>
                            </thead>
                            <tbody>
                            {areas.map((area: any, index: number) => (
                              <tr key={area.key} className="border-t align-top">
                                <td className="p-2 text-slate-500">{index + 1}</td>
                                <td className="p-2 min-w-[260px]">
                                  <p className={`font-medium ${area.isSubaccount ? "pl-4 text-blue-700" : ""}`}>{area.isSubaccount ? "↳ " : ""}{area.label}</p>
                                  <p className="text-[11px] text-slate-500">Asserzioni: {area.assertions}</p>
                                  <p className="text-[11px] text-slate-400">{(area.reasons ?? []).join(" · ") || "nessuna anomalia specifica"}</p>
                                  {area.controlPlan && (
                                    <div className="mt-1.5 border-t pt-1.5 space-y-1">
                                      <p className="text-[11px]"><span className="font-medium text-emerald-700">Eseguite automaticamente:</span> {(area.controlPlan.executedProcedures ?? []).map((procedure: any) => procedure.title).join(" · ") || "nessuna"}</p>
                                      <p className="text-[11px]"><span className="font-medium text-amber-700">Suggerite:</span> {(area.controlPlan.suggestedProcedures ?? []).map((procedure: any) => procedure.title).join(" · ") || "nessuna"}</p>
                                    </div>
                                  )}
                                </td>
                                <td className="p-2 text-right whitespace-nowrap">{euro(area.value)}</td>
                                <td className="p-2 text-right whitespace-nowrap">{euro(area.previousValue)}</td>
                                <td className="p-2 text-right whitespace-nowrap">{area.previousPreviousValue ? euro(area.previousPreviousValue) : "n.d."}</td>
                                <td className="p-2 text-right whitespace-nowrap font-semibold">{area.incidencePercent == null ? "n.d." : `${area.incidencePercent.toLocaleString("it-IT")}%`}</td>
                                <td className="p-2"><Badge className={area.priority === "molto_alta" ? "bg-red-100 text-red-700" : area.priority === "alta" ? "bg-orange-100 text-orange-700" : area.priority === "media" ? "bg-yellow-100 text-yellow-700" : "bg-slate-100 text-slate-600"}>{String(area.priority).replace("_", " ")}</Badge></td>
                              </tr>
                            ))}
                            </tbody>
                          </table>
                        </div>
                        );
                      })}
                      {reconciliation.fragmentedAreas && (
                        <div className="border-t pt-4 space-y-3">
                          <div>
                            <p className="text-sm font-semibold text-slate-800">Dettaglio delle poste frammentate</p>
                            <p className="text-xs text-slate-500 mt-0.5">Controparti ordinate per esposizione: la selezione preliminare copre almeno l'80% della popolazione e include saldi significativi o di segno anomalo.</p>
                          </div>
                          {([
                            ["customers", "Clienti"],
                            ["suppliers", "Fornitori"],
                          ] as const).map(([key, label]) => {
                            const area = reconciliation.fragmentedAreas[key];
                            const visibleRows = (area.ranked ?? []).filter((row: any) => row.preliminaryPriority);
                            return (
                              <div key={key} className="rounded-lg border overflow-hidden">
                                <div className="bg-slate-50 px-3 py-2 flex items-center justify-between gap-3 flex-wrap">
                                  <div>
                                    <p className="text-sm font-semibold">{label}</p>
                                    <p className="text-[11px] text-slate-500">Esposizione {euro(area.totalExposure)} · {area.totalCounterparties} controparti</p>
                                  </div>
                                  <Badge className="bg-blue-100 text-blue-700">{area.priorityCounterparties} prioritarie</Badge>
                                </div>
                                <div className="overflow-x-auto">
                                  <table className="w-full text-xs">
                                    <thead className="bg-white text-slate-500">
                                      <tr><th className="text-left p-2">Ordine</th><th className="text-left p-2">Controparte</th><th className="text-right p-2">Saldo</th><th className="text-right p-2">Incidenza</th><th className="text-right p-2">Copertura</th><th className="text-left p-2">Criterio di inclusione</th></tr>
                                    </thead>
                                    <tbody>
                                      {visibleRows.map((row: any) => (
                                        <tr key={`${key}-${row.entityCode}`} className="border-t align-top">
                                          <td className="p-2 text-slate-500">{row.rank}</td>
                                          <td className="p-2 min-w-[220px]"><p className="font-medium">{row.entityName}</p><p className="text-[11px] text-slate-400">Cod. {row.entityCode} · conto {row.accountCode} · riga fonte {row.sourceRow}</p></td>
                                          <td className={`p-2 text-right whitespace-nowrap ${row.contraSign ? "text-red-700 font-semibold" : ""}`}>{euro(row.balance)}{row.contraSign && <p className="text-[10px]">segno anomalo</p>}</td>
                                          <td className="p-2 text-right whitespace-nowrap">{row.incidencePercent.toLocaleString("it-IT")}%</td>
                                          <td className="p-2 text-right whitespace-nowrap">{row.cumulativePercent.toLocaleString("it-IT")}%</td>
                                          <td className="p-2 min-w-[220px]">{(row.reasons ?? []).join(" · ")}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            );
                          })}
                          <p className="text-[11px] rounded border border-amber-200 bg-amber-50 p-2 text-amber-800">La selezione è una proposta iniziale. Il revisore la completa considerando rischio, operazioni successive, eccezioni di quadratura e natura delle controparti.</p>
                        </div>
                      )}
                    </div>
                  )}
                  <p className="text-[11px] text-slate-500">Motore {reconciliation.engineVersion}. Le fonti sono identificate tramite impronta SHA-256; ogni ricalcolo usa i file attualmente presenti in Nextcloud.</p>
                </div>
              ) : (
                <p className="text-sm text-amber-700">Quadratura non disponibile: mancano {reconciliation?.missing?.join(", ") || "documenti richiesti"}.</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Mappa documentale */}
        <Card id="documenti" className="mb-6 border-slate-200 scroll-mt-4">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Package className="w-4 h-4 text-slate-600" />
                  Mappa documentale del fascicolo
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Riepilogo dei documenti caricati e di quelli effettivamente disponibili per le analisi automatiche.
                </p>
              </div>
              <div className="flex gap-2">
                <Badge variant="outline" className="text-xs">{documentiFascicolo.length} caricati</Badge>
                <Badge className="text-xs bg-blue-100 text-blue-700">{documentiAnalizzati} inclusi</Badge>
                {documentiConErrore > 0 && <Badge className="text-xs bg-red-100 text-red-700">{documentiConErrore} errori</Badge>}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            {DOCUMENTI_GUIDA.map(item => {
              const docsVoce = documentiFascicolo.filter(d => item.tipi.includes(d.tipoDocumento ?? ""));
              const bilanciConNota = item.label === "Documenti societari"
                ? documentiFascicolo.filter(d => ["bilancio", "bilancio_revisione", "bilancio_storico"].includes(d.tipoDocumento ?? ""))
                : [];
              const presente = docsVoce.length > 0;
              const incluso = docsVoce.some(docInclusoNelleAnalisi);
              const inCorso = docsVoce.some(d => d.statoParsing === "in_corso");
              const errore = docsVoce.some(d => d.statoParsing === "errore");
              const notaIntegrativaCoperta = bilanciConNota.some(d => d.statoParsing === "completato");

              return (
                <div key={item.label} className={`rounded-lg border p-3 ${
                  incluso || notaIntegrativaCoperta ? "bg-emerald-50/50 border-emerald-200" :
                  presente ? "bg-blue-50/40 border-blue-200" :
                  item.obbligatorio ? "bg-amber-50/50 border-amber-200" : "bg-white border-slate-200"
                }`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                      incluso || notaIntegrativaCoperta ? "bg-emerald-100 text-emerald-700" :
                      inCorso ? "bg-blue-100 text-blue-700" :
                      errore ? "bg-red-100 text-red-700" :
                      presente ? "bg-slate-100 text-slate-600" : "bg-amber-100 text-amber-700"
                    }`}>
                      {inCorso ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
                        incluso || notaIntegrativaCoperta ? <CheckCircle className="w-3.5 h-3.5" /> :
                        presente ? <FileText className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-foreground">{item.label}</span>
                        {item.obbligatorio && <Badge className="text-[11px] bg-red-100 text-red-700">Obbligatorio</Badge>}
                        {presente && <Badge className="text-[11px] bg-emerald-100 text-emerald-700">Caricato</Badge>}
                        {incluso && <Badge className="text-[11px] bg-blue-100 text-blue-700">Incluso nelle analisi</Badge>}
                        {notaIntegrativaCoperta && <Badge className="text-[11px] bg-emerald-100 text-emerald-700">Nota integrativa nel bilancio</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">Uso: {item.uso}</p>
                      {docsVoce.length > 0 ? (
                        <div className="mt-2 space-y-1">
                          {docsVoce.slice(0, 3).map(d => (
                            <div key={d.id} className="flex items-center gap-2 text-xs text-slate-600">
                              <span className="truncate">{d.nomeFile}</span>
                              {d.annoRiferimento && <span className="text-slate-400">({d.annoRiferimento})</span>}
                              <span className="text-slate-400">- {statoDocumentoLabel(d.statoParsing)}</span>
                            </div>
                          ))}
                          {docsVoce.length > 3 && <p className="text-xs text-slate-400">+ altri {docsVoce.length - 3} documenti</p>}
                        </div>
                      ) : notaIntegrativaCoperta ? (
                        <p className="text-xs text-emerald-700 mt-1">
                          Nessun documento societario separato caricato. Nota integrativa coperta dal bilancio CEE/PDF/XBRL gia' analizzato.
                        </p>
                      ) : (
                        <p className="text-xs text-slate-500 mt-1">Nessun documento societario separato caricato.</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Alert */}
        {alerts && alerts.filter(a => !a.letto).length > 0 && (
          <div className="mb-6 space-y-2">
            {alerts.filter(a => !a.letto).slice(0, 3).map(alert => (
              <div key={alert.id} className={`flex items-start gap-3 p-3 rounded-lg border ${alert.severita === "critical" ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"}`}>
                <AlertTriangle className={`w-4 h-4 flex-shrink-0 mt-0.5 ${alert.severita === "critical" ? "text-red-500" : "text-amber-500"}`} />
                <div>
                  <div className={`text-sm font-medium ${alert.severita === "critical" ? "text-red-700" : "text-amber-700"}`}>{alert.titolo}</div>
                  <div className={`text-xs mt-0.5 ${alert.severita === "critical" ? "text-red-600" : "text-amber-600"}`}>{alert.messaggio}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Moduli */}
        <div className="hidden">
          <h2 className="text-lg font-semibold text-foreground mb-3">Moduli di revisione</h2>
          <div className="space-y-2">
            {MODULI.map((m, i) => (
              <ModuloCard key={m.n} {...m} stato={stati[i]} incaricoId={incaricoId} />
            ))}
          </div>
        </div>

        {/* Circolarizzazione */}
        <div className="hidden">
          <h2 className="text-lg font-semibold text-foreground mb-3">Verifiche di dettaglio</h2>
          <Link href={`/incarichi/${incaricoId}/circolarizzazione`}>
            <Card className="cursor-pointer hover:shadow-md transition-all border-indigo-200 bg-indigo-50/30">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center">
                    <FileText className="w-4 h-4 text-indigo-600" />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-foreground text-sm">Circolarizzazione Saldi</span>
                    <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">ISA Italia 505</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">Selezione campione AI, lettere Word per clienti/fornitori, follow-up risposte</p>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              </CardContent>
            </Card>
          </Link>
          <Link href={`/incarichi/${incaricoId}/verifica-incassi`} className="mt-3 block">
            <Card className="cursor-pointer hover:shadow-md transition-all border-teal-200 bg-teal-50/30">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 rounded-full bg-teal-100 flex items-center justify-center">
                    <CheckCircle className="w-4 h-4 text-teal-600" />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-foreground text-sm">Verifica Incassi e Pagamenti Successivi</span>
                    <span className="text-xs bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full">ISA Italia 560</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">Confronto partitari clienti/fornitori con estratto conto bancario Q1 anno successivo</p>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              </CardContent>
            </Card>
          </Link>

          <Link href={`/incarichi/${incaricoId}/verifica-ricavi-costi`} className="mt-3 block">
            <Card className="cursor-pointer hover:shadow-md transition-all border-violet-200 bg-violet-50/30">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center">
                    <TrendingUp className="w-4 h-4 text-violet-600" />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-foreground text-sm">Verifica Ricavi e Costi</span>
                    <span className="text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full">ISA Italia 500 · 330</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">Analisi comparativa CE, check anomalie (margine, ammortamenti, oneri finanziari), checklist procedure</p>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              </CardContent>
            </Card>
          </Link>

          {/* Schede di controllo aree di bilancio */}
          <h3 className="text-sm font-semibold text-muted-foreground mt-5 mb-2 uppercase tracking-wide">Schede di controllo aree di bilancio</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Link href={`/incarichi/${incaricoId}/scheda-rimanenze`}>
              <Card className="cursor-pointer hover:shadow-md transition-all border-amber-200 bg-amber-50/30 h-full">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                    <Package className="w-4 h-4 text-amber-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium text-foreground text-sm">Rimanenze</span>
                      <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">ISA 501</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">Conteggio fisico, valorizzazione, obsolescenza</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                </CardContent>
              </Card>
            </Link>
            <Link href={`/incarichi/${incaricoId}/scheda-immobilizzazioni`}>
              <Card className="cursor-pointer hover:shadow-md transition-all border-blue-200 bg-blue-50/30 h-full">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-4 h-4 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium text-foreground text-sm">Immobilizzazioni</span>
                      <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">ISA 500/501</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">Registro cespiti, ammortamenti, acquisizioni</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                </CardContent>
              </Card>
            </Link>
            <Link href={`/incarichi/${incaricoId}/scheda-disponibilita-liquide`}>
              <Card className="cursor-pointer hover:shadow-md transition-all border-green-200 bg-green-50/30 h-full">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                    <Banknote className="w-4 h-4 text-green-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium text-foreground text-sm">Disponibilità Liquide</span>
                      <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">ISA 500/505</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">Riconciliazione bancaria, cassa, estratti conto</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                </CardContent>
              </Card>
            </Link>
            <Link href={`/incarichi/${incaricoId}/scheda-patrimonio-netto`}>
              <Card className="cursor-pointer hover:shadow-md transition-all border-indigo-200 bg-indigo-50/30 h-full">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                    <Shield className="w-4 h-4 text-indigo-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium text-foreground text-sm">Patrimonio Netto</span>
                      <span className="text-xs bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full">ISA 500</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">Variazioni PN, dividendi, copertura perdite</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                </CardContent>
              </Card>
            </Link>
            <Link href={`/incarichi/${incaricoId}/scheda-ricavi`}>
              <Card className="cursor-pointer hover:shadow-md transition-all border-teal-200 bg-teal-50/30 h-full">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-teal-100 flex items-center justify-center flex-shrink-0">
                    <TrendingUp className="w-4 h-4 text-teal-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium text-foreground text-sm">Ricavi e Costi</span>
                      <span className="text-xs bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded-full">ISA 240/315</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">Completezza, cut-off, anomalie, concentrazione</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                </CardContent>
              </Card>
            </Link>
          </div>

          {/* Piano Controlli + Analisi Verticale */}
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <Link href={`/incarichi/${incaricoId}/piano-controlli`}>
              <Card className="cursor-pointer hover:shadow-md transition-all border-purple-200 bg-purple-50/30 h-full">
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center">
                      <BarChart3 className="w-4 h-4 text-purple-600" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-foreground text-sm">Piano dei Controlli</span>
                      <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">AI</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">Prioritizzazione AI di tutte le aree di bilancio</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                </CardContent>
              </Card>
            </Link>
            <Link href={`/incarichi/${incaricoId}/analisi-verticale`}>
              <Card className="cursor-pointer hover:shadow-md transition-all border-blue-200 bg-blue-50/30 h-full">
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                      <PieChart className="w-4 h-4 text-blue-600" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-foreground text-sm">Analisi Verticale</span>
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">SP / CE</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">Peso % di ogni voce su totale attivo e ricavi</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                </CardContent>
              </Card>
            </Link>
          </div>
        </div>

        {/* Documenti */}
        <div id="documenti-operativi" className="scroll-mt-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-foreground">Documenti</h2>
          </div>

          <Card className="mb-4 border-blue-200 bg-blue-50/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-blue-600" />
                Cartella documentale Revisioni
                {sourceStatus?.folder && <Badge className="bg-green-100 text-green-700">collegata</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              <p className="text-xs text-muted-foreground">
                Collega la cartella Nextcloud della società. La scansione è in sola lettura: nessun file viene spostato, rinominato o eliminato.
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  value={nextcloudFolder}
                  onChange={event => setNextcloudFolder(event.target.value)}
                  placeholder="Revisioni/NOME SOCIETA/2025"
                  className="h-8 text-xs flex-1"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={connectSource.isPending || !nextcloudFolder.trim()}
                  onClick={() => connectSource.mutate({ incaricoId, folder: nextcloudFolder })}
                >
                  {connectSource.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FolderOpen className="w-4 h-4 mr-1" />}
                  Collega
                </Button>
                <Button
                  size="sm"
                  className="h-8"
                  disabled={!sourceStatus?.folder || scanningSource}
                  onClick={() => scanSource()}
                >
                  {scanningSource ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}
                  Aggiorna documenti
                </Button>
              </div>
              {sourceScan && (
                <div className="rounded-md border bg-background overflow-hidden">
                  <div className="px-3 py-2 flex items-center justify-between border-b">
                    <span className="text-xs font-medium">{sourceScan.total} file rilevati</span>
                    <span className="text-xs text-muted-foreground truncate max-w-[60%]">{sourceScan.folder}</span>
                  </div>
                  <div className="max-h-64 overflow-auto divide-y">
                    {sourceScan.files.slice(0, 100).map(file => (
                      <div key={file.path} className="px-3 py-2 flex items-center gap-3 text-xs">
                        <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate" title={file.path}>{file.name}</p>
                          <p className="text-muted-foreground truncate">{file.path}</p>
                        </div>
                        <Badge variant="outline" className="whitespace-nowrap">
                          {file.suggestion.tipo.replace(/_/g, " ")} · {Math.round(file.suggestion.confidence * 100)}%
                        </Badge>
                      </div>
                    ))}
                    {sourceScan.total > 100 && (
                      <p className="px-3 py-2 text-xs text-muted-foreground">Mostrati i primi 100 file.</p>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Upload area */}
          <Card className="mb-4 border-dashed border-2 border-muted-foreground/20">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-3 font-medium uppercase tracking-wide">Carica documento</p>
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex-1 min-w-[160px]">
                  <label className="text-xs text-muted-foreground mb-1 block">Tipo documento</label>
                  <Select value={tipoDocumento} onValueChange={v => setTipoDocumento(v as TipoDoc)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bilancio_revisione">Bilancio CEE oggetto di revisione</SelectItem>
                      <SelectItem value="bilancio_storico">Bilancio CEE storico (anni precedenti)</SelectItem>
                      <SelectItem value="bilancio_analitico">Bilancio analitico / di verifica</SelectItem>
                      <SelectItem value="nota_integrativa">Nota integrativa</SelectItem>
                      <SelectItem value="verbale_assemblea">Verbale assemblea</SelectItem>
                      <SelectItem value="contratto">Contratto</SelectItem>
                      <SelectItem value="estratto_conto">Estratto conto bancario</SelectItem>
                      <SelectItem value="libro_mastro">Libro mastro</SelectItem>
                      <SelectItem value="partitario">Partitario clienti/fornitori</SelectItem>
                      <SelectItem value="altro">Altro documento</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {["bilancio_revisione", "bilancio_storico", "bilancio_analitico"].includes(tipoDocumento) && (
                  <div className="w-24">
                    <label className="text-xs text-muted-foreground mb-1 block">Anno</label>
                    <Input
                      type="number"
                      value={annoRiferimento}
                      onChange={e => setAnnoRiferimento(e.target.value)}
                      className="h-8 text-xs"
                      min={2000} max={2099}
                    />
                  </div>
                )}
                <Button size="sm" disabled={uploading} onClick={() => fileInputRef.current?.click()} className="h-8">
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Upload className="w-4 h-4 mr-1" />}
                  {uploading ? "Caricamento..." : "Carica file"}
                </Button>
                <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,.xml,.xbrl,.xlsx,.xls,.csv" multiple onChange={handleFileUpload} />
              </div>
              <p className="text-xs text-muted-foreground mt-2">Formati supportati: PDF, Excel (.xlsx/.xls), XML/XBRL, CSV. Puoi selezionare più file contemporaneamente.</p>
            </CardContent>
          </Card>

          {/* Lista documenti per categoria */}
          {!documenti?.length ? (
            <Card>
              <CardContent className="p-6 text-center">
                <FileText className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Nessun documento caricato. Inizia caricando il bilancio oggetto di revisione.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {/* Bilancio oggetto di revisione */}
              {documenti.filter(d => d.tipoDocumento === "bilancio_revisione" || d.tipoDocumento === "bilancio").length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-indigo-500 inline-block"></span>
                    Bilancio oggetto di revisione
                  </p>
                  <div className="space-y-2">
                    {documenti.filter(d => d.tipoDocumento === "bilancio_revisione" || d.tipoDocumento === "bilancio").map(doc => (
                      <DocRow key={doc.id} doc={doc} onParse={() => parseDoc.mutate({ documentoId: doc.id })} onDelete={() => deleteDoc.mutate({ id: doc.id })} parsing={parseDoc.isPending} />
                    ))}
                  </div>
                </div>
              )}
              {/* Bilancio analitico / di verifica */}
              {documenti.filter(d => d.tipoDocumento === "bilancio_analitico").length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
                    Bilancio analitico / di verifica
                    <span className="ml-1 text-xs text-emerald-600 font-normal normal-case">(fonte primaria per schede e matching)</span>
                  </p>
                  <div className="space-y-2">
                    {documenti.filter(d => d.tipoDocumento === "bilancio_analitico").map(doc => (
                      <DocRow key={doc.id} doc={doc} onParse={() => parseDoc.mutate({ documentoId: doc.id })} onDelete={() => deleteDoc.mutate({ id: doc.id })} parsing={parseDoc.isPending} />
                    ))}
                  </div>
                </div>
              )}
              {/* Bilanci storici */}
              {documenti.filter(d => d.tipoDocumento === "bilancio_storico").length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-amber-500 inline-block"></span>
                    Bilanci CEE storici (anni precedenti)
                  </p>
                  <div className="space-y-2">
                    {documenti.filter(d => d.tipoDocumento === "bilancio_storico").map(doc => (
                      <DocRow key={doc.id} doc={doc} onParse={() => parseDoc.mutate({ documentoId: doc.id })} onDelete={() => deleteDoc.mutate({ id: doc.id })} parsing={parseDoc.isPending} />
                    ))}
                  </div>
                </div>
              )}
              {/* Altri documenti */}
              {documenti.filter(d => !d.tipoDocumento?.startsWith("bilancio")).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-gray-400 inline-block"></span>
                    Altri documenti
                  </p>
                  <div className="space-y-2">
                    {documenti.filter(d => !d.tipoDocumento?.startsWith("bilancio")).map(doc => (
                      <DocRow key={doc.id} doc={doc} onParse={() => parseDoc.mutate({ documentoId: doc.id })} onDelete={() => deleteDoc.mutate({ id: doc.id })} parsing={parseDoc.isPending} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </RevisorLayout>
  );
}
