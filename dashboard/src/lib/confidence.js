// The numbers in the Recommendation panel, worked out from the hand itself
// instead of fixed placeholders.
//
//   card detection   the model's own score for the least certain card in play
//                    (the seat's hand and the dealer's up card), sent by the
//                    camera server
//   dealer bust      how often the dealer busts from this up card, nudged by
//                    the true count
//   recommendation   how clear the call is: a hand where the other moves are
//                    nearly as good, or where the count is close to flipping
//                    the play, scores lower
//   overall          40% card detection + 60% recommendation, as before

import { DEVIATIONS, dealerColLabel, handTotal, isPair, isSoft, recommend } from "./strategy.js";

// Dealer bust rate by up card: 6 decks, dealer stands on soft 17, after the
// dealer has checked for blackjack (so an Ace up means no blackjack).
// Standard published figures, rounded.
const BUST_BY_UP = { 2: 0.35, 3: 0.37, 4: 0.4, 5: 0.42, 6: 0.42, 7: 0.26, 8: 0.24, 9: 0.23, 10: 0.21, A: 0.17 };

/**
 * Chance the dealer busts, as a fraction. A higher true count means more tens
 * left, which busts a dealer starting from a small card more often. The count
 * effect is a rough estimate (about +0.8 points per +1 true count for 2-6).
 */
export function dealerBustProbability(dealerUp, trueCount = 0, countReliable = true) {
  if (!dealerUp || dealerUp === "??") return null;
  const col = dealerColLabel(dealerUp);
  const base = BUST_BY_UP[col];
  if (base === undefined) return null;
  const tc = countReliable ? Math.max(-6, Math.min(6, trueCount || 0)) : 0;
  const perPoint = ["2", "3", "4", "5", "6"].includes(col) ? 0.008 : 0.004;
  return Math.max(0.05, Math.min(0.6, base + tc * perPoint));
}

// Chart plays that are close calls even without a count index: the best and
// second-best moves are worth almost the same. [kind, total or pair rank, dealer columns]
const CLOSE_SPOTS = [
  ["hard", 16, ["7", "8"]],
  ["hard", 15, ["9"]],
  ["hard", 11, ["A"]],
  ["hard", 8, ["5", "6"]],
  ["soft", 18, ["2", "A"]],
  ["soft", 19, ["6"]],
  ["soft", 17, ["2"]],
  ["soft", 15, ["4"]],
  ["soft", 13, ["5"]],
  ["pair", "9", ["7", "A"]],
  ["pair", "7", ["8"]],
  ["pair", "4", ["5", "6"]],
  ["pair", "6", ["2", "7"]],
  ["pair", "2", ["2", "3"]],
  ["pair", "3", ["2", "3"]],
];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * How clear the recommended play is (0-1) and, for a close call, why.
 * { confidence, closeCall, note }
 */
export function recommendationConfidence(cards, dealerUp, trueCount = 0, countReliable = true) {
  if (!cards || cards.length < 2 || !dealerUp || dealerUp === "??") return { confidence: null, closeCall: false, note: null };
  const col = dealerColLabel(dealerUp);
  const total = handTotal(cards);
  const pair = isPair(cards);
  const soft = !pair && isSoft(cards);
  const rec = recommend(cards, dealerUp, trueCount, countReliable);

  // 1. A count-index play: the closer the true count is to the index, the closer the call.
  if (!pair && !soft) {
    const dev = DEVIATIONS.find(([, t, c]) => t === total && c === col);
    if (dev) {
      const [, , , , , index] = dev;
      if (!countReliable) {
        return {
          confidence: 0.7,
          closeCall: true,
          note: `Close call: this play changes with the count (at a true count of ${index}), and the count can't be trusted mid-shoe.`,
        };
      }
      const distance = Math.abs((trueCount || 0) - index);
      return {
        confidence: clamp(0.6 + 0.08 * distance, 0.6, 0.93),
        closeCall: distance < 2,
        note:
          distance < 2
            ? `Close call: the right play flips at a true count of ${index} (now ${(trueCount || 0).toFixed(1)}).`
            : null,
      };
    }
  }

  // 2. A chart play where the alternatives are worth almost the same.
  const kind = pair ? "pair" : soft ? "soft" : "hard";
  const key = pair ? (["J", "Q", "K"].includes(cards[0].slice(0, -1)) ? "10" : cards[0].slice(0, -1)) : total;
  if (CLOSE_SPOTS.some(([k, t, cols]) => k === kind && t === key && cols.includes(col))) {
    return { confidence: 0.75, closeCall: true, note: "Close call: the other moves are worth almost as much here." };
  }

  // 3. A clear chart play. Hands that can't bust, or that already stand, are the clearest.
  const obvious = (!soft && !pair && (total >= 17 || total <= 8)) || (soft && total >= 20) || rec.action === "SPLIT";
  return { confidence: obvious ? 0.98 : 0.94, closeCall: false, note: null };
}

/**
 * The model's confidence in the cards that matter for this decision: the
 * least certain of the player's hand and the dealer's up card. Falls back on
 * the high / medium / low label when no score was sent.
 */
export function detectionConfidence(player, dealer) {
  const fromLabel = { high: 0.9, medium: 0.7, low: 0.5 };
  const score = (x) => (x && typeof x.detection === "number" ? x.detection : x ? fromLabel[x.confidence] ?? null : null);
  const values = [score(player), dealer && dealer.cards && dealer.cards.length ? score(dealer) : null].filter(
    (v) => typeof v === "number"
  );
  return values.length ? Math.min(...values) : null;
}

export function overallConfidence(detection, recommendationConf) {
  if (recommendationConf == null) return null;
  return (detection ?? 0.9) * 0.4 + recommendationConf * 0.6;
}
