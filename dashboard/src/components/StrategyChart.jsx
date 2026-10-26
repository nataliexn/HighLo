import React, { useState } from "react";
import { createPortal } from "react-dom";
import { DEALER_COLUMNS, fullStrategyChart } from "../lib/strategy.js";

const COLORS = {
  HIT: "#d1393f",
  STAND: "#3f7fd1",
  DOUBLE: "#3f9d5c",
  SPLIT: "#d1a13a",
  SURRENDER: "#161616",
};

function ChartModal({ onClose }) {
  const sections = fullStrategyChart();
  return createPortal(
    <div
      role="dialog"
      aria-label="Basic strategy chart"
      style={{ position: "fixed", inset: 0, background: "rgba(8,10,9,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={onClose}
    >
      <div className="hlo-panel" style={{ width: 640, maxWidth: "100%", maxHeight: "92vh", display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
        <div className="hlo-panel__header">
          <h3 className="hlo-panel__title" style={{ fontSize: "1.1rem" }}>Basic strategy chart</h3>
          <button type="button" className="hlo-btn hlo-btn--ghost" style={{ padding: "4px 12px", fontSize: "0.78rem" }} onClick={onClose}>Close</button>
        </div>
        <div className="hlo-panel__body" style={{ overflowY: "auto" }}>
          <p style={{ margin: "0 0 10px", fontSize: "0.78rem", color: "var(--white-dim)", lineHeight: 1.5 }}>
            Find your hand on the left and the dealer's up card across the top. When HighLo joins a shoe that is
            already in progress, the count is missing every card in the discard pile, so recommendations follow this
            chart instead of the count.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12, fontSize: "0.7rem" }}>
            {Object.entries(COLORS).map(([name, color]) => (
              <span key={name} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: color, border: "1px solid rgba(255,255,255,0.25)" }} />
                {name[0] + name.slice(1).toLowerCase()} ({name[0]})
              </span>
            ))}
          </div>
          {sections.map((section) => (
            <div key={section.title} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: "0.78rem", fontWeight: 600, marginBottom: 4 }}>{section.title}</div>
              <div style={{ overflowX: "auto" }}>
                <table className="hlo-strategy-table" style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left" }}>You \ Dealer</th>
                      {DEALER_COLUMNS.map((c) => <th key={c}>{c}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {section.rows.map((row) => (
                      <tr key={row.label}>
                        <td style={{ textAlign: "left", fontWeight: 600 }}>{row.label}</td>
                        {row.cells.map((cell) => (
                          <td key={cell.col} style={{ background: COLORS[cell.action], color: "#fff", fontWeight: 700 }}>
                            {cell.action[0]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          <p style={{ margin: 0, fontSize: "0.7rem", color: "var(--white-faint)", lineHeight: 1.5 }}>
            Standard multi-deck chart (dealer stands on 17). "Surrender" applies only where the table allows it; if
            it doesn't, hit instead.
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
}

/** A button that opens the full strategy chart. `compact` is the mobile size. */
export default function StrategyChartButton({ compact = false, label = "Strategy chart", style }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="hlo-pill"
        onClick={() => setOpen(true)}
        title="Open the basic-strategy (hit) chart"
        style={{ border: "1px solid rgba(255,255,255,0.12)", cursor: "pointer", font: "inherit", fontSize: compact ? "0.68rem" : "0.75rem", fontWeight: 600, ...style }}
      >
        {label}
      </button>
      {open && <ChartModal onClose={() => setOpen(false)} />}
    </>
  );
}
