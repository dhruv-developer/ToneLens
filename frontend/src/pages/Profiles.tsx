import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Plus, RotateCcw, Trash2, UserRound } from "lucide-react";
import { useState } from "react";
import { RecorderPanel, type Picked } from "../components/RecorderPanel";
import { Card, Empty, PageHeader, Spinner, Stat } from "../components/ui";
import { api, subscribeProgress } from "../lib/api";
import { fmt, pct } from "../lib/format";
import type { Profile } from "../lib/types";

const PROMPTS = [
  "The train leaves at seven tomorrow morning.",
  "कल सुबह ट्रेन सात बजे निकलेगी।",
  "Main office jaa raha hoon, shaam ko milte hain.",
  "Please put the files on the table near the window.",
  "The weather has been quite mild this week.",
];

export default function Profiles() {
  const qc = useQueryClient();
  const profiles = useQuery({ queryKey: ["profiles"], queryFn: api.profiles });
  const [name, setName] = useState("");
  const [active, setActive] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.createProfile(name),
    onSuccess: (p) => { setName(""); setActive(p.id); qc.invalidateQueries({ queryKey: ["profiles"] }); },
  });
  const current = profiles.data?.find((p) => p.id === active) ?? profiles.data?.[0];

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Voice profiles" title="Calibrate to your normal">
        A naturally expressive speaker and a naturally flat one shouldn't be judged by the same thresholds. Record a few neutral sentences; analyses that use the profile are then reported relative to your baseline (e.g. “+3 st above your usual pitch, 1.3× your usual pace”).
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <div className="space-y-3">
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}>
            <input className="input" placeholder="New profile name" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn-primary px-3" disabled={!name.trim() || create.isPending}><Plus className="h-4 w-4" /></button>
          </form>
          {profiles.data?.map((p) => (
            <button key={p.id} type="button" onClick={() => setActive(p.id)}
              className={clsx("glass flex w-full items-center gap-3 p-3 text-left transition", current?.id === p.id && "ring-2 ring-pitch/60")}>
              <div className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-pitch to-energy font-bold text-white">{p.name[0]?.toUpperCase()}</div>
              <div>
                <div className="font-semibold">{p.name}</div>
                <div className="text-xs text-ink-400">{p.baseline ? `${p.baseline.n} baseline recording(s)` : "not calibrated"}</div>
              </div>
            </button>
          ))}
        </div>
        {current ? <ProfileDetail key={current.id} p={current} /> : (
          <Empty icon={<UserRound className="h-8 w-8" />} title="Create a profile to start">Profiles store only aggregate measurements (median pitch, range, pace, loudness, pausing), not audio.</Empty>
        )}
      </div>
    </div>
  );
}

function ProfileDetail({ p }: { p: Profile }) {
  const qc = useQueryClient();
  const [promptIdx, setPromptIdx] = useState((p.baseline?.n ?? 0) % PROMPTS.length);
  const [status, setStatus] = useState<string | null>(null);

  const record = useMutation({
    mutationFn: async (pk: Picked) => {
      const { id } = await api.upload(pk.blob, pk.filename, { kind: "baseline", profileId: p.id, title: `Baseline · ${p.name}` });
      setStatus("analysing…");
      await new Promise<void>((resolve) => subscribeProgress(id, (e) => {
        setStatus(e.stage);
        if (e.status === "done" || e.status === "failed") { setStatus(e.status === "failed" ? `failed: ${e.error}` : null); resolve(); }
      }));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["profiles"] }); setPromptIdx((i) => (i + 1) % PROMPTS.length); },
  });
  const reset = useMutation({ mutationFn: () => api.resetProfile(p.id), onSuccess: () => qc.invalidateQueries({ queryKey: ["profiles"] }) });
  const del = useMutation({ mutationFn: () => api.deleteProfile(p.id), onSuccess: () => qc.invalidateQueries({ queryKey: ["profiles"] }) });

  const b = p.baseline;
  return (
    <div className="space-y-6">
      <Card title={`${p.name}'s baseline`} action={
        <div className="flex gap-2">
          <button type="button" className="btn-ghost py-1 text-xs" onClick={() => reset.mutate()} disabled={!b}><RotateCcw className="h-3.5 w-3.5" /> Reset</button>
          <button type="button" className="btn-danger py-1 text-xs" onClick={() => confirm(`Delete profile ${p.name}?`) && del.mutate()}><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      }>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="Recordings" value={b?.n ?? 0} sub={b && b.n < 3 ? "3+ recommended" : undefined} />
          <Stat label="Usual pitch" value={fmt(b?.pitch_median_hz, 0, " Hz")} accent="#b4a9ff" />
          <Stat label="Usual range" value={fmt(b?.pitch_range_semitones, 1, " st")} accent="#b4a9ff" />
          <Stat label="Usual pace" value={fmt(b?.speaking_rate_wps, 2, " w/s")} accent="#2fd6b0" />
          <Stat label="Usual pausing" value={pct(b?.pause_ratio)} accent="#ff6b8a" />
        </div>
      </Card>
      <RecorderPanel compact prompt={PROMPTS[promptIdx]} onPicked={(pk) => record.mutate(pk)} busy={record.isPending} />
      <div className="flex items-center justify-between text-sm text-ink-400">
        <span>Read the sentence in your normal, neutral voice. Each recording refines the baseline.</span>
        {(record.isPending || status) && <span className="flex items-center gap-2 text-ink-200"><Spinner /> {status ?? "uploading…"}</span>}
      </div>
      <button type="button" className="text-xs text-pitch hover:underline" onClick={() => setPromptIdx((i) => (i + 1) % PROMPTS.length)}>Different sentence →</button>
    </div>
  );
}
