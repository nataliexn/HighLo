import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppState } from "../state/AppStateContext.jsx";

function DisclaimerModal({ seat, spectate, onCancel, onConfirm }) {
  const [checked, setChecked] = useState(false);

  return (
    <div
      role="dialog"
      aria-label="Disclaimer"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(8,10,9,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 200,
        padding: 20,
      }}
    >
      <div className="hlo-panel" style={{ width: 460, maxWidth: "100%" }}>
        <div className="hlo-panel__header">
          <h3 className="hlo-panel__title" style={{ fontSize: "1.2rem" }}>
            {spectate ? "Before you watch" : "Before you sit down"}
          </h3>
        </div>
        <div className="hlo-panel__body">
          <p style={{ fontSize: "0.85rem", color: "var(--white-dim)", lineHeight: 1.6 }}>
            HighLo is provided strictly for <strong>educational purposes</strong> — to help you learn and
            practice basic strategy and card counting concepts. It is not financial or gambling advice, and
            nothing it shows is a guarantee of any outcome.
          </p>
          <p style={{ fontSize: "0.85rem", color: "var(--white-dim)", lineHeight: 1.6 }}>
            Using a device or an app like this at an actual casino table is <strong>not permitted</strong> by
            most casinos and may violate their rules or local law. HighLo and its creators are not liable for
            any consequences — including being asked to leave or banned from a casino — that result from using
            information learned through this app in a real venue.
          </p>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, marginTop: 16, fontSize: "0.82rem", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              style={{ marginTop: 3 }}
            />
            I have read and understand this disclaimer.
          </label>
          <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
            <button className="hlo-btn hlo-btn--ghost" style={{ flex: 1 }} onClick={onCancel}>
              Cancel
            </button>
            <button
              className="hlo-btn hlo-btn--primary"
              style={{ flex: 1 }}
              disabled={!checked}
              onClick={onConfirm}
            >
              {spectate ? "Continue as spectator" : `Continue to seat ${seat}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SeatSelection() {
  const { occupancy, selectedSeat, setSelectedSeat, startSpectating, isGuest, username, live, seatsKnown } =
    useAppState();
  const navigate = useNavigate();
  const seats = Object.keys(occupancy).map(Number);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [spectate, setSpectate] = useState(false);
  const canSit = Boolean(selectedSeat && occupancy[selectedSeat]);

  // A seat can only be taken while the camera shows it occupied. If the seat
  // picked earlier has since been vacated, drop the choice instead of letting
  // the user sit in an empty seat.
  useEffect(() => {
    if (selectedSeat && !occupancy[selectedSeat]) setSelectedSeat(null);
  }, [occupancy, selectedSeat]);

  function pick(seat) {
    if (!occupancy[seat]) return;
    setSelectedSeat(seat);
  }

  let hint = "Only seats the camera sees occupied can be selected.";
  if (!live) hint = "No camera is connected, so no seat can be taken yet. You can spectate in the meantime.";
  else if (!seatsKnown) hint = "Seats are read from the next round's deal. You can spectate until then.";

  return (
    <div
      style={{
        minHeight: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        gap: 24,
      }}
    >
      <div style={{ textAlign: "center" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: "2rem", margin: 0, letterSpacing: "0.04em" }}>
          Choose your seat
        </h1>
        <p style={{ color: "var(--white-faint)", marginTop: 4 }}>
          Welcome, {isGuest ? "Guest" : username}. {hint}
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: "0.68rem", letterSpacing: "0.12em", color: "var(--white-faint)" }}>
          DEALER
        </span>

        {/* Table felt, curve facing downward — this is the view a player
            gets approaching the table, with the dealer standing beyond the
            flat (top) edge. Seats run right-to-left, matching how the
            dealer deals clockwise from a seated player's point of view.
            Seat positions and sizes are percentage/viewport-based (not
            fixed pixels) so they scale down together with the table and
            never overlap on a smaller screen. */}
        <div
          className="hlo-panel"
          style={{
            position: "relative",
            width: 560,
            maxWidth: "94vw",
            height: "clamp(210px, 46vw, 300px)",
            borderRadius: "10px 10px 50% 50% / 10px 10px 65% 65%",
            background: "linear-gradient(0deg, var(--felt-light), var(--felt))",
          }}
        >
          {seats.map((seat, i) => {
            // Horizontal position is spaced EVENLY by seat index (not by
            // cosine of an angle) so every gap between adjacent seats is
            // identical — seat 1 lands on the right, seat 6 on the left
            // (right-to-left dealing order), with no bunching at the ends.
            // An equal-angle/ellipse parametrization bunches seats near the
            // ends of the arc (where cos changes slowest), which is exactly
            // what caused 1/2 and 5/6 to overlap; even horizontal spacing
            // fixes that regardless of screen size.
            const t = seats.length === 1 ? 0 : i / (seats.length - 1);
            const leftPct = 90 - 80 * t;
            // Vertical position still follows a gentle arc (dips lowest in
            // the middle seats) using the same t, purely for the curved
            // "around the table" look — it has no bearing on overlap since
            // that's driven by horizontal spacing above.
            const topPct = 20 + 36 * Math.sin(Math.PI * t);
            const occupied = occupancy[seat];
            const isSelected = selectedSeat === seat;
            return (
              <button
                key={seat}
                onClick={() => pick(seat)}
                disabled={!occupied}
                style={{
                  position: "absolute",
                  left: `${leftPct}%`,
                  top: `${topPct}%`,
                  transform: "translate(-50%, -50%)",
                  width: "clamp(48px, 13vw, 84px)",
                  height: "clamp(48px, 13vw, 84px)",
                  borderRadius: "50%",
                  border: isSelected ? "3px solid var(--brass)" : "2px solid rgba(244,242,234,0.3)",
                  background: occupied
                    ? isSelected
                      ? "var(--red)"
                      : "var(--charcoal-light)"
                    : "rgba(60,62,61,0.4)",
                  color: occupied ? "var(--white)" : "var(--white-faint)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: occupied ? "pointer" : "not-allowed",
                  fontWeight: 700,
                }}
              >
                <span style={{ fontSize: "clamp(0.7rem, 2.6vw, 1.1rem)" }}>{seat}</span>
                <span style={{ fontSize: "clamp(0.5rem, 1.6vw, 0.6rem)", fontWeight: 500 }}>
                  {occupied ? "occupied" : "vacant"}
                </span>
              </button>
            );
          })}
        </div>
        <span style={{ fontSize: "0.68rem", letterSpacing: "0.12em", color: "var(--white-faint)" }}>
          YOU ARE HERE
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        <button
          className="hlo-btn hlo-btn--primary"
          style={{ fontSize: "1rem", padding: "12px 32px" }}
          disabled={!canSit}
          onClick={() => {
            setSpectate(false);
            setShowDisclaimer(true);
          }}
        >
          {canSit ? `Sit at seat ${selectedSeat}` : "Select a seat to sit down"}
        </button>
        <button
          className="hlo-btn hlo-btn--ghost"
          style={{ fontSize: "0.9rem", padding: "10px 28px" }}
          onClick={() => {
            setSpectate(true);
            setShowDisclaimer(true);
          }}
        >
          Spectate
        </button>
        <p style={{ margin: 0, maxWidth: 360, textAlign: "center", fontSize: "0.72rem", color: "var(--white-faint)", lineHeight: 1.5 }}>
          Spectating shows every player's recommendation as each turn happens, without a seat of your own.
          {isGuest ? "" : " Your analysis stays on your account, view only; it only grows while you sit at a seat."}
        </p>
      </div>

      {showDisclaimer && (
        <DisclaimerModal
          seat={selectedSeat}
          spectate={spectate}
          onCancel={() => setShowDisclaimer(false)}
          onConfirm={() => {
            setShowDisclaimer(false);
            if (spectate) startSpectating();
            navigate("/master");
          }}
        />
      )}
    </div>
  );
}
