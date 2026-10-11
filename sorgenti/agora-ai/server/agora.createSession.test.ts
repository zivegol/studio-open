import { beforeEach, describe, expect, it, vi } from "vitest";

const events: string[] = [];
const createdRuns: Array<{ provider: string; role: string }> = [];

vi.mock("./db", () => ({
  createAgentRuns: vi.fn(async ({ runs }: { runs: Array<{ provider: string; role: string }> }) => {
    events.push("create-runs");
    createdRuns.splice(0, createdRuns.length, ...runs);
  }),
  attachDocumentsToSession: vi.fn(async () => []),
  createDeliberationSession: vi.fn(async () => ({ id: "session-role-test", status: "running" as const })),
  getAgentModelsForUser: vi.fn(async () => []),
  getAttachmentsByIdsForUser: vi.fn(async () => []),
  getCredentialsForUser: vi.fn(async () => [{ provider: "manus", secretCiphertext: "unused", model: null, apiChannel: "direct", inputCostPerMillion: null, outputCostPerMillion: null }]),
  getHardBudgetForUser: vi.fn(async () => null),
  getRolesForUser: vi.fn(async () => []),
  getSessionWithRuns: vi.fn(),
  listSessionsForUser: vi.fn(),
  removeCredential: vi.fn(),
  saveAgentModel: vi.fn(),
  saveAgentRole: vi.fn(async ({ provider }: { provider: string }) => { events.push(`save-${provider}`); }),
  saveCredential: vi.fn(),
  saveHardBudgetForUser: vi.fn(),
  saveSessionSynthesis: vi.fn(),
  updateAgentRun: vi.fn(),
}));

import { agoraRouter } from "./routers/agora";

const roles = {
  openai: "Analista", anthropic: "Critico", gemini: "Ideatore", kimi: "Ricercatore", manus: "Responsabile del piano tecnico", perplexity: "Verificatore",
} as const;

describe("agora.createSession", () => {
  beforeEach(() => { events.splice(0, events.length); createdRuns.splice(0, createdRuns.length); });

  it("salva i ruoli modificati prima di creare gli agenti della sessione", async () => {
    const caller = agoraRouter.createCaller({ user: { id: 7 }, req: {} as never, res: {} as never });
    await caller.createSession({ prompt: "Definiamo un piano tecnico per una nuova applicazione digitale.", providers: ["manus"], roles });

    expect(events).toHaveLength(7);
    expect(events.slice(0, 6)).toEqual(["save-openai", "save-anthropic", "save-gemini", "save-kimi", "save-manus", "save-perplexity"]);
    expect(events[6]).toBe("create-runs");
    expect(createdRuns).toEqual([{ provider: "manus", role: "Responsabile del piano tecnico" }]);
  });
});
