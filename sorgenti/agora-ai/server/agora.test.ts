import { describe, expect, it } from "vitest";
import { chooseSynthesisProvider, configuredRequestedProviders, DEFAULT_ROLES, isOpenRouterCompatible, OPENROUTER_MODEL_FALLBACKS, PROVIDER_IDS, PROVIDERS } from "../shared/agents";
import { extractPeerReviewScores, peerReviewRepairPrompt } from "../shared/peerReviews";
import { adaptiveOutputBudget, calculateCostUsd, estimateTextTokens, peerReviewOutputBudget, peerReviewRepairOutputBudget, sumKnownCosts, TOKEN_BUDGETS } from "../shared/usage";
import { decryptSecret, encryptSecret } from "./crypto";
import { evaluationTypeForTiers, reviewForDisplay, reviewForRunDisplay } from "./db";
import { applyRankingSignal, attachmentDownloadForUser, documentOutputFallback, enforceHardBudget, incompleteRunsForSynthesis, isOpenRouterCredentialRejected, persistRoleOverrides, rolesForSession, seniorPromptFromDossier, suggestedRoles, synthesisCoverage } from "./routers/agora";

describe("Agorà AI: configurazione e segreti", () => {
  it("mantiene esattamente i sei agenti concordati", () => {
    expect(PROVIDER_IDS).toEqual(["openai", "anthropic", "gemini", "kimi", "manus", "perplexity"]);
    expect(Object.keys(PROVIDERS)).toHaveLength(6);
  });

  it("fornisce un ruolo iniziale per ciascun agente", () => {
    expect(PROVIDER_IDS.every(provider => DEFAULT_ROLES[provider].length > 1)).toBe(true);
  });

  it("dedica i budget più compatti alle verifiche e alle sintesi", () => {
    const compactInstruction = "Rispondi esclusivamente con OK.";
    expect(compactInstruction.length).toBeLessThan(40);
  });

  it("può sintetizzare con il primo provider configurato, senza dipendere da ChatGPT", () => {
    expect(chooseSynthesisProvider(["gemini", "perplexity"])).toBe("gemini");
    expect(chooseSynthesisProvider(["perplexity"])).toBe("perplexity");
    expect(chooseSynthesisProvider([])).toBeUndefined();
  });

  it("limita una sessione agli agenti selezionati e realmente configurati", () => {
    expect(configuredRequestedProviders(["manus", "anthropic", "perplexity"], ["manus", "anthropic"])).toEqual(["anthropic", "manus"]);
    expect(configuredRequestedProviders(["openai"], [])).toEqual([]);
  });

  it("usa OpenRouter per cinque agenti e mantiene Manus separato", () => {
    expect(PROVIDER_IDS.filter(isOpenRouterCompatible)).toEqual(["openai", "anthropic", "gemini", "kimi", "perplexity"]);
    expect(isOpenRouterCompatible("manus")).toBe(false);
    expect(OPENROUTER_MODEL_FALLBACKS.anthropic.recommended).toMatch(/^anthropic\//);
  });

  it("riconosce l’errore OpenRouter User not found come chiave non valida", () => {
    expect(isOpenRouterCredentialRejected(401, '{"error":{"message":"User not found."}}')).toBe(true);
    expect(isOpenRouterCredentialRejected(403, '{"error":{"message":"Credit limit reached"}}')).toBe(false);
  });

  it("usa il fallback ChatGPT se GPT-5 esaurisce il budget senza testo", () => {
    const prompt = "Tema\n--- Contesto documentale selezionato ---\nPDF\n--- Fine contesto documentale ---";
    expect(documentOutputFallback("openai", "openrouter", "openai/gpt-5-mini", prompt, "Il modello ha esaurito il budget di risposta prima di produrre testo.")).toBe("openai/gpt-4.1-mini");
    expect(documentOutputFallback("openai", "openrouter", "openai/gpt-5-mini", "Tema senza allegati", "Il modello ha esaurito il budget di risposta prima di produrre testo.")).toBe("openai/gpt-4.1-mini");
  });

  it("consegna un download firmato solo dopo il controllo dell’allegato del proprietario", async () => {
    const result = await attachmentDownloadForUser(7, 12, async (userId, ids) => userId === 7 && ids[0] === 12 ? [{ storageKey: "agora-ai/7/doc.txt", fileName: "doc.txt" }] as any : [], async key => `https://signed.example/${key}`);
    expect(result).toEqual({ fileName: "doc.txt", url: "https://signed.example/agora-ai/7/doc.txt" });
    await expect(attachmentDownloadForUser(7, 99, async () => [] as any, async key => key)).rejects.toThrow("Allegato non disponibile");
  });

  it("blocca prima dell’avvio se una soglia hard è superata o il preventivo è incompleto", () => {
    expect(() => enforceHardBudget(null, { estimatedCostUsd: null, costComplete: false })).not.toThrow();
    expect(() => enforceHardBudget(0.01, { estimatedCostUsd: 0.02, costComplete: true })).toThrow("Soglia hard superata");
    expect(() => enforceHardBudget(0.01, { estimatedCostUsd: 0.001, costComplete: false })).toThrow("preventivo non è completo");
  });

  it("non espone il JSON tecnico dei voti nella replica leggibile", () => {
    const review = 'Accordo iniziale. {"peer_scores":[{"provider":"gemini","reasoning":8,"evidence":7,"utility":9,"role_fit":8,"rationale":"utile"}]} Raccomandazione finale.';
    expect(reviewForDisplay(review)).toBe("Accordo iniziale. Raccomandazione finale.");
    expect(reviewForDisplay('```json\n{"peer_scores":[]}\n```')).toContain("Valutazioni tecniche registrate");
  });

  it("identifica una valutazione parziale anche nelle sessioni già salvate", () => {
    expect(reviewForRunDisplay("Replica ricevuta, ma valutazione strutturata incompleta.", "partial")).toBe("Valutazione parziale — Replica ricevuta, ma valutazione strutturata incompleta.");
  });

  it("classifica in modo esplicito le valutazioni tra pari e senior-verso-junior", () => {
    expect(evaluationTypeForTiers("junior", "junior")).toBe("peer");
    expect(evaluationTypeForTiers("senior", "senior")).toBe("peer");
    expect(evaluationTypeForTiers("senior", "junior")).toBe("cross_tier");
  });

  it("accetta solo voti 1-10 degli altri agenti e rifiuta l’autovalutazione", () => {
    const text = `Replica critica.

\`\`\`json
{"peer_scores":[
  {"provider":"anthropic","reasoning":8,"evidence":7,"utility":9,"role_fit":8,"rationale":"Contributo concreto"},
  {"provider":"openai","reasoning":10,"evidence":10,"utility":10,"role_fit":10,"rationale":"Autovalutazione"},
  {"provider":"gemini","reasoning":0,"evidence":7,"utility":8,"role_fit":8,"rationale":"Voto non valido"}
]}
\`\`\``;
    const parsed = extractPeerReviewScores(text, "openai", ["anthropic", "gemini"]);
    expect(parsed.cleanText).toBe("Replica critica.");
    expect(parsed.scores).toHaveLength(1);
    expect(parsed.complete).toBe(false);
    expect(parsed.scores[0]).toMatchObject({ subjectProvider: "anthropic", overallScore: 8, rationale: "Contributo concreto" });
  });

  it("prepara una repair call che non inventa soggetti o autovalutazioni", () => {
    const prompt = peerReviewRepairPrompt({ originalText: '{"peer_scores":[{"provider":"anthropic"}', evaluatorProvider: "openai", eligibleSubjects: ["openai", "anthropic", "gemini"] });
    expect(prompt).toContain("anthropic, gemini");
    expect(prompt).not.toContain('"provider":"openai"');
    expect(prompt).toContain('restituisci {"peer_scores":[]}');
  });

  it("propone ruoli tecnici complementari quando la richiesta riguarda un’app", () => {
    const proposal = suggestedRoles("Dobbiamo progettare un'app con API, database e correzione bug.");
    expect(proposal.type).toBe("progetto tecnico");
    expect(proposal.roles.manus).toBe("Pianificatore di implementazione");
    expect(proposal.roles.anthropic).toBe("Revisore tecnico critico");
  });

  it("classifica una domanda sul contesto umano come riflessione concettuale", () => {
    const proposal = suggestedRoles("Confrontatevi sulla possibilità che un modello linguistico sviluppi una reale comprensione del contesto umano.");
    expect(proposal.type).toBe("riflessione concettuale");
    expect(proposal.roles.anthropic).toBe("Critico filosofico");
  });

  it("mantiene un ruolo modificato quando prepara la sessione", () => {
    const proposal = suggestedRoles("Dobbiamo progettare un'app con API, database e correzione bug.");
    const roles = rolesForSession([], { ...proposal.roles, manus: "Responsabile del piano tecnico" });
    expect(roles.manus).toBe("Responsabile del piano tecnico");
    expect(roles.openai).toBe("Architetto di prodotto");
  });

  it("blocca il verdetto se manca una risposta o una replica richiesta", () => {
    expect(incompleteRunsForSynthesis([{ provider: "openai", status: "completed", reviewStatus: "completed" }, { provider: "anthropic", status: "failed", reviewStatus: null }])).toHaveLength(1);
    expect(incompleteRunsForSynthesis([{ provider: "openai", status: "completed", reviewStatus: "completed" }, { provider: "anthropic", status: "completed", reviewStatus: "failed" }])).toHaveLength(1);
    expect(incompleteRunsForSynthesis([{ provider: "openai", status: "completed", reviewStatus: "skipped" }])).toHaveLength(0);
  });

  it("consente il dossier economico con una valutazione parziale ma non con una risposta iniziale fallita", () => {
    expect(incompleteRunsForSynthesis([{ provider: "junior_analyst", status: "completed", reviewStatus: "partial" }], true)).toHaveLength(0);
    expect(incompleteRunsForSynthesis([{ provider: "junior_analyst", status: "failed", reviewStatus: "partial" }], true)).toHaveLength(1);
  });

  it("consente un verdetto parziale con una sola posizione assente, ma non con due", () => {
    expect(synthesisCoverage([{ provider: "openai", status: "completed", response: "ok" }, { provider: "anthropic", status: "completed", response: "ok" }, { provider: "gemini", status: "failed", response: null }]).canSynthesize).toBe(true);
    expect(synthesisCoverage([{ provider: "openai", status: "completed", response: "ok" }, { provider: "anthropic", status: "failed", response: null }, { provider: "gemini", status: "failed", response: null }]).canSynthesize).toBe(true);
    expect(synthesisCoverage([{ provider: "openai", status: "failed", response: null }, { provider: "anthropic", status: "failed", response: null }]).canSynthesize).toBe(false);
  });

  it("mantiene la domanda originale come focus prioritario dei senior", () => {
    const prompt = seniorPromptFromDossier("Quale strategia adottare?", "Il dossier suggerisce A.");
    expect(prompt.indexOf("Quale strategia adottare?")).toBeLessThan(prompt.indexOf("Il dossier suggerisce A."));
    expect(prompt).toContain("almeno l'80% del testo");
    expect(prompt).toContain("Non trasformare la risposta in una recensione");
  });

  it("usa il ranking solo con un campione sufficiente e lo rende esplicito", () => {
    const proposal = suggestedRoles("Dobbiamo progettare un'app con API, database e correzione bug.");
    expect(applyRankingSignal(proposal, [{ provider: "manus", sampleSize: 4, overallScore: 9.2 }]).rankingSignal).toBeNull();
    const ranked = applyRankingSignal(proposal, [{ provider: "manus", sampleSize: 12, overallScore: 8.4 }]);
    expect(ranked.rankingSignal).toEqual({ provider: "manus", score: 8.4, sampleSize: 12 });
    expect(ranked.roles.manus).toContain("esperienza tra pari");
  });

  it("salva tutti i ruoli modificati prima della creazione della sessione", async () => {
    const roles = suggestedRoles("Dobbiamo progettare un'app con API, database e correzione bug.").roles;
    const saved: Array<{ userId: number; provider: string; role: string }> = [];
    await persistRoleOverrides(42, roles, async input => { saved.push(input); });
    expect(saved).toHaveLength(PROVIDER_IDS.length);
    expect(saved).toContainEqual({ userId: 42, provider: "manus", role: "Pianificatore di implementazione" });
  });

  it("calcola il costo dalla tariffa per milione di token", () => {
    const cost = calculateCostUsd({ inputTokens: 2_000, outputTokens: 500, totalTokens: 2_500, source: "reported" }, 2, 10);
    expect(cost).toBe(0.009);
  });

  it("mantiene un preventivo token per ogni fase del dibattito", () => {
    expect(TOKEN_BUDGETS.openai.initialOutput).toBeGreaterThan(TOKEN_BUDGETS.openai.reviewOutput);
    expect(TOKEN_BUDGETS.gemini.synthesisOutput).toBeGreaterThan(0);
    expect(estimateTextTokens("Quattro parole molto brevi")).toBeGreaterThan(0);
  });

  it("garantisce anche a una domanda breve il budget minimo anti-interruzione", () => {
    const shortPrompt = "Confrontatevi sulla comprensione del contesto umano da parte dei modelli linguistici.";
    expect(adaptiveOutputBudget("openai", "initial", shortPrompt)).toBeGreaterThanOrEqual(2_400);
    expect(adaptiveOutputBudget("openai", "initial", shortPrompt)).toBeLessThanOrEqual(adaptiveOutputBudget("openai", "initial", "x".repeat(3_000)));
  });

  it("riserva spazio sufficiente per i voti obbligatori della replica", () => {
    expect(peerReviewOutputBudget("openai", "Tema breve", 2)).toBeGreaterThanOrEqual(220);
    expect(peerReviewOutputBudget("openai", "Tema breve", 8)).toBeGreaterThanOrEqual(550);
    expect(peerReviewRepairOutputBudget(2)).toBeLessThan(peerReviewOutputBudget("openai", "Tema breve", 2));
    expect(peerReviewRepairOutputBudget(8)).toBeLessThanOrEqual(1_000);
  });

  it("segnala quando il totale economico non ha tutte le tariffe", () => {
    expect(sumKnownCosts([0.01, null, 0.02])).toEqual({ amount: 0.03, complete: false });
    expect(sumKnownCosts([0.01, 0.02])).toEqual({ amount: 0.03, complete: true });
  });

  it("cifra le chiavi API senza conservarle in chiaro", () => {
    const original = "private-api-key-example";
    const encrypted = encryptSecret(original);
    expect(encrypted).not.toContain(original);
    expect(decryptSecret(encrypted)).toBe(original);
  });
});
