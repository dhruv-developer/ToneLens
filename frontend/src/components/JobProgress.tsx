import clsx from "clsx";
import { motion } from "framer-motion";
import { Check, AlertTriangle } from "lucide-react";
import { STAGES } from "../lib/format";
import { Spinner } from "./ui";

export function JobProgress({ stage, progress, error }: { stage: string; progress: number; error?: string | null }) {
  const idx = STAGES.findIndex((s) => s.key === stage);
  const failed = stage === "failed";
  return (
    <div className="glass mx-auto max-w-xl p-8">
      <div className="mb-6 text-center">
        <div className="text-gradient text-2xl font-extrabold">{failed ? "Analysis failed" : "Listening closely…"}</div>
        <div className="mt-1 text-sm text-ink-400">{failed ? error : "Transcribing words and measuring how they were said"}</div>
      </div>
      <div className="relative mb-8 h-2 overflow-hidden rounded-full bg-white/[0.06]">
        <motion.div className="h-full rounded-full" style={{ background: "linear-gradient(90deg,#8b7bff,#2fd6b0)" }}
          animate={{ width: `${Math.max(4, progress * 100)}%` }} transition={{ ease: "easeOut", duration: 0.6 }} />
        {!failed && <div className="shimmer absolute inset-0" />}
      </div>
      <ol className="space-y-3">
        {STAGES.slice(1, -1).map((s, i) => {
          const n = i + 1;
          const done = !failed && (idx > n || stage === "done");
          const active = !failed && idx === n;
          return (
            <li key={s.key} className={clsx("flex items-center gap-3 text-sm", done ? "text-ink-200" : active ? "text-white" : "text-ink-400")}>
              <span className={clsx("grid h-6 w-6 place-items-center rounded-full border",
                done ? "border-energy/40 bg-energy/15 text-energy" : active ? "border-pitch/50 bg-pitch/15 text-pitch" : "border-white/10")}>
                {done ? <Check className="h-3.5 w-3.5" /> : active ? <Spinner className="h-3.5 w-3.5" /> : <span className="text-[10px]">{n}</span>}
              </span>
              {s.label}
            </li>
          );
        })}
      </ol>
      {failed && (
        <div className="mt-6 flex items-start gap-2 rounded-xl border border-pause/30 bg-pause/10 p-3 text-sm text-pause">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}
    </div>
  );
}
