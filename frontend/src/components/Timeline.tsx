import { Pause, Play } from "lucide-react";
import { useMemo, useState, type MouseEvent } from "react";
import { useSize } from "../hooks/useSize";
import type { Player } from "../hooks/usePlayer";
import { mmss } from "../lib/format";
import type { Features } from "../lib/types";

const H = 330;
const PITCH_TOP = 28, PITCH_BOTTOM = 190;
const EN_TOP = 205, EN_BOTTOM = 262;
const WORD_Y = 276, WORD_H = 30;

/** Interactive prosody timeline: pitch contour, energy, pauses, word lane, synced playhead. */
export function Timeline({ features, player }: { features: Features; player: Player }) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const cv = features.curves;
  const dur = features.duration_seconds || cv.time[cv.time.length - 1] || 1;
  const W = Math.max(width, 200);
  const padL = 44, padR = 12;
  const x = (t: number) => padL + (t / dur) * (W - padL - padR);
  const tOf = (px: number) => Math.max(0, Math.min(dur, ((px - padL) / (W - padL - padR)) * dur));

  const { pitchPaths, energyPath, yP, ticks } = useMemo(() => {
    const voiced = cv.pitch_hz.filter((v): v is number => v !== null);
    const lo = voiced.length ? Math.min(...voiced) * 0.88 : 80;
    const hi = voiced.length ? Math.max(...voiced) * 1.08 : 300;
    const yP = (f: number) => PITCH_BOTTOM - (Math.log2(f / lo) / Math.log2(hi / lo)) * (PITCH_BOTTOM - PITCH_TOP);
    const paths: string[] = [];
    let cur = "", prev: number | null = null;
    cv.pitch_hz.forEach((f, i) => {
      if (f === null || (prev !== null && Math.abs(Math.log2(f / prev)) > 0.3)) {
        if (cur) paths.push(cur);
        cur = f === null ? "" : `M${x(cv.time[i]).toFixed(1)},${yP(f).toFixed(1)}`;
        prev = f;
        return;
      }
      cur += `${cur ? "L" : "M"}${x(cv.time[i]).toFixed(1)},${yP(f).toFixed(1)}`;
      prev = f;
    });
    if (cur) paths.push(cur);

    const maxR = Math.max(...cv.rms, 1e-6);
    const pts = cv.rms.map((r, i) => `${x(cv.time[i]).toFixed(1)},${(EN_BOTTOM - (r / maxR) * (EN_BOTTOM - EN_TOP)).toFixed(1)}`);
    const energyPath = pts.length ? `M${x(0)},${EN_BOTTOM}L${pts.join("L")}L${x(cv.time[cv.time.length - 1])},${EN_BOTTOM}Z` : "";

    const ticks = [100, 150, 200, 250, 300, 400].filter((f) => f > lo && f < hi);
    return { pitchPaths: paths, energyPath, yP, ticks };
  }, [cv, W, dur]);

  const hoverInfo = useMemo(() => {
    if (hover === null) return null;
    const i = Math.min(cv.time.length - 1, Math.max(0, Math.round((hover / dur) * (cv.time.length - 1))));
    const word = features.words.find((w) => hover >= w.start && hover <= w.end);
    return { t: hover, f: cv.pitch_hz[i], word };
  }, [hover, cv, dur, features.words]);

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHover(tOf(e.clientX - r.left));
  };

  const timeTicks = useMemo(() => {
    const step = dur > 20 ? 5 : dur > 8 ? 2 : dur > 3 ? 1 : 0.5;
    const out: number[] = [];
    for (let t = 0; t <= dur + 1e-6; t += step) out.push(t);
    return out;
  }, [dur]);

  return (
    <div className="glass overflow-hidden">
      <div className="flex items-center gap-3 border-b border-white/5 px-4 py-3">
        <button type="button" onClick={player.toggle} disabled={!player.ready}
          className="grid h-9 w-9 place-items-center rounded-full bg-pitch text-white shadow-[0_0_24px_-4px_rgba(139,123,255,0.9)] transition hover:brightness-110 disabled:opacity-40">
          {player.playing ? <Pause className="h-4 w-4 fill-white" /> : <Play className="ml-0.5 h-4 w-4 fill-white" />}
        </button>
        <div className="font-mono text-sm text-ink-300">{mmss(player.t)} / {mmss(dur)}</div>
        <div className="ml-auto flex flex-wrap items-center gap-3 text-xs text-ink-400">
          <Legend color="var(--color-pitch)" label="pitch" />
          <Legend color="var(--color-energy)" label="energy" />
          <Legend color="var(--color-pause)" label="pause" />
          <Legend color="var(--color-emph)" label="emphasis" />
        </div>
      </div>
      <div ref={ref} className="relative">
        {width > 0 && (
          <svg width={W} height={H} className="block cursor-crosshair select-none" onMouseMove={onMove}
            onMouseLeave={() => setHover(null)} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); player.seek(tOf(e.clientX - r.left)); }}>
            <defs>
              <linearGradient id="en-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#2fd6b0" stopOpacity="0.55" />
                <stop offset="1" stopColor="#2fd6b0" stopOpacity="0.02" />
              </linearGradient>
              <filter id="glow" x="-10%" y="-50%" width="120%" height="200%">
                <feGaussianBlur stdDeviation="3" result="b" />
                <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>

            {ticks.map((f) => (
              <g key={f}>
                <line x1={padL} x2={W - padR} y1={yP(f)} y2={yP(f)} stroke="rgba(255,255,255,0.05)" />
                <text x={padL - 6} y={yP(f) + 3} textAnchor="end" className="fill-ink-400 font-mono text-[10px]">{f}</text>
              </g>
            ))}
            <text x={6} y={PITCH_TOP - 10} className="fill-ink-400 text-[10px] font-semibold uppercase tracking-widest">Hz</text>

            {features.pauses.map((p, i) => (
              <rect key={i} x={x(p.start)} width={Math.max(2, x(p.end) - x(p.start))} y={PITCH_TOP - 8} height={EN_BOTTOM - PITCH_TOP + 8}
                className="fill-pause/10" />
            ))}

            {features.words.map((w, i) => (
              <line key={i} x1={x(w.start)} x2={x(w.start)} y1={PITCH_TOP} y2={EN_BOTTOM} stroke="rgba(255,255,255,0.04)" />
            ))}

            <path d={energyPath} fill="url(#en-grad)" stroke="#2fd6b0" strokeOpacity={0.7} strokeWidth={1} />
            <g filter="url(#glow)">
              {pitchPaths.map((d, i) => (
                <path key={i} d={d} fill="none" stroke="#8b7bff" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
              ))}
            </g>

            {features.words.map((w, i) => {
              const x0 = x(w.start), x1 = x(w.end), wpx = Math.max(3, x1 - x0 - 2);
              const a = Math.max(0, Math.min(1, w.emphasis_score / 2));
              const active = player.t >= w.start && player.t <= w.end;
              return (
                <g key={i} onClick={(e) => { e.stopPropagation(); player.playRange(w.start, w.end); }} className="cursor-pointer">
                  <rect x={x0 + 1} y={WORD_Y} width={wpx} height={WORD_H} rx={6}
                    fill={w.emphasis_candidate ? `rgba(255,181,71,${0.25 + a * 0.4})` : `rgba(139,123,255,${0.08 + a * 0.25})`}
                    stroke={active ? "#fff" : w.emphasis_candidate ? "#ffb547" : "rgba(255,255,255,0.08)"} strokeWidth={active ? 1.5 : 1} />
                  {wpx > 18 && (
                    <text x={x0 + 1 + wpx / 2} y={WORD_Y + 19} textAnchor="middle"
                      className={w.emphasis_candidate ? "fill-white text-[11px] font-semibold" : "fill-ink-200 text-[11px]"}>
                      {truncate(w.word, Math.floor(wpx / 6.5))}
                    </text>
                  )}
                </g>
              );
            })}

            {timeTicks.map((t) => (
              <text key={t} x={x(t)} y={H - 6} textAnchor="middle" className="fill-ink-400 font-mono text-[9px]">{t.toFixed(t % 1 ? 1 : 0)}s</text>
            ))}

            {hoverInfo && (
              <line x1={x(hoverInfo.t)} x2={x(hoverInfo.t)} y1={PITCH_TOP - 8} y2={WORD_Y + WORD_H} stroke="rgba(255,255,255,0.25)" strokeDasharray="3 3" />
            )}
            <line x1={x(player.t)} x2={x(player.t)} y1={PITCH_TOP - 12} y2={WORD_Y + WORD_H} stroke="#fff" strokeWidth={1.5} />
            <circle cx={x(player.t)} cy={PITCH_TOP - 12} r={4} fill="#fff" />
          </svg>
        )}
        {hoverInfo && (
          <div className="pointer-events-none absolute top-2 rounded-lg border border-white/10 bg-ink-900/95 px-3 py-2 text-xs shadow-xl"
            style={{ left: Math.min(Math.max(x(hoverInfo.t) + 10, 0), W - 190) }}>
            <div className="font-mono text-ink-300">{hoverInfo.t.toFixed(2)}s · {hoverInfo.f ? `${hoverInfo.f.toFixed(0)} Hz` : "unvoiced"}</div>
            {hoverInfo.word && (
              <div className="mt-1">
                <span className="font-semibold text-white">{hoverInfo.word.word}</span>
                <span className="ml-2 text-ink-400">emphasis {hoverInfo.word.emphasis_score >= 0 ? "+" : ""}{hoverInfo.word.emphasis_score.toFixed(2)}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: color }} />{label}</span>;
}

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, Math.max(1, n - 1)) + "…" : s);
