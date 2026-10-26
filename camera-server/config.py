"""Settings, read from environment variables / the .env file."""
from __future__ import annotations

import os
import secrets
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv, set_key

BASE_DIR = Path(__file__).resolve().parent
ENV_PATH = BASE_DIR / ".env"


def _split(value: str) -> tuple[str, ...]:
    return tuple(part.strip() for part in value.split(",") if part.strip())


def _flag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    host: str
    port: int
    tls: bool
    extra_sans: tuple[str, ...]
    allowed_origins: tuple[str, ...]
    viewer_token: str
    phone_token: str
    model_path: Path
    conf: float
    imgsz: int
    device: str
    max_frame_bytes: int
    cert_dir: Path
    viewer_token_is_new: bool = False
    snapshot_dir: Path = BASE_DIR / "snapshots"
    calibration_path: Path = BASE_DIR / "calibration" / "calibration.json"


def _dir(value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else BASE_DIR / path


def _persist_viewer_token() -> str:
    """Create a viewer token once and store it in .env so it survives restarts."""
    token = secrets.token_urlsafe(24)
    ENV_PATH.touch(exist_ok=True)
    set_key(str(ENV_PATH), "VIEWER_TOKEN", token)
    try:
        os.chmod(ENV_PATH, 0o600)  # best effort; ignored on Windows
    except OSError:
        pass
    return token


def load_settings() -> Settings:
    load_dotenv(ENV_PATH)

    viewer_token = os.getenv("VIEWER_TOKEN", "").strip()
    is_new = False
    if not viewer_token:
        viewer_token = _persist_viewer_token()
        is_new = True

    phone_token = os.getenv("PHONE_TOKEN", "").strip() or secrets.token_urlsafe(16)

    model_path = Path(os.getenv("MODEL_PATH", "models/cards.pt"))
    if not model_path.is_absolute():
        model_path = BASE_DIR / model_path

    return Settings(
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8443")),
        tls=_flag("TLS", True),
        extra_sans=_split(os.getenv("EXTRA_SANS", "")),
        allowed_origins=_split(
            os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
        ),
        viewer_token=viewer_token,
        phone_token=phone_token,
        model_path=model_path,
        conf=float(os.getenv("CONF", "0.5")),
        imgsz=int(os.getenv("IMGSZ", "640")),
        device=os.getenv("DEVICE", "").strip(),
        max_frame_bytes=int(os.getenv("MAX_FRAME_BYTES", "2000000")),
        cert_dir=BASE_DIR / "certs",
        viewer_token_is_new=is_new,
        snapshot_dir=_dir(os.getenv("SNAPSHOT_DIR", "snapshots")),
        calibration_path=_dir(os.getenv("CALIBRATION", "calibration/calibration.json")),
    )
