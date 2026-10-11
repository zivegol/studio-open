import path from "node:path";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getIncaricoById, updateIncarico } from "../db";
import { analyzeRevisionFolderLocally, downloadNextcloudFile, listNextcloudFiles } from "../nextcloud";
import { runStandardReconciliation } from "../standardAuditEngine";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const analysisCache = new Map<string, { at: number; value: any }>();
const reconciliationCache = new Map<string, { at: number; value: any }>();
const analysisInFlight = new Map<string, Promise<any>>();
const cacheKey = (folder: string, year: number) => `${folder}::${year}`;
const validCache = <T>(entry?: { at: number; value: T }) => entry && Date.now() - entry.at < CACHE_TTL_MS ? entry.value : null;

async function cachedAnalysis(folder: string, year: number, force = false) {
  const key = cacheKey(folder, year);
  const running = analysisInFlight.get(key);
  if (running) return running;
  if (!force) {
    const cached = validCache(analysisCache.get(key));
    if (cached) return cached;
  }
  const task = analyzeRevisionFolderLocally(folder, year).then(value => {
    analysisCache.set(key, { at: Date.now(), value });
    if (force) reconciliationCache.delete(key);
    return value;
  }).finally(() => analysisInFlight.delete(key));
  analysisInFlight.set(key, task);
  return task;
}

type SuggestedType =
  | "bilancio_revisione" | "bilancio_storico" | "bilancio_analitico"
  | "nota_integrativa" | "verbale_assemblea" | "contratto"
  | "estratto_conto" | "libro_mastro" | "partitario" | "altro";

function classifyFile(name: string, incaricoYear: number): { tipo: SuggestedType; confidence: number; year: number | null } {
  const value = name.toLocaleLowerCase("it-IT");
  const yearMatch = value.match(/(?:19|20)\d{2}/g);
  const year = yearMatch?.length ? Number(yearMatch[yearMatch.length - 1]) : null;
  if (/xbrl|bilancio.?cee/.test(value)) return { tipo: year && year !== incaricoYear ? "bilancio_storico" : "bilancio_revisione", confidence: 0.94, year };
  if (/nota.?integrativa/.test(value)) return { tipo: "nota_integrativa", confidence: 0.98, year };
  if (/bilancio.?di.?verifica|situazione.?contabile|bilancio.?analitico/.test(value)) return { tipo: "bilancio_analitico", confidence: 0.91, year };
  if (/partitari?|clienti|fornitori/.test(value)) return { tipo: "partitario", confidence: 0.82, year };
  if (/estratt[oi].?conto|movimenti?.?banc|conto.?corrente/.test(value)) return { tipo: "estratto_conto", confidence: 0.88, year };
  if (/libro.?giornale|mastr[oi]/.test(value)) return { tipo: "libro_mastro", confidence: 0.88, year };
  if (/verbale|assemblea|cda|consiglio.?amministrazione/.test(value)) return { tipo: "verbale_assemblea", confidence: 0.88, year };
  if (/contratto|finanziamento|leasing|mutuo/.test(value)) return { tipo: "contratto", confidence: 0.8, year };
  return { tipo: "altro", confidence: 0.35, year };
}

async function ownedIncarico(id: number, userId: number) {
  const incarico = await getIncaricoById(id);
  if (!incarico || incarico.userId !== userId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Incarico non trovato" });
  }
  return incarico;
}

export const dossierSourceRouter = router({
  status: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .query(async ({ input, ctx }) => {
      const incarico = await ownedIncarico(input.incaricoId, ctx.user.id);
      return { folder: incarico.nextcloudFolder ?? null };
    }),

  connect: protectedProcedure
    .input(z.object({
      incaricoId: z.number(),
      folder: z.string().trim().min(1).max(1000),
    }))
    .mutation(async ({ input, ctx }) => {
      await ownedIncarico(input.incaricoId, ctx.user.id);
      const normalized = input.folder.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
      if (normalized.split("/").some(part => part === "..")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Percorso cartella non valido" });
      }
      // Verifica subito accesso e correttezza della cartella.
      const files = await listNextcloudFiles(normalized, 1);
      await updateIncarico(input.incaricoId, { nextcloudFolder: normalized });
      analysisCache.delete(cacheKey(normalized, (await getIncaricoById(input.incaricoId))!.annoEsercizio));
      reconciliationCache.delete(cacheKey(normalized, (await getIncaricoById(input.incaricoId))!.annoEsercizio));
      return { folder: normalized, accessible: true, hasFiles: files.length > 0 };
    }),

  scan: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .query(async ({ input, ctx }) => {
      const incarico = await ownedIncarico(input.incaricoId, ctx.user.id);
      if (!incarico.nextcloudFolder) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Collega prima la cartella Revisioni" });
      }
      const files = await listNextcloudFiles(incarico.nextcloudFolder);
      return {
        folder: incarico.nextcloudFolder,
        total: files.length,
        files: files.map(file => ({
          ...file,
          extension: path.extname(file.name).slice(1).toLowerCase(),
          suggestion: classifyFile(file.name, incarico.annoEsercizio),
        })),
      };
    }),

  analysis: protectedProcedure
    .input(z.object({ incaricoId: z.number(), force: z.boolean().optional() }))
    .query(async ({ input, ctx }) => {
      const incarico = await ownedIncarico(input.incaricoId, ctx.user.id);
      if (!incarico.nextcloudFolder) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Collega prima la cartella Revisioni" });
      }
      const result = await cachedAnalysis(incarico.nextcloudFolder, incarico.annoEsercizio, input.force);
      return {
        folder: result.folder,
        profile: result.profile,
        auditPackage: result.auditPackage,
        standardPackage: result.standardPackage,
        parser: result.parser,
      };
    }),

  reconciliation: protectedProcedure
    .input(z.object({ incaricoId: z.number(), force: z.boolean().optional() }))
    .query(async ({ input, ctx }) => {
      const incarico = await ownedIncarico(input.incaricoId, ctx.user.id);
      if (!incarico.nextcloudFolder) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Collega prima la cartella Revisioni" });
      }
      const key = cacheKey(incarico.nextcloudFolder, incarico.annoEsercizio);
      if (!input.force) {
        const cached = validCache(reconciliationCache.get(key));
        if (cached) return cached;
      }
      const analysis = await cachedAnalysis(incarico.nextcloudFolder, incarico.annoEsercizio, input.force);
      if (!analysis.standardPackage?.documents) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Pacchetto documentale standard non disponibile" });
      }
      const result = await runStandardReconciliation({
        engagementYear: incarico.annoEsercizio,
        documents: analysis.standardPackage.documents,
        download: sourcePath => downloadNextcloudFile(
          sourcePath.startsWith("Revisioni/") ? sourcePath : `Revisioni/${sourcePath}`
        ),
      });
      reconciliationCache.set(key, { at: Date.now(), value: result });
      return result;
    }),
});
