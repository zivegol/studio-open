import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { chooseSynthesisProvider, configuredRequestedProviders, DEFAULT_ROLES, isOpenRouterCompatible, OPENROUTER_MODEL_FALLBACKS, PROVIDERS, PROVIDER_IDS, type ProviderId } from "../../shared/agents";
import { applyJuniorCoordination, executeWithJuniorFallback, JUNIOR_PROVIDER_IDS, juniorFallbackCandidate, juniorRolesForTheme, parseJuniorCoordination, type JuniorAgent, type JuniorCoordination, type JuniorProviderId } from "../../shared/juniorPool";
import { extractPeerReviewScores, peerReviewRepairPrompt } from "../../shared/peerReviews";
import { adaptiveOutputBudget, calculateCostUsd, estimateTextTokens, peerReviewOutputBudget, peerReviewRepairOutputBudget, reviewExcerptCharacters, sumKnownCosts, TOKEN_BUDGETS, type ProviderUsage } from "../../shared/usage";
import { decryptSecret, encryptSecret } from "../crypto";
import { attachDocumentsToSession, createAgentRuns, createDeliberationSession, createSessionAttachment, evaluationTypeForTiers, getAgentModelsForUser, getAttachmentsByIdsForUser, getCredentialsForUser, getHardBudgetForUser, getPeerStatisticsForUser, getRolesForUser, getSessionWithRuns, listSessionAttachmentsForUser, listSessionsForUser, removeCredential, saveAgentModel, saveAgentRole, saveCredential, saveHardBudgetForUser, savePeerEvaluations, saveSessionSynthesis, updateAgentRun } from "../db";
import { documentContext, extractDocumentText, MAX_DOCUMENTS_PER_SESSION, MAX_DOCUMENT_BYTES, validateDocument } from "../documents";
import { runProvider } from "../providers";
import { storageGetSignedUrl, storagePut } from "../storage";
import { protectedProcedure, router } from "../_core/trpc";

const providerSchema = z.enum(PROVIDER_IDS);
const juniorProviderSchema = z.enum(JUNIOR_PROVIDER_IDS);
const runnableProviderSchema = z.union([providerSchema, juniorProviderSchema]);
const roleSchema = z.string().trim().min(2).max(180);
const priceSchema = z.number().min(0).max(1_000_000).nullable().optional();
const channelSchema = z.enum(["direct", "openrouter"]);
const modelSchema = z.string().trim().min(3).max(128);
const attachmentIdsSchema = z.array(z.number().int().positive()).max(MAX_DOCUMENTS_PER_SESSION).default([]);
const uploadAttachmentSchema = z.object({ fileName: z.string().trim().min(1).max(180), mimeType: z.string().trim().max(160), base64: z.string().min(4).max(Math.ceil(MAX_DOCUMENT_BYTES * 1.4)) });

type OpenRouterCatalogModel = { id: string; name: string; pricing?: { prompt?: string; completion?: string }; benchmarks?: { artificial_analysis?: { intelligence_index?: number } } };
let catalogCache: { expiresAt: number; models: OpenRouterCatalogModel[] } | undefined;

async function getOpenRouterCatalog() {
  if (catalogCache && catalogCache.expiresAt > Date.now()) return catalogCache.models;
  const response = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(9_000) });
  if (!response.ok) throw new Error("Catalogo OpenRouter temporaneamente non disponibile.");
  const payload = await response.json() as { data?: OpenRouterCatalogModel[] };
  const models = payload.data ?? [];
  catalogCache = { models, expiresAt: Date.now() + 15 * 60 * 1000 };
  return models;
}

function pricingScore(model: OpenRouterCatalogModel) {
  return Number(model.pricing?.prompt ?? "Infinity") + Number(model.pricing?.completion ?? "Infinity");
}

function isJuniorProvider(provider: string): provider is JuniorProviderId {
  return (JUNIOR_PROVIDER_IDS as readonly string[]).includes(provider);
}

function labelForRun(provider: string) {
  if (provider === "junior_analyst") return "Junior analista";
  if (provider === "junior_critic") return "Junior critico";
  if (provider === "junior_researcher") return "Junior ricercatore";
  return PROVIDERS[provider as ProviderId]?.label ?? provider;
}

function availableJuniorModel(modelIds: string[], catalog: OpenRouterCatalogModel[]) {
  return modelIds
    .map(id => catalog.find(model => model.id === id && !model.id.includes(":batch") && !model.id.endsWith(":free")))
    .find((model): model is OpenRouterCatalogModel => Boolean(model));
}

export function juniorModelFor(agent: JuniorAgent, catalog: OpenRouterCatalogModel[]) {
  const primary = availableJuniorModel(agent.preferredModels, catalog);
  if (!primary) throw new Error("Nessun modello junior economico affidabile è disponibile nel catalogo OpenRouter.");
  const primaryFamily = primary.id.split("/")[0];
  const fallback = availableJuniorModel(agent.fallbackModels.filter(model => model.split("/")[0] !== primaryFamily), catalog)
    ?? availableJuniorModel(agent.preferredModels.filter(model => model !== primary.id && model.split("/")[0] !== primaryFamily), catalog)
    ?? availableJuniorModel(agent.fallbackModels.filter(model => model !== primary.id), catalog)
    ?? null;
  return { model: primary.id, fallbackModel: fallback?.id ?? null, label: primary.name };
}

function juniorPoolForPrompt(prompt: string, catalog: OpenRouterCatalogModel[], coordination: JuniorCoordination | null = null) {
  const theme = suggestedRoles(prompt).type;
  return applyJuniorCoordination(juniorRolesForTheme(theme), coordination).map(agent => ({ ...agent, ...juniorModelFor(agent, catalog) }));
}

async function coordinateJuniorTeam(prompt: string, apiKey: string) {
  const coordinatorModel = "openai/gpt-5.4-mini";
  const instruction = `Sei il coordinatore del pool junior di Agorà. Analizza la richiesta e progetta esattamente tre incarichi complementari, concreti e non sovrapposti. Non risolvere il problema. Assegna junior_analyst alla costruzione dell'analisi, junior_critic alla verifica critica e junior_researcher al controllo di presupposti/fonti o alla competenza specialistica più utile. Adatta davvero i tre incarichi al dominio del prompt. Restituisci esclusivamente JSON valido con questa struttura: {"domain":"...","complexity":"bassa|media|alta","teamReason":"...","assignments":[{"provider":"junior_analyst","role":"...","objective":"...","reason":"..."},{"provider":"junior_critic","role":"...","objective":"...","reason":"..."},{"provider":"junior_researcher","role":"...","objective":"...","reason":"..."}]}.\n\nRICHIESTA DA ORGANIZZARE:\n${excerpt(prompt, 8_000)}`;
  try {
    const result = await runProvider({ provider: "openai", apiKey, model: coordinatorModel, apiChannel: "openrouter", role: "coordinatore junior e assegnatore degli incarichi", prompt: instruction, maxOutputTokens: 1_200 });
    return { coordination: parseJuniorCoordination(result.text), coordinatorModel, usage: result.usage };
  } catch {
    return { coordination: null, coordinatorModel, usage: null };
  }
}

function juniorEstimateForPrompt(prompt: string, catalog: OpenRouterCatalogModel[]) {
  const pool = juniorPoolForPrompt(prompt, catalog);
  const promptTokens = estimateTextTokens(prompt) + 80;
  const members = pool.map(agent => {
    const model = catalog.find(item => item.id === agent.model);
    const initial: ProviderUsage = { inputTokens: promptTokens, outputTokens: 180, totalTokens: promptTokens + 180, source: "estimated" };
    const review: ProviderUsage = { inputTokens: promptTokens + 340, outputTokens: 150, totalTokens: promptTokens + 490, source: "estimated" };
    const total: ProviderUsage = { inputTokens: initial.inputTokens + review.inputTokens, outputTokens: initial.outputTokens + review.outputTokens, totalTokens: initial.totalTokens + review.totalTokens, source: "estimated" };
    const costUsd = calculateCostUsd(total, Number(model?.pricing?.prompt ?? NaN) * 1_000_000, Number(model?.pricing?.completion ?? NaN) * 1_000_000);
    return { ...agent, initial, review, total, costUsd };
  });
  const synthesis: ProviderUsage = { inputTokens: promptTokens + 700, outputTokens: 260, totalTokens: promptTokens + 960, source: "estimated" };
  const firstModel = catalog.find(item => item.id === members[0]?.model);
  const synthesisCost = calculateCostUsd(synthesis, Number(firstModel?.pricing?.prompt ?? NaN) * 1_000_000, Number(firstModel?.pricing?.completion ?? NaN) * 1_000_000);
  const costs = sumKnownCosts([...members.map(member => member.costUsd), synthesisCost]);
  return { pool: members, synthesis, estimatedTokens: members.reduce((sum, member) => sum + member.total.totalTokens, synthesis.totalTokens), estimatedCostUsd: costs.amount, costComplete: costs.complete, theme: suggestedRoles(prompt).type, composition: { promptTokens, reviewExcerptCharacters: 900, agentCount: members.length } };
}

