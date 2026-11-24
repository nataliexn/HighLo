// Playstyle analysis for the analysis accounts (dec5, dec11).
//
// While the user sits at a seat, every round is followed card by card:
//   * each time one of their hands takes a card, the move was HIT (or DOUBLE
//     when that card was laid sideways);
//   * when the seat splits into two hands, the move was SPLIT;
//   * a hand still under 21 when the round ends STOOD.
// Each move is graded against what HighLo recommended at that moment (the
// basic-strategy chart, plus count plays when the count is trusted). The
// report is then a handful of plain rules over those numbers.
//
// Records are kept in this browser (localStorage), one list per account.
// That is enough for a demo of 30-40 hands; a real launch would keep them on
// a server so an account's history follows the player between devices.

import { handValue } from "../components/Card.jsx";
import { basicStrategyAction, recommend } from "./strategy.js";
import { MIN_HANDS_REQUIRED } from "../state/mockData.js";

export const ANALYSIS_ACCOUNTS = ["dec5", "dec11"];
export const isAnalysisAccount = (name) => ANALYSIS_ACCOUNTS.includes((name || "").trim().toLowerCase());

const known = (cards) => (cards || []).filter((c) => c && c !== "??");
const rankOf = (code) => {
  const r = code.slice(0, -1);
  return ["J", "Q", "K"].includes(r) ? "10" : r;
};
const dealerCol = (code) => (rankOf(code) === "A" ? "A" : rankOf(code));
const isSoftHand = (cards) => {
  if (!cards.some((c) => rankOf(c) === "A")) return false;
  const hard = cards.reduce((s, c) => s + (rankOf(c) === "A" ? 1 : Math.min(10, Number(rankOf(c)))), 0);
  return hard + 10 <= 21;
};

// ---------------------------------------------------------------- grading
/** The chart's move for a pair that may not be split again: played as its plain total. */
function pairAsTotal(cards, dealerUp) {
  if (rankOf(cards[0]) === "A") return "HIT";                 // soft 12
  const total = handValue(cards);
  if (total >= 17) return "STAND";
  if (total <= 8) return "HIT";
  // the same total from two different ranks, so the chart doesn't read it as a pair
  const same = total <= 11 ? ["2S", `${total - 2}H`] : ["10S", `${total - 10}H`];
  return basicStrategyAction(same, dealerUp);
}

/**
 * What the player should have done, among the moves the camera can see.
 * Surrender can't be seen, so where the chart surrenders the no-surrender
 * play (hit) is expected. A double or split that isn't allowed any more
 * (third card, or a seat already split) falls back to the chart's next move.
 * Returns null when the decision can't be graded fairly.
 */
export function expectedMove(cards, dealerUp, trueCount, countReliable, { canSplit }) {
  const rec = recommend(cards, dealerUp, trueCount, countReliable, { afterSplit: !canSplit });
  let action = rec.action;
  if (action === "SURRENDER") action = "HIT";
  if (action === "DOUBLE" && cards.length > 2) {
    action = isSoftHand(cards) && handValue(cards) === 18 ? "STAND" : "HIT";
  }
  if (action === "SPLIT" && !canSplit) action = pairAsTotal(cards, dealerUp);
  return { action, basis: rec.basis };
}

// ---------------------------------------------------------------- following a round
export function newTracker(seat) {
  return { seat, hands: [{ snap: [], doubled: false, decisions: [] }], split: false, preSplit: [], results: null };
}

function decide(tracker, cards, action, ctx, canSplit) {
  const exp = expectedMove(cards, ctx.dealerUp, ctx.trueCount, ctx.countReliable, { canSplit });
  return {
    cards: [...cards],
    dealerUp: ctx.dealerUp,
    trueCount: Math.round(ctx.trueCount * 10) / 10,
    action,
    expected: exp ? exp.action : null,
    basis: exp ? exp.basis : null,
    correct: exp ? exp.action === action : null,
  };
}

/**
 * Feed the player's current hands (cards as shown, after their corrections).
 * ctx: { dealerUp, trueCount, countReliable }.
 */
