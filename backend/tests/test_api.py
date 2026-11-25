"""End-to-end API tests. Whisper is stubbed so tests are fast and offline;
everything else (ffmpeg, prosody, queue, DB, fingerprints, drills) is real."""

import io
import time

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from tonelens import pipeline
from tonelens.core.drills import score_attempt
from tonelens.core.prosody import SR

WORDS = ["that's", "exactly", "what", "I", "wanted"]


def make_clip(freqs, amps, word_s=0.35, gap_s=0.08, rise=False):
    parts, words, t = [], [], 0.0
    for i, (f, a) in enumerate(zip(freqs, amps)):
        n = int(word_s * SR)
        if rise and i == len(freqs) - 1:
            fr = np.linspace(f, f * 1.6, n)
        else:
            fr = np.full(n, f)
        parts.append((a * np.sin(2 * np.pi * np.cumsum(fr) / SR)).astype(np.float32))
        parts.append(np.zeros(int(gap_s * SR), np.float32))
        words.append({"word": WORDS[i % len(WORDS)], "start": t, "end": t + word_s, "probability": 0.9})
        t += word_s + gap_s
    y = np.concatenate([np.zeros(int(0.2 * SR), np.float32)] + parts)
    for w in words:
        w["start"] += 0.2
        w["end"] += 0.2
    buf = io.BytesIO()
    sf.write(buf, y, SR, format="WAV")
    return buf.getvalue(), words


@pytest.fixture()
def client(monkeypatch):
    stub = {}

    def fake_transcribe(path, model_size="base", language=None):
        words = stub["words"]
        return {"text": " ".join(w["word"] for w in words), "language": language or "en",
                "language_probability": 0.97, "duration": 0.0, "segments": [], "words": words}

    monkeypatch.setattr(pipeline, "transcribe_audio", fake_transcribe)
    from tonelens.api.main import app
    with TestClient(app) as c:
        c.stub = stub
        yield c


def upload(client, data, words, **form):
    client.stub["words"] = words
    r = client.post("/api/analyses", files={"file": ("clip.wav", data, "audio/wav")}, data=form)
    assert r.status_code == 202, r.text
    aid = r.json()["id"]
    for _ in range(150):
        a = client.get(f"/api/analyses/{aid}").json()
        if a["status"] in ("done", "failed"):
            break
        time.sleep(0.1)
    assert a["status"] == "done", a
    return a


def test_full_analysis_flow(client):
    data, words = make_clip([180] * 5, [0.1, 0.5, 0.1, 0.1, 0.1])
    a = upload(client, data, words, context="after a long wait")
    assert a["features"]["emphasis_candidates"] == ["exactly"]
    assert len(a["fingerprint_detail"]["dims"]) == 8
    assert a["audio_url"]
    assert client.get(a["audio_url"]).headers["content-type"] == "audio/wav"

    # events stream ends with done
    body = client.get(f"/api/analyses/{a['id']}/events").text
    assert '"status": "done"' in body

    # list, patch, export
    lst = client.get("/api/analyses").json()
    assert any(x["id"] == a["id"] for x in lst["items"])
    p = client.patch(f"/api/analyses/{a['id']}", json={"title": "Test", "tags": ["Demo", "demo "], "label": "statement"}).json()
    assert p["title"] == "Test" and p["tags"] == ["demo"] and p["label"] == "statement"
    assert client.patch(f"/api/analyses/{a['id']}", json={"label": "nonsense"}).status_code == 422
    assert "exactly" in client.get(f"/api/analyses/{a['id']}/export?format=csv").text
    assert "ToneLens report" in client.get(f"/api/analyses/{a['id']}/export?format=md").text
    assert client.get(f"/api/analyses/{a['id']}/export?format=json").json()["id"] == a["id"]

    # interpretation without a key -> clean 503
    r = client.post(f"/api/analyses/{a['id']}/interpret", json={"mode": "prosody"})
    assert r.status_code == 503 and r.json()["detail"]["code"] == "missing_groq_key"


def test_dedupe_reuses_previous_result(client):
    data, words = make_clip([200] * 4, [0.2] * 4)
    a1 = upload(client, data, words)
    client.stub["words"] = []  # would produce an empty transcript if ASR ran again
    a2 = upload(client, data, [])
    assert a2["transcript"] == a1["transcript"] != ""


