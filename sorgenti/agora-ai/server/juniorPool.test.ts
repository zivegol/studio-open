import { describe, expect, it, vi } from "vitest";
import { extractPeerReviewScores } from "../shared/peerReviews";
import { applyJuniorCoordination, executeWithJuniorFallback, JUNIOR_PROVIDER_IDS, juniorFallbackCandidate, juniorRolesForTheme, parseJuniorCoordination, selectCrossFamilyJuniorFallback } from "../shared/juniorPool";

describe("junior pool", () => {
  it("assegna tre ruoli complementari per una riflessione concettuale", () => {
    const roles = juniorRolesForTheme("riflessione concettuale");
    expect(roles.map(role => role.provider)).toEqual([...JUNIOR_PROVIDER_IDS]);
    expect(roles.map(role => role.role)).toContain("Controargomentatore filosofico");
  });

  it("accetta il piano strutturato del coordinatore e applica incarichi specifici", () => {
    const coordination = parseJuniorCoordination(JSON.stringify({ domain: "fiscale", complexity: "alta", teamReason: "Servono calcolo, critica e fonti.", assignments: [
      { provider: "junior_analyst", role: "Analista fiscale", objective: "Ricostruire il trattamento applicabile", reason: "Definisce la tesi" },
      { provider: "junior_critic", role: "Revisore prudenziale", objective: "Cercare eccezioni e rischi", reason: "Controlla la tesi" },
      { provider: "junior_researcher", role: "Verificatore normativo", objective: "Individuare fonti e dati mancanti", reason: "Verifica i presupposti" },
    ] }));
    expect(coordination?.domain).toBe("fiscale");
    expect(applyJuniorCoordination(juniorRolesForTheme("strategia generale"), coordination)[0].role).toContain("Ricostruire il trattamento");
  });

  it("rifiuta un piano incompleto e conserva la squadra di sicurezza", () => {
    expect(parseJuniorCoordination('{"domain":"tecnico"}')).toBeNull();
    const fallback = juniorRolesForTheme("progetto tecnico");
    expect(applyJuniorCoordination(fallback, null)).toBe(fallback);
  });

  it("accetta voti completi da 1 a 10 tra junior e rifiuta l’autovalutazione", () => {
    const text = `Replica breve.\n\n\`\`\`json
{"peer_scores":[
  {"provider":"junior_critic","reasoning":8,"evidence":7,"utility":9,"role_fit":8,"rationale":"Critica utile"},
  {"provider":"junior_researcher","reasoning":7,"evidence":8,"utility":8,"role_fit":9,"rationale":"Buona ricerca"},
  {"provider":"junior_analyst","reasoning":10,"evidence":10,"utility":10,"role_fit":10,"rationale":"Auto voto"}
]}
\`\`\``;
    const result = extractPeerReviewScores(text, "junior_analyst", ["junior_analyst", "junior_critic", "junior_researcher"]);
    expect(result.complete).toBe(true);
    expect(result.scores).toHaveLength(2);
    expect(result.scores.some(score => score.subjectProvider === "junior_analyst")).toBe(false);
  });

  it("accetta anche il JSON dei voti senza recinti Markdown", () => {
    const text = '{"peer_scores":[{"provider":"junior_critic","reasoning":8,"evidence":7,"utility":9,"role_fit":8,"rationale":"Critica utile"},{"provider":"junior_researcher","reasoning":7,"evidence":8,"utility":8,"role_fit":9,"rationale":"Buona ricerca"}]}';
    const result = extractPeerReviewScores(text, "junior_analyst", ["junior_analyst", "junior_critic", "junior_researcher"]);
    expect(result.complete).toBe(true);
    expect(result.scores).toHaveLength(2);
    expect(result.cleanText).toBe("");
  });

  it("sceglie il fallback economico solo quando differisce dal modello principale", () => {
    expect(juniorFallbackCandidate("mistralai/mistral-nemo", "openai/gpt-4.1-nano")).toBe("openai/gpt-4.1-nano");
    expect(juniorFallbackCandidate("mistralai/mistral-nemo", "mistralai/mistral-nemo")).toBeUndefined();
    expect(juniorFallbackCandidate("mistralai/mistral-nemo", null)).toBeUndefined();
  });

  it("sceglie un fallback junior di una famiglia diversa dal modello gratuito", () => {
    expect(selectCrossFamilyJuniorFallback("mistralai/mistral-nemo", ["mistralai/mistral-small-3.2-24b-instruct", "qwen/qwen3.7-flash"])).toBe("qwen/qwen3.7-flash");
  });

  it("ripete il dossier junior con il fallback se il modello principale fallisce", async () => {
    const execute = vi.fn(async (model: string) => {
      if (model === "mistralai/mistral-nemo") throw new Error("modello non disponibile");
      return "Dossier completato";
    });
    const result = await executeWithJuniorFallback({ primaryModel: "mistralai/mistral-nemo", fallbackModel: "openai/gpt-4.1-nano", execute });
    expect(execute).toHaveBeenCalledWith("mistralai/mistral-nemo");
    expect(execute).toHaveBeenCalledWith("openai/gpt-4.1-nano");
    expect(result).toEqual({ result: "Dossier completato", model: "openai/gpt-4.1-nano", fallbackUsed: true });
  });

  it("esclude modelli gratuiti e le famiglie che hanno restituito User not found", () => {
    const candidates = juniorRolesForTheme("strategia generale").flatMap(agent => [...agent.preferredModels, ...agent.fallbackModels]);
    expect(candidates.every(model => !model.endsWith(":free"))).toBe(true);
    expect(candidates.every(model => !model.startsWith("z-ai/") && !model.startsWith("nvidia/"))).toBe(true);
  });
});
