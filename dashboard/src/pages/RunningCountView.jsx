import React from "react";
import { useAppState } from "../state/AppStateContext.jsx";
import CountHistory from "../components/CountHistory.jsx";
import StrategyChartButton from "../components/StrategyChart.jsx";

// Small stat box, styled exactly like the old "Last shuffle" panel this
// replaces (Running count / True count / Cards counted / Est. decks
// remaining / Hands since shuffle), detached from the CountHistory
// component itself so they live at the page level instead —
// CountHistory itself skips its own stats row here via
// `showStats={false}` to avoid repeating them. Fixed width (rather than
// `inline-block`, which sized each box to its own content) so all five
// line up exactly the same size regardless of label/value length.
function StatBox({ label, value }) {
  return (
    <div className="hlo-panel" style={{ padding: 16, width: 170, flex: "0 0 170px" }}>
      <div style={{ fontSize: "0.75rem", color: "var(--white-faint)" }}>{label}</div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: "2rem" }}>{value}</div>
    </div>
  );
}

export default function RunningCountView() {
  const { countStats, shoeStats, midShoeJoin } = useAppState();

  return (
    <div className="hlo-page">
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "1.8rem", letterSpacing: "0.03em", margin: "0 0 4px" }}>
        Running Count
      </h1>
      <p style={{ color: "var(--white-faint)", marginTop: 0, marginBottom: 20 }}>
        Full card history and count progression since last shuffle.
      </p>

      {midShoeJoin.isMidShoeJoin && (
        <div style={{ marginBottom: 16, padding: "10px 12px", borderRadius: 8, background: "rgba(209,161,58,0.12)", border: "1px solid rgba(209,161,58,0.45)", fontSize: "0.8rem", lineHeight: 1.5, color: "var(--white-dim)" }}>
          <b style={{ color: "var(--white)" }}>Joined mid-shoe — this count is unreliable.</b> Cards already in the
          discard pile were never counted, so the numbers below only cover what the camera has seen. Recommendations
          follow the basic-strategy chart until the next shuffle, when counting restarts from zero.{" "}
          <StrategyChartButton label="Open the strategy chart" />
        </div>
      )}
      <div style={{ display: "flex", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
        <StatBox label="Running count" value={countStats.runningCount} />
        <StatBox label="True count" value={countStats.trueCount.toFixed(1)} />
        <StatBox label="Cards counted" value={countStats.cardsCounted} />
        <StatBox label="Est. decks remaining" value={countStats.decksRemaining.toFixed(1)} />
        <StatBox label="Hands since shuffle" value={shoeStats.handsSinceShuffle} />
      </div>

      <CountHistory showStats={false} />
    </div>
  );
}
