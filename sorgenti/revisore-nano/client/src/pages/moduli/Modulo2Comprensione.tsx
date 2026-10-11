import { useState, useEffect } from "react";
import RevisorLayout from "@/components/revisione/RevisorLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useParams, useLocation } from "wouter";
import { Loader2, Sparkles, ChevronRight, ChevronLeft, Download, Info, TrendingUp, TrendingDown } from "lucide-react";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import { formatCurrency, formatPercent } from "@/lib/utils";

function NumInput({ label, value, onChange, prefix = "€", hint }: { label: string; value: string; onChange: (v: string) => void; prefix?: string; hint?: string }) {
  return (
    <div>
      <Label className="text-sm">{label}</Label>
      {hint && <div className="text-xs text-muted-foreground mb-1">{hint}</div>}
      <div className="relative mt-1">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">{prefix}</span>
        <Input
          type="number"
          className="pl-7"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="0"
        />
      </div>
    </div>
  );
}

function IndiceCard({ label, valore, soglia, inverso = false }: { label: string; valore: number | null; soglia?: number; inverso?: boolean }) {
  if (valore === null) return null;
  const isOk = soglia ? (inverso ? valore <= soglia : valore >= soglia) : true;
  return (
    <div className={`p-3 rounded-lg border ${isOk ? "border-emerald-200 bg-emerald-50/50" : "border-amber-200 bg-amber-50/50"}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold mt-1 ${isOk ? "text-emerald-700" : "text-amber-700"}`}>
        {(valore * 100).toFixed(1)}%
      </div>
    </div>
  );
}

