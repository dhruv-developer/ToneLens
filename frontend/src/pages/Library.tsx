import { keepPreviousData, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { GitCompare, LibraryBig, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnalysisCard } from "../components/AnalysisCard";
import { Empty, PageHeader, Spinner } from "../components/ui";
import { api } from "../lib/api";
import type { Kind } from "../lib/types";

const KINDS: { k: Kind | "all"; l: string }[] = [
  { k: "analysis", l: "Analyses" }, { k: "drill", l: "Drill attempts" }, { k: "baseline", l: "Baselines" }, { k: "all", l: "Everything" },
];
const PAGE = 24;

export default function Library() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [kind, setKind] = useState<Kind | "all">("analysis");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => { const t = setTimeout(() => { setDebounced(q); setPage(0); }, 250); return () => clearTimeout(t); }, [q]);

  const list = useQuery({
    queryKey: ["analyses", { q: debounced, kind, page }],
    queryFn: () => api.list({ q: debounced, kind, limit: PAGE, offset: page * PAGE }),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => (query.state.data?.items.some((i) => i.status === "queued" || i.status === "processing") ? 2000 : false),
  });

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 6 ? s : [...s, id]));
  const pages = Math.ceil((list.data?.total ?? 0) / PAGE);

  return (
    <div>
      <PageHeader eyebrow="Library" title="Every delivery, searchable"
        action={
          <button type="button" className="btn-primary" disabled={selected.length < 2} onClick={() => nav(`/compare?ids=${selected.join(",")}`)}>
            <GitCompare className="h-4 w-4" /> Compare {selected.length ? `(${selected.length})` : ""}
          </button>
        }>
        Search transcripts, then select 2–6 recordings to compare their contours and fingerprints.
      </PageHeader>

      <div className="mb-6 flex flex-col gap-3 md:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input className="input pl-9" placeholder="Search transcripts and titles…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex rounded-xl border border-white/10 bg-ink-900/80 p-1">
          {KINDS.map(({ k, l }) => (
            <button key={k} type="button" onClick={() => { setKind(k); setPage(0); }}
              className={clsx("rounded-lg px-3 py-1.5 text-xs font-medium transition", kind === k ? "bg-white/10 text-white" : "text-ink-400 hover:text-white")}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {list.isLoading ? <div className="grid h-40 place-items-center"><Spinner className="h-6 w-6" /></div> :
        !list.data?.items.length ? (
          <Empty icon={<LibraryBig className="h-8 w-8" />} title={debounced ? "No matches" : "Nothing here yet"}>
            {debounced ? "Try another search." : "Record something in the Studio and it will appear here."}
          </Empty>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {list.data.items.map((a) => <AnalysisCard key={a.id} a={a} selected={selected.includes(a.id)} onSelect={() => toggle(a.id)} />)}
            </div>
            {pages > 1 && (
              <div className="mt-6 flex items-center justify-center gap-3 text-sm">
                <button type="button" className="btn-ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
                <span className="text-ink-400">{page + 1} / {pages} · {list.data.total} total</span>
                <button type="button" className="btn-ghost" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</button>
              </div>
            )}
          </>
        )}
    </div>
  );
}
