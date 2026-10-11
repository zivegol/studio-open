import { and, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { agentModelPreferences, agentPeerEvaluations, agentRoles, agentRuns, apiCredentials, deliberationSessions, externalIdentities, InsertUser, sessionAttachments, users } from "../drizzle/schema";
import { nanoid } from "nanoid";
import { documentContext } from "./documents";
import { createHash } from "node:crypto";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getUserById(id: number) {
  const db = await dbOrThrow();
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0];
}

export async function upsertOidcUser(input: { issuer: string; subject: string; email: string | null; name: string | null; isOwner: boolean }) {
  const db = await dbOrThrow();
  const existingIdentity = await db.select().from(externalIdentities).where(and(eq(externalIdentities.issuer, input.issuer), eq(externalIdentities.subject, input.subject))).limit(1);
  if (existingIdentity[0]) {
    await db.update(externalIdentities).set({ emailAtLogin: input.email, lastSeenAt: new Date() }).where(eq(externalIdentities.id, existingIdentity[0].id));
    await db.update(users).set({ name: input.name, email: input.email, loginMethod: "oidc", lastSignedIn: new Date(), updatedAt: new Date(), ...(input.isOwner ? { role: "admin" as const } : {}) }).where(eq(users.id, existingIdentity[0].userId));
    return getUserById(existingIdentity[0].userId);
  }

  const legacyOpenId = `oidc:${createHash("sha256").update(input.issuer).update("\u0000").update(input.subject).digest("base64url")}`;
  const inserted = await db.insert(users).values({ openId: legacyOpenId, name: input.name, email: input.email, loginMethod: "oidc", role: input.isOwner ? "admin" : "user", lastSignedIn: new Date() });
  const userId = Number(inserted[0].insertId);
  await db.insert(externalIdentities).values({ userId, issuer: input.issuer, subject: input.subject, emailAtLogin: input.email, lastSeenAt: new Date() });
  return getUserById(userId);
}

export async function getHardBudgetForUser(userId: number) {
  const db = await dbOrThrow();
  const result = await db.select({ hardBudgetUsd: users.hardBudgetUsd }).from(users).where(eq(users.id, userId)).limit(1);
  return result[0]?.hardBudgetUsd ?? null;
}

export async function saveHardBudgetForUser(userId: number, hardBudgetUsd: number | null) {
  const db = await dbOrThrow();
  await db.update(users).set({ hardBudgetUsd, updatedAt: new Date() }).where(eq(users.id, userId));
  return hardBudgetUsd;
}

async function dbOrThrow() {
  const db = await getDb();
  if (!db) throw new Error("Il database non è disponibile.");
  return db;
}

export function reviewForDisplay(value: string | null) {
  if (!value) return value;
  const fenced = value.replace(/```json\s*[\s\S]*?\s*```/gi, "").trim();
  if (!fenced) return "Valutazioni tecniche registrate; il parere sintetico non è disponibile.";
  const start = fenced.indexOf('{"peer_scores"');
  if (start < 0) return fenced;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < fenced.length; index += 1) {
    const character = fenced[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return `${fenced.slice(0, start)} ${fenced.slice(index + 1)}`.replace(/\s{2,}/g, " ").trim() || "Valutazioni tecniche registrate; il parere sintetico non è disponibile.";
    }
  }
  return fenced.slice(0, start).trim() || "Valutazioni tecniche incomplete; il parere sintetico non è disponibile.";
}

export function reviewForRunDisplay(value: string | null, reviewStatus: string | null) {
  const visible = reviewForDisplay(value);
  return reviewStatus === "partial" && visible
    ? `Valutazione parziale — ${visible}`
    : visible;
}

export async function getCredentialsForUser(userId: number) {
  const db = await dbOrThrow();
  const own = await db.select().from(apiCredentials).where(eq(apiCredentials.userId, userId));
  if (own.length) return own;
  const studio = await db.select({ credential: apiCredentials }).from(apiCredentials).innerJoin(users, eq(apiCredentials.userId, users.id)).where(eq(users.role, "admin"));
  return studio.map(row => row.credential);
}

