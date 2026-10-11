import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { AttachmentPicker } from "@/components/AttachmentPicker";
import { trpc } from "@/lib/trpc";
import { PROVIDERS, PROVIDER_IDS, type ProviderId } from "@shared/agents";
import { JUNIOR_PROVIDER_IDS, type JuniorProviderId } from "@shared/juniorPool";
import { AlertCircle, ArrowUpRight, Check, CircleDashed, Clock3, Coins, Loader2, MessageSquareText, Printer, Settings2, Sparkles, WandSparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import { toast } from "sonner";
import { Link } from "wouter";

function formatTokens(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("it-IT", { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

function formatUsd(value: number | null | undefined) {
  if (value === null || value === undefined) return "Tariffa mancante";
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "USD", minimumFractionDigits: value < 0.01 ? 4 : 2, maximumFractionDigits: 4 }).format(value);
}

function formatProviderCharge(value: number | null | undefined, unit: string | null | undefined) {
  if (value === null || value === undefined || !unit) return null;
  if (unit === "openrouter_credits") return `OpenRouter: ${value.toFixed(6)} crediti`;
  if (unit === "manus_credits") return `Manus: ${value} crediti`;
  return `${value} ${unit}`;
}

function reportAgentLabel(provider: string) {
  return PROVIDERS[provider as ProviderId]?.label ?? (provider === "junior_analyst" ? "Junior analista" : provider === "junior_critic" ? "Junior critico" : provider === "junior_researcher" ? "Junior ricercatore" : provider);
}

type JuniorPoolPreview = { provider: string; label: string; role: string; model: string };

export default function Home() {
  const utils = trpc.useUtils();
  const settings = trpc.agora.settings.useQuery(undefined, { staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: "always" });
  const openRouterCredit = trpc.agora.openRouterCredit.useQuery(undefined, { refetchInterval: 60_000 });
  const initialSession = new URLSearchParams(window.location.search).get("session");
  const [activeSession, setActiveSession] = useState<string | null>(initialSession);
  const [prompt, setPrompt] = useState("");
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<number[]>([]);
  const [deliberationMode, setDeliberationMode] = useState<"economic" | "deep">("deep");
  const [selectedProviders, setSelectedProviders] = useState<ProviderId[]>([]);
  const [selectionInitialized, setSelectionInitialized] = useState(false);
  const knownConfiguredProviders = useRef<ProviderId[]>([]);
  const [stage, setStage] = useState<"idle" | "initial" | "review" | "verdict">("idle");
  const isRunning = stage !== "idle";
  const createSession = trpc.agora.createSession.useMutation();
  const createJuniorSession = trpc.agora.createJuniorSession.useMutation();
  const escalateToSenior = trpc.agora.escalateToSenior.useMutation();
  const runAgent = trpc.agora.runAgent.useMutation();
  const reviewAgent = trpc.agora.reviewAgent.useMutation();
  const synthesize = trpc.agora.synthesize.useMutation();
  const sessionQuery = trpc.agora.getSession.useQuery({ sessionId: activeSession ?? "inactive" }, { enabled: Boolean(activeSession), refetchInterval: isRunning ? 1200 : false });
  const estimateMutation = trpc.agora.estimate.useMutation();
  const estimateJuniorMutation = trpc.agora.estimateJunior.useMutation();
  const roleSuggestionMutation = trpc.agora.suggestRoles.useMutation();
  const applySuggestedRoles = trpc.agora.applySuggestedRoles.useMutation();
  const [editableRoles, setEditableRoles] = useState<Record<ProviderId, string> | null>(null);
  const [rankingIgnored, setRankingIgnored] = useState(false);
  const [estimateKey, setEstimateKey] = useState<string | null>(null);
  const [roleSuggestionKey, setRoleSuggestionKey] = useState<string | null>(null);
  const [lastJuniorPool, setLastJuniorPool] = useState<JuniorPoolPreview[]>([]);
  const [juniorPoolError, setJuniorPoolError] = useState<string | null>(null);
  const estimateRequestId = useRef(0);
  const roleSuggestionRequestId = useRef(0);

  const agentByProvider = useMemo(() => new Map((settings.data ?? []).map(agent => [agent.provider, agent])), [settings.data]);
  const runByProvider = useMemo(() => new Map((sessionQuery.data?.runs ?? []).map(run => [run.provider, run])), [sessionQuery.data?.runs]);
  const peerEvaluations = sessionQuery.data?.evaluations ?? [];
  const settingsRecovering = settings.isLoading && !settings.data;
  const configuredCount = (settings.data ?? []).filter(agent => agent.configured).length;
  const selectedConfiguredAgents = (settings.data ?? []).filter(agent => agent.configured && selectedProviders.includes(agent.provider));
  const configuredProviderIds = useMemo(() => (settings.data ?? []).filter(agent => agent.configured).map(agent => agent.provider), [settings.data]);
  const currentEstimateKey = `${deliberationMode}::${prompt.trim()}::${selectedProviders.join(",")}::${selectedAttachmentIds.join(",")}`;
  const currentEstimate = deliberationMode === "economic" ? estimateJuniorMutation.data : estimateMutation.data;
  const hasCurrentEstimate = estimateKey === currentEstimateKey;
  const currentJuniorPool = deliberationMode === "economic" && hasCurrentEstimate && currentEstimate && "pool" in currentEstimate ? currentEstimate.pool : null;
  const visibleJuniorPool = currentJuniorPool ?? (deliberationMode === "economic" ? lastJuniorPool : null);
  const juniorPoolAwaitingFirstEstimate = deliberationMode === "economic" && prompt.trim().length >= 12 && !visibleJuniorPool?.length && (!hasCurrentEstimate || estimateJuniorMutation.isPending);
  const availableOpenRouterCredit = openRouterCredit.data?.keyLimitRemaining ?? openRouterCredit.data?.accountRemaining ?? null;
  const openRouterCreditLabel = openRouterCredit.data?.keyLimitRemaining !== null && openRouterCredit.data?.keyLimitRemaining !== undefined ? "Limite chiave" : "Credito account";

  useEffect(() => {
    if (!settings.data) return;
    setSelectedProviders(current => {
      if (!selectionInitialized) return configuredProviderIds;
      const newlyConfigured = configuredProviderIds.filter(provider => !knownConfiguredProviders.current.includes(provider));
      return Array.from(new Set([...current.filter(provider => configuredProviderIds.includes(provider)), ...newlyConfigured]));
    });
    knownConfiguredProviders.current = configuredProviderIds;
    setSelectionInitialized(true);
  }, [configuredProviderIds, selectionInitialized, settings.data]);

  useEffect(() => {
    const value = prompt.trim();
    if (value.length < 12 || selectedProviders.length === 0) {
      setEstimateKey(null);
      if (value.length < 12) {
        setLastJuniorPool([]);
        setJuniorPoolError(null);
      }
      return;
    }
    const requestId = ++estimateRequestId.current;
    const requestKey = `${deliberationMode}::${value}::${selectedProviders.join(",")}::${selectedAttachmentIds.join(",")}`;
    const timer = window.setTimeout(() => {
      const mutation = deliberationMode === "economic" ? estimateJuniorMutation : estimateMutation;
      const input = deliberationMode === "economic" ? { prompt: value, attachmentIds: selectedAttachmentIds } : { prompt: value, providers: selectedProviders, attachmentIds: selectedAttachmentIds };
      mutation.mutate(input as never, {
        onSuccess: data => {
          if (estimateRequestId.current !== requestId) return;
          setEstimateKey(requestKey);
          if (deliberationMode === "economic" && data && typeof data === "object" && "pool" in data && Array.isArray(data.pool)) {
            setLastJuniorPool(data.pool as JuniorPoolPreview[]);
            setJuniorPoolError(null);
          }
        },
        onError: error => {
          if (estimateRequestId.current === requestId && deliberationMode === "economic") setJuniorPoolError(error instanceof Error ? error.message : "Impossibile aggiornare il pool preliminare.");
        },
      });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [deliberationMode, prompt, selectedProviders, selectedAttachmentIds, estimateJuniorMutation.mutate, estimateMutation.mutate]);

  useEffect(() => {
    const value = prompt.trim();
    if (value.length < 30) { setRoleSuggestionKey(null); return; }
    const requestId = ++roleSuggestionRequestId.current;
    const timer = window.setTimeout(() => roleSuggestionMutation.mutate({ prompt: value }, { onSuccess: () => { if (roleSuggestionRequestId.current === requestId) setRoleSuggestionKey(value); } }), 900);
    return () => window.clearTimeout(timer);
  }, [prompt, roleSuggestionMutation.mutate]);

  useEffect(() => {
    if (roleSuggestionMutation.data && roleSuggestionKey === prompt.trim()) {
      setEditableRoles(roleSuggestionMutation.data.roles);
      setRankingIgnored(false);
    }
  }, [prompt, roleSuggestionKey, roleSuggestionMutation.data]);

  function toggleProvider(provider: ProviderId) {
    setSelectedProviders(current => current.includes(provider) ? current.filter(item => item !== provider) : [...current, provider]);
  }

  async function applyRoles() {
    if (!roleSuggestionMutation.data || !editableRoles) return;
    try {
      await applySuggestedRoles.mutateAsync({ roles: editableRoles });
      await utils.agora.settings.invalidate();
      toast.success(`Ruoli applicati: ${roleSuggestionMutation.data.type}.`);
    } catch { toast.error("Impossibile applicare i ruoli suggeriti."); }
  }

  function ignoreRankingSignal() {
    const signal = roleSuggestionMutation.data?.rankingSignal;
    if (!signal) return;
    setEditableRoles(current => current ? { ...current, [signal.provider]: current[signal.provider].replace(" · guida per esperienza tra pari", "") } : current);
    setRankingIgnored(true);
    toast.message("Segnale ranking ignorato per questa proposta.");
  }

  async function startDeliberation() {
    if (prompt.trim().length < 12) return toast.error("Inserisci un tema di almeno 12 caratteri.");
    if (deliberationMode === "deep" && !selectedConfiguredAgents.length) return toast.error("Seleziona almeno un agente con una chiave API configurata.");
    if (deliberationMode === "economic" && !settings.data?.some(agent => agent.sharedOpenRouter)) return toast.error("Configura la chiave OpenRouter condivisa per usare la modalità economica.");
    try {
      let sessionId: string;
      let providersToRun: Array<ProviderId | JuniorProviderId>;
      let expectedCount: number;
      if (deliberationMode === "economic") {
        const session = await createJuniorSession.mutateAsync({ prompt: prompt.trim(), attachmentIds: selectedAttachmentIds });
        toast.message(`Coordinatore ${session.coordination.coordinatorModel}: ${session.coordination.teamReason}`);
        sessionId = session.id;
        providersToRun = session.pool.map(agent => agent.provider);
        expectedCount = providersToRun.length;
      } else {
        const session = await createSession.mutateAsync({ prompt: prompt.trim(), providers: selectedProviders, roles: roleSuggestionMutation.data && editableRoles ? editableRoles : undefined, attachmentIds: selectedAttachmentIds });
        sessionId = session.id;
        providersToRun = selectedProviders;
        expectedCount = selectedConfiguredAgents.length;
      }
      await utils.agora.settings.invalidate();
      await utils.agora.listAttachments.invalidate();
      setSelectedAttachmentIds([]);
      setActiveSession(sessionId);
      setStage("initial");
      await utils.agora.getSession.invalidate({ sessionId });
      await Promise.allSettled(providersToRun.map(provider => runAgent.mutateAsync({ sessionId, provider })));
      const afterInitial = await utils.agora.getSession.fetch({ sessionId });
      const completedProviders = afterInitial.runs.filter(run => run.status === "completed" && run.response).map(run => run.provider as ProviderId | JuniorProviderId);
      if (!completedProviders.length) {
        toast.error("Nessun agente ha potuto rispondere. Controlla credito, modello e messaggi nelle card prima di riprovare.");
        return;
      }
      const missingInitialCount = expectedCount - completedProviders.length;
      if (missingInitialCount > 0) toast.message(`${completedProviders.length} pareri disponibili su ${expectedCount}: il consiglio prosegue e il verdetto indicherà esplicitamente i contributi mancanti.`);
      setStage("review");
      await Promise.allSettled(completedProviders.map(provider => reviewAgent.mutateAsync({ sessionId, provider })));
      const afterReviews = await utils.agora.getSession.fetch({ sessionId });
      const reviewedRuns = afterReviews.runs.filter(run => completedProviders.includes(run.provider as ProviderId | JuniorProviderId));
      const unavailableReviews = reviewedRuns.filter(run => run.reviewStatus !== "completed" && !(deliberationMode === "economic" && run.reviewStatus === "partial"));
      if (unavailableReviews.length > 0) toast.message(`${reviewedRuns.length - unavailableReviews.length} repliche disponibili su ${reviewedRuns.length}: il verdetto verrà comunque generato e dichiarerà il limite.`);
      if (deliberationMode === "economic" && reviewedRuns.some(run => run.reviewStatus === "partial")) toast.message("Una valutazione junior è parziale: il dossier viene generato comunque e i voti validi ricevuti vengono conservati nelle statistiche.");
      setStage("verdict");
      let verdictReady = false;
      let partialVerdict = false;
      try { const result = await synthesize.mutateAsync({ sessionId }); verdictReady = true; partialVerdict = result.partial; } catch (error) { toast.error(error instanceof Error ? error.message : "Verdetto non disponibile."); }
      await Promise.all([utils.agora.getSession.invalidate({ sessionId }), utils.agora.listSessions.invalidate()]);
      if (verdictReady) toast.success(partialVerdict ? (deliberationMode === "economic" ? "Dossier parziale pronto: puoi valutare se coinvolgere i senior." : "Verdetto parziale pronto: indica esplicitamente il contributo assente.") : (deliberationMode === "economic" ? "Dossier junior pronto: puoi ora coinvolgere i senior." : "Il dibattito del consiglio è completo."));
      else toast.message("Dibattito parziale salvato: consulta le card degli agenti che non hanno completato.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Non è stato possibile avviare il dibattito.");
    } finally { setStage("idle"); }
  }

  async function involveSenior() {
    if (!activeSession) return;
    if (!selectedConfiguredAgents.length) return toast.error("Seleziona almeno un senior configurato prima dell’escalation.");
    try {
      const session = await escalateToSenior.mutateAsync({ juniorSessionId: activeSession, providers: selectedProviders, roles: roleSuggestionMutation.data && editableRoles ? editableRoles : undefined });
      setActiveSession(session.id);
      setDeliberationMode("deep");
      setStage("initial");
      await utils.agora.getSession.invalidate({ sessionId: session.id });
      await Promise.allSettled(session.providers.map(provider => runAgent.mutateAsync({ sessionId: session.id, provider })));
      const afterInitial = await utils.agora.getSession.fetch({ sessionId: session.id });
      const completed = afterInitial.runs.filter(run => run.status === "completed" && run.response).map(run => run.provider as ProviderId);
      if (!completed.length) return toast.error("Nessun senior ha prodotto un parere utilizzabile.");
      if (completed.length !== session.providers.length) toast.message(`${completed.length} senior disponibili su ${session.providers.length}: il verdetto verrà comunque prodotto.`);
      setStage("review");
      await Promise.allSettled(completed.map(provider => reviewAgent.mutateAsync({ sessionId: session.id, provider })));
      setStage("verdict");
      await synthesize.mutateAsync({ sessionId: session.id });
      await Promise.all([utils.agora.getSession.invalidate({ sessionId: session.id }), utils.agora.listSessions.invalidate()]);
      toast.success("Il tavolo senior ha completato il verdetto sul dossier junior.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Non è stato possibile coinvolgere i senior.");
    } finally { setStage("idle"); }
  }

  async function completeActiveSession() {
    if (!activeSession || !sessionQuery.data) return;
    const completed = sessionQuery.data.runs.filter(run => run.status === "completed" && run.response).map(run => run.provider as ProviderId | JuniorProviderId);
    if (!completed.length) return toast.error("Non ci sono ancora pareri utilizzabili da sintetizzare.");
    try {
      setStage("review");
      const toReview = sessionQuery.data.runs.filter(run => completed.includes(run.provider as ProviderId | JuniorProviderId) && run.reviewStatus !== "completed").map(run => run.provider as ProviderId | JuniorProviderId);
      await Promise.allSettled(toReview.map(provider => reviewAgent.mutateAsync({ sessionId: activeSession, provider })));
      setStage("verdict");
      await synthesize.mutateAsync({ sessionId: activeSession });
      await Promise.all([utils.agora.getSession.invalidate({ sessionId: activeSession }), utils.agora.listSessions.invalidate(), utils.agora.peerStatistics.invalidate()]);
      toast.success(`Sintesi completata con ${completed.length} pareri disponibili.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Non è stato possibile completare la sintesi.");
    } finally { setStage("idle"); }
  }

  const status = (provider: ProviderId) => runByProvider.get(provider)?.status ?? (activeSession ? "not_selected" : (selectedProviders.includes(provider) && agentByProvider.get(provider)?.configured ? "queued" : "not_selected"));
  const statusLabel: Record<string, string> = { queued: "In attesa", running: "Analisi iniziale", completed: "Posizione pronta", failed: "Da rivedere", skipped: "Non configurato", not_selected: "Non incluso" };
  const statusColor: Record<string, string> = { queued: "bg-slate-200", running: "animate-pulse bg-amber-400", completed: "bg-emerald-500", failed: "bg-rose-500", skipped: "bg-slate-300", not_selected: "bg-slate-200" };
  const stageLabel = stage === "idle" ? "Pronta" : { initial: "Turno 1: posizioni iniziali", review: "Turno 2: repliche incrociate", verdict: "Verdetto comune" }[stage];

  return <div className="relative mx-auto w-full max-w-5xl pb-12">
    {sessionQuery.data && <><div className="print-report hidden" aria-hidden="true"><header><p className="print-kicker">Agorà AI - verbale della consultazione</p><h1>{sessionQuery.data.session.title}</h1><p className="print-meta">Generato il {new Date().toLocaleString("it-IT")} · Sessione {sessionQuery.data.session.id}</p></header><section><h2>Domanda sottoposta al consiglio</h2><div className="print-prose"><Streamdown>{sessionQuery.data.parentSession?.prompt ?? sessionQuery.data.session.prompt}</Streamdown></div></section>{sessionQuery.data.parentRuns.length > 0 && <section><h2>Pareri completi del pool junior</h2>{sessionQuery.data.parentRuns.map(run => <article key={`print-parent-${run.id}`}><h3>{reportAgentLabel(run.provider)}</h3><p className="print-role">{run.role} · {run.resolvedModel}</p>{run.response && <div className="print-prose"><Streamdown>{run.response}</Streamdown></div>}{run.reviewResponse && <div className="print-review"><h4>Replica</h4><Streamdown>{run.reviewResponse}</Streamdown></div>}</article>)}</section>}<section><h2>{sessionQuery.data.session.mode === "economic" ? "Pareri completi del pool junior" : "Pareri completi del consiglio senior"}</h2>{sessionQuery.data.runs.map(run => <article key={`print-run-${run.id}`}><h3>{reportAgentLabel(run.provider)}</h3><p className="print-role">{run.role} · {run.resolvedModel}</p>{run.response ? <div className="print-prose"><Streamdown>{run.response}</Streamdown></div> : <p>Parere non disponibile: {run.error ?? run.status}.</p>}{run.reviewResponse && <div className="print-review"><h4>Replica al consiglio</h4><Streamdown>{run.reviewResponse}</Streamdown></div>}</article>)}</section>{sessionQuery.data.parentSession?.finalSynthesis && <section><h2>Sintesi junior</h2><div className="print-prose"><Streamdown>{sessionQuery.data.parentSession.finalSynthesis}</Streamdown></div></section>}{sessionQuery.data.session.finalSynthesis && <section className="print-synthesis"><h2>{sessionQuery.data.session.mode === "economic" ? "Sintesi del pool junior" : "Sintesi e parere condiviso"}</h2><div className="print-prose"><Streamdown>{sessionQuery.data.session.finalSynthesis}</Streamdown></div></section>}<footer>Agorà AI · Documento generato dalla sessione archiviata</footer></div></>}
    {activeSession && sessionQuery.data && !sessionQuery.data.session.finalSynthesis && sessionQuery.data.runs.some(run => run.status === "completed" && run.response) && <div className="relative z-10 mb-3 flex justify-end"><Button onClick={completeActiveSession} disabled={isRunning} className="rounded-xl bg-sky-900 px-4 text-xs font-extrabold hover:bg-sky-800">{isRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}Completa repliche e sintesi</Button></div>}
    {activeSession && sessionQuery.data && sessionQuery.data.runs.some(run => run.response) && <div className="relative z-10 mb-3 flex justify-end print:hidden"><Button type="button" variant="outline" onClick={() => window.print()} className="rounded-xl border-slate-300 bg-white px-4 text-xs font-extrabold"><Printer className="mr-2 h-4 w-4" />Stampa / salva PDF</Button></div>}
    <div className="pointer-events-none absolute -left-10 -top-16 h-56 w-56 rounded-full bg-sky-200/55 blur-3xl" /><div className="pointer-events-none absolute -right-8 top-16 h-48 w-48 rounded-full bg-rose-200/55 blur-3xl" />
    <section className="relative overflow-hidden rounded-[1.8rem] bg-slate-950 px-5 py-7 text-white shadow-[0_24px_60px_-32px_rgba(20,28,41,0.75)] sm:px-8 sm:py-9"><div className="agora-dot-grid absolute inset-0 opacity-30" /><div className="absolute -right-12 -top-12 h-48 w-48 rounded-full bg-sky-300/30" /><div className="absolute -bottom-16 right-20 h-40 w-40 rounded-full bg-rose-300/30" /><div className="relative max-w-3xl"><div className="mb-5 flex items-center justify-between gap-3"><Badge className="rounded-full border-0 bg-white/12 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.16em] text-white"><Sparkles className="mr-1.5 h-3.5 w-3.5" />Agorà AI</Badge><span className="rounded-full bg-white/10 px-3 py-1.5 text-[10px] font-bold text-white/75">{settingsRecovering ? "Recupero agenti…" : `${configuredCount}/6 connessi`}</span></div><h1 className="max-w-2xl text-3xl font-black leading-[0.98] tracking-[-0.065em] sm:text-5xl">Una domanda.<br />Un vero confronto.</h1><p className="mt-4 max-w-xl text-sm leading-6 text-slate-300">Sei agenti analizzano, leggono le altre posizioni e replicano sulle divergenze. Il verdetto finale rende espliciti accordi, rischi e prossimi passi.</p></div></section>

    <section className="relative mt-5 rounded-[1.65rem] border border-white/80 bg-white/78 p-4 shadow-[0_16px_45px_-32px_rgba(20,28,41,0.30)] backdrop-blur sm:p-5"><div className="mb-3 flex items-center justify-between gap-4"><div><p className="text-sm font-extrabold tracking-tight text-slate-950">Porta un tema al consiglio</p><p className="mt-0.5 text-xs text-slate-500">Problema, strategia, progetto o decisione.</p></div><span className="text-[11px] font-bold tabular-nums text-slate-400">{prompt.length}/12.000</span></div><Textarea value={prompt} onChange={event => setPrompt(event.target.value)} disabled={isRunning} maxLength={12000} placeholder="Es. Come dovremmo lanciare il nuovo servizio nei prossimi 90 giorni, con un budget limitato?" className="min-h-32 resize-none rounded-2xl border-slate-200 bg-slate-50/80 p-4 text-sm leading-6 text-slate-900 placeholder:text-slate-400 focus-visible:ring-slate-950" />
      <AttachmentPicker selectedIds={selectedAttachmentIds} onChange={setSelectedAttachmentIds} disabled={isRunning} />
      <div className="mt-3 rounded-2xl border border-sky-100 bg-sky-50/70 p-3"><div className="mb-2 flex items-center justify-between gap-3"><div><p className="text-[10px] font-extrabold uppercase tracking-[0.13em] text-sky-800">Profondità del confronto</p><p className="mt-0.5 text-[11px] leading-4 text-slate-600">Scegli se partire dal pool economico o dal consiglio completo.</p></div></div><div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => !isRunning && setDeliberationMode("economic")} className={`rounded-xl px-3 py-2.5 text-left text-xs font-extrabold transition ${deliberationMode === "economic" ? "bg-sky-900 text-white" : "bg-white text-slate-600 ring-1 ring-sky-100"}`}><span className="block">Economico</span><span className="mt-0.5 block text-[10px] font-medium opacity-75">3 junior, dossier preliminare</span></button><button type="button" onClick={() => !isRunning && setDeliberationMode("deep")} className={`rounded-xl px-3 py-2.5 text-left text-xs font-extrabold transition ${deliberationMode === "deep" ? "bg-slate-950 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}><span className="block">Approfondito</span><span className="mt-0.5 block text-[10px] font-medium opacity-75">6 senior, verdetto completo</span></button></div></div>
      <div className="mt-3 min-h-[152px] rounded-2xl bg-slate-100/85 p-3"><div className="mb-2 flex items-center justify-between"><p className="text-[10px] font-extrabold uppercase tracking-[0.13em] text-slate-500">{deliberationMode === "economic" ? "Pool preliminare" : "Agenti coinvolti"}</p><span className="text-[10px] font-bold text-slate-500">{deliberationMode === "economic" ? "3 junior" : settingsRecovering ? "recupero" : `${selectedConfiguredAgents.length} selezionati`}</span></div>{settingsRecovering && deliberationMode === "deep" ? <div className="flex flex-wrap gap-2" aria-label="Recupero delle configurazioni degli agenti">{Array.from({ length: 6 }, (_, index) => <div key={index} className="h-8 w-24 animate-pulse rounded-xl bg-white/80" />)}</div> : deliberationMode === "economic" ? <><div className="grid min-h-[100px] gap-2 sm:grid-cols-3">{visibleJuniorPool?.length ? visibleJuniorPool.map(agent => <div key={agent.provider} className="min-h-[100px] rounded-xl bg-white px-3 py-2"><p className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-sky-800">{agent.label}</p><p className="mt-0.5 text-xs font-bold text-slate-800">{agent.role}</p><p className="mt-1 truncate text-[10px] text-slate-500">{agent.model}</p></div>) : juniorPoolAwaitingFirstEstimate ? Array.from({ length: 3 }, (_, index) => <div key={index} className="min-h-[100px] animate-pulse rounded-xl bg-white/75 px-3 py-2"><div className="h-3 w-20 rounded bg-sky-100" /><div className="mt-3 h-3 w-28 rounded bg-slate-100" /><div className="mt-3 h-2.5 w-full rounded bg-slate-100" /></div>) : <p className="col-span-3 flex min-h-[100px] items-center text-xs leading-5 text-slate-500">Scrivi il tema per ricevere ruoli e modelli junior adattivi.</p>}</div>{visibleJuniorPool?.length && (estimateJuniorMutation.isPending || !hasCurrentEstimate) && <p className="mt-2 text-[10px] font-bold text-sky-800">Aggiornamento del pool in corso: le card restano visibili.</p>}{juniorPoolError && <p className="mt-2 rounded-lg bg-rose-50 px-2.5 py-2 text-[10px] font-bold leading-4 text-rose-800">{juniorPoolError}</p>}</> : <div className="flex flex-wrap gap-2">{(settings.data ?? []).map(agent => <button type="button" key={agent.provider} onClick={() => agent.configured && !isRunning && toggleProvider(agent.provider)} disabled={!agent.configured || isRunning} className={`rounded-xl px-3 py-2 text-xs font-extrabold transition ${selectedProviders.includes(agent.provider) && agent.configured ? "bg-slate-950 text-white" : "bg-white text-slate-400 ring-1 ring-slate-200"} disabled:cursor-not-allowed`}><span className="mr-1.5">{agent.avatar}</span>{agent.label}</button>)}</div>}</div>
      {roleSuggestionMutation.data && roleSuggestionKey === prompt.trim() && editableRoles && <div className="mt-3 rounded-2xl border border-rose-100 bg-rose-50/70 p-3"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-extrabold uppercase tracking-[0.13em] text-rose-800">Ruoli adattivi proposti</p><p className="mt-0.5 text-xs font-bold text-slate-800">Tema rilevato: {roleSuggestionMutation.data.type}</p><p className="mt-1 text-[11px] leading-4 text-slate-600">Modifica direttamente i ruoli: saranno usati dal dibattito appena avviato.</p></div><Button type="button" variant="outline" onClick={applyRoles} disabled={isRunning || applySuggestedRoles.isPending} className="h-9 shrink-0 rounded-xl border-rose-200 bg-white text-[11px] font-extrabold text-rose-900 hover:bg-rose-100">{applySuggestedRoles.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}Applica ora</Button></div><div className="mt-3 grid gap-2 sm:grid-cols-2">{selectedProviders.map(provider => <label key={provider} className="rounded-xl bg-white/90 px-2.5 py-2"><span className="mb-1 block text-[10px] font-extrabold uppercase tracking-[0.1em] text-slate-500">{PROVIDERS[provider].label}</span><input value={editableRoles[provider]} onChange={event => setEditableRoles(current => current ? { ...current, [provider]: event.target.value } : current)} disabled={isRunning} maxLength={180} className="w-full bg-transparent text-xs font-bold text-slate-800 outline-none placeholder:text-slate-400" /></label>)}</div></div>}
      {roleSuggestionMutation.data?.rankingSignal && !rankingIgnored && <div className="mt-3 flex flex-col gap-2 rounded-2xl border border-sky-100 bg-sky-50/75 p-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-[11px] leading-4 text-sky-950"><span className="font-extrabold">Segnale statistiche:</span> {PROVIDERS[roleSuggestionMutation.data.rankingSignal.provider].label} ha una media di {roleSuggestionMutation.data.rankingSignal.score.toFixed(1)}/10 su {roleSuggestionMutation.data.rankingSignal.sampleSize} valutazioni. La proposta resta modificabile.</p><Button type="button" variant="outline" size="sm" onClick={ignoreRankingSignal} className="h-8 shrink-0 rounded-lg border-sky-200 bg-white text-[10px] font-extrabold text-sky-900">Ignora ranking</Button></div>}
      {currentEstimate && estimateKey === currentEstimateKey && <div className="mt-3 overflow-hidden rounded-2xl bg-slate-950 text-white shadow-lg shadow-slate-950/15"><div className="grid gap-0 sm:grid-cols-[1.25fr_1fr]"><div className="border-b border-white/10 px-4 py-4 sm:border-b-0 sm:border-r"><p className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.14em] text-sky-300"><Coins className="h-3.5 w-3.5" />Preventivo totale · {deliberationMode === "economic" ? "junior" : "senior"}</p>{currentEstimate.estimatedCostUsd === null ? <p className="mt-1 text-2xl font-black tracking-[-0.05em]">Stima non disponibile</p> : <p className="mt-1 flex items-baseline gap-2 text-3xl font-black tracking-[-0.05em]">~{formatUsd(currentEstimate.estimatedCostUsd)}{!currentEstimate.costComplete && <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-amber-300">parziale</span>}</p>}<p className="mt-1 text-[11px] leading-4 text-slate-300">Tariffe live del catalogo OpenRouter; non è ancora un addebito reale.</p>{availableOpenRouterCredit !== null && <p className="mt-2 rounded-lg bg-white/10 px-2.5 py-2 text-[10px] font-bold text-sky-100">{openRouterCreditLabel}: {formatUsd(availableOpenRouterCredit)} · stima: {formatUsd(currentEstimate.estimatedCostUsd)}</p>}</div><div className="px-4 py-4"><p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-400">Volume previsto</p><p className="mt-1 text-xl font-extrabold">~{formatTokens(currentEstimate.estimatedTokens)} token</p><p className="mt-1 text-[11px] leading-4 text-slate-300">{currentEstimate.composition.agentCount} agenti · base {formatTokens(currentEstimate.composition.promptTokens)} token · fino a {currentEstimate.composition.reviewExcerptCharacters} caratteri per peer nella replica.</p></div></div></div>}
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="flex items-center gap-1.5 text-[11px] leading-4 text-slate-500"><WandSparkles className="h-3.5 w-3.5 shrink-0 text-sky-700" />{deliberationMode === "economic" ? "Budget economici: analisi, replica e dossier preliminare." : "Budget rigorosi: analisi, replica breve e verdetto comune."}</p><Button onClick={startDeliberation} disabled={settingsRecovering || isRunning || createSession.isPending || createJuniorSession.isPending} className="h-11 rounded-xl bg-slate-950 px-5 text-xs font-extrabold shadow-lg shadow-slate-950/15 hover:bg-slate-800">{settingsRecovering ? "Recupero…" : isRunning ? stageLabel : deliberationMode === "economic" ? "Avvia il pool junior" : "Avvia il dibattito"}{isRunning ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <ArrowUpRight className="ml-2 h-4 w-4" />}</Button></div></section>

    {!settingsRecovering && configuredCount < 6 && <Alert className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/80 text-amber-950"><AlertCircle className="h-4 w-4" /><AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-xs leading-5">{6 - configuredCount} {6 - configuredCount === 1 ? "agente non è ancora configurato" : "agenti non sono ancora configurati"}. Le rispettive card verranno saltate.<Button asChild variant="link" className="h-auto p-0 text-xs font-extrabold text-amber-900"><Link href="/settings">Apri impostazioni <ArrowUpRight className="ml-1 h-3.5 w-3.5" /></Link></Button></AlertDescription></Alert>}

    {activeSession && <section className="mt-5 overflow-hidden rounded-2xl border border-sky-100 bg-white text-slate-800 shadow-[0_14px_38px_-30px_rgba(20,70,120,0.35)]"><div className="grid sm:grid-cols-2"><div className="border-b border-sky-100 bg-sky-50/85 px-4 py-4 sm:border-b-0 sm:border-r"><p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-sky-900">Preventivo totale</p><p className="mt-1 text-3xl font-black tracking-[-0.05em] text-slate-950">{sessionQuery.data?.session.estimatedCostUsd !== null && sessionQuery.data?.session.estimatedCostUsd !== undefined ? formatUsd(sessionQuery.data.session.estimatedCostUsd) : "Tariffe mancanti"}</p><p className="mt-1 text-[11px] leading-4 text-slate-600">Stima iniziale derivata dalle tariffe manuali dei modelli.</p></div><div className="bg-emerald-50/75 px-4 py-4"><p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-emerald-900">Consuntivo totale</p><p className="mt-1 text-3xl font-black tracking-[-0.05em] text-slate-950">{sessionQuery.data?.session.finalSynthesis && sessionQuery.data.session.costComplete ? formatUsd(sessionQuery.data.session.actualCostUsd) : sessionQuery.data?.session.finalSynthesis ? "Parziale" : "In elaborazione"}</p><p className="mt-1 text-[11px] leading-4 text-slate-600">Costo calcolato a fine dibattito; “Parziale” segnala tariffe mancanti.</p></div></div><div className="grid gap-2 border-t border-slate-100 bg-slate-50/70 px-4 py-3 sm:grid-cols-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Token</p><p className="mt-0.5 text-sm font-extrabold">{formatTokens(sessionQuery.data?.session.actualTokens ?? sessionQuery.data?.session.estimatedTokens)}</p></div><div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Addebiti provider</p><p className="mt-0.5 text-sm font-extrabold">{[typeof sessionQuery.data?.session.openrouterCredits === "number" ? `OR ${sessionQuery.data.session.openrouterCredits.toFixed(6)}` : null, typeof sessionQuery.data?.session.manusCredits === "number" ? `M ${sessionQuery.data.session.manusCredits}` : null].filter(Boolean).join(" · ") || "non disponibili"}</p></div><div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Stato</p><p className="mt-0.5 text-sm font-extrabold">{isRunning ? stageLabel : sessionQuery.data?.session.finalSynthesis ? "Verdetto disponibile" : "Pronta"}</p></div></div></section>}

    <section className="mt-7"><div className="mb-3 flex items-end justify-between"><div><p className="text-xs font-extrabold uppercase tracking-[0.18em] text-slate-500">Il consiglio</p><h2 className="mt-1 text-xl font-black tracking-[-0.05em] text-slate-950">Posizioni, repliche, decisione.</h2></div>{activeSession && <span className="flex items-center gap-1.5 text-xs text-slate-500"><Clock3 className="h-3.5 w-3.5" />{isRunning ? "Aggiornamento in tempo reale" : "Sessione salvata"}</span>}</div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{PROVIDER_IDS.map(provider => { const agent = agentByProvider.get(provider) ?? { ...PROVIDERS[provider], provider, role: PROVIDERS[provider].defaultRole, configured: false }; const run = runByProvider.get(provider); const agentStatus = status(provider); const receivedEvaluations = peerEvaluations.filter(evaluation => evaluation.subjectProvider === provider); const peerScore = receivedEvaluations.length ? receivedEvaluations.reduce((sum, evaluation) => sum + evaluation.overallScore, 0) / receivedEvaluations.length : null; const runTokens = (run?.initialInputTokens ?? 0) + (run?.initialOutputTokens ?? 0) + (run?.reviewInputTokens ?? 0) + (run?.reviewOutputTokens ?? 0); const hasManualCost = typeof run?.initialCostUsd === "number" || typeof run?.reviewCostUsd === "number"; const manualCost = (run?.initialCostUsd ?? 0) + (run?.reviewCostUsd ?? 0); const charges = [formatProviderCharge(run?.initialProviderCharge, run?.initialProviderChargeUnit), formatProviderCharge(run?.reviewProviderCharge, run?.reviewProviderChargeUnit)].filter(Boolean); return <Card key={provider} className="overflow-hidden rounded-[1.4rem] border-black/5 bg-white/82 shadow-[0_13px_35px_-27px_rgba(20,28,41,0.34)]"><CardContent className="p-4"><div className="flex items-start gap-3"><div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-sm font-extrabold ${agent.accent}`}>{agent.avatar}</div><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><h3 className="font-extrabold tracking-tight text-slate-950">{agent.label}</h3><span className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusColor[agentStatus]}`} /></div><p className="truncate text-xs text-slate-500">{agent.role}</p></div></div><div className="mt-4 border-t border-slate-100 pt-3"><p className="mb-2 flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.12em] text-slate-500">{agentStatus === "running" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : agentStatus === "completed" ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <CircleDashed className="h-3.5 w-3.5" />}{statusLabel[agentStatus]}</p>{run?.response ? <div className="max-h-56 overflow-y-auto pr-1 text-sm leading-6 text-slate-700"><Streamdown>{run.response}</Streamdown></div> : run?.error ? <p className="text-xs leading-5 text-rose-700">{run.error}</p> : <p className="text-xs leading-5 text-slate-500">{agentStatus === "skipped" ? "Aggiungi una chiave API nelle impostazioni per coinvolgere questo agente." : "Il contributo apparirà qui."}</p>}{run?.reviewResponse && <div className="mt-3 rounded-xl bg-rose-50 p-3"><p className="mb-1.5 text-[10px] font-extrabold uppercase tracking-[0.12em] text-rose-800">Replica al consiglio</p><div className="max-h-36 overflow-y-auto text-xs leading-5 text-slate-700"><Streamdown>{run.reviewResponse}</Streamdown></div></div>}{peerScore !== null && <p className="mt-3 rounded-lg bg-sky-50 px-2.5 py-2 text-[11px] font-extrabold text-sky-950">Valutazione tra pari: {peerScore.toFixed(1)}/10 · {receivedEvaluations.length} voti</p>}{run?.reviewError && run?.reviewResponse && <p className="mt-2 text-[10px] leading-4 text-amber-700">{run.reviewError}</p>}{run && (runTokens > 0 || run.initialUsageSource) && <p className="mt-3 text-[10px] font-bold text-slate-500">Token: {formatTokens(runTokens)} · {charges.length ? `addebito ${charges.join(" + ")}` : hasManualCost ? `stima tariffaria ${formatUsd(manualCost)}` : "addebito non disponibile"}</p>}</div></CardContent></Card>})}</div></section>

    {sessionQuery.data?.session.mode === "economic" && <section className="mt-7"><div className="mb-3"><p className="text-xs font-extrabold uppercase tracking-[0.18em] text-sky-700">Pool preliminare</p><h2 className="mt-1 text-xl font-black tracking-[-0.05em] text-slate-950">Analisi, replica, dossier.</h2></div><div className="grid gap-3 md:grid-cols-3">{(sessionQuery.data.runs ?? []).filter(run => run.tier === "junior").map(run => { const label = run.provider === "junior_analyst" ? "Junior analista" : run.provider === "junior_critic" ? "Junior critico" : "Junior ricercatore"; const total = (run.initialInputTokens ?? 0) + (run.initialOutputTokens ?? 0) + (run.reviewInputTokens ?? 0) + (run.reviewOutputTokens ?? 0); return <Card key={run.id} className="overflow-hidden rounded-[1.4rem] border-sky-100 bg-white/85 shadow-[0_13px_35px_-27px_rgba(20,28,41,0.34)]"><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-sky-700">{label}</p><h3 className="mt-1 text-sm font-extrabold text-slate-950">{run.role}</h3><p className="mt-1 truncate text-[10px] text-slate-500">{run.resolvedModel}</p></div><span className={`h-2.5 w-2.5 rounded-full ${statusColor[run.status] ?? "bg-slate-200"}`} /></div><div className="mt-3 border-t border-slate-100 pt-3">{run.response ? <div className="max-h-44 overflow-y-auto text-xs leading-5 text-slate-700"><Streamdown>{run.response}</Streamdown></div> : run.error ? <p className="text-xs leading-5 text-rose-700">{run.error}</p> : <p className="text-xs text-slate-500">Il contributo apparirà qui.</p>}{run.reviewResponse && <div className="mt-3 rounded-xl bg-sky-50 p-2.5"><p className="mb-1 text-[10px] font-extrabold uppercase tracking-[0.1em] text-sky-800">Replica</p><div className="max-h-28 overflow-y-auto text-[11px] leading-5 text-slate-700"><Streamdown>{run.reviewResponse}</Streamdown></div></div>}{total > 0 && <p className="mt-3 text-[10px] font-bold text-slate-500">{formatTokens(total)} token · {typeof run.initialCostUsd === "number" || typeof run.reviewCostUsd === "number" ? formatUsd((run.initialCostUsd ?? 0) + (run.reviewCostUsd ?? 0)) : "addebito da rilevare"}</p>}</div></CardContent></Card>; })}</div></section>}
    {sessionQuery.data?.parentSession && <section className="mt-6 rounded-[1.45rem] border border-sky-200 bg-sky-50/75 p-4"><div className="flex items-center justify-between gap-3"><p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-sky-800">Analisi collegata · junior → senior</p><span className="rounded-full bg-white px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.1em] text-sky-800">Dossier riusato</span></div><div className="mt-3 grid gap-2 sm:grid-cols-2"><div className="rounded-xl bg-white/90 p-3"><p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-sky-800">Fase junior</p><p className="mt-1 text-sm font-extrabold text-slate-950">Dossier economico</p><p className="mt-1 text-xs text-slate-600">{sessionQuery.data.parentSession.actualTokens ?? sessionQuery.data.parentSession.estimatedTokens ?? 0} token · {sessionQuery.data.parentSession.actualCostUsd ?? sessionQuery.data.parentSession.estimatedCostUsd !== null ? `stima ${formatUsd((sessionQuery.data.parentSession.actualCostUsd ?? sessionQuery.data.parentSession.estimatedCostUsd) ?? 0)}` : "addebito da rilevare"}</p></div><div className="rounded-xl bg-slate-950 p-3 text-white"><p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-sky-300">Fase senior</p><p className="mt-1 text-sm font-extrabold">Verdetto approfondito</p><p className="mt-1 text-xs text-slate-300">{sessionQuery.data.session.actualTokens ?? sessionQuery.data.session.estimatedTokens ?? 0} token · {sessionQuery.data.session.actualCostUsd ?? sessionQuery.data.session.estimatedCostUsd !== null ? `stima ${formatUsd((sessionQuery.data.session.actualCostUsd ?? sessionQuery.data.session.estimatedCostUsd) ?? 0)}` : "addebito da rilevare"}</p></div></div></section>}
    {sessionQuery.data?.childSession && sessionQuery.data.session.mode === "economic" && <section className="mt-6 rounded-[1.45rem] border border-violet-200 bg-violet-50/75 p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-violet-800">Escalation completata</p><p className="mt-1 text-sm font-extrabold text-slate-950">Il tavolo senior è collegato a questo dossier.</p></div><Link href={`/?session=${sessionQuery.data.childSession.id}`} className="rounded-xl bg-slate-950 px-3 py-2 text-[11px] font-extrabold text-white">Apri fase senior <ArrowUpRight className="ml-1 inline h-3.5 w-3.5" /></Link></div><div className="mt-3 grid gap-2 sm:grid-cols-2"><div className="rounded-xl bg-white/90 p-3"><p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-violet-800">Junior</p><p className="mt-1 text-xs text-slate-600">{sessionQuery.data.session.actualTokens ?? sessionQuery.data.session.estimatedTokens ?? 0} token · {sessionQuery.data.session.actualCostUsd ?? sessionQuery.data.session.estimatedCostUsd !== null ? `stima ${formatUsd((sessionQuery.data.session.actualCostUsd ?? sessionQuery.data.session.estimatedCostUsd) ?? 0)}` : "addebito da rilevare"}</p></div><div className="rounded-xl bg-slate-950 p-3 text-white"><p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-sky-300">Senior</p><p className="mt-1 text-xs text-slate-300">{sessionQuery.data.childSession.actualTokens ?? sessionQuery.data.childSession.estimatedTokens ?? 0} token · {sessionQuery.data.childSession.actualCostUsd ?? sessionQuery.data.childSession.estimatedCostUsd !== null ? `stima ${formatUsd((sessionQuery.data.childSession.actualCostUsd ?? sessionQuery.data.childSession.estimatedCostUsd) ?? 0)}` : "addebito in elaborazione"}</p></div></div></section>}
    {sessionQuery.data?.session.finalSynthesis && <section className="relative mt-6 overflow-hidden rounded-[1.65rem] border border-sky-100 bg-gradient-to-br from-sky-50 via-white to-rose-50 p-5 shadow-[0_18px_45px_-32px_rgba(20,28,41,0.35)] sm:p-7"><div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-sky-200/60" /><div className="relative"><div className="mb-3 flex items-center gap-2"><div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-950 text-white"><MessageSquareText className="h-4 w-4" /></div><div><p className="text-xs font-extrabold uppercase tracking-[0.16em] text-sky-900">{sessionQuery.data.session.mode === "economic" ? "Dossier preliminare" : "Verdetto comune"}</p><h2 className="text-lg font-black tracking-[-0.04em] text-slate-950">{sessionQuery.data.session.mode === "economic" ? "Prima lettura economica." : "Dalla discussione all’azione."}</h2></div></div><div className="prose prose-slate prose-sm max-w-none leading-7"><Streamdown>{sessionQuery.data.session.finalSynthesis}</Streamdown></div>{sessionQuery.data.session.mode === "economic" && <div className="mt-5 rounded-2xl border border-sky-200 bg-white/80 p-3"><p className="text-xs leading-5 text-slate-600">Vuoi approfondire? I senior riceveranno questo dossier come contesto e potranno confermare, contestare o completare l’analisi.</p><Button onClick={involveSenior} disabled={isRunning || escalateToSenior.isPending} className="mt-3 h-10 rounded-xl bg-slate-950 px-4 text-xs font-extrabold hover:bg-slate-800">{escalateToSenior.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}Coinvolgi i senior</Button></div>}</div></section>}
    <div className="mt-7 flex items-center justify-center gap-2 text-center text-[11px] leading-4 text-slate-500"><Settings2 className="h-3.5 w-3.5" />Gestisci chiavi, modelli, ruoli e tariffe da <Link href="/settings" className="font-bold text-slate-700 underline underline-offset-2">Impostazioni</Link>.</div>
  </div>;
}
