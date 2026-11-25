import { useSize } from "../hooks/useSize";
import { SERIES } from "../lib/format";
import type { Contours } from "../lib/types";

/** Time- and speaker-normalised pitch contours drawn on one axis (semitones vs own median). */
export function ContourOverlay({ series, height = 240 }: { series: { name: string; contours: Contours; color?: string }[]; height?: number }) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const all = series.flatMap((s) => s.contours.pitch);
  const lo = Math.min(-4, ...all) - 1, hi = Math.max(4, ...all) + 1;
  const W = Math.max(width, 200), padL = 34, padB = 20;
  const y = (v: number) => 10 + (1 - (v - lo) / (hi - lo)) * (height - 10 - padB);
  const x = (i: number, n: number) => padL + (i / (n - 1)) * (W - padL - 8);

  const path = (c: Contours) => {
    let d = "", pen = false, prev = 0;
    c.pitch.forEach((v, i) => {
      // break on unvoiced frames and on implausible jumps (likely octave errors)
      if (!c.voiced[i] || (pen && Math.abs(v - prev) > 4)) { pen = false; prev = v; if (!c.voiced[i]) return; }
      d += `${pen ? "L" : "M"}${x(i, c.pitch.length).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
      prev = v;
    });
    return d;
  };
  const energy = (c: Contours) =>
    `M${x(0, c.energy.length)},${height - padB}` + c.energy.map((e, i) => `L${x(i, c.energy.length).toFixed(1)},${(height - padB - e * 36).toFixed(1)}`).join("") + `L${x(c.energy.length - 1, c.energy.length)},${height - padB}Z`;

  const grid = [-6, -3, 0, 3, 6, 9, 12].filter((v) => v > lo && v < hi);
  return (
    <div ref={ref}>
      {width > 0 && (
        <svg width={W} height={height}>
          {grid.map((g) => (
            <g key={g}>
              <line x1={padL} x2={W - 8} y1={y(g)} y2={y(g)} stroke={g === 0 ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.05)"} />
              <text x={padL - 6} y={y(g) + 3} textAnchor="end" className="fill-ink-400 font-mono text-[9px]">{g > 0 ? `+${g}` : g}</text>
            </g>
          ))}
          {series.map((s, i) => (
            <path key={`e${s.name}`} d={energy(s.contours)} fill={s.color ?? SERIES[i % SERIES.length]} fillOpacity={0.07} />
          ))}
          {series.map((s, i) => (
            <path key={s.name} d={path(s.contours)} fill="none" stroke={s.color ?? SERIES[i % SERIES.length]} strokeWidth={2.4}
              strokeLinecap="round" strokeLinejoin="round" style={{ filter: `drop-shadow(0 0 6px ${(s.color ?? SERIES[i % SERIES.length])}88)` }} />
          ))}
          <text x={padL} y={height - 4} className="fill-ink-400 text-[9px]">start</text>
          <text x={W - 8} y={height - 4} textAnchor="end" className="fill-ink-400 text-[9px]">end (time-normalised)</text>
        </svg>
      )}
    </div>
  );
}
