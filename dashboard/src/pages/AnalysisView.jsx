import React from "react";
import { useAppState } from "../state/AppStateContext.jsx";

function StatCard({ label, value, sub }) {
  return (
    <div className="hlo-panel" style={{ padding: 16 }}>
      <div style={{ fontSize: "0.75rem", color: "var(--white-faint)" }}>{label}</div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: "1.9rem", margin: "4px 0" }}>{value}</div>
      {sub && <div style={{ fontSize: "0.72rem", color: "var(--white-dim)" }}>{sub}</div>}
    </div>
  );
}

export default function AnalysisView() {
  const { analysis, isGuest, isSpectating } = useAppState();
  const locked = analysis.handsPlayed < analysis.minHandsRequired || analysis.trend.length === 0;
  const maxWinRate = Math.max(0.01, ...analysis.trend.map((t) => t.winRate));

  if (isGuest) {
    return (
      <div className="hlo-page">
        <div className="hlo-panel" style={{ padding: 32, textAlign: "center" }}>
          <h2 style={{ fontFamily: "var(--font-display)", letterSpacing: "0.03em" }}>Analysis is for registered players</h2>
          <p style={{ color: "var(--white-faint)" }}>
            Log in and play at least {analysis.minHandsRequired} hands to unlock your playstyle, risk profile, and
            decision-accuracy reports.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="hlo-page">
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "1.8rem", letterSpacing: "0.03em", margin: "0 0 4px" }}>
        Analysis Report
      </h1>
      <p style={{ color: "var(--white-faint)", marginTop: 0, marginBottom: 20 }}>
        {analysis.handsPlayed} hands recorded this account.
        {isSpectating && " You're spectating, so this is view only: only hands played from a seat change it."}
      </p>

      {locked ? (
        <div className="hlo-panel" style={{ padding: 24 }}>
          <p style={{ margin: 0 }}>
            {analysis.handsPlayed < analysis.minHandsRequired
              ? `Play ${analysis.minHandsRequired - analysis.handsPlayed} more hand(s) to unlock your full report.`
              : "Your report is still being prepared. It needs a little more history."}
          </p>
        </div>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 14,
              marginBottom: 20,
            }}
          >
            <StatCard label="Playstyle" value={analysis.playstyle} />
            <StatCard label="Risk profile" value={analysis.riskProfile} />
            <StatCard label="Decision accuracy" value={`${Math.round(analysis.decisionAccuracy * 100)}%`} />
            <StatCard label="Betting behavior" value="Flat / occasional 2x" sub={analysis.bettingBehavior} />
          </div>

          <div className="hlo-panel" style={{ marginBottom: 20 }}>
            <div className="hlo-panel__header">
              <h3 className="hlo-panel__title">What we've noticed</h3>
            </div>
            <div className="hlo-panel__body">
              <p style={{ margin: 0, color: "var(--white-dim)", fontSize: "0.88rem", lineHeight: 1.6 }}>
                {analysis.description}
              </p>
            </div>
          </div>

          <div className="hlo-panel">
            <div className="hlo-panel__header">
              <h3 className="hlo-panel__title">Win Rate by Day</h3>
            </div>
            <div className="hlo-panel__body">
              <div style={{ display: "flex", alignItems: "flex-end", gap: 18, height: 160 }}>
                {analysis.trend.map((t) => (
                  <div key={t.date} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
                    <div style={{ fontSize: "0.7rem", marginBottom: 4, color: "var(--white-dim)" }}>
                      {Math.round(t.winRate * 100)}%
                    </div>
                    <div
                      style={{
                        width: "60%",
                        height: `${(t.winRate / maxWinRate) * 120}px`,
                        background: "linear-gradient(180deg, var(--red-bright), var(--red))",
                        borderRadius: "4px 4px 0 0",
                      }}
                    />
                    <div style={{ fontSize: "0.68rem", marginTop: 6, color: "var(--white-faint)" }}>{t.date}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
