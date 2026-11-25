"""Standalone worker for TONELENS_QUEUE=redis.

    python -m tonelens.worker            # one process, TONELENS_WORKERS concurrent jobs

Run as many as you like, on as many machines as share the database and data volume.

Reliable-queue pattern: a job is atomically moved (BLMOVE) from the shared queue
into this worker's own processing list, and only removed once finished. Each
worker refreshes a heartbeat key; if a worker dies, any other worker's reaper
notices the expired heartbeat and pushes its in-flight jobs back onto the queue.
"""

from __future__ import annotations

import logging
import os
import signal
import socket
import threading
from concurrent.futures import ThreadPoolExecutor

import redis

from .config import get_settings
from .db import get_engine
from .jobs import QUEUE_KEY
from .pipeline import process_analysis

log = logging.getLogger("tonelens.worker")

PROC_PREFIX = "tonelens:proc:"
HB_PREFIX = "tonelens:hb:"
HB_TTL = 30


def reap_dead_workers(r: redis.Redis) -> int:
    """Requeue jobs held by workers whose heartbeat has expired."""
    moved = 0
    for key in r.scan_iter(f"{PROC_PREFIX}*"):
        wid = key.decode()[len(PROC_PREFIX):]
        if r.exists(f"{HB_PREFIX}{wid}"):
            continue
        while r.lmove(key, QUEUE_KEY, "RIGHT", "LEFT"):
            moved += 1
        r.delete(key)
    if moved:
        log.warning("requeued %d job(s) from dead workers", moved)
    return moved


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    s = get_settings()
    get_engine()
    r = redis.Redis.from_url(s.redis_url)
    wid = f"{socket.gethostname()}:{os.getpid()}"
    proc_key = f"{PROC_PREFIX}{wid}"
    stop = threading.Event()

    def heartbeat():
        while not stop.is_set():
            r.set(f"{HB_PREFIX}{wid}", 1, ex=HB_TTL)
            stop.wait(HB_TTL / 3)

    def reaper():
        while not stop.wait(60):
            try:
                reap_dead_workers(r)
            except redis.RedisError:
                log.exception("reaper failed")

    r.set(f"{HB_PREFIX}{wid}", 1, ex=HB_TTL)
    reap_dead_workers(r)
    threading.Thread(target=heartbeat, daemon=True).start()
    threading.Thread(target=reaper, daemon=True).start()

    slots = threading.Semaphore(s.workers)
    pool = ThreadPoolExecutor(max_workers=s.workers, thread_name_prefix="tonelens-worker")
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stop.set())

    log.info("worker %s up: %d slot(s), queue %s", wid, s.workers, QUEUE_KEY)
    while not stop.is_set():
        if not slots.acquire(timeout=1):
            continue
        try:
            raw = r.blmove(QUEUE_KEY, proc_key, 2, "RIGHT", "LEFT")
        except redis.RedisError:
            log.exception("redis unavailable; retrying")
            slots.release()
            stop.wait(2)
            continue
        if raw is None:
            slots.release()
            continue
        aid = raw.decode()
        log.info("picked %s", aid)

        def run(aid=aid, raw=raw):
            try:
                process_analysis(aid)
            finally:
                r.lrem(proc_key, 1, raw)
                slots.release()

        pool.submit(run)

    log.info("draining in-flight jobs…")
    pool.shutdown(wait=True)
    r.delete(f"{HB_PREFIX}{wid}")


if __name__ == "__main__":
    main()
