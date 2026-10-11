import React, { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import RevisorLayout from "@/components/revisione/RevisorLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";
import {
  ChevronLeft, Banknote, Sparkles, Save, CheckCircle2, AlertCircle,
  Info, Plus, Trash2, ClipboardList, AlertTriangle, Upload, FileText,
} from "lucide-react";

interface ContoCorriente {
  banca: string;
  iban?: string;
  saldoBilancio: number;
  saldoEstrattoConto?: number;
  differenza?: number;
  riconciliato?: boolean;
  note?: string;
}

interface ChecklistItem {
  voce: string;
  completata: boolean;
  note?: string;
}

interface CentraleRischiIntermediario {
  mese: string;
  intermediario: string;
  categoria: "crediti_per_cassa" | "garanzie_ricevute" | "altro";
  accordato: number;
  accordatoOperativo: number;
  utilizzato: number;
  saldoMedio: number;
  valoreGaranzia: number;
  importoGarantito: number;
}

interface CentraleRischiMese {
  mese: string;
  intermediari: number;
  accordato: number;
  accordatoOperativo: number;
  utilizzato: number;
  saldoMedio: number;
  garanzieRicevute: number;
  importoGarantito: number;
}

interface CentraleRischiData {
  nomeFile: string;
  intestatario?: string;
  codiceIntestatario?: string;
  dateRichieste: string[];
  mesi: CentraleRischiMese[];
  dettagli: CentraleRischiIntermediario[];
  totaleAccordato: number;
  totaleUtilizzato: number;
  totaleGaranzieRicevute: number;
  utilizzoSuAccordato: number | null;
  anomalie: string[];
  elaboratoIl: string;
}

function parseNumeroItaliano(value: string | undefined): number {
  const clean = String(value ?? "").trim().replace(/\s/g, "");
  if (!clean) return 0;
  const normalized = clean.includes(",")
    ? clean.replace(/\./g, "").replace(",", ".")
    : clean.replace(/\./g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

const MAX_IMPORTO_CENTRALE_RISCHI = 50_000_000;
const IMPORTO_CENTRALE_RISCHI_RE = /\b\d{1,3}(?:\.\d{3})+\b|\b\d{1,8}\b/g;

function isImportoCentraleRischiPlausibile(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= MAX_IMPORTO_CENTRALE_RISCHI;
}

function normalizzaRigaCentraleRischi(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

function estraiImportiCentraleRischi(line: string): number[] {
  return (line.match(IMPORTO_CENTRALE_RISCHI_RE) ?? [])
    .map(parseNumeroItaliano)
    .filter(isImportoCentraleRischiPlausibile);
}

function hasImportiTabellariCentraleRischi(line: string, minCount: number): boolean {
  return (line.match(/\b\d{1,3}(?:\.\d{3})+\b/g) ?? []).length >= minCount;
}

function isRigaCreditoCentraleRischi(line: string): boolean {
  return /crediti per cassa|autoliquidant|scadenza|revoca|finanziament|rischi a revoca|sofferenz|sconfin|firma/i.test(line);
}

function isRigaGaranziaCentraleRischi(line: string): boolean {
  return /garanzie ricevute|valore garanzia|importo garantito|garanzia/i.test(line);
}

function scegliValoriCreditoCentraleRischi(line: string): [number, number, number, number] | null {
  const importi = estraiImportiCentraleRischi(line);
  if (importi.length < 4) return null;
  const values = importi.slice(-4) as [number, number, number, number];
  if (values.every(value => value === 0)) return null;
  const massimoAffidato = Math.max(values[0], values[1]);
  if (massimoAffidato > 0 && values[2] > massimoAffidato * 1.5 + 1000) return null;
  return values;
}

function scegliValoriGaranziaCentraleRischi(line: string): [number, number] | null {
  const importi = estraiImportiCentraleRischi(line);
  if (importi.length < 2) return null;
  const values = importi.slice(-2) as [number, number];
  return values[0] > 0 || values[1] > 0 ? values : null;
}

function isMeseChiusuraEsercizioCr(mese: string, annoEsercizio: number | null): boolean {
  const normalized = mese.toLowerCase();
  if (!normalized.includes("dicembre")) return false;
  return annoEsercizio == null || normalized.includes(String(annoEsercizio));
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

function parseCentraleRischiText(text: string, nomeFile: string): CentraleRischiData {
  const dateRichieste = text.match(/Date richieste:\s*([\s\S]*?)DATI ANAGRAFICI/i)?.[1]
    ?.split(/\s+/)
    .map(v => v.trim())
    .filter(v => /^[a-z]{3}-\d{2}$/i.test(v)) ?? [];
  const intestatario = text.match(/Intestatario:\s*\n?(.+?)(?:\n|Sede legale|Codice Lei)/i)?.[1]?.trim();
  const codiceIntestatario = text.match(/Intestatario:\s+(\d{6,})/i)?.[1]
    ?? text.match(/Codice intestatario:[\s\S]*?\n(\d{6,})/i)?.[1];
  const monthBlocks = Array.from(text.matchAll(/DATA DI RIFERIMENTO:\s*([^\n]+)\n([\s\S]*?)(?=DATA DI RIFERIMENTO:|$)/gi));
  const dettagli: CentraleRischiIntermediario[] = [];
  let righeScartatePerImportiAnomali = 0;

  for (const monthBlock of monthBlocks) {
    const mese = monthBlock[1].trim();
    const block = monthBlock[2];
    const sections = Array.from(block.matchAll(/(?:^|\n)([A-Z0-9][^\n]{2,}?)Intermediario:\s*\n?([\s\S]*?)(?=\n[A-Z0-9][^\n]{2,}?Intermediario:|Data di elaborazione|DATA DI RIFERIMENTO:|$)/g));

    for (const section of sections) {
      const intermediario = section[1].replace(/\s+/g, " ").trim();
      const body = section[2];
      const creditBody = body.split(/INFORMAZIONI SUI GARANTI/i)[0];
      const creditLines = creditBody.split(/\n+/).map(normalizzaRigaCentraleRischi).filter(Boolean);
      const candidateRows = creditLines.flatMap((line, index) => {
        const isRigaCredito = isRigaCreditoCentraleRischi(line);
        const isRigaImporti = hasImportiTabellariCentraleRischi(line, 4);
        if (!isRigaCredito && !isRigaImporti) return [];
        const combinedLine = normalizzaRigaCentraleRischi(`${line} ${creditLines[index + 1] ?? ""}`);
        const values = scegliValoriCreditoCentraleRischi(combinedLine);
        if (!values && /\d/.test(combinedLine)) righeScartatePerImportiAnomali += 1;
        return values ? [{ line: combinedLine, values }] : [];
      });
      const totalRow = candidateRows.find(row => /crediti per cassa/i.test(row.line));
      const rowsToUse = totalRow ? [totalRow] : candidateRows;

      for (const row of rowsToUse) {
        const values = row.values;
        dettagli.push({
          mese,
          intermediario,
          categoria: "crediti_per_cassa",
          accordato: values[0],
          accordatoOperativo: values[1],
          utilizzato: values[2],
          saldoMedio: values[3],
          valoreGaranzia: 0,
          importoGarantito: 0,
        });
      }

      if (body.includes("Garanzie ricevute")) {
        const guaranteeLines = body.split(/\n+/).map(normalizzaRigaCentraleRischi).filter(Boolean);
        const candidate = guaranteeLines
          .flatMap((line, index) => {
            if (!isRigaGaranziaCentraleRischi(line)) return [];
            const combinedLine = normalizzaRigaCentraleRischi(`${line} ${guaranteeLines[index + 1] ?? ""}`);
            const values = scegliValoriGaranziaCentraleRischi(combinedLine);
            if (!values && /\d/.test(combinedLine)) righeScartatePerImportiAnomali += 1;
            return values ? [values] : [];
          })
          .pop();
        if (candidate) {
          dettagli.push({
            mese,
            intermediario,
            categoria: "garanzie_ricevute",
            accordato: 0,
            accordatoOperativo: 0,
            utilizzato: 0,
            saldoMedio: 0,
            valoreGaranzia: candidate[0],
            importoGarantito: candidate[1],
          });
        }
      }
    }
  }

  const mesiMap = new Map<string, CentraleRischiMese>();
  for (const row of dettagli) {
    const item = mesiMap.get(row.mese) ?? {
      mese: row.mese,
      intermediari: 0,
      accordato: 0,
      accordatoOperativo: 0,
      utilizzato: 0,
      saldoMedio: 0,
      garanzieRicevute: 0,
      importoGarantito: 0,
    };
    item.accordato += row.accordato;
    item.accordatoOperativo += row.accordatoOperativo;
    item.utilizzato += row.utilizzato;
    item.saldoMedio += row.saldoMedio;
    item.garanzieRicevute += row.valoreGaranzia;
    item.importoGarantito += row.importoGarantito;
    item.intermediari = new Set(dettagli.filter(d => d.mese === row.mese).map(d => d.intermediario)).size;
    mesiMap.set(row.mese, item);
  }

  const mesi = Array.from(mesiMap.values());
  const ultimo = mesi[0];
  const anomalie: string[] = [];
  if (!ultimo) anomalie.push("Nessun mese rilevato nel PDF della Centrale Rischi.");
  if (ultimo?.accordato > 0 && ultimo.utilizzato / ultimo.accordato > 0.9) {
    anomalie.push("Utilizzo superiore al 90% dell'accordato nell'ultimo mese disponibile.");
  }
  if (righeScartatePerImportiAnomali > 0) {
    anomalie.push("Alcune righe della Centrale Rischi sono state scartate per importi non plausibili o non riconducibili a righe di affidamento.");
  }
  if (dettagli.some(d => /SCADUT|SCONFIN|CONTESTAT/i.test(JSON.stringify(d)))) {
    anomalie.push("Possibili posizioni scadute, sconfinanti o contestate rilevate nel testo.");
  }

  return {
    nomeFile,
    intestatario,
    codiceIntestatario,
    dateRichieste,
    mesi,
    dettagli,
    totaleAccordato: ultimo?.accordato ?? 0,
    totaleUtilizzato: ultimo?.utilizzato ?? 0,
    totaleGaranzieRicevute: ultimo?.garanzieRicevute ?? 0,
    utilizzoSuAccordato: ultimo?.accordato ? Math.round((ultimo.utilizzato / ultimo.accordato) * 1000) / 10 : null,
    anomalie,
    elaboratoIl: new Date().toISOString(),
  };
}

const RISCHIO_CONFIG = {
  basso: { label: "Basso", bg: "bg-green-50 border-green-200", badge: "bg-green-100 text-green-800" },
  medio: { label: "Medio", bg: "bg-amber-50 border-amber-200", badge: "bg-amber-100 text-amber-800" },
  alto: { label: "Alto", bg: "bg-orange-50 border-orange-200", badge: "bg-orange-100 text-orange-800" },
  critico: { label: "Critico", bg: "bg-red-50 border-red-200", badge: "bg-red-100 text-red-800" },
};

export default function SchedaDisponibilitaLiquide() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const incaricoId = parseInt(id ?? "0");

  const [contiCorrenti, setContiCorrenti] = useState<ContoCorriente[]>([]);
  const [saldoCassaBilancio, setSaldoCassaBilancio] = useState("");
  const [saldoCassaConteggio, setSaldoCassaConteggio] = useState("");
  const [noteCassa, setNoteCassa] = useState("");
  const [riconciliazioneEseguita, setRiconciliazioneEseguita] = useState(false);
  const [dataRiconciliazione, setDataRiconciliazione] = useState("");
  const [noteRiconciliazione, setNoteRiconciliazione] = useState("");
  const [estrattiAcquisiti, setEstratiAcquisiti] = useState(false);
  const [noteEstratto, setNoteEstratto] = useState("");
  const [circBancaria, setCircBancaria] = useState(false);
  const [noteCircBancaria, setNoteCircBancaria] = useState("");
  const [centraleRischi, setCentraleRischi] = useState<CentraleRischiData | null>(null);
  const [letturaCrInCorso, setLetturaCrInCorso] = useState(false);
  const [meseCentraleRischiSelezionato, setMeseCentraleRischiSelezionato] = useState<string | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [conclusioni, setConclusioni] = useState("");
  const [rischio, setRischio] = useState("medio");
  const [noteRevisore, setNoteRevisore] = useState("");
  const [stato, setStato] = useState("da_iniziare");
  const [analisiAI, setAnalisiAI] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<"conti" | "cassa" | "centraleRischi" | "checklist" | "conclusioni">("conti");

  const { data: scheda, isLoading } = trpc.schedeControllo.getSchedaDisponibilitaLiquide.useQuery(
    { incaricoId }, { enabled: incaricoId > 0 }
  );
  const { data: analisiVerticale } = trpc.documenti.getAnalisiVerticale.useQuery(
    { incaricoId }, { enabled: incaricoId > 0 }
  );
  const { data: incarico } = trpc.incarichi.get.useQuery(
    { id: incaricoId }, { enabled: incaricoId > 0 }
  );

  const salvaMutation = trpc.schedeControllo.salvaSchedaDisponibilitaLiquide.useMutation({
    onSuccess: () => toast.success("Scheda disponibilità liquide salvata"),
    onError: () => toast.error("Errore nel salvataggio"),
  });
  const analizzaMutation = trpc.schedeControllo.analizzaDisponibilitaConAI.useMutation({
    onSuccess: (data) => {
      setAnalisiAI(data);
      if (data.rischioValutazione) setRischio(data.rischioValutazione);
      if (data.conclusioni) setConclusioni(data.conclusioni);
      toast.success("Analisi AI completata");
    },
    onError: () => toast.error("Errore nell'analisi AI"),
  });

  useEffect(() => {
    if (!scheda) return;
    if (scheda.contiCorrenti?.length) setContiCorrenti(scheda.contiCorrenti as ContoCorriente[]);
    if (scheda.saldoCassaBilancio) setSaldoCassaBilancio(scheda.saldoCassaBilancio);
    if (scheda.saldoCassaConteggio) setSaldoCassaConteggio(scheda.saldoCassaConteggio);
    if (scheda.noteCassa) setNoteCassa(scheda.noteCassa);
    setRiconciliazioneEseguita(scheda.riconciliazioneEseguita ?? false);
    if (scheda.dataRiconciliazione) setDataRiconciliazione(String(scheda.dataRiconciliazione));
    if (scheda.noteRiconciliazione) setNoteRiconciliazione(scheda.noteRiconciliazione);
    setEstratiAcquisiti(scheda.estrattiContoAcquisiti ?? false);
    if (scheda.noteEstrattoConto) setNoteEstratto(scheda.noteEstrattoConto);
    setCircBancaria(scheda.circolarizzazioneBancaria ?? false);
    if (scheda.noteCircolarizzazioneBancaria) setNoteCircBancaria(scheda.noteCircolarizzazioneBancaria);
    if (scheda.centraleRischi) setCentraleRischi(scheda.centraleRischi as CentraleRischiData);
    if (scheda.checklistIsa?.length) setChecklist(scheda.checklistIsa as ChecklistItem[]);
    if (scheda.conclusioni) setConclusioni(scheda.conclusioni);
    if (scheda.rischioValutazione) setRischio(scheda.rischioValutazione);
    if (scheda.noteRevisore) setNoteRevisore(scheda.noteRevisore);
    if (scheda.stato) setStato(scheda.stato);
  }, [scheda]);

  const checklistCompletate = checklist.filter(c => c.completata).length;

  // Calcola totali conti correnti
  const totaleSaldoBilancio = contiCorrenti.reduce((s, c) => s + c.saldoBilancio, 0);
  const totaleSaldoEstrattoContoCalcolato = contiCorrenti.filter(c => c.saldoEstrattoConto !== undefined).reduce((s, c) => s + (c.saldoEstrattoConto ?? 0), 0);
  const totaleDifferenze = contiCorrenti.filter(c => c.differenza !== undefined).reduce((s, c) => s + (c.differenza ?? 0), 0);
  const differenzaCassa = saldoCassaBilancio && saldoCassaConteggio
    ? parseFloat(saldoCassaConteggio) - parseFloat(saldoCassaBilancio)
    : null;
  const voceSp = (chiave: string): number | null => {
    const voce = (analisiVerticale as any)?.sp?.find((v: any) => v.chiave === chiave);
    const valore = Number(voce?.valore);
    return Number.isFinite(valore) ? valore : null;
  };
  const debitiBancariCT = voceSp("debitiBancariCT");
  const debitiBancariLT = voceSp("debitiBancariLT");
  const debitiBancariBilancio = (debitiBancariCT ?? 0) + (debitiBancariLT ?? 0);
  const haDebitiBancariBilancio = debitiBancariCT != null || debitiBancariLT != null;
  const annoEsercizio = Number(incarico?.annoEsercizio);
  const annoEsercizioValido = Number.isFinite(annoEsercizio) ? annoEsercizio : null;
  const meseChiusuraCr = centraleRischi?.mesi.find(mese => isMeseChiusuraEsercizioCr(mese.mese, annoEsercizioValido))
    ?? centraleRischi?.mesi.find(mese => isMeseChiusuraEsercizioCr(mese.mese, null))
    ?? centraleRischi?.mesi[0]
    ?? null;
  const meseCrSelezionato = centraleRischi?.mesi.find(mese => mese.mese === meseCentraleRischiSelezionato)
    ?? meseChiusuraCr
    ?? centraleRischi?.mesi[0]
    ?? null;
  const dettagliMeseCrSelezionato = centraleRischi?.dettagli.filter(row => row.mese === meseCrSelezionato?.mese) ?? [];
  const utilizzoCrBilancio = meseChiusuraCr?.utilizzato ?? null;
  const scostamentoBancheCr = haDebitiBancariBilancio && utilizzoCrBilancio != null
    ? utilizzoCrBilancio - debitiBancariBilancio
    : null;
  const scostamentoBancheCrPerc = scostamentoBancheCr != null && debitiBancariBilancio !== 0
    ? Math.round((scostamentoBancheCr / Math.abs(debitiBancariBilancio)) * 1000) / 10
    : null;
  const sogliaScostamentoBanche = Math.max(1000, Math.abs(debitiBancariBilancio) * 0.05);
  const scostamentoBancheRilevante = scostamentoBancheCr != null && Math.abs(scostamentoBancheCr) > sogliaScostamentoBanche;
  const centraleRischiImportiAnomali = !!centraleRischi
    && (centraleRischi.totaleAccordato > MAX_IMPORTO_CENTRALE_RISCHI
      || centraleRischi.totaleUtilizzato > MAX_IMPORTO_CENTRALE_RISCHI
      || centraleRischi.mesi.some(mese => mese.accordato > MAX_IMPORTO_CENTRALE_RISCHI || mese.utilizzato > MAX_IMPORTO_CENTRALE_RISCHI));

  function aggiornaCC(i: number, campo: keyof ContoCorriente, valore: any) {
    setContiCorrenti(prev => prev.map((c, idx) => {
      if (idx !== i) return c;
      const updated = { ...c, [campo]: valore };
      // Ricalcola differenza automaticamente
      if (campo === "saldoBilancio" || campo === "saldoEstrattoConto") {
        const sb = campo === "saldoBilancio" ? parseFloat(valore) || 0 : c.saldoBilancio;
        const se = campo === "saldoEstrattoConto" ? parseFloat(valore) || 0 : (c.saldoEstrattoConto ?? 0);
        if (c.saldoEstrattoConto !== undefined || campo === "saldoEstrattoConto") {
          updated.differenza = se - sb;
        }
      }
      return updated;
    }));
  }

  function salva() {
    salvaMutation.mutate({
      incaricoId,
      contiCorrenti,
      saldoCassaBilancio: saldoCassaBilancio || undefined,
      saldoCassaConteggio: saldoCassaConteggio || undefined,
      noteCassa,
      riconciliazioneEseguita,
      dataRiconciliazione: dataRiconciliazione || undefined,
      noteRiconciliazione,
      estrattiContoAcquisiti: estrattiAcquisiti,
      noteEstrattoConto: noteEstratto,
      circolarizzazioneBancaria: circBancaria,
      noteCircolarizzazioneBancaria: noteCircBancaria,
      centraleRischi: centraleRischi as any,
      checklistIsa: checklist,
      conclusioni,
      rischioValutazione: rischio as any,
      noteRevisore,
      stato: stato as any,
    });
  }

  function toggleChecklist(i: number) {
    setChecklist(prev => prev.map((item, idx) => idx === i ? { ...item, completata: !item.completata } : item));
  }

  async function leggiCentraleRischi(file: File | null | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Carica un PDF della Centrale Rischi");
      return;
    }

    setLetturaCrInCorso(true);
    try {
      const text = await extractPdfText(file);
      const parsed = parseCentraleRischiText(text, file.name);
      setCentraleRischi(parsed);
      setActiveTab("centraleRischi");
      toast.success(`Centrale Rischi letta: ${parsed.mesi.length} mesi e ${parsed.dettagli.length} righe`);
    } catch (error: any) {
      toast.error(`Errore lettura Centrale Rischi: ${error?.message ?? "PDF non leggibile"}`);
    } finally {
      setLetturaCrInCorso(false);
    }
  }

  if (isLoading) {
    return (
      <RevisorLayout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      </RevisorLayout>
    );
  }

  const rischioConf = RISCHIO_CONFIG[rischio as keyof typeof RISCHIO_CONFIG] ?? RISCHIO_CONFIG.medio;

  return (
    <RevisorLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/incarichi/${incaricoId}`)}>
            <ChevronLeft className="w-4 h-4 mr-1" /> Indietro
          </Button>
          <div className="flex items-center gap-2">
            <Banknote className="w-5 h-5 text-green-600" />
            <h1 className="text-xl font-bold">Scheda Disponibilità Liquide</h1>
            {incarico && <span className="text-slate-500 text-sm">— {incarico.cliente?.ragioneSociale ?? ""} {incarico.annoEsercizio}</span>}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Badge className={rischioConf.badge}>Rischio {rischioConf.label}</Badge>
            <Badge variant="outline">{checklistCompletate}/{checklist.length} controlli</Badge>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b">
          {(["conti", "cassa", "centraleRischi", "checklist", "conclusioni"] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium capitalize transition-colors ${activeTab === tab ? "border-b-2 border-blue-600 text-blue-600" : "text-slate-500 hover:text-slate-700"}`}>
              {tab === "conti" ? "Conti Correnti" : tab === "cassa" ? "Cassa e Riconciliazione" : tab === "centraleRischi" ? "Centrale Rischi" : tab === "checklist" ? "Checklist ISA" : "Conclusioni"}
            </button>
          ))}
        </div>

        {/* Tab: Conti Correnti */}
        {activeTab === "conti" && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Conti Correnti Bancari</CardTitle>
                  <Button size="sm" variant="outline" onClick={() => setContiCorrenti(prev => [...prev, { banca: "", saldoBilancio: 0 }])}>
                    <Plus className="w-3.5 h-3.5 mr-1" /> Aggiungi c/c
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {contiCorrenti.length === 0 && (
                  <div className="text-center py-8 text-slate-400">
                    <Banknote className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">Nessun conto corrente inserito. Aggiungi i conti correnti dell'impresa.</p>
                  </div>
                )}
                {contiCorrenti.map((cc, i) => (
                  <div key={i} className="p-4 border rounded-lg space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Banca</Label>
                        <Input value={cc.banca} onChange={e => aggiornaCC(i, "banca", e.target.value)} placeholder="Nome banca" className="h-8 text-sm" />
                      </div>
                      <div>
                        <Label className="text-xs">IBAN</Label>
                        <Input value={cc.iban ?? ""} onChange={e => aggiornaCC(i, "iban", e.target.value)} placeholder="IT00 X000 0000 0000 0000 0000 000" className="h-8 text-sm font-mono" />
                      </div>
                      <div>
                        <Label className="text-xs">Saldo da bilancio (€)</Label>
                        <Input type="number" value={cc.saldoBilancio} onChange={e => aggiornaCC(i, "saldoBilancio", parseFloat(e.target.value) || 0)} className="h-8 text-sm" />
                      </div>
                      <div>
                        <Label className="text-xs">Saldo da estratto conto (€)</Label>
                        <Input type="number" value={cc.saldoEstrattoConto ?? ""} onChange={e => aggiornaCC(i, "saldoEstrattoConto", parseFloat(e.target.value) || 0)} placeholder="Da compilare dopo riconciliazione" className="h-8 text-sm" />
                      </div>
                    </div>
                    {cc.differenza !== undefined && (
                      <div className={`px-3 py-1.5 rounded text-sm font-medium ${Math.abs(cc.differenza) < 0.01 ? "bg-green-50 text-green-700" : "bg-orange-50 text-orange-700"}`}>
                        {Math.abs(cc.differenza) < 0.01
                          ? "✓ Riconciliato"
                          : `Differenza: ${formatCurrency(cc.differenza)}`}
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Checkbox checked={cc.riconciliato ?? false} onCheckedChange={v => aggiornaCC(i, "riconciliato", !!v)} />
                        <Label className="text-xs">Riconciliazione completata</Label>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => setContiCorrenti(prev => prev.filter((_, idx) => idx !== i))} className="h-7 text-red-400 hover:text-red-600">
                        <Trash2 className="w-3.5 h-3.5 mr-1" /> Rimuovi
                      </Button>
                    </div>
                    <Input value={cc.note ?? ""} onChange={e => aggiornaCC(i, "note", e.target.value)} placeholder="Note (partite in transito, assegni in circolazione...)" className="h-7 text-xs" />
                  </div>
                ))}
                {contiCorrenti.length > 0 && (
                  <div className="p-3 bg-slate-50 rounded-lg text-sm space-y-1">
                    <div className="flex justify-between"><span>Totale saldo bilancio:</span><span className="font-medium">{formatCurrency(totaleSaldoBilancio)}</span></div>
                    {contiCorrenti.some(c => c.saldoEstrattoConto !== undefined) && (
                      <div className="flex justify-between"><span>Totale saldo estratti conto:</span><span className="font-medium">{formatCurrency(totaleSaldoEstrattoContoCalcolato)}</span></div>
                    )}
                    {contiCorrenti.some(c => c.differenza !== undefined) && (
                      <div className={`flex justify-between font-medium ${Math.abs(totaleDifferenze) < 0.01 ? "text-green-700" : "text-orange-700"}`}>
                        <span>Differenza totale:</span><span>{formatCurrency(totaleDifferenze)}</span>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Estratti conto e circolarizzazione */}
            <Card>
              <CardHeader><CardTitle className="text-base">Estratti Conto e Circolarizzazione Bancaria</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  <Checkbox id="estratti" checked={estrattiAcquisiti} onCheckedChange={v => setEstratiAcquisiti(!!v)} />
                  <Label htmlFor="estratti">Estratti conto bancari al 31/12 acquisiti per tutti i c/c</Label>
                </div>
                <div>
                  <Label>Note sugli estratti conto</Label>
                  <Textarea value={noteEstratto} onChange={e => setNoteEstratto(e.target.value)} rows={2} placeholder="Osservazioni, banche che non hanno fornito estratti..." />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="circbancaria" checked={circBancaria} onCheckedChange={v => setCircBancaria(!!v)} />
                  <Label htmlFor="circbancaria">Circolarizzazione bancaria inviata (ISA 505)</Label>
                </div>
                {circBancaria && (
                  <div>
                    <Label>Note sulla circolarizzazione bancaria</Label>
                    <Textarea value={noteCircBancaria} onChange={e => setNoteCircBancaria(e.target.value)} rows={2} placeholder="Banche contattate, risposte ricevute, eccezioni..." />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Tab: Cassa e Riconciliazione */}
        {activeTab === "cassa" && (
          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Cassa</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Saldo cassa da bilancio (€)</Label>
                    <Input type="number" value={saldoCassaBilancio} onChange={e => setSaldoCassaBilancio(e.target.value)} placeholder="0,00" />
                  </div>
                  <div>
                    <Label>Saldo cassa da conteggio (€)</Label>
                    <Input type="number" value={saldoCassaConteggio} onChange={e => setSaldoCassaConteggio(e.target.value)} placeholder="0,00" />
                  </div>
                </div>
                {differenzaCassa !== null && (
                  <div className={`p-3 rounded-lg border text-sm font-medium ${Math.abs(differenzaCassa) < 0.01 ? "bg-green-50 border-green-200 text-green-700" : "bg-orange-50 border-orange-200 text-orange-700"}`}>
                    {Math.abs(differenzaCassa) < 0.01
                      ? "✓ Cassa quadrata"
                      : `Differenza cassa: ${formatCurrency(differenzaCassa)}`}
                  </div>
                )}
                <div>
                  <Label>Note sulla cassa</Label>
                  <Textarea value={noteCassa} onChange={e => setNoteCassa(e.target.value)} rows={2} placeholder="Modalità di conteggio, osservazioni" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Riconciliazione Bancaria</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  <Checkbox id="riconciliazione" checked={riconciliazioneEseguita} onCheckedChange={v => setRiconciliazioneEseguita(!!v)} />
                  <Label htmlFor="riconciliazione">Riconciliazione bancaria eseguita per tutti i c/c</Label>
                </div>
                {riconciliazioneEseguita && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Data riconciliazione</Label>
                      <Input type="date" value={dataRiconciliazione} onChange={e => setDataRiconciliazione(e.target.value)} />
                    </div>
                    <div />
                    <div className="col-span-2">
                      <Label>Note sulla riconciliazione</Label>
                      <Textarea value={noteRiconciliazione} onChange={e => setNoteRiconciliazione(e.target.value)} rows={3} placeholder="Partite in transito, assegni emessi non presentati, bonifici in attesa..." />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Tab: Centrale Rischi */}
        {activeTab === "centraleRischi" && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">Lettura Centrale Rischi</CardTitle>
                    <p className="text-xs text-slate-500 mt-1">
                      Carica il prospetto PDF Banca d'Italia: il sistema riepiloga affidamenti, utilizzi e garanzie mese per mese.
                    </p>
                  </div>
                  <div>
                    <input
                      id="centrale-rischi-upload"
                      type="file"
                      accept=".pdf,application/pdf"
                      className="hidden"
                      onChange={e => {
                        void leggiCentraleRischi(e.target.files?.[0]);
                        e.currentTarget.value = "";
                      }}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={letturaCrInCorso}
                      onClick={() => document.getElementById("centrale-rischi-upload")?.click()}
                    >
                      {letturaCrInCorso ? (
                        <div className="w-3.5 h-3.5 mr-1 rounded-full border-2 border-slate-300 border-t-slate-700 animate-spin" />
                      ) : (
                        <Upload className="w-3.5 h-3.5 mr-1" />
                      )}
                      Carica PDF CR
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {!centraleRischi ? (
                  <div className="text-center py-10 text-slate-400">
                    <FileText className="w-10 h-10 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">Nessuna Centrale Rischi caricata.</p>
                    <p className="text-xs mt-1">Il PDF viene letto localmente e non viene inviato all'AI.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {centraleRischiImportiAnomali && (
                      <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-red-800 text-sm flex gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>
                          Importi CR non plausibili gia' salvati in scheda. Rimuovi questa Centrale Rischi e ricarica il PDF: il parser aggiornato scarta codici/date letti erroneamente come importi.
                        </span>
                      </div>
                    )}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="p-3 rounded-lg bg-slate-50 border">
                        <p className="text-xs text-slate-500">Mesi letti</p>
                        <p className="text-lg font-semibold">{centraleRischi.mesi.length}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-blue-50 border border-blue-100">
                        <p className="text-xs text-blue-600">Accordato mese bilancio</p>
                        <p className="text-lg font-semibold text-blue-900">{formatCurrency(meseChiusuraCr?.accordato ?? 0)}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-100">
                        <p className="text-xs text-emerald-600">Utilizzato mese bilancio</p>
                        <p className="text-lg font-semibold text-emerald-900">{formatCurrency(meseChiusuraCr?.utilizzato ?? 0)}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-amber-50 border border-amber-100">
                        <p className="text-xs text-amber-600">Utilizzo / accordato</p>
                        <p className="text-lg font-semibold text-amber-900">
                          {!meseChiusuraCr?.accordato ? "n.d." : `${Math.round((meseChiusuraCr.utilizzato / meseChiusuraCr.accordato) * 1000) / 10}%`}
                        </p>
                      </div>
                    </div>

                    <div className={`p-4 rounded-lg border ${scostamentoBancheRilevante ? "bg-orange-50 border-orange-200" : "bg-slate-50 border-slate-200"}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-800">Confronto debiti bancari da bilancio / Centrale Rischi al 31/12</p>
                          <p className="text-xs text-slate-500 mt-1">
                            Confronta i debiti verso banche iscritti in bilancio con l'utilizzato CR di dicembre dell'esercizio.
                          </p>
                        </div>
                        {scostamentoBancheRilevante ? (
                          <Badge className="bg-orange-100 text-orange-800 border-orange-200">Scostamento da verificare</Badge>
                        ) : (
                          <Badge variant="outline">Controllo automatico</Badge>
                        )}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-4 text-sm">
                        <div className="p-3 rounded bg-white border">
                          <p className="text-xs text-slate-500">Debiti bancari bilancio</p>
                          <p className="font-semibold">{haDebitiBancariBilancio ? formatCurrency(debitiBancariBilancio) : "n.d."}</p>
                          {haDebitiBancariBilancio && (
                            <p className="text-[11px] text-slate-400 mt-1">
                              CT {formatCurrency(debitiBancariCT ?? 0)} / LT {formatCurrency(debitiBancariLT ?? 0)}
                            </p>
                          )}
                        </div>
                        <div className="p-3 rounded bg-white border">
                          <p className="text-xs text-slate-500">Utilizzato CR mese bilancio</p>
                          <p className="font-semibold">{utilizzoCrBilancio == null ? "n.d." : formatCurrency(utilizzoCrBilancio)}</p>
                          <p className="text-[11px] text-slate-400 mt-1">{meseChiusuraCr?.mese ?? "Mese non rilevato"}</p>
                        </div>
                        <div className="p-3 rounded bg-white border">
                          <p className="text-xs text-slate-500">Differenza CR - bilancio</p>
                          <p className={`font-semibold ${scostamentoBancheRilevante ? "text-orange-700" : "text-slate-800"}`}>
                            {scostamentoBancheCr == null ? "n.d." : formatCurrency(scostamentoBancheCr)}
                          </p>
                          <p className="text-[11px] text-slate-400 mt-1">
                            {scostamentoBancheCrPerc == null ? "Percentuale n.d." : `${scostamentoBancheCrPerc}% sul bilancio`}
                          </p>
                        </div>
                        <div className="p-3 rounded bg-white border">
                          <p className="text-xs text-slate-500">Esito</p>
                          <p className={`font-semibold ${scostamentoBancheRilevante ? "text-orange-700" : "text-emerald-700"}`}>
                            {!haDebitiBancariBilancio
                              ? "Debiti bancari non letti"
                              : scostamentoBancheRilevante
                                ? "Approfondire"
                                : "Coerente"}
                          </p>
                          <p className="text-[11px] text-slate-400 mt-1">Soglia: maggiore tra 1.000 euro e 5%</p>
                        </div>
                      </div>

                      {!haDebitiBancariBilancio && (
                        <div className="mt-3 flex gap-2 text-sm text-amber-700">
                          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                          <span>Non ho trovato nel bilancio voci specifiche di debiti verso banche. Se il bilancio e' CEE/XBRL va riparsato con il parser aggiornato; se e' analitico, servono i conti bancari debitori classificati nei debiti.</span>
                        </div>
                      )}
                      {scostamentoBancheRilevante && (
                        <div className="mt-3 flex gap-2 text-sm text-orange-800">
                          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                          <span>Lo scostamento puo' dipendere da rate mutui non segnalate nello stesso modo, garanzie/fidi non utilizzati, data CR non coincidente con il 31/12 o classificazioni di bilancio da ricontrollare.</span>
                        </div>
                      )}
                    </div>

                    <div className="p-3 rounded-lg border bg-white text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium">{centraleRischi.intestatario || "Intestatario non rilevato"}</p>
                          <p className="text-xs text-slate-500">
                            {centraleRischi.codiceIntestatario ? `Codice intestatario ${centraleRischi.codiceIntestatario}` : "Codice intestatario non rilevato"} - {centraleRischi.nomeFile}
                          </p>
                        </div>
                        <Button type="button" size="sm" variant="ghost" className="text-red-500" onClick={() => setCentraleRischi(null)}>
                          <Trash2 className="w-3.5 h-3.5 mr-1" /> Rimuovi
                        </Button>
                      </div>
                    </div>

                    {centraleRischi.anomalie.length > 0 && (
                      <div className="p-3 rounded-lg border border-orange-200 bg-orange-50 text-orange-800 text-sm space-y-1">
                        {centraleRischi.anomalie.map((anomalia, idx) => (
                          <div key={idx} className="flex gap-2">
                            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                            <span>{anomalia}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="p-4 rounded-lg border bg-slate-50 space-y-3">
                      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-800">Dettaglio singolo mese</p>
                          <p className="text-xs text-slate-500">
                            Seleziona un mese per vedere gli intermediari letti dalla Centrale Rischi. Il confronto di bilancio resta ancorato a {meseChiusuraCr?.mese ?? "dicembre esercizio"}.
                          </p>
                        </div>
                        <Select
                          value={meseCrSelezionato?.mese ?? ""}
                          onValueChange={setMeseCentraleRischiSelezionato}
                        >
                          <SelectTrigger className="w-full md:w-56 bg-white">
                            <SelectValue placeholder="Seleziona mese" />
                          </SelectTrigger>
                          <SelectContent>
                            {centraleRischi.mesi.slice(0, 36).map(mese => (
                              <SelectItem key={mese.mese} value={mese.mese}>{mese.mese}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
                        <div className="p-2 rounded bg-white border">
                          <p className="text-[11px] text-slate-500">Mese</p>
                          <p className="font-medium">{meseCrSelezionato?.mese ?? "n.d."}</p>
                        </div>
                        <div className="p-2 rounded bg-white border">
                          <p className="text-[11px] text-slate-500">Intermediari</p>
                          <p className="font-medium">{meseCrSelezionato?.intermediari ?? 0}</p>
                        </div>
                        <div className="p-2 rounded bg-white border">
                          <p className="text-[11px] text-slate-500">Accordato</p>
                          <p className="font-medium">{formatCurrency(meseCrSelezionato?.accordato ?? 0)}</p>
                        </div>
                        <div className="p-2 rounded bg-white border">
                          <p className="text-[11px] text-slate-500">Utilizzato</p>
                          <p className="font-medium">{formatCurrency(meseCrSelezionato?.utilizzato ?? 0)}</p>
                        </div>
                        <div className="p-2 rounded bg-white border">
                          <p className="text-[11px] text-slate-500">Garanzie</p>
                          <p className="font-medium">{formatCurrency(meseCrSelezionato?.garanzieRicevute ?? 0)}</p>
                        </div>
                      </div>

                      <div className="overflow-x-auto border rounded-lg bg-white">
                        <table className="w-full text-xs">
                          <thead className="bg-white text-slate-500">
                            <tr>
                              <th className="text-left p-2">Intermediario</th>
                              <th className="text-left p-2">Categoria</th>
                              <th className="text-right p-2">Accordato</th>
                              <th className="text-right p-2">Acc. operativo</th>
                              <th className="text-right p-2">Utilizzato</th>
                              <th className="text-right p-2">Saldo medio</th>
                              <th className="text-right p-2">Garanzia</th>
                            </tr>
                          </thead>
                          <tbody>
                            {dettagliMeseCrSelezionato.length === 0 ? (
                              <tr>
                                <td colSpan={7} className="p-3 text-center text-slate-400">Nessun dettaglio intermediario rilevato per il mese selezionato.</td>
                              </tr>
                            ) : dettagliMeseCrSelezionato.map((row, idx) => (
                              <tr key={`${row.intermediario}-${row.categoria}-${idx}`} className="border-t">
                                <td className="p-2 font-medium">{row.intermediario}</td>
                                <td className="p-2">{row.categoria === "crediti_per_cassa" ? "Crediti per cassa" : row.categoria === "garanzie_ricevute" ? "Garanzie ricevute" : "Altro"}</td>
                                <td className="p-2 text-right">{formatCurrency(row.accordato)}</td>
                                <td className="p-2 text-right">{formatCurrency(row.accordatoOperativo)}</td>
                                <td className="p-2 text-right">{formatCurrency(row.utilizzato)}</td>
                                <td className="p-2 text-right">{formatCurrency(row.saldoMedio)}</td>
                                <td className="p-2 text-right">{formatCurrency(row.valoreGaranzia)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="overflow-x-auto border rounded-lg">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-xs text-slate-500">
                          <tr>
                            <th className="text-left p-2">Mese</th>
                            <th className="text-right p-2">Interm.</th>
                            <th className="text-right p-2">Accordato</th>
                            <th className="text-right p-2">Acc. operativo</th>
                            <th className="text-right p-2">Utilizzato</th>
                            <th className="text-right p-2">Saldo medio</th>
                            <th className="text-right p-2">Garanzie ricevute</th>
                          </tr>
                        </thead>
                        <tbody>
                          {centraleRischi.mesi.slice(0, 36).map(mese => (
                            <tr
                              key={mese.mese}
                              className={`border-t cursor-pointer hover:bg-blue-50 ${mese.mese === meseCrSelezionato?.mese ? "bg-blue-50" : ""}`}
                              onClick={() => setMeseCentraleRischiSelezionato(mese.mese)}
                            >
                              <td className="p-2 font-medium">{mese.mese}</td>
                              <td className="p-2 text-right">{mese.intermediari}</td>
                              <td className="p-2 text-right">{formatCurrency(mese.accordato)}</td>
                              <td className="p-2 text-right">{formatCurrency(mese.accordatoOperativo)}</td>
                              <td className="p-2 text-right">{formatCurrency(mese.utilizzato)}</td>
                              <td className="p-2 text-right">{formatCurrency(mese.saldoMedio)}</td>
                              <td className="p-2 text-right">{formatCurrency(mese.garanzieRicevute)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Tab: Checklist */}
        {activeTab === "checklist" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ClipboardList className="w-4 h-4" />
                Checklist ISA Italia 500/505 — {checklistCompletate}/{checklist.length} completati
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {checklist.map((item, i) => (
                <div key={i} className={`p-3 rounded-lg border transition-colors ${item.completata ? "bg-green-50 border-green-200" : "bg-white border-slate-200"}`}>
                  <div className="flex items-start gap-3">
                    <Checkbox checked={item.completata} onCheckedChange={() => toggleChecklist(i)} className="mt-0.5" />
                    <div className="flex-1">
                      <p className={`text-sm ${item.completata ? "line-through text-slate-400" : "text-slate-700"}`}>{item.voce}</p>
                    </div>
                    {item.completata ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <AlertCircle className="w-4 h-4 text-slate-300" />}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Tab: Conclusioni */}
        {activeTab === "conclusioni" && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-purple-600" /> Analisi AI (ISA 500/505)
                  </CardTitle>
                  <Button size="sm" onClick={() => analizzaMutation.mutate({
                    incaricoId,
                    totaleLiquide: totaleSaldoBilancio + (saldoCassaBilancio ? parseFloat(saldoCassaBilancio) : 0),
                    numeroCc: contiCorrenti.length,
                    differenzeTotali: totaleDifferenze,
                  })} disabled={analizzaMutation.isPending}>
                    {analizzaMutation.isPending ? "Analisi..." : "Analizza con AI"}
                  </Button>
                </div>
              </CardHeader>
              {analisiAI && (
                <CardContent className="space-y-3">
                  <div className={`p-3 rounded-lg border ${RISCHIO_CONFIG[analisiAI.rischioValutazione as keyof typeof RISCHIO_CONFIG]?.bg ?? ""}`}>
                    <p className="text-sm font-medium">Rischio: {RISCHIO_CONFIG[analisiAI.rischioValutazione as keyof typeof RISCHIO_CONFIG]?.label ?? analisiAI.rischioValutazione}</p>
                  </div>
                  {analisiAI.areePrincipali?.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-slate-500 mb-1">Aree principali</p>
                      <ul className="space-y-1">
                        {analisiAI.areePrincipali.map((a: string, i: number) => (
                          <li key={i} className="flex items-start gap-2 text-sm"><AlertTriangle className="w-3.5 h-3.5 text-amber-500 mt-0.5 flex-shrink-0" />{a}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {analisiAI.procedurePrioritarie?.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-slate-500 mb-1">Procedure prioritarie</p>
                      <ul className="space-y-1">
                        {analisiAI.procedurePrioritarie.map((p: string, i: number) => (
                          <li key={i} className="flex items-start gap-2 text-sm"><Info className="w-3.5 h-3.5 text-blue-500 mt-0.5 flex-shrink-0" />{p}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              )}
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Valutazione e Conclusioni</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label>Livello di rischio</Label>
                  <Select value={rischio} onValueChange={setRischio}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="basso">Basso</SelectItem>
                      <SelectItem value="medio">Medio</SelectItem>
                      <SelectItem value="alto">Alto</SelectItem>
                      <SelectItem value="critico">Critico</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Conclusioni</Label>
                  <Textarea value={conclusioni} onChange={e => setConclusioni(e.target.value)} rows={4} placeholder="Conclusioni sull'area disponibilità liquide, eventuali rilievi..." />
                </div>
                <div>
                  <Label>Note di lavoro</Label>
                  <Textarea value={noteRevisore} onChange={e => setNoteRevisore(e.target.value)} rows={2} placeholder="Note interne del revisore" />
                </div>
                <div>
                  <Label>Stato scheda</Label>
                  <Select value={stato} onValueChange={setStato}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="da_iniziare">Da iniziare</SelectItem>
                      <SelectItem value="in_corso">In corso</SelectItem>
                      <SelectItem value="completata">Completata</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Azioni */}
        <div className="flex justify-end gap-2 pb-6">
          <Button variant="outline" onClick={() => navigate(`/incarichi/${incaricoId}`)}>Annulla</Button>
          <Button onClick={salva} disabled={salvaMutation.isPending}>
            <Save className="w-4 h-4 mr-1" />
            {salvaMutation.isPending ? "Salvataggio..." : "Salva Scheda"}
          </Button>
        </div>
      </div>
    </RevisorLayout>
  );
}
