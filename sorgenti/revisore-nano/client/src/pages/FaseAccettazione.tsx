import { useState } from "react";
import { useParams, useLocation } from "wouter";
import RevisorLayout from "@/components/revisione/RevisorLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  ChevronLeft, Sparkles, Loader2, AlertTriangle, CheckCircle,
  TrendingUp, TrendingDown, Minus, ArrowRight, FileText, BookOpen, Shield
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "wouter";

// ─── HELPER ───────────────────────────────────────────────────────────────────

function SemaforoIcon({ semaforo }: { semaforo: string }) {
  if (semaforo === "verde") return <div className="w-3 h-3 rounded-full bg-emerald-500 flex-shrink-0" />;
  if (semaforo === "rosso") return <div className="w-3 h-3 rounded-full bg-red-500 flex-shrink-0" />;
  return <div className="w-3 h-3 rounded-full bg-amber-400 flex-shrink-0" />;
}

function LivelloRischioBadge({ livello }: { livello: string }) {
  const cls =
    livello === "critico" ? "bg-red-100 text-red-700 border-red-200" :
    livello === "alto" ? "bg-orange-100 text-orange-700 border-orange-200" :
    livello === "medio" ? "bg-amber-100 text-amber-700 border-amber-200" :
    "bg-emerald-100 text-emerald-700 border-emerald-200";
  return <Badge variant="outline" className={`text-xs ${cls}`}>{livello}</Badge>;
}

