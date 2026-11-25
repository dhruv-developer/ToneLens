"""Prosodic feature extraction.

Everything here is a *measurement* (pitch, energy, timing). Nothing in this
module produces an emotional or pragmatic label; that is the interpreter's job,
and it is told to treat these numbers as evidence, not conclusions.

Notes on method
- Pitch uses YIN (fast, but it always returns a value). Unvoiced/silent frames
  are removed with an energy mask, and octave errors are trimmed relative to
  the utterance median. This approximates voicing; it is not a voicing detector.
- Pause ratio is measured inside the speech span (first to last active frame),
  so leading/trailing silence in a recording does not inflate it.
- Word-level features are z-scored within the utterance, a simple form of
  speaker normalisation: "emphasis" means "stands out relative to this
  speaker in this utterance", not an absolute threshold.
"""

from __future__ import annotations

import math

import librosa
import numpy as np

SR = 16000
FRAME = 1024          # 64 ms at 16 kHz
HOP = 256             # 16 ms at 16 kHz
FMIN, FMAX = 65.0, 400.0
MIN_PAUSE_S = 0.25
FINAL_WINDOW_S = 0.5
EMPHASIS_Z = 1.0
FILLERS = {"um", "umm", "uh", "uhh", "erm", "er", "hmm", "hm", "ah", "eh"}

# Minimum spread before a word-level feature is considered informative.
MIN_STD = {"pitch_st": 0.5, "energy_db": 1.0, "dur_per_char": 0.01}
WEIGHTS = {"pitch_st": 0.4, "energy_db": 0.4, "dur_per_char": 0.2}


def _semitones(f: np.ndarray, ref: float) -> np.ndarray:
    return 12.0 * np.log2(f / ref)


def _runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """Return [start, end) index runs where mask is True."""
    runs, start = [], None
    for i, v in enumerate(mask):
        if v and start is None:
            start = i
        elif not v and start is not None:
            runs.append((start, i))
            start = None
    if start is not None:
        runs.append((start, len(mask)))
    return runs


def _clean(x: float | None, nd: int = 3):
    if x is None or not np.isfinite(x):
        return None
    return round(float(x), nd)


