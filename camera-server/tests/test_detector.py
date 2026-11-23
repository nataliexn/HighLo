"""python -m unittest discover -s tests -v"""
import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from detector import YoloDetector, long_side_angle, to_highlo_code  # noqa: E402


class _List(list):
    def tolist(self):
        return list(self)


class _Obb:
    def __init__(self, rows):
        # rows: (cls, conf, cx, cy, w, h, rotation)
        self.cls = _List(r[0] for r in rows)
        self.conf = _List(r[1] for r in rows)
        self.xywhr = _List([r[2], r[3], r[4], r[5], r[6]] for r in rows)
        self.xyxy = _List([r[2] - 50, r[3] - 50, r[2] + 50, r[3] + 50] for r in rows)


class _Result:
    def __init__(self, rows):
        self.orig_shape = (600, 1000)
        self.names = {0: "KH", 1: "back"}
        self.obb = _Obb(rows)
        self.boxes = None


class _Model:
    def __init__(self, rows):
        self.rows = rows

    def predict(self, *args, **kwargs):
        return [_Result(self.rows)]


class DetectorTests(unittest.TestCase):
    def test_card_codes(self):
        self.assertEqual(to_highlo_code("10h"), "10H")
        self.assertEqual(to_highlo_code("king of hearts"), "KH")
        self.assertIsNone(to_highlo_code("back"))

    def test_long_side_angle(self):
        # upright card (narrow w, tall h, no rotation) points straight up
        self.assertAlmostEqual(long_side_angle(60, 90, 0.0), 0.0)
        # the same card turned 30 degrees clockwise
        self.assertAlmostEqual(long_side_angle(60, 90, math.radians(30)), 30.0)
        # Ultralytics may describe that card with w and h swapped and the angle moved by 90 degrees
        self.assertAlmostEqual(long_side_angle(90, 60, math.radians(-60)), 30.0)
        # a card lying sideways
        self.assertAlmostEqual(abs(long_side_angle(90, 60, 0.0)), 90.0)

    def test_oriented_model_reports_angles(self):
        det = YoloDetector.__new__(YoloDetector)
        det.conf, det.imgsz, det.device = 0.5, 640, None
        det.model = _Model([(0, 0.91, 500, 300, 60, 90, 0.0), (1, 0.8, 200, 100, 90, 60, 0.0)])
        found = det.predict(None)
        self.assertEqual(found[0]["code"], "KH")
        self.assertEqual(found[0]["angle"], 0.0)
        self.assertEqual(abs(found[1]["angle"]), 90.0)
        self.assertEqual(found[0]["box"], [0.45, 0.4167, 0.55, 0.5833])


if __name__ == "__main__":
    unittest.main()
