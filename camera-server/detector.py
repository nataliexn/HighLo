"""Card detection. Wraps an Ultralytics YOLO model, or does nothing without one."""
from __future__ import annotations

import logging
import math
from pathlib import Path
from typing import Protocol

log = logging.getLogger("highlo.detector")

RANKS = {"A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"}
RANK_WORDS = {
    "ace": "A", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6",
    "seven": "7", "eight": "8", "nine": "9", "ten": "10", "jack": "J",
    "queen": "Q", "king": "K",
}
SUIT_WORDS = {
    "spade": "S", "spades": "S", "heart": "H", "hearts": "H",
    "diamond": "D", "diamonds": "D", "club": "C", "clubs": "C",
}


def to_highlo_code(label: str) -> str | None:
    """Turn a model class name into HighLo's card code ("KH", "10D", "AS").

    Understands compact names ("kh", "10H") and spelled-out ones
    ("king of hearts", "ten_of_clubs"). Returns None if it isn't a card.
    """
    text = label.strip().lower().replace("_", " ").replace("-", " ")
    words = text.replace(" of ", " ").split()
    if len(words) == 2 and words[1] in SUIT_WORDS:
        rank = RANK_WORDS.get(words[0], words[0].upper())
        return f"{rank}{SUIT_WORDS[words[1]]}" if rank in RANKS else None
    compact = text.replace(" ", "").upper()
    if len(compact) in (2, 3) and compact[-1] in "SHDC" and compact[:-1] in RANKS:
        return compact
    return None


def long_side_angle(w: float, h: float, rotation: float) -> float:
    """Direction of a rotated box's long side, in degrees clockwise from vertical (-90..90).

    `rotation` is Ultralytics' OBB angle in radians: the direction of the box's `w`
    side, measured from the x axis towards y (clockwise on screen). A card's long side
    is its upright, so a card lying sideways reads about 90 degrees off its seat."""
    vx, vy = (math.cos(rotation), math.sin(rotation)) if w >= h else (-math.sin(rotation), math.cos(rotation))
    angle = math.degrees(math.atan2(vx, -vy))
    return (angle + 90.0) % 180.0 - 90.0


def usable_device(device: str) -> str | None:
    """DEVICE from .env, or the CPU when it asks for a GPU this Python can't use.

    Ultralytics would otherwise fail on every single frame. The usual cause is a
    CPU-only PyTorch, for example when the server is started from a virtual
    environment that has its own copy of torch."""
    device = (device or "").strip()
    if not device or device.lower() in ("cpu", "mps"):
        return device or None
    try:
        import torch

        if torch.cuda.is_available():
            return device
        build = getattr(torch, "__version__", "unknown version")
    except ImportError:
        build = "not installed"
    log.warning(
        "DEVICE=%s asks for an NVIDIA GPU, but this Python's PyTorch (%s) can't use one, so detection runs on "
        "the CPU (slow). Start the server with the Python that has the CUDA build of torch, or install it here.",
        device, build,
    )
    return "cpu"


class Detector(Protocol):
    loaded: bool
    name: str | None

    def predict(self, bgr_image) -> list[dict]: ...


class NullDetector:
    """Used when there is no model: the server still relays video."""

    loaded = False
    name = None

    def predict(self, bgr_image) -> list[dict]:
        return []


class YoloDetector:
    loaded = True

    def __init__(self, model_path: Path, conf: float, imgsz: int, device: str):
        from ultralytics import YOLO  # imported late so the server runs without it

        self.name = model_path.name
        self.conf = conf
        self.imgsz = imgsz
        self.device = usable_device(device)
        self.model = YOLO(str(model_path))

    def predict(self, bgr_image) -> list[dict]:
        result = self.model.predict(
            bgr_image, conf=self.conf, imgsz=self.imgsz, device=self.device, agnostic_nms=True, verbose=False
        )[0]
        height, width = result.orig_shape
        names = result.names
        found = []

        def entry(cls, conf, x1, y1, x2, y2, angle=None):
            label = str(names[int(cls)])
            item = {
                "label": label,
                "code": to_highlo_code(label),
                "conf": round(float(conf), 3),
                # normalised 0-1 so the viewer can draw it at any size
                "box": [round(x1 / width, 4), round(y1 / height, 4), round(x2 / width, 4), round(y2 / height, 4)],
            }
            if angle is not None:
                item["angle"] = round(angle, 1)
            return item

        obb = getattr(result, "obb", None)
        if obb is not None:
            # An oriented-box model (yolo obb): also tells which way each card lies,
            # which is how a sideways double-down card is recognised.
            for (x1, y1, x2, y2), (_, _, w, h, r), cls, conf in zip(
                obb.xyxy.tolist(), obb.xywhr.tolist(), obb.cls.tolist(), obb.conf.tolist()
            ):
                found.append(entry(cls, conf, x1, y1, x2, y2, long_side_angle(w, h, r)))
        elif result.boxes is not None:
            for box in result.boxes:
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                found.append(entry(box.cls[0], box.conf[0], x1, y1, x2, y2))
        return found


def build_detector(model_path: Path, conf: float, imgsz: int, device: str) -> Detector:
    if not model_path.exists():
        log.warning("No model at %s - streaming video only, no card detection.", model_path)
        return NullDetector()
    try:
        detector = YoloDetector(model_path, conf, imgsz, device)
    except ImportError:
        log.warning("`ultralytics` is not installed - streaming video only.")
        return NullDetector()
    except Exception as exc:  # corrupt model file, bad device name, ...
        log.error("Could not load %s (%s) - streaming video only.", model_path, exc)
        return NullDetector()
    log.info("Loaded detection model %s", model_path.name)
    return detector
