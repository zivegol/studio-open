import { useState, useRef, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import RevisorLayout from "@/components/revisione/RevisorLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import React from "react";
import { formatCurrency, formatPercent } from "@/lib/utils";
import {
  ChevronLeft,
  Upload,
  CheckCircle2,
  AlertCircle,
  MinusCircle,
  HelpCircle,
  BarChart3,
  FileSpreadsheet,
  Search,
  Sparkles,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Banknote,
  Users,
  Building,
  FileWarning,
  Trash2,
} from "lucide-react";

// ─── TIPI ─────────────────────────────────────────────────────────────────────

type StatoMatching = "non_verificata" | "incassata_pagata" | "parzialmente_coperta" | "non_trovata";

type PartitaEstratta = {
  codice: string;
  ragioneSociale: string;
  saldoPartita: number;
  estero: boolean;
};

type PartitarioEstrattoPayload = {
  clienti: PartitaEstratta[];
  fornitori: PartitaEstratta[];
  metodo: string;
};

const STATO_CONFIG: Record<StatoMatching, { label: string; color: string; icon: React.ReactNode; bg: string }> = {
  incassata_pagata: {
    label: "Incassata/Pagata",
    color: "text-green-700",
    bg: "bg-green-50 border-green-200",
    icon: <CheckCircle2 className="w-4 h-4 text-green-600" />,
  },
  parzialmente_coperta: {
    label: "Parziale",
    color: "text-amber-700",
    bg: "bg-amber-50 border-amber-200",
    icon: <MinusCircle className="w-4 h-4 text-amber-600" />,
  },
  non_trovata: {
    label: "Non trovata",
    color: "text-red-700",
    bg: "bg-red-50 border-red-200",
    icon: <AlertCircle className="w-4 h-4 text-red-600" />,
  },
  non_verificata: {
    label: "Non verificata",
    color: "text-slate-500",
    bg: "bg-slate-50 border-slate-200",
    icon: <HelpCircle className="w-4 h-4 text-slate-400" />,
  },
};

const fmt = (v: unknown) => formatCurrency(v as number | string | null);
const fmtPerc = (v: unknown) => formatPercent(v as number | string | null, { segno: false });

function normalizzaErroreVerificaIncassi(message: string | null | undefined): string {
  const raw = String(message ?? "").trim();
  if (!raw) return "Verifica non completata. Controlla i file caricati e riprova.";
  if (/failed query|insert into|params:|data too long|sql/i.test(raw)) {
    return "Verifica non completata: alcuni dati letti dai file non erano salvabili nel formato previsto. Il dettaglio tecnico e' stato nascosto; ricarica i file e riprova.";
  }
  return raw.startsWith("Errore durante la verifica")
    ? raw
    : `Errore durante la verifica: ${raw}`;
}

function parseNumeroItaliano(value: string): number {
  const clean = String(value ?? "").trim().replace(/\s/g, "");
  if (!clean) return NaN;
  if (/^\d{1,3}(\.\d{3})*(,\d+)?$/.test(clean)) {
    return Number(clean.replace(/\./g, "").replace(",", "."));
  }
  if (/^\d{1,3}(,\d{3})*(\.\d+)?$/.test(clean)) {
    return Number(clean.replace(/,/g, ""));
  }
  return Number(clean.replace(",", "."));
}

function dedupEstratte(rows: Array<PartitaEstratta & { tipo: "cliente" | "fornitore" }>) {
  const map = new Map<string, PartitaEstratta & { tipo: "cliente" | "fornitore" }>();
  for (const row of rows) {
    const key = `${row.tipo}::${row.codice || row.ragioneSociale.toLowerCase().trim()}`;
    const existing = map.get(key);
    if (!existing || Math.abs(row.saldoPartita) > Math.abs(existing.saldoPartita)) {
      map.set(key, row);
    }
  }
  return Array.from(map.values());
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

    const pageText = Array.from(lineMap.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([, parts]) => parts.sort((a, b) => a.x - b.x).map((part) => part.str).join(" "))
      .join("\n");
    pages.push(pageText);
  }

  return pages.join("\n");
}

async function parsePartitarioPdfDeterministic(
  file: File,
  annoFallback: number
): Promise<{
  payload: PartitarioEstrattoPayload;
  info: { clienti: number; fornitori: number; azienda: string; anno: number };
}> {
  const text = await extractPdfText(file);
  const headerRe = /Conto\s+([0-9.\s]+)\s+([\s\S]+?)\s+Partitario\s+Dal\s+\d{2}\/\d{2}\/\d{2}\s+Al\s+\d{2}\/\d{2}\/\d{2}/gi;
  const saldoRe = /([\-]?\d[\d.,]*)\s+Saldo alla data\.\.:/gi;
  const rows: Array<PartitaEstratta & { tipo: "cliente" | "fornitore" }> = [];
  const headers = Array.from(text.matchAll(headerRe));
  const aziendaMatch = text.match(/\bENKI\b.*?(?:a socio unico)?/i);
  const annoMatch = text.match(/Al\s+31\/12\/(\d{2})/i);
  const filename = file.name.toLowerCase();

  for (let index = 0; index < headers.length; index++) {
    const match = headers[index];
    const start = match.index ?? 0;
    const end = index + 1 < headers.length ? headers[index + 1].index ?? text.length : text.length;
    const block = text.slice(start, end);
    const saldi = Array.from(block.matchAll(saldoRe));
    if (saldi.length === 0) continue;

    const rawSaldo = saldi[saldi.length - 1][1];
    const saldo = Math.abs(parseNumeroItaliano(rawSaldo));
    if (!Number.isFinite(saldo) || saldo <= 0) continue;

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
      estero: /gmbh|bv|sas|corp|ireland|ltd|uc|gmbh|julich/i.test(ragioneSociale),
    });
  }

  const deduped = dedupEstratte(rows);
  const clienti = deduped.filter((row) => row.tipo === "cliente").map(({ tipo, ...row }) => row);
  const fornitori = deduped.filter((row) => row.tipo === "fornitore").map(({ tipo, ...row }) => row);
  const anno = annoMatch ? 2000 + Number(annoMatch[1]) : annoFallback;

  return {
    payload: {
      clienti,
      fornitori,
      metodo: "pdf_regex_locale",
    },
    info: {
      clienti: clienti.length,
      fornitori: fornitori.length,
      azienda: aziendaMatch?.[0]?.trim() || "",
      anno,
    },
  };
}

// ─── COMPONENTE UPLOAD FILE ───────────────────────────────────────────────────

function FileUploadBox({
  label,
  sublabel,
  icon,
  files,
  onFiles,
  accept = ".xlsx,.xls,.csv",
  multiple = false,
}: {
  label: string;
  sublabel: string;
  icon: React.ReactNode;
  files: File[];
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const file = files[0] ?? null;
  return (
    <div
      className={`border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-colors ${
        files.length > 0 ? "border-blue-400 bg-blue-50" : "border-slate-300 hover:border-blue-400 hover:bg-blue-50/40"
      }`}
      onClick={() => ref.current?.click()}
    >
      <input
        ref={ref}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          const selected = e.target.files ? Array.from(e.target.files) : [];
          if (selected.length > 0) onFiles(selected);
        }}
      />
      <div className="flex flex-col items-center gap-2">
        {files.length > 0 ? (
          <>
            <CheckCircle2 className="w-8 h-8 text-blue-600" />
            <span className="text-sm font-medium text-blue-700">
              {files.length === 1 ? files[0].name : `${files.length} file caricati`}
            </span>
            <span className="text-xs text-slate-500">
              {files.length === 1
                ? `${(file.size / 1024).toFixed(0)} KB - clicca per cambiare`
                : `${files.length} file - clicca per aggiungere o sostituire`}
            </span>
          </>
        ) : (
          <>
            <div className="text-slate-400">{icon}</div>
            <span className="text-sm font-semibold text-slate-700">{label}</span>
            <span className="text-xs text-slate-500">{sublabel}</span>
            <span className="text-xs text-slate-400 mt-1">{accept.includes(".pdf") ? "Excel (.xlsx, .xls), CSV o PDF" : "Excel (.xlsx, .xls) o CSV"}</span>
          </>
        )}
      </div>
    </div>
  );
}

// ─── COMPONENTE PRINCIPALE ────────────────────────────────────────────────────

