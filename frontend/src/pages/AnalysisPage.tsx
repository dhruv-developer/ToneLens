import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { motion } from "framer-motion";
import { Download, Dumbbell, Fingerprint, Gauge, Pencil, Tag, Trash2, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ContourOverlay } from "../components/ContourOverlay";
import { InterpretationPanel } from "../components/InterpretationPanel";
import { JobProgress } from "../components/JobProgress";
import { Radar } from "../components/Radar";
import { Timeline } from "../components/Timeline";
import { Transcript } from "../components/Transcript";
import { Bar, Card, ContourBadge, ScoreRing, Spinner, Stat } from "../components/ui";
import { useAnalysis } from "../hooks/useAnalysis";
import { usePlayer } from "../hooks/usePlayer";
import { api } from "../lib/api";
import { fmt, langName, pct, signed } from "../lib/format";
import type { Analysis, SpeechAct } from "../lib/types";

export default function AnalysisPage() {
  const { id } = useParams();
  const { data: a, isLoading, error, progress } = useAnalysis(id);
  const player = usePlayer(a?.status === "done" ? a.audio_url : null);

  if (isLoading) return <div className="grid h-64 place-items-center"><Spinner className="h-6 w-6" /></div>;
  if (error || !a) return <div className="text-pause">Could not load analysis: {(error as Error)?.message}</div>;

  if (a.status !== "done") {
    return (
      <div className="pt-10">
        <JobProgress stage={progress?.stage ?? a.stage} progress={progress?.progress ?? a.progress} error={progress?.error ?? a.error} />
      </div>
    );
  }

  const f = a.features!;
  const rel = f.baseline_relative;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <Header a={a} />

      {f.warning && <div className="rounded-xl border border-emph/30 bg-emph/10 p-3 text-sm text-emph">{f.warning}</div>}

      <Card>
        <Transcript features={f} text={a.transcript} player={player} />
      </Card>

      <Timeline features={f} player={player} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Language" value={langName(a.language)} sub={`${pct(a.language_probability)} confidence`} />
        <Stat label="Median pitch" value={fmt(f.pitch_median_hz, 0, " Hz")} accent="#b4a9ff"
          sub={rel?.pitch_level_st !== undefined ? `${signed(rel.pitch_level_st)} st vs your baseline` : `p10–p90 ${fmt(f.pitch_p10_hz, 0)}–${fmt(f.pitch_p90_hz, 0)} Hz`} />
        <Stat label="Pitch range" value={fmt(f.pitch_range_semitones, 1, " st")} accent="#b4a9ff"
          sub={rel?.pitch_range_delta_st !== undefined ? `${signed(rel.pitch_range_delta_st)} st vs baseline` : "10th–90th percentile"} />
        <Stat label="Final contour" value={<ContourBadge contour={f.final_contour} />} sub={`${signed(f.final_contour_slope_st_per_s)} st/s, last 0.5 s`} />
        <Stat label="Speaking rate" value={fmt(f.speaking_rate_wps, 2, " w/s")} accent="#2fd6b0"
          sub={rel?.rate_ratio !== undefined ? `${rel.rate_ratio}× your usual pace` : `${f.word_count} words`} />
        <Stat label="Pause ratio" value={pct(f.pause_ratio)} accent="#ff6b8a" sub={`${f.long_pause_count} pause(s) ≥ 250 ms`} />
        <Stat label="Loudness dynamics" value={fmt(f.energy_variability, 2)} accent="#2fd6b0"
          sub={rel?.loudness_delta_db !== undefined ? `${signed(rel.loudness_delta_db)} dB vs baseline` : "coefficient of variation"} />
        <Stat label="Emphasis" value={f.emphasis_candidates.length ? f.emphasis_candidates.join(", ") : "none"} accent="#ffb547"
          sub={f.fillers.length ? `fillers: ${f.fillers.join(", ")}` : "speaker-relative z ≥ 1"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <InterpretationPanel analysis={a} />
        <div className="space-y-6">
          <FingerprintCard a={a} />
          <SimilarCard id={a.id} />
        </div>
      </div>

      {a.kind === "drill" && a.drill && <DrillCard a={a} />}

      <WordTable a={a} onPlay={player.playRange} />
    </motion.div>
  );
}

