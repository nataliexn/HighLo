"""Step 3: make a labelled training set of fake table photos, ready for YOLO.

It pastes your real card cutouts (assets/) onto your real empty-board photo - dealer cards,
fanned player hands, face-down hole cards, the discard pile and the shoe - then makes each
picture look like a phone photo (angle, lighting, blur, noise). The label of every card is
the part of it you can actually see, which is exactly what the detector has to find.

Run:  python generate.py --board "C:/Users/natal/Desktop/Fall 2026/image-references/empty-board.jpg" --count 3000
Out:  dataset/images/{train,val}/*.jpg   dataset/labels/{train,val}/*.txt   dataset/data.yaml
"""
import argparse
import json
import math
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps

from extract_cards import ALL_CODES

BACK_CLASS = len(ALL_CODES)                # 52
CLASS_NAMES = ALL_CODES + ["back"]         # "AS", "2S", ... "KC", "back"
SCENE_WIDTH = 2000                         # the empty-board photo is shrunk to this width for compositing
MIN_VISIBLE = 0.18                         # a card with less than this fraction showing gets no label
MIN_BOX = 10                               # px, in the output picture

_assets = {}


# ---------------------------------------------------------------- assets
def load_assets(assets_dir: Path, board_path: Path, layout_path: Path, calibration_path: str = ""):
    cards = {}
    for code in ALL_CODES:
        p = assets_dir / "cards" / f"{code}.png"
        if p.exists():
            cards[code] = np.array(Image.open(p).convert("RGBA"))
    back_path = assets_dir / "back.png"
    if not back_path.exists():
        raise SystemExit("assets/back.png is missing - run extract_cards.py first")
    back = np.array(Image.open(back_path).convert("RGBA"))
    if not cards:
        raise SystemExit("no card cutouts in assets/cards - run extract_cards.py first")
    board = np.array(ImageOps.exif_transpose(Image.open(board_path)).convert("RGB"))
    scale = SCENE_WIDTH / board.shape[1]
    scene = cv2.resize(board, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    layout = json.loads(layout_path.read_text())
    scene_to_frame = None
    if calibration_path:
        cal = json.loads(Path(calibration_path).read_text())
        S = np.diag([board.shape[1] / scene.shape[1], board.shape[0] / scene.shape[0], 1.0])  # scene px -> board px
        scene_to_frame = np.array(cal["board_to_frame"]) @ S
        scene_to_frame /= scene_to_frame[2, 2]
    return {"cards": cards, "back": back, "scene": scene, "layout": layout, "scene_to_frame": scene_to_frame}


def init_worker(assets_dir, board_path, layout_path, calibration_path=""):
    global _assets
    _assets = load_assets(Path(assets_dir), Path(board_path), Path(layout_path), calibration_path)


# ---------------------------------------------------------------- drawing
def paste_card(scene, idmap, rgba, cx, cy, width, theta_deg, inst, rng, shade=1.0, shadow=0.35):
    """Draw one card (centre cx,cy; width in px; rotated clockwise by theta). Returns its full pixel area."""
    h0, w0 = rgba.shape[:2]
    cw = max(8, int(round(width)))
    ch = max(8, int(round(width * h0 / w0)))
    small = cv2.resize(rgba, (cw, ch), interpolation=cv2.INTER_AREA)
    th = math.radians(theta_deg)
    c, s = math.cos(th), math.sin(th)
    tx = cx - (c * cw / 2 - s * ch / 2)
    ty = cy - (s * cw / 2 + c * ch / 2)
    corners = np.array([[0, 0], [cw, 0], [cw, ch], [0, ch]], np.float32)
    pts = np.stack([c * corners[:, 0] - s * corners[:, 1] + tx, s * corners[:, 0] + c * corners[:, 1] + ty], 1)
    pad = 10
    x0, y0 = int(pts[:, 0].min()) - pad, int(pts[:, 1].min()) - pad
    x1, y1 = int(pts[:, 0].max()) + pad, int(pts[:, 1].max()) + pad
    H, W = scene.shape[:2]
    X0, Y0, X1, Y1 = max(x0, 0), max(y0, 0), min(x1, W), min(y1, H)
    if X1 <= X0 or Y1 <= Y0:
        return 0
    M = np.array([[c, -s, tx - X0], [s, c, ty - Y0]], np.float32)
    warped = cv2.warpAffine(small, M, (X1 - X0, Y1 - Y0), flags=cv2.INTER_LINEAR,
                            borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
    alpha = warped[..., 3].astype(np.float32) / 255.0
    roi = scene[Y0:Y1, X0:X1].astype(np.float32)
    if shadow > 0:                                   # soft drop shadow, a few px down-right
        sh = cv2.GaussianBlur(alpha, (0, 0), 3.0)
        sh = np.roll(np.roll(sh, 3, axis=0), 4, axis=1)
        roi *= (1.0 - shadow * sh)[..., None]
    rgb = warped[..., :3].astype(np.float32) * shade
    roi = roi * (1 - alpha[..., None]) + rgb * alpha[..., None]
    scene[Y0:Y1, X0:X1] = np.clip(roi, 0, 255).astype(np.uint8)
    idmap[Y0:Y1, X0:X1][alpha > 0.5] = inst
    return int((alpha > 0.5).sum())


def pick_code(rng, codes):
    return codes[int(rng.integers(len(codes)))]


def build_scene(rng, assets):
    """Compose one table. Returns (scene_rgb, idmap, instances) where instances[inst] = (class_id, full_area)."""
    layout, cards, back = assets["layout"], assets["cards"], assets["back"]
    scene = assets["scene"].copy()
    H, W = scene.shape[:2]
    idmap = np.zeros((H, W), np.uint16)
    inst_info = {}
    next_inst = [1]
    codes = sorted(cards)
    card_w = layout["card_width"] * W

    def new_inst(class_id):
        i = next_inst[0]
        next_inst[0] += 1
        inst_info[i] = [class_id, 0]
        return i

    def draw(face, cx, cy, width, theta, inst, shade):
        img = back if face == "back" else cards[face]
        inst_info[inst][1] += paste_card(scene, idmap, img, cx, cy, width, theta, inst, rng, shade)

    # --- piles: stacks of face-down cards, labelled as one "back" each
    for key in ("discard_pile", "shoe"):
        spec = layout[key]
        if rng.random() > spec["present"]:
            continue
        cx = (spec["x"] + rng.uniform(-1, 1) * spec["jitter"]) * W
        cy = (spec["y"] + rng.uniform(-1, 1) * spec["jitter"]) * H
        theta = rng.normal(0, 2.5)
        inst = new_inst(BACK_CLASS)
        for layer in range(int(rng.integers(3, 14))):          # a thicker pile = more offset copies
            draw("back", cx + layer * rng.uniform(0.3, 0.9), cy - layer * rng.uniform(0.5, 1.4),
                 card_w * rng.uniform(0.97, 1.03), theta + rng.normal(0, 0.4), inst, 0.97 + 0.03 * rng.random())

    # --- dealer: a row of cards above the arc, sometimes with a face-down hole card
    n_dealer = int(rng.choice([0, 1, 2, 3, 4], p=[0.06, 0.12, 0.52, 0.2, 0.10]))
    if n_dealer:
        d = layout["dealer"]
        gap = rng.uniform(1.03, 1.22)
        cx0 = (d["x"] + rng.uniform(-1, 1) * d["x_jitter"]) * W
        cy0 = (d["y"] + rng.uniform(-1, 1) * d["y_jitter"]) * H
        w = card_w * rng.uniform(0.96, 1.04)
        hole = n_dealer >= 2 and rng.random() < 0.5
        base_theta = rng.normal(0, 2.0)
        for i in range(n_dealer):
            face = "back" if (hole and i == 0) else pick_code(rng, codes)
            x = cx0 + (i - (n_dealer - 1) / 2) * w * gap
            inst = new_inst(BACK_CLASS if face == "back" else CLASS_NAMES.index(face))
            draw(face, x, cy0 + rng.normal(0, 0.004 * H), w, base_theta + rng.normal(0, 1.5), inst,
                 rng.uniform(0.94, 1.04))

    # --- players: 1-6 seats, each a fanned hand where later cards sit on top of earlier ones
    n_seats = int(rng.choice([0, 1, 2, 3, 4, 5, 6], p=[0.03, 0.10, 0.17, 0.22, 0.20, 0.16, 0.12]))
    seats = [layout["seats"][i] for i in rng.permutation(len(layout["seats"]))[:n_seats]]
    for seat in seats:
        n_cards = int(rng.choice([1, 2, 3, 4, 5, 6], p=[0.04, 0.46, 0.26, 0.14, 0.07, 0.03]))
        hand_theta = seat["angle"] + rng.normal(0, 5.0)
        w = card_w * rng.uniform(0.95, 1.05)
        h = w * 1.4
        sideways = rng.random() < 0.2
        cx = seat["x"] * W + rng.uniform(-0.012, 0.012) * W
        cy = seat["y"] * H + rng.uniform(-0.012, 0.012) * W
        th = math.radians(hand_theta)
        c, s = math.cos(th), math.sin(th)
        for i in range(n_cards):
            code = pick_code(rng, codes)
            theta = hand_theta + rng.normal(0, 2.5)
            inst = new_inst(CLASS_NAMES.index(code))
            draw(code, cx, cy, w, theta, inst, rng.uniform(0.92, 1.05))
            if sideways:
                dx, dy = rng.uniform(0.32, 0.46) * w, rng.uniform(-0.04, 0.04) * h
            else:
                dx, dy = rng.uniform(-0.08, 0.08) * w, rng.uniform(0.27, 0.40) * h
            cx += c * dx - s * dy       # offset in the hand's own (rotated) frame
            cy += s * dx + c * dy
    return scene, idmap, inst_info


# ---------------------------------------------------------------- camera + photo look
def floor_texture(rng, w, h):
    base = rng.uniform(85, 150)
    tint = np.array([1.0, rng.uniform(0.92, 1.0), rng.uniform(0.85, 0.97)])
    tex = np.full((h, w, 3), base, np.float32) * tint
    noise = cv2.GaussianBlur(rng.normal(0, 1, (h, w)).astype(np.float32), (0, 0), 6) * 40
    tex += noise[..., None]
    plank = int(rng.integers(120, 220))
    tilt = rng.uniform(-0.05, 0.05)
    for y in range(-plank, h + plank, plank):
        pts = np.array([[0, y], [w, y + tilt * w]], np.int32)
        cv2.polylines(tex, [pts.reshape(-1, 1, 2)], False, (base * 0.45,) * 3, 2)
    return np.clip(tex, 0, 255).astype(np.uint8)


def camera_view(rng, scene, idmap, out_w, out_h, scene_to_frame=None):
    """Where the phone looks. Free mode: board is 75-95% of the frame width, slightly off-centre and skewed.
    Fixed mode (scene_to_frame given): the real camera framing from calibrate.py, wobbled a little
    because the phone stand moves between sessions."""
    H, W = scene.shape[:2]
    if scene_to_frame is not None:
        corners = np.array([[0, 0], [out_w, 0], [out_w, out_h], [0, out_h]], np.float32)
        wobble = corners + rng.normal(0, 0.006 * out_w, corners.shape).astype(np.float32)
        Hm = cv2.getPerspectiveTransform(corners, wobble) @ scene_to_frame
        return _warp_scene(rng, scene, idmap, Hm, out_w, out_h)
    k = rng.uniform(0.76, 0.95)
    sw, sh = out_w * k, out_w * k * H / W
    cx = out_w / 2 + rng.normal(0, 0.025) * out_w
    cy = out_h / 2 + rng.normal(0, 0.03) * out_h
    rot = math.radians(rng.normal(0, 2.0))
    c, s = math.cos(rot), math.sin(rot)
    src = np.array([[0, 0], [W, 0], [W, H], [0, H]], np.float32)
    rel = np.array([[-sw / 2, -sh / 2], [sw / 2, -sh / 2], [sw / 2, sh / 2], [-sw / 2, sh / 2]], np.float32)
    dst = np.stack([c * rel[:, 0] - s * rel[:, 1] + cx, s * rel[:, 0] + c * rel[:, 1] + cy], 1)
    dst += rng.normal(0, 0.007 * out_w, dst.shape).astype(np.float32)      # perspective wobble
    Hm = cv2.getPerspectiveTransform(src, dst.astype(np.float32))
    return _warp_scene(rng, scene, idmap, Hm, out_w, out_h)


def _warp_scene(rng, scene, idmap, Hm, out_w, out_h):
    H, W = scene.shape[:2]
    img = cv2.warpPerspective(scene, Hm, (out_w, out_h), flags=cv2.INTER_AREA)
    cover = cv2.warpPerspective(np.full((H, W), 255, np.uint8), Hm, (out_w, out_h), flags=cv2.INTER_LINEAR)
    ids = cv2.warpPerspective(idmap, Hm, (out_w, out_h), flags=cv2.INTER_NEAREST)
    floor = floor_texture(rng, out_w, out_h)
    m = (cv2.GaussianBlur(cover, (0, 0), 1.2).astype(np.float32) / 255.0)[..., None]
    img = (img.astype(np.float32) * m + floor.astype(np.float32) * (1 - m)).astype(np.uint8)
    return img, ids, float(abs(np.linalg.det(Hm[:2, :2])))


def phone_look(rng, img):
    """Exposure, white balance, uneven light, glare, blur, noise and JPEG - the way a phone photo goes wrong."""
    f = img.astype(np.float32) / 255.0
    dim = rng.random() < 0.3                                   # your real camera-distance shot was dim
    gamma = rng.uniform(1.1, 1.7) if dim else rng.uniform(0.8, 1.15)
    f = np.power(np.clip(f, 0, 1), gamma)
    f = (f - 0.5) * rng.uniform(0.85, 1.2) + 0.5
    f *= np.array([rng.uniform(0.94, 1.08), 1.0, rng.uniform(0.9, 1.06)], np.float32)   # warm / cool
    h, w = f.shape[:2]
    gx, gy = np.meshgrid(np.linspace(-1, 1, w), np.linspace(-1, 1, h))
    ang = rng.uniform(0, 2 * math.pi)
    f *= (1 + rng.uniform(0.0, 0.18) * (math.cos(ang) * gx + math.sin(ang) * gy))[..., None]   # uneven light
    if rng.random() < 0.3:                                     # a soft glare spot
        px, py = rng.uniform(-0.8, 0.8), rng.uniform(-0.8, 0.8)
        spot = np.exp(-(((gx - px) / rng.uniform(0.15, 0.4)) ** 2 + ((gy - py) / rng.uniform(0.15, 0.4)) ** 2))
        f += (rng.uniform(0.05, 0.25) * spot)[..., None]
    f = np.clip(f, 0, 1)
    out = (f * 255).astype(np.uint8)
    r = rng.random()
    if r < 0.2:                                                # slight motion blur (a wobbly stand)
        n = int(rng.integers(3, 8))
        kern = np.zeros((n, n), np.float32)
        kern[n // 2, :] = 1.0 / n
        M = cv2.getRotationMatrix2D((n / 2 - 0.5, n / 2 - 0.5), rng.uniform(0, 180), 1)
        kern = cv2.warpAffine(kern, M, (n, n))
        out = cv2.filter2D(out, -1, kern / max(kern.sum(), 1e-6))
    elif r < 0.75:
        out = cv2.GaussianBlur(out, (0, 0), rng.uniform(0.3, 1.4))
    noise = rng.normal(0, rng.uniform(1, 6), out.shape)
    out = np.clip(out.astype(np.float32) + noise, 0, 255).astype(np.uint8)
    ok, enc = cv2.imencode(".jpg", out, [cv2.IMWRITE_JPEG_QUALITY, int(rng.integers(68, 96))])
    return cv2.imdecode(enc, cv2.IMREAD_COLOR) if ok else out   # same channel order in and out (RGB)


# ---------------------------------------------------------------- labels
def labels_from_ids(ids, inst_info, scale2, out_w, out_h):
    labels = []
    for inst, (class_id, full_area) in inst_info.items():
        ys, xs = np.nonzero(ids == inst)
        if xs.size == 0 or full_area == 0:
            continue
        visible = xs.size / (full_area * scale2)
        x0, x1, y0, y1 = int(xs.min()), int(xs.max()) + 1, int(ys.min()), int(ys.max()) + 1
        if (x1 - x0) < MIN_BOX or (y1 - y0) < MIN_BOX:
            continue
        # a pile is many stacked backs sharing one id, so the ratio test only applies to single cards
        if class_id != BACK_CLASS and visible < MIN_VISIBLE:
            continue
        labels.append((class_id, (x0 + x1) / 2 / out_w, (y0 + y1) / 2 / out_h, (x1 - x0) / out_w, (y1 - y0) / out_h))
    return labels


def make_one(job):
    index, seed, out_w, out_h, split, out_dir, preview = job
    rng = np.random.default_rng(seed)
    scene, idmap, info = build_scene(rng, _assets)
    img, ids, scale2 = camera_view(rng, scene, idmap, out_w, out_h, _assets.get("scene_to_frame"))
    labels = labels_from_ids(ids, info, scale2, out_w, out_h)
    img = phone_look(rng, img)
    name = f"synth_{index:06d}"
    out_dir = Path(out_dir)
    cv2.imwrite(str(out_dir / "images" / split / f"{name}.jpg"), cv2.cvtColor(img, cv2.COLOR_RGB2BGR),
                [cv2.IMWRITE_JPEG_QUALITY, 92])
    (out_dir / "labels" / split / f"{name}.txt").write_text(
        "".join(f"{c} {x:.6f} {y:.6f} {w:.6f} {h:.6f}\n" for c, x, y, w, h in labels))
    if preview:
        vis = cv2.cvtColor(img, cv2.COLOR_RGB2BGR).copy()
        for c, x, y, w, h in labels:
            p0 = (int((x - w / 2) * out_w), int((y - h / 2) * out_h))
            p1 = (int((x + w / 2) * out_w), int((y + h / 2) * out_h))
            cv2.rectangle(vis, p0, p1, (0, 255, 255) if c != BACK_CLASS else (255, 160, 0), 2)
            cv2.putText(vis, CLASS_NAMES[c], (p0[0], max(14, p0[1] - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.55,
                        (0, 255, 0), 2)
        (out_dir / "preview").mkdir(exist_ok=True)
        cv2.imwrite(str(out_dir / "preview" / f"{name}.jpg"), vis)
    return [c for c, *_ in labels]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--board", required=True, help="photo of the empty board")
    ap.add_argument("--assets", default="assets")
    ap.add_argument("--layout", default="layout.json")
    ap.add_argument("--out", default="dataset")
    ap.add_argument("--count", type=int, default=3000, help="how many pictures to make")
    ap.add_argument("--val", type=float, default=0.1, help="fraction kept aside to measure accuracy")
    ap.add_argument("--size", type=int, nargs=2, default=[1280, 720], metavar=("W", "H"),
                    help="picture size; match the phone's send size (1280 720 is the camera page's High setting)")
    ap.add_argument("--calibration", default="",
                    help="calibration.json from the camera server's calibrate.py: renders the board exactly as the "
                         "real camera frames it (size is then taken from it unless --size is given)")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--preview", type=int, default=24, help="also save this many pictures with boxes drawn on")
    ap.add_argument("--workers", type=int, default=1, help="CPU processes (try 4 on a laptop)")
    args = ap.parse_args()

    out = Path(args.out)
    for sub in ("images/train", "images/val", "labels/train", "labels/val"):
        (out / sub).mkdir(parents=True, exist_ok=True)
    out_w, out_h = args.size
    if args.calibration and "--size" not in sys.argv:
        out_w, out_h = json.loads(Path(args.calibration).read_text())["frame_size"]

    init_worker(args.assets, args.board, args.layout, args.calibration)
    have = sorted(_assets["cards"])
    missing = [c for c in ALL_CODES if c not in have]
    if missing:
        print(f"WARNING: no cutout for {', '.join(missing)} - the model will never see them. "
              f"Photograph them, run extract_cards.py again, then regenerate.")

    n_val = int(round(args.count * args.val))
    jobs = []
    for i in range(args.count):
        split = "val" if i < n_val else "train"
        jobs.append((i, args.seed * 1_000_003 + i, out_w, out_h, split, str(out), i < args.preview))

    counts = np.zeros(len(CLASS_NAMES), int)
    if args.workers > 1:
        with ProcessPoolExecutor(args.workers, initializer=init_worker,
                                 initargs=(args.assets, args.board, args.layout, args.calibration)) as pool:
            for k, classes in enumerate(pool.map(make_one, jobs, chunksize=8), 1):
                for c in classes:
                    counts[c] += 1
                if k % 200 == 0:
                    print(f"  {k}/{args.count}")
    else:
        for k, job in enumerate(jobs, 1):
            for c in make_one(job):
                counts[c] += 1
            if k % 200 == 0:
                print(f"  {k}/{args.count}")

    yaml = ["# generated by generate.py", f"path: {out.resolve().as_posix()}", "train: images/train",
            "val: images/val", f"nc: {len(CLASS_NAMES)}", "names:"]
    yaml += [f"  {i}: {name}" for i, name in enumerate(CLASS_NAMES)]
    (out / "data.yaml").write_text("\n".join(yaml) + "\n")

    present = counts[:BACK_CLASS][[ALL_CODES.index(c) for c in have]]
    print(f"made {args.count} pictures ({args.count - n_val} train, {n_val} val) in {out}")
    print(f"labelled objects: {counts.sum()}  | per card: min {present.min()}, max {present.max()}  "
          f"| 'back': {counts[BACK_CLASS]}")
    imgsz = 1088 if args.calibration else 1280
    print(f"next:  yolo detect train data={out / 'data.yaml'} model=yolov8s.pt imgsz={imgsz} epochs=100 "
          f"batch=8 fliplr=0 flipud=0 degrees=8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
