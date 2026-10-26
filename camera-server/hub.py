"""Shared state: the phone connection, the newest frame, and the viewers."""
from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import deque

import cv2
import numpy as np
from starlette.websockets import WebSocket

log = logging.getLogger("highlo.hub")

STALE_FRAME_SECONDS = 3.0      # no frames for this long => camera counts as closed
HEARTBEAT_SECONDS = 2.0
SEND_TIMEOUT_SECONDS = 1.0     # a stuck viewer must not stall everyone else


class Hub:
    def __init__(self, detector, max_frame_bytes: int, clock=time.monotonic, engine=None):
        self.detector = detector
        self.engine = engine            # TableEngine, or None without a calibration
        self.last_state: dict | None = engine.state() if engine is not None else None
        self.max_frame_bytes = max_frame_bytes
        self._clock = clock

        self.phone: WebSocket | None = None
        self.camera_open = False
        self.width = 0
        self.height = 0
        self.viewers: set[WebSocket] = set()

        self.latest_jpeg: bytes | None = None
        self.frame_seq = 0
        self._last_frame_at = 0.0
        self._frame_times: deque[float] = deque(maxlen=30)
        self._cond = asyncio.Condition()
        self._last_status: dict | None = None

    # ---- status ---------------------------------------------------------
    def fps(self) -> float:
        now = self._clock()
        recent = [t for t in self._frame_times if now - t < 3.0]
        if len(recent) < 2:
            return 0.0
        return round((len(recent) - 1) / max(recent[-1] - recent[0], 1e-6), 1)

    def status(self) -> dict:
        return {
            "phoneOnline": self.phone is not None,
            "cameraOpen": self.phone is not None and self.camera_open,
            "modelLoaded": bool(self.detector.loaded),
            "modelName": self.detector.name,
            "width": self.width,
            "height": self.height,
            "fps": self.fps(),
            "viewers": len(self.viewers),
        }

    async def publish_status(self, force: bool = False) -> None:
        """Tell viewers (and the phone) about changes. fps alone isn't a change."""
        current = self.status()
        comparable = {k: v for k, v in current.items() if k != "fps"}
        if not force and comparable == self._last_status:
            return
        reopened = comparable.get("cameraOpen") and not (self._last_status or {}).get("cameraOpen")
        self._last_status = comparable
        await self.broadcast({"type": "status", **current})
        if reopened and self.last_state is not None:
            await self.broadcast(self.last_state)  # viewers empty their table while the camera is off
        await self._send_phone({"type": "stats", "viewers": current["viewers"]})

    # ---- viewers --------------------------------------------------------
    async def add_viewer(self, ws: WebSocket) -> None:
        self.viewers.add(ws)
        await self.publish_status(force=True)  # the new viewer needs the current state
        if self.last_state is not None:
            try:
                await asyncio.wait_for(ws.send_text(json.dumps(self.last_state, separators=(",", ":"))), SEND_TIMEOUT_SECONDS)
            except Exception:
                self.viewers.discard(ws)

    async def remove_viewer(self, ws: WebSocket) -> None:
        self.viewers.discard(ws)
        await self.publish_status()

    async def broadcast(self, message: dict) -> None:
        if not self.viewers:
            return
        text = json.dumps(message, separators=(",", ":"))
        for ws in list(self.viewers):
            try:
                await asyncio.wait_for(ws.send_text(text), SEND_TIMEOUT_SECONDS)
            except Exception:
                self.viewers.discard(ws)

    async def _send_phone(self, message: dict) -> None:
        if self.phone is None:
            return
        try:
            await asyncio.wait_for(self.phone.send_text(json.dumps(message)), SEND_TIMEOUT_SECONDS)
        except Exception:
            pass

    # ---- phone ----------------------------------------------------------
    async def attach_phone(self, ws: WebSocket) -> None:
        """A newly authenticated phone replaces any earlier connection."""
        old = self.phone
        self.phone = ws
        self.camera_open = False
        if old is not None and old is not ws:
            try:
                await old.close(code=4409)
            except Exception:
                pass
        await self.publish_status()

    async def detach_phone(self, ws: WebSocket) -> None:
        if self.phone is not ws:
            return  # it was already replaced by a newer connection
        self.phone = None
        self.camera_open = False
        self._frame_times.clear()
        await self.publish_status()

    async def on_phone_message(self, text: str) -> None:
        if len(text) > 2048:
            return
        try:
            message = json.loads(text)
        except ValueError:
            return
        if not isinstance(message, dict) or message.get("type") != "camera":
            return
        self.camera_open = bool(message.get("open"))
        for key, attr in (("width", "width"), ("height", "height")):
            value = message.get(key)
            if isinstance(value, int) and 0 < value <= 10000:
                setattr(self, attr, value)
        if self.camera_open:
            self._last_frame_at = self._clock()
        await self.publish_status()

    async def on_frame(self, data: bytes) -> None:
        if len(data) > self.max_frame_bytes or data[:2] != b"\xff\xd8":
            return  # not a JPEG, or too big: ignore rather than decode it
        now = self._clock()
        self._last_frame_at = now
        self._frame_times.append(now)
        reopened = not self.camera_open
        self.camera_open = True
        async with self._cond:
            self.latest_jpeg = data
            self.frame_seq += 1
            self._cond.notify_all()
        if reopened:
            await self.publish_status()

    async def next_frame(self, after_seq: int, timeout: float) -> tuple[bytes | None, int]:
        """Wait for a frame newer than `after_seq` (used by the MJPEG stream)."""
        async with self._cond:
            try:
                await asyncio.wait_for(
                    self._cond.wait_for(
                        lambda: self.frame_seq != after_seq and self.latest_jpeg is not None
                    ),
                    timeout,
                )
            except asyncio.TimeoutError:
                return None, after_seq
            return self.latest_jpeg, self.frame_seq

    # ---- background loops -----------------------------------------------
    async def detection_loop(self) -> None:
        """Always works on the newest frame, so a slow model skips frames
        instead of falling further and further behind."""
        last_seq = 0
        while True:
            jpeg, seq = await self.next_frame(last_seq, timeout=3600)
            if jpeg is None:
                continue
            last_seq = seq
            if not self.detector.loaded:
                continue
            image = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
            if image is None:
                continue
            try:
                boxes = await asyncio.to_thread(self.detector.predict, image)
            except Exception:
                log.exception("Detection failed on frame %s", seq)
                continue
            await self.broadcast({"type": "detections", "seq": seq, "boxes": boxes})
            await self.update_table(boxes)

    async def update_table(self, boxes: list[dict]) -> None:
        if self.engine is None:
            return
        try:
            changed = self.engine.update(boxes, self._clock())
            if changed or self.last_state is None:
                self.last_state = self.engine.state()
                await self.broadcast(self.last_state)
        except Exception:
            log.exception("Table engine failed")

    async def watchdog_loop(self) -> None:
        """Marks the camera closed if frames stop (phone locked, tab hidden)
        and sends a regular status update so fps stays fresh."""
        while True:
            await asyncio.sleep(HEARTBEAT_SECONDS / 2)
            if self.camera_open and self._clock() - self._last_frame_at > STALE_FRAME_SECONDS:
                self.camera_open = False
                await self.publish_status()
            elif self.viewers:
                await self.broadcast({"type": "status", **self.status()})
