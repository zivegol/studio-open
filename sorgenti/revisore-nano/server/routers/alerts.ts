import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getAlertsByIncarico, markAlertRead, getUnreadAlertsCount } from "../db";

export const alertsRouter = router({
  listByIncarico: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .query(async ({ input }) => {
      return getAlertsByIncarico(input.incaricoId);
    }),

  unreadCount: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .query(async ({ input }) => {
      const count = await getUnreadAlertsCount(input.incaricoId);
      return { count };
    }),

  markRead: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await markAlertRead(input.id);
      return { success: true };
    }),

  markAllRead: protectedProcedure
    .input(z.object({ incaricoId: z.number() }))
    .mutation(async ({ input }) => {
      const alerts = await getAlertsByIncarico(input.incaricoId);
      await Promise.all(alerts.filter(a => !a.letto).map(a => markAlertRead(a.id)));
      return { success: true };
    }),
});
