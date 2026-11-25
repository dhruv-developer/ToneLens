import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Shell } from "./components/Shell";
import { Spinner } from "./components/ui";
import "./index.css";
import Studio from "./pages/Studio";

// route-level code splitting keeps the first load small
const AnalysisPage = lazy(() => import("./pages/AnalysisPage"));
const Library = lazy(() => import("./pages/Library"));
const Compare = lazy(() => import("./pages/Compare"));
const Drills = lazy(() => import("./pages/Drills"));
const Profiles = lazy(() => import("./pages/Profiles"));
const Evaluate = lazy(() => import("./pages/Evaluate"));

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: false, retry: 1 } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Shell>
          <Suspense fallback={<div className="grid h-64 place-items-center"><Spinner className="h-6 w-6" /></div>}>
            <Routes>
              <Route path="/" element={<Studio />} />
              <Route path="/a/:id" element={<AnalysisPage />} />
              <Route path="/library" element={<Library />} />
              <Route path="/compare" element={<Compare />} />
              <Route path="/drills" element={<Drills />} />
              <Route path="/profiles" element={<Profiles />} />
              <Route path="/evaluate" element={<Evaluate />} />
              <Route path="*" element={<div className="text-ink-400">Page not found.</div>} />
            </Routes>
          </Suspense>
        </Shell>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
