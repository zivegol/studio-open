import { useState } from "react";
import RevisorLayout from "@/components/revisione/RevisorLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useParams, useLocation } from "wouter";
import { Loader2, Sparkles, ChevronLeft, CheckCircle, Download, FileText, Info } from "lucide-react";
import { toast } from "sonner";
import { Streamdown } from "streamdown";

const AREE_STANDARD = [
  { area: "Immobilizzazioni materiali e immateriali", isa: "ISA 500/501" },
  { area: "Rimanenze di magazzino", isa: "ISA 501" },
  { area: "Crediti verso clienti", isa: "ISA 505" },
  { area: "Disponibilità liquide", isa: "ISA 500" },
  { area: "Debiti verso fornitori", isa: "ISA 500" },
  { area: "Patrimonio netto", isa: "ISA 500" },
  { area: "Ricavi e costi operativi", isa: "ISA 240/315" },
  { area: "Continuità aziendale", isa: "ISA 570" },
];

export default function Modulo5Piano() {
  const params = useParams<{ id: string }>();
  const incaricoId = parseInt(params.id);
  const [, navigate] = useLocation();

  const { data: modulo, refetch } = trpc.moduli.piano.get.useQuery({ incaricoId });
  const genera = trpc.moduli.piano.generaConAi.useMutation({
    onSuccess: () => { refetch(); toast.success("Piano generato"); },
    onError: (e: any) => toast.error(e.message),
  });
  const save = trpc.moduli.piano.save.useMutation({
    onSuccess: () => { refetch(); toast.success("Salvato"); },
    onError: (e: any) => toast.error(e.message),
  });

  const [noteGenerali, setNoteGenerali] = useState("");

  const pianoAree = (modulo?.areeRevisione as any[]) || [];

  function handleSave(completato = false) {
    save.mutate({
      incaricoId,
      completato,
    });
  }

  return (
    <RevisorLayout incaricoId={incaricoId} moduloAttivo={5}>
      <div className="p-6 max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="outline" className="text-xs">ISA Italia 300</Badge>
              {modulo?.completato && <Badge className="bg-emerald-100 text-emerald-700 text-xs">Completato</Badge>}
            </div>
            <h1 className="text-2xl font-bold text-foreground">Modulo 5 — Piano di revisione</h1>
            <p className="text-muted-foreground mt-1 text-sm">Piano di revisione personalizzato basato su rischi e materialità identificati</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => toast.info("Funzione di esportazione PDF in arrivo nella prossima versione.")}
          >
            <Download className="w-4 h-4 mr-1" />
            Esporta fascicolo
          </Button>
        </div>

        {/* Info */}
        <div className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg mb-6">
          <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-blue-700">
            Il piano di revisione (ISA Italia 300) descrive le procedure pianificate per rispondere ai rischi identificati nel Modulo 3. Genera il piano con AI per ottenere procedure personalizzate per ogni area.
          </p>
        </div>

        {/* Genera piano AI */}
        <Card className="mb-4">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-500" />
                Piano di revisione AI (ISA Italia 300/330)
              </CardTitle>
              <Button
                onClick={() => genera.mutate({ incaricoId })}
                disabled={genera.isPending}
              >
                {genera.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Sparkles className="w-4 h-4 mr-1" />}
                {modulo?.sintesiPianoAi ? "Rigenera piano" : "Genera piano"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {genera.isPending ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
                <Loader2 className="w-4 h-4 animate-spin" /> Generazione piano in corso...
              </div>
            ) : modulo?.sintesiPianoAi ? (
              <div className="prose prose-sm max-w-none text-foreground">
                <Streamdown>{modulo.sintesiPianoAi}</Streamdown>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Clicca "Genera piano" per creare automaticamente un piano di revisione personalizzato basato sui rischi identificati nel Modulo 3 e sulla materialità del Modulo 4.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Aree di revisione pianificate */}
        {pianoAree.length > 0 && (
          <Card className="mb-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Procedure per area di rischio</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {pianoAree.map((area: any, i: number) => (
                <div key={i} className={`p-3 rounded-lg border ${area.livelloRischio === "alto" ? "border-red-200 bg-red-50/30" : area.livelloRischio === "medio" ? "border-amber-200 bg-amber-50/30" : "border-emerald-200 bg-emerald-50/30"}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm">{area.area}</span>
                    <div className="flex items-center gap-2">
                      {area.isa && <Badge variant="outline" className="text-xs">{area.isa}</Badge>}
                      <Badge className={`text-xs ${area.livelloRischio === "alto" ? "bg-red-100 text-red-700" : area.livelloRischio === "medio" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                        {area.livelloRischio}
                      </Badge>
                    </div>
                  </div>
                  {area.procedure && (
                    <ul className="text-xs text-muted-foreground space-y-1">
                      {(area.procedure as string[]).map((p: string, j: number) => (
                        <li key={j} className="flex items-start gap-1.5">
                          <span className="text-primary mt-0.5">•</span>
                          <span>{p}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Aree standard (se piano non ancora generato) */}
        {pianoAree.length === 0 && (
          <Card className="mb-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Aree standard di revisione</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2">
                {AREE_STANDARD.map((a, i) => (
                  <div key={i} className="flex items-center gap-2 p-2 border border-border rounded text-sm">
                    <FileText className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <div>
                      <div className="text-foreground">{a.area}</div>
                      <div className="text-xs text-muted-foreground">{a.isa}</div>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-3">Genera il piano AI per ottenere procedure specifiche per ciascuna area.</p>
            </CardContent>
          </Card>
        )}

        {/* Note generali */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Note generali al piano</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              rows={4}
              value={noteGenerali}
              onChange={e => setNoteGenerali(e.target.value)}
              placeholder="Inserisci note generali, considerazioni particolari o istruzioni per il team di revisione..."
            />
          </CardContent>
        </Card>

        {/* Riepilogo fascicolo */}
        {modulo?.sintesiPianoAi && modulo?.completato && (
          <Card className="mb-6 border-emerald-200 bg-emerald-50/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2 text-emerald-700">
                <CheckCircle className="w-4 h-4" />
                Fascicolo completato
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-emerald-700">Tutti i moduli sono stati completati. Puoi esportare il fascicolo completo in PDF.</p>
            </CardContent>
          </Card>
        )}

        {/* Azioni */}
        <div className="flex items-center justify-between">
          <Button variant="outline" onClick={() => navigate(`/incarichi/${incaricoId}/modulo/4`)}>
            <ChevronLeft className="w-4 h-4 mr-1" /> Modulo 4
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => handleSave(false)} disabled={save.isPending}>
              {save.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Salva bozza
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={() => handleSave(true)}
              disabled={save.isPending}
            >
              <CheckCircle className="w-4 h-4 mr-1" />
              Completa fascicolo
            </Button>
          </div>
        </div>
      </div>
    </RevisorLayout>
  );
}