export function observe(tracker, hands, ctx) {
  if (!tracker || tracker.results) return;           // dealer finished: the round is decided
  const live = (hands || []).filter((h) => known(h.cards).length > 0);
  if (!live.length || !ctx.dealerUp || ctx.dealerUp === "??") return;   // swept, or not dealt yet

  // the seat just split: the move on the original pair was SPLIT
  if (hands.length >= 2 && !tracker.split) {
    const pair = tracker.hands[0].snap.length === 2 ? tracker.hands[0].snap : [known(hands[0].cards)[0], known(hands[1].cards)[0]];
    tracker.preSplit = [...tracker.hands[0].decisions, decide(tracker, pair, "SPLIT", ctx, true)];
    tracker.split = true;
    tracker.hands = hands.map(() => ({ snap: [], doubled: false, decisions: [] }));
  }

  hands.forEach((hand, i) => {
    const cur = known(hand.cards);
    const h = tracker.hands[i] || (tracker.hands[i] = { snap: [], doubled: false, decisions: [] });
    if (cur.length > h.snap.length) {
      if (h.snap.length >= 2 && handValue(h.snap) < 21 && !h.doubled) {
        const doubled = Boolean(hand.isDoubled) && h.snap.length === 2;
        h.decisions.push(decide(tracker, h.snap, doubled ? "DOUBLE" : "HIT", ctx, !tracker.split));
      }
      h.snap = cur;
    } else if (cur.length === h.snap.length) {
      h.snap = cur;                                   // a card was corrected, same count
    }                                                 // fewer cards: a flicker or the sweep; keep what we had
    h.doubled = h.doubled || Boolean(hand.isDoubled);
    h.ctx = ctx;
  });
}

/** Round results (from lib/outcome.js) for this seat, once the dealer has finished. */
export function setResults(tracker, results) {
  if (tracker && results && results.length) tracker.results = results;
}

/** The round is over: a hand still under 21 stood. Returns a record, or null if the seat played nothing. */
export function finalize(tracker, when = new Date()) {
  if (!tracker) return null;
  const hands = tracker.hands
    .map((h, i) => {
      if (!h.snap.length) return null;
      const decisions = [...(i === 0 ? tracker.preSplit : []), ...h.decisions];
      const total = handValue(h.snap);
      const natural = !tracker.split && h.snap.length === 2 && total === 21;
      if (h.snap.length >= 2 && total < 21 && !h.doubled && !natural && h.ctx) {
        decisions.push(decide(tracker, h.snap, "STAND", h.ctx, !tracker.split));
      }
      const res = (tracker.results || []).find((r) => r.handIndex === i);
      return {
        cards: h.snap,
        isSplit: tracker.split,
        isDoubled: h.doubled,
        result: res ? res.result : total > 21 ? "bust" : null,
        player: total,
        dealer: res ? res.dealer : null,
        decisions,
      };
    })
    .filter(Boolean);
  if (!hands.length) return null;
  return { at: when.toISOString(), seat: tracker.seat, hands };
}

// ---------------------------------------------------------------- the report
function leakOf(d) {
  if (d.correct !== false) return null;
  const total = handValue(d.cards);
  const col = dealerCol(d.dealerUp);
  const strong = ["7", "8", "9", "10", "A"].includes(col);
  if (d.expected === "SPLIT") return "missedSplit";
  if (d.action === "SPLIT") return "badSplit";
  if (d.expected === "DOUBLE") return "missedDouble";
  if (d.action === "DOUBLE") return "extraDouble";
  if (isSoftHand(d.cards)) return "soft";
  if (total >= 12 && total <= 16 && d.action === "STAND" && strong) return "stiffStand";
  if (total >= 12 && total <= 16 && d.action === "HIT" && !strong) return "stiffHit";
  if (d.action === "HIT" && total >= 17) return "hitHigh";
  return d.action === "STAND" ? "standEarly" : "hitLate";
}

const LEAK_TEXT = {
  stiffStand:
    "Your most common miss was standing on 12-16 against a dealer 7 or higher. The chart hits there: the dealer will usually make 17 or more, so standing loses more often than risking the bust.",
  stiffHit:
    "Your most common miss was hitting 12-16 against a dealer 2-6. The chart stands there and lets the dealer, who is the one likely to bust, take the risk.",
  missedDouble:
    "You passed on doubles the chart calls for, mostly 10 or 11 against a weaker dealer card. Those are the hands that pay the most when you double.",
  extraDouble:
    "You doubled on hands the chart would only hit or stand. That puts more money out without the edge that makes doubling worth it.",
  missedSplit: "You played pairs the chart splits. Aces and 8s are always split; 2s, 3s, 6s, 7s and 9s depend on the dealer card.",
  badSplit: "You split pairs the chart keeps together, like 10s or 5s. Those are already strong (or best doubled) as one hand.",
  soft:
    "Soft hands (with an Ace counted as 11) were where you strayed most. You can't bust a soft hand with one card, so the chart hits or doubles soft 17 and below.",
  hitHigh: "You hit some hard 17s or higher. Past 17 the chance of busting outweighs anything the extra card can add.",
  standEarly: "You stood on some low totals the chart hits. Under 12 no single card can bust you, so taking one is free.",
  hitLate: "A few of your hits went against the chart. Check the strategy chart for those spots.",
};

