import React, { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import RevisorLayout from "@/components/revisione/RevisorLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Save, Shield, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

const RISCHIO_BADGE: Record<string, string> = {
  basso:   "bg-green-100 text-green-800",
  medio:   "bg-yellow-100 text-yellow-800",
  alto:    "bg-orange-100 text-orange-800",
  critico: "bg-red-100 text-red-800",
};

export default function SchedaPatrimonioNetto() {
  const { id } = useParams<{ id: string }>();
  const incaricoId = parseInt(id ?? "0");
  const [, navigate] = useLocation();

  const { data: scheda, refetch } = trpc.schedeControllo.getSchedaPatrimonioNetto.useQuery({ incaricoId });
  const { data: incarico } = trpc.incarichi.get.useQuery({ id: incaricoId });
  const { data: cliente } = trpc.clienti.get.useQuery(
    { id: incarico?.clienteId ?? 0 },
    { enabled: !!incarico?.clienteId }
  );

  // Campi form
  const [totalePN, setTotalePN] = useState("");
  const [pnAnnoPrec, setPnAnnoPrec] = useState("");
  const [utileEsercizio, setUtileEsercizio] = useState("");
  const [capitalesociale, setCapitalesociale] = useState("");
  const [riservaLegale, setRiservaLegale] = useState("");
  const [aumentoCapitale, setAumentoCapitale] = useState(false);
  const [noteAumentoCapitale, setNoteAumentoCapitale] = useState("");
  const [distribuzioneUtili, setDistribuzioneUtili] = useState(false);
  const [importoDividendi, setImportoDividendi] = useState("");
  const [noteDividendi, setNoteDividendi] = useState("");
  const [coperturaPerdite, setCoperturaPerdite] = useState(false);
  const [noteCoperturaPerdite, setNoteCoperturaPerdite] = useState("");
  const [checklist, setChecklist] = useState<{ voce: string; completata: boolean; note: string }[]>([]);
  const [conclusioni, setConclusioni] = useState("");
  const [noteRevisore, setNoteRevisore] = useState("");
  const [stato, setStato] = useState<"da_iniziare" | "in_corso" | "completata">("da_iniziare");
  const [analisiAI, setAnalisiAI] = useState<any>(null);

  useEffect(() => {
    if (scheda) {
      const s = scheda as any;
      setTotalePN(s.totalePN ? String(s.totalePN) : "");
      setPnAnnoPrec(s.pnAnnoPrec ? String(s.pnAnnoPrec) : "");
      setUtileEsercizio(s.utileEsercizio ? String(s.utileEsercizio) : "");
      setCapitalesociale(s.capitalesociale ? String(s.capitalesociale) : "");
      setRiservaLegale(s.riservaLegale ? String(s.riservaLegale) : "");
      setAumentoCapitale(s.aumentoCapitale ?? false);
      setNoteAumentoCapitale(s.noteAumentoCapitale ?? "");
      setDistribuzioneUtili(s.distribuzioneUtili ?? false);
      setImportoDividendi(s.importoDividendi ? String(s.importoDividendi) : "");
      setNoteDividendi(s.noteDividendi ?? "");
      setCoperturaPerdite(s.coperturaPerdite ?? false);
      setNoteCoperturaPerdite(s.noteCoperturaPerdite ?? "");
      setChecklist((s.checklistIsa as any[]) ?? []);
      setConclusioni(s.conclusioni ?? "");
      setNoteRevisore(s.noteRevisore ?? "");
      setStato((s.stato as any) ?? "da_iniziare");
    }
  }, [scheda]);

  const salva = trpc.schedeControllo.saveSchedaPatrimonioNetto.useMutation({ onSuccess: () => refetch() });
  const analizzaAI = trpc.schedeControllo.analizzaPatrimonioNettoConAI.useMutation({
    onSuccess: (data) => {
      setAnalisiAI(data);
      if (data.conclusioni) setConclusioni(data.conclusioni);
      if (data.rischioValutazione) {
        salva.mutate({ incaricoId, rischioValutazione: data.rischioValutazione, conclusioni: data.conclusioni });
      }
    },
  });

  const handleSalva = () => {
    salva.mutate({
      incaricoId,
      totalePN: totalePN ? parseFloat(totalePN) : undefined,
      pnAnnoPrec: pnAnnoPrec ? parseFloat(pnAnnoPrec) : undefined,
      utileEsercizio: utileEsercizio ? parseFloat(utileEsercizio) : undefined,
      capitalesociale: capitalesociale ? parseFloat(capitalesociale) : undefined,
      riservaLegale: riservaLegale ? parseFloat(riservaLegale) : undefined,
      aumentoCapitale,
      noteAumentoCapitale,
      distribuzioneUtili,
      importoDividendi: importoDividendi ? parseFloat(importoDividendi) : undefined,
      noteDividendi,
      coperturaPerdite,
      noteCoperturaPerdite,
      checklistIsa: checklist,
      conclusioni,
      noteRevisore,
      stato,
    });
  };

  const handleAnalizzaAI = () => {
    analizzaAI.mutate({
      incaricoId,
      totalePN: totalePN ? parseFloat(totalePN) : undefined,
      pnAnnoPrec: pnAnnoPrec ? parseFloat(pnAnnoPrec) : undefined,
      utileEsercizio: utileEsercizio ? parseFloat(utileEsercizio) : undefined,
      aumentoCapitale,
      distribuzioneUtili,
    });
  };

  const variazionePN = totalePN && pnAnnoPrec && parseFloat(pnAnnoPrec) !== 0
    ? ((parseFloat(totalePN) - parseFloat(pnAnnoPrec)) / Math.abs(parseFloat(pnAnnoPrec)) * 100).toFixed(1)
    : null;

  const ragioneSociale = cliente?.ragioneSociale ?? `Incarico #${incaricoId}`;

  return (
    <RevisorLayout>
      <div className="max-w-4xl mx-auto space-y-6 p-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <button
              onClick={() => navigate(`/incarichi/${incaricoId}/piano-controlli`)}
              className="text-xs text-muted-foreground hover:text-primary mb-1 flex items-center gap-1"
            >
              ← Piano dei controlli
            </button>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-indigo-100 text-indigo-700">
                <Shield className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-xl font-bold">Scheda — Patrimonio Netto</h1>
                <p className="text-sm text-muted-foreground">{ragioneSociale} · ISA Italia 500</p>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleAnalizzaAI} disabled={analizzaAI.isPending} className="gap-2">
              {analizzaAI.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Analisi AI
            </Button>
            <Button onClick={handleSalva} disabled={salva.isPending} className="gap-2">
              <Save className="h-4 w-4" />
              Salva
            </Button>
          </div>
        </div>

        {/* Dati quantitativi */}
        <Card>
          <CardHeader><CardTitle className="text-sm">Dati Quantitativi</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label className="text-xs">Capitale Sociale (€)</Label>
              <Input type="number" value={capitalesociale} onChange={e => setCapitalesociale(e.target.value)} placeholder="0" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Riserva Legale (€)</Label>
              <Input type="number" value={riservaLegale} onChange={e => setRiservaLegale(e.target.value)} placeholder="0" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Utile Esercizio (€)</Label>
              <Input type="number" value={utileEsercizio} onChange={e => setUtileEsercizio(e.target.value)} placeholder="0" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Totale PN corrente (€)</Label>
              <Input type="number" value={totalePN} onChange={e => setTotalePN(e.target.value)} placeholder="0" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Totale PN anno prec. (€)</Label>
              <Input type="number" value={pnAnnoPrec} onChange={e => setPnAnnoPrec(e.target.value)} placeholder="0" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Variazione PN</Label>
              <div className={`h-10 flex items-center px-3 rounded-md border text-sm font-medium ${
                variazionePN === null ? "text-muted-foreground" :
                parseFloat(variazionePN) > 0 ? "text-green-700 bg-green-50" : "text-red-700 bg-red-50"
              }`}>
                {variazionePN ? `${parseFloat(variazionePN) > 0 ? "+" : ""}${variazionePN}%` : "—"}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Variazioni significative */}
        <Card>
          <CardHeader><CardTitle className="text-sm">Variazioni e Operazioni Straordinarie</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3">
              <Checkbox checked={aumentoCapitale} onCheckedChange={v => setAumentoCapitale(!!v)} id="aumento" />
              <div className="flex-1">
                <Label htmlFor="aumento" className="text-sm cursor-pointer">Aumento di capitale nell'esercizio</Label>
                {aumentoCapitale && (
                  <Textarea value={noteAumentoCapitale} onChange={e => setNoteAumentoCapitale(e.target.value)}
                    placeholder="Note: importo, tipo (gratuito/oneroso), delibera assembleare..." className="mt-2 text-xs" />
                )}
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Checkbox checked={distribuzioneUtili} onCheckedChange={v => setDistribuzioneUtili(!!v)} id="dividendi" />
              <div className="flex-1">
                <Label htmlFor="dividendi" className="text-sm cursor-pointer">Distribuzione utili / dividendi</Label>
                {distribuzioneUtili && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Importo dividendi (€)</Label>
                      <Input type="number" value={importoDividendi} onChange={e => setImportoDividendi(e.target.value)} placeholder="0" />
                    </div>
                    <div>
                      <Label className="text-xs">Note</Label>
                      <Input value={noteDividendi} onChange={e => setNoteDividendi(e.target.value)} placeholder="Delibera assembleare..." />
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Checkbox checked={coperturaPerdite} onCheckedChange={v => setCoperturaPerdite(!!v)} id="perdite" />
              <div className="flex-1">
                <Label htmlFor="perdite" className="text-sm cursor-pointer">Copertura perdite pregresse</Label>
                {coperturaPerdite && (
                  <Textarea value={noteCoperturaPerdite} onChange={e => setNoteCoperturaPerdite(e.target.value)}
                    placeholder="Modalità di copertura, importo, delibera..." className="mt-2 text-xs" />
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Analisi AI */}
        {analisiAI && (
          <Card className="border-indigo-200 bg-indigo-50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-indigo-600" />
                Analisi AI — Patrimonio Netto
                <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${RISCHIO_BADGE[analisiAI.rischioValutazione] ?? ""}`}>
                  Rischio {analisiAI.rischioValutazione}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {analisiAI.areePrincipali?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold mb-1">Aree principali:</p>
                  <div className="flex flex-wrap gap-1">
                    {analisiAI.areePrincipali.map((a: string, i: number) => (
                      <Badge key={i} variant="secondary" className="text-xs">{a}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {analisiAI.procedurePrioritarie?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold mb-1">Procedure prioritarie:</p>
                  <ul className="space-y-1">
                    {analisiAI.procedurePrioritarie.map((p: string, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-xs">
                        <CheckCircle2 className="h-3 w-3 text-indigo-600 mt-0.5 shrink-0" />
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {analisiAI.conclusioni && (
                <p className="text-xs text-muted-foreground italic border-l-2 border-indigo-300 pl-2">
                  {analisiAI.conclusioni}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Checklist ISA */}
        <Card>
          <CardHeader><CardTitle className="text-sm">Checklist ISA 500 — Patrimonio Netto</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {checklist.map((item, i) => (
              <div key={i} className="flex items-start gap-3">
                <Checkbox
                  checked={item.completata}
                  onCheckedChange={v => {
                    const updated = [...checklist];
                    updated[i] = { ...updated[i], completata: !!v };
                    setChecklist(updated);
                  }}
                  id={`check-pn-${i}`}
                />
                <div className="flex-1">
                  <Label htmlFor={`check-pn-${i}`} className={`text-sm cursor-pointer ${item.completata ? "line-through text-muted-foreground" : ""}`}>
                    {item.voce}
                  </Label>
                  <Input
                    value={item.note}
                    onChange={e => {
                      const updated = [...checklist];
                      updated[i] = { ...updated[i], note: e.target.value };
                      setChecklist(updated);
                    }}
                    placeholder="Note..."
                    className="mt-1 text-xs h-7"
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Conclusioni */}
        <Card>
          <CardHeader><CardTitle className="text-sm">Conclusioni e Stato</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs">Conclusioni revisore</Label>
              <Textarea value={conclusioni} onChange={e => setConclusioni(e.target.value)}
                placeholder="Conclusioni sull'area Patrimonio Netto..." className="min-h-[80px]" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Note aggiuntive</Label>
              <Textarea value={noteRevisore} onChange={e => setNoteRevisore(e.target.value)}
                placeholder="Note interne del revisore..." className="min-h-[60px]" />
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs">Stato scheda:</Label>
              {(["da_iniziare", "in_corso", "completata"] as const).map(s => (
                <button key={s} onClick={() => setStato(s)}
                  className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                    stato === s ? "bg-primary text-primary-foreground border-primary" : "border-muted text-muted-foreground hover:border-primary"
                  }`}>
                  {s === "da_iniziare" ? "Da iniziare" : s === "in_corso" ? "In corso" : "Completata"}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {salva.isSuccess && (
          <div className="flex items-center gap-2 text-green-700 text-sm bg-green-50 border border-green-200 rounded-lg px-4 py-2">
            <CheckCircle2 className="h-4 w-4" />
            Scheda salvata correttamente
          </div>
        )}
      </div>
    </RevisorLayout>
  );
}
