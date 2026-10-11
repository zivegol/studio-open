import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  getIncaricoById,
  getClienteById,
  getDocumentiByIncarico,
  getModuloAccettazione,
  getModuloComprensione,
  getModuloRischio,
  getModuloMaterialita,
  getModuloPiano,
} from "../db";
import { storagePut } from "../storage";

// ─── Helper: formatta numero in euro ─────────────────────────────────────────
function fmt(val: unknown): string {
  if (val === null || val === undefined) return "—";
  const n = Number(val);
  if (isNaN(n)) return String(val);
  return n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function fmtN(val: unknown): string {
  if (val === null || val === undefined) return "—";
  return String(val);
}

// ─── Helper: semaforo rischio ─────────────────────────────────────────────────
function semaforoRischio(livello: number | null | undefined): string {
  if (!livello) return "—";
  if (livello === 1) return "Basso";
  if (livello === 2) return "Medio";
  if (livello === 3) return "Alto";
  return String(livello);
}

// ─── Genera HTML del fascicolo ────────────────────────────────────────────────
function generaHtmlFascicolo(data: {
  cliente: any;
  incarico: any;
  documenti: any[];
  accettazione: any;
  comprensione: any;
  rischio: any;
  materialita: any;
  piano: any;
  dataGenerazione: string;
}): string {
  const { cliente, incarico, documenti, accettazione, comprensione, rischio, materialita, piano, dataGenerazione } = data;

  const statoModulo = (stato: number | null) =>
    stato === 2 ? '<span style="color:#16a34a;font-weight:600">✓ Completato</span>'
    : stato === 1 ? '<span style="color:#2563eb;font-weight:600">In corso</span>'
    : '<span style="color:#9ca3af">Non avviato</span>';

  const checkItem = (val: boolean | null | undefined, label: string) =>
    `<tr><td style="padding:4px 8px;border-bottom:1px solid #f0f0f0">${label}</td><td style="padding:4px 8px;border-bottom:1px solid #f0f0f0;text-align:center">${val ? '✓' : '✗'}</td></tr>`;

  // Dati bilancio estratti (dal primo documento bilancio analizzato)
  const docBilancio = documenti.find(d => d.tipoDocumento === "bilancio" && d.statoParsing === "completato" && d.datiStrutturati);
  const dati = (docBilancio?.datiStrutturati || {}) as Record<string, any>;

  // Aree di rischio
  const areeRischio = (rischio?.areeRischio as any[]) || [];
  const areeRischioHtml = areeRischio.length > 0
    ? areeRischio.map((a: any) => `<tr>
        <td style="padding:4px 8px;border-bottom:1px solid #f0f0f0">${a.area || "—"}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #f0f0f0;text-align:center;color:${a.livello === "alto" ? "#dc2626" : a.livello === "medio" ? "#d97706" : "#16a34a"};font-weight:600">${a.livello || "—"}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #f0f0f0;font-size:12px">${a.motivazione || "—"}</td>
      </tr>`).join("")
    : '<tr><td colspan="3" style="padding:8px;color:#9ca3af;font-style:italic">Nessuna area di rischio identificata</td></tr>';

  // Procedure pianificate
  const procedure = (piano?.procedurePianificate as any[]) || [];
  const procedureHtml = procedure.length > 0
    ? procedure.map((p: any) => `<tr>
        <td style="padding:4px 8px;border-bottom:1px solid #f0f0f0;font-weight:500">${p.area || "—"}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #f0f0f0;font-size:12px">${Array.isArray(p.procedure) ? p.procedure.join("; ") : "—"}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #f0f0f0;text-align:center;color:${p.priorita === "alta" ? "#dc2626" : p.priorita === "media" ? "#d97706" : "#16a34a"};font-weight:600">${p.priorita || "—"}</td>
      </tr>`).join("")
    : '<tr><td colspan="3" style="padding:8px;color:#9ca3af;font-style:italic">Piano non ancora generato</td></tr>';

  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<title>Fascicolo di Revisione — ${cliente?.ragioneSociale} ${incarico?.annoEsercizio}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 13px; color: #1a1a2e; line-height: 1.5; background: #fff; }
  .page { max-width: 900px; margin: 0 auto; padding: 40px; }
  .header { border-bottom: 3px solid #1e3a5f; padding-bottom: 20px; margin-bottom: 30px; }
  .header-top { display: flex; justify-content: space-between; align-items: flex-start; }
  .logo-area h1 { font-size: 22px; font-weight: 700; color: #1e3a5f; }
  .logo-area p { font-size: 11px; color: #6b7280; margin-top: 2px; }
  .meta-area { text-align: right; font-size: 11px; color: #6b7280; }
  .meta-area strong { color: #1a1a2e; font-size: 13px; }
  .cliente-box { background: #f0f4f8; border-left: 4px solid #1e3a5f; padding: 14px 18px; margin-bottom: 30px; border-radius: 0 6px 6px 0; }
  .cliente-box h2 { font-size: 18px; font-weight: 700; color: #1e3a5f; }
  .cliente-box .meta { display: flex; gap: 24px; margin-top: 6px; font-size: 12px; color: #4b5563; flex-wrap: wrap; }
  .sezione { margin-bottom: 28px; page-break-inside: avoid; }
  .sezione-titolo { display: flex; align-items: center; gap: 10px; background: #1e3a5f; color: #fff; padding: 8px 14px; border-radius: 6px 6px 0 0; font-size: 13px; font-weight: 600; }
  .sezione-titolo .num { background: rgba(255,255,255,0.2); border-radius: 50%; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0; }
  .sezione-titolo .isa { margin-left: auto; font-size: 10px; font-weight: 400; opacity: 0.8; }
  .sezione-body { border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 6px 6px; padding: 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #f8fafc; padding: 6px 8px; text-align: left; font-weight: 600; color: #374151; border-bottom: 2px solid #e5e7eb; }
  .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 12px; }
  .kpi { background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px 12px; }
  .kpi-label { font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; }
  .kpi-value { font-size: 16px; font-weight: 700; color: #1e3a5f; margin-top: 2px; }
  .kpi-sub { font-size: 10px; color: #9ca3af; margin-top: 1px; }
  .stato-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-bottom: 16px; }
  .stato-modulo { text-align: center; padding: 8px 4px; border: 1px solid #e5e7eb; border-radius: 6px; }
  .stato-modulo .n { font-size: 18px; font-weight: 700; color: #1e3a5f; }
  .stato-modulo .label { font-size: 9px; color: #6b7280; margin-top: 2px; line-height: 1.3; }
  .ai-box { background: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 6px; padding: 12px; font-size: 12px; color: #374151; line-height: 1.6; white-space: pre-wrap; }
  .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e5e7eb; display: flex; justify-content: space-between; font-size: 10px; color: #9ca3af; }
  .badge-esito { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; }
  .badge-accettato { background: #dcfce7; color: #16a34a; }
  .badge-sospeso { background: #fef3c7; color: #d97706; }
  .badge-rifiutato { background: #fee2e2; color: #dc2626; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
<div class="page">

  <!-- INTESTAZIONE -->
  <div class="header">
    <div class="header-top">
      <div class="logo-area">
        <h1>RevisoreNano</h1>
        <p>Piattaforma di Revisione Legale — ISA Italia</p>
      </div>
      <div class="meta-area">
        <div><strong>FASCICOLO DI REVISIONE</strong></div>
        <div>Anno esercizio: <strong>${incarico?.annoEsercizio || "—"}</strong></div>
        <div>Tipo incarico: ${incarico?.tipoIncarico?.replace(/_/g, " ") || "—"}</div>
        <div style="margin-top:6px">Generato il: ${dataGenerazione}</div>
      </div>
    </div>
  </div>

  <!-- CLIENTE -->
  <div class="cliente-box">
    <h2>${cliente?.ragioneSociale || "Cliente non specificato"}</h2>
    <div class="meta">
      <span>P.IVA: ${cliente?.partitaIva || "—"}</span>
      <span>C.F.: ${cliente?.codiceFiscale || "—"}</span>
      <span>Forma giuridica: ${cliente?.formaGiuridica?.replace(/_/g, " ") || "—"}</span>
      <span>Settore: ${cliente?.settore || "—"}</span>
      ${cliente?.comune ? `<span>Sede: ${cliente.comune}${cliente.provincia ? ` (${cliente.provincia})` : ""}</span>` : ""}
    </div>
  </div>

  <!-- STATO AVANZAMENTO -->
  <div class="sezione">
    <div class="sezione-titolo">
      <span class="num">◎</span>
      Stato avanzamento fascicolo
    </div>
    <div class="sezione-body">
      <div class="stato-grid">
        ${[
          { n: 1, label: "Accettazione incarico", stato: incarico?.statoModulo1 },
          { n: 2, label: "Comprensione impresa", stato: incarico?.statoModulo2 },
          { n: 3, label: "Valutazione rischio", stato: incarico?.statoModulo3 },
          { n: 4, label: "Materialità", stato: incarico?.statoModulo4 },
          { n: 5, label: "Piano di revisione", stato: incarico?.statoModulo5 },
        ].map(m => `
          <div class="stato-modulo" style="border-color:${m.stato === 2 ? "#86efac" : m.stato === 1 ? "#93c5fd" : "#e5e7eb"}; background:${m.stato === 2 ? "#f0fdf4" : m.stato === 1 ? "#eff6ff" : "#fff"}">
            <div class="n" style="color:${m.stato === 2 ? "#16a34a" : m.stato === 1 ? "#2563eb" : "#9ca3af"}">${m.stato === 2 ? "✓" : m.n}</div>
            <div class="label">${m.label}</div>
          </div>`).join("")}
      </div>
      <div style="font-size:11px;color:#6b7280">
        Documenti caricati: <strong>${documenti.length}</strong> &nbsp;|&nbsp;
        Analizzati: <strong>${documenti.filter(d => d.statoParsing === "completato").length}</strong>
      </div>
    </div>
  </div>

  <!-- MODULO 1: ACCETTAZIONE -->
  <div class="sezione">
    <div class="sezione-titolo">
      <span class="num">1</span>
      Accettazione e continuazione dell'incarico
      <span class="isa">ISA Italia 210 / 220</span>
    </div>
    <div class="sezione-body">
      ${accettazione ? `
        <div style="margin-bottom:10px">
          Esito: <span class="badge-esito badge-${accettazione.esito || "sospeso"}">${accettazione.esito?.replace(/_/g, " ") || "In valutazione"}</span>
          &nbsp;&nbsp;Stato: ${statoModulo(incarico?.statoModulo1)}
        </div>
        <table>
          <thead><tr><th>Verifica</th><th style="width:80px;text-align:center">Esito</th></tr></thead>
          <tbody>
            ${checkItem(accettazione.indipendenzaVerificata, "Indipendenza verificata (ISA Italia 220)")}
            ${checkItem(accettazione.competenzaVerificata, "Competenza professionale verificata")}
            ${checkItem(accettazione.integritaManagementVerificata, "Integrità del management verificata")}
            ${checkItem(accettazione.conflittiInteresseVerificati, "Conflitti di interesse verificati")}
            ${checkItem(accettazione.onorarioDefinito, "Onorario definito")}
            ${checkItem(accettazione.letteraIncaricoFirmata, "Lettera di incarico firmata (ISA Italia 210)")}
          </tbody>
        </table>
        ${accettazione.motivazioneEsito ? `<div style="margin-top:10px;font-size:12px;color:#374151"><strong>Note:</strong> ${accettazione.motivazioneEsito}</div>` : ""}
        ${accettazione.analisiAi ? `<div style="margin-top:10px"><div style="font-size:11px;font-weight:600;color:#6b7280;margin-bottom:4px">ANALISI AI</div><div class="ai-box">${accettazione.analisiAi}</div></div>` : ""}
      ` : '<p style="color:#9ca3af;font-style:italic;font-size:12px">Modulo non ancora compilato.</p>'}
    </div>
  </div>

  <!-- MODULO 2: COMPRENSIONE IMPRESA -->
  <div class="sezione">
    <div class="sezione-titolo">
      <span class="num">2</span>
      Comprensione dell'impresa e del contesto
      <span class="isa">ISA Italia 315</span>
    </div>
    <div class="sezione-body">
      ${comprensione || dati.ricavi ? `
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi-label">Ricavi netti</div><div class="kpi-value">${fmt(comprensione?.ricaviNetti || dati.ricavi)}</div></div>
          <div class="kpi"><div class="kpi-label">Totale attivo</div><div class="kpi-value">${fmt(comprensione?.totaleAttivo || dati.totaleAttivo)}</div></div>
          <div class="kpi"><div class="kpi-label">Patrimonio netto</div><div class="kpi-value">${fmt(comprensione?.patrimonioNetto || dati.patrimonioNetto)}</div></div>
          <div class="kpi"><div class="kpi-label">Utile / Perdita</div><div class="kpi-value" style="color:${Number(comprensione?.utileEsercizio || dati.utile) < 0 ? "#dc2626" : "#16a34a"}">${fmt(comprensione?.utileEsercizio || dati.utile)}</div></div>
          <div class="kpi"><div class="kpi-label">Debiti totali</div><div class="kpi-value">${fmt(comprensione?.debitiTotali || dati.debitiTotali)}</div></div>
          <div class="kpi"><div class="kpi-label">Dipendenti</div><div class="kpi-value">${fmtN(comprensione?.numeroDipendenti || dati.dipendenti)}</div><div class="kpi-sub">unità</div></div>
        </div>
        ${comprensione?.sintesiAi ? `<div style="margin-top:10px"><div style="font-size:11px;font-weight:600;color:#6b7280;margin-bottom:4px">SINTESI AI (ISA Italia 315)</div><div class="ai-box">${comprensione.sintesiAi}</div></div>` : ""}
        ${dati.sintesi ? `<div style="margin-top:10px"><div style="font-size:11px;font-weight:600;color:#6b7280;margin-bottom:4px">SINTESI BILANCIO ESTRATTA</div><div class="ai-box">${dati.sintesi}</div></div>` : ""}
      ` : '<p style="color:#9ca3af;font-style:italic;font-size:12px">Modulo non ancora compilato.</p>'}
    </div>
  </div>

  <!-- MODULO 3: VALUTAZIONE RISCHIO -->
  <div class="sezione">
    <div class="sezione-titolo">
      <span class="num">3</span>
      Valutazione del rischio
      <span class="isa">ISA Italia 315 / 330</span>
    </div>
    <div class="sezione-body">
      ${rischio ? `
        <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:14px">
          <div class="kpi"><div class="kpi-label">Rischio inerente</div><div class="kpi-value">${semaforoRischio(rischio.rischioInerentePunteggio)}</div></div>
          <div class="kpi"><div class="kpi-label">Rischio di controllo</div><div class="kpi-value">${semaforoRischio(rischio.rischioControlloPunteggio)}</div></div>
          <div class="kpi"><div class="kpi-label">RMM (rischio errore significativo)</div><div class="kpi-value">${semaforoRischio(rischio.rmmPunteggio)}</div></div>
        </div>
        <table>
          <thead><tr><th>Area di rischio</th><th style="width:80px;text-align:center">Livello</th><th>Motivazione</th></tr></thead>
          <tbody>${areeRischioHtml}</tbody>
        </table>
        ${rischio.sintesiRischioAi ? `<div style="margin-top:10px"><div style="font-size:11px;font-weight:600;color:#6b7280;margin-bottom:4px">ANALISI AI RISCHI</div><div class="ai-box">${rischio.sintesiRischioAi}</div></div>` : ""}
      ` : '<p style="color:#9ca3af;font-style:italic;font-size:12px">Modulo non ancora compilato.</p>'}
    </div>
  </div>

  <!-- MODULO 4: MATERIALITÀ -->
  <div class="sezione">
    <div class="sezione-titolo">
      <span class="num">4</span>
      Determinazione della materialità
      <span class="isa">ISA Italia 320</span>
    </div>
    <div class="sezione-body">
      ${materialita ? `
        <div class="kpi-grid">
          <div class="kpi">
            <div class="kpi-label">Overall Materiality (OM)</div>
            <div class="kpi-value">${fmt(materialita.overallMateriality)}</div>
            <div class="kpi-sub">Benchmark: ${materialita.benchmarkUsato?.replace(/_/g, " ") || "—"} (${materialita.percentualeBenchmark || "—"}%)</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">Performance Materiality (PM)</div>
            <div class="kpi-value">${fmt(materialita.performanceMateriality)}</div>
            <div class="kpi-sub">Fattore riduzione: ${materialita.fattoreRiduzione ? (Number(materialita.fattoreRiduzione) * 100).toFixed(0) + "%" : "—"}</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">Clearly Trivial Threshold (CTT)</div>
            <div class="kpi-value">${fmt(materialita.clearlyTrivialThreshold)}</div>
            <div class="kpi-sub">5% dell'Overall Materiality</div>
          </div>
        </div>
        ${materialita.giustificazioneMaterialita ? `<div style="margin-top:10px;font-size:12px;color:#374151"><strong>Giustificazione:</strong> ${materialita.giustificazioneMaterialita}</div>` : ""}
      ` : '<p style="color:#9ca3af;font-style:italic;font-size:12px">Modulo non ancora compilato.</p>'}
    </div>
  </div>

  <!-- MODULO 5: PIANO DI REVISIONE -->
  <div class="sezione">
    <div class="sezione-titolo">
      <span class="num">5</span>
      Piano di revisione
      <span class="isa">ISA Italia 300</span>
    </div>
    <div class="sezione-body">
      ${piano ? `
        ${piano.sintesiPianoAi ? `<div style="margin-bottom:12px"><div style="font-size:11px;font-weight:600;color:#6b7280;margin-bottom:4px">PIANO GENERATO CON AI</div><div class="ai-box">${piano.sintesiPianoAi}</div></div>` : ""}
        <table>
          <thead><tr><th>Area di revisione</th><th>Procedure pianificate</th><th style="width:70px;text-align:center">Priorità</th></tr></thead>
          <tbody>${procedureHtml}</tbody>
        </table>
      ` : '<p style="color:#9ca3af;font-style:italic;font-size:12px">Modulo non ancora compilato.</p>'}
    </div>
  </div>

  <!-- DOCUMENTI -->
  <div class="sezione">
    <div class="sezione-titolo">
      <span class="num">◎</span>
      Documenti del fascicolo
    </div>
    <div class="sezione-body">
      ${documenti.length > 0 ? `
        <table>
          <thead><tr><th>Nome file</th><th>Tipo</th><th>Formato</th><th style="width:100px;text-align:center">Stato analisi</th></tr></thead>
          <tbody>
            ${documenti.map(d => `<tr>
              <td style="padding:4px 8px;border-bottom:1px solid #f0f0f0">${d.nomeFile}</td>
              <td style="padding:4px 8px;border-bottom:1px solid #f0f0f0">${d.tipoDocumento?.replace(/_/g, " ") || "—"}</td>
              <td style="padding:4px 8px;border-bottom:1px solid #f0f0f0;text-transform:uppercase;font-size:11px">${d.tipoFile}</td>
              <td style="padding:4px 8px;border-bottom:1px solid #f0f0f0;text-align:center;color:${d.statoParsing === "completato" ? "#16a34a" : d.statoParsing === "errore" ? "#dc2626" : "#d97706"};font-weight:600;font-size:11px">${d.statoParsing === "completato" ? "Analizzato" : d.statoParsing === "errore" ? "Errore" : "In corso"}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      ` : '<p style="color:#9ca3af;font-style:italic;font-size:12px">Nessun documento caricato.</p>'}
    </div>
  </div>

  <!-- FOOTER -->
  <div class="footer">
    <div>RevisoreNano — Piattaforma di Revisione Legale ISA Italia</div>
    <div>Fascicolo generato il ${dataGenerazione} &nbsp;|&nbsp; Riservato e confidenziale</div>
  </div>

</div>
</body>
</html>`;
}

// ─── ROUTER ESPORTAZIONE ──────────────────────────────────────────────────────
export const esportazioneRouter = router({

  // Genera HTML del fascicolo (il frontend lo converte in PDF via window.print)
  fascicolo: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .query(async ({ input }) => {
      const incarico = await getIncaricoById(input.incaricoId);
      if (!incarico) throw new TRPCError({ code: "NOT_FOUND", message: "Incarico non trovato" });

      const [cliente, documenti, accettazione, comprensione, rischio, materialita, piano] = await Promise.all([
        getClienteById(incarico.clienteId),
        getDocumentiByIncarico(input.incaricoId),
        getModuloAccettazione(input.incaricoId),
        getModuloComprensione(input.incaricoId),
        getModuloRischio(input.incaricoId),
        getModuloMaterialita(input.incaricoId),
        getModuloPiano(input.incaricoId),
      ]);

      const dataGenerazione = new Date().toLocaleDateString("it-IT", {
        day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit"
      });

      const html = generaHtmlFascicolo({
        cliente,
        incarico,
        documenti,
        accettazione,
        comprensione,
        rischio,
        materialita,
        piano,
        dataGenerazione,
      });

      return { html, nomeFile: `fascicolo-${cliente?.ragioneSociale?.replace(/\s+/g, "-").toLowerCase()}-${incarico.annoEsercizio}.pdf` };
    }),
});
