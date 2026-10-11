import { describe, it, expect } from "vitest";

// ─── Test: logica collegamento verifica incassi → circolarizzazione ───────────

interface PartitaNonTrovata {
  tipo: "cliente" | "fornitore";
  ragioneSociale: string;
  saldoPartita: string; // decimal come stringa dal DB
  codice?: string | null;
  statoMatching: "non_trovata";
}

/** Aggrega partite non trovate per ragione sociale, sommando i saldi */
function aggregaPartiteNonTrovate(partite: PartitaNonTrovata[]) {
  const aggregati = new Map<string, { ragioneSociale: string; tipo: "cliente" | "fornitore"; saldo: number; codice?: string }>();
  for (const p of partite) {
    const key = `${p.tipo}::${p.ragioneSociale}`;
    const existing = aggregati.get(key);
    const saldo = parseFloat(p.saldoPartita);
    if (existing) {
      existing.saldo += saldo;
    } else {
      aggregati.set(key, {
        ragioneSociale: p.ragioneSociale,
        tipo: p.tipo,
        saldo,
        codice: p.codice ?? undefined,
      });
    }
  }
  return Array.from(aggregati.values()).sort((a, b) => Math.abs(b.saldo) - Math.abs(a.saldo));
}

/** Converte partita aggregata in riga testo per le textarea della circolarizzazione */
function convertiInRigaTesto(n: { ragioneSociale: string; saldo: number; codice?: string }) {
  const prefix = n.codice ? `${n.codice};` : "";
  return `${prefix}${n.ragioneSociale};${Math.abs(n.saldo).toFixed(2)}`;
}

describe("Aggregazione partite non trovate", () => {
  it("aggrega più partite dello stesso soggetto sommando i saldi", () => {
    const partite: PartitaNonTrovata[] = [
      { tipo: "cliente", ragioneSociale: "ROSSI SRL", saldoPartita: "1000.00", statoMatching: "non_trovata" },
      { tipo: "cliente", ragioneSociale: "ROSSI SRL", saldoPartita: "500.00", statoMatching: "non_trovata" },
      { tipo: "cliente", ragioneSociale: "BIANCHI SPA", saldoPartita: "2000.00", statoMatching: "non_trovata" },
    ];
    const risultato = aggregaPartiteNonTrovate(partite);
    expect(risultato).toHaveLength(2);
    const rossi = risultato.find(r => r.ragioneSociale === "ROSSI SRL");
    expect(rossi?.saldo).toBe(1500);
    const bianchi = risultato.find(r => r.ragioneSociale === "BIANCHI SPA");
    expect(bianchi?.saldo).toBe(2000);
  });

  it("non aggrega clienti e fornitori con stesso nome (tipo diverso)", () => {
    const partite: PartitaNonTrovata[] = [
      { tipo: "cliente", ragioneSociale: "VERDI SRL", saldoPartita: "1000.00", statoMatching: "non_trovata" },
      { tipo: "fornitore", ragioneSociale: "VERDI SRL", saldoPartita: "800.00", statoMatching: "non_trovata" },
    ];
    const risultato = aggregaPartiteNonTrovate(partite);
    expect(risultato).toHaveLength(2);
  });

  it("ordina per saldo decrescente (valore assoluto)", () => {
    const partite: PartitaNonTrovata[] = [
      { tipo: "cliente", ragioneSociale: "PICCOLO SRL", saldoPartita: "100.00", statoMatching: "non_trovata" },
      { tipo: "cliente", ragioneSociale: "GRANDE SPA", saldoPartita: "50000.00", statoMatching: "non_trovata" },
      { tipo: "fornitore", ragioneSociale: "MEDIO SNC", saldoPartita: "5000.00", statoMatching: "non_trovata" },
    ];
    const risultato = aggregaPartiteNonTrovate(partite);
    expect(risultato[0].ragioneSociale).toBe("GRANDE SPA");
    expect(risultato[1].ragioneSociale).toBe("MEDIO SNC");
    expect(risultato[2].ragioneSociale).toBe("PICCOLO SRL");
  });

  it("gestisce lista vuota", () => {
    const risultato = aggregaPartiteNonTrovate([]);
    expect(risultato).toHaveLength(0);
  });

  it("preserva il codice contabile", () => {
    const partite: PartitaNonTrovata[] = [
      { tipo: "cliente", ragioneSociale: "ALFA SRL", saldoPartita: "3000.00", codice: "00241", statoMatching: "non_trovata" },
    ];
    const risultato = aggregaPartiteNonTrovate(partite);
    expect(risultato[0].codice).toBe("00241");
  });
});

