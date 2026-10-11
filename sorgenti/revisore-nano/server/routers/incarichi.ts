import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getIncarichiByCliente,
  getIncarichiByUser,
  getIncaricoById,
  createIncarico,
  updateIncarico,
  getClienteById,
  getIncaricoByClienteAnno,
  deleteIncarico,
  incaricoHaDatiOperativi,
} from "../db";

export const incarichiRouter = router({
  listByCliente: protectedProcedure
    .input(z.object({ clienteId: z.number() }))
    .query(async ({ input }) => {
      return getIncarichiByCliente(input.clienteId);
    }),

  listAll: protectedProcedure.query(async ({ ctx }) => {
    return getIncarichiByUser(ctx.user.id);
  }),

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const incarico = await getIncaricoById(input.id);
      if (!incarico) return null;
      const cliente = await getClienteById(incarico.clienteId);
      return { ...incarico, cliente };
    }),

  create: protectedProcedure
    .input(
      z.object({
        clienteId: z.number(),
        annoEsercizio: z.number().min(2000).max(2100),
        tipoIncarico: z
          .enum(["revisione_legale", "revisione_volontaria", "continuazione"])
          .optional(),
        note: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await getIncaricoByClienteAnno(input.clienteId, input.annoEsercizio);
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Esiste già un incarico per l'esercizio ${input.annoEsercizio}. Apri il fascicolo esistente.`,
        });
      }
      return createIncarico({ ...input, userId: ctx.user.id });
    }),

  deleteEmpty: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const incarico = await getIncaricoById(input.id);
      if (!incarico || incarico.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Incarico non trovato" });
      }
      const moduliAvviati = [incarico.statoModulo1, incarico.statoModulo2, incarico.statoModulo3, incarico.statoModulo4, incarico.statoModulo5].some(value => (value ?? 0) > 0);
      const nonVuoto = incarico.stato !== "bozza" || Boolean(incarico.nextcloudFolder) || moduliAvviati || await incaricoHaDatiOperativi(input.id);
      if (nonVuoto) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "L'incarico contiene già dati o attività e non può essere eliminato." });
      }
      await deleteIncarico(input.id);
      return { deleted: true, id: input.id };
    }),

  updateStato: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        stato: z.enum(["bozza", "in_corso", "completato", "archiviato"]).optional(),
        statoModulo1: z.number().min(0).max(2).optional(),
        statoModulo2: z.number().min(0).max(2).optional(),
        statoModulo3: z.number().min(0).max(2).optional(),
        statoModulo4: z.number().min(0).max(2).optional(),
        statoModulo5: z.number().min(0).max(2).optional(),
        note: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await updateIncarico(id, data);
      return getIncaricoById(id);
    }),
});
