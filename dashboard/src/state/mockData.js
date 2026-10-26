// What HighLo shows before a camera is connected: an EMPTY table. There is no
// pretend hand any more; cards, seats and the running count only ever come
// from the camera server. The only sample data left is the three demo
// accounts' analysis history below (until a real database exists).

export const SEAT_COUNT = 6;

export const emptyOccupancy = () =>
  Object.fromEntries(Array.from({ length: SEAT_COUNT }, (_, i) => [i + 1, false]));

export const emptyPlayers = () =>
  Array.from({ length: SEAT_COUNT }, (_, i) => ({
    seat: i + 1,
    occupied: false,
    hands: [{ cards: [], isBust: false, isSplit: false }],
    isTurn: false,
    confidence: "high",
    lastAction: null,
  }));

export const emptyDealer = () => ({ cards: [], holeCardKnown: false, confidence: "high" });

export const emptyShoeStats = () => ({ handsSinceShuffle: 0, lastShuffleHand: 0 });

export const defaultMidShoeJoin = { isMidShoeJoin: false, countReliability: 1 };

// Confidence numbers shown next to a recommendation (placeholder values until
// the server reports real ones).
export const defaultRecommendation = {
  action: "HIT", // HIT | STAND | DOUBLE | SPLIT | SURRENDER
  recommendationConfidence: 0.87,
  cardDetectionConfidence: 0.94,
  dealerBustProbability: 0.31,
};

// ---- Demo accounts ------------------------------------------------------
// Analysis history is tied to the ACCOUNT, whether or not the user is
// spectating. Three made-up accounts for now; a database replaces this later.
// Any other username starts with an empty history.
export const MIN_HANDS_REQUIRED = 5;

export const emptyAnalysis = () => ({
  handsPlayed: 0,
  minHandsRequired: MIN_HANDS_REQUIRED,
  playstyle: "",
  riskProfile: "",
  decisionAccuracy: 0,
  bettingBehavior: "",
  description: "",
  trend: [],
});

export const DEMO_ACCOUNTS = {
  alex: {
    handsPlayed: 37,
    minHandsRequired: MIN_HANDS_REQUIRED,
    playstyle: "Disciplined Basic-Strategy Follower",
    riskProfile: "Low-Moderate",
    decisionAccuracy: 0.91,
    bettingBehavior: "Flat betting, occasional 2x on true count > 2",
    description:
      "Across your last 37 recorded hands, you've followed basic strategy on the vast majority of hands, only deviating on a handful of soft-hand doubles against a dealer 6. Your bet sizing barely moves with the count, which keeps variance low but also caps your edge when the true count runs hot. Increasing your spread on true counts above +2 is the single change most likely to raise your win rate. You tend to stand a beat too early on hard 12s against a dealer 2 or 3; tightening that up should close most of the remaining gap to perfect play.",
    trend: [
      { date: "Sep 12", winRate: 0.41 },
      { date: "Sep 15", winRate: 0.44 },
      { date: "Sep 19", winRate: 0.47 },
      { date: "Sep 23", winRate: 0.46 },
      { date: "Sep 27", winRate: 0.5 },
    ],
  },
  jordan: {
    handsPlayed: 82,
    minHandsRequired: MIN_HANDS_REQUIRED,
    playstyle: "Aggressive Doubler",
    riskProfile: "High",
    decisionAccuracy: 0.78,
    bettingBehavior: "Large swings, doubles down on most 9s, 10s and 11s",
    description:
      "Across 82 recorded hands you double down more often than the chart does, especially on hard 9 against a dealer 7 or higher, which costs you roughly one decision in five. Your results swing widely from session to session. Playing the chart on those doubles would lower the variance without giving up much upside.",
    trend: [
      { date: "Oct 02", winRate: 0.55 },
      { date: "Oct 05", winRate: 0.38 },
      { date: "Oct 11", winRate: 0.49 },
      { date: "Oct 14", winRate: 0.33 },
      { date: "Oct 20", winRate: 0.52 },
    ],
  },
  sean: {
    handsPlayed: 3,
    minHandsRequired: MIN_HANDS_REQUIRED,
    playstyle: "",
    riskProfile: "",
    decisionAccuracy: 0,
    bettingBehavior: "",
    description: "",
    trend: [],
  },
};

export function analysisFor(username) {
  const key = (username || "").trim().toLowerCase();
  return DEMO_ACCOUNTS[key] ? { ...DEMO_ACCOUNTS[key] } : emptyAnalysis();
}
