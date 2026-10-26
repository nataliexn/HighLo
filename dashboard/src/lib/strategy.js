import { parseCard, rankValue } from "../components/Card.jsx";

export const DEALER_COLUMNS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "A"];

function dealerColLabel(code) {
  const { rank } = parseCard(code);
  if (rank === "A") return "A";
  if (["K", "Q", "J"].includes(rank)) return "10";
  return rank;
}

function isPair(cards) {
  if (cards.length !== 2) return false;
  const [a, b] = cards.map((c) => parseCard(c).rank);
  const norm = (r) => (["K", "Q", "J"].includes(r) ? "10" : r);
  return norm(a) === norm(b);
}

function isSoft(cards) {
  // Soft = contains an Ace that can still count as 11 without busting.
  const ranks = cards.map((c) => parseCard(c).rank);
  if (!ranks.includes("A")) return false;
  let total = cards.reduce((sum, c) => sum + rankValue(parseCard(c).rank), 0);
  let aces = ranks.filter((r) => r === "A").length;
  while (total > 21 && aces > 1) {
    total -= 10;
    aces -= 1;
  }
  return total <= 21;
}

function handTotal(cards) {
  let total = 0;
  let aces = 0;
  cards.forEach((c) => {
    const { rank } = parseCard(c);
    total += rankValue(rank);
    if (rank === "A") aces += 1;
  });
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

const inRange = (col, list) => list.includes(col);
const LOW = ["2", "3", "4", "5", "6"];
const MID6 = ["2", "3", "4", "5", "6", "7"];

/**
 * Looks up the standard basic-strategy move for a two(+)-card hand against
 * a dealer up card. Returns one of HIT / STAND / DOUBLE / SPLIT / SURRENDER.
 * This intentionally covers the common, well-known chart rather than every
 * casino-specific rule variant (e.g. DAS, resplit limits).
 */
export function basicStrategyAction(cards, dealerUpCode) {
  const col = dealerColLabel(dealerUpCode);

  if (isPair(cards)) {
    const rank = parseCard(cards[0]).rank;
    const norm = ["K", "Q", "J"].includes(rank) ? "10" : rank;
    if (norm === "A" || norm === "8") return "SPLIT";
    if (norm === "10") return "STAND";
    if (norm === "9") return inRange(col, ["7", "10", "A"]) ? "STAND" : "SPLIT";
    if (norm === "7") return inRange(col, MID6) ? "SPLIT" : "HIT";
    if (norm === "6") return inRange(col, LOW) ? "SPLIT" : "HIT";
    if (norm === "5") return inRange(col, ["2", "3", "4", "5", "6", "7", "8", "9"]) ? "DOUBLE" : "HIT";
    if (norm === "4") return inRange(col, ["5", "6"]) ? "SPLIT" : "HIT";
    if (norm === "2" || norm === "3") return inRange(col, MID6) ? "SPLIT" : "HIT";
  }

  const total = handTotal(cards);

  if (isSoft(cards)) {
    if (total >= 19) return "STAND";
    if (total === 18) {
      if (inRange(col, ["9", "10", "A"])) return "HIT";
      if (inRange(col, ["3", "4", "5", "6"])) return "DOUBLE";
      return "STAND";
    }
    if (total === 17) return inRange(col, ["3", "4", "5", "6"]) ? "DOUBLE" : "HIT";
    if (total === 16 || total === 15) return inRange(col, ["4", "5", "6"]) ? "DOUBLE" : "HIT";
    if (total === 14 || total === 13) return inRange(col, ["5", "6"]) ? "DOUBLE" : "HIT";
    return "HIT";
  }

  // Hard totals
  if (total >= 17) return "STAND";
  if (total === 16 || total === 15) {
    if (inRange(col, ["9", "10", "A"])) return "SURRENDER";
    return inRange(col, LOW) ? "STAND" : "HIT";
  }
  if (total === 14 || total === 13) return inRange(col, LOW) ? "STAND" : "HIT";
  if (total === 12) return inRange(col, ["4", "5", "6"]) ? "STAND" : "HIT";
  if (total === 11) return "DOUBLE";
  if (total === 10) return inRange(col, ["2", "3", "4", "5", "6", "7", "8", "9"]) ? "DOUBLE" : "HIT";
  if (total === 9) return inRange(col, ["3", "4", "5", "6"]) ? "DOUBLE" : "HIT";
  return "HIT";
}

/**
 * Builds the small reference chart shown in the Recommendation component:
 * one row of actions across dealer up cards 2-A for the *current* hand
 * type (pair / soft / hard), with the active dealer column flagged so the
 * UI can highlight it.
 */
export function buildStrategyRow(cards, dealerUpCode) {
  const activeCol = dealerColLabel(dealerUpCode);
  return DEALER_COLUMNS.map((col) => ({
    col,
    action: basicStrategyAction(cards, syntheticDealerCode(col)),
    active: col === activeCol,
  }));
}

// Builds a throwaway card code for a given dealer column label so we can
// reuse basicStrategyAction's dealer-column parsing for every chart cell.
function syntheticDealerCode(col) {
  if (col === "A") return "AS";
  if (col === "10") return "10S";
  return `${col}S`;
}

export function handTypeLabel(cards) {
  if (isPair(cards)) return `Pair of ${parseCard(cards[0]).rank}s`;
  if (isSoft(cards)) return `Soft ${handTotal(cards)}`;
  return `Hard ${handTotal(cards)}`;
}

// ---------------------------------------------------------------------------
// Full basic-strategy chart (for the "Strategy chart" screen)
// ---------------------------------------------------------------------------

const HARD_ROWS = [
  [5, ["2S", "3H"]], [6, ["2S", "4H"]], [7, ["2S", "5H"]], [8, ["3S", "5H"]],
  [9, ["4S", "5H"]], [10, ["4S", "6H"]], [11, ["5S", "6H"]], [12, ["10S", "2H"]],
  [13, ["10S", "3H"]], [14, ["10S", "4H"]], [15, ["10S", "5H"]], [16, ["10S", "6H"]],
  [17, ["10S", "7H"]],
];

function rowFor(label, cards) {
  return {
    label,
    cells: DEALER_COLUMNS.map((col) => ({ col, action: basicStrategyAction(cards, syntheticDealerCode(col)) })),
  };
}

/** Every hand type against every dealer up card, straight from basicStrategyAction. */
export function fullStrategyChart() {
  return [
    { title: "Hard totals", rows: HARD_ROWS.map(([t, cards]) => rowFor(String(t), cards)) },
    {
      title: "Soft totals (hand with an Ace counted as 11)",
      rows: ["2", "3", "4", "5", "6", "7", "8", "9"].map((r) => rowFor(`A,${r}`, ["AS", `${r}H`])),
    },
    {
      title: "Pairs",
      rows: ["2", "3", "4", "5", "6", "7", "8", "9", "10", "A"].map((r) => rowFor(`${r},${r}`, [`${r}S`, `${r}H`])),
    },
  ];
}

// ---------------------------------------------------------------------------
// Recommendation = the chart, plus count-based deviations when the count is trusted
// ---------------------------------------------------------------------------

// A subset of the well-known "Illustrious 18" index plays (6 decks, dealer
// stands on 17). [hand-kind, total, dealer column, action, direction, index]:
// "gte" = play `action` when true count >= index, "lt" = when true count < index.
const DEVIATIONS = [
  ["hard", 16, "10", "STAND", "gte", 0],
  ["hard", 15, "10", "STAND", "gte", 4],
  ["hard", 16, "9", "STAND", "gte", 5],
  ["hard", 13, "2", "HIT", "lt", -1],
  ["hard", 13, "3", "HIT", "lt", -2],
  ["hard", 12, "2", "STAND", "gte", 3],
  ["hard", 12, "3", "STAND", "gte", 2],
  ["hard", 12, "4", "HIT", "lt", 0],
  ["hard", 12, "5", "HIT", "lt", -2],
  ["hard", 12, "6", "HIT", "lt", -1],
  ["hard", 10, "10", "DOUBLE", "gte", 4],
  ["hard", 10, "A", "DOUBLE", "gte", 4],
  ["hard", 9, "2", "DOUBLE", "gte", 1],
  ["hard", 9, "7", "DOUBLE", "gte", 3],
];

/**
 * @param cards        the player's cards
 * @param dealerUp     the dealer's up card
 * @param trueCount    current true count
 * @param countReliable false right after joining a shoe mid-way (the count is
 *                      missing everything already in the discard pile)
 * @returns { action, chartAction, basis: "chart" | "count", note }
 */
export function recommend(cards, dealerUp, trueCount, countReliable) {
  const chartAction = basicStrategyAction(cards, dealerUp);
  if (!countReliable) {
    return { action: chartAction, chartAction, basis: "chart", note: null };
  }
  const col = dealerColLabel(dealerUp);
  if (!isPair(cards) && !isSoft(cards)) {
    const total = handTotal(cards);
    for (const [, t, c, action, dir, idx] of DEVIATIONS) {
      if (t !== total || c !== col) continue;
      const hit = dir === "gte" ? trueCount >= idx : trueCount < idx;
      if (hit && action !== chartAction) {
        return {
          action,
          chartAction,
          basis: "count",
          note: `True count ${trueCount.toFixed(1)} ${dir === "gte" ? "≥" : "<"} ${idx}: ${action} instead of the chart's ${chartAction}.`,
        };
      }
    }
  }
  return { action: chartAction, chartAction, basis: "chart", note: null };
}
