"""ToneLens: prosody-aware speech understanding (Streamlit UI)."""

import html
import os
from pathlib import Path

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from dotenv import load_dotenv
from plotly.subplots import make_subplots

from tonelens.core.audio_io import AudioConversionError, save_bytes, to_wav16k
from tonelens.core.interpreter import MissingKeyError, interpret_speech
from tonelens.core.prosody import extract_prosody
from tonelens.core.speech import MODEL_SIZES, transcribe_audio

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

st.set_page_config(page_title="ToneLens", page_icon="🎙️", layout="wide")

st.markdown(
    """
<style>
.stApp { background: #10121a; color: #f4f5fa; }
[data-testid="stMetric"] { background: #1b1e2b; padding: 14px 18px; border-radius: 12px; }
h1 { letter-spacing: -1px; }
.tl-transcript { font-size: 1.35rem; line-height: 2.3rem; background: #1b1e2b;
  padding: 16px 20px; border-radius: 12px; }
.tl-word { padding: 2px 4px; border-radius: 6px; }
.tl-emph { border-bottom: 2px solid #ffb547; font-weight: 600; }
.tl-pause { color: #7d84a3; font-size: 0.9rem; padding: 0 4px; }
.tl-card { background: #1b1e2b; border-radius: 12px; padding: 14px 18px; margin-bottom: 10px; }
.tl-muted { color: #9aa0b8; font-size: 0.9rem; }
</style>
""",
    unsafe_allow_html=True,
)

LANG_OPTIONS = {"Auto-detect": None, "English": "en", "Hindi": "hi"}


# ---------------------------------------------------------------- pipeline

@st.cache_data(show_spinner=False, max_entries=32)
def analyze_audio(data: bytes, suffix: str, model_size: str, language: str | None) -> dict:
    src = save_bytes(data, suffix)
    wav = to_wav16k(src)
    try:
        asr = transcribe_audio(wav, model_size=model_size, language=language)
        feats = extract_prosody(wav, words=asr["words"], transcript=asr["text"])
    finally:
        for p in (src, wav):
            try:
                os.unlink(p)
            except OSError:
                pass
    return {"asr": asr, "features": feats}


@st.cache_data(show_spinner=False, max_entries=64)
def cached_interpretation(transcript, language, features, context, mode):
    return interpret_speech(transcript, language, features, context=context, mode=mode)


def run_interpretation(result: dict, context: str, mode: str):
    asr = result["asr"]
    if not asr["text"]:
        return None, "No speech was transcribed, so there is nothing to interpret."
    try:
        return cached_interpretation(asr["text"], asr["language"], result["features"], context, mode), None
    except MissingKeyError:
        return None, "missing_key"
    except Exception as e:  # network / API errors
        return None, f"Interpretation failed: {e}"


# ---------------------------------------------------------------- rendering

def fmt(v, unit="", nd=1):
    return "–" if v is None else f"{v:.{nd}f}{unit}"


def render_metrics(result: dict):
    asr, f = result["asr"], result["features"]
    top, bottom = st.columns(3), st.columns(3)
    top[0].metric("Language", f"{asr['language']} · {asr['language_probability']:.0%}")
    top[1].metric("Duration", fmt(f["duration_seconds"], " s"))
    top[2].metric("Median pitch", fmt(f["pitch_median_hz"], " Hz", 0))
    bottom[0].metric("Pitch range", fmt(f["pitch_range_semitones"], " st"))
    bottom[1].metric("Pause ratio", fmt(f["pause_ratio"] * 100 if f["pause_ratio"] is not None else None, "%", 0))
    bottom[2].metric("Speaking rate", fmt(f["speaking_rate_wps"], " w/s"))
    extra = (
        f"Final contour: <b>{f['final_contour']}</b> ({fmt(f['final_contour_slope_st_per_s'], ' st/s')}) · "
        f"Energy variability: <b>{f['energy_variability']:.2f}</b> · "
        f"Long pauses: <b>{f['long_pause_count']}</b> · "
        f"Fillers: <b>{html.escape(', '.join(f['fillers']) or 'none')}</b>"
    )
    st.markdown(f"<div class='tl-muted'>{extra}</div>", unsafe_allow_html=True)
    if f.get("warning"):
        st.warning(f["warning"])


