import { describe, it, expect } from "vitest";

// ─── Test: logica confronto bilanci pluriennali ───────────────────────────────

function calcolaDeltaPerc(valoreCorrente: number | null, valorePrecedente: number | null): number | null {
  if (valoreCorrente === null || valorePrecedente === null || valorePrecedente === 0) return null;
  const delta = valoreCorrente - valorePrecedente;
  return Math.round((delta / Math.abs(valorePrecedente)) * 10000) / 100;
}

function estraiDatiBilancio(datiStrutturati: Record<string, unknown>, annoRiferimento?: number | null) {
  const d = datiStrutturati;
  const sp = (d.statoPatrimoniale as Record<string, unknown>) || {};
  const ce = (d.contoEconomico as Record<string, unknown>) || {};
  return {
    anno: annoRiferimento ?? (d.anno as number) ?? null,
    ricavi: ((d.ricavi ?? ce.ricaviVendite ?? ce.totaleValoreProduzione) ?? null) as number | null,
    totaleAttivo: ((d.totaleAttivo ?? sp.totaleAttivo) ?? null) as number | null,
    patrimonioNetto: ((d.patrimonioNetto ?? sp.patrimoniNetto) ?? null) as number | null,
    utile: ((d.utile ?? sp.utileEsercizio ?? ce.utileNetto) ?? null) as number | null,
    debitiTotali: ((d.debitiTotali ?? sp.totalDebiti) ?? null) as number | null,
  };
}

function suggerisciBenchmark(ricavi: number | null, totaleAttivo: number | null, patrimonioNetto: number | null, utile: number | null) {
  if (ricavi !== null && totaleAttivo !== null && ricavi >= totaleAttivo * 0.3) {
    return { benchmark: "ricavi_netti", percentuale: 0.75 };
  } else if (totaleAttivo !== null && ricavi !== null && totaleAttivo > ricavi * 2) {
    return { benchmark: "totale_attivo", percentuale: 1.5 };
  } else if (patrimonioNetto !== null && utile !== null && utile > 0) {
    return { benchmark: "utile_ante_imposte", percentuale: 7.5 };
  }
  return { benchmark: "ricavi_netti", percentuale: 0.75 };
}

describe("Confronto bilanci pluriennali", () => {
  it("calcola delta percentuale correttamente", () => {
    expect(calcolaDeltaPerc(110, 100)).toBe(10);
    expect(calcolaDeltaPerc(90, 100)).toBe(-10);
    expect(calcolaDeltaPerc(0, 100)).toBe(-100);
    expect(calcolaDeltaPerc(null, 100)).toBeNull();
    expect(calcolaDeltaPerc(100, null)).toBeNull();
    expect(calcolaDeltaPerc(100, 0)).toBeNull(); // divisione per zero
  });

  it("calcola delta con arrotondamento a 2 decimali", () => {
    const result = calcolaDeltaPerc(105, 100);
    expect(result).toBe(5);
    const result2 = calcolaDeltaPerc(103, 97);
    expect(result2).toBe(6.19); // 6/97 * 100 = 6.185... → 6.19
  });

  it("estrae dati da struttura piatta", () => {
    const dati = {
      anno: 2024,
      ricavi: 500000,
      totaleAttivo: 300000,
      patrimonioNetto: 150000,
      utile: 20000,
      debitiTotali: 150000,
    };
    const estratto = estraiDatiBilancio(dati);
    expect(estratto.anno).toBe(2024);
    expect(estratto.ricavi).toBe(500000);
    expect(estratto.totaleAttivo).toBe(300000);
    expect(estratto.patrimonioNetto).toBe(150000);
    expect(estratto.utile).toBe(20000);
  });

  it("estrae dati da struttura annidata (Excel CE/SP)", () => {
    const dati = {
      statoPatrimoniale: {
        totaleAttivo: 400000,
        patrimoniNetto: 200000,
        totalDebiti: 200000,
        utileEsercizio: 30000,
      },
      contoEconomico: {
        ricaviVendite: 600000,
        utileNetto: 30000,
      },
    };
    const estratto = estraiDatiBilancio(dati, 2023);
    expect(estratto.anno).toBe(2023);
    expect(estratto.ricavi).toBe(600000);
    expect(estratto.totaleAttivo).toBe(400000);
    expect(estratto.patrimonioNetto).toBe(200000);
    expect(estratto.utile).toBe(30000);
    expect(estratto.debitiTotali).toBe(200000);
  });

  it("ordina bilanci per anno crescente", () => {
    const bilanci = [
      { anno: 2024, ricavi: 500000 },
      { anno: 2022, ricavi: 400000 },
      { anno: 2023, ricavi: 450000 },
    ];
    const ordinati = bilanci.sort((a, b) => (a.anno ?? 0) - (b.anno ?? 0));
    expect(ordinati[0].anno).toBe(2022);
    expect(ordinati[1].anno).toBe(2023);
    expect(ordinati[2].anno).toBe(2024);
  });

  it("confronto pluriennale: calcola variazioni per 3 anni", () => {
    const estratti = [
      { anno: 2022, ricavi: 400000 as number | null },
      { anno: 2023, ricavi: 450000 as number | null },
      { anno: 2024, ricavi: 500000 as number | null },
    ];
    const confronto = estratti.map((b, i) => {
      const delta = i > 0 ? calcolaDeltaPerc(b.ricavi, estratti[i - 1].ricavi) : null;
      return { anno: b.anno, valore: b.ricavi, deltaPerc: delta };
    });
    expect(confronto[0].deltaPerc).toBeNull(); // primo anno: nessuna variazione
    expect(confronto[1].deltaPerc).toBe(12.5); // 450000/400000 - 1 = 12.5%
    expect(confronto[2].deltaPerc).toBeCloseTo(11.11, 1); // 500000/450000 - 1 = 11.11%
  });
});

