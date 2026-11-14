import os
from pathlib import Path

API_DIR = Path(__file__).resolve().parents[1]
ROOT = API_DIR.parent


def load_env() -> None:
    """Load api/.env into the process environment without overriding it."""
    path = API_DIR / ".env"
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip().strip('"').strip("'")
        if value:
            os.environ.setdefault(key.strip(), value)


load_env()


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


def data_dir() -> Path:
    return Path(env("CANONICO_DATA_DIR") or ROOT / "data")


def state_file() -> Path | None:
    value = os.environ.get("CANONICO_STATE_FILE")
    if value is None:
        return API_DIR / ".runtime" / "state.json"
    return Path(value) if value else None


def cors_origins() -> list[str]:
    raw = env("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    return [o.strip() for o in raw.split(",") if o.strip()]


def cors_origin_regex() -> str | None:
    return env("CORS_ORIGIN_REGEX", r"https://.*\.vercel\.app") or None


def public_url() -> str:
    """Base URL shown in webhook addresses."""
    return env("CANONICO_PUBLIC_URL", "http://localhost:8000").rstrip("/")


VERSION = "0.1.0"
CORPUS = "org-consulting-clearpath"
SEED_AT = "2026-11-14T09:12:00Z"
DETECTED_AT = "2026-11-14T09:15:00Z"
PROPOSED_AT = "2026-11-14T09:20:00Z"
