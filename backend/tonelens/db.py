"""Persistence (SQLite by default, Postgres via TONELENS_DATABASE_URL)."""

from __future__ import annotations

import sqlite3
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone

from sqlalchemy import JSON, Column, event
from sqlalchemy.exc import OperationalError
from sqlmodel import Field, Session, SQLModel, create_engine

from .config import get_settings


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def now() -> datetime:
    return datetime.now(timezone.utc)


class Profile(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    name: str
    created_at: datetime = Field(default_factory=now)
    baseline: dict | None = Field(default=None, sa_column=Column(JSON))


class Analysis(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    created_at: datetime = Field(default_factory=now, index=True)
    updated_at: datetime = Field(default_factory=now)

    kind: str = Field(default="analysis", index=True)   # analysis | baseline | drill
    status: str = Field(default="queued", index=True)   # queued | processing | done | failed
    stage: str = "queued"
    progress: float = 0.0
    error: str | None = None

    title: str | None = None
    filename: str = "recording"
    sha256: str = Field(index=True)
    upload_path: str = ""
    audio_path: str | None = None
    model_size: str = "base"
    language_hint: str | None = None
    context: str = ""
    tags: list = Field(default_factory=list, sa_column=Column(JSON))
    label: str | None = None             # human annotation of the speech act (evaluation)
    profile_id: str | None = Field(default=None, index=True)
    reference_id: str | None = None      # drills: which analysis this attempt imitates

    duration: float | None = None
    language: str | None = None
    language_probability: float | None = None
    transcript: str | None = None

    asr: dict | None = Field(default=None, sa_column=Column(JSON))
    features: dict | None = Field(default=None, sa_column=Column(JSON))
    fingerprint: dict | None = Field(default=None, sa_column=Column(JSON))
    interpretations: dict = Field(default_factory=dict, sa_column=Column(JSON))
    drill: dict | None = Field(default=None, sa_column=Column(JSON))


_engine = None


def get_engine():
    global _engine
    if _engine is None:
        url = get_settings().db_url
        if url.startswith("sqlite"):
            _engine = create_engine(url, connect_args={"check_same_thread": False, "timeout": 30})

            @event.listens_for(_engine, "connect")
            def _pragmas(conn, _):
                cur = conn.cursor()
                # busy_timeout first: several processes (API + workers) may open
                # a fresh DB at once, and switching to WAL needs a brief lock.
                cur.execute("PRAGMA busy_timeout=30000")
                try:
                    cur.execute("PRAGMA journal_mode=WAL")  # persistent once any process sets it
                except sqlite3.OperationalError:
                    pass
                cur.execute("PRAGMA synchronous=NORMAL")
                cur.close()
        else:
            _engine = create_engine(url, pool_pre_ping=True, pool_size=10, max_overflow=20)
        for attempt in range(5):
            try:
                SQLModel.metadata.create_all(_engine)
                break
            except OperationalError:
                if attempt == 4:
                    raise
                time.sleep(0.5 * (attempt + 1))
    return _engine


@contextmanager
def session_scope():
    with Session(get_engine(), expire_on_commit=False) as s:
        yield s


def update_analysis(analysis_id: str, **fields) -> None:
    with session_scope() as s:
        a = s.get(Analysis, analysis_id)
        if a is None:
            return
        for k, v in fields.items():
            setattr(a, k, v)
        a.updated_at = now()
        s.add(a)
        s.commit()