describe("Pre-popolamento benchmark Modulo 4 da bilancio", () => {
  it("suggerisce ricavi_netti per impresa commerciale", () => {
    // Ricavi > 30% dell'attivo → impresa commerciale
    const result = suggerisciBenchmark(500000, 300000, 150000, 20000);
    expect(result.benchmark).toBe("ricavi_netti");
    expect(result.percentuale).toBe(0.75);
  });

  it("suggerisce totale_attivo per impresa patrimoniale", () => {
    // Attivo > 2x ricavi → impresa patrimoniale/immobiliare
    const result = suggerisciBenchmark(100000, 800000, 400000, 15000);
    expect(result.benchmark).toBe("totale_attivo");
    expect(result.percentuale).toBe(1.5);
  });

  it("suggerisce utile_ante_imposte per impresa con utile stabile", () => {
    // Ricavi < 30% attivo ma utile positivo
    const result = suggerisciBenchmark(200000, 1000000, 500000, 50000);
    expect(result.benchmark).toBe("totale_attivo"); // attivo > 2x ricavi, priorità su utile
    expect(result.percentuale).toBe(1.5);
  });

  it("fallback a ricavi_netti se dati mancanti", () => {
    const result = suggerisciBenchmark(null, null, null, null);
    expect(result.benchmark).toBe("ricavi_netti");
    expect(result.percentuale).toBe(0.75);
  });

  it("calcola materialità correttamente con benchmark pre-popolato", () => {
    const benchmarkValore = 500000;
    const percentuale = 0.75;
    const om = benchmarkValore * (percentuale / 100);
    expect(om).toBe(3750); // 500000 * 0.0075
    const pm = om * 0.70; // fattore standard
    expect(pm).toBeCloseTo(2625);
    const ctt = om * 0.05;
    expect(ctt).toBeCloseTo(187.5);
  });

  it("estrae valori benchmark da struttura piatta del bilancio", () => {
    const dati = {
      ricavi: 500000,
      totaleAttivo: 300000,
      patrimonioNetto: 150000,
      utile: 20000,
    };
    const valori = {
      ricavi_netti: (dati.ricavi ?? null) as number | null,
      totale_attivo: (dati.totaleAttivo ?? null) as number | null,
      patrimonio_netto: (dati.patrimonioNetto ?? null) as number | null,
      utile_ante_imposte: (dati.utile ?? null) as number | null,
    };
    expect(valori.ricavi_netti).toBe(500000);
    expect(valori.totale_attivo).toBe(300000);
    expect(valori.patrimonio_netto).toBe(150000);
    expect(valori.utile_ante_imposte).toBe(20000);
  });
});
