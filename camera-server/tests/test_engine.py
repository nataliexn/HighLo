"""python -m unittest discover -s tests -v"""
import json, sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine import TableEngine, hand_total  # noqa: E402

CAL = json.loads((Path(__file__).resolve().parents[1] / "calibration" / "calibration.json").read_text())


def det(code, cx, cy, conf=0.9, w=0.083, h=0.205):
    return {"code": None if code == "back" else code, "label": code, "conf": conf,
            "box": [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2]}


DEALER = (0.51, 0.19)
SEAT = {s["seat"]: (s["x"], s["y"]) for s in CAL["zones"]["seats"]}
DISCARD = (CAL["zones"]["discard"]["x"], CAL["zones"]["discard"]["y"])


def run(engine, dets, t0, seconds, fps=10):
    n = int(seconds * fps)
    for i in range(n):
        engine.update(dets, t0 + i / fps)
    return t0 + seconds


class EngineTests(unittest.TestCase):
    def setUp(self):
        self.e = TableEngine(CAL)

    def warm(self):
        """Start with an empty table (the engine looks at the table for a few seconds when it starts)."""
        return run(self.e, [], 0, 3.5)

    def test_each_card_counted_once(self):
        dets = [det("5H", *DEALER), det("KS", *SEAT[3]), det("2C", SEAT[3][0] + 0.04, SEAT[3][1] + 0.05)]
        t = run(self.e, dets, self.warm(), 5)
        run(self.e, dets, t, 30)                     # stays on the table a long time
        hist = self.e.state()["countHistory"]
        self.assertEqual(len(hist), 3)
        self.assertEqual(sum(h["value"] for h in hist), 1)  # +1 (5) -1 (K) +1 (2)

    def test_flicker_not_counted(self):
        t = self.warm()
        self.e.update([det("9D", *SEAT[2])], t)
        self.e.update([det("9D", *SEAT[2])], t + 0.1)
        self.assertEqual(self.e.state()["countHistory"], [])

    def test_misread_is_outvoted(self):
        t = self.warm()
        for i in range(20):
            code = "7H" if i != 5 else "7D"
            self.e.update([det(code, *SEAT[4])], t)
            t += 0.1
        self.assertEqual(self.e.state()["players"][3]["hands"][0]["cards"], ["7H"])

    def test_hole_card_hidden_then_revealed(self):
        up, hole = det("6S", 0.46, 0.19), det("back", 0.57, 0.19)
        t = run(self.e, [up, hole, det("10C", *SEAT[1]), det("8D", *SEAT[1])], self.warm(), 4)
        s = self.e.state()
        self.assertEqual(s["dealer"]["cards"], ["6S", "??"])
        self.assertFalse(s["dealer"]["holeCardKnown"])
        count_before = sum(h["value"] for h in s["countHistory"])
        run(self.e, [up, det("QH", 0.57, 0.19), det("10C", *SEAT[1]), det("8D", *SEAT[1])], t, 4)
        s = self.e.state()
        self.assertEqual(s["dealer"]["cards"], ["6S", "QH"])
        self.assertTrue(s["dealer"]["holeCardKnown"])
        self.assertEqual(sum(h["value"] for h in s["countHistory"]), count_before - 1)

    def test_rounds_and_round_end(self):
        t = run(self.e, [det("5H", *DEALER)], self.warm(), 3)
        self.assertTrue(self.e.state()["roundActive"])
        t = run(self.e, [], t, 6)                     # table swept
        self.assertFalse(self.e.state()["roundActive"])
        run(self.e, [det("9H", *DEALER)], t, 3)
        self.assertEqual(self.e.state()["shoeStats"]["handsSinceShuffle"], 2)

    def test_midshoe_join_when_discard_has_cards(self):
        run(self.e, [det("back", *DISCARD)], 0, 5)
        s = self.e.state()
        self.assertEqual(s["shoeStatus"], "midshoe")
        self.assertTrue(s["midShoeJoin"]["isMidShoeJoin"])

    def test_fresh_shoe_when_discard_empty(self):
        run(self.e, [det("5H", *DEALER)], self.warm(), 5)
        self.assertEqual(self.e.state()["shoeStatus"], "counting")

    def test_shuffle_after_midshoe_resets_count(self):
        t = run(self.e, [det("back", *DISCARD)], 0, 6)
        t = run(self.e, [det("2H", *DEALER), det("back", *DISCARD)], t, 3)   # a round is played
        t = run(self.e, [det("back", *DISCARD)], t, 6)                       # swept
        self.assertEqual(self.e.state()["shoeStatus"], "midshoe")
        run(self.e, [], t, 8)                                                # pile picked up
        s = self.e.state()
        self.assertEqual(s["shoeStatus"], "counting")
        self.assertTrue(s["countHistory"][-1].get("isShuffleMarker"))
        self.assertEqual(s["shoeStats"]["handsSinceShuffle"], 0)

    def test_cards_swept_into_discard_not_recounted(self):
        t = run(self.e, [det("KH", *DEALER)], self.warm(), 4)
        run(self.e, [det("KH", *DISCARD)], t, 4)
        self.assertEqual(len(self.e.state()["countHistory"]), 1)

    def test_turn_follows_cards(self):
        base = [det("10S", 0.46, 0.19), det("back", 0.57, 0.19)]
        for seat in (1, 2):
            base += [det("9H", *SEAT[seat]), det("5C", SEAT[seat][0] + 0.04, SEAT[seat][1] + 0.05)]
        run(self.e, base, self.warm(), 4)
        turns = [p["seat"] for p in self.e.state()["players"] if p["isTurn"]]
        self.assertEqual(turns, [1])

    def test_joining_mid_round_shows_and_counts_nothing_until_next_round(self):
        out = [det("QH", *DEALER), det("QD", *SEAT[2]), det("9S", *SEAT[2], ), det("QC", *SEAT[5])]
        t = run(self.e, out, 0, 6)                       # camera starts with a round already on the table
        s = self.e.state()
        self.assertEqual(s["countHistory"], [])
        self.assertEqual(s["dealer"]["cards"], [])
        self.assertTrue(all(not p["occupied"] for p in s["players"]))
        self.assertTrue(s["waitingForRound"])
        t = run(self.e, [], t, 3)                        # table swept
        self.assertFalse(self.e.state()["waitingForRound"])
        run(self.e, [det("5H", *DEALER), det("2C", *SEAT[3])], t, 3)   # a new round starts
        s = self.e.state()
        self.assertEqual(len(s["countHistory"]), 2)
        self.assertEqual(s["dealer"]["cards"], ["5H"])

    def test_one_card_with_two_labels_is_counted_once(self):
        t = self.warm()
        for i in range(20):
            self.e.update([det("QH", *DEALER, conf=0.9), det("QD", DEALER[0] + 0.004, DEALER[1], conf=0.6)], t + i / 10)
        self.assertEqual(len(self.e.state()["countHistory"]), 1)

    def deal(self, seats, t, seconds=4, extra=()):
        """An opening deal: dealer up + face-down card, two cards for each given seat."""
        dets = [det("6S", 0.46, 0.19), det("back", 0.57, 0.19), *extra]
        for seat in seats:
            x, y = SEAT[seat]
            dets += [det("9H", x, y), det("5C", x + 0.04, y + 0.05)]
        return run(self.e, dets, t, seconds)

    def occupied(self):
        return [p["seat"] for p in self.e.state()["players"] if p["occupied"]]

    def test_seats_read_from_the_opening_deal(self):
        self.assertFalse(self.e.state()["seatsKnown"])
        self.deal([2, 4], self.warm())
        s = self.e.state()
        self.assertTrue(s["seatsKnown"])
        self.assertEqual(self.occupied(), [2, 4])
        self.assertEqual({k: v for k, v in s["occupancy"].items() if v}, {"2": True, "4": True})

    def test_seat_memory_survives_the_sweep_and_is_replaced_by_the_next_deal(self):
        t = self.deal([2, 4], self.warm())
        t = run(self.e, [], t, 6)                         # everything swept away
        self.assertEqual(self.occupied(), [2, 4])         # still remembered between rounds
        self.deal([4, 5], t)                              # seat 2 is not dealt this time
        self.assertEqual(self.occupied(), [4, 5])

    def test_memory_not_changed_before_the_deal_is_complete(self):
        t = self.deal([2], self.warm())
        t = run(self.e, [], t, 6)
        run(self.e, [det("6S", 0.46, 0.19), det("9H", *SEAT[5])], t, 4)   # only part of a deal is out
        self.assertEqual(self.occupied(), [2])

    def test_hand_total(self):
        self.assertEqual(hand_total(["AS", "KH"]), 21)
        self.assertEqual(hand_total(["AS", "AH", "9C"]), 21)
        self.assertEqual(hand_total(["10S", "6H", "9D"]), 25)


if __name__ == "__main__":
    unittest.main()
