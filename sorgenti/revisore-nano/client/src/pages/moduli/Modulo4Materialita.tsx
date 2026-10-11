import { useState } from "react";
import RevisorLayout from "@/components/revisione/RevisorLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useParams, useLocation } from "wouter";
import { Loader2, ChevronRight, ChevronLeft, Lightbulb, Info, Download } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";

const BENCHMARK_LABELS: Record<string, string> = {
  ricavi_netti: "Ricavi netti",
  totale_attivo: "Totale attivo",
  patrimonio_netto: "Patrimonio netto",
  utile_ante_imposte: "Utile ante imposte",
  costo_venduto: "Costo del venduto",
};

const BENCHMARK_RANGE: Record<string, string> = {
  ricavi_netti: "0,5% – 1%",
  totale_attivo: "1% – 2%",
  patrimonio_netto: "2% – 5%",
  utile_ante_imposte: "5% – 10%",
  costo_venduto: "0,5% – 1%",
};

function ValoreCard({ label, valore, sub, highlight = false }: { label: string; valore: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`p-4 rounded-lg border ${highlight ? "border-primary/30 bg-primary/5" : "border-border bg-muted/30"}`}>
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className={`text-2xl font-bold ${highlight ? "text-primary" : "text-foreground"}`}>{valore}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

export default function Modulo4Materialita() {
  const params = useParams<{ id: string }>();
  const incaricoId = parseInt(params.id);
  const [, navigate] = useLocation();

  const { data: modulo, refetch } = trpc.moduli.materialita.get.useQuery({ incaricoId });
  const { data: datiMaterialita } = trpc.documenti.getDatiPerMaterialita.useQuery({ incaricoId });
  const [prepopolato, setPrepopolato] = useState(false);
  const calcola = trpc.moduli.materialita.calcola.useMutation({
    onSuccess: () => { refetch(); toast.success("Materialità calcolata"); },
    onError: e => toast.error(e.message),
  });
  function prepopolaDaBilancio() {
    if (!datiMaterialita?.disponibile || !datiMaterialita.valori) return;
    const v = datiMaterialita.valori;
    setBenchmarkTipo(datiMaterialita.benchmarkConsigliato);
    setBenchmarkPerc(datiMaterialita.percentualeConsigliata.toString());
    const valBenchmark = v[datiMaterialita.benchmarkConsigliato];
    if (valBenchmark !== null && valBenchmark !== undefined) {
      setBenchmarkValore(valBenchmark.toString());
    }
    setMotivazione(datiMaterialita.motivazione);
    setPrepopolato(true);
    toast.success(`Benchmark pre-popolato da: ${datiMaterialita.nomeFile}`);
  }

  const suggerisci = trpc.moduli.materialita.suggerisciBenchmark.useMutation({
    onSuccess: (data) => {
      setBenchmarkTipo(data.benchmarkConsigliato as any);
      setBenchmarkPerc(data.percentualeConsigliata.toString());
      const valori = data.valori as Record<string, number>;
      setBenchmarkValore(valori[data.benchmarkConsigliato]?.toString() || "");
      setMotivazione(data.motivazione);
      toast.success("Benchmark suggerito dall'AI");
    },
    onError: e => toast.error(e.message),
  });

  const [benchmarkTipo, setBenchmarkTipo] = useState<"ricavi_netti" | "totale_attivo" | "patrimonio_netto" | "utile_ante_imposte" | "costo_venduto">(
    (modulo?.benchmarkTipo as any) || "ricavi_netti"
  );
  const [benchmarkValore, setBenchmarkValore] = useState(modulo?.benchmarkValore?.toString() || "");
  const [benchmarkPerc, setBenchmarkPerc] = useState(modulo?.benchmarkPercentuale?.toString() || "0.75");
  const [motivazione, setMotivazione] = useState(modulo?.motivazioneBenchmark || "");
  const [primoIncarico, setPrimoIncarico] = useState(modulo?.primoIncarico || false);
  const [erroriPrec, setErroriPrec] = useState(modulo?.erroriAnniPrecedenti || false);
  const [controlliDeboli, setControlliDeboli] = useState(modulo?.controlliDeboli || false);

  // Calcolo live
  const val = parseFloat(benchmarkValore) || 0;
  const perc = parseFloat(benchmarkPerc) || 0;
  const om = val > 0 && perc > 0 ? val * (perc / 100) : 0;
  let fattore = 0.70;
  if (primoIncarico) fattore -= 0.10;
  if (erroriPrec) fattore -= 0.10;
  if (controlliDeboli) fattore -= 0.05;
  fattore = Math.max(fattore, 0.50);
  const pm = om * fattore;
  const ctt = om * 0.05;

  const fmt = (n: number) => n > 0 ? formatCurrency(n, { decimali: 0 }) : "—";

  function handleSave(completato = false) {
    if (!benchmarkValore || !benchmarkPerc) {
      toast.error("Inserisci il valore del benchmark e la percentuale");
      return;
    }
    calcola.mutate({
      incaricoId,
      benchmarkTipo,
      benchmarkValore: parseFloat(benchmarkValore),
      benchmarkPercentuale: parseFloat(benchmarkPerc),
      motivazioneBenchmark: motivazione || undefined,
      primoIncarico,
      erroriAnniPrecedenti: erroriPrec,
      controlliDeboli,
      completato,
    });
  }

  return (
    <RevisorLayout incaricoId={incaricoId} moduloAttivo={4}>
      <div className="p-6 max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className="text-xs">ISA Italia 320</Badge>
            {modulo?.completato && <Badge className="bg-emerald-100 text-emerald-700 text-xs">Completato</Badge>}
          </div>
          <h1 className="text-2xl font-bold text-foreground">Modulo 4 — Materialità</h1>
          <p className="text-muted-foreground mt-1 text-sm">Determinazione di Overall Materiality, Performance Materiality e Clearly Trivial Threshold</p>
        </div>

        {/* Banner pre-popolamento da bilancio */}
        {datiMaterialita?.disponibile && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg mb-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Download className="w-4 h-4 text-emerald-600" />
                  <span className="text-sm font-medium text-emerald-800">
                    Dati disponibili dal bilancio: {datiMaterialita.nomeFile}
                    {datiMaterialita.annoRiferimento ? ` (${datiMaterialita.annoRiferimento})` : ""}
                  </span>
                  {prepopolato && <Badge className="bg-emerald-100 text-emerald-700 text-xs">Pre-popolato</Badge>}
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2">
                  {datiMaterialita.valori?.ricavi_netti != null && (
                    <div className="text-xs text-emerald-700"><span className="font-medium">Ricavi netti:</span> {formatCurrency(datiMaterialita.valori.ricavi_netti)}</div>
                  )}
                  {datiMaterialita.valori?.totale_attivo != null && (
                    <div className="text-xs text-emerald-700"><span className="font-medium">Totale attivo:</span> {formatCurrency(datiMaterialita.valori.totale_attivo)}</div>
                  )}
                  {datiMaterialita.valori?.patrimonio_netto != null && (
                    <div className="text-xs text-emerald-700"><span className="font-medium">Patrimonio netto:</span> {formatCurrency(datiMaterialita.valori.patrimonio_netto)}</div>
                  )}
                  {datiMaterialita.valori?.utile_ante_imposte != null && (
                    <div className="text-xs text-emerald-700"><span className="font-medium">Utile ante imposte:</span> {formatCurrency(datiMaterialita.valori.utile_ante_imposte)}</div>
                  )}
                </div>
                <div className="text-xs text-emerald-600 mt-1 italic">
                  Benchmark consigliato: <strong>{BENCHMARK_LABELS[datiMaterialita.benchmarkConsigliato]}</strong> al {datiMaterialita.percentualeConsigliata}%
                </div>
              </div>
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white shrink-0"
                onClick={prepopolaDaBilancio}>
                <Download className="w-4 h-4 mr-1" />
                {prepopolato ? "Ri-applica" : "Pre-popola benchmark"}
              </Button>
            </div>
          </div>
        )}

        {/* Info */}
        <div className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg mb-6">
          <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-blue-700">
            Secondo ISA Italia 320, la materialità dipende dal benchmark scelto e dal giudizio professionale del revisore. La Performance Materiality è solitamente il 60-75% dell'Overall Materiality.
          </p>
        </div>

        {/* Benchmark */}
        <Card className="mb-4">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Selezione del benchmark</CardTitle>
              <Button size="sm" variant="outline" onClick={() => suggerisci.mutate({ incaricoId })} disabled={suggerisci.isPending}>
                {suggerisci.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Lightbulb className="w-4 h-4 mr-1" />}
                Suggerisci benchmark
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Tipo di benchmark</Label>
                <Select value={benchmarkTipo} onValueChange={v => setBenchmarkTipo(v as typeof benchmarkTipo)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(BENCHMARK_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v} <span className="text-muted-foreground text-xs">({BENCHMARK_RANGE[k]})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Valore del benchmark (€)</Label>
                <Input
                  type="number"
                  className="mt-1"
                  value={benchmarkValore}
                  onChange={e => setBenchmarkValore(e.target.value)}
                  placeholder="es. 489054"
                />
              </div>
            </div>
            <div>
              <Label>Percentuale applicata (%)</Label>
              <div className="text-xs text-muted-foreground mb-1">Fascia consigliata per {BENCHMARK_LABELS[benchmarkTipo]}: {BENCHMARK_RANGE[benchmarkTipo]}</div>
              <Input
                type="number"
                step="0.05"
                min="0.1"
                max="10"
                value={benchmarkPerc}
                onChange={e => setBenchmarkPerc(e.target.value)}
                placeholder="es. 0.75"
              />
            </div>
            <div>
              <Label>Motivazione della scelta</Label>
              <Textarea
                className="mt-1"
                rows={2}
                value={motivazione}
                onChange={e => setMotivazione(e.target.value)}
                placeholder="Motivazione della scelta del benchmark..."
              />
            </div>
          </CardContent>
        </Card>

        {/* Fattori riduzione PM */}
        <Card className="mb-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Fattori di riduzione della Performance Materiality</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { key: "primo", label: "Primo incarico (nuovo cliente)", note: "-10%", value: primoIncarico, onChange: setPrimoIncarico },
              { key: "errori", label: "Errori rilevati negli anni precedenti", note: "-10%", value: erroriPrec, onChange: setErroriPrec },
              { key: "controlli", label: "Controlli interni deboli / assenti", note: "-5%", value: controlliDeboli, onChange: setControlliDeboli },
            ].map(f => (
              <div key={f.key} className="flex items-center gap-3 p-3 border border-border rounded-lg">
                <Checkbox id={f.key} checked={f.value} onCheckedChange={v => f.onChange(!!v)} />
                <Label htmlFor={f.key} className="flex-1 text-sm cursor-pointer">{f.label}</Label>
                <Badge variant="outline" className="text-xs text-amber-600">{f.note}</Badge>
              </div>
            ))}
            <div className="text-xs text-muted-foreground">
              Fattore di riduzione applicato: <strong>{(fattore * 100).toFixed(0)}%</strong> (base 70%, minimo 50%)
            </div>
          </CardContent>
        </Card>

        {/* Risultati */}
        {om > 0 && (
          <Card className="mb-6 border-primary/20 bg-primary/5">
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-primary">Risultati della materialità</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-3">
                <ValoreCard
                  label="Overall Materiality (OM)"
                  valore={fmt(om)}
                  sub={`${benchmarkPerc}% di ${BENCHMARK_LABELS[benchmarkTipo]}`}
                  highlight
                />
                <ValoreCard
                  label="Performance Materiality (PM)"
                  valore={fmt(pm)}
                  sub={`${(fattore * 100).toFixed(0)}% di OM`}
                />
                <ValoreCard
                  label="Clearly Trivial Threshold (CTT)"
                  valore={fmt(ctt)}
                  sub="5% di OM"
                />
              </div>
              <div className="mt-3 p-3 bg-white/60 rounded-lg text-xs text-muted-foreground">
                <strong>Interpretazione:</strong> Errori superiori a {fmt(om)} sono materiali. Errori tra {fmt(ctt)} e {fmt(pm)} vanno accumulati. Errori inferiori a {fmt(ctt)} sono chiaramente irrilevanti.
              </div>
            </CardContent>
          </Card>
        )}

        {/* Azioni */}
        <div className="flex items-center justify-between">
          <Button variant="outline" onClick={() => navigate(`/incarichi/${incaricoId}/modulo/3`)}>
            <ChevronLeft className="w-4 h-4 mr-1" /> Modulo 3
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => handleSave(false)} disabled={calcola.isPending}>
              {calcola.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Salva bozza
            </Button>
            <Button onClick={() => { handleSave(true); navigate(`/incarichi/${incaricoId}/modulo/5`); }} disabled={calcola.isPending}>
              Completa e vai al Modulo 5 <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      </div>
    </RevisorLayout>
  );
}
