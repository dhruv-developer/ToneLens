"""Multilingual speech recognition with faster-whisper (word timestamps on)."""

import os
import threading

import soundfile as sf
from faster_whisper import WhisperModel

MODEL_SIZES = ("tiny", "base", "small", "medium")


_models: dict[str, WhisperModel] = {}
_lock = threading.Lock()


def get_model(size: str = "base") -> WhisperModel:
    """Load each model size once per process. num_workers lets several threads
    transcribe concurrently on one model (CTranslate2 handles the batching)."""
    if size not in MODEL_SIZES:
        raise ValueError(f"unknown Whisper model {size!r}; choose from {MODEL_SIZES}")
    with _lock:
        if size not in _models:
            workers = int(os.getenv("TONELENS_WORKERS", "2"))
            _models[size] = WhisperModel(size, device="cpu", compute_type="int8", num_workers=max(workers, 1))
        return _models[size]


def transcribe_audio(audio_path: str, model_size: str = "base", language: str | None = None) -> dict:
    model = get_model(model_size)
    # Input is already 16 kHz mono WAV (audio_io.to_wav16k). Passing an array
    # avoids faster-whisper's PyAV decoder, which breaks on some av versions.
    audio, sr = sf.read(audio_path, dtype="float32", always_2d=False)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if sr != 16000:
        raise ValueError(f"expected 16 kHz audio, got {sr} Hz; run audio_io.to_wav16k first")
    segments, info = model.transcribe(
        audio,
        beam_size=5,
        vad_filter=True,
        word_timestamps=True,
        condition_on_previous_text=False,
        language=language,
    )
    segments = list(segments)

    words = []
    seg_out = []
    for seg in segments:
        seg_out.append({"start": float(seg.start), "end": float(seg.end), "text": seg.text.strip()})
        for w in seg.words or []:
            token = w.word.strip()
            if not token:
                continue
            words.append({
                "word": token,
                "start": float(w.start),
                "end": float(w.end),
                "probability": float(w.probability),
            })

    return {
        "text": " ".join(s["text"] for s in seg_out).strip(),
        "language": info.language,
        "language_probability": float(info.language_probability),
        "duration": float(info.duration),
        "segments": seg_out,
        "words": words,
    }
