import React from "react";
import { useAppState } from "../state/AppStateContext.jsx";

/**
 * DemoBanner
 * Shown whenever no camera is live: the table on screen is the built-in
 * sample (state/mockData.js demoTable), so visitors can see every part of
 * HighLo working. Disappears the moment a camera goes live.
 */
export default function DemoBanner({ compact = false }) {
  const { isDemo } = useAppState();
  if (!isDemo) return null;
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        flexWrap: "wrap",
        padding: compact ? "6px 12px" : "7px 16px",
        background: "rgba(168,134,63,0.16)",
        borderBottom: "1px solid rgba(168,134,63,0.45)",
        color: "var(--white-dim)",
        fontSize: compact ? "0.72rem" : "0.8rem",
        textAlign: "center",
        lineHeight: 1.4,
      }}
    >
      <span
        style={{
          fontWeight: 700,
          letterSpacing: "0.08em",
          color: "var(--brass)",
          border: "1px solid var(--brass)",
          borderRadius: 999,
          padding: "1px 8px",
          fontSize: "0.68rem",
        }}
      >
        SAMPLE DATA
      </span>
      No camera is connected, so this is a sample table showing what HighLo does during a live game.
    </div>
  );
}
