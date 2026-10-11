import { useState } from "react";
import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import RevisorLayout from "@/components/revisione/RevisorLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle2, Info, FileText, Calculator } from "lucide-react";
import { toast } from "sonner";

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function fmt(v: number | null, decimali = 0): string {
  if (v == null) return "—";
  return v.toLocaleString("it-IT", { minimumFractionDigits: decimali, maximumFractionDigits: decimali });
}

function fmtPerc(v: number | null): string {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

type Semaforo = "verde" | "giallo" | "rosso" | "grigio";

function SemaforoBadge({ s }: { s: Semaforo }) {
  const cfg: Record<Semaforo, { label: string; cls: string }> = {
    verde: { label: "OK", cls: "bg-emerald-100 text-emerald-800 border-emerald-200" },
    giallo: { label: "Attenzione", cls: "bg-amber-100 text-amber-800 border-amber-200" },
    rosso: { label: "Anomalia", cls: "bg-red-100 text-red-800 border-red-200" },
    grigio: { label: "N/D", cls: "bg-gray-100 text-gray-500 border-gray-200" },
  };
  const { label, cls } = cfg[s];
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>{label}</span>;
}

function SemaforoIcon({ s }: { s: Semaforo }) {
  if (s === "verde") return <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />;
  if (s === "giallo") return <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />;
  if (s === "rosso") return <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />;
  return <Info className="w-4 h-4 text-gray-400 shrink-0" />;
}

function VariazIcon({ v }: { v: number | null }) {
  if (v == null) return <Minus className="w-3 h-3 text-gray-400" />;
  if (v > 0) return <TrendingUp className="w-3 h-3 text-emerald-600" />;
  return <TrendingDown className="w-3 h-3 text-red-500" />;
}

function prioritaBadge(p: "alta" | "media" | "bassa") {
  const cfg = {
    alta: "bg-red-100 text-red-700 border-red-200",
    media: "bg-amber-100 text-amber-700 border-amber-200",
    bassa: "bg-gray-100 text-gray-600 border-gray-200",
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cfg[p]}`}>{p.charAt(0).toUpperCase() + p.slice(1)}</span>;
}

// ─── COMPONENTE PRINCIPALE ────────────────────────────────────────────────────

export default function VerificaRicaviCosti() {
  const { id } = useParams<{ id: string }>();
  const incaricoId = parseInt(id);

  const { data, isLoading } = trpc.verificaRicaviCosti.getAnalisi.useQuery({ incaricoId });

  // Riconciliazione IVA
  const [volumeIvaInput, setVolumeIvaInput] = useState("");
  const [riconcilazioneResult, setRiconciliazioneResult] = useState<{
    annoRiferimento: number | null;
    nomeFile: string;
    ricaviBilancio: number;
    volumeAffariIva: number;
    scostamentoAssoluto: number;
    scostamentoPerc: number | null;
    semaforo: "verde" | "giallo" | "rosso" | "grigio";
    nota: string;
  } | null>(null);
  const riconciliazioneIVA = trpc.verificaRicaviCosti.riconciliazioneIVA.useMutation({
    onSuccess: (result) => {
      setRiconciliazioneResult(result);
      toast.success("Riconciliazione completata");
    },
    onError: (e) => toast.error(e.message || "Errore durante la riconciliazione"),
  });

  // Export Excel carta di lavoro CE
  const [exportingCE, setExportingCE] = useState(false);
  const exportCEQuery = trpc.verificaRicaviCosti.exportCartaLavoroCE.useQuery(
    { incaricoId },
    { enabled: false }
  );

  async function handleExportCE() {
    setExportingCE(true);
    try {
      const result = await exportCEQuery.refetch();
      if (!result.data) { toast.error("Nessun dato disponibile per l'export"); return; }
      const { nomeCliente, annoN, annoN1, righeTabella } = result.data;

      // Genera XLSX con xlsx library
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();

      // Foglio 1: Analisi comparativa CE
      const headerCE = ["Gruppo", "Voce CE", `Anno ${annoN} (€)`, `Anno ${annoN1} (€)`, "Variaz. Assoluta (€)", "Variaz. %", `Incidenza Ricavi ${annoN} %`, `Incidenza Ricavi ${annoN1} %`, "Semaforo"];
      const rowsCE = righeTabella.map(r => [
        r.gruppo,
        r.voce,
        r.annoN ?? "",
        r.annoN1 ?? "",
        r.variazAssoluta ?? "",
        r.variazPerc != null ? `${r.variazPerc > 0 ? "+" : ""}${r.variazPerc.toFixed(1)}%` : "",
        r.incidenzaN != null ? `${r.incidenzaN.toFixed(1)}%` : "",
        r.incidenzaN1 != null ? `${r.incidenzaN1.toFixed(1)}%` : "",
        r.semaforo.toUpperCase(),
      ]);
      const wsCE = XLSX.utils.aoa_to_sheet([[`Carta di lavoro CE — ${nomeCliente} — Anno ${annoN}`], [], headerCE, ...rowsCE]);
      wsCE["!cols"] = [{ wch: 20 }, { wch: 30 }, { wch: 16 }, { wch: 16 }, { wch: 20 }, { wch: 12 }, { wch: 20 }, { wch: 20 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(wb, wsCE, "Analisi CE");

      // Foglio 2: Intestazione carta di lavoro
      const wsInfo = XLSX.utils.aoa_to_sheet([
        ["CARTA DI LAVORO — ANALISI CONTO ECONOMICO"],
        [],
        ["Cliente:", nomeCliente],
        ["Anno di revisione:", annoN],
        ["Anno precedente:", annoN1],
        ["Data elaborazione:", new Date().toLocaleDateString("it-IT")],
        [],
        ["Riferimento ISA:", "ISA Italia 500, ISA Italia 330"],
        [],
        ["Note del revisore:", ""],
        ["", ""],
        ["Firma:", ""],
      ]);
      wsInfo["!cols"] = [{ wch: 25 }, { wch: 40 }];
      XLSX.utils.book_append_sheet(wb, wsInfo, "Copertina");

      const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `CdL_CE_${nomeCliente.replace(/[^a-zA-Z0-9]/g, "_")}_${annoN}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Carta di lavoro CE esportata");
    } catch (e: any) {
      toast.error(e?.message || "Errore durante l'export");
    } finally {
      setExportingCE(false);
    }
  }

  function handleRiconciliaIVA() {
    const val = parseFloat(volumeIvaInput.replace(/[.,]/g, (m) => m === "." ? "" : "."));
    if (isNaN(val) || val <= 0) {
      toast.error("Inserire un importo valido per il volume d'affari IVA");
      return;
    }
    riconciliazioneIVA.mutate({ incaricoId, volumeAffariIva: val });
  }

  return (
    <RevisorLayout incaricoId={incaricoId}>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-foreground">Verifica Ricavi e Costi</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Analisi comparativa del conto economico, check anomalie e checklist procedure di revisione (ISA 500, ISA 330).
            </p>
          </div>
          {data?.disponibile && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2 shrink-0 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
              onClick={handleExportCE}
              disabled={exportingCE}
            >
              {exportingCE ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              Esporta carta di lavoro CE (.xlsx)
            </Button>
          )}
        </div>

        {isLoading && (
          <Card>
            <CardContent className="p-8 flex items-center justify-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Analisi in corso...</span>
            </CardContent>
          </Card>
        )}

        {data && !data.disponibile && (
          <Card className="border-amber-200 bg-amber-50/40">
            <CardContent className="p-6 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-800">Dati non disponibili</p>
                <p className="text-sm text-amber-700 mt-1">{data.motivo}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {data && data.disponibile && (
          <>
            {/* Intestazione bilanci */}
            <div className="flex flex-wrap gap-3 text-sm">
              <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2">
                <FileText className="w-4 h-4 text-indigo-500" />
                <span className="text-indigo-700 font-medium">Anno {data.annoN}</span>
                <span className="text-indigo-500 text-xs">{data.nomeFileN}</span>
              </div>
              {data.annoN1 && (
                <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                  <FileText className="w-4 h-4 text-slate-400" />
                  <span className="text-slate-600 font-medium">Anno {data.annoN1} (confronto)</span>
                  <span className="text-slate-400 text-xs">{data.nomeFileN1}</span>
                </div>
              )}
              {!data.annoN1 && (
                <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <Info className="w-4 h-4 text-amber-500" />
                  <span className="text-amber-700 text-xs">Bilancio anno precedente non disponibile — caricalo per abilitare l'analisi comparativa.</span>
                </div>
              )}
            </div>

            {/* Analisi comparativa CE */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-indigo-500" />
                  Analisi comparativa Conto Economico
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground w-[30%]">Voce CE</th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground">Anno {data.annoN} (€)</th>
                        {data.annoN1 && <th className="text-right px-4 py-2 font-medium text-muted-foreground">Anno {data.annoN1} (€)</th>}
                        {data.annoN1 && <th className="text-right px-4 py-2 font-medium text-muted-foreground">Var. %</th>}
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground">% Ricavi N</th>
                        {data.annoN1 && <th className="text-right px-4 py-2 font-medium text-muted-foreground">% Ricavi N-1</th>}
                        <th className="text-center px-4 py-2 font-medium text-muted-foreground">Stato</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const gruppi = Array.from(new Set(data.vociCE.map(v => v.gruppo)));
                        return gruppi.map(gruppo => (
                          <>
                            <tr key={`g-${gruppo}`} className="bg-muted/10">
                              <td colSpan={data.annoN1 ? 7 : 4} className="px-4 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                {gruppo}
                              </td>
                            </tr>
                            {data.vociCE.filter(v => v.gruppo === gruppo).map(v => (
                              <tr key={v.chiave} className="border-b hover:bg-muted/10 transition-colors">
                                <td className="px-4 py-2 text-foreground">{v.label}</td>
                                <td className="px-4 py-2 text-right font-mono">{fmt(v.valoreN)}</td>
                                {data.annoN1 && <td className="px-4 py-2 text-right font-mono text-muted-foreground">{fmt(v.valoreN1)}</td>}
                                {data.annoN1 && (
                                  <td className="px-4 py-2 text-right">
                                    <span className={`flex items-center justify-end gap-1 font-mono text-xs ${
                                      v.semaforo === "rosso" ? "text-red-600" :
                                      v.semaforo === "giallo" ? "text-amber-600" : "text-muted-foreground"
                                    }`}>
                                      <VariazIcon v={v.variazPerc} />
                                      {fmtPerc(v.variazPerc)}
                                    </span>
                                  </td>
                                )}
                                <td className="px-4 py-2 text-right text-xs text-muted-foreground font-mono">{v.incidenzaRicaviN != null ? `${v.incidenzaRicaviN.toFixed(1)}%` : "—"}</td>
                                {data.annoN1 && <td className="px-4 py-2 text-right text-xs text-muted-foreground font-mono">{v.incidenzaRicaviN1 != null ? `${v.incidenzaRicaviN1.toFixed(1)}%` : "—"}</td>}
                                <td className="px-4 py-2 text-center">
                                  {v.semaforo !== "grigio" && <SemaforoBadge s={v.semaforo} />}
                                </td>
                              </tr>
                            ))}
                          </>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>
                {data.vociCE.some(v => v.note) && (
                  <div className="px-4 py-3 border-t space-y-1">
                    {data.vociCE.filter(v => v.note).map(v => (
                      <p key={v.chiave} className="text-xs text-muted-foreground flex items-start gap-1.5">
                        <SemaforoIcon s={v.semaforo} />
                        <span><strong>{v.label}:</strong> {v.note}</span>
                      </p>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Check anomalie */}
            {data.anomalie.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                    Check anomalie e indicatori
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {data.anomalie.map((a, i) => (
                    <div key={i} className={`rounded-lg border p-3 ${
                      a.semaforo === "rosso" ? "border-red-200 bg-red-50/40" :
                      a.semaforo === "giallo" ? "border-amber-200 bg-amber-50/40" :
                      "border-emerald-200 bg-emerald-50/20"
                    }`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2">
                          <SemaforoIcon s={a.semaforo} />
                          <div>
                            <p className="text-sm font-medium text-foreground">{a.area} — {a.descrizione}</p>
                            <p className="text-sm font-mono font-semibold mt-0.5">{a.valore}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{a.riferimento}</p>
                          </div>
                        </div>
                        <SemaforoBadge s={a.semaforo} />
                      </div>
                      {a.semaforo !== "verde" && (
                        <p className="text-xs text-muted-foreground mt-2 pl-6 border-t pt-2">{a.proceduraSuggerita}</p>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Riconciliazione ricavi vs IVA */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Calculator className="w-4 h-4 text-blue-500" />
                  Riconciliazione ricavi vs volume d'affari IVA
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Inserire il volume d'affari dalla dichiarazione IVA annuale (rigo VE50 del modello IVA) per confrontarlo con i ricavi del bilancio.
                </p>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    placeholder="Es. 450000"
                    value={volumeIvaInput}
                    onChange={(e) => setVolumeIvaInput(e.target.value)}
                    className="max-w-xs"
                  />
                  <Button
                    onClick={handleRiconciliaIVA}
                    disabled={riconciliazioneIVA.isPending || !volumeIvaInput}
                    size="sm"
                  >
                    {riconciliazioneIVA.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Calculator className="w-4 h-4 mr-1" />}
                    Riconcilia
                  </Button>
                </div>
                {riconcilazioneResult && (
                  <div className={`rounded-lg border p-4 space-y-3 ${
                    riconcilazioneResult.semaforo === "verde" ? "border-emerald-200 bg-emerald-50/40" :
                    riconcilazioneResult.semaforo === "giallo" ? "border-amber-200 bg-amber-50/40" :
                    riconcilazioneResult.semaforo === "rosso" ? "border-red-200 bg-red-50/40" :
                    "border-border bg-muted/20"
                  }`}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-foreground">Risultato riconciliazione</span>
                      <SemaforoBadge s={riconcilazioneResult.semaforo} />
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground">Ricavi da bilancio ({riconcilazioneResult.annoRiferimento})</p>
                        <p className="font-mono font-semibold">€ {fmt(riconcilazioneResult.ricaviBilancio)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Volume d'affari IVA</p>
                        <p className="font-mono font-semibold">€ {fmt(riconcilazioneResult.volumeAffariIva)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Scostamento assoluto</p>
                        <p className={`font-mono font-semibold ${
                          riconcilazioneResult.scostamentoAssoluto > 0 ? "text-emerald-700" : "text-red-700"
                        }`}>
                          {riconcilazioneResult.scostamentoAssoluto >= 0 ? "+" : ""}€ {fmt(riconcilazioneResult.scostamentoAssoluto)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Scostamento %</p>
                        <p className={`font-mono font-semibold ${
                          riconcilazioneResult.semaforo === "verde" ? "text-emerald-700" :
                          riconcilazioneResult.semaforo === "giallo" ? "text-amber-700" : "text-red-700"
                        }`}>
                          {fmtPerc(riconcilazioneResult.scostamentoPerc)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2 pt-1 border-t">
                      <SemaforoIcon s={riconcilazioneResult.semaforo} />
                      <p className="text-xs text-muted-foreground">{riconcilazioneResult.nota}</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Checklist procedure */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  Checklist procedure di revisione suggerite
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.checklist.map((c, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-border hover:bg-muted/10 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-xs font-semibold text-foreground">{c.area}</span>
                        {prioritaBadge(c.priorita)}
                        <Badge variant="outline" className="text-xs">{c.riferimentoISA}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{c.procedura}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </RevisorLayout>
  );
}
