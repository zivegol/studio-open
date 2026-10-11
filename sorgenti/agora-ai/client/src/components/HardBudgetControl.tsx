import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export function HardBudgetControl() {
  const utils = trpc.useUtils();
  const budget = trpc.agora.hardBudget.useQuery();
  const save = trpc.agora.saveHardBudget.useMutation();
  const [value, setValue] = useState("");

  useEffect(() => {
    if (budget.data) setValue(budget.data.hardBudgetUsd?.toString() ?? "");
  }, [budget.data]);

  async function persist() {
    const normalized = value.trim() === "" ? null : Number(value.replace(",", "."));
    if (normalized !== null && (!Number.isFinite(normalized) || normalized <= 0)) return toast.error("Inserisci un importo positivo in USD oppure svuota il campo per disattivare la soglia.");
    try {
      await save.mutateAsync({ hardBudgetUsd: normalized });
      await utils.agora.hardBudget.invalidate();
      toast.success(normalized === null ? "Soglia hard disattivata." : `Soglia hard impostata a ${normalized.toFixed(4)} USD.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossibile salvare la soglia hard.");
    }
  }

  return <Card className="mb-5 rounded-2xl border-amber-200 bg-amber-50/80 shadow-[0_12px_35px_-25px_rgba(120,75,10,0.22)]"><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end sm:justify-between"><div className="min-w-0"><p className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-[0.12em] text-amber-900"><ShieldAlert className="h-4 w-4" />Soglia hard di spesa</p><p className="mt-1 text-xs leading-5 text-amber-950">Blocca l’avvio prima di qualunque chiamata se il preventivo supera il limite. Per sicurezza blocca anche preventivi con tariffe incomplete.</p></div><div className="flex w-full gap-2 sm:w-72"><div className="min-w-0 flex-1"><Label className="sr-only" htmlFor="hard-budget-usd">Limite in USD</Label><Input id="hard-budget-usd" inputMode="decimal" value={value} onChange={event => setValue(event.target.value)} placeholder="Disattivata" className="h-10 rounded-xl border-amber-200 bg-white text-sm" /></div><Button type="button" onClick={persist} disabled={budget.isLoading || save.isPending} className="h-10 rounded-xl bg-amber-900 px-4 text-xs font-extrabold hover:bg-amber-800">Salva</Button></div></CardContent></Card>;
}