export async function saveCredential(input: { userId: number; provider: string; secretCiphertext: string; model?: string | null; apiChannel?: string; inputCostPerMillion?: number | null; outputCostPerMillion?: number | null }) {
  const db = await dbOrThrow();
  const existing = await db.select().from(apiCredentials).where(and(eq(apiCredentials.userId, input.userId), eq(apiCredentials.provider, input.provider))).limit(1);
  if (existing[0]) {
    await db.update(apiCredentials).set({ secretCiphertext: input.secretCiphertext, model: input.model ?? null, apiChannel: input.apiChannel ?? "direct", inputCostPerMillion: input.inputCostPerMillion ?? null, outputCostPerMillion: input.outputCostPerMillion ?? null, updatedAt: new Date() }).where(eq(apiCredentials.id, existing[0].id));
  } else {
    await db.insert(apiCredentials).values(input);
  }
}

export async function removeCredential(userId: number, provider: string) {
  const db = await dbOrThrow();
  await db.delete(apiCredentials).where(and(eq(apiCredentials.userId, userId), eq(apiCredentials.provider, provider)));
}

export async function getRolesForUser(userId: number) {
  const db = await dbOrThrow();
  return db.select().from(agentRoles).where(eq(agentRoles.userId, userId));
}

export async function saveAgentRole(input: { userId: number; provider: string; role: string }) {
  const db = await dbOrThrow();
  const existing = await db.select().from(agentRoles).where(and(eq(agentRoles.userId, input.userId), eq(agentRoles.provider, input.provider))).limit(1);
  if (existing[0]) {
    await db.update(agentRoles).set({ role: input.role, updatedAt: new Date() }).where(eq(agentRoles.id, existing[0].id));
  } else {
    await db.insert(agentRoles).values(input);
  }
}

export async function getAgentModelsForUser(userId: number) {
  const db = await dbOrThrow();
  return db.select().from(agentModelPreferences).where(eq(agentModelPreferences.userId, userId));
}

export async function saveAgentModel(input: { userId: number; provider: string; model: string }) {
  const db = await dbOrThrow();
  const existing = await db.select().from(agentModelPreferences).where(and(eq(agentModelPreferences.userId, input.userId), eq(agentModelPreferences.provider, input.provider))).limit(1);
  if (existing[0]) {
    await db.update(agentModelPreferences).set({ model: input.model, updatedAt: new Date() }).where(eq(agentModelPreferences.id, existing[0].id));
  } else {
    await db.insert(agentModelPreferences).values(input);
  }
}

export async function createDeliberationSession(input: { userId: number; title: string; prompt: string; mode?: "economic" | "deep"; parentSessionId?: string | null; juniorDossier?: string | null; estimatedTokens?: number; estimatedCostUsd?: number | null; costComplete?: boolean }) {
  const db = await dbOrThrow();
  const id = nanoid();
  await db.insert(deliberationSessions).values({ ...input, id, costComplete: input.costComplete ? 1 : 0, status: "running" });
  return { id, ...input, status: "running" as const };
}

export async function createAgentRuns(input: { sessionId: string; userId: number; runs: Array<{ provider: string; role: string; tier?: "junior" | "senior"; resolvedModel?: string | null; fallbackModel?: string | null }> }) {
  const db = await dbOrThrow();
  await db.insert(agentRuns).values(input.runs.map(run => ({ ...run, sessionId: input.sessionId, userId: input.userId, tier: run.tier ?? "senior", resolvedModel: run.resolvedModel ?? null, fallbackModel: run.fallbackModel ?? null, status: "queued" as const })));
}

