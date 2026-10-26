"""Card detection. Wraps an Ultralytics YOLO model, or does nothing without one."""
from __future__ import annotations

import logging
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
        self.device = device or None
        self.model = YOLO(str(model_path))

    def predict(self, bgr_image) -> list[dict]:
        result = self.model.predict(
            bgr_image, conf=self.conf, imgsz=self.imgsz, device=self.device, agnostic_nms=True, verbose=False
        )[0]
        height, width = result.orig_shape
        names = result.names
        found = []
        for box in result.boxes:
            label = str(names[int(box.cls[0])])
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            found.append(
                {
                    "label": label,
                    "code": to_highlo_code(label),
                    "conf": round(float(box.conf[0]), 3),
                    # normalised 0-1 so the viewer can draw it at any size
                    "box": [
                        round(x1 / width, 4), round(y1 / height, 4),
                        round(x2 / width, 4), round(y2 / height, 4),
                    ],
                }
            )
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
