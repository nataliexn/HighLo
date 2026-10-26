import React, { useState } from "react";
import { CardCluster, handValue } from "./Card.jsx";
import { useAppState } from "../state/AppStateContext.jsx";
import CardCorrectionModal from "./CardCorrectionModal.jsx";

const CONFIDENCE_LABEL = { high: "High", medium: "Medium", low: "Low" };

function PlayerSeat({ player, isSelf, compact, hideLabel, large }) {
  const { localCorrections, correctCard, roundOutcomes } = useAppState();
  const [editing, setEditing] = useState(null); // { handIndex, cardIndex, code }

  const confidence = player.confidence || "low";

  function resolvedCard(handIndex, cardIndex, code) {
    const key = `${player.seat}-${handIndex}-${cardIndex}`;
    return localCorrections[key] || code;
  }

  function applyCorrection(pick) {
    if (!editing) return;
    const { handIndex, cardIndex, code } = editing;
    if (pick === null) {
      correctCard(player.seat, handIndex, cardIndex, "??");
      return;
    }
    const current = resolvedCard(handIndex, cardIndex, code);
    const currentRank = current.slice(0, -1) === "10" ? "10" : current.slice(0, -1);
    const currentSuit = current.slice(-1);
    const next =
      pick.type === "rank" ? `${pick.value}${currentSuit}` : `${currentRank}${pick.value}`;
    correctCard(player.seat, handIndex, cardIndex, next);
  }

  const seatMinHeight = large ? 210 : compact ? 110 : 142;

  // Vacant = nobody was dealt in here. A seat that has a player but no cards
  // right now (between rounds) says so, instead of showing a total of 0.
  const noCards = player.hands.every((h) => h.cards.length === 0);
  if (!player.occupied || noCards) {
    return (
      <div
        className="hlo-panel"
        style={{
          opacity: player.occupied ? 0.6 : 0.35,
          padding: compact ? 10 : 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: seatMinHeight,
          height: "100%",
        }}
      >
        <span style={{ fontSize: "0.8rem", color: "var(--white-faint)" }}>
          Seat {player.seat} — {player.occupied ? "waiting for cards" : "vacant"}
        </span>
      </div>
    );
  }

  const mainHand = player.hands[0];
  const mainResolved = mainHand.cards.map((c, i) => resolvedCard(0, i, c));
  const mainTotal = handValue(mainResolved);
  const status = mainTotal > 21 ? "bust" : mainTotal === 21 ? "blackjack" : null;
  const outcome = roundOutcomes ? roundOutcomes[player.seat] : null;

  return (
    <div
      className="hlo-panel"
      style={{
        padding: compact ? 10 : 14,
        border: player.isTurn
          ? "1px solid var(--brass)"
          : isSelf
          ? "1px solid rgba(244,242,234,0.4)"
          : undefined,
        minHeight: seatMinHeight,
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* These overlays are deliberately siblings of the dimmed content
          wrapper below, not inside it — so a status like "BUST" always
          renders fully solid/opaque, even on a seat that's faded down
          because it's not currently someone's turn. */}
      {status === "bust" && (
        <div className="hlo-status-overlay hlo-status-overlay--bust">BUST</div>
      )}
      {status === "blackjack" && (
        <div className="hlo-status-overlay hlo-status-overlay--blackjack">21</div>
      )}
      {outcome && <div className={`hlo-round-overlay hlo-round-overlay--${outcome}`} />}

      <div
        style={{
          opacity: player.isTurn ? 1 : 0.55,
          transition: "opacity 0.2s ease",
          display: "flex",
          flexDirection: "column",
          flex: 1,
        }}
      >
        <div style={{ display: "flex", justifyContent: hideLabel ? "flex-end" : "space-between", alignItems: "center", marginBottom: 8 }}>
          {!hideLabel && (
            <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>
              Seat {player.seat}
              {isSelf ? " (you)" : ""}
            </span>
          )}
          <span
            className="hlo-pill"
            style={{ gap: 5 }}
            title={`Detection confidence: ${CONFIDENCE_LABEL[confidence]}`}
          >
            <span className={`hlo-confidence-dot hlo-confidence-dot--${confidence}`} />
            {CONFIDENCE_LABEL[confidence]}
          </span>
        </div>

        {/* Primary hand (hands[0]) renders full size. Any extra hand from a
            split renders smaller and to the LEFT of it, one row, so a
            two-hand seat reads as "small hand — main hand" left to right.
            Card entrance animation (see Card.jsx) makes a newly-appearing
            split hand ease in smoothly rather than popping in. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: large ? "center" : "flex-start",
            gap: large ? 20 : 14,
            flexWrap: "wrap",
            flex: 1,
          }}
        >
          {[...player.hands]
            .map((hand, hIdx) => ({ hand, hIdx }))
            .slice(1)
            .reverse()
            .map(({ hand, hIdx }) => {
              const resolvedCards = hand.cards.map((c, i) => resolvedCard(hIdx, i, c));
              return (
                <div key={hIdx} className="hlo-card--enter" style={{ opacity: 0.85 }}>
                  {hand.isSplit && (
                    <div style={{ fontSize: "0.62rem", color: "var(--white-faint)", marginBottom: 4 }}>
                      Split hand {hIdx + 1}
                    </div>
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <CardCluster
                      cards={resolvedCards}
                      size={large ? "lg" : "sm"}
                      onCardClick={(cardIndex, code) => setEditing({ handIndex: hIdx, cardIndex, code })}
                    />
                    <span style={{ fontFamily: "var(--font-display)", fontSize: large ? "1.3rem" : "1.05rem" }}>
                      {handValue(resolvedCards)}
                    </span>
                  </div>
                </div>
              );
            })}

          {player.hands.slice(0, 1).map((hand, hIdx) => {
            const resolvedCards = hand.cards.map((c, i) => resolvedCard(hIdx, i, c));
            return (
              <div key={hIdx}>
                {hand.isSplit && (
                  <div style={{ fontSize: "0.68rem", color: "var(--white-faint)", marginBottom: 4 }}>
                    Main hand
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <CardCluster
                    cards={resolvedCards}
                    size={large ? "xl" : compact ? "sm" : "md"}
                    onCardClick={(cardIndex, code) => setEditing({ handIndex: hIdx, cardIndex, code })}
                  />
                  <span
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: large ? "1.8rem" : compact ? "1.1rem" : "1.4rem",
                    }}
                  >
                    {handValue(resolvedCards)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {player.lastAction && !compact && (
          <div style={{ marginTop: 8, fontSize: "0.7rem", color: "var(--white-faint)" }}>
            Last action: {player.lastAction}
          </div>
        )}
      </div>

      {editing && <CardCorrectionModal onClose={() => setEditing(null)} onPick={applyCorrection} />}
    </div>
  );
}

/**
 * ActivePlayers
 * Single row of up to six seats, no wrapping, laid out right-to-left
 * (seat 1 on the right) to mirror how a real table deals: the dealer
 * works clockwise, which from a seated player's point of view moves
 * right to left. Every seat shares the same minimum height regardless
 * of hand size, so the row stays visually aligned.
 * `compact` tightens spacing/card size for mobile use generally.
 * `onlySeat` renders just that one seat (used for the mobile "current
 * hand" view). `hideLabel` drops the "Seat N (you)" text — used on that
 * same mobile view, where the "Your hand" heading above already makes
 * it redundant. `large` renders noticeably bigger cards for that view,
 * instead of the old CSS-transform scale hack.
 */
export default function ActivePlayers({ compact = false, onlySeat = null, hideLabel = false, large = false }) {
  const { players, selectedSeat } = useAppState();
  const visible = onlySeat
    ? players.filter((p) => p.seat === onlySeat)
    : [...players].sort((a, b) => b.seat - a.seat); // seat 6 first (left) ... seat 1 last (right)

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        flexWrap: "nowrap",
        gap: 10,
        overflowX: onlySeat ? "visible" : "auto",
        alignItems: "stretch",
      }}
    >
      {visible.map((p) => (
        <div key={p.seat} style={{ flex: compact ? "1 1 100%" : "1 1 0", minWidth: compact ? 0 : 138 }}>
          <PlayerSeat
            player={p}
            isSelf={p.seat === selectedSeat}
            compact={compact}
            hideLabel={hideLabel}
            large={large}
          />
        </div>
      ))}
    </div>
  );
}
