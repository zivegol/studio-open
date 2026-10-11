import { useParams, Link } from "wouter";
import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2,
  Circle,
  Clock,
  Lock,
  ChevronRight,
  AlertTriangle,
  ArrowRight,
  BookOpen,
  FileText,
  BarChart3,
  Search,
  Send,
  CreditCard,
  Package,
  Building2,
  Landmark,
  TrendingUp,
  Calendar,
  Activity,
  PenLine,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Plus,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

// ─── TIPI ─────────────────────────────────────────────────────────────────────

type StatoStep = "completato" | "in_corso" | "disponibile" | "bloccato";
type PrioritaStep = "critica" | "alta" | "media" | "bassa";
type FaseWorkflow = "pianificazione" | "raccolta_dati" | "verifiche" | "completamento";

interface StepWorkflow {
  id: string;
  fase: FaseWorkflow;
  ordine: number;
  titolo: string;
  descrizione: string;
  riferimentoISA: string;
  stato: StatoStep;
  priorita: PrioritaStep;
  href: string;
  dipendeDa: string[];
  notaRevisore: string;
  percentualeCompletamento: number;
  completatoManualmente?: boolean;
}

// ─── CONFIGURAZIONE ICONE ─────────────────────────────────────────────────────

const ICONE_STEP: Record<string, React.ElementType> = {
  accettazione: FileText,
  comprensione: BookOpen,
  valutazione_rischio: AlertTriangle,
  materialita: BarChart3,
  piano_revisione: Calendar,
  bilancio_caricato: FileText,
  bilancio_storico: FileText,
  partitario: FileText,
  estratto_conto: CreditCard,
  analisi_verticale: BarChart3,
  verifica_ricavi_costi: TrendingUp,
  circolarizzazione: Send,
  verifica_incassi: Search,
  scheda_rimanenze: Package,
  scheda_immobilizzazioni: Building2,
  scheda_disponibilita_liquide: Landmark,
  scheda_patrimonio_netto: Activity,
  scheda_ricavi: TrendingUp,
  eventi_successivi: Calendar,
  continuita_aziendale: Activity,
};

const LABEL_FASE: Record<FaseWorkflow, string> = {
  pianificazione: "Pianificazione",
  raccolta_dati: "Raccolta Dati",
  verifiche: "Verifiche",
  completamento: "Completamento",
};

const COLORE_FASE: Record<FaseWorkflow, string> = {
  pianificazione: "bg-blue-500",
  raccolta_dati: "bg-amber-500",
  verifiche: "bg-violet-500",
  completamento: "bg-emerald-500",
};

// ─── COMPONENTI ───────────────────────────────────────────────────────────────

function BadgeStato({ stato }: { stato: StatoStep }) {
  switch (stato) {
    case "completato":
      return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 gap-1"><CheckCircle2 className="w-3 h-3" />Completato</Badge>;
    case "in_corso":
      return <Badge className="bg-blue-100 text-blue-800 border-blue-200 gap-1"><Clock className="w-3 h-3" />In corso</Badge>;
    case "disponibile":
      return <Badge className="bg-slate-100 text-slate-700 border-slate-200 gap-1"><Circle className="w-3 h-3" />Da fare</Badge>;
    case "bloccato":
      return <Badge className="bg-slate-50 text-slate-400 border-slate-200 gap-1"><Lock className="w-3 h-3" />Bloccato</Badge>;
  }
}

function BadgePriorita({ priorita }: { priorita: PrioritaStep }) {
  switch (priorita) {
    case "critica":
      return <Badge variant="destructive" className="text-xs">Critica</Badge>;
    case "alta":
      return <Badge className="bg-orange-100 text-orange-800 border-orange-200 text-xs">Alta</Badge>;
    case "media":
      return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200 text-xs">Media</Badge>;
    case "bassa":
      return <Badge className="bg-slate-100 text-slate-600 border-slate-200 text-xs">Bassa</Badge>;
  }
}

