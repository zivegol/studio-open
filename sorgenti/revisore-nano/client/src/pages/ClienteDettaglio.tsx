import { useState } from "react";
import RevisorLayout from "@/components/revisione/RevisorLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Link, useLocation, useParams } from "wouter";
import { Plus, ArrowRight, FileText, Building2, Calendar, ChevronLeft, Trash2 } from "lucide-react";
import { toast } from "sonner";

const MODULI_LABELS = ["Accettazione", "Comprensione", "Rischio", "Materialità", "Piano"];

function ProgressModuli({ incarico }: { incarico: any }) {
  const stati = [
    incarico.statoModulo1 ?? 0,
    incarico.statoModulo2 ?? 0,
    incarico.statoModulo3 ?? 0,
    incarico.statoModulo4 ?? 0,
    incarico.statoModulo5 ?? 0,
  ];
  return (
    <div className="flex gap-1 mt-2">
      {stati.map((s, i) => (
        <div
          key={i}
          className={`h-1.5 flex-1 rounded-full ${s === 2 ? "bg-emerald-500" : s === 1 ? "bg-blue-400" : "bg-gray-200"}`}
          title={`${MODULI_LABELS[i]}: ${s === 2 ? "Completato" : s === 1 ? "In corso" : "Da iniziare"}`}
        />
      ))}
    </div>
  );
}

