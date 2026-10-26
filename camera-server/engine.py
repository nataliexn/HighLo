"""Table engine: turns per-frame card detections into blackjack table state.

Input  : detections [{"code": "KH"|None, "label": str, "conf": float, "box": [x1,y1,x2,y2]}]
         (box normalised 0-1 in the calibrated camera frame; code None + label
         "back" = a face-down card)
Output : the dict HighLo expects as a {"type": "state"} message.

What it does
  * tracks each physical card over time, so a card is confirmed only after it
    has been seen steadily, and is counted exactly ONCE no matter how long it
    stays on the table or how often the detector flickers;
  * sorts cards into zones from calibration/calibration.json (dealer, seats
    1-6, discard pile, shoe);
  * follows rounds (cards appear -> table swept clear), the dealer's hole card,
    and a rough "whose turn is it";
  * shoe status. If the camera starts while cards already sit in the discard
    pile, the shoe is "midshoe": we missed earlier rounds so the running count
    is unreliable and HighLo falls back on the basic-strategy chart. When the
    discard pile is later picked up and stays gone (a shuffle) the status
    becomes "counting" and the count restarts from zero.
"""
from __future__ import annotations

import json
import math
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

CONFIRM_HITS = 3            # detections needed ...
CONFIRM_SECONDS = 0.5       # ... over at least this long
MIN_SHARE = 0.6             # share of weighted votes the winning label needs
MIN_MEAN_CONF = 0.45
VOTE_DECAY = 0.92           # older frames fade, so a flipped card re-labels itself
LOST_SECONDS = 2.0          # a card unseen this long is gone
ROUND_END_SECONDS = 2.5     # table clear for this long => round over
JOIN_DECISION_SECONDS = 3.0 # look at the discard pile this long after starting
SHUFFLE_EMPTY_SECONDS = 4.0 # discard pile gone this long (between rounds) => shuffle
DUP_IOU = 0.7              # two boxes this overlapped are one card seen twice (different labels)
GAP_SECONDS = 8.0           # no frames for this long => treat tracks as stale
DEAL_STEADY_SECONDS = 1.0   # the opening deal must look the same this long before seats are read
SEAT_COUNT = 6


def hi_lo(code: str) -> int:
    rank = code[:-1]
    if rank in ("2", "3", "4", "5", "6"):
        return 1
    if rank in ("7", "8", "9"):
        return 0
    return -1


def hand_total(cards: list[str]) -> int:
    total, aces = 0, 0
    for c in cards:
        r = c[:-1]
        if r == "A":
            total += 11
            aces += 1
        elif r in ("10", "J", "Q", "K"):
            total += 10
        else:
            total += int(r)
    while total > 21 and aces:
        total -= 10
        aces -= 1
    return total


def _iou(a, b) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


@dataclass
class Track:
    id: int
    box: list
    zone: str
    first: float
    last: float
    votes: Counter = field(default_factory=Counter)
    conf_sum: float = 0.0
    hits: int = 0
    order: float = 0.0
    entry: dict | None = None     # the count-history entry made for this card

    def add(self, code: str, conf: float, box, now: float, zone: str) -> None:
        for k in self.votes:                 # recent frames count more (a card can be turned over)
            self.votes[k] *= VOTE_DECAY
        self.votes[code] += conf
        self.conf_sum = self.conf_sum * VOTE_DECAY + conf
        self.hits += 1
        self.box = box
        self.last = now
        self.zone = zone

    @property
    def code(self) -> str:
        return self.votes.most_common(1)[0][0]

    @property
    def share(self) -> float:
        return self.votes[self.code] / max(sum(self.votes.values()), 1e-9)

    @property
    def mean_conf(self) -> float:
        weight = (1 - VOTE_DECAY ** self.hits) / (1 - VOTE_DECAY)
        return self.conf_sum / weight

    def confirmed(self, now: float) -> bool:
        return (
            self.hits >= CONFIRM_HITS
            and self.last - self.first >= CONFIRM_SECONDS
            and self.share >= MIN_SHARE
            and self.mean_conf >= MIN_MEAN_CONF
        )

    @property
    def face_down(self) -> bool:
        return self.code == "back"


