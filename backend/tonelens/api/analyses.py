"""/api/analyses: upload, progress (SSE), results, interpretation, export."""

from __future__ import annotations

import asyncio
import csv
import hashlib
import io
import json
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, PlainTextResponse, Response, StreamingResponse
from pydantic import BaseModel
from sqlmodel import col, func, or_, select

from ..config import get_settings
from ..core.fingerprint import similarity
from ..core.interpreter import MODES, MissingKeyError, interpret_speech
from ..core.speech import MODEL_SIZES
from ..db import Analysis, Profile, new_id, session_scope, update_analysis
from ..jobs import get_queue
from ..pipeline import upload_dir
from .serializers import full, summary

router = APIRouter(prefix="/api/analyses", tags=["analyses"])

ALLOWED = {".wav", ".mp3", ".m4a", ".ogg", ".oga", ".flac", ".webm", ".aiff", ".aif", ".mp4", ".aac", ".opus"}
KINDS = {"analysis", "baseline", "drill"}
SPEECH_ACTS = {"statement", "question", "request", "exclamation", "unclear"}


def get_or_404(analysis_id: str) -> Analysis:
    with session_scope() as s:
        a = s.get(Analysis, analysis_id)
    if a is None:
        raise HTTPException(404, "analysis not found")
    return a


@router.post("", status_code=202)
async def create_analysis(
    file: UploadFile = File(...),
    context: str = Form(""),
    title: str | None = Form(None),
    kind: str = Form("analysis"),
    profile_id: str | None = Form(None),
    reference_id: str | None = Form(None),
    model_size: str | None = Form(None),
    language: str | None = Form(None),
):
    settings = get_settings()
    suffix = Path(file.filename or "").suffix.lower() or ".webm"
    if suffix not in ALLOWED:
        raise HTTPException(415, f"unsupported file type {suffix}")
    if kind not in KINDS:
        raise HTTPException(422, f"kind must be one of {sorted(KINDS)}")
    model_size = model_size or settings.whisper_model
    if model_size not in MODEL_SIZES:
        raise HTTPException(422, f"model_size must be one of {MODEL_SIZES}")
    language = (language or "").strip() or None
    profile_id = profile_id or None
    reference_id = reference_id or None
    if kind == "baseline" and not profile_id:
        raise HTTPException(422, "baseline recordings need a profile_id")
    if kind == "drill" and not reference_id:
        raise HTTPException(422, "drill attempts need a reference_id")
    with session_scope() as s:
        if profile_id and s.get(Profile, profile_id) is None:
            raise HTTPException(404, "profile not found")
        if reference_id and s.get(Analysis, reference_id) is None:
            raise HTTPException(404, "reference analysis not found")

    aid = new_id()
    dest = upload_dir() / f"{aid}{suffix}"
    limit = settings.max_upload_mb * 1024 * 1024
    h, size = hashlib.sha256(), 0
    with open(dest, "wb") as out:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > limit:
                out.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(413, f"file exceeds {settings.max_upload_mb} MB")
            h.update(chunk)
            out.write(chunk)
    if size == 0:
        dest.unlink(missing_ok=True)
        raise HTTPException(422, "empty file")

    a = Analysis(
        id=aid, kind=kind, title=title or None, filename=file.filename or f"recording{suffix}",
        sha256=h.hexdigest(), upload_path=str(dest), model_size=model_size, language_hint=language,
        context=context, profile_id=profile_id, reference_id=reference_id,
    )
    with session_scope() as s:
        s.add(a)
        s.commit()
    get_queue().enqueue(aid)
    return {"id": aid, "status": "queued", "events_url": f"/api/analyses/{aid}/events"}


