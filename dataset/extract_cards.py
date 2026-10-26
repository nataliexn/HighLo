"""Step 1: cut each card photo out of its background.

Reads  <src>/<code>.jpg   (e.g. AS.jpg, 10H.jpg, KD.jpg ...), one face-up card
                          lying on the board, photographed from above
and    <src>/<a board photo with a face-down card>  (for the card back)
writes assets/cards/<code>.png   upright, straightened, rounded-corner RGBA cutouts
       assets/back.png           the card back
       assets/cards_contact_sheet.jpg   a picture of everything it found, to eyeball

Run:  python extract_cards.py --src "C:/Users/natal/Desktop/Fall 2026/image-references"
"""
import argparse
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps

RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]
SUITS = ["S", "H", "D", "C"]
ALL_CODES = [r + s for s in SUITS for r in RANKS]

CARD_W, CARD_H = 450, 630          # 5:7, the real shape of a poker-size card
CORNER_RADIUS = 0.055 * CARD_W     # rounded corners
INSET = 2                          # shave the cutout's outer pixels (removes the edge halo)
WORK_SCALE = 0.25                  # segment on a quarter-size copy: fast and plenty accurate


def load_rgb(path: Path) -> np.ndarray:
    return np.array(ImageOps.exif_transpose(Image.open(path)).convert("RGB"))


def order_quad(pts: np.ndarray) -> np.ndarray:
    """Return the 4 corners as top-left, top-right, bottom-right, bottom-left."""
    pts = pts.reshape(4, 2).astype(np.float32)
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).ravel()
    return np.array([pts[np.argmin(s)], pts[np.argmin(d)], pts[np.argmax(s)], pts[np.argmax(d)]], np.float32)


def card_quad(rgb_small: np.ndarray):
    """Find the top card (the brightest large blob) and return its 4 corners (small-image coords)."""
    gray = cv2.GaussianBlur(cv2.cvtColor(rgb_small, cv2.COLOR_RGB2GRAY), (5, 5), 0)
    # The card under the top one shows a slightly darker edge. 215 separates the two.
    for threshold in (215, 205, 225, 195):
        mask = (gray > threshold).astype(np.uint8)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue
        c = max(contours, key=cv2.contourArea)
        area = cv2.contourArea(c)
        frac = area / float(gray.shape[0] * gray.shape[1])
        if not 0.05 < frac < 0.45:
            continue
        hull = cv2.convexHull(c)
        rect = cv2.minAreaRect(hull)
        (w, h) = rect[1]
        if min(w, h) < 1 or cv2.contourArea(hull) / (w * h) < 0.85:
            continue
        # 4-corner polygon of the hull (corrects perspective); fall back to the rotated rectangle
        quad = None
        peri = cv2.arcLength(hull, True)
        for eps in (0.02, 0.03, 0.04, 0.05, 0.06):
            approx = cv2.approxPolyDP(hull, eps * peri, True)
            if len(approx) == 4:
                quad = approx
                break
        if quad is None:
            quad = cv2.boxPoints(rect)
        return order_quad(np.asarray(quad)), threshold
    return None, None


def rounded_mask(w: int, h: int, radius: float, inset: int) -> np.ndarray:
    scale = 4  # draw 4x then shrink: smooth edges
    m = np.zeros((h * scale, w * scale), np.uint8)
    x0, y0, x1, y1 = [v * scale for v in (inset, inset, w - 1 - inset, h - 1 - inset)]
    r = int(radius * scale)
    cv2.rectangle(m, (x0 + r, y0), (x1 - r, y1), 255, -1)
    cv2.rectangle(m, (x0, y0 + r), (x1, y1 - r), 255, -1)
    for cx, cy in ((x0 + r, y0 + r), (x1 - r, y0 + r), (x0 + r, y1 - r), (x1 - r, y1 - r)):
        cv2.circle(m, (cx, cy), r, 255, -1)
    return cv2.resize(m, (w, h), interpolation=cv2.INTER_AREA)


def cutout(rgb_full: np.ndarray):
    small = cv2.resize(rgb_full, None, fx=WORK_SCALE, fy=WORK_SCALE, interpolation=cv2.INTER_AREA)
    quad, threshold = card_quad(small)
    if quad is None:
        return None, None
    quad_full = quad / WORK_SCALE
    # make sure the long side is vertical: a card on the table is portrait
    top, left = np.linalg.norm(quad_full[1] - quad_full[0]), np.linalg.norm(quad_full[3] - quad_full[0])
    if top > left:
        quad_full = np.roll(quad_full, -1, axis=0)
    dst = np.array([[0, 0], [CARD_W - 1, 0], [CARD_W - 1, CARD_H - 1], [0, CARD_H - 1]], np.float32)
    flat = cv2.warpPerspective(rgb_full, cv2.getPerspectiveTransform(quad_full.astype(np.float32), dst),
                               (CARD_W, CARD_H), flags=cv2.INTER_AREA)
    alpha = rounded_mask(CARD_W, CARD_H, CORNER_RADIUS, INSET)
    flat = white_balance(flat, alpha)
    alpha = trim_dark_edges(flat, alpha)
    return np.dstack([flat, alpha]), threshold


