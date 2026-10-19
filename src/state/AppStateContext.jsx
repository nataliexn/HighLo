import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import config from "../config.js";
import { handValue } from "../components/Card.jsx";
import { computeCountStats, hiLoValue, TOTAL_DECKS } from "../lib/count.js";
import { connectCameraLink } from "../lib/cameraLink.js";
import {
  defaultOccupancy,
  defaultPlayers,
  defaultDealer,
  defaultRecommendation,
  defaultCountHistory,
  defaultShoeStats,
  defaultAnalysis,
  defaultMidShoeJoin,
  CURRENT_HAND_CARD_COUNT,
} from "./mockData.js";

const AppStateContext = createContext(null);
// Camera-link data changes many times a second (detection boxes), so it
// lives in its own context: only the components that draw it re-render.
const CameraLinkContext = createContext(null);

const LINK_STORAGE_KEY = "highlo:cameraLink";
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

function loadLinkSettings() {
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

const SEAT_STORAGE_KEY = "highlo:selectedSeat";

// Per-device storage for everything a user can change locally: their
// card corrections, the Running Count history those corrections edit,
// and the shoe stats a manual Shuffle resets. Stored in this browser only
// (never shared with other users), and deliberately NOT keyed by seat, so
// switching seats keeps the same history. The version segment lets a
// future change to the data shape start clean instead of loading stale
// data saved by an older build.
const LOCAL_STATE_PREFIX = "highlo:v3:";

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

export function AppStateProvider({ children }) {
  // ---- Auth / session -------------------------------------------------
  // isGuest=true and isAuthenticated=false are the sane defaults for a
  // fresh visit; nothing here is left undefined.
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isGuest, setIsGuest] = useState(false);
  const [username, setUsername] = useState("");

  // ---- Seat selection ---------------------------------------------------
  const [selectedSeat, setSelectedSeatState] = useState(() => {
    const stored = window.localStorage.getItem(SEAT_STORAGE_KEY);
    return stored ? Number(stored) : null;
  });

  function setSelectedSeat(seat) {
    setSelectedSeatState(seat);
    if (seat) {
      window.localStorage.setItem(SEAT_STORAGE_KEY, String(seat));
    } else {
      window.localStorage.removeItem(SEAT_STORAGE_KEY);
    }
  }

  // ---- Live table data --------------------------------------------------
  // Defaults to a fully-populated mock hand so the dashboard always reads
  // as "a game is happening". The detection socket effect below is where a
  // real Raspberry Pi feed would overwrite these with live detections.
  const [occupancy, setOccupancy] = useState(defaultOccupancy);
  const [players, setPlayers] = useState(defaultPlayers);
  const [dealer, setDealer] = useState(defaultDealer);
  const [recommendation, setRecommendation] = useState(defaultRecommendation);
  // Everyone starts from the same default history; after that, each
  // user's edits (and manual Shuffle) live only in their own browser.
  const [countHistory, setCountHistory] = useState(() => loadLocal("countHistory", defaultCountHistory));
  const [shoeStats, setShoeStats] = useState(() => loadLocal("shoeStats", defaultShoeStats));
  const [analysis, setAnalysis] = useState(defaultAnalysis);
  const [midShoeJoin] = useState(defaultMidShoeJoin);
  // Phone camera link (see lib/cameraLink.js). Settings live in this browser.
  const [linkSettings, setLinkSettings] = useState(loadLinkSettings);
  const [cameraLink, setCameraLink] = useState(OFFLINE_LINK);
  const live = cameraLink.serverOnline && cameraLink.phoneOnline && cameraLink.cameraOpen;
  const cameraConnected = live || Boolean(config.CAMERA_STREAM_URL);
  const [isCountHistoryVisible, setIsCountHistoryVisible] = useState(true);

  // Controls whether the Recommendation component shows every seat's
  // recommendation as each turn happens ("all") or only surfaces one when
  // it's this viewer's own seat's turn ("mine"). Desktop only — mobile is
  // always forced to "mine" regardless of this value (see RecommendationPanel).
  const [recommendationScope, setRecommendationScope] = useState("all");

  // Seat -> "win" | "lose" | "push", shown as a tinted overlay for a few
  // seconds after the dealer's hand resolves. See resolveRoundDemo().
  const [roundOutcomes, setRoundOutcomes] = useState({});

  // Per-user card corrections. Keyed by "seat-handIndex-cardIndex" (seat
  // can be a numeric seat or the string "dealer") so a correction only
  // ever affects this browser's view, never the shared detection state.
  const [localCorrections, setLocalCorrections] = useState(() => loadLocal("localCorrections", {}));

  useEffect(() => saveLocal("countHistory", countHistory), [countHistory]);
  useEffect(() => saveLocal("shoeStats", shoeStats), [shoeStats]);
  useEffect(() => saveLocal("localCorrections", localCorrections), [localCorrections]);

  function correctCard(seat, handIndex, cardIndex, newCode) {
    setLocalCorrections((prev) => ({
      ...prev,
      [`${seat}-${handIndex}-${cardIndex}`]: newCode,
    }));
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
  const countStats = useMemo(() => computeCountStats(countHistory, TOTAL_DECKS), [countHistory]);

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
      const nonMarkerEntries = prev.filter((e) => !e.isShuffleMarker);
      const referenceHand = nonMarkerEntries.slice(-CURRENT_HAND_CARD_COUNT);
      return [...referenceHand, { isShuffleMarker: true }];
    });
    setShoeStats((prev) => ({ ...prev, handsSinceShuffle: 0 }));
  }

  // ---- Demo: resolve the round (win/lose/push overlay, then reset) ------
  // Reveals the dealer's hole card, tints every occupied seat green/red/
  // yellow against the dealer's final total, then after 3 seconds clears
  // the tint and deals a fresh mock hand ("next hand begins").
  function resolveRoundDemo() {
    setDealer((prev) => ({ ...prev, holeCardKnown: true }));
    setPlayers((currentPlayers) => {
      const dealerTotal = handValue(dealer.cards);
      const dealerBust = dealerTotal > 21;
      const outcomes = {};
      currentPlayers.forEach((p) => {
        if (!p.occupied) return;
        const total = handValue(p.hands[0].cards);
        if (total > 21) {
          outcomes[p.seat] = "lose";
        } else if (dealerBust) {
          outcomes[p.seat] = "win";
        } else if (total > dealerTotal) {
          outcomes[p.seat] = "win";
        } else if (total < dealerTotal) {
          outcomes[p.seat] = "lose";
        } else {
          outcomes[p.seat] = "push";
        }
      });
      setRoundOutcomes(outcomes);
      return currentPlayers;
    });

    setTimeout(() => {
      setRoundOutcomes({});
      setPlayers(defaultPlayers);
      setDealer(defaultDealer);
      setLocalCorrections({});
    }, 3000);
  }

  // ---- Phone camera link -------------------------------------------------
  // Connects to the camera server whenever address + token are saved, and
  // reconnects by itself. HighLo goes live the moment the server reports the
  // phone online with its camera open; until then the mock table stays.
  useEffect(() => {
    setCameraLink(OFFLINE_LINK);
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
            // Full table state from the server (see README "Connecting the camera").
            if (event.occupancy) setOccupancy(event.occupancy);
            if (event.players) setPlayers(event.players);
            if (event.dealer) setDealer(event.dealer);
            if (event.recommendation) setRecommendation(event.recommendation);
            if (event.countHistory) setCountHistory(event.countHistory);
            if (event.shoeStats) setShoeStats(event.shoeStats);
            break;
          default:
            break;
        }
      },
    });
    return () => link.close();
  }, [linkSettings]);

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
    () => ({ ...cameraLink, live, settings: linkSettings, saveLinkSettings, clearLinkSettings }),
    [cameraLink, live, linkSettings]
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
      },
      continueAsGuest: () => {
        setIsGuest(true);
        setIsAuthenticated(false);
        setUsername("Guest");
      },
      logout: () => {
        setIsAuthenticated(false);
        setIsGuest(false);
        setUsername("");
        setSelectedSeat(null);
      },
      selectedSeat,
      setSelectedSeat,
      occupancy,
      players,
      dealer,
      recommendation,
      countHistory,
      countStats,
      shoeStats,
      analysis,
      midShoeJoin,
      cameraConnected,
      isCountHistoryVisible,
      setIsCountHistoryVisible,
      recommendationScope,
      setRecommendationScope,
      roundOutcomes,
      resolveRoundDemo,
      forceShuffle,
      localCorrections,
      correctCard,
    }),
    [
      isAuthenticated,
      isGuest,
      username,
      selectedSeat,
      occupancy,
      players,
      dealer,
      recommendation,
      countHistory,
      countStats,
      shoeStats,
      analysis,
      midShoeJoin,
      cameraConnected,
      isCountHistoryVisible,
      recommendationScope,
      roundOutcomes,
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
