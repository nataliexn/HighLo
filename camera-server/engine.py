"""Table engine: turns per-frame card detections into blackjack table state.

Input  : detections [{"code": "KH"|None, "label": str, "conf": float, "box": [x1,y1,x2,y2],
                      "angle": float (optional)}]
         (box normalised 0-1 in the calibrated camera frame; code None + label
         "back" = a face-down card; angle = the card's long side, degrees clockwise
         from vertical, sent by an oriented-box model and used to spot a sideways
         double-down card)
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
GAP_SECONDS = 15.0          # no frames for longer than this => the table may have changed: start over
PAUSE_SECONDS = 1.0         # a shorter gap (bad network) pauses every clock instead of losing the cards
SPLIT_SEPARATION = 0.7      # a pair this many card widths apart, side by side across the seat, has been split
SIDEWAYS_DEGREES = 45.0     # a card turned more than this from its seat's upright is a double-down card
DEAL_STEADY_SECONDS = 1.0   # the first pass of the deal must look the same this long before seats are read
COIN_STEADY_SECONDS = 1.0   # a coin must sit in a bet spot this long to count (a passing hand doesn't)
COIN_GONE_SECONDS = 1.5     # ... and be missing this long to stop counting
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
    angles: list = field(default_factory=list)   # long-side angles seen (oriented-box model only)
    sideways: bool = False        # decided once, when the card is confirmed (it is on top, fully visible then)

    def add(self, code: str, conf: float, box, now: float, zone: str, angle=None) -> None:
        if angle is not None and len(self.angles) < 30:
            self.angles.append(float(angle))
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
        # each seat's "upright": the direction its cards point, towards the dealer (degrees clockwise from vertical)
        self.seat_angle = {s["seat"]: float(s.get("angle", 0.0)) for s in zones["seats"]}
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
        # Seats that got a card this round. They count as occupied straight away,
        # before the opening deal is complete, so a player can pick their seat.
        self.round_seats: set[int] = set()
        # Coins / chips in the bet spots (coins.py), steadied over time.
        self.coins_present: set[int] = set()
        self.coin_seen_since: dict[int, float] = {}
        self.coin_missing_since: dict[int, float] = {}
        self.splits: dict[int, tuple[int, int]] = {}   # seat -> track ids of the two split cards
        self.opening_done = False   # this round: every dealt seat and the dealer have two cards
        self.hand_of: dict[int, int] = {}              # track id -> hand index within its seat

    # ---- zones ------------------------------------------------------------
    def zone_of(self, box) -> str:
        cx, cy = (box[0] + box[2]) / 2 * self.W, (box[1] + box[3]) / 2 * self.H
        if math.dist((cx, cy), self.shoe_c) < 1.3 * self.card_w:
            return "shoe"
        if math.dist((cx, cy), self.discard_c) < 1.5 * self.card_w:
            return "discard"
        if cy < 0.36 * self.H and 0.2 * self.W < cx < 0.8 * self.W:   # the piles sit at the edges, so the
            return "dealer"                                            # dealer has room for a long row
        seat, dist = min(
            ((s, math.dist((cx, cy), c)) for s, c in self.seats.items()), key=lambda t: t[1]
        )
        return f"seat{seat}" if dist <= 0.28 * self.W else "other"

    # ---- main entry --------------------------------------------------------
    def update(self, detections: list[dict], now: float, coins: set[int] | None = None) -> bool:
        """Feed one frame's detections, and optionally the seats with a coin in their bet
        spot (None = not checked this frame). Returns True if the table state changed."""
        before = self._signature()
        gap = now - self.last_update if self.last_update is not None else 0.0
        if PAUSE_SECONDS < gap <= GAP_SECONDS:
            self._pause(gap)
        elif gap > GAP_SECONDS:
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
        self._assign_hands()
        self._deal(now)
        self._rounds(now)
        self._coins(now, coins)
        self._shoe(now)
        return self._signature() != before

    def _pause(self, gap: float) -> None:
        """Frames stopped for a few seconds (weak network, phone hiccup). Assume the
        table did not change: move every clock forward by the gap, so the cards are
        not dropped (and later counted again) and no round or shuffle timer runs on."""
        for t in self.tracks.values():
            t.first += gap
            t.last += gap
        for name in ("clear_since", "discard_seen_since", "discard_gone_since", "deal_ready_since", "started"):
            value = getattr(self, name)
            if value is not None:
                setattr(self, name, value + gap)

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
            dets.append((code, float(d.get("conf", 0.5)), box, zone, d.get("angle")))

        pairs = []
        for di, (code, _, box, _, _) in enumerate(dets):
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
            code, conf, box, zone, angle = dets[di]
            self.tracks[tid].add(code, conf, box, now, zone, angle)

        for di, (code, conf, box, zone, angle) in enumerate(dets):
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
            t.add(code, conf, box, now, zone, angle)
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
                if t.zone.startswith("seat"):
                    seat = int(t.zone[4:])
                    t.sideways = self._is_sideways(t, seat)
                    self.round_seats.add(seat)
                    self.seats_known = True
                    if self.deal_resolved:          # e.g. a card the deal check missed
                        self.seat_memory.add(seat)
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
        self.round_seats = set()
        self.splits = {}
        self.hand_of = {}
        self.opening_done = False

    def _is_sideways(self, t, seat: int) -> bool:
        """A double-down card lies across the hand. Needs the card's angle (an oriented-box model)."""
        if not t.angles:
            return False
        # average the angle differences on a 180-degree circle (a card upside down is still upright)
        diffs = [math.radians(2 * (a - self.seat_angle.get(seat, 0.0))) for a in t.angles]
        mean = math.degrees(math.atan2(sum(math.sin(d) for d in diffs), sum(math.cos(d) for d in diffs))) / 2
        return abs(mean) > SIDEWAYS_DEGREES

    def _across(self, seat: int, a, b) -> float:
        """How far apart two cards are across the seat (sideways, not towards the dealer), in pixels."""
        ang = math.radians(self.seat_angle.get(seat, 0.0))
        across = (math.cos(ang), math.sin(ang))          # the seat's left-right axis in the picture
        (ax, ay), (bx, by) = self._center(a), self._center(b)
        return abs((bx - ax) * across[0] + (by - ay) * across[1])

    def _center(self, t) -> tuple[float, float]:
        b = t.box
        return ((b[0] + b[2]) / 2 * self.W, (b[1] + b[3]) / 2 * self.H)

    @staticmethod
    def _split_rank(code: str) -> str:
        rank = code[:-1]
        return "10" if rank in ("10", "J", "Q", "K") else rank

    def _assign_hands(self) -> None:
        """Splits. Only after the opening deal is complete (everyone has two cards),
        and only once per seat. When a seat's first two cards are a pair and they sit
        side by side, more than SPLIT_SEPARATION card widths apart across the seat,
        the seat has two hands, each on about half of the seat box. Every other card
        belongs to the hand whose split card it lies nearest. Hand 0 is the one on the
        dealer's left (right side of the picture), which is played first. A split stays
        for the rest of the round."""
        self.hand_of = {}
        if not self.tracking:
            return
        if not self.opening_done and self.deal_resolved:
            counts = [len([t for t in self._cards_in(f"seat{s}") if not t.face_down]) for s in self.round_seats]
            self.opening_done = (
                bool(counts) and min(counts) >= 2 and len(self._cards_in("dealer")) >= 2
            )
        for seat in range(1, SEAT_COUNT + 1):
            cards = [t for t in self._cards_in(f"seat{seat}") if not t.face_down]
            anchors = self.splits.get(seat)
            if anchors and not all(a in self.tracks for a in anchors):
                anchors = None
                self.splits.pop(seat, None)
            if anchors is None and len(cards) >= 2 and self.opening_done:
                a, b = cards[0], cards[1]
                if (self._split_rank(a.code) == self._split_rank(b.code)
                        and not a.sideways and not b.sideways
                        and self._across(seat, a, b) >= SPLIT_SEPARATION * self.card_w):
                    anchors = tuple(sorted((a.id, b.id), key=lambda i: -self._center(self.tracks[i])[0]))
                    self.splits[seat] = anchors
            groups = [[], []] if anchors else [[]]
            for t in cards:
                if not anchors:
                    index = 0
                elif t.id in anchors:
                    index = anchors.index(t.id)
                else:
                    c = self._center(t)
                    index = min((0, 1), key=lambda k: math.dist(c, self._center(self.tracks[anchors[k]])))
                self.hand_of[t.id] = index
                groups[index].append(t)
            for index, group in enumerate(groups):
                for position, t in enumerate(group):
                    if t.entry is not None:
                        t.entry["handIndex"] = index
                        t.entry["cardIndex"] = position

    def _deal(self, now) -> None:
        """Seats are settled by the FIRST PASS of the deal: every player gets one card, then the
        dealer takes theirs. Once the dealer has a card (and it stays that way for a moment),
        the seats that have cards are occupied and every other seat is vacant, coin or not
        (vacant = not dealt in). A seat that gets a card later in the round is added back."""
        if not self.tracking or not self.round_active or self.deal_resolved:
            return
        dealer = [t for t in self.tracks.values() if t.zone == "dealer" and t.confirmed(t.last)]
        dealt = {
            seat for seat in range(1, SEAT_COUNT + 1)
            if any(t.zone == f"seat{seat}" and t.confirmed(t.last) and not t.face_down for t in self.tracks.values())
        }
        if not dealer or not (dealt or self.round_seats):
            self.deal_ready_since = None
            return
        self.deal_ready_since = self.deal_ready_since if self.deal_ready_since is not None else now
        if now - self.deal_ready_since >= DEAL_STEADY_SECONDS:
            self.seat_memory = dealt | self.round_seats
            self.seats_known = True
            self.deal_resolved = True

    def _coins(self, now, coins) -> None:
        """A coin or chip in a seat's bet spot means someone wants to play there. It opens the seat
        only BETWEEN rounds (table cleared). During a round coins are ignored: a coin put down
        after the deal opens the seat for the next round, once this one is swept. Taking a coin
        away never closes a seat; only not being dealt in does (see _deal)."""
        if coins is None:
            return
        for seat in range(1, SEAT_COUNT + 1):
            if seat in coins:
                self.coin_missing_since.pop(seat, None)
                since = self.coin_seen_since.setdefault(seat, now)
                if now - since >= COIN_STEADY_SECONDS:
                    self.coins_present.add(seat)
            else:
                self.coin_seen_since.pop(seat, None)
                since = self.coin_missing_since.setdefault(seat, now)
                if now - since >= COIN_GONE_SECONDS:
                    self.coins_present.discard(seat)
        if self.tracking and not self.round_active and self.coins_present - self.seat_memory:
            self.seat_memory |= self.coins_present
            self.seats_known = True

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
                if not self.deal_resolved and self.round_seats:
                    # the deal never looked complete (a missed card): go by who got cards
                    self.seat_memory = set(self.round_seats)
                    self.deal_resolved = True

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
        dealing = self.round_active and not self.deal_resolved
        for seat in range(1, SEAT_COUNT + 1):
            cards = [t for t in self._cards_in(f"seat{seat}") if not t.face_down] if self.tracking else []
            split = seat in self.splits
            groups = [[], []] if split else [[]]
            for t in cards:
                groups[self.hand_of.get(t.id, 0) if split else 0].append(t)
            hands = []
            for group in groups:
                codes = [t.code for t in group]
                hands.append({
                    "cards": codes,
                    "isBust": hand_total(codes) > 21 if codes else False,
                    "isSplit": split,
                    # a sideways card: the hand doubled down, took exactly one card and is finished
                    "isDoubled": any(t.sideways for t in group),
                    "isTurn": False,
                    "_last": max((t.order for t in group), default=0),
                })
            conf = min((t.mean_conf for t in cards), default=1.0)
            players.append({
                "seat": seat,
                "occupied": seat in self.seat_memory or (dealing and seat in self.round_seats),
                "hands": hands,
                "isTurn": False,
                "confidence": "high" if conf >= 0.8 else "medium" if conf >= 0.6 else "low",
                # the model's own score for the least certain card in the seat (0-1)
                "detection": round(conf, 3),
                "lastAction": None,
            })
        dealer_tracks = self._cards_in("dealer") if self.tracking else []
        up = [t for t in dealer_tracks if not t.face_down]
        hole_hidden = any(t.face_down for t in dealer_tracks)
        dcards = [t.code for t in up]
        if hole_hidden and dcards:
            dcards = dcards[:1] + ["??"] + dcards[1:]
        dconf = min((t.mean_conf for t in up), default=1.0)
        dealer = {
            "cards": dcards,
            "holeCardKnown": len(up) >= 2 and not hole_hidden,
            "confidence": "high" if dconf >= 0.8 else "medium" if dconf >= 0.6 else "low",
            "detection": round(dconf, 3),
        }
        self._turn(players, dealer)
        for p in players:
            for h in p["hands"]:
                h.pop("_last")
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
            "coins": sorted(self.coins_present),
            "waitingForRound": self.waiting_for_round,
        }

    def _turn(self, players, dealer) -> None:
        """Rough turn guess: no gestures yet, so this follows the cards.

        Hands are played seat 1 -> 6, and inside a split seat hand 0 then hand 1.
        Once everyone has their opening cards, the first live hand is up; when a
        hand takes a card it is up until it is finished (21 or bust) or another
        hand gets a card. Everyone is done once the dealer's hole card is turned.
        """
        if not self.round_active or not dealer["cards"] or dealer["holeCardKnown"]:
            return
        active = [p for p in players if p["occupied"] and any(h["cards"] for h in p["hands"])]
        if not active or any(sum(len(h["cards"]) for h in p["hands"]) < 2 for p in active):
            return
        order = [(p, h) for p in active for h in p["hands"]]

        def live(h):
            return bool(h["cards"]) and hand_total(h["cards"]) < 21 and not h["isDoubled"]

        def drawn(h):   # has taken a card beyond its opening one(s)
            return len(h["cards"]) > (1 if h["isSplit"] else 2)

        touched = [i for i, (_, h) in enumerate(order) if drawn(h)]
        start = max(touched, key=lambda i: order[i][1]["_last"]) if touched else 0
        pick = next((j for j in range(start, len(order)) if live(order[j][1])), None)
        if pick is None:
            return
        player, hand = order[pick]
        hand["isTurn"] = True
        player["isTurn"] = True