def white_balance(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """The photos have a warm cast; make the card paper neutral white again."""
    inside = alpha > 250
    bright = inside & (rgb.min(axis=2) > 170)
    if bright.sum() < 1000:
        return rgb
    paper = np.median(rgb[bright], axis=0)
    gain = np.array([238.0, 238.0, 236.0]) / np.maximum(paper, 1.0)
    return np.clip(rgb.astype(np.float32) * gain, 0, 255).astype(np.uint8)


def trim_dark_edges(rgb: np.ndarray, alpha: np.ndarray, band: int = 14) -> np.ndarray:
    """If the outline was a hair off, a sliver of dark felt can stay along an edge. Drop it."""
    gray = rgb.mean(axis=2)
    edge = np.zeros(gray.shape, bool)
    edge[:band, :] = edge[-band:, :] = True
    edge[:, :band] = edge[:, -band:] = True
    dark = (gray < 165) & edge
    dark = cv2.dilate(dark.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
    out = alpha.copy()
    out[dark] = 0
    return out


def find_back(rgb_full: np.ndarray):
    """Find one face-down card (red back) lying on its own in a board photo."""
    scale = 0.25
    small = cv2.resize(rgb_full, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    hsv = cv2.cvtColor(small, cv2.COLOR_RGB2HSV)
    hue, sat, val = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    red = (((hue < 12) | (hue > 165)) & (sat > 45) & (val > 120)).astype(np.uint8)
    red = cv2.morphologyEx(red, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    contours, _ = cv2.findContours(red, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    best = None
    for c in contours:
        rect = cv2.minAreaRect(c)
        (w, h) = rect[1]
        if min(w, h) < 20:
            continue
        ratio = min(w, h) / max(w, h)
        solidity = cv2.contourArea(c) / (w * h)
        # a single card back: card-shaped, solid, and about the size of the other cards (~ 1.3% of a 4032x3024 photo)
        area_frac = cv2.contourArea(c) / (small.shape[0] * small.shape[1])
        if 0.62 < ratio < 0.82 and solidity > 0.88 and 0.006 < area_frac < 0.03:
            score = solidity - abs(ratio - 0.714)
            if best is None or score > best[0]:
                best = (score, rect)
    if best is None:
        return None
    quad = order_quad(cv2.boxPoints(best[1])) / scale
    top, left = np.linalg.norm(quad[1] - quad[0]), np.linalg.norm(quad[3] - quad[0])
    if top > left:
        quad = np.roll(quad, -1, axis=0)
    dst = np.array([[0, 0], [CARD_W - 1, 0], [CARD_W - 1, CARD_H - 1], [0, CARD_H - 1]], np.float32)
    flat = cv2.warpPerspective(rgb_full, cv2.getPerspectiveTransform(quad.astype(np.float32), dst),
                               (CARD_W, CARD_H), flags=cv2.INTER_AREA)
    return np.dstack([flat, rounded_mask(CARD_W, CARD_H, CORNER_RADIUS, INSET + 2)])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", required=True, help="folder with the card photos (AS.jpg, 10H.jpg, ...) and board photos")
    ap.add_argument("--out", default="assets", help="where to write the cutouts (default: assets)")
    ap.add_argument("--back-from", default=None,
                    help="board photo to take one face-down card from "
                         "(default: tries every board-*.jpg until one works)")
    args = ap.parse_args()

    src, out = Path(args.src), Path(args.out)
    (out / "cards").mkdir(parents=True, exist_ok=True)

    found, missing, failed = [], [], []
    for code in ALL_CODES:
        path = src / f"{code}.jpg"
        if not path.exists():
            missing.append(code)
            continue
        rgba, threshold = cutout(load_rgb(path))
        if rgba is None:
            failed.append(code)
            continue
        Image.fromarray(rgba, "RGBA").save(out / "cards" / f"{code}.png")
        found.append(code)

    # the card back
    back = None
    candidates = [Path(args.back_from)] if args.back_from else sorted(src.glob("board-*.jpg"))
    for cand in candidates:
        back = find_back(load_rgb(cand))
        if back is not None:
            print(f"card back taken from {cand.name}")
            break
    if back is not None:
        Image.fromarray(back, "RGBA").save(out / "back.png")

    # contact sheet to eyeball the result
    tiles = []
    for code in ALL_CODES + ["back"]:
        p = out / ("back.png" if code == "back" else f"cards/{code}.png")
        tile = np.full((315, 225, 3), (40, 110, 60), np.uint8)
        if p.exists():
            rgba = np.array(Image.open(p).convert("RGBA").resize((225, 315)))
            a = rgba[..., 3:4] / 255.0
            tile = (rgba[..., :3] * a + tile * (1 - a)).astype(np.uint8)
        cv2.putText(tile, code, (6, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
        tiles.append(tile)
    cols = 14
    while len(tiles) % cols:
        tiles.append(np.full_like(tiles[0], 30))
    rows = [np.hstack(tiles[i:i + cols]) for i in range(0, len(tiles), cols)]
    sheet = cv2.resize(np.vstack(rows), None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA)
    Image.fromarray(sheet).save(out / "cards_contact_sheet.jpg", quality=88)

    print(f"cut out {len(found)}/52 cards -> {out / 'cards'}")
    if missing:
        print("MISSING photos (no <code>.jpg found):", ", ".join(missing))
    if failed:
        print("COULD NOT SEGMENT:", ", ".join(failed))
    if back is None:
        print("COULD NOT FIND a face-down card. Use --back-from <a board photo with a lone face-down card>.")
    print(f"open {out / 'cards_contact_sheet.jpg'} and check that every card is straight and complete.")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
