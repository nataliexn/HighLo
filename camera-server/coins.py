"""Coins and chips in front of each seat: who wants to play.

A player puts a coin (or chip) on the felt just below their seat's white box,
on their own side. This looks for something round, about the size of a coin,
in that spot. No model is needed: coins and chips are circles, and the
calibration says exactly where each seat is and how big a card (and so a
coin) looks in the picture.

Only the bet spots are searched, so round things elsewhere (the "2 TO 1"
lettering, the card piles) are ignored. The table engine decides what a coin
means (see TableEngine.update).
"""
from __future__ import annotations

import math

import cv2
import numpy as np

SPOT_DISTANCE = 1.25   # bet spot centre: this many card heights from the box centre, away from the dealer
SPOT_RADIUS = 1.1      # search this many card heights around it
COIN_RADIUS = 0.33     # a coin's radius is about a third of a card's width
COIN_RANGE = (0.65, 1.4)   # accept circles this much smaller / bigger than that


class CoinSpotter:
    def __init__(self, calibration: dict):
        zones = calibration["zones"]
        self.seats = []
        for s in zones["seats"]:
            a = math.radians(float(s.get("angle", 0.0)))
            # towards the dealer is "up" for the seat's cards; the bet spot is the other way
            self.seats.append((s["seat"], s["x"], s["y"], math.sin(a), -math.cos(a)))
        self.card_w = zones["card_w"]          # fraction of the frame width
        self.card_h = zones["card_h"]          # fraction of the frame height

    def spots(self, width: int, height: int) -> dict[int, tuple[float, float, float]]:
        """seat -> (x, y, search radius) in pixels, for a frame of this size."""
        ch = self.card_h * height
        out = {}
        for seat, x, y, ux, uy in self.seats:
            out[seat] = (x * width - ux * SPOT_DISTANCE * ch, y * height - uy * SPOT_DISTANCE * ch, SPOT_RADIUS * ch)
        return out

    def find(self, bgr, card_boxes=()) -> set[int]:
        """Seats that have a coin (or chip) in their bet spot right now.

        card_boxes: the card detections for the same frame ([x1, y1, x2, y2], 0-1). Coins lie on the
        felt, so a circle on a card (a pattern printed on its face) is not a coin."""
        if bgr is None:
            return set()
        height, width = bgr.shape[:2]
        r = COIN_RADIUS * self.card_w * width
        gray = cv2.medianBlur(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY), 5)
        circles = cv2.HoughCircles(
            gray, cv2.HOUGH_GRADIENT, dp=1.2, minDist=r * 1.4, param1=120, param2=28,
            minRadius=max(3, int(r * COIN_RANGE[0])), maxRadius=int(r * COIN_RANGE[1]),
        )
        if circles is None:
            return set()
        spots = self.spots(width, height)
        found = set()
        boxes = [(b[0] * width, b[1] * height, b[2] * width, b[3] * height) for b in card_boxes]
        for cx, cy, _ in circles[0]:
            if any(x1 <= cx <= x2 and y1 <= cy <= y2 for x1, y1, x2, y2 in boxes):
                continue
            # each circle belongs to the nearest bet spot, if it is inside one
            seat, (sx, sy, sr) = min(spots.items(), key=lambda kv: math.hypot(cx - kv[1][0], cy - kv[1][1]))
            if math.hypot(cx - sx, cy - sy) <= sr:
                found.add(seat)
        return found
