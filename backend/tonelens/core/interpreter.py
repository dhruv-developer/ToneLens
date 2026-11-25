"""Prosody-aware (and text-only baseline) interpretation via Groq."""

from __future__ import annotations

import json
import os

from .prosody import summary_for_llm

# Groq retires models over time; override with TONELENS_GROQ_MODEL.
DEFAULT_MODEL = "openai/gpt-oss-120b"


def model_name() -> str:
    return os.environ.get("TONELENS_GROQ_MODEL") or DEFAULT_MODEL
MODES = ("prosody", "text_only")


class MissingKeyError(RuntimeError):
    pass


SYSTEM_PROMPT = """You are an expert in multilingual speech pragmatics and NLP \
(English, Hindi, Hinglish code-switching, and other languages).

You interpret how an utterance may be meant, using ONLY the evidence supplied.

Rules:
- Do not claim to know the speaker's true emotions or mental state.
- Do not equate low pitch with sadness or high pitch with happiness.
- Do not assume sarcasm from flat delivery; at most, note a possible mismatch.
- Clearly separate measured evidence from interpretation.
- Account for language, dialect and cultural variation in prosody.
- If evidence is insufficient, say so explicitly.
- Never invent acoustic observations. If no acoustic data is supplied, \
vocal_delivery must say that no acoustic evidence was available.
- Keep every string concise (1-2 sentences) and user-friendly.

Respond with a single JSON object with exactly these keys:
{
  "literal_meaning": string,
  "vocal_delivery": string,
  "interpretations": [ {"hypothesis": string, "confidence": "low"|"medium"|"high", "evidence": string} ],
  "emphasized_words": [string],
  "hesitation": string,
  "prosody_text_agreement": "consistent"|"divergent"|"insufficient",
  "agreement_reason": string,
  "speech_act": "statement"|"question"|"request"|"exclamation"|"unclear",
  "cannot_infer": [string]
}
Give 1-3 interpretations ordered by plausibility."""


FEATURE_GUIDE = """How to read the acoustic fields:
- pitch_range_semitones: spread between 10th and 90th percentile pitch (roughly: <4 narrow, 4-8 moderate, >8 wide).
- final_contour: pitch movement over the last ~0.5 s of voicing (rising / falling / level). A rise can mark a question in many languages, but not universally.
- energy_variability: coefficient of variation of loudness across speech frames.
- pause_ratio: share of the speech span that is silent; pauses lists silences >= 250 ms.
- words[].emphasis_score: z-score of pitch/loudness/lengthening relative to the same speaker in this utterance; >= 1.0 marks an emphasis candidate.
- relative_to_speaker_baseline (if present): this speaker's delivery compared with their own neutral recordings \
(pitch_level_st > 0 = higher than usual; rate_ratio > 1 = faster than usual). Prefer these over absolute values.
- Values come from automatic estimation (YIN pitch with an energy mask) and can be noisy."""


def build_prompt(transcript: str, language: str, features: dict | None, context: str, mode: str) -> str:
    if mode not in MODES:
        raise ValueError(f"mode must be one of {MODES}")
    parts = [
        f"Detected language: {language or 'unknown'}",
        f'Transcript: "{transcript}"',
        f"Conversation context: {context.strip() or 'none supplied'}",
    ]
    if mode == "prosody" and features is not None:
        parts.append(FEATURE_GUIDE)
        parts.append("Acoustic measurements (JSON):\n" + json.dumps(summary_for_llm(features), ensure_ascii=False))
    else:
        parts.append("No acoustic data is available: interpret from the words and context alone.")
    return "\n\n".join(parts)


def _client():
    key = os.getenv("GROQ_API_KEY", "").strip()
    if not key or key == "your_groq_api_key":
        raise MissingKeyError("GROQ_API_KEY is not set. Copy .env.example to .env and add your key.")
    from groq import Groq
    return Groq(api_key=key)


def interpret_speech(
    transcript: str,
    language: str,
    features: dict | None,
    context: str = "",
    mode: str = "prosody",
) -> dict:
    """Return {"mode", "analysis" (dict or None), "raw" (str), "error" (str or None)}."""
    client = _client()
    prompt = build_prompt(transcript, language, features, context, mode)
    raw, last_err = "", None
    model = model_name()
    extra = {}
    if "gpt-oss" in model:
        # reasoning model: keep thinking short and leave room for the JSON answer
        extra = {"reasoning_effort": "low"}
    for _ in range(2):
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
            max_tokens=4000,
            response_format={"type": "json_object"},
            **extra,
        )
        raw = resp.choices[0].message.content or ""
        try:
            return {"mode": mode, "analysis": json.loads(raw), "raw": raw, "error": None}
        except json.JSONDecodeError as e:
            last_err = str(e)
    return {"mode": mode, "analysis": None, "raw": raw, "error": f"Model did not return valid JSON: {last_err}"}
