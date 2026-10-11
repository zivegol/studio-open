import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import RevisorLayout from "@/components/revisione/RevisorLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, BarChart3, TrendingUp, AlertTriangle } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

// ─── COLORI PER GRUPPO ────────────────────────────────────────────────────────

const COLORI_GRUPPO: Record<string, string> = {
  "Attivo immobilizzato": "bg-blue-500",
  "Attivo circolante": "bg-cyan-500",
  "Patrimonio netto": "bg-emerald-500",
  "Passivo": "bg-rose-500",
  "Valore della produzione": "bg-violet-500",
  "Costi della produzione": "bg-orange-500",
  "Proventi e oneri finanziari": "bg-amber-500",
  "Imposte": "bg-slate-500",
  "Risultato": "bg-teal-500",
};

const COLORI_TESTO: Record<string, string> = {
  "Attivo immobilizzato": "text-blue-700 bg-blue-50",
  "Attivo circolante": "text-cyan-700 bg-cyan-50",
  "Patrimonio netto": "text-emerald-700 bg-emerald-50",
  "Passivo": "text-rose-700 bg-rose-50",
  "Valore della produzione": "text-violet-700 bg-violet-50",
  "Costi della produzione": "text-orange-700 bg-orange-50",
  "Proventi e oneri finanziari": "text-amber-700 bg-amber-50",
  "Imposte": "text-slate-700 bg-slate-50",
  "Risultato": "text-teal-700 bg-teal-50",
};

// ─── SOGLIA RILEVANZA ─────────────────────────────────────────────────────────
// Voci con peso > 20% = alta rilevanza, > 10% = media, < 5% = bassa
function livelloRilevanza(perc: number | null): "alta" | "media" | "bassa" {
  if (perc == null) return "bassa";
  if (perc >= 20) return "alta";
  if (perc >= 10) return "media";
  return "bassa";
}

// ─── COMPONENTE BARRA ─────────────────────────────────────────────────────────

function BarraVoce({
  label,
  valore,
  peso,
  gruppo,
  totaleLabel,
}: {
  label: string;
  valore: number | null;
  peso: number | null;
  gruppo: string;
  totaleLabel: string;
}) {
  const rilevanza = livelloRilevanza(peso);
  const colore = COLORI_GRUPPO[gruppo] ?? "bg-slate-400";
  const larghezza = Math.min(peso ?? 0, 100);

  return (
    <div className="flex items-center gap-3 py-1.5 group">
      {/* Etichetta */}
      <div className="w-52 shrink-0">
        <div className="flex items-center gap-1.5">
          {rilevanza === "alta" && (
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          )}
          <span className={`text-xs font-medium ${rilevanza === "alta" ? "text-slate-800" : "text-slate-600"}`}>
            {label}
          </span>
        </div>
      </div>

      {/* Barra */}
      <div className="flex-1 relative h-5 bg-slate-100 rounded overflow-hidden">
        <div
          className={`h-full ${colore} transition-all duration-500 rounded`}
          style={{ width: `${larghezza}%` }}
        />
        {peso != null && peso > 3 && (
          <span className="absolute inset-0 flex items-center pl-2 text-white text-xs font-semibold">
            {peso.toFixed(1)}%
          </span>
        )}
      </div>

      {/* Percentuale esterna (per barre piccole) */}
      {(peso == null || peso <= 3) && (
        <span className="text-xs text-slate-500 w-12 text-right">
          {peso != null ? `${peso.toFixed(1)}%` : "—"}
        </span>
      )}
      {peso != null && peso > 3 && <span className="w-12" />}

      {/* Importo */}
      <div className="w-28 text-right shrink-0">
        <span className="text-xs text-slate-700 font-mono">
          {valore != null ? formatCurrency(valore) : "—"}
        </span>
      </div>

      {/* Badge rilevanza */}
      <div className="w-16 shrink-0">
        {rilevanza === "alta" && (
          <Badge className="text-xs bg-amber-100 text-amber-700 border-amber-200">Alta</Badge>
        )}
        {rilevanza === "media" && (
          <Badge className="text-xs bg-blue-50 text-blue-600 border-blue-200">Media</Badge>
        )}
      </div>
    </div>
  );
}

// ─── COMPONENTE PRINCIPALE ────────────────────────────────────────────────────

