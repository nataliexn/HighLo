import React from "react";

// ---------------------------------------------------------------------
// Deck data (52 cards, no jokers)
// ---------------------------------------------------------------------
export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
export const SUITS = ["S", "H", "D", "C"]; // spades, hearts, diamonds, clubs

export const SUIT_SYMBOL = { S: "♠", H: "♥", D: "♦", C: "♣" };
export const SUIT_NAME = { S: "Spades", H: "Hearts", D: "Diamonds", C: "Clubs" };
export const RED_SUITS = ["H", "D"];

// Builds the full 52-card deck as codes like "AS", "10H", "KD".
export function buildDeck() {
  const deck = [];
  RANKS.forEach((rank) => {
    SUITS.forEach((suit) => {
      deck.push(`${rank}${suit}`);
    });
  });
  return deck;
}

// Parses a card code ("10H") into { rank, suit }.
export function parseCard(code) {
  if (!code) return { rank: "?", suit: "S" };
  const suit = code.slice(-1);
  const rank = code.slice(0, -1);
  return { rank, suit };
}

// Blackjack value of a single rank (Ace counted high here; hand totals
// should reduce Aces from 11 to 1 as needed — see handValue()).
export function rankValue(rank) {
  if (rank === "A") return 11;
  if (["K", "Q", "J", "10"].includes(rank)) return 10;
  return parseInt(rank, 10);
}

