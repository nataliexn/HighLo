import React, { useState } from "react";
import { createPortal } from "react-dom";
import { buildShareLink, useAppState, useCameraLink } from "../state/AppStateContext.jsx";
import { parseServerAddress } from "../lib/cameraLink.js";

// One plain-language line for where the phone link currently stands.
function summarize(link) {
  const { settings } = link;
  if (!settings.serverAddress || !settings.token) return { tone: "off", text: "set up" };
  if (link.problem === "token") return { tone: "low", text: "wrong token" };
  if (link.problem === "origin") return { tone: "low", text: "site not allowed" };
  if (link.problem === "address") return { tone: "low", text: "bad address" };
  if (!link.serverOnline) return { tone: "off", text: "server offline" };
  if (!link.phoneOnline) return { tone: "medium", text: "waiting for phone" };
  if (!link.cameraOpen) return { tone: "medium", text: "waiting for camera" };
  return { tone: "high", text: link.modelLoaded ? "live" : "live (no model)" };
}

function StatusDot({ tone }) {
  return tone === "off" ? (
    <span className="hlo-confidence-dot" style={{ background: "var(--white-faint)" }} />
  ) : (
    <span className={`hlo-confidence-dot hlo-confidence-dot--${tone}`} />
  );
}

const inputStyle = {
  width: "100%",
  marginTop: 4,
  padding: "10px 12px",
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.15)",
  background: "var(--charcoal)",
  color: "var(--white)",
};

// The link everyone else at the table opens to see this camera. It carries
// the server address and viewer token in the URL fragment (#...), which the
// website's server never receives.
function ShareTableLink({ settings }) {
  const [copied, setCopied] = useState(false);
  const url = buildShareLink(settings);
  const local = /^(https?:\/\/)?(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(settings.serverAddress);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link:", url);
    }
  }
  async function share() {
    try {
      await navigator.share({ title: "HighLo table", url });
    } catch {
      // cancelled, or not supported: the copy button still works
    }
  }

  return (
    <div style={{ marginTop: 6, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
      <div style={{ fontSize: "0.78rem", fontWeight: 600, marginBottom: 4 }}>Table link</div>
      <p style={{ margin: "0 0 8px", fontSize: "0.72rem", color: "var(--white-faint)", lineHeight: 1.5 }}>
        Send this to everyone at the table. Opening it connects their HighLo to this camera. Anyone with the link can
        watch, so only share it with the table.
      </p>
      {local && (
        <p style={{ margin: "0 0 8px", fontSize: "0.72rem", color: "var(--confidence-medium)", lineHeight: 1.5 }}>
          This is a local network address: it only works for phones on the same Wi-Fi that have opened it once and
          accepted the certificate warning. Use a tunnel address (see the camera server README) so it works for
          everyone.
        </p>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="hlo-btn hlo-btn--ghost" style={{ flex: 1 }} onClick={copy}>
          {copied ? "Copied" : "Copy link"}
        </button>
        {typeof navigator !== "undefined" && navigator.share && (
          <button type="button" className="hlo-btn hlo-btn--ghost" style={{ flex: 1 }} onClick={share}>
            Share…
          </button>
        )}
      </div>
    </div>
  );
}

function CameraLinkModal({ onClose }) {
  const link = useCameraLink();
  const [address, setAddress] = useState(link.settings.serverAddress);
  const [token, setToken] = useState(link.settings.token);
  const [error, setError] = useState("");
  const summary = summarize(link);

  function handleSave(e) {
    e.preventDefault();
    if (!parseServerAddress(address)) {
      setError("That doesn't look like an address. Use the one the server prints, e.g. https://192.168.1.20:8443");
      return;
    }
    if (!token.trim()) {
      setError("Enter the access token the server printed.");
      return;
    }
    link.saveLinkSettings({ serverAddress: address, token });
    onClose();
  }

  return createPortal(
    <div
      role="dialog"
      aria-label="Phone camera"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(8,10,9,0.65)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 20,
      }}
      onClick={onClose}
    >
      <div className="hlo-panel" style={{ width: 420, maxWidth: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div className="hlo-panel__header">
          <h3 className="hlo-panel__title" style={{ fontSize: "1.1rem" }}>
            Phone camera
          </h3>
          <span className="hlo-pill">
            <StatusDot tone={summary.tone} />
            {summary.text}
          </span>
        </div>
        <form className="hlo-panel__body" onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--white-dim)", lineHeight: 1.5 }}>
            Start the HighLo camera server on your computer and enter what it prints. After this HighLo connects by
            itself whenever your phone opens its camera.
          </p>
          <label style={{ fontSize: "0.78rem", color: "var(--white-dim)" }}>
            Server address
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="https://192.168.1.20:8443"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              style={inputStyle}
            />
          </label>
          <label style={{ fontSize: "0.78rem", color: "var(--white-dim)" }}>
            Access token
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="from the server's terminal or .env file"
              autoComplete="off"
              style={inputStyle}
            />
          </label>
          {error && <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--confidence-low)" }}>{error}</p>}
          {!error && link.settings.serverAddress && !link.serverOnline && !link.problem && (
            <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--white-faint)", lineHeight: 1.5 }}>
              Can't reach the server? Open its address once in this browser and accept the certificate warning,
              then come back.
            </p>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button type="submit" className="hlo-btn hlo-btn--primary" style={{ flex: 1 }}>
              Save &amp; connect
            </button>
            {link.settings.serverAddress && (
              <button
                type="button"
                className="hlo-btn hlo-btn--ghost"
                onClick={() => {
                  link.clearLinkSettings();
                  setAddress("");
                  setToken("");
                }}
              >
                Disconnect
              </button>
            )}
            <button type="button" className="hlo-btn hlo-btn--ghost" onClick={onClose}>
              Close
            </button>
          </div>
          {link.settings.serverAddress && link.settings.token && <ShareTableLink settings={link.settings} />}
        </form>
      </div>
    </div>,
    document.body
  );
}

/**
 * CameraStatusPill
 * Small status button for the top bar: shows whether the phone camera is
 * connected and opens the settings dialog. `compact` is the mobile version.
 */
export default function CameraStatusPill({ compact = false }) {
  const link = useCameraLink();
  const { username } = useAppState();
  const [open, setOpen] = useState(false);
  const summary = summarize(link);

   if (username.trim().toLowerCase() !== "camera") return null;

  return (
    <>
      <button
        type="button"
        className="hlo-pill"
        onClick={() => setOpen(true)}
        title="Phone camera settings"
        style={{ border: "1px solid rgba(255,255,255,0.12)", cursor: "pointer", font: "inherit", fontSize: compact ? "0.68rem" : "0.75rem", fontWeight: 600 }}
      >
        <StatusDot tone={summary.tone} />
        {compact ? "Camera" : `Camera · ${summary.text}`}
      </button>
      {open && <CameraLinkModal onClose={() => setOpen(false)} />}
    </>
  );
}
