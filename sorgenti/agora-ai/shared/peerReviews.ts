import type { ProviderId } from "./agents";

export type PeerReviewScore = {
  subjectProvider: string;
  reasoningScore: number;
  evidenceScore: number;
  utilityScore: number;
  roleFitScore: number;
  overallScore: number;
  rationale: string;
};

function score(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 10) return undefined;
  return numeric;
}

export function extractPeerReviewScores(text: string, evaluatorProvider: string, eligibleSubjects: string[]) {
  const fenced = text.match(/```json\s*([\s\S]*?)\s*```/i);
  const rawStart = text.indexOf('{"peer_scores"');
  const rawJson = rawStart >= 0 ? text.slice(rawStart).trim() : undefined;
  const json = fenced?.[1] ?? rawJson;
  if (!json) return { cleanText: text.trim(), scores: [] as PeerReviewScore[], complete: false };
  try {
    const parsed = JSON.parse(json) as { peer_scores?: Array<Record<string, unknown>> };
    const allowed = new Set(eligibleSubjects.filter(provider => provider !== evaluatorProvider));
    const bySubject = new Map<string, PeerReviewScore>();
    (parsed.peer_scores ?? []).forEach(item => {
      const subjectProvider = typeof item.provider === "string" && allowed.has(item.provider) ? item.provider : undefined;
      const reasoningScore = score(item.reasoning);
      const evidenceScore = score(item.evidence);
      const utilityScore = score(item.utility);
      const roleFitScore = score(item.role_fit);
      if (!subjectProvider || !allowed.has(subjectProvider) || !reasoningScore || !evidenceScore || !utilityScore || !roleFitScore) return;
      const rationale = typeof item.rationale === "string" ? item.rationale.trim().slice(0, 280) : "";
      bySubject.set(subjectProvider, { subjectProvider, reasoningScore, evidenceScore, utilityScore, roleFitScore, overallScore: (reasoningScore + evidenceScore + utilityScore + roleFitScore) / 4, rationale });
    });
    const scores = Array.from(bySubject.values());
    const cleanText = fenced ? text.replace(fenced[0], "").trim() : text.slice(0, rawStart).trim();
    return { cleanText, scores, complete: scores.length === allowed.size };
  } catch {
    return { cleanText: text.trim(), scores: [] as PeerReviewScore[], complete: false };
  }
}

export function peerReviewRepairPrompt(input: { originalText: string; evaluatorProvider: string; eligibleSubjects: string[] }) {
  const subjects = input.eligibleSubjects.filter(provider => provider !== input.evaluatorProvider);
  const template = subjects.map(provider => `{"provider":"${provider}","reasoning":1,"evidence":1,"utility":1,"role_fit":1,"rationale":"motivo breve"}`).join(",");
  return `Converti esclusivamente la valutazione seguente nel JSON valido richiesto. Non inventare punteggi mancanti: se non puoi recuperare con certezza TUTTI i soggetti, restituisci {"peer_scores":[]}.

Soggetti obbligatori: ${subjects.join(", ")}.
Valutatore: ${input.evaluatorProvider}.
Schema obbligatorio:
{"peer_scores":[${template}]}

Output originale:
${input.originalText.slice(0, 5_000)}`;
}
