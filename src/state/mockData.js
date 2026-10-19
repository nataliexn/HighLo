// Default, non-empty snapshot of "what the camera would be seeing" right
// now. Everything here is a plausible in-progress hand so the dashboard
// reads as live rather than blank. Replace with real detection payloads
// once a phone camera is paired through the camera server (see README).
import { hiLoValue } from "../lib/count.js";

export const SEAT_COUNT = 6;

// Occupancy as the camera would report it: true = seat detected occupied.
export const defaultOccupancy = {
  1: true,
  2: true,
  3: true,
  4: false, // vacant seat
  5: true, // the demo user's seat (active turn)
  6: true,
};

// Seats are dealt in order 1 -> 6, so only seat 5 (the active turn) and
// everything before it may have already acted / drawn extra cards. Seat 4
// is vacant (skipped), and seat 6 hasn't been acted on yet, so it only
// shows its original two cards.
export const defaultPlayers = [
  {
    seat: 1,
    occupied: true,
    // 5 cards -> demonstrates the "2 over 3" shaped hand layout. Already
    // acted (stood), since seat 5 is the active turn.
    hands: [{ cards: ["5D", "6C", "4H", "2S", "3D"], isBust: false, isSplit: false }],
    isTurn: false,
    confidence: "high", // high | medium | low
    lastAction: "STAND",
  },
  {
    seat: 2,
    occupied: true,
    // A split pair of face cards (J/K — both 10-value, the realistic case
    // where a player is tempted to split tens): the second hand renders
    // smaller, to the left of the main hand, and also demonstrates the
    // 4-card "square" shape.
    hands: [
      { cards: ["JD", "3C", "2S", "2D"], isBust: false, isSplit: true },
      { cards: ["KS", "6D"], isBust: false, isSplit: true },
    ],
    isTurn: false,
    confidence: "medium",
    lastAction: "STAND",
  },
  {
    seat: 3,
    occupied: true,
    // Busted (24) — the one bust example in the mock UI.
    hands: [{ cards: ["10D", "6C", "8H"], isBust: true, isSplit: false }],
    isTurn: false,
    confidence: "high",
    lastAction: "HIT",
  },
  {
    seat: 4,
    occupied: false,
    hands: [],
    isTurn: false,
    confidence: "low",
    lastAction: null,
  },
  {
    seat: 5,
    occupied: true,
    // The active turn (and, in the seat-selection demo, "you").
    hands: [{ cards: ["8D", "5H"], isBust: false, isSplit: false }],
    isTurn: true,
    confidence: "high",
    lastAction: null,
  },
  {
    seat: 6,
    occupied: true,
    // Soft 18 (A + 7) — hasn't acted yet, so just its original two cards.
    hands: [{ cards: ["AS", "7D"], isBust: false, isSplit: false }],
    isTurn: false,
    confidence: "high",
    lastAction: null,
  },
];

// First card is the dealer's face-up card; second is the hole card, shown
// face-down until holeCardKnown flips true (round resolution). Like a
// player seat, the dealer also gets a detection-confidence reading and
// can have its cards corrected.
export const defaultDealer = {
  cards: ["7D", "KH"],
  holeCardKnown: false,
  confidence: "high",
};

export const defaultRecommendation = {
  action: "HIT", // HIT | STAND | DOUBLE | SPLIT | SURRENDER
  recommendationConfidence: 0.87,
  cardDetectionConfidence: 0.94,
  dealerBustProbability: 0.31,
};

// Seats actually in the game, in dealing order (ascending seat number —
// seat 4 is vacant and skipped, same as everywhere else).
const occupiedSeatsInOrder = defaultPlayers.filter((p) => p.occupied);

