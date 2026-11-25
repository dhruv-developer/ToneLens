import { useCallback, useEffect, useRef, useState } from "react";

/** Shared audio player state so the timeline, transcript and word table stay in sync. */
export function usePlayer(url: string | null | undefined) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const stopAt = useRef<number | null>(null);

  useEffect(() => {
    if (!url) return;
    const a = new Audio(url);
    a.preload = "auto";
    audio.current = a;
    let raf = 0;
    const tick = () => {
      setT(a.currentTime);
      if (stopAt.current !== null && a.currentTime >= stopAt.current) {
        a.pause();
        stopAt.current = null;
      }
      if (!a.paused) raf = requestAnimationFrame(tick);
    };
    const onPlay = () => { setPlaying(true); raf = requestAnimationFrame(tick); };
    const onPause = () => { setPlaying(false); setT(a.currentTime); cancelAnimationFrame(raf); };
    const onTime = () => setT(a.currentTime);  // fallback when rAF is throttled
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onPause);
    a.addEventListener("timeupdate", onTime);
    return () => {
      cancelAnimationFrame(raf);
      a.pause();
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onPause);
      a.removeEventListener("timeupdate", onTime);
      audio.current = null;
    };
  }, [url]);

  const toggle = useCallback(() => {
    const a = audio.current;
    if (!a) return;
    stopAt.current = null;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  }, []);

  const seek = useCallback((time: number, play = true) => {
    const a = audio.current;
    if (!a) return;
    stopAt.current = null;
    a.currentTime = Math.max(0, time);
    setT(a.currentTime);
    if (play) a.play().catch(() => {});
  }, []);

  const playRange = useCallback((start: number, end: number) => {
    const a = audio.current;
    if (!a) return;
    a.currentTime = Math.max(0, start - 0.05);
    stopAt.current = end + 0.08;
    a.play().catch(() => {});
  }, []);

  return { t, playing, toggle, seek, playRange, ready: !!url };
}

export type Player = ReturnType<typeof usePlayer>;
