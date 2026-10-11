import { describe, expect, it } from "vitest";
import { matchPartita } from "./routers/verificaIncassi";

describe("matchPartita", () => {
  it("non abbina automaticamente un movimento con importo simile ma nominativo diverso", () => {
    const result = matchPartita(
      {
        tipo: "cliente",
        ragioneSociale: "HOTEL RAFFL TONIDANDEL S.N.C.",
        saldoPartita: 18237.56,
      },
      [
        {
          originalIndex: 0,
          data: "2026-01-09",
          importo: 18992,
          segno: "avere",
          descrizione: "bonif. vs. favore - bon.da aichner invest ag n. 5026/b2b/4-29.11.25",
        },
      ],
      new Set<number>(),
    );

    expect(result.stato).toBe("non_trovata");
    expect(result.importoCoperto).toBe(0);
  });

  it("abbina quando importo e nominativo sono compatibili", () => {
    const usedIndexes = new Set<number>();
    const result = matchPartita(
      {
        tipo: "cliente",
        ragioneSociale: "ARCA LIVING SRL",
        saldoPartita: 14612,
      },
      [
        {
          originalIndex: 0,
          data: "2026-01-20",
          importo: 14612,
          segno: "avere",
          descrizione: "bonif. vs. favore - bon.da arca living srl pag. ft. 5289",
        },
      ],
      usedIndexes,
    );

    expect(result.stato).toBe("incassata_pagata");
    expect(result.importoCoperto).toBe(14612);
    expect(usedIndexes.has(0)).toBe(true);
  });

  it("prioritizza l'importo preciso con nominativo coerente prima dei parziali", () => {
    const usedIndexes = new Set<number>();
    const result = matchPartita(
      {
        tipo: "cliente",
        ragioneSociale: "ARCA LIVING SRL",
        saldoPartita: 14612,
      },
      [
        {
          originalIndex: 0,
          data: "2026-01-10",
          importo: 5000,
          segno: "avere",
          descrizione: "bonif. vs. favore - bon.da arca living srl acconto",
        },
        {
          originalIndex: 1,
          data: "2026-01-20",
          importo: 14612,
          segno: "avere",
          descrizione: "bonif. vs. favore - bon.da arca living srl saldo ft. 5289",
        },
      ],
      usedIndexes,
    );

    expect(result.stato).toBe("incassata_pagata");
    expect(result.importoCoperto).toBe(14612);
    expect(result.descrizioneMovimento).toContain("Importo preciso");
    expect(usedIndexes.has(1)).toBe(true);
    expect(usedIndexes.has(0)).toBe(false);
  });

  it("segnala importo preciso con nominativo non coerente senza abbinarlo", () => {
    const usedIndexes = new Set<number>();
    const result = matchPartita(
      {
        tipo: "cliente",
        ragioneSociale: "HOTEL RAFFL TONIDANDEL S.N.C.",
        saldoPartita: 18237.56,
      },
      [
        {
          originalIndex: 0,
          data: "2026-01-09",
          importo: 18237.56,
          segno: "avere",
          descrizione: "bonif. vs. favore - bon.da aichner invest ag n. 5026/b2b",
        },
      ],
      usedIndexes,
    );

    expect(result.stato).toBe("non_trovata");
    expect(result.importoCoperto).toBe(0);
    expect(result.descrizioneMovimento).toContain("Importo preciso trovato");
    expect(usedIndexes.size).toBe(0);
  });

  it("non consuma pagamenti generici con beneficiari vari per fornitori specifici", () => {
    const usedIndexes = new Set<number>();
    const result = matchPartita(
      {
        tipo: "fornitore",
        ragioneSociale: "GAVIOLI DAVIDE",
        saldoPartita: 21655,
      },
      [
        {
          originalIndex: 0,
          data: "2026-01-07",
          importo: -21721,
          segno: "dare",
          descrizione: "vostra disposizione - vs.disp. rif. mb0b97028626 favore beneficiari vari distinta - add.tot",
        },
      ],
      usedIndexes,
    );

    expect(result.stato).toBe("non_trovata");
    expect(usedIndexes.size).toBe(0);
  });

  it("abbina incassi a rate dello stesso cliente anche se ogni rata e' lontana dal saldo totale", () => {
    const usedIndexes = new Set<number>();
    const result = matchPartita(
      {
        tipo: "cliente",
        ragioneSociale: "HOTEL RAFFL TONIDANDEL S.N.C.",
        saldoPartita: 18237.56,
      },
      [
        {
          originalIndex: 0,
          data: "2026-01-10",
          importo: 5000,
          segno: "avere",
          descrizione: "bonif. vs. favore - bon.da tonidandel acconto ft 5010",
        },
        {
          originalIndex: 1,
          data: "2026-01-24",
          importo: 7000,
          segno: "avere",
          descrizione: "bonif. vs. favore - bon.da tonidandel seconda rata ft 5010",
        },
        {
          originalIndex: 2,
          data: "2026-02-12",
          importo: 6237.56,
          segno: "avere",
          descrizione: "bonif. vs. favore - bon.da tonidandel saldo ft 5010",
        },
      ],
      usedIndexes,
    );

    expect(result.stato).toBe("incassata_pagata");
    expect(result.importoCoperto).toBe(18237.56);
    expect(usedIndexes.size).toBe(3);
    expect(result.dataMovimento).toBe("2026-01-10 +2");
  });

  it("abbina pagamenti a rate dello stesso fornitore anche se ogni rata e' lontana dal saldo totale", () => {
    const usedIndexes = new Set<number>();
    const result = matchPartita(
      {
        tipo: "fornitore",
        ragioneSociale: "ROSSI MARIO SRL",
        saldoPartita: 9200,
      },
      [
        {
          originalIndex: 0,
          data: "2026-01-15",
          importo: -3000,
          segno: "dare",
          descrizione: "vostra disposizione - bonifico a favore rossi mario srl acconto ft 88",
        },
        {
          originalIndex: 1,
          data: "2026-02-10",
          importo: -4200,
          segno: "dare",
          descrizione: "vostra disposizione - bonifico a favore rossi mario srl seconda rata ft 88",
        },
        {
          originalIndex: 2,
          data: "2026-02-28",
          importo: -2000,
          segno: "dare",
          descrizione: "vostra disposizione - bonifico a favore rossi mario srl saldo ft 88",
        },
      ],
      usedIndexes,
    );

    expect(result.stato).toBe("incassata_pagata");
    expect(result.importoCoperto).toBe(9200);
    expect(usedIndexes.size).toBe(3);
    expect(result.dataMovimento).toBe("2026-01-15 +2");
  });

  it("classifica come parziale un movimento nominativo anche con copertura bassa", () => {
    const usedIndexes = new Set<number>();
    const result = matchPartita(
      {
        tipo: "cliente",
        ragioneSociale: "LOGISTICA S.R.L.",
        saldoPartita: 42501.16,
      },
      [
        {
          originalIndex: 0,
          data: "2026-02-20",
          importo: 2562,
          segno: "avere",
          descrizione: "bonif. vs. favore - bon.da logistica srl acconto fattura",
        },
      ],
      usedIndexes,
    );

    expect(result.stato).toBe("parzialmente_coperta");
    expect(result.importoCoperto).toBe(2562);
    expect(result.residuo).toBe(39939.16);
    expect(usedIndexes.has(0)).toBe(true);
  });

  it("riconosce sigle brevi come nominativo per coperture parziali", () => {
    const result = matchPartita(
      {
        tipo: "cliente",
        ragioneSociale: "LH S.R.L.",
        saldoPartita: 9395.24,
      },
      [
        {
          originalIndex: 0,
          data: "2026-01-28",
          importo: 4500,
          segno: "avere",
          descrizione: "bonif. vs. favore - bon.da lh srl acconto fattura",
        },
      ],
      new Set<number>(),
    );

    expect(result.stato).toBe("parzialmente_coperta");
    expect(result.importoCoperto).toBe(4500);
    expect(result.residuo).toBe(4895.24);
  });

  it("segnala il nominativo trovato con segno non coerente senza coprire il saldo", () => {
    const usedIndexes = new Set<number>();
    const result = matchPartita(
      {
        tipo: "fornitore",
        ragioneSociale: "SUSA S.P.A.",
        saldoPartita: 16773.41,
      },
      [
        {
          originalIndex: 0,
          data: "2026-02-03",
          importo: 181.63,
          segno: "avere",
          descrizione: "bonif. vs. favore - bon.da susa spa rimborso",
        },
      ],
      usedIndexes,
    );

    expect(result.stato).toBe("non_trovata");
    expect(result.importoCoperto).toBe(0);
    expect(result.residuo).toBe(16773.41);
    expect(result.descrizioneMovimento).toContain("segno non coerente");
    expect(usedIndexes.size).toBe(0);
  });
});
