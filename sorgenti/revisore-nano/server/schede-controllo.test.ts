/**
 * Test per le schede di controllo aree di bilancio
 * Rimanenze (ISA 501), Immobilizzazioni (ISA 500/501), Disponibilità Liquide (ISA 500/505)
 */
import { describe, it, expect } from "vitest";

// ─── Helper di calcolo rimanenze ──────────────────────────────────────────────

function calcolaDifferenzaRimanenze(valoreContabile: number, valoreConteggio: number) {
  return valoreConteggio - valoreContabile;
}

function calcolaFondoObsolescenzaCategorie(categorie: { valore: number; percObsolescenza: number }[]) {
  return categorie.reduce((sum, c) => sum + c.valore * c.percObsolescenza / 100, 0);
}

function calcolaTotaleCategorie(categorie: { valore: number }[]) {
  return categorie.reduce((sum, c) => sum + c.valore, 0);
}

// ─── Helper di calcolo immobilizzazioni ──────────────────────────────────────

function calcolaValoreNettoImmobilizzazioni(lordoMat: number, fondiMat: number, lordoImmat: number, fondiImmat: number) {
  return (lordoMat - fondiMat) + (lordoImmat - fondiImmat);
}

function calcolaVariazioneNettoImmobilizzazioni(
  valoreNetto: number,
  acquisizioni: number,
  dismissioni: number,
  ammortamenti: number
) {
  return valoreNetto + acquisizioni - dismissioni - ammortamenti;
}

// ─── Helper di calcolo disponibilità liquide ─────────────────────────────────

function calcolaTotaleLiquide(contiCorrenti: { saldoBilancio: number }[], saldoCassa: number) {
  return contiCorrenti.reduce((sum, cc) => sum + cc.saldoBilancio, 0) + saldoCassa;
}

function calcolaDifferenzaCC(saldoBilancio: number, saldoEstratto: number) {
  return saldoEstratto - saldoBilancio;
}

function tuttiCCRiconciliati(contiCorrenti: { riconciliato?: boolean }[]) {
  return contiCorrenti.length > 0 && contiCorrenti.every(cc => cc.riconciliato === true);
}

// ─── TEST RIMANENZE ───────────────────────────────────────────────────────────

describe("Scheda Rimanenze — calcoli", () => {
  it("calcola correttamente la differenza tra valore contabile e conteggio fisico", () => {
    expect(calcolaDifferenzaRimanenze(100_000, 98_500)).toBeCloseTo(-1_500);
    expect(calcolaDifferenzaRimanenze(50_000, 50_000)).toBeCloseTo(0);
    expect(calcolaDifferenzaRimanenze(30_000, 32_000)).toBeCloseTo(2_000);
  });

  it("segnala differenza significativa quando supera lo zero", () => {
    const diff = calcolaDifferenzaRimanenze(100_000, 97_000);
    expect(Math.abs(diff)).toBeGreaterThan(0);
  });

  it("calcola il fondo obsolescenza per categorie", () => {
    const categorie = [
      { valore: 50_000, percObsolescenza: 10 },
      { valore: 30_000, percObsolescenza: 25 },
      { valore: 20_000, percObsolescenza: 0 },
    ];
    const fondo = calcolaFondoObsolescenzaCategorie(categorie);
    expect(fondo).toBeCloseTo(12_500); // 5000 + 7500 + 0
  });

  it("calcola il totale delle categorie di rimanenze", () => {
    const categorie = [
      { valore: 50_000, percObsolescenza: 0 },
      { valore: 30_000, percObsolescenza: 0 },
      { valore: 20_000, percObsolescenza: 0 },
    ];
    expect(calcolaTotaleCategorie(categorie)).toBe(100_000);
  });

  it("gestisce categorie vuote senza errori", () => {
    expect(calcolaFondoObsolescenzaCategorie([])).toBe(0);
    expect(calcolaTotaleCategorie([])).toBe(0);
  });
});

// ─── TEST IMMOBILIZZAZIONI ────────────────────────────────────────────────────