@router.get("")
def list_analyses(q: str | None = None, kind: str | None = "analysis", status: str | None = None,
                  labeled: bool | None = None, limit: int = 50, offset: int = 0):
    limit = max(1, min(limit, 200))
    with session_scope() as s:
        stmt = select(Analysis)
        if kind and kind != "all":
            stmt = stmt.where(Analysis.kind == kind)
        if status:
            stmt = stmt.where(Analysis.status == status)
        if labeled is not None:
            stmt = stmt.where(col(Analysis.label).is_not(None) if labeled else col(Analysis.label).is_(None))
        if q:
            like = f"%{q}%"
            stmt = stmt.where(or_(col(Analysis.transcript).ilike(like), col(Analysis.title).ilike(like),
                                  col(Analysis.filename).ilike(like)))
        total = s.exec(select(func.count()).select_from(stmt.subquery())).one()
        rows = s.exec(stmt.order_by(col(Analysis.created_at).desc()).offset(offset).limit(limit)).all()
    return {"total": total, "items": [summary(a) for a in rows]}


@router.get("/{analysis_id}")
def get_analysis(analysis_id: str):
    return full(get_or_404(analysis_id))


class AnalysisPatch(BaseModel):
    title: str | None = None
    tags: list[str] | None = None
    label: str | None = None
    context: str | None = None


@router.patch("/{analysis_id}")
def patch_analysis(analysis_id: str, body: AnalysisPatch):
    get_or_404(analysis_id)
    fields = body.model_dump(exclude_unset=True)
    if "label" in fields and fields["label"] not in SPEECH_ACTS | {None, ""}:
        raise HTTPException(422, f"label must be one of {sorted(SPEECH_ACTS)}")
    if fields.get("label") == "":
        fields["label"] = None
    if "tags" in fields:
        fields["tags"] = sorted({t.strip().lower() for t in fields["tags"] or [] if t.strip()})[:20]
    update_analysis(analysis_id, **fields)
    return full(get_or_404(analysis_id))


@router.delete("/{analysis_id}", status_code=204)
def delete_analysis(analysis_id: str):
    with session_scope() as s:
        a = s.get(Analysis, analysis_id)
        if a is None:
            raise HTTPException(404, "analysis not found")
        for p in (a.audio_path, a.upload_path):
            if p:
                Path(p).unlink(missing_ok=True)
        s.delete(a)
        s.commit()
    return Response(status_code=204)


@router.get("/{analysis_id}/events")
async def analysis_events(analysis_id: str, request: Request):
    get_or_404(analysis_id)

    async def stream():
        last = None
        ticks = 0
        while not await request.is_disconnected():
            a = await run_in_threadpool(get_or_404, analysis_id)
            state = {"status": a.status, "stage": a.stage, "progress": round(a.progress, 3), "error": a.error}
            if state != last:
                yield f"event: progress\ndata: {json.dumps(state)}\n\n"
                last = state
                ticks = 0
            elif ticks % 25 == 0:
                yield ": keep-alive\n\n"
            if a.status in ("done", "failed"):
                break
            ticks += 1
            await asyncio.sleep(0.4)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/{analysis_id}/audio")
def analysis_audio(analysis_id: str):
    a = get_or_404(analysis_id)
    if not a.audio_path or not Path(a.audio_path).exists():
        raise HTTPException(404, "audio not available yet")
    return FileResponse(a.audio_path, media_type="audio/wav", filename=f"{a.id}.wav")


class InterpretBody(BaseModel):
    mode: str = "prosody"
    context: str | None = None
    force: bool = False


def run_interpretation(analysis_id: str, mode: str, context: str | None = None, force: bool = False) -> dict:
    a = get_or_404(analysis_id)
    if a.status != "done":
        raise HTTPException(409, "analysis is not finished yet")
    if mode not in MODES:
        raise HTTPException(422, f"mode must be one of {MODES}")
    if context is not None and context != a.context:
        a.context = context
        force = True
        update_analysis(a.id, context=context)
    cached = (a.interpretations or {}).get(mode)
    if cached and not force:
        return cached
    if not a.transcript:
        raise HTTPException(422, "no speech was transcribed; nothing to interpret")
    try:
        result = interpret_speech(a.transcript, a.language or "", a.features, context=a.context or "", mode=mode)
    except MissingKeyError as e:
        raise HTTPException(503, {"code": "missing_groq_key", "message": str(e)}) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, {"code": "llm_error", "message": str(e)[:300]}) from e
    interp = dict(a.interpretations or {})
    interp[mode] = result
    update_analysis(a.id, interpretations=interp)
    return result