def render_chart(features: dict, key: str):
    cv = features["curves"]
    if not cv["time"]:
        return
    fig = make_subplots(rows=2, cols=1, shared_xaxes=True, vertical_spacing=0.06,
                        row_heights=[0.6, 0.4])
    fig.add_trace(go.Scatter(x=cv["time"], y=cv["pitch_hz"], mode="lines", name="F0",
                             line=dict(color="#7c8cff", width=2), connectgaps=False), row=1, col=1)
    fig.add_trace(go.Scatter(x=cv["time"], y=cv["rms"], mode="lines", name="RMS",
                             line=dict(color="#36d1a6", width=1.5), fill="tozeroy",
                             fillcolor="rgba(54,209,166,0.15)"), row=2, col=1)
    fig.add_hline(y=cv["threshold"], line=dict(color="#7d84a3", dash="dot", width=1), row=2, col=1)

    for p in features["pauses"]:
        for r in (1, 2):
            fig.add_vrect(x0=p["start"], x1=p["end"], fillcolor="#ff6b6b", opacity=0.12,
                          line_width=0, row=r, col=1)

    for w in features["words"]:
        color = "#ffb547" if w["emphasis_candidate"] else "rgba(160,166,190,0.35)"
        fig.add_vline(x=w["start"], line=dict(color="rgba(160,166,190,0.18)", width=1), row=1, col=1)
        fig.add_annotation(x=(w["start"] + w["end"]) / 2, y=1.0, yref="y domain", yanchor="bottom",
                           text=html.escape(w["word"]), showarrow=False,
                           font=dict(size=11, color=color), row=1, col=1)

    fig.update_layout(height=430, margin=dict(l=10, r=10, t=40, b=10), showlegend=False,
                      paper_bgcolor="#10121a", plot_bgcolor="#151826", font=dict(color="#d7dbea"))
    fig.update_xaxes(title_text="time (s)", row=2, col=1, gridcolor="#242838")
    fig.update_yaxes(gridcolor="#242838")
    fig.update_yaxes(title_text="pitch (Hz)", row=1, col=1)
    fig.update_yaxes(title_text="energy (RMS)", row=2, col=1)
    st.plotly_chart(fig, use_container_width=True, key=key)


def render_transcript(result: dict):
    words = result["features"]["words"]
    if not words:
        st.markdown(f"<div class='tl-transcript'>{html.escape(result['asr']['text'] or '(no speech)')}</div>",
                    unsafe_allow_html=True)
        return
    spans = []
    for w in words:
        if w["pause_before"] >= 0.25:
            spans.append(f"<span class='tl-pause'>⏸ {w['pause_before']:.1f}s</span>")
        alpha = float(np.clip(w["emphasis_score"], 0, 2)) / 2 * 0.55
        cls = "tl-word tl-emph" if w["emphasis_candidate"] else "tl-word"
        title = f"emphasis {w['emphasis_score']:+.2f} | z {w['z']}"
        spans.append(
            f"<span class='{cls}' style='background: rgba(255,181,71,{alpha:.2f})' "
            f"title='{html.escape(title)}'>{html.escape(w['word'])}</span>"
        )
    st.markdown(f"<div class='tl-transcript'>{' '.join(spans)}</div>", unsafe_allow_html=True)
    st.caption("Shading = word stands out in pitch, loudness or lengthening relative to this speaker. "
               "Underlined = emphasis candidate. ⏸ = pause ≥ 250 ms.")


AGREEMENT_TEXT = {
    "divergent": ("warning", "⚠️ **Prosody–text disagreement.** The linguistic content and vocal delivery may "
                             "convey different pragmatic signals. More conversational context is required."),
    "consistent": ("success", "✅ **Prosody and text appear consistent.**"),
    "insufficient": ("info", "ℹ️ **Insufficient evidence** to compare vocal delivery with the words."),
}


