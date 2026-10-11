import { useState } from "react";
import { useParams } from "wouter";
import RevisorLayout from "@/components/revisione/RevisorLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ChevronLeft, Sparkles, Loader2, AlertTriangle, CheckCircle,
  TrendingUp, TrendingDown, Minus, BookOpen, Shield, ArrowRight,
  FileText, BarChart3, ChevronDown, ChevronUp, Link2
} from "lucide-react";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { toast } from "sonner";
import { Link } from "wouter";

// ─── ETICHETTE AREE ───────────────────────────────────────────────────────────

const AREA_LABELS: Record<string, { label: string; isa: string; colore: string }> = {
  crediti_clienti:       { label: "Crediti verso clienti",             isa: "ISA 505",     colore: "indigo" },
  debiti_fornitori:      { label: "Debiti verso fornitori",            isa: "ISA 500",     colore: "teal"   },
  rimanenze:             { label: "Rimanenze di magazzino",            isa: "ISA 501",     colore: "amber"  },
  immobilizzazioni_mat:  { label: "Immobilizzazioni materiali",        isa: "ISA 500/501", colore: "blue"   },
  immobilizzazioni_immat:{ label: "Immobilizzazioni immateriali",      isa: "ISA 500",     colore: "blue"   },
  disponibilita_liquide: { label: "Disponibilità liquide",             isa: "ISA 500/505", colore: "emerald"},
  patrimonio_netto:      { label: "Patrimonio netto",                  isa: "ISA 500",     colore: "purple" },
  ricavi_costi:          { label: "Ricavi e costi operativi",          isa: "ISA 240/315", colore: "orange" },
  debiti_tributari:      { label: "Debiti tributari e previdenziali",  isa: "ISA 500",     colore: "red"    },
  fondi_rischi:          { label: "Fondi rischi e oneri",              isa: "ISA 500",     colore: "rose"   },
  parti_correlate:       { label: "Parti correlate",                   isa: "ISA 550",     colore: "pink"   },
  continuita_aziendale:  { label: "Continuità aziendale",              isa: "ISA 570",     colore: "red"    },
};

const STATO_LABELS: Record<string, string> = {
  da_iniziare:      "Da iniziare",
  in_corso:         "In corso",
  completata:       "Completata",
  non_applicabile:  "N/A",
};

const STATO_COLORS: Record<string, string> = {
  da_iniziare:     "bg-gray-100 text-gray-600",
  in_corso:        "bg-blue-100 text-blue-700",
  completata:      "bg-emerald-100 text-emerald-700",
  non_applicabile: "bg-gray-50 text-gray-400",
};

const RISCHIO_COLORS: Record<string, string> = {
  critico: "border-red-300 bg-red-50/40",
  alto:    "border-orange-300 bg-orange-50/40",
  medio:   "border-amber-200 bg-amber-50/30",
  basso:   "border-emerald-200 bg-emerald-50/20",
};

// ─── COMPONENTE AREA CONTROLLO ────────────────────────────────────────────────