def test_baseline_profile_and_relative_features(client):
    prof = client.post("/api/profiles", json={"name": "Dhruv"}).json()
    low, words = make_clip([120] * 4, [0.2] * 4)
    upload(client, low, words, kind="baseline", profile_id=prof["id"])
    profs = client.get("/api/profiles").json()
    base = next(p for p in profs if p["id"] == prof["id"])["baseline"]
    assert base["n"] == 1 and base["pitch_median_hz"] == pytest.approx(120, rel=0.05)

    high, words = make_clip([240] * 4, [0.2] * 4)
    a = upload(client, high, words, profile_id=prof["id"])
    rel = a["features"]["baseline_relative"]
    assert rel["pitch_level_st"] == pytest.approx(12, abs=0.6)   # one octave above baseline
    assert a["fingerprint_detail"]["speaker_relative"] is True


def test_drill_scoring_prefers_matching_shape(client):
    ref_data, words = make_clip([150] * 4, [0.2] * 4, rise=True)
    ref = upload(client, ref_data, words, title="question")

    # same shape, different voice (higher pitch) -> high contour score
    good_data, words = make_clip([230] * 4, [0.2] * 4, rise=True)
    good = upload(client, good_data, words, kind="drill", reference_id=ref["id"])
    # flat ending -> lower score
    flat_data, words = make_clip([230] * 4, [0.2] * 4, rise=False)
    flat = upload(client, flat_data, words, kind="drill", reference_id=ref["id"])

    assert good["drill"]["overall"] > flat["drill"]["overall"]
    assert good["drill"]["parts"]["contour"] > flat["drill"]["parts"]["contour"]
    attempts = client.get(f"/api/drills/{ref['id']}/attempts").json()
    assert {x["id"] for x in attempts} == {good["id"], flat["id"]}


def test_compare_similar_stats_and_delete(client):
    d1, w1 = make_clip([180] * 4, [0.2] * 4)
    d2, w2 = make_clip([180] * 4, [0.1, 0.5, 0.1, 0.1])
    a1, a2 = upload(client, d1, w1), upload(client, d2, w2)
    cmp = client.post("/api/compare", json={"ids": [a1["id"], a2["id"]]}).json()
    assert len(cmp["items"]) == 2 and 0 <= cmp["pairs"][0]["similarity"] <= 1
    assert len(cmp["items"][0]["contours"]["pitch"]) == 120
    assert client.get(f"/api/analyses/{a1['id']}/similar").json()["items"]
    st = client.get("/api/stats").json()
    assert st["by_status"]["done"] >= 2
    cfg = client.get("/api/config").json()
    assert cfg["groq_configured"] is False and cfg["queue"] == "inline"
    assert client.delete(f"/api/analyses/{a1['id']}").status_code == 204
    assert client.get(f"/api/analyses/{a1['id']}").status_code == 404


def test_rejects_bad_uploads(client):
    assert client.post("/api/analyses", files={"file": ("x.txt", b"hello", "text/plain")}).status_code == 415
    assert client.post("/api/analyses", files={"file": ("x.wav", b"", "audio/wav")}).status_code == 422
    assert client.post("/api/analyses", files={"file": ("x.wav", b"RIFF", "audio/wav")},
                       data={"kind": "drill"}).status_code == 422


def test_corrupt_audio_fails_cleanly(client):
    client.stub["words"] = []
    r = client.post("/api/analyses", files={"file": ("bad.wav", b"not really audio" * 100, "audio/wav")})
    aid = r.json()["id"]
    for _ in range(50):
        a = client.get(f"/api/analyses/{aid}").json()
        if a["status"] in ("done", "failed"):
            break
        time.sleep(0.1)
    assert a["status"] == "failed" and "decode" in a["error"].lower()


def test_evaluation_endpoint_shape(client):
    ev = client.get("/api/evaluation").json()
    assert set(ev["overall"]) >= {"n", "text_only_acc", "prosody_acc"}


def test_score_attempt_identical_is_near_perfect():
    data, words = make_clip([170] * 4, [0.1, 0.4, 0.1, 0.1], rise=True)
    from tonelens.core.prosody import extract_prosody
    y, _ = sf.read(io.BytesIO(data), dtype="float32")
    f = extract_prosody(y, words=words)
    assert score_attempt(f, f)["overall"] > 95
