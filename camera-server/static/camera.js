// HighLo Camera: sends this phone's camera to the HighLo camera server.
// Everything is written with textContent / DOM calls only - no HTML strings.
(() => {
  "use strict";

  // The pairing token arrives in the URL fragment (#t=...), which browsers never
  // send to the server. Keep it for this tab only, then remove it from the address bar.
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (fragment.get("t")) {
    sessionStorage.setItem("hlo-phone-token", fragment.get("t"));
    history.replaceState(null, "", location.pathname);
  }
  const token = sessionStorage.getItem("hlo-phone-token") || "";

  const $ = (id) => document.getElementById(id);
  const els = {
    server: $("st-server"), camera: $("st-camera"), viewers: $("st-viewers"), fps: $("st-fps"),
    notice: $("notice"), video: $("preview"), empty: $("preview-empty"),
    start: $("btn-start"), stop: $("btn-stop"), flip: $("btn-flip"), rotate: $("btn-rotate"), snap: $("btn-snap"), timer: $("snap-timer"), snaps: $("st-snaps"), size: $("st-size"),
    quality: $("quality"),
  };

  const state = {
    ws: null, authed: false, stream: null, facing: "environment",
    timer: null, busy: false, wakeLock: null, retry: 0, sent: 0, sentWindow: [],
    upsideDown: false, lastStart: 0, lastW: 0, lastH: 0, snapshots: 0, snapshotBusy: false,
  };
  // Shown in the preview box AND encoded for sending, so the preview is
  // always exactly what HighLo receives (landscape, rotated if needed).
  const canvas = $("preview-canvas");

  function setPill(el, text, tone) {
    el.textContent = text;
    el.className = "pill" + (tone ? " " + tone : "");
  }
  function notice(text) {
    els.notice.textContent = text || "";
    els.notice.hidden = !text;
  }

  // ---- connection -------------------------------------------------------
  function connect() {
    if (!token) {
      setPill(els.server, "Not paired", "bad");
      notice("Scan the QR code shown on your computer to pair this phone.");
      els.start.disabled = true;
      return;
    }
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/ws/phone`);
    ws.binaryType = "arraybuffer";
    state.ws = ws;
    state.authed = false;
    setPill(els.server, "Connecting…", "warn");

    ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token }));
    ws.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === "authed") {
        state.authed = true;
        state.retry = 0;
        setPill(els.server, "Connected", "ok");
        notice("");
        if (state.stream) announceCamera(true);
      } else if (msg.type === "stats") {
        const n = Number(msg.viewers) || 0;
        setPill(els.viewers, n > 0 ? "HighLo connected" : "Waiting for HighLo", n > 0 ? "ok" : "warn");
      }
    };
    ws.onclose = (event) => {
      state.authed = false;
      setPill(els.viewers, "Not connected");
      if (event.code === 4401) {
        setPill(els.server, "Wrong code", "bad");
        notice("This pairing code is no longer valid. Restart the server and scan the new QR code.");
        els.start.disabled = true;
        return; // retrying with the same token can't succeed
      }
      if (event.code === 4409) {
        setPill(els.server, "Replaced", "warn");
        notice("Another phone took over this connection.");
        return;
      }
      setPill(els.server, "Reconnecting…", "warn");
      const delay = Math.min(1000 * 2 ** state.retry++, 5000);
      setTimeout(connect, delay);
    };
  }

  function announceCamera(open) {
    if (!state.ws || !state.authed) return;
    const track = state.stream && state.stream.getVideoTracks()[0];
    const settings = track ? track.getSettings() : {};
    state.ws.send(JSON.stringify({
      type: "camera", open,
      width: sendSize().width || settings.width || 0,
      height: sendSize().height || settings.height || 0,
    }));
  }

  // ---- camera -----------------------------------------------------------
  function qualityParams() {
    const [maxWidth, jpegQuality, fps] = els.quality.value.split(":").map(Number);
    return { maxWidth, jpegQuality, fps };
  }
  // What gets sent (and shown in the preview) is the centre 16:9 window of the
  // camera picture, upright: on a portrait phone camera that means the top and
  // bottom are cut off, exactly like the preview box. HighLo's feed is 16:9 too,
  // so it shows the same area. "Rotate 180" is only for an upside-down picture.
  const ASPECT = 16 / 9;
  function cropRect(vw, vh) {
    if (vw / vh > ASPECT) {
      const sw = vh * ASPECT;
      return { sx: (vw - sw) / 2, sy: 0, sw, sh: vh };
    }
    const sh = vw / ASPECT;
    return { sx: 0, sy: (vh - sh) / 2, sw: vw, sh };
  }
  function sendSize() {
    const { maxWidth } = qualityParams();
    const vw = els.video.videoWidth, vh = els.video.videoHeight;
    if (!vw || !vh) return { width: 0, height: 0 };
    const { sw, sh } = cropRect(vw, vh);
    const scale = Math.min(1, maxWidth / sw);
    return { width: Math.round(sw * scale), height: Math.round(sh * scale) };
  }
  // Draw the centre 16:9 window of the camera picture into `target`, no wider than maxWidth.
  function renderCrop(target, maxWidth) {
    const { sx, sy, sw, sh } = cropRect(els.video.videoWidth, els.video.videoHeight);
    const scale = Math.min(1, maxWidth / sw);
    const width = Math.round(sw * scale), height = Math.round(sh * scale);
    target.width = width;
    target.height = height;
    const ctx = target.getContext("2d");
    ctx.save();
    ctx.translate(width / 2, height / 2);
    if (state.upsideDown) ctx.rotate(Math.PI);
    ctx.drawImage(els.video, sx, sy, sw, sh, -width / 2, -height / 2, width, height);
    ctx.restore();
    return { width, height };
  }
  function drawFrame() {
    const { width, height } = renderCrop(canvas, qualityParams().maxWidth);
    if (width !== state.lastW || height !== state.lastH) {
      state.lastW = width; state.lastH = height;
      setPill(els.size, `${width}×${height} (camera ${els.video.videoWidth}×${els.video.videoHeight})`);
      announceCamera(true); // HighLo needs the new size to place detection boxes
    }
  }

  // Save one full-quality still of exactly what the server sees, on the computer running the server.
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function takeSnapshot() {
    if (!state.stream || state.snapshotBusy) return;
    state.snapshotBusy = true;
    try {
      // a countdown, because tapping the screen shakes a phone stand
      for (let left = Number(els.timer.value) || 0; left > 0; left--) {
        els.snap.textContent = `Hold still… ${left}`;
        await sleep(1000);
        if (!state.stream) return;
      }
      els.snap.textContent = "Saving…";
      const shot = document.createElement("canvas");
      renderCrop(shot, Infinity); // native resolution, not scaled down
      const blob = await new Promise((resolve) => shot.toBlob(resolve, "image/jpeg", 0.95));
      const res = await fetch("/api/snapshot", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/jpeg" },
        body: blob,
      });
      if (!res.ok) throw new Error(String(res.status));
      state.snapshots += 1;
      setPill(els.snaps, `${state.snapshots} saved`, "ok");
      notice("");
    } catch {
      notice("Could not save the snapshot. Is the server still running?");
    } finally {
      state.snapshotBusy = false;
      els.snap.textContent = "Take snapshot";
    }
  }

  async function startCamera() {
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      notice("This page must be opened over HTTPS to use the camera. Use the link from the server's terminal.");
      return;
    }
    stopCamera(false);
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: state.facing }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } },
      });
    } catch (err) {
      const denied = err && (err.name === "NotAllowedError" || err.name === "SecurityError");
      notice(denied
        ? "Camera permission was denied. Allow camera access for this site in your browser settings."
        : "Could not start the camera. Is another app using it?");
      return;
    }
    notice("");
    els.video.srcObject = state.stream;
    await els.video.play().catch(() => {});
    els.empty.hidden = true;
    els.start.hidden = true;
    els.stop.hidden = false;
    els.flip.hidden = false;
    els.rotate.hidden = false;
    els.snap.hidden = false;
    setPill(els.camera, "On", "ok");
    keepAwake();
    announceCamera(true);
    scheduleCapture();
  }

  function stopCamera(announce = true) {
    clearTimeout(state.timer);
    state.timer = null;
    if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
    els.video.srcObject = null;
    canvas.width = 1; canvas.height = 1; // clear the preview
    state.lastW = 0; state.lastH = 0;
    els.empty.hidden = false;
    els.start.hidden = false;
    els.stop.hidden = true;
    els.flip.hidden = true;
    els.rotate.hidden = true;
    els.snap.hidden = true;
    setPill(els.camera, "Off");
    setPill(els.size, "—");
    setPill(els.fps, "—");
    if (announce) announceCamera(false);
    if (state.wakeLock) { state.wakeLock.release().catch(() => {}); state.wakeLock = null; }
  }

  function scheduleCapture() {
    const { fps } = qualityParams();
    // count the time already spent encoding, so the real rate matches the setting
    const wait = Math.max(0, 1000 / fps - (performance.now() - state.lastStart));
    state.timer = setTimeout(captureFrame, wait);
  }

  function captureFrame() {
    if (!state.stream) return;
    if (state.busy || !els.video.videoWidth) return scheduleCapture();
    state.lastStart = performance.now();
    drawFrame(); // also updates the preview, even while not connected
    const ws = state.ws;
    const ready = ws && ws.readyState === WebSocket.OPEN && state.authed;
    // skip a frame rather than queue up: buffered frames just add lag
    if (!ready || ws.bufferedAmount > 512 * 1024) return scheduleCapture();
    state.busy = true;
    canvas.toBlob(async (blob) => {
      try {
        if (blob && ws.readyState === WebSocket.OPEN) {
          ws.send(await blob.arrayBuffer());
          countSent();
        }
      } finally {
        state.busy = false;
        scheduleCapture();
      }
    }, "image/jpeg", qualityParams().jpegQuality);
  }

  function countSent() {
    const now = performance.now();
    state.sentWindow.push(now);
    while (state.sentWindow.length && now - state.sentWindow[0] > 3000) state.sentWindow.shift();
    const rate = state.sentWindow.length / 3;
    setPill(els.fps, `${rate.toFixed(0)} frames/s`, rate > 0 ? "ok" : "warn");
  }

  async function keepAwake() {
    try {
      if ("wakeLock" in navigator && !state.wakeLock) {
        state.wakeLock = await navigator.wakeLock.request("screen");
        state.wakeLock.addEventListener("release", () => { state.wakeLock = null; });
      }
    } catch { /* not supported or refused: the screen may dim */ }
  }

  // ---- wiring -----------------------------------------------------------
  els.start.addEventListener("click", startCamera);
  els.stop.addEventListener("click", () => stopCamera(true));
  els.flip.addEventListener("click", () => {
    state.facing = state.facing === "environment" ? "user" : "environment";
    startCamera();
  });
  els.snap.addEventListener("click", takeSnapshot);
  els.rotate.addEventListener("click", () => {
    state.upsideDown = !state.upsideDown;
  });
  els.quality.addEventListener("change", () => state.stream && announceCamera(true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.stream) keepAwake();
  });
  window.addEventListener("pagehide", () => stopCamera(true));

  connect();
})();
