import { Card, CardContent } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { PROVIDERS, type ProviderId } from "@shared/agents";
import { BarChart3, Loader2, Sparkles, UsersRound } from "lucide-react";

function score(value: number) {
  return new Intl.NumberFormat("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
}

function scoreOrNone(value: number | null | undefined) {
  return typeof value === "number" ? `${score(value)}/10` : "—";
}

const criteria = [
  { key: "reasoningScore" as const, label: "Ragionamento", color: "bg-sky-500" },
  { key: "evidenceScore" as const, label: "Evidenze", color: "bg-violet-500" },
  { key: "utilityScore" as const, label: "Utilità", color: "bg-emerald-500" },
  { key: "roleFitScore" as const, label: "Aderenza al ruolo", color: "bg-rose-400" },
];

const JUNIOR_STATISTICS_AGENTS: Record<string, { label: string; avatar: string; accent: string }> = {
  junior_analyst: { label: "Junior analista", avatar: "A", accent: "bg-sky-100 text-sky-900" },
  junior_critic: { label: "Junior critico", avatar: "C", accent: "bg-rose-100 text-rose-900" },
  junior_researcher: { label: "Junior ricercatore", avatar: "R", accent: "bg-violet-100 text-violet-900" },
};

export default function Statistics() {
  const statistics = trpc.agora.peerStatistics.useQuery(undefined, { staleTime: 30_000 });

  return <div className="relative mx-auto w-full max-w-5xl pb-12">
    <div className="pointer-events-none absolute -left-8 top-0 h-48 w-48 rounded-full bg-sky-200/50 blur-3xl" />
    <div className="pointer-events-none absolute right-0 top-20 h-40 w-40 rounded-full bg-rose-200/50 blur-3xl" />

    <section className="relative overflow-hidden rounded-[1.8rem] bg-slate-950 px-5 py-7 text-white shadow-[0_24px_60px_-32px_rgba(20,28,41,0.75)] sm:px-8 sm:py-9">
      <div className="agora-dot-grid absolute inset-0 opacity-30" />
      <div className="relative max-w-3xl">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.16em] text-white"><BarChart3 className="h-3.5 w-3.5" />Valutazioni tra pari</div>
        <h1 className="text-3xl font-black leading-[0.98] tracking-[-0.065em] sm:text-5xl">Un ranking che<br />spiega se stesso.</h1>
        <p className="mt-4 max-w-xl text-sm leading-6 text-slate-300">Ogni agente valuta gli altri da 1 a 10 su ragionamento, evidenze, utilità e coerenza con il ruolo. Quando il dossier viene approfondito, i senior valutano anche i tre contributi junior.</p>
      </div>
    </section>

    {statistics.isLoading ? <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-slate-400" /></div> : !statistics.data?.length ? <Card className="relative mt-5 rounded-[1.6rem] border-slate-100 bg-white/80 shadow-[0_16px_45px_-32px_rgba(20,28,41,0.30)]"><CardContent className="flex flex-col items-center px-6 py-12 text-center"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-50 text-sky-900"><UsersRound className="h-6 w-6" /></div><h2 className="mt-4 text-xl font-black tracking-[-0.04em] text-slate-950">Nessun voto aggregato, per ora.</h2><p className="mt-2 max-w-md text-sm leading-6 text-slate-600">Le sessioni precedenti non hanno restituito tutti i voti obbligatori. Alla prossima replica valida, qui appariranno medie, trend e il dettaglio fra pari junior e senior. Il ranking non usa dati simulati.</p></CardContent></Card> : <section className="relative mt-5">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2"><div><p className="text-xs font-extrabold uppercase tracking-[0.18em] text-slate-500">Classifica contestuale</p><h2 className="mt-1 text-xl font-black tracking-[-0.05em] text-slate-950">Medie aggregate su 10.</h2></div><p className="max-w-md text-xs leading-5 text-slate-500">La media senior, quando disponibile, guida l’ordinamento; il campione dei pari junior resta sempre separato e visibile.</p></div>
      <div className="grid gap-3 md:grid-cols-2">{statistics.data.map((item, index) => {
        const agent = PROVIDERS[item.provider as ProviderId] ?? JUNIOR_STATISTICS_AGENTS[item.provider];
        const mainScore = item.seniorOverallScore ?? item.overallScore;
        return <Card key={item.provider} className="overflow-hidden rounded-[1.45rem] border-black/5 bg-white/85 shadow-[0_13px_35px_-27px_rgba(20,28,41,0.34)]"><CardContent className="p-5">
          <div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><div className={`flex h-11 w-11 items-center justify-center rounded-2xl text-sm font-extrabold ${agent?.accent ?? "bg-slate-100"}`}>{agent?.avatar ?? "?"}</div><div><p className="text-base font-extrabold tracking-tight text-slate-950">{agent?.label ?? item.provider}</p><p className="text-xs text-slate-500">{item.sampleSize} valutazioni ricevute</p></div></div><div className="text-right"><p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-slate-500">#{index + 1}</p><p className="mt-0.5 text-2xl font-black tracking-[-0.06em] text-slate-950">{score(mainScore)}<span className="ml-0.5 text-sm text-slate-400">/10</span></p></div></div>
          <div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-xl bg-violet-50 px-3 py-2"><p className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-violet-800">Giudizio senior</p><p className="mt-1 text-sm font-black text-slate-950">{scoreOrNone(item.seniorOverallScore)}</p><p className="mt-0.5 text-[10px] font-bold text-violet-700">{item.seniorSampleSize} voti</p></div><div className="rounded-xl bg-sky-50 px-3 py-2"><p className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-sky-800">Pari junior</p><p className="mt-1 text-sm font-black text-slate-950">{scoreOrNone(item.juniorOverallScore)}</p><p className="mt-0.5 text-[10px] font-bold text-sky-700">{item.juniorSampleSize} voti</p></div></div>
          <div className="mt-5 grid gap-2">{criteria.map(criterion => <div key={criterion.key}><div className="mb-1 flex items-center justify-between text-[11px] font-bold text-slate-600"><span>{criterion.label}</span><span>{score(item[criterion.key])}/10</span></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${criterion.color}`} style={{ width: `${Math.min(100, item[criterion.key] * 10)}%` }} /></div></div>)}</div>
          {item.history.length > 0 && <div className="mt-5 border-t border-slate-100 pt-3"><div className="mb-2 flex items-center justify-between"><p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-slate-500">Trend ultime sessioni</p><p className="text-[10px] font-bold text-slate-400">{item.history.length} punti</p></div><div className="flex h-9 items-end gap-1">{item.history.map(point => <div key={point.sessionId} title={`${score(point.score)}/10`} className="min-w-0 flex-1 rounded-t-sm bg-sky-300/80" style={{ height: `${Math.max(12, point.score * 10)}%` }} />)}</div></div>}
        </CardContent></Card>;
      })}</div>
      <div className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-100 bg-amber-50/75 px-4 py-3 text-xs leading-5 text-amber-950"><Sparkles className="mt-0.5 h-4 w-4 shrink-0" /><p><strong>Interpretazione:</strong> un giudizio senior misura la qualità del contributo preliminare secondo il consiglio approfondito; non certifica una verità assoluta né sostituisce il giudizio umano.</p></div>
    </section>}
  </div>;
}
