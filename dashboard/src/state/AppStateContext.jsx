import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import config from "../config.js";
import { computeCountStats, hiLoValue, TOTAL_DECKS } from "../lib/count.js";
import { connectCameraLink } from "../lib/cameraLink.js";
import {
  emptyOccupancy,
  emptyPlayers,
  emptyDealer,
  emptyShoeStats,
  emptyAnalysis,
  analysisFor,
  defaultRecommendation,
  defaultMidShoeJoin,
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
  const analysis = useMemo(() => {
    const base = isAuthenticated ? analysisFor(username) : emptyAnalysis();
    return { ...base, handsPlayed: base.handsPlayed + (extraHands[accountKey] || 0) };
  }, [isAuthenticated, username, accountKey, extraHands]);

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
  const live = cameraLink.serverOnline && cameraLink.phoneOnline && cameraLink.cameraOpen;
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

  // Seat -> "win" | "lose" | "push", shown as a tinted overlay for a few
  // seconds after the dealer's hand resolves (not wired to the camera yet).
  const [roundOutcomes] = useState({});

  // Per-user card corrections. Keyed by "seat-handIndex-cardIndex" (seat
  // can be a numeric seat or the string "dealer") so a correction only
  // ever affects this browser's view, never the shared detection state.
  // They last for the current round only (cleared when a new round starts).
  const [localCorrections, setLocalCorrections] = useState({});

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

  useEffect(() => {
    if (!live || !serverState) {
      setOccupancy(emptyOccupancy());
      setSeatsKnown(false);
      setPlayers(emptyPlayers());
      setDealer(emptyDealer());
      setCountHistory([]);
      setShoeStats(emptyShoeStats());
      setMidShoeJoin(defaultMidShoeJoin);
      setLocalCorrections({});
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
      }
      if (event.roundActive && me.selectedSeat && event.players) {
        const mine = event.players.find((p) => p.seat === me.selectedSeat);
        if (mine && mine.hands[0].cards.length > 0) round.played = true;
      }
      // A round the user sat through has ended: it counts towards their analysis
      // (only when logged in AND sitting, never for a spectator or a guest).
      if (!event.roundActive && round.active && round.played && me.isAuthenticated && me.selectedSeat) {
        setExtraHands((prev) => ({ ...prev, [me.accountKey]: (prev[me.accountKey] || 0) + 1 }));
        round.played = false;
      }
      round.active = event.roundActive;
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
      seatsKnown,
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
      seatsKnown,
      scopeChoice,
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
