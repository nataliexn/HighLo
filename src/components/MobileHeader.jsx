import React from "react";
import { useNavigate } from "react-router-dom";
import { useAppState } from "../state/AppStateContext.jsx";
import CameraStatusPill from "./CameraLink.jsx";

/**
 * MobileHeader
 * The trimmed-down top bar for phones: just the logo, who's playing,
 * their seat, and the two account actions. No page nav links here — the
 * bottom MobileTabBar handles navigation, like a normal mobile app.
 */
export default function MobileHeader() {
  const { selectedSeat, username, isGuest, logout } = useAppState();
  const navigate = useNavigate();

  return (
    <nav className="hlo-nav hlo-nav--mobile">
      <div className="hlo-nav__brand" style={{ fontSize: "1.3rem" }}>
        High<span>Lo</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
        <CameraStatusPill compact />
        <span className="hlo-nav__seat" style={{ fontSize: "0.72rem" }}>
          {isGuest ? "Guest" : username} · Seat {selectedSeat ?? "—"}
        </span>
        <button
          className="hlo-btn hlo-btn--ghost"
          style={{ padding: "4px 10px", fontSize: "0.7rem" }}
          onClick={() => navigate("/seats")}
        >
          Switch
        </button>
        <button
          className="hlo-btn hlo-btn--ghost"
          style={{ padding: "4px 10px", fontSize: "0.7rem" }}
          onClick={() => {
            logout();
            navigate("/");
          }}
        >
          Log out
        </button>
      </div>
    </nav>
  );
}
