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
import { Sparkles, Save, TrendingUp, RefreshCw, CheckCircle2, Plus, Trash2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

const RISCHIO_BADGE: Record<string, string> = {
  basso:   "bg-green-100 text-green-800",
  medio:   "bg-yellow-100 text-yellow-800",
  alto:    "bg-orange-100 text-orange-800",
  critico: "bg-red-100 text-red-800",
};

export default function SchedaRicavi() {
  const { id } = useParams<{ id: string }>();
  const incaricoId = parseInt(id ?? "0");
  const [, navigate] = useLocation();

  const { data: scheda, refetch } = trpc.schedeControllo.getSchedaRicavi.useQuery({ incaricoId });
  const { data: incarico } = trpc.incarichi.get.useQuery({ id: incaricoId });
  const { data: cliente } = trpc.clienti.get.useQuery(
    { id: incarico?.clienteId ?? 0 },
    { enabled: !!incarico?.clienteId }
  );

  // Campi form
  const [ricaviTotali, setRicaviTotali] = useState("");
  const [ricaviAnnoPrec, setRicaviAnnoPrec] = useState("");
  const [categorieRicavi, setCategorieRicavi] = useState<{ categoria: string; importo: number; percentuale?: number; note?: string }[]>([]);
  const [completezzaVerificata, setCompletezzaVerificata] = useState(false);
  const [noteCompletezza, setNoteCompletezza] = useState("");
  const [cutOffVerificato, setCutOffVerificato] = useState(false);
  const [noteCutOff, setNoteCutOff] = useState("");
  const [periodoVerificaCutOff, setPeriodoVerificaCutOff] = useState("");
  const [anomalieRilevate, setAnomalieRilevate] = useState(false);
  const [descrizioneAnomalie, setDescrizioneAnomalie] = useState("");
  const [concentrazioneClienti, setConcentrazioneClienti] = useState(false);
  const [noteConcentrazione, setNoteConcentrazione] = useState("");
  const [ricaviNonRicorrenti, setRicaviNonRicorrenti] = useState("");
  const [noteRicaviNonRicorrenti, setNoteRicaviNonRicorrenti] = useState("");
  const [checklist, setChecklist] = useState<{ voce: string; completata: boolean; note: string }[]>([]);
  const [conclusioni, setConclusioni] = useState("");
  const [noteRevisore, setNoteRevisore] = useState("");
  const [stato, setStato] = useState<"da_iniziare" | "in_corso" | "completata">("da_iniziare");
  const [analisiAI, setAnalisiAI] = useState<any>(null);

  useEffect(() => {
    if (scheda) {
      const s = scheda as any;
      setRicaviTotali(s.ricaviTotali ? String(s.ricaviTotali) : "");
      setRicaviAnnoPrec(s.ricaviAnnoPrec ? String(s.ricaviAnnoPrec) : "");
      setCategorieRicavi((s.categorieRicavi as any[]) ?? []);
      setCompletezzaVerificata(s.completezzaVerificata ?? false);
      setNoteCompletezza(s.noteCompletezza ?? "");
      setCutOffVerificato(s.cutOffVerificato ?? false);
      setNoteCutOff(s.noteCutOff ?? "");
      setPeriodoVerificaCutOff(s.periodoVerificaCutOff ?? "");
      setAnomalieRilevate(s.anomalieRilevate ?? false);
      setDescrizioneAnomalie(s.descrizioneAnomalie ?? "");
      setConcentrazioneClienti(s.concentrazioneClienti ?? false);
      setNoteConcentrazione(s.noteConcentrazione ?? "");
      setRicaviNonRicorrenti(s.ricaviNonRicorrenti ? String(s.ricaviNonRicorrenti) : "");
      setNoteRicaviNonRicorrenti(s.noteRicaviNonRicorrenti ?? "");
      setChecklist((s.checklistIsa as any[]) ?? []);
      setConclusioni(s.conclusioni ?? "");
      setNoteRevisore(s.noteRevisore ?? "");
      setStato((s.stato as any) ?? "da_iniziare");
    }
  }, [scheda]);

  const salva = trpc.schedeControllo.saveSchedaRicavi.useMutation({ onSuccess: () => refetch() });
  const analizzaAI = trpc.schedeControllo.analizzaRicaviConAI.useMutation({
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
      ricaviTotali: ricaviTotali ? parseFloat(ricaviTotali) : undefined,
      ricaviAnnoPrec: ricaviAnnoPrec ? parseFloat(ricaviAnnoPrec) : undefined,
      categorieRicavi,
      completezzaVerificata,
      noteCompletezza,
      cutOffVerificato,
      noteCutOff,
      periodoVerificaCutOff,
      anomalieRilevate,
      descrizioneAnomalie,
      concentrazioneClienti,
      noteConcentrazione,
      ricaviNonRicorrenti: ricaviNonRicorrenti ? parseFloat(ricaviNonRicorrenti) : undefined,
      noteRicaviNonRicorrenti,
      checklistIsa: checklist,
      conclusioni,
      noteRevisore,
      stato,
    });
  };

  const handleAnalizzaAI = () => {
    analizzaAI.mutate({
      incaricoId,
      ricaviTotali: ricaviTotali ? parseFloat(ricaviTotali) : undefined,
      ricaviAnnoPrec: ricaviAnnoPrec ? parseFloat(ricaviAnnoPrec) : undefined,
      anomalieRilevate,
      concentrazioneClienti,
      ricaviNonRicorrenti: ricaviNonRicorrenti ? parseFloat(ricaviNonRicorrenti) : undefined,
    });
  };

  const variazioneRicavi = ricaviTotali && ricaviAnnoPrec && parseFloat(ricaviAnnoPrec) !== 0
    ? ((parseFloat(ricaviTotali) - parseFloat(ricaviAnnoPrec)) / Math.abs(parseFloat(ricaviAnnoPrec)) * 100).toFixed(1)
    : null;

  const aggiungiCategoria = () => {
    setCategorieRicavi([...categorieRicavi, { categoria: "", importo: 0 }]);
  };

  const rimuoviCategoria = (i: number) => {
    setCategorieRicavi(categorieRicavi.filter((_, idx) => idx !== i));
  };

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
              <div className="p-2 rounded-lg bg-teal-100 text-teal-700">
                <TrendingUp className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-xl font-bold">Scheda — Ricavi e Costi</h1>
                <p className="text-sm text-muted-foreground">{ragioneSociale} · ISA Italia 240/315</p>
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
              <Label className="text-xs">Ricavi correnti (€)</Label>
              <Input type="number" value={ricaviTotali} onChange={e => setRicaviTotali(e.target.value)} placeholder="0" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Ricavi anno prec. (€)</Label>
              <Input type="number" value={ricaviAnnoPrec} onChange={e => setRicaviAnnoPrec(e.target.value)} placeholder="0" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Variazione</Label>
              <div className={`h-10 flex items-center px-3 rounded-md border text-sm font-medium ${
                variazioneRicavi === null ? "text-muted-foreground" :
                parseFloat(variazioneRicavi) > 0 ? "text-green-700 bg-green-50" : "text-red-700 bg-red-50"
              }`}>
                {variazioneRicavi ? `${parseFloat(variazioneRicavi) > 0 ? "+" : ""}${variazioneRicavi}%` : "—"}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Ricavi non ricorrenti (€)</Label>
              <Input type="number" value={ricaviNonRicorrenti} onChange={e => setRicaviNonRicorrenti(e.target.value)} placeholder="0" />
            </div>
          </CardContent>
        </Card>

        {/* Categorie ricavi */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Categorie di Ricavo</CardTitle>
              <Button size="sm" variant="outline" onClick={aggiungiCategoria} className="h-7 text-xs gap-1">
                <Plus className="h-3 w-3" /> Aggiungi
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {categorieRicavi.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">
                Nessuna categoria inserita. Aggiungi le categorie di ricavo principali.
              </p>
            )}
            {categorieRicavi.map((cat, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={cat.categoria}
                  onChange={e => {
                    const updated = [...categorieRicavi];
                    updated[i] = { ...updated[i], categoria: e.target.value };
                    setCategorieRicavi(updated);
                  }}
                  placeholder="Categoria (es. Vendite prodotti, Prestazioni servizi...)"
                  className="flex-1 text-xs"
                />
                <Input
                  type="number"
                  value={cat.importo || ""}
                  onChange={e => {
                    const updated = [...categorieRicavi];
                    updated[i] = { ...updated[i], importo: parseFloat(e.target.value) || 0 };
                    setCategorieRicavi(updated);
                  }}
                  placeholder="Importo €"
                  className="w-32 text-xs"
                />
                <span className="text-xs text-muted-foreground w-12 text-right">
                  {ricaviTotali && parseFloat(ricaviTotali) > 0
                    ? `${((cat.importo / parseFloat(ricaviTotali)) * 100).toFixed(1)}%`
                    : "—"}
                </span>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => rimuoviCategoria(i)}>
                  <Trash2 className="h-3 w-3 text-red-500" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Verifiche specifiche */}
        <Card>
          <CardHeader><CardTitle className="text-sm">Verifiche Specifiche ISA 240/315</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3">
              <Checkbox checked={completezzaVerificata} onCheckedChange={v => setCompletezzaVerificata(!!v)} id="completezza" />
              <div className="flex-1">
                <Label htmlFor="completezza" className="text-sm cursor-pointer">Completezza ricavi verificata</Label>
                {completezzaVerificata && (
                  <Textarea value={noteCompletezza} onChange={e => setNoteCompletezza(e.target.value)}
                    placeholder="Procedure eseguite per la verifica di completezza..." className="mt-2 text-xs" />
                )}
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Checkbox checked={cutOffVerificato} onCheckedChange={v => setCutOffVerificato(!!v)} id="cutoff" />
              <div className="flex-1">
                <Label htmlFor="cutoff" className="text-sm cursor-pointer">Test di cut-off eseguito</Label>
                {cutOffVerificato && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Periodo verificato</Label>
                      <Input value={periodoVerificaCutOff} onChange={e => setPeriodoVerificaCutOff(e.target.value)}
                        placeholder="Es. Dic 2024 - Gen 2025" className="text-xs" />
                    </div>
                    <div>
                      <Label className="text-xs">Note</Label>
                      <Input value={noteCutOff} onChange={e => setNoteCutOff(e.target.value)}
                        placeholder="Risultati del test..." className="text-xs" />
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Checkbox checked={anomalieRilevate} onCheckedChange={v => setAnomalieRilevate(!!v)} id="anomalie" />
              <div className="flex-1">
                <Label htmlFor="anomalie" className="text-sm cursor-pointer text-orange-700">Anomalie rilevate nei ricavi</Label>
                {anomalieRilevate && (
                  <Textarea value={descrizioneAnomalie} onChange={e => setDescrizioneAnomalie(e.target.value)}
                    placeholder="Descrizione delle anomalie rilevate..." className="mt-2 text-xs border-orange-200" />
                )}
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Checkbox checked={concentrazioneClienti} onCheckedChange={v => setConcentrazioneClienti(!!v)} id="concentrazione" />
              <div className="flex-1">
                <Label htmlFor="concentrazione" className="text-sm cursor-pointer">Concentrazione clienti significativa</Label>
                {concentrazioneClienti && (
                  <Textarea value={noteConcentrazione} onChange={e => setNoteConcentrazione(e.target.value)}
                    placeholder="Principali clienti, % sul fatturato totale, rischio di dipendenza..." className="mt-2 text-xs" />
                )}
              </div>
            </div>
            {ricaviNonRicorrenti && parseFloat(ricaviNonRicorrenti) > 0 && (
              <div className="space-y-1">
                <Label className="text-xs">Note su ricavi non ricorrenti</Label>
                <Textarea value={noteRicaviNonRicorrenti} onChange={e => setNoteRicaviNonRicorrenti(e.target.value)}
                  placeholder="Natura e motivazione dei ricavi non ricorrenti..." className="text-xs" />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Analisi AI */}
        {analisiAI && (
          <Card className="border-teal-200 bg-teal-50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-teal-600" />
                Analisi AI — Ricavi
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
                        <CheckCircle2 className="h-3 w-3 text-teal-600 mt-0.5 shrink-0" />
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {analisiAI.conclusioni && (
                <p className="text-xs text-muted-foreground italic border-l-2 border-teal-300 pl-2">
                  {analisiAI.conclusioni}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Checklist ISA */}
        <Card>
          <CardHeader><CardTitle className="text-sm">Checklist ISA 240/315 — Ricavi</CardTitle></CardHeader>
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
                  id={`check-ric-${i}`}
                />
                <div className="flex-1">
                  <Label htmlFor={`check-ric-${i}`} className={`text-sm cursor-pointer ${item.completata ? "line-through text-muted-foreground" : ""}`}>
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
                placeholder="Conclusioni sull'area Ricavi e Costi..." className="min-h-[80px]" />
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
