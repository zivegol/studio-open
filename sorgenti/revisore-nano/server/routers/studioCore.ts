import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  clienti,
  documenti,
  incarichi,
  studioEvidence,
  studioJobs,
  studioResults,
} from "../../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

export const studioCoreRouter = router({
  dossierManifest: protectedProcedure
    .input(z.object({ incaricoId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database non disponibile" });
      const rows = await db
        .select({ incarico: incarichi, cliente: clienti })
        .from(incarichi)
        .innerJoin(clienti, eq(clienti.id, incarichi.clienteId))
        .where(and(eq(incarichi.id, input.incaricoId), eq(incarichi.userId, ctx.user.id)))
        .limit(1);
      const row = rows[0];
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Incarico non trovato" });

      const [sources, jobs, evidence, results] = await Promise.all([
        db.select({
          sourceId: documenti.studioSourceId,
          fileName: documenti.nomeFile,
          mimeType: documenti.tipoFile,
          documentType: documenti.tipoDocumento,
          contentHash: documenti.contentHash,
          etag: documenti.sourceEtag,
          classification: documenti.classification,
          parsingState: documenti.statoParsing,
          updatedAt: documenti.updatedAt,
        }).from(documenti).where(eq(documenti.incaricoId, input.incaricoId)),
        db.select().from(studioJobs).where(eq(studioJobs.incaricoId, input.incaricoId)),
        db.select({ evidenceId: studioEvidence.evidenceId, jobId: studioEvidence.jobId, documentoId: studioEvidence.documentoId, kind: studioEvidence.kind, confidence: studioEvidence.confidence, status: studioEvidence.status, createdAt: studioEvidence.createdAt })
          .from(studioEvidence).where(eq(studioEvidence.incaricoId, input.incaricoId)),
        db.select({ resultId: studioResults.resultId, jobId: studioResults.jobId, resultType: studioResults.resultType, status: studioResults.status, provenance: studioResults.provenance, createdAt: studioResults.createdAt, updatedAt: studioResults.updatedAt })
          .from(studioResults).where(eq(studioResults.incaricoId, input.incaricoId)),
      ]);

      return {
        schemaVersion: "1.0.0" as const,
        appId: "revisore-studio" as const,
        client: {
          clientId: row.cliente.studioClientId,
          displayName: row.cliente.ragioneSociale,
        },
        dossier: {
          dossierId: row.incarico.studioDossierId,
          legacyIncaricoId: row.incarico.id,
          year: row.incarico.annoEsercizio,
          status: row.incarico.stato,
          ownerUserId: row.incarico.userId,
        },
        sources,
        jobs,
        evidence,
        results,
      };
    }),
});