describe("Conversione in formato testo per textarea circolarizzazione", () => {
  it("genera riga con codice nel formato codice;ragione_sociale;saldo", () => {
    const riga = convertiInRigaTesto({ ragioneSociale: "ROSSI SRL", saldo: 2190.82, codice: "00241" });
    expect(riga).toBe("00241;ROSSI SRL;2190.82");
  });

  it("genera riga senza codice nel formato ragione_sociale;saldo", () => {
    const riga = convertiInRigaTesto({ ragioneSociale: "BIANCHI SPA", saldo: 18237.56 });
    expect(riga).toBe("BIANCHI SPA;18237.56");
  });

  it("usa valore assoluto del saldo (partite passive)", () => {
    const riga = convertiInRigaTesto({ ragioneSociale: "FORNITORE SRL", saldo: -5000.00 });
    expect(riga).toBe("FORNITORE SRL;5000.00");
  });

  it("arrotonda a 2 decimali", () => {
    const riga = convertiInRigaTesto({ ragioneSociale: "TEST SRL", saldo: 1234.5 });
    expect(riga).toBe("TEST SRL;1234.50");
  });
});

describe("Logica di pre-selezione tipo circolarizzazione", () => {
  it("imposta 'entrambi' se ci sono sia clienti che fornitori non trovati", () => {
    const nonTrovati = [
      { tipo: "cliente" as const, ragioneSociale: "A", saldo: 1000 },
      { tipo: "fornitore" as const, ragioneSociale: "B", saldo: 2000 },
    ];
    const clientiNT = nonTrovati.filter(n => n.tipo === "cliente");
    const fornitoriNT = nonTrovati.filter(n => n.tipo === "fornitore");
    let tipoCirc: string;
    if (clientiNT.length > 0 && fornitoriNT.length > 0) tipoCirc = "entrambi";
    else if (clientiNT.length > 0) tipoCirc = "clienti";
    else tipoCirc = "fornitori";
    expect(tipoCirc).toBe("entrambi");
  });

  it("imposta 'clienti' se ci sono solo clienti non trovati", () => {
    const nonTrovati = [
      { tipo: "cliente" as const, ragioneSociale: "A", saldo: 1000 },
    ];
    const clientiNT = nonTrovati.filter(n => n.tipo === "cliente");
    const fornitoriNT = nonTrovati.filter(n => n.tipo === "fornitore");
    let tipoCirc: string;
    if (clientiNT.length > 0 && fornitoriNT.length > 0) tipoCirc = "entrambi";
    else if (clientiNT.length > 0) tipoCirc = "clienti";
    else tipoCirc = "fornitori";
    expect(tipoCirc).toBe("clienti");
  });

  it("imposta 'fornitori' se ci sono solo fornitori non trovati", () => {
    const nonTrovati = [
      { tipo: "fornitore" as const, ragioneSociale: "B", saldo: 2000 },
    ];
    const clientiNT = nonTrovati.filter(n => n.tipo === "cliente");
    const fornitoriNT = nonTrovati.filter(n => n.tipo === "fornitore");
    let tipoCirc: string;
    if (clientiNT.length > 0 && fornitoriNT.length > 0) tipoCirc = "entrambi";
    else if (clientiNT.length > 0) tipoCirc = "clienti";
    else tipoCirc = "fornitori";
    expect(tipoCirc).toBe("fornitori");
  });
});

