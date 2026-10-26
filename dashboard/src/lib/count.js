import { parseCard } from "../components/Card.jsx";

export const TOTAL_DECKS = 6;
export const CARDS_PER_DECK = 52;

/** Standard Hi-Lo running-count value for a single card. */
export function hiLoValue(code) {
  const { rank } = parseCard(code);
  if (["2", "3", "4", "5", "6"].includes(rank)) return 1;
  if (["7", "8", "9"].includes(rank)) return 0;
  return -1; // 10, J, Q, K, A
}

/**
 * Computes the live running-count stats for the *current* shoe only: the
 * portion of `entries` after the most recent shuffle marker (or all of
 * them, if there hasn't been one yet this session).
 */
export function computeCountStats(entries, totalDecks = TOTAL_DECKS) {
  const lastShuffleIdx = entries.reduce(
    (acc, e, i) => (e.isShuffleMarker ? i : acc),
    -1
  );
  // A hidden (not-yet-revealed) dealer hole card is excluded from the
  // count too — a real counter can't see it yet either, so it shouldn't
  // move the running count until it's actually revealed. A card marked
  // "??" (an unresolved manual correction — "I can't tell what this is")
  // is excluded the same way, rather than counting as some arbitrary
  // value, until it's corrected to an actual rank.
  const current = entries
    .slice(lastShuffleIdx + 1)
    .filter((e) => !e.isShuffleMarker && !e.isHiddenCard && e.card !== "??");
  const runningCount = current.reduce((sum, e) => sum + e.value, 0);
  const cardsCounted = current.length;
  const totalCards = totalDecks * CARDS_PER_DECK;
  const cardsRemaining = Math.max(0, totalCards - cardsCounted);
  const decksRemaining = Math.max(0.5, cardsRemaining / CARDS_PER_DECK);
  const trueCount = runningCount / decksRemaining;
  return { runningCount, cardsCounted, cardsRemaining, decksRemaining, trueCount, totalCards };
}

/**
 * Standard insurance rule of thumb: with a 6-deck shoe, insurance is
 * roughly a break-even/favorable side bet once the true count reaches
 * about +3 (more tens/aces left in the shoe than a fresh deck would have).
 * Only meaningful when the dealer's up card is an Ace.
 */
export function insuranceAdvice(trueCount) {
  const takeInsurance = trueCount >= 3;
  return {
    takeInsurance,
    label: takeInsurance ? "Take insurance" : "Skip insurance",
    reason: takeInsurance
      ? `True count (${trueCount.toFixed(1)}) is high enough that extra tens are likely in the shoe.`
      : `True count (${trueCount.toFixed(1)}) isn't high enough to make insurance profitable.`,
  };
}
