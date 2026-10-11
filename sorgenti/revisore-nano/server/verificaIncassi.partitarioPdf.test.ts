import { describe, expect, it } from "vitest";
import { dedupPartite } from "./routers/verificaIncassi";

describe("dedupPartite", () => {
  it("mantiene il saldo finale piu' significativo per conti ripetuti su piu' pagine", () => {
    const result = dedupPartite([
      {
        tipo: "cliente",
        codice: "3. 1. 31950",
        ragioneSociale: "ACACIA S.R.L",
        saldoPartita: 1211.88,
      },
      {
        tipo: "cliente",
        codice: "3. 1. 31950",
        ragioneSociale: "ACACIA S.R.L",
        saldoPartita: 1947.12,
      },
      {
        tipo: "cliente",
        codice: "3. 1. 31950",
        ragioneSociale: "ACACIA S.R.L",
        saldoPartita: 0,
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      tipo: "cliente",
      codice: "3. 1. 31950",
      ragioneSociale: "ACACIA S.R.L",
      saldoPartita: 1947.12,
    });
  });

  it("non mescola clienti e fornitori con lo stesso nominativo", () => {
    const result = dedupPartite([
      {
        tipo: "cliente",
        codice: "3. 1. 32316",
        ragioneSociale: "3D HUBS B.V.",
        saldoPartita: 300.72,
      },
      {
        tipo: "fornitore",
        codice: "53. 1. 32316",
        ragioneSociale: "3D HUBS B.V.",
        saldoPartita: 246.49,
      },
    ]);

    expect(result).toHaveLength(2);
    expect(result.map((row) => row.tipo).sort()).toEqual(["cliente", "fornitore"]);
  });
});
