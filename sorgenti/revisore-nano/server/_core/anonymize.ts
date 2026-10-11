// Aggiungere questo file come server/_core/anonymize.ts
// Utility per anonimizzare dati prima di inviarli all'AI Anthropic

/**
 * Sostituisce la ragione sociale con un identificativo anonimo
 * prima di inviare i dati all'AI.
 * I dati reali restano solo nel database locale.
 */
export function anonymizeCliente(cliente: {
  ragioneSociale?: string | null;
  codiceFiscale?: string | null;
  partitaIva?: string | null;
  settore?: string | null;
  formaGiuridica?: string | null;
  comune?: string | null;
  provincia?: string | null;
} | null | undefined, incaricoId: number): {
  label: string;
  settore: string;
  formaGiuridica: string;
  area: string;
} {
  if (!cliente) return { label: `Azienda #${incaricoId}`, settore: "N/D", formaGiuridica: "N/D", area: "N/D" };
  return {
    label: `Azienda #${incaricoId}`,           // NON invia ragione sociale
    settore: cliente.settore || "N/D",          // settore ok (non identificativo)
    formaGiuridica: cliente.formaGiuridica || "N/D",  // forma giuridica ok
    area: cliente.provincia || "N/D",           // provincia ok (non comune specifico)
    // codiceFiscale e partitaIva: MAI inviati
  };
}

/**
 * Anonimizza importi bilancio mantenendo le proporzioni
 * (opzionale — attivare solo se si vuole massima privacy)
 */
export function anonymizeAmounts(amounts: Record<string, number>, factor?: number): Record<string, number> {
  // Di default non anonimizza gli importi (necessari per analisi corretta)
  // Se factor è fornito, moltiplica tutti gli importi per un fattore costante
  if (!factor) return amounts;
  return Object.fromEntries(Object.entries(amounts).map(([k, v]) => [k, Math.round(v * factor)]));
}
