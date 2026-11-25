import { useCallback, useEffect, useRef, useState } from "react";
import { detectPitch, rms } from "../lib/pitch";

export interface LiveSample { t: number; f: number | null; level: number }

export interface Recording { blob: Blob; filename: string; duration: number; url: string }

function pickMime(): { mime: string; ext: string } {
  const opts = [
    { mime: "audio/webm;codecs=opus", ext: ".webm" },
    { mime: "audio/webm", ext: ".webm" },
    { mime: "audio/mp4", ext: ".m4a" },
    { mime: "audio/ogg;codecs=opus", ext: ".ogg" },
  ];
  return opts.find((o) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(o.mime)) ?? { mime: "", ext: ".webm" };
}

/** Mic capture + live pitch/level analysis.
 *  Browser auto-gain, noise suppression and echo cancellation are switched off:
 *  they flatten exactly the loudness dynamics ToneLens is trying to measure. */
export function useRecorder(maxSeconds = 120) {
  const [state, setState] = useState<"idle" | "requesting" | "recording" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const samples = useRef<LiveSample[]>([]);
  const live = useRef<{ f: number | null; level: number }>({ f: null, level: 0 });

  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const rafRef = useRef<number>(0);
  const tickRef = useRef<number>(0);
  const startRef = useRef(0);
  const resolveRef = useRef<((r: Recording | null) => void) | null>(null);

  const cleanup = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    clearInterval(tickRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    streamRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async () => {
    setError(null);
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      });
      streamRef.current = stream;
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      src.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);

      const { mime, ext } = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" });
        const duration = (performance.now() - startRef.current) / 1000;
        cleanup();
        setState("idle");
        resolveRef.current?.(
          blob.size ? { blob, filename: `recording-${Date.now()}${ext}`, duration, url: URL.createObjectURL(blob) } : null,
        );
        resolveRef.current = null;
      };
      recRef.current = rec;
      samples.current = [];
      startRef.current = performance.now();
      rec.start(250);
      setState("recording");
      setElapsed(0);

      const loop = () => {
        analyser.getFloatTimeDomainData(buf);
        const level = rms(buf);
        const f = detectPitch(buf, ctx.sampleRate);
        const t = (performance.now() - startRef.current) / 1000;
        live.current = { f, level };
        samples.current.push({ t, f, level });
        if (samples.current.length > 2400) samples.current.splice(0, 600);
        rafRef.current = requestAnimationFrame(loop);
      };
      loop();
      tickRef.current = window.setInterval(() => {
        const t = (performance.now() - startRef.current) / 1000;
        setElapsed(t);
        if (t >= maxSeconds && rec.state === "recording") rec.stop();
      }, 100);
    } catch (e) {
      cleanup();
      setState("error");
      setError(e instanceof Error ? e.message : "Microphone unavailable");
    }
  }, [cleanup, maxSeconds]);

  /** Stop and resolve with the recording. */
  const stop = useCallback(
    () =>
      new Promise<Recording | null>((resolve) => {
        const rec = recRef.current;
        if (!rec || rec.state !== "recording") return resolve(null);
        resolveRef.current = resolve;
        rec.stop();
      }),
    [],
  );

  return { state, error, elapsed, samples, live, start, stop };
}