class TableEngine:
    def __init__(self, calibration: dict):
        zones = calibration["zones"]
        self.W, self.H = calibration["frame_size"]
        self.card_w = zones["card_w"] * self.W
        self.seats = {s["seat"]: (s["x"] * self.W, s["y"] * self.H) for s in zones["seats"]}
        self.dealer_c = (zones["dealer"]["x"] * self.W, zones["dealer"]["y"] * self.H)
        self.shoe_c = (zones["shoe"]["x"] * self.W, zones["shoe"]["y"] * self.H)
        self.discard_c = (zones["discard"]["x"] * self.W, zones["discard"]["y"] * self.H)
        self.reset_all()

    @classmethod
    def from_file(cls, path: Path) -> "TableEngine":
        return cls(json.loads(Path(path).read_text()))

    # ---- state ------------------------------------------------------------
    def reset_all(self) -> None:
        self.tracks: dict[int, Track] = {}
        self._next_id = 1
        self._order = 0
        self.history: list[dict] = []
        self.hand_no = 0
        self.hands_since_shuffle = 0
        self.last_shuffle_hand = 0
        self.round_active = False
        self.clear_since: float | None = None
        self.shoe_status = "unknown"       # unknown -> midshoe | counting
        self.started: float | None = None
        self.last_update: float | None = None
        self.discard_seen_since: float | None = None
        self.discard_gone_since: float | None = None
        self.discard_was_present = False
        self.join_resolved = False         # have we decided whether we joined mid-round?
        self.waiting_for_round = False     # cards were already out when we started: ignore them
        self.ignored_ids: set[int] = set()
        # Which seats have a player. Read from each round's opening deal and kept
        # (even while the table is swept) until the next round's opening deal.
        self.seat_memory: set[int] = set()
        self.seats_known = False
        self.deal_resolved = False
        self.deal_ready_since: float | None = None
        self.last_turn: int | None = None

    # ---- zones ------------------------------------------------------------
    def zone_of(self, box) -> str:
        cx, cy = (box[0] + box[2]) / 2 * self.W, (box[1] + box[3]) / 2 * self.H
        if math.dist((cx, cy), self.shoe_c) < 1.3 * self.card_w:
            return "shoe"
        if math.dist((cx, cy), self.discard_c) < 1.5 * self.card_w:
            return "discard"
        if cy < 0.36 * self.H and 0.25 * self.W < cx < 0.75 * self.W:
            return "dealer"
        seat, dist = min(
            ((s, math.dist((cx, cy), c)) for s, c in self.seats.items()), key=lambda t: t[1]
        )
        return f"seat{seat}" if dist <= 0.28 * self.W else "other"

    # ---- main entry --------------------------------------------------------
    def update(self, detections: list[dict], now: float) -> bool:
        """Feed one frame's detections. Returns True if the table state changed."""
        before = self._signature()
        if self.last_update is not None and now - self.last_update > GAP_SECONDS:
            self.tracks.clear()           # the table may have changed while we were blind
            self.clear_since = None
            self.discard_seen_since = self.discard_gone_since = None
            self.round_active = False     # re-join: wait for a clean start of a round
            self.join_resolved = False
            self.waiting_for_round = False
            self.started = now
        self.last_update = now
        if self.started is None:
            self.started = now

        self._track(self._dedupe(detections), now)
        self._drop_lost(now)
        self._join(now)
        self._count_new_cards()
        self._deal(now)
        self._rounds(now)
        self._shoe(now)
        return self._signature() != before

    # ---- detections ----------------------------------------------------------
    @staticmethod
    def _dedupe(detections):
        """One physical card sometimes gets two boxes with different labels (e.g. QH and QD).
        Keep the more confident one, so it can't be counted twice."""
        kept = []
        for d in sorted(detections, key=lambda d: -float(d.get("conf", 0))):
            if all(_iou(d["box"], k["box"]) < DUP_IOU for k in kept):
                kept.append(d)
        return kept

    # ---- joining -------------------------------------------------------------
    def _join(self, now) -> None:
        """Decide, a few seconds after starting, whether cards were already out.

        If so, this is a mid-round join: those cards are not shown or counted
        (we missed how they were dealt) until the table has been cleared and a
        new round starts."""
        if self.join_resolved or self.started is None or now - self.started < JOIN_DECISION_SECONDS:
            return
        self.join_resolved = True
        if any(t.confirmed(now) for t in self.tracks.values() if self._on_table(t)):
            self.waiting_for_round = True
            self.ignored_ids = {t.id for t in self.tracks.values() if self._on_table(t)}

    @staticmethod
    def _on_table(t) -> bool:
        return t.zone == "dealer" or t.zone.startswith("seat")

    @property
    def tracking(self) -> bool:
        return self.join_resolved and not self.waiting_for_round

    # ---- tracking ------------------------------------------------------------
    def _track(self, detections, now) -> None:
        dets = []
        for d in detections:
            code = d.get("code") or ("back" if d.get("label") == "back" else None)
            if code is None:
                continue
            box = d["box"]
            zone = self.zone_of(box)
            if zone in ("shoe", "other"):
                continue
            dets.append((code, float(d.get("conf", 0.5)), box, zone))

        pairs = []
        for di, (code, _, box, _) in enumerate(dets):
            for tid, t in self.tracks.items():
                score = _iou(box, t.box)
                if score < 0.3:
                    continue
                pairs.append((score + (0.15 if t.code == code else 0.0), di, tid))
        pairs.sort(reverse=True)
        used_d, used_t = set(), set()
        for _, di, tid in pairs:
            if di in used_d or tid in used_t:
                continue
            used_d.add(di)
            used_t.add(tid)
            code, conf, box, zone = dets[di]
            self.tracks[tid].add(code, conf, box, now, zone)

        for di, (code, conf, box, zone) in enumerate(dets):
            if di in used_d:
                continue
            if any(_iou(box, t.box) >= DUP_IOU for t in self.tracks.values()):
                continue          # a second box on a card we already follow
            t = Track(self._next_id, box, zone, now, now)
            self._next_id += 1
            # a face-down dealer card that was just turned over keeps its place in the order
            ghost = next(
                (g for g in self.tracks.values()
                 if g.id not in used_t and g.face_down and g.zone == zone and _iou(g.box, box) >= 0.3),
                None,
            )
            if ghost is not None:
                t.order = ghost.order
                t.entry = ghost.entry
                del self.tracks[ghost.id]
            else:
                self._order += 1
                t.order = self._order
            t.add(code, conf, box, now, zone)
            self.tracks[t.id] = t

    def _drop_lost(self, now) -> None:
        for tid in [i for i, t in self.tracks.items() if now - t.last > LOST_SECONDS]:
            del self.tracks[tid]

    # ---- counting ------------------------------------------------------------
    def _table_tracks(self, confirmed_only=True, now=None):
        out = []
        for t in self.tracks.values():
            if t.zone == "dealer" or t.zone.startswith("seat"):
                if not confirmed_only or t.confirmed(now if now is not None else t.last):
                    out.append(t)
        return out

    def _count_new_cards(self) -> None:
        if not self.tracking:
            return
        for t in self.tracks.values():
            if not (t.zone == "dealer" or t.zone.startswith("seat")):
                continue
            if not t.confirmed(t.last) or t.face_down:
                continue
            code = t.code
            if t.entry is None:
                if not self.round_active:
                    self._start_round()
                t.entry = {
                    "card": code, "value": hi_lo(code), "hand": self.hand_no,
                    "handStart": not any(e.get("hand") == self.hand_no for e in self.history),
                    "seat": "dealer" if t.zone == "dealer" else int(t.zone[4:]),
                    "handIndex": 0,
                    # position within the hand, so HighLo can match a correction to this entry
                    "cardIndex": sum(1 for o in self.tracks.values()
                                     if o.zone == t.zone and o.order < t.order and o.confirmed(o.last)),
                    "_order": t.order,
                }
                self.history.append(t.entry)
            elif t.entry["card"] != code:          # the detector changed its mind
                t.entry["card"] = code
                t.entry["value"] = hi_lo(code)

    def _start_round(self) -> None:
        self.round_active = True
        self.deal_resolved = False
        self.deal_ready_since = None
        self.hand_no += 1
        self.hands_since_shuffle += 1
        self.clear_since = None

    def _deal(self, now) -> None:
        """Read who is playing from the opening deal: dealer has two cards (up + hole)
        and every seat that has a card has two. Seats that were dealt are occupied;
        a seat that was occupied last round but is not dealt now is vacant."""
        if not self.tracking or not self.round_active or self.deal_resolved:
            return
        dealer = [t for t in self.tracks.values() if t.zone == "dealer" and t.confirmed(t.last)]
        per_seat = {
            seat: len([t for t in self.tracks.values()
                       if t.zone == f"seat{seat}" and t.confirmed(t.last) and not t.face_down])
            for seat in range(1, SEAT_COUNT + 1)
        }
        dealt = {seat for seat, n in per_seat.items() if n > 0}
        ready = len(dealer) >= 2 and bool(dealt) and all(per_seat[seat] >= 2 for seat in dealt)
        if not ready:
            self.deal_ready_since = None
            return
        self.deal_ready_since = self.deal_ready_since if self.deal_ready_since is not None else now
        if now - self.deal_ready_since >= DEAL_STEADY_SECONDS:
            self.seat_memory = dealt
            self.seats_known = True
            self.deal_resolved = True

    def _rounds(self, now) -> None:
        on_table = [t for t in self.tracks.values() if self._on_table(t)]
        if self.waiting_for_round:
            # Cards that were already out when we started. Once every one of them has
            # been swept away, the next card is the start of a new round.
            if not any(i in self.tracks for i in self.ignored_ids):
                self.waiting_for_round = False
                self.ignored_ids = set()
            else:
                self.ignored_ids |= {t.id for t in on_table}
            return
        if not self.round_active:
            return
        if on_table:
            self.clear_since = None
        else:
            self.clear_since = self.clear_since if self.clear_since is not None else now
            if now - self.clear_since >= ROUND_END_SECONDS:
                self.round_active = False
                self.clear_since = None

    def _shoe(self, now) -> None:
        discard = [t for t in self.tracks.values() if t.zone == "discard" and t.confirmed(now)]
        if discard:
            self.discard_gone_since = None
            self.discard_seen_since = self.discard_seen_since if self.discard_seen_since is not None else now
            if now - self.discard_seen_since >= 2.0:
                self.discard_was_present = True
        else:
            self.discard_seen_since = None
            self.discard_gone_since = self.discard_gone_since if self.discard_gone_since is not None else now

        if self.shoe_status == "unknown" and self.started is not None and now - self.started >= JOIN_DECISION_SECONDS:
            self.shoe_status = "midshoe" if discard else "counting"

        if (
            self.discard_was_present
            and not discard
            and not self.round_active
            and self.discard_gone_since is not None
            and now - self.discard_gone_since >= SHUFFLE_EMPTY_SECONDS
        ):
            self._shuffled()

    def _shuffled(self) -> None:
        last = self.hand_no
        keep = [e for e in self.history if e.get("hand") == last and not e.get("isShuffleMarker")]
        self.history = keep + [{"isShuffleMarker": True}]
        self.shoe_status = "counting"
        self.discard_was_present = False
        self.hands_since_shuffle = 0
        self.last_shuffle_hand = last

    def force_shuffle(self) -> None:
        self._shuffled()

    # ---- output --------------------------------------------------------------
    def _cards_in(self, zone: str, now=None):
        ts = [t for t in self.tracks.values() if t.zone == zone and t.confirmed(t.last)]
        return sorted(ts, key=lambda t: t.order)

    def _signature(self):
        return json.dumps(self.state(), sort_keys=True, default=str)

    def state(self) -> dict:
        players = []
        for seat in range(1, SEAT_COUNT + 1):
            cards = [t for t in self._cards_in(f"seat{seat}") if not t.face_down] if self.tracking else []
            codes = [t.code for t in cards]
            conf = min((t.mean_conf for t in cards), default=1.0)
            players.append({
                "seat": seat,
                "occupied": seat in self.seat_memory,
                "hands": [{"cards": codes, "isBust": hand_total(codes) > 21 if codes else False, "isSplit": False}],
                "isTurn": False,
                "confidence": "high" if conf >= 0.8 else "medium" if conf >= 0.6 else "low",
                "lastAction": None,
                "_last": max((t.order for t in cards), default=0),
            })
        dealer_tracks = self._cards_in("dealer") if self.tracking else []
        up = [t for t in dealer_tracks if not t.face_down]
        hole_hidden = any(t.face_down for t in dealer_tracks)
        dcards = [t.code for t in up]
        if hole_hidden and dcards:
            dcards = dcards[:1] + ["??"] + dcards[1:]
        dealer = {
            "cards": dcards,
            "holeCardKnown": len(up) >= 2 and not hole_hidden,
            "confidence": "high",
        }
        self._turn(players, dealer, hole_hidden)
        for p in players:
            p.pop("_last")
        history = [{k: v for k, v in e.items() if not k.startswith("_")} for e in self.history]
        return {
            "type": "state",
            "occupancy": {str(p["seat"]): p["occupied"] for p in players},
            "seatsKnown": self.seats_known,
            "players": players,
            "dealer": dealer,
            "countHistory": history,
            "shoeStats": {"handsSinceShuffle": self.hands_since_shuffle, "lastShuffleHand": self.last_shuffle_hand},
            "midShoeJoin": {
                "isMidShoeJoin": self.shoe_status == "midshoe",
                "countReliability": 0.0 if self.shoe_status == "midshoe" else 1.0,
            },
            "shoeStatus": self.shoe_status,
            "roundActive": self.round_active,
            "waitingForRound": self.waiting_for_round,
        }

    def _turn(self, players, dealer, hole_hidden) -> None:
        """Rough turn guess: no gestures yet, so this follows the cards.

        Once everyone has two cards, the first seat (1 -> 6) holding a live
        hand is up; when a seat takes a card, that seat is up until another
        seat gets one. Everyone is done once the dealer's hole card is turned.
        """
        if not self.round_active or not dealer["cards"] or (dealer["holeCardKnown"]):
            return
        active = [p for p in players if p["occupied"] and p["hands"][0]["cards"]]
        if not active or any(len(p["hands"][0]["cards"]) < 2 for p in active):
            return

        def live(p):
            cards = p["hands"][0]["cards"]
            t = hand_total(cards)
            return t < 21 and not (len(cards) == 2 and t == 21)

        candidates = [p for p in active if live(p)]
        if not candidates:
            return
        three_plus = [p for p in candidates if len(p["hands"][0]["cards"]) > 2]
        pick = max(three_plus, key=lambda p: p["_last"]) if three_plus else candidates[0]
        pick["isTurn"] = True