function IconaStato({ stato }: { stato: StatoStep }) {
  switch (stato) {
    case "completato":
      return <CheckCircle2 className="w-6 h-6 text-emerald-500 shrink-0" />;
    case "in_corso":
      return <Clock className="w-6 h-6 text-blue-500 shrink-0" />;
    case "disponibile":
      return <Circle className="w-6 h-6 text-slate-400 shrink-0" />;
    case "bloccato":
      return <Lock className="w-6 h-6 text-slate-300 shrink-0" />;
  }
}

function StepCard({ step, incaricoId, onSegnaCompletato }: {
  step: StepWorkflow;
  incaricoId: number;
  onSegnaCompletato?: (stepId: string, completato: boolean) => void;
}) {
  const Icona = ICONE_STEP[step.id] ?? FileText;
  const isBloccato = step.stato === "bloccato";
  const isCompletato = step.stato === "completato";
  const isCompletabile = !isBloccato;
  const [noteAperte, setNoteAperte] = useState(false);
  const [nuovaNota, setNuovaNota] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Query storico note (lazy: solo quando il pannello è aperto)
  const { data: storicoNote, refetch: refetchNote } = trpc.workflowRevisione.getStepNote.useQuery(
    { incaricoId, stepId: step.id },
    { enabled: noteAperte }
  );

  const aggiungiNota = trpc.workflowRevisione.aggiungiNotaStep.useMutation({
    onSuccess: () => {
      setNuovaNota("");
      refetchNote();
      toast.success("Nota aggiunta");
    },
    onError: () => toast.error("Errore nel salvataggio della nota"),
  });

  return (
    <div className={`rounded-lg border transition-all ${
      isBloccato ? "opacity-50 bg-slate-50 border-slate-200" :
      isCompletato ? "bg-emerald-50/50 border-emerald-200" :
      step.stato === "in_corso" ? "bg-blue-50/50 border-blue-200" :
      "bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm"
    }`}>
    <div className="flex gap-4 p-4">
      {/* Icona stato */}
      <div className="flex flex-col items-center gap-1 pt-0.5">
        <IconaStato stato={step.stato} />
      </div>

      {/* Contenuto */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <Icona className="w-4 h-4 text-slate-500 shrink-0" />
            <span className={`font-medium text-sm ${isBloccato ? "text-slate-400" : "text-slate-800"}`}>
              {step.titolo}
            </span>
            <BadgePriorita priorita={step.priorita} />
          </div>
          <div className="flex items-center gap-2">
            <BadgeStato stato={step.stato} />
            {step.completatoManualmente && (
              <Badge className="bg-violet-100 text-violet-700 border-violet-200 gap-1 text-xs">
                <PenLine className="w-2.5 h-2.5" />Manuale
              </Badge>
            )}
            <span className="text-xs text-slate-400">{step.riferimentoISA}</span>
          </div>
        </div>

        <p className={`text-xs mt-1 ${isBloccato ? "text-slate-400" : "text-slate-500"}`}>
          {step.descrizione}
        </p>

        {/* Nota contestuale */}
        {step.notaRevisore && !isBloccato && (
          <div className={`mt-2 text-xs px-2 py-1.5 rounded border-l-2 ${
            step.notaRevisore.startsWith("⚠️") ? "bg-amber-50 border-amber-400 text-amber-800" :
            isCompletato ? "bg-emerald-50 border-emerald-400 text-emerald-800" :
            "bg-slate-50 border-slate-300 text-slate-600"
          }`}>
            {step.notaRevisore}
          </div>
        )}

        {/* Barra avanzamento per step in corso */}
        {step.stato === "in_corso" && step.percentualeCompletamento > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <Progress value={step.percentualeCompletamento} className="h-1.5 flex-1" />
            <span className="text-xs text-slate-500 shrink-0">{step.percentualeCompletamento}%</span>
          </div>
        )}

        {/* Pulsante azione */}
        <div className="mt-2 flex gap-2 flex-wrap">
          {!isBloccato && step.href && (
            <Link href={step.href}>
              <Button
                size="sm"
                variant={isCompletato ? "outline" : "default"}
                className={`text-xs h-7 gap-1 ${isCompletato ? "" : "bg-slate-800 hover:bg-slate-700"}`}
              >
                {isCompletato ? "Visualizza" : step.stato === "in_corso" ? "Continua" : "Inizia"}
                <ChevronRight className="w-3 h-3" />
              </Button>
            </Link>
          )}
          {/* Pulsante segna completato per tutti gli step non bloccati */}
          {isCompletabile && onSegnaCompletato && (
            <Button
              size="sm"
              variant="outline"
              className={`text-xs h-7 gap-1 ${
                isCompletato && step.completatoManualmente
                  ? "border-violet-300 text-violet-700 hover:bg-violet-50"
                  : isCompletato
                  ? "border-slate-300 text-slate-500 hover:bg-slate-50"
                  : "border-emerald-300 text-emerald-700 hover:bg-emerald-50 hover:border-emerald-400"
              }`}
              onClick={() => onSegnaCompletato(step.id, !isCompletato)}
            >
              <PenLine className="w-3 h-3" />
              {isCompletato ? "Riapri step" : "Segna completato"}
            </Button>
          )}
        </div>
      </div>
    </div>
    {/* Pannello note espandibile */}
    {!isBloccato && (
      <div className="border-t border-dashed border-slate-200">
        <button
          className="w-full flex items-center gap-2 px-4 py-2 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-colors"
          onClick={() => setNoteAperte(v => !v)}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span>Note revisore</span>
          {storicoNote && storicoNote.length > 0 && (
            <Badge className="bg-slate-100 text-slate-600 border-0 text-xs px-1.5 py-0">{storicoNote.length}</Badge>
          )}
          <span className="ml-auto">{noteAperte ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}</span>
        </button>
        {noteAperte && (
          <div className="px-4 pb-4 space-y-3">
            {/* Storico note */}
            {storicoNote && storicoNote.length > 0 ? (
              <div className="space-y-2">
                {storicoNote.map(n => (
                  <div key={n.id} className="bg-slate-50 rounded p-2.5 border border-slate-100">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-medium text-slate-600">{n.autore ?? "Revisore"}</span>
                      <span className="text-xs text-slate-400">
                        {new Date(n.createdAt).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <p className="text-xs text-slate-700 whitespace-pre-wrap">{n.nota}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 italic">Nessuna nota per questo step.</p>
            )}
            {/* Form nuova nota */}
            <div className="flex gap-2">
              <Textarea
                ref={textareaRef}
                value={nuovaNota}
                onChange={e => setNuovaNota(e.target.value)}
                placeholder="Aggiungi una nota..."
                className="text-xs min-h-[60px] resize-none"
                onKeyDown={e => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && nuovaNota.trim()) {
                    aggiungiNota.mutate({ incaricoId, stepId: step.id, nota: nuovaNota.trim() });
                  }
                }}
              />
              <Button
                size="sm"
                className="self-end h-8 gap-1 bg-slate-700 hover:bg-slate-800 text-white"
                disabled={!nuovaNota.trim() || aggiungiNota.isPending}
                onClick={() => aggiungiNota.mutate({ incaricoId, stepId: step.id, nota: nuovaNota.trim() })}
              >
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </div>
            <p className="text-xs text-slate-400">Ctrl+Invio per salvare</p>
          </div>
        )}
      </div>
    )}
    </div>
  );
}

// ─── PAGINA PRINCIPALE ────────────────────────────────────────────────────────

export default function RoadmapRevisione() {
  const params = useParams<{ incaricoId: string }>();
  const incaricoId = parseInt(params.incaricoId ?? "0");

  // Filtro step per stato
  const [filtroStato, setFiltroStato] = useState<"tutti" | "da_fare" | "in_corso" | "completati">("tutti");

  // Dialog note per segna completato
  const [dialogStep, setDialogStep] = useState<{ stepId: string; completato: boolean } | null>(null);
  const [noteDialog, setNoteDialog] = useState("");

  const utils = trpc.useUtils();
  const segnaCompletato = trpc.workflowRevisione.segnaStepCompletato.useMutation({
    onSuccess: (result) => {
      utils.workflowRevisione.getWorkflow.invalidate({ incaricoId });
      toast.success(result.completato ? "Step segnato come completato" : "Step riportato a da fare");
      setDialogStep(null);
      setNoteDialog("");
    },
    onError: (e) => toast.error("Errore: " + e.message),
  });

  const handleSegnaCompletato = (stepId: string, completato: boolean) => {
    if (completato) {
      // Apri dialog per inserire note opzionali
      setDialogStep({ stepId, completato });
      setNoteDialog("");
    } else {
      // Rimuovi completamento senza dialog
      segnaCompletato.mutate({ incaricoId, stepId, completato: false });
    }
  };

  const { data, isLoading, error } = trpc.workflowRevisione.getWorkflow.useQuery(
    { incaricoId },
    { enabled: incaricoId > 0 }
  );

  if (isLoading) {
    return (
      <div className="container max-w-4xl py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-200 rounded w-1/3" />
          <div className="h-4 bg-slate-100 rounded w-1/2" />
          <div className="h-32 bg-slate-100 rounded" />
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-20 bg-slate-100 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="container max-w-4xl py-8">
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6 text-red-700 text-sm">
            Impossibile caricare il workflow. Verificare che l'incarico esista.
          </CardContent>
        </Card>
      </div>
    );
  }

  // Filtra step per stato
  const stepsFiltrati = data.steps.filter(step => {
    if (filtroStato === "tutti") return true;
    if (filtroStato === "da_fare") return step.stato === "disponibile" || step.stato === "bloccato";
    if (filtroStato === "in_corso") return step.stato === "in_corso";
    if (filtroStato === "completati") return step.stato === "completato";
    return true;
  });

  // Raggruppa step per fase
  const stepPerFase = stepsFiltrati.reduce<Record<FaseWorkflow, StepWorkflow[]>>((acc, step) => {
    if (!acc[step.fase]) acc[step.fase] = [];
    acc[step.fase].push(step);
    return acc;
  }, {} as Record<FaseWorkflow, StepWorkflow[]>);

  const fasi: FaseWorkflow[] = ["pianificazione", "raccolta_dati", "verifiche", "completamento"];

  return (
    <div className="container max-w-4xl py-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Roadmap di Revisione</h1>
          <p className="text-slate-500 text-sm mt-1">
            Guida passo-passo alle verifiche — segui l'ordine suggerito per una copertura completa.
          </p>
        </div>
        <Link href={`/incarichi/${incaricoId}`}>
          <Button variant="outline" size="sm">← Torna all'incarico</Button>
        </Link>
      </div>

      {/* Avanzamento globale */}
      <Card className="border-slate-200">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <span className="text-sm font-semibold text-slate-700">Avanzamento complessivo</span>
              <span className="text-xs text-slate-500 ml-2">
                {data.stepsCompletati} di {data.stepsTotali} step completati
              </span>
            </div>
            <span className="text-2xl font-bold text-slate-800">{data.percGlobale}%</span>
          </div>
          <Progress value={data.percGlobale} className="h-3" />

          {/* Stato dati disponibili */}
          <div className="flex gap-3 mt-4 flex-wrap">
            <span className={`text-xs px-2 py-1 rounded-full border ${data.hasBilancio ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-slate-50 border-slate-200 text-slate-500"}`}>
              {data.hasBilancio ? "✓" : "○"} Bilancio {data.annoN}
            </span>
            <span className={`text-xs px-2 py-1 rounded-full border ${data.hasBilancioStorico ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-slate-50 border-slate-200 text-slate-500"}`}>
              {data.hasBilancioStorico ? "✓" : "○"} Bilancio {data.annoN - 1}
            </span>
            <span className={`text-xs px-2 py-1 rounded-full border ${data.hasPartitario ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-slate-50 border-slate-200 text-slate-500"}`}>
              {data.hasPartitario ? "✓" : "○"} Partitario
            </span>
            <span className={`text-xs px-2 py-1 rounded-full border ${data.hasEstrattoConto ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-slate-50 border-slate-200 text-slate-500"}`}>
              {data.hasEstrattoConto ? "✓" : "○"} Estratto conto
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Prossimo step consigliato */}
      {data.prossimoStep && (
        <Card className="border-blue-200 bg-blue-50/50">
          <CardContent className="pt-5 pb-5">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-full bg-blue-100 shrink-0">
                <ArrowRight className="w-4 h-4 text-blue-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-blue-600 uppercase tracking-wide">Prossimo step consigliato</span>
                  <BadgePriorita priorita={data.prossimoStep.priorita} />
                </div>
                <p className="font-semibold text-slate-800 mt-0.5">{data.prossimoStep.titolo}</p>
                <p className="text-xs text-slate-600 mt-0.5">{data.prossimoStep.nota}</p>
              </div>
              <Link href={data.prossimoStep.href}>
                <Button size="sm" className="bg-blue-600 hover:bg-blue-700 shrink-0 gap-1">
                  Vai <ChevronRight className="w-3 h-3" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Barra filtri */}
      <div className="flex gap-2 flex-wrap">
        {([
          { key: "tutti", label: "Tutti", count: data.steps.length },
          { key: "da_fare", label: "Da fare", count: data.steps.filter(s => s.stato === "disponibile" || s.stato === "bloccato").length },
          { key: "in_corso", label: "In corso", count: data.steps.filter(s => s.stato === "in_corso").length },
          { key: "completati", label: "Completati", count: data.steps.filter(s => s.stato === "completato").length },
        ] as const).map(f => (
          <button
            key={f.key}
            onClick={() => setFiltroStato(f.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              filtroStato === f.key
                ? "bg-slate-800 text-white border-slate-800"
                : "bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50"
            }`}
          >
            {f.label}
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${
              filtroStato === f.key ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"
            }`}>{f.count}</span>
          </button>
        ))}
      </div>

      {/* Timeline per fase */}
      {stepsFiltrati.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm">
          Nessuno step corrisponde al filtro selezionato.
        </div>
      ) : null}
      {fasi.map(fase => {
        const steps = stepPerFase[fase] ?? [];
        if (steps.length === 0) return null;
        const stepsCompletati = steps.filter(s => s.stato === "completato").length;

        return (
          <div key={fase}>
            {/* Header fase */}
            <div className="flex items-center gap-3 mb-3">
              <div className={`w-3 h-3 rounded-full ${COLORE_FASE[fase]}`} />
              <h2 className="font-semibold text-slate-700 text-sm uppercase tracking-wide">
                {LABEL_FASE[fase]}
              </h2>
              <span className="text-xs text-slate-400">
                {stepsCompletati}/{steps.length}
              </span>
              <div className="flex-1 h-px bg-slate-200" />
            </div>

            {/* Step della fase */}
            <div className="space-y-2 ml-6">
              {steps.map(step => (
                <StepCard key={step.id} step={step} incaricoId={incaricoId} onSegnaCompletato={handleSegnaCompletato} />
              ))}
            </div>
          </div>
        );
      })}

      {/* Dialog conferma note per segna completato */}
      <Dialog open={!!dialogStep} onOpenChange={(open) => { if (!open) { setDialogStep(null); setNoteDialog(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Segna step come completato</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-slate-600">
              Aggiungi una nota opzionale per documentare le procedure eseguite (es. data verifica, fonti consultate).
            </p>
            <Textarea
              placeholder="Note revisore (opzionale)..."
              value={noteDialog}
              onChange={(e) => setNoteDialog(e.target.value)}
              rows={3}
              className="text-sm"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogStep(null); setNoteDialog(""); }}>Annulla</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={segnaCompletato.isPending}
              onClick={() => {
                if (!dialogStep) return;
                segnaCompletato.mutate({
                  incaricoId,
                  stepId: dialogStep.stepId,
                  completato: true,
                  noteRevisore: noteDialog.trim() || undefined,
                });
              }}
            >
              {segnaCompletato.isPending ? "Salvataggio..." : "Conferma completamento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
