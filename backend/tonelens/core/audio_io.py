"""Audio normalisation: every input becomes 16 kHz mono 16-bit WAV."""

import shutil
import subprocess
import tempfile
from pathlib import Path

TARGET_SR = 16000


class AudioConversionError(RuntimeError):
    pass


def to_wav16k(src: str | Path) -> str:
    """Convert any ffmpeg-readable audio file to a temporary 16 kHz mono WAV."""
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        raise AudioConversionError(
            "ffmpeg was not found on PATH. Install it (e.g. `brew install ffmpeg`)."
        )
    out = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    out.close()
    cmd = [
        ffmpeg, "-y", "-loglevel", "error",
        "-i", str(src),
        "-ac", "1", "-ar", str(TARGET_SR), "-sample_fmt", "s16",
        out.name,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise AudioConversionError(
            f"Could not decode audio: {proc.stderr.strip() or 'unknown ffmpeg error'}"
        )
    return out.name


def save_bytes(data: bytes, suffix: str) -> str:
    """Write uploaded/recorded bytes to a temp file and return its path."""
    tmp = tempfile.NamedTemporaryFile(suffix=suffix or ".bin", delete=False)
    tmp.write(data)
    tmp.close()
    return tmp.name
