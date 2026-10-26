"""Step 2: read the six seat outlines off your empty-board photo and write layout.json.

The generator uses layout.json to know where hands, the dealer and the card piles go.
Everything is stored as fractions of the photo's width/height, so the photo's resolution doesn't matter.
You can open layout.json and nudge any number by hand.

Run:  python layout_from_board.py --board "C:/Users/natal/Desktop/Fall 2026/image-references/empty-board.jpg"
"""
import argparse
import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps

WORK_WIDTH = 2000


def detect_seats(rgb: np.ndarray):
    scale = WORK_WIDTH / rgb.shape[1]
    small = cv2.resize(rgb, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    h, w = small.shape[:2]
    hsv = cv2.cvtColor(small, cv2.COLOR_RGB2HSV)
    white = ((hsv[..., 1] < 60) & (hsv[..., 2] > 170)).astype(np.uint8)
    contours, _ = cv2.findContours(white, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    seats = []
    for c in contours:
        rect = cv2.minAreaRect(c)
        (rw, rh) = rect[1]
        long_side, short_side = max(rw, rh), min(rw, rh)
        # a seat outline is card-shaped (about 160 x 232 at this width) and nothing else on the felt is
        if not (0.10 * w < long_side < 0.14 * w and 0.06 * w < short_side < 0.10 * w):
            continue
        if cv2.contourArea(c) < 0.5 * long_side * short_side:
            continue
        pts = c.reshape(-1, 2).astype(np.float32)
        centre = pts.mean(axis=0)
        _, _, vt = np.linalg.svd(pts - centre, full_matrices=False)
        d = vt[0]
        if d[1] > 0:
            d = -d                                    # make the long axis point "up"
        angle = math.degrees(math.atan2(d[0], -d[1]))  # clockwise from vertical
        seats.append({"x": round(float(centre[0] / w), 4), "y": round(float(centre[1] / h), 4),
                      "angle": round(angle, 1)})
    seats.sort(key=lambda s: s["x"])
    return seats, w / h


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--board", required=True, help="photo of the empty board (no cards on it)")
    ap.add_argument("--out", default="layout.json")
    args = ap.parse_args()

    rgb = np.array(ImageOps.exif_transpose(Image.open(args.board)).convert("RGB"))
    seats, aspect = detect_seats(rgb)
    print(f"found {len(seats)} seat outlines")
    if len(seats) != 6:
        print("Expected 6. Open layout.json afterwards and fix the seats by hand, or retake the photo "
              "with the whole board in frame and nothing on the felt.")
    layout = {
        "_note": "x, y are fractions of the board photo's width/height. angle = degrees clockwise from "
                 "'card upright'. Edit freely.",
        "board_aspect": round(aspect, 4),
        "card_width": 0.075,                 # card width as a fraction of the board photo's width
        "seats": seats,
        "dealer": {"x": 0.50, "y": 0.235, "x_jitter": 0.03, "y_jitter": 0.02},
        "discard_pile": {"x": 0.175, "y": 0.16, "jitter": 0.015, "present": 0.65},
        "shoe": {"x": 0.82, "y": 0.15, "jitter": 0.015, "present": 0.9},
    }
    Path(args.out).write_text(json.dumps(layout, indent=2))
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
