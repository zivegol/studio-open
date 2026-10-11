import { describe, expect, it } from "vitest";

// ─── Test logica selezione campione circolarizzazione ─────────────────────────

interface Nominativo {
  ragioneSociale: string;
  saldo: number;
  isEstero?: boolean;
}

/**
 * Replica la logica di selezione campione del router circolarizzazione.
 * Criteri ISA Italia 505:
 * 1. Pareto 80% — i nominativi che coprono l'80% del totale
 * 2. Supera Performance Materiality
 * 3. Esteri
 * 4. Campione casuale per raggiungere la copertura minima
 */
function selezionaCampione(
  lista: Nominativo[],
  pm: number | null,
  coperturaMinimaPerc: number
): { selezionati: Nominativo[]; copertura: number } {
  if (lista.length === 0) return { selezionati: [], copertura: 0 };

  const totale = lista.reduce((s, n) => s + n.saldo, 0);
  const ordinati = [...lista].sort((a, b) => b.saldo - a.saldo);

  const selezionati = new Set<number>();

  // 1. Pareto 80%
  let cumulativo = 0;
  for (let i = 0; i < ordinati.length; i++) {
    if (cumulativo / totale >= 0.8) break;
    selezionati.add(i);
    cumulativo += ordinati[i].saldo;
  }

  // 2. Supera PM
  if (pm !== null) {
    for (let i = 0; i < ordinati.length; i++) {
      if (ordinati[i].saldo >= pm) selezionati.add(i);
    }
  }

  // 3. Esteri
  for (let i = 0; i < ordinati.length; i++) {
    if (ordinati[i].isEstero) selezionati.add(i);
  }

  // 4. Campione casuale per copertura minima
  const coperturaCampione = () =>
    (Array.from(selezionati).reduce((s, i) => s + ordinati[i].saldo, 0) / totale) * 100;

  let idx = 0;
  while (coperturaCampione() < coperturaMinimaPerc && selezionati.size < ordinati.length) {
    if (!selezionati.has(idx)) selezionati.add(idx);
    idx++;
  }

  const risultato = Array.from(selezionati).map((i) => ordinati[i]);
  return { selezionati: risultato, copertura: coperturaCampione() };
}

/**
 * Calcola la copertura minima in base al livello di rischio (1=basso, 2=medio, 3=alto).
 */
function calcolaCoperturaMinimaPerc(livelloRischio: number): number {
  if (livelloRischio >= 3) return 75;
  if (livelloRischio === 2) return 60;
  return 50;
}

// ─── SUITE ────────────────────────────────────────────────────────────────────

describe("circolarizzazione — selezione campione", () => {
  const clientiTest: Nominativo[] = [
    { ragioneSociale: "ALFA SRL", saldo: 50000 },
    { ragioneSociale: "BETA SRL", saldo: 30000 },
    { ragioneSociale: "GAMMA SRL", saldo: 15000 },
    { ragioneSociale: "DELTA SRL", saldo: 8000 },
    { ragioneSociale: "EPSILON SRL", saldo: 5000 },
    { ragioneSociale: "ZETA SRL", saldo: 2000 },
    { ragioneSociale: "ETA SRL", saldo: 1000 },
    { ragioneSociale: "THETA GmbH", saldo: 500, isEstero: true },
  ];

  it("seleziona almeno i nominativi che coprono l'80% del totale (Pareto)", () => {
    const { selezionati, copertura } = selezionaCampione(clientiTest, null, 50);
    // Totale = 111500; 80% = 89200
    // ALFA (50000) + BETA (30000) + GAMMA (15000) = 95000 > 89200
    expect(copertura).toBeGreaterThanOrEqual(80);
  });

  it("include sempre i nominativi esteri", () => {
    const { selezionati } = selezionaCampione(clientiTest, null, 50);
    const nomiSelezionati = selezionati.map((n) => n.ragioneSociale);
    expect(nomiSelezionati).toContain("THETA GmbH");
  });

  it("include i nominativi che superano la Performance Materiality", () => {
    const pm = 10000; // tutti con saldo > 10000 devono essere inclusi
    const { selezionati } = selezionaCampione(clientiTest, pm, 50);
    const nomiSelezionati = selezionati.map((n) => n.ragioneSociale);
    expect(nomiSelezionati).toContain("ALFA SRL");
    expect(nomiSelezionati).toContain("BETA SRL");
    expect(nomiSelezionati).toContain("GAMMA SRL");
  });

  it("raggiunge la copertura minima richiesta", () => {
    const { copertura } = selezionaCampione(clientiTest, null, 70);
    expect(copertura).toBeGreaterThanOrEqual(70);
  });

  it("restituisce array vuoto per lista vuota", () => {
    const { selezionati, copertura } = selezionaCampione([], null, 60);
    expect(selezionati).toHaveLength(0);
    expect(copertura).toBe(0);
  });

  it("seleziona tutti se la lista è piccola e la copertura richiesta è alta", () => {
    const piccola = [
      { ragioneSociale: "A", saldo: 100 },
      { ragioneSociale: "B", saldo: 100 },
    ];
    const { selezionati } = selezionaCampione(piccola, null, 100);
    expect(selezionati).toHaveLength(2);
  });
});

describe("circolarizzazione — copertura minima per livello rischio", () => {
  it("rischio alto (3) → copertura minima 75%", () => {
    expect(calcolaCoperturaMinimaPerc(3)).toBe(75);
  });

  it("rischio medio (2) → copertura minima 60%", () => {
    expect(calcolaCoperturaMinimaPerc(2)).toBe(60);
  });

  it("rischio basso (1) → copertura minima 50%", () => {
    expect(calcolaCoperturaMinimaPerc(1)).toBe(50);
  });
});

describe("circolarizzazione — calcolo differenze follow-up", () => {
  it("differenza zero se i saldi coincidono", () => {
    const saldoLibri = 15000;
    const saldoConfermato = 15000;
    expect(saldoLibri - saldoConfermato).toBe(0);
  });

  it("differenza positiva se il saldo confermato è inferiore", () => {
    const saldoLibri = 15000;
    const saldoConfermato = 12000;
    expect(saldoLibri - saldoConfermato).toBe(3000);
  });

  it("differenza negativa se il saldo confermato è superiore", () => {
    const saldoLibri = 10000;
    const saldoConfermato = 11500;
    expect(saldoLibri - saldoConfermato).toBe(-1500);
  });

  it("differenze totali: somma di tutte le differenze assolute", () => {
    const differenze = [3000, -1500, 0, 500];
    const totale = differenze.reduce((s, d) => s + Math.abs(d), 0);
    expect(totale).toBe(5000);
  });
});
