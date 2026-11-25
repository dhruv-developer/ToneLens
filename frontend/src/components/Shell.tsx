import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { AudioWaveform, BarChart3, Dumbbell, GitCompare, Library, Mic2, UserRound, Github } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { api } from "../lib/api";

const NAV = [
  { to: "/", label: "Studio", icon: Mic2, end: true },
  { to: "/library", label: "Library", icon: Library },
  { to: "/compare", label: "Compare", icon: GitCompare },
  { to: "/drills", label: "Delivery Gym", icon: Dumbbell },
  { to: "/profiles", label: "Voice profiles", icon: UserRound },
  { to: "/evaluate", label: "Research lab", icon: BarChart3 },
];

export function Shell({ children }: { children: ReactNode }) {
  const config = useQuery({ queryKey: ["config"], queryFn: api.config, staleTime: 60_000 });
  const stats = useQuery({ queryKey: ["stats"], queryFn: api.stats, refetchInterval: 5000 });
  const running = (stats.data?.by_status.processing ?? 0) + (stats.data?.by_status.queued ?? 0);

  return (
    <div className="relative min-h-screen">
      <div className="aurora" />
      <div className="grain" />
      <div className="relative z-10 flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-white/[0.06] bg-ink-950/60 px-4 py-6 backdrop-blur-xl lg:flex">
          <NavLink to="/" className="mb-8 flex items-center gap-2.5 px-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: "linear-gradient(135deg,#8b7bff,#2fd6b0)" }}>
              <AudioWaveform className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="text-lg font-extrabold tracking-tight">ToneLens</div>
              <div className="-mt-1 text-[10px] uppercase tracking-[0.2em] text-ink-400">prosody intelligence</div>
            </div>
          </NavLink>
          <nav className="flex flex-col gap-1">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end}
                className={({ isActive }) => clsx("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                  isActive ? "bg-white/[0.07] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]" : "text-ink-300 hover:bg-white/[0.04] hover:text-white")}>
                <Icon className="h-4 w-4" /> {label}
              </NavLink>
            ))}
          </nav>

          <div className="mt-auto space-y-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-xs">
            <div className="label">System</div>
            <Row k="LLM" v={config.data ? (config.data.groq_configured ? <span className="text-energy">Groq · ready</span> : <span className="text-emph">no key</span>) : "…"} />
            <Row k="Queue" v={config.data ? `${config.data.queue} · ${config.data.workers}w` : "…"} />
            <Row k="Active jobs" v={<span className={running ? "text-pitch" : ""}>{running}</span>} />
            <Row k="Analysed" v={`${stats.data?.by_status.done ?? 0} · ${Math.round((stats.data?.audio_seconds ?? 0) / 60)} min`} />
          </div>
          <a className="mt-3 flex items-center gap-2 px-2 text-xs text-ink-400 hover:text-ink-200" href="/docs" target="_blank" rel="noreferrer">
            <Github className="h-3.5 w-3.5" /> API docs
          </a>
        </aside>

        <div className="min-w-0 flex-1">
          <nav className="sticky top-0 z-20 flex gap-1 overflow-x-auto border-b border-white/[0.06] bg-ink-950/80 px-3 py-2 backdrop-blur-xl lg:hidden">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end}
                className={({ isActive }) => clsx("flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs", isActive ? "bg-white/10 text-white" : "text-ink-300")}>
                <Icon className="h-3.5 w-3.5" /> {label}
              </NavLink>
            ))}
          </nav>
          <main className="mx-auto max-w-7xl px-4 py-8 md:px-8 md:py-10">{children}</main>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return <div className="flex items-center justify-between gap-2"><span className="text-ink-400">{k}</span><span className="font-mono text-ink-200">{v}</span></div>;
}
