# HighLo

A blackjack table assistant. A phone watches a real table, a computer-vision model reads the cards, and a web
dashboard shows the count, each hand and a recommended move.

This repository holds all three parts:

| Folder | What it is | Where it runs |
| --- | --- | --- |
| [`dashboard/`](dashboard) | HighLo, the React/Vite web app: live table, running count, strategy chart, analysis | Vercel (or `npm run dev`) |
| [`camera-server/`](camera-server) | Receives the phone's video, detects cards with YOLO, tracks the table and sends it to HighLo | Your computer, on the same Wi-Fi as the phone |
| [`dataset/`](dataset) | Builds a synthetic, labelled training set from your own card and board photos | Your computer (training needs an NVIDIA GPU or Colab) |

```
phone browser --video--> camera-server --card boxes + table state--> dashboard
                          (YOLO + table engine)                       (count, recommendations)

your photos --dataset/--> synthetic pictures --YOLO training--> cards.pt --> camera-server/models/
```

## How it fits together

1. **Make a training set.** `dataset/` turns photos of your cards and empty board into thousands of labelled pictures
   framed like your real camera.
2. **Train a model** with Ultralytics YOLO and put the result in `camera-server/models/cards.pt`.
3. **Calibrate.** Take a snapshot from the phone page and run `camera-server/calibrate.py`, so the server knows where
   the seats, dealer, shoe and discard pile are.
4. **Run the camera server**, open its `/camera` page on your phone, and connect the dashboard to it.
5. The server counts every card once, follows rounds and shuffles, and tells the dashboard. If it starts while cards
   are already in the discard pile, HighLo treats the count as unreliable and recommends from the basic-strategy chart
   until the next shuffle.

Each folder has its own README with the exact commands:
[dashboard](dashboard/README.md) · [camera server](camera-server/README.md) · [dataset](dataset/README.md).

## Quick start (dashboard only)

```bash
cd dashboard
npm install
npm run dev
```

The dashboard runs on built-in demo data without the camera server. To deploy on Vercel from this repository, set the
project's **Root Directory** to `dashboard`.

## Status

A prototype. The dashboard and camera server work end to end with simulated detections; the card model, real-game
timing and gesture recognition (hit/stand) are still being developed.

## Licence

AGPL-3.0, see [LICENSE](LICENSE). The card detector uses [Ultralytics YOLO](https://github.com/ultralytics/ultralytics),
which is also AGPL-3.0, so the project as a whole follows the same licence. If you modify it and let other people use
it over a network, you must offer them the source code. This is not legal advice.

## Disclaimer

HighLo is a learning project. Recommendations are informational only, and card counting may be restricted by casino
rules or local law. Check the rules wherever you play. Your own card and board photos are not part of this repository.