export async function createSessionAttachment(input: { userId: number; fileName: string; mimeType: string; sizeBytes: number; storageKey: string; storageUrl: string; textExcerpt: string; source: "external" | "nextcloud"; anonymizationStatus: "anonymized" | "not_anonymized"; aiDisclosureConfirmedAt: Date; sourceReference?: string | null }) {
  const db = await dbOrThrow();
  const result = await db.insert(sessionAttachments).values({ ...input, sessionId: null, includeInContext: 0 });
  const id = Number(result[0].insertId);
  const created = await db.select().from(sessionAttachments).where(and(eq(sessionAttachments.id, id), eq(sessionAttachments.userId, input.userId))).limit(1);
  if (!created[0]) throw new Error("Impossibile registrare l’allegato.");
  return created[0];
}

export async function listSessionAttachmentsForUser(userId: number, sessionId?: string) {
  const db = await dbOrThrow();
  return db.select().from(sessionAttachments).where(sessionId ? and(eq(sessionAttachments.userId, userId), eq(sessionAttachments.sessionId, sessionId)) : eq(sessionAttachments.userId, userId)).orderBy(desc(sessionAttachments.createdAt));
}

export async function getAttachmentsByIdsForUser(userId: number, attachmentIds: number[]) {
  if (!attachmentIds.length) return [];
  const db = await dbOrThrow();
  const documents = await db.select().from(sessionAttachments).where(and(eq(sessionAttachments.userId, userId), inArray(sessionAttachments.id, attachmentIds)));
  if (documents.length !== attachmentIds.length) throw new Error("Uno o più allegati non sono disponibili per il tuo account.");
  return documents;
}

export async function attachDocumentsToSession(userId: number, sessionId: string, attachmentIds: number[]) {
  if (!attachmentIds.length) return [];
  const db = await dbOrThrow();
  const documents = await db.select().from(sessionAttachments).where(and(eq(sessionAttachments.userId, userId), inArray(sessionAttachments.id, attachmentIds)));
  if (documents.length !== attachmentIds.length || documents.some(document => document.sessionId && document.sessionId !== sessionId)) throw new Error("Uno o più allegati non sono disponibili per questa sessione.");
  await db.update(sessionAttachments).set({ sessionId, includeInContext: 1, updatedAt: new Date() }).where(and(eq(sessionAttachments.userId, userId), inArray(sessionAttachments.id, attachmentIds)));
  return documents.map(document => ({ ...document, sessionId, includeInContext: 1 }));
}

export async function getSessionWithRuns(userId: number, sessionId: string) {
  const db = await dbOrThrow();
  const session = await db.select().from(deliberationSessions).where(and(eq(deliberationSessions.id, sessionId), eq(deliberationSessions.userId, userId))).limit(1);
  if (!session[0]) return undefined;
  const storedRuns = await db.select().from(agentRuns).where(and(eq(agentRuns.sessionId, sessionId), eq(agentRuns.userId, userId)));
  const runs = storedRuns.map(run => ({ ...run, reviewResponse: reviewForRunDisplay(run.reviewResponse, run.reviewStatus) }));
  const attachments = await listSessionAttachmentsForUser(userId, sessionId);
  const evaluations = await db.select().from(agentPeerEvaluations).where(and(eq(agentPeerEvaluations.sessionId, sessionId), eq(agentPeerEvaluations.userId, userId)));
  const parent = session[0].parentSessionId ? await db.select().from(deliberationSessions).where(and(eq(deliberationSessions.id, session[0].parentSessionId), eq(deliberationSessions.userId, userId))).limit(1) : [];
  const storedParentRuns = parent[0] ? await db.select().from(agentRuns).where(and(eq(agentRuns.sessionId, parent[0].id), eq(agentRuns.userId, userId))) : [];
  const parentRuns = storedParentRuns.map(run => ({ ...run, reviewResponse: reviewForRunDisplay(run.reviewResponse, run.reviewStatus) }));
  const child = await db.select().from(deliberationSessions).where(and(eq(deliberationSessions.parentSessionId, sessionId), eq(deliberationSessions.userId, userId))).limit(1);
  const contextualSession = { ...session[0], prompt: `${session[0].prompt}${documentContext(attachments.filter(attachment => attachment.includeInContext === 1))}` };
  return { session: contextualSession, runs, evaluations, attachments, parentSession: parent[0] ?? null, parentRuns, childSession: child[0] ?? null };
}