function RaccomandazioneBanner({ raccomandazione, motivazione }: { raccomandazione: string; motivazione: string }) {
  if (raccomandazione === "accetta") {
    return (
      <div className="flex items-start gap-3 p-4 rounded-lg bg-emerald-50 border border-emerald-200">
        <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-emerald-800 text-sm">Raccomandazione: Accettare l'incarico</p>
          <p className="text-xs text-emerald-700 mt-1">{motivazione}</p>
        </div>
      </div>
    );
  }
  if (raccomandazione === "rifiuta") {
    return (
      <div className="flex items-start gap-3 p-4 rounded-lg bg-red-50 border border-red-200">
        <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-red-800 text-sm">Raccomandazione: Non accettare l'incarico</p>
          <p className="text-xs text-red-700 mt-1">{motivazione}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-50 border border-amber-200">
      <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
      <div>
        <p className="font-semibold text-amber-800 text-sm">Raccomandazione: Accettare con riserva</p>
        <p className="text-xs text-amber-700 mt-1">{motivazione}</p>
      </div>
    </div>
  );
}

// ─── PAGINA PRINCIPALE ────────────────────────────────────────────────────────

export default function FaseAccettazione() {
  const params = useParams<{ id: string }>();
  const incaricoId = parseInt(params.id);
  const [, navigate] = useLocation();
  const [noteRevisore, setNoteRevisore] = useState("");
  const [salvandoNote, setSalvandoNote] = useState(false);

  const { data: incarico } = trpc.incarichi.get.useQuery({ id: incaricoId });
  const { data: strategia, refetch: refetchStrategia } = trpc.strategia.get.useQuery({
    incaricoId,
    fase: "accettazione",
  });
  const { data: documenti } = trpc.documenti.listByIncarico.useQuery({ incaricoId });

  const generaAccettazione = trpc.strategia.generaAccettazione.useMutation({
    onSuccess: () => {
      refetchStrategia();
      toast.success("Analisi di accettazione generata");
    },
    onError: (e) => toast.error(e.message),
  });

  const avanzaARevisione = trpc.strategia.avanzaARevisione.useMutation({
    onSuccess: () => {
      toast.success("Incarico avanzato alla fase di revisione effettiva");
      navigate(`/incarichi/${incaricoId}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const aggiornaNote = trpc.strategia.aggiornaNote.useMutation({
    onSuccess: () => { toast.success("Note salvate"); setSalvandoNote(false); },
    onError: (e) => { toast.error(e.message); setSalvandoNote(false); },
  });

  // Bilanci storici analizzati
  const bilanciStorici = documenti?.filter(
    d => (d.tipoDocumento === "bilancio_storico" || d.tipoDocumento === "bilancio") && d.statoParsing === "completato"
  ) ?? [];
  const bilanciInAttesa = documenti?.filter(
    d => (d.tipoDocumento === "bilancio_storico" || d.tipoDocumento === "bilancio") && d.statoParsing !== "completato"
  ) ?? [];

  const indicatori = (strategia?.indicatoriRischio as any[]) ?? [];
  const areeRischio = (strategia?.areeRischioIdentificate as any[]) ?? [];
  const priorita = (strategia?.prioritaControlli as any[]) ?? [];
  const parsedExtra = strategia as any;

  function handleSalvaNote() {
    if (!strategia?.id) return;
    setSalvandoNote(true);
    aggiornaNote.mutate({ strategiaId: strategia.id, noteRevisore });
  }

  // Inizializza le note dal DB
  useState(() => {
    if (strategia?.noteRevisore) setNoteRevisore(strategia.noteRevisore);
  });

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
            <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-xs">Fase 1</Badge>
            <Badge variant="outline" className="text-xs">ISA Italia 210/220/300</Badge>
          </div>
          <h1 className="text-2xl font-bold text-foreground">Accettazione dell'Incarico</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Analisi preliminare dei bilanci storici per valutare l'accettazione e redigere il piano strategico iniziale.
          </p>
        </div>

        {/* Stato bilanci */}
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="w-4 h-4 text-muted-foreground" />
              Bilanci storici disponibili
            </CardTitle>
          </CardHeader>
          <CardContent>
            {bilanciStorici.length === 0 && bilanciInAttesa.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-sm text-muted-foreground">Nessun bilancio storico caricato.</p>
                <Link href={`/incarichi/${incaricoId}`}>
                  <Button variant="outline" size="sm" className="mt-3">
                    Vai al fascicolo per caricare i bilanci
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {bilanciStorici.map(d => (
                  <div key={d.id} className="flex items-center gap-2 text-sm">
                    <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                    <span className="text-foreground">{d.nomeFile}</span>
                    {d.annoRiferimento && <Badge variant="outline" className="text-xs">{d.annoRiferimento}</Badge>}
                    <Badge className="text-xs bg-emerald-100 text-emerald-700">analizzato</Badge>
                  </div>
                ))}
                {bilanciInAttesa.map(d => (
                  <div key={d.id} className="flex items-center gap-2 text-sm">
                    <Loader2 className="w-4 h-4 text-blue-500 flex-shrink-0 animate-spin" />
                    <span className="text-muted-foreground">{d.nomeFile}</span>
                    <Badge className="text-xs bg-blue-100 text-blue-700">in analisi</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Genera analisi */}
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-500" />
              Analisi AI per l'accettazione
            </CardTitle>
          </CardHeader>
          <CardContent>
            {bilanciStorici.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Carica e analizza almeno un bilancio storico prima di generare l'analisi.
              </p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground mb-4">
                  L'AI analizzerà i {bilanciStorici.length} bilancio/i disponibili per valutare i rischi di accettazione,
                  identificare le aree critiche e redigere un piano strategico preliminare conforme a ISA Italia 210/220/300.
                </p>
                <Button
                  onClick={() => generaAccettazione.mutate({ incaricoId })}
                  disabled={generaAccettazione.isPending}
                  className="bg-[#1e3a5f] hover:bg-[#162d4a]"
                >
                  {generaAccettazione.isPending ? (
                    <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Analisi in corso...</>
                  ) : (
                    <><Sparkles className="w-4 h-4 mr-2" /> {strategia ? "Rigenera analisi" : "Genera analisi"}</>
                  )}
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        {/* Risultati analisi */}
        {strategia && (
          <>
            {/* Raccomandazione */}
            {parsedExtra?.raccomandazioneAccettazione && (
              <div className="mb-6">
                <RaccomandazioneBanner
                  raccomandazione={parsedExtra.raccomandazioneAccettazione}
                  motivazione={parsedExtra.motivazioneAccettazione ?? ""}
                />
              </div>
            )}

            {/* Trend storici */}
            {strategia.analisiTrendStorici && (
              <Card className="mb-6">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-blue-500" />
                    Analisi andamento storico
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-foreground leading-relaxed">{strategia.analisiTrendStorici}</p>
                </CardContent>
              </Card>
            )}

            {/* Indicatori di rischio */}
            {indicatori.length > 0 && (
              <Card className="mb-6">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                    Indicatori di rischio
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {indicatori.map((ind: any, i: number) => (
                      <div key={i} className="flex items-start gap-3">
                        <SemaforoIcon semaforo={ind.semaforo} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-foreground">{ind.indicatore}</span>
                            {ind.valore && <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">{ind.valore}</span>}
                          </div>
                          {ind.nota && <p className="text-xs text-muted-foreground mt-0.5">{ind.nota}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Aree di rischio */}
            {areeRischio.length > 0 && (
              <Card className="mb-6">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Shield className="w-4 h-4 text-orange-500" />
                    Aree di rischio identificate
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {areeRischio.map((area: any, i: number) => (
                      <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/30">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="text-sm font-medium text-foreground">{area.area}</span>
                            <LivelloRischioBadge livello={area.livello} />
                          </div>
                          <p className="text-xs text-muted-foreground">{area.motivazione}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Piano strategico */}
            {strategia.pianoStrategico && (
              <Card className="mb-6">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-indigo-500" />
                    Piano strategico preliminare
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">{strategia.pianoStrategico}</p>
                </CardContent>
              </Card>
            )}

            {/* Priorità controlli */}
            {priorita.length > 0 && (
              <Card className="mb-6">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Priorità di controllo suggerite</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {priorita.map((p: any, i: number) => (
                      <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-border">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                          p.priorita <= 2 ? "bg-red-100 text-red-700" :
                          p.priorita <= 4 ? "bg-amber-100 text-amber-700" :
                          "bg-emerald-100 text-emerald-700"
                        }`}>{p.priorita}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground">{p.area}</p>
                          {p.motivazione && <p className="text-xs text-muted-foreground mt-0.5">{p.motivazione}</p>}
                          {p.procedureSuggerite && p.procedureSuggerite.length > 0 && (
                            <ul className="mt-1 space-y-0.5">
                              {(p.procedureSuggerite as string[]).slice(0, 3).map((proc: string, j: number) => (
                                <li key={j} className="text-xs text-muted-foreground flex items-start gap-1">
                                  <span className="text-muted-foreground/50 mt-0.5">›</span>
                                  <span>{proc}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Note revisore */}
            <Card className="mb-6">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Note del revisore</CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={noteRevisore}
                  onChange={e => setNoteRevisore(e.target.value)}
                  placeholder="Aggiungi considerazioni personali, osservazioni sull'impresa, elementi emersi dai colloqui con la direzione..."
                  className="min-h-[100px] text-sm"
                />
                <Button size="sm" variant="outline" className="mt-2" onClick={handleSalvaNote} disabled={salvandoNote}>
                  {salvandoNote ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                  Salva note
                </Button>
              </CardContent>
            </Card>

            {/* Avanza a revisione */}
            <Card className="border-2 border-indigo-200 bg-indigo-50/30">
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                    <ArrowRight className="w-5 h-5 text-indigo-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-foreground text-sm mb-1">Avanza alla Fase di Revisione Effettiva</h3>
                    <p className="text-xs text-muted-foreground mb-3">
                      Una volta completata la fase di accettazione e caricato il bilancio oggetto di revisione,
                      avanza alla fase di revisione effettiva per generare la strategia aggiornata e i controlli per area.
                    </p>
                    <Button
                      onClick={() => avanzaARevisione.mutate({ incaricoId })}
                      disabled={avanzaARevisione.isPending}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white"
                    >
                      {avanzaARevisione.isPending ? (
                        <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Avanzamento...</>
                      ) : (
                        <><ArrowRight className="w-4 h-4 mr-2" /> Avanza a revisione effettiva</>
                      )}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </RevisorLayout>
  );
}
