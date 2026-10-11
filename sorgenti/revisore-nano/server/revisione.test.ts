import { describe, expect, it } from "vitest";

// ─── Test: Calcolo materialità ────────────────────────────────────────────────
function calcolaMaterialita(
  valore: number,
  percentuale: number,
  primoIncarico: boolean,
  erroriPrecedenti: boolean,
  controlliDeboli: boolean
) {
  const om = valore * (percentuale / 100);
  let fattore = 0.70;
  if (primoIncarico) fattore -= 0.10;
  if (erroriPrecedenti) fattore -= 0.10;
  if (controlliDeboli) fattore -= 0.05;
  fattore = Math.max(fattore, 0.50);
  const pm = om * fattore;
  const ctt = om * 0.05;
  return { om: Math.round(om * 100) / 100, pm: Math.round(pm * 100) / 100, ctt: Math.round(ctt * 100) / 100, fattore };
}

describe("Calcolo materialità (ISA Italia 320)", () => {
  it("calcola OM, PM e CTT con parametri standard", () => {
    const result = calcolaMaterialita(489054, 0.75, false, false, false);
    expect(result.om).toBeCloseTo(3667.91, 1);
    expect(result.pm).toBeCloseTo(2567.54, 1); // 70% di OM
    expect(result.ctt).toBeCloseTo(183.40, 1); // 5% di OM
    expect(result.fattore).toBe(0.70);
  });

  it("riduce PM per primo incarico (-10%)", () => {
    const result = calcolaMaterialita(489054, 0.75, true, false, false);
    expect(result.fattore).toBe(0.60);
    expect(result.pm).toBeCloseTo(result.om * 0.60, 1);
  });

  it("riduce PM per errori anni precedenti (-10%)", () => {
    const result = calcolaMaterialita(489054, 0.75, false, true, false);
    expect(result.fattore).toBe(0.60);
  });

  it("riduce PM per controlli deboli (-5%)", () => {
    const result = calcolaMaterialita(489054, 0.75, false, false, true);
    expect(result.fattore).toBeCloseTo(0.65, 10);
  });

  it("non scende sotto il 50% anche con tutti i fattori negativi", () => {
    const result = calcolaMaterialita(489054, 0.75, true, true, true);
    expect(result.fattore).toBe(0.50);
  });

  it("CTT è sempre il 5% di OM", () => {
    const result = calcolaMaterialita(1000000, 1, false, false, false);
    expect(result.om).toBe(10000);
    expect(result.ctt).toBe(500);
  });
});

// ─── Test: Calcolo RMM ────────────────────────────────────────────────────────
function calcolaRMM(rischioInerente: number, rischioControllo: number) {
  if (rischioInerente === 0 || rischioControllo === 0) return 0;
  return Math.round((rischioInerente + rischioControllo) / 2);
}

function calcolaRischioIndividuazione(rmm: number) {
  if (rmm >= 3) return 1; // basso (più procedure)
  if (rmm === 2) return 2;
  if (rmm === 1) return 3; // alto (meno procedure)
  return 0;
}

describe("Calcolo RMM e rischio individuazione (ISA Italia 200)", () => {
  it("RMM alto quando RI e RC sono entrambi alti", () => {
    expect(calcolaRMM(3, 3)).toBe(3);
  });

  it("RMM medio con RI alto e RC basso", () => {
    expect(calcolaRMM(3, 1)).toBe(2);
  });

  it("RMM basso con entrambi bassi", () => {
    expect(calcolaRMM(1, 1)).toBe(1);
  });

  it("rischio individuazione inversamente proporzionale a RMM", () => {
    expect(calcolaRischioIndividuazione(3)).toBe(1); // RMM alto → RI basso
    expect(calcolaRischioIndividuazione(2)).toBe(2);
    expect(calcolaRischioIndividuazione(1)).toBe(3); // RMM basso → RI alto
  });
});

// ─── Test: Classificazione nano impresa ──────────────────────────────────────
function isNanoImpresa(totaleAttivo: number, ricavi: number, dipendenti: number) {
  const limiti = [totaleAttivo <= 175000, ricavi <= 350000, dipendenti <= 5];
  return limiti.filter(Boolean).length >= 2;
}

describe("Classificazione nano impresa (art. 2435-ter c.c.)", () => {
  it("è nano impresa se almeno 2 su 3 limiti rispettati", () => {
    expect(isNanoImpresa(100000, 200000, 3)).toBe(true);
  });

  it("non è nano impresa se solo 1 limite rispettato", () => {
    expect(isNanoImpresa(100000, 500000, 10)).toBe(false);
  });

  it("è nano impresa al limite esatto", () => {
    expect(isNanoImpresa(175000, 350000, 5)).toBe(true);
  });

  it("non è nano impresa se tutti i limiti superati", () => {
    expect(isNanoImpresa(200000, 400000, 8)).toBe(false);
  });

  it("è nano impresa con solo dipendenti e ricavi nei limiti", () => {
    expect(isNanoImpresa(300000, 200000, 3)).toBe(true);
  });
});

// ─── Test: Validazione checklist accettazione ─────────────────────────────────
function valutaAccettazione(checks: Record<string, boolean>): "accettato" | "sospeso" | "rifiutato" {
  const critici = ["indipendenzaVerificata", "letteraIncaricoFirmata"];
  const hasCriticiMancanti = critici.some(k => !checks[k]);
  if (hasCriticiMancanti) return "sospeso";
  const completati = Object.values(checks).filter(Boolean).length;
  if (completati < 4) return "sospeso";
  return "accettato";
}

describe("Checklist accettazione incarico (ISA Italia 210/220)", () => {
  it("accetta con tutti i check completati", () => {
    const checks = {
      indipendenzaVerificata: true,
      competenzaVerificata: true,
      integritaManagementVerificata: true,
      rischioIncaricoPrecedente: true,
      conflittiInteresseVerificati: true,
      onorarioDefinito: true,
      letteraIncaricoFirmata: true,
    };
    expect(valutaAccettazione(checks)).toBe("accettato");
  });

  it("sospende se indipendenza non verificata", () => {
    const checks = {
      indipendenzaVerificata: false,
      competenzaVerificata: true,
      integritaManagementVerificata: true,
      rischioIncaricoPrecedente: true,
      conflittiInteresseVerificati: true,
      onorarioDefinito: true,
      letteraIncaricoFirmata: true,
    };
    expect(valutaAccettazione(checks)).toBe("sospeso");
  });

  it("sospende se lettera di incarico non firmata", () => {
    const checks = {
      indipendenzaVerificata: true,
      competenzaVerificata: true,
      integritaManagementVerificata: true,
      rischioIncaricoPrecedente: true,
      conflittiInteresseVerificati: true,
      onorarioDefinito: true,
      letteraIncaricoFirmata: false,
    };
    expect(valutaAccettazione(checks)).toBe("sospeso");
  });
});
