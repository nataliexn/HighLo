import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import config from "../config.js";
import { computeCountStats, hiLoValue, TOTAL_DECKS } from "../lib/count.js";
import { connectCameraLink } from "../lib/cameraLink.js";
import { dealerFinished, roundResults as buildRoundResults } from "../lib/outcome.js";
import {
  emptyOccupancy,
  emptyPlayers,
  emptyDealer,
  emptyShoeStats,
  emptyAnalysis,
  analysisFor,
  defaultRecommendation,
  defaultMidShoeJoin,
  demoTable,
} from "./mockData.js";
import {
  analyze,
  finalize as finalizeRound,
  isAnalysisAccount,
  newTracker,
  observe as observeRound,
  setResults as setRoundTrackerResults,
} from "../lib/analysis.js";

const AppStateContext = createContext(null);
// Camera-link data changes many times a second (detection boxes), so it
// lives in its own context: only the components that draw it re-render.
const CameraLinkContext = createContext(null);

const LINK_STORAGE_KEY = "highlo:cameraLink";
// When the camera or the connection drops, the table stays on screen this
// long before it is cleared, so a short network hiccup mid-hand loses nothing.
export const EXPIRE_MS = 15000;
const OFFLINE_LINK = {
  serverOnline: false, // HighLo can reach the camera server
  phoneOnline: false, // a phone is paired with the server
  cameraOpen: false, // ...and its camera is on and sending frames
  modelLoaded: false,
  modelName: null,
  width: 0,
  height: 0,
  fps: 0,
  streamUrl: null,
  boxes: [],
  problem: null, // "token" | "origin" | "address" | null
};

// A table link shared by the camera host: https://<site>/#cam=<address>&key=<token>.
// It lives in the URL fragment, which is never sent to the website's server.
// Opening it saves the connection in this browser and tidies the address bar.
function linkFromUrl() {
  try {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const serverAddress = (params.get("cam") || "").trim();
    const token = (params.get("key") || "").trim();
    if (!serverAddress || !token) return null;
    const clean = { serverAddress, token };
    window.localStorage.setItem(LINK_STORAGE_KEY, JSON.stringify(clean));
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    return clean;
  } catch {
    return null;
  }
}

/** The link the camera host can send to everyone at the table. */
export function buildShareLink(settings) {
  const params = new URLSearchParams({ cam: settings.serverAddress, key: settings.token });
  return `${window.location.origin}/#${params.toString()}`;
}

function loadLinkSettings() {
  const shared = linkFromUrl();
  if (shared) return shared;
  try {
    const saved = JSON.parse(window.localStorage.getItem(LINK_STORAGE_KEY));
    if (saved && typeof saved.serverAddress === "string" && typeof saved.token === "string") {
      return saved;
    }
  } catch {
    // nothing saved, or unreadable: fall back to the build-time shortcut
  }
  return { serverAddress: config.CAMERA_SERVER_URL || "", token: config.CAMERA_SERVER_TOKEN || "" };
}

// Per-device storage. Only the small things that belong to a person survive a
// refresh (hands played by each account). Table data (cards, seats, the count)
// is never saved here: it comes from the camera server, and with no camera
// HighLo shows an empty table. The version segment lets a future change to the
// data shape start clean instead of loading stale data from an older build
// (v4 also drops the old demo history that earlier builds saved).
const LOCAL_STATE_PREFIX = "highlo:v4:";

