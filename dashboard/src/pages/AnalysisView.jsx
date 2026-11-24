import React, { useState } from "react";
import { useAppState } from "../state/AppStateContext.jsx";
import { RESULT_STYLE } from "../lib/outcome.js";

const MOVE_LABEL = { HIT: "Hit", STAND: "Stand", DOUBLE: "Double", SPLIT: "Split" };

// The last few rounds an analysis account played, each move marked against the chart.
function RecentHands({ rounds }) {
  if (!rounds || rounds.length === 0) return null;
  return (
    <div className="hlo-panel" style={{ marginTop: 20 }}>
      <div className="hlo-panel__header">
        <h3 className="hlo-panel__title">Recent hands</h3>
      </div>
      <div className="hlo-panel__body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rounds.map((round) =>
          round.hands.map((hand, hi) => {
            const style = hand.result ? RESULT_STYLE[hand.result] : null;
            return (
              <div
                key={`${round.at}-${hi}`}
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 10px",
                  borderRadius: 8,
                  background: "rgba(255,255,255,0.03)",
                  fontSize: "0.8rem",
                }}
              >
                <span style={{ fontFamily: "var(--font-mono)", minWidth: 120 }}>
                  {hand.cards.join(" ")} = {hand.player}
                  {hand.isSplit ? ` · split hand ${hi + 1}` : ""}
                </span>
                <span style={{ display: "flex", gap: 6, flexWrap: "wrap", flex: 1 }}>
                  {hand.decisions.map((d, i) => (
                    <span
                      key={i}
                      className="hlo-pill"
                      title={
                        d.correct === null
                          ? "Not graded"
                          : d.correct
                          ? `Matches the ${d.basis === "count" ? "count play" : "chart"}`
                          : `The ${d.basis === "count" ? "count play" : "chart"} was ${MOVE_LABEL[d.expected]}`
                      }
                      style={{ color: d.correct === false ? "var(--red-bright)" : d.correct ? "var(--confidence-high)" : undefined }}
                    >
                      {d.correct === false ? "✗" : d.correct ? "✓" : "·"} {MOVE_LABEL[d.action]} on {d.cards.join(" ")} vs {d.dealerUp}
                      {d.correct === false ? ` (chart: ${MOVE_LABEL[d.expected]})` : ""}
                    </span>
                  ))}
                </span>
                {style && (
                  <b style={{ color: style.color, fontFamily: "var(--font-display)", fontSize: "1rem", letterSpacing: "0.04em" }}>
                    {style.label}
                  </b>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function ResetAnalysis() {
  const { resetAnalysis } = useAppState();
  const [confirming, setConfirming] = useState(false);
  return confirming ? (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", fontSize: "0.78rem", color: "var(--white-dim)" }}>
      Delete every hand recorded for this account in this browser?
      <button className="hlo-btn hlo-btn--primary" style={{ padding: "4px 12px", fontSize: "0.75rem" }} onClick={() => { resetAnalysis(); setConfirming(false); }}>
        Reset
      </button>
      <button className="hlo-btn hlo-btn--ghost" style={{ padding: "4px 12px", fontSize: "0.75rem" }} onClick={() => setConfirming(false)}>
        Cancel
      </button>
    </span>
  ) : (
    <button className="hlo-btn hlo-btn--ghost" style={{ padding: "4px 12px", fontSize: "0.75rem" }} onClick={() => setConfirming(true)}>
      Reset analysis
    </button>
  );
}

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
  const { analysis, isGuest, isSpectating, analysisAccount, isDemo } = useAppState();
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
      <p style={{ color: "var(--white-faint)", marginTop: 0, marginBottom: 20, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <span>
          {analysis.handsPlayed} hands recorded this account.
          {isSpectating && " You're spectating, so this is view only: only hands played from a seat change it."}
          {analysisAccount &&
            (isDemo
              ? " Hands are recorded from a seat while a camera is live (not from the sample table)."
              : " Every hand you play from your seat updates this report.")}
        </span>
        {analysisAccount && analysis.handsPlayed > 0 && <ResetAnalysis />}
      </p>

      {locked ? (
        <div className="hlo-panel" style={{ padding: 24 }}>
          <p style={{ margin: 0 }}>
            {analysis.handsPlayed < analysis.minHandsRequired
              ? `Play ${analysis.minHandsRequired - analysis.handsPlayed} more hand(s) to unlock your full report.`
              : "Your report is still being prepared. It needs a little more history."}
          </p>
          {analysisAccount && <RecentHands rounds={analysis.recent} />}
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
            {analysis.stats ? (
              <StatCard
                label="Results"
                value={`${analysis.stats.wins}W · ${analysis.stats.pushes}P · ${analysis.stats.losses}L`}
                sub={`Bust rate ${Math.round(analysis.stats.bustRate * 100)}% · ${analysis.stats.doubles} double${analysis.stats.doubles === 1 ? "" : "s"}`}
              />
            ) : (
              <StatCard label="Betting behavior" value="Flat / occasional 2x" sub={analysis.bettingBehavior} />
            )}
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
              <h3 className="hlo-panel__title">{analysis.trendTitle || "Win Rate by Day"}</h3>
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
          {analysisAccount && <RecentHands rounds={analysis.recent} />}
        </>
      )}
    </div>
  );
}
