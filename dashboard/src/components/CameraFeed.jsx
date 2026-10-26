import React, { useEffect, useRef, useState } from "react";
import config from "../config.js";
import { useAppState, useCameraLink } from "../state/AppStateContext.jsx";

const CONFIDENCE_BORDER = {
  high: "var(--confidence-high)",
  medium: "var(--confidence-medium)",
  low: "var(--confidence-low)",
};

// Confidence colour for a detection box.
function boxColor(conf) {
  if (conf >= 0.8) return CONFIDENCE_BORDER.high;
  if (conf >= 0.6) return CONFIDENCE_BORDER.medium;
  return CONFIDENCE_BORDER.low;
}

// Size of an element, kept up to date as it resizes.
function useElementSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

// Where a frame of the given size lands inside a container when it is shown
// with object-fit: contain, so normalised (0-1) detection boxes line up
// with the picture rather than with the letterbox bars around it.
function fittedRect(container, frameWidth, frameHeight) {
  if (!container.width || !container.height || !frameWidth || !frameHeight) return null;
  const scale = Math.min(container.width / frameWidth, container.height / frameHeight);
  const width = frameWidth * scale;
  const height = frameHeight * scale;
  return { left: (container.width - width) / 2, top: (container.height - height) / 2, width, height };
}

export default function CameraFeed() {
  const { cameraConnected } = useAppState();
  const link = useCameraLink();
  const frameRef = useRef(null);
  const frameSize = useElementSize(frameRef);

  // The phone camera (through the camera server) wins while it is live;
  // otherwise fall back to a plain stream URL, then to the placeholder.
  const streamUrl = link.live ? link.streamUrl : config.CAMERA_STREAM_URL;
  const rect = link.live ? fittedRect(frameSize, link.width, link.height) : null;

  let offlineHint;
  if (link.settings.serverAddress && link.settings.token) {
    if (link.problem) offlineHint = "Check the Camera settings (top bar)";
    else if (!link.serverOnline) offlineHint = "Camera server not reachable";
    else if (!link.phoneOnline) offlineHint = "Waiting for the phone to connect";
    else offlineHint = "Waiting for the phone to start its camera";
  } else {
    offlineHint = "Use the Camera button in the top bar to connect your phone";
  }

  return (
    <div
      ref={frameRef}
      className="hlo-camera"
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
        containerType: "inline-size",
        background: streamUrl ? "#000" : "var(--charcoal)",
      }}
    >
      {streamUrl ? (
        // The picture fits itself inside the box (never spills out of it); the
        // black bars around it are the part of the box the picture doesn't cover.
        <img
          src={streamUrl}
          alt="Live table feed"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }}
        />
      ) : (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            gap: 6,
            color: "var(--white-faint)",
          }}
        >
          <span style={{ fontFamily: "var(--font-display)", fontSize: "1.4rem", letterSpacing: "0.04em" }}>
            NO CAMERA DETECTED
          </span>
          <span style={{ fontSize: "0.85rem", color: "var(--white-dim)" }}>The table is empty.</span>
          <span style={{ fontSize: "0.78rem" }}>{offlineHint}</span>
        </div>
      )}

      {/* Real detections from the phone camera, drawn over the picture. */}
      {rect &&
        link.boxes.map((b, i) => {
          const [x1, y1, x2, y2] = b.box;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: rect.left + x1 * rect.width,
                top: rect.top + y1 * rect.height,
                width: (x2 - x1) * rect.width,
                height: (y2 - y1) * rect.height,
                border: `2px solid ${boxColor(b.conf)}`,
                borderRadius: 4,
                pointerEvents: "none",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  left: -2,
                  bottom: "100%",
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.62rem",
                  padding: "1px 5px",
                  borderRadius: 4,
                  background: "rgba(27,28,29,0.85)",
                  color: "var(--white)",
                  whiteSpace: "nowrap",
                }}
              >
                {b.code || b.label} {Math.round(b.conf * 100)}%
              </span>
            </div>
          );
        })}

      <div
        style={{
          position: "absolute",
          top: 8,
          right: 10,
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: "0.7rem",
          color: "var(--white-dim)",
          background: "rgba(0,0,0,0.4)",
          padding: "3px 8px",
          borderRadius: 999,
        }}
      >
        <span
          className={`hlo-confidence-dot hlo-confidence-dot--${cameraConnected ? "high" : "low"}`}
        />
        {cameraConnected ? (link.live && !link.modelLoaded ? "LIVE (video only)" : "LIVE") : "NO CAMERA"}
      </div>
    </div>
  );
}
