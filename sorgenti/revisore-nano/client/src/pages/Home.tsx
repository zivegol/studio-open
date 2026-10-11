import RevisorLayout from "@/components/revisione/RevisorLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Users, FileText, CheckCircle, Clock, AlertTriangle, Plus, ArrowRight } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";

function StatoModuloBadge({ stato }: { stato: number }) {
  if (stato === 2) return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-xs">Completato</Badge>;
  if (stato === 1) return <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-xs">In corso</Badge>;
  return <Badge variant="outline" className="text-gray-500 text-xs">Da iniziare</Badge>;
}

export default function Home() {
  const { isAuthenticated } = useAuth();
  const { data: incarichi, isLoading } = trpc.incarichi.listAll.useQuery(undefined, { enabled: isAuthenticated });
  const { data: clienti } = trpc.clienti.list.useQuery(undefined, { enabled: isAuthenticated });

  const incarichiInCorso = incarichi?.filter(i => i.stato === "in_corso" || i.stato === "bozza") || [];
  const incarichiCompletati = incarichi?.filter(i => i.stato === "completato") || [];

  return (
    <RevisorLayout>
      <div className="p-6 max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Panoramica degli incarichi di revisione legale</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <Card>
            <CardContent className="p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                <Users className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <div className="text-2xl font-bold text-foreground">{clienti?.length || 0}</div>
                <div className="text-sm text-muted-foreground">Clienti</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center">
                <Clock className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <div className="text-2xl font-bold text-foreground">{incarichiInCorso.length}</div>
                <div className="text-sm text-muted-foreground">Incarichi attivi</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center">
                <CheckCircle className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <div className="text-2xl font-bold text-foreground">{incarichiCompletati.length}</div>
                <div className="text-sm text-muted-foreground">Completati</div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Incarichi attivi */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground">Incarichi attivi</h2>
            <Button asChild variant="outline" size="sm">
              <Link href="/clienti">
                <Plus className="w-4 h-4 mr-1" /> Nuovo incarico
              </Link>
            </Button>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-20 bg-muted rounded-lg animate-pulse" />
              ))}
            </div>
          ) : incarichiInCorso.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">Nessun incarico attivo.</p>
                <Button asChild className="mt-4" size="sm">
                  <Link href="/clienti">Crea il primo incarico</Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {incarichiInCorso.map(incarico => {
                const moduli = [
                  incarico.statoModulo1 ?? 0,
                  incarico.statoModulo2 ?? 0,
                  incarico.statoModulo3 ?? 0,
                  incarico.statoModulo4 ?? 0,
                  incarico.statoModulo5 ?? 0,
                ];
                const completati = moduli.filter(s => s === 2).length;
                const progressPct = (completati / 5) * 100;

                return (
                  <Link key={incarico.id} href={`/incarichi/${incarico.id}`}>
                    <Card className="cursor-pointer hover:shadow-md transition-shadow">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium text-foreground truncate">
                                Incarico #{incarico.id} — {incarico.annoEsercizio}
                              </span>
                              <StatoModuloBadge stato={incarico.stato === "completato" ? 2 : incarico.stato === "in_corso" ? 1 : 0} />
                            </div>
                            <div className="flex items-center gap-4 mt-2">
                              <div className="flex-1">
                                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                                  <span>Avanzamento fascicolo</span>
                                  <span>{completati}/5 moduli</span>
                                </div>
                                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-primary rounded-full transition-all"
                                    style={{ width: `${progressPct}%` }}
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                          <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-1" />
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Link clienti */}
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Users className="w-5 h-5 text-primary" />
              <div>
                <div className="font-medium text-foreground">Gestione clienti</div>
                <div className="text-sm text-muted-foreground">Anagrafica e incarichi per cliente</div>
              </div>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/clienti">
                Vai ai clienti <ArrowRight className="w-4 h-4 ml-1" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </RevisorLayout>
  );
}
