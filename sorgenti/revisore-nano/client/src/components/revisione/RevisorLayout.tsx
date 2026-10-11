import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Users,
  FileText,
  LogOut,
  Scale,
  Bell,
  Loader2,
  LockKeyhole,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { REVISION_PHASES, basePhaseStates } from "@/lib/revisionWorkflow";

interface RevisorLayoutProps {
  children: React.ReactNode;
  incaricoId?: number;
  moduloAttivo?: number;
}

const navItems = [
  { href: "/", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/clienti", icon: Users, label: "Clienti" },
];

function ModuloStep({ n, label, isa, stato, href, attivo, bloccato }: {
  n: number; label: string; isa: string; stato: number; href: string; attivo: boolean; bloccato: boolean;
}) {
  const statoClass = stato === 2 ? "bg-emerald-500" : stato === 1 ? "bg-blue-500" : "bg-gray-300";
  const textClass = attivo ? "text-white font-semibold" : stato === 2 ? "text-emerald-200" : "text-gray-400";

  return (
    <Link href={href}>
      <div className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-colors",
        attivo ? "bg-white/10" : "hover:bg-white/5"
      )}>
        <div className={cn("w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0", bloccato ? "bg-slate-600" : statoClass)}>
          {bloccato ? <LockKeyhole className="w-3 h-3" /> : stato === 2 ? "✓" : n}
        </div>
        <div className="min-w-0">
          <div className={cn("text-sm truncate", textClass, bloccato && "text-gray-500")}>{label}</div>
          <div className="text-[11px] text-gray-500">{bloccato ? "Consultabile · non avviata" : isa}</div>
        </div>
      </div>
    </Link>
  );
}

export default function RevisorLayout({ children, incaricoId, moduloAttivo }: RevisorLayoutProps) {
  const { user, loading, isAuthenticated, logout } = useAuth();
  const [location] = useLocation();
  const idFromLocation = Number(location.match(/^\/incarichi\/(\d+)/)?.[1]);
  const effectiveIncaricoId = incaricoId ?? (Number.isFinite(idFromLocation) ? idFromLocation : undefined);

  const { data: incarico } = trpc.incarichi.get.useQuery(
    { id: effectiveIncaricoId! },
    { enabled: !!effectiveIncaricoId }
  );

  const { data: alertsData } = trpc.alerts.unreadCount.useQuery(
    { incaricoId: effectiveIncaricoId! },
    { enabled: !!effectiveIncaricoId }
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-6">
        <div className="flex items-center gap-3">
          <Scale className="w-10 h-10 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">RevisoreNano</h1>
            <p className="text-sm text-muted-foreground">Piattaforma di revisione legale</p>
          </div>
        </div>
        <p className="text-muted-foreground text-center max-w-sm">
          Accedi per gestire i tuoi incarichi di revisione legale conformi agli ISA Italia.
        </p>
        <Button asChild size="lg">
          <a href={getLoginUrl()}>Accedi alla piattaforma</a>
        </Button>
      </div>
    );
  }

  const statoFasi = basePhaseStates(incarico);
  const accettazioneCompletata = statoFasi[0] === 2;
  const faseAttiva = moduloAttivo === 1 ? 1 : moduloAttivo === 2 ? 3
    : moduloAttivo === 3 || moduloAttivo === 4 ? 5 : moduloAttivo === 5 ? 6
    : location.includes("/verifica-incassi") ? 8 : location.includes("/circolarizzazione") ? 9
    : location.includes("/piano-controlli") || location.includes("/scheda-") || location.includes("/verifica-ricavi-costi") ? 7
    : undefined;

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 flex flex-col" style={{ background: "var(--sidebar)" }}>
        {/* Logo */}
        <div className="p-5 border-b border-sidebar-border">
          <div className="flex items-center gap-2">
            <Scale className="w-6 h-6 text-sidebar-primary" />
            <div>
              <div className="text-sm font-bold text-sidebar-foreground">RevisoreNano</div>
              <div className="text-xs text-gray-500">ISA Italia</div>
            </div>
          </div>
        </div>

        {/* Nav principale */}
        <nav className="p-3 space-y-1">
          {navItems.map(({ href, icon: Icon, label }) => (
            <Link key={href} href={href}>
              <div className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm cursor-pointer transition-colors",
                location === href
                  ? "bg-white/10 text-white font-medium"
                  : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
              )}>
                <Icon className="w-4 h-4 flex-shrink-0" />
                {label}
              </div>
            </Link>
          ))}
        </nav>

        {/* Sezione moduli (se siamo in un incarico) */}
        {effectiveIncaricoId && incarico && (
          <div className="px-3 mt-2 flex-1 min-h-0 overflow-y-auto">
            <div className="border-t border-sidebar-border pt-3 mb-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Fascicolo</span>
                {(alertsData?.count ?? 0) > 0 && (
                  <Badge variant="destructive" className="text-xs px-1.5 py-0">
                    {alertsData?.count}
                  </Badge>
                )}
              </div>
              <Link href={`/incarichi/${effectiveIncaricoId}`}>
                <div className="text-xs text-gray-400 hover:text-gray-200 cursor-pointer truncate mb-3">
                  {incarico.cliente?.ragioneSociale} — {incarico.annoEsercizio}
                </div>
              </Link>
              <div className="space-y-0.5">
                {REVISION_PHASES.map((m) => (
                  <ModuloStep
                    key={m.n}
                    n={m.n}
                    label={m.shortTitle}
                    isa={m.isa}
                    stato={statoFasi[m.n - 1] ?? 0}
                    href={m.href(effectiveIncaricoId)}
                    attivo={faseAttiva === m.n}
                    bloccato={m.n > 1 && !accettazioneCompletata}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* User */}
        <div className="p-3 border-t border-sidebar-border">
          <div className="flex items-center gap-2 px-2 py-1.5">
            <div className="w-7 h-7 rounded-full bg-sidebar-primary flex items-center justify-center text-xs font-bold text-sidebar-primary-foreground flex-shrink-0">
              {user?.name?.charAt(0)?.toUpperCase() || "R"}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-sidebar-foreground truncate">{user?.name || "Revisore"}</div>
              <div className="text-xs text-gray-500 truncate">{user?.email || ""}</div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-gray-500 hover:text-gray-200"
              onClick={logout}
            >
              <LogOut className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