export default function VerificaIncassi() {
  const { id } = useParams<{ id: string }>();
  const incaricoId = parseInt(id);
  const [, navigate] = useLocation();

  // Stato wizard
  const [step, setStep] = useState<"upload" | "risultati">("upload");
  const [sessioneId, setSessioneId] = useState<number | null>(null);

  // File caricati
  const [filesPartitario, setFilesPartitario] = useState<File[]>([]);
  const [filesEc, setFilesEc] = useState<File[]>([]); // multipli

  // Parametri
  const [annoEsercizio, setAnnoEsercizio] = useState(new Date().getFullYear() - 1);
  const [trimestreVerifica, setTrimestreVerifica] = useState(1);

  // Filtro tabella
  const [filtroTipo, setFiltroTipo] = useState<"tutti" | "cliente" | "fornitore">("tutti");
  const [filtroStato, setFiltroStato] = useState<"tutti" | StatoMatching>("tutti");
  const [filtroEsito, setFiltroEsito] = useState<"tutti" | "quadrati" | "non_quadrati" | "differenze">("tutti");
  const [ricerca, setRicerca] = useState("");
  const [filtroMese, setFiltroMese] = useState<string>("tutti"); // "tutti" o "YYYY-MM"
  const [emailCircolarizzazione, setEmailCircolarizzazione] = useState("");

  // Note partita
  const [noteEdit, setNoteEdit] = useState<Record<number, string>>({});
  const [noteAperte, setNoteAperte] = useState<Set<number>>(new Set());
  const [partiteSelezionate, setPartiteSelezionate] = useState<Set<number>>(new Set());

  // Analisi AI
  const [analisiAi, setAnalisiAi] = useState<string>("");
  const [partitarioPdfInfo, setPartitarioPdfInfo] = useState<{ clienti: number; fornitori: number; azienda: string; anno: number; files: number } | null>(null);
  const [partitariEstrattiJson, setPartitariEstrattiJson] = useState<string[]>([]);

  // PDF estratto conto — stato parsing
  const [pdfEcInfo, setPdfEcInfo] = useState<{ banca: string; periodo: string; movimenti: number } | null>(null);

  // Queries e mutations
  const { data: sessioneData, refetch: refetchSessione } = trpc.verificaIncassi.listPartite.useQuery(
    { sessioneId: sessioneId!, tipo: "tutti", stato: "tutti" },
    { enabled: sessioneId !== null }
  );
  const { data: sessioniList, refetch: refetchSessioni } = trpc.verificaIncassi.listSessioni.useQuery({ incaricoId });
  const creaSessione = trpc.verificaIncassi.creaSessione.useMutation();
  const creaSessioneDaDossier = trpc.verificaIncassi.creaSessioneDaDossier.useMutation();
  const riportaNonQuadrate = trpc.verificaIncassi.riportaNonQuadrateInCircolarizzazione.useMutation();
  const aggiornaNota = trpc.verificaIncassi.aggiornaNota.useMutation();
  const analisiAiMutation = trpc.verificaIncassi.analisiAiProcedureAlternative.useMutation();
  const eliminaSessione = trpc.verificaIncassi.eliminaSessione.useMutation();

  // Reset completo dello stato quando cambia l'incarico (navigazione tra clienti diversi)
  useEffect(() => {
    setStep("upload");
    setSessioneId(null);
    setFilesPartitario([]);
    setFilesEc([]);
    setAnnoEsercizio(new Date().getFullYear() - 1);
    setTrimestreVerifica(1);
    setFiltroTipo("tutti");
    setFiltroStato("tutti");
    setFiltroEsito("tutti");
    setRicerca("");
    setFiltroMese("tutti");
    setEmailCircolarizzazione("");
    setNoteEdit({});
    setNoteAperte(new Set());
    setPartiteSelezionate(new Set());
    setAnalisiAi("");
    setPartitarioPdfInfo(null);
    setPartitariEstrattiJson([]);
    setPdfEcInfo(null);
    setCsvDaPdf([]);
  }, [incaricoId]);

  useEffect(() => {
    if (!sessioneId && sessioniList?.length) {
      const latest = [...sessioniList].sort((a, b) => b.id - a.id)[0];
      setSessioneId(latest.id);
      setAnnoEsercizio(latest.annoEsercizio);
      setTrimestreVerifica(latest.trimestreVerifica ?? 1);
      setStep("risultati");
    }
  }, [sessioniList, sessioneId]);

  // ─── HELPERS ──────────────────────────────────────────────────────────────

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  // ─── HANDLERS ─────────────────────────────────────────────────────────────

  // Stato per tenere i CSV base64 convertiti da PDF
  const [csvDaPdf, setCsvDaPdf] = React.useState<string[]>([]);

  const handleParsaPdf = async (file: File) => {
    void file;
    toast.error("Parsing PDF estratto conto disabilitato: per evitare invii all'IA, carica gli estratti conto in Excel o CSV.");
  };

  const handlePartitarioFiles = async (incomingFiles: File[]) => {
    const pdfFiles = incomingFiles.filter((file) => file.name.toLowerCase().endsWith(".pdf"));
    const nonPdfFiles = incomingFiles.filter((file) => !file.name.toLowerCase().endsWith(".pdf"));

    if (nonPdfFiles.length > 0) {
      setFilesPartitario(nonPdfFiles);
      setPartitariEstrattiJson([]);
      setPartitarioPdfInfo(null);
      if (pdfFiles.length > 0) {
        toast.info("Sono stati mantenuti i file Excel/CSV del partitario; i PDF non sono stati aggiunti in questo passaggio.");
      }
      return;
    }

    if (pdfFiles.length === 0) return;

    const extractedJson: string[] = [];
    let clienti = 0;
    let fornitori = 0;
    let azienda = "";
    let anno = annoEsercizio;

    try {
      for (const file of pdfFiles) {
        toast.info(`Parsing locale del partitario PDF "${file.name}"...`);
        const result = await parsePartitarioPdfDeterministic(file, annoEsercizio);
        extractedJson.push(JSON.stringify(result.payload));
        clienti += result.info.clienti;
        fornitori += result.info.fornitori;
        azienda = azienda || result.info.azienda;
        anno = result.info.anno || anno;
      }

      setFilesPartitario(prev => [...prev, ...pdfFiles]);
      setPartitariEstrattiJson(prev => [...prev, ...extractedJson]);
      setPartitarioPdfInfo(prev => ({
        clienti: (prev?.clienti ?? 0) + clienti,
        fornitori: (prev?.fornitori ?? 0) + fornitori,
        azienda: prev?.azienda || azienda,
        anno: prev?.anno || anno,
        files: (prev?.files ?? 0) + pdfFiles.length,
      }));
      toast.success(`Partitario PDF elaborato localmente: ${clienti} clienti, ${fornitori} fornitori`);
    } catch (e: any) {
      toast.error("Errore parsing partitario PDF: " + e.message);
    }
  };

  const handleAvvia = async () => {
    if (filesEc.length === 0 && csvDaPdf.length === 0) { toast.error("Carica almeno un estratto conto bancario"); return; }
    if (filesPartitario.length === 0) { toast.error("Carica il file partitario clienti/fornitori"); return; }

    try {
      const partitariBase64 = partitariEstrattiJson.length > 0 ? undefined : await Promise.all(filesPartitario.map(fileToBase64));
      // Converti i file CSV/Excel normali in base64
      const estrattiContoBase64Normali = await Promise.all(filesEc.map(fileToBase64));
      // Unisci con i CSV convertiti da PDF
      const estrattiContoBase64 = [...estrattiContoBase64Normali, ...csvDaPdf];

      const result = await creaSessione.mutateAsync({
        incaricoId,
        annoEsercizio,
        trimestreVerifica,
        partitariBase64,
        partitariEstrattiJson: partitariEstrattiJson.length > 0 ? partitariEstrattiJson : undefined,
        estrattiContoBase64,
      });

      setSessioneId(result.sessioneId);
      setStep("risultati");
      toast.success(`Verifica completata: ${result.clientiParsati + result.fornitoriParsati} partite analizzate`);
    } catch (e: any) {
      // TRPCClientError: il messaggio è in e.message (ereditato da Error)
      // Se e.message è undefined, prova shape.message o data.message
      const msg = e?.message
        ?? e?.shape?.message
        ?? e?.data?.message
        ?? (typeof e === "string" ? e : null)
        ?? JSON.stringify(e);
      toast.error(normalizzaErroreVerificaIncassi(msg));
      console.error("[handleAvvia] errore completo:", e);
    }
  };

  const handleAvviaDaDossier = async () => {
    try {
      const result = await creaSessioneDaDossier.mutateAsync({ incaricoId });
      setTrimestreVerifica(1);
      setSessioneId(result.sessioneId);
      setStep("risultati");
      await refetchSessioni();
      toast.success(`Verifica automatica completata: ${result.clientiParsati} clienti, ${result.fornitoriParsati} fornitori e ${result.movimentiParsati} movimenti bancari`);
    } catch (e: any) {
      toast.error(normalizzaErroreVerificaIncassi(e?.message));
    }
  };

  const handleSalvaNota = async (partitaId: number) => {
    await aggiornaNota.mutateAsync({ partitaId, noteRevisore: noteEdit[partitaId] ?? "" });
    await refetchSessione();
    setNoteAperte(prev => { const s = new Set(prev); s.delete(partitaId); return s; });
    toast.success("Nota salvata");
  };

  const handleAnalisiAi = async () => {
    if (!sessioneId) return;
    try {
      const result = await analisiAiMutation.mutateAsync({ sessioneId });
      setAnalisiAi(typeof result.analisi === "string" ? result.analisi : "Analisi non disponibile.");
      toast.success("Analisi AI completata");
    } catch (e: any) {
      toast.error("Errore analisi AI: " + e.message);
    }
  };

  const handleEliminaSessione = async (idDaEliminare: number) => {
    const conferma = window.confirm("Eliminare definitivamente questa sessione e tutte le partite collegate?");
    if (!conferma) return;

    try {
      await eliminaSessione.mutateAsync({ sessioneId: idDaEliminare });
      if (sessioneId === idDaEliminare) {
        setSessioneId(null);
        setStep("upload");
        setAnalisiAi("");
        setNoteEdit({});
        setNoteAperte(new Set());
      }
      await refetchSessioni();
      toast.success("Sessione eliminata");
    } catch (e: any) {
      toast.error("Errore eliminazione sessione: " + (e?.message ?? "operazione non completata"));
    }
  };

  // ─── DATI FILTRATI ─────────────────────────────────────────────────────────

  const handleRiportaNonQuadrate = async () => {
    if (!sessioneId) return;
    if (!emailCircolarizzazione.trim()) {
      toast.error("Inserisci l'email del revisore per la circolarizzazione");
      return;
    }
    try {
      const result = await riportaNonQuadrate.mutateAsync({
        sessioneId,
        incaricoId,
        emailRevisore: emailCircolarizzazione.trim(),
        partitaIds: Array.from(partiteSelezionate),
      });
      toast.success(`Create ${result.destinatari} posizioni in circolarizzazione`);
      navigate(`/incarichi/${id}/circolarizzazione`);
    } catch (e: any) {
      toast.error(e?.message ?? "Errore nel riporto in circolarizzazione");
    }
  };

  const partite = (sessioneData ?? []) as Array<{
    id: number; tipo: "cliente" | "fornitore"; ragioneSociale: string;
    numeroFattura?: string | null; saldoPartita: string; importoCoperto?: string | null;
    residuo?: string | null; statoMatching: string; dataMovimentoBancario?: string | null;
    descrizioneMovimento?: string | null; confidenzaMatching?: string | null; noteRevisore?: string | null;
  }>;
  const residuoPartita = (p: { residuo?: string | null }) => Math.abs(Number(p.residuo ?? 0) || 0);
  const isQuadrata = (p: { statoMatching: string; residuo?: string | null }) =>
    p.statoMatching === "incassata_pagata" && residuoPartita(p) <= 0.01;
  const isNonQuadrata = (p: { statoMatching: string; residuo?: string | null }) => !isQuadrata(p);
  const dashboard = React.useMemo(() => {
    const clienti = partite.filter(p => p.tipo === "cliente");
    const fornitori = partite.filter(p => p.tipo === "fornitore");
    const quadrate = partite.filter(isQuadrata);
    const nonQuadrate = partite.filter(isNonQuadrata);
    const differenze = partite.filter(p => residuoPartita(p) > 0.01);
    const differenzaTotale = differenze.reduce((sum, p) => sum + residuoPartita(p), 0);
    const differenzaClienti = differenze.filter(p => p.tipo === "cliente").reduce((sum, p) => sum + residuoPartita(p), 0);
    const differenzaFornitori = differenze.filter(p => p.tipo === "fornitore").reduce((sum, p) => sum + residuoPartita(p), 0);
    const riepilogo = (rows: typeof partite) => {
      const totale = rows.reduce((sum, p) => sum + Math.abs(Number(p.saldoPartita) || 0), 0);
      const voce = (filtered: typeof partite) => {
        const importo = filtered.reduce((sum, p) => sum + Math.abs(Number(p.saldoPartita) || 0), 0);
        return { importo, percentuale: totale > 0 ? importo / totale * 100 : 0, numero: filtered.length };
      };
      return {
        totale,
        numero: rows.length,
        quadrati: voce(rows.filter(isQuadrata)),
        parziali: voce(rows.filter(p => p.statoMatching === "parzialmente_coperta")),
        nonTrovati: voce(rows.filter(p => p.statoMatching === "non_trovata" || p.statoMatching === "non_verificata")),
      };
    };
    return {
      clienti,
      fornitori,
      quadrate,
      nonQuadrate,
      differenze,
      differenzaTotale,
      differenzaClienti,
      differenzaFornitori,
      riepiloghi: {
        tutti: riepilogo(partite),
        cliente: riepilogo(clienti),
        fornitore: riepilogo(fornitori),
      },
    };
  }, [partite]);
  const partiteFiltrate = partite.filter((p) => {
    if (filtroTipo !== "tutti" && p.tipo !== filtroTipo) return false;
    if (filtroStato !== "tutti" && p.statoMatching !== filtroStato) return false;
    if (filtroEsito === "quadrati" && !isQuadrata(p)) return false;
    if (filtroEsito === "non_quadrati" && !isNonQuadrata(p)) return false;
    if (filtroEsito === "differenze" && residuoPartita(p) <= 0.01) return false;
    if (ricerca && !p.ragioneSociale.toLowerCase().includes(ricerca.toLowerCase())) return false;
    if (filtroMese !== "tutti" && p.dataMovimentoBancario) {
      // Estrai YYYY-MM dalla data del movimento (DD/MM/YYYY o YYYY-MM-DD)
      const d = p.dataMovimentoBancario;
      let mesePartita = "";
      const partiSlash = d.split("/");
      const partiDash = d.split("-");
      if (partiSlash.length === 3) mesePartita = `${partiSlash[2]}-${partiSlash[1].padStart(2, "0")}`;
      else if (partiDash.length === 3) mesePartita = `${partiDash[0]}-${partiDash[1].padStart(2, "0")}`;
      if (mesePartita !== filtroMese) return false;
    }
    return true;
  });
  const selezione = React.useMemo(() => {
    const rows = partite.filter(p => partiteSelezionate.has(p.id));
    const importo = rows.reduce((sum, p) => sum + Math.abs(Number(p.saldoPartita) || 0), 0);
    const perTipo = (tipo: "cliente" | "fornitore") => {
      const selected = rows.filter(p => p.tipo === tipo);
      const selectedAmount = selected.reduce((sum, p) => sum + Math.abs(Number(p.saldoPartita) || 0), 0);
      const classTotal = dashboard.riepiloghi[tipo].totale;
      return {
        numero: selected.length,
        importo: selectedAmount,
        percentuale: classTotal > 0 ? selectedAmount / classTotal * 100 : 0,
      };
    };
    return { numero: rows.length, importo, clienti: perTipo("cliente"), fornitori: perTipo("fornitore") };
  }, [partite, partiteSelezionate, dashboard.riepiloghi]);
  const coperturaVerifica = React.useMemo(() => {
    const perTipo = (tipo: "cliente" | "fornitore") => {
      const rows = partite.filter(p => p.tipo === tipo);
      const base = rows.reduce((sum, p) => sum + Math.abs(Number(p.saldoPartita) || 0), 0);
      const quadrati = rows.filter(isQuadrata).reduce((sum, p) => sum + Math.abs(Number(p.saldoPartita) || 0), 0);
      const circolarizzati = rows.filter(p => partiteSelezionate.has(p.id) && !isQuadrata(p)).reduce((sum, p) => sum + Math.abs(Number(p.saldoPartita) || 0), 0);
      return { base, quadrati, circolarizzati, coperto: quadrati + circolarizzati, percentuale: base > 0 ? (quadrati + circolarizzati) / base * 100 : 0 };
    };
    return { clienti: perTipo("cliente"), fornitori: perTipo("fornitore") };
  }, [partite, partiteSelezionate]);

  // Mesi disponibili dai movimenti bancari (per il selettore)
  const mesiDisponibili = React.useMemo(() => {
    const mesiSet = new Set<string>();
    const MESI_IT = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno",
      "Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
    for (const p of partite) {
      if (!p.dataMovimentoBancario) continue;
      const d = p.dataMovimentoBancario;
      const partiSlash = d.split("/");
      const partiDash = d.split("-");
      let chiave = "";
      if (partiSlash.length === 3) chiave = `${partiSlash[2]}-${partiSlash[1].padStart(2, "0")}`;
      else if (partiDash.length === 3) chiave = `${partiDash[0]}-${partiDash[1].padStart(2, "0")}`;
      if (chiave) mesiSet.add(chiave);
    }
    return Array.from(mesiSet).sort().map(k => {
      const [anno, mese] = k.split("-");
      return { valore: k, label: `${MESI_IT[parseInt(mese) - 1]} ${anno}` };
    });
  }, [partite]);

  // Recupera la sessione corrente dalla lista
  const sessione = sessioniList?.find(s => s.id === sessioneId);

  // ─── RENDER ───────────────────────────────────────────────────────────────

  return (
    <RevisorLayout>
      <div className="max-w-7xl mx-auto p-6 space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/incarichi/${id}`)}>
            <ChevronLeft className="w-4 h-4 mr-1" /> Fascicolo
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Verifica Incassi e Pagamenti Successivi</h1>
            <p className="text-sm text-slate-500">ISA Italia 560 — Confronto partitari con estratto conto Q{trimestreVerifica} anno successivo</p>
          </div>
          {step === "risultati" && (
            <div className="ml-auto flex items-center gap-2">
              {sessioniList && sessioniList.length > 1 && (
                <select className="h-9 rounded-md border bg-white px-2 text-xs" value={sessioneId ?? ""} onChange={e => setSessioneId(Number(e.target.value))}>
                  {[...sessioniList].sort((a, b) => b.id - a.id).map(s => <option key={s.id} value={s.id}>{s.annoEsercizio} · Q{s.trimestreVerifica} · elaborazione #{s.id}</option>)}
                </select>
              )}
              <Button variant="outline" size="sm" onClick={handleAvviaDaDossier} disabled={creaSessioneDaDossier.isPending}>
                <RefreshCw className={`w-4 h-4 mr-2 ${creaSessioneDaDossier.isPending ? "animate-spin" : ""}`} />Rielabora dal dossier
              </Button>
            </div>
          )}
        </div>

        {/* Sessioni precedenti */}
        {sessioniList && sessioniList.length > 0 && step === "upload" && (
          <Card className="border-blue-200 bg-blue-50/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-blue-700">Sessioni precedenti</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {sessioniList.map(s => (
                  <div key={s.id} className="flex items-center rounded-md border border-blue-300 bg-white">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 rounded-r-none px-3 text-xs text-blue-700 hover:bg-blue-50"
                      onClick={() => { setSessioneId(s.id); setStep("risultati"); }}
                    >
                      {s.annoEsercizio} — Q{s.trimestreVerifica} ({s.stato})
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 rounded-l-none border-l border-blue-200 p-0 text-red-600 hover:bg-red-50 hover:text-red-700"
                      disabled={eliminaSessione.isPending}
                      title="Elimina sessione"
                      onClick={() => handleEliminaSessione(s.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* STEP 1: UPLOAD */}
        {step === "upload" && (
          <div className="space-y-6">
            <Card className="border-teal-300 bg-teal-50/50">
              <CardContent className="p-4 flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-sm font-semibold text-teal-900">Elaborazione automatica dal dossier cliente</p>
                  <p className="text-xs text-teal-800 mt-1">Usa i partitari dell'esercizio e gli estratti conto dell'anno successivo già presenti nella cartella Nextcloud collegata.</p>
                </div>
                <Button onClick={handleAvviaDaDossier} disabled={creaSessioneDaDossier.isPending} className="bg-teal-700 hover:bg-teal-800">
                  {creaSessioneDaDossier.isPending ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Elaborazione…</> : <><Sparkles className="w-4 h-4 mr-2" />Avvia dal dossier</>}
                </Button>
              </CardContent>
            </Card>
            <div className="hidden">
            {/* Parametri */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Parametri della verifica</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Anno di chiusura bilancio</Label>
                  <Input
                    type="number"
                    value={annoEsercizio}
                    onChange={e => setAnnoEsercizio(parseInt(e.target.value))}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Trimestre estratto conto (anno successivo)</Label>
                  <select
                    className="mt-1 w-full border border-slate-200 rounded-md px-3 py-2 text-sm"
                    value={trimestreVerifica}
                    onChange={e => setTrimestreVerifica(parseInt(e.target.value))}
                  >
                    <option value={1}>Q1 — Gennaio/Marzo</option>
                    <option value={2}>Q2 — Aprile/Giugno</option>
                    <option value={3}>Q3 — Luglio/Settembre</option>
                  </select>
                </div>
                {partitarioPdfInfo && (
                  <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-800">
                    <div className="font-medium">Partitario PDF estratto</div>
                    <div className="mt-1">
                      {partitarioPdfInfo.azienda || "Azienda"} — {partitarioPdfInfo.anno || annoEsercizio} — {partitarioPdfInfo.clienti} clienti — {partitarioPdfInfo.fornitori} fornitori — {partitarioPdfInfo.files} PDF
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Upload file */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Carica i file</CardTitle>
                <p className="text-xs text-slate-500 mt-1">
                  Il partitario può essere in <strong>qualsiasi formato</strong> (Hermete, TeamSystem, Zucchetti, Sage, foglio unico, fogli separati o PDF testuale) e viene letto con parser locali. Gli estratti conto per l'incrocio automatico vanno caricati in CSV o Excel.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FileUploadBox
                    label="Partitario Clienti e Fornitori"
                    sublabel="Qualsiasi formato gestionale (XLS/XLSX/CSV/PDF testuale) - parsing locale"
                    icon={<FileSpreadsheet className="w-8 h-8" />}
                    files={filesPartitario}
                    onFiles={handlePartitarioFiles}
                    accept=".xlsx,.xls,.csv,.pdf"
                    multiple
                  />
                  {/* Upload multiplo estratti conto CSV/Excel */}
                  <div
                    className={`border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-colors ${
                      filesEc.length > 0 ? "border-blue-400 bg-blue-50" : "border-slate-300 hover:border-blue-400 hover:bg-blue-50/40"
                    }`}
                    onClick={() => document.getElementById("input-ec")?.click()}
                  >
                    <input
                      id="input-ec"
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files) setFilesEc(prev => [...prev, ...Array.from(e.target.files!)]);
                      }}
                    />
                    <div className="flex flex-col items-center gap-2">
                      {filesEc.length > 0 ? (
                        <>
                          <CheckCircle2 className="w-8 h-8 text-blue-600" />
                          <span className="text-sm font-medium text-blue-700">{filesEc.length} file caricati</span>
                          <div className="text-xs text-slate-600 space-y-0.5">
                            {filesEc.map((f, i) => <div key={i}>{f.name}</div>)}
                          </div>
                          <button className="text-xs text-red-500 mt-1" onClick={(e) => { e.stopPropagation(); setFilesEc([]); }}>Rimuovi tutti</button>
                        </>
                      ) : (
                        <>
                          <FileSpreadsheet className="w-8 h-8 text-slate-400" />
                          <span className="text-sm font-semibold text-slate-700">Estratto Conto CSV/Excel</span>
                          <span className="text-xs text-slate-500">Movimenti Q{trimestreVerifica} {annoEsercizio + 1} — selezione multipla</span>
                          <span className="text-xs text-slate-400 mt-1">CSV o Excel</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Upload estratto conto PDF disabilitato per evitare invii all'IA */}
                  <div
                    className={`border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-colors ${
                      pdfEcInfo ? "border-purple-400 bg-purple-50" :
                      "border-slate-300 hover:border-purple-400 hover:bg-purple-50/40"
                    }`}
                    onClick={() => document.getElementById("input-ec-pdf")?.click()}
                  >
                    <input
                      id="input-ec-pdf"
                      type="file"
                      accept=".pdf"
                      multiple
                      className="hidden"
                      onChange={async (e) => {
                        if (e.target.files) {
                          for (const f of Array.from(e.target.files)) {
                            await handleParsaPdf(f);
                          }
                        }
                      }}
                    />
                    <div className="flex flex-col items-center gap-2">
                      {pdfEcInfo ? (
                        <>
                          <CheckCircle2 className="w-8 h-8 text-purple-600" />
                          <span className="text-sm font-medium text-purple-700">{pdfEcInfo.movimenti} movimenti estratti</span>
                          <span className="text-xs text-slate-600">{pdfEcInfo.banca || "Banca"} — {pdfEcInfo.periodo}</span>
                          <button className="text-xs text-red-500 mt-1" onClick={(e) => { e.stopPropagation(); setPdfEcInfo(null); setCsvDaPdf([]); }}>Rimuovi</button>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-8 h-8 text-slate-400" />
                          <span className="text-sm font-semibold text-slate-700">Estratto Conto PDF</span>
                          <span className="text-xs text-slate-500">Upload disabilitato per evitare invii all'IA</span>
                          <span className="text-xs text-purple-500 mt-1 font-medium">Usa Excel o CSV per l'incrocio automatico</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Istruzioni formato */}
            <Card className="bg-slate-50 border-slate-200">
              <CardContent className="pt-4">
                <p className="text-xs font-semibold text-slate-600 mb-2">Formati supportati</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-600">
                  <div>
                    <p className="font-medium mb-1">Partitario (qualsiasi formato gestionale):</p>
                    <p className="text-slate-500 mb-1">Il parser locale riconosce fogli separati Clienti/Fornitori (Hermete), layout affiancato, foglio unico con colonna tipo e PDF testuale di mastrini. Supporta XLS, XLSX, CSV e PDF.</p>
                    <code className="block bg-white border border-slate-200 rounded p-2 text-xs">
                      Hermete: fogli separati Clienti/Fornitori<br/>
                      Foglio unico: colonna Tipo + Nominativo + Saldo<br/>
                      Layout affiancato: CLIENTI | FORNITORI affiancati<br/>
                      PDF: mastrini clienti/fornitori con testo selezionabile
                    </code>
                  </div>
                  <div>
                    <p className="font-medium mb-1">Estratto conto CSV (es. export home banking):</p>
                    <p className="text-slate-500 mb-1">Separatore <code>;</code> — colonne: Data contabile; Data valuta; Importo; Divisa; Causale; Descrizione; Canale. Importo negativo = uscita.</p>
                    <code className="block bg-white border border-slate-200 rounded p-2 text-xs">
                      Data contabile;Data valuta;Importo;Divisa;Causale;Descrizione;Canale<br/>
                      05/01/2025;05/01/2025;15000,00;EUR;BONIF;Bonifico Rossi Srl;WEB<br/>
                      12/01/2025;12/01/2025;-8500,00;EUR;BONIF;Pag Verdi Srl;WEB
                    </code>
                    <p className="text-slate-400 mt-1">Puoi caricare più file CSV (uno per mese) — verranno uniti automaticamente.</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button
                onClick={handleAvvia}
                disabled={creaSessione.isPending || (filesEc.length === 0 && csvDaPdf.length === 0) || filesPartitario.length === 0}
                className="bg-[#1e3a5f] hover:bg-[#152d4a] text-white px-8"
              >
                {creaSessione.isPending ? (
                  <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Analisi in corso...</>
                ) : (
                  <><Search className="w-4 h-4 mr-2" /> Avvia verifica matching</>
                )}
              </Button>
            </div>
            </div>
          </div>
        )}

        {/* STEP 2: RISULTATI */}
        {step === "risultati" && sessione && (
          <div className="space-y-6">

            {/* Dashboard riepilogo */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[
                {
                  label: "Tutti",
                  key: "tutti" as const,
                  icon: <BarChart3 className="w-5 h-5 text-slate-600" />,
                  onClick: () => { setFiltroTipo("tutti"); setFiltroStato("tutti"); setFiltroEsito("tutti"); },
                  active: filtroTipo === "tutti" && filtroStato === "tutti" && filtroEsito === "tutti",
                  bg: "bg-slate-50",
                },
                {
                  label: "Clienti",
                  key: "cliente" as const,
                  icon: <Users className="w-5 h-5 text-green-600" />,
                  onClick: () => { setFiltroTipo("cliente"); setFiltroStato("tutti"); setFiltroEsito("tutti"); },
                  active: filtroTipo === "cliente" && filtroEsito === "tutti",
                  bg: "bg-green-50",
                },
                {
                  label: "Fornitori",
                  key: "fornitore" as const,
                  icon: <Building className="w-5 h-5 text-blue-600" />,
                  onClick: () => { setFiltroTipo("fornitore"); setFiltroStato("tutti"); setFiltroEsito("tutti"); },
                  active: filtroTipo === "fornitore" && filtroEsito === "tutti",
                  bg: "bg-blue-50",
                },
              ].map(k => (
                <button key={k.label} type="button" onClick={k.onClick} className="text-left">
                  <Card className={`${k.bg} ${k.active ? "ring-2 ring-blue-500 border-blue-300" : "border-transparent"} hover:shadow-sm transition`}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2">{k.icon}<span className="font-semibold text-slate-800">{k.label}</span></div>
                        <span className="text-xs text-slate-500">{dashboard.riepiloghi[k.key].numero} nominativi · {fmt(dashboard.riepiloghi[k.key].totale)}</span>
                      </div>
                      <div className="space-y-2 text-xs">
                        {[
                          ["Quadrati 100%", dashboard.riepiloghi[k.key].quadrati, "text-emerald-700"],
                          ["Quadrati parz.", dashboard.riepiloghi[k.key].parziali, "text-amber-700"],
                          ["Non trovati", dashboard.riepiloghi[k.key].nonTrovati, "text-red-700"],
                        ].map(([label, item, color]: any) => (
                          <div key={label} className="flex items-center justify-between gap-3 border-t border-slate-200/70 pt-2">
                            <span className={color}>{label} <span className="text-slate-400">({item.numero})</span></span>
                            <span className="font-medium whitespace-nowrap">{fmt(item.importo)} · {item.percentuale.toLocaleString("it-IT", { maximumFractionDigits: 1 })}%</span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </button>
              ))}
            </div>

            <Card className="border-orange-200 bg-orange-50/50">
              <CardContent className="pt-4">
                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-end">
                  <div>
                    <p className="text-sm font-semibold text-orange-900">Copertura verifiche e conferma circolarizzazioni</p>
                    <p className="text-xs text-orange-800 mt-1">
                      Seleziona nella tabella i nominativi non quadrati da circolarizzare. La copertura combina saldi già quadrati automaticamente e posizioni selezionate per conferma esterna.
                    </p>
                    <div className="grid sm:grid-cols-2 gap-2 mt-3">
                      {(["clienti", "fornitori"] as const).map(tipo => {
                        const item = coperturaVerifica[tipo];
                        return <div key={tipo} className="rounded border border-orange-200 bg-white p-3 text-xs">
                          <p className="font-semibold capitalize text-slate-800">{tipo}</p>
                          <p className="mt-1 text-emerald-700">Quadrati automatici: <strong>{fmt(item.quadrati)}</strong></p>
                          <p className="text-blue-700">Selezionati per circolarizzazione: <strong>{fmt(item.circolarizzati)}</strong></p>
                          <p className="mt-1 border-t pt-1">Copertura complessiva: <strong>{fmt(item.coperto)} · {item.percentuale.toLocaleString("it-IT", { maximumFractionDigits: 2 })}%</strong></p>
                        </div>;
                      })}
                    </div>
                    <Input
                      type="email"
                      placeholder="email revisore per risposte terzi"
                      value={emailCircolarizzazione}
                      onChange={e => setEmailCircolarizzazione(e.target.value)}
                      className="mt-3 max-w-md bg-white"
                    />
                  </div>
                  <Button
                    type="button"
                    className="bg-orange-700 hover:bg-orange-800 text-white"
                    disabled={selezione.numero === 0 || riportaNonQuadrate.isPending}
                    onClick={handleRiportaNonQuadrate}
                  >
                    {riportaNonQuadrate.isPending ? (
                      <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Riporto...</>
                    ) : (
                      <><FileWarning className="w-4 h-4 mr-2" /> Conferma selezionati</>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Filtri */}
            <Card>
              <CardContent className="pt-4">
                <div className="flex flex-wrap gap-3 items-center">
                  <div className="flex items-center gap-1">
                    <Search className="w-4 h-4 text-slate-400" />
                    <Input
                      placeholder="Cerca ragione sociale..."
                      value={ricerca}
                      onChange={e => setRicerca(e.target.value)}
                      className="h-8 w-52 text-sm"
                    />
                  </div>
                  <div className="flex gap-1">
                    {(["tutti", "cliente", "fornitore"] as const).map(t => (
                      <Button
                        key={t}
                        variant={filtroTipo === t ? "default" : "outline"}
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => { setFiltroTipo(t); setFiltroEsito("tutti"); }}
                      >
                        {t === "tutti" ? "Tutti" : t === "cliente" ? "Clienti" : "Fornitori"}
                      </Button>
                    ))}
                  </div>
                  <div className="flex gap-1">
                    {(["tutti", "incassata_pagata", "parzialmente_coperta", "non_trovata"] as const).map(s => (
                      <Button
                        key={s}
                        variant={filtroStato === s ? "default" : "outline"}
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => { setFiltroStato(s); setFiltroEsito("tutti"); }}
                      >
                        {s === "tutti" ? "Tutti" : STATO_CONFIG[s].label}
                      </Button>
                    ))}
                  </div>
                  {/* Filtro mese */}
                  {mesiDisponibili.length > 0 && (
                    <div className="flex items-center gap-1">
                      <select
                        value={filtroMese}
                        onChange={e => setFiltroMese(e.target.value)}
                        className="h-8 text-xs border border-input rounded-md px-2 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      >
                        <option value="tutti">Tutti i mesi</option>
                        {mesiDisponibili.map(m => (
                          <option key={m.valore} value={m.valore}>{m.label}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <span className="text-xs text-slate-400 ml-auto">{partiteFiltrate.length} partite</span>
                </div>
              </CardContent>
            </Card>

            {selezione.numero > 0 && (
              <Card className="border-blue-300 bg-blue-50/60 sticky top-2 z-10 shadow-sm">
                <CardContent className="p-3 flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-sm font-semibold text-blue-900">{selezione.numero} nominativi selezionati</p>
                    <p className="text-xs text-blue-700">Incidenza calcolata sul totale clienti e fornitori della sessione.</p>
                  </div>
                  <div className="flex gap-6 flex-wrap ml-auto">
                    {selezione.clienti.numero > 0 && (
                      <div className="text-right">
                        <p className="text-[11px] text-blue-700">Clienti selezionati ({selezione.clienti.numero})</p>
                        <p className="font-bold text-blue-900">{fmt(selezione.clienti.importo)}</p>
                        <p className="text-xs text-blue-700">{selezione.clienti.percentuale.toLocaleString("it-IT", { maximumFractionDigits: 2 })}% del totale clienti</p>
                      </div>
                    )}
                    {selezione.fornitori.numero > 0 && (
                      <div className="text-right">
                        <p className="text-[11px] text-blue-700">Fornitori selezionati ({selezione.fornitori.numero})</p>
                        <p className="font-bold text-blue-900">{fmt(selezione.fornitori.importo)}</p>
                        <p className="text-xs text-blue-700">{selezione.fornitori.percentuale.toLocaleString("it-IT", { maximumFractionDigits: 2 })}% del totale fornitori</p>
                      </div>
                    )}
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setPartiteSelezionate(new Set())}>Azzera selezione</Button>
                </CardContent>
              </Card>
            )}

            {/* Tabella partite */}
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="px-3 py-3 text-center w-10">
                          <input
                            type="checkbox"
                            aria-label="Seleziona tutti i nominativi filtrati"
                            checked={partiteFiltrate.some(p => !isQuadrata(p)) && partiteFiltrate.filter(p => !isQuadrata(p)).every(p => partiteSelezionate.has(p.id))}
                            onChange={e => setPartiteSelezionate(prev => {
                              const next = new Set(prev);
                              partiteFiltrate.filter(p => !isQuadrata(p)).forEach(p => e.target.checked ? next.add(p.id) : next.delete(p.id));
                              return next;
                            })}
                          />
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 w-20">Tipo</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Ragione Sociale</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 w-28">N. Fattura</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600 w-28">Saldo</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600 w-28">Coperto</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600 w-24">Residuo</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 w-32">Stato</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Movimento bancario</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-slate-600 w-16">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {partiteFiltrate.map(p => {
                        const cfg = STATO_CONFIG[p.statoMatching as StatoMatching] ?? STATO_CONFIG.non_verificata;
                        const notaAperta = noteAperte.has(p.id);
                        return (
                          <React.Fragment key={p.id}>
                            <tr key={p.id} className={`border-b border-slate-100 hover:bg-slate-50/60 ${cfg.bg}`}>
                              <td className="px-3 py-2 text-center">
                                <input
                                  type="checkbox"
                                  aria-label={`Seleziona ${p.ragioneSociale}`}
                                  disabled={isQuadrata(p)}
                                  checked={partiteSelezionate.has(p.id)}
                                  onChange={e => setPartiteSelezionate(prev => {
                                    const next = new Set(prev);
                                    e.target.checked ? next.add(p.id) : next.delete(p.id);
                                    return next;
                                  })}
                                />
                              </td>
                              <td className="px-4 py-2">
                                <Badge variant="outline" className="text-xs">
                                  {p.tipo === "cliente" ? "CL" : "FO"}
                                </Badge>
                              </td>
                              <td className="px-4 py-2 font-medium text-slate-800">{p.ragioneSociale}</td>
                              <td className="px-4 py-2 text-slate-500 text-xs">{p.numeroFattura || "—"}</td>
                              <td className="px-4 py-2 text-right font-mono text-slate-700">
                                <div>{fmt(p.saldoPartita)}</div>
                                <div className="text-[10px] font-sans text-slate-400">
                                  {(Math.abs(Number(p.saldoPartita) || 0) / Math.max(dashboard.riepiloghi[p.tipo].totale, 1) * 100).toLocaleString("it-IT", { maximumFractionDigits: 2 })}% del totale {p.tipo === "cliente" ? "clienti" : "fornitori"}
                                </div>
                              </td>
                              <td className="px-4 py-2 text-right font-mono text-green-700">{fmt(p.importoCoperto)}</td>
                              <td className="px-4 py-2 text-right font-mono text-red-600">
                                {Number(p.residuo) > 0 ? fmt(p.residuo) : "—"}
                              </td>
                              <td className="px-4 py-2">
                                <div className="flex items-center gap-1">
                                  {cfg.icon}
                                  <span className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
                                </div>
                                {p.confidenzaMatching && (
                                  <div className="text-xs text-slate-400 mt-0.5">
                                    Conf. {(Number(p.confidenzaMatching) * 100).toFixed(0)}%
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-2 text-xs text-slate-500">
                                {p.dataMovimentoBancario && (
                                  <span className="font-medium">{p.dataMovimentoBancario} — </span>
                                )}
                                {p.descrizioneMovimento
                                  ? p.descrizioneMovimento.substring(0, 60) + (p.descrizioneMovimento.length > 60 ? "…" : "")
                                  : "—"}
                              </td>
                              <td className="px-4 py-2 text-center">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0 text-slate-400 hover:text-slate-700"
                                  onClick={() => {
                                    setNoteAperte(prev => {
                                      const s = new Set(prev);
                                      if (s.has(p.id)) s.delete(p.id); else s.add(p.id);
                                      return s;
                                    });
                                    if (!noteEdit[p.id]) {
                                      setNoteEdit(prev => ({ ...prev, [p.id]: p.noteRevisore ?? "" }));
                                    }
                                  }}
                                >
                                  ✏️
                                </Button>
                              </td>
                            </tr>
                            {notaAperta && (
                              <tr key={`nota-${p.id}`} className="bg-yellow-50 border-b border-yellow-100">
                                <td colSpan={10} className="px-4 py-2">
                                  <div className="flex gap-2 items-start">
                                    <Textarea
                                      placeholder="Nota del revisore (procedura alternativa, spiegazione, ecc.)"
                                      value={noteEdit[p.id] ?? ""}
                                      onChange={e => setNoteEdit(prev => ({ ...prev, [p.id]: e.target.value }))}
                                      className="text-xs h-16 flex-1"
                                    />
                                    <Button size="sm" className="text-xs" onClick={() => handleSalvaNota(p.id)}>
                                      Salva
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                      {partiteFiltrate.length === 0 && (
                        <tr>
                          <td colSpan={10} className="px-4 py-8 text-center text-slate-400 text-sm">
                            Nessuna partita trovata con i filtri selezionati.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

              {/* ─── VERIFICA PAGAMENTI OBBLIGATORI ───────────────── */}
            <VerificaPagamentiObbligatori sessioneId={sessioneId!} incaricoId={incaricoId} />

            {/* Analisi AI partite non trovate */}
            <Card className="border-purple-200">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-purple-600" />
                    Analisi AI — Procedure alternative (ISA Italia 560)
                  </CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-purple-300 text-purple-700 hover:bg-purple-50"
                    onClick={handleAnalisiAi}
                    disabled={analisiAiMutation.isPending}
                  >
                    {analisiAiMutation.isPending ? (
                      <><RefreshCw className="w-3 h-3 mr-1 animate-spin" /> Analisi...</>
                    ) : (
                      <><Sparkles className="w-3 h-3 mr-1" /> Genera suggerimenti AI</>
                    )}
                  </Button>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Per le partite non trovate nell'estratto conto, l'AI suggerisce le procedure alternative di revisione.
                </p>
              </CardHeader>
              {analisiAi && (
                <CardContent>
                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                    {analisiAi}
                  </div>
                </CardContent>
              )}
            </Card>

            {/* Azioni */}
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" onClick={() => setStep("upload")}>
                <Upload className="w-4 h-4 mr-2" /> Nuova verifica
              </Button>
              <Button variant="outline" onClick={() => navigate(`/incarichi/${id}`)}>
                <ChevronLeft className="w-4 h-4 mr-2" /> Torna al fascicolo
              </Button>
              {sessioneId && (
                <ExportISA560Button sessioneId={sessioneId} />
              )}
              {sessioneId && (
                <Button
                  variant="outline"
                  className="border-red-300 text-red-700 hover:bg-red-50"
                  disabled={eliminaSessione.isPending}
                  onClick={() => handleEliminaSessione(sessioneId)}
                >
                  <Trash2 className="w-4 h-4 mr-2" /> Elimina sessione
                </Button>
              )}
            </div>

          </div>
        )}

      </div>
    </RevisorLayout>
  );
}

// ─── COMPONENTE EXPORT ISA 560 ───────────────────────────────────────────────

function ExportISA560Button({ sessioneId }: { sessioneId: number }) {
  const [isDownloading, setIsDownloading] = React.useState(false);
  const utils = trpc.useUtils();

  const handleExport = async () => {
    setIsDownloading(true);
    try {
      const result = await utils.verificaIncassi.exportISA560.fetch({ sessioneId });
      if (!result?.base64) throw new Error("Nessun dato ricevuto");
      // Scarica il file
      const blob = new Blob(
        [Uint8Array.from(atob(result.base64), c => c.charCodeAt(0))],
        { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.nomeFile;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      const { toast } = await import("sonner");
      toast.error("Errore export: " + (e?.message ?? "Errore sconosciuto"));
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Button
      variant="outline"
      onClick={handleExport}
      disabled={isDownloading}
      className="border-green-300 text-green-700 hover:bg-green-50"
    >
      {isDownloading ? (
        <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Generazione... </>
      ) : (
        <><FileSpreadsheet className="w-4 h-4 mr-2" /> Esporta carta di lavoro ISA 560 (.xlsx)</>
      )}
    </Button>
  );
}

// ─── COMPONENTE VERIFICA PAGAMENTI OBBLIGATORI ─────────────────────────────────

function VerificaPagamentiObbligatori({ sessioneId, incaricoId }: { sessioneId: number; incaricoId: number }) {
  const { data, isLoading } = trpc.verificaIncassi.getVerificaPagamentiObbligatori.useQuery(
    { sessioneId, incaricoId },
    { enabled: sessioneId != null }
  );

  if (isLoading) {
    return (
      <Card className="border-amber-200">
        <CardContent className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
          <RefreshCw className="w-4 h-4 animate-spin" /> Analisi pagamenti obbligatori in corso...
        </CardContent>
      </Card>
    );
  }

  if (!data || !data.disponibile) {
    const msg = (data as any)?.messaggioIndisponibile;
    return (
      <Card className="border-amber-200 bg-amber-50/50">
        <CardContent className="p-4 text-sm text-amber-800 flex items-start gap-2">
          <Banknote className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-600" />
          <span>{msg ?? "Nessun movimento bancario disponibile per la verifica dei pagamenti obbligatori. Carica un estratto conto PDF o CSV per abilitare questa funzione."}</span>
        </CardContent>
      </Card>
    );
  }

  const { mesi, totali, anomalie, confrontoBilancio, matchImporti } = data;

  // Semaforo per riga mese
  function semaforoMese(r: typeof mesi[0]) {
    if (r.stipendi > 0 && r.inps_inail > 0) return "verde";
    if (r.stipendi > 0 || r.inps_inail > 0) return "giallo";
    return "grigio"; // nessun pagamento obbligatorio rilevato
  }

  const coloriSemaforo: Record<string, string> = {
    verde: "bg-green-100 text-green-800 border-green-200",
    giallo: "bg-amber-100 text-amber-800 border-amber-200",
    grigio: "bg-slate-100 text-slate-600 border-slate-200",
  };

  return (
    <Card className="border-amber-200">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Banknote className="w-4 h-4 text-amber-600" />
          Verifica Pagamenti Obbligatori — Stipendi, Contributi e Imposte
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Classificazione automatica dei movimenti bancari in uscita per categoria (ISA Italia 500/315).
          Il semaforo indica se nel mese sono stati rilevati sia stipendi che contributi INPS/INAIL.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* Anomalie */}
        {anomalie.length > 0 && (
          <div className="space-y-2">
            {anomalie.map((a, i) => (
              <div
                key={i}
                className={`flex items-start gap-2 p-3 rounded-lg border text-sm ${
                  a.severita === "alta"
                    ? "bg-red-50 border-red-200 text-red-800"
                    : "bg-amber-50 border-amber-200 text-amber-800"
                }`}
              >
                <FileWarning className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{a.messaggio}</span>
              </div>
            ))}
          </div>
        )}

        {/* Totali */}
        {totali && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
              <Users className="w-4 h-4 text-blue-600 mx-auto mb-1" />
              <div className="text-xs text-muted-foreground">Stipendi totali</div>
              <div className="font-semibold text-sm text-blue-800">{formatCurrency(totali.stipendi)}</div>
              <div className="text-xs text-blue-600">{totali.mesiConStipendi} mesi</div>
            </div>
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
              <Building className="w-4 h-4 text-green-600 mx-auto mb-1" />
              <div className="text-xs text-muted-foreground">INPS / INAIL</div>
              <div className="font-semibold text-sm text-green-800">{formatCurrency(totali.inps_inail)}</div>
              <div className="text-xs text-green-600">{totali.mesiConContributi} mesi</div>
            </div>
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-center">
              <FileWarning className="w-4 h-4 text-orange-600 mx-auto mb-1" />
              <div className="text-xs text-muted-foreground">F24 / Imposte</div>
              <div className="font-semibold text-sm text-orange-800">{formatCurrency(totali.f24_imposte)}</div>
              <div className="text-xs text-orange-600">{totali.mesiConF24} versamenti</div>
            </div>

          </div>
        )}

        {/* Griglia mese × categoria */}
        {mesi.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50">
                  <th className="text-left p-2 border border-slate-200 font-medium">Mese</th>
                  <th className="text-right p-2 border border-slate-200 font-medium text-blue-700">
                    <Users className="w-3 h-3 inline mr-1" />Stipendi
                  </th>
                  <th className="text-right p-2 border border-slate-200 font-medium text-green-700">
                    <Building className="w-3 h-3 inline mr-1" />INPS/INAIL
                  </th>
                  <th className="text-right p-2 border border-slate-200 font-medium text-orange-700">
                    <FileWarning className="w-3 h-3 inline mr-1" />F24/Imposte
                  </th>

                  <th className="text-center p-2 border border-slate-200 font-medium">Stato</th>
                </tr>
              </thead>
              <tbody>
                {mesi.map((r) => {
                  const semaforo = semaforoMese(r);
                  return (
                    <tr key={r.mese} className="hover:bg-slate-50/50">
                      <td className="p-2 border border-slate-200 font-medium">{r.meseLabel}</td>
                      <td className="p-2 border border-slate-200 text-right text-blue-700">
                        {r.stipendi > 0 ? formatCurrency(r.stipendi) : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="p-2 border border-slate-200 text-right text-green-700">
                        {r.inps_inail > 0 ? formatCurrency(r.inps_inail) : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="p-2 border border-slate-200 text-right text-orange-700">
                        {r.f24_imposte > 0 ? formatCurrency(r.f24_imposte) : <span className="text-slate-400">—</span>}
                      </td>

                      <td className="p-2 border border-slate-200 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded-full border text-xs font-medium ${coloriSemaforo[semaforo]}`}>
                          {semaforo === "verde" ? "✓ Completo" : semaforo === "giallo" ? "⚠ Parziale" : "— Nessuno"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            Nessun pagamento obbligatorio classificato nei movimenti bancari disponibili.
            Verifica che le descrizioni dei movimenti contengano riferimenti a stipendi, INPS, F24 o contributi.
          </p>
        )}

        {/* Confronto con bilancio */}
        {confrontoBilancio && (
          <div className={`rounded-lg border p-4 ${
            confrontoBilancio.semaforo === "verde" ? "bg-green-50 border-green-200" :
            confrontoBilancio.semaforo === "giallo" ? "bg-amber-50 border-amber-200" :
            "bg-red-50 border-red-200"
          }`}>
            <div className="flex items-center gap-2 mb-3">
              <span className="font-semibold text-sm">
                {confrontoBilancio.semaforo === "verde" ? "✅" : confrontoBilancio.semaforo === "giallo" ? "⚠️" : "🚨"}
                {" "}Confronto con bilancio {confrontoBilancio.annoBilancio}
              </span>
              {confrontoBilancio.numeroDipendenti && (
                <span className="text-xs text-muted-foreground ml-auto">{confrontoBilancio.numeroDipendenti} dipendenti a bilancio</span>
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3 text-xs">
              <div className="bg-white/60 rounded p-2 text-center">
                <div className="text-muted-foreground">Costo personale bilancio</div>
                <div className="font-semibold text-sm">{formatCurrency(confrontoBilancio.costoPersonaleBilancio)}</div>
              </div>
              <div className="bg-white/60 rounded p-2 text-center">
                <div className="text-muted-foreground">Stipendi estratto conto</div>
                <div className="font-semibold text-sm">{formatCurrency(confrontoBilancio.stipendiEstrattoConto)}</div>
              </div>
              <div className="bg-white/60 rounded p-2 text-center">
                <div className="text-muted-foreground">Scostamento assoluto</div>
                <div className={`font-semibold text-sm ${
                  (confrontoBilancio.scostamentoAssoluto ?? 0) < 0 ? "text-red-700" : "text-green-700"
                }`}>{formatCurrency(confrontoBilancio.scostamentoAssoluto)}</div>
              </div>
              <div className="bg-white/60 rounded p-2 text-center">
                <div className="text-muted-foreground">Scostamento %</div>
                <div className={`font-semibold text-sm ${
                  Math.abs(confrontoBilancio.scostamentoPerc ?? 0) <= 10 ? "text-green-700" :
                  Math.abs(confrontoBilancio.scostamentoPerc ?? 0) <= 25 ? "text-amber-700" : "text-red-700"
                }`}>{(confrontoBilancio.scostamentoPerc ?? 0).toFixed(1)}%</div>
              </div>
            </div>
            <p className="text-xs">{confrontoBilancio.nota}</p>
          </div>
        )}

        {/* Matching per importo vs saldi SP */}
        {matchImporti && matchImporti.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Banknote className="w-4 h-4 text-indigo-600" />
              <span className="font-semibold text-sm text-indigo-800">Matching per importo — Saldi Stato Patrimoniale</span>
              <span className="text-xs text-muted-foreground ml-1">(tolleranza ±2% o ±100 €)</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-indigo-50">
                    <th className="text-left p-2 border border-indigo-200 font-medium text-indigo-700">Voce SP</th>
                    <th className="text-right p-2 border border-indigo-200 font-medium text-indigo-700">Saldo SP (€)</th>
                    <th className="text-left p-2 border border-indigo-200 font-medium text-indigo-700">Movimento bancario abbinato</th>
                    <th className="text-right p-2 border border-indigo-200 font-medium text-indigo-700">Importo (€)</th>
                    <th className="text-right p-2 border border-indigo-200 font-medium text-indigo-700">Scostamento</th>
                    <th className="text-center p-2 border border-indigo-200 font-medium text-indigo-700">Stato</th>
                  </tr>
                </thead>
                <tbody>
                  {matchImporti.map((m, i) => {
                    const abbinato = m.movimentiAbbinati[0];
                    return (
                      <tr key={i} className="hover:bg-indigo-50/30">
                        <td className="p-2 border border-slate-200 font-medium">{m.voce}</td>
                        <td className="p-2 border border-slate-200 text-right font-mono">{formatCurrency(m.importoSP)}</td>
                        <td className="p-2 border border-slate-200">
                          {abbinato ? (
                            <div>
                              <div className="font-medium">{abbinato.descrizione}</div>
                              <div className="text-muted-foreground">{abbinato.data}</div>
                              {!abbinato.classificatoTestuale && (
                                <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200 text-xs">
                                  Non classificato testualmente
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400 italic">Nessun movimento trovato</span>
                          )}
                        </td>
                        <td className="p-2 border border-slate-200 text-right font-mono">
                          {abbinato ? formatCurrency(abbinato.importo) : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="p-2 border border-slate-200 text-right">
                          {abbinato ? (
                            <span className={abbinato.scostamentoAss === 0 ? "text-green-700 font-medium" : "text-amber-700"}>
                              {abbinato.scostamentoAss >= 0 ? "+" : ""}{formatCurrency(abbinato.scostamentoAss)}
                              <br />
                              <span className="text-xs">({abbinato.scostamentoPerc >= 0 ? "+" : ""}{abbinato.scostamentoPerc.toFixed(1)}%)</span>
                            </span>
                          ) : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="p-2 border border-slate-200 text-center">
                          <span className={`inline-block px-2 py-0.5 rounded-full border text-xs font-medium ${
                            m.statoMatch === "trovato" ? "bg-green-100 text-green-800 border-green-200" :
                            m.statoMatch === "trovato_parziale" ? "bg-amber-100 text-amber-800 border-amber-200" :
                            "bg-red-100 text-red-800 border-red-200"
                          }`}>
                            {m.statoMatch === "trovato" ? "✓ Esatto" :
                             m.statoMatch === "trovato_parziale" ? "≈ Parziale" : "✗ Non trovato"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              La tabella confronta i saldi dei debiti a breve termine dello Stato Patrimoniale con i movimenti bancari in uscita di importo simile.
              I movimenti con badge “Non classificato testualmente” sono stati trovati per importo ma non riconosciuti dai pattern descrittivi (es. “emolumenti”, “bonifico” generico).
            </p>
          </div>
        )}

        <p className="text-xs text-muted-foreground border-t pt-3">
          La classificazione è basata su pattern testuali nelle descrizioni dei movimenti bancari.
          Movimenti con descrizioni generiche potrebbero non essere classificati correttamente — verificare manualmente i casi dubbi.
        </p>
      </CardContent>
    </Card>
  );
}
