import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { PROVIDERS, type ProviderId } from "@shared/agents";
import { ArrowUpRight, Clock3, History as HistoryIcon, Loader2, Sparkles } from "lucide-react";

const statusStyle = { draft: "bg-slate-100 text-slate-600", running: "bg-amber-100 text-amber-800", completed: "bg-emerald-100 text-emerald-800", failed: "bg-rose-100 text-rose-800" } as const;

function formatUsd(value: number | null) {
  if (value === null) return "tariffa mancante";
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "USD", minimumFractionDigits: value < 0.01 ? 4 : 2, maximumFractionDigits: 4 }).format(value);
}

function chargeText(value: number | null, unit: string | null) {
  if (value === null || !unit) return null;
  if (unit === "openrouter_credits") return `OpenRouter: ${value.toFixed(6)} crediti`;
  if (unit === "manus_credits") return `Manus: ${value} crediti`;
  return `${value} ${unit}`;
}

export default function History() {
  const sessions = trpc.agora.listSessions.useQuery();
  return (
    <div className="relative mx-auto w-full max-w-5xl pb-12">
      <div className="pointer-events-none absolute -left-12 top-12 h-48 w-48 rounded-full bg-sky-200/55 blur-3xl" />
      <div className="relative mb-8"><p className="mb-2 text-xs font-extrabold uppercase tracking-[0.2em] text-slate-500">Archivio</p><h1 className="text-3xl font-black tracking-[-0.06em] text-slate-950 sm:text-4xl">Le discussioni non si perdono.</h1><p className="mt-3 max-w-xl text-sm leading-6 text-slate-600">Riapri prompt, contributi, token e addebiti effettivi del tuo consiglio quando vuoi.</p></div>
      {sessions.isLoading ? <div className="flex min-h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div> : sessions.data?.length ? <div className="grid gap-3">{sessions.data.map(session => {
        const isFinal = session.status === "completed" && session.actualTokens !== null;
        const tokens = isFinal ? session.actualTokens : session.estimatedTokens;
        const manualEstimate = isFinal ? session.actualCostUsd : session.estimatedCostUsd;
        const providerCharges = [session.openrouterCredits !== null ? `OpenRouter: ${session.openrouterCredits.toFixed(6)} crediti` : null, session.manusCredits !== null ? `Manus: ${session.manusCredits} crediti` : null].filter(Boolean);
        const phaseLabel = session.mode === "economic" ? "Fase junior · dossier preliminare" : session.parentSessionId ? "Fase senior · basata sul dossier junior" : "Fase senior · analisi diretta";
        return <Card key={session.id} className="rounded-[1.35rem] border-black/5 bg-white/80 shadow-[0_12px_35px_-25px_rgba(20,28,41,0.30)]"><CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="mb-2 flex flex-wrap items-center gap-2"><Badge className={`rounded-full border-0 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.12em] ${statusStyle[session.status]}`}>{session.status === "completed" ? "Verdetto pronto" : session.status}</Badge><Badge className={`rounded-full border-0 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.12em] ${session.mode === "economic" ? "bg-sky-100 text-sky-800" : "bg-violet-100 text-violet-800"}`}>{phaseLabel}</Badge><span className="flex items-center gap-1 text-xs text-slate-500"><Clock3 className="h-3.5 w-3.5" />{new Date(session.createdAt).toLocaleString("it-IT", { dateStyle: "medium", timeStyle: "short" })}</span></div><h2 className="truncate text-base font-extrabold tracking-tight text-slate-950">{session.title}</h2><p className="mt-1.5 text-xs font-bold text-slate-500">{isFinal ? "Token consuntivati" : "Token preventivati"}: {tokens?.toLocaleString("it-IT") ?? "—"}</p><p className="mt-1 text-xs text-slate-500">Stima tariffaria USD: {session.costComplete ? formatUsd(manualEstimate) : "tariffe manuali incomplete"}</p><p className="mt-1 text-xs font-bold text-slate-700">Addebiti provider: {providerCharges.length ? providerCharges.join(" · ") : "non disponibili per questa fase"}</p>{session.runs.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{session.runs.map(run => { const tokenCount = (run.initialInputTokens ?? 0) + (run.initialOutputTokens ?? 0) + (run.reviewInputTokens ?? 0) + (run.reviewOutputTokens ?? 0); const manualCost = (run.initialCostUsd ?? 0) + (run.reviewCostUsd ?? 0); const hasManualCost = typeof run.initialCostUsd === "number" || typeof run.reviewCostUsd === "number"; const name = PROVIDERS[run.provider as ProviderId]?.label ?? (run.provider === "junior_analyst" ? "Junior analista" : run.provider === "junior_critic" ? "Junior critico" : run.provider === "junior_researcher" ? "Junior ricercatore" : run.provider); const charges = [chargeText(run.initialProviderCharge, run.initialProviderChargeUnit), chargeText(run.reviewProviderCharge, run.reviewProviderChargeUnit)].filter(Boolean); return <span key={run.provider} className="rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600">{name}: {tokenCount.toLocaleString("it-IT")} token · {charges.length ? charges.join(" + ") : hasManualCost ? `stima ${formatUsd(manualCost)}` : "addebito n/d"}</span>})}</div>}{session.finalSynthesis && <p className="mt-1.5 line-clamp-2 max-w-2xl text-sm text-slate-600">{session.finalSynthesis}</p>}</div><Button asChild variant="outline" className="shrink-0 rounded-xl border-slate-200 bg-white text-xs font-bold hover:bg-slate-50"><a href={`/?session=${session.id}`}>Apri <ArrowUpRight className="ml-1.5 h-4 w-4" /></a></Button></CardContent></Card>;
      })}</div> : <Card className="rounded-[1.5rem] border-dashed border-slate-300 bg-white/55"><CardContent className="flex min-h-64 flex-col items-center justify-center p-8 text-center"><div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-100 text-sky-800"><HistoryIcon className="h-5 w-5" /></div><h2 className="font-extrabold tracking-tight">Nessuna discussione archiviata.</h2><p className="mt-2 max-w-sm text-sm text-slate-600">Avvia il primo confronto e qui troverai tutte le sintesi future.</p><Button asChild className="mt-5 rounded-xl bg-slate-950 text-xs font-bold"><a href="/"><Sparkles className="mr-1.5 h-4 w-4" />Avvia un confronto</a></Button></CardContent></Card>}
    </div>
  );
}
