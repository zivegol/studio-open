export const ENV = {
  appId: process.env.OIDC_CLIENT_ID ?? "",
  cookieSecret: process.env.SESSION_SECRET ?? process.env.JWT_SECRET ?? (process.env.NODE_ENV === "test" ? "agora-test-session-secret-at-least-32-chars" : ""),
  databaseUrl: process.env.DATABASE_URL ?? "",
  publicAppUrl: process.env.PUBLIC_APP_URL ?? "",
  oidcIssuerUrl: process.env.OIDC_ISSUER_URL ?? "",
  oidcClientSecret: process.env.OIDC_CLIENT_SECRET ?? "",
  oidcRedirectUri: process.env.OIDC_REDIRECT_URI ?? "",
  ownerOidcSubject: process.env.OWNER_OIDC_SUBJECT ?? "",
  allowedOidcSubjects: (process.env.OIDC_ALLOWED_SUBJECTS ?? "").split(",").map(value => value.trim()).filter(Boolean),
  llmApiUrl: process.env.OPENAI_API_BASE ?? "https://api.openai.com",
  llmApiKey: process.env.OPENAI_API_KEY ?? "",
  isProduction: process.env.NODE_ENV === "production",
};

export function validateProductionEnv() {
  if (!ENV.isProduction) return;
  const required = ["DATABASE_URL", "PUBLIC_APP_URL", "SESSION_SECRET", "AGORA_ENCRYPTION_KEY", "OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "OIDC_REDIRECT_URI", "S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY"];
  const missing = required.filter(name => !process.env[name]);
  if (missing.length) throw new Error(`Configurazione server incompleta: ${missing.join(", ")}`);
  if (ENV.cookieSecret.length < 32) throw new Error("SESSION_SECRET deve contenere almeno 32 caratteri.");
  if (ENV.allowedOidcSubjects.length === 0) throw new Error("OIDC_ALLOWED_SUBJECTS è obbligatoria in produzione.");
  const publicUrl = new URL(ENV.publicAppUrl);
  if (publicUrl.protocol !== "https:") throw new Error("PUBLIC_APP_URL deve usare HTTPS in produzione.");
  if (new URL(ENV.oidcRedirectUri).origin !== publicUrl.origin) throw new Error("OIDC_REDIRECT_URI deve appartenere a PUBLIC_APP_URL.");
}
