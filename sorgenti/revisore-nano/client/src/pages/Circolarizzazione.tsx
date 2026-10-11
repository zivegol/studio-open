import { useState, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Upload,
  FileText,
  Users,
  Building2,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Download,
  Plus,
  ChevronLeft,
  Mail,
  TrendingUp,
  BarChart3,
  RefreshCw,
  Zap,
  Info,
  Loader2,
} from "lucide-react";
import RevisorLayout from "@/components/revisione/RevisorLayout";
import { formatCurrency } from "@/lib/utils";

// ─── TIPI ─────────────────────────────────────────────────────────────────────

interface NominativoInput {
  codice?: string;
  ragioneSociale: string;
  saldo: number;
  isEstero?: boolean;
}

// ─── BADGE HELPERS ────────────────────────────────────────────────────────────

function BadgeMotivazione({ motivazione }: { motivazione: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
    saldo_elevato_pareto: { label: "Pareto 80%", variant: "default" },
    supera_materialita: { label: "Supera PM", variant: "default" },
    estero: { label: "Estero", variant: "secondary" },
    anomalia_ai: { label: "Anomalia AI", variant: "destructive" },
    campione_casuale: { label: "Campione", variant: "outline" },
    manuale_revisore: { label: "Manuale", variant: "secondary" },
  };
  const cfg = map[motivazione] ?? { label: motivazione, variant: "outline" as const };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

function BadgeStatoLettera({ stato }: { stato: string }) {
  const map: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
    da_generare: { label: "Da generare", color: "bg-gray-100 text-gray-600", icon: <Clock className="w-3 h-3" /> },
    generata: { label: "Generata", color: "bg-blue-100 text-blue-700", icon: <FileText className="w-3 h-3" /> },
    inviata: { label: "Inviata", color: "bg-yellow-100 text-yellow-700", icon: <Mail className="w-3 h-3" /> },
    risposta_ricevuta: { label: "Risposta ✓", color: "bg-green-100 text-green-700", icon: <CheckCircle2 className="w-3 h-3" /> },
    risposta_discordante: { label: "Discordante !", color: "bg-orange-100 text-orange-700", icon: <AlertTriangle className="w-3 h-3" /> },
    nessuna_risposta: { label: "Nessuna risposta", color: "bg-red-100 text-red-700", icon: <XCircle className="w-3 h-3" /> },
    procedura_alternativa: { label: "Proc. alternativa", color: "bg-purple-100 text-purple-700", icon: <RefreshCw className="w-3 h-3" /> },
  };
  const cfg = map[stato] ?? { label: stato, color: "bg-gray-100 text-gray-600", icon: null };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

// ─── PARSER CSV/TESTO ─────────────────────────────────────────────────────────

/**
 * Parsa un numero in formato italiano (1.234,56) o anglosassone (1,234.56 o 1234.56).
 * Non rimuove mai il separatore decimale.
 */
function parseNumeroSaldo(s: string): number {
  if (!s || s.trim() === "") return NaN;
  const clean = s.trim().replace(/[€$\s]/g, "");
  // Formato italiano: 1.234,56 → punto come migliaia, virgola come decimale
  if (/^\d{1,3}(\.\d{3})*(,\d+)?$/.test(clean)) {
    return parseFloat(clean.replace(/\./g, "").replace(",", "."));
  }
  // Formato anglosassone con virgola come migliaia: 1,234.56
  if (/^\d{1,3}(,\d{3})*(\.\d+)?$/.test(clean)) {
    return parseFloat(clean.replace(/,/g, ""));
  }
  // Numero semplice con virgola decimale: 1234,56
  if (/^\d+(,\d+)?$/.test(clean)) {
    return parseFloat(clean.replace(",", "."));
  }
  // Numero semplice con punto decimale: 1234.56 (già corretto)
  return parseFloat(clean);
}

function parseTesto(testo: string): NominativoInput[] {
  const righe = testo.trim().split("\n").filter((r) => r.trim());
  const risultati: NominativoInput[] = [];

  for (const riga of righe) {
    // Supporta separatori: tab, punto e virgola
    // NON usare la virgola come separatore di colonne perché è usata come decimale
    const parti = riga.split(/[\t;]/).map((p) => p.trim());
    if (parti.length < 2) continue;

    // Cerca il saldo (numero) tra le colonne
    let ragioneSociale = "";
    let saldo = 0;
    let codice: string | undefined;

    // Formato: codice | ragione_sociale | saldo  oppure  ragione_sociale | saldo
    if (parti.length >= 3 && !isNaN(parseNumeroSaldo(parti[2]))) {
      codice = parti[0];
      ragioneSociale = parti[1];
      saldo = parseNumeroSaldo(parti[2]);
    } else if (!isNaN(parseNumeroSaldo(parti[1]))) {
      ragioneSociale = parti[0];
      saldo = parseNumeroSaldo(parti[1]);
    } else if (!isNaN(parseNumeroSaldo(parti[parti.length - 1]))) {
      ragioneSociale = parti.slice(0, -1).join(" ");
      saldo = parseNumeroSaldo(parti[parti.length - 1]);
    }

    if (ragioneSociale && saldo !== 0) {
      const isEstero =
        ragioneSociale.includes("GmbH") ||
        ragioneSociale.includes("Ltd") ||
        ragioneSociale.includes("S.A.") ||
        ragioneSociale.includes("SIRKETI") ||
        ragioneSociale.includes("S.p.Z") ||
        ragioneSociale.includes("IRELAND") ||
        ragioneSociale.includes("PORTUGAL") ||
        ragioneSociale.includes("PROJECT S.L");

      risultati.push({ codice, ragioneSociale, saldo: Math.abs(saldo), isEstero });
    }
  }
  return risultati;
}

// ─── COMPONENTE PRINCIPALE ────────────────────────────────────────────────────

export default function Circolarizzazione() {
  const { incaricoId } = useParams<{ incaricoId: string }>();
  const [, navigate] = useLocation();
  const id = parseInt(incaricoId ?? "0");

  // Stato wizard
  const [step, setStep] = useState<"setup" | "campione" | "followup">("setup");
  const [sessioneId, setSessioneId] = useState<number | null>(null);
  const [ragioneSocialeCliente, setRagioneSocialeCliente] = useState("");

  // Parametri setup
  const [emailRevisore, setEmailRevisore] = useState("");
  const [dataRiferimento, setDataRiferimento] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [tipoCirc, setTipoCirc] = useState<"clienti" | "fornitori" | "entrambi">("entrambi");
  const [testoClienti, setTestoClienti] = useState("");
  const [testoFornitori, setTestoFornitori] = useState("");

  // Stato modifica campione
  const [motivazioneEsclusione, setMotivazioneEsclusione] = useState<Record<number, string>>({});
  const [showAggiungiManuale, setShowAggiungiManuale] = useState(false);
  const [nuovoNom, setNuovoNom] = useState({ ragioneSociale: "", saldo: "", tipo: "cliente" as "cliente" | "fornitore", codice: "", isEstero: false });

  // Stato follow-up
  const [followUpEdit, setFollowUpEdit] = useState<Record<number, { stato: string; saldoConfermato: string; note: string; dataInvio: string; dataRisposta: string; proceduraAlternativa: string }>>({});

  // Query: partite non trovate dalla verifica incassi
  const { data: nonTrovatiVerifica } = trpc.circolarizzazione.getNonTrovatiDaVerifica.useQuery({ incaricoId: id });
  const [nonTrovatiImportati, setNonTrovatiImportati] = useState(false);

  // Stato download lettere
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [downloadingDocx, setDownloadingDocx] = useState<number | null>(null);

  // Download singola lettera .docx via fetch (evita intercettazione del router React)
  const handleDownloadDocx = useCallback(async (destId: number, ragioneSociale: string, tipo: string) => {
    setDownloadingDocx(destId);
    try {
      const response = await fetch(`/api/circolarizzazione-docx/${destId}`, { credentials: "include" });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Errore sconosciuto" }));
        throw new Error(err.error || `Errore ${response.status}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `lettera-${tipo}-${ragioneSociale.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 40)}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Lettera scaricata");
    } catch (e: any) {
      toast.error("Errore download lettera: " + e.message);
    } finally {
      setDownloadingDocx(null);
    }
  }, []);

  // Download ZIP tutte le lettere via fetch
  const handleDownloadZip = useCallback(async (sessId: number) => {
    setDownloadingZip(true);
    try {
      const response = await fetch(`/api/circolarizzazione-docx-all/${sessId}`, { credentials: "include" });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Errore sconosciuto" }));
        throw new Error(err.error || `Errore ${response.status}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `lettere-circolarizzazione-sessione-${sessId}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("ZIP lettere scaricato");
    } catch (e: any) {
      toast.error("Errore download ZIP: " + e.message);
    } finally {
      setDownloadingZip(false);
    }
  }, []);

  // Queries
  const { data: sessioneData, refetch: refetchSessione } = trpc.circolarizzazione.getSessione.useQuery(
    { sessioneId: sessioneId! },
    { enabled: sessioneId !== null }
  );
  const { data: riepilogo, refetch: refetchRiepilogo } = trpc.circolarizzazione.riepilogoFollowUp.useQuery(
    { sessioneId: sessioneId! },
    { enabled: sessioneId !== null && step === "followup" }
  );
  const { data: sessioniList } = trpc.circolarizzazione.listSessioni.useQuery({ incaricoId: id });

  // Export carta di lavoro
  const [exportingCL, setExportingCL] = useState(false);
  const { refetch: fetchCartaLavoro } = trpc.circolarizzazione.exportCartaLavoro.useQuery(
    { sessioneId: sessioneId! },
    { enabled: false }
  );

  const handleExportCartaLavoro = async () => {
    if (!sessioneId) return;
    setExportingCL(true);
    try {
      const { data } = await fetchCartaLavoro();
      if (!data) throw new Error("Nessun dato disponibile");
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();

      // Foglio 1: Campione
      const wsData = [
        ["Cod.", "Ragione Sociale", "Tipo", "Saldo (€)", "Motivazione", "Priorità", "Stato Lettera", "Data Invio", "Data Risposta", "Saldo Confermato (€)", "Differenza (€)", "Note Follow-up", "Procedura Alternativa"],
        ...data.campione.map((r) => [
          r.codice, r.ragioneSociale, r.tipo,
          r.saldo, r.motivazione, r.priorita, r.statoLettera,
          r.dataInvio, r.dataRisposta,
          r.saldoConfermato ?? "", r.differenza ?? "",
          r.noteFollowUp, r.proceduraAlternativa,
        ]),
      ];
      const ws1 = XLSX.utils.aoa_to_sheet(wsData);
      ws1["!cols"] = [8, 35, 12, 14, 22, 10, 18, 12, 12, 20, 14, 30, 30].map((w) => ({ wch: w }));
      XLSX.utils.book_append_sheet(wb, ws1, "Campione ISA 505");

      // Foglio 2: Statistiche
      const s = data.statistiche;
      const ws2 = XLSX.utils.aoa_to_sheet([
        ["Carta di Lavoro — Circolarizzazione ISA 505"],
        [],
        ["Cliente:", data.nomeCliente],
        ["Anno esercizio:", data.anno],
        ["Tipo circolarizzazione:", data.tipoCircolarizzazione],
        ["Data esportazione:", data.dataEsportazione],
        [],
        ["STATISTICHE"],
        ["Totale campione:", s.totaleCampione],
        ["Totale saldo campione (€):", s.totaleSaldo],
        ["Risposte ricevute:", s.totaleRisposte],
        ["Risposte discordanti:", s.totaleDiscordanti],
        ["Differenze totali (€):", s.totaleDifferenze],
        ["% risposta:", `${s.percentualeRisposta.toFixed(1)}%`],
        [],
        ["FIRMA REVISORE"],
        ["Nome:", ""],
        ["Data:", ""],
        ["Firma:", ""],
      ]);
      XLSX.utils.book_append_sheet(wb, ws2, "Copertina");

      XLSX.writeFile(wb, `circolarizzazione-ISA505-${data.nomeCliente.replace(/[^a-zA-Z0-9]/g, "_")}-${data.anno}.xlsx`);
      toast.success("Carta di lavoro esportata");
    } catch (e: unknown) {
      toast.error("Errore export: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setExportingCL(false);
    }
  };

  // Mutations
  const creaSessione = trpc.circolarizzazione.creaSessione.useMutation();
  const generaLettere = trpc.circolarizzazione.generaLettere.useMutation();
  const aggiornaInclusione = trpc.circolarizzazione.aggiornaInclusione.useMutation();
  const aggiungiManuale = trpc.circolarizzazione.aggiungiManuale.useMutation();
  const aggiornaFollowUp = trpc.circolarizzazione.aggiornaFollowUp.useMutation();
  const caricaRisposta = trpc.circolarizzazione.caricaRisposta.useMutation();
  const acquisisciRisposte = trpc.circolarizzazione.acquisisciRisposteDalDossier.useMutation();
  const [uploadingRisposta, setUploadingRisposta] = useState<number | null>(null);
  const [esitoAcquisizione, setEsitoAcquisizione] = useState<any>(null);

  const handleAcquisisciRisposte = async () => {
    if (!sessioneId) return;
    try {
      const result = await acquisisciRisposte.mutateAsync({ sessioneId });
      setEsitoAcquisizione(result);
      await refetchSessione();
      await refetchRiepilogo();
      toast.success(`Analizzate ${result.associati} risposte dal dossier`);
    } catch (e: any) {
      toast.error(e?.message ?? "Analisi delle risposte non riuscita");
    }
  };

  const handleCaricaRisposta = async (destinatarioId: number, file: File) => {
    setUploadingRisposta(destinatarioId);
    try {
      const fileBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await caricaRisposta.mutateAsync({ destinatarioId, nomeFile: file.name, mimeType: file.type || "application/octet-stream", fileBase64 });
      await refetchSessione();
      await refetchRiepilogo();
      toast.success(`Risposta caricata per ${file.name}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Caricamento risposta non riuscito");
    } finally {
      setUploadingRisposta(null);
    }
  };

  // ─── HANDLERS ───────────────────────────────────────────────────────────────

  /** Converte le partite non trovate in formato testo per le textarea */
  function importaNonTrovatiNelleListe() {
    if (!nonTrovatiVerifica?.disponibile || !nonTrovatiVerifica.nonTrovati.length) return;

    const clientiNT = nonTrovatiVerifica.nonTrovati.filter(n => n.tipo === "cliente");
    const fornitoriNT = nonTrovatiVerifica.nonTrovati.filter(n => n.tipo === "fornitore");

    if (clientiNT.length > 0) {
      const righeClienti = clientiNT
        .map(n => `${n.codice ? n.codice + ";" : ""}${n.ragioneSociale};${Math.abs(n.saldo).toFixed(2)}`)
        .join("\n");
      // Aggiunge ai dati esistenti (non sovrascrive)
      setTestoClienti(prev => {
        const existing = prev.trim();
        return existing ? existing + "\n" + righeClienti : righeClienti;
      });
    }

    if (fornitoriNT.length > 0) {
      const righeFornitori = fornitoriNT
        .map(n => `${n.codice ? n.codice + ";" : ""}${n.ragioneSociale};${Math.abs(n.saldo).toFixed(2)}`)
        .join("\n");
      setTestoFornitori(prev => {
        const existing = prev.trim();
        return existing ? existing + "\n" + righeFornitori : righeFornitori;
      });
    }

    // Imposta il tipo di circolarizzazione in base a ciò che è disponibile
    if (clientiNT.length > 0 && fornitoriNT.length > 0) setTipoCirc("entrambi");
    else if (clientiNT.length > 0) setTipoCirc("clienti");
    else if (fornitoriNT.length > 0) setTipoCirc("fornitori");

    setNonTrovatiImportati(true);
    toast.success(
      `Importati ${clientiNT.length} clienti e ${fornitoriNT.length} fornitori non trovati dalla verifica incassi`
    );
  }

  const handleCreaSessione = async () => {
    if (!emailRevisore) { toast.error("Inserisci l'email del revisore"); return; }
    if (!dataRiferimento) { toast.error("Inserisci la data di riferimento"); return; }

    const listaClienti = tipoCirc !== "fornitori" ? parseTesto(testoClienti) : [];
    const listaFornitori = tipoCirc !== "clienti" ? parseTesto(testoFornitori) : [];

    if (tipoCirc !== "fornitori" && listaClienti.length === 0) {
      toast.error("Nessun cliente riconosciuto. Verifica il formato (codice;ragione_sociale;saldo)");
      return;
    }
    if (tipoCirc !== "clienti" && listaFornitori.length === 0) {
      toast.error("Nessun fornitore riconosciuto. Verifica il formato");
      return;
    }

    try {
      const result = await creaSessione.mutateAsync({
        incaricoId: id,
        emailRevisore,
        dataRiferimento,
        tipoCircolarizzazione: tipoCirc,
        listaClienti: listaClienti.length > 0 ? listaClienti : undefined,
        listaFornitori: listaFornitori.length > 0 ? listaFornitori : undefined,
      });
      setSessioneId(result.sessioneId);
      setRagioneSocialeCliente(result.ragioneSocialeCliente);
      setStep("campione");
      toast.success(`Campione selezionato: ${result.campioneCl + result.campioneFo} destinatari`);
    } catch (e: any) {
      toast.error("Errore nella creazione della sessione: " + e.message);
    }
  };

  const handleGeneraLettere = async () => {
    if (!sessioneId) return;
    try {
      const result = await generaLettere.mutateAsync({
        sessioneId,
        ragioneSocialeCliente,
      });
      await refetchSessione();
      toast.success(`${result.generate} lettere Word generate con successo`);
    } catch (e: any) {
      toast.error("Errore nella generazione lettere: " + e.message);
    }
  };

  const handleToggleInclusione = async (destId: number, incluso: boolean) => {
    const motivazione = motivazioneEsclusione[destId];
    if (!incluso && !motivazione) {
      toast.error("Inserisci una motivazione per l'esclusione");
      return;
    }
    await aggiornaInclusione.mutateAsync({ destinatarioId: destId, incluso, motivazioneEsclusione: motivazione });
    await refetchSessione();
    toast.success(incluso ? "Destinatario incluso" : "Destinatario escluso");
  };

  const handleAggiungiManuale = async () => {
    if (!nuovoNom.ragioneSociale || !nuovoNom.saldo) { toast.error("Compila ragione sociale e saldo"); return; }
    await aggiungiManuale.mutateAsync({
      sessioneId: sessioneId!,
      incaricoId: id,
      codice: nuovoNom.codice || undefined,
      ragioneSociale: nuovoNom.ragioneSociale,
      tipo: nuovoNom.tipo,
      saldo: parseFloat(nuovoNom.saldo),
      isEstero: nuovoNom.isEstero,
    });
    await refetchSessione();
    setShowAggiungiManuale(false);
    setNuovoNom({ ragioneSociale: "", saldo: "", tipo: "cliente", codice: "", isEstero: false });
    toast.success("Destinatario aggiunto");
  };

  const handleSalvaFollowUp = async (destId: number) => {
    const edit = followUpEdit[destId];
    if (!edit?.stato) { toast.error("Seleziona uno stato"); return; }
    await aggiornaFollowUp.mutateAsync({
      destinatarioId: destId,
      statoLettera: edit.stato as any,
      dataInvio: edit.dataInvio || undefined,
      dataRisposta: edit.dataRisposta || undefined,
      saldoConfermato: edit.saldoConfermato ? parseFloat(edit.saldoConfermato) : undefined,
      noteFollowUp: edit.note || undefined,
      proceduraAlternativa: edit.proceduraAlternativa || undefined,
    });
    await refetchSessione();
    await refetchRiepilogo();
    toast.success("Follow-up aggiornato");
  };

  const destinatari = sessioneData?.destinatari ?? [];
  const clientiSelezionati = destinatari.filter((d) => d.tipo === "cliente" && d.incluso);
  const fornitoriSelezionati = destinatari.filter((d) => d.tipo === "fornitore" && d.incluso);
  const clientiEsclusi = destinatari.filter((d) => d.tipo === "cliente" && !d.incluso);
  const fornitoriEsclusi = destinatari.filter((d) => d.tipo === "fornitore" && !d.incluso);

  // ─── RENDER ──────────────────────────────────────────────────────────────────

  return (
    <RevisorLayout>
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/incarichi/${id}`)}>
            <ChevronLeft className="w-4 h-4 mr-1" /> Fascicolo
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Circolarizzazione Saldi</h1>
            <p className="text-sm text-slate-500">ISA Italia 505 — Conferme esterne</p>
          </div>
        </div>

        {/* Sessioni precedenti */}
        {sessioniList && sessioniList.length > 0 && step === "setup" && (
          <Card className="border-blue-200 bg-blue-50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-blue-800">Sessioni precedenti ({sessioniList.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {sessioniList.map((s) => (
                  <Button
                    key={s.id}
                    variant="outline"
                    size="sm"
                    className="bg-white"
                    onClick={() => { setSessioneId(s.id); setStep("campione"); }}
                  >
                    Sessione #{s.id} — {new Date(s.dataRiferimento).toLocaleDateString("it-IT")}
                    <Badge variant="secondary" className="ml-2">{s.stato}</Badge>
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* STEP 1: SETUP */}
        {step === "setup" && (
          <div className="space-y-6">

            {/* Banner: partite non trovate dalla verifica incassi */}
            {nonTrovatiVerifica?.disponibile && (
              <div className="p-4 bg-amber-50 border border-amber-300 rounded-lg">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <Zap className="w-4 h-4 text-amber-600" />
                      <span className="text-sm font-semibold text-amber-800">
                        Partite non riscontrate nella verifica incassi/pagamenti
                      </span>
                      {nonTrovatiImportati && (
                        <span className="text-xs bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full font-medium">Importati</span>
                      )}
                    </div>
                    <p className="text-xs text-amber-700 mb-3">
                      La verifica incassi/pagamenti successivi (ISA Italia 560) ha rilevato
                      {" "}<strong>{nonTrovatiVerifica.nonTrovati.length} nominativi</strong> con partite aperte non riscontrate
                      negli estratti bancari del trimestre successivo. Questi soggetti sono candidati prioritari
                      per la circolarizzazione (ISA Italia 505).
                    </p>
                    <div className="flex flex-wrap gap-3 text-xs">
                      {nonTrovatiVerifica.totaleClienti > 0 && (
                        <div className="flex items-center gap-1.5 bg-white border border-amber-200 rounded px-2 py-1">
                          <Users className="w-3.5 h-3.5 text-green-600" />
                          <span className="font-medium">{nonTrovatiVerifica.totaleClienti} clienti</span>
                          {nonTrovatiVerifica.saldoTotaleClienti != null && (
                            <span className="text-amber-600">— saldo: {formatCurrency(nonTrovatiVerifica.saldoTotaleClienti, { decimali: 0 })}</span>
                          )}
                        </div>
                      )}
                      {nonTrovatiVerifica.totaleFornitori > 0 && (
                        <div className="flex items-center gap-1.5 bg-white border border-amber-200 rounded px-2 py-1">
                          <Building2 className="w-3.5 h-3.5 text-orange-600" />
                          <span className="font-medium">{nonTrovatiVerifica.totaleFornitori} fornitori</span>
                          {nonTrovatiVerifica.saldoTotaleFornitori != null && (
                            <span className="text-amber-600">— saldo: {formatCurrency(nonTrovatiVerifica.saldoTotaleFornitori, { decimali: 0 })}</span>
                          )}
                        </div>
                      )}
                      {nonTrovatiVerifica.sessione && (
                        <div className="flex items-center gap-1 text-amber-600">
                          <Info className="w-3 h-3" />
                          Analisi del {new Date(nonTrovatiVerifica.sessione.dataAnalisi).toLocaleDateString("it-IT")}
                          {nonTrovatiVerifica.sessione.annoEsercizio ? ` — esercizio ${nonTrovatiVerifica.sessione.annoEsercizio}` : ""}
                        </div>
                      )}
                    </div>
                    {/* Anteprima nominativi */}
                    {nonTrovatiVerifica.nonTrovati.length > 0 && (
                      <div className="mt-3 space-y-1">
                        {nonTrovatiVerifica.nonTrovati.slice(0, 5).map((n, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs text-amber-800">
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${n.tipo === "cliente" ? "bg-green-500" : "bg-orange-500"}`} />
                            <span className="font-medium truncate max-w-[200px]">{n.ragioneSociale}</span>
                            <span className="text-amber-600 ml-auto">{formatCurrency(Math.abs(n.saldo), { decimali: 0 })}</span>
                            <span className="text-amber-500">{n.tipo}</span>
                          </div>
                        ))}
                        {nonTrovatiVerifica.nonTrovati.length > 5 && (
                          <div className="text-xs text-amber-600 italic">...e altri {nonTrovatiVerifica.nonTrovati.length - 5} nominativi</div>
                        )}
                      </div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    className="bg-amber-600 hover:bg-amber-700 text-white shrink-0"
                    onClick={importaNonTrovatiNelleListe}
                    disabled={nonTrovatiImportati}
                  >
                    <Zap className="w-4 h-4 mr-1" />
                    {nonTrovatiImportati ? "Importati" : "Importa nelle liste"}
                  </Button>
                </div>
              </div>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Mail className="w-5 h-5 text-blue-600" />
                  Parametri della circolarizzazione
                </CardTitle>
                <CardDescription>
                  Configura i parametri base. La copertura minima del campione verrà calcolata automaticamente in base al livello di rischio del Modulo 3.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <Label>Email del Revisore *</Label>
                  <Input
                    type="email"
                    placeholder="revisore@studio.it"
                    value={emailRevisore}
                    onChange={(e) => setEmailRevisore(e.target.value)}
                  />
                  <p className="text-xs text-slate-500">I terzi risponderanno a questo indirizzo</p>
                </div>
                <div className="space-y-1">
                  <Label>Data di riferimento saldi *</Label>
                  <Input
                    type="date"
                    value={dataRiferimento}
                    onChange={(e) => setDataRiferimento(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Tipo circolarizzazione</Label>
                  <Select value={tipoCirc} onValueChange={(v) => setTipoCirc(v as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="entrambi">Clienti e Fornitori</SelectItem>
                      <SelectItem value="clienti">Solo Clienti</SelectItem>
                      <SelectItem value="fornitori">Solo Fornitori</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Input liste */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {tipoCirc !== "fornitori" && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Users className="w-4 h-4 text-green-600" />
                      Lista Clienti
                    </CardTitle>
                    <CardDescription>
                      Incolla il testo dalla stampa del gestionale. Formato supportato:<br />
                      <code className="text-xs bg-slate-100 px-1 rounded">codice;ragione_sociale;saldo</code> oppure <code className="text-xs bg-slate-100 px-1 rounded">ragione_sociale;saldo</code>
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Textarea
                      placeholder={"00241;ROCCO GALVAGNI & C. SRL;2190.82\n01206;HOTEL RAFFL TONIDANDEL S.N.C.;18237.56\n..."}
                      className="font-mono text-xs h-48 resize-none"
                      value={testoClienti}
                      onChange={(e) => setTestoClienti(e.target.value)}
                    />
                    {testoClienti && (
                      <p className="text-xs text-green-700 mt-1">
                        ✓ {parseTesto(testoClienti).length} clienti riconosciuti
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}

              {tipoCirc !== "clienti" && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Building2 className="w-4 h-4 text-orange-600" />
                      Lista Fornitori
                    </CardTitle>
                    <CardDescription>
                      Stesso formato della lista clienti. I fornitori esteri vengono rilevati automaticamente.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Textarea
                      placeholder={"00744;VER.METAL S.R.L.;38896.68\n02621;TAMOIL ITALIA SPA;72295.36\n..."}
                      className="font-mono text-xs h-48 resize-none"
                      value={testoFornitori}
                      onChange={(e) => setTestoFornitori(e.target.value)}
                    />
                    {testoFornitori && (
                      <p className="text-xs text-orange-700 mt-1">
                        ✓ {parseTesto(testoFornitori).length} fornitori riconosciuti
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>

            <div className="flex justify-end">
              <Button
                onClick={handleCreaSessione}
                disabled={creaSessione.isPending}
                className="bg-blue-700 hover:bg-blue-800"
                size="lg"
              >
                {creaSessione.isPending ? (
                  <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Analisi AI in corso...</>
                ) : (
                  <><TrendingUp className="w-4 h-4 mr-2" /> Seleziona campione con AI</>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* STEP 2: CAMPIONE */}
        {step === "campione" && sessioneData && (
          <div className="space-y-6">
            {/* Riepilogo sessione */}
            <Card className="border-green-200 bg-green-50">
              <CardContent className="pt-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold text-green-700">{clientiSelezionati.length}</div>
                    <div className="text-xs text-green-600">Clienti selezionati</div>
                    <div className="text-xs text-slate-500">Copertura: {parseFloat(sessioneData.sessione.coperturaCampioneCl ?? "0").toFixed(1)}%</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-orange-700">{fornitoriSelezionati.length}</div>
                    <div className="text-xs text-orange-600">Fornitori selezionati</div>
                    <div className="text-xs text-slate-500">Copertura: {parseFloat(sessioneData.sessione.coperturaCampioneFo ?? "0").toFixed(1)}%</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-blue-700">{sessioneData.sessione.percentualeCoperturaMinimaCalcolata}%</div>
                    <div className="text-xs text-blue-600">Copertura minima richiesta</div>
                    <div className="text-xs text-slate-500">Basata su rischio Modulo 3</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-slate-700">{destinatari.filter((d) => d.incluso).length}</div>
                    <div className="text-xs text-slate-600">Totale inclusi</div>
                    <div className="text-xs text-slate-500">Data rif.: {new Date(sessioneData.sessione.dataRiferimento).toLocaleDateString("it-IT")}</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Analisi AI */}
            {sessioneData.sessione.analisiAiSelezione && (
              <Card className="border-blue-100">
                <CardContent className="pt-4">
                  <p className="text-sm text-slate-700 italic">
                    <span className="font-semibold text-blue-700">Analisi AI (ISA 505): </span>
                    {sessioneData.sessione.analisiAiSelezione}
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Tabella destinatari */}
            <Tabs defaultValue="clienti">
              <TabsList>
                <TabsTrigger value="clienti">Clienti ({clientiSelezionati.length + clientiEsclusi.length})</TabsTrigger>
                <TabsTrigger value="fornitori">Fornitori ({fornitoriSelezionati.length + fornitoriEsclusi.length})</TabsTrigger>
              </TabsList>

              {(["clienti", "fornitori"] as const).map((tab) => {
                const inclusi = tab === "clienti" ? clientiSelezionati : fornitoriSelezionati;
                const esclusi = tab === "clienti" ? clientiEsclusi : fornitoriEsclusi;
                const tutti = [...inclusi, ...esclusi];

                return (
                  <TabsContent key={tab} value={tab} className="space-y-3">
                    <div className="overflow-x-auto rounded-lg border">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 border-b">
                          <tr>
                            <th className="text-left px-3 py-2 font-medium text-slate-600">Codice</th>
                            <th className="text-left px-3 py-2 font-medium text-slate-600">Ragione Sociale</th>
                            <th className="text-right px-3 py-2 font-medium text-slate-600">Saldo (€)</th>
                            <th className="text-center px-3 py-2 font-medium text-slate-600">Motivo</th>
                            <th className="text-center px-3 py-2 font-medium text-slate-600">Priorità</th>
                            <th className="text-center px-3 py-2 font-medium text-slate-600">Lettera</th>
                            <th className="text-center px-3 py-2 font-medium text-slate-600">Incluso</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tutti.map((dest) => (
                            <tr
                              key={dest.id}
                              className={`border-b hover:bg-slate-50 ${!dest.incluso ? "opacity-50 bg-slate-50" : ""}`}
                            >
                              <td className="px-3 py-2 text-slate-500 font-mono text-xs">{dest.codice ?? "—"}</td>
                              <td className="px-3 py-2 font-medium">
                                {dest.ragioneSociale}
                                {dest.isEstero && <Badge variant="outline" className="ml-1 text-xs">Estero</Badge>}
                              </td>
                              <td className="px-3 py-2 text-right font-mono">
                                {formatCurrency(dest.saldo, { simbolo: false })}
                              </td>
                              <td className="px-3 py-2 text-center">
                                <BadgeMotivazione motivazione={dest.motivazioneSelezione} />
                              </td>
                              <td className="px-3 py-2 text-center">
                                <Badge variant={dest.priorita === "alta" ? "default" : dest.priorita === "media" ? "secondary" : "outline"}>
                                  {dest.priorita}
                                </Badge>
                              </td>
                              <td className="px-3 py-2 text-center">
                                {dest.s3KeyLettera ? (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 text-xs text-blue-600"
                                    disabled={downloadingDocx === dest.id}
                                    onClick={() => handleDownloadDocx(dest.id, dest.ragioneSociale, dest.tipo)}
                                  >
                                    {downloadingDocx === dest.id ? (
                                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                    ) : (
                                      <Download className="w-3 h-3 mr-1" />
                                    )}
                                    .docx
                                  </Button>
                                ) : (
                                  <span className="text-xs text-slate-400">—</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-center">
                                {dest.incluso ? (
                                  <div className="flex items-center gap-1 justify-center">
                                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 text-xs text-red-500"
                                      onClick={() => handleToggleInclusione(dest.id, false)}
                                    >
                                      Escludi
                                    </Button>
                                  </div>
                                ) : (
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-1 justify-center">
                                      <XCircle className="w-4 h-4 text-red-400" />
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 text-xs text-green-600"
                                        onClick={() => handleToggleInclusione(dest.id, true)}
                                      >
                                        Includi
                                      </Button>
                                    </div>
                                    {dest.motivazioneEsclusione && (
                                      <p className="text-xs text-slate-500 max-w-[150px]">{dest.motivazioneEsclusione}</p>
                                    )}
                                  </div>
                                )}
                                {dest.incluso && (
                                  <Input
                                    placeholder="Motivazione esclusione..."
                                    className="h-6 text-xs mt-1 w-32"
                                    value={motivazioneEsclusione[dest.id] ?? ""}
                                    onChange={(e) =>
                                      setMotivazioneEsclusione((prev) => ({ ...prev, [dest.id]: e.target.value }))
                                    }
                                  />
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </TabsContent>
                );
              })}
            </Tabs>

            {/* Aggiungi manuale */}
            {showAggiungiManuale && (
              <Card className="border-dashed">
                <CardHeader><CardTitle className="text-sm">Aggiungi destinatario manuale</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <Input placeholder="Codice" value={nuovoNom.codice} onChange={(e) => setNuovoNom((p) => ({ ...p, codice: e.target.value }))} />
                  <Input placeholder="Ragione Sociale *" className="col-span-2" value={nuovoNom.ragioneSociale} onChange={(e) => setNuovoNom((p) => ({ ...p, ragioneSociale: e.target.value }))} />
                  <Input placeholder="Saldo *" type="number" value={nuovoNom.saldo} onChange={(e) => setNuovoNom((p) => ({ ...p, saldo: e.target.value }))} />
                  <Select value={nuovoNom.tipo} onValueChange={(v) => setNuovoNom((p) => ({ ...p, tipo: v as any }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cliente">Cliente</SelectItem>
                      <SelectItem value="fornitore">Fornitore</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="col-span-2 md:col-span-5 flex gap-2">
                    <Button size="sm" onClick={handleAggiungiManuale}>Aggiungi</Button>
                    <Button size="sm" variant="ghost" onClick={() => setShowAggiungiManuale(false)}>Annulla</Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Azioni */}
            <div className="flex flex-wrap gap-3 justify-between">
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setShowAggiungiManuale(true)}>
                  <Plus className="w-4 h-4 mr-1" /> Aggiungi manuale
                </Button>
                <Button variant="outline" onClick={() => setStep("setup")}>
                  <ChevronLeft className="w-4 h-4 mr-1" /> Modifica parametri
                </Button>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleGeneraLettere}
                  disabled={generaLettere.isPending}
                  className="bg-green-700 hover:bg-green-800"
                >
                  {generaLettere.isPending ? (
                    <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Generazione in corso...</>
                  ) : (
                    <><FileText className="w-4 h-4 mr-2" /> Genera lettere Word</>
                  )}
                </Button>
                {sessioneData.sessione.stato === "lettere_generate" || sessioneData.sessione.stato === "follow_up" || sessioneData.sessione.stato === "inviate" ? (
                  <>
                    <Button onClick={() => setStep("followup")} className="bg-blue-700 hover:bg-blue-800">
                      <BarChart3 className="w-4 h-4 mr-2" /> Vai al Follow-up
                    </Button>
                    <Button
                      variant="outline"
                      className="border-blue-300 text-blue-700 hover:bg-blue-50"
                      disabled={downloadingZip}
                      onClick={() => sessioneId && handleDownloadZip(sessioneId)}
                    >
                      {downloadingZip ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Download className="w-4 h-4 mr-2" />
                      )}
                      Scarica tutte le lettere (.zip)
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: FOLLOW-UP */}
        {step === "followup" && sessioneData && (
          <div className="space-y-6">
            <Card className="border-blue-200 bg-blue-50/40">
              <CardHeader>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2"><Zap className="w-4 h-4 text-blue-700" /> Risposte dal dossier</CardTitle>
                    <CardDescription>Associa i PDF ai nominativi, esegue OCR locale e confronta il saldo confermato con quello contabile.</CardDescription>
                  </div>
                  <Button onClick={handleAcquisisciRisposte} disabled={acquisisciRisposte.isPending} className="bg-blue-700 hover:bg-blue-800">
                    {acquisisciRisposte.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                    {acquisisciRisposte.isPending ? "Analisi in corso..." : "Acquisisci e verifica dal dossier"}
                  </Button>
                </div>
              </CardHeader>
              {esitoAcquisizione && (
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-2 text-xs">
                    <Badge variant="outline">{esitoAcquisizione.documentiPdf} PDF trovati</Badge>
                    <Badge className="bg-green-100 text-green-800">{esitoAcquisizione.associati} nominativi associati</Badge>
                    {esitoAcquisizione.nonAssociati.length > 0 && <Badge className="bg-amber-100 text-amber-800">{esitoAcquisizione.nonAssociati.length} file da associare</Badge>}
                  </div>
                  <div className="overflow-x-auto rounded-lg border bg-white">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50"><tr><th className="text-left p-2">Nominativo</th><th className="text-right p-2">Contabile</th><th className="text-right p-2">Confermato</th><th className="text-right p-2">Differenza</th><th className="text-center p-2">Esito automatico</th></tr></thead>
                      <tbody>{esitoAcquisizione.risultati.map((result: any) => (
                        <tr key={result.destinatarioId} className="border-t">
                          <td className="p-2"><p className="font-medium">{result.ragioneSociale}</p><p className="text-[10px] text-slate-500">{result.file}{result.allegati > 1 ? ` + ${result.allegati - 1} allegato/i` : ""}</p></td>
                          <td className="p-2 text-right font-mono">{formatCurrency(result.saldoContabile, { simbolo: false })}</td>
                          <td className="p-2 text-right font-mono">{result.saldoConfermato != null ? formatCurrency(result.saldoConfermato, { simbolo: false }) : "da verificare"}</td>
                          <td className={`p-2 text-right font-mono ${result.conforme ? "text-green-700" : "text-orange-700"}`}>{result.differenza != null ? formatCurrency(result.differenza, { simbolo: false }) : "—"}</td>
                          <td className="p-2 text-center"><Badge className={result.conforme ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}>{result.conforme ? "Conforme" : "Da riesaminare"} · conf. {result.confidenza}</Badge></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                  <p className="text-[11px] text-slate-500">L'esito è una proposta automatica: le letture manoscritte, la firma e le anomalie indicate nelle note devono essere confermate dal revisore.</p>
                </CardContent>
              )}
            </Card>
            {/* Statistiche */}
            {riepilogo && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: "Inviate", value: riepilogo.inviate, color: "text-yellow-700", bg: "bg-yellow-50" },
                  { label: "Risposte ricevute", value: riepilogo.risposteRicevute, color: "text-green-700", bg: "bg-green-50" },
                  { label: "Discordanti", value: riepilogo.risposteDiscordanti, color: "text-orange-700", bg: "bg-orange-50" },
                  { label: "Nessuna risposta", value: riepilogo.nessuna, color: "text-red-700", bg: "bg-red-50" },
                ].map((s) => (
                  <Card key={s.label} className={s.bg}>
                    <CardContent className="pt-4 text-center">
                      <div className={`text-3xl font-bold ${s.color}`}>{s.value}</div>
                      <div className="text-xs text-slate-600 mt-1">{s.label}</div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {riepilogo && riepilogo.differenzeTotali > 0 && (
              <Card className="border-orange-200 bg-orange-50">
                <CardContent className="pt-4">
                  <p className="text-sm text-orange-800">
                    <AlertTriangle className="w-4 h-4 inline mr-1" />
                    <strong>Differenze totali rilevate: €{formatCurrency(riepilogo.differenzeTotali, { simbolo: false })}</strong> — verificare le singole posizioni discordanti e documentare le procedure di riconciliazione nel fascicolo.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Tabella follow-up */}
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-slate-600">Nominativo</th>
                    <th className="text-center px-3 py-2 font-medium text-slate-600">Tipo</th>
                    <th className="text-right px-3 py-2 font-medium text-slate-600">Saldo (€)</th>
                    <th className="text-center px-3 py-2 font-medium text-slate-600">Stato</th>
                    <th className="text-right px-3 py-2 font-medium text-slate-600">Saldo confermato</th>
                    <th className="text-right px-3 py-2 font-medium text-slate-600">Differenza</th>
                    <th className="text-center px-3 py-2 font-medium text-slate-600">Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {destinatari.filter((d) => d.incluso).map((dest) => {
                    const edit = followUpEdit[dest.id];
                    const differenza = dest.differenza ? parseFloat(dest.differenza) : null;
                    return (
                      <tr key={dest.id} className="border-b hover:bg-slate-50">
                        <td className="px-3 py-2">
                          <div className="font-medium">{dest.ragioneSociale}</div>
                          {dest.isEstero && <Badge variant="outline" className="text-xs">Estero</Badge>}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Badge variant={dest.tipo === "cliente" ? "default" : "secondary"}>
                            {dest.tipo === "cliente" ? "Cliente" : "Fornitore"}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {formatCurrency(dest.saldo, { simbolo: false })}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <BadgeStatoLettera stato={dest.statoLettera ?? "da_generare"} />
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-slate-600">
                          {dest.saldoConfermato
                            ? formatCurrency(dest.saldoConfermato, { simbolo: false })
                            : "—"}
                        </td>
                        <td className={`px-3 py-2 text-right font-mono font-bold ${differenza && differenza !== 0 ? "text-orange-600" : "text-green-600"}`}>
                          {differenza !== null ? (differenza === 0 ? "✓ 0,00" : formatCurrency(differenza, { simbolo: false })) : "—"}
                        </td>
                        <td className="px-3 py-2">
                          <div className="space-y-1 min-w-[200px]">
                            <Select
                              value={edit?.stato ?? dest.statoLettera ?? ""}
                              onValueChange={(v) =>
                                setFollowUpEdit((p) => ({ ...p, [dest.id]: { ...p[dest.id], stato: v } }))
                              }
                            >
                              <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Aggiorna stato..." /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="inviata">Inviata</SelectItem>
                                <SelectItem value="risposta_ricevuta">Risposta ricevuta</SelectItem>
                                <SelectItem value="risposta_discordante">Risposta discordante</SelectItem>
                                <SelectItem value="nessuna_risposta">Nessuna risposta</SelectItem>
                                <SelectItem value="procedura_alternativa">Procedura alternativa</SelectItem>
                              </SelectContent>
                            </Select>
                            {(edit?.stato === "risposta_ricevuta" || edit?.stato === "risposta_discordante") && (
                              <Input
                                placeholder="Saldo confermato (€)"
                                className="h-7 text-xs"
                                type="number"
                                value={edit?.saldoConfermato ?? ""}
                                onChange={(e) =>
                                  setFollowUpEdit((p) => ({ ...p, [dest.id]: { ...p[dest.id], saldoConfermato: e.target.value } }))
                                }
                              />
                            )}
                            {edit?.stato === "procedura_alternativa" && (
                              <Input
                                placeholder="Descrivere procedura alternativa..."
                                className="h-7 text-xs"
                                value={edit?.proceduraAlternativa ?? ""}
                                onChange={(e) =>
                                  setFollowUpEdit((p) => ({ ...p, [dest.id]: { ...p[dest.id], proceduraAlternativa: e.target.value } }))
                                }
                              />
                            )}
                            <Input
                              placeholder="Note..."
                              className="h-7 text-xs"
                              value={edit?.note ?? dest.noteFollowUp ?? ""}
                              onChange={(e) =>
                                setFollowUpEdit((p) => ({ ...p, [dest.id]: { ...p[dest.id], note: e.target.value } }))
                              }
                            />
                            <input
                              id={`risposta-${dest.id}`}
                              type="file"
                              accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
                              className="hidden"
                              onChange={e => { const file = e.target.files?.[0]; if (file) void handleCaricaRisposta(dest.id, file); }}
                            />
                            <Button type="button" variant="outline" size="sm" className="h-7 text-xs w-full" disabled={uploadingRisposta === dest.id} onClick={() => document.getElementById(`risposta-${dest.id}`)?.click()}>
                              {uploadingRisposta === dest.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Upload className="w-3 h-3 mr-1" />}
                              {dest.nomeFileRisposta ? "Sostituisci risposta" : "Carica risposta"}
                            </Button>
                            {dest.s3UrlRisposta && <a href={dest.s3UrlRisposta} target="_blank" rel="noreferrer" className="block text-[11px] text-blue-600 underline truncate">{dest.nomeFileRisposta || "Apri risposta"}</a>}
                            {!dest.s3UrlRisposta && dest.nomeFileRisposta && <p className="text-[11px] text-blue-700 truncate" title={dest.nomeFileRisposta}>Nel dossier: {dest.nomeFileRisposta}</p>}
                            {edit?.stato && (
                              <Button
                                size="sm"
                                className="h-7 text-xs w-full"
                                onClick={() => handleSalvaFollowUp(dest.id)}
                              >
                                Salva
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" onClick={() => setStep("campione")}>
                <ChevronLeft className="w-4 h-4 mr-1" /> Torna al campione
              </Button>
              {sessioneId && (
                <Button
                  className="bg-green-600 hover:bg-green-700 text-white"
                  onClick={handleExportCartaLavoro}
                  disabled={exportingCL}
                >
                  <Download className="w-4 h-4 mr-1" />
                  {exportingCL ? "Esportazione..." : "Esporta Carta di Lavoro ISA 505 (Excel)"}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </RevisorLayout>
  );
}