def extract_prosody(
    audio: str | np.ndarray,
    words: list[dict] | None = None,
    transcript: str | None = None,
    sr: int = SR,
) -> dict:
    """Compute utterance- and word-level prosodic features.

    audio: a path (resampled to 16 kHz mono) or a mono float array at `sr`.
    words: [{"word", "start", "end"}] from ASR word timestamps (optional).
    """
    if isinstance(audio, (str, bytes)) or hasattr(audio, "__fspath__"):
        y, sr = librosa.load(audio, sr=SR, mono=True)
    else:
        y = np.asarray(audio, dtype=np.float32)
    duration = len(y) / sr
    words = words or []

    rms = librosa.feature.rms(y=y, frame_length=FRAME, hop_length=HOP, center=True)[0]
    f0 = librosa.yin(y, fmin=FMIN, fmax=FMAX, sr=sr, frame_length=FRAME, hop_length=HOP, center=True)
    n = min(len(rms), len(f0))
    rms, f0 = rms[:n], f0[:n]
    times = librosa.frames_to_time(np.arange(n), sr=sr, hop_length=HOP)

    max_rms = float(rms.max()) if n else 0.0
    if max_rms < 1e-4:
        return _empty(duration, words, transcript)

    # Active (speech-energy) mask
    noise_floor = float(np.percentile(rms, 10))
    threshold = max(0.1 * max_rms, min(1.5 * noise_floor, 0.5 * max_rms))
    active = rms > threshold
    act_idx = np.flatnonzero(active)
    span = slice(act_idx[0], act_idx[-1] + 1)
    span_active = active[span]
    active_ratio = float(span_active.mean())
    pause_ratio = 1.0 - active_ratio

    pauses = []
    for s, e in _runs(~span_active):
        dur = (e - s) * HOP / sr
        if dur >= MIN_PAUSE_S:
            t0 = float(times[span.start + s])
            pauses.append({"start": round(t0, 3), "end": round(t0 + dur, 3), "duration": round(dur, 3)})

    # Pitch: energy-masked, range-limited, octave-error trimmed
    voiced_mask = active & np.isfinite(f0) & (f0 >= FMIN) & (f0 <= FMAX)
    if voiced_mask.any():
        med0 = float(np.median(f0[voiced_mask]))
        voiced_mask &= (f0 > 0.55 * med0) & (f0 < 1.8 * med0)
    voiced = f0[voiced_mask]

    if len(voiced) >= 3:
        pitch_median = float(np.median(voiced))
        p10, p90 = np.percentile(voiced, [10, 90])
        pitch_range = float(12 * np.log2(p90 / p10))
        pitch_std_st = float(np.std(_semitones(voiced, pitch_median)))
    else:
        pitch_median = p10 = p90 = pitch_range = pitch_std_st = float("nan")

    final_slope, final_contour = _final_contour(times, f0, voiced_mask, pitch_median)

    # Energy over active frames
    act_rms = rms[active]
    energy_mean = float(act_rms.mean())
    energy_cv = float(act_rms.std() / energy_mean) if energy_mean > 0 else 0.0

    # Speaking rate
    word_count = len(words) if words else len((transcript or "").split())
    active_seconds = max(float(active.sum()) * HOP / sr, 0.1)
    speaking_rate = word_count / active_seconds if word_count else 0.0

    word_feats = _word_features(words, times, f0, voiced_mask, rms, pitch_median, sr)
    fillers = [w["word"] for w in word_feats if w["is_filler"]]

    return {
        "duration_seconds": round(duration, 2),
        "pitch_median_hz": _clean(pitch_median, 1),
        "pitch_p10_hz": _clean(p10, 1),
        "pitch_p90_hz": _clean(p90, 1),
        "pitch_range_semitones": _clean(pitch_range, 2),
        "pitch_variability_semitones": _clean(pitch_std_st, 2),
        "final_contour_slope_st_per_s": _clean(final_slope, 2),
        "final_contour": final_contour,
        "energy_mean": round(energy_mean, 5),
        "energy_variability": round(energy_cv, 3),
        "pause_ratio": round(pause_ratio, 3),
        "active_speech_ratio": round(active_ratio, 3),
        "pauses": pauses,
        "long_pause_count": len(pauses),
        "speaking_rate_wps": round(speaking_rate, 2),
        "word_count": word_count,
        "voiced_frame_ratio": round(float(voiced_mask.sum()) / max(int(active.sum()), 1), 3),
        "fillers": fillers,
        "words": word_feats,
        "emphasis_candidates": [w["word"] for w in word_feats if w["emphasis_candidate"]],
        "curves": {
            "time": [round(float(t), 3) for t in times],
            "rms": [round(float(v), 5) for v in rms],
            "pitch_hz": [round(float(v), 1) if m else None for v, m in zip(f0, voiced_mask)],
            "threshold": round(threshold, 5),
        },
    }


def _final_contour(times, f0, voiced_mask, pitch_median):
    idx = np.flatnonzero(voiced_mask)
    if len(idx) < 5 or not np.isfinite(pitch_median):
        return float("nan"), "unknown"
    t_last = times[idx[-1]]
    sel = idx[times[idx] >= t_last - FINAL_WINDOW_S]
    if len(sel) < 5:
        sel = idx[-5:]
    t = times[sel]
    st = _semitones(f0[sel], pitch_median)
    if np.ptp(t) <= 0:
        return float("nan"), "unknown"
    slope = float(np.polyfit(t, st, 1)[0])
    if slope > 3.0:
        label = "rising"
    elif slope < -3.0:
        label = "falling"
    else:
        label = "level"
    return slope, label


def _word_features(words, times, f0, voiced_mask, rms, pitch_median, sr):
    out = []
    prev_end = None
    for w in words:
        start, end = float(w["start"]), float(w["end"])
        sel = (times >= start) & (times <= end)
        token = w["word"]
        letters = sum(ch.isalnum() for ch in token) or 1
        dur = max(end - start, 0.0)

        vsel = sel & voiced_mask
        pitch_st = (
            float(np.median(_semitones(f0[vsel], pitch_median)))
            if vsel.any() and np.isfinite(pitch_median) else float("nan")
        )
        peak = float(rms[sel].max()) if sel.any() else float("nan")
        energy_db = 20 * math.log10(peak) if peak and peak > 0 else float("nan")
        gap = start - prev_end if prev_end is not None else 0.0
        prev_end = end

        out.append({
            "word": token,
            "start": round(start, 3),
            "end": round(end, 3),
            "pitch_st": pitch_st,
            "energy_db": energy_db,
            "dur_per_char": dur / letters,
            "pause_before": round(max(gap, 0.0), 3),
            "is_filler": token.lower().strip(".,!?…") in FILLERS,
        })

    _add_emphasis(out)
    for w in out:
        for k in ("pitch_st", "energy_db", "dur_per_char"):
            w[k] = _clean(w[k], 3)
    return out


