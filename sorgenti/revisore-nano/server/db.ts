import { eq, desc, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser, users,
  clienti, InsertCliente,
  incarichi, InsertIncarico,
  documenti, InsertDocumento,
  moduloAccettazione, InsertModuloAccettazione,
  moduloComprensione, InsertModuloComprensione,
  moduloRischio, InsertModuloRischio,
  moduloMaterialita, InsertModuloMaterialita,
  moduloPiano, InsertModuloPiano,
  alerts, InsertAlert,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

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

// ─── USERS ────────────────────────────────────────────────────────────────────
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot upsert user: database not available"); return; }
  try {
    const values: InsertUser = { openId: user.openId };
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
    if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
    if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
    else if (user.openId === ENV.ownerOpenId) { values.role = "admin"; updateSet.role = "admin"; }
    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) { console.error("[Database] Failed to upsert user:", error); throw error; }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── CLIENTI ──────────────────────────────────────────────────────────────────
export async function getClientiByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(clienti).where(eq(clienti.userId, userId)).orderBy(desc(clienti.createdAt));
}

export async function getClienteById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(clienti).where(eq(clienti.id, id)).limit(1);
  return result[0];
}

export async function createCliente(data: InsertCliente) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(clienti).values({ ...data, studioClientId: data.studioClientId ?? randomUUID() });
  const result = await db.select().from(clienti).where(eq(clienti.ragioneSociale, data.ragioneSociale)).orderBy(desc(clienti.createdAt)).limit(1);
  return result[0];
}

export async function updateCliente(id: number, data: Partial<InsertCliente>) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(clienti).set(data).where(eq(clienti.id, id));
}

export async function deleteCliente(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(clienti).where(eq(clienti.id, id));
}

// ─── INCARICHI ────────────────────────────────────────────────────────────────
export async function getIncarichiByCliente(clienteId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(incarichi).where(eq(incarichi.clienteId, clienteId)).orderBy(desc(incarichi.annoEsercizio));
}

export async function getIncarichiByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(incarichi).where(eq(incarichi.userId, userId)).orderBy(desc(incarichi.createdAt));
}

export async function getIncaricoById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(incarichi).where(eq(incarichi.id, id)).limit(1);
  return result[0];
}

export async function getIncaricoByClienteAnno(clienteId: number, annoEsercizio: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(incarichi).where(and(
    eq(incarichi.clienteId, clienteId),
    eq(incarichi.annoEsercizio, annoEsercizio),
  )).orderBy(desc(incarichi.createdAt)).limit(1);
  return result[0];
}

export async function createIncarico(data: InsertIncarico) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(incarichi).values({ ...data, studioDossierId: data.studioDossierId ?? randomUUID() });
  const result = await db.select().from(incarichi).where(and(eq(incarichi.clienteId, data.clienteId), eq(incarichi.annoEsercizio, data.annoEsercizio))).orderBy(desc(incarichi.createdAt)).limit(1);
  return result[0];
}

export async function updateIncarico(id: number, data: Partial<InsertIncarico>) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(incarichi).set(data).where(eq(incarichi.id, id));
}

export async function deleteIncarico(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(incarichi).where(eq(incarichi.id, id));
}

export async function incaricoHaDatiOperativi(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const tables = [documenti, moduloAccettazione, moduloComprensione, moduloRischio, moduloMaterialita, moduloPiano, alerts] as const;
  const checks = await Promise.all(tables.map(table => db.select({ id: table.id }).from(table as any).where(eq((table as any).incaricoId, id)).limit(1)));
  return checks.some(rows => rows.length > 0);
}

// ─── DOCUMENTI ────────────────────────────────────────────────────────────────
export async function getDocumentiByIncarico(incaricoId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(documenti).where(eq(documenti.incaricoId, incaricoId)).orderBy(desc(documenti.createdAt));
}

export async function getDocumentoById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(documenti).where(eq(documenti.id, id)).limit(1);
  return result[0];
}

export async function createDocumento(data: InsertDocumento) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(documenti).values({ ...data, studioSourceId: data.studioSourceId ?? randomUUID(), classification: data.classification ?? "restricted" });
  const result = await db.select().from(documenti).where(eq(documenti.s3Key, data.s3Key)).limit(1);
  return result[0];
}