@router.post("/{analysis_id}/interpret")
async def interpret(analysis_id: str, body: InterpretBody):
    return await run_in_threadpool(run_interpretation, analysis_id, body.mode, body.context, body.force)


@router.get("/{analysis_id}/similar")
def similar(analysis_id: str, limit: int = 5):
    a = get_or_404(analysis_id)
    if not a.fingerprint:
        return {"items": []}
    vec = a.fingerprint["vector"]
    with session_scope() as s:
        rows = s.exec(select(Analysis).where(Analysis.status == "done", Analysis.id != a.id)
                      .order_by(col(Analysis.created_at).desc()).limit(1000)).all()
    scored = sorted(((similarity(vec, r.fingerprint["vector"]), r) for r in rows if r.fingerprint),
                    key=lambda x: x[0], reverse=True)[:max(1, min(limit, 20))]
    return {"items": [{**summary(r), "similarity": round(sc, 3)} for sc, r in scored]}


@router.get("/{analysis_id}/export")
def export(analysis_id: str, format: str = "json"):
    a = get_or_404(analysis_id)
    if a.status != "done":
        raise HTTPException(409, "analysis is not finished yet")
    base = f"tonelens-{a.id}"
    if format == "json":
        data = full(a)
        data["features"] = {k: v for k, v in (a.features or {}).items() if k != "curves"}
        return Response(json.dumps(data, indent=2, ensure_ascii=False), media_type="application/json",
                        headers={"Content-Disposition": f'attachment; filename="{base}.json"'})
    if format == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["word", "start", "end", "pitch_st_vs_median", "peak_energy_db", "sec_per_char",
                    "pause_before_s", "emphasis_score", "emphasis_candidate"])
        for x in (a.features or {}).get("words", []):
            w.writerow([x["word"], x["start"], x["end"], x["pitch_st"], x["energy_db"], x["dur_per_char"],
                        x["pause_before"], x["emphasis_score"], x["emphasis_candidate"]])
        return Response(buf.getvalue(), media_type="text/csv",
                        headers={"Content-Disposition": f'attachment; filename="{base}-words.csv"'})
    if format == "md":
        return PlainTextResponse(_markdown_report(a), headers={"Content-Disposition": f'attachment; filename="{base}.md"'})
    raise HTTPException(422, "format must be json, csv or md")


def _markdown_report(a: Analysis) -> str:
    f = a.features or {}
    lines = [f"# ToneLens report: {a.title or a.filename}", "",
             f"> {a.transcript or '(no speech)'}", "",
             f"- Language: **{a.language}** ({(a.language_probability or 0):.0%})",
             f"- Duration: {f.get('duration_seconds')} s",
             f"- Median pitch: {f.get('pitch_median_hz')} Hz, range {f.get('pitch_range_semitones')} st",
             f"- Final contour: {f.get('final_contour')} ({f.get('final_contour_slope_st_per_s')} st/s)",
             f"- Pause ratio: {f.get('pause_ratio')}, long pauses: {f.get('long_pause_count')}",
             f"- Speaking rate: {f.get('speaking_rate_wps')} words/s",
             f"- Emphasis candidates: {', '.join(f.get('emphasis_candidates') or []) or 'none'}", ""]
    if f.get("baseline_relative"):
        lines += ["## Relative to speaker baseline", "", "```json", json.dumps(f["baseline_relative"], indent=2), "```", ""]
    for mode, res in (a.interpretations or {}).items():
        an = res.get("analysis") or {}
        lines += [f"## Interpretation ({mode})", "",
                  f"**Literal meaning:** {an.get('literal_meaning', '')}", "",
                  f"**Vocal delivery:** {an.get('vocal_delivery', '')}", "",
                  f"**Prosody–text agreement:** {an.get('prosody_text_agreement', '')}: {an.get('agreement_reason', '')}", ""]
        for i in an.get("interpretations", []):
            lines.append(f"- {i.get('hypothesis')} (*{i.get('confidence')}*): {i.get('evidence')}")
        lines.append("")
    lines.append("_Interpretations are hypotheses, not definitive emotional assessments._")
    return "\n".join(lines)
