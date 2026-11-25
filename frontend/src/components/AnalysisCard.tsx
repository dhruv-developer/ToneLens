import clsx from "clsx";
import { Check } from "lucide-react";
import { Link } from "react-router-dom";
import { fmt, langName, timeAgo } from "../lib/format";
import type { AnalysisSummary } from "../lib/types";
import { Radar } from "./Radar";
import { ContourBadge, StatusBadge } from "./ui";

export function AnalysisCard({ a, selected, onSelect, extra }: {
  a: AnalysisSummary; selected?: boolean; onSelect?: () => void; extra?: React.ReactNode;
}) {
  return (
    <div className={clsx("glass group relative flex gap-4 p-4 transition hover:border-white/15", selected && "ring-2 ring-pitch/70")}>
      {onSelect && (
        <button type="button" onClick={onSelect} aria-label="select"
          className={clsx("absolute right-3 top-3 z-10 grid h-6 w-6 place-items-center rounded-md border transition",
            selected ? "border-pitch bg-pitch text-white" : "border-white/20 bg-black/30 opacity-60 group-hover:opacity-100")}>
          {selected && <Check className="h-3.5 w-3.5" />}
        </button>
      )}
      <div className="grid h-[84px] w-[84px] shrink-0 place-items-center rounded-xl bg-black/20">
        {a.fingerprint ? <Radar mini size={76} labels={a.fingerprint.map(String)} series={[{ name: a.id, values: a.fingerprint }]} /> : <StatusBadge status={a.status} />}
      </div>
      <Link to={`/a/${a.id}`} className="min-w-0 flex-1">
        <div className="flex items-center gap-2 pr-8 text-xs text-ink-400">
          <span>{timeAgo(a.created_at)}</span>
          {a.language && <span>· {langName(a.language)}</span>}
          {a.duration ? <span>· {fmt(a.duration, 1, "s")}</span> : null}
          {a.kind !== "analysis" && <span className="chip py-0 text-[10px]">{a.kind}</span>}
        </div>
        <div className="mt-1 line-clamp-1 font-semibold text-white">{a.title || a.filename}</div>
        <div className="mt-0.5 line-clamp-2 text-sm text-ink-300">{a.transcript || (a.status === "done" ? "(no speech)" : a.stage)}</div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {a.status !== "done" && <StatusBadge status={a.status} />}
          {a.headline && <ContourBadge contour={a.headline.final_contour} />}
          {a.headline?.emphasis_candidates?.slice(0, 2).map((w) => <span key={w} className="chip border-emph/30 text-emph">{w}</span>)}
          {a.label && <span className="chip border-rise/30 text-rise">label: {a.label}</span>}
          {a.drill_score != null && <span className="chip border-energy/30 text-energy">score {Math.round(a.drill_score)}</span>}
          {a.tags.map((t) => <span key={t} className="chip">#{t}</span>)}
          {extra}
        </div>
      </Link>
    </div>
  );
}
