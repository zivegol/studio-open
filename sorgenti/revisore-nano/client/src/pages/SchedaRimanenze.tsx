import React, { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import RevisorLayout from "@/components/revisione/RevisorLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";
import {
  ChevronLeft, Package, Sparkles, Save, CheckCircle2, AlertTriangle,
  AlertCircle, Info, Plus, Trash2, BarChart3, ClipboardList,
} from "lucide-react";

// ─── TIPI ─────────────────────────────────────────────────────────────────────

interface CategoriaRimanenza {
  categoria: string;
  valore: number;
  percObsolescenza?: number;
  note?: string;
}

interface ChecklistItem {
  voce: string;
  completata: boolean;
  note?: string;
}

const RISCHIO_CONFIG = {
  basso: { label: "Basso", color: "text-green-700", bg: "bg-green-50 border-green-200", badge: "bg-green-100 text-green-800" },
  medio: { label: "Medio", color: "text-amber-700", bg: "bg-amber-50 border-amber-200", badge: "bg-amber-100 text-amber-800" },
  alto: { label: "Alto", color: "text-orange-700", bg: "bg-orange-50 border-orange-200", badge: "bg-orange-100 text-orange-800" },
  critico: { label: "Critico", color: "text-red-700", bg: "bg-red-50 border-red-200", badge: "bg-red-100 text-red-800" },
};

// ─── COMPONENTE PRINCIPALE ────────────────────────────────────────────────────

export default function SchedaRimanenze() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const incaricoId = parseInt(id ?? "0");

  // Dati scheda
  const [metodo, setMetodo] = useState<string>("");
  const [metodoNote, setMetodoNote] = useState("");
  const [conteggioEseguito, setConteggioEseguito] = useState(false);
  const [dataConteggio, setDataConteggio] = useState("");
  const [noteConteggio, setNoteConteggio] = useState("");
  const [valoreContabile, setValoreContabile] = useState("");
  const [valoreConteggio, setValoreConteggio] = useState("");
  const [percObsolescenza, setPercObsolescenza] = useState("");
  const [fondoObsolescenza, setFondoObsolescenza] = useState("");
  const [noteObsolescenza, setNoteObsolescenza] = useState("");
  const [categorie, setCategorie] = useState<CategoriaRimanenza[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [conclusioni, setConclusioni] = useState("");
  const [rischio, setRischio] = useState<string>("medio");
  const [noteRevisore, setNoteRevisore] = useState("");
  const [stato, setStato] = useState<string>("da_iniziare");
  const [analisiAI, setAnalisiAI] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<"dati" | "checklist" | "categorie" | "conclusioni">("dati");

  // Queries
  const { data: scheda, isLoading } = trpc.schedeControllo.getSchedaRimanenze.useQuery(
    { incaricoId },
    { enabled: incaricoId > 0 }
  );
  const { data: incarico } = trpc.incarichi.get.useQuery(
    { id: incaricoId },
    { enabled: incaricoId > 0 }
  );

  // Mutations
  const salvaMutation = trpc.schedeControllo.salvaSchedaRimanenze.useMutation({
    onSuccess: () => toast.success("Scheda rimanenze salvata"),
    onError: () => toast.error("Errore nel salvataggio"),
  });
  const analizzaMutation = trpc.schedeControllo.analizzaRimanenzeConAI.useMutation({
    onSuccess: (data) => {
      setAnalisiAI(data);
      if (data.rischioValutazione) setRischio(data.rischioValutazione);
      if (data.conclusioni) setConclusioni(data.conclusioni);
      toast.success("Analisi AI completata");
    },
    onError: () => toast.error("Errore nell'analisi AI"),
  });

  // Carica dati esistenti
  useEffect(() => {
    if (!scheda) return;
    if (scheda.metodoValorizzazione) setMetodo(scheda.metodoValorizzazione);
    if (scheda.metodoValorizzazioneNote) setMetodoNote(scheda.metodoValorizzazioneNote);
    setConteggioEseguito(scheda.conteggioFisicoEseguito ?? false);
    if (scheda.dataConteggio) setDataConteggio(String(scheda.dataConteggio));
    if (scheda.noteConteggio) setNoteConteggio(scheda.noteConteggio);
    if (scheda.valoreContabile) setValoreContabile(scheda.valoreContabile);
    if (scheda.valoreConteggio) setValoreConteggio(scheda.valoreConteggio);
    if (scheda.percentualeObsolescenza) setPercObsolescenza(scheda.percentualeObsolescenza);
    if (scheda.fondoObsolescenza) setFondoObsolescenza(scheda.fondoObsolescenza);
    if (scheda.noteObsolescenza) setNoteObsolescenza(scheda.noteObsolescenza);
    if (scheda.categorieRimanenze?.length) setCategorie(scheda.categorieRimanenze as CategoriaRimanenza[]);
    if (scheda.checklistIsa?.length) setChecklist(scheda.checklistIsa as ChecklistItem[]);
    if (scheda.conclusioni) setConclusioni(scheda.conclusioni);
    if (scheda.rischioValutazione) setRischio(scheda.rischioValutazione);
    if (scheda.noteRevisore) setNoteRevisore(scheda.noteRevisore);
    if (scheda.stato) setStato(scheda.stato);
  }, [scheda]);

  const differenza = valoreContabile && valoreConteggio
    ? parseFloat(valoreConteggio) - parseFloat(valoreContabile)
    : null;

  const checklistCompletate = checklist.filter(c => c.completata).length;

  function salva() {
    salvaMutation.mutate({
      incaricoId,
      metodoValorizzazione: metodo as any,
      metodoValorizzazioneNote: metodoNote,
      conteggioFisicoEseguito: conteggioEseguito,
      dataConteggio: dataConteggio || undefined,
      noteConteggio,
      valoreContabile: valoreContabile || undefined,
      valoreConteggio: valoreConteggio || undefined,
      percentualeObsolescenza: percObsolescenza || undefined,
      fondoObsolescenza: fondoObsolescenza || undefined,
      noteObsolescenza,
      categorieRimanenze: categorie,
      checklistIsa: checklist,
      conclusioni,
      rischioValutazione: rischio as any,
      noteRevisore,
      stato: stato as any,
    });
  }

  function aggiungiCategoria() {
    setCategorie(prev => [...prev, { categoria: "", valore: 0, percObsolescenza: 0, note: "" }]);
  }

  function rimuoviCategoria(i: number) {
    setCategorie(prev => prev.filter((_, idx) => idx !== i));
  }

  function aggiornaCategoria(i: number, campo: keyof CategoriaRimanenza, valore: any) {
    setCategorie(prev => prev.map((c, idx) => idx === i ? { ...c, [campo]: valore } : c));
  }

  function toggleChecklist(i: number) {
    setChecklist(prev => prev.map((item, idx) => idx === i ? { ...item, completata: !item.completata } : item));
  }

  function aggiornaChecklistNote(i: number, note: string) {
    setChecklist(prev => prev.map((item, idx) => idx === i ? { ...item, note } : item));
  }

  if (isLoading) {
    return (
      <RevisorLayout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      </RevisorLayout>
    );
  }

  const rischioConf = RISCHIO_CONFIG[rischio as keyof typeof RISCHIO_CONFIG] ?? RISCHIO_CONFIG.medio;

  return (
    <RevisorLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/incarichi/${incaricoId}`)}>
            <ChevronLeft className="w-4 h-4 mr-1" /> Indietro
          </Button>
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-amber-600" />
            <h1 className="text-xl font-bold">Scheda Rimanenze</h1>
            {incarico && <span className="text-slate-500 text-sm">— {incarico.cliente?.ragioneSociale ?? ""} {incarico.annoEsercizio}</span>}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Badge className={rischioConf.badge}>Rischio {rischioConf.label}</Badge>
            <Badge variant="outline">{checklistCompletate}/{checklist.length} controlli</Badge>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b">
          {(["dati", "checklist", "categorie", "conclusioni"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium capitalize transition-colors ${activeTab === tab ? "border-b-2 border-blue-600 text-blue-600" : "text-slate-500 hover:text-slate-700"}`}
            >
              {tab === "dati" ? "Dati Generali" : tab === "checklist" ? "Checklist ISA 501" : tab === "categorie" ? "Categorie" : "Conclusioni"}
            </button>
          ))}
        </div>

        {/* Tab: Dati Generali */}
        {activeTab === "dati" && (
          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Metodo di Valorizzazione</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Metodo (OIC 13)</Label>
                    <Select value={metodo} onValueChange={setMetodo}>
                      <SelectTrigger><SelectValue placeholder="Seleziona metodo" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cmp">Costo Medio Ponderato</SelectItem>
                        <SelectItem value="fifo">FIFO (First In First Out)</SelectItem>
                        <SelectItem value="lifo">LIFO (Last In First Out)</SelectItem>
                        <SelectItem value="specifico">Costo Specifico</SelectItem>
                        <SelectItem value="altro">Altro</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Stato scheda</Label>
                    <Select value={stato} onValueChange={setStato}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="da_iniziare">Da iniziare</SelectItem>
                        <SelectItem value="in_corso">In corso</SelectItem>
                        <SelectItem value="completata">Completata</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label>Note sul metodo / variazioni rispetto anno precedente</Label>
                  <Textarea value={metodoNote} onChange={e => setMetodoNote(e.target.value)} rows={2} placeholder="Indicare eventuali variazioni del metodo rispetto all'anno precedente (ISA 501.13)" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Conteggio Fisico (ISA 501.4)</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  <Checkbox id="conteggio" checked={conteggioEseguito} onCheckedChange={v => setConteggioEseguito(!!v)} />
                  <Label htmlFor="conteggio">Conteggio fisico eseguito o esaminati i verbali</Label>
                </div>
                {conteggioEseguito && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Data conteggio</Label>
                      <Input type="date" value={dataConteggio} onChange={e => setDataConteggio(e.target.value)} />
                    </div>
                    <div />
                    <div className="col-span-2">
                      <Label>Note sul conteggio</Label>
                      <Textarea value={noteConteggio} onChange={e => setNoteConteggio(e.target.value)} rows={2} placeholder="Modalità, campionamento, osservazioni" />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Valori Contabili e Verifica</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Valore contabile bilancio (€)</Label>
                    <Input type="number" value={valoreContabile} onChange={e => setValoreContabile(e.target.value)} placeholder="0,00" />
                  </div>
                  <div>
                    <Label>Valore da conteggio fisico (€)</Label>
                    <Input type="number" value={valoreConteggio} onChange={e => setValoreConteggio(e.target.value)} placeholder="0,00" />
                  </div>
                </div>
                {differenza !== null && (
                  <div className={`p-3 rounded-lg border text-sm font-medium ${Math.abs(differenza) < 1 ? "bg-green-50 border-green-200 text-green-700" : "bg-orange-50 border-orange-200 text-orange-700"}`}>
                    {Math.abs(differenza) < 1
                      ? "✓ Nessuna differenza significativa"
                      : `Differenza: ${formatCurrency(differenza)} — verificare la causa`}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Obsolescenza e Svalutazione (OIC 13)</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>% obsolescenza stimata</Label>
                    <Input type="number" min="0" max="100" value={percObsolescenza} onChange={e => setPercObsolescenza(e.target.value)} placeholder="0,0" />
                  </div>
                  <div>
                    <Label>Fondo obsolescenza (€)</Label>
                    <Input type="number" value={fondoObsolescenza} onChange={e => setFondoObsolescenza(e.target.value)} placeholder="0,00" />
                  </div>
                </div>
                <div>
                  <Label>Note sull'obsolescenza</Label>
                  <Textarea value={noteObsolescenza} onChange={e => setNoteObsolescenza(e.target.value)} rows={2} placeholder="Descrizione delle categorie obsolete, criteri di stima" />
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Tab: Checklist ISA 501 */}
        {activeTab === "checklist" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ClipboardList className="w-4 h-4" />
                Checklist ISA Italia 501 — {checklistCompletate}/{checklist.length} completati
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {checklist.map((item, i) => (
                <div key={i} className={`p-3 rounded-lg border transition-colors ${item.completata ? "bg-green-50 border-green-200" : "bg-white border-slate-200"}`}>
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={item.completata}
                      onCheckedChange={() => toggleChecklist(i)}
                      className="mt-0.5"
                    />
                    <div className="flex-1 space-y-1">
                      <p className={`text-sm ${item.completata ? "line-through text-slate-400" : "text-slate-700"}`}>{item.voce}</p>
                      {item.completata && (
                        <Input
                          value={item.note ?? ""}
                          onChange={e => aggiornaChecklistNote(i, e.target.value)}
                          placeholder="Note (opzionale)"
                          className="text-xs h-7"
                        />
                      )}
                    </div>
                    {item.completata ? <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 text-slate-300 flex-shrink-0" />}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Tab: Categorie */}
        {activeTab === "categorie" && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="w-4 h-4" /> Categorie di Rimanenze
                </CardTitle>
                <Button size="sm" variant="outline" onClick={aggiungiCategoria}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> Aggiungi
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {categorie.length === 0 && (
                <div className="text-center py-8 text-slate-400">
                  <Package className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">Nessuna categoria inserita. Aggiungi le categorie di rimanenze.</p>
                </div>
              )}
              {categorie.map((cat, i) => (
                <div key={i} className="p-3 border rounded-lg space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <Label className="text-xs">Categoria</Label>
                      <Input value={cat.categoria} onChange={e => aggiornaCategoria(i, "categoria", e.target.value)} placeholder="es. Merci, Materie prime..." className="h-8 text-sm" />
                    </div>
                    <div>
                      <Label className="text-xs">Valore (€)</Label>
                      <Input type="number" value={cat.valore} onChange={e => aggiornaCategoria(i, "valore", parseFloat(e.target.value) || 0)} className="h-8 text-sm" />
                    </div>
                    <div>
                      <Label className="text-xs">% Obsolescenza</Label>
                      <div className="flex gap-1">
                        <Input type="number" min="0" max="100" value={cat.percObsolescenza ?? 0} onChange={e => aggiornaCategoria(i, "percObsolescenza", parseFloat(e.target.value) || 0)} className="h-8 text-sm" />
                        <Button size="sm" variant="ghost" onClick={() => rimuoviCategoria(i)} className="h-8 w-8 p-0 text-red-400 hover:text-red-600">
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                  <Input value={cat.note ?? ""} onChange={e => aggiornaCategoria(i, "note", e.target.value)} placeholder="Note sulla categoria" className="h-7 text-xs" />
                </div>
              ))}
              {categorie.length > 0 && (
                <div className="p-3 bg-slate-50 rounded-lg text-sm">
                  <span className="font-medium">Totale: </span>
                  {formatCurrency(categorie.reduce((s, c) => s + c.valore, 0))}
                  {" — Fondo stimato: "}
                  {formatCurrency(categorie.reduce((s, c) => s + c.valore * (c.percObsolescenza ?? 0) / 100, 0))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Tab: Conclusioni */}
        {activeTab === "conclusioni" && (
          <div className="space-y-4">
            {/* Analisi AI */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-purple-600" /> Analisi AI (ISA 501)
                  </CardTitle>
                  <Button
                    size="sm"
                    onClick={() => analizzaMutation.mutate({
                      incaricoId,
                      valoreContabile: valoreContabile ? parseFloat(valoreContabile) : undefined,
                      metodoValorizzazione: metodo,
                      percentualeObsolescenza: percObsolescenza ? parseFloat(percObsolescenza) : undefined,
                      categorieRimanenze: categorie,
                    })}
                    disabled={analizzaMutation.isPending}
                  >
                    {analizzaMutation.isPending ? "Analisi in corso..." : "Analizza con AI"}
                  </Button>
                </div>
              </CardHeader>
              {analisiAI && (
                <CardContent className="space-y-3">
                  <div className={`p-3 rounded-lg border ${RISCHIO_CONFIG[analisiAI.rischioValutazione as keyof typeof RISCHIO_CONFIG]?.bg ?? ""}`}>
                    <p className="text-sm font-medium">Rischio: {RISCHIO_CONFIG[analisiAI.rischioValutazione as keyof typeof RISCHIO_CONFIG]?.label ?? analisiAI.rischioValutazione}</p>
                  </div>
                  {analisiAI.areePrincipali?.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-slate-500 mb-1">Aree principali</p>
                      <ul className="space-y-1">
                        {analisiAI.areePrincipali.map((a: string, i: number) => (
                          <li key={i} className="flex items-start gap-2 text-sm"><AlertTriangle className="w-3.5 h-3.5 text-amber-500 mt-0.5 flex-shrink-0" />{a}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {analisiAI.procedurePrioritarie?.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-slate-500 mb-1">Procedure prioritarie</p>
                      <ul className="space-y-1">
                        {analisiAI.procedurePrioritarie.map((p: string, i: number) => (
                          <li key={i} className="flex items-start gap-2 text-sm"><Info className="w-3.5 h-3.5 text-blue-500 mt-0.5 flex-shrink-0" />{p}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              )}
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Valutazione del Rischio</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label>Livello di rischio</Label>
                  <Select value={rischio} onValueChange={setRischio}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="basso">Basso</SelectItem>
                      <SelectItem value="medio">Medio</SelectItem>
                      <SelectItem value="alto">Alto</SelectItem>
                      <SelectItem value="critico">Critico</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Conclusioni del revisore</Label>
                  <Textarea value={conclusioni} onChange={e => setConclusioni(e.target.value)} rows={4} placeholder="Conclusioni sull'area rimanenze, eventuali rilievi, raccomandazioni..." />
                </div>
                <div>
                  <Label>Note di lavoro</Label>
                  <Textarea value={noteRevisore} onChange={e => setNoteRevisore(e.target.value)} rows={3} placeholder="Note interne del revisore (non incluse nel fascicolo finale)" />
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Azioni */}
        <div className="flex justify-end gap-2 pb-6">
          <Button variant="outline" onClick={() => navigate(`/incarichi/${incaricoId}`)}>Annulla</Button>
          <Button onClick={salva} disabled={salvaMutation.isPending}>
            <Save className="w-4 h-4 mr-1" />
            {salvaMutation.isPending ? "Salvataggio..." : "Salva Scheda"}
          </Button>
        </div>
      </div>
    </RevisorLayout>
  );
}
