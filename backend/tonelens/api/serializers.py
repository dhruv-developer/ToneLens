from __future__ import annotations

from ..db import Analysis


def summary(a: Analysis) -> dict:
    f = a.features or {}
    return {
        "id": a.id,
        "kind": a.kind,
        "status": a.status,
        "stage": a.stage,
        "progress": a.progress,
        "error": a.error,
        "title": a.title,
        "filename": a.filename,
        "created_at": a.created_at.isoformat(),
        "duration": a.duration,
        "language": a.language,
        "transcript": a.transcript,
        "tags": a.tags or [],
        "label": a.label,
        "profile_id": a.profile_id,
        "reference_id": a.reference_id,
        "model_size": a.model_size,
        "headline": {
            "pitch_median_hz": f.get("pitch_median_hz"),
            "pitch_range_semitones": f.get("pitch_range_semitones"),
            "final_contour": f.get("final_contour"),
            "pause_ratio": f.get("pause_ratio"),
            "speaking_rate_wps": f.get("speaking_rate_wps"),
            "emphasis_candidates": f.get("emphasis_candidates"),
        } if f else None,
        "fingerprint": (a.fingerprint or {}).get("vector"),
        "interpreted": sorted((a.interpretations or {}).keys()),
        "drill_score": (a.drill or {}).get("overall"),
    }


def full(a: Analysis) -> dict:
    out = summary(a)
    out.update({
        "context": a.context,
        "language_probability": a.language_probability,
        "asr": a.asr,
        "features": a.features,
        "fingerprint_detail": a.fingerprint,
        "interpretations": a.interpretations or {},
        "drill": a.drill,
        "audio_url": f"/api/analyses/{a.id}/audio" if a.audio_path else None,
    })
    return out
