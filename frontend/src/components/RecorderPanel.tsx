import clsx from "clsx";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, Square, Upload, TrendingUp, TrendingDown, MoveRight } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { useRecorder } from "../hooks/useRecorder";
import { mmss } from "../lib/format";
import { noteName, recentSlope } from "../lib/pitch";
import { LivePitchCanvas } from "./LivePitchCanvas";

export interface Picked { blob: Blob; filename: string }

const ACCEPT = ".wav,.mp3,.m4a,.ogg,.flac,.webm,.aiff,.aif,.mp4,.aac,.opus";

/** Big record orb + live pitch trail + drag-and-drop. Calls onPicked with audio. */
export function RecorderPanel({ onPicked, busy, compact, prompt }: {
  onPicked: (p: Picked) => void; busy?: boolean; compact?: boolean; prompt?: string;
}) {
  const rec = useRecorder();
  const [readout, setReadout] = useState<{ f: number | null; slope: number | null; level: number }>({ f: null, slope: null, level: 0 });
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const recording = rec.state === "recording";

  // throttle the numeric readouts to ~12 fps (the canvas runs at full rate)
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => {
      setReadout({ f: rec.live.current.f, level: rec.live.current.level, slope: recentSlope(rec.samples.current) });
    }, 80);
    return () => clearInterval(id);
  }, [recording, rec.live, rec.samples]);

  const toggle = async () => {
    if (recording) {
      const r = await rec.stop();
      if (r) onPicked({ blob: r.blob, filename: r.filename });
    } else {
      rec.start();
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onPicked({ blob: f, filename: f.name });
  };

  const slope = readout.slope;
  const cue = slope === null ? null : slope > 4 ? "rising" : slope < -4 ? "falling" : "level";
  const orb = compact ? 72 : 104;

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={onDrop}
      className={clsx("glass relative overflow-hidden transition", drag && "ring-2 ring-pitch/60")}
    >
      {prompt && (
        <div className="border-b border-white/5 px-6 py-4 text-center text-lg font-medium text-ink-100">
          <span className="label mr-2">Read aloud</span>“{prompt}”
        </div>
      )}
      <div className={clsx("grid items-center gap-6 p-6", compact ? "md:grid-cols-[auto_1fr]" : "md:grid-cols-[auto_1fr]")}>
        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={toggle}
            disabled={busy || rec.state === "requesting"}
            className="relative grid place-items-center rounded-full text-white transition disabled:opacity-50"
            style={{ width: orb, height: orb }}
            aria-label={recording ? "Stop recording" : "Start recording"}
          >
            {recording && (
              <>
                <span className="pulse-ring absolute inset-0 rounded-full bg-pause/40" />
                <span className="absolute inset-0 rounded-full bg-pause/20" style={{ transform: `scale(${1 + Math.min(readout.level * 8, 0.5)})`, transition: "transform 80ms" }} />
              </>
            )}
            <span
              className="absolute inset-0 rounded-full"
              style={{
                background: recording ? "radial-gradient(circle at 30% 30%, #ff8aa3, #ff4d73 60%, #c2234a)" : "radial-gradient(circle at 30% 30%, #b4a9ff, #8b7bff 55%, #4f3fd6)",
                boxShadow: recording ? "0 0 50px -6px rgba(255,77,115,0.8)" : "0 0 60px -10px rgba(139,123,255,0.9)",
              }}
            />
            <span className="relative">{recording ? <Square className="h-7 w-7 fill-white" /> : <Mic className="h-8 w-8" />}</span>
          </button>
          <div className="font-mono text-sm text-ink-300">{recording ? mmss(rec.elapsed) : rec.state === "requesting" ? "allow mic…" : "tap to record"}</div>
        </div>

        <div className="relative min-w-0">
          <LivePitchCanvas samples={rec.samples} active={recording} height={compact ? 130 : 200} />
          <AnimatePresence>
            {!recording && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl bg-ink-850/70 text-center backdrop-blur-[2px]">
                <div className="text-sm text-ink-300">
                  {rec.error ? <span className="text-pause">{rec.error}</span> : <>Your pitch is drawn live as you speak. <span className="text-ink-400">Or drop an audio file here.</span></>}
                </div>
                <button type="button" className="btn-ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
                  <Upload className="h-4 w-4" /> Upload audio
                </button>
              </motion.div>
            )}
          </AnimatePresence>
          {recording && (
            <div className="pointer-events-none absolute right-2 top-2 flex gap-2">
              <span className="chip font-mono">{readout.f ? `${readout.f.toFixed(0)} Hz · ${noteName(readout.f)}` : "– Hz"}</span>
              {cue && (
                <span className={clsx("chip", cue === "rising" ? "text-rise" : cue === "falling" ? "text-emph" : "")}>
                  {cue === "rising" ? <TrendingUp className="h-3 w-3" /> : cue === "falling" ? <TrendingDown className="h-3 w-3" /> : <MoveRight className="h-3 w-3" />}
                  {cue}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      <input ref={fileRef} type="file" accept={ACCEPT} className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPicked({ blob: f, filename: f.name }); e.target.value = ""; }} />
    </div>
  );
}
