import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { FlaskConical, Play } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, Empty, PageHeader, Spinner, Stat } from "../components/ui";
import { api } from "../lib/api";
import { langName, pct } from "../lib/format";

export default function Evaluate() {
  const qc = useQueryClient();
  const ev = useQuery({ queryKey: ["evaluation"], queryFn: api.evaluation });
  const run = useMutation({ mutationFn: api.runEvaluation, onSuccess: () => qc.invalidateQueries({ queryKey: ["evaluation"] }) });
  const d = ev.data;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Research lab · H1" title="Does prosody actually help?"
        action={<button type="button" className="btn-primary" disabled={!d?.labeled || run.isPending || !d.groq_configured} onClick={() => run.mutate()}>
          {run.isPending ? <Spinner /> : <Play className="h-4 w-4" />} Run missing interpretations
        </button>}>
        Label recordings with the speech act you intended (statement, question…) from any analysis page. ToneLens then runs <b>System A</b> (words + context) and <b>System B</b> (words + prosody + context) and scores both against your labels, per language. Don't assume B wins; knowing where it doesn't is the finding.
      </PageHeader>

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 font-mono text-sm text-ink-300">
        I<sub>text</sub> = f(L, C) <span className="mx-3 text-ink-400">vs</span> I<sub>multimodal</sub> = f(L, P, C)
      </div>

      {!d ? <Spinner /> : !d.labeled ? (
        <Empty icon={<FlaskConical className="h-8 w-8" />} title="No labeled recordings yet">
          Open an analysis and use <b>Label speech act…</b> in its header. Tip: record the same sentence as a statement and as a question, in English, Hindi and Hinglish.
        </Empty>
      ) : (
        <>
          {!d.groq_configured && <div className="rounded-xl border border-emph/30 bg-emph/10 p-3 text-sm text-emph">Add GROQ_API_KEY to .env to run the systems.</div>}
          {run.data?.errors.length ? <div className="text-sm text-pause">{run.data.errors.length} interpretation(s) failed.</div> : null}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Labeled" value={d.labeled} />
            <Stat label="Scored" value={d.overall.n} sub="both systems ran" />
            <Stat label="System A accuracy" value={pct(d.overall.text_only_acc)} accent="#9aa2c0" />
            <Stat label="System B accuracy" value={pct(d.overall.prosody_acc)} accent="#8b7bff" />
            <Stat label="B right, A wrong" value={d.overall.prosody_only_correct} sub={`A right, B wrong: ${d.overall.text_only_correct}`} accent="#2fd6b0" />
          </div>

          {Object.keys(d.by_language).length > 0 && (
            <Card title="By language">
              <div className="space-y-4">
                {Object.entries(d.by_language).map(([lang, v]) => (
                  <div key={lang}>
                    <div className="mb-1 flex justify-between text-sm"><span>{langName(lang)}</span><span className="text-ink-400">n={v.n}</span></div>
                    <AccBar label="A" value={v.text_only_acc} color="#9aa2c0" />
                    <AccBar label="B" value={v.prosody_acc} color="#8b7bff" />
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card title="Items">
            <div className="scrollbar-thin overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="label"><tr>{["Transcript", "Lang", "Label", "System A", "System B"].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr></thead>
                <tbody>
                  {d.items.map((it) => (
                    <tr key={it.id} className="border-t border-white/5">
                      <td className="max-w-md truncate px-3 py-2"><Link to={`/a/${it.id}`} className="hover:text-pitch">{it.transcript}</Link></td>
                      <td className="px-3">{it.language}</td>
                      <td className="px-3 font-semibold">{it.label}</td>
                      <Pred v={it.pred_text_only} ok={it.pred_text_only === it.label} />
                      <Pred v={it.pred_prosody} ok={it.pred_prosody === it.label} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function Pred({ v, ok }: { v: string | null; ok: boolean }) {
  return <td className={clsx("px-3", v === null ? "text-ink-400" : ok ? "text-energy" : "text-pause")}>{v ?? "–"}{v !== null && (ok ? " ✓" : " ✗")}</td>;
}

function AccBar({ label, value, color }: { label: string; value: number | null; color: string }) {
  return (
    <div className="mb-1 flex items-center gap-2 text-xs">
      <span className="w-4 text-ink-400">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full" style={{ width: `${(value ?? 0) * 100}%`, background: color }} /></div>
      <span className="w-10 text-right font-mono">{pct(value)}</span>
    </div>
  );
}
