import React, { useState } from "react";
import { createPortal } from "react-dom";
import Card, { ShuffleMarkerCard, HiddenCardMarker } from "./Card.jsx";
import { useAppState } from "../state/AppStateContext.jsx";

function ForceShuffleConfirm({ onCancel, onConfirm }) {
  return createPortal(
    <div
      role="dialog"
      aria-label="Confirm force shuffle"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(8,10,9,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 200,
        padding: 20,
      }}
    >
      <div className="hlo-panel" style={{ width: 420, maxWidth: "100%" }}>
        <div className="hlo-panel__header">
          <h3 className="hlo-panel__title" style={{ fontSize: "1.1rem" }}>
            Shuffle?
          </h3>
        </div>
        <div className="hlo-panel__body">
          {/* margin: 0 cancels the browser's default <p> top margin,
              which was stacking on top of the panel body's own padding
              and making the gap above the text noticeably bigger than
              the gap below it (marginBottom here matches the button
              row's own gap below, so both sides read as the same size). */}
          <p style={{ fontSize: "0.85rem", color: "var(--white-dim)", lineHeight: 1.6, margin: "0 0 16px" }}>
            This clears the card history and count back to zero, the same as if the camera had just
            detected a real shuffle. Only the hand currently in play is kept, as a reference point
            after the new marker. This can't be undone.
          </p>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="hlo-btn hlo-btn--ghost" style={{ flex: 1 }} onClick={onCancel}>
              Cancel
            </button>
            <button className="hlo-btn hlo-btn--primary" style={{ flex: 1 }} onClick={onConfirm}>
              Shuffle
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * CountHistory
 * `showStats`: when true (the Master View usage), shows the panel's own
 *   "Running Count" header title and its full stats row. The dedicated
 *   Running Count page passes `showStats={false}` since it renders those
 *   same numbers itself, as page-level stat boxes, instead.
 * `masterView`: when true (the Master View usage ONLY), the card history
 *   starts collapsed down to just the current hand's cards — mirroring
 *   how the Recommendation panel also shows a trimmed-down view on Master
 *   View — with a button to expand to the full history since the last
 *   shuffle (the pre-shuffle reference cards, every earlier hand this
 *   shoe, and the current hand). The dedicated Running Count page and the
 *   mobile view leave this false, so they always show the full history.
 */
export default function CountHistory({ showStats = true, masterView = false }) {
  const { countHistory, countStats, shoeStats, isCountHistoryVisible, setIsCountHistoryVisible, forceShuffle, midShoeJoin } =
    useAppState();
  const [confirmingShuffle, setConfirmingShuffle] = useState(false);
  const [expanded, setExpanded] = useState(!masterView);

  // The hand in progress is the newest one in the history (the camera numbers
  // hands itself, so this can't be a fixed constant).
  const latestHand = countHistory.reduce((m, e) => (e.isShuffleMarker ? m : Math.max(m, e.hand ?? 0)), 0);
  const visibleHistory =
    masterView && !expanded ? countHistory.filter((entry) => entry.hand === latestHand) : countHistory;

  // Newest card first (top-left), oldest last (bottom-right) — cards wrap
  // to new rows below rather than ever scrolling sideways. Each item keeps
  // its original chronological index as its key so existing cards never
  // remount (and thus never re-animate) just because a new one was added
  // at the front of the display order.
  const displayOrder = visibleHistory.map((entry, idx) => ({ entry, idx })).reverse();
  const newestIdx = visibleHistory.length - 1;

  // Group consecutive entries that share the same `hand` number into one
  // block, each with its own "Current hand" / "Hand N" label — the
  // indicator for which cards belong to one hand and where a new hand
  // begins. A shuffle marker always breaks the run and renders as its own
  // standalone item between hand groups, never merged into one.
  const groups = [];
  displayOrder.forEach(({ entry, idx }) => {
    if (entry.isShuffleMarker) {
      groups.push({ key: `marker-${idx}`, isShuffleMarker: true });
      return;
    }
    const last = groups[groups.length - 1];
    if (last && !last.isShuffleMarker && last.hand === entry.hand) {
      last.items.push({ entry, idx });
    } else {
      groups.push({ key: `hand-${entry.hand}-${idx}`, hand: entry.hand, items: [{ entry, idx }] });
    }
  });

  return (
    <div className="hlo-panel">
      <div className="hlo-panel__header" style={{ flexWrap: "wrap", rowGap: 6 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          {showStats && <h3 className="hlo-panel__title">Running Count</h3>}
          {!isCountHistoryVisible && (
            <span style={{ fontSize: "0.78rem", color: "var(--white-faint)" }}>
              Cards hidden — practicing mental counting
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {masterView && (
            <button
              className="hlo-btn hlo-btn--ghost"
              style={{ padding: "5px 12px", fontSize: "0.8rem" }}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Show current hand only" : "Show full history"}
            </button>
          )}
          <button
            className="hlo-btn hlo-btn--ghost"
            style={{ padding: "5px 12px", fontSize: "0.8rem" }}
            onClick={() => setConfirmingShuffle(true)}
            title="Manually mark a shuffle — resets the history and count, same as a camera-detected shuffle"
          >
            Shuffle
          </button>
          <button
            className="hlo-btn hlo-btn--ghost"
            style={{ padding: "5px 12px", fontSize: "0.8rem" }}
            onClick={() => setIsCountHistoryVisible((v) => !v)}
          >
            {isCountHistoryVisible ? "Hide" : "Reveal"}
          </button>
        </div>
      </div>
      <div className="hlo-panel__body">
        {showStats && (
          <div style={{ display: "flex", gap: 28, marginBottom: 16, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: "0.7rem", color: "var(--white-faint)" }}>
                Running count{midShoeJoin.isMidShoeJoin ? " (unreliable — joined mid-shoe)" : ""}
              </div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: "2rem" }}>{countStats.runningCount}</div>
            </div>
            <div>
              <div style={{ fontSize: "0.7rem", color: "var(--white-faint)" }}>True count</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: "2rem" }}>
                {countStats.trueCount.toFixed(1)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: "0.7rem", color: "var(--white-faint)" }}>Cards counted</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: "2rem" }}>{countStats.cardsCounted}</div>
            </div>
            <div>
              <div style={{ fontSize: "0.7rem", color: "var(--white-faint)" }}>Est. decks remaining</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: "2rem" }}>
                {countStats.decksRemaining.toFixed(1)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: "0.7rem", color: "var(--white-faint)" }}>Hands since shuffle</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: "2rem" }}>{shoeStats.handsSinceShuffle}</div>
            </div>
          </div>
        )}

        {/* The block of cards as a whole is centered within the panel
            (so a short history that fits on one line sits centered
            rather than pinned to the left edge), but the cards WITHIN
            that block stay left-aligned — each wrapped row starts from
            the left rather than every row being individually centered.
            `maxWidth: 100%` + `minWidth: 0` on the inner row cap it at
            the panel's actual width: without them a flex item defaults
            to its content's full unwrapped width, which could overflow
            past the panel on a narrow (mobile) screen instead of
            actually wrapping, throwing the centering off. */}
        {groups.length === 0 && (
          <p style={{ margin: "4px 0 0", textAlign: "center", fontSize: "0.82rem", color: "var(--white-faint)" }}>
            Nothing counted yet. Counting starts with the next round.
          </p>
        )}
        <div style={{ display: "flex", justifyContent: "center", width: "100%" }}>
          <div className="hlo-card-row" style={{ maxWidth: "100%", minWidth: 0 }}>
            {groups.map((group) =>
              group.isShuffleMarker ? (
                <ShuffleMarkerCard key={group.key} />
              ) : (
                <div key={group.key} className="hlo-hand-group">
                  <div className="hlo-hand-group__label">
                    {group.hand === latestHand ? "Current hand" : `Hand ${group.hand}`}
                  </div>
                  <div className="hlo-hand-group__cards">
                    {group.items.map(({ entry, idx }) =>
                      entry.isHiddenCard ? (
                        <HiddenCardMarker key={`entry-${idx}`} />
                      ) : (
                        <Card
                          key={`entry-${idx}`}
                          code={entry.card}
                          variant="count"
                          countValue={entry.value}
                          hidden={!isCountHistoryVisible}
                          animate={idx === newestIdx}
                        />
                      )
                    )}
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      </div>

      {confirmingShuffle && (
        <ForceShuffleConfirm
          onCancel={() => setConfirmingShuffle(false)}
          onConfirm={() => {
            forceShuffle();
            setConfirmingShuffle(false);
          }}
        />
      )}
    </div>
  );
}
