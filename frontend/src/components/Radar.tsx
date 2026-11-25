import { SERIES } from "../lib/format";

export interface RadarSeries { name: string; values: number[]; color?: string }

/** Prosodic fingerprint radar. `labels` length must match each series. */
export function Radar({ labels, series, size = 300, mini = false }: { labels: string[]; series: RadarSeries[]; size?: number; mini?: boolean }) {
  const n = labels.length;
  const c = size / 2, r = c - (mini ? 6 : 54);
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return [c + Math.cos(a) * r * v, c + Math.sin(a) * r * v] as const;
  };
  const poly = (vals: number[]) => vals.map((v, i) => pt(i, Math.max(0.03, v)).join(",")).join(" ");

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="overflow-visible">
      {[0.25, 0.5, 0.75, 1].map((k) => (
        <polygon key={k} points={poly(Array(n).fill(k))} fill="none" stroke="rgba(255,255,255,0.07)" />
      ))}
      {!mini && labels.map((_, i) => {
        const [x, y] = pt(i, 1);
        return <line key={i} x1={c} y1={c} x2={x} y2={y} stroke="rgba(255,255,255,0.05)" />;
      })}
      {series.map((s, si) => {
        const color = s.color ?? SERIES[si % SERIES.length];
        return (
          <g key={s.name}>
            <polygon points={poly(s.values)} fill={color} fillOpacity={mini ? 0.3 : 0.16} stroke={color} strokeWidth={mini ? 1.2 : 2}
              strokeLinejoin="round" style={{ filter: mini ? undefined : `drop-shadow(0 0 8px ${color}88)` }} />
            {!mini && s.values.map((v, i) => {
              const [x, y] = pt(i, Math.max(0.03, v));
              return <circle key={i} cx={x} cy={y} r={3} fill={color} />;
            })}
          </g>
        );
      })}
      {!mini && labels.map((l, i) => {
        const [x, y] = pt(i, 1.17);
        return <text key={l} x={x} y={y} textAnchor="middle" dominantBaseline="middle" className="fill-ink-300 text-[10.5px] font-medium">{l}</text>;
      })}
    </svg>
  );
}
