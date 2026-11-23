"""Smoke tests with made-up cards and a made-up board, so they run without your photos.
Run from the project folder:   python -m unittest discover -s tests -v
"""
import json
import math
import sys
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import extract_cards as ex          # noqa: E402
import generate as gen              # noqa: E402
import layout_from_board as lfb     # noqa: E402

SEATS = [(0.14, 0.49, 34), (0.28, 0.63, 21), (0.43, 0.71, 6), (0.59, 0.70, -11), (0.74, 0.61, -27), (0.88, 0.46, -44)]


def fake_board(w=2000, h=1200):
    img = np.full((h, w, 3), (20, 45, 35), np.uint8)
    for x, y, ang in SEATS:
        box = cv2.boxPoints(((x * w, y * h), (160, 232), ang))
        cv2.polylines(img, [box.astype(np.int32)], True, (240, 240, 240), 7)
    return img


def fake_card(code, w=450, h=630):
    rgb = np.full((h, w, 3), 238, np.uint8)
    cv2.putText(rgb, code, (40, 120), cv2.FONT_HERSHEY_SIMPLEX, 3, (200, 20, 20), 8)
    return np.dstack([rgb, ex.rounded_mask(w, h, ex.CORNER_RADIUS, 2)])


class PipelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        root = Path(cls.tmp.name)
        (root / "assets" / "cards").mkdir(parents=True)
        for code in ex.ALL_CODES[:20]:                       # only some cards: missing ones must be tolerated
            Image.fromarray(fake_card(code), "RGBA").save(root / "assets" / "cards" / f"{code}.png")
        back = fake_card("")
        back[..., :3] = (170, 60, 70)
        Image.fromarray(back, "RGBA").save(root / "assets" / "back.png")
        cls.board_path = root / "board.jpg"
        cv2.imwrite(str(cls.board_path), fake_board())
        cls.layout_path = root / "layout.json"
        cls.root = root

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_seat_detection_finds_six_with_sensible_angles(self):
        seats, _ = lfb.detect_seats(cv2.cvtColor(fake_board(), cv2.COLOR_BGR2RGB))
        self.assertEqual(len(seats), 6)
        for found, (_, _, angle) in zip(seats, SEATS):
            self.assertAlmostEqual(found["angle"], angle, delta=4)

    def test_cutout_of_a_card_lying_on_felt(self):
        felt = np.full((4032, 3024, 3), (35, 55, 45), np.uint8)
        card = cv2.cvtColor(fake_card("7S")[..., :3], cv2.COLOR_RGB2BGR)
        card = cv2.resize(card, (1180, 1652))
        felt[1200:1200 + 1652, 900:900 + 1180] = card
        rgba, _ = ex.cutout(cv2.cvtColor(felt, cv2.COLOR_BGR2RGB))
        self.assertIsNotNone(rgba)
        self.assertEqual(rgba.shape, (ex.CARD_H, ex.CARD_W, 4))
        self.assertGreater((rgba[..., 3] > 250).mean(), 0.9)       # nearly all of it is card

    def test_generated_dataset_is_valid_yolo(self):
        lfb_args = lfb.detect_seats(cv2.cvtColor(fake_board(), cv2.COLOR_BGR2RGB))[0]
        self.layout_path.write_text(json.dumps({
            "card_width": 0.075, "seats": lfb_args,
            "dealer": {"x": 0.5, "y": 0.235, "x_jitter": 0.03, "y_jitter": 0.02},
            "discard_pile": {"x": 0.175, "y": 0.16, "jitter": 0.015, "present": 1.0},
            "shoe": {"x": 0.82, "y": 0.15, "jitter": 0.015, "present": 1.0}}))
        gen.init_worker(self.root / "assets", self.board_path, self.layout_path)
        out = self.root / "ds"
        for sub in ("images/train", "labels/train"):
            (out / sub).mkdir(parents=True)
        seen = 0
        for i in range(8):
            classes = gen.make_one((i, 1000 + i, 640, 360, "train", str(out), False))
            seen += len(classes)
            lines = (out / "labels" / "train" / f"synth_{i:06d}.txt").read_text().split("\n")
            for line in filter(None, lines):
                c, x, y, w, h = line.split()
                self.assertTrue(0 <= int(c) < len(gen.CLASS_NAMES))
                for v in (x, y, w, h):
                    self.assertTrue(0.0 <= float(v) <= 1.0, line)
                self.assertGreater(float(w), 0)
                self.assertGreater(float(h), 0)
            img = cv2.imread(str(out / "images" / "train" / f"synth_{i:06d}.jpg"))
            self.assertEqual(img.shape[:2], (360, 640))
        self.assertGreater(seen, 8)                              # at least the piles
        # only cards that have a cutout may be used
        used = {c for i in range(8) for c in (int(l.split()[0]) for l in
                (out / "labels" / "train" / f"synth_{i:06d}.txt").read_text().split("\n") if l)}
        allowed = set(range(20)) | {gen.BACK_CLASS}
        self.assertTrue(used <= allowed, used - allowed)

    def _layout(self):
        seats = lfb.detect_seats(cv2.cvtColor(fake_board(), cv2.COLOR_BGR2RGB))[0]
        self.layout_path.write_text(json.dumps({
            "card_width": 0.075, "seats": seats,
            "dealer": {"x": 0.5, "y": 0.235, "x_jitter": 0.03, "y_jitter": 0.02},
            "discard_pile": {"x": 0.119, "y": 0.15, "jitter": 0.012, "present": 1.0},
            "shoe": {"x": 0.870, "y": 0.11, "jitter": 0.012, "present": 1.0}}))
        return seats

    def test_oriented_labels_follow_each_card(self):
        self._layout()
        gen.init_worker(self.root / "assets", self.board_path, self.layout_path)
        out = self.root / "ds_obb"
        for sub in ("images/train", "labels/train"):
            (out / sub).mkdir(parents=True)
        lines = []
        for i in range(10):
            gen.make_one((i, 500 + i, 640, 360, "train", str(out), False, "obb"))
            lines += filter(None, (out / "labels" / "train" / f"synth_{i:06d}.txt").read_text().split("\n"))
        self.assertTrue(lines)
        for line in lines:
            parts = line.split()
            self.assertEqual(len(parts), 9, line)                  # class + four corners
            self.assertTrue(0 <= int(parts[0]) < len(gen.CLASS_NAMES))
            quad = np.array([float(v) for v in parts[1:]]).reshape(4, 2) * [640, 360]
            self.assertTrue(((quad >= 0) & (quad <= 640)).all())
            sides = np.linalg.norm(np.roll(quad, -1, 0) - quad, axis=1)
            self.assertGreater(sides.min(), 0)
            d1, d2 = quad[1] - quad[0], quad[2] - quad[1]
            if sides.min() > 3 and sides[0] < 600 and sides[1] < 350:   # unclipped boxes are rectangles
                self.assertLess(abs(d1 @ d2) / (np.linalg.norm(d1) * np.linalg.norm(d2)), 0.1, line)

    def test_hands_are_dealt_towards_the_dealer_with_splits_and_doubles(self):
        self._layout()
        gen.init_worker(self.root / "assets", self.board_path, self.layout_path)
        placed = []
        real_new = gen.paste_card

        def spy(scene, idmap, rgba, cx, cy, width, theta, inst, rng, shade=1.0, shadow=0.35):
            placed.append((inst, cx, cy, theta))
            return real_new(scene, idmap, rgba, cx, cy, width, theta, inst, rng, shade, shadow)

        gen.paste_card = spy
        try:
            sideways = 0
            for seed in range(60):
                placed.clear()
                gen.build_scene(np.random.default_rng(seed), gen._assets)
                seats = gen._assets["layout"]["seats"]
                for inst, cx, cy, theta in placed:
                    seat = min(seats, key=lambda s: math.dist((s["x"] * 2000, s["y"] * 1200), (cx, cy)))
                    if math.dist((seat["x"] * 2000, seat["y"] * 1200), (cx, cy)) < 160:
                        off = ((theta - seat["angle"]) + 90) % 180 - 90
                        sideways += abs(off) > 60
        finally:
            gen.paste_card = real_new
        self.assertGreater(sideways, 0)                        # some double-down cards were laid sideways

    def test_same_seed_gives_same_picture(self):
        gen.init_worker(self.root / "assets", self.board_path, self.layout_path)
        out = self.root / "ds2"
        for sub in ("images/train", "labels/train"):
            (out / sub).mkdir(parents=True)
        gen.make_one((0, 7, 320, 180, "train", str(out), False))
        a = (out / "labels/train/synth_000000.txt").read_text()
        gen.make_one((0, 7, 320, 180, "train", str(out), False))
        self.assertEqual(a, (out / "labels/train/synth_000000.txt").read_text())


if __name__ == "__main__":
    unittest.main()
