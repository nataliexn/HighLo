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

    def test_seat_with_a_card_is_selectable_before_the_first_pass_is_complete(self):
        t = self.deal([2], self.warm())
        t = run(self.e, [], t, 6)
        t = run(self.e, [det("9H", *SEAT[5])], t, 3)        # seat 5's first card, the dealer hasn't taken one yet
        self.assertEqual(self.occupied(), [2, 5])            # seat 2 isn't dropped before the first pass is done
        run(self.e, [det("6S", 0.46, 0.19), det("9H", *SEAT[5])], t, 3)   # the dealer's card ends the first pass
        self.assertEqual(self.occupied(), [5])               # seat 2 wasn't dealt in: vacant

    def test_first_round_seats_show_from_the_first_card(self):
        run(self.e, [det("6S", 0.46, 0.19), det("9H", *SEAT[3]), det("4D", *SEAT[6])], self.warm(), 3)
        s = self.e.state()
        self.assertTrue(s["seatsKnown"])
        self.assertEqual(self.occupied(), [3, 6])

    def test_seat_dealt_late_is_still_added(self):
        t = self.deal([2, 5], self.warm())              # deal looks complete without seat 4
        x, y = SEAT[4]
        self.deal([2, 5], t, extra=[det("9H", x, y), det("5C", x + 0.04, y + 0.05)])
        self.assertEqual(self.occupied(), [2, 4, 5])

    def split_deal(self, apart):
        x, y = SEAT[3]
        return [det("6S", 0.46, 0.19), det("back", 0.57, 0.19),
                det("8H", x + apart / 2, y), det("8C", x - apart / 2, y)]

    def test_split_pair_makes_two_hands(self):
        t = run(self.e, self.split_deal(0.03), self.warm(), 3)   # pair, close together: one hand
        self.assertEqual(len(self.e.state()["players"][2]["hands"]), 1)
        for step in range(1, 11):                                  # the dealer slides them apart
            self.e.update(self.split_deal(0.03 + 0.01 * step), t)
            t += 0.1
        x, y = SEAT[3]
        dets = self.split_deal(0.13) + [det("3D", x + 0.065, y + 0.06)]
        run(self.e, dets, t, 3)                                    # one more card on the right-hand one
        self.assertEqual(len(self.e.state()["countHistory"]), 4)   # 6S, 8H, 8C, 3D: nothing counted twice
        s = self.e.state()
        hands = s["players"][2]["hands"]
        self.assertEqual([h["cards"] for h in hands], [["8H", "3D"], ["8C"]])
        self.assertTrue(all(h["isSplit"] for h in hands))
        self.assertTrue(hands[0]["isTurn"])
        entry = next(e for e in s["countHistory"] if e.get("card") == "8C")
        self.assertEqual((entry["handIndex"], entry["cardIndex"]), (1, 0))

    def test_no_split_before_everyone_has_two_cards(self):
        x, y = SEAT[3]
        dets = [det("6S", 0.46, 0.19), det("back", 0.57, 0.19),
                det("8H", x + 0.065, y), det("8C", x - 0.065, y), det("9D", *SEAT[5])]   # seat 5 still waiting
        run(self.e, dets, self.warm(), 3)
        self.assertEqual(len(self.e.state()["players"][2]["hands"]), 1)

    def test_pair_stacked_towards_the_dealer_is_not_a_split(self):
        x, y = SEAT[4]
        dets = [det("6S", 0.46, 0.19), det("back", 0.57, 0.19),
                det("KH", x, y + 0.08), det("QD", x + 0.02, y)]           # second card on top, nearer the dealer
        run(self.e, dets, self.warm(), 4)
        self.assertEqual(len(self.e.state()["players"][3]["hands"]), 1)

    def test_sideways_card_is_a_double_down(self):
        x, y = SEAT[3]
        up = CAL["zones"]["seats"][3]["angle"]           # seat 3's upright, as the model would report it
        hand = [det("6S", 0.46, 0.19), det("back", 0.57, 0.19),
                dict(det("5H", x, y + 0.08), angle=up), dict(det("6C", x + 0.02, y), angle=up)]
        x2, y2 = SEAT[5]
        hand += [det("9H", x2, y2 + 0.08), det("5C", x2 + 0.02, y2)]
        t = run(self.e, hand, self.warm(), 4)
        run(self.e, hand + [dict(det("KD", x, y - 0.05, w=0.2, h=0.15), angle=up + 88)], t, 3)
        s = self.e.state()
        three = s["players"][2]["hands"][0]
        self.assertEqual(three["cards"], ["5H", "6C", "KD"])
        self.assertTrue(three["isDoubled"])
        self.assertFalse(s["players"][2]["isTurn"])      # a doubled hand is finished
        self.assertTrue(s["players"][4]["isTurn"])       # so the turn moves on to seat 5

    def test_upright_card_is_not_a_double(self):
        x, y = SEAT[6]
        up = CAL["zones"]["seats"][0]["angle"]           # seat 6 is tilted about 35 degrees
        dets = [det("6S", 0.46, 0.19), det("back", 0.57, 0.19),
                dict(det("5H", x, y), angle=up - 4), dict(det("2C", x + 0.02, y - 0.05), angle=up + 177)]
        run(self.e, dets, self.warm(), 4)
        self.assertFalse(self.e.state()["players"][5]["hands"][0]["isDoubled"])

    def test_short_camera_dropout_keeps_the_hand(self):
        t = self.deal([2], self.warm())
        before = self.e.state()
        x, y = SEAT[2]
        same = [det("6S", 0.46, 0.19), det("back", 0.57, 0.19), det("9H", x, y), det("5C", x + 0.04, y + 0.05)]
        run(self.e, same, t + 12, 2)                    # 12 s with no frames, then the same table again
        after = self.e.state()
        self.assertEqual(len(after["countHistory"]), len(before["countHistory"]))
        self.assertEqual(after["players"][1]["hands"][0]["cards"], ["9H", "5C"])
        self.assertTrue(after["roundActive"])

    def test_detection_scores_are_reported(self):
        x, y = SEAT[2]
        dets = [det("6S", 0.46, 0.19, conf=0.95), det("9H", x, y, conf=0.9), det("5C", x + 0.04, y + 0.05, conf=0.62)]
        run(self.e, dets, self.warm(), 3)
        s = self.e.state()
        self.assertAlmostEqual(s["players"][1]["detection"], 0.62, places=2)    # the least certain card
        self.assertEqual(s["players"][1]["confidence"], "medium")
        self.assertAlmostEqual(s["dealer"]["detection"], 0.95, places=2)

    # ---- coins / chips in the bet spots (seating) ---------------------------------
    def coins(self, seats, t, seconds, dets=()):
        n = int(seconds * 10)
        for i in range(n):
            self.e.update(list(dets), t + i / 10, coins=set(seats))
        return t + seconds

    def test_coin_between_rounds_opens_the_seat(self):
        t = self.coins({4}, self.warm(), 0.5)
        self.assertEqual(self.occupied(), [])                # a moment isn't enough (a hand passing by)
        self.coins({4}, t, 1.0)
        self.assertEqual(self.occupied(), [4])
        self.assertTrue(self.e.state()["seatsKnown"])

    def test_taking_the_coin_away_does_not_close_the_seat(self):
        t = self.coins({4}, self.warm(), 2)
        self.coins(set(), t, 10)                             # unsure what to bet
        self.assertEqual(self.occupied(), [4])

    def test_seat_with_a_coin_but_no_card_is_vacant_after_the_first_pass(self):
        t = self.coins({2, 4}, self.warm(), 2)
        self.assertEqual(self.occupied(), [2, 4])
        dealt = [det("9H", *SEAT[2]), det("6S", 0.46, 0.19)]  # seat 2 and the dealer: seat 4 skipped
        self.coins({2, 4}, t, 3, dealt)
        self.assertEqual(self.occupied(), [2])

    def test_cards_without_a_coin_still_open_the_seat(self):
        dealt = [det("9H", *SEAT[6]), det("6S", 0.46, 0.19)]
        self.coins(set(), self.warm(), 3, dealt)
        self.assertEqual(self.occupied(), [6])

    def test_coin_put_down_during_a_round_counts_from_the_next_round(self):
        dealt = [det("9H", *SEAT[2]), det("5C", SEAT[2][0] + 0.04, SEAT[2][1] + 0.05),
                 det("6S", 0.46, 0.19), det("back", 0.57, 0.19)]
        t = self.coins(set(), self.warm(), 3, dealt)
        t = self.coins({5}, t, 4, dealt)                     # seat 5's coin arrives mid-round
        self.assertEqual(self.occupied(), [2])               # not this round
        t = self.coins({5}, t, 6)                            # table swept, round over
        self.assertFalse(self.e.state()["roundActive"])
        self.assertEqual(self.occupied(), [2, 5])

    def test_coins_ignored_while_waiting_for_a_round_joined_midway(self):
        out = [det("QH", *DEALER), det("QD", *SEAT[2])]
        t = self.coins({3}, 0, 6, out)                       # camera starts mid-round
        self.assertEqual(self.occupied(), [])
        self.coins({3}, t, 4)                                # swept: now it counts
        self.assertEqual(self.occupied(), [3])

    def test_hand_total(self):
        self.assertEqual(hand_total(["AS", "KH"]), 21)
        self.assertEqual(hand_total(["AS", "AH", "9C"]), 21)
        self.assertEqual(hand_total(["10S", "6H", "9D"]), 25)


if __name__ == "__main__":
    unittest.main()
