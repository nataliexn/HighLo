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
    hands: [{ cards: [], isBust: false, isSplit: false, isDoubled: false }],
    isTurn: false,
    confidence: "high",
    lastAction: null,
  }));

export const emptyDealer = () => ({ cards: [], holeCardKnown: false, confidence: "high" });

export const emptyShoeStats = () => ({ handsSinceShuffle: 0, lastShuffleHand: 0 });

export const defaultMidShoeJoin = { isMidShoeJoin: false, countReliability: 1 };

// The move shown before any hand is in play. The confidence numbers next to a
// recommendation are worked out per hand in lib/confidence.js.
export const defaultRecommendation = {
  action: "HIT", // HIT | STAND | DOUBLE | SPLIT | SURRENDER
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

// ---- Sample table -------------------------------------------------------
// Shown only while no camera is live, so someone visiting the site (or the
// app between sessions) sees every part of the dashboard working instead of
// empty seats. A banner says it is sample data (see DemoBanner). It is never
// recorded into anyone's analysis.
export function demoTable() {
  const hand = (cards, extra = {}) => ({ cards, isBust: false, isSplit: false, isDoubled: false, isTurn: false, ...extra });
  const players = [
    // seat 1 doubled on 11 (the sideways card) and got a 9
    { seat: 1, occupied: true, hands: [hand(["6D", "5S", "9H"], { isDoubled: true })], isTurn: false, confidence: "high", detection: 0.93, lastAction: "Double" },
    // seat 2 split 8s: hand 1 drew to 21, hand 2 stands on 17
    {
      seat: 2,
      occupied: true,
      hands: [hand(["8H", "3C", "10D"], { isSplit: true }), hand(["8S", "9C"], { isSplit: true })],
      isTurn: false,
      confidence: "medium",
      detection: 0.71,
      lastAction: "Split",
    },
    // seat 3 is up: 11 against a dealer 6
    { seat: 3, occupied: true, hands: [hand(["5C", "6S"], { isTurn: true })], isTurn: true, confidence: "high", detection: 0.91, lastAction: null },
    { seat: 4, occupied: false, hands: [hand([])], isTurn: false, confidence: "high", lastAction: null },
    { seat: 5, occupied: true, hands: [hand(["AH", "7C"])], isTurn: false, confidence: "high", detection: 0.88, lastAction: null },
    { seat: 6, occupied: false, hands: [hand([])], isTurn: false, confidence: "high", lastAction: null },
  ];
  const dealer = { cards: ["6H", "??"], holeCardKnown: false, confidence: "high", detection: 0.96 };

  // two earlier hands this shoe, then the one on the table
  const history = [];
  const add = (handNo, seat, handIndex, cardIndex, card) =>
    history.push({
      card,
      value: ["2", "3", "4", "5", "6"].includes(card.slice(0, -1)) ? 1 : ["7", "8", "9"].includes(card.slice(0, -1)) ? 0 : -1,
      hand: handNo,
      handStart: !history.some((e) => e.hand === handNo),
      seat,
      handIndex,
      cardIndex,
    });
  [
    [1, "dealer", ["9S", "KD"]], [1, 2, ["4H", "QS", "7D"]], [1, 3, ["10C", "8C"]],
    [2, "dealer", ["5D", "2H", "JC"]], [2, 1, ["AS", "KH"]], [2, 3, ["3D", "4S", "9D"]], [2, 5, ["6C", "2C", "QH"]],
  ].forEach(([h, seat, cards]) => cards.forEach((c, i) => add(h, seat, 0, i, c)));
  add(3, "dealer", 0, 0, "6H");
  players.forEach((p) => p.hands.forEach((hd, hi) => hd.cards.forEach((c, ci) => add(3, p.seat, hi, ci, c))));

  return {
    occupancy: Object.fromEntries(players.map((p) => [p.seat, p.occupied])),
    players,
    dealer,
    countHistory: history,
    shoeStats: { handsSinceShuffle: 3, lastShuffleHand: 0 },
  };
}
