# HighLo

HighLo is a live table-assist dashboard for blackjack. A camera above the table reads the cards, and HighLo turns that into a basic-strategy recommendation, a Hi-Lo running count, and a play-style report for the player sitting at a seat. It works on desktop and mobile.

> **Status:** UI-complete prototype. All computer-vision data is currently **mocked** (see `src/state/mockData.js`). The camera, detection pipeline and backend are not connected yet.

---

## Features

### Accounts and seating
- Log in or register (simulated, no backend yet), or continue as a guest. Guests get recommendations and the running count, but no saved stats or play-style report.
- Seat selection on a curved table: dealer at the top, six seats running right to left, the way a real deal moves. Seat 1 is on the right.
- A required disclaimer, gated by a checkbox, before sitting down. The seat choice is remembered on the device.
- If the camera sees the player's seat go empty, they are asked to switch seats or end the session.

### Desktop Master View
- **Live table feed** with confidence-colored detection boxes for each seat and the dealer. The box for the seat in play is highlighted.
- **Recommendation panel** (see below).
- **Dealer and active players**: one row of up to six seats, plus the dealer's up card and face-down hole card.
- **Running count**, showing only the current hand by default. A "Show full history" button expands it.
- Expanded pages for the table, the running count and the analysis report.

### Recommendation
- Large colored action box: HIT, STAND, DOUBLE, SPLIT or SURRENDER.
- **Overall confidence**, which blends how sure the vision model is about the cards with how well the move matches basic strategy.
- A warning when card detection confidence drops below 70%.
- A basic-strategy chart row for the current hand against every dealer up card, with the real up card highlighted.
- Metrics with info tooltips: card detection confidence, dealer bust probability, running count and true count.
- Insurance advice whenever the dealer shows an Ace, based on the true count.
- A "Mid-shoe join" notice when tracking started after cards were already dealt.
- **Scope toggle** (desktop): show every seat's recommendation as each turn happens, or only on your own turn. Mobile is always "my turn only".

### Players and cards
- Hands are laid out in shapes for 2 to 6 cards. A split hand appears smaller, to the left of the main hand.
- Per-seat detection-confidence indicator, "BUST" and "21" overlays, and a win, lose or push tint when the round resolves.
- **Card correction**: tap any card to fix its rank or suit, or mark it unknown. Corrections update the running count as well.

### Running count
- Hi-Lo counting over a 6-deck shoe, with running count, true count, cards counted, estimated decks remaining and hands since shuffle.
- Card history is grouped by hand, with a "Current hand" or "Hand N" label on each group, so you can see where each hand starts and ends.
- The dealer's hole card shows as a "HIDDEN" placeholder and is not counted until it is revealed.
- A full-width "Shuffled" divider marks a shuffle. The hand before the shuffle stays visible for reference but is not part of the count.
- **Hide / Reveal** the cards for practicing counting in your head.
- **Shuffle** button for a manual shuffle. This only affects your own view.

### Analysis
- Play-style report: play style, risk profile, decision accuracy and betting behavior.
- Win rate per day logged in, plotted as a trend, with a written summary.
- Unlocks after a minimum number of hands.

### Mobile
- Dedicated screens: **Current Hand**, **Analysis** and **Running Count**, with a header and tab bar.
- Player-focused: no camera feed. It shows the dealer, the recommendation, and only the viewer's own hand.
- The recommendation collapses to the action box. Tap to expand the details.

### Local persistence
- Each user's card corrections, running-count history and manual shuffle are saved in their own browser (`localStorage`).
- They survive a refresh and a seat change, and are never shared with other users.
- Every new user starts from the same default mock history.

---

## Tech stack
- React 18, React Router 6, Vite
- Plain CSS (`src/index.css`) with design tokens
- Fonts: Inter (body), Bebas Neue (headings and big numbers), Space Mono (card ranks and tabular data)

## Getting started

```bash
npm install
npm run dev      # local dev server
npm run build    # production build
npm run preview  # preview the production build
```

## Project structure

```
src/
  App.jsx                 routing and desktop/mobile layouts
  config.js               endpoints for the camera, detection socket and API
  components/             Card, CameraFeed, ActivePlayers, Dealer, RecommendationPanel,
                          CountHistory, CardCorrectionModal, Nav, MobileHeader, MobileTabBar
  pages/                  Login, SeatSelection, MasterView, TableView, AnalysisView,
                          RunningCountView
  pages/mobile/           MobileCurrentHand, MobileAnalysis, MobileRunningCount
  lib/                    count.js (Hi-Lo, true count, insurance), strategy.js (basic strategy)
  state/                  AppStateContext.jsx (app state, local persistence), mockData.js
```

## Connecting the table hardware

All hardware hookups are in `src/config.js`. A value of `null` means "use mock data".

| Setting | Purpose |
| --- | --- |
| `CAMERA_STREAM_URL` | MJPEG/HLS stream. The camera feed swaps its placeholder for the live image. |
| `DETECTION_SOCKET_URL` | WebSocket that pushes detections as JSON: `{ occupancy, players, dealer, recommendation, countHistory, shoeStats }`. Any field you leave out keeps its last value. |
| `API_BASE_URL` | REST base for auth, gameplay history and analysis, once a backend exists. |

When the detection socket sends a new `countHistory`, it replaces the history for everyone connected. This is how a camera-detected shuffle will reach all users.

---

## Roadmap

These items are planned but not built yet.

**Hardware and detection**
- [ ] Connect the Raspberry Pi camera stream and the real-time detection socket
- [ ] Real card, seat and dealer detection with live confidence scores
- [ ] Gesture recognition (hit, stand, double, split) with a visible "gesture detected" cue
- [ ] Camera-detected shuffles that reset the count for everyone at the table
- [ ] Real round-start and round-end events, replacing the demo "Simulate round end" button
- [ ] Clear each seat's last action at the start of a new round

**Backend and accounts**
- [ ] Real authentication and account storage
- [ ] Saved gameplay history per user
- [ ] Persisted play-style analysis, built from each user's actual decisions
- [ ] Shared state across devices, so a user can pick up on another device

**Strategy and counting**
- [ ] Rules-accurate strategy engine (double after split, resplit limits, deck count, dealer stands or hits on soft 17)
- [ ] Dealer bust probability computed from the real up card and count, instead of a mock value
- [ ] Count-based play deviations (for example the Illustrious 18)
- [ ] Bet-size guidance tied to the true count

**Quality**
- [ ] Automated tests for the count, strategy and state logic
- [ ] Accessibility pass (keyboard navigation, screen-reader labels, contrast)
- [ ] Error and offline states for a lost camera or socket connection
- [ ] Remove demo-only controls once real events are wired in

## Disclaimer

HighLo is a prototype for learning and analysis. Recommendations are informational only, and card counting may be restricted by casino rules or local law. Check the rules wherever you play.
