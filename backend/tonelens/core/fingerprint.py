"""Prosodic fingerprint: a compact, comparable vector describing *how* something was said.

Each dimension maps a measurement onto [0, 1] with a fixed, documented range so
fingerprints from different recordings live in the same space. This is the
"prosodic representation geometry" idea in its simplest form: deliveries
become points, and we can measure distances between them.
"""

from __future__ import annotations

import math

import numpy as np

# key, label, extractor, (lo, hi)
DIMENSIONS = [
    ("pitch_level", "Pitch level"),
    ("pitch_range", "Pitch range"),
    ("pitch_movement", "Pitch movement"),
    ("final_rise", "Final rise"),
    ("dynamics", "Loudness dynamics"),
    ("pace", "Pace"),
    ("pausing", "Pausing"),
    ("emphasis", "Emphasis density"),
]


def _scale(v, lo, hi):
    if v is None or not np.isfinite(v):
        return None
    return float(np.clip((v - lo) / (hi - lo), 0.0, 1.0))


def compute_fingerprint(features: dict) -> dict:
    rel = features.get("baseline_relative") or {}
    words = features.get("words") or []
    n_words = max(len(words), 1)

    if "pitch_level_st" in rel:
        level_raw, level = rel["pitch_level_st"], _scale(rel["pitch_level_st"], -6, 6)
    else:
        pm = features.get("pitch_median_hz")
        # log-scale position between 80 Hz and 320 Hz (two octaves)
        level_raw = pm
        level = _scale(math.log2(pm / 80) / 2, 0, 1) if pm else None

    raw = {
        "pitch_level": level_raw,
        "pitch_range": features.get("pitch_range_semitones"),
        "pitch_movement": features.get("pitch_variability_semitones"),
        "final_rise": features.get("final_contour_slope_st_per_s"),
        "dynamics": features.get("energy_variability"),
        "pace": features.get("speaking_rate_wps"),
        "pausing": features.get("pause_ratio"),
        "emphasis": len(features.get("emphasis_candidates") or []) / n_words if words else None,
    }
    scaled = {
        "pitch_level": level,
        "pitch_range": _scale(raw["pitch_range"], 0, 14),
        "pitch_movement": _scale(raw["pitch_movement"], 0, 5),
        "final_rise": _scale(raw["final_rise"], -20, 20),
        "dynamics": _scale(raw["dynamics"], 0, 1.2),
        "pace": _scale(raw["pace"], 0.5, 5),
        "pausing": _scale(raw["pausing"], 0, 0.5),
        "emphasis": _scale(raw["emphasis"], 0, 0.35),
    }
    dims = [
        {"key": k, "label": label, "value": None if scaled[k] is None else round(scaled[k], 3),
         "raw": None if raw[k] is None else round(float(raw[k]), 3)}
        for k, label in DIMENSIONS
    ]
    return {"dims": dims, "vector": [d["value"] if d["value"] is not None else 0.5 for d in dims],
            "speaker_relative": "pitch_level_st" in rel}


def similarity(a: list[float], b: list[float]) -> float:
    """1.0 = identical delivery shape, 0.0 = maximally different (in the unit hypercube)."""
    va, vb = np.asarray(a, float), np.asarray(b, float)
    if va.shape != vb.shape or va.size == 0:
        return 0.0
    return float(1.0 - np.linalg.norm(va - vb) / math.sqrt(va.size))