def _add_emphasis(word_feats):
    n = len(word_feats)
    zs = {}
    for key in WEIGHTS:
        vals = np.array([w[key] for w in word_feats], dtype=float)
        ok = np.isfinite(vals)
        z = np.zeros(n)
        if n >= 3 and ok.sum() >= 3 and np.std(vals[ok]) >= MIN_STD[key]:
            z[ok] = (vals[ok] - vals[ok].mean()) / vals[ok].std()
            zs[key] = z
    for i, w in enumerate(word_feats):
        if zs:
            tot = sum(WEIGHTS[k] for k in zs)
            score = sum(WEIGHTS[k] * zs[k][i] for k in zs) / tot
        else:
            score = 0.0
        w["emphasis_score"] = round(float(score), 2)
        w["z"] = {k: round(float(zs[k][i]), 2) for k in zs}
        w["emphasis_candidate"] = bool(score >= EMPHASIS_Z)


def _empty(duration, words, transcript):
    return {
        "duration_seconds": round(duration, 2),
        "pitch_median_hz": None, "pitch_p10_hz": None, "pitch_p90_hz": None,
        "pitch_range_semitones": None, "pitch_variability_semitones": None,
        "final_contour_slope_st_per_s": None, "final_contour": "unknown",
        "energy_mean": 0.0, "energy_variability": 0.0,
        "pause_ratio": 1.0, "active_speech_ratio": 0.0, "pauses": [],
        "long_pause_count": 0, "speaking_rate_wps": 0.0,
        "word_count": len(words) if words else len((transcript or "").split()),
        "voiced_frame_ratio": 0.0, "fillers": [], "words": [],
        "emphasis_candidates": [],
        "curves": {"time": [], "rms": [], "pitch_hz": [], "threshold": 0.0},
        "warning": "No speech energy detected (silent or near-silent audio).",
    }


def summary_for_llm(features: dict) -> dict:
    """Compact, curve-free view of the features for prompting."""
    keep = [
        "duration_seconds", "pitch_median_hz", "pitch_range_semitones",
        "pitch_variability_semitones", "final_contour", "final_contour_slope_st_per_s",
        "energy_variability", "pause_ratio", "long_pause_count", "pauses",
        "speaking_rate_wps", "word_count", "voiced_frame_ratio", "fillers",
        "emphasis_candidates",
    ]
    out = {k: features.get(k) for k in keep}
    if features.get("baseline_relative"):
        out["relative_to_speaker_baseline"] = features["baseline_relative"]
    out["words"] = [
        {
            "word": w["word"],
            "pitch_st_vs_median": w["pitch_st"],
            "emphasis_score": w["emphasis_score"],
            "pause_before_s": w["pause_before"],
        }
        for w in features.get("words", [])
    ]
    if "warning" in features:
        out["warning"] = features["warning"]
    return out


BASELINE_KEYS = ("pitch_median_hz", "pitch_range_semitones", "speaking_rate_wps", "energy_mean", "pause_ratio")


def update_baseline(baseline: dict | None, features: dict) -> dict:
    """Running mean of a speaker's neutral-delivery measurements."""
    base = dict(baseline or {})
    n = int(base.get("n", 0))
    for k in BASELINE_KEYS:
        v = features.get(k)
        if v is None:
            continue
        prev = base.get(k)
        base[k] = v if prev is None else (prev * n + v) / (n + 1)
    base["n"] = n + 1
    return base


def relative_to_baseline(features: dict, baseline: dict | None) -> dict | None:
    """Express an utterance relative to the speaker's own neutral baseline."""
    if not baseline or not baseline.get("n"):
        return None
    out = {"baseline_recordings": baseline["n"]}
    pm, bpm = features.get("pitch_median_hz"), baseline.get("pitch_median_hz")
    if pm and bpm:
        out["pitch_level_st"] = round(12 * math.log2(pm / bpm), 2)
    pr, bpr = features.get("pitch_range_semitones"), baseline.get("pitch_range_semitones")
    if pr is not None and bpr is not None:
        out["pitch_range_delta_st"] = round(pr - bpr, 2)
    r, br = features.get("speaking_rate_wps"), baseline.get("speaking_rate_wps")
    if r and br:
        out["rate_ratio"] = round(r / br, 2)
    e, be = features.get("energy_mean"), baseline.get("energy_mean")
    if e and be:
        out["loudness_delta_db"] = round(20 * math.log10(e / be), 2)
    p, bp = features.get("pause_ratio"), baseline.get("pause_ratio")
    if p is not None and bp is not None:
        out["pause_ratio_delta"] = round(p - bp, 3)
    return out
