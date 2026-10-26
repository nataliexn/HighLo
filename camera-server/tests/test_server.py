"""Run with:  python -m unittest discover -s tests -v   (from the project folder)"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import create_app  # noqa: E402
from config import Settings  # noqa: E402
from detector import NullDetector, to_highlo_code  # noqa: E402
from security import AuthLimiter, TicketStore, ensure_certificate, origin_allowed, tokens_equal  # noqa: E402

VIEWER, PHONE = "viewer-secret", "phone-secret"
HIGHLO = {"origin": "http://localhost:5173"}


class FakeDetector:
    loaded = True
    name = "fake.pt"

    def predict(self, image):
        return [{"label": "KH", "code": "KH", "conf": 0.91, "box": [0.1, 0.1, 0.3, 0.4]}]


def settings(**overrides) -> Settings:
    values = dict(
        host="127.0.0.1", port=8443, tls=False, extra_sans=(),
        allowed_origins=("http://localhost:5173",), viewer_token=VIEWER, phone_token=PHONE,
        model_path=Path("none.pt"), conf=0.5, imgsz=640, device="",
        max_frame_bytes=500_000, cert_dir=Path("certs"),
    )
    values.update(overrides)
    return Settings(**values)


def jpeg_bytes() -> bytes:
    image = np.zeros((48, 64, 3), np.uint8)
    image[:, :] = (30, 120, 60)
    ok, buf = cv2.imencode(".jpg", image)
    assert ok
    return buf.tobytes()


def auth(ws, token):
    ws.send_text(json.dumps({"type": "auth", "token": token}))


def recv_type(ws, wanted, limit=20):
    for _ in range(limit):
        message = ws.receive_json()
        if message["type"] == wanted:
            return message
    raise AssertionError(f"never received {wanted!r}")


class HttpTests(unittest.TestCase):
    def test_pages_and_headers(self):
        with TestClient(create_app(settings(), NullDetector())) as client:
            self.assertEqual(client.get("/healthz").json(), {"ok": True})
            page = client.get("/camera")
            self.assertEqual(page.status_code, 200)
            self.assertIn("HighLo", page.text)
            self.assertIn("default-src 'none'", page.headers["content-security-policy"])
            self.assertEqual(page.headers["x-content-type-options"], "nosniff")
            self.assertEqual(client.get("/static/camera.js").status_code, 200)

    def test_stream_requires_ticket(self):
        with TestClient(create_app(settings(), NullDetector())) as client:
            self.assertEqual(client.get("/stream.mjpg").status_code, 403)
            self.assertEqual(client.get("/stream.mjpg?ticket=guess").status_code, 403)


class ViewerAuthTests(unittest.TestCase):
    def test_wrong_token_is_rejected(self):
        with TestClient(create_app(settings(), NullDetector())) as client:
            with client.websocket_connect("/ws/viewer", headers=HIGHLO) as ws:
                auth(ws, "nope")
                self.assertEqual(ws.receive_json()["error"], "unauthorized")
                with self.assertRaises(WebSocketDisconnect) as ctx:
                    ws.receive_json()
                self.assertEqual(ctx.exception.code, 4401)

    def test_unknown_website_is_rejected(self):
        with TestClient(create_app(settings(), NullDetector())) as client:
            with self.assertRaises(WebSocketDisconnect):
                with client.websocket_connect("/ws/viewer", headers={"origin": "https://evil.example"}):
                    pass

    def test_repeated_failures_lock_out(self):
        with TestClient(create_app(settings(), NullDetector())) as client:
            for _ in range(8):
                with client.websocket_connect("/ws/viewer", headers=HIGHLO) as ws:
                    auth(ws, "bad")
                    ws.receive_json()
            with self.assertRaises(WebSocketDisconnect) as ctx:
                with client.websocket_connect("/ws/viewer", headers=HIGHLO):
                    pass
            self.assertEqual(ctx.exception.code, 4429)

    def test_phone_token_does_not_open_viewer(self):
        with TestClient(create_app(settings(), NullDetector())) as client:
            with client.websocket_connect("/ws/viewer", headers=HIGHLO) as ws:
                auth(ws, PHONE)
                self.assertEqual(ws.receive_json()["error"], "unauthorized")


class EndToEndTests(unittest.TestCase):
    def test_phone_frames_reach_highlo(self):
        app = create_app(settings(), FakeDetector(), stream_max_frames=1)
        with TestClient(app) as client:
            with client.websocket_connect("/ws/viewer", headers=HIGHLO) as viewer:
                auth(viewer, VIEWER)
                ready = viewer.receive_json()
                self.assertEqual(ready["type"], "ready")
                first = recv_type(viewer, "status")
                self.assertFalse(first["phoneOnline"])
                self.assertTrue(first["modelLoaded"])

                same_origin = {"origin": "http://testserver"}
                with client.websocket_connect("/ws/phone", headers=same_origin) as phone:
                    auth(phone, PHONE)
                    self.assertEqual(phone.receive_json()["type"], "authed")

                    online = recv_type(viewer, "status")
                    self.assertTrue(online["phoneOnline"])
                    self.assertFalse(online["cameraOpen"])

                    phone.send_text(json.dumps({"type": "camera", "open": True, "width": 64, "height": 48}))
                    opened = recv_type(viewer, "status")
                    while not opened["cameraOpen"]:
                        opened = recv_type(viewer, "status")
                    self.assertEqual((opened["width"], opened["height"]), (64, 48))

                    phone.send_bytes(b"this is not a jpeg")      # ignored
                    phone.send_bytes(jpeg_bytes())
                    found = recv_type(viewer, "detections")
                    self.assertEqual(found["boxes"][0]["code"], "KH")
                    self.assertEqual(app.hub.frame_seq, 1)

                    stream = client.get(ready["streamPath"])
                    self.assertEqual(stream.status_code, 200)
                    self.assertTrue(stream.headers["content-type"].startswith("multipart/x-mixed-replace"))
                    self.assertIn(b"image/jpeg", stream.content)
                    self.assertIn(jpeg_bytes(), stream.content)

                # phone disconnects -> HighLo is told
                offline = recv_type(viewer, "status")
                while offline["phoneOnline"]:
                    offline = recv_type(viewer, "status")
                self.assertFalse(offline["cameraOpen"])

    def test_phone_wrong_token(self):
        with TestClient(create_app(settings(), NullDetector())) as client:
            with client.websocket_connect("/ws/phone", headers={"origin": "http://testserver"}) as ws:
                auth(ws, VIEWER)
                self.assertEqual(ws.receive_json()["error"], "unauthorized")

    def test_phone_from_other_site_rejected(self):
        with TestClient(create_app(settings(), NullDetector())) as client:
            with self.assertRaises(WebSocketDisconnect):
                with client.websocket_connect("/ws/phone", headers=HIGHLO):
                    pass


class UnitTests(unittest.TestCase):
    def test_tokens_equal(self):
        self.assertTrue(tokens_equal("abc", "abc"))
        self.assertFalse(tokens_equal("abd", "abc"))
        self.assertFalse(tokens_equal(None, "abc"))
        self.assertFalse(tokens_equal("", ""))
        self.assertFalse(tokens_equal("x" * 300, "x" * 300))

    def test_limiter_expires(self):
        now = [0.0]
        limiter = AuthLimiter(max_failures=2, window=10, clock=lambda: now[0])
        limiter.record_failure("a"); limiter.record_failure("a")
        self.assertTrue(limiter.blocked("a"))
        now[0] = 11
        self.assertFalse(limiter.blocked("a"))

    def test_tickets_expire(self):
        now = [0.0]
        store = TicketStore(ttl=5, clock=lambda: now[0])
        ticket = store.issue()
        self.assertTrue(store.valid(ticket))
        now[0] = 6
        self.assertFalse(store.valid(ticket))
        self.assertFalse(store.valid(None))

    def test_origin_rules(self):
        allowed = ("http://localhost:5173",)
        self.assertTrue(origin_allowed(None, "h:1", allowed))
        self.assertTrue(origin_allowed("http://localhost:5173", "h:1", allowed))
        self.assertTrue(origin_allowed("https://h:1", "h:1", ()))
        self.assertFalse(origin_allowed("https://evil.example", "h:1", allowed))

    def test_card_labels(self):
        cases = {"KH": "KH", "10d": "10D", "ace of spades": "AS", "ten_of_clubs": "10C",
                 "Queen-of-Hearts": "QH", "dealer": None, "1H": None, "person": None}
        for label, code in cases.items():
            self.assertEqual(to_highlo_code(label), code, label)

    def test_certificate_is_created_and_reused(self):
        with tempfile.TemporaryDirectory() as tmp:
            cert, key = ensure_certificate(Path(tmp), ("highlo.test",))
            first = cert.read_bytes()
            self.assertTrue(key.exists())
            cert2, _ = ensure_certificate(Path(tmp), ("highlo.test",))
            self.assertEqual(first, cert2.read_bytes())          # reused
            ensure_certificate(Path(tmp), ("another.test",))
            self.assertNotEqual(first, cert.read_bytes())         # new name => regenerated


if __name__ == "__main__":
    unittest.main()
