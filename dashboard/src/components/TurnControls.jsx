import React from "react";
import { useAppState } from "../state/AppStateContext.jsx";

/**
 * TurnControls
 * Previous / Next player, in the Active Players header. The camera guesses
 * whose turn it is from the cards; these move that turn by hand, so the
 * Recommendation follows the right hand. Hands go in play order: seat 1 to 6,
 * split hand 1 before hand 2. The adjustment is for this viewer and holds
 * until the camera's own guess moves on (a card lands) or the round ends.
 */
export default function TurnControls({ compact = false }) {
  const { turnControls } = useAppState();
  const style = { padding: compact ? "4px 10px" : "5px 12px", fontSize: compact ? "0.7rem" : "0.76rem" };
  return (
    <div style={{ display: "flex", gap: 8 }} role="group" aria-label="Whose turn">
      <button
        type="button"
        className="hlo-btn hlo-btn--ghost"
        style={style}
        disabled={!turnControls.canPrevious}
        onClick={turnControls.previous}
        title="Move the turn back to the previous hand"
      >
        ← Previous player
      </button>
      <button
        type="button"
        className="hlo-btn hlo-btn--ghost"
        style={style}
        disabled={!turnControls.canNext}
        onClick={turnControls.next}
        title="Move the turn on to the next hand"
      >
        Next player →
      </button>
    </div>
  );
}
