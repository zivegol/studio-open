export type RegistroCespitiCategoria = {
  codice: string;
  descrizione: string;
  valoreIniziale: number;
  variazioniAcquisto: number;
  valoreFinale: number;
  fondoIniziale: number;
  quotaAmmortamento: number;
  fondoFinale: number;
  residuoDaAmmortizzare: number;
};

export type RegistroCespitiBene = {
  codice: string;
  categoriaCodice: string;
  categoria: string;
  descrizione: string;
  valoreAmmortizzabile: number;
  aliquotaCivilistica: number | null;
  quotaCivilistica: number;
};

const numero = (value?: string): number => {
  if (!value) return 0;
  const normalized = value.replace(/\s/g, "").replace(/\./g, "").replace(",", ".").replace(/[^0-9.-]/g, "");
  const result = Number(normalized);
  return Number.isFinite(result) ? result : 0;
};

const celle = (line: string) => line.split("|").slice(1, -1).map(value => value.trim());

export function parseRegistroCespiti(text: string, nomeFile: string) {
  const normalized = text.replace(/\r/g, "");
  if (!/REGISTRO\s+DEI\s+BENI\s+AMMORTIZZABILI/i.test(normalized)) {
    throw new Error("Il PDF non sembra essere un registro dei beni ammortizzabili");
  }

  const anno = Number(normalized.match(/Da\s+1\/01\/(\d{4})\s+a\s+31\/12\/\d{4}/i)?.[1] ?? 0) || null;
  const partitaIva = normalized.match(/Partita IVA\s+(\d{11})/i)?.[1] ?? null;
  const ragioneSociale = normalized.match(/Ditta\s+\d+\s+([^\n]+)/i)?.[1]?.trim() ?? null;
  const stampaDiProva = /\*?\s*S\s*t\s*a\s*m\s*p\s*a\s+d\s*i\s+p\s*r\s*o\s*v\s*a\s*\*?/i.test(normalized);
  const pagine = Math.max(...Array.from(normalized.matchAll(/Pagina\s+\d{4}\/(\d+)/gi), match => Number(match[1])), 0);

  const riepilogo = normalized.includes("PROSPETTO RIEPILOGATIVO")
    ? normalized.slice(normalized.indexOf("PROSPETTO RIEPILOGATIVO"))
    : "";
  const lines = riepilogo.split("\n");
  const categorie: RegistroCespitiCategoria[] = [];
  let categoriaCorrente: { codice: string; descrizione: string } | null = null;
  let totaliGenerali: RegistroCespitiCategoria | null = null;

  for (let i = 0; i < lines.length; i++) {
    const categoriaMatch = lines[i].match(/\|\s*Categoria\s+(\d+)\s+(.+?)\s*\|?\s*$/i);
    if (categoriaMatch) categoriaCorrente = { codice: categoriaMatch[1], descrizione: categoriaMatch[2].replace(/\|.*/, "").trim() };

    const row = celle(lines[i]);
    const isTotaleCategoria = row[0] === "TOTALI" && row[1] === "CIV";
    const isTotaleGenerale = row[0] === "TOTALI" && row[1] === "CIV" && /GENERALI/.test(lines[i + 1] ?? "");
    if (!isTotaleCategoria || (!categoriaCorrente && !isTotaleGenerale)) continue;

    let secondaRiga: string[] | null = null;
    for (let j = i + 1; j < Math.min(i + 7, lines.length); j++) {
      const candidate = celle(lines[j]);
      if (candidate[0] === "" && candidate[1] === "CIV") {
        secondaRiga = candidate;
        break;
      }
    }
    if (!secondaRiga) continue;

    const parsed: RegistroCespitiCategoria = {
      codice: isTotaleGenerale ? "TOTALI" : categoriaCorrente!.codice,
      descrizione: isTotaleGenerale ? "Totali generali" : categoriaCorrente!.descrizione,
      valoreIniziale: numero(row[2]),
      variazioniAcquisto: numero(secondaRiga[2]),
      valoreFinale: numero(secondaRiga[4]),
      fondoIniziale: numero(row[5]),
      quotaAmmortamento: numero(secondaRiga[5]),
      fondoFinale: numero(secondaRiga[7]),
      residuoDaAmmortizzare: numero(row[8]),
    };
    if (isTotaleGenerale) totaliGenerali = parsed;
    else if (!categorie.some(item => item.codice === parsed.codice)) categorie.push(parsed);
  }

  const movimenti = normalized.split("PROSPETTO RIEPILOGATIVO")[0];
  const beni: RegistroCespitiBene[] = [];
  const intestazioni = Array.from(movimenti.matchAll(/\|\s*Categoria\s+(\d+)\s+(.+?)\s+Cespite\s+([\d.]+)\s+([^|\n]*)\|/gi));
  for (let i = 0; i < intestazioni.length; i++) {
    const match = intestazioni[i];
    const start = match.index ?? 0;
    const end = intestazioni[i + 1]?.index ?? movimenti.length;
    const block = movimenti.slice(start, end);
    const codice = match[3].trim();
    if (beni.some(bene => bene.codice === codice)) continue;
    const valore = numero(block.match(/Valore ammortizzabile civilistico\s+([\d.]+,\d{2})/i)?.[1]);
    const ammortamento = block.match(/Ammortamento civilistico\s*\|\s*([\d.,]+)\s*\|[^|]*\|\s*([\d.]+,\d{2})/i);
    beni.push({
      codice,
      categoriaCodice: match[1],
      categoria: match[2].trim(),
      descrizione: match[4].trim(),
      valoreAmmortizzabile: valore,
      aliquotaCivilistica: ammortamento ? numero(ammortamento[1]) : null,
      quotaCivilistica: ammortamento ? numero(ammortamento[2]) : 0,
    });
  }

  if (!totaliGenerali) throw new Error("Totali generali non individuati nel registro cespiti");
  const aliquote = Array.from(new Map(
    beni.filter(bene => bene.aliquotaCivilistica !== null).map(bene => [
      `${bene.categoriaCodice}-${bene.aliquotaCivilistica}`,
      { categoria: `${bene.categoriaCodice} - ${bene.categoria}`, aliquota: bene.aliquotaCivilistica!, note: "Estratta dal registro cespiti" },
    ])
  ).values());

  return {
    fonte: nomeFile,
    anno,
    ragioneSociale,
    partitaIva,
    pagine,
    stampaDiProva,
    totali: totaliGenerali,
    categorie: categorie.sort((a, b) => Number(a.codice) - Number(b.codice)),
    beni,
    aliquote,
    controlliAutomatici: [
      "Identificazione del periodo e della società intestataria",
      "Estrazione dei totali civilistici iniziali e finali",
      "Ricalcolo del fondo finale: fondo iniziale + quota dell'esercizio",
      "Ricalcolo del valore finale: valore iniziale + variazioni d'acquisto",
      "Estrazione di categorie, aliquote e quote civilistiche",
      "Individuazione dei cespiti acquisiti nell'esercizio",
    ],
    anomalie: [
      ...(stampaDiProva ? ["Il documento è una stampa di prova: richiedere il registro definitivo prima di concludere la verifica."] : []),
      ...(Math.abs((totaliGenerali.fondoIniziale + totaliGenerali.quotaAmmortamento) - totaliGenerali.fondoFinale) > 0.02
        ? ["Il fondo finale non coincide con fondo iniziale più quota dell'esercizio."] : []),
      ...(Math.abs((totaliGenerali.valoreIniziale + totaliGenerali.variazioniAcquisto) - totaliGenerali.valoreFinale) > 0.02
        ? ["Il valore finale non coincide con valore iniziale più variazioni d'acquisto."] : []),
    ],
  };
}