export async function updateDocumento(id: number, data: Partial<InsertDocumento>) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(documenti).set(data).where(eq(documenti.id, id));
}

export async function deleteDocumento(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(documenti).where(eq(documenti.id, id));
}

// ─── MODULO ACCETTAZIONE ──────────────────────────────────────────────────────
export async function getModuloAccettazione(incaricoId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(moduloAccettazione).where(eq(moduloAccettazione.incaricoId, incaricoId)).limit(1);
  return result[0];
}

export async function upsertModuloAccettazione(data: InsertModuloAccettazione) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const existing = await getModuloAccettazione(data.incaricoId);
  if (existing) {
    await db.update(moduloAccettazione).set(data).where(eq(moduloAccettazione.incaricoId, data.incaricoId));
  } else {
    await db.insert(moduloAccettazione).values(data);
  }
  return getModuloAccettazione(data.incaricoId);
}

// ─── MODULO COMPRENSIONE ──────────────────────────────────────────────────────
export async function getModuloComprensione(incaricoId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(moduloComprensione).where(eq(moduloComprensione.incaricoId, incaricoId)).limit(1);
  return result[0];
}

export async function upsertModuloComprensione(data: InsertModuloComprensione) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const existing = await getModuloComprensione(data.incaricoId);
  if (existing) {
    await db.update(moduloComprensione).set(data).where(eq(moduloComprensione.incaricoId, data.incaricoId));
  } else {
    await db.insert(moduloComprensione).values(data);
  }
  return getModuloComprensione(data.incaricoId);
}

// ─── MODULO RISCHIO ───────────────────────────────────────────────────────────
export async function getModuloRischio(incaricoId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(moduloRischio).where(eq(moduloRischio.incaricoId, incaricoId)).limit(1);
  return result[0];
}

export async function upsertModuloRischio(data: InsertModuloRischio) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const existing = await getModuloRischio(data.incaricoId);
  if (existing) {
    await db.update(moduloRischio).set(data).where(eq(moduloRischio.incaricoId, data.incaricoId));
  } else {
    await db.insert(moduloRischio).values(data);
  }
  return getModuloRischio(data.incaricoId);
}

// ─── MODULO MATERIALITÀ ───────────────────────────────────────────────────────
export async function getModuloMaterialita(incaricoId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(moduloMaterialita).where(eq(moduloMaterialita.incaricoId, incaricoId)).limit(1);
  return result[0];
}

export async function upsertModuloMaterialita(data: InsertModuloMaterialita) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const existing = await getModuloMaterialita(data.incaricoId);
  if (existing) {
    await db.update(moduloMaterialita).set(data).where(eq(moduloMaterialita.incaricoId, data.incaricoId));
  } else {
    await db.insert(moduloMaterialita).values(data);
  }
  return getModuloMaterialita(data.incaricoId);
}

// ─── MODULO PIANO ─────────────────────────────────────────────────────────────
export async function getModuloPiano(incaricoId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(moduloPiano).where(eq(moduloPiano.incaricoId, incaricoId)).limit(1);
  return result[0];
}

export async function upsertModuloPiano(data: InsertModuloPiano) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const existing = await getModuloPiano(data.incaricoId);
  if (existing) {
    await db.update(moduloPiano).set(data).where(eq(moduloPiano.incaricoId, data.incaricoId));
  } else {
    await db.insert(moduloPiano).values(data);
  }
  return getModuloPiano(data.incaricoId);
}

// ─── ALERTS ───────────────────────────────────────────────────────────────────
export async function getAlertsByIncarico(incaricoId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(alerts).where(eq(alerts.incaricoId, incaricoId)).orderBy(desc(alerts.createdAt));
}

export async function createAlert(data: InsertAlert) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(alerts).values(data);
}

export async function markAlertRead(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(alerts).set({ letto: true }).where(eq(alerts.id, id));
}

export async function getUnreadAlertsCount(incaricoId: number) {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.select().from(alerts).where(and(eq(alerts.incaricoId, incaricoId), eq(alerts.letto, false)));
  return result.length;
}