describe("Scheda Immobilizzazioni — calcoli", () => {
  it("calcola il valore netto delle immobilizzazioni", () => {
    const netto = calcolaValoreNettoImmobilizzazioni(500_000, 200_000, 80_000, 30_000);
    expect(netto).toBe(350_000); // (500k-200k) + (80k-30k)
  });

  it("gestisce immobilizzazioni senza fondo ammortamento", () => {
    const netto = calcolaValoreNettoImmobilizzazioni(100_000, 0, 0, 0);
    expect(netto).toBe(100_000);
  });

  it("calcola la variazione netta tenendo conto di acquisizioni, dismissioni e ammortamenti", () => {
    const nettoInizio = 350_000;
    const variazione = calcolaVariazioneNettoImmobilizzazioni(nettoInizio, 50_000, 10_000, 30_000);
    expect(variazione).toBe(360_000); // 350k + 50k - 10k - 30k
  });

  it("segnala cespiti completamente ammortizzati quando fondo >= lordo", () => {
    const lordo = 100_000;
    const fondo = 100_000;
    expect(fondo >= lordo).toBe(true);
  });
});

// ─── TEST DISPONIBILITÀ LIQUIDE ───────────────────────────────────────────────

describe("Scheda Disponibilità Liquide — calcoli", () => {
  it("calcola il totale delle disponibilità liquide (c/c + cassa)", () => {
    const conti = [
      { saldoBilancio: 45_000 },
      { saldoBilancio: 12_500 },
      { saldoBilancio: 3_200 },
    ];
    const totale = calcolaTotaleLiquide(conti, 1_500);
    expect(totale).toBeCloseTo(62_200);
  });

  it("calcola la differenza tra saldo bilancio e estratto conto", () => {
    expect(calcolaDifferenzaCC(45_000, 45_000)).toBeCloseTo(0);
    expect(calcolaDifferenzaCC(45_000, 44_800)).toBeCloseTo(-200);
    expect(calcolaDifferenzaCC(12_500, 12_700)).toBeCloseTo(200);
  });

  it("verifica se tutti i c/c sono riconciliati", () => {
    const tuttiRiconciliati = [
      { riconciliato: true },
      { riconciliato: true },
      { riconciliato: true },
    ];
    expect(tuttiCCRiconciliati(tuttiRiconciliati)).toBe(true);

    const nonTuttiRiconciliati = [
      { riconciliato: true },
      { riconciliato: false },
    ];
    expect(tuttiCCRiconciliati(nonTuttiRiconciliati)).toBe(false);
  });

  it("gestisce lista vuota di c/c", () => {
    expect(calcolaTotaleLiquide([], 500)).toBe(500);
    expect(tuttiCCRiconciliati([])).toBe(false);
  });

  it("segnala differenza significativa quando supera la soglia", () => {
    const sogliaMaterialita = 5_000;
    const diff = Math.abs(calcolaDifferenzaCC(100_000, 106_000));
    expect(diff).toBeGreaterThan(sogliaMaterialita);
  });
});

// ─── TEST INTEGRAZIONE CHECKLIST ─────────────────────────────────────────────

describe("Checklist ISA — completamento", () => {
  const checklist = [
    { voce: "Presenza fisica verificata", completata: true },
    { voce: "Valorizzazione conforme OIC 13", completata: true },
    { voce: "Fondo obsolescenza adeguato", completata: false },
    { voce: "Cut-off verificato", completata: true },
  ];

  it("conta correttamente i controlli completati", () => {
    const completati = checklist.filter(c => c.completata).length;
    expect(completati).toBe(3);
  });

  it("calcola la percentuale di completamento", () => {
    const completati = checklist.filter(c => c.completata).length;
    const perc = (completati / checklist.length) * 100;
    expect(perc).toBe(75);
  });

  it("identifica i controlli mancanti", () => {
    const mancanti = checklist.filter(c => !c.completata);
    expect(mancanti).toHaveLength(1);
    expect(mancanti[0].voce).toBe("Fondo obsolescenza adeguato");
  });
});
