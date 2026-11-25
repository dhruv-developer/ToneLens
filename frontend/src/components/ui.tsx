import clsx from "clsx";
import { Loader2, TrendingDown, TrendingUp, MoveRight, HelpCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { Status } from "../lib/types";

export function Card({ children, className, title, action, icon }: {
  children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode; icon?: ReactNode;
}) {
  return (
    <section className={clsx("glass p-5", className)}>
      {(title || action) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-100">
            {icon && <span className="text-pitch">{icon}</span>}
            {title}
          </h3>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, accent, hint }: {
  label: string; value: ReactNode; sub?: ReactNode; accent?: string; hint?: string;
}) {
  return (
    <div className="group relative rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3" title={hint}>
      <div className="label">{label}</div>
      <div className="mt-1 font-mono text-xl font-semibold tracking-tight" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-ink-400">{sub}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx("animate-spin", className ?? "h-4 w-4")} />;
}

const STATUS_STYLE: Record<Status, string> = {
  queued: "border-ink-400/30 text-ink-300",
  processing: "border-pitch/40 text-pitch",
  done: "border-energy/30 text-energy",
  failed: "border-pause/40 text-pause",
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={clsx("chip", STATUS_STYLE[status])}>
      {status === "processing" && <Spinner className="h-3 w-3" />}
      {status}
    </span>
  );
}

export function ContourBadge({ contour }: { contour?: string | null }) {
  const map: Record<string, { icon: ReactNode; cls: string }> = {
    rising: { icon: <TrendingUp className="h-3 w-3" />, cls: "text-rise border-rise/30" },
    falling: { icon: <TrendingDown className="h-3 w-3" />, cls: "text-emph border-emph/30" },
    level: { icon: <MoveRight className="h-3 w-3" />, cls: "text-ink-200" },
  };
  const m = map[contour ?? ""] ?? { icon: <HelpCircle className="h-3 w-3" />, cls: "text-ink-400" };
  return <span className={clsx("chip", m.cls)}>{m.icon}{contour ?? "unknown"}</span>;
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/10 px-6 py-14 text-center">
      {icon && <div className="text-ink-400">{icon}</div>}
      <div className="font-semibold text-ink-200">{title}</div>
      {children && <div className="max-w-md text-sm text-ink-400">{children}</div>}
    </div>
  );
}

export function PageHeader({ eyebrow, title, children, action }: {
  eyebrow?: string; title: ReactNode; children?: ReactNode; action?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <div className="label mb-2 text-pitch">{eyebrow}</div>}
        <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">{title}</h1>
        {children && <p className="mt-2 max-w-2xl text-ink-300">{children}</p>}
      </div>
      {action}
    </div>
  );
}

export function Bar({ value, color = "#8b7bff", className }: { value: number | null; color?: string; className?: string }) {
  return (
    <div className={clsx("h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]", className)}>
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%`, background: color }} />
    </div>
  );
}

export function ScoreRing({ value, size = 120, label }: { value: number; size?: number; label?: string }) {
  const r = size / 2 - 8, c = 2 * Math.PI * r;
  const color = value >= 80 ? "#2fd6b0" : value >= 60 ? "#ffb547" : "#ff6b8a";
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.07)" strokeWidth={8} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={8} fill="none" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} style={{ transition: "stroke-dashoffset 1s ease" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="font-mono text-3xl font-bold" style={{ color }}>{Math.round(value)}</div>
        {label && <div className="label">{label}</div>}
      </div>
    </div>
  );
}