function Header({ a }: { a: Analysis }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(a.title ?? "");
  const [tags, setTags] = useState(a.tags.join(", "));
  useEffect(() => { setTitle(a.title ?? ""); setTags(a.tags.join(", ")); }, [a.title, a.tags]);

  const patch = useMutation({
    mutationFn: (body: Parameters<typeof api.patch>[1]) => api.patch(a.id, body),
    onSuccess: (d) => { qc.setQueryData(["analysis", a.id], d); qc.invalidateQueries({ queryKey: ["analyses"] }); },
  });
  const del = useMutation({
    mutationFn: () => api.remove(a.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["analyses"] }); nav("/library"); },
  });

  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="label mb-1 flex items-center gap-2 text-pitch">
          {a.kind === "drill" ? "Drill attempt" : a.kind === "baseline" ? "Baseline recording" : "Analysis"} · {a.model_size} · {fmt(a.duration, 1, "s")}
        </div>
        {editing ? (
          <form className="flex flex-wrap gap-2" onSubmit={(e) => {
            e.preventDefault();
            patch.mutate({ title, tags: tags.split(",").map((t) => t.trim()).filter(Boolean) });
            setEditing(false);
          }}>
            <input className="input w-72" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" autoFocus />
            <input className="input w-60" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tags, comma separated" />
            <button className="btn-primary">Save</button>
          </form>
        ) : (
          <h1 className="flex items-center gap-3 text-3xl font-extrabold tracking-tight">
            {a.title || a.filename}
            <button type="button" onClick={() => setEditing(true)} className="text-ink-400 hover:text-white"><Pencil className="h-4 w-4" /></button>
          </h1>
        )}
        {!editing && a.tags.length > 0 && <div className="mt-2 flex gap-1.5">{a.tags.map((t) => <span key={t} className="chip"><Tag className="h-3 w-3" />{t}</span>)}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select className="input w-auto py-1.5 text-xs" value={a.label ?? ""} title="Human label for the Research lab"
          onChange={(e) => patch.mutate({ label: (e.target.value || null) as SpeechAct | null })}>
          <option value="">Label speech act…</option>
          {["statement", "question", "request", "exclamation", "unclear"].map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <Link to={`/drills?ref=${a.kind === "drill" && a.reference_id ? a.reference_id : a.id}`} className="btn-ghost py-1.5 text-xs"><Dumbbell className="h-3.5 w-3.5" /> Practice</Link>
        <div className="group relative">
          <button type="button" className="btn-ghost py-1.5 text-xs"><Download className="h-3.5 w-3.5" /> Export</button>
          <div className="invisible absolute right-0 z-30 mt-1 w-40 rounded-xl border border-white/10 bg-ink-850 p-1 opacity-0 shadow-xl transition group-hover:visible group-hover:opacity-100">
            {(["md", "json", "csv"] as const).map((fm) => (
              <a key={fm} href={api.exportUrl(a.id, fm)} className="block rounded-lg px-3 py-2 text-sm hover:bg-white/5">
                {fm === "md" ? "Report (.md)" : fm === "json" ? "Full data (.json)" : "Words (.csv)"}
              </a>
            ))}
          </div>
        </div>
        <button type="button" className="btn-danger py-1.5 text-xs" onClick={() => confirm("Delete this analysis and its audio?") && del.mutate()}>
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function FingerprintCard({ a }: { a: Analysis }) {
  const fp = a.fingerprint_detail;
  if (!fp) return null;
  return (
    <Card title="Delivery fingerprint" icon={<Fingerprint className="h-4 w-4" />}
      action={<span className="chip text-[10px]">{fp.speaker_relative ? "speaker-relative" : "absolute"}</span>}>
      <div className="flex justify-center"><Radar size={300} labels={fp.dims.map((d) => d.label)} series={[{ name: "this", values: fp.vector }]} /></div>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
        {fp.dims.map((d) => (
          <div key={d.key}>
            <div className="flex justify-between text-[11px]"><span className="text-ink-400">{d.label}</span><span className="font-mono text-ink-300">{d.raw ?? "–"}</span></div>
            <Bar value={(d.value ?? 0) * 100} />
          </div>
        ))}
      </div>
    </Card>
  );
}

function SimilarCard({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["similar", id], queryFn: () => api.similar(id) });
  return (
    <Card title="Similar deliveries" icon={<Users className="h-4 w-4" />}>
      {!q.data?.items.length ? <div className="text-sm text-ink-400">Analyse more recordings to find deliveries with a similar shape.</div> : (
        <ul className="space-y-2">
          {q.data.items.map((s) => (
            <li key={s.id}>
              <Link to={`/a/${s.id}`} className="flex items-center gap-3 rounded-lg p-2 hover:bg-white/5">
                <div className="w-12 font-mono text-sm text-energy">{Math.round(s.similarity * 100)}%</div>
                <div className="min-w-0 flex-1 truncate text-sm text-ink-200">{s.title || s.transcript || s.filename}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DrillCard({ a }: { a: Analysis }) {
  const d = a.drill!;
  return (
    <Card title="Drill score" icon={<Gauge className="h-4 w-4" />}
      action={a.reference_id && <Link to={`/a/${a.reference_id}`} className="text-sm text-pitch hover:underline">open reference</Link>}>
      <div className="grid gap-6 md:grid-cols-[auto_1fr_1.4fr] md:items-center">
        <ScoreRing value={d.overall} label="match" size={140} />
        <div className="space-y-2">
          {Object.entries(d.parts).map(([k, v]) => (
            <div key={k}>
              <div className="flex justify-between text-xs"><span className="capitalize text-ink-300">{k}</span><span className="font-mono">{v === null ? "–" : Math.round(v)}</span></div>
              <Bar value={v} color={v === null ? undefined : v > 75 ? "#2fd6b0" : v > 50 ? "#ffb547" : "#ff6b8a"} />
            </div>
          ))}
        </div>
        <div>
          <ContourOverlay height={180} series={[
            { name: "reference", contours: d.contours.reference, color: "#9aa2c0" },
            { name: "you", contours: d.contours.attempt, color: "#8b7bff" },
          ]} />
          <ul className="mt-2 space-y-1 text-sm text-ink-200">{d.tips.map((t, i) => <li key={i}>→ {t}</li>)}</ul>
        </div>
      </div>
    </Card>
  );
}

function WordTable({ a, onPlay }: { a: Analysis; onPlay: (s: number, e: number) => void }) {
  const [open, setOpen] = useState(false);
  const words = a.features?.words ?? [];
  if (!words.length) return null;
  return (
    <Card title={`Word-level measurements · ${words.length} words`} action={<button type="button" className="btn-ghost py-1 text-xs" onClick={() => setOpen(!open)}>{open ? "Hide" : "Show"}</button>}>
      {open && (
        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="label">
              <tr>{["word", "time", "pitch Δst", "peak dB", "s/char", "pause before", "emphasis"].map((h) => <th key={h} className="px-2 py-2 font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody className="font-mono text-xs">
              {words.map((w, i) => (
                <tr key={i} onClick={() => onPlay(w.start, w.end)} className={clsx("cursor-pointer border-t border-white/5 hover:bg-white/[0.03]", w.emphasis_candidate && "text-emph")}>
                  <td className="px-2 py-1.5 font-sans text-sm">{w.word}</td>
                  <td className="px-2">{w.start.toFixed(2)}–{w.end.toFixed(2)}</td>
                  <td className="px-2">{signed(w.pitch_st, 2)}</td>
                  <td className="px-2">{fmt(w.energy_db, 1)}</td>
                  <td className="px-2">{fmt(w.dur_per_char, 3)}</td>
                  <td className="px-2">{w.pause_before ? `${w.pause_before.toFixed(2)}s` : ""}</td>
                  <td className="px-2"><div className="flex items-center gap-2"><span className="w-10">{signed(w.emphasis_score, 2)}</span><Bar className="w-24" value={Math.max(0, w.emphasis_score) * 40} color="#ffb547" /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
