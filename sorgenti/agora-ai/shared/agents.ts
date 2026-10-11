export const PROVIDER_IDS = ["openai", "anthropic", "gemini", "kimi", "manus", "perplexity"] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export const PROVIDERS: Record<ProviderId, { label: string; shortLabel: string; avatar: string; accent: string; defaultRole: string; defaultModel: string | null }> = {
  openai: { label: "ChatGPT", shortLabel: "GPT", avatar: "G", accent: "bg-emerald-100 text-emerald-900", defaultRole: "Analista strategico", defaultModel: "gpt-5-mini" },
  anthropic: { label: "Claude", shortLabel: "Claude", avatar: "C", accent: "bg-orange-100 text-orange-900", defaultRole: "Critico costruttivo", defaultModel: "claude-sonnet-4-5" },
  gemini: { label: "Gemini", shortLabel: "Gemini", avatar: "G", accent: "bg-blue-100 text-blue-900", defaultRole: "Ideatore", defaultModel: "gemini-3.7-flash" },
  kimi: { label: "Kimi", shortLabel: "Kimi", avatar: "K", accent: "bg-violet-100 text-violet-900", defaultRole: "Ricercatore", defaultModel: "kimi-k3" },
  manus: { label: "Manus", shortLabel: "Manus", avatar: "M", accent: "bg-rose-100 text-rose-900", defaultRole: "Pianificatore operativo", defaultModel: null },
  perplexity: { label: "Perplexity", shortLabel: "PPLX", avatar: "P", accent: "bg-cyan-100 text-cyan-900", defaultRole: "Verificatore", defaultModel: null },
};

export const DEFAULT_ROLES: Record<ProviderId, string> = Object.fromEntries(
  PROVIDER_IDS.map(provider => [provider, PROVIDERS[provider].defaultRole]),
) as Record<ProviderId, string>;

export const OPENROUTER_COMPATIBLE_PROVIDERS = ["openai", "anthropic", "gemini", "kimi", "perplexity"] as const;
export type OpenRouterProviderId = (typeof OPENROUTER_COMPATIBLE_PROVIDERS)[number];

export const OPENROUTER_MODEL_FALLBACKS: Record<OpenRouterProviderId, { recommended: string; economical: string }> = {
  openai: { recommended: "openai/gpt-5.4-mini", economical: "openai/gpt-5.4-nano" },
  anthropic: { recommended: "anthropic/claude-sonnet-4.6", economical: "anthropic/claude-haiku-4.5" },
  gemini: { recommended: "google/gemini-3.1-pro-preview", economical: "google/gemini-2.5-flash" },
  kimi: { recommended: "moonshotai/kimi-k2.5", economical: "moonshotai/kimi-k2.5" },
  perplexity: { recommended: "perplexity/sonar-pro", economical: "perplexity/sonar" },
};

export function isOpenRouterCompatible(provider: ProviderId): provider is OpenRouterProviderId {
  return (OPENROUTER_COMPATIBLE_PROVIDERS as readonly string[]).includes(provider);
}

export function chooseSynthesisProvider(configuredProviders: Iterable<string>): ProviderId | undefined {
  const configured = new Set(configuredProviders);
  return PROVIDER_IDS.find(provider => configured.has(provider));
}

export function configuredRequestedProviders(requestedProviders: Iterable<ProviderId>, configuredProviders: Iterable<string>): ProviderId[] {
  const requested = new Set(requestedProviders);
  const configured = new Set(configuredProviders);
  return PROVIDER_IDS.filter(provider => requested.has(provider) && configured.has(provider));
}

export const AGENT_STATUSES = ["queued", "running", "completed", "failed", "skipped"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];
