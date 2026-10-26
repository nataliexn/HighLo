import React, { useState } from "react";
import { createPortal } from "react-dom";
import { RANKS, SUITS } from "./Card.jsx";

/**
 * CardCorrectionModal
 * Rendered via a portal directly into document.body so it's never
 * affected by a dimmed/faded ancestor (e.g. a non-active player's
 * seat panel) — it always shows fully opaque and is always usable,
 * for any seat or the dealer.
 */
export default function CardCorrectionModal({ onClose, onPick }) {
  const [mode, setMode] = useState(null); // "rank" | "suit" | "unknown"

  return createPortal(
    <div
      role="dialog"
      aria-label="Correct card"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(8,10,9,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        className="hlo-panel"
        style={{ width: 320, maxWidth: "90vw", opacity: 1 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="hlo-panel__header">
          <h3 className="hlo-panel__title" style={{ fontSize: "1.1rem" }}>
            Correct card
          </h3>
          <button className="hlo-btn hlo-btn--ghost" style={{ padding: "4px 10px" }} onClick={onClose}>
            Close
          </button>
        </div>
        <div className="hlo-panel__body">
          {!mode && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button className="hlo-btn hlo-btn--ghost" onClick={() => setMode("rank")}>
                Incorrect rank
              </button>
              <button className="hlo-btn hlo-btn--ghost" onClick={() => setMode("suit")}>
                Incorrect suit
              </button>
              <button
                className="hlo-btn hlo-btn--ghost"
                onClick={() => {
                  onPick(null);
                  onClose();
                }}
              >
                Mark as unknown card
              </button>
            </div>
          )}
          {mode === "rank" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
              {RANKS.map((r) => (
                <button
                  key={r}
                  className="hlo-btn hlo-btn--ghost"
                  style={{ padding: "8px 0" }}
                  onClick={() => {
                    onPick({ type: "rank", value: r });
                    onClose();
                  }}
                >
                  {r}
                </button>
              ))}
            </div>
          )}
          {mode === "suit" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
              {SUITS.map((s) => (
                <button
                  key={s}
                  className="hlo-btn hlo-btn--ghost"
                  style={{ padding: "8px 0" }}
                  onClick={() => {
                    onPick({ type: "suit", value: s });
                    onClose();
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
