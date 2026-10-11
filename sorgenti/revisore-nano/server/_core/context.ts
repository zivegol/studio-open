// Sostituisce server/_core/context.ts
// Usa il nostro JWT locale invece di sdk.authenticateRequest di Manus

import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { verifyToken, COOKIE_NAME } from "./oauth";
import * as db from "../db";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    // Leggi il cookie di sessione
    const cookieHeader = opts.req.headers.cookie || "";
    const cookies: Record<string, string> = {};
    cookieHeader.split(";").forEach(pair => {
      const [k, ...v] = pair.trim().split("=");
      if (k) cookies[k.trim()] = decodeURIComponent(v.join("="));
    });

      const token = cookies[COOKIE_NAME];
      if (token) {
        const openId = await verifyToken(token);
        if (openId) {
          user = (await db.getUserByOpenId(openId)) ?? null;
          if (user) {
            // Aggiorna lastSignedIn
            await db.upsertUser({ openId, lastSignedIn: new Date() });
          }
        }
    }
  } catch (error) {
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
