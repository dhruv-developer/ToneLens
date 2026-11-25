"""Runtime configuration (env vars prefixed TONELENS_, plus GROQ_API_KEY)."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]
ROOT_DIR = BACKEND_DIR.parent

# GROQ_API_KEY and TONELENS_* may live in either .env
load_dotenv(ROOT_DIR / ".env")
load_dotenv(BACKEND_DIR / ".env")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="TONELENS_", extra="ignore")

    data_dir: Path = BACKEND_DIR / "data"
    database_url: str = ""                       # default: sqlite in data_dir
    queue: Literal["inline", "redis"] = "inline"  # inline = thread pool inside the API process
    redis_url: str = "redis://localhost:6379/0"
    workers: int = 2                              # concurrent analyses per process
    whisper_model: str = "base"
    max_upload_mb: int = 50
    max_duration_s: float = 300.0
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    serve_frontend: bool = True                   # serve ../frontend/dist if it exists

    @property
    def db_url(self) -> str:
        return self.database_url or f"sqlite:///{self.data_dir / 'tonelens.db'}"


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.data_dir.mkdir(parents=True, exist_ok=True)
    return s
