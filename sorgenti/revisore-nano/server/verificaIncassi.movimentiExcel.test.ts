import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parsaMovimentiDaExcel } from "./routers/verificaIncassi";

describe("parsaMovimentiDaExcel", () => {
  it("legge movimenti con intestazioni non perfettamente standard", () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Estratto conto banca"],
      [],
      ["Data operazione", "Descrizione operazione", "Importo in addebito", "Importo in accredito"],
      ["05/01/2026", "Bonifico fornitore ALFA SRL", "1.250,50", ""],
      ["08/01/2026", "Bonifico cliente BETA SPA", "", "2.000,00"],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Gennaio");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const result = parsaMovimentiDaExcel(buffer);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      data: "2026-01-05",
      segno: "dare",
      importo: -1250.5,
    });
    expect(result[1]).toMatchObject({
      data: "2026-01-08",
      segno: "avere",
      importo: 2000,
    });
  });
});