export default function AnalisiVerticale() {
  const { id } = useParams<{ id: string }>();
  const incaricoId = parseInt(id);
  const [, navigate] = useLocation();

  const { data, isLoading } = trpc.documenti.getAnalisiVerticale.useQuery({ incaricoId });

  // Raggruppa le voci per gruppo
  function raggruppa<T extends { gruppo: string }>(voci: T[]): Record<string, T[]> {
    return voci.reduce((acc, v) => {
      if (!acc[v.gruppo]) acc[v.gruppo] = [];
      acc[v.gruppo].push(v);
      return acc;
    }, {} as Record<string, T[]>);
  }

  return (
    <RevisorLayout incaricoId={incaricoId}>
      <div className="max-w-5xl mx-auto space-y-6 pb-12">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/incarichi/${incaricoId}`)}>
            <ChevronLeft className="w-4 h-4 mr-1" /> Fascicolo
          </Button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-blue-600" />
              Analisi Verticale del Bilancio
            </h1>
            <p className="text-sm text-slate-500">
              Peso % di ogni voce sul totale attivo (SP) e sui ricavi (CE)
            </p>
          </div>
        </div>

        {isLoading && (
          <Card>
            <CardContent className="py-12 text-center text-slate-500">
              Caricamento analisi verticale...
            </CardContent>
          </Card>
        )}

        {!isLoading && (!data || !data.disponibile) && (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="py-8 text-center">
              <BarChart3 className="w-10 h-10 text-amber-400 mx-auto mb-3" />
              <p className="text-amber-800 font-medium">Nessun bilancio disponibile</p>
              <p className="text-amber-600 text-sm mt-1">
                Carica un bilancio (PDF o Excel) nel fascicolo per visualizzare l'analisi verticale.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => navigate(`/incarichi/${incaricoId}`)}
              >
                Vai al fascicolo
              </Button>
            </CardContent>
          </Card>
        )}

        {data?.disponibile && (
          <>
            {/* Riepilogo */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card className="bg-blue-50 border-blue-200">
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-blue-600 font-medium">Totale Attivo</p>
                  <p className="text-lg font-bold text-blue-800 font-mono">
                    {formatCurrency(data.totaleAttivo)}
                  </p>
                </CardContent>
              </Card>
              <Card className="bg-violet-50 border-violet-200">
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-violet-600 font-medium">Totale Ricavi</p>
                  <p className="text-lg font-bold text-violet-800 font-mono">
                    {formatCurrency(data.totaleRicavi)}
                  </p>
                </CardContent>
              </Card>
              <Card className="bg-slate-50 border-slate-200">
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-slate-600 font-medium">Bilancio</p>
                  <p className="text-sm font-semibold text-slate-800 truncate">{data.nomeFile}</p>
                </CardContent>
              </Card>
              <Card className="bg-slate-50 border-slate-200">
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-slate-600 font-medium">Anno</p>
                  <p className="text-lg font-bold text-slate-800">{data.annoRiferimento ?? "—"}</p>
                </CardContent>
              </Card>
            </div>

            {/* Legenda rilevanza */}
            <div className="flex items-center gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                <Badge className="text-xs bg-amber-100 text-amber-700 border-amber-200">Alta</Badge>
                ≥ 20% del totale — priorità di controllo elevata
              </span>
              <span className="flex items-center gap-1">
                <Badge className="text-xs bg-blue-50 text-blue-600 border-blue-200">Media</Badge>
                10–20% — controllo standard
              </span>
              <span className="text-slate-400">Senza badge: &lt; 10% — bassa rilevanza</span>
            </div>

            {/* STATO PATRIMONIALE */}
            {data.sp && data.sp.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-blue-600" />
                    Stato Patrimoniale — peso % su Totale Attivo ({formatCurrency(data.totaleAttivo)})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {Object.entries(raggruppa(data.sp)).map(([gruppo, voci]) => (
                    <div key={gruppo}>
                      <div className={`inline-block px-2 py-0.5 rounded text-xs font-semibold mb-2 ${COLORI_TESTO[gruppo] ?? "text-slate-700 bg-slate-100"}`}>
                        {gruppo}
                      </div>
                      <div className="space-y-0.5 pl-2 border-l-2 border-slate-100">
                        {voci.map(v => (
                          <BarraVoce
                            key={v.chiave}
                            label={v.label}
                            valore={v.valore}
                            peso={v.pesoSuTotaleAttivo}
                            gruppo={v.gruppo}
                            totaleLabel="Totale attivo"
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* CONTO ECONOMICO */}
            {data.ce && data.ce.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-violet-600" />
                    Conto Economico — peso % su Ricavi ({formatCurrency(data.totaleRicavi)})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {Object.entries(raggruppa(data.ce)).map(([gruppo, voci]) => (
                    <div key={gruppo}>
                      <div className={`inline-block px-2 py-0.5 rounded text-xs font-semibold mb-2 ${COLORI_TESTO[gruppo] ?? "text-slate-700 bg-slate-100"}`}>
                        {gruppo}
                      </div>
                      <div className="space-y-0.5 pl-2 border-l-2 border-slate-100">
                        {voci.map(v => (
                          <BarraVoce
                            key={v.chiave}
                            label={v.label}
                            valore={v.valore}
                            peso={v.pesoSuRicavi}
                            gruppo={v.gruppo}
                            totaleLabel="Ricavi"
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Nota metodologica */}
            <Card className="bg-slate-50 border-slate-200">
              <CardContent className="py-3">
                <p className="text-xs text-slate-500">
                  <strong>Nota metodologica:</strong> L'analisi verticale (o analisi per indici di composizione) esprime ogni voce di bilancio come percentuale del totale di riferimento.
                  Per lo Stato Patrimoniale il riferimento è il totale attivo; per il Conto Economico i ricavi netti.
                  Le voci con peso ≥ 20% sono evidenziate come priorità di controllo in conformità con ISA Italia 315 (identificazione e valutazione dei rischi).
                  I dati sono estratti automaticamente dal bilancio caricato — verificare la corrispondenza con il documento originale.
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </RevisorLayout>
  );
}
