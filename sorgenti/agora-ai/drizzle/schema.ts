import { double, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  hardBudgetUsd: double("hard_budget_usd"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const externalIdentities = mysqlTable("external_identities", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  issuer: varchar("issuer", { length: 512 }).notNull(),
  subject: varchar("subject", { length: 255 }).notNull(),
  emailAtLogin: varchar("email_at_login", { length: 320 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
}, table => ({
  issuerSubjectUnique: uniqueIndex("external_identities_issuer_subject_unique").on(table.issuer, table.subject),
}));

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const apiCredentials = mysqlTable("api_credentials", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  provider: varchar("provider", { length: 32 }).notNull(),
  secretCiphertext: text("secret_ciphertext").notNull(),
  model: varchar("model", { length: 128 }),
  apiChannel: varchar("api_channel", { length: 32 }).notNull().default("direct"),
  inputCostPerMillion: double("input_cost_per_million"),
  outputCostPerMillion: double("output_cost_per_million"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, table => ({
  userProviderUnique: uniqueIndex("api_credentials_user_provider_unique").on(table.userId, table.provider),
}));

export const agentRoles = mysqlTable("agent_roles", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  provider: varchar("provider", { length: 32 }).notNull(),
  role: text("role").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, table => ({
  userProviderUnique: uniqueIndex("agent_roles_user_provider_unique").on(table.userId, table.provider),
}));

export const agentModelPreferences = mysqlTable("agent_model_preferences", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  provider: varchar("provider", { length: 32 }).notNull(),
  model: varchar("model", { length: 128 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, table => ({
  userProviderUnique: uniqueIndex("agent_model_preferences_user_provider_unique").on(table.userId, table.provider),
}));

export const deliberationSessions = mysqlTable("deliberation_sessions", {
  id: varchar("id", { length: 21 }).primaryKey(),
  userId: int("user_id").notNull(),
  title: varchar("title", { length: 180 }).notNull(),
  prompt: text("prompt").notNull(),
  mode: mysqlEnum("mode", ["economic", "deep"]).default("deep").notNull(),
  parentSessionId: varchar("parent_session_id", { length: 21 }),
  juniorDossier: text("junior_dossier"),
  status: mysqlEnum("status", ["draft", "running", "completed", "failed"]).default("draft").notNull(),
  finalSynthesis: text("final_synthesis"),
  estimatedTokens: int("estimated_tokens"),
  estimatedCostUsd: double("estimated_cost_usd"),
  actualTokens: int("actual_tokens"),
  actualCostUsd: double("actual_cost_usd"),
  costComplete: int("cost_complete").default(0).notNull(),
  openrouterCredits: double("openrouter_credits"),
  manusCredits: double("manus_credits"),
  synthesisInputTokens: int("synthesis_input_tokens"),
  synthesisOutputTokens: int("synthesis_output_tokens"),
  synthesisCostUsd: double("synthesis_cost_usd"),
  synthesisProviderCharge: double("synthesis_provider_charge"),
  synthesisProviderChargeUnit: varchar("synthesis_provider_charge_unit", { length: 32 }),
  synthesisUsageSource: varchar("synthesis_usage_source", { length: 16 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, table => ({
  userCreatedIndex: uniqueIndex("deliberation_sessions_user_id_unique").on(table.userId, table.id),
}));

export const sessionShares = mysqlTable("session_shares", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: varchar("session_id", { length: 21 }).notNull(),
  granteeUserId: int("grantee_user_id").notNull(),
  permission: mysqlEnum("permission", ["view", "comment"]).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  revokedAt: timestamp("revoked_at"),
}, table => ({
  sessionGranteeUnique: uniqueIndex("session_shares_session_grantee_unique").on(table.sessionId, table.granteeUserId),
}));

export const sessionAttachments = mysqlTable("session_attachments", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  sessionId: varchar("session_id", { length: 21 }),
  fileName: varchar("file_name", { length: 180 }).notNull(),
  mimeType: varchar("mime_type", { length: 160 }).notNull(),
  sizeBytes: int("size_bytes").notNull(),
  storageKey: varchar("storage_key", { length: 512 }).notNull(),
  storageUrl: varchar("storage_url", { length: 640 }).notNull(),
  textExcerpt: text("text_excerpt").notNull(),
  source: mysqlEnum("source", ["external", "nextcloud"]).default("external").notNull(),
  anonymizationStatus: mysqlEnum("anonymization_status", ["anonymized", "not_anonymized"]).default("not_anonymized").notNull(),
  aiDisclosureConfirmedAt: timestamp("ai_disclosure_confirmed_at"),
  sourceReference: varchar("source_reference", { length: 640 }),
  includeInContext: int("include_in_context").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, table => ({
  userSessionIndex: uniqueIndex("session_attachments_user_session_id_unique").on(table.userId, table.sessionId, table.id),
}));

export const agentRuns = mysqlTable("agent_runs", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: varchar("session_id", { length: 21 }).notNull(),
  userId: int("user_id").notNull(),
  provider: varchar("provider", { length: 32 }).notNull(),
  role: text("role").notNull(),
  tier: mysqlEnum("tier", ["junior", "senior"]).default("senior").notNull(),
  resolvedModel: varchar("resolved_model", { length: 128 }),
  fallbackModel: varchar("fallback_model", { length: 128 }),
  status: mysqlEnum("status", ["queued", "running", "completed", "failed", "skipped"]).default("queued").notNull(),
  response: text("response"),
  error: text("error"),
  initialInputTokens: int("initial_input_tokens"),
  initialOutputTokens: int("initial_output_tokens"),
  initialCostUsd: double("initial_cost_usd"),
  initialProviderCharge: double("initial_provider_charge"),
  initialProviderChargeUnit: varchar("initial_provider_charge_unit", { length: 32 }),
  initialUsageSource: varchar("initial_usage_source", { length: 16 }),
  reviewStatus: mysqlEnum("review_status", ["queued", "running", "completed", "partial", "failed", "skipped"]),
  reviewResponse: text("review_response"),
  reviewError: text("review_error"),
  reviewRepairAttempts: int("review_repair_attempts").default(0).notNull(),
  reviewInputTokens: int("review_input_tokens"),
  reviewOutputTokens: int("review_output_tokens"),
  reviewCostUsd: double("review_cost_usd"),
  reviewProviderCharge: double("review_provider_charge"),
  reviewProviderChargeUnit: varchar("review_provider_charge_unit", { length: 32 }),
  reviewUsageSource: varchar("review_usage_source", { length: 16 }),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, table => ({
  sessionProviderUnique: uniqueIndex("agent_runs_session_provider_unique").on(table.sessionId, table.provider),
}));

export const agentPeerEvaluations = mysqlTable("agent_peer_evaluations", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: varchar("session_id", { length: 21 }).notNull(),
  userId: int("user_id").notNull(),
  evaluatorProvider: varchar("evaluator_provider", { length: 32 }).notNull(),
  evaluatorTier: mysqlEnum("evaluator_tier", ["junior", "senior", "unknown"]).default("unknown").notNull(),
  evaluationType: mysqlEnum("evaluation_type", ["peer", "cross_tier", "unknown"]).default("unknown").notNull(),
  subjectProvider: varchar("subject_provider", { length: 32 }).notNull(),
  reasoningScore: int("reasoning_score").notNull(),
  evidenceScore: int("evidence_score").notNull(),
  utilityScore: int("utility_score").notNull(),
  roleFitScore: int("role_fit_score").notNull(),
  overallScore: double("overall_score").notNull(),
  rationale: text("rationale"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, table => ({
  sessionEvaluatorSubjectUnique: uniqueIndex("agent_peer_evaluations_session_evaluator_subject_unique").on(table.sessionId, table.evaluatorProvider, table.subjectProvider),
  userSubjectIndex: uniqueIndex("agent_peer_evaluations_user_subject_session_unique").on(table.userId, table.subjectProvider, table.sessionId, table.evaluatorProvider),
}));
