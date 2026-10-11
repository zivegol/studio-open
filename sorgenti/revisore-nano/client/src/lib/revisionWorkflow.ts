export type RevisionPhase = {
  n: number;
  title: string;
  shortTitle: string;
  isa: string;
  description: string;
  href: (incaricoId: number) => string;
};

export const REVISION_PHASES: RevisionPhase[] = [
  { n: 1, title: "Accettazione e mantenimento dell'incarico", shortTitle: "Accettazione incarico", isa: "ISA 210/220", description: "Indipendenza, competenza, integrità, termini e lettera d'incarico", href: id => `/incarichi/${id}/modulo/1` },
  { n: 2, title: "Acquisizione e classificazione documenti", shortTitle: "Documenti", isa: "ISA 230/500", description: "Dossier, completezza, classificazione e fonti", href: id => `/incarichi/${id}#documenti` },
  { n: 3, title: "Analisi preliminare e coerenza storica", shortTitle: "Analisi preliminare", isa: "ISA 315/520", description: "Confronto con i due esercizi precedenti e situazioni infrannuali", href: id => `/incarichi/${id}#analisi-preliminare` },
  { n: 4, title: "Quadrature contabili", shortTitle: "Quadrature", isa: "ISA 500", description: "XBRL, bilanci, partitari e saldi di dettaglio", href: id => `/incarichi/${id}#quadrature` },
  { n: 5, title: "Significatività e valutazione dei rischi", shortTitle: "Rischi e significatività", isa: "ISA 315/320/330", description: "Priorità separate per stato patrimoniale e conto economico", href: id => `/incarichi/${id}/modulo/3` },
  { n: 6, title: "Piano di revisione", shortTitle: "Piano di revisione", isa: "ISA 300", description: "Procedure pianificate per area e risposta ai rischi", href: id => `/incarichi/${id}/modulo/5` },
  { n: 7, title: "Verifiche per area di bilancio", shortTitle: "Verifiche per area", isa: "ISA 330/500", description: "Schede di lavoro e controlli sulle poste significative", href: id => `/incarichi/${id}/piano-controlli` },
  { n: 8, title: "Incassi e pagamenti successivi", shortTitle: "Incassi e pagamenti", isa: "ISA 500/560", description: "Matching automatico delle partite con i movimenti bancari", href: id => `/incarichi/${id}/verifica-incassi` },
  { n: 9, title: "Circolarizzazioni e procedure alternative", shortTitle: "Circolarizzazioni", isa: "ISA 505", description: "Campione, risposte, differenze e procedure alternative", href: id => `/incarichi/${id}/circolarizzazione` },
  { n: 10, title: "Completamento, conclusioni e relazione", shortTitle: "Conclusioni", isa: "ISA 450/700", description: "Eccezioni aperte, riesame e formazione del giudizio", href: id => `/incarichi/${id}#conclusioni` },
];

export function basePhaseStates(incarico: any): number[] {
  if (!incarico) return Array(10).fill(0);
  const risk = incarico.statoModulo3 ?? 0;
  const materiality = incarico.statoModulo4 ?? 0;
  return [
    incarico.statoModulo1 ?? 0,
    incarico.nextcloudFolder ? 2 : 0,
    incarico.statoModulo2 ?? 0,
    0,
    risk === 2 && materiality === 2 ? 2 : Math.max(risk, materiality),
    incarico.statoModulo5 ?? 0,
    0, 0, 0, 0,
  ];
}

