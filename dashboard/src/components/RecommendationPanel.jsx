import React, { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAppState } from "../state/AppStateContext.jsx";
import { basicStrategyAction, buildStrategyRow, handTypeLabel, recommend } from "../lib/strategy.js";
import StrategyChartButton from "./StrategyChart.jsx";
import { insuranceAdvice } from "../lib/count.js";
import { parseCard } from "./Card.jsx";

const ACTION_COLOR = {
  HIT: "var(--red-bright)",
  STAND: "#3f7fd1",
  DOUBLE: "var(--confidence-high)",
  SPLIT: "#d1a13a",
  SURRENDER: "#161616",
};
const ACTION_TEXT_COLOR = {
  HIT: "var(--white)",
  STAND: "var(--white)",
  DOUBLE: "var(--white)",
  SPLIT: "var(--white)",
  SURRENDER: "var(--white)",
};

// Matches the tooltip's CSS width (index.css .hlo-info-icon__tooltip)
// and the minimum breathing room it keeps from the edge of the screen.
const TOOLTIP_WIDTH = 200;
const TOOLTIP_VIEWPORT_MARGIN = 8;

/**
 * InfoIcon
 * The tooltip renders through a portal into document.body, positioned by
 * the icon's actual on-screen coordinates (via getBoundingClientRect)
 * rather than CSS `position: absolute` anchored to the icon itself.
 * Metrics live inside this panel's scrollable body (`overflowY: auto`
 * when `fillHeight` is set), and an absolutely-positioned tooltip wide
 * enough to poke past a narrow grid column was getting counted as part
 * of that container's scrollable content — which silently turns on a
 * matching horizontal scrollbar too, per how CSS overflow-x/-y interact.
 * A portal sidesteps that entirely: the tooltip overlays on top of
 * whatever's beneath it instead of ever affecting any ancestor's size.
 *
 * The tooltip is normally centered under its icon (see the `translateX
 * (-50%)` in the CSS), but centering alone can still push it past the
 * left or right edge of the screen when the icon itself sits near an
 * edge — e.g. "Dealer bust probability" on desktop, or a tapped metric
 * on a narrow mobile screen. `show()` clamps the center point so the
 * full 200px-wide tooltip always stays within the viewport instead of
 * running off the side.
 */
function InfoIcon({ text }) {
  const [coords, setCoords] = useState(null);
  const iconRef = useRef(null);

  function show() {
    const rect = iconRef.current.getBoundingClientRect();
    const halfWidth = TOOLTIP_WIDTH / 2;
    const minCenter = halfWidth + TOOLTIP_VIEWPORT_MARGIN;
    const maxCenter = window.innerWidth - halfWidth - TOOLTIP_VIEWPORT_MARGIN;
    const center = Math.min(Math.max(rect.left + rect.width / 2, minCenter), maxCenter);
    setCoords({ top: rect.top, left: center });
  }
  function hide() {
    setCoords(null);
  }

  return (
    <span
      ref={iconRef}
      className="hlo-info-icon"
      tabIndex={0}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      i
      {coords &&
        createPortal(
          <div
            className="hlo-info-icon__tooltip hlo-info-icon__tooltip--portal"
            style={{ top: coords.top, left: coords.left }}
          >
            {text}
          </div>,
          document.body
        )}
    </span>
  );
}

function Metric({ label, value, info }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--white-faint)", fontSize: "0.7rem" }}>
        {label}
        <InfoIcon text={info} />
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "1.05rem" }}>{value}</div>
    </div>
  );
}

function ScopeToggle({ scope, setScope }) {
  return (
    <div className="hlo-toggle" role="radiogroup" aria-label="Recommendation visibility">
      <button
        type="button"
        role="radio"
        aria-checked={scope === "all"}
        className={`hlo-toggle__option ${scope === "all" ? "active" : ""}`}
        onClick={() => setScope("all")}
      >
        All turns
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={scope === "mine"}
        className={`hlo-toggle__option ${scope === "mine" ? "active" : ""}`}
        onClick={() => setScope("mine")}
      >
        My turn only
      </button>
    </div>
  );
}

