"""Delivery drills: score how closely an attempt matches a reference delivery.

Both recordings are reduced to speaker-normalised, time-normalised contours
(pitch in semitones relative to each speaker's own median, loudness relative
to each recording's peak), aligned with DTW, and compared. Using each
speaker's own median means a low voice can match a high voice's *shape*.
"""

from __future__ import annotations

import numpy as np

N_POINTS = 120


def _speech_span(curves: dict) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    t = np.asarray(curves["time"], float)
    rms = np.asarray(curves["rms"], float)
    pitch = np.array([np.nan if v is None else v for v in curves["pitch_hz"]], float)
    active = np.flatnonzero(rms > curves.get("threshold", 0))
    if len(active) < 2:
        return t, rms, pitch
    sl = slice(active[0], active[-1] + 1)
    return t[sl], rms[sl], pitch[sl]


def normalised_contours(features: dict, n: int = N_POINTS) -> dict:
    curves = features.get("curves") or {}
    if not curves.get("time"):
        return {"pitch": [0.0] * n, "energy": [0.0] * n, "voiced": [False] * n}
    t, rms, pitch = _speech_span(curves)
    grid = np.linspace(t[0], t[-1], n) if t[-1] > t[0] else np.full(n, t[0])

    voiced = np.isfinite(pitch) & (pitch > 0)
    if voiced.sum() >= 2:
        med = np.median(pitch[voiced])
        st = 12 * np.log2(pitch[voiced] / med)
        p = np.interp(grid, t[voiced], st)
        v = np.interp(grid, t, voiced.astype(float)) > 0.5
    else:
        p, v = np.zeros(n), np.zeros(n, bool)
    e = np.interp(grid, t, rms / (rms.max() or 1.0))
    return {"pitch": [round(float(x), 3) for x in p], "energy": [round(float(x), 4) for x in e],
            "voiced": [bool(x) for x in v]}


def dtw(a: np.ndarray, b: np.ndarray, band: int = 20) -> tuple[float, list[tuple[int, int]]]:
    n, m = len(a), len(b)
    cost = np.full((n + 1, m + 1), np.inf)
    cost[0, 0] = 0.0
    for i in range(1, n + 1):
        lo, hi = max(1, i - band), min(m, i + band)
        for j in range(lo, hi + 1):
            d = abs(a[i - 1] - b[j - 1])
            cost[i, j] = d + min(cost[i - 1, j], cost[i, j - 1], cost[i - 1, j - 1])
    # backtrack
    i, j, path = n, m, []
    while i > 0 and j > 0:
        path.append((i - 1, j - 1))
        step = np.argmin([cost[i - 1, j - 1], cost[i - 1, j], cost[i, j - 1]])
        if step == 0:
            i, j = i - 1, j - 1
        elif step == 1:
            i -= 1
        else:
            j -= 1
    path.reverse()
    return float(cost[n, m] / len(path)), path


def _norm_words(ws):
    return {w.lower().strip(".,!?…\"'") for w in ws}


def score_attempt(reference: dict, attempt: dict) -> dict:
    """reference/attempt: full feature dicts (prosody.extract_prosody output)."""
    rc, ac = normalised_contours(reference), normalised_contours(attempt)
    rp, ap = np.asarray(rc["pitch"]), np.asarray(ac["pitch"])
    re_, ae = np.asarray(rc["energy"]), np.asarray(ac["energy"])

    pitch_dist, _ = dtw(rp, ap)
    energy_dist, _ = dtw(re_, ae)
    pitch_score = 100 * float(np.exp(-pitch_dist / 2.5))     # 2.5 st mean deviation -> ~37
    energy_score = 100 * float(np.exp(-energy_dist / 0.18))

    def ratio_score(a, b, tol):
        if not a or not b:
            return None
        return 100 * float(np.exp(-abs(np.log(a / b)) / tol))

    rate_score = ratio_score(attempt.get("speaking_rate_wps"), reference.get("speaking_rate_wps"), 0.35)
    range_score = ratio_score((attempt.get("pitch_range_semitones") or 0) + 1,
                              (reference.get("pitch_range_semitones") or 0) + 1, 0.5)

    ref_emph, att_emph = _norm_words(reference.get("emphasis_candidates") or []), _norm_words(attempt.get("emphasis_candidates") or [])
    if ref_emph or att_emph:
        emph_score = 100 * len(ref_emph & att_emph) / len(ref_emph | att_emph)
    else:
        emph_score = None

    parts = {"contour": pitch_score, "energy": energy_score, "pace": rate_score,
             "range": range_score, "emphasis": emph_score}
    weights = {"contour": 0.4, "energy": 0.2, "pace": 0.15, "range": 0.15, "emphasis": 0.1}
    used = {k: v for k, v in parts.items() if v is not None}
    overall = sum(weights[k] * used[k] for k in used) / sum(weights[k] for k in used)

    tips = []
    rf, af = reference.get("final_contour"), attempt.get("final_contour")
    if rf and af and rf != af and "unknown" not in (rf, af):
        tips.append(f"The reference ends with a {rf} pitch; yours ends {af}.")
    rr, ar = reference.get("pitch_range_semitones"), attempt.get("pitch_range_semitones")
    if rr is not None and ar is not None and abs(rr - ar) >= 2:
        tips.append(f"Your pitch range is {'wider' if ar > rr else 'narrower'} by {abs(ar - rr):.1f} semitones.")
    rw, aw = reference.get("speaking_rate_wps"), attempt.get("speaking_rate_wps")
    if rw and aw and abs(aw / rw - 1) >= 0.15:
        tips.append(f"You spoke about {abs(aw / rw - 1):.0%} {'faster' if aw > rw else 'slower'}.")
    missing = ref_emph - att_emph
    if missing:
        tips.append("Stress " + ", ".join(f"“{w}”" for w in sorted(missing)) + " more, like the reference.")
    extra = att_emph - ref_emph
    if extra:
        tips.append("You stressed " + ", ".join(f"“{w}”" for w in sorted(extra)) + " where the reference didn't.")
    rpz, apz = reference.get("long_pause_count", 0), attempt.get("long_pause_count", 0)
    if rpz != apz:
        tips.append(f"Reference has {rpz} long pause(s); you had {apz}.")
    if not tips:
        tips.append("Close match. Try it with a different context or emotion in mind.")

    return {
        "overall": round(overall, 1),
        "parts": {k: (None if v is None else round(v, 1)) for k, v in parts.items()},
        "tips": tips,
        "contours": {"reference": rc, "attempt": ac},
    }
