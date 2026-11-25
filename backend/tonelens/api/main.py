"""ToneLens API.

    uvicorn tonelens.api.main:app --reload            (from backend/)
"""

from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse

from ..config import ROOT_DIR, get_settings
from ..db import get_engine
from ..jobs import get_queue, recover_stale_jobs
from . import analyses, extras

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("tonelens.api")


@asynccontextmanager
async def lifespan(_: FastAPI):
    get_engine()
    q = get_queue()
    recover_stale_jobs()
    log.info("ToneLens API ready (queue=%s)", q.mode)
    yield


app = FastAPI(title="ToneLens API", version="0.2.0", lifespan=lifespan)
settings = get_settings()

app.add_middleware(GZipMiddleware, minimum_size=2048)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def timing(request: Request, call_next):
    t0 = time.perf_counter()
    response = await call_next(request)
    response.headers["Server-Timing"] = f"app;dur={(time.perf_counter() - t0) * 1000:.1f}"
    return response


app.include_router(analyses.router)
app.include_router(extras.router)

# Single-container deploys: serve the built SPA from the same origin.
DIST = ROOT_DIR / "frontend" / "dist"
if settings.serve_frontend and DIST.exists():
    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            from fastapi import HTTPException
            raise HTTPException(404, "not found")
        target = (DIST / path).resolve()
        if path and target.is_file() and DIST in target.parents:
            return FileResponse(target)
        return FileResponse(DIST / "index.html")
