// Sostituisce server/_core/oauth.ts
import express from "express";
import type { Express, Request, Response, NextFunction } from "express";
import * as db from "../db";
import { SignJWT, jwtVerify } from "jose";
import { ENV } from "./env";

const COOKIE_NAME = "revisore_session";
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

const LOCAL_USERS: Record<string, string> = {
  admin: process.env.ADMIN_PASSWORD || "",
};

async function createToken(userId: string): Promise<string> {
  const secret = new TextEncoder().encode(ENV.cookieSecret);
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1y")
    .sign(secret);
}

async function verifyToken(token: string): Promise<string | null> {
  try {
    const secret = new TextEncoder().encode(ENV.cookieSecret);
    const { payload } = await jwtVerify(token, secret);
    return (payload.sub as string) || null;
  } catch {
    return null;
  }
}

export function registerOAuthRoutes(app: Express) {
  if (!process.env.ADMIN_PASSWORD || ENV.cookieSecret.length < 32) {
    throw new Error("Set ADMIN_PASSWORD and JWT_SECRET (at least 32 characters) before starting the server.");
  }
  // Parsing cookie manuale
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const cookieHeader = req.headers.cookie || "";
    const cookies: Record<string, string> = {};
    cookieHeader.split(";").forEach(pair => {
      const [k, ...v] = pair.trim().split("=");
      if (k) cookies[k.trim()] = decodeURIComponent(v.join("="));
    });
    (req as Request & { cookies: Record<string, string> }).cookies = cookies;
    next();
  });

  // Login page
  app.get("/login", (_req: Request, res: Response) => {
    res.send(`<!DOCTYPE html>
<html lang="it">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Revisore Nano — Accesso</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#f4f4f9;display:flex;align-items:center;justify-content:center;min-height:100vh}
  .box{background:#fff;border-radius:8px;padding:2.5rem;width:360px;box-shadow:0 4px 16px rgba(0,0,0,.1)}
  h1{font-size:20px;color:#1e3a5f;margin-bottom:.5rem}
  p{font-size:13px;color:#6b6860;margin-bottom:1.5rem}
  label{display:block;font-size:12px;color:#6b6860;margin-bottom:4px}
  input{width:100%;padding:8px 12px;border:1px solid #ddd;border-radius:4px;font-size:14px;margin-bottom:1rem}
  button{width:100%;padding:10px;background:#1e3a5f;color:#fff;border:none;border-radius:4px;font-size:14px;cursor:pointer}
  .err{color:#8a0000;font-size:12px;margin-bottom:.75rem}
</style>
</head>
<body>
<div class="box">
  <h1>Revisore Legale</h1>
  <p>Nano Imprese — Accesso riservato</p>
  ${`<form method="POST" action="/api/auth/login">
    <label>Utente</label>
    <input type="text" name="username" value="admin" required>
    <label>Password</label>
    <input type="password" name="password" required autofocus>
    <button type="submit">Accedi</button>
  </form>`}
</div>
</body></html>`);
  });

  // Login POST
  app.post("/api/auth/login",
    express.urlencoded({ extended: false }),
    async (req: Request, res: Response) => {
      const { username, password } = req.body as { username: string; password: string };
      const expected = LOCAL_USERS[username];
      if (!expected || expected !== password) {
        res.status(401).send("Credenziali non valide. <a href='/login'>Riprova</a>");
        return;
      }
      const openId = `local:${username}`;
      await db.upsertUser({
        openId,
        name: username,
        email: null,
        loginMethod: "local",
        lastSignedIn: new Date(),
      });
      const token = await createToken(openId);
      res.setHeader("Set-Cookie",
        `${COOKIE_NAME}=${token}; HttpOnly; Secure; Max-Age=${ONE_YEAR_MS / 1000}; SameSite=Lax; Path=/`
      );
      res.redirect("/");
    }
  );

  // Logout
  app.get("/api/auth/logout", (_req: Request, res: Response) => {
    res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; Max-Age=0; Path=/`);
    res.redirect("/login");
  });

  // Middleware verifica sessione su tutte le route
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    const publicPaths = ["/login", "/api/auth/login", "/api/auth/logout", "/favicon.ico", "/assets"];
    if (publicPaths.some(p => req.path.startsWith(p))) { next(); return; }
    const cookies = (req as Request & { cookies: Record<string, string> }).cookies || {};
    const token = cookies[COOKIE_NAME];
    if (!token) { res.redirect("/login"); return; }
    const userId = await verifyToken(token);
    if (!userId) { res.redirect("/login"); return; }
    (req as Request & { userId: string }).userId = userId;
    next();
  });
}

export { verifyToken, COOKIE_NAME };