function pct(n, d) {
  return d ? Math.round((n / d) * 100) : 0;
}

/** Everything the Analysis page shows, built from the saved rounds. */
export function analyze(records) {
  const rounds = records || [];
  const hands = rounds.flatMap((r) => r.hands);
  const decisions = hands.flatMap((h) => h.decisions);
  const graded = decisions.filter((d) => d.correct !== null);
  const correct = graded.filter((d) => d.correct).length;
  const accuracy = graded.length ? correct / graded.length : 0;

  const count = (pred) => hands.filter(pred).length;
  const wins = count((h) => h.result === "win" || h.result === "blackjack");
  const pushes = count((h) => h.result === "push");
  const busts = count((h) => h.result === "bust");
  const losses = count((h) => h.result === "lose") + busts;
  const doubles = count((h) => h.isDoubled);
  const bustRate = hands.length ? busts / hands.length : 0;
  const doubleRate = hands.length ? doubles / hands.length : 0;

  const leaks = {};
  graded.forEach((d) => {
    const k = leakOf(d);
    if (k) leaks[k] = (leaks[k] || 0) + 1;
  });
  const n = (k) => leaks[k] || 0;
  const standTooSoon = n("stiffStand") + n("standEarly");
  const hitTooMuch = n("stiffHit") + n("hitHigh") + n("hitLate");

  // ---- playstyle: first rule that matches
  let playstyle;
  if (graded.length < 3) playstyle = "Still Reading Your Game";
  else if (accuracy >= 0.9) playstyle = "Disciplined Chart Player";
  else if (n("extraDouble") >= 2 && n("extraDouble") >= n("missedDouble")) playstyle = "Aggressive Doubler";
  else if (standTooSoon >= 2 && standTooSoon >= 1.5 * hitTooMuch) playstyle = "Cautious Stander";
  else if (hitTooMuch >= 2 && hitTooMuch >= 1.5 * standTooSoon) playstyle = "Over-Hitter";
  else if (n("missedDouble") >= 2) playstyle = "Conservative, Leaves Doubles Behind";
  else if (accuracy >= 0.75) playstyle = "Solid, With a Few Leaks";
  else playstyle = "Playing on Instinct";

  // ---- risk profile
  let riskProfile;
  if (bustRate >= 0.25 || doubleRate >= 0.2 || n("extraDouble") >= 3) riskProfile = "High";
  else if (bustRate < 0.12 && doubleRate < 0.08) riskProfile = "Low";
  else riskProfile = "Moderate";

  // ---- count plays
  const countPlays = graded.filter((d) => d.basis === "count");
  const countFollowed = countPlays.filter((d) => d.correct).length;

  // ---- the written report
  const parts = [];
  parts.push(
    `Across ${rounds.length} hand${rounds.length === 1 ? "" : "s"}${hands.length > rounds.length ? ` (${hands.length} counting splits)` : ""}, you followed the strategy on ${correct} of ${graded.length} decisions (${pct(correct, graded.length)}%).`
  );
  parts.push(
    `You won ${wins}, pushed ${pushes} and lost ${losses}${busts ? `, busting ${busts} time${busts === 1 ? "" : "s"}` : ""}.`
  );
  const topLeak = Object.entries(leaks).sort((a, b) => b[1] - a[1])[0];
  if (topLeak) parts.push(LEAK_TEXT[topLeak[0]]);
  if (countPlays.length) {
    parts.push(
      `The count changed the right play ${countPlays.length} time${countPlays.length === 1 ? "" : "s"}, and you made the count play ${countFollowed} of those.`
    );
  }
  if (accuracy >= 0.9 && graded.length >= 5) {
    parts.push("Your play is close to the chart. The next step is watching the true count and making the count-based plays when it is trusted.");
  }

  // ---- trend: win rate for every 5 hands
  const trend = [];
  for (let i = 0; i < rounds.length; i += 5) {
    const chunk = rounds.slice(i, i + 5).flatMap((r) => r.hands);
    const w = chunk.filter((h) => h.result === "win" || h.result === "blackjack").length;
    trend.push({ date: `Hands ${i + 1}-${Math.min(i + 5, rounds.length)}`, winRate: chunk.length ? w / chunk.length : 0 });
  }

  return {
    handsPlayed: rounds.length,
    minHandsRequired: MIN_HANDS_REQUIRED,
    playstyle,
    riskProfile,
    decisionAccuracy: accuracy,
    bettingBehavior: "",
    description: parts.join(" "),
    trend,
    trendTitle: "Win rate, every 5 hands",
    stats: { wins, pushes, losses, busts, bustRate, doubles, decisions: graded.length, correct, leaks },
    recent: rounds.slice(-5).reverse(),
    isLive: true,
  };
}