export type PeerEvaluationInput = {
  subjectProvider: string;
  evaluationType: "peer" | "cross_tier";
  reasoningScore: number;
  evidenceScore: number;
  utilityScore: number;
  roleFitScore: number;
  overallScore: number;
  rationale: string;
};

export function evaluationTypeForTiers(evaluatorTier: "junior" | "senior", subjectTier: "junior" | "senior") {
  return evaluatorTier === subjectTier ? "peer" as const : "cross_tier" as const;
}

export async function savePeerEvaluations(input: { userId: number; sessionId: string; evaluatorProvider: string; evaluatorTier: "junior" | "senior"; evaluations: PeerEvaluationInput[] }) {
  if (!input.evaluations.length) return;
  const db = await dbOrThrow();
  await Promise.all(input.evaluations.map(evaluation => db.insert(agentPeerEvaluations).values({ ...input, ...evaluation }).onDuplicateKeyUpdate({ set: { evaluatorTier: input.evaluatorTier, evaluationType: evaluation.evaluationType, reasoningScore: evaluation.reasoningScore, evidenceScore: evaluation.evidenceScore, utilityScore: evaluation.utilityScore, roleFitScore: evaluation.roleFitScore, overallScore: evaluation.overallScore, rationale: evaluation.rationale, updatedAt: new Date() } })));
}

export async function getPeerStatisticsForUser(userId: number) {
  const db = await dbOrThrow();
  const evaluations = await db.select().from(agentPeerEvaluations).where(eq(agentPeerEvaluations.userId, userId));
  const grouped = new Map<string, typeof evaluations>();
  evaluations.forEach(evaluation => grouped.set(evaluation.subjectProvider, [...(grouped.get(evaluation.subjectProvider) ?? []), evaluation]));
  return Array.from(grouped.entries()).map(([provider, items]) => {
    const average = (field: "reasoningScore" | "evidenceScore" | "utilityScore" | "roleFitScore" | "overallScore") => items.reduce((sum, item) => sum + item[field], 0) / items.length;
    const juniorItems = items.filter(item => item.evaluatorTier === "junior");
    const seniorItems = items.filter(item => item.evaluatorTier === "senior");
    const scopedAverage = (scope: typeof items) => scope.length ? scope.reduce((sum, item) => sum + item.overallScore, 0) / scope.length : null;
    const bySession = new Map<string, typeof items>();
    items.forEach(item => bySession.set(item.sessionId, [...(bySession.get(item.sessionId) ?? []), item]));
    const history = Array.from(bySession.entries()).map(([sessionId, sessionItems]) => ({ sessionId, score: sessionItems.reduce((sum, item) => sum + item.overallScore, 0) / sessionItems.length, at: sessionItems.reduce((latest, item) => item.updatedAt > latest ? item.updatedAt : latest, sessionItems[0].updatedAt) })).sort((a, b) => a.at.getTime() - b.at.getTime()).slice(-12);
    return { provider, sampleSize: items.length, overallScore: average("overallScore"), reasoningScore: average("reasoningScore"), evidenceScore: average("evidenceScore"), utilityScore: average("utilityScore"), roleFitScore: average("roleFitScore"), juniorSampleSize: juniorItems.length, juniorOverallScore: scopedAverage(juniorItems), seniorSampleSize: seniorItems.length, seniorOverallScore: scopedAverage(seniorItems), latestAt: items.reduce((latest, item) => item.updatedAt > latest ? item.updatedAt : latest, items[0].updatedAt), history };
  }).sort((a, b) => (b.seniorOverallScore ?? b.overallScore) - (a.seniorOverallScore ?? a.overallScore));
}