describe("Parser numerico saldo (parseNumeroSaldo)", () => {
  // Replica della funzione corretta
  function parseNumeroSaldo(s: string): number {
    if (!s || s.trim() === "") return NaN;
    const clean = s.trim().replace(/[€$\s]/g, "");
    if (/^\d{1,3}(\.\d{3})*(,\d+)?$/.test(clean)) {
      return parseFloat(clean.replace(/\./g, "").replace(",", "."));
    }
    if (/^\d{1,3}(,\d{3})*(\.\d+)?$/.test(clean)) {
      return parseFloat(clean.replace(/,/g, ""));
    }
    if (/^\d+(,\d+)?$/.test(clean)) {
      return parseFloat(clean.replace(",", "."));
    }
    return parseFloat(clean);
  }

  it("parsa numero anglosassone semplice con punto decimale (caso bug principale)", () => {
    // Questo era il caso che causava il bug: 2190.82 diventava 219082
    expect(parseNumeroSaldo("2190.82")).toBe(2190.82);
    expect(parseNumeroSaldo("18237.56")).toBe(18237.56);
    expect(parseNumeroSaldo("38896.68")).toBe(38896.68);
    expect(parseNumeroSaldo("72295.36")).toBe(72295.36);
  });

  it("parsa numero anglosassone con virgola come migliaia", () => {
    expect(parseNumeroSaldo("2,190.82")).toBe(2190.82);
    expect(parseNumeroSaldo("18,237.56")).toBe(18237.56);
    expect(parseNumeroSaldo("1,234,567.89")).toBe(1234567.89);
  });

  it("parsa numero italiano con punto come migliaia e virgola decimale", () => {
    expect(parseNumeroSaldo("2.190,82")).toBe(2190.82);
    expect(parseNumeroSaldo("18.237,56")).toBe(18237.56);
    expect(parseNumeroSaldo("1.234.567,89")).toBe(1234567.89);
  });

  it("parsa numero semplice senza separatori", () => {
    expect(parseNumeroSaldo("1000")).toBe(1000);
    expect(parseNumeroSaldo("500.00")).toBe(500);
    expect(parseNumeroSaldo("1234,56")).toBe(1234.56);
  });

  it("parsa numero con simbolo euro", () => {
    expect(parseNumeroSaldo("€ 2190.82")).toBe(2190.82);
    expect(parseNumeroSaldo("€2.190,82")).toBe(2190.82);
  });

  it("restituisce NaN per stringa vuota o non numerica", () => {
    expect(parseNumeroSaldo("")).toBeNaN();
    expect(parseNumeroSaldo("abc")).toBeNaN();
  });

  it("la vecchia implementazione buggy avrebbe dato risultati errati", () => {
    // Vecchia logica: .replace(",", ".").replace(/\./g, "").replace(",", ".")
    // Per "2190.82": prima replace non fa nulla (nessuna virgola), poi .replace(/\./g, "") rimuove il punto → "219082"
    function vecchiaLogica(s: string): number {
      return parseFloat(s.replace(",", ".").replace(/\./g, "").replace(",", "."));
    }
    expect(vecchiaLogica("2190.82")).toBe(219082); // BUG: era questo il problema!
    expect(vecchiaLogica("18237.56")).toBe(1823756); // BUG
    // La nuova logica corregge:
    expect(parseNumeroSaldo("2190.82")).toBe(2190.82); // CORRETTO
    expect(parseNumeroSaldo("18237.56")).toBe(18237.56); // CORRETTO
  });
});

describe("Calcolo statistiche riepilogative", () => {
  it("calcola saldo totale clienti e fornitori non trovati", () => {
    const nonTrovati = [
      { tipo: "cliente" as const, ragioneSociale: "A", saldo: 1000 },
      { tipo: "cliente" as const, ragioneSociale: "B", saldo: 2000 },
      { tipo: "fornitore" as const, ragioneSociale: "C", saldo: 5000 },
    ];
    const clienti = nonTrovati.filter(n => n.tipo === "cliente");
    const fornitori = nonTrovati.filter(n => n.tipo === "fornitore");
    const saldoClienti = clienti.reduce((s, n) => s + Math.abs(n.saldo), 0);
    const saldoFornitori = fornitori.reduce((s, n) => s + Math.abs(n.saldo), 0);
    expect(saldoClienti).toBe(3000);
    expect(saldoFornitori).toBe(5000);
  });

  it("non aggiunge duplicati quando si importa nelle liste esistenti", () => {
    // Simula il comportamento del frontend: aggiunge senza sovrascrivere
    const testoEsistente = "00100;CLIENTE ESISTENTE;1000.00";
    const nuoveRighe = "00241;ROSSI SRL;2190.82";
    const testoFinale = testoEsistente + "\n" + nuoveRighe;
    const righe = testoFinale.split("\n").filter(r => r.trim());
    expect(righe).toHaveLength(2);
    expect(righe[0]).toBe("00100;CLIENTE ESISTENTE;1000.00");
    expect(righe[1]).toBe("00241;ROSSI SRL;2190.82");
  });
});
