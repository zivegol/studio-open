import { useState } from "react";
import RevisorLayout from "@/components/revisione/RevisorLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useParams, useLocation } from "wouter";
import { Loader2, Sparkles, ChevronRight, CheckCircle, AlertTriangle, Info } from "lucide-react";
import { toast } from "sonner";
import { Streamdown } from "streamdown";

const CHECKLIST = [
  { key: "indipendenzaVerificata", label: "Indipendenza verificata (art. 10 D.Lgs. 39/2010)", isa: "ISA 220.11" },
  { key: "competenzaVerificata", label: "Competenza professionale adeguata per il settore", isa: "ISA 220.14" },
  { key: "integritaManagementVerificata", label: "Integrità del management valutata", isa: "ISA 210.A14" },
  { key: "rischioIncaricoPrecedente", label: "Rischi da incarico precedente analizzati (se continuazione)", isa: "ISA 220.23" },
  { key: "conflittiInteresseVerificati", label: "Conflitti di interesse verificati", isa: "ISA 220.11" },
  { key: "onorarioDefinito", label: "Onorario definito e non condizionato", isa: "ISA 210.A51" },
  { key: "letteraIncaricoFirmata", label: "Lettera di incarico firmata (art. 10 D.Lgs. 39/2010)", isa: "ISA 210.10" },
];

export default function Modulo1Accettazione() {
  const params = useParams<{ id: string }>();
  const incaricoId = parseInt(params.id);
  const [, navigate] = useLocation();

  const { data: modulo, refetch } = trpc.moduli.accettazione.get.useQuery({ incaricoId });
  const save = trpc.moduli.accettazione.save.useMutation({
    onSuccess: () => { refetch(); toast.success("Salvato"); },
    onError: e => toast.error(e.message),
  });
  const analisiAi = trpc.moduli.accettazione.analisiAi.useMutation({
    onSuccess: () => { refetch(); toast.success("Analisi AI completata"); },
    onError: e => toast.error(e.message),
  });

  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [esito, setEsito] = useState<string>("");
  const [motivazione, setMotivazione] = useState("");

  // Inizializza dai dati salvati
  const checkValues: Record<string, boolean> = {};
  CHECKLIST.forEach(c => {
    checkValues[c.key] = checks[c.key] !== undefined ? checks[c.key] : !!(modulo as any)?.[c.key];
  });

  const tuttiCompletati = CHECKLIST.every(c => checkValues[c.key]);

  function handleSave(completato = false) {
    save.mutate({
      incaricoId,
      ...Object.fromEntries(CHECKLIST.map(c => [c.key, checkValues[c.key]])) as any,
      esito: (esito || modulo?.esito) as any,
      motivazioneEsito: motivazione || modulo?.motivazioneEsito || undefined,
      completato,
    });
  }

  return (
    <RevisorLayout incaricoId={incaricoId} moduloAttivo={1}>
      <div className="p-6 max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="outline" className="text-xs">ISA Italia 210/220</Badge>
              {modulo?.completato && <Badge className="bg-emerald-100 text-emerald-700 text-xs">Completato</Badge>}
            </div>
            <h1 className="text-2xl font-bold text-foreground">Modulo 1 — Accettazione incarico</h1>
            <p className="text-muted-foreground mt-1 text-sm">Valutazione preliminare per l'accettazione o continuazione dell'incarico</p>
          </div>
        </div>

        {/* Info box */}
        <div className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg mb-6">
          <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-blue-700">
            Secondo ISA Italia 210 e 220, il revisore deve valutare se accettare o continuare l'incarico verificando indipendenza, competenza e integrità del management prima di procedere.
          </p>
        </div>

        {/* Checklist */}
        <Card className="mb-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Checklist di accettazione</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {CHECKLIST.map(item => (
              <div key={item.key} className="flex items-start gap-3 p-3 rounded-lg border border-border hover:bg-muted/30 transition-colors">
                <Checkbox
                  id={item.key}
                  checked={checkValues[item.key]}
                  onCheckedChange={v => setChecks(prev => ({ ...prev, [item.key]: !!v }))}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <Label htmlFor={item.key} className="text-sm font-medium cursor-pointer">{item.label}</Label>
                  <div className="text-xs text-muted-foreground mt-0.5">{item.isa}</div>
                </div>
                {checkValues[item.key] && <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Esito */}
        <Card className="mb-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Esito della valutazione</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Decisione</Label>
              <Select value={esito || modulo?.esito || ""} onValueChange={setEsito}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Seleziona esito..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="accettato">✅ Incarico accettato</SelectItem>
                  <SelectItem value="sospeso">⏸ In valutazione / sospeso</SelectItem>
                  <SelectItem value="rifiutato">❌ Incarico rifiutato</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Motivazione / Note</Label>
              <Textarea
                className="mt-1"
                rows={3}
                placeholder="Inserisci eventuali note o motivazioni..."
                value={motivazione || modulo?.motivazioneEsito || ""}
                onChange={e => setMotivazione(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        {/* AI Analysis */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-500" />
                Analisi AI (ISA Italia 210/220)
              </CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={() => analisiAi.mutate({ incaricoId })}
                disabled={analisiAi.isPending}
              >
                {analisiAi.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Sparkles className="w-4 h-4 mr-1" />}
                {modulo?.analisiAi ? "Rigenera" : "Analizza"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {analisiAi.isPending ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="w-4 h-4 animate-spin" /> Analisi in corso...
              </div>
            ) : modulo?.analisiAi ? (
              <div className="prose prose-sm max-w-none text-foreground">
                <Streamdown>{modulo.analisiAi}</Streamdown>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Clicca "Analizza" per ottenere una valutazione AI dell'incarico basata sui documenti caricati e sul profilo del cliente.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Azioni */}
        <div className="flex items-center justify-between">
          <Button variant="outline" onClick={() => handleSave(false)} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
            Salva bozza
          </Button>
          <Button
            onClick={() => { handleSave(true); navigate(`/incarichi/${incaricoId}/modulo/2`); }}
            disabled={save.isPending}
          >
            Completa e vai al Modulo 2 <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </div>
    </RevisorLayout>
  );
}