function compactCatalogFor(provider: Exclude<ProviderId, "manus">, catalog: OpenRouterCatalogModel[]) {
  const prefix = provider === "openai" ? "openai/" : provider === "anthropic" ? "anthropic/" : provider === "gemini" ? "google/" : provider === "kimi" ? "moonshotai/" : "perplexity/";
  const candidates = catalog.filter(model => model.id.startsWith(prefix) && !model.id.includes(":batch"));
  const fallback = OPENROUTER_MODEL_FALLBACKS[provider];
  const fallbackModel = candidates.find(model => model.id === fallback.recommended) ?? candidates[0];
  const economical = [...candidates].sort((a, b) => pricingScore(a) - pricingScore(b))[0] ?? fallbackModel;
  const curatedPowerful: Record<Exclude<ProviderId, "manus">, string> = {
    openai: "openai/gpt-5.4",
    anthropic: "anthropic/claude-opus-4.6",
    gemini: "google/gemini-3.1-pro-preview",
    kimi: "moonshotai/kimi-k2.5",
    perplexity: "perplexity/sonar-pro",
  };
  const powerful = candidates.find(model => model.id === curatedPowerful[provider])
    ?? [...candidates].sort((a, b) => (b.benchmarks?.artificial_analysis?.intelligence_index ?? -1) - (a.benchmarks?.artificial_analysis?.intelligence_index ?? -1))[0]
    ?? fallbackModel;
  return { recommended: fallbackModel ? { id: fallbackModel.id, name: fallbackModel.name } : { id: fallback.recommended, name: fallback.recommended }, economical: economical ? { id: economical.id, name: economical.name } : { id: fallback.economical, name: fallback.economical }, powerful: powerful ? { id: powerful.id, name: powerful.name } : { id: fallback.recommended, name: fallback.recommended } };
}

function rolesByProvider(savedRoles: Array<{ provider: string; role: string }>) {
  const saved = new Map(savedRoles.map(item => [item.provider, item.role]));
  return Object.fromEntries(PROVIDER_IDS.map(provider => [provider, saved.get(provider) || DEFAULT_ROLES[provider]])) as Record<ProviderId, string>;
}

export function rolesForSession(savedRoles: Array<{ provider: string; role: string }>, overrides?: Partial<Record<ProviderId, string>>) {
  return { ...rolesByProvider(savedRoles), ...overrides } as Record<ProviderId, string>;
}

export function incompleteRunsForSynthesis(runs: Array<{ provider: string; status: string; reviewStatus: string | null }>, allowPartialReviews = false) {
  const requiresReview = runs.length > 1;
  return runs.filter(run => run.status !== "completed" || (requiresReview && run.reviewStatus !== "completed" && !(allowPartialReviews && run.reviewStatus === "partial")));
}

export function synthesisCoverage<T extends { provider: string; status: string; response: string | null }>(runs: T[]) {
  const successful = runs.filter(run => run.status === "completed" && run.response);
  const missingPositions = runs.filter(run => run.status !== "completed" || !run.response);
  return { successful, missingPositions, canSynthesize: successful.length >= 1 };
}

export function documentOutputFallback(provider: ProviderId, apiChannel: "direct" | "openrouter", model: string | null | undefined, prompt: string, error: string) {
  const budgetExhausted = /esaurito il budget di risposta|finish_reason.*length/i.test(error);
  if (provider === "openai" && apiChannel === "openrouter" && budgetExhausted && model !== "openai/gpt-4.1-mini") return "openai/gpt-4.1-mini";
  return undefined;
}

export function seniorPromptFromDossier(originalPrompt: string, dossier: string) {
  return `DOMANDA PRINCIPALE - è a questa domanda che devi rispondere direttamente:\n${originalPrompt}\n\n--- Materiale istruttorio: dossier preliminare del pool junior ---\n${dossier}\n--- Fine materiale istruttorio ---\n\nISTRUZIONE PRIORITARIA: formula un tuo parere senior autonomo e completo in risposta alla DOMANDA PRINCIPALE. Usa il dossier junior soltanto come base informativa: sfrutta ciò che è utile, correggi silenziosamente errori e colma omissioni. Non trasformare la risposta in una recensione del lavoro junior. Dedica almeno l'80% del testo alla tua analisi, conclusione e proposte sulla domanda originaria; limita al massimo al 20% eventuali osservazioni esplicite sul dossier. Il lettore deve poter comprendere il tuo parere anche senza aver letto il dossier junior.`;
}

export async function attachmentDownloadForUser(
  userId: number,
  attachmentId: number,
  readAttachments: typeof getAttachmentsByIdsForUser = getAttachmentsByIdsForUser,
  signedUrl: typeof storageGetSignedUrl = storageGetSignedUrl,
) {
  const attachments = await readAttachments(userId, [attachmentId]);
  if (!attachments[0]) throw new Error("Allegato non disponibile per il tuo account.");
  return { url: await signedUrl(attachments[0].storageKey), fileName: attachments[0].fileName };
}

export async function persistRoleOverrides(userId: number, roles: Record<ProviderId, string>, persist: typeof saveAgentRole = saveAgentRole) {
  await Promise.all(PROVIDER_IDS.map(provider => persist({ userId, provider, role: roles[provider] })));
}

function modelsByProvider(savedModels: Array<{ provider: string; model: string }>) {
  return new Map(savedModels.map(item => [item.provider, item.model]));
}

async function validatedModelsByProvider(savedModels: Array<{ provider: string; model: string }>, credentials: Awaited<ReturnType<typeof getCredentialsForUser>>) {
  const modelMap = modelsByProvider(savedModels);
  if (!sharedOpenRouterCredential(credentials)) return modelMap;
  try {
    const catalog = await getOpenRouterCatalog();
    for (const provider of PROVIDER_IDS.filter(isOpenRouterCompatible)) {
      const prefix = provider === "openai" ? "openai/" : provider === "anthropic" ? "anthropic/" : provider === "gemini" ? "google/" : provider === "kimi" ? "moonshotai/" : "perplexity/";
      const saved = modelMap.get(provider);
      if (!saved || !catalog.some(model => model.id === saved && model.id.startsWith(prefix))) modelMap.set(provider, compactCatalogFor(provider, catalog).recommended.id);
    }
  } catch {
    // Se il catalogo è temporaneamente indisponibile, la configurazione salvata rimane utilizzabile.
  }
  return modelMap;
}

function sharedOpenRouterCredential(credentials: Awaited<ReturnType<typeof getCredentialsForUser>>) {
  return credentials.find(credential => credential.apiChannel === "openrouter" && credential.provider !== "manus");
}

type OpenRouterCreditInfo = {
  connectionStatus: "valid" | "invalid" | "unavailable";
  keyLimitRemaining: number | null;
  keyLimit: number | null;
  usage: number | null;
  usageDaily: number | null;
  usageMonthly: number | null;
  accountRemaining: number | null;
};

export function isOpenRouterCredentialRejected(status: number, payload: string) {
  return status === 401 || /user not found|invalid api key|unauthorized/i.test(payload);
}

async function openRouterCreditInfo(apiKey: string): Promise<OpenRouterCreditInfo | null> {
  try {
    const keyResponse = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(8_000) });
    const keyRaw = await keyResponse.text();
    if (!keyResponse.ok) return { connectionStatus: isOpenRouterCredentialRejected(keyResponse.status, keyRaw) ? "invalid" : "unavailable", keyLimitRemaining: null, keyLimit: null, usage: null, usageDaily: null, usageMonthly: null, accountRemaining: null };
    const keyPayload = JSON.parse(keyRaw) as { data?: { limit_remaining?: number | null; limit?: number | null; usage?: number; usage_daily?: number; usage_monthly?: number } };
    const key = keyPayload.data;
    const numberOrNull = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
    let accountRemaining: number | null = null;
    try {
      const creditsResponse = await fetch("https://openrouter.ai/api/v1/credits", { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(8_000) });
      if (creditsResponse.ok) {
        const creditsPayload = await creditsResponse.json() as { data?: { total_credits?: number; total_usage?: number } };
        const totalCredits = numberOrNull(creditsPayload.data?.total_credits);
        const totalUsage = numberOrNull(creditsPayload.data?.total_usage);
        if (totalCredits !== null && totalUsage !== null) accountRemaining = Math.max(0, totalCredits - totalUsage);
      }
    } catch {
      // Una chiave ordinaria può non avere permesso sul saldo account; il limite della chiave resta disponibile.
    }
    return { connectionStatus: "valid", keyLimitRemaining: numberOrNull(key?.limit_remaining), keyLimit: numberOrNull(key?.limit), usage: numberOrNull(key?.usage), usageDaily: numberOrNull(key?.usage_daily), usageMonthly: numberOrNull(key?.usage_monthly), accountRemaining };
  } catch {
    return null;
  }
}

