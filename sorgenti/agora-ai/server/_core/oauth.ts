import { createHash, randomBytes } from "node:crypto";
import type { Express, Request } from "express";
import { createRemoteJWKSet, decodeJwt, jwtVerify, SignJWT } from "jose";
import { upsertOidcUser } from "../db";
import { createSessionToken } from "./auth";
import { getSessionCookieOptions } from "./cookies";
import { ENV } from "./env";

const FLOW_COOKIE = ENV.isProduction ? "__Host-agora_oidc_flow" : "agora_oidc_flow";
const SESSION_COOKIE = "app_session_id";
type Discovery = { authorization_endpoint: string; token_endpoint: string; jwks_uri: string; issuer: string };
let discoveryCache: Promise<Discovery> | undefined;

function secretKey() {
  if (ENV.cookieSecret.length < 32) throw new Error("SESSION_SECRET deve contenere almeno 32 caratteri.");
  return new TextEncoder().encode(ENV.cookieSecret);
}

async function discovery() {
  if (!ENV.oidcIssuerUrl) throw new Error("OIDC_ISSUER_URL non configurato.");
  const issuer = ENV.oidcIssuerUrl.endsWith("/") ? ENV.oidcIssuerUrl : `${ENV.oidcIssuerUrl}/`;
  discoveryCache ??= fetch(new URL(".well-known/openid-configuration", issuer)).then(async response => {
    if (!response.ok) throw new Error(`Discovery OIDC non disponibile (${response.status}).`);
    return response.json() as Promise<Discovery>;
  });
  return discoveryCache;
}

function base64url(bytes = 32) { return randomBytes(bytes).toString("base64url"); }
function challenge(verifier: string) { return createHash("sha256").update(verifier).digest("base64url"); }
function query(req: Request, name: string) { return typeof req.query[name] === "string" ? req.query[name] as string : ""; }
async function signFlow(value: { state: string; nonce: string; verifier: string }) {
  return new SignJWT(value).setProtectedHeader({ alg: "HS256" }).setIssuer("agora-ai").setAudience("oidc-flow").setIssuedAt().setExpirationTime("10m").sign(secretKey());
}

export function oauthStateRecoveryPath() { return "/?oauth_error=state_expired"; }
export function isOidcSubjectAllowed(subject: string, allowed = ENV.allowedOidcSubjects, production = ENV.isProduction) {
  if (production && allowed.length === 0) return false;
  return allowed.length === 0 || allowed.includes(subject);
}

export function registerOAuthRoutes(app: Express) {
  app.get("/api/oauth/login", async (_req, res) => {
    try {
      const metadata = await discovery();
      const state = base64url();
      const nonce = base64url();
      const verifier = base64url(48);
      res.cookie(FLOW_COOKIE, await signFlow({ state, nonce, verifier }), { httpOnly: true, secure: ENV.isProduction, sameSite: "lax", path: "/", maxAge: 10 * 60 * 1000 });
      const url = new URL(metadata.authorization_endpoint);
      url.searchParams.set("client_id", ENV.appId);
      url.searchParams.set("redirect_uri", ENV.oidcRedirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "openid profile email");
      url.searchParams.set("state", state);
      url.searchParams.set("nonce", nonce);
      url.searchParams.set("code_challenge", challenge(verifier));
      url.searchParams.set("code_challenge_method", "S256");
      res.redirect(302, url.toString());
    } catch { res.status(503).json({ error: "Login OIDC non disponibile." }); }
  });

  app.get("/api/oauth/callback", async (req, res) => {
    const flowToken = req.headers.cookie?.split(";").map(value => value.trim()).find(value => value.startsWith(`${FLOW_COOKIE}=`))?.slice(FLOW_COOKIE.length + 1);
    res.clearCookie(FLOW_COOKIE, { path: "/", secure: ENV.isProduction, sameSite: "lax" });
    try {
      if (!flowToken || !query(req, "code") || !query(req, "state")) return res.redirect(302, oauthStateRecoveryPath());
      const { payload: flow } = await jwtVerify(decodeURIComponent(flowToken), secretKey(), { issuer: "agora-ai", audience: "oidc-flow", algorithms: ["HS256"] });
      if (typeof flow.state !== "string" || flow.state !== query(req, "state") || typeof flow.nonce !== "string" || typeof flow.verifier !== "string") return res.redirect(302, oauthStateRecoveryPath());
      const metadata = await discovery();
      const body = new URLSearchParams({ grant_type: "authorization_code", code: query(req, "code"), redirect_uri: ENV.oidcRedirectUri, client_id: ENV.appId, code_verifier: flow.verifier });
      if (ENV.oidcClientSecret) body.set("client_secret", ENV.oidcClientSecret);
      const tokenResponse = await fetch(metadata.token_endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
      if (!tokenResponse.ok) throw new Error("token_exchange_failed");
      const tokens = await tokenResponse.json() as { id_token?: string };
      if (!tokens.id_token) throw new Error("missing_id_token");
      const unverified = decodeJwt(tokens.id_token);
      if (typeof unverified.iss !== "string" || unverified.iss !== metadata.issuer) throw new Error("issuer_mismatch");
      const { payload } = await jwtVerify(tokens.id_token, createRemoteJWKSet(new URL(metadata.jwks_uri)), { issuer: metadata.issuer, audience: ENV.appId });
      if (payload.nonce !== flow.nonce || typeof payload.sub !== "string") throw new Error("nonce_or_subject_invalid");
      if (!isOidcSubjectAllowed(payload.sub)) return res.status(403).send("Account non autorizzato per Agorà.");
      const user = await upsertOidcUser({ issuer: metadata.issuer, subject: payload.sub, email: typeof payload.email === "string" ? payload.email : null, name: typeof payload.name === "string" ? payload.name : null, isOwner: payload.sub === ENV.ownerOidcSubject });
      if (!user) throw new Error("user_not_created");
      res.cookie(SESSION_COOKIE, await createSessionToken({ userId: user.id, issuer: metadata.issuer, subject: payload.sub }), { ...getSessionCookieOptions(req), maxAge: 12 * 60 * 60 * 1000 });
      res.redirect(302, "/");
    } catch { res.redirect(302, oauthStateRecoveryPath()); }
  });
}
