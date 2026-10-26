import React from "react";
import { useAppState } from "../state/AppStateContext.jsx";
import CameraFeed from "../components/CameraFeed.jsx";
import ActivePlayers from "../components/ActivePlayers.jsx";
import Dealer from "../components/Dealer.jsx";

export default function TableView() {
  const { midShoeJoin } = useAppState();
  return (
    <div className="hlo-page">
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "1.8rem", letterSpacing: "0.03em", margin: "0 0 4px" }}>
        Table View
      </h1>
      <p style={{ color: "var(--white-faint)", marginTop: 0, marginBottom: 20 }}>
        Full camera feed with detection overlays and every seat at the table.
        {midShoeJoin.isMidShoeJoin && " Tracking joined mid-shoe — some count history predates this session."}
      </p>

      <div className="hlo-panel" style={{ marginBottom: 18 }}>
        <div className="hlo-panel__body">
          <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 9" }}>
            <CameraFeed />
          </div>
        </div>
      </div>

      <div className="hlo-panel">
        <div className="hlo-panel__header">
          <h3 className="hlo-panel__title">All Seats</h3>
        </div>
        <div className="hlo-panel__body">
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
            <Dealer />
          </div>
          <ActivePlayers />
        </div>
      </div>
    </div>
  );
}
