// Connection to the HighLo camera server (the separate Python program that
// receives video from the phone and runs card detection).
//
// HighLo keeps trying to reach the server by itself. The server reports
// whether the phone is online and its camera is open, so nobody has to press
// "connect" - the moment the phone starts its camera, HighLo goes live.

const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 5000;

// Close codes the server uses on purpose (see highlo-camera-server/app.py).
export const CLOSE_WRONG_TOKEN = 4401;
export const CLOSE_ORIGIN_NOT_ALLOWED = 4403;

/**
 * "192.168.1.5:8443", "https://pc.local:8443/" etc. -> { httpBase, wsUrl },
 * or null if it isn't a usable address.
 */
export function parseServerAddress(input) {
  const text = (input || "").trim();
  if (!text) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  const secure = url.protocol === "https:" || url.protocol === "wss:";
  const plain = url.protocol === "http:" || url.protocol === "ws:";
  if ((!secure && !plain) || !url.hostname) return null;
  return {
    httpBase: `${secure ? "https" : "http"}://${url.host}`,
    wsUrl: `${secure ? "wss" : "ws"}://${url.host}/ws/viewer`,
  };
}

/**
 * Connects, signs in with the access token, and keeps reconnecting until
 * close() is called. `onEvent` receives:
 *   { type: "ready", streamUrl }          signed in; video stream address
 *   { type: "status", ...}                phoneOnline, cameraOpen, modelLoaded, fps, width, height
 *   { type: "detections", boxes }         card boxes for the latest frame
 *   { type: "state", ... }                full table state, if the server sends it
 *   { type: "closed", code }              connection lost (will retry)
 *   { type: "rejected", code }            wrong token / site not allowed (stops retrying)
 *   { type: "invalid" }                   address or token missing/unusable
 */
export function connectCameraLink({ serverAddress, token, onEvent }) {
  const target = parseServerAddress(serverAddress);
  if (!target || !token) {
    onEvent({ type: "invalid" });
    return { close() {} };
  }

  let socket = null;
  let timer = null;
  let stopped = false;
  let attempts = 0;

  function scheduleRetry() {
    if (stopped) return;
    const delay = Math.min(RETRY_MIN_MS * 2 ** attempts, RETRY_MAX_MS);
    attempts += 1;
    timer = setTimeout(open, delay);
  }

  function open() {
    if (stopped) return;
    let ws;
    try {
      ws = new WebSocket(target.wsUrl);
    } catch {
      // e.g. an https page trying to open a plain ws:// address
      onEvent({ type: "closed", code: 0 });
      scheduleRetry();
      return;
    }
    socket = ws;

    ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token }));

    ws.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!message || typeof message !== "object") return;
      if (message.type === "ready") {
        attempts = 0;
        onEvent({ type: "ready", streamUrl: `${target.httpBase}${message.streamPath}` });
      } else {
        onEvent(message);
      }
    };

    ws.onclose = (event) => {
      if (socket !== ws) return; // an old socket we already replaced
      socket = null;
      onEvent({ type: "closed", code: event.code });
      if (event.code === CLOSE_WRONG_TOKEN || event.code === CLOSE_ORIGIN_NOT_ALLOWED) {
        stopped = true; // retrying can't help and would just trip the lockout
        onEvent({ type: "rejected", code: event.code });
        return;
      }
      scheduleRetry();
    };

    ws.onerror = () => {}; // onclose always follows
  }

  open();

  return {
    close() {
      stopped = true;
      clearTimeout(timer);
      if (socket) {
        const ws = socket;
        socket = null;
        ws.onclose = null;
        ws.close();
      }
    },
  };
}