async function requireValidOpenRouterCredential(apiKey: string) {
  const info = await openRouterCreditInfo(apiKey);
  if (info?.connectionStatus === "invalid") throw new TRPCError({ code: "BAD_REQUEST", message: "La chiave OpenRouter condivisa non viene riconosciuta dall’account (“User not found”). Genera o copia di nuovo una chiave API attiva da OpenRouter e sostituiscila nelle Impostazioni." });
  if (!info || info.connectionStatus !== "valid") throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Non riesco a verificare OpenRouter in questo momento. Riprova tra qualche istante prima di avviare il pool junior." });
  return info;
}

function resolveAgentConfig(provider: ProviderId, credentials: Awaited<ReturnType<typeof getCredentialsForUser>>, modelMap: Map<string, string>) {
  const shared = sharedOpenRouterCredential(credentials);
  if (isOpenRouterCompatible(provider) && shared) {
    return { credential: shared, apiChannel: "openrouter" as const, model: modelMap.get(provider) ?? OPENROUTER_MODEL_FALLBACKS[provider].recommended };
  }
  const credential = credentials.find(item => item.provider === provider);
  if (!credential) return undefined;
  return { credential, apiChannel: credential.apiChannel === "openrouter" ? "openrouter" as const : "direct" as const, model: modelMap.get(provider) ?? credential.model };
}

export function suggestedRoles(prompt: string) {
  const lower = prompt.toLowerCase();
  const type = /\b(comprensione|coscienza|filosofi\w*|etica|significato|contesto umano|natura umana|concettuale)\b/.test(lower) ? "riflessione concettuale" : /\b(codice|software|applicazione|api|bug|tecnica|tecnico|database|sviluppatore|deploy|integrazione)\b/.test(lower) ? "progetto tecnico" : /\b(marketing|vendite?|lancio|brand|clienti?|campagna)\b/.test(lower) ? "strategia di mercato" : /\b(ricerca|studio|fonti?|dati|analisi)\b/.test(lower) ? "ricerca e analisi" : /\b(creativ\w*|design|contenut\w*|story|nomin\w*)\b/.test(lower) ? "progetto creativo" : "strategia generale";
  const roles: Record<ProviderId, string> = type === "progetto tecnico"
    ? { openai: "Architetto di prodotto", anthropic: "Revisore tecnico critico", gemini: "Ideatore di soluzioni", kimi: "Ricercatore tecnico", manus: "Pianificatore di implementazione", perplexity: "Verificatore di fattibilità" }
    : type === "riflessione concettuale"
      ? { openai: "Analista concettuale", anthropic: "Critico filosofico", gemini: "Generatore di prospettive", kimi: "Ricercatore interdisciplinare", manus: "Mappatore delle implicazioni", perplexity: "Verificatore argomentativo" }
      : type === "strategia di mercato"
      ? { openai: "Stratega di posizionamento", anthropic: "Critico di rischio commerciale", gemini: "Ideatore di campagne", kimi: "Ricercatore di mercato", manus: "Pianificatore operativo", perplexity: "Verificatore di evidenze" }
      : type === "ricerca e analisi"
        ? { openai: "Analista della tesi", anthropic: "Revisore metodologico", gemini: "Generatore di ipotesi", kimi: "Ricercatore documentale", manus: "Pianificatore della ricerca", perplexity: "Verificatore di fonti" }
        : type === "progetto creativo"
          ? { openai: "Direttore creativo", anthropic: "Critico editoriale", gemini: "Ideatore di concept", kimi: "Ricercatore di riferimenti", manus: "Produttore operativo", perplexity: "Verificatore di coerenza" }
          : { openai: "Analista strategico", anthropic: "Critico costruttivo", gemini: "Ideatore", kimi: "Ricercatore", manus: "Pianificatore operativo", perplexity: "Verificatore" };
  return { type, roles };
}

export function applyRankingSignal(base: ReturnType<typeof suggestedRoles>, statistics: Array<{ provider: string; sampleSize: number; overallScore: number }>) {
  const leader = statistics.filter(item => item.sampleSize >= 10 && item.overallScore >= 7.5 && PROVIDER_IDS.includes(item.provider as ProviderId)).sort((a, b) => b.overallScore - a.overallScore)[0];
  if (!leader) return { ...base, rankingSignal: null as null | { provider: ProviderId; score: number; sampleSize: number } };
  const provider = leader.provider as ProviderId;
  return {
    ...base,
    roles: { ...base.roles, [provider]: `${base.roles[provider]} · guida per esperienza tra pari` },
    rankingSignal: { provider, score: leader.overallScore, sampleSize: leader.sampleSize },
  };
}

function shortTitle(prompt: string) {
  const compact = prompt.trim().replace(/\s+/g, " ");
  return compact.length > 90 ? `${compact.slice(0, 87)}…` : compact;
}

function excerpt(value: string, maxCharacters = 1_000) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= maxCharacters ? compact : `${compact.slice(0, maxCharacters - 1)}…`;
}

function costFor(usage: ProviderUsage, credential?: { inputCostPerMillion: number | null; outputCostPerMillion: number | null; apiChannel?: string }, model?: string | null) {
  const catalogModel = credential?.apiChannel === "openrouter" && model ? catalogCache?.models.find(item => item.id === model) : undefined;
  const inputCostPerMillion = catalogModel ? Number(catalogModel.pricing?.prompt ?? NaN) * 1_000_000 : credential?.inputCostPerMillion;
  const outputCostPerMillion = catalogModel ? Number(catalogModel.pricing?.completion ?? NaN) * 1_000_000 : credential?.outputCostPerMillion;
  return calculateCostUsd(usage, inputCostPerMillion, outputCostPerMillion);
}

function buildEstimate(prompt: string, requestedProviders: ProviderId[], credentials: Awaited<ReturnType<typeof getCredentialsForUser>>, modelMap: Map<string, string>) {
  const basePromptTokens = estimateTextTokens(prompt) + 90;
  const activeProviders = requestedProviders.filter(provider => Boolean(resolveAgentConfig(provider, credentials, modelMap)));
  const reviewInputTokens = basePromptTokens + Math.max(0, activeProviders.length - 1) * Math.ceil(reviewExcerptCharacters(prompt) / 4) + 200;
  const agentEstimates = activeProviders.map(provider => {
    const config = resolveAgentConfig(provider, credentials, modelMap);
    const initial: ProviderUsage = { inputTokens: basePromptTokens, outputTokens: adaptiveOutputBudget(provider, "initial", prompt), totalTokens: basePromptTokens + adaptiveOutputBudget(provider, "initial", prompt), source: "estimated" };
    const review: ProviderUsage = { inputTokens: reviewInputTokens, outputTokens: adaptiveOutputBudget(provider, "review", prompt), totalTokens: reviewInputTokens + adaptiveOutputBudget(provider, "review", prompt), source: "estimated" };
    const total: ProviderUsage = { inputTokens: initial.inputTokens + review.inputTokens, outputTokens: initial.outputTokens + review.outputTokens, totalTokens: initial.totalTokens + review.totalTokens, source: "estimated" };
    return { provider, initial, review, total, estimatedCostUsd: costFor(total, config?.credential, config?.model) };
  });
  const synthesisProvider = chooseSynthesisProvider(activeProviders);
  const synthesisBudget = synthesisProvider ? adaptiveOutputBudget(synthesisProvider, "synthesis", prompt) : 0;
  const synthesisInputTokens = basePromptTokens + activeProviders.length * Math.ceil(reviewExcerptCharacters(prompt) / 4) + 250;
  const synthesisUsage: ProviderUsage = { inputTokens: synthesisInputTokens, outputTokens: synthesisBudget, totalTokens: synthesisInputTokens + synthesisBudget, source: "estimated" };
  const synthesisConfig = synthesisProvider ? resolveAgentConfig(synthesisProvider, credentials, modelMap) : undefined;
  const synthesisCost = synthesisConfig ? costFor(synthesisUsage, synthesisConfig.credential, synthesisConfig.model) : null;
  const tokenTotal = agentEstimates.reduce((sum, item) => sum + item.total.totalTokens, synthesisUsage.totalTokens);
  const costs = sumKnownCosts([...agentEstimates.map(item => item.estimatedCostUsd), synthesisCost]);
  const openRouterCosts = agentEstimates.filter(item => resolveAgentConfig(item.provider, credentials, modelMap)?.apiChannel === "openrouter").map(item => item.estimatedCostUsd);
  if (synthesisConfig?.apiChannel === "openrouter") openRouterCosts.push(synthesisCost);
  const openRouterEstimate = sumKnownCosts(openRouterCosts);
  return { agentEstimates, synthesisProvider, synthesisUsage, estimatedTokens: tokenTotal, estimatedCostUsd: costs.amount, costComplete: costs.complete, openRouterEstimatedCostUsd: openRouterEstimate.amount, openRouterCostComplete: openRouterEstimate.complete, composition: { promptTokens: basePromptTokens, reviewExcerptCharacters: reviewExcerptCharacters(prompt), agentCount: activeProviders.length } };
}

