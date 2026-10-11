export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  authMode:
    process.env.AUTH_MODE ??
    (process.env.OAUTH_SERVER_URL ? "oauth" : "local"),
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
  uploadsDir: process.env.UPLOADS_DIR ?? "/app/uploads",
  appBaseUrl: process.env.APP_BASE_URL ?? "",
  nextcloudUrl: process.env.NEXTCLOUD_URL ?? "",
  nextcloudInternalUrl: process.env.NEXTCLOUD_INTERNAL_URL ?? "",
  nextcloudUser: process.env.NEXTCLOUD_USER ?? "",
  nextcloudPass: process.env.NEXTCLOUD_PASS ?? "",
  nextcloudRootFolder:
    process.env.NEXTCLOUD_ROOT_FOLDER ?? "Revisore Nano",
};
