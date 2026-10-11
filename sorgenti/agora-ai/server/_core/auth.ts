import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../../drizzle/schema";
import { getUserById } from "../db";
import { ENV } from "./env";

export type SessionClaims = { userId: number; issuer: string; subject: string };

function sessionKey() {
  if (ENV.cookieSecret.length < 32) throw new Error("SESSION_SECRET deve contenere almeno 32 caratteri.");
  return new TextEncoder().encode(ENV.cookieSecret);
}

export async function createSessionToken(claims: SessionClaims) {
  return new SignJWT({ uid: claims.userId, oidc_iss: claims.issuer, oidc_sub: claims.subject })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" }).setIssuer("agora-ai").setAudience("agora-web")
    .setIssuedAt().setExpirationTime("12h").sign(sessionKey());
}

export async function authenticateRequest(req: Request): Promise<User | null> {
  const raw = req.headers.cookie?.split(";").map(value => value.trim()).find(value => value.startsWith("app_session_id="))?.slice("app_session_id=".length);
  if (!raw) return null;
  try {
    const { payload } = await jwtVerify(decodeURIComponent(raw), sessionKey(), { algorithms: ["HS256"], issuer: "agora-ai", audience: "agora-web" });
    if (!Number.isInteger(payload.uid) || Number(payload.uid) <= 0) return null;
    return (await getUserById(Number(payload.uid))) ?? null;
  } catch { return null; }
}