function costSummary(runs: Array<{ initialInputTokens: number | null; initialOutputTokens: number | null; initialCostUsd: number | null; initialProviderCharge: number | null; initialProviderChargeUnit: string | null; reviewInputTokens: number | null; reviewOutputTokens: number | null; reviewCostUsd: number | null; reviewProviderCharge: number | null; reviewProviderChargeUnit: string | null }>, synthesisUsage: ProviderUsage, synthesisCost: number | null, synthesisCharge?: { amount: number; unit: string }) {
  const actualTokens = runs.reduce((sum, run) => sum + (run.initialInputTokens ?? 0) + (run.initialOutputTokens ?? 0) + (run.reviewInputTokens ?? 0) + (run.reviewOutputTokens ?? 0), synthesisUsage.totalTokens);
  const cost = sumKnownCosts([...runs.flatMap(run => [run.initialCostUsd, run.reviewCostUsd]), synthesisCost]);
  const charges = runs.flatMap(run => [{ amount: run.initialProviderCharge, unit: run.initialProviderChargeUnit }, { amount: run.reviewProviderCharge, unit: run.reviewProviderChargeUnit }]);
  if (synthesisCharge) charges.push(synthesisCharge);
  const openrouterCredits = charges.filter(charge => charge.unit === "openrouter_credits").reduce((sum, charge) => sum + (charge.amount ?? 0), 0);
  const manusCredits = charges.filter(charge => charge.unit === "manus_credits").reduce((sum, charge) => sum + (charge.amount ?? 0), 0);
  return { actualTokens, actualCostUsd: cost.amount, costComplete: cost.complete, openrouterCredits, manusCredits };
}

export function enforceHardBudget(hardBudgetUsd: number | null, estimate: { estimatedCostUsd: number | null; costComplete: boolean }) {
  if (hardBudgetUsd === null) return;
  if (!estimate.costComplete || estimate.estimatedCostUsd === null) throw new TRPCError({ code: "BAD_REQUEST", message: `Soglia hard attiva (${hardBudgetUsd.toFixed(4)} USD): il preventivo non è completo, quindi l’avvio è bloccato finché non configuri tutte le tariffe o disattivi la soglia.` });
  if (estimate.estimatedCostUsd > hardBudgetUsd) throw new TRPCError({ code: "BAD_REQUEST", message: `Soglia hard superata: preventivo ${estimate.estimatedCostUsd.toFixed(4)} USD, limite ${hardBudgetUsd.toFixed(4)} USD. Riduci agenti o scegli la modalità Economico.` });
}