def render_analysis(out: dict | None, err: str | None, title: str):
    st.markdown(f"#### {title}")
    if err == "missing_key":
        st.info("Interpretation needs a Groq API key. Copy `.env.example` to `.env`, set `GROQ_API_KEY`, "
                "then rerun. Transcript and acoustic analysis above work without it.")
        return
    if err:
        st.error(err)
        return
    if out is None:
        return
    a = out["analysis"]
    if a is None:
        st.error(out["error"])
        st.code(out["raw"])
        return

    if out["mode"] == "prosody":
        kind, text = AGREEMENT_TEXT.get(a.get("prosody_text_agreement"), AGREEMENT_TEXT["insufficient"])
        getattr(st, kind)(f"{text}\n\n{a.get('agreement_reason', '')}")

    st.markdown(
        f"<div class='tl-card'><b>Literal meaning</b><br>{html.escape(str(a.get('literal_meaning', '')))}</div>"
        f"<div class='tl-card'><b>Vocal delivery</b><br>{html.escape(str(a.get('vocal_delivery', '')))}</div>",
        unsafe_allow_html=True,
    )
    st.markdown(f"**Speech act:** `{a.get('speech_act', 'unclear')}`")
    st.markdown("**Possible interpretations** (hypotheses, not verdicts)")
    for i in a.get("interpretations", []) or []:
        st.markdown(f"- **{i.get('hypothesis', '')}** · _{i.get('confidence', '?')} confidence_  \n"
                    f"  <span class='tl-muted'>{html.escape(str(i.get('evidence', '')))}</span>",
                    unsafe_allow_html=True)
    if a.get("emphasized_words"):
        st.markdown("**Emphasized words:** " + ", ".join(f"`{w}`" for w in a["emphasized_words"]))
    st.markdown(f"**Hesitation:** {a.get('hesitation', '–')}")
    if a.get("cannot_infer"):
        st.markdown("**Cannot reliably infer:** " + "; ".join(a["cannot_infer"]))


def words_table(features: dict):
    rows = [{
        "word": w["word"], "start": w["start"], "end": w["end"],
        "pitch (st vs median)": w["pitch_st"], "peak energy (dB)": w["energy_db"],
        "sec/char": w["dur_per_char"], "pause before (s)": w["pause_before"],
        "emphasis score": w["emphasis_score"], "candidate": w["emphasis_candidate"],
    } for w in features["words"]]
    st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)


def safe_analyze(data: bytes, name: str, model_size: str, language):
    try:
        with st.spinner(f"Transcribing and measuring {name}… (first run downloads the Whisper model)"):
            return analyze_audio(data, Path(name).suffix or ".wav", model_size, language)
    except AudioConversionError as e:
        st.error(str(e))
    except Exception as e:
        st.error(f"Analysis failed for {name}: {e}")
    return None


# ---------------------------------------------------------------- layout

with st.sidebar:
    st.markdown("### Settings")
    model_size = st.selectbox("Whisper model", MODEL_SIZES, index=1,
                              help="Larger is more accurate (esp. Hindi/Hinglish) but slower on CPU.")
    lang_label = st.selectbox("Language", list(LANG_OPTIONS), index=0)
    language = LANG_OPTIONS[lang_label]
    compare_text_only = st.toggle("Compare with text-only baseline", value=False,
                                  help="Runs the same LLM without acoustic evidence (System A).")
    key_ok = bool(os.getenv("GROQ_API_KEY", "").strip()) and os.getenv("GROQ_API_KEY") != "your_groq_api_key"
    st.markdown(f"Groq key: {'✅ loaded' if key_ok else '⚠️ not set'}")
    st.caption("ToneLens describes observable vocal delivery. It is not an emotion detector.")

st.title("ToneLens")
st.markdown("<div class='tl-muted'>Understand the voice behind the words: transcript · acoustic evidence · "
            "interpretation · ambiguity</div>", unsafe_allow_html=True)

