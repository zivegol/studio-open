import React, { useState } from "react";
import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import RevisorLayout from "@/components/revisione/RevisorLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  AlertTriangle, CheckCircle2, Clock, Sparkles, ArrowRight,
  TrendingUp, Building2, Package, Banknote, Users, FileText,
  BarChart3, Shield, RefreshCw, ChevronDown, ChevronUp, Info,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";

// ─── Configurazione aree ──────────────────────────────────────────────────────
const AREE_CONFIG: Record<string, {
  label: string;
  isa: string;
  icon: React.ReactNode;
  colore: string;
  route?: string;
}> = {
  crediti_clienti:       { label: "Crediti verso Clienti",     isa: "ISA 505",     icon: <Users className="h-4 w-4" />,     colore: "blue",   route: "circolarizzazione" },
  debiti_fornitori:      { label: "Debiti verso Fornitori",     isa: "ISA 500",     icon: <Building2 className="h-4 w-4" />, colore: "purple", route: "circolarizzazione" },
  rimanenze:             { label: "Rimanenze",                  isa: "ISA 501",     icon: <Package className="h-4 w-4" />,   colore: "orange", route: "scheda-rimanenze" },
  immobilizzazioni_mat:  { label: "Immobilizzazioni Materiali", isa: "ISA 500/501", icon: <Building2 className="h-4 w-4" />, colore: "stone",  route: "scheda-immobilizzazioni" },
  immobilizzazioni_immat:{ label: "Immobilizzazioni Immateriali",isa: "ISA 500",    icon: <FileText className="h-4 w-4" />,  colore: "slate",  route: "scheda-immobilizzazioni" },
  disponibilita_liquide: { label: "Disponibilità Liquide",      isa: "ISA 500/505", icon: <Banknote className="h-4 w-4" />,  colore: "green",  route: "scheda-disponibilita-liquide" },
  patrimonio_netto:      { label: "Patrimonio Netto",           isa: "ISA 500",     icon: <Shield className="h-4 w-4" />,    colore: "indigo", route: "scheda-patrimonio-netto" },
  ricavi_costi:          { label: "Ricavi e Costi",             isa: "ISA 240/315", icon: <TrendingUp className="h-4 w-4" />,colore: "teal",   route: "scheda-ricavi" },
  debiti_tributari:      { label: "Debiti Tributari",           isa: "ISA 500",     icon: <FileText className="h-4 w-4" />,  colore: "red",    route: undefined },
  fondi_rischi:          { label: "Fondi Rischi e Oneri",       isa: "ISA 500",     icon: <AlertTriangle className="h-4 w-4" />, colore: "yellow", route: undefined },
  parti_correlate:       { label: "Parti Correlate",            isa: "ISA 550",     icon: <Users className="h-4 w-4" />,     colore: "pink",   route: undefined },
  continuita_aziendale:  { label: "Continuità Aziendale",       isa: "ISA 570",     icon: <BarChart3 className="h-4 w-4" />, colore: "rose",   route: undefined },
};

const RISCHIO_CONFIG = {
  basso:   { label: "Basso",   badge: "bg-green-100 text-green-800",  bar: "bg-green-500",  dot: "bg-green-500"  },
  medio:   { label: "Medio",   badge: "bg-yellow-100 text-yellow-800",bar: "bg-yellow-500", dot: "bg-yellow-500" },
  alto:    { label: "Alto",    badge: "bg-orange-100 text-orange-800",bar: "bg-orange-500", dot: "bg-orange-500" },
  critico: { label: "Critico", badge: "bg-red-100 text-red-800",      bar: "bg-red-500",    dot: "bg-red-500"    },
};

const STATO_CONFIG = {
  da_iniziare:      { label: "Da iniziare",  icon: <Clock className="h-3 w-3" />,        badge: "bg-gray-100 text-gray-700" },
  in_corso:         { label: "In corso",     icon: <RefreshCw className="h-3 w-3" />,    badge: "bg-blue-100 text-blue-700" },
  completata:       { label: "Completata",   icon: <CheckCircle2 className="h-3 w-3" />, badge: "bg-green-100 text-green-700" },
  non_applicabile:  { label: "N/A",          icon: <Info className="h-3 w-3" />,         badge: "bg-gray-100 text-gray-500" },
};

