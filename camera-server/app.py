"""The web app: phone page, phone + viewer WebSockets, and the MJPEG stream."""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import secrets
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, PlainTextResponse, StreamingResponse
from starlette.routing import Mount, Route, WebSocketRoute
from starlette.staticfiles import StaticFiles
from starlette.websockets import WebSocket, WebSocketDisconnect

from config import Settings
from detector import Detector, build_detector
from engine import TableEngine
from hub import Hub
from security import AuthLimiter, TicketStore, origin_allowed, tokens_equal

log = logging.getLogger("highlo.app")
STATIC_DIR = Path(__file__).resolve().parent / "static"
AUTH_TIMEOUT_SECONDS = 5.0
MAX_SNAPSHOT_BYTES = 12_000_000

# The phone page loads nothing from anywhere else.
PAGE_CSP = (
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; "
    "media-src 'self' blob:; connect-src 'self' wss: ws:; base-uri 'none'; "
    "form-action 'none'; frame-ancestors 'none'"
)


class SecurityHeaders:
    """Adds browser security headers to every HTTP response."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path = scope["path"]

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                extra = {
                    b"x-content-type-options": b"nosniff",
                    b"referrer-policy": b"no-referrer",
                    b"cache-control": b"no-store",
                }
                if path == "/camera" or path.startswith("/static/"):
                    extra[b"content-security-policy"] = PAGE_CSP.encode()
                    extra[b"permissions-policy"] = b"camera=(self), microphone=()"
                present = {name.lower() for name, _ in headers}
                headers += [(k, v) for k, v in extra.items() if k not in present]
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_headers)


def _client_ip(ws: WebSocket) -> str:
    return ws.client.host if ws.client else "unknown"


def create_app(
    settings: Settings,
    detector: Detector | None = None,
    stream_max_frames: int | None = None,
) -> Starlette:
    """`detector` and `stream_max_frames` exist so tests can swap in fakes."""
    detector = detector or build_detector(
        settings.model_path, settings.conf, settings.imgsz, settings.device
    )
    engine = None
    if settings.calibration_path.exists():
        try:
            engine = TableEngine.from_file(settings.calibration_path)
        except Exception as exc:
            log.error("Could not load %s (%s) - no table tracking.", settings.calibration_path, exc)
    else:
        log.warning("No calibration at %s - run calibrate.py. Card boxes only, no table tracking.", settings.calibration_path)
    hub = Hub(detector, settings.max_frame_bytes, engine=engine)
    tickets = TicketStore()
    limiter = AuthLimiter()

    async def authenticate(ws: WebSocket, expected: str) -> bool:
        """First message must be {"type":"auth","token":...}, within 5 seconds."""
        ip = _client_ip(ws)
        try:
            raw = await asyncio.wait_for(ws.receive_text(), AUTH_TIMEOUT_SECONDS)
            message = json.loads(raw)
            ok = (
                isinstance(message, dict)
                and message.get("type") == "auth"
                and tokens_equal(message.get("token"), expected)
            )
        except (asyncio.TimeoutError, ValueError, WebSocketDisconnect, RuntimeError):
            ok = False
        if ok:
            limiter.reset(ip)
            return True
        limiter.record_failure(ip)
        with contextlib.suppress(Exception):
            await ws.send_text(json.dumps({"type": "error", "error": "unauthorized"}))
            await ws.close(code=4401)
        return False

    async def accept_if_permitted(ws: WebSocket, *, same_origin_only: bool) -> bool:
        origin = ws.headers.get("origin")
        allowed = () if same_origin_only else settings.allowed_origins
        if not origin_allowed(origin, ws.headers.get("host"), allowed):
            await ws.close(code=4403)
            return False
        if limiter.blocked(_client_ip(ws)):
            await ws.close(code=4429)
            return False
        await ws.accept()
        return True

    # ---- WebSockets ------------------------------------------------------
    async def ws_phone(ws: WebSocket):
        if not await accept_if_permitted(ws, same_origin_only=True):
            return
        if not await authenticate(ws, settings.phone_token):
            return
        await ws.send_text(json.dumps({"type": "authed"}))
        await hub.attach_phone(ws)
        try:
            while True:
                message = await ws.receive()
                if message["type"] == "websocket.disconnect":
                    break
                if message.get("bytes") is not None:
                    await hub.on_frame(message["bytes"])
                elif message.get("text") is not None:
                    await hub.on_phone_message(message["text"])
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            await hub.detach_phone(ws)

    async def ws_viewer(ws: WebSocket):
        if not await accept_if_permitted(ws, same_origin_only=False):
            return
        if not await authenticate(ws, settings.viewer_token):
            return
        ticket = tickets.issue()
        await ws.send_text(
            json.dumps({"type": "ready", "streamPath": f"/stream.mjpg?ticket={ticket}"})
        )
        await hub.add_viewer(ws)
        try:
            while True:
                message = await ws.receive()  # viewers send nothing; this notices disconnects
                if message["type"] == "websocket.disconnect":
                    break
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            await hub.remove_viewer(ws)

    # ---- HTTP ------------------------------------------------------------
    async def camera_page(request: Request):
        return FileResponse(STATIC_DIR / "camera.html", media_type="text/html")

    async def health(request: Request):
        return JSONResponse({"ok": True})

    async def snapshot(request: Request):
        """The phone page saves a still here (for building a training set).

        Same protections as the phone WebSocket: same-site only, the phone token, a failed-login
        lockout, a size cap, and a real-JPEG check. The file name is made here, never taken from the client.
        """
        ip = request.client.host if request.client else "unknown"
        if limiter.blocked(ip):
            return JSONResponse({"error": "locked out"}, status_code=429)
        if not origin_allowed(request.headers.get("origin"), request.headers.get("host"), ()):
            return JSONResponse({"error": "forbidden"}, status_code=403)
        header = request.headers.get("authorization", "")
        supplied = header[7:] if header.lower().startswith("bearer ") else None
        if not tokens_equal(supplied, settings.phone_token):
            limiter.record_failure(ip)
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        limiter.reset(ip)

        declared = request.headers.get("content-length", "")
        if declared.isdigit() and int(declared) > MAX_SNAPSHOT_BYTES:
            return JSONResponse({"error": "too large"}, status_code=413)
        body = bytearray()
        async for chunk in request.stream():
            body += chunk
            if len(body) > MAX_SNAPSHOT_BYTES:
                return JSONResponse({"error": "too large"}, status_code=413)
        data = bytes(body)
        picture = None
        if data.startswith(b"\xff\xd8\xff"):
            picture = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
        if picture is None:
            return JSONResponse({"error": "not a JPEG"}, status_code=400)

        now = datetime.now()
        name = f"snap_{now:%Y%m%d_%H%M%S}_{now.microsecond // 1000:03d}_{secrets.token_hex(2)}.jpg"
        settings.snapshot_dir.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread((settings.snapshot_dir / name).write_bytes, data)
        height, width = picture.shape[:2]
        log.info("snapshot saved: %s (%dx%d)", name, width, height)
        return JSONResponse({"ok": True, "name": name, "width": width, "height": height})

    async def index(request: Request):
        return PlainTextResponse("HighLo camera server. Open /camera on your phone.")

    async def stream(request: Request):
        if not tickets.valid(request.query_params.get("ticket")):
            return PlainTextResponse("Forbidden", status_code=403)

        async def parts():
            last_seq, sent = 0, 0
            while stream_max_frames is None or sent < stream_max_frames:
                jpeg, seq = await hub.next_frame(last_seq, timeout=10)
                if jpeg is None:
                    if await request.is_disconnected():
                        return
                    continue
                last_seq, sent = seq, sent + 1
                yield (
                    b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                    + str(len(jpeg)).encode()
                    + b"\r\n\r\n"
                    + jpeg
                    + b"\r\n"
                )

        return StreamingResponse(
            parts(), media_type="multipart/x-mixed-replace; boundary=frame"
        )

    @contextlib.asynccontextmanager
    async def lifespan(app):
        tasks = [
            asyncio.create_task(hub.detection_loop()),
            asyncio.create_task(hub.watchdog_loop()),
        ]
        try:
            yield
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)

    app = Starlette(
        routes=[
            Route("/", index),
            Route("/healthz", health),
            Route("/camera", camera_page),
            Route("/stream.mjpg", stream),
            Route("/api/snapshot", snapshot, methods=["POST"]),
            WebSocketRoute("/ws/phone", ws_phone),
            WebSocketRoute("/ws/viewer", ws_viewer),
            Mount("/static", StaticFiles(directory=STATIC_DIR), name="static"),
        ],
        lifespan=lifespan,
    )
    wrapped = SecurityHeaders(app)
    wrapped.hub = hub  # exposed for tests
    return wrapped
