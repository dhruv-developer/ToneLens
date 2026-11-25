"""Job queue. Two interchangeable backends:

- inline: a thread pool inside the API process (zero setup; good for one machine)
- redis:  the API pushes job ids to a Redis list; any number of
          `python -m tonelens.worker` processes (on any machine sharing the DB
          and data volume) pop and run them. Scale by adding workers.
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache

from sqlmodel import select

from .config import get_settings
from .db import Analysis, session_scope
from .pipeline import process_analysis

QUEUE_KEY = "tonelens:jobs"
log = logging.getLogger("tonelens.jobs")


class InlineQueue:
    mode = "inline"

    def __init__(self, workers: int):
        self.pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="tonelens-worker")
        self.workers = workers

    def enqueue(self, analysis_id: str) -> None:
        self.pool.submit(process_analysis, analysis_id)

    def depth(self) -> int:
        return self.pool._work_queue.qsize()  # noqa: SLF001


class RedisQueue:
    mode = "redis"

    def __init__(self, url: str):
        import redis
        self.r = redis.Redis.from_url(url)
        self.workers = None

    def enqueue(self, analysis_id: str) -> None:
        self.r.lpush(QUEUE_KEY, analysis_id)

    def depth(self) -> int:
        return int(self.r.llen(QUEUE_KEY))


@lru_cache
def get_queue():
    s = get_settings()
    return RedisQueue(s.redis_url) if s.queue == "redis" else InlineQueue(s.workers)


def recover_stale_jobs() -> int:
    """Re-enqueue jobs left queued/processing by a crash or restart (inline mode only;
    redis workers own their own recovery)."""
    q = get_queue()
    if q.mode != "inline":
        return 0
    with session_scope() as s:
        stale = s.exec(select(Analysis).where(Analysis.status.in_(["queued", "processing"]))).all()
    for a in stale:
        q.enqueue(a.id)
    if stale:
        log.info("re-enqueued %d stale job(s)", len(stale))
    return len(stale)