export const agoraRouter = router({
  openRouterCredit: protectedProcedure.query(async ({ ctx }) => {
    const credentials = await getCredentialsForUser(ctx.user.id);
    const shared = sharedOpenRouterCredential(credentials);
    if (!shared) return null;
    return openRouterCreditInfo(decryptSecret(shared.secretCiphertext));
  }),

  hardBudget: protectedProcedure.query(async ({ ctx }) => ({ hardBudgetUsd: await getHardBudgetForUser(ctx.user.id) })),

  settings: protectedProcedure.query(async ({ ctx }) => {
    const [credentials, roles, models] = await Promise.all([getCredentialsForUser(ctx.user.id), getRolesForUser(ctx.user.id), getAgentModelsForUser(ctx.user.id)]);
    const credentialByProvider = new Map(credentials.map(item => [item.provider, item]));
    const roleMap = rolesByProvider(roles);
    const modelMap = await validatedModelsByProvider(models, credentials);
    const shared = sharedOpenRouterCredential(credentials);
    return PROVIDER_IDS.map(provider => ({
      provider, ...PROVIDERS[provider], role: roleMap[provider], configured: provider === "manus" ? Boolean(credentialByProvider.get(provider)) : Boolean(shared || credentialByProvider.get(provider)),
      model: modelMap.get(provider) ?? (isOpenRouterCompatible(provider) && shared ? OPENROUTER_MODEL_FALLBACKS[provider].recommended : credentialByProvider.get(provider)?.model ?? PROVIDERS[provider].defaultModel),
      apiChannel: (isOpenRouterCompatible(provider) && shared ? "openrouter" : credentialByProvider.get(provider)?.apiChannel === "openrouter" ? "openrouter" : "direct") as "direct" | "openrouter",
      inputCostPerMillion: isOpenRouterCompatible(provider) && shared ? null : credentialByProvider.get(provider)?.inputCostPerMillion ?? null,
      outputCostPerMillion: isOpenRouterCompatible(provider) && shared ? null : credentialByProvider.get(provider)?.outputCostPerMillion ?? null,
      sharedOpenRouter: Boolean(shared) && isOpenRouterCompatible(provider),
      modelOptions: isOpenRouterCompatible(provider) ? OPENROUTER_MODEL_FALLBACKS[provider] : null,
    }));
  }),

  openRouterRecommendations: protectedProcedure.query(async () => {
    const catalog = await getOpenRouterCatalog();
    return {
      openai: compactCatalogFor("openai", catalog),
      anthropic: compactCatalogFor("anthropic", catalog),
      gemini: compactCatalogFor("gemini", catalog),
      kimi: compactCatalogFor("kimi", catalog),
      perplexity: compactCatalogFor("perplexity", catalog),
      fetchedAt: new Date().toISOString(),
    };
  }),

  peerStatistics: protectedProcedure.query(async ({ ctx }) => getPeerStatisticsForUser(ctx.user.id)),

  saveSharedOpenRouter: protectedProcedure.input(z.object({ apiKey: z.string().trim().min(4).max(512) })).mutation(async ({ ctx, input }) => {
    if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Solo il titolare può modificare le chiavi dello Studio." });
    await requireValidOpenRouterCredential(input.apiKey);
    await saveCredential({ userId: ctx.user.id, provider: "anthropic", secretCiphertext: encryptSecret(input.apiKey), model: null, apiChannel: "openrouter", inputCostPerMillion: null, outputCostPerMillion: null });
    return { configured: true };
  }),

  saveHardBudget: protectedProcedure.input(z.object({ hardBudgetUsd: z.number().min(0.0001).max(1000).nullable() })).mutation(async ({ ctx, input }) => ({ hardBudgetUsd: await saveHardBudgetForUser(ctx.user.id, input.hardBudgetUsd) })),

  saveCredential: protectedProcedure.input(z.object({ provider: providerSchema, apiKey: z.string().trim().min(4).max(512), model: z.string().trim().max(128).nullable().optional(), apiChannel: channelSchema.optional(), inputCostPerMillion: priceSchema, outputCostPerMillion: priceSchema })).mutation(async ({ ctx, input }) => {
    if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Solo il titolare può modificare le chiavi dello Studio." });
    await saveCredential({ userId: ctx.user.id, provider: input.provider, secretCiphertext: encryptSecret(input.apiKey), model: input.model || null, apiChannel: input.apiChannel ?? "direct", inputCostPerMillion: input.inputCostPerMillion ?? null, outputCostPerMillion: input.outputCostPerMillion ?? null });
    return { provider: input.provider, configured: true };
  }),

  removeCredential: protectedProcedure.input(z.object({ provider: providerSchema })).mutation(async ({ ctx, input }) => {
    if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Solo il titolare può modificare le chiavi dello Studio." });
    await removeCredential(ctx.user.id, input.provider);
    return { provider: input.provider, configured: false };
  }),

  saveRole: protectedProcedure.input(z.object({ provider: providerSchema, role: roleSchema })).mutation(async ({ ctx, input }) => {
    await saveAgentRole({ userId: ctx.user.id, ...input });
    return input;
  }),

  saveAgentModel: protectedProcedure.input(z.object({ provider: providerSchema, model: modelSchema })).mutation(async ({ ctx, input }) => {
    await saveAgentModel({ userId: ctx.user.id, ...input });
    return input;
  }),

  suggestRoles: protectedProcedure.input(z.object({ prompt: z.string().trim().min(12).max(12000) })).mutation(async ({ ctx, input }) => applyRankingSignal(suggestedRoles(input.prompt), await getPeerStatisticsForUser(ctx.user.id))),

  applySuggestedRoles: protectedProcedure.input(z.object({ roles: z.record(providerSchema, roleSchema) })).mutation(async ({ ctx, input }) => {
    await Promise.all(PROVIDER_IDS.map(provider => saveAgentRole({ userId: ctx.user.id, provider, role: input.roles[provider] })));
    return input.roles;
  }),

  testCredential: protectedProcedure.input(z.object({ provider: providerSchema, apiKey: z.string().trim().min(4).max(512), model: z.string().trim().max(128).nullable().optional(), apiChannel: channelSchema.optional() })).mutation(async ({ ctx, input }) => {
    if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Solo il titolare può verificare nuove chiavi dello Studio." });
    const result = await runProvider({ provider: input.provider, apiKey: input.apiKey, model: input.model, apiChannel: input.apiChannel, role: "verifica connessione", prompt: "Rispondi esclusivamente con OK.", maxOutputTokens: 128 });
    return { success: true, preview: result.text.slice(0, 120), usage: result.usage };
  }),

  testConfiguredAgent: protectedProcedure.input(z.object({ provider: providerSchema })).mutation(async ({ ctx, input }) => {
    const [credentials, models] = await Promise.all([getCredentialsForUser(ctx.user.id), getAgentModelsForUser(ctx.user.id)]);
    const config = resolveAgentConfig(input.provider, credentials, await validatedModelsByProvider(models, credentials));
    if (!config) throw new TRPCError({ code: "BAD_REQUEST", message: `Configura prima ${PROVIDERS[input.provider].label}.` });
    if (config.apiChannel === "openrouter") await requireValidOpenRouterCredential(decryptSecret(config.credential.secretCiphertext));
    const result = await runProvider({ provider: input.provider, apiKey: decryptSecret(config.credential.secretCiphertext), model: config.model, apiChannel: config.apiChannel, role: "verifica connessione", prompt: "Rispondi esclusivamente con OK.", maxOutputTokens: 128 });
    return { success: true, model: config.model, preview: result.text.slice(0, 120), usage: result.usage };
  }),

  estimate: protectedProcedure.input(z.object({ prompt: z.string().trim().min(12).max(12000), providers: z.array(providerSchema).min(1).max(6), attachmentIds: attachmentIdsSchema })).mutation(async ({ ctx, input }) => {
    const [credentials, models] = await Promise.all([getCredentialsForUser(ctx.user.id), getAgentModelsForUser(ctx.user.id)]);
    const attachments = await getAttachmentsByIdsForUser(ctx.user.id, input.attachmentIds);
    return buildEstimate(`${input.prompt}${documentContext(attachments)}`, Array.from(new Set(input.providers)), credentials, await validatedModelsByProvider(models, credentials));
  }),

  estimateJunior: protectedProcedure.input(z.object({ prompt: z.string().trim().min(12).max(12000), attachmentIds: attachmentIdsSchema })).mutation(async ({ ctx, input }) => {
    const credentials = await getCredentialsForUser(ctx.user.id);
    if (!sharedOpenRouterCredential(credentials)) throw new TRPCError({ code: "BAD_REQUEST", message: "Configura prima la chiave OpenRouter condivisa per stimare la modalità economica." });
    const attachments = await getAttachmentsByIdsForUser(ctx.user.id, input.attachmentIds);
    return juniorEstimateForPrompt(`${input.prompt}${documentContext(attachments)}`, await getOpenRouterCatalog());
  }),

  listAttachments: protectedProcedure.query(async ({ ctx }) => {
    const attachments = await listSessionAttachmentsForUser(ctx.user.id);
    return attachments.map(({ storageKey: _storageKey, storageUrl: _storageUrl, textExcerpt, ...attachment }) => ({ ...attachment, excerptCharacters: textExcerpt.length }));
  }),

  uploadAttachment: protectedProcedure.input(uploadAttachmentSchema.extend({
    source: z.enum(["external", "nextcloud"]),
    anonymizationStatus: z.enum(["anonymized", "not_anonymized"]),
    confirmAiDisclosure: z.literal(true),
    sourceReference: z.string().trim().max(640).nullable().optional(),
  })).mutation(async ({ ctx, input }) => {
    const raw = Buffer.from(input.base64, "base64");
    const document = validateDocument({ fileName: input.fileName, mimeType: input.mimeType, buffer: raw });
    const textExcerpt = await extractDocumentText(document);
    const objectId = crypto.randomUUID();
    const stored = await storagePut(`users/${ctx.user.id}/attachments/${objectId}/${document.fileName}`, document.buffer, document.mimeType);
    const attachment = await createSessionAttachment({ userId: ctx.user.id, fileName: document.fileName, mimeType: document.mimeType, sizeBytes: document.buffer.length, storageKey: stored.key, storageUrl: stored.url, textExcerpt, source: input.source, anonymizationStatus: input.anonymizationStatus, aiDisclosureConfirmedAt: new Date(), sourceReference: input.sourceReference ?? null });
    const { storageKey: _storageKey, storageUrl: _storageUrl, ...safeAttachment } = attachment;
    return { ...safeAttachment, excerptCharacters: textExcerpt.length };
  }),

  attachmentDownload: protectedProcedure.input(z.object({ attachmentId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    return attachmentDownloadForUser(ctx.user.id, input.attachmentId);
  }),

  createJuniorSession: protectedProcedure.input(z.object({ prompt: z.string().trim().min(12).max(12000), attachmentIds: attachmentIdsSchema })).mutation(async ({ ctx, input }) => {
    const credentials = await getCredentialsForUser(ctx.user.id);
    const shared = sharedOpenRouterCredential(credentials);
    if (!shared) throw new TRPCError({ code: "BAD_REQUEST", message: "Configura prima la chiave OpenRouter condivisa per avviare il pool economico." });
    await requireValidOpenRouterCredential(decryptSecret(shared.secretCiphertext));
    const attachments = await getAttachmentsByIdsForUser(ctx.user.id, input.attachmentIds);
    const context = documentContext(attachments);
    const catalog = await getOpenRouterCatalog();
    const coordinated = await coordinateJuniorTeam(`${input.prompt}${context}`, decryptSecret(shared.secretCiphertext));
    const baseEstimate = juniorEstimateForPrompt(`${input.prompt}${context}`, catalog);
    const pool = juniorPoolForPrompt(`${input.prompt}${context}`, catalog, coordinated.coordination).map(agent => ({ ...agent, costUsd: baseEstimate.pool.find(item => item.provider === agent.provider)?.costUsd ?? null }));
    const estimate = { ...baseEstimate, pool };
    enforceHardBudget(await getHardBudgetForUser(ctx.user.id), estimate);
    const session = await createDeliberationSession({ userId: ctx.user.id, title: `Economico · ${shortTitle(input.prompt)}`, prompt: input.prompt, mode: "economic", estimatedTokens: estimate.estimatedTokens, estimatedCostUsd: estimate.estimatedCostUsd, costComplete: estimate.costComplete });
    await attachDocumentsToSession(ctx.user.id, session.id, input.attachmentIds);
    await createAgentRuns({ sessionId: session.id, userId: ctx.user.id, runs: estimate.pool.map(agent => ({ provider: agent.provider, role: agent.role, tier: "junior", resolvedModel: agent.model, fallbackModel: agent.fallbackModel })) });
    return { ...session, mode: "economic" as const, coordination: coordinated.coordination ? { ...coordinated.coordination, coordinatorModel: coordinated.coordinatorModel } : { domain: estimate.theme, complexity: "media" as const, teamReason: "Il coordinatore non ha restituito un piano valido: è stata applicata la squadra complementare di sicurezza.", assignments: [], coordinatorModel: coordinated.coordinatorModel }, pool: estimate.pool.map(({ provider, label, role, model, fallbackModel, costUsd }) => ({ provider, label, role, model, fallbackModel, costUsd })) };
  }),

  escalateToSenior: protectedProcedure.input(z.object({ juniorSessionId: z.string().min(6).max(32), providers: z.array(providerSchema).min(1).max(6), roles: z.record(providerSchema, roleSchema).optional() })).mutation(async ({ ctx, input }) => {
    const junior = await getSessionWithRuns(ctx.user.id, input.juniorSessionId);
    if (!junior || junior.session.mode !== "economic") throw new TRPCError({ code: "NOT_FOUND", message: "Dossier junior non trovato." });
    const dossier = junior.session.juniorDossier ?? junior.session.finalSynthesis;
    if (!dossier) throw new TRPCError({ code: "BAD_REQUEST", message: "Completa prima il dossier junior per coinvolgere i senior." });
    const [credentials, savedRoles, models] = await Promise.all([getCredentialsForUser(ctx.user.id), getRolesForUser(ctx.user.id), getAgentModelsForUser(ctx.user.id)]);
    const modelMap = await validatedModelsByProvider(models, credentials);
    const requested = Array.from(new Set(input.providers)).filter(provider => Boolean(resolveAgentConfig(provider, credentials, modelMap)));
    if (!requested.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Nessun senior selezionato ha una configurazione disponibile." });
    const roles = rolesForSession(savedRoles, input.roles);
    if (input.roles) await persistRoleOverrides(ctx.user.id, roles);
    const seniorPrompt = seniorPromptFromDossier(junior.session.prompt, dossier);
    const estimate = buildEstimate(seniorPrompt, requested, credentials, modelMap);
    enforceHardBudget(await getHardBudgetForUser(ctx.user.id), estimate);
    const session = await createDeliberationSession({ userId: ctx.user.id, title: `Senior · ${shortTitle(junior.session.prompt)}`, prompt: seniorPrompt, mode: "deep", parentSessionId: junior.session.id, juniorDossier: dossier, estimatedTokens: estimate.estimatedTokens, estimatedCostUsd: estimate.estimatedCostUsd, costComplete: estimate.costComplete });
    await createAgentRuns({ sessionId: session.id, userId: ctx.user.id, runs: requested.map(provider => ({ provider, role: roles[provider], tier: "senior", resolvedModel: modelMap.get(provider) ?? null })) });
    return { ...session, providers: requested, parentSessionId: junior.session.id };
  }),

  createSession: protectedProcedure.input(z.object({ prompt: z.string().trim().min(12).max(12000), providers: z.array(providerSchema).min(1).max(6), roles: z.record(providerSchema, roleSchema).optional(), attachmentIds: attachmentIdsSchema })).mutation(async ({ ctx, input }) => {
    const [roles, credentials, models] = await Promise.all([getRolesForUser(ctx.user.id), getCredentialsForUser(ctx.user.id), getAgentModelsForUser(ctx.user.id)]);
    if (input.roles) await persistRoleOverrides(ctx.user.id, input.roles);
    const requestedProviders = Array.from(new Set(input.providers));
    const modelMap = await validatedModelsByProvider(models, credentials);
    const configuredProviders = requestedProviders.filter(provider => Boolean(resolveAgentConfig(provider, credentials, modelMap)));
    if (!configuredProviders.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Seleziona almeno un agente con una chiave API configurata." });
    const attachments = await getAttachmentsByIdsForUser(ctx.user.id, input.attachmentIds);
    const context = documentContext(attachments);
    const estimate = buildEstimate(`${input.prompt}${context}`, configuredProviders, credentials, modelMap);
    enforceHardBudget(await getHardBudgetForUser(ctx.user.id), estimate);
    const shared = sharedOpenRouterCredential(credentials);
    if (shared) await requireValidOpenRouterCredential(decryptSecret(shared.secretCiphertext));
    if (shared && estimate.openRouterEstimatedCostUsd !== null && estimate.openRouterCostComplete) {
      const credit = await openRouterCreditInfo(decryptSecret(shared.secretCiphertext));
      const remaining = credit?.keyLimitRemaining ?? credit?.accountRemaining ?? null;
      if (remaining !== null && remaining < estimate.openRouterEstimatedCostUsd) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Credito OpenRouter insufficiente: la stima per i modelli selezionati è ${estimate.openRouterEstimatedCostUsd.toFixed(4)} crediti, mentre il limite residuo della chiave è ${remaining.toFixed(4)}. Ricarica il saldo, alza il limite della chiave o scegli modelli con budget più basso.` });
      }
    }
    const session = await createDeliberationSession({ userId: ctx.user.id, title: shortTitle(input.prompt), prompt: input.prompt, estimatedTokens: estimate.estimatedTokens, estimatedCostUsd: estimate.estimatedCostUsd, costComplete: estimate.costComplete });
    await attachDocumentsToSession(ctx.user.id, session.id, input.attachmentIds);
    const roleMap = rolesForSession(roles, input.roles);
    await createAgentRuns({ sessionId: session.id, userId: ctx.user.id, runs: configuredProviders.map(provider => ({ provider, role: roleMap[provider] })) });
    return { ...session, estimate };
  }),

  listSessions: protectedProcedure.query(({ ctx }) => listSessionsForUser(ctx.user.id)),

  getSession: protectedProcedure.input(z.object({ sessionId: z.string().min(6).max(32) })).query(async ({ ctx, input }) => {
    const result = await getSessionWithRuns(ctx.user.id, input.sessionId);
    if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Sessione non trovata." });
    return result;
  }),

  runAgent: protectedProcedure.input(z.object({ sessionId: z.string().min(6).max(32), provider: runnableProviderSchema })).mutation(async ({ ctx, input }) => {
    const current = await getSessionWithRuns(ctx.user.id, input.sessionId);
    if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Sessione non trovata." });
    const run = current.runs.find(item => item.provider === input.provider);
    if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Agente non trovato nella sessione." });
    const [credentials, models] = await Promise.all([getCredentialsForUser(ctx.user.id), getAgentModelsForUser(ctx.user.id)]);
    const shared = sharedOpenRouterCredential(credentials);
    const isJunior = isJuniorProvider(input.provider);
    const config = isJunior ? (shared && run.resolvedModel ? { credential: shared, apiChannel: "openrouter" as const, model: run.resolvedModel, executionProvider: "openai" as ProviderId } : undefined) : (() => { const resolved = resolveAgentConfig(input.provider as ProviderId, credentials, modelsByProvider(models)); return resolved ? { ...resolved, executionProvider: input.provider as ProviderId } : undefined; })();
    if (!config) {
      await updateAgentRun(run.id, { status: "skipped", error: "Configura la chiave API di questo agente nelle impostazioni.", completedAt: new Date() });
      return { provider: input.provider, status: "skipped" as const };
    }
    await updateAgentRun(run.id, { status: "running", error: null, startedAt: new Date() });
    try {
      const result = await runProvider({ provider: config.executionProvider, apiKey: decryptSecret(config.credential.secretCiphertext), model: config.model, apiChannel: config.apiChannel, role: run.role, prompt: current.session.prompt, maxOutputTokens: isJunior ? 180 : adaptiveOutputBudget(config.executionProvider, "initial", current.session.prompt) });
      const cost = costFor(result.usage, config.credential, config.model);
      await updateAgentRun(run.id, { status: "completed", response: result.text, error: null, initialInputTokens: result.usage.inputTokens, initialOutputTokens: result.usage.outputTokens, initialUsageSource: result.usage.source, initialCostUsd: cost, initialProviderCharge: result.providerCharge?.amount ?? null, initialProviderChargeUnit: result.providerCharge?.unit ?? null, completedAt: new Date() });
      return { provider: input.provider, status: "completed" as const, usage: result.usage, costUsd: cost };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Errore non identificato durante la risposta dell’agente.";
      const fallbackModel = isJunior ? juniorFallbackCandidate(config.model ?? "", run.fallbackModel) : documentOutputFallback(config.executionProvider, config.apiChannel, config.model, current.session.prompt, message);
      if (fallbackModel) {
        try {
          const fallback = await runProvider({ provider: isJunior ? "openai" : config.executionProvider, apiKey: decryptSecret(config.credential.secretCiphertext), model: fallbackModel, apiChannel: isJunior ? "openrouter" : config.apiChannel, role: run.role, prompt: current.session.prompt, maxOutputTokens: isJunior ? 180 : adaptiveOutputBudget(config.executionProvider, "initial", current.session.prompt) });
          const fallbackCost = costFor(fallback.usage, config.credential, fallbackModel);
          const fallbackReason = isJunior ? `Fallback automatico: ${config.model} non disponibile; usato ${fallbackModel}.` : `Fallback automatico: ${config.model} ha esaurito il budget senza testo; usato ${fallbackModel}.`;
          await updateAgentRun(run.id, { status: "completed", resolvedModel: fallbackModel, response: fallback.text, error: fallbackReason, initialInputTokens: fallback.usage.inputTokens, initialOutputTokens: fallback.usage.outputTokens, initialUsageSource: fallback.usage.source, initialCostUsd: fallbackCost, initialProviderCharge: fallback.providerCharge?.amount ?? null, initialProviderChargeUnit: fallback.providerCharge?.unit ?? null, completedAt: new Date() });
          return { provider: input.provider, status: "completed" as const, usage: fallback.usage, costUsd: fallbackCost, fallbackUsed: true };
        } catch (fallbackError) {
          const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : "Fallback junior non riuscito.";
          await updateAgentRun(run.id, { status: "failed", error: `${message.slice(0, 380)} · Fallback: ${fallbackMessage.slice(0, 380)}`, completedAt: new Date() });
          return { provider: input.provider, status: "failed" as const };
        }
      }
      await updateAgentRun(run.id, { status: "failed", error: message.slice(0, 800), completedAt: new Date() });
      return { provider: input.provider, status: "failed" as const };
    }
  }),

  reviewAgent: protectedProcedure.input(z.object({ sessionId: z.string().min(6).max(32), provider: runnableProviderSchema })).mutation(async ({ ctx, input }) => {
    const current = await getSessionWithRuns(ctx.user.id, input.sessionId);
    if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Sessione non trovata." });
    const run = current.runs.find(item => item.provider === input.provider);
    if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Agente non trovato nella sessione." });
    const [credentials, models] = await Promise.all([getCredentialsForUser(ctx.user.id), getAgentModelsForUser(ctx.user.id)]);
    const shared = sharedOpenRouterCredential(credentials);
    const isJunior = isJuniorProvider(input.provider);
    const config = isJunior ? (shared && run.resolvedModel ? { credential: shared, apiChannel: "openrouter" as const, model: run.resolvedModel, executionProvider: "openai" as ProviderId } : undefined) : (() => { const resolved = resolveAgentConfig(input.provider as ProviderId, credentials, modelsByProvider(models)); return resolved ? { ...resolved, executionProvider: input.provider as ProviderId } : undefined; })();
    if (!config || run.status !== "completed" || !run.response) {
      await updateAgentRun(run.id, { reviewStatus: "skipped", reviewError: "Replica non disponibile: manca una risposta iniziale o la chiave API." });
      return { provider: input.provider, reviewStatus: "skipped" as const };
    }
    const seniorParent = !isJunior && current.session.parentSessionId ? await getSessionWithRuns(ctx.user.id, current.session.parentSessionId) : undefined;
    const juniorRuns = seniorParent?.runs.filter(item => item.tier === "junior" && item.status === "completed" && item.response) ?? [];
    const peerRuns = [...current.runs.filter(item => item.provider !== input.provider && item.status === "completed" && item.response), ...juniorRuns];
    const peers = peerRuns.map(item => `### ${labelForRun(item.provider)} — ${item.role}\n${excerpt(item.response ?? "", reviewExcerptCharacters(current.session.prompt))}`).join("\n\n");
    if (!peers) {
      await updateAgentRun(run.id, { reviewStatus: "skipped", reviewError: "Non ci sono contributi di altri agenti da valutare." });
      return { provider: input.provider, reviewStatus: "skipped" as const };
    }
    const scoreTemplate = peerRuns.map(item => `{"provider":"${item.provider}","reasoning":1,"evidence":1,"utility":1,"role_fit":1,"rationale":"motivo breve"}`).join(",");
    const juniorInstruction = juniorRuns.length ? "I contributi etichettati Junior devono essere valutati con lo stesso rigore dei senior: i loro punteggi appariranno come valutazioni senior nella dashboard." : "";
    const prompt = `Tema: ${excerpt(current.session.prompt, 2_000)}\n\nLa tua posizione iniziale:\n${excerpt(run.response, 1_200)}\n\nPosizioni degli altri agenti:\n${peers}\n\nISTRUZIONE OBBLIGATORIA — scrivi PRIMA il seguente unico blocco JSON completo, con una voce per OGNI altro agente e valori interi da 1 a 10. Non omettere alcun peer, non includere te stesso e non aggiungere testo dentro il JSON:\n\n\`\`\`json\n{"peer_scores":[${scoreTemplate}]}\n\`\`\`\n\nDOPO il JSON, scrivi obbligatoriamente un parere sintetico leggibile di 3 frasi: accordi, divergenza principale e raccomandazione aggiornata. ${juniorInstruction} I voti JSON completi sono necessari per salvare le statistiche.`;
    await updateAgentRun(run.id, { reviewStatus: "running", reviewError: null });
    const finalizeReview = async (result: Awaited<ReturnType<typeof runProvider>>, executedModel: string, primaryCost: number | null, fallbackMessage?: string) => {
      const original = extractPeerReviewScores(result.text, input.provider, peerRuns.map(item => item.provider));
      let parsed = original;
      let repairUsage: ProviderUsage | undefined;
      let repairCost: number | null = null;
      let repairCharge: typeof result.providerCharge | undefined;
      let repairNote: string | undefined;

      if (!original.complete && shared) {
        try {
          const catalog = await getOpenRouterCatalog();
          const repairModel = juniorPoolForPrompt(current.session.prompt, catalog)[0]?.model;
          if (!repairModel) throw new Error("Nessun modello economico disponibile per la riparazione.");
          const repaired = await runProvider({
            provider: "openai",
            apiKey: decryptSecret(shared.secretCiphertext),
            model: repairModel,
            apiChannel: "openrouter",
            role: "validatore economico di JSON delle valutazioni",
            prompt: peerReviewRepairPrompt({ originalText: result.text, evaluatorProvider: input.provider, eligibleSubjects: peerRuns.map(item => item.provider) }),
            maxOutputTokens: peerReviewRepairOutputBudget(peerRuns.length),
          });
          repairUsage = repaired.usage;
          repairCost = costFor(repaired.usage, shared, repairModel);
          repairCharge = repaired.providerCharge;
          const repairedScores = extractPeerReviewScores(repaired.text, input.provider, peerRuns.map(item => item.provider));
          if (repairedScores.complete) {
            parsed = repairedScores;
            repairNote = `Valutazioni riparate con un solo controllo economico (${repairModel}).`;
          } else {
            repairNote = `Repair call eseguita ma incompleta: attesi ${peerRuns.length} voti validi, ricevuti ${repairedScores.scores.length}.`;
          }
        } catch (repairError) {
          const message = repairError instanceof Error ? repairError.message : "errore di riparazione non identificato";
          repairNote = `Repair call non disponibile: ${message.slice(0, 220)}.`;
        }
      }

      const evaluationInput = parsed.scores.map(score => ({ ...score, evaluationType: evaluationTypeForTiers(run.tier, peerRuns.find(item => item.provider === score.subjectProvider)?.tier ?? run.tier) }));
      if (evaluationInput.length) await savePeerEvaluations({ userId: ctx.user.id, sessionId: input.sessionId, evaluatorProvider: input.provider, evaluatorTier: run.tier, evaluations: evaluationInput });
      const reviewStatus = parsed.complete ? "completed" as const : "partial" as const;
      const evaluationMessage = parsed.complete ? [fallbackMessage, repairNote].filter(Boolean).join(" · ") || null : [fallbackMessage, repairNote, `Valutazione tra pari parziale: attesi ${peerRuns.length} voti validi, ricevuti e salvati ${parsed.scores.length}.`].filter(Boolean).join(" · ");
      const originalText = original.cleanText.trim();
      const visibleReview = originalText && !/^```json|^\{\s*"peer_scores"/i.test(originalText) ? originalText : parsed.complete ? "Valutazioni registrate. Il modello non ha aggiunto un parere sintetico." : "Replica ricevuta, ma valutazione strutturata incompleta.";
      const combinedCost = typeof primaryCost === "number" && typeof repairCost === "number" ? Number((primaryCost + repairCost).toFixed(8)) : repairUsage ? null : primaryCost;
      const combinedCharge = result.providerCharge && repairCharge ? result.providerCharge.unit === repairCharge.unit ? result.providerCharge.amount + repairCharge.amount : null : result.providerCharge?.amount ?? repairCharge?.amount ?? null;
      const chargeUnit = result.providerCharge && repairCharge ? result.providerCharge.unit === repairCharge.unit ? result.providerCharge.unit : null : result.providerCharge?.unit ?? repairCharge?.unit ?? null;
      await updateAgentRun(run.id, { reviewStatus, reviewResponse: visibleReview, reviewError: evaluationMessage, reviewRepairAttempts: repairUsage ? 1 : 0, reviewInputTokens: result.usage.inputTokens + (repairUsage?.inputTokens ?? 0), reviewOutputTokens: result.usage.outputTokens + (repairUsage?.outputTokens ?? 0), reviewCostUsd: combinedCost, reviewProviderCharge: combinedCharge, reviewProviderChargeUnit: chargeUnit, reviewUsageSource: repairUsage ? "reported" : result.usage.source });
      return { provider: input.provider, reviewStatus, usage: { ...result.usage, inputTokens: result.usage.inputTokens + (repairUsage?.inputTokens ?? 0), outputTokens: result.usage.outputTokens + (repairUsage?.outputTokens ?? 0), totalTokens: result.usage.totalTokens + (repairUsage?.totalTokens ?? 0) }, costUsd: combinedCost, evaluationsSaved: parsed.complete ? parsed.scores.length : 0, evaluationsComplete: parsed.complete, repaired: Boolean(repairUsage) };
    };
    try {
      const result = await runProvider({ provider: config.executionProvider, apiKey: decryptSecret(config.credential.secretCiphertext), model: config.model, apiChannel: config.apiChannel, role: `${run.role}, revisore delle posizioni del consiglio`, prompt, maxOutputTokens: isJunior ? 320 : peerReviewOutputBudget(config.executionProvider, current.session.prompt, peerRuns.length) });
      const cost = costFor(result.usage, config.credential, config.model);
      return finalizeReview(result, config.model ?? "", cost);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Errore non identificato durante la replica.";
      const fallbackModel = isJunior ? juniorFallbackCandidate(config.model ?? "", run.fallbackModel) : undefined;
      if (fallbackModel) {
        try {
          const fallback = await runProvider({ provider: "openai", apiKey: decryptSecret(config.credential.secretCiphertext), model: fallbackModel, apiChannel: "openrouter", role: `${run.role}, revisore delle posizioni del consiglio`, prompt, maxOutputTokens: 320 });
          const fallbackCost = costFor(fallback.usage, config.credential, fallbackModel);
          const finalized = await finalizeReview(fallback, fallbackModel, fallbackCost, `Fallback automatico nella replica: ${config.model} non disponibile; usato ${fallbackModel}.`);
          await updateAgentRun(run.id, { resolvedModel: fallbackModel });
          return { ...finalized, fallbackUsed: true };
        } catch (fallbackError) {
          const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : "Fallback junior non riuscito.";
          await updateAgentRun(run.id, { reviewStatus: "failed", reviewError: `${message.slice(0, 380)} · Fallback: ${fallbackMessage.slice(0, 380)}` });
          return { provider: input.provider, reviewStatus: "failed" as const };
        }
      }
      await updateAgentRun(run.id, { reviewStatus: "failed", reviewError: message.slice(0, 800) });
      return { provider: input.provider, reviewStatus: "failed" as const };
    }
  }),

  synthesize: protectedProcedure.input(z.object({ sessionId: z.string().min(6).max(32) })).mutation(async ({ ctx, input }) => {
    const current = await getSessionWithRuns(ctx.user.id, input.sessionId);
    if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Sessione non trovata." });
    const coverage = synthesisCoverage(current.runs);
    const { successful, missingPositions } = coverage;
    if (!coverage.canSynthesize) {
      const labels = missingPositions.map(run => labelForRun(run.provider)).join(", ");
      throw new TRPCError({ code: "BAD_REQUEST", message: `Nessun parere utilizzabile: ${labels || "gli agenti coinvolti"} non hanno prodotto una posizione.` });
    }
    const incompleteReviews = successful.filter(run => run.reviewStatus !== "completed" && !(current.session.mode === "economic" && run.reviewStatus === "partial"));
    const partialNotice = [
      `Pareri iniziali disponibili: ${successful.length} su ${current.runs.length}.`,
      missingPositions.length ? `Contributi iniziali assenti: ${missingPositions.map(run => labelForRun(run.provider)).join(", ")}.` : "",
      incompleteReviews.length ? `Repliche incrociate non disponibili: ${incompleteReviews.map(run => labelForRun(run.provider)).join(", ")}.` : "",
    ].filter(Boolean).join(" ");
    const dossier = successful.map(run => `## ${labelForRun(run.provider)} — ${run.role}\nPosizione: ${excerpt(run.response ?? "", 6_000)}\nReplica: ${run.reviewResponse ? excerpt(run.reviewResponse, 3_500) : "non disponibile"}`).join("\n\n");
    const isEconomic = current.session.mode === "economic";
    const prompt = `Richiesta: ${excerpt(current.session.prompt, 3_000)}\n\nDibattito del consiglio:\n${dossier}\n\nNota obbligatoria sulla copertura: ${partialNotice} Apri sempre il testo con una breve avvertenza che indichi esattamente quanti pareri sono disponibili sul totale. Se manca qualche contributo, dichiara che la sintesi è basata sui soli pareri disponibili e non attribuire agli assenti opinioni non espresse. Il verdetto deve comunque individuare il massimo consenso realmente ricavabile.\n\n${isEconomic ? "Redigi un dossier preliminare in italiano entro 420 parole: mappa del problema, accordi, divergenze, incertezze e domande che giustificano eventualmente il coinvolgimento dei senior." : "Redigi un verdetto sintetico e condiviso in italiano entro 550 parole: 1) decisione proposta, 2) accordi verificati, 3) divergenze residue e rischio associato, 4) piano d’azione in 3-5 passi. Non inventare attribuzioni."}`;
    const [credentials, models] = await Promise.all([getCredentialsForUser(ctx.user.id), getAgentModelsForUser(ctx.user.id)]);
    const synthesisProvider = isEconomic ? "openai" as ProviderId : chooseSynthesisProvider(current.runs.filter(run => run.status === "completed" && run.response).map(run => run.provider));
    if (!synthesisProvider) throw new TRPCError({ code: "BAD_REQUEST", message: "Configura almeno una chiave API per produrre il verdetto." });
    const shared = sharedOpenRouterCredential(credentials);
    const config = isEconomic ? (shared && successful[0]?.resolvedModel ? { credential: shared, model: successful[0].resolvedModel, apiChannel: "openrouter" as const } : undefined) : resolveAgentConfig(synthesisProvider, credentials, await validatedModelsByProvider(models, credentials));
    if (!config) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Configurazione del facilitatore non disponibile." });
    let synthesisModel = config.model ?? "";
    const execution = isEconomic
      ? await executeWithJuniorFallback({ primaryModel: synthesisModel, fallbackModel: successful[0]?.fallbackModel, execute: async model => runProvider({ provider: "openai", apiKey: decryptSecret(config.credential.secretCiphertext), model, apiChannel: "openrouter", role: "facilitatore del dossier preliminare", prompt, maxOutputTokens: 260 }) })
      : { result: await runProvider({ provider: synthesisProvider, apiKey: decryptSecret(config.credential.secretCiphertext), model: synthesisModel, apiChannel: config.apiChannel, role: "facilitatore neutrale del dibattito", prompt, maxOutputTokens: adaptiveOutputBudget(synthesisProvider, "synthesis", current.session.prompt) }), model: synthesisModel, fallbackUsed: false };
    synthesisModel = execution.model;
    const result = execution.result;
    const synthesisCost = costFor(result.usage, config.credential, synthesisModel);
    const totals = costSummary(current.runs, result.usage, synthesisCost, result.providerCharge);
    await saveSessionSynthesis(ctx.user.id, input.sessionId, result.text, totals, { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, costUsd: synthesisCost, providerCharge: result.providerCharge?.amount ?? null, providerChargeUnit: result.providerCharge?.unit ?? null, usageSource: result.usage.source }, isEconomic ? { juniorDossier: result.text } : undefined);
    return { synthesis: result.text, usage: result.usage, costUsd: synthesisCost, totals, partial: Boolean(partialNotice), partialNotice: partialNotice || null };
  }),
});
