"""Calibrate HighLo's table zones from the real camera frame.

    python calibrate.py --board path/to/empty-board.jpg \
        --layout path/to/layout.json --frame snapshots/snap_xxx.jpg

Aligns the empty-board photo to the camera frame (SIFT + RANSAC homography),
maps the seat / dealer / shoe / discard positions from layout.json into the
camera frame, and writes calibration/calibration.json, calibration/reference.jpg
(the frame used) and calibration/zones_preview.jpg (check it by eye).
All coordinates are normalised 0..1 of the camera frame (x right, y down).
"""
import argparse, json, shutil, sys
from pathlib import Path
import cv2
import numpy as np

OUT = Path(__file__).parent / "calibration"


def align(board, frame):
    sift = cv2.SIFT_create(6000)
    g1 = cv2.cvtColor(board, cv2.COLOR_BGR2GRAY)
    g2 = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(3.0, (8, 8))
    k1, d1 = sift.detectAndCompute(clahe.apply(g1), None)
    k2, d2 = sift.detectAndCompute(clahe.apply(g2), None)
    m = cv2.BFMatcher().knnMatch(d1, d2, k=2)
    good = [a for a, b in (p for p in m if len(p) == 2) if a.distance < 0.75 * b.distance]
    if len(good) < 12:
        raise SystemExit(f"only {len(good)} matches; cannot align")
    src = np.float32([k1[g.queryIdx].pt for g in good])
    dst = np.float32([k2[g.trainIdx].pt for g in good])
    H, mask = cv2.findHomography(src, dst, cv2.RANSAC, 4.0)
    return H, int(mask.sum()), len(good)


def card_quad(cx, cy, w, h, ang):
    """Corners of a card (w x h, px) centred at cx,cy, rotated ang deg clockwise."""
    a = np.radians(ang)
    R = np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]])
    pts = np.array([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]])
    return (pts @ R.T) + [cx, cy]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--board", required=True)
    ap.add_argument("--layout", required=True)
    ap.add_argument("--frame", required=True)
    a = ap.parse_args()
    board, frame = cv2.imread(a.board), cv2.imread(a.frame)
    layout = json.load(open(a.layout))
    bh, bw = board.shape[:2]
    fh, fw = frame.shape[:2]
    H, inl, total = align(board, frame)
    print(f"homography from {inl}/{total} matches")

    def to_frame(nx, ny):
        p = cv2.perspectiveTransform(np.float32([[[nx * bw, ny * bh]]]), H)[0, 0]
        return float(p[0] / fw), float(p[1] / fh)

    # local scale (frame px per board px) and rotation, from the homography
    c = np.float32([[[bw / 2, bh / 2]], [[bw / 2 + 100, bh / 2]]])
    q = cv2.perspectiveTransform(c, H)[:, 0]
    scale = float(np.hypot(*(q[1] - q[0])) / 100)
    rot = float(np.degrees(np.arctan2(q[1][1] - q[0][1], q[1][0] - q[0][0])))
    print(f"scale {scale:.3f}  rotation {rot:.2f} deg")

    cw = layout["card_width"] * bw * scale          # card width in frame px
    chh = cw * 1.4
    seats = []
    # layout seats are sorted left->right, so seat numbers run 6..1
    for i, s in enumerate(layout["seats"]):
        x, y = to_frame(s["x"], s["y"])
        seats.append({"seat": len(layout["seats"]) - i, "x": x, "y": y, "angle": s["angle"] + rot})
    def pt(k):
        return to_frame(*layout[k]) if isinstance(layout[k], list) else to_frame(layout[k]["x"], layout[k]["y"])
    zones = {
        "seats": seats,
        "dealer": dict(zip("xy", pt("dealer"))),
        "shoe": dict(zip("xy", pt("shoe"))),
        "discard": dict(zip("xy", pt("discard_pile"))),
        "card_w": cw / fw, "card_h": chh / fh,
    }
    OUT.mkdir(exist_ok=True)
    json.dump({"frame_size": [fw, fh], "board_size": [bw, bh], "board_to_frame": H.tolist(),
               "inliers": inl, "matches": total, "zones": zones},
              open(OUT / "calibration.json", "w"), indent=2)
    if Path(a.frame).resolve() != (OUT / "reference.jpg").resolve():
        shutil.copy(a.frame, OUT / "reference.jpg")

    prev = frame.copy()
    for s in seats:
        cx, cy = s["x"] * fw, s["y"] * fh
        cv2.polylines(prev, [card_quad(cx, cy, cw * 1.4, chh * 1.5, s["angle"]).astype(np.int32)], True, (0, 255, 255), 2)
        cv2.putText(prev, f"seat {s['seat']}", (int(cx) - 30, int(cy) + 5), 0, 0.7, (0, 255, 255), 2)
    for name, col in (("dealer", (255, 150, 0)), ("shoe", (0, 0, 255)), ("discard", (255, 0, 255))):
        z = zones[name]
        cx, cy = z["x"] * fw, z["y"] * fh
        cv2.circle(prev, (int(cx), int(cy)), int(cw), col, 2)
        cv2.putText(prev, name, (int(cx) - 25, int(cy)), 0, 0.7, col, 2)
    cv2.imwrite(str(OUT / "zones_preview.jpg"), prev)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