export default function ClienteDettaglio() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const clienteId = parseInt(params.id);
  const [open, setOpen] = useState(false);
  const [anno, setAnno] = useState(new Date().getFullYear().toString());
  const [tipoIncarico, setTipoIncarico] = useState<"revisione_legale" | "revisione_volontaria" | "continuazione">("revisione_legale");

  const { data: cliente } = trpc.clienti.get.useQuery({ id: clienteId });
  const { data: incarichi, isLoading, refetch } = trpc.incarichi.listByCliente.useQuery({ clienteId });

  const createIncarico = trpc.incarichi.create.useMutation({
    onSuccess: () => { refetch(); setOpen(false); toast.success("Incarico creato"); },
    onError: (e) => toast.error(e.message),
  });
  const deleteCliente = trpc.clienti.delete.useMutation({
    onSuccess: () => { toast.success("Cliente eliminato"); navigate("/clienti"); },
    onError: (e) => toast.error(e.message),
  });
  const deleteIncarico = trpc.incarichi.deleteEmpty.useMutation({
    onSuccess: () => { refetch(); toast.success("Incarico vuoto eliminato"); },
    onError: (e) => toast.error(e.message),
  });

  const anni = Array.from({ length: 10 }, (_, i) => (new Date().getFullYear() - i).toString());
  const puoEliminareCliente = !!cliente && !incarichi?.length;

  function confermaEliminaCliente() {
    if (!cliente) return;
    const conferma = window.confirm(
      `Eliminare il cliente "${cliente.ragioneSociale}"?\n\nQuesta operazione e' disponibile solo se non ci sono incarichi collegati.`
    );
    if (conferma) deleteCliente.mutate({ id: cliente.id });
  }

  function confermaEliminaIncarico(incarico: any) {
    const conferma = window.confirm(
      `Eliminare l'incarico ${incarico.id} dell'esercizio ${incarico.annoEsercizio}?\n\nL'operazione è consentita soltanto se il fascicolo è vuoto e in bozza.`
    );
    if (conferma) deleteIncarico.mutate({ id: incarico.id });
  }

  return (
    <RevisorLayout>
      <div className="p-6 max-w-4xl mx-auto">
        {/* Back */}
        <Link href="/clienti">
          <Button variant="ghost" size="sm" className="mb-4 -ml-2 text-muted-foreground">
            <ChevronLeft className="w-4 h-4 mr-1" /> Clienti
          </Button>
        </Link>

        {/* Header cliente */}
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary font-bold text-lg">
              {cliente?.ragioneSociale?.charAt(0)?.toUpperCase() || "?"}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">{cliente?.ragioneSociale || "Caricamento..."}</h1>
              <div className="flex items-center gap-2 mt-1">
                {cliente?.formaGiuridica && <Badge variant="outline" className="text-xs">{cliente.formaGiuridica.toUpperCase()}</Badge>}
                {cliente?.settore && <span className="text-sm text-muted-foreground">{cliente.settore}</span>}
                {cliente?.comune && <span className="text-sm text-muted-foreground">· {cliente.comune}</span>}
              </div>
              {(cliente?.codiceFiscale || cliente?.partitaIva) && (
                <div className="text-xs text-muted-foreground mt-1">
                  {cliente.codiceFiscale && <span>CF: {cliente.codiceFiscale}</span>}
                  {cliente.codiceFiscale && cliente.partitaIva && <span> · </span>}
                  {cliente.partitaIva && <span>P.IVA: {cliente.partitaIva}</span>}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive"
              disabled={!puoEliminareCliente || deleteCliente.isPending}
              onClick={confermaEliminaCliente}
              title={puoEliminareCliente ? "Elimina cliente" : "Prima elimina o archivia gli incarichi collegati"}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Elimina cliente
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="w-4 h-4 mr-2" />Nuovo incarico</Button>
              </DialogTrigger>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Nuovo incarico di revisione</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-2">
                <div>
                  <Label>Anno di esercizio</Label>
                  <Select value={anno} onValueChange={setAnno}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {anni.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Tipo incarico</Label>
                  <Select value={tipoIncarico} onValueChange={v => setTipoIncarico(v as typeof tipoIncarico)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="revisione_legale">Revisione legale</SelectItem>
                      <SelectItem value="revisione_volontaria">Revisione volontaria</SelectItem>
                      <SelectItem value="continuazione">Continuazione incarico</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  className="w-full"
                  disabled={createIncarico.isPending}
                  onClick={() => createIncarico.mutate({ clienteId, annoEsercizio: parseInt(anno), tipoIncarico })}
                >
                  {createIncarico.isPending ? "Creazione..." : "Crea incarico"}
                </Button>
              </div>
            </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Lista incarichi */}
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-3">Incarichi di revisione</h2>
          {isLoading ? (
            <div className="space-y-3">{[1,2].map(i => <div key={i} className="h-20 bg-muted rounded-lg animate-pulse" />)}</div>
          ) : !incarichi?.length ? (
            <Card><CardContent className="p-8 text-center">
              <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">Nessun incarico. Crea il primo incarico di revisione.</p>
            </CardContent></Card>
          ) : (
            <div className="space-y-3">
              {incarichi.map(inc => {
                const stati = [inc.statoModulo1 ?? 0, inc.statoModulo2 ?? 0, inc.statoModulo3 ?? 0, inc.statoModulo4 ?? 0, inc.statoModulo5 ?? 0];
                const completati = stati.filter(s => s === 2).length;
                return (
                  <Link key={inc.id} href={`/incarichi/${inc.id}`}>
                    <Card className="cursor-pointer hover:shadow-md transition-shadow">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <Calendar className="w-4 h-4 text-muted-foreground" />
                              <span className="font-medium text-foreground">Esercizio {inc.annoEsercizio}</span>
                              <Badge variant="outline" className="text-xs capitalize">{inc.tipoIncarico?.replace(/_/g, " ")}</Badge>
                              <Badge className={`text-xs ${inc.stato === "completato" ? "bg-emerald-100 text-emerald-700" : inc.stato === "in_corso" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"}`}>
                                {inc.stato?.replace(/_/g, " ")}
                              </Badge>
                            </div>
                            <div className="mt-2">
                              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                                <span>Avanzamento</span>
                                <span>{completati}/5 moduli completati</span>
                              </div>
                              <ProgressModuli incarico={inc} />
                            </div>
                          </div>
                          <div className="ml-4 flex items-center gap-2 flex-shrink-0">
                            {inc.stato === "bozza" && !inc.nextcloudFolder && [inc.statoModulo1, inc.statoModulo2, inc.statoModulo3, inc.statoModulo4, inc.statoModulo5].every(value => (value ?? 0) === 0) && (
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                                title="Elimina incarico vuoto"
                                disabled={deleteIncarico.isPending}
                                onClick={event => { event.preventDefault(); event.stopPropagation(); confermaEliminaIncarico(inc); }}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
                            <ArrowRight className="w-4 h-4 text-muted-foreground" />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </RevisorLayout>
  );
}