function HandChartRow({ cards, dealerUpCode }) {
  const row = buildStrategyRow(cards, dealerUpCode);
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6 }}>
        <span style={{ fontSize: "0.72rem", fontWeight: 600, color: "var(--white-dim)" }}>
          Strategy chart — {handTypeLabel(cards)}
        </span>
        <InfoIcon text="The standard basic-strategy move for this hand against each possible dealer up card. Your dealer's actual up card is highlighted." />
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="hlo-strategy-table">
          <thead>
            <tr>
              {row.map((cell) => (
                <th key={cell.col}>{cell.col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {row.map((cell) => (
                <td
                  key={cell.col}
                  className={cell.active ? "active-cell" : ""}
                  // Surrender is black elsewhere; on the dark chart it would vanish, so draw it white.
                  style={{ color: cell.action === "SURRENDER" ? "var(--white)" : ACTION_COLOR[cell.action] }}
                >
                  {cell.action[0]}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * RecommendationPanel
 * `mobile`: renders the compact, mobile-focused variant — forced to "my
 *   turn only" (no scope toggle at all), a bigger fixed-width action box,
 *   and everything below the action box collapsed by default (tap to
 *   expand the full metrics/strategy-chart/analysis view).
 * `fillHeight`: (desktop) stretches the panel to 100% of its flex
 *   container and lets the body scroll internally, so it can be sized to
 *   match the live feed panel next to it.
 * `showAnalysis`: shows the "Your playstyle analysis" block at the
 *   bottom. Off by default on the Master View's copy of this panel, so
 *   it matches the live feed panel's height with no internal scroll —
 *   the full report still lives on the Analysis Report page.
 */
export default function RecommendationPanel({ mobile = false, fillHeight = false, showAnalysis = true }) {
  const {
    recommendation,
    midShoeJoin,
    analysis,
    isGuest,
    players,
    selectedSeat,
    dealer,
    recommendationScope,
    setRecommendationScope,
    countStats,
    isSpectating,
  } = useAppState();
  const [mobileExpanded, setMobileExpanded] = useState(false);

  const activeTurnPlayer = players.find((p) => p.isTurn);
  // Spectators have no seat of their own, so they always see every turn.
  const effectiveScope = isSpectating ? "all" : mobile ? "mine" : recommendationScope;
  const showForSelfOnly = effectiveScope === "mine";
  const displayedPlayer =
    activeTurnPlayer && (!showForSelfOnly || activeTurnPlayer.seat === selectedSeat) ? activeTurnPlayer : null;

  const activeHand = displayedPlayer ? displayedPlayer.hands[displayedPlayer.hands.length - 1] : null;
  const dealerUpCard = dealer.cards[0];

  // The move comes from the basic-strategy chart; with a trusted count it may
  // switch to a count-based play. After a mid-shoe join the count is missing
  // everything in the discard pile, so only the chart is used.
  const countReliable = !midShoeJoin.isMidShoeJoin;
  const rec = activeHand
    ? recommend(activeHand.cards, dealerUpCard, countStats.trueCount, countReliable)
    : null;
  const action = rec ? rec.action : recommendation.action;
  let adjustedConfidence = recommendation.recommendationConfidence;
  if (rec) {
    adjustedConfidence = rec.basis === "chart"
      ? Math.min(0.99, recommendation.recommendationConfidence + 0.08)
      : Math.max(0.4, recommendation.recommendationConfidence - 0.05);
  }

  // Overall confidence blends how sure the vision model is about the
  // cards it read with how strongly the (strategy-checked) move is
  // favored. Card detection carries real weight here: a shaky read
  // undermines everything downstream of it.
  const overallConfidence = activeHand
    ? recommendation.cardDetectionConfidence * 0.4 + adjustedConfidence * 0.6
    : null;
  const detectionIsLow = recommendation.cardDetectionConfidence < 0.7;

  const dealerUpIsAce = parseCard(dealerUpCard).rank === "A";
  const insurance = dealerUpIsAce ? insuranceAdvice(countStats.trueCount) : null;

  const panelStyle = fillHeight
    ? { height: "100%", display: "flex", flexDirection: "column" }
    : undefined;
  const bodyStyle = fillHeight ? { flex: 1, overflowY: "auto" } : undefined;

  return (
    <div className="hlo-panel" style={panelStyle}>
      <div className="hlo-panel__header">
        <h3 className="hlo-panel__title">Recommendation</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {midShoeJoin.isMidShoeJoin && !mobile && (
            <span className="hlo-pill" title="Tracking started after cards were already dealt this shoe">
              Mid-shoe join
            </span>
          )}
          {!mobile && !isSpectating && <ScopeToggle scope={recommendationScope} setScope={setRecommendationScope} />}
        </div>
      </div>
      <div className="hlo-panel__body" style={bodyStyle}>
        {midShoeJoin.isMidShoeJoin && (
          <div
            style={{
              marginBottom: 14,
              padding: "9px 11px",
              borderRadius: 8,
              background: "rgba(209,161,58,0.12)",
              border: "1px solid rgba(209,161,58,0.45)",
              fontSize: "0.74rem",
              lineHeight: 1.5,
              color: "var(--white-dim)",
            }}
          >
            <b style={{ color: "var(--white)" }}>Joined mid-shoe.</b> The camera started while cards were already in
            the discard pile, so the running count is unreliable until the next shuffle. Recommendations follow the
            basic-strategy chart instead of the count.
            <div style={{ marginTop: 6 }}>
              <StrategyChartButton label="Open the strategy chart" />
            </div>
          </div>
        )}
        {/* Table-wide, not tied to whose turn it is: an insurance
            call-out whenever the dealer's up card is an Ace. */}
        {insurance && (
          <div
            className="hlo-pill"
            style={{
              display: "inline-flex",
              marginBottom: 14,
              color: insurance.takeInsurance ? "var(--confidence-high)" : "var(--white-faint)",
              background: insurance.takeInsurance ? "rgba(63,157,92,0.15)" : undefined,
            }}
            title={insurance.reason}
          >
            Dealer shows Ace — {insurance.label}
          </div>
        )}

        {displayedPlayer ? (
          <>
            {!mobile && (
              <div style={{ fontSize: "0.72rem", color: "var(--white-faint)", marginBottom: 8 }}>
                Seat {displayedPlayer.seat}
                {displayedPlayer.seat === selectedSeat ? " (you)" : ""}'s turn
              </div>
            )}

            {/* Colored, high-contrast action box + overall confidence */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginBottom: mobile && !mobileExpanded ? 4 : 14,
                cursor: mobile ? "pointer" : "default",
              }}
              onClick={mobile ? () => setMobileExpanded((v) => !v) : undefined}
            >
              <div
                className={mobile ? "hlo-action-box--fixed" : ""}
                style={{
                  display: "inline-block",
                  background: ACTION_COLOR[action],
                  color: ACTION_TEXT_COLOR[action],
                  fontFamily: "var(--font-display)",
                  fontSize: mobile ? "2.1rem" : "2.4rem",
                  letterSpacing: "0.04em",
                  padding: mobile ? "12px 10px" : "10px 30px",
                  borderRadius: "var(--radius-md)",
                  boxShadow: "0 4px 14px rgba(0,0,0,0.35)",
                }}
              >
                {action}
              </div>
              {overallConfidence !== null && (
                <div style={{ textAlign: "left" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "flex-start",
                      gap: 4,
                      fontSize: "0.62rem",
                      color: "var(--white-faint)",
                    }}
                  >
                    Overall confidence
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: "1.6rem",
                      color: detectionIsLow ? "var(--confidence-low)" : "var(--white)",
                    }}
                  >
                    {Math.round(overallConfidence * 100)}%
                  </div>
                </div>
              )}
              {mobile && (
                <span style={{ marginLeft: "auto", fontSize: "0.68rem", color: "var(--white-faint)" }}>
                  {mobileExpanded ? "▲ tap to collapse" : "▼ tap for details"}
                </span>
              )}
            </div>

            {detectionIsLow && (
              <p style={{ fontSize: "0.72rem", color: "var(--confidence-low)", fontWeight: 600, marginTop: -6, marginBottom: 12 }}>
                ⚠ Card detection confidence is below 70% — this recommendation may be unreliable.
              </p>
            )}

            {(!mobile || mobileExpanded) && (
              <>
                {rec && rec.basis === "count" && (
                  <p style={{ fontSize: "0.72rem", color: "var(--confidence-medium)", marginBottom: 12 }}>{rec.note}</p>
                )}

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: mobile ? "1fr 1fr" : "repeat(auto-fit, minmax(120px, 1fr))",
                    gap: 14,
                  }}
                >
                  <Metric
                    label="Card detection confidence"
                    value={`${Math.round(recommendation.cardDetectionConfidence * 100)}%`}
                    info="How certain the vision model is that the cards it read for this hand are correct."
                  />
                  <Metric
                    label="Dealer bust probability"
                    value={`${Math.round(recommendation.dealerBustProbability * 100)}%`}
                    info="Estimated chance the dealer busts, based on their up card and the current count."
                  />
                  <Metric
                    label="Running count"
                    value={countStats.runningCount}
                    info="A continuous tally of card values that tracks the ratio of high cards to low cards remaining in the deck. A higher count favours the player."
                  />
                  <Metric
                    label="True count"
                    value={countStats.trueCount.toFixed(1)}
                    info="Running count divided by the estimated decks remaining — the number you use to determine how much you will bet"
                  />
                </div>

                {midShoeJoin.isMidShoeJoin && (
                  <p style={{ fontSize: "0.72rem", color: "var(--white-faint)", marginTop: 12 }}>
                    Running and true count above only include cards seen since tracking began — treat them as
                    unreliable until the next shuffle.
                  </p>
                )}

                <HandChartRow cards={activeHand.cards} dealerUpCode={dealerUpCard} />
              </>
            )}
          </>
        ) : (
          <p style={{ color: "var(--white-faint)", fontSize: "0.85rem" }}>
            {dealer.cards.length === 0
              ? "Waiting for the next round to start."
              : showForSelfOnly
              ? "Recommendation hidden until it's your turn."
              : "Waiting for the next turn to begin."}
          </p>
        )}

        {showAnalysis && !isGuest && (!mobile || mobileExpanded) && (
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>Your playstyle analysis</span>
              {analysis.handsPlayed < analysis.minHandsRequired && (
                <span className="hlo-pill">
                  {analysis.handsPlayed}/{analysis.minHandsRequired} hands
                </span>
              )}
            </div>
            {analysis.handsPlayed >= analysis.minHandsRequired && analysis.playstyle ? (
              <p style={{ fontSize: "0.78rem", color: "var(--white-dim)", marginTop: 6 }}>
                {analysis.playstyle} · {analysis.riskProfile} risk · {Math.round(analysis.decisionAccuracy * 100)}% decision accuracy
              </p>
            ) : (
              <p style={{ fontSize: "0.78rem", color: "var(--white-faint)", marginTop: 6 }}>
                {analysis.handsPlayed >= analysis.minHandsRequired
                  ? "Your report is still being prepared."
                  : `Play ${analysis.minHandsRequired - analysis.handsPlayed} more hand(s) to unlock your report.`}
              </p>
            )}
            {isSpectating && (
              <p style={{ fontSize: "0.72rem", color: "var(--white-faint)", marginTop: 6 }}>
                Spectating: view only. Hands you watch don't change your analysis.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
