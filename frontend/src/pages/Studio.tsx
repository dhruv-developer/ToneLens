import { useMutation, useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowRight, Settings2, Sparkles } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AnalysisCard } from "../components/AnalysisCard";
import { RecorderPanel, type Picked } from "../components/RecorderPanel";
import { Spinner } from "../components/ui";
import { api } from "../lib/api";

const LANGS = [
  { v: "", l: "Auto-detect" }, { v: "en", l: "English" }, { v: "hi", l: "Hindi / Hinglish" }, { v: "ur", l: "Urdu" },
  { v: "bn", l: "Bengali" }, { v: "ta", l: "Tamil" }, { v: "es", l: "Spanish" }, { v: "fr", l: "French" },
];

const EXAMPLES = [
  { delivery: "High energy, wide pitch", reading: "Genuine excitement?", color: "#2fd6b0" },
  { delivery: "Flat, low energy", reading: "Neutral acknowledgement?", color: "#9aa2c0" },
  { delivery: "Hard stress on “exactly”", reading: "Insistence, or irony?", color: "#ffb547" },
];

export default function Studio() {
  const nav = useNavigate();
  const config = useQuery({ queryKey: ["config"], queryFn: api.config });
  const profiles = useQuery({ queryKey: ["profiles"], queryFn: api.profiles });
  const recent = useQuery({ queryKey: ["analyses", "recent"], queryFn: () => api.list({ limit: 4 }) });

  const [context, setContext] = useState("");
  const [profileId, setProfileId] = useState("");
  const [model, setModel] = useState("");
  const [language, setLanguage] = useState("");
  const [showOpts, setShowOpts] = useState(false);

  const upload = useMutation({
    mutationFn: (p: Picked) => api.upload(p.blob, p.filename, {
      context, profileId: profileId || null, modelSize: model || undefined, language: language || null,
    }),
    onSuccess: ({ id }) => nav(`/a/${id}`),
  });

  return (
    <div className="space-y-12">
      <section className="pt-4 text-center">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="chip mx-auto mb-5 border-pitch/30 text-pitch">
          <Sparkles className="h-3 w-3" /> multilingual · prosody-aware · speaker-normalised
        </motion.div>
        <motion.h1 initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className="mx-auto max-w-4xl text-4xl font-extrabold leading-[1.05] tracking-tight md:text-6xl">
          The words say <span className="text-ink-400">what.</span><br />
          <span className="text-gradient">The voice says how.</span>
        </motion.h1>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }} className="mx-auto mt-5 max-w-2xl text-lg text-ink-300">
          Speak in English, Hindi or Hinglish. ToneLens transcribes you, measures pitch, energy, pauses and emphasis word by word, and flags when your delivery and your words point different ways.
        </motion.p>
      </section>

      <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="mx-auto max-w-5xl space-y-3">
        <RecorderPanel onPicked={(p) => upload.mutate(p)} busy={upload.isPending} />
        <div className="glass p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <input className="input" placeholder="Context (optional): what was said before this? Helps the interpretation."
              value={context} onChange={(e) => setContext(e.target.value)} />
            <select className="input md:w-56" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
              <option value="">No voice profile</option>
              {profiles.data?.map((p) => <option key={p.id} value={p.id}>{p.name}{p.baseline ? ` · ${p.baseline.n} baseline` : " · uncalibrated"}</option>)}
            </select>
            <button type="button" className="btn-ghost shrink-0" onClick={() => setShowOpts((v) => !v)}><Settings2 className="h-4 w-4" /> ASR</button>
          </div>
          {showOpts && (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <select className="input" value={model} onChange={(e) => setModel(e.target.value)}>
                <option value="">Whisper model: {config.data?.default_model ?? "base"} (default)</option>
                {config.data?.whisper_models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <select className="input" value={language} onChange={(e) => setLanguage(e.target.value)}>
                {LANGS.map((l) => <option key={l.v} value={l.v}>{l.l}</option>)}
              </select>
            </div>
          )}
          {upload.isPending && <div className="mt-3 flex items-center gap-2 text-sm text-ink-300"><Spinner /> Uploading…</div>}
          {upload.error && <div className="mt-3 text-sm text-pause">{(upload.error as Error).message}</div>}
        </div>
      </motion.section>

      <section className="mx-auto max-w-5xl">
        <div className="label mb-3">The experiment · same words, different delivery</div>
        <div className="grid gap-3 md:grid-cols-3">
          {EXAMPLES.map((e) => (
            <div key={e.delivery} className="glass p-4">
              <div className="text-lg font-semibold text-white">“That’s exactly what I wanted.”</div>
              <div className="mt-3 text-sm" style={{ color: e.color }}>{e.delivery}</div>
              <div className="text-sm text-ink-400">→ {e.reading}</div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-sm text-ink-400">
          Record all three, then open <Link to="/compare" className="text-pitch hover:underline">Compare</Link> to overlay their contours and fingerprints. ToneLens reports observable delivery and qualified hypotheses. It is not an emotion detector.
        </p>
      </section>

      {!!recent.data?.items.length && (
        <section className="mx-auto max-w-5xl">
          <div className="mb-3 flex items-center justify-between">
            <div className="label">Recent</div>
            <Link to="/library" className="flex items-center gap-1 text-sm text-pitch hover:underline">Library <ArrowRight className="h-3.5 w-3.5" /></Link>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {recent.data.items.map((a) => <AnalysisCard key={a.id} a={a} />)}
          </div>
        </section>
      )}
    </div>
  );
}
