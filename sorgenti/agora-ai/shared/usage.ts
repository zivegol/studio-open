import type { ProviderId } from "./agents";

export type UsageSource = "reported" | "estimated";

export type ProviderUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  source: UsageSource;
};

export type ProviderCharge = {
  amount: number;
  unit: "openrouter_credits" | "manus_credits";
  source: "provider";
};

export type TokenBudget = { initialOutput: number; reviewOutput: number; synthesisOutput: number };

export const TOKEN_BUDGETS: Record<ProviderId, TokenBudget> = {
  openai: { initialOutput: 2_400, reviewOutput: 1_000, synthesisOutput: 2_200 },
  anthropic: { initialOutput: 1_800, reviewOutput: 900, synthesisOutput: 2_000 },
  gemini: { initialOutput: 1_800, reviewOutput: 900, synthesisOutput: 2_000 },
  kimi: { initialOutput: 1_800, reviewOutput: 900, synthesisOutput: 2_000 },
  manus: { initialOutput: 1_400, reviewOutput: 800, synthesisOutput: 1_700 },
  perplexity: { initialOutput: 1_400, reviewOutput: 800, synthesisOutput: 1_700 },
};

export type DebatePhase = "initial" | "review" | "synthesis";

export function promptBudgetMultiplier(prompt: string) {
  const length = prompt.trim().length;
  if (length <= 280) return 0.45;
  if (length <= 900) return 0.65;
  if (length <= 2_500) return 0.82;
  return 1;
}

export function adaptiveOutputBudget(provider: ProviderId, phase: DebatePhase, prompt: string) {
  const base = TOKEN_BUDGETS[provider][phase === "initial" ? "initialOutput" : phase === "review" ? "reviewOutput" : "synthesisOutput"];
  // A short user prompt can still require a complete, structured answer. The old
  // 260-token floor frequently cut opinions in the middle of a sentence.
  const minimum = phase === "initial" ? 2_400 : phase === "review" ? 1_000 : 1_800;
  const hasDocumentContext = prompt.includes("--- Contesto documentale selezionato ---");
  const documentMinimum = !hasDocumentContext ? 0
    : phase === "initial" ? provider === "openai" ? 3_200 : 1_150
    : phase === "review" ? 620
    : 1_300;
  return Math.max(minimum, documentMinimum, Math.round(base * promptBudgetMultiplier(prompt)));
}

export function peerReviewOutputBudget(provider: ProviderId, prompt: string, peerCount: number) {
  const adaptive = adaptiveOutputBudget(provider, "review", prompt);
  const structuredMinimum = 110 + Math.max(0, peerCount) * 55;
  return Math.max(adaptive, structuredMinimum);
}

export function peerReviewRepairOutputBudget(peerCount: number) {
  return Math.min(1_000, Math.max(420, 180 + Math.max(0, peerCount) * 95));
}

export function reviewExcerptCharacters(prompt: string) {
  const multiplier = promptBudgetMultiplier(prompt);
  return multiplier <= 0.45 ? 420 : multiplier <= 0.65 ? 600 : multiplier <= 0.82 ? 760 : 900;
}

export function estimateTextTokens(value: string) {
  return Math.max(1, Math.ceil(value.trim().length / 4));
}

export function calculateCostUsd(usage: ProviderUsage, inputCostPerMillion?: number | null, outputCostPerMillion?: number | null) {
  if (inputCostPerMillion === null || inputCostPerMillion === undefined || outputCostPerMillion === null || outputCostPerMillion === undefined) return null;
  return Number(((usage.inputTokens * inputCostPerMillion + usage.outputTokens * outputCostPerMillion) / 1_000_000).toFixed(8));
}

export function sumKnownCosts(costs: Array<number | null | undefined>) {
  const known = costs.filter((cost): cost is number => typeof cost === "number" && Number.isFinite(cost));
  return { amount: Number(known.reduce((sum, cost) => sum + cost, 0).toFixed(8)), complete: known.length === costs.length };
}
