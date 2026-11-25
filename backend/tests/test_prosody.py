import json
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tonelens.core.interpreter import build_prompt  # noqa: E402
from tonelens.core.prosody import SR, extract_prosody  # noqa: E402


def tone(freq, seconds, amp=0.3):
    t = np.arange(int(seconds * SR)) / SR
    return (amp * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def glide(f_start, f_end, seconds, amp=0.3):
    n = int(seconds * SR)
    f = np.linspace(f_start, f_end, n)
    phase = 2 * np.pi * np.cumsum(f) / SR
    return (amp * np.sin(phase)).astype(np.float32)


def silence(seconds):
    return np.zeros(int(seconds * SR), dtype=np.float32)


def test_steady_tone_pitch():
    f = extract_prosody(tone(200, 2.0))
    assert f["pitch_median_hz"] == pytest.approx(200, rel=0.03)
    assert f["pitch_range_semitones"] < 0.5
    assert f["final_contour"] == "level"


def test_rising_and_falling_final_contour():
    rising = np.concatenate([tone(160, 1.0), glide(160, 260, 0.6)])
    falling = np.concatenate([tone(240, 1.0), glide(240, 150, 0.6)])
    assert extract_prosody(rising)["final_contour"] == "rising"
    assert extract_prosody(falling)["final_contour"] == "falling"


def test_pause_detection_ignores_edges():
    y = np.concatenate([silence(0.5), tone(180, 1.0), silence(0.6), tone(180, 1.0), silence(0.5)])
    f = extract_prosody(y)
    assert f["long_pause_count"] == 1
    p = f["pauses"][0]
    assert p["duration"] == pytest.approx(0.6, abs=0.1)
    assert p["start"] == pytest.approx(1.5, abs=0.1)
    # ratio is within the speech span (≈0.6 / 2.6), not the whole file
    assert f["pause_ratio"] == pytest.approx(0.6 / 2.6, abs=0.06)


def test_loud_word_is_emphasis_candidate():
    amps = [0.1, 0.1, 0.5, 0.1, 0.1]
    parts, words, t = [], [], 0.0
    for i, a in enumerate(amps):
        parts += [tone(180, 0.4, a), silence(0.1)]
        words.append({"word": f"w{i}", "start": t, "end": t + 0.4})
        t += 0.5
    f = extract_prosody(np.concatenate(parts), words=words)
    assert f["emphasis_candidates"] == ["w2"]
    assert f["speaking_rate_wps"] > 0


def test_silence_is_handled():
    f = extract_prosody(silence(1.0), transcript="hello")
    assert "warning" in f
    assert f["pitch_median_hz"] is None


def test_output_is_json_serialisable():
    words = [{"word": "a", "start": 0.0, "end": 0.5}, {"word": "b", "start": 0.6, "end": 1.0}]
    json.dumps(extract_prosody(tone(150, 1.2), words=words), allow_nan=False)


def test_text_only_prompt_has_no_acoustics():
    feats = extract_prosody(tone(200, 1.0))
    with_p = build_prompt("That's exactly what I wanted.", "en", feats, "", "prosody")
    text_only = build_prompt("That's exactly what I wanted.", "en", feats, "", "text_only")
    assert "pitch_median_hz" in with_p
    assert "pitch_median_hz" not in text_only
    assert "No acoustic data" in text_only
