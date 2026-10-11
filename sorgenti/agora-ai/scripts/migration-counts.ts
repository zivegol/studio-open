import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";

const tables = ["users", "external_identities", "deliberation_sessions", "agent_runs", "agent_peer_evaluations", "session_attachments", "api_credentials"] as const;
const db = await getDb();
if (!db) throw new Error("DATABASE_URL non configurato.");

const counts: Record<string, number> = {};
for (const table of tables) {
  const result = await db.execute(sql.raw(`SELECT COUNT(*) AS count FROM \`${table}\``));
  const rows = result[0] as Array<{ count: number | string }>;
  counts[table] = Number(rows[0]?.count ?? 0);
}
process.stdout.write(`${JSON.stringify(counts, null, 2)}\n`);
