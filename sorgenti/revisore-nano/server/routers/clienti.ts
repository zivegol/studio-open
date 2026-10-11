import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  getClientiByUser,
  getClienteById,
  createCliente,
  updateCliente,
  deleteCliente,
  getIncarichiByCliente,
  createIncarico,
} from "../db";
import { analyzeRevisionFolderLocally, listNextcloudDirectory } from "../nextcloud";

const legalForms = ["srl", "srl_unipersonale", "snc", "sas", "spa", "ditta_individuale", "altro"] as const;

async function inspectClientFolder(folder: string) {
  const normalized = folder.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (normalized.split("/").some(part => part === "..")) throw new Error("Percorso cartella non valido");
  const analysis = await analyzeRevisionFolderLocally(normalized);
  const profile = analysis.profile ?? {};
  if (!profile.ragioneSociale) throw new Error("Non riesco a identificare con sicurezza la società dal documento");
  if (!legalForms.includes(profile.formaGiuridica)) profile.formaGiuridica = "altro";
  return { ...analysis, folder: normalized, profile };
}

export const clientiRouter = router({
  browseFolders: protectedProcedure
    .input(z.object({ folder: z.string().max(1000).default("Revisioni") }))
    .query(async ({ input }) => {
      const folder = input.folder.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "") || "Revisioni";
      const entries = await listNextcloudDirectory(folder);
      const parentParts = folder.split("/").filter(Boolean);
      parentParts.pop();
      return {
        folder,
        parent: parentParts.length ? parentParts.join("/") : null,
        folders: entries.filter(entry => entry.isFolder).map(entry => ({ path: entry.path, name: entry.name })),
      };
    }),

  analyzeFolder: protectedProcedure
    .input(z.object({ folder: z.string().trim().min(1).max(1000) }))
    .mutation(async ({ input }) => inspectClientFolder(input.folder)),

  createFromFolder: protectedProcedure
    .input(z.object({
      folder: z.string().trim().min(1).max(1000),
      annoEsercizio: z.number().min(2000).max(2100),
      tipoIncarico: z.enum(["revisione_legale", "revisione_volontaria", "continuazione"]).default("revisione_legale"),
    }))
    .mutation(async ({ ctx, input }) => {
      // Riesamina la fonte sul server: il client non può costruire autonomamente l'anagrafica.
      const analysis = await inspectClientFolder(input.folder);
      const p = analysis.profile;
      const cliente = await createCliente({
        userId: ctx.user.id,
        ragioneSociale: String(p.ragioneSociale),
        codiceFiscale: p.codiceFiscale ? String(p.codiceFiscale) : undefined,
        partitaIva: p.partitaIva ? String(p.partitaIva) : undefined,
        formaGiuridica: p.formaGiuridica,
        settore: p.settore ? String(p.settore) : undefined,
        comune: p.comune ? String(p.comune) : undefined,
        provincia: p.provincia ? String(p.provincia).slice(0, 2).toUpperCase() : undefined,
        nextcloudFolder: analysis.folder,
        note: `Anagrafica generata da ${analysis.identitySource}. Documenti rilevati: ${analysis.totalFiles}.`,
      });
      const incarico = await createIncarico({
        clienteId: cliente.id,
        userId: ctx.user.id,
        annoEsercizio: input.annoEsercizio,
        tipoIncarico: input.tipoIncarico,
        nextcloudFolder: analysis.folder,
      });
      return { cliente, incarico, analysis };
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    return getClientiByUser(ctx.user.id);
  }),

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return getClienteById(input.id);
    }),

  create: protectedProcedure
    .input(
      z.object({
        ragioneSociale: z.string().min(1),
        codiceFiscale: z.string().optional(),
        partitaIva: z.string().optional(),
        formaGiuridica: z
          .enum(["srl", "srl_unipersonale", "snc", "sas", "spa", "ditta_individuale", "altro"])
          .optional(),
        settore: z.string().optional(),
        comune: z.string().optional(),
        provincia: z.string().max(2).optional(),
        note: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return createCliente({ ...input, userId: ctx.user.id });
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        ragioneSociale: z.string().min(1).optional(),
        codiceFiscale: z.string().optional(),
        partitaIva: z.string().optional(),
        formaGiuridica: z
          .enum(["srl", "srl_unipersonale", "snc", "sas", "spa", "ditta_individuale", "altro"])
          .optional(),
        settore: z.string().optional(),
        comune: z.string().optional(),
        provincia: z.string().max(2).optional(),
        note: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await updateCliente(id, data);
      return getClienteById(id);
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const cliente = await getClienteById(input.id);
      if (!cliente || cliente.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Cliente non trovato" });
      }
      const incarichi = await getIncarichiByCliente(input.id);
      if (incarichi.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Impossibile eliminare il cliente: ci sono ${incarichi.length} incarico/i collegati. Elimina o archivia prima gli incarichi.`,
        });
      }
      await deleteCliente(input.id);
      return { success: true };
    }),
});