// --- Hand numbering --------------------------------------------------
// Every Running Count entry carries a `hand` number, and the first card of
// each hand carries `handStart: true`. The UI (see CountHistory.jsx) uses
// these to group cards by hand and mark where a new hand begins. Hand 0 is
// the last hand played BEFORE the most recent shuffle, kept for reference
// above the shuffle marker (it isn't part of the count). Hands
// 1..PREVIOUS_HANDS.length are the hands already played since that
// shuffle; CURRENT_HAND_NUMBER is the hand in progress right now.
//
// All of these hands are FIXED mock data — the same every load and for
// every user — not generated at runtime. Each one was simulated once from
// a 6-deck shoe (dealer + 4-5 players, everyone dealt at least two cards,
// players hitting per basic strategy, dealer standing on 17) and pasted
// in below, so it reads like real blackjack. They were picked so the
// running count since the shuffle, including the current hand's visible
// cards, comes out to +3. Cards are
// listed in the order they were dealt: dealer up card, each player's
// first card, dealer hole card, each player's second card, then every
// hit in turn (players first, dealer last).
const PRE_SHUFFLE_HAND =
["10S", "5H", "KD", "3H", "8S", "QH", "6C", "10D", "JD", "KS", "QC", "9H"];

const PREVIOUS_HANDS = [
  ["3H", "QD", "JD", "QD", "9S", "JC", "KH", "5H", "8H", "4D", "8S"],
  ["3S", "KH", "10D", "8D", "4C", "2H", "5C", "KH", "8S", "3D", "AD", "10S", "3S", "5H", "7D", "QD"],
  ["8S", "7H", "3H", "2C", "AH", "7S", "10S", "2C", "8S", "JS", "AC", "3C", "KD", "5C", "7D", "AS", "3D", "KC", "9C", "7H"],
  ["10H", "AC", "2S", "7C", "AS", "9H", "5S", "6H", "7D", "QS", "4H", "9D", "6H"],
  ["KH", "2H", "7H", "QH", "10S", "JS", "5S", "8D", "10C", "7C", "JC", "4S", "2D", "4H", "KC", "KH", "AD", "AS"],
  ["AC", "2H", "2H", "6D", "8H", "KD", "JC", "5S", "QD", "3D", "10H", "2D", "4D", "AC", "6S", "3H", "10H", "8C", "8H"],
  ["7H", "3D", "2H", "6S", "9H", "3C", "KH", "JH", "AD", "10H", "AD", "6H", "3D", "JD", "2S", "JS"],
];
export const CURRENT_HAND_NUMBER = PREVIOUS_HANDS.length + 1;

// Breaks a seat's hand(s) into "first card dealt", "second card dealt",
// and "everything dealt during this seat's own turn" — the three slots
// buildCurrentHandEntries() below deals out across all seats in turn.
// For a SPLIT seat specifically, the original two-card deal was a pair
// (both cards into hands[0] before the split), and splitting moves that
// second card onto the new hands[1] as ITS first card — so the "second
// card dealt" for a split seat is hands[1].cards[0], not hands[0].cards[1].
// Everything else is cards added afterward, during the turn: the rest of
// hands[0] first (hits on the original hand after splitting), then the
// rest of hands[1] (hits on the split-off hand, dealt after), matching
// how a split is actually played — finish hand one, then hand two.
// Each returned card carries its (handIndex, cardIndex) address — the
// same addressing `correctCard(seat, handIndex, cardIndex, …)` uses — so
// a later manual correction can find and update the matching history
// entry (see buildCurrentHandEntries and AppStateContext.correctCard).
function splitHandParts(player) {
  if (player.hands.length > 1) {
    const firstCard = { code: player.hands[0].cards[0], handIndex: 0, cardIndex: 0 };
    const secondCard = { code: player.hands[1].cards[0], handIndex: 1, cardIndex: 0 };
    const turnCards = [
      ...player.hands[0].cards.slice(1).map((code, i) => ({ code, handIndex: 0, cardIndex: i + 1 })),
      ...player.hands[1].cards.slice(1).map((code, i) => ({ code, handIndex: 1, cardIndex: i + 1 })),
    ];
    return { firstCard, secondCard, turnCards };
  }
  const cards = player.hands[0].cards;
  const firstCard = { code: cards[0], handIndex: 0, cardIndex: 0 };
  const secondCard = { code: cards[1], handIndex: 0, cardIndex: 1 };
  const turnCards = cards.slice(2).map((code, i) => ({ code, handIndex: 0, cardIndex: i + 2 }));
  return { firstCard, secondCard, turnCards };
}

