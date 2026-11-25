import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dumbbell, Play, Trophy } from "lucide-react";
import { useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ContourOverlay } from "../components/ContourOverlay";
import { RecorderPanel, type Picked } from "../components/RecorderPanel";
import { Card, ContourBadge, Empty, PageHeader, ScoreRing, Spinner } from "../components/ui";
import { usePlayer } from "../hooks/usePlayer";
import { api } from "../lib/api";
import { timeAgo } from "../lib/format";

export default function Drills() {
  const [params, setParams] = useSearchParams();
  const refId = params.get("ref") ?? "";
  const nav = useNavigate();
  const qc = useQueryClient();

  const refs = useQuery({ queryKey: ["analyses", "drill-refs"], queryFn: () => api.list({ kind: "analysis", status: "done", limit: 100 }) });
  const ref = useQuery({ queryKey: ["analysis", refId], queryFn: () => api.get(refId), enabled: !!refId });
  const attempts = useQuery({ queryKey: ["attempts", refId], queryFn: () => api.drillAttempts(refId), enabled: !!refId, refetchInterval: 3000 });
  const player = usePlayer(ref.data?.audio_url);

  useEffect(() => {
    if (!refId && refs.data?.items.length) setParams({ ref: refs.data.items[0].id }, { replace: true });
  }, [refId, refs.data, setParams]);

  const submit = useMutation({
    mutationFn: (p: Picked) => api.upload(p.blob, p.filename, { kind: "drill", referenceId: refId, language: ref.data?.language }),
    onSuccess: ({ id }) => { qc.invalidateQueries({ queryKey: ["attempts", refId] }); nav(`/a/${id}`); },
  });

  const done = (attempts.data ?? []).filter((a) => a.drill_score != null);
  const best = done.reduce((m, a) => Math.max(m, a.drill_score ?? 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Delivery Gym" title="Say it like that">
        Pick any recording as a reference, listen, and imitate its delivery. ToneLens aligns both contours with dynamic time warping and scores the shape (pitch, loudness, pace, range, emphasis) independently of your voice's pitch.
      </PageHeader>

      {refs.data && !refs.data.items.length ? (
        <Empty icon={<Dumbbell className="h-8 w-8" />} title="No references yet">Analyse a recording in the <Link to="/" className="text-pitch hover:underline">Studio</Link> first; any analysis can become a drill.</Empty>
      ) : (
        <>
          <div className="glass flex flex-col gap-3 p-4 md:flex-row md:items-center">
            <span className="label shrink-0">Reference</span>
            <select className="input" value={refId} onChange={(e) => setParams({ ref: e.target.value })}>
              {refs.data?.items.map((r) => <option key={r.id} value={r.id}>{(r.title || r.transcript || r.filename)?.slice(0, 90)}</option>)}
            </select>
          </div>

          {ref.data?.features && (
            <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
              <Card title="Target delivery" action={<ContourBadge contour={ref.data.features.final_contour} />}>
                <div className="mb-4 flex items-center gap-4">
                  <button type="button" onClick={player.toggle} className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-pitch text-white shadow-[0_0_30px_-6px_rgba(139,123,255,0.9)]">
                    <Play className="ml-0.5 h-5 w-5 fill-white" />
                  </button>
                  <div className="text-xl font-semibold leading-snug">
                    {ref.data.features.words.length ? ref.data.features.words.map((w, i) => (
                      <span key={i} className={w.emphasis_candidate ? "text-emph underline decoration-2 underline-offset-4" : ""}>{w.word} </span>
                    )) : ref.data.transcript}
                  </div>
                </div>
                <ContourOverlay height={200} series={[{ name: "ref", contours: refContours(ref.data.features), color: "#9aa2c0" }]} />
              </Card>
              <Card title="Your progress" icon={<Trophy className="h-4 w-4" />}>
                {done.length ? (
                  <div className="flex items-center gap-6">
                    <ScoreRing value={best} label="best" />
                    <div className="flex-1 space-y-1.5">
                      {done.slice(-6).reverse().map((a) => (
                        <Link key={a.id} to={`/a/${a.id}`} className="flex items-center justify-between rounded-lg px-2 py-1 text-sm hover:bg-white/5">
                          <span className="text-ink-400">{timeAgo(a.created_at)}</span>
                          <span className="font-mono font-semibold">{Math.round(a.drill_score!)}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                ) : <div className="text-sm text-ink-400">No attempts yet. Record one below.</div>}
              </Card>
            </div>
          )}

          {refId && <RecorderPanel onPicked={(p) => submit.mutate(p)} busy={submit.isPending} compact />}
          {submit.isPending && <div className="flex items-center gap-2 text-sm text-ink-300"><Spinner /> scoring…</div>}
        </>
      )}
    </div>
  );
}

// Build a display contour from full features (same normalisation the server uses for drills).
function refContours(f: NonNullable<Awaited<ReturnType<typeof api.get>>["features"]>) {
  const { time, rms, pitch_hz, threshold } = f.curves;
  const act = rms.map((r, i) => (r > threshold ? i : -1)).filter((i) => i >= 0);
  const s = act[0] ?? 0, e = act[act.length - 1] ?? time.length - 1;
  const voiced = pitch_hz.slice(s, e + 1).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const med = voiced[Math.floor(voiced.length / 2)] || 1;
  const N = 120, pitch: number[] = [], energy: number[] = [], vflag: boolean[] = [];
  const maxR = Math.max(...rms.slice(s, e + 1), 1e-6);
  for (let k = 0; k < N; k++) {
    const i = Math.round(s + (k / (N - 1)) * (e - s));
    const p = pitch_hz[i];
    pitch.push(p ? 12 * Math.log2(p / med) : 0);
    vflag.push(p !== null);
    energy.push(rms[i] / maxR);
  }
  return { pitch, energy, voiced: vflag };
}
