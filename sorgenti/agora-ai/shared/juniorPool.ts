export const JUNIOR_PROVIDER_IDS = ["junior_analyst", "junior_critic", "junior_researcher"] as const;
export type JuniorProviderId = (typeof JUNIOR_PROVIDER_IDS)[number];

export type JuniorAgent = {
  provider: JuniorProviderId;
  label: string;
  role: string;
  preferredModels: string[];
  fallbackModels: string[];
};

export type JuniorAssignment = {
  provider: JuniorProviderId;
  role: string;
  objective: string;
  reason: string;
};

export type JuniorCoordination = {
  domain: string;
  complexity: "bassa" | "media" | "alta";
  teamReason: string;
  assignments: JuniorAssignment[];
};

export function parseJuniorCoordination(text: string): JuniorCoordination | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const value = JSON.parse(match[0]) as Partial<JuniorCoordination>;
    if (!value.domain || !value.teamReason || !["bassa", "media", "alta"].includes(value.complexity ?? "") || !Array.isArray(value.assignments)) return null;
    const byProvider = new Map(value.assignments.map(item => [item?.provider, item]));
    const assignments = JUNIOR_PROVIDER_IDS.map(provider => byProvider.get(provider)).filter((item): item is JuniorAssignment => Boolean(item?.role?.trim() && item?.objective?.trim() && item?.reason?.trim()));
    if (assignments.length !== JUNIOR_PROVIDER_IDS.length) return null;
    return { domain: value.domain.trim().slice(0, 120), complexity: value.complexity as JuniorCoordination["complexity"], teamReason: value.teamReason.trim().slice(0, 500), assignments: assignments.map(item => ({ ...item, role: item.role.trim().slice(0, 90), objective: item.objective.trim().slice(0, 240), reason: item.reason.trim().slice(0, 240) })) };
  } catch {
    return null;
  }
}

export function applyJuniorCoordination(fallback: JuniorAgent[], coordination: JuniorCoordination | null): JuniorAgent[] {
  if (!coordination) return fallback;
  const assignments = new Map(coordination.assignments.map(item => [item.provider, item]));
  return fallback.map(agent => {
    const assignment = assignments.get(agent.provider);
    return assignment ? { ...agent, role: `${assignment.role}: ${assignment.objective}`.slice(0, 180) } : agent;
  });
}

export function juniorRolesForTheme(theme: string): JuniorAgent[] {
  const thematic = theme === "riflessione concettuale"
    ? ["Analista concettuale rapido", "Controargomentatore filosofico", "Ricercatore interdisciplinare"]
    : theme === "progetto tecnico"
      ? ["Analista tecnico rapido", "Revisore dei rischi", "Ricercatore di soluzioni"]
      : theme === "strategia di mercato"
        ? ["Analista di mercato rapido", "Critico commerciale", "Ricercatore di segnali"]
        : ["Analista rapido", "Controargomentatore", "Ricercatore sintetico"];
  return [
    {
      provider: "junior_analyst",
      label: "Junior analista",
      role: thematic[0],
      preferredModels: ["openai/gpt-5.4-nano", "qwen/qwen3.7-flash"],
      fallbackModels: ["google/gemini-3.1-flash-lite", "mistralai/mistral-small-2603"],
    },
    {
      provider: "junior_critic",
      label: "Junior critico",
      role: thematic[1],
      preferredModels: ["google/gemini-3.1-flash-lite", "mistralai/mistral-small-2603"],
      fallbackModels: ["qwen/qwen3.7-flash", "openai/gpt-5.4-nano"],
    },
    {
      provider: "junior_researcher",
      label: "Junior ricercatore",
      role: thematic[2],
      preferredModels: ["qwen/qwen3.7-flash", "mistralai/mistral-small-2603"],
      fallbackModels: ["openai/gpt-5.4-nano", "google/gemini-3.1-flash-lite"],
    },
  ];
}

export function juniorFallbackCandidate(primaryModel: string, fallbackModel: string | null | undefined) {
  if (!fallbackModel || fallbackModel === primaryModel) return undefined;
  return fallbackModel;
}

export function selectCrossFamilyJuniorFallback(primaryModel: string, paidCandidates: string[]) {
  const primaryFamily = primaryModel.split("/")[0];
  return paidCandidates.find(model => model.split("/")[0] !== primaryFamily) ?? paidCandidates.find(model => model !== primaryModel.replace(/:free$/, ""));
}

export async function executeWithJuniorFallback<T>(input: {
  primaryModel: string;
  fallbackModel: string | null | undefined;
  execute: (model: string) => Promise<T>;
}) {
  try {
    return { result: await input.execute(input.primaryModel), model: input.primaryModel, fallbackUsed: false };
  } catch (primaryError) {
    const fallback = juniorFallbackCandidate(input.primaryModel, input.fallbackModel);
    if (!fallback) throw primaryError;
    return { result: await input.execute(fallback), model: fallback, fallbackUsed: true };
  }
}
