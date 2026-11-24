"""python -m unittest discover -s tests -v"""
import json
import sys
import unittest
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from coins import CoinSpotter  # noqa: E402

CAL = json.loads((ROOT / "calibration" / "calibration.json").read_text())
# A real table photo, lined up with the camera's calibrated view: coins and chips in front of
# seats 1, 2, 3 (two stacks: a double) and 5 (two stacks: a split); seats 4 and 6 empty.
PHOTO = cv2.imread(str(Path(__file__).parent / "coins_frame.jpg"))


class CoinTests(unittest.TestCase):
    def setUp(self):
        self.spotter = CoinSpotter(CAL)

    def test_finds_every_kind_of_coin_and_chip(self):
        self.assertEqual(self.spotter.find(PHOTO), {1, 2, 3, 5})

    def test_works_at_the_phone_send_sizes(self):
        for width in (960, 1280):
            frame = cv2.resize(PHOTO, (width, round(width * PHOTO.shape[0] / PHOTO.shape[1])))
            self.assertEqual(self.spotter.find(frame), {1, 2, 3, 5}, width)

    def test_empty_felt_has_no_coins(self):
        felt = np.full_like(PHOTO, (40, 55, 35))
        self.assertEqual(self.spotter.find(felt), set())

    def test_round_pattern_on_a_card_is_not_a_coin(self):
        frame = np.full_like(PHOTO, (40, 55, 35))
        h, w = frame.shape[:2]
        x, y, _ = self.spotter.spots(w, h)[4]
        cv2.rectangle(frame, (int(x - 45), int(y - 60)), (int(x + 45), int(y + 60)), (235, 235, 235), -1)
        cv2.circle(frame, (int(x), int(y)), int(0.33 * CAL["zones"]["card_w"] * w), (30, 30, 160), 4)
        self.assertEqual(self.spotter.find(frame), {4})                    # looks like a coin on its own ...
        card = [(x - 45) / w, (y - 60) / h, (x + 45) / w, (y + 60) / h]
        self.assertEqual(self.spotter.find(frame, [card]), set())         # ... but it sits on a card


if __name__ == "__main__":
    unittest.main()