function AreaControlloCard({ area, incaricoId, onUpdate }: {
  area: any;
  incaricoId: number;
  onUpdate: () => void;
}) {
  const [aperta, setAperta] = useState(area.livelloRischio === "critico" || area.livelloRischio === "alto");
  const [note, setNote] = useState(area.noteRevisore ?? "");
  const [salvandoNote, setSalvandoNote] = useState(false);

  const meta = AREA_LABELS[area.area] ?? { label: area.area, isa: "", colore: "gray" };
  const procedure = (area.procedureSuggerite as any[]) ?? [];

  const aggiorna = trpc.strategia.aggiornaAreaControllo.useMutation({
    onSuccess: () => { onUpdate(); toast.success("Aggiornato"); },
    onError: (e) => toast.error(e.message),
  });

  function handleStatoChange(nuovoStato: string) {
    aggiorna.mutate({ areaId: area.id, stato: nuovoStato as any });
  }

  function handleSalvaNote() {
    setSalvandoNote(true);
    aggiorna.mutate({ areaId: area.id, noteRevisore: note });
    setSalvandoNote(false);
  }

  const deltaNum = area.deltaPercentuale ? parseFloat(area.deltaPercentuale) : null;
  const DeltaIcon = deltaNum === null ? Minus : deltaNum > 0 ? TrendingUp : TrendingDown;
  const deltaColor = deltaNum === null ? "text-muted-foreground" : deltaNum > 15 ? "text-red-600" : deltaNum > 5 ? "text-amber-600" : deltaNum < -15 ? "text-red-600" : "text-emerald-600";

  return (
    <Card className={`border ${RISCHIO_COLORS[area.livelloRischio] ?? "border-border"}`}>
      <CardContent className="p-0">
        {/* Header area */}
        <button
          className="w-full text-left p-4 flex items-center gap-3"
          onClick={() => setAperta(!aperta)}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-foreground text-sm">{meta.label}</span>
              <Badge variant="outline" className="text-xs">{meta.isa}</Badge>
              <Badge className={`text-xs ${STATO_COLORS[area.stato]}`}>{STATO_LABELS[area.stato]}</Badge>
              {area.livelloRischio && (
                <Badge variant="outline" className={`text-xs ${
                  area.livelloRischio === "critico" ? "border-red-300 text-red-700" :
                  area.livelloRischio === "alto" ? "border-orange-300 text-orange-700" :
                  area.livelloRischio === "medio" ? "border-amber-300 text-amber-700" :
                  "border-emerald-300 text-emerald-700"
                }`}>{area.livelloRischio}</Badge>
              )}
            </div>
            {/* Valori contabili */}
            {(area.valoreBilancio || area.valoreStorico) && (
              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                {area.valoreStorico && <span>Storico: {formatCurrency(area.valoreStorico)}</span>}
                {area.valoreBilancio && <span>Corrente: {formatCurrency(area.valoreBilancio)}</span>}
                {deltaNum !== null && (
                  <span className={`flex items-center gap-0.5 ${deltaColor}`}>
                    <DeltaIcon className="w-3 h-3" />
                    {formatPercent(deltaNum)}
                  </span>
                )}
              </div>
            )}
          </div>
          {aperta ? <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
        </button>

        {/* Dettaglio espandibile */}
        {aperta && (
          <div className="px-4 pb-4 border-t border-border/50 pt-3 space-y-4">
            {/* Motivazione rischio */}
            {area.motivazioneRischio && (
              <p className="text-xs text-muted-foreground italic">{area.motivazioneRischio}</p>
            )}

            {/* Procedure suggerite */}
            {procedure.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-foreground uppercase tracking-wide mb-2">Procedure suggerite</p>
                <div className="space-y-1.5">
                  {procedure.map((p: any, i: number) => (
                    <div key={i} className="flex items-start gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                        p.priorita === "alta" ? "bg-red-500" :
                        p.priorita === "media" ? "bg-amber-500" : "bg-emerald-500"
                      }`} />
                      <div className="flex-1 min-w-0">
                        <span className="text-xs text-foreground">{p.procedura ?? p}</span>
                        {p.isa && <span className="ml-2 text-xs text-muted-foreground">({p.isa})</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Link a strumenti specifici */}
            {(area.area === "crediti_clienti" || area.area === "debiti_fornitori") && (
              <div className="flex gap-2 flex-wrap">
                <Link href={`/incarichi/${incaricoId}/circolarizzazione`}>
                  <Button size="sm" variant="outline" className="text-xs h-7 gap-1">
                    <Link2 className="w-3 h-3" /> Circolarizzazione
                  </Button>
                </Link>
                <Link href={`/incarichi/${incaricoId}/verifica-incassi`}>
                  <Button size="sm" variant="outline" className="text-xs h-7 gap-1">
                    <Link2 className="w-3 h-3" /> Verifica incassi/pagamenti
                  </Button>
                </Link>
              </div>
            )}

            {/* Stato */}
            <div className="flex items-center gap-3">
              <p className="text-xs font-semibold text-foreground uppercase tracking-wide">Stato</p>
              <Select value={area.stato} onValueChange={handleStatoChange} disabled={aggiorna.isPending}>
                <SelectTrigger className="h-7 text-xs w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="da_iniziare">Da iniziare</SelectItem>
                  <SelectItem value="in_corso">In corso</SelectItem>
                  <SelectItem value="completata">Completata</SelectItem>
                  <SelectItem value="non_applicabile">Non applicabile</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Note revisore */}
            <div>
              <p className="text-xs font-semibold text-foreground uppercase tracking-wide mb-1.5">Note revisore</p>
              <Textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Osservazioni, evidenze raccolte, conclusioni..."
                className="min-h-[70px] text-xs"
              />
              <Button size="sm" variant="outline" className="mt-1.5 h-7 text-xs" onClick={handleSalvaNote} disabled={salvandoNote}>
                Salva note
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── PAGINA PRINCIPALE ────────────────────────────────────────────────────────

export default function FaseRevisione() {
  const params = useParams<{ id: string }>();
  const incaricoId = parseInt(params.id);

  const { data: incarico } = trpc.incarichi.get.useQuery({ id: incaricoId });
  const { data: strategia, refetch: refetchStrategia } = trpc.strategia.get.useQuery({
    incaricoId,
    fase: "revisione",
  });
  const { data: areeControllo, refetch: refetchAree } = trpc.strategia.getAreeControllo.useQuery({ incaricoId });
  const { data: documenti } = trpc.documenti.listByIncarico.useQuery({ incaricoId });

  const generaRevisione = trpc.strategia.generaRevisione.useMutation({
    onSuccess: () => {
      refetchStrategia();
      refetchAree();
      toast.success("Strategia di revisione generata");
    },
    onError: (e) => toast.error(e.message),
  });

  // Bilancio corrente
  const bilancioCorrente = documenti?.find(
    d => (d.tipoDocumento === "bilancio_revisione" || d.tipoDocumento === "bilancio") && d.statoParsing === "completato"
  );

  const variazioniSignificative = (strategia?.variazioniSignificative as any[]) ?? [];
  const indicatori = (strategia?.indicatoriRischio as any[]) ?? [];

  // Ordina aree per rischio (critico > alto > medio > basso)
  const ordineRischio = { critico: 0, alto: 1, medio: 2, basso: 3 };
  const areeSortate = [...(areeControllo ?? [])].sort((a, b) =>
    (ordineRischio[a.livelloRischio as keyof typeof ordineRischio] ?? 4) -
    (ordineRischio[b.livelloRischio as keyof typeof ordineRischio] ?? 4)
  );

  const areeCompletate = areeSortate.filter(a => a.stato === "completata").length;
  const areeTotali = areeSortate.filter(a => a.stato !== "non_applicabile").length;

  return (
    <RevisorLayout>
      <div className="max-w-3xl mx-auto px-4 py-6">
        {/* Back */}
        <Link href={`/incarichi/${incaricoId}`}>
          <Button variant="ghost" size="sm" className="mb-4 -ml-2 text-muted-foreground">
            <ChevronLeft className="w-4 h-4 mr-1" />
            {incarico?.cliente?.ragioneSociale ?? "Incarico"}
          </Button>
        </Link>

        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-1">
            <Badge className="bg-indigo-100 text-indigo-700 border-indigo-200 text-xs">Fase 2</Badge>
            <Badge variant="outline" className="text-xs">ISA Italia 300/315/330/500</Badge>
          </div>
          <h1 className="text-2xl font-bold text-foreground">Revisione Effettiva — {incarico?.annoEsercizio}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Strategia aggiornata con il bilancio corrente e controlli prioritizzati per area di rischio.
          </p>
        </div>

        {/* Avanzamento controlli */}
        {areeTotali > 0 && (
          <Card className="mb-6">
            <CardContent className="p-4">
              <div className="flex justify-between text-sm mb-2">
                <span className="font-medium text-foreground">Avanzamento controlli</span>
                <span className="text-muted-foreground">{areeCompletate}/{areeTotali} aree completate</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div
                  className="bg-indigo-500 h-2 rounded-full transition-all"
                  style={{ width: `${areeTotali > 0 ? (areeCompletate / areeTotali) * 100 : 0}%` }}
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Bilancio corrente */}
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="w-4 h-4 text-muted-foreground" />
              Bilancio oggetto di revisione
            </CardTitle>
          </CardHeader>
          <CardContent>
            {bilancioCorrente ? (
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                <span className="text-foreground">{bilancioCorrente.nomeFile}</span>
                {bilancioCorrente.annoRiferimento && (
                  <Badge variant="outline" className="text-xs">{bilancioCorrente.annoRiferimento}</Badge>
                )}
                <Badge className="text-xs bg-emerald-100 text-emerald-700">analizzato</Badge>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                <p className="text-sm text-muted-foreground">
                  Nessun bilancio corrente analizzato.{" "}
                  <Link href={`/incarichi/${incaricoId}`} className="text-indigo-600 underline">
                    Carica il bilancio {incarico?.annoEsercizio}
                  </Link>{" "}
                  prima di generare la strategia.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Genera strategia */}
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-500" />
              Strategia di revisione aggiornata
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              L'AI confronterà il bilancio corrente con i dati storici, aggiornerà la valutazione del rischio
              e genererà le procedure di controllo prioritizzate per ciascuna area di bilancio.
            </p>
            <Button
              onClick={() => generaRevisione.mutate({ incaricoId })}
              disabled={generaRevisione.isPending}
              className="bg-[#1e3a5f] hover:bg-[#162d4a]"
            >
              {generaRevisione.isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Generazione in corso...</>
              ) : (
                <><Sparkles className="w-4 h-4 mr-2" /> {strategia ? "Rigenera strategia" : "Genera strategia"}</>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Risultati strategia */}
        {strategia && (
          <>
            {/* Variazioni significative */}
            {variazioniSignificative.length > 0 && (
              <Card className="mb-6">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-blue-500" />
                    Variazioni significative (storico vs corrente)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-1.5 pr-3 font-semibold text-muted-foreground">Voce</th>
                          <th className="text-right py-1.5 pr-3 font-semibold text-muted-foreground">Storico</th>
                          <th className="text-right py-1.5 pr-3 font-semibold text-muted-foreground">Corrente</th>
                          <th className="text-right py-1.5 font-semibold text-muted-foreground">Δ%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {variazioniSignificative.map((v: any, i: number) => {
                          const delta = parseFloat(v.deltaPerc ?? v.delta ?? 0);
                          const segnalazione = v.segnalazione ?? "normale";
                          return (
                            <tr key={i} className={`border-b border-border/50 ${segnalazione === "critica" ? "bg-red-50/50" : segnalazione === "attenzione" ? "bg-amber-50/50" : ""}`}>
                              <td className="py-1.5 pr-3 text-foreground font-medium">{v.voce}</td>
                              <td className="py-1.5 pr-3 text-right text-muted-foreground">
                                {v.valoreStorico ? formatCurrency(v.valoreStorico, { simbolo: false }) : "n.d."}
                              </td>
                              <td className="py-1.5 pr-3 text-right text-foreground">
                                {v.valoreCorrente ? formatCurrency(v.valoreCorrente, { simbolo: false }) : "n.d."}
                              </td>
                              <td className={`py-1.5 text-right font-medium ${delta > 15 || delta < -15 ? "text-red-600" : delta > 5 || delta < -5 ? "text-amber-600" : "text-emerald-600"}`}>
                                {formatPercent(delta)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Analisi trend */}
            {strategia.analisiTrendStorici && (
              <Card className="mb-6">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-indigo-500" />
                    Analisi comparativa
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-foreground leading-relaxed">{strategia.analisiTrendStorici}</p>
                </CardContent>
              </Card>
            )}

            {/* Piano strategico aggiornato */}
            {strategia.pianoStrategico && (
              <Card className="mb-6">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Shield className="w-4 h-4 text-indigo-500" />
                    Piano di revisione aggiornato
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">{strategia.pianoStrategico}</p>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* Aree di controllo */}
        {areeSortate.length > 0 && (
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
              <Shield className="w-5 h-5 text-muted-foreground" />
              Controlli per area di bilancio
            </h2>
            <div className="space-y-3">
              {areeSortate.map(area => (
                <AreaControlloCard
                  key={area.id}
                  area={area}
                  incaricoId={incaricoId}
                  onUpdate={refetchAree}
                />
              ))}
            </div>
          </div>
        )}

        {/* Link ai moduli */}
        <Card className="border-border/50">
          <CardContent className="p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Moduli di supporto</p>
            <div className="grid grid-cols-2 gap-2">
              <Link href={`/incarichi/${incaricoId}/modulo/4`}>
                <Button variant="outline" size="sm" className="w-full text-xs h-8 gap-1.5">
                  <FileText className="w-3 h-3" /> Materialità
                </Button>
              </Link>
              <Link href={`/incarichi/${incaricoId}/modulo/3`}>
                <Button variant="outline" size="sm" className="w-full text-xs h-8 gap-1.5">
                  <AlertTriangle className="w-3 h-3" /> Valutazione rischio
                </Button>
              </Link>
              <Link href={`/incarichi/${incaricoId}/circolarizzazione`}>
                <Button variant="outline" size="sm" className="w-full text-xs h-8 gap-1.5">
                  <FileText className="w-3 h-3" /> Circolarizzazione
                </Button>
              </Link>
              <Link href={`/incarichi/${incaricoId}/verifica-incassi`}>
                <Button variant="outline" size="sm" className="w-full text-xs h-8 gap-1.5">
                  <CheckCircle className="w-3 h-3" /> Verifica incassi
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </RevisorLayout>
  );
}
