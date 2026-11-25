import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AlertTriangle, Brain, CheckCircle2, FileText, Info, KeyRound, RefreshCw, Sparkles, Split } from "lucide-react";
import { useState } from "react";
import { api, ApiError } from "../lib/api";
import type { Analysis, Interpretation, Mode } from "../lib/types";
import { Card, Spinner } from "./ui";

const AGREEMENT = {
  divergent: {
    icon: <AlertTriangle className="h-5 w-5" />, cls: "border-emph/40 bg-emph/10 text-emph",
    title: "Prosody–text disagreement",
    body: "The words and the vocal delivery may convey different pragmatic signals. More conversational context is needed before reading intent.",
  },
  consistent: {
    icon: <CheckCircle2 className="h-5 w-5" />, cls: "border-energy/40 bg-energy/10 text-energy",
    title: "Delivery and words agree", body: "Vocal delivery is consistent with the literal content.",
  },
  insufficient: {
    icon: <Info className="h-5 w-5" />, cls: "border-white/15 bg-white/[0.04] text-ink-200",
    title: "Not enough evidence", body: "The acoustic evidence is too weak to compare with the words.",
  },
} as const;

const CONF = { low: "text-ink-400", medium: "text-emph", high: "text-energy" };

export function InterpretationPanel({ analysis }: { analysis: Analysis }) {
  const qc = useQueryClient();
  const [context, setContext] = useState(analysis.context ?? "");
  const [abMode, setAbMode] = useState(!!analysis.interpretations.text_only);
  const [missingKey, setMissingKey] = useState(false);

  const run = useMutation({
    mutationFn: async ({ modes, force }: { modes: Mode[]; force?: boolean }) => {
      for (const m of modes) await api.interpret(analysis.id, m, context, force);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["analysis", analysis.id] }),
    onError: (e) => { if (e instanceof ApiError && e.code === "missing_groq_key") setMissingKey(true); },
  });

  const modes: Mode[] = abMode ? ["prosody", "text_only"] : ["prosody"];
  const have = modes.every((m) => analysis.interpretations[m]);
  const contextChanged = context !== (analysis.context ?? "");

  return (
    <Card title="Interpretation" icon={<Brain className="h-4 w-4" />}
      action={
        <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-300">
          <Split className="h-3.5 w-3.5" /> A/B vs text-only
          <input type="checkbox" checked={abMode} onChange={(e) => setAbMode(e.target.checked)} className="accent-[#8b7bff]" />
        </label>
      }>
      <div className="mb-4 flex flex-col gap-2 md:flex-row">
        <input className="input" placeholder="Conversation context (optional), e.g. “reply after hearing the meeting moved to Saturday”"
          value={context} onChange={(e) => setContext(e.target.value)} />
        <button type="button" className="btn-primary shrink-0" disabled={run.isPending}
          onClick={() => run.mutate({ modes, force: contextChanged || have })}>
          {run.isPending ? <Spinner /> : have ? <RefreshCw className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
          {have ? (contextChanged ? "Re-interpret" : "Regenerate") : "Interpret"}
        </button>
      </div>

      {missingKey && (
        <div className="mb-4 flex gap-3 rounded-xl border border-pitch/30 bg-pitch/10 p-4 text-sm">
          <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-pitch" />
          <div>
            <div className="font-semibold text-white">Add your Groq key to enable interpretation</div>
            <div className="mt-1 text-ink-300">Put <code className="rounded bg-black/30 px-1">GROQ_API_KEY=…</code> in <code className="rounded bg-black/30 px-1">.env</code> at the project root and restart the API. Transcript, prosody, fingerprints, drills and comparisons all work without it.</div>
          </div>
        </div>
      )}
      {run.error && !missingKey && <div className="mb-4 text-sm text-pause">{(run.error as Error).message}</div>}

      <div className={clsx("grid gap-4", abMode && "lg:grid-cols-2")}>
        {modes.map((m) => (
          <InterpretationView key={m} mode={m} result={analysis.interpretations[m]} showBanner={m === "prosody"} pending={run.isPending} />
        ))}
      </div>
    </Card>
  );
}

function InterpretationView({ mode, result, showBanner, pending }: { mode: Mode; result?: Interpretation; showBanner: boolean; pending: boolean }) {
  const title = mode === "prosody" ? "System B · words + prosody" : "System A · words only";
  if (!result) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-ink-400">
        <div className="label mb-2">{title}</div>
        {pending ? <div className="flex items-center justify-center gap-2"><Spinner /> thinking…</div> : "Not interpreted yet."}
      </div>
    );
  }
  const a = result.analysis;
  if (!a) {
    return <div className="rounded-xl border border-pause/30 p-4 text-sm text-pause">{result.error}<pre className="mt-2 whitespace-pre-wrap text-xs text-ink-400">{result.raw}</pre></div>;
  }
  const ag = AGREEMENT[a.prosody_text_agreement] ?? AGREEMENT.insufficient;
  return (
    <div className="space-y-4 rounded-xl border border-white/[0.06] bg-white/[0.015] p-4">
      <div className="flex items-center justify-between">
        <div className="label">{title}</div>
        <span className="chip">speech act: <b className="text-white">{a.speech_act}</b></span>
      </div>
      {showBanner && (
        <div className={clsx("flex gap-3 rounded-xl border p-3", ag.cls)}>
          {ag.icon}
          <div>
            <div className="font-semibold">{ag.title}</div>
            <div className="text-sm opacity-90">{a.agreement_reason || ag.body}</div>
          </div>
        </div>
      )}
      <Field icon={<FileText className="h-3.5 w-3.5" />} label="Literal meaning">{a.literal_meaning}</Field>
      <Field label="Vocal delivery">{a.vocal_delivery}</Field>
      <div>
        <div className="label mb-2">Possible readings · hypotheses, not verdicts</div>
        <ul className="space-y-2">
          {a.interpretations.map((h, i) => (
            <li key={i} className="rounded-lg border border-white/[0.06] bg-black/20 p-3">
              <div className="flex items-start justify-between gap-3">
                <span className="font-medium text-white">{h.hypothesis}</span>
                <span className={clsx("shrink-0 text-xs font-semibold uppercase tracking-wider", CONF[h.confidence])}>{h.confidence}</span>
              </div>
              <div className="mt-1 text-sm text-ink-400">{h.evidence}</div>
            </li>
          ))}
        </ul>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Emphasized">{a.emphasized_words.length ? a.emphasized_words.map((w) => <span key={w} className="chip mr-1 border-emph/30 text-emph">{w}</span>) : "–"}</Field>
        <Field label="Hesitation">{a.hesitation}</Field>
      </div>
      {a.cannot_infer.length > 0 && (
        <Field label="Cannot reliably infer"><ul className="list-disc pl-4 text-ink-400">{a.cannot_infer.map((c, i) => <li key={i}>{c}</li>)}</ul></Field>
      )}
    </div>
  );
}

function Field({ label, children, icon }: { label: string; children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div>
      <div className="label mb-1 flex items-center gap-1">{icon}{label}</div>
      <div className="text-sm text-ink-200">{children}</div>
    </div>
  );
}
