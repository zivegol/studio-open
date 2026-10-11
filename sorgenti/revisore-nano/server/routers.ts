import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { clientiRouter } from "./routers/clienti";
import { incarichiRouter } from "./routers/incarichi";
import { documentiRouter } from "./routers/documenti";
import { moduliRouter } from "./routers/moduli";
import { alertsRouter } from "./routers/alerts";
import { esportazioneRouter } from "./routers/esportazione";
import { circolarizzazioneRouter } from "./routers/circolarizzazione";
import { verificaIncassiRouter } from "./routers/verificaIncassi";
import { strategiaRouter } from "./routers/strategia";
import { schedeControlloRouter } from "./routers/schedeControllo";
import { verificaRicaviCostiRouter } from "./routers/verificaRicaviCosti";
import { workflowRevisioneRouter } from "./routers/workflowRevisione";
import { wizardRouter } from "./routers/wizard";
import { studioCoreRouter } from "./routers/studioCore";
import { dossierSourceRouter } from "./routers/dossierSource";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  clienti: clientiRouter,
  incarichi: incarichiRouter,
  documenti: documentiRouter,
  moduli: moduliRouter,
  alerts: alertsRouter,
  esportazione: esportazioneRouter,
  circolarizzazione: circolarizzazioneRouter,
  verificaIncassi: verificaIncassiRouter,
  strategia: strategiaRouter,
  schedeControllo: schedeControlloRouter,
  verificaRicaviCosti: verificaRicaviCostiRouter,
  workflowRevisione: workflowRevisioneRouter,
  wizard: wizardRouter,
  studioCore: studioCoreRouter,
  dossierSource: dossierSourceRouter,
});

export type AppRouter = typeof appRouter;