function loadLocal(key, fallback) {
  try {
    const raw = window.localStorage.getItem(LOCAL_STATE_PREFIX + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveLocal(key, value) {
  try {
    window.localStorage.setItem(LOCAL_STATE_PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage full or blocked (e.g. private mode): the app still works,
    // the changes just won't survive a refresh.
  }
}

/** A card as this viewer sees it: their correction for that card (by id, else by slot), or the reading. */
export function fixCard(corrections, seat, handIndex, cardIndex, code, cardId) {
  return (cardId && corrections[`id:${cardId}`]) || corrections[`${seat}-${handIndex}-${cardIndex}`] || code;
}

export function AppStateProvider({ children }) {
  // ---- Auth / session -------------------------------------------------
  // isGuest=true and isAuthenticated=false are the sane defaults for a
  // fresh visit; nothing here is left undefined.
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isGuest, setIsGuest] = useState(false);
  const [username, setUsername] = useState("");

  // ---- Seat selection ---------------------------------------------------
  // A session is either SITTING at a seat or SPECTATING (no seat). Both live
  // only for this visit: they are not saved, so a stale seat can't survive a
  // log-out or refresh.
  const [selectedSeat, setSelectedSeatState] = useState(null);
  const [isSpectating, setIsSpectating] = useState(false);

  function setSelectedSeat(seat) {
    setSelectedSeatState(seat);
    if (seat) setIsSpectating(false);
  }

  function startSpectating() {
    setSelectedSeatState(null);
    setIsSpectating(true);
  }

  // ---- Live table data --------------------------------------------------
  // Starts EMPTY and only ever shows what the camera server reports. With no
  // camera connected nothing is made up: no seats, no cards, no count.
  const [occupancy, setOccupancy] = useState(emptyOccupancy);
  const [seatsKnown, setSeatsKnown] = useState(false); // the server has read who is playing
  const [players, setPlayers] = useState(emptyPlayers);
  const [dealer, setDealer] = useState(emptyDealer);
  const [recommendation, setRecommendation] = useState(defaultRecommendation);
  const [countHistory, setCountHistory] = useState([]);
  const [shoeStats, setShoeStats] = useState(emptyShoeStats);
  const [midShoeJoin, setMidShoeJoin] = useState(defaultMidShoeJoin);
  // The latest table state the server sent. It is only SHOWN while the camera
  // is live (see the effect below), so a stale table never lingers on screen.
  const [serverState, setServerState] = useState(null);

  // ---- Account analysis -------------------------------------------------
  // Tied to the account (three demo accounts for now), whether or not the
  // user is spectating. Only a user who is sitting at a seat can ADD to it.
  const [extraHands, setExtraHands] = useState(() => loadLocal("extraHands", {}));
  useEffect(() => saveLocal("extraHands", extraHands), [extraHands]);
  const accountKey = username.trim().toLowerCase();
  // The analysis accounts (dec5, dec11) build a real report from the hands they
  // play (lib/analysis.js). Their rounds are kept per account in this browser.
  const analysisAccount = isAuthenticated && isAnalysisAccount(accountKey);
  const [analysisRecords, setAnalysisRecords] = useState(() => loadLocal("analysisRecords", {}));
  useEffect(() => saveLocal("analysisRecords", analysisRecords), [analysisRecords]);
  const analysis = useMemo(() => {
    if (analysisAccount) return analyze(analysisRecords[accountKey] || []);
    const base = isAuthenticated ? analysisFor(username) : emptyAnalysis();
    return { ...base, handsPlayed: base.handsPlayed + (extraHands[accountKey] || 0) };
  }, [isAuthenticated, username, accountKey, extraHands, analysisAccount, analysisRecords]);
  function resetAnalysis() {
    setAnalysisRecords((prev) => {
      const next = { ...prev };
      delete next[accountKey];
      return next;
    });
  }

  // What each kind of session may do:
  //   logged in + seat      view analysis, analysis updates, can switch the recommendation view
  //   logged in + spectate  view analysis (read-only), recommendations fixed to "all turns"
  //   guest + seat          no analysis, can switch the recommendation view
  //   guest + spectate      no analysis, recommendations fixed to "all turns"
  const canViewAnalysis = isAuthenticated;
  const canUpdateAnalysis = isAuthenticated && !isSpectating;
  const canToggleRecommendationView = !isSpectating;

  // Phone camera link (see lib/cameraLink.js). Settings live in this browser.
  const [linkSettings, setLinkSettings] = useState(loadLinkSettings);
  const [cameraLink, setCameraLink] = useState(OFFLINE_LINK);
  const rawLive = cameraLink.serverOnline && cameraLink.phoneOnline && cameraLink.cameraOpen;
  // `live` stays true for EXPIRE_MS after the camera drops; `holding` marks that window.
  const [graceLive, setGraceLive] = useState(false);
  useEffect(() => {
    if (rawLive) {
      setGraceLive(true);
      return undefined;
    }
    const timer = setTimeout(() => setGraceLive(false), EXPIRE_MS);
    return () => clearTimeout(timer);
  }, [rawLive]);
  const live = rawLive || graceLive;
  const holding = live && !rawLive;
  const cameraConnected = live || Boolean(config.CAMERA_STREAM_URL);
  const [isCountHistoryVisible, setIsCountHistoryVisible] = useState(true);

  // Controls whether the Recommendation component shows every seat's
  // recommendation as each turn happens ("all") or only surfaces one when
  // it's this viewer's own seat's turn ("mine"). Desktop only — mobile is
  // always forced to "mine" regardless of this value (see RecommendationPanel).
  const [scopeChoice, setScopeChoice] = useState("all");
  const recommendationScope = isSpectating ? "all" : scopeChoice;
  function setRecommendationScope(next) {
    if (canToggleRecommendationView) setScopeChoice(next);
  }

  // Per-user card corrections. Keyed by the card's id from the camera server
  // ("id:c42"), so a correction stays on that physical card even if the model
  // relabels it or another card is read in front of it; the slot key
  // "seat-handIndex-cardIndex" is the fallback (sample table). A correction
  // only ever affects this browser's view, never the shared detection state.
  // They last for the current round only (cleared when a new round starts).
  const [localCorrections, setLocalCorrections] = useState({});

  function correctCard(seat, handIndex, cardIndex, newCode, cardId) {
    setLocalCorrections((prev) => ({
      ...prev,
      [cardId ? `id:${cardId}` : `${seat}-${handIndex}-${cardIndex}`]: newCode,
    }));
    if (cardId) return; // the history view picks it up by id (countHistoryView below)
    // Keep the Running Count history in sync: the history entry dealt
    // from this exact (seat, handIndex, cardIndex) slot — tagged that
    // way in mockData.js's buildCurrentHandEntries — gets its card/value
    // updated too, so correcting a misread card actually moves the
    // count instead of just changing what's shown on the seat.
    setCountHistory((prev) =>
      prev.map((entry) =>
        entry.seat === seat && entry.handIndex === handIndex && entry.cardIndex === cardIndex
          ? {
              ...entry,
              card: newCode,
              value: newCode === "??" ? 0 : hiLoValue(newCode),
              // A correction on the dealer's hole card only happens once
              // it's actually revealed (see Dealer.jsx), so it's known
              // now too and should start counting like any other card.
              isHiddenCard: false,
            }
          : entry
      )
    );
  }

  // ---- Derived running-count stats --------------------------------------
  // Computed from countHistory itself (Hi-Lo running count, true count,
  // cards counted / remaining in a 6-deck shoe) so the Running Count
  // component and page always agree, and update the instant a card is
  // added — no separate "runningCount" field to keep in sync by hand.
  // The history as this viewer sees it: the server's entries with this viewer's corrections.
  const countHistoryView = useMemo(
    () =>
      countHistory.map((entry) => {
        const fixed = entry.id ? localCorrections[`id:${entry.id}`] : undefined;
        return fixed
          ? { ...entry, card: fixed, value: fixed === "??" ? 0 : hiLoValue(fixed), isHiddenCard: false }
          : entry;
      }),
    [countHistory, localCorrections]
  );
  const countStats = useMemo(() => computeCountStats(countHistoryView, TOTAL_DECKS), [countHistoryView]);

  // ---- Round results ------------------------------------------------------
  // Once the dealer stands (17+) or busts, every hand gets a result; a split
  // hand gets its own. Uses this viewer's card corrections. The results stay
  // up after the table is swept and clear when the next round starts.
  const [roundResults, setRoundResults] = useState(null);
  const corrected = useMemo(() => {
    const fix = (seat, handIndex, cards, ids) =>
      cards.map((c, i) => fixCard(localCorrections, seat, handIndex, i, c, ids && ids[i]));
    return {
      dealer: { ...dealer, cards: fix("dealer", 0, dealer.cards, dealer.ids) },
      players: players.map((p) => ({
        ...p,
        hands: p.hands.map((h, hi) => ({ ...h, cards: fix(p.seat, hi, h.cards, h.ids) })),
      })),
    };
  }, [players, dealer, localCorrections]);
  const liveResults = useMemo(
    () => (dealerFinished(corrected.dealer) ? buildRoundResults(corrected.players, corrected.dealer) : null),
    [corrected]
  );
  // Once shown, the results stay put while the cards are cleared away (taking cards
  // off would otherwise change totals and flip the results), and go once the
  // table is empty, back to "waiting for the next round".
  const cardsOnTable =
    players.reduce((n, p) => n + p.hands.reduce((m, h) => m + h.cards.length, 0), 0) + dealer.cards.length;
  const resultsLock = useRef({ shown: false, cards: 0 });
  useEffect(() => {
    const lock = resultsLock.current;
    if (cardsOnTable === 0) {
      lock.shown = false;
      lock.cards = 0;
      setRoundResults(null);
      return;
    }
    if (liveResults && liveResults.length && (!lock.shown || cardsOnTable >= lock.cards)) {
      lock.shown = true; // first time, or a card was corrected / added while nothing is being cleared
      lock.cards = cardsOnTable;
      setRoundResults(liveResults);
    } else if (!lock.shown) {
      setRoundResults(null); // dealer still drawing
    }
    // shown and cards are going: the table is being cleared, keep the results as they were
  }, [liveResults, cardsOnTable]);
  // ---- Whose turn (manual adjust) ----------------------------------------
  // The camera guesses whose turn it is from the cards. Previous / Next player
  // (Active Players panel) move it by hand, for this viewer. The adjustment
  // holds until the camera's own guess moves on (e.g. a card lands on another
  // hand) or a new round starts.
  const detectedTurn = useMemo(() => {
    for (const p of players) {
      const hi = p.hands.findIndex((h) => h.isTurn);
      if (hi >= 0) return `${p.seat}-${hi}`;
      if (p.isTurn) return `${p.seat}-0`;
    }
    return "";
  }, [players]);
  const [turnOverride, setTurnOverride] = useState(null); // { seat, handIndex, base }
  const playersView = useMemo(() => {
    if (!turnOverride || turnOverride.base !== detectedTurn) return players;
    return players.map((p) => ({
      ...p,
      isTurn: p.seat === turnOverride.seat,
      hands: p.hands.map((h, hi) => ({ ...h, isTurn: p.seat === turnOverride.seat && hi === turnOverride.handIndex })),
    }));
  }, [players, turnOverride, detectedTurn]);
  // hands in play order: seat 1 -> 6, split hand 1 before hand 2
  const turnOrder = useMemo(
    () =>
      [...players]
        .sort((a, b) => a.seat - b.seat)
        .flatMap((p) => p.hands.map((h, hi) => ({ seat: p.seat, handIndex: hi, has: h.cards.length > 0 })))
        .filter((h) => h.has),
    [players]
  );
  const currentTurnIndex = useMemo(() => {
    for (const p of playersView) {
      const hi = p.hands.findIndex((h) => h.isTurn);
      if (hi >= 0) return turnOrder.findIndex((t) => t.seat === p.seat && t.handIndex === hi);
    }
    return -1;
  }, [playersView, turnOrder]);
  function stepTurn(direction) {
    if (turnOrder.length === 0) return;
    const from = currentTurnIndex < 0 ? (direction > 0 ? -1 : turnOrder.length) : currentTurnIndex;
    const to = Math.max(0, Math.min(turnOrder.length - 1, from + direction));
    setTurnOverride({ ...turnOrder[to], base: detectedTurn });
  }
  const turnControls = {
    canPrevious: turnOrder.length > 0 && currentTurnIndex !== 0,
    canNext: turnOrder.length > 0 && currentTurnIndex !== turnOrder.length - 1,
    previous: () => stepTurn(-1),
    next: () => stepTurn(1),
  };

  const roundOutcomes = useMemo(() => {
    const map = {};
    (roundResults || []).forEach((r) => {
      map[`${r.seat}-${r.handIndex}`] = r.result;
    });
    return map;
  }, [roundResults]);

  // ---- Force Shuffle (manual, THIS USER ONLY) ---------------------------
  // Only changes this user's own (locally stored) history and count — it
  // never reaches anyone else. A shuffle for everyone only happens when
  // the camera detects a real one: that arrives as a new `countHistory`
  // in the detection payload below, which replaces the history for all
  // connected users. Simulates a shuffle happening right now: keeps only the most recent
  // hand's cards as the post-shuffle reference (per the spec: "last
  // completed hand before shuffle remains visible for reference"), drops
  // everything else, and resets the running count to zero. The confirm
  // step lives in the UI (CountHistory.jsx) before this is called.
  function forceShuffle() {
    setCountHistory((prev) => {
      const cards = prev.filter((e) => !e.isShuffleMarker);
      if (cards.length === 0) return prev;
      const lastHand = cards.reduce((m, e) => Math.max(m, e.hand ?? 0), 0);
      const referenceHand = cards.filter((e) => e.hand === lastHand);
      return [...referenceHand, { isShuffleMarker: true }];
    });
    setShoeStats((prev) => ({ ...prev, handsSinceShuffle: 0 }));
  }

  // ---- Phone camera link -------------------------------------------------
  // Connects to the camera server whenever address + token are saved, and
  // reconnects by itself. HighLo goes live the moment the server reports the
  // phone online with its camera open; until then the mock table stays.
  useEffect(() => {
    setCameraLink(OFFLINE_LINK);
    setServerState(null);
    if (!linkSettings.serverAddress || !linkSettings.token) return undefined;

    const link = connectCameraLink({
      serverAddress: linkSettings.serverAddress,
      token: linkSettings.token,
      onEvent: (event) => {
        switch (event.type) {
          case "ready":
            setCameraLink((prev) => ({ ...prev, serverOnline: true, streamUrl: event.streamUrl, problem: null }));
            break;
          case "closed":
            setCameraLink((prev) => ({ ...OFFLINE_LINK, problem: prev.problem }));
            break;
          case "rejected":
            setCameraLink({ ...OFFLINE_LINK, problem: event.code === 4401 ? "token" : "origin" });
            break;
          case "invalid":
            setCameraLink({ ...OFFLINE_LINK, problem: "address" });
            break;
          case "status":
            // fps changes every second; ignore it so a steady stream doesn't re-render
            setCameraLink((prev) => {
              const next = {
                ...prev,
                phoneOnline: Boolean(event.phoneOnline),
                cameraOpen: Boolean(event.cameraOpen),
                modelLoaded: Boolean(event.modelLoaded),
                modelName: event.modelName || null,
                width: Number(event.width) || 0,
                height: Number(event.height) || 0,
                boxes: event.cameraOpen ? prev.boxes : [],
              };
              const same = ["phoneOnline", "cameraOpen", "modelLoaded", "modelName", "width", "height"].every(
                (key) => prev[key] === next[key]
              );
              return same && next.boxes === prev.boxes ? prev : next;
            });
            break;
          case "detections":
            setCameraLink((prev) => (prev.cameraOpen ? { ...prev, boxes: Array.isArray(event.boxes) ? event.boxes : [] } : prev));
            break;
          case "state":
            // Full table state from the server. Kept here and applied by the
            // effect below, but only while the camera is live.
            setServerState(event);
            break;
          default:
            break;
        }
      },
    });
    return () => link.close();
  }, [linkSettings]);

  // ---- Showing the server's table ------------------------------------------
  // While the camera is live the table mirrors the server. With no camera the
  // whole table goes back to empty (no stale cards, no stale seats).
  const sessionRef = useRef({});
  sessionRef.current = { selectedSeat, isAuthenticated, isSpectating, accountKey };
  const roundRef = useRef({ active: false, played: false });
  const [roundActive, setRoundActive] = useState(false);
  // No live camera: show the sample table (labelled by DemoBanner) instead of an
  // empty one, so every part of the dashboard can be seen working.
  const isDemo = !live;

  useEffect(() => {
    if (!live || !serverState) {
      const demo = demoTable();
      setOccupancy(live ? emptyOccupancy() : demo.occupancy);
      setSeatsKnown(!live);
      setPlayers(live ? emptyPlayers() : demo.players);
      setDealer(live ? emptyDealer() : demo.dealer);
      setCountHistory(live ? [] : demo.countHistory);
      setShoeStats(live ? emptyShoeStats() : demo.shoeStats);
      setMidShoeJoin(defaultMidShoeJoin);
      setLocalCorrections({});
      setRoundResults(null);
      setRoundActive(false);
      roundRef.current = { active: false, played: false };
      return;
    }
    const event = serverState;
    const round = roundRef.current;
    const me = sessionRef.current;

    if (typeof event.roundActive === "boolean") {
      if (event.roundActive && !round.active) {
        round.played = false;
        setLocalCorrections({}); // corrections belong to the round they were made in
        setRoundResults(null);
        resultsLock.current = { shown: false, cards: 0 };
        setTurnOverride(null);
      }
      if (event.roundActive && me.selectedSeat && event.players) {
        const mine = event.players.find((p) => p.seat === me.selectedSeat);
        if (mine && mine.hands.some((h) => h.cards.length > 0)) round.played = true;
      }
      // A round the user sat through has ended: it counts towards their analysis
      // (only when logged in AND sitting, never for a spectator or a guest).
      if (
        !event.roundActive && round.active && round.played && me.isAuthenticated && me.selectedSeat &&
        !isAnalysisAccount(me.accountKey) // those count from their own records
      ) {
        setExtraHands((prev) => ({ ...prev, [me.accountKey]: (prev[me.accountKey] || 0) + 1 }));
        round.played = false;
      }
      round.active = event.roundActive;
      setRoundActive(event.roundActive);
    }

    if (event.occupancy) setOccupancy(event.occupancy);
    setSeatsKnown(Boolean(event.seatsKnown));
    if (event.players) setPlayers(event.players);
    if (event.dealer) setDealer(event.dealer);
    if (event.recommendation) setRecommendation(event.recommendation);
    if (event.countHistory) setCountHistory(event.countHistory);
    if (event.shoeStats) setShoeStats(event.shoeStats);
    if (event.midShoeJoin) setMidShoeJoin(event.midShoeJoin);
  }, [live, serverState]);

  // ---- Recording hands for the analysis accounts ---------------------------
  // Follows the user's own seat through each live round and saves the round
  // (cards, every move, how it was graded, the result) when it ends. Only from
  // a seat, only with a live camera, never from the sample table.
  const trackerRef = useRef(null);
  useEffect(() => {
    const recording = live && analysisAccount && selectedSeat && !isSpectating;
    if (!recording) {
      trackerRef.current = null;
      return;
    }
    if (roundActive) {
      if (!trackerRef.current || trackerRef.current.seat !== selectedSeat) trackerRef.current = newTracker(selectedSeat);
      const mine = corrected.players.find((p) => p.seat === selectedSeat);
      observeRound(trackerRef.current, mine ? mine.hands : [], {
        dealerUp: corrected.dealer.cards[0],
        trueCount: countStats.trueCount,
        countReliable: !midShoeJoin.isMidShoeJoin,
      });
      if (roundResults) setRoundTrackerResults(trackerRef.current, roundResults.filter((r) => r.seat === selectedSeat));
    } else if (trackerRef.current) {
      const record = finalizeRound(trackerRef.current);
      trackerRef.current = null;
      if (record) {
        setAnalysisRecords((prev) => ({ ...prev, [accountKey]: [...(prev[accountKey] || []), record] }));
      }
    }
  }, [live, analysisAccount, selectedSeat, isSpectating, roundActive, corrected, roundResults, countStats, midShoeJoin, accountKey]);

  function saveLinkSettings(next) {
    const clean = { serverAddress: next.serverAddress.trim(), token: next.token.trim() };
    try {
      window.localStorage.setItem(LINK_STORAGE_KEY, JSON.stringify(clean));
    } catch {
      // storage blocked: the link still works until the page is closed
    }
    setLinkSettings(clean);
  }

  function clearLinkSettings() {
    try {
      window.localStorage.removeItem(LINK_STORAGE_KEY);
    } catch {
      // ignore
    }
    setLinkSettings({ serverAddress: "", token: "" });
  }

  const linkValue = useMemo(
    () => ({ ...cameraLink, live: rawLive, holding, settings: linkSettings, saveLinkSettings, clearLinkSettings }),
    [cameraLink, rawLive, holding, linkSettings]
  );

  const value = useMemo(
    () => ({
      isAuthenticated,
      isGuest,
      username,
      login: (name) => {
        setUsername(name);
        setIsAuthenticated(true);
        setIsGuest(false);
        setSelectedSeatState(null);
        setIsSpectating(false);
      },
      continueAsGuest: () => {
        setIsGuest(true);
        setIsAuthenticated(false);
        setUsername("Guest");
        setSelectedSeatState(null);
        setIsSpectating(false);
      },
      logout: () => {
        setIsAuthenticated(false);
        setIsGuest(false);
        setUsername("");
        setSelectedSeatState(null);
        setIsSpectating(false);
      },
      selectedSeat,
      setSelectedSeat,
      isSpectating,
      startSpectating,
      canViewAnalysis,
      canUpdateAnalysis,
      canToggleRecommendationView,
      live,
      holding,
      isDemo,
      seatsKnown,
      occupancy,
      players: playersView,
      turnControls,
      dealer,
      recommendation,
      countHistory: countHistoryView,
      countStats,
      shoeStats,
      analysis,
      analysisAccount,
      resetAnalysis,
      midShoeJoin,
      cameraConnected,
      isCountHistoryVisible,
      setIsCountHistoryVisible,
      recommendationScope,
      setRecommendationScope,
      roundOutcomes,
      roundResults,
      forceShuffle,
      localCorrections,
      correctCard,
    }),
    [
      isAuthenticated,
      isGuest,
      username,
      selectedSeat,
      isSpectating,
      analysis,
      live,
      holding,
      isDemo,
      analysisAccount,
      seatsKnown,
      scopeChoice,
      occupancy,
      players,
      playersView,
      turnControls,
      dealer,
      recommendation,
      countHistory,
      countHistoryView,
      countStats,
      shoeStats,
      analysis,
      midShoeJoin,
      cameraConnected,
      isCountHistoryVisible,
      recommendationScope,
      roundOutcomes,
      roundResults,
      localCorrections,
    ]
  );

  return (
    <AppStateContext.Provider value={value}>
      <CameraLinkContext.Provider value={linkValue}>{children}</CameraLinkContext.Provider>
    </AppStateContext.Provider>
  );
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used within AppStateProvider");
  return ctx;
}

export function useCameraLink() {
  const ctx = useContext(CameraLinkContext);
  if (!ctx) throw new Error("useCameraLink must be used within AppStateProvider");
  return ctx;
}
