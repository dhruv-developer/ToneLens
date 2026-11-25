import { useQuery } from "@tanstack/react-query";
import { GitCompare } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { ContourOverlay } from "../components/ContourOverlay";
import { Radar } from "../components/Radar";
import { Card, ContourBadge, Empty, PageHeader, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { fmt, pct, SERIES } from "../lib/format";

export default function Compare() {
  const [params] = useSearchParams();
  const ids = (params.get("ids") ?? "").split(",").filter(Boolean);
  const q = useQuery({ queryKey: ["compare", ids], queryFn: () => api.compare(ids), enabled: ids.length >= 2 });

  if (ids.length < 2) {
    return (
      <div>
        <PageHeader eyebrow="Compare" title="Same words, different delivery" />
        <Empty icon={<GitCompare className="h-8 w-8" />} title="Pick at least two recordings">
          Go to the <Link className="text-pitch hover:underline" to="/library">Library</Link>, select 2–6 cards, and press Compare.
        </Empty>
      </div>
    );
  }
  if (q.isLoading) return <div className="grid h-64 place-items-center"><Spinner className="h-6 w-6" /></div>;
  if (q.error || !q.data) return <div className="text-pause">{(q.error as Error)?.message}</div>;

  const items = q.data.items;
  const name = (i: number) => items[i].title || `#${i + 1} ${items[i].transcript?.slice(0, 28) ?? items[i].filename}`;
  const dims = items[0].fingerprint_detail.dims.map((d) => d.label);
  const rows: [string, (it: (typeof items)[number]) => React.ReactNode][] = [
    ["Transcript", (it) => <span className="font-sans text-ink-200">{it.transcript}</span>],
    ["Median pitch", (it) => fmt(it.features.pitch_median_hz, 0, " Hz")],
    ["Pitch range", (it) => fmt(it.features.pitch_range_semitones, 1, " st")],
    ["Final contour", (it) => <ContourBadge contour={it.features.final_contour} />],
    ["Loudness dynamics", (it) => fmt(it.features.energy_variability, 2)],
    ["Pause ratio", (it) => pct(it.features.pause_ratio)],
    ["Rate", (it) => fmt(it.features.speaking_rate_wps, 2, " w/s")],
    ["Emphasis", (it) => it.features.emphasis_candidates.join(", ") || "–"],
    ["Speech act (B)", (it) => (it.interpreted.includes("prosody") ? "see analysis" : "–")],
  ];

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Compare" title="Same words, different delivery">
        Contours are normalised per speaker (semitones from each recording's own median) and per duration, so shape is compared rather than voice or speed.
      </PageHeader>

      <div className="flex flex-wrap gap-2">
        {items.map((it, i) => (
          <Link key={it.id} to={`/a/${it.id}`} className="chip py-1 text-sm hover:bg-white/10">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: SERIES[i % SERIES.length] }} /> {name(i)}
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Card title="Pitch contour overlay">
          <ContourOverlay height={300} series={items.map((it, i) => ({ name: it.id, contours: it.contours, color: SERIES[i % SERIES.length] }))} />
        </Card>
        <Card title="Fingerprints">
          <div className="flex justify-center">
            <Radar size={320} labels={dims} series={items.map((it, i) => ({ name: it.id, values: it.fingerprint_detail.vector, color: SERIES[i % SERIES.length] }))} />
          </div>
        </Card>
      </div>

      <Card title="Measurements">
        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th className="label px-3 py-2" />
                {items.map((it, i) => (
                  <th key={it.id} className="px-3 py-2 text-xs font-semibold" style={{ color: SERIES[i % SERIES.length] }}>{name(i)}</th>
                ))}
              </tr>
            </thead>
            <tbody className="font-mono text-xs">
              {rows.map(([label, get]) => (
                <tr key={label} className="border-t border-white/5">
                  <td className="label px-3 py-2">{label}</td>
                  {items.map((it) => <td key={it.id} className="px-3 py-2">{get(it)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Delivery similarity (fingerprint distance)">
        <div className="flex flex-wrap gap-3">
          {q.data.pairs.map((p) => {
            const ia = items.findIndex((x) => x.id === p.a), ib = items.findIndex((x) => x.id === p.b);
            return (
              <div key={p.a + p.b} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="h-2 w-2 rounded-full" style={{ background: SERIES[ia % SERIES.length] }} />
                  <span>vs</span>
                  <span className="h-2 w-2 rounded-full" style={{ background: SERIES[ib % SERIES.length] }} />
                </div>
                <div className="mt-1 font-mono text-2xl font-bold text-white">{Math.round(p.similarity * 100)}%</div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
