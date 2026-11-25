"""Profiles, compare, drills, evaluation (H1 experiment), config and stats."""

from __future__ import annotations

import os
from collections import defaultdict

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlmodel import col, func, select

from ..config import get_settings
from ..core.drills import normalised_contours, score_attempt
from ..core.fingerprint import DIMENSIONS, similarity
from ..core.speech import MODEL_SIZES
from ..db import Analysis, Profile, session_scope
from ..jobs import get_queue
from .analyses import get_or_404, run_interpretation
from .serializers import summary

router = APIRouter(prefix="/api", tags=["extras"])


# ---------------------------------------------------------------- meta

def groq_configured() -> bool:
    k = os.getenv("GROQ_API_KEY", "").strip()
    return bool(k) and k != "your_groq_api_key"


@router.get("/health")
def health():
    return {"ok": True}


@router.get("/config")
def config():
    s = get_settings()
    q = get_queue()
    return {
        "groq_configured": groq_configured(),
        "whisper_models": list(MODEL_SIZES),
        "default_model": s.whisper_model,
        "queue": q.mode,
        "workers": s.workers,
        "max_upload_mb": s.max_upload_mb,
        "max_duration_s": s.max_duration_s,
        "fingerprint_dims": [{"key": k, "label": l} for k, l in DIMENSIONS],
    }


@router.get("/stats")
def stats():
    with session_scope() as s:
        by_status = dict(s.exec(select(Analysis.status, func.count()).group_by(Analysis.status)).all())
        by_lang = dict(s.exec(select(Analysis.language, func.count()).where(Analysis.status == "done")
                              .group_by(Analysis.language)).all())
        audio_s = s.exec(select(func.coalesce(func.sum(Analysis.duration), 0)).where(Analysis.status == "done")).one()
        profiles = s.exec(select(func.count()).select_from(Profile)).one()
    return {"by_status": by_status, "by_language": {k or "unknown": v for k, v in by_lang.items()},
            "audio_seconds": round(float(audio_s), 1), "profiles": profiles, "queue_depth": get_queue().depth()}


# ---------------------------------------------------------------- profiles

class ProfileIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)


def _profile_out(p: Profile) -> dict:
    return {"id": p.id, "name": p.name, "created_at": p.created_at.isoformat(), "baseline": p.baseline}


@router.get("/profiles")
def list_profiles():
    with session_scope() as s:
        return [_profile_out(p) for p in s.exec(select(Profile).order_by(col(Profile.created_at))).all()]


@router.post("/profiles", status_code=201)
def create_profile(body: ProfileIn):
    p = Profile(name=body.name.strip())
    with session_scope() as s:
        s.add(p)
        s.commit()
    return _profile_out(p)


@router.post("/profiles/{profile_id}/reset")
def reset_profile(profile_id: str):
    with session_scope() as s:
        p = s.get(Profile, profile_id)
        if p is None:
            raise HTTPException(404, "profile not found")
        p.baseline = None
        s.add(p)
        s.commit()
        return _profile_out(p)


@router.delete("/profiles/{profile_id}", status_code=204)
def delete_profile(profile_id: str):
    with session_scope() as s:
        p = s.get(Profile, profile_id)
        if p is None:
            raise HTTPException(404, "profile not found")
        s.delete(p)
        s.commit()


# ---------------------------------------------------------------- compare

class CompareIn(BaseModel):
    ids: list[str] = Field(min_length=2, max_length=6)


@router.post("/compare")
def compare(body: CompareIn):
    items = [get_or_404(i) for i in body.ids]
    not_done = [a.id for a in items if a.status != "done"]
    if not_done:
        raise HTTPException(409, f"not finished: {', '.join(not_done)}")
    out = []
    for a in items:
        out.append({**summary(a), "fingerprint_detail": a.fingerprint,
                    "contours": normalised_contours(a.features),
                    "features": {k: v for k, v in a.features.items() if k not in ("curves",)}})
    pairs = [{"a": x.id, "b": y.id, "similarity": round(similarity(x.fingerprint["vector"], y.fingerprint["vector"]), 3)}
             for i, x in enumerate(items) for y in items[i + 1:]]
    return {"items": out, "pairs": pairs}


# ---------------------------------------------------------------- drills

class DrillScoreIn(BaseModel):
    reference_id: str
    attempt_id: str


@router.post("/drills/score")
def drill_score(body: DrillScoreIn):
    ref, att = get_or_404(body.reference_id), get_or_404(body.attempt_id)
    if ref.status != "done" or att.status != "done":
        raise HTTPException(409, "both recordings must be finished")
    return score_attempt(ref.features, att.features)


@router.get("/drills/{reference_id}/attempts")
def drill_attempts(reference_id: str):
    with session_scope() as s:
        rows = s.exec(select(Analysis).where(Analysis.kind == "drill", Analysis.reference_id == reference_id)
                      .order_by(col(Analysis.created_at))).all()
    return [summary(a) for a in rows]


# ---------------------------------------------------------------- evaluation (H1)

def _speech_act(a: Analysis, mode: str) -> str | None:
    res = (a.interpretations or {}).get(mode) or {}
    return (res.get("analysis") or {}).get("speech_act")


@router.get("/evaluation")
def evaluation():
    """Compare System A (text-only) vs System B (prosody-aware) on human speech-act labels."""
    with session_scope() as s:
        rows = s.exec(select(Analysis).where(col(Analysis.label).is_not(None), Analysis.status == "done")).all()
    per_lang: dict[str, dict] = defaultdict(lambda: {"n": 0, "text_only": 0, "prosody": 0})
    items, totals = [], {"n": 0, "text_only": 0, "prosody": 0, "prosody_only_correct": 0, "text_only_correct": 0}
    for a in rows:
        t, p = _speech_act(a, "text_only"), _speech_act(a, "prosody")
        items.append({**summary(a), "pred_text_only": t, "pred_prosody": p})
        if t is None or p is None:
            continue
        lang = a.language or "unknown"
        tc, pc = t == a.label, p == a.label
        totals["n"] += 1
        totals["text_only"] += tc
        totals["prosody"] += pc
        totals["prosody_only_correct"] += pc and not tc
        totals["text_only_correct"] += tc and not pc
        per_lang[lang]["n"] += 1
        per_lang[lang]["text_only"] += tc
        per_lang[lang]["prosody"] += pc

    def acc(d):
        return {"n": d["n"], "text_only_acc": d["text_only"] / d["n"] if d["n"] else None,
                "prosody_acc": d["prosody"] / d["n"] if d["n"] else None}

    return {"overall": {**acc(totals), "prosody_only_correct": totals["prosody_only_correct"],
                        "text_only_correct": totals["text_only_correct"]},
            "by_language": {k: acc(v) for k, v in per_lang.items()},
            "items": items, "labeled": len(rows), "groq_configured": groq_configured()}


@router.post("/evaluation/run")
async def evaluation_run():
    with session_scope() as s:
        rows = s.exec(select(Analysis).where(col(Analysis.label).is_not(None), Analysis.status == "done")).all()
    done, errors = 0, []
    for a in rows:
        for mode in ("text_only", "prosody"):
            if (a.interpretations or {}).get(mode):
                continue
            try:
                await run_in_threadpool(run_interpretation, a.id, mode)
                done += 1
            except HTTPException as e:
                errors.append({"id": a.id, "mode": mode, "error": e.detail})
                if isinstance(e.detail, dict) and e.detail.get("code") == "missing_groq_key":
                    return {"ran": done, "errors": errors}
    return {"ran": done, "errors": errors}
