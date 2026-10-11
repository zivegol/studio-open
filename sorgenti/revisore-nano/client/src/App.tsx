import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Clienti from "./pages/Clienti";
import ClienteDettaglio from "./pages/ClienteDettaglio";
import IncaricoDettaglio from "./pages/IncaricoDettaglio";
import Modulo1 from "./pages/moduli/Modulo1Accettazione";
import Modulo2 from "./pages/moduli/Modulo2Comprensione";
import Modulo3 from "./pages/moduli/Modulo3Rischio";
import Modulo4 from "./pages/moduli/Modulo4Materialita";
import Modulo5 from "./pages/moduli/Modulo5Piano";
import Circolarizzazione from "./pages/Circolarizzazione";
import VerificaIncassi from "./pages/VerificaIncassi";
import SchedaRimanenze from "./pages/SchedaRimanenze";
import SchedaImmobilizzazioni from "./pages/SchedaImmobilizzazioni";
import SchedaDisponibilitaLiquide from "./pages/SchedaDisponibilitaLiquide";
import SchedaPatrimonioNetto from "./pages/SchedaPatrimonioNetto";
import SchedaRicavi from "./pages/SchedaRicavi";
import PianoControlli from "./pages/PianoControlli";
import AnalisiVerticale from "./pages/AnalisiVerticale";
import VerificaRicaviCosti from "./pages/VerificaRicaviCosti";
import RoadmapRevisione from "./pages/RoadmapRevisione";
import WizardRevisione from "./pages/WizardRevisione";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/clienti" component={Clienti} />
      <Route path="/clienti/:id" component={ClienteDettaglio} />
      <Route path="/incarichi/:id" component={IncaricoDettaglio} />
      <Route path="/incarichi/:id/modulo/1" component={Modulo1} />
      <Route path="/incarichi/:id/modulo/2" component={Modulo2} />
      <Route path="/incarichi/:id/modulo/3" component={Modulo3} />
      <Route path="/incarichi/:id/modulo/4" component={Modulo4} />
      <Route path="/incarichi/:id/modulo/5" component={Modulo5} />
      <Route path="/incarichi/:id/circolarizzazione" component={Circolarizzazione} />
      <Route path="/incarichi/:id/verifica-incassi" component={VerificaIncassi} />
      <Route path="/incarichi/:id/scheda-rimanenze" component={SchedaRimanenze} />
      <Route path="/incarichi/:id/scheda-immobilizzazioni" component={SchedaImmobilizzazioni} />
      <Route path="/incarichi/:id/scheda-disponibilita-liquide" component={SchedaDisponibilitaLiquide} />
      <Route path="/incarichi/:id/scheda-patrimonio-netto" component={SchedaPatrimonioNetto} />
      <Route path="/incarichi/:id/scheda-ricavi" component={SchedaRicavi} />
      <Route path="/incarichi/:id/piano-controlli" component={PianoControlli} />
      <Route path="/incarichi/:id/analisi-verticale" component={AnalisiVerticale} />
      <Route path="/incarichi/:id/verifica-ricavi-costi" component={VerificaRicaviCosti} />
      <Route path="/incarichi/:id/roadmap" component={RoadmapRevisione} />
      <Route path="/incarichi/:incaricoId/wizard" component={WizardRevisione} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