// ─── Componente AreaCard ──────────────────────────────────────────────────────
function AreaCard({
  area, incaricoId, onAggiorna,
}: {
  area: any;
  incaricoId: number;
  onAggiorna: () => void;
}) {
  const [, navigate] = useLocation();
  const [expanded, setExpanded] = useState(false);
  const [noteLocali, setNoteLocali] = useState(area.noteRevisore ?? "");

  const cfg = AREE_CONFIG[area.area] ?? { label: area.area, isa: "", icon: <FileText className="h-4 w-4" />, colore: "gray" };
  const rischio = RISCHIO_CONFIG[area.livelloRischio as keyof typeof RISCHIO_CONFIG] ?? RISCHIO_CONFIG.medio;
  const stato = STATO_CONFIG[area.stato as keyof typeof STATO_CONFIG] ?? STATO_CONFIG.da_iniziare;
  const procedure = (area.procedureSuggerite as any[]) ?? [];

  const aggiornaStato = trpc.strategia.aggiornaAreaControllo.useMutation({ onSuccess: onAggiorna });

  const handleStato = (nuovoStato: string) => {
    aggiornaStato.mutate({ areaId: area.id, stato: nuovoStato as any, noteRevisore: noteLocali });
  };

  const handleSalvaNota = () => {
    aggiornaStato.mutate({ areaId: area.id, noteRevisore: noteLocali });
  };

  return (
    <Card className={`border-l-4 ${
      area.livelloRischio === "critico" ? "border-l-red-500" :
      area.livelloRischio === "alto" ? "border-l-orange-500" :
      area.livelloRischio === "medio" ? "border-l-yellow-500" : "border-l-green-500"
    }`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className={`p-1.5 rounded-md bg-${cfg.colore}-100 text-${cfg.colore}-700 shrink-0`}>
              {cfg.icon}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm">{cfg.label}</span>
                <span className="text-xs text-muted-foreground">{cfg.isa}</span>
                {area.priorita && (
                  <span className="text-xs font-bold text-muted-foreground">#{area.priorita}</span>
                )}
              </div>
              {area.valoreBilancio && (
                <div className="text-xs text-muted-foreground mt-0.5">
                  {formatCurrency(area.valoreBilancio)}
                  {area.deltaPercentuale && (
                    <span className={`ml-2 font-medium ${parseFloat(area.deltaPercentuale) > 0 ? "text-green-600" : "text-red-600"}`}>
                      {parseFloat(area.deltaPercentuale) > 0 ? "+" : ""}{parseFloat(area.deltaPercentuale).toFixed(1)}%
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${rischio.badge}`}>
              {rischio.label}
            </span>
            <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${stato.badge}`}>
              {stato.icon}{stato.label}
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-3">
        {/* Motivazione rischio */}
        {area.motivazioneRischio && (
          <p className="text-xs text-muted-foreground italic border-l-2 border-muted pl-2">
            {area.motivazioneRischio}
          </p>
        )}

        {/* Procedure suggerite (collassabili) */}
        {procedure.length > 0 && (
          <div>
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {procedure.length} procedure suggerite
            </button>
            {expanded && (
              <ul className="mt-2 space-y-1">
                {procedure.map((p: any, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    <span className={`mt-0.5 shrink-0 text-xs font-bold px-1 rounded ${
                      p.priorita === "alta" ? "bg-red-100 text-red-700" :
                      p.priorita === "media" ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-600"
                    }`}>{p.priorita ?? "—"}</span>
                    <span className="text-muted-foreground">{p.procedura}</span>
                    {p.isa && <span className="shrink-0 text-xs text-blue-600">{p.isa}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Note revisore */}
        <div className="space-y-1">
          <Textarea
            value={noteLocali}
            onChange={e => setNoteLocali(e.target.value)}
            placeholder="Note revisore..."
            className="text-xs min-h-[50px] resize-none"
          />
          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-1">
              {(["da_iniziare", "in_corso", "completata", "non_applicabile"] as const).map(s => (
                <button
                  key={s}
                  onClick={() => handleStato(s)}
                  className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                    area.stato === s
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-muted text-muted-foreground hover:border-primary"
                  }`}
                >
                  {STATO_CONFIG[s].label}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              {cfg.route && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-xs px-2"
                  onClick={() => navigate(`/incarichi/${incaricoId}/${cfg.route}`)}
                >
                  Apri scheda <ArrowRight className="h-3 w-3 ml-1" />
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-xs px-2"
                onClick={handleSalvaNota}
                disabled={aggiornaStato.isPending}
              >
                Salva nota
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Pagina principale ────────────────────────────────────────────────────────
export default function PianoControlli() {
  const { id } = useParams<{ id: string }>();
  const incaricoId = parseInt(id ?? "0");
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  // Dati
  const { data: incarico } = trpc.incarichi.get.useQuery({ id: incaricoId });
  const { data: cliente } = trpc.clienti.get.useQuery(
    { id: incarico?.clienteId ?? 0 },
    { enabled: !!incarico?.clienteId }
  );
  const { data: strategia, refetch: refetchStrategia } = trpc.strategia.get.useQuery(
    { incaricoId, fase: "revisione" },
    { enabled: incaricoId > 0 }
  );
  const { data: aree, refetch: refetchAree } = trpc.strategia.getAreeControllo.useQuery(
    { incaricoId },
    { enabled: incaricoId > 0 }
  );

  // Mutazioni
  const generaRevisione = trpc.strategia.generaRevisione.useMutation({
    onSuccess: () => {
      refetchStrategia();
      refetchAree();
      utils.strategia.getAreeControllo.invalidate({ incaricoId });
    },
  });

  const areeOrdinata = [...(aree ?? [])].sort((a, b) => {
    const ordineRischio = { critico: 0, alto: 1, medio: 2, basso: 3 };
    return (ordineRischio[a.livelloRischio as keyof typeof ordineRischio] ?? 2) -
           (ordineRischio[b.livelloRischio as keyof typeof ordineRischio] ?? 2);
  });

  // Statistiche avanzamento
  const totaleAree = areeOrdinata.length;
  const areeCompletate = areeOrdinata.filter(a => a.stato === "completata").length;
  const areeInCorso = areeOrdinata.filter(a => a.stato === "in_corso").length;
  const areeCritiche = areeOrdinata.filter(a => a.livelloRischio === "critico" || a.livelloRischio === "alto").length;
  const percAvanzamento = totaleAree > 0 ? Math.round((areeCompletate / totaleAree) * 100) : 0;

  const ragioneSociale = cliente?.ragioneSociale ?? `Incarico #${incaricoId}`;
  const anno = incarico?.annoEsercizio ?? "—";

  return (
    <RevisorLayout>
      <div className="max-w-5xl mx-auto space-y-6 p-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <button
              onClick={() => navigate(`/incarichi/${incaricoId}`)}
              className="text-xs text-muted-foreground hover:text-primary mb-1 flex items-center gap-1"
            >
              ← Fascicolo incarico
            </button>
            <h1 className="text-2xl font-bold">Piano dei Controlli</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {ragioneSociale} — Esercizio {anno}
            </p>
          </div>
          <Button
            onClick={() => generaRevisione.mutate({ incaricoId })}
            disabled={generaRevisione.isPending}
            className="gap-2 shrink-0"
          >
            {generaRevisione.isPending ? (
              <><RefreshCw className="h-4 w-4 animate-spin" />Analisi in corso...</>
            ) : (
              <><Sparkles className="h-4 w-4" />{aree && aree.length > 0 ? "Rigenera piano AI" : "Genera piano AI"}</>
            )}
          </Button>
        </div>

        {/* Stato avanzamento */}
        {totaleAree > 0 && (
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Avanzamento revisione</span>
                <span className="text-sm text-muted-foreground">{areeCompletate}/{totaleAree} aree completate</span>
              </div>
              <Progress value={percAvanzamento} className="h-2 mb-3" />
              <div className="grid grid-cols-4 gap-3 text-center">
                <div className="bg-red-50 rounded-lg p-2">
                  <div className="text-lg font-bold text-red-700">{areeCritiche}</div>
                  <div className="text-xs text-red-600">Priorità alta</div>
                </div>
                <div className="bg-blue-50 rounded-lg p-2">
                  <div className="text-lg font-bold text-blue-700">{areeInCorso}</div>
                  <div className="text-xs text-blue-600">In corso</div>
                </div>
                <div className="bg-green-50 rounded-lg p-2">
                  <div className="text-lg font-bold text-green-700">{areeCompletate}</div>
                  <div className="text-xs text-green-600">Completate</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-2">
                  <div className="text-lg font-bold text-gray-700">{percAvanzamento}%</div>
                  <div className="text-xs text-gray-600">Avanzamento</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Piano strategico AI */}
        {strategia?.pianoStrategico && (
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Piano Strategico di Revisione
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed">{strategia.pianoStrategico}</p>
              {Boolean(strategia.variazioniSignificative) && (strategia.variazioniSignificative as any[]).length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-muted-foreground mb-2">Variazioni significative rispetto all'anno precedente:</p>
                  <div className="space-y-1">
                    {(strategia.variazioniSignificative as any[]).slice(0, 5).map((v: any, i: number): React.ReactNode => (
                      <div key={i} className="flex items-center justify-between text-xs bg-background rounded px-2 py-1">
                        <span className="font-medium">{v.voce}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-muted-foreground">{formatCurrency(v.valoreStorico)} → {formatCurrency(v.valoreCorrente)}</span>
                          <span className={`font-bold ${
                            v.segnalazione === "critica" ? "text-red-600" :
                            v.segnalazione === "attenzione" ? "text-orange-600" : "text-green-600"
                          }`}>
                            {v.deltaPerc > 0 ? "+" : ""}{v.deltaPerc?.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Stato vuoto */}
        {(!aree || aree.length === 0) && !generaRevisione.isPending && (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center">
              <BarChart3 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="font-semibold mb-2">Piano dei controlli non ancora generato</h3>
              <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
                Clicca su <strong>"Genera piano AI"</strong> per analizzare il bilancio caricato e ottenere
                un piano prioritizzato di controlli per tutte le aree significative, con procedure ISA specifiche
                e valutazione del rischio per ciascuna area.
              </p>
              <p className="text-xs text-muted-foreground">
                Assicurati di aver caricato il bilancio da revisionare nella sezione Documenti.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Loading */}
        {generaRevisione.isPending && (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="py-8 text-center">
              <RefreshCw className="h-8 w-8 text-primary animate-spin mx-auto mb-3" />
              <p className="font-medium">Analisi AI in corso...</p>
              <p className="text-sm text-muted-foreground mt-1">
                L'AI sta analizzando il bilancio, confrontando i dati storici e identificando le aree di rischio.
                Questo può richiedere 15-30 secondi.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Aree di controllo */}
        {areeOrdinata.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                Aree di controllo — ordinate per priorità
              </h2>
              <Badge variant="outline" className="text-xs">{totaleAree} aree</Badge>
            </div>
            <div className="grid gap-3">
              {areeOrdinata.map(area => (
                <AreaCard
                  key={area.id}
                  area={area}
                  incaricoId={incaricoId}
                  onAggiorna={() => refetchAree()}
                />
              ))}
            </div>
          </div>
        )}

        {/* Errore */}
        {generaRevisione.isError && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="py-4">
              <p className="text-sm text-red-700">
                Errore durante la generazione: {generaRevisione.error?.message}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </RevisorLayout>
  );
}
