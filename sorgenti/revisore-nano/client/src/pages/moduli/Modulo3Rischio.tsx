import { useState } from "react";
import RevisorLayout from "@/components/revisione/RevisorLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useParams, useLocation } from "wouter";
import { Loader2, Sparkles, ChevronRight, ChevronLeft, Plus, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import { Input } from "@/components/ui/input";

type LivelloRischio = "basso" | "medio" | "alto";

const LIVELLI = [
  { value: "1", label: "1 — Basso", color: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  { value: "2", label: "2 — Medio", color: "text-amber-700 bg-amber-50 border-amber-200" },
  { value: "3", label: "3 — Alto", color: "text-red-700 bg-red-50 border-red-200" },
];

function RischioSlider({ label, value, onChange, note, onNoteChange }: {
  label: string; value: number; onChange: (v: number) => void; note: string; onNoteChange: (v: string) => void;
}) {
  const livello = LIVELLI[value - 1];
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{label}</Label>
        {value > 0 && <Badge className={`text-xs border ${livello?.color}`}>{livello?.label}</Badge>}
      </div>
      <div className="flex gap-2">
        {LIVELLI.map((l, i) => (
          <button
            key={l.value}
            onClick={() => onChange(i + 1)}
            className={`flex-1 py-2 text-sm rounded-lg border transition-all ${value === i + 1 ? `${l.color} font-medium` : "border-border text-muted-foreground hover:bg-muted"}`}
          >
            {l.label}
          </button>
        ))}
      </div>
      <Textarea
        rows={2}
        placeholder="Note e motivazione..."
        value={note}
        onChange={e => onNoteChange(e.target.value)}
        className="text-sm"
      />
    </div>
  );
}

export default function Modulo3Rischio() {
  const params = useParams<{ id: string }>();
  const incaricoId = parseInt(params.id);
  const [, navigate] = useLocation();

  const { data: modulo, refetch } = trpc.moduli.rischio.get.useQuery({ incaricoId });
  const save = trpc.moduli.rischio.save.useMutation({
    onSuccess: () => { refetch(); toast.success("Salvato"); },
    onError: e => toast.error(e.message),
  });
  const analisiAi = trpc.moduli.rischio.analisiAiRischi.useMutation({
    onSuccess: () => { refetch(); toast.success("Analisi AI completata"); },
    onError: e => toast.error(e.message),
  });

  const [rischioInerente, setRischioInerente] = useState(modulo?.rischioInerentePunteggio || 0);
  const [noteInerente, setNoteInerente] = useState(modulo?.rischioInerenteNote || "");
  const [rischioControllo, setRischioControllo] = useState(modulo?.rischioControlloPunteggio || 0);
  const [noteControllo, setNoteControllo] = useState(modulo?.rischioControlloNote || "");
  const [areeRischio, setAreeRischio] = useState<Array<{ area: string; livello: LivelloRischio; descrizione: string }>>(
    (modulo?.areeRischio as any) || []
  );

  // Calcola RMM e rischio individuazione
  const rmm = rischioInerente > 0 && rischioControllo > 0 ? Math.round((rischioInerente + rischioControllo) / 2) : 0;
  const rischioIndividuazione = rmm >= 3 ? 1 : rmm === 2 ? 2 : rmm === 1 ? 3 : 0;
  const rmmLabel = LIVELLI[rmm - 1];
  const indLabel = LIVELLI[rischioIndividuazione - 1];

  function addArea() {
    setAreeRischio(prev => [...prev, { area: "", livello: "medio", descrizione: "" }]);
  }
  function removeArea(i: number) {
    setAreeRischio(prev => prev.filter((_, idx) => idx !== i));
  }
  function updateArea(i: number, field: string, value: string) {
    setAreeRischio(prev => prev.map((a, idx) => idx === i ? { ...a, [field]: value } : a));
  }

  function handleSave(completato = false) {
    save.mutate({
      incaricoId,
      rischioInerentePunteggio: rischioInerente || undefined,
      rischioInerenteNote: noteInerente || undefined,
      rischioControlloPunteggio: rischioControllo || undefined,
      rischioControlloNote: noteControllo || undefined,
      areeRischio: areeRischio.filter(a => a.area),
      completato,
    });
  }

  return (
    <RevisorLayout incaricoId={incaricoId} moduloAttivo={3}>
      <div className="p-6 max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className="text-xs">ISA Italia 315/330</Badge>
            {modulo?.completato && <Badge className="bg-emerald-100 text-emerald-700 text-xs">Completato</Badge>}
          </div>
          <h1 className="text-2xl font-bold text-foreground">Modulo 3 — Valutazione del rischio</h1>
          <p className="text-muted-foreground mt-1 text-sm">Rischio inerente, di controllo e di errore significativo (RMM)</p>
        </div>

        {/* Rischio inerente */}
        <Card className="mb-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Rischio inerente</CardTitle>
            <p className="text-xs text-muted-foreground">Propensione al rischio di errore significativo prima dei controlli (ISA 315.A86)</p>
          </CardHeader>
          <CardContent>
            <RischioSlider
              label="Livello rischio inerente"
              value={rischioInerente}
              onChange={setRischioInerente}
              note={noteInerente}
              onNoteChange={setNoteInerente}
            />
          </CardContent>
        </Card>

        {/* Rischio controllo */}
        <Card className="mb-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Rischio di controllo</CardTitle>
            <p className="text-xs text-muted-foreground">Efficacia del sistema di controllo interno (ISA 315.A88). Per nano imprese spesso ALTO per struttura organizzativa limitata.</p>
          </CardHeader>
          <CardContent>
            <RischioSlider
              label="Livello rischio di controllo"
              value={rischioControllo}
              onChange={setRischioControllo}
              note={noteControllo}
              onNoteChange={setNoteControllo}
            />
          </CardContent>
        </Card>

        {/* RMM e Rischio individuazione */}
        {rmm > 0 && (
          <Card className={`mb-4 ${rmm === 3 ? "border-red-200 bg-red-50/30" : rmm === 2 ? "border-amber-200 bg-amber-50/30" : "border-emerald-200 bg-emerald-50/30"}`}>
            <CardContent className="p-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Rischio di errore significativo (RMM)</div>
                  <Badge className={`text-sm px-3 py-1 border ${rmmLabel?.color}`}>{rmmLabel?.label}</Badge>
                  <p className="text-xs text-muted-foreground mt-2">RMM = media(RI × RC) — ISA Italia 200</p>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Rischio di individuazione pianificato</div>
                  <Badge className={`text-sm px-3 py-1 border ${indLabel?.color}`}>{indLabel?.label}</Badge>
                  <p className="text-xs text-muted-foreground mt-2">Inversamente proporzionale a RMM — ISA Italia 200.A34</p>
                </div>
              </div>
              {rmm === 3 && (
                <div className="flex items-center gap-2 mt-3 p-2 bg-red-100 border border-red-300 rounded text-sm text-red-700">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  RMM elevato: aumentare la portata delle procedure di revisione (ISA Italia 330.7).
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Aree di rischio */}
        <Card className="mb-4">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Aree di rischio significativo</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">Voci di bilancio o processi con rischio elevato (ISA 315.28)</p>
              </div>
              <Button size="sm" variant="outline" onClick={addArea}>
                <Plus className="w-4 h-4 mr-1" /> Aggiungi area
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {areeRischio.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Nessuna area di rischio aggiunta. Usa l'AI per identificarle automaticamente.</p>
            ) : (
              areeRischio.map((area, i) => (
                <div key={i} className="flex items-start gap-3 p-3 border border-border rounded-lg">
                  <div className="flex-1 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs">Area / Voce di bilancio</Label>
                        <Input className="mt-1 h-8 text-sm" value={area.area} onChange={e => updateArea(i, "area", e.target.value)} placeholder="es. Immobilizzazioni" />
                      </div>
                      <div>
                        <Label className="text-xs">Livello rischio</Label>
                        <Select value={area.livello} onValueChange={v => updateArea(i, "livello", v)}>
                          <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="basso">Basso</SelectItem>
                            <SelectItem value="medio">Medio</SelectItem>
                            <SelectItem value="alto">Alto</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <Input className="h-8 text-sm" value={area.descrizione} onChange={e => updateArea(i, "descrizione", e.target.value)} placeholder="Motivazione / descrizione rischio..." />
                  </div>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive flex-shrink-0" onClick={() => removeArea(i)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* AI */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-500" />
                Analisi AI dei rischi (ISA Italia 315)
              </CardTitle>
              <Button size="sm" variant="outline" onClick={() => analisiAi.mutate({ incaricoId })} disabled={analisiAi.isPending}>
                {analisiAi.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Sparkles className="w-4 h-4 mr-1" />}
                {modulo?.analisiAiRischi ? "Rigenera" : "Analizza rischi"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {analisiAi.isPending ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="w-4 h-4 animate-spin" /> Analisi in corso...
              </div>
            ) : modulo?.analisiAiRischi ? (
              <div className="prose prose-sm max-w-none text-foreground">
                <Streamdown>{modulo.analisiAiRischi}</Streamdown>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Genera un'analisi AI dei rischi principali basata sul contesto aziendale e sui documenti caricati.</p>
            )}
          </CardContent>
        </Card>

        {/* Azioni */}
        <div className="flex items-center justify-between">
          <Button variant="outline" onClick={() => navigate(`/incarichi/${incaricoId}/modulo/2`)}>
            <ChevronLeft className="w-4 h-4 mr-1" /> Modulo 2
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => handleSave(false)} disabled={save.isPending}>
              {save.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Salva bozza
            </Button>
            <Button onClick={() => { handleSave(true); navigate(`/incarichi/${incaricoId}/modulo/4`); }} disabled={save.isPending}>
              Completa e vai al Modulo 4 <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      </div>
    </RevisorLayout>
  );
}