export async function listSessionsForUser(userId: number) {
  const db = await dbOrThrow();
  const sessions = await db.select().from(deliberationSessions).where(eq(deliberationSessions.userId, userId)).orderBy(desc(deliberationSessions.createdAt)).limit(50);
  if (!sessions.length) return [];
  const runs = await db.select({
    sessionId: agentRuns.sessionId,
    provider: agentRuns.provider,
    initialInputTokens: agentRuns.initialInputTokens,
    initialOutputTokens: agentRuns.initialOutputTokens,
    initialCostUsd: agentRuns.initialCostUsd,
    initialProviderCharge: agentRuns.initialProviderCharge,
    initialProviderChargeUnit: agentRuns.initialProviderChargeUnit,
    initialUsageSource: agentRuns.initialUsageSource,
    reviewInputTokens: agentRuns.reviewInputTokens,
    reviewOutputTokens: agentRuns.reviewOutputTokens,
    reviewCostUsd: agentRuns.reviewCostUsd,
    reviewProviderCharge: agentRuns.reviewProviderCharge,
    reviewProviderChargeUnit: agentRuns.reviewProviderChargeUnit,
    reviewUsageSource: agentRuns.reviewUsageSource,
  }).from(agentRuns).where(eq(agentRuns.userId, userId));
  return sessions.map(session => ({ ...session, runs: runs.filter(run => run.sessionId === session.id) }));
}

export async function updateAgentRun(runId: number, patch: { status?: "queued" | "running" | "completed" | "failed" | "skipped"; response?: string | null; error?: string | null; resolvedModel?: string | null; startedAt?: Date | null; completedAt?: Date | null; initialInputTokens?: number | null; initialOutputTokens?: number | null; initialCostUsd?: number | null; initialProviderCharge?: number | null; initialProviderChargeUnit?: string | null; initialUsageSource?: string | null; reviewStatus?: "queued" | "running" | "completed" | "partial" | "failed" | "skipped" | null; reviewResponse?: string | null; reviewError?: string | null; reviewRepairAttempts?: number; reviewInputTokens?: number | null; reviewOutputTokens?: number | null; reviewCostUsd?: number | null; reviewProviderCharge?: number | null; reviewProviderChargeUnit?: string | null; reviewUsageSource?: string | null }) {
  const db = await dbOrThrow();
  await db.update(agentRuns).set({ ...patch, updatedAt: new Date() }).where(eq(agentRuns.id, runId));
}

export async function saveSessionSynthesis(userId: number, sessionId: string, finalSynthesis: string, totals: { actualTokens: number; actualCostUsd: number; costComplete: boolean; openrouterCredits: number; manusCredits: number }, synthesis: { inputTokens: number; outputTokens: number; costUsd: number | null; providerCharge?: number | null; providerChargeUnit?: string | null; usageSource: string }, options?: { juniorDossier?: string | null }) {
  const db = await dbOrThrow();
  await db.update(deliberationSessions).set({ finalSynthesis, juniorDossier: options?.juniorDossier ?? null, actualTokens: totals.actualTokens, actualCostUsd: totals.actualCostUsd, costComplete: totals.costComplete ? 1 : 0, openrouterCredits: totals.openrouterCredits, manusCredits: totals.manusCredits, synthesisInputTokens: synthesis.inputTokens, synthesisOutputTokens: synthesis.outputTokens, synthesisCostUsd: synthesis.costUsd, synthesisProviderCharge: synthesis.providerCharge ?? null, synthesisProviderChargeUnit: synthesis.providerChargeUnit ?? null, synthesisUsageSource: synthesis.usageSource, status: "completed", updatedAt: new Date() }).where(and(eq(deliberationSessions.id, sessionId), eq(deliberationSessions.userId, userId)));
}
