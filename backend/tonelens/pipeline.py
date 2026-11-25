"""The analysis pipeline a worker runs for one queued Analysis."""

from __future__ import annotations

import logging
import shutil
from pathlib import Path

from sqlmodel import select

from .config import get_settings
from .core.audio_io import to_wav16k
from .core.drills import score_attempt
from .core.fingerprint import compute_fingerprint
from .core.prosody import extract_prosody, relative_to_baseline, update_baseline
from .core.speech import transcribe_audio
from .db import Analysis, Profile, session_scope, update_analysis

log = logging.getLogger("tonelens.pipeline")


def audio_dir() -> Path:
    d = get_settings().data_dir / "audio"
    d.mkdir(parents=True, exist_ok=True)
    return d


def upload_dir() -> Path:
    d = get_settings().data_dir / "uploads"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _cached_result(a: Analysis) -> Analysis | None:
    """Same audio + same ASR settings already analysed -> reuse ASR and features."""
    with session_scope() as s:
        return s.exec(
            select(Analysis).where(
                Analysis.sha256 == a.sha256, Analysis.status == "done", Analysis.id != a.id,
                Analysis.model_size == a.model_size, Analysis.language_hint == a.language_hint,
            ).limit(1)
        ).first()


def process_analysis(analysis_id: str) -> None:
    with session_scope() as s:
        a = s.get(Analysis, analysis_id)
    if a is None or a.status == "done":
        return
    try:
        _run(a)
    except Exception as e:  # noqa: BLE001 - surface every failure to the user
        log.exception("analysis %s failed", analysis_id)
        update_analysis(analysis_id, status="failed", stage="failed", error=str(e)[:500])


def _run(a: Analysis) -> None:
    settings = get_settings()
    update_analysis(a.id, status="processing", stage="decoding", progress=0.08, error=None)

    wav_path = audio_dir() / f"{a.id}.wav"
    cached = _cached_result(a)

    if cached and cached.audio_path and Path(cached.audio_path).exists():
        shutil.copyfile(cached.audio_path, wav_path)
        asr, base_features = cached.asr, dict(cached.features)
        update_analysis(a.id, stage="measuring", progress=0.7)
    else:
        tmp = to_wav16k(a.upload_path)
        shutil.move(tmp, wav_path)

        import soundfile as sf
        duration = sf.info(str(wav_path)).duration
        if duration > settings.max_duration_s:
            raise ValueError(f"Recording is {duration:.0f}s; the limit is {settings.max_duration_s:.0f}s.")
        update_analysis(a.id, stage="transcribing", progress=0.25, duration=duration)

        asr = transcribe_audio(str(wav_path), model_size=a.model_size, language=a.language_hint)
        update_analysis(a.id, stage="measuring", progress=0.7)
        base_features = extract_prosody(str(wav_path), words=asr["words"], transcript=asr["text"])

    features = dict(base_features)
    features.pop("baseline_relative", None)

    profile_baseline = None
    if a.profile_id:
        with session_scope() as s:
            p = s.get(Profile, a.profile_id)
            profile_baseline = p.baseline if p else None
    if a.kind != "baseline":
        rel = relative_to_baseline(features, profile_baseline)
        if rel:
            features["baseline_relative"] = rel

    update_analysis(a.id, stage="fingerprinting", progress=0.88)
    fingerprint = compute_fingerprint(features)

    drill = None
    if a.kind == "drill" and a.reference_id:
        with session_scope() as s:
            ref = s.get(Analysis, a.reference_id)
        if ref and ref.features:
            drill = score_attempt(ref.features, features)

    if a.kind == "baseline" and a.profile_id:
        with session_scope() as s:
            p = s.get(Profile, a.profile_id)
            if p:
                p.baseline = update_baseline(p.baseline, features)
                s.add(p)
                s.commit()

    update_analysis(
        a.id,
        status="done", stage="done", progress=1.0,
        audio_path=str(wav_path),
        duration=features.get("duration_seconds"),
        language=asr["language"], language_probability=asr["language_probability"],
        transcript=asr["text"], asr=asr, features=features, fingerprint=fingerprint, drill=drill,
    )
    try:
        Path(a.upload_path).unlink(missing_ok=True)
    except OSError:
        pass
