// Round results: once the dealer has finished drawing, how each hand did.
import { handValue } from "../components/Card.jsx";

const known = (cards) => cards.filter((c) => c && c !== "??");

/** The dealer stands on 17 or more (soft 17 included) or has bust. */
export function dealerFinished(dealer) {
  if (!dealer || !dealer.holeCardKnown) return false;
  const cards = known(dealer.cards);
  return cards.length >= 2 && handValue(cards) >= 17;
}

const isBlackjack = (cards, isSplit) => !isSplit && cards.length === 2 && handValue(cards) === 21;

/**
 * "win" | "blackjack" | "push" | "lose" | "bust" for one hand against the
 * dealer's final cards, plus both totals.
 */
export function handOutcome(cards, isSplit, dealerCards) {
  const player = handValue(known(cards));
  const dealerKnown = known(dealerCards);
  const dealer = handValue(dealerKnown);
  const playerBJ = isBlackjack(known(cards), isSplit);
  const dealerBJ = isBlackjack(dealerKnown, false);
  let result;
  if (player > 21) result = "bust";
  else if (playerBJ && dealerBJ) result = "push";
  else if (playerBJ) result = "blackjack";
  else if (dealerBJ) result = "lose";
  else if (dealer > 21 || player > dealer) result = "win";
  else if (player === dealer) result = "push";
  else result = "lose";
  return { result, player, dealer, dealerBust: dealer > 21 };
}

/**
 * One entry per hand that has cards, in play order (seat 1 -> 6, split hand
 * 1 before hand 2). A split hand gets its own entry.
 */
export function roundResults(players, dealer) {
  const out = [];
  [...players]
    .sort((a, b) => a.seat - b.seat)
    .forEach((p) => {
      p.hands.forEach((hand, handIndex) => {
        if (!hand.cards.length) return;
        out.push({
          seat: p.seat,
          handIndex,
          isSplit: Boolean(hand.isSplit) && p.hands.length > 1,
          isDoubled: Boolean(hand.isDoubled),
          cards: hand.cards,
          ...handOutcome(hand.cards, hand.isSplit && p.hands.length > 1, dealer.cards),
        });
      });
    });
  return out;
}

// Green for a win, blue for a push, red for a loss or bust.
export const RESULT_STYLE = {
  win: { label: "WIN", color: "var(--confidence-high)", tint: "rgba(63, 157, 92, 0.35)" },
  blackjack: { label: "BLACKJACK", color: "var(--confidence-high)", tint: "rgba(63, 157, 92, 0.35)" },
  push: { label: "PUSH", color: "#3f7fd1", tint: "rgba(63, 127, 209, 0.35)" },
  lose: { label: "LOSE", color: "var(--red-bright)", tint: "rgba(209, 57, 63, 0.35)" },
  bust: { label: "BUST", color: "var(--red-bright)", tint: "rgba(209, 57, 63, 0.35)" },
};
