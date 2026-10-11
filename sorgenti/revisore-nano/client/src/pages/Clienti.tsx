import { useState } from "react";
import RevisorLayout from "@/components/revisione/RevisorLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Link, useLocation } from "wouter";
import { Plus, Building2, ArrowRight, Search, Trash2, FolderOpen, Loader2, CheckCircle, ChevronRight, ChevronUp } from "lucide-react";
import { toast } from "sonner";

export default function Clienti() {
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [folder, setFolder] = useState("Revisioni/");
  const [browseFolder, setBrowseFolder] = useState("Revisioni");
  const [selectedYear, setSelectedYear] = useState("");
  const [folderAnalysis, setFolderAnalysis] = useState<any>(null);

  const { data: clienti, isLoading, refetch } = trpc.clienti.list.useQuery();
  const { data: folderListing, isLoading: loadingFolders, error: folderError } = trpc.clienti.browseFolders.useQuery(
    { folder: browseFolder },
    { enabled: open }
  );
  const analyzeFolder = trpc.clienti.analyzeFolder.useMutation({
    onSuccess: data => {
      setFolderAnalysis(data);
      setSelectedYear(String(data.years[0] ?? new Date().getFullYear() - 1));
      toast.success(`${data.profile.ragioneSociale} identificata`);
    },
    onError: (e) => toast.error(e.message),
  });
  const createFromFolder = trpc.clienti.createFromFolder.useMutation({
    onSuccess: data => {
      refetch();
      setOpen(false);
      setFolder("Revisioni/");
      setFolderAnalysis(null);
      toast.success("Cliente e fascicolo creati dalla cartella Revisioni");
      navigate(`/incarichi/${data.incarico.id}`);
    },
    onError: e => toast.error(e.message),
  });
  const deleteCliente = trpc.clienti.delete.useMutation({
    onSuccess: () => { refetch(); toast.success("Cliente eliminato"); },
    onError: (e) => toast.error(e.message),
  });

  function confermaEliminaCliente(id: number, ragioneSociale: string) {
    const conferma = window.confirm(
      `Eliminare il cliente "${ragioneSociale}"?\n\nL'eliminazione e' consentita solo se non ci sono incarichi collegati.`
    );
    if (conferma) deleteCliente.mutate({ id });
  }

  const filtered = (clienti || []).filter(c =>
    c.ragioneSociale.toLowerCase().includes(search.toLowerCase()) ||
    (c.codiceFiscale || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <RevisorLayout>
      <div className="p-6 max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Clienti</h1>
            <p className="text-muted-foreground mt-1">Anagrafica clienti e gestione incarichi</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="w-4 h-4 mr-2" />Nuovo cliente</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Nuovo cliente</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-2">
                <p className="text-sm text-muted-foreground">
                  Indica soltanto la cartella individuale della società. L'app leggerà visura, atti, nomina e bilanci per costruire l'anagrafica e proporti l'esercizio da aprire.
                </p>
                <div>
                  <Label>Seleziona la cartella della società</Label>
                  <div className="mt-1 rounded-lg border overflow-hidden">
                    <div className="px-3 py-2 bg-muted/50 border-b flex items-center gap-2">
                      <FolderOpen className="w-4 h-4 text-blue-600" />
                      <span className="text-sm font-medium truncate flex-1">/{folderListing?.folder ?? browseFolder}</span>
                      {folderListing?.parent && (
                        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => { setBrowseFolder(folderListing.parent!); setFolderAnalysis(null); }}>
                          <ChevronUp className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                    <div className="max-h-56 overflow-auto divide-y">
                      {loadingFolders && <div className="p-4 text-sm text-muted-foreground flex items-center"><Loader2 className="w-4 h-4 mr-2 animate-spin" />Caricamento cartelle…</div>}
                      {folderError && <div className="p-3 text-sm text-destructive">{folderError.message}</div>}
                      {!loadingFolders && !folderError && folderListing?.folders.map(item => (
                        <button
                          type="button"
                          key={item.path}
                          className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-muted/60"
                          onClick={() => { setBrowseFolder(item.path); setFolderAnalysis(null); }}
                        >
                          <FolderOpen className="w-4 h-4 text-amber-500" />
                          <span className="text-sm flex-1 truncate">{item.name}</span>
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        </button>
                      ))}
                      {!loadingFolders && !folderError && folderListing?.folders.length === 0 && (
                        <div className="p-3 text-sm text-muted-foreground">Nessuna sottocartella.</div>
                      )}
                    </div>
                    <div className="p-2 border-t bg-background">
                      <Button
                        className="w-full"
                        variant={folder === browseFolder ? "default" : "outline"}
                        disabled={analyzeFolder.isPending || loadingFolders || !!folderError}
                        onClick={() => { setFolder(browseFolder); setFolderAnalysis(null); analyzeFolder.mutate({ folder: browseFolder }); }}
                      >
                        {analyzeFolder.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-2" />}
                        Seleziona questa cartella e analizza
                      </Button>
                    </div>
                  </div>
                </div>
                {folderAnalysis && (
                  <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
                    <div className="flex items-start gap-2">
                      <CheckCircle className="w-5 h-5 text-emerald-600 mt-0.5" />
                      <div>
                        <p className="font-semibold">{folderAnalysis.profile.ragioneSociale}</p>
                        <p className="text-xs text-muted-foreground">
                          CF {folderAnalysis.profile.codiceFiscale || "non rilevato"} · P.IVA {folderAnalysis.profile.partitaIva || "non rilevata"}
                        </p>
                        <p className="text-xs text-muted-foreground">Fonte: {folderAnalysis.identitySource} · {folderAnalysis.totalFiles} documenti trovati</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(folderAnalysis.categories).map(([key, value]) => (
                        <Badge key={key} variant="outline" className="text-xs">{key}: {String(value)}</Badge>
                      ))}
                    </div>
                    <div>
                      <Label>Quale fascicolo vuoi aprire?</Label>
                      <Select value={selectedYear} onValueChange={setSelectedYear}>
                        <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(folderAnalysis.years.length ? folderAnalysis.years : [new Date().getFullYear() - 1]).map((year: number) => (
                            <SelectItem key={year} value={String(year)}>Esercizio {year}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button className="w-full" disabled={!selectedYear || createFromFolder.isPending} onClick={() => createFromFolder.mutate({ folder, annoEsercizio: Number(selectedYear), tipoIncarico: "revisione_legale" })}>
                      {createFromFolder.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                      Crea cliente e apri fascicolo
                    </Button>
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Cerca per ragione sociale o codice fiscale..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {isLoading ? (
          <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />)}</div>
        ) : filtered.length === 0 ? (
          <Card><CardContent className="p-8 text-center">
            <Building2 className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">{search ? "Nessun cliente trovato." : "Nessun cliente ancora. Crea il primo."}</p>
          </CardContent></Card>
        ) : (
          <div className="space-y-2">
            {filtered.map(c => (
              <Link key={c.id} href={`/clienti/${c.id}`}>
                <Card className="cursor-pointer hover:shadow-md transition-shadow">
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-bold text-sm flex-shrink-0">
                        {c.ragioneSociale.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-medium text-foreground">{c.ragioneSociale}</div>
                        <div className="text-sm text-muted-foreground flex items-center gap-2">
                          {c.formaGiuridica && <Badge variant="outline" className="text-xs">{c.formaGiuridica.toUpperCase()}</Badge>}
                          {c.settore && <span>{c.settore}</span>}
                          {c.comune && <span>· {c.comune}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        disabled={deleteCliente.isPending}
                        title="Elimina cliente"
                        onClick={e => {
                          e.preventDefault();
                          e.stopPropagation();
                          confermaEliminaCliente(c.id, c.ragioneSociale);
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                      <ArrowRight className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </RevisorLayout>
  );
}
