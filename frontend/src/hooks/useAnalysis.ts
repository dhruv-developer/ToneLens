import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, subscribeProgress, type ProgressEvent } from "../lib/api";

/** Fetch one analysis; while it is still running, follow server-sent progress
 *  events and refetch the full record once it finishes. */
export function useAnalysis(id: string | undefined) {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["analysis", id], queryFn: () => api.get(id!), enabled: !!id });
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const status = query.data?.status;

  useEffect(() => {
    if (!id || !status || status === "done" || status === "failed") return;
    return subscribeProgress(id, (e) => {
      setProgress(e);
      if (e.status === "done" || e.status === "failed") {
        qc.invalidateQueries({ queryKey: ["analysis", id] });
        qc.invalidateQueries({ queryKey: ["analyses"] });
        qc.invalidateQueries({ queryKey: ["stats"] });
      }
    });
  }, [id, status, qc]);

  return { ...query, progress };
}