tab_analyze, tab_compare = st.tabs(["Analyze", "Compare deliveries"])

with tab_analyze:
    c1, c2 = st.columns(2)
    recorded = c1.audio_input("Record")
    uploaded = c2.file_uploader("…or upload audio", type=["wav", "mp3", "m4a", "ogg", "flac", "webm", "aiff"])
    context = st.text_area("Conversation context (optional)", placeholder="e.g. Reply after being told the meeting moved to Saturday.",
                           height=70)

    source = uploaded or recorded
    if source is not None:
        name = getattr(source, "name", None) or "recording.wav"
        result = safe_analyze(source.getvalue(), name, model_size, language)
        if result:
            render_metrics(result)
            render_chart(result["features"], key="main_chart")
            render_transcript(result)
            with st.expander("Word-level measurements"):
                words_table(result["features"])

            st.divider()
            if compare_text_only:
                l, r = st.columns(2)
                with l:
                    out, err = run_interpretation(result, context, "prosody")
                    render_analysis(out, err, "Prosody-aware (System B)")
                with r:
                    out, err = run_interpretation(result, context, "text_only")
                    render_analysis(out, err, "Text-only baseline (System A)")
            else:
                with st.spinner("Interpreting…"):
                    out, err = run_interpretation(result, context, "prosody")
                render_analysis(out, err, "Prosody-aware interpretation")
    else:
        st.info("Record or upload a short clip (5–30 s works best) to begin.")

with tab_compare:
    st.markdown("Upload 2–3 recordings of **the same sentence** with different delivery "
                "to see how the measurements and interpretation change.")
    files = st.file_uploader("Recordings", type=["wav", "mp3", "m4a", "ogg", "flac", "webm", "aiff"],
                             accept_multiple_files=True, key="cmp_files")
    cmp_context = st.text_input("Shared context (optional)", key="cmp_ctx")
    files = (files or [])[:3]
    if len(files) >= 2:
        results = []
        for f in files:
            r = safe_analyze(f.getvalue(), f.name, model_size, language)
            if r:
                results.append((f.name, r))

        if results:
            table = pd.DataFrame([{
                "recording": n, "transcript": r["asr"]["text"],
                "pitch median (Hz)": r["features"]["pitch_median_hz"],
                "pitch range (st)": r["features"]["pitch_range_semitones"],
                "final contour": r["features"]["final_contour"],
                "energy var.": r["features"]["energy_variability"],
                "pause ratio": r["features"]["pause_ratio"],
                "rate (w/s)": r["features"]["speaking_rate_wps"],
                "emphasis": ", ".join(r["features"]["emphasis_candidates"]) or "–",
            } for n, r in results])
            st.dataframe(table, use_container_width=True, hide_index=True)

            fig = go.Figure()
            for n, r in results:
                cv, med = r["features"]["curves"], r["features"]["pitch_median_hz"]
                if not med:
                    continue
                st_vals = [12 * np.log2(v / med) if v else None for v in cv["pitch_hz"]]
                fig.add_trace(go.Scatter(x=cv["time"], y=st_vals, mode="lines", name=n, connectgaps=False))
            fig.update_layout(title="Pitch contours (semitones relative to each speaker's median)", height=360,
                              paper_bgcolor="#10121a", plot_bgcolor="#151826", font=dict(color="#d7dbea"),
                              margin=dict(l=10, r=10, t=50, b=10))
            st.plotly_chart(fig, use_container_width=True, key="cmp_chart")

            cols = st.columns(len(results))
            for col, (n, r) in zip(cols, results):
                with col:
                    out, err = run_interpretation(r, cmp_context, "prosody")
                    render_analysis(out, err, n)
    else:
        st.info("Upload at least two recordings.")

st.divider()
st.caption("Interpretations are hypotheses grounded in measured delivery, not definitive emotional assessments. "
           "Prosody varies across speakers, languages and cultures.")