// The current hand's history entries, in the order the cards were
// *actually dealt*, not just flattened by seat:
//   1. Dealer's face-up card
//   2. Each seat's FIRST card, in seat order
//   3. Dealer's hole card — recorded as a "hidden" marker, since a real
//      counter can't see its value until it's revealed
//   4. Each seat's SECOND card, in seat order
//   5. Everything dealt afterward during each seat's own turn — for a
//      split seat, hits on the first hand THEN hits on the second hand,
//      then it moves on to the next seat's turn
// This is what the static Running Count history is built from below, so
// it reads as a real deal sequence rather than cards grouped by seat.
// Every entry is tagged with `seat`/`handIndex`/`cardIndex` (dealer's
// seat is the string "dealer", matching how Dealer.jsx calls
// correctCard) so a manual card correction can find its matching
// history entry and update the running count to reflect it.
function buildCurrentHandEntries() {
  const entries = [];
  const addCard = (seat, { code, handIndex, cardIndex }, handStart = false) =>
    entries.push({
      card: code,
      value: hiLoValue(code),
      seat,
      handIndex,
      cardIndex,
      hand: CURRENT_HAND_NUMBER,
      handStart,
    });

  // handStart only on the very first card of the hand (the dealer's
  // face-up card) — that's the one boundary that marks "a new hand
  // begins" for the current hand.
  addCard("dealer", { code: defaultDealer.cards[0], handIndex: 0, cardIndex: 0 }, true);
  occupiedSeatsInOrder.forEach((p) => addCard(p.seat, splitHandParts(p).firstCard));
  entries.push({
    isHiddenCard: true,
    card: defaultDealer.cards[1],
    seat: "dealer",
    handIndex: 0,
    cardIndex: 1,
    hand: CURRENT_HAND_NUMBER,
  });
  occupiedSeatsInOrder.forEach((p) => addCard(p.seat, splitHandParts(p).secondCard));
  occupiedSeatsInOrder.forEach((p) => splitHandParts(p).turnCards.forEach((c) => addCard(p.seat, c)));

  return entries;
}

export const defaultCurrentHandEntries = buildCurrentHandEntries();

// --- Running count history (static mock) -------------------------------
// Hand 0 (before the shuffle), the shuffle marker, the previous hands
// above in order, then the real, correctly ordered cards from the current
// hand (defaultCurrentHandEntries).
function handEntries(cards, hand) {
  return cards.map((card, cardIdx) => ({ card, value: hiLoValue(card), hand, handStart: cardIdx === 0 }));
}

function buildDefaultCountHistory() {
  return [
    ...handEntries(PRE_SHUFFLE_HAND, 0),
    { isShuffleMarker: true },
    ...PREVIOUS_HANDS.flatMap((cards, i) => handEntries(cards, i + 1)),
    ...defaultCurrentHandEntries,
  ];
}

export const defaultCountHistory = buildDefaultCountHistory();

// How many history entries belong to "the current hand" — used by the
// Force Shuffle action to know how much to keep as the post-shuffle
// reference hand.
export const CURRENT_HAND_CARD_COUNT = defaultCurrentHandEntries.length;

export const defaultShoeStats = {
  handsSinceShuffle: CURRENT_HAND_NUMBER,
  lastShuffleHand: 0,
};

export const defaultAnalysis = {
  handsPlayed: 37,
  minHandsRequired: 5,
  playstyle: "Disciplined Basic-Strategy Follower",
  riskProfile: "Low-Moderate",
  decisionAccuracy: 0.91,
  bettingBehavior: "Flat betting, occasional 2x on true count > 2",
  // Longer, human-readable summary the analysis engine generated from
  // this player's recorded decisions — shown under the short stat line.
  description:
    "Across your last 37 recorded hands, you've followed basic strategy on the vast majority of hands, only deviating on a handful of soft-hand doubles against a dealer 6. Your bet sizing barely moves with the count, which keeps variance low but also caps your edge when the true count runs hot — increasing your spread on true counts above +2 is the single change most likely to raise your win rate. You tend to stand a beat too early on hard 12s against a dealer 2 or 3; tightening that up should close most of the remaining gap to perfect play.",
  // Win rate per day the player was logged in and dealt hands.
  trend: [
    { date: "Sep 12", winRate: 0.41 },
    { date: "Sep 15", winRate: 0.44 },
    { date: "Sep 19", winRate: 0.47 },
    { date: "Sep 23", winRate: 0.46 },
    { date: "Sep 27", winRate: 0.5 },
  ],
};

export const defaultMidShoeJoin = {
  isMidShoeJoin: true,
  countReliability: 0.6,
};