// Standard blackjack hand total with soft-ace reduction.
export function handValue(cardCodes) {
  let total = 0;
  let aces = 0;
  cardCodes.forEach((code) => {
    const { rank } = parseCard(code);
    total += rankValue(rank);
    if (rank === "A") aces += 1;
  });
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

const SIZE_STYLES = {
  sm: { width: 34, height: 48, fontSize: 12, pipSize: 14 },
  md: { width: 52, height: 74, fontSize: 16, pipSize: 20 },
  lg: { width: 74, height: 104, fontSize: 20, pipSize: 28 },
  // Extra-large — used for the mobile "Your hand" view, where the
  // player's own cards are the main thing on screen.
  xl: { width: 94, height: 132, fontSize: 25, pipSize: 36 },
};

// The simplified "count" card variant renders noticeably larger than a
// normal playing card (2x a standard "sm" card) so the rank/suit/badge
// have room to breathe in the Running Count component.
const COUNT_SIZE = { width: 68, height: 96, rankFontSize: 30, suitFontSize: 20, badgeFontSize: 15 };
export { COUNT_SIZE };

/** Shared "card back" face: grey diagonal weave + centered HL mark, used
 *  for both an unrevealed dealer hole card and a hidden count-history
 *  card. H and L are rendered at identical height/weight. */
function CardBack({ width, height, className = "", label = "Face-down card" }) {
  return (
    <div
      className={`hlo-card hlo-card--back ${className}`}
      style={{ width, height, fontSize: Math.round(width * 0.36) }}
      aria-label={label}
    >
      <span className="hlo-card__hl-mark">
        <span className="hlo-card__hl-h">H</span>
        <span className="hlo-card__hl-l">L</span>
      </span>
    </div>
  );
}

/**
 * Card
 * Renders a single playing card. Pass `code` (e.g. "AS", "10H").
 *
 * - `faceDown`: renders the grey "HL" card back (dealer hole card).
 * - `flagged`: marks a card the CV pipeline is unsure about (drives the
 *    manual-correction affordance upstream).
 * - `variant="count"`: the simplified, larger style used in the
 *    running-count history — a big centered rank + suit, with an
 *    optional count badge in the top-right corner, colored to match
 *    the suit.
 * - `hidden`: (variant="count" only) renders the same grey "HL" card
 *    back used when the player hides the count history to practice.
 * - `animate`: plays a short "dealt in" entrance animation on mount
 *    (defaults on; new cards animate in, existing ones don't re-trigger).
 */
export default function Card({
  code = "AS",
  size = "md",
  faceDown = false,
  flagged = false,
  onClick,
  className = "",
  variant = "standard",
  countValue,
  hidden = false,
  animate = true,
}) {
  const { rank, suit } = parseCard(code);
  const isRed = RED_SUITS.includes(suit);
  const dims = SIZE_STYLES[size] || SIZE_STYLES.md;
  const animClass = animate ? "hlo-card--enter" : "";

  if (variant === "count" && hidden) {
    return (
      <CardBack
        width={COUNT_SIZE.width}
        height={COUNT_SIZE.height}
        className={`${animClass} ${className}`}
        label="Hidden card"
      />
    );
  }

  if (faceDown) {
    return <CardBack width={dims.width} height={dims.height} className={`${animClass} ${className}`} />;
  }

  if (variant === "count") {
    return (
      <div
        className={`hlo-card hlo-card--count ${isRed ? "hlo-card--red" : "hlo-card--black"} ${animClass} ${className}`}
        style={{ width: COUNT_SIZE.width, height: COUNT_SIZE.height }}
        aria-label={`${rank} of ${SUIT_NAME[suit]}`}
      >
        {countValue !== undefined && (
          <span
            className="hlo-card__count-badge"
            style={{
              fontSize: COUNT_SIZE.badgeFontSize,
              color: isRed ? "var(--red-bright)" : "var(--charcoal)",
            }}
          >
            {countValue > 0 ? `+${countValue}` : countValue}
          </span>
        )}
        <span className="hlo-card__big-rank" style={{ fontSize: COUNT_SIZE.rankFontSize }}>
          {rank}
        </span>
        <span className="hlo-card__big-suit" style={{ fontSize: COUNT_SIZE.suitFontSize }}>
          {SUIT_SYMBOL[suit]}
        </span>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`hlo-card ${isRed ? "hlo-card--red" : "hlo-card--black"} ${
        flagged ? "hlo-card--flagged" : ""
      } ${animClass} ${className}`}
      style={{ width: dims.width, height: dims.height, fontSize: dims.fontSize }}
      onClick={onClick}
      aria-label={`${rank} of ${SUIT_NAME[suit]}`}
      title={onClick ? "Click to correct this card" : undefined}
    >
      <span className="hlo-card__corner hlo-card__corner--tl">
        <span className="hlo-card__rank">{rank}</span>
        <span className="hlo-card__suit" style={{ fontSize: dims.pipSize * 0.55 }}>
          {SUIT_SYMBOL[suit]}
        </span>
      </span>
      <span className="hlo-card__center" style={{ fontSize: dims.pipSize }}>
        {SUIT_SYMBOL[suit]}
      </span>
      <span className="hlo-card__corner hlo-card__corner--br">
        <span className="hlo-card__rank">{rank}</span>
        <span className="hlo-card__suit" style={{ fontSize: dims.pipSize * 0.55 }}>
          {SUIT_SYMBOL[suit]}
        </span>
      </span>
      {flagged && <span className="hlo-card__flag" title="Low confidence detection">?</span>}
    </button>
  );
}

/**
 * ShuffleMarkerCard
 * Marks where a shuffle happened in the Running Count history. Unlike a
 * card tile, this spans the FULL WIDTH of the row it's in (see
 * `.hlo-shuffle-break`'s `flex-basis: 100%` in index.css), forcing a hard
 * line break in the wrapping card row so it reads as an unmistakable
 * "new hand/shoe starts here" divider rather than just another small
 * icon sitting among the cards. Cards older than this (besides the one
 * hand kept for reference) are not retained.
 */
export function ShuffleMarkerCard() {
  return (
    <div
      className="hlo-shuffle-break"
      role="separator"
      aria-label="Shuffle occurred here"
      title="Shuffle detected — count reset; only the prior hand is kept for reference"
    >
      <span className="hlo-shuffle-break__line" />
      <span className="hlo-shuffle-break__label">Shuffled</span>
      <span className="hlo-shuffle-break__line" />
    </div>
  );
}

/**
 * HiddenCardMarker
 * Same tile shape/size as ShuffleMarkerCard, but marks the dealer's
 * not-yet-revealed hole card in the Running Count history — a real
 * counter can't see its value yet, so it's shown as a placeholder
 * rather than a counted card, and excluded from the running count until
 * it's actually revealed (see computeCountStats). "HIDDEN" is a working
 * label; happy to rename once there's a design direction for it.
 */
export function HiddenCardMarker({ size = COUNT_SIZE }) {
  return (
    <div
      className="hlo-card hlo-hidden-marker"
      style={{ width: size.width, height: size.height }}
      aria-label="Dealer hole card — not yet revealed"
      title="Dealer's hole card — unknown until revealed, so it isn't counted yet"
    >
      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.04em" }}>HIDDEN</span>
    </div>
  );
}

/** Small row of cards, used wherever a flat row (no shaped layout) works. */
export function CardRow({ cards = [], size = "md", onCardClick, flaggedIndexes = [] }) {
  return (
    <div className="hlo-card-row">
      {cards.map((code, i) => (
        <Card
          key={`${code}-${i}`}
          code={code}
          size={size}
          flagged={flaggedIndexes.includes(i)}
          onClick={onCardClick ? () => onCardClick(i, code) : undefined}
        />
      ))}
    </div>
  );
}

// How many cards sit in each row for a given hand size: 1-2 cards is a
// single row, 3 fans into a triangle (2 over 1), 4 into a square (2x2),
// 5 is 2-over-3, and 6 is 2-over-4.
function rowsForCount(n) {
  if (n <= 2) return [n];
  if (n === 3) return [2, 1];
  if (n === 4) return [2, 2];
  if (n === 5) return [2, 3];
  if (n === 6) return [2, 4];
  // Beyond 6 (shouldn't happen in blackjack): wrap everything evenly.
  const first = Math.ceil(n / 2);
  return [first, n - first];
}

/**
 * CardCluster
 * Shapes a hand's cards into a triangle/square/pyramid once it grows
 * beyond two cards (per the "3=triangle, 4=square, 5=2-over-3,
 * 6=2-over-4" layout). New cards animate in via Card's own entrance
 * transition; nothing here needs to re-animate existing ones.
 */
export function CardCluster({ cards = [], size = "md", onCardClick, flaggedIndexes = [] }) {
  const rows = rowsForCount(cards.length);
  let cursor = 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        alignItems: "center",
        transition: "all 0.25s ease",
      }}
    >
      {rows.map((rowCount, rowIdx) => {
        const rowCards = cards.slice(cursor, cursor + rowCount);
        const startIndex = cursor;
        cursor += rowCount;
        return (
          <div key={rowIdx} className="hlo-card-row" style={{ justifyContent: "center" }}>
            {rowCards.map((code, i) => {
              const flatIndex = startIndex + i;
              return (
                <Card
                  key={`${flatIndex}-${code}`}
                  code={code}
                  size={size}
                  flagged={flaggedIndexes.includes(flatIndex)}
                  onClick={onCardClick ? () => onCardClick(flatIndex, code) : undefined}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
