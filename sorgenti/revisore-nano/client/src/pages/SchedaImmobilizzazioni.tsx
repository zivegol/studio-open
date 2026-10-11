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
  ChevronLeft, Building2, Sparkles, Save, CheckCircle2, AlertTriangle,
  AlertCircle, Info, Plus, Trash2, ClipboardList, FileText, RefreshCw,
} from "lucide-react";

interface AliquotaAmmortamento {
  categoria: string;
  aliquota: number;
  note?: string;
}

interface ChecklistItem {
  voce: string;
  completata: boolean;
  note?: string;
}

const RISCHIO_CONFIG = {
  basso: { label: "Basso", bg: "bg-green-50 border-green-200", badge: "bg-green-100 text-green-800" },
  medio: { label: "Medio", bg: "bg-amber-50 border-amber-200", badge: "bg-amber-100 text-amber-800" },
  alto: { label: "Alto", bg: "bg-orange-50 border-orange-200", badge: "bg-orange-100 text-orange-800" },
  critico: { label: "Critico", bg: "bg-red-50 border-red-200", badge: "bg-red-100 text-red-800" },
};

export default function SchedaImmobilizzazioni() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const incaricoId = parseInt(id ?? "0");

  const [valoreImmobiliMat, setValoreImmobiliMat] = useState("");
  const [valoreImmobiliImmat, setValoreImmobiliImmat] = useState("");
  const [fondiMat, setFondiMat] = useState("");
  const [fondiImmat, setFondiImmat] = useState("");
  const [registroVerificato, setRegistroVerificato] = useState(false);
  const [noteRegistro, setNoteRegistro] = useState("");
  const [aliquote, setAliquote] = useState<AliquotaAmmortamento[]>([]);
  const [ammortamentiCorretti, setAmmortamentiCorretti] = useState<boolean | undefined>();
  const [noteAmmortamenti, setNoteAmmortamenti] = useState("");
  const [acquisizioni, setAcquisizioni] = useState("");
  const [dismissioni, setDismissioni] = useState("");
  const [noteAcquisizioni, setNoteAcquisizioni] = useState("");
  const [noteDismissioni, setNoteDismissioni] = useState("");
  const [rivalutazioni, setRivalutazioni] = useState("");
  const [svalutazioni, setSvalutazioni] = useState("");
  const [noteRivalutazioni, setNoteRivalutazioni] = useState("");
  const [beniInLeasing, setBeniInLeasing] = useState(false);
  const [noteLeasing, setNoteLeasing] = useState("");
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [conclusioni, setConclusioni] = useState("");
  const [rischio, setRischio] = useState("medio");
  const [noteRevisore, setNoteRevisore] = useState("");
  const [stato, setStato] = useState("da_iniziare");
  const [analisiAI, setAnalisiAI] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<"dati" | "ammortamenti" | "checklist" | "conclusioni">("dati");

  const { data: scheda, isLoading } = trpc.schedeControllo.getSchedaImmobilizzazioni.useQuery(
    { incaricoId }, { enabled: incaricoId > 0 }
  );
  const { data: incarico } = trpc.incarichi.get.useQuery(
    { id: incaricoId }, { enabled: incaricoId > 0 }
  );
  const { data: registroDossier, isLoading: registroLoading, refetch: ricaricaRegistro } =
    trpc.schedeControllo.analizzaRegistroCespitiDaDossier.useQuery(
      { incaricoId }, { enabled: incaricoId > 0, staleTime: 24 * 60 * 60 * 1000, retry: false }
    );

  const salvaMutation = trpc.schedeControllo.salvaSchedaImmobilizzazioni.useMutation({
    onSuccess: () => toast.success("Scheda immobilizzazioni salvata"),
    onError: () => toast.error("Errore nel salvataggio"),
  });
  const analizzaMutation = trpc.schedeControllo.analizzaImmobilizzazioniConAI.useMutation({
    onSuccess: (data) => {
      setAnalisiAI(data);
      if (data.rischioValutazione) setRischio(data.rischioValutazione);
      if (data.conclusioni) setConclusioni(data.conclusioni);
      toast.success("Analisi AI completata");
    },
    onError: () => toast.error("Errore nell'analisi AI"),
  });

  useEffect(() => {
    if (!scheda) return;
    if (scheda.valoreImmobiliMat) setValoreImmobiliMat(scheda.valoreImmobiliMat);
    if (scheda.valoreImmobiliImmat) setValoreImmobiliImmat(scheda.valoreImmobiliImmat);
    if (scheda.fondiAmmortamentoMat) setFondiMat(scheda.fondiAmmortamentoMat);
    if (scheda.fondiAmmortamentoImmat) setFondiImmat(scheda.fondiAmmortamentoImmat);
    setRegistroVerificato(scheda.registroCespitiVerificato ?? false);
    if (scheda.noteRegistroCespiti) setNoteRegistro(scheda.noteRegistroCespiti);
    if (scheda.aliquoteAmmortamento?.length) setAliquote(scheda.aliquoteAmmortamento as AliquotaAmmortamento[]);
    if (scheda.ammortamentiCalcolatiCorrettamente !== null) setAmmortamentiCorretti(scheda.ammortamentiCalcolatiCorrettamente ?? undefined);
    if (scheda.noteAmmortamenti) setNoteAmmortamenti(scheda.noteAmmortamenti);
    if (scheda.acquisizioni) setAcquisizioni(scheda.acquisizioni);
    if (scheda.dismissioni) setDismissioni(scheda.dismissioni);
    if (scheda.noteAcquisizioni) setNoteAcquisizioni(scheda.noteAcquisizioni);
    if (scheda.noteDismissioni) setNoteDismissioni(scheda.noteDismissioni);
    if (scheda.rivalutazioni) setRivalutazioni(scheda.rivalutazioni);
    if (scheda.svalutazioni) setSvalutazioni(scheda.svalutazioni);
    if (scheda.noteRivalutazioni) setNoteRivalutazioni(scheda.noteRivalutazioni);
    setBeniInLeasing(scheda.beniInLeasing ?? false);
    if (scheda.noteLeasingIFRS16) setNoteLeasing(scheda.noteLeasingIFRS16);
    if (scheda.checklistIsa?.length) setChecklist(scheda.checklistIsa as ChecklistItem[]);
    if (scheda.conclusioni) setConclusioni(scheda.conclusioni);
    if (scheda.rischioValutazione) setRischio(scheda.rischioValutazione);
    if (scheda.noteRevisore) setNoteRevisore(scheda.noteRevisore);
    if (scheda.stato) setStato(scheda.stato);
  }, [scheda]);

  useEffect(() => {
    if (!registroDossier) return;
    const totali = registroDossier.totali;
    if (!scheda?.valoreImmobiliMat) setValoreImmobiliMat(String(totali.valoreFinale));
    if (!scheda?.fondiAmmortamentoMat) setFondiMat(String(totali.fondoFinale));
    if (!scheda?.acquisizioni) setAcquisizioni(String(totali.variazioniAcquisto));
    if (!scheda?.dismissioni) setDismissioni("0");
    if (!scheda?.aliquoteAmmortamento?.length) setAliquote(registroDossier.aliquote);
    if (!scheda?.noteRegistroCespiti) {
      setNoteRegistro(`Registro acquisito automaticamente dal dossier: ${registroDossier.fonte}.${registroDossier.stampaDiProva ? " Documento marcato come stampa di prova: acquisire la versione definitiva." : ""}`);
    }
    if (!scheda?.noteAmmortamenti) {
      setNoteAmmortamenti(`Quota civilistica 2025 estratta dal registro: ${formatCurrency(totali.quotaAmmortamento)}. Fondo finale: ${formatCurrency(totali.fondoFinale)}.`);
    }
  }, [registroDossier, scheda]);

  const checklistCompletate = checklist.filter(c => c.completata).length;
  const totaleNettoMat = valoreImmobiliMat && fondiMat
    ? parseFloat(valoreImmobiliMat) - parseFloat(fondiMat)
    : valoreImmobiliMat ? parseFloat(valoreImmobiliMat) : null;

  function salva() {
    salvaMutation.mutate({
      incaricoId,
      valoreImmobiliMat: valoreImmobiliMat || undefined,
      valoreImmobiliImmat: valoreImmobiliImmat || undefined,
      fondiAmmortamentoMat: fondiMat || undefined,
      fondiAmmortamentoImmat: fondiImmat || undefined,
      registroCespitiVerificato: registroVerificato,
      noteRegistroCespiti: noteRegistro,
      aliquoteAmmortamento: aliquote,
      ammortamentiCalcolatiCorrettamente: ammortamentiCorretti,
      noteAmmortamenti,
      acquisizioni: acquisizioni || undefined,
      dismissioni: dismissioni || undefined,
      noteAcquisizioni,
      noteDismissioni,
      rivalutazioni: rivalutazioni || undefined,
      svalutazioni: svalutazioni || undefined,
      noteRivalutazioni,
      beniInLeasing,
      noteLeasingIFRS16: noteLeasing,
      checklistIsa: checklist,
      conclusioni,
      rischioValutazione: rischio as any,
      noteRevisore,
      stato: stato as any,
    });
  }

  function toggleChecklist(i: number) {
    setChecklist(prev => prev.map((item, idx) => idx === i ? { ...item, completata: !item.completata } : item));
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
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/incarichi/${incaricoId}`)}>
            <ChevronLeft className="w-4 h-4 mr-1" /> Indietro
          </Button>
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-blue-600" />
            <h1 className="text-xl font-bold">Scheda Immobilizzazioni</h1>
            {incarico && <span className="text-slate-500 text-sm">— {incarico.cliente?.ragioneSociale ?? ""} {incarico.annoEsercizio}</span>}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Badge className={rischioConf.badge}>Rischio {rischioConf.label}</Badge>
            <Badge variant="outline">{checklistCompletate}/{checklist.length} controlli</Badge>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b">
          {(["dati", "ammortamenti", "checklist", "conclusioni"] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium capitalize transition-colors ${activeTab === tab ? "border-b-2 border-blue-600 text-blue-600" : "text-slate-500 hover:text-slate-700"}`}>
              {tab === "dati" ? "Dati Generali" : tab === "ammortamenti" ? "Ammortamenti" : tab === "checklist" ? "Checklist ISA" : "Conclusioni"}
            </button>
          ))}
        </div>

        {/* Tab: Dati Generali */}
        {activeTab === "dati" && (
          <div className="space-y-4">
            <Card className="border-blue-200 bg-blue-50/30">
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2"><FileText className="w-4 h-4 text-blue-600" /> Registro cespiti dal dossier</CardTitle>
                    <p className="text-xs text-slate-500 mt-1">Lettura locale automatica del PDF, senza servizi AI esterni.</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => ricaricaRegistro()} disabled={registroLoading}>
                    <RefreshCw className={`w-3.5 h-3.5 mr-1 ${registroLoading ? "animate-spin" : ""}`} /> Aggiorna dal dossier
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {registroLoading && <p className="text-sm text-slate-500">Ricerca e analisi del registro cespiti in corso...</p>}
                {!registroLoading && !registroDossier && <p className="text-sm text-amber-700">Nessun registro cespiti PDF riconosciuto nel dossier.</p>}
                {registroDossier && (
                  <>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge variant="outline">{registroDossier.fonte}</Badge>
                      <Badge variant="outline">{registroDossier.pagine} pagine</Badge>
                      <Badge variant="outline">{registroDossier.beni.length} cespiti</Badge>
                      <Badge variant="outline">{registroDossier.categorie.length} categorie</Badge>
                      {registroDossier.stampaDiProva && <Badge className="bg-amber-100 text-amber-800">Stampa di prova</Badge>}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                      {[
                        ["Valore iniziale", registroDossier.totali.valoreIniziale],
                        ["Acquisizioni 2025", registroDossier.totali.variazioniAcquisto],
                        ["Valore finale", registroDossier.totali.valoreFinale],
                        ["Quota 2025", registroDossier.totali.quotaAmmortamento],
                        ["Fondo finale", registroDossier.totali.fondoFinale],
                      ].map(([label, value]) => (
                        <div key={String(label)} className="rounded-lg border bg-white p-3">
                          <p className="text-[11px] text-slate-500">{label}</p>
                          <p className="font-semibold text-sm mt-1">{formatCurrency(Number(value))}</p>
                        </div>
                      ))}
                    </div>
                    {registroDossier.anomalie.length > 0 && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-1">
                        {registroDossier.anomalie.map((anomalia, index) => <p key={index} className="text-xs text-amber-800 flex gap-2"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{anomalia}</p>)}
                      </div>
                    )}
                    <div className="overflow-x-auto rounded-lg border bg-white">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50 text-slate-600"><tr><th className="text-left p-2">Categoria</th><th className="text-right p-2">Valore finale</th><th className="text-right p-2">Quota 2025</th><th className="text-right p-2">Fondo finale</th><th className="text-right p-2">Residuo</th></tr></thead>
                        <tbody>{registroDossier.categorie.map(categoria => (
                          <tr key={categoria.codice} className="border-t"><td className="p-2 font-medium">{categoria.codice} - {categoria.descrizione}</td><td className="p-2 text-right">{formatCurrency(categoria.valoreFinale)}</td><td className="p-2 text-right">{formatCurrency(categoria.quotaAmmortamento)}</td><td className="p-2 text-right">{formatCurrency(categoria.fondoFinale)}</td><td className="p-2 text-right">{formatCurrency(categoria.residuoDaAmmortizzare)}</td></tr>
                        ))}</tbody>
                      </table>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-slate-600 mb-2">Controlli eseguiti automaticamente</p>
                      <div className="grid md:grid-cols-2 gap-1">{registroDossier.controlliAutomatici.map((controllo, index) => <p key={index} className="text-xs flex gap-2 text-slate-600"><CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0" />{controllo}</p>)}</div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Valori Contabili</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Immobilizzazioni materiali lorde (€)</Label>
                    <Input type="number" value={valoreImmobiliMat} onChange={e => setValoreImmobiliMat(e.target.value)} placeholder="0,00" />
                  </div>
                  <div>
                    <Label>Fondo ammortamento materiali (€)</Label>
                    <Input type="number" value={fondiMat} onChange={e => setFondiMat(e.target.value)} placeholder="0,00" />
                  </div>
                  <div>
                    <Label>Immobilizzazioni immateriali lorde (€)</Label>
                    <Input type="number" value={valoreImmobiliImmat} onChange={e => setValoreImmobiliImmat(e.target.value)} placeholder="0,00" />
                  </div>
                  <div>
                    <Label>Fondo ammortamento immateriali (€)</Label>
                    <Input type="number" value={fondiImmat} onChange={e => setFondiImmat(e.target.value)} placeholder="0,00" />
                  </div>
                </div>
                {totaleNettoMat !== null && (
                  <div className="p-3 bg-slate-50 rounded-lg text-sm">
                    <span className="font-medium">Valore netto materiali: </span>{formatCurrency(totaleNettoMat)}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Registro Cespiti</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  <Checkbox id="registro" checked={registroVerificato} onCheckedChange={v => setRegistroVerificato(!!v)} />
                  <Label htmlFor="registro">Registro cespiti verificato e aggiornato al 31/12</Label>
                </div>
                <div>
                  <Label>Note sul registro cespiti</Label>
                  <Textarea value={noteRegistro} onChange={e => setNoteRegistro(e.target.value)} rows={2} placeholder="Osservazioni sul registro, eventuali discrepanze" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Acquisizioni e Dismissioni</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Acquisizioni esercizio (€)</Label>
                    <Input type="number" value={acquisizioni} onChange={e => setAcquisizioni(e.target.value)} placeholder="0,00" />
                  </div>
                  <div>
                    <Label>Dismissioni esercizio (€)</Label>
                    <Input type="number" value={dismissioni} onChange={e => setDismissioni(e.target.value)} placeholder="0,00" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Note acquisizioni</Label>
                    <Textarea value={noteAcquisizioni} onChange={e => setNoteAcquisizioni(e.target.value)} rows={2} placeholder="Documentazione esaminata, osservazioni" />
                  </div>
                  <div>
                    <Label>Note dismissioni</Label>
                    <Textarea value={noteDismissioni} onChange={e => setNoteDismissioni(e.target.value)} rows={2} placeholder="Plus/minusvalenze, trattamento fiscale" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Rivalutazioni e Svalutazioni</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Rivalutazioni (€)</Label>
                    <Input type="number" value={rivalutazioni} onChange={e => setRivalutazioni(e.target.value)} placeholder="0,00" />
                  </div>
                  <div>
                    <Label>Svalutazioni (€)</Label>
                    <Input type="number" value={svalutazioni} onChange={e => setSvalutazioni(e.target.value)} placeholder="0,00" />
                  </div>
                </div>
                <div>
                  <Label>Note su rivalutazioni / svalutazioni</Label>
                  <Textarea value={noteRivalutazioni} onChange={e => setNoteRivalutazioni(e.target.value)} rows={2} placeholder="Riferimento normativo (L. 342/2000, OIC 9), motivazione" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Leasing (OIC 12 / IFRS 16)</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  <Checkbox id="leasing" checked={beniInLeasing} onCheckedChange={v => setBeniInLeasing(!!v)} />
                  <Label htmlFor="leasing">Presenza di beni in leasing</Label>
                </div>
                {beniInLeasing && (
                  <div>
                    <Label>Note sul leasing</Label>
                    <Textarea value={noteLeasing} onChange={e => setNoteLeasing(e.target.value)} rows={2} placeholder="Trattamento contabile, impatto sul bilancio, canoni residui" />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Tab: Ammortamenti */}
        {activeTab === "ammortamenti" && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Aliquote di Ammortamento</CardTitle>
                <Button size="sm" variant="outline" onClick={() => setAliquote(prev => [...prev, { categoria: "", aliquota: 0 }])}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> Aggiungi
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3 p-3 rounded-lg border">
                <Label className="text-sm">Ammortamenti calcolati correttamente:</Label>
                <div className="flex gap-2">
                  <Button size="sm" variant={ammortamentiCorretti === true ? "default" : "outline"} onClick={() => setAmmortamentiCorretti(true)}>Sì</Button>
                  <Button size="sm" variant={ammortamentiCorretti === false ? "destructive" : "outline"} onClick={() => setAmmortamentiCorretti(false)}>No</Button>
                </div>
              </div>
              {aliquote.map((a, i) => (
                <div key={i} className="grid grid-cols-3 gap-2 items-end">
                  <div>
                    <Label className="text-xs">Categoria cespite</Label>
                    <Input value={a.categoria} onChange={e => setAliquote(prev => prev.map((x, idx) => idx === i ? { ...x, categoria: e.target.value } : x))} placeholder="es. Automezzi, Macchinari..." className="h-8 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">Aliquota %</Label>
                    <Input type="number" min="0" max="100" value={a.aliquota} onChange={e => setAliquote(prev => prev.map((x, idx) => idx === i ? { ...x, aliquota: parseFloat(e.target.value) || 0 } : x))} className="h-8 text-sm" />
                  </div>
                  <div className="flex gap-1">
                    <Input value={a.note ?? ""} onChange={e => setAliquote(prev => prev.map((x, idx) => idx === i ? { ...x, note: e.target.value } : x))} placeholder="Note" className="h-8 text-xs" />
                    <Button size="sm" variant="ghost" onClick={() => setAliquote(prev => prev.filter((_, idx) => idx !== i))} className="h-8 w-8 p-0 text-red-400">
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
              <div>
                <Label>Note generali sugli ammortamenti</Label>
                <Textarea value={noteAmmortamenti} onChange={e => setNoteAmmortamenti(e.target.value)} rows={3} placeholder="Variazioni di aliquote, deroghe, ammortamenti anticipati/ridotti" />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tab: Checklist */}
        {activeTab === "checklist" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ClipboardList className="w-4 h-4" />
                Checklist ISA Italia 500/501 — {checklistCompletate}/{checklist.length} completati
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {checklist.map((item, i) => (
                <div key={i} className={`p-3 rounded-lg border transition-colors ${item.completata ? "bg-green-50 border-green-200" : "bg-white border-slate-200"}`}>
                  <div className="flex items-start gap-3">
                    <Checkbox checked={item.completata} onCheckedChange={() => toggleChecklist(i)} className="mt-0.5" />
                    <div className="flex-1">
                      <p className={`text-sm ${item.completata ? "line-through text-slate-400" : "text-slate-700"}`}>{item.voce}</p>
                    </div>
                    {item.completata ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <AlertCircle className="w-4 h-4 text-slate-300" />}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Tab: Conclusioni */}
        {activeTab === "conclusioni" && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-purple-600" /> Analisi AI (ISA 500/501)
                  </CardTitle>
                  <Button size="sm" onClick={() => analizzaMutation.mutate({
                    incaricoId,
                    valoreImmobiliMat: valoreImmobiliMat ? parseFloat(valoreImmobiliMat) : undefined,
                    valoreImmobiliImmat: valoreImmobiliImmat ? parseFloat(valoreImmobiliImmat) : undefined,
                    acquisizioni: acquisizioni ? parseFloat(acquisizioni) : undefined,
                    dismissioni: dismissioni ? parseFloat(dismissioni) : undefined,
                    rivalutazioni: rivalutazioni ? parseFloat(rivalutazioni) : undefined,
                    beniInLeasing,
                  })} disabled={analizzaMutation.isPending}>
                    {analizzaMutation.isPending ? "Analisi..." : "Analizza con AI"}
                  </Button>
                </div>
              </CardHeader>
              {analisiAI && (
                <CardContent className="space-y-3">
                  <div className={`p-3 rounded-lg border ${RISCHIO_CONFIG[analisiAI.rischioValutazione as keyof typeof RISCHIO_CONFIG]?.bg ?? ""}`}>
                    <p className="text-sm font-medium">Rischio: {RISCHIO_CONFIG[analisiAI.rischioValutazione as keyof typeof RISCHIO_CONFIG]?.label ?? analisiAI.rischioValutazione}</p>
                  </div>
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
              <CardHeader><CardTitle className="text-base">Valutazione e Conclusioni</CardTitle></CardHeader>
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
                  <Label>Conclusioni</Label>
                  <Textarea value={conclusioni} onChange={e => setConclusioni(e.target.value)} rows={4} placeholder="Conclusioni sull'area immobilizzazioni, eventuali rilievi..." />
                </div>
                <div>
                  <Label>Note di lavoro</Label>
                  <Textarea value={noteRevisore} onChange={e => setNoteRevisore(e.target.value)} rows={2} placeholder="Note interne del revisore" />
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