export default function Modulo2Comprensione() {
  const params = useParams<{ id: string }>();
  const incaricoId = parseInt(params.id);
  const [, navigate] = useLocation();

  const { data: modulo, refetch } = trpc.moduli.comprensione.get.useQuery({ incaricoId });
  const { data: documenti } = trpc.documenti.listByIncarico.useQuery({ incaricoId });
  const parsingBilancio = documenti?.some(d =>
    ["bilancio_revisione", "bilancio", "bilancio_storico"].includes(d.tipoDocumento ?? "") &&
    d.statoParsing === "in_corso"
  ) ?? false;
  const { data: datiBilancio, isLoading: loadingBilancio } = trpc.documenti.getDatiBilancioRevisione.useQuery(
    { incaricoId },
    { refetchInterval: parsingBilancio ? 3000 : false }
  );
  const { data: confrontoBilanci } = trpc.documenti.getConfrontoBilanci.useQuery({ incaricoId });
  const [prepopolato, setPrepopolato] = useState(false);
  const save = trpc.moduli.comprensione.save.useMutation({
    onSuccess: () => { refetch(); toast.success("Salvato"); },
    onError: e => toast.error(e.message),
  });
  const sintesiAi = trpc.moduli.comprensione.sintesiAi.useMutation({
    onSuccess: () => { refetch(); toast.success("Sintesi AI generata"); },
    onError: e => toast.error(e.message),
  });
  function prepopolaDaBilancio() {
    if (!datiBilancio?.disponibile || !datiBilancio.dati) return;
    const d = datiBilancio.dati;
    setForm(f => ({
      ...f,
      totaleAttivo: d.totaleAttivo?.toString() || f.totaleAttivo,
      ricaviNetti: d.ricavi?.toString() || f.ricaviNetti,
      patrimonioNetto: d.patrimonioNetto?.toString() || f.patrimonioNetto,
      utilePerditaEsercizio: d.utile?.toString() || f.utilePerditaEsercizio,
      debitiTotali: d.debitiTotali?.toString() || f.debitiTotali,
      disponibilitaLiquide: d.disponibilitaLiquide?.toString() || f.disponibilitaLiquide,
      creditiTotali: d.creditiClienti?.toString() || f.creditiTotali,
      numeroDipendenti: d.dipendenti?.toString() || f.numeroDipendenti,
    }));
    setPrepopolato(true);
    toast.success(`Dati pre-popolati da: ${datiBilancio.nomeFile}`);
  }

  const [form, setForm] = useState({
    totaleAttivo: modulo?.totaleAttivo?.toString() || "",
    ricaviNetti: modulo?.ricaviNetti?.toString() || "",
    patrimonioNetto: modulo?.patrimonioNetto?.toString() || "",
    utilePerditaEsercizio: modulo?.utilePerditaEsercizio?.toString() || "",
    numeroDipendenti: modulo?.numeroDipendenti?.toString() || "",
    debitiTotali: modulo?.debitiTotali?.toString() || "",
    creditiTotali: modulo?.creditiTotali?.toString() || "",
    disponibilitaLiquide: modulo?.disponibilitaLiquide?.toString() || "",
    settoreAttivita: modulo?.settoreAttivita || "",
  });

  useEffect(() => {
    if (!modulo) return;
    setForm(f => ({
      ...f,
      totaleAttivo: modulo.totaleAttivo?.toString() || f.totaleAttivo,
      ricaviNetti: modulo.ricaviNetti?.toString() || f.ricaviNetti,
      patrimonioNetto: modulo.patrimonioNetto?.toString() || f.patrimonioNetto,
      utilePerditaEsercizio: modulo.utilePerditaEsercizio?.toString() || f.utilePerditaEsercizio,
      numeroDipendenti: modulo.numeroDipendenti?.toString() || f.numeroDipendenti,
      debitiTotali: modulo.debitiTotali?.toString() || f.debitiTotali,
      creditiTotali: modulo.creditiTotali?.toString() || f.creditiTotali,
      disponibilitaLiquide: modulo.disponibilitaLiquide?.toString() || f.disponibilitaLiquide,
      settoreAttivita: modulo.settoreAttivita || f.settoreAttivita,
    }));
  }, [modulo]);

  useEffect(() => {
    if (!datiBilancio?.disponibile || !datiBilancio.dati || prepopolato) return;
    const campiBilancioVuoti = [
      form.totaleAttivo,
      form.ricaviNetti,
      form.patrimonioNetto,
      form.utilePerditaEsercizio,
      form.debitiTotali,
      form.creditiTotali,
      form.disponibilitaLiquide,
    ].every(v => !v);
    if (!campiBilancioVuoti) return;

    const d = datiBilancio.dati;
    setForm(f => ({
      ...f,
      totaleAttivo: d.totaleAttivo?.toString() || f.totaleAttivo,
      ricaviNetti: d.ricavi?.toString() || f.ricaviNetti,
      patrimonioNetto: d.patrimonioNetto?.toString() || f.patrimonioNetto,
      utilePerditaEsercizio: d.utile?.toString() || f.utilePerditaEsercizio,
      debitiTotali: d.debitiTotali?.toString() || f.debitiTotali,
      disponibilitaLiquide: d.disponibilitaLiquide?.toString() || f.disponibilitaLiquide,
      creditiTotali: d.creditiClienti?.toString() || f.creditiTotali,
      numeroDipendenti: d.dipendenti?.toString() || f.numeroDipendenti,
    }));
    setPrepopolato(true);
  }, [datiBilancio, form, prepopolato]);

  // Calcola indici
  const attivo = parseFloat(form.totaleAttivo) || 0;
  const ricavi = parseFloat(form.ricaviNetti) || 0;
  const pn = parseFloat(form.patrimonioNetto) || 0;
  const utile = parseFloat(form.utilePerditaEsercizio) || 0;
  const debiti = parseFloat(form.debitiTotali) || 0;

  const indici = {
    adeguatezzaPatrimoniale: debiti > 0 ? pn / debiti : null,
    incidenzaDebiti: attivo > 0 ? debiti / attivo : null,
    redditivita: ricavi > 0 ? utile / ricavi : null,
  };

  // Nano impresa check
  const limiti = [attivo <= 175000, ricavi <= 350000, parseInt(form.numeroDipendenti) <= 5];
  const isNano = limiti.filter(Boolean).length >= 2;

  function handleSave(completato = false) {
    save.mutate({
      incaricoId,
      totaleAttivo: parseFloat(form.totaleAttivo) || undefined,
      ricaviNetti: parseFloat(form.ricaviNetti) || undefined,
      patrimonioNetto: parseFloat(form.patrimonioNetto) || undefined,
      utilePerditaEsercizio: parseFloat(form.utilePerditaEsercizio) || undefined,
      numeroDipendenti: parseInt(form.numeroDipendenti) || undefined,
      debitiTotali: parseFloat(form.debitiTotali) || undefined,
      creditiTotali: parseFloat(form.creditiTotali) || undefined,
      disponibilitaLiquide: parseFloat(form.disponibilitaLiquide) || undefined,
      settoreAttivita: form.settoreAttivita || undefined,
      completato,
    });
  }

  const fmt = (n: string) => formatCurrency(n, { decimali: 0 });

  return (
    <RevisorLayout incaricoId={incaricoId} moduloAttivo={2}>
      <div className="p-6 max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="outline" className="text-xs">ISA Italia 315</Badge>
              {modulo?.completato && <Badge className="bg-emerald-100 text-emerald-700 text-xs">Completato</Badge>}
              {modulo?.isNanoImpresa !== undefined && (
                <Badge className={modulo.isNanoImpresa ? "bg-blue-100 text-blue-700 text-xs" : "bg-gray-100 text-gray-600 text-xs"}>
                  {modulo.isNanoImpresa ? "Nano impresa" : "Non nano impresa"}
                </Badge>
              )}
            </div>
            <h1 className="text-2xl font-bold text-foreground">Modulo 2 — Comprensione dell'impresa</h1>
            <p className="text-muted-foreground mt-1 text-sm">Analisi del contesto aziendale e dei dati economico-patrimoniali</p>
          </div>
        </div>

        {/* Banner pre-popolamento da bilancio */}
        {loadingBilancio ? (
          <div className="flex items-center gap-2 p-3 bg-gray-50 border border-gray-200 rounded-lg mb-6 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Verifica bilancio caricato...
          </div>
        ) : parsingBilancio && !datiBilancio?.disponibile ? (
          <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg mb-6 text-sm text-blue-700">
            <Loader2 className="w-4 h-4 animate-spin" /> Parsing del bilancio in corso: i dati si aggiorneranno automaticamente appena pronti.
          </div>
        ) : datiBilancio?.disponibile ? (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg mb-6">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Download className="w-4 h-4 text-emerald-600" />
                  <span className="text-sm font-medium text-emerald-800">
                    Bilancio disponibile: {datiBilancio.nomeFile}
                    {datiBilancio.annoRiferimento ? ` (${datiBilancio.annoRiferimento})` : ""}
                  </span>
                  {prepopolato && <Badge className="bg-emerald-100 text-emerald-700 text-xs">Pre-popolato</Badge>}
                </div>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  {datiBilancio.dati?.ricavi != null && (
                    <div className="text-xs text-emerald-700"><span className="font-medium">Ricavi:</span> {formatCurrency(datiBilancio.dati.ricavi)}</div>
                  )}
                  {datiBilancio.dati?.totaleAttivo != null && (
                    <div className="text-xs text-emerald-700"><span className="font-medium">Totale attivo:</span> {formatCurrency(datiBilancio.dati.totaleAttivo)}</div>
                  )}
                  {datiBilancio.dati?.patrimonioNetto != null && (
                    <div className="text-xs text-emerald-700"><span className="font-medium">Patr. netto:</span> {formatCurrency(datiBilancio.dati.patrimonioNetto)}</div>
                  )}
                  {datiBilancio.dati?.utile != null && (
                    <div className="text-xs text-emerald-700"><span className="font-medium">Utile/Perdita:</span> {formatCurrency(datiBilancio.dati.utile)}</div>
                  )}
                  {datiBilancio.dati?.debitiTotali != null && (
                    <div className="text-xs text-emerald-700"><span className="font-medium">Debiti totali:</span> {formatCurrency(datiBilancio.dati.debitiTotali)}</div>
                  )}
                  {datiBilancio.dati?.dipendenti != null && (
                    <div className="text-xs text-emerald-700"><span className="font-medium">Dipendenti:</span> {datiBilancio.dati.dipendenti}</div>
                  )}
                </div>
                {datiBilancio.dati?.sintesi && (
                  <div className="text-xs text-emerald-700 mt-2 italic">{datiBilancio.dati.sintesi}</div>
                )}
              </div>
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white shrink-0"
                onClick={prepopolaDaBilancio}>
                <Download className="w-4 h-4 mr-1" />
                {prepopolato ? "Ri-applica" : "Pre-popola campi"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg mb-6">
            <Info className="w-4 h-4 text-amber-500 flex-shrink-0" />
            <div className="flex-1 text-sm text-amber-700">
              Nessun bilancio analizzato trovato. Carica il bilancio oggetto di revisione nel fascicolo per pre-popolare automaticamente i campi.
            </div>
          </div>
        )}

        {/* Dati bilancio */}
        <Card className="mb-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Dati economico-patrimoniali principali</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <NumInput label="Totale attivo" value={form.totaleAttivo} onChange={v => setForm(f => ({ ...f, totaleAttivo: v }))} hint="Stato patrimoniale" />
              <NumInput label="Ricavi netti" value={form.ricaviNetti} onChange={v => setForm(f => ({ ...f, ricaviNetti: v }))} hint="Conto economico" />
              <NumInput label="Patrimonio netto" value={form.patrimonioNetto} onChange={v => setForm(f => ({ ...f, patrimonioNetto: v }))} />
              <NumInput label="Utile / Perdita" value={form.utilePerditaEsercizio} onChange={v => setForm(f => ({ ...f, utilePerditaEsercizio: v }))} hint="Negativo = perdita" />
              <NumInput label="Debiti totali" value={form.debitiTotali} onChange={v => setForm(f => ({ ...f, debitiTotali: v }))} />
              <NumInput label="Crediti totali" value={form.creditiTotali} onChange={v => setForm(f => ({ ...f, creditiTotali: v }))} />
              <NumInput label="Disponibilità liquide" value={form.disponibilitaLiquide} onChange={v => setForm(f => ({ ...f, disponibilitaLiquide: v }))} />
              <NumInput label="N. dipendenti" value={form.numeroDipendenti} onChange={v => setForm(f => ({ ...f, numeroDipendenti: v }))} prefix="#" hint="Media annua" />
            </div>
          </CardContent>
        </Card>

        {/* Nano impresa check */}
        {(form.totaleAttivo || form.ricaviNetti || form.numeroDipendenti) && (
          <Card className={`mb-4 ${isNano ? "border-blue-200 bg-blue-50/30" : "border-gray-200"}`}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="font-medium text-sm">Classificazione nano impresa (art. 2435-ter c.c.)</span>
                <Badge className={isNano ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"}>
                  {isNano ? "✓ Nano impresa" : "Non nano impresa"}
                </Badge>
              </div>
              <div className="grid grid-cols-3 gap-3 text-xs">
                {[
                  { label: "Totale attivo ≤ 175.000 €", ok: limiti[0], val: fmt(form.totaleAttivo) },
                  { label: "Ricavi ≤ 350.000 €", ok: limiti[1], val: fmt(form.ricaviNetti) },
                  { label: "Dipendenti ≤ 5", ok: limiti[2], val: form.numeroDipendenti || "—" },
                ].map((l, i) => (
                  <div key={i} className={`p-2 rounded border ${l.ok ? "border-emerald-200 bg-emerald-50" : "border-gray-200 bg-white"}`}>
                    <div className={l.ok ? "text-emerald-700" : "text-gray-500"}>{l.ok ? "✓" : "✗"} {l.label}</div>
                    <div className="font-medium mt-0.5">{l.val}</div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-2">Almeno 2 su 3 limiti devono essere rispettati per qualificarsi come nano impresa.</p>
            </CardContent>
          </Card>
        )}

        {/* Indici */}
        {(indici.adeguatezzaPatrimoniale !== null || indici.incidenzaDebiti !== null || indici.redditivita !== null) && (
          <Card className="mb-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Indici di bilancio calcolati</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-3">
                <IndiceCard label="Adeguatezza patrimoniale (PN/Debiti)" valore={indici.adeguatezzaPatrimoniale} soglia={0.2} />
                <IndiceCard label="Incidenza debiti su attivo" valore={indici.incidenzaDebiti} soglia={0.8} inverso />
                <IndiceCard label="Redditività vendite (Utile/Ricavi)" valore={indici.redditivita} />
              </div>
              {utile < 0 && (
                <div className="flex items-center gap-2 mt-3 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                  <TrendingDown className="w-4 h-4" />
                  Perdita di esercizio rilevata. Valutare la continuità aziendale (ISA Italia 570).
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Analisi Pluriennale */}
        {confrontoBilanci?.disponibile && confrontoBilanci.estratti && confrontoBilanci.estratti.length >= 2 && (
          <Card className="mb-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-blue-500" />
                Analisi pluriennale — Confronto bilanci
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 pr-4 font-semibold text-muted-foreground">Voce</th>
                      {confrontoBilanci.estratti.map((b, i) => (
                        <th key={i} className="text-right py-2 px-3 font-semibold">
                          {b.anno ?? "N/D"}
                          {b.tipo === "bilancio_revisione" && <span className="ml-1 text-indigo-600">(rev.)</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {([
                      { key: "ricavi", label: "Ricavi" },
                      { key: "totaleAttivo", label: "Totale attivo" },
                      { key: "patrimonioNetto", label: "Patrimonio netto" },
                      { key: "utile", label: "Utile / Perdita" },
                      { key: "debitiTotali", label: "Debiti totali" },
                    ] as { key: keyof typeof confrontoBilanci.estratti[0]; label: string }[]).map(({ key, label }) => (
                      <tr key={key as string} className="border-b border-border/50 hover:bg-muted/30">
                        <td className="py-2 pr-4 font-medium text-foreground">{label}</td>
                        {confrontoBilanci.estratti!.map((b, i) => {
                          const val = b[key] as number | null;
                          const conf = confrontoBilanci.confronto?.[key as string];
                          const dp = conf?.[i]?.deltaPerc;
                          const isPositive = dp !== null && dp !== undefined && dp > 0;
                          const isNegative = dp !== null && dp !== undefined && dp < 0;
                          const isUtile = key === "utile";
                          return (
                            <td key={i} className="text-right py-2 px-3">
                              <div className="font-medium">
                                {val !== null ? formatCurrency(val, { decimali: 0 }) : "—"}
                              </div>
                              {i > 0 && dp !== null && dp !== undefined && (
                                <div className={`text-xs flex items-center justify-end gap-0.5 ${
                                  isUtile
                                    ? (isPositive ? "text-emerald-600" : isNegative ? "text-red-500" : "text-muted-foreground")
                                    : (key === "debitiTotali"
                                      ? (isPositive ? "text-red-500" : isNegative ? "text-emerald-600" : "text-muted-foreground")
                                      : (isPositive ? "text-emerald-600" : isNegative ? "text-red-500" : "text-muted-foreground"))
                                }`}>
                                  {isPositive ? <TrendingUp className="w-3 h-3" /> : isNegative ? <TrendingDown className="w-3 h-3" /> : null}
                                  {formatPercent(dp)}
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                Confronto basato su {confrontoBilanci.estratti.length} bilanci caricati. Le variazioni % sono calcolate rispetto all'anno precedente.
                {confrontoBilanci.estratti.some(b => b.tipo === "bilancio_revisione") && " Il bilancio oggetto di revisione è indicato con (rev.)."}
              </p>
            </CardContent>
          </Card>
        )}

        {/* AI Sintesi */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-500" />
                Sintesi AI del contesto aziendale
              </CardTitle>
              <Button size="sm" variant="outline" onClick={() => sintesiAi.mutate({ incaricoId })} disabled={sintesiAi.isPending}>
                {sintesiAi.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Sparkles className="w-4 h-4 mr-1" />}
                {modulo?.sintesiAi ? "Rigenera" : "Genera sintesi"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {sintesiAi.isPending ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="w-4 h-4 animate-spin" /> Generazione in corso...
              </div>
            ) : modulo?.sintesiAi ? (
              <div className="prose prose-sm max-w-none text-foreground">
                <Streamdown>{modulo.sintesiAi}</Streamdown>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Genera una sintesi AI del contesto aziendale basata sui dati inseriti e sui documenti caricati.</p>
            )}
          </CardContent>
        </Card>

        {/* Azioni */}
        <div className="flex items-center justify-between">
          <Button variant="outline" onClick={() => navigate(`/incarichi/${incaricoId}/modulo/1`)}>
            <ChevronLeft className="w-4 h-4 mr-1" /> Modulo 1
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => handleSave(false)} disabled={save.isPending}>
              {save.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Salva bozza
            </Button>
            <Button onClick={() => { handleSave(true); navigate(`/incarichi/${incaricoId}/modulo/3`); }} disabled={save.isPending}>
              Completa e vai al Modulo 3 <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      </div>
    </RevisorLayout>
  );
}
