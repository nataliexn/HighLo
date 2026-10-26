import React from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAppState } from "../state/AppStateContext.jsx";
import CameraStatusPill from "./CameraLink.jsx";
import StrategyChartButton from "./StrategyChart.jsx";

export default function Nav() {
  const { selectedSeat, isSpectating, username, isGuest, logout } = useAppState();
  const navigate = useNavigate();

  function handleSwitchSeat() {
    navigate("/seats");
  }

  return (
    <nav className="hlo-nav">
      <div className="hlo-nav__brand">
        High<span>Lo</span>
      </div>
      <div className="hlo-nav__links">
        <NavLink to="/master" className={({ isActive }) => `hlo-nav__link ${isActive ? "active" : ""}`}>
          Master
        </NavLink>
        <NavLink to="/table" className={({ isActive }) => `hlo-nav__link ${isActive ? "active" : ""}`}>
          Table
        </NavLink>
        <NavLink to="/analysis" className={({ isActive }) => `hlo-nav__link ${isActive ? "active" : ""}`}>
          Analysis
        </NavLink>
        <NavLink to="/count" className={({ isActive }) => `hlo-nav__link ${isActive ? "active" : ""}`}>
          Running Count
        </NavLink>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <StrategyChartButton />
        <CameraStatusPill />
        <span className="hlo-nav__seat">
          {isGuest ? "Guest" : username} · {isSpectating ? "Spectating" : `Seat ${selectedSeat ?? "—"}`}
        </span>
        <button className="hlo-btn hlo-btn--ghost" style={{ padding: "6px 14px", fontSize: "0.8rem" }} onClick={handleSwitchSeat}>
          {isSpectating ? "Take a seat" : "Switch seat"}
        </button>
        <button className="hlo-btn hlo-btn--ghost" style={{ padding: "6px 14px", fontSize: "0.8rem" }} onClick={() => { logout(); navigate("/"); }}>
          Log out
        </button>
      </div>
    </nav>
  );
}
