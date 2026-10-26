import React, { useState } from "react";
import Card, { handValue } from "./Card.jsx";
import { useAppState } from "../state/AppStateContext.jsx";
import CardCorrectionModal from "./CardCorrectionModal.jsx";

const CONFIDENCE_LABEL = { high: "High", medium: "Medium", low: "Low" };

/**
 * Dealer
 * Shows the dealer's up card plus the hole card (face-down, grey
 * "HL"-branded, until the round resolves and holeCardKnown flips true).
 * Styled like a player seat — confidence badge, correction support — but
 * fully saturated and without the brass "your turn" border, since the
 * dealer is never "in turn" the way a player is. The "DEALER" label sits
 * on its own centered line, with the confidence pill centered beneath it.
 */
export default function Dealer({ compact = false }) {
  const { dealer, localCorrections, correctCard } = useAppState();
  const [editing, setEditing] = useState(null); // { cardIndex, code }
  const confidence = dealer.confidence || "high";

  function resolvedCard(cardIndex, code) {
    const key = `dealer-0-${cardIndex}`;
    return localCorrections[key] || code;
  }

  function applyCorrection(pick) {
    if (!editing) return;
    const { cardIndex, code } = editing;
    if (pick === null) {
      correctCard("dealer", 0, cardIndex, "??");
      return;
    }
    const current = resolvedCard(cardIndex, code);
    const currentRank = current.slice(0, -1) === "10" ? "10" : current.slice(0, -1);
    const currentSuit = current.slice(-1);
    const next = pick.type === "rank" ? `${pick.value}${currentSuit}` : `${currentRank}${pick.value}`;
    correctCard("dealer", 0, cardIndex, next);
  }

  const [rawUp, rawHole] = dealer.cards;
  const noCards = dealer.cards.length === 0;
  const upCard = resolvedCard(0, rawUp);
  const holeCard = resolvedCard(1, rawHole);
  const visibleTotal = noCards ? 0 : dealer.holeCardKnown ? handValue([upCard, holeCard]) : handValue([upCard]);

  return (
    <div
      className="hlo-panel hlo-dealer-panel"
      style={{
        padding: compact ? 10 : 14,
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
      }}
    >
      <span style={{ fontSize: "0.7rem", letterSpacing: "0.12em", color: "var(--white)", fontWeight: 700 }}>
        DEALER
      </span>

      <span
        className="hlo-pill"
        style={{ gap: 5 }}
        title={`Detection confidence: ${CONFIDENCE_LABEL[confidence]}`}
      >
        <span className={`hlo-confidence-dot hlo-confidence-dot--${confidence}`} />
        {CONFIDENCE_LABEL[confidence]}
      </span>

      {noCards ? (
        <span style={{ fontSize: "0.8rem", color: "var(--white-faint)", padding: "20px 12px" }}>
          Waiting for the next round
        </span>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* The face-down card sits on the LEFT, the up card on the right,
              the way the dealer lays them out at a real table. */}
          <div className="hlo-card-row">
            <Card
              code={holeCard}
              size={compact ? "sm" : "md"}
              faceDown={!dealer.holeCardKnown}
              onClick={dealer.holeCardKnown ? () => setEditing({ cardIndex: 1, code: rawHole }) : undefined}
            />
            <Card
              code={upCard}
              size={compact ? "sm" : "md"}
              onClick={() => setEditing({ cardIndex: 0, code: rawUp })}
            />
          </div>
          <span style={{ fontFamily: "var(--font-display)", fontSize: compact ? "1.2rem" : "1.5rem" }}>
            {visibleTotal}
            {!dealer.holeCardKnown && (
              <span style={{ fontSize: "0.6rem", color: "var(--white-faint)", fontFamily: "var(--font-body)", marginLeft: 4 }}>
                showing
              </span>
            )}
          </span>
        </div>
      )}

      {editing && <CardCorrectionModal onClose={() => setEditing(null)} onPick={applyCorrection} />}
    </div>
  );
}
