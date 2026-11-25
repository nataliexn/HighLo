# HighLo Camera Server

Turns your phone into the table camera for HighLo, like DroidCam, but built for HighLo.

Run taskkill /f /im python.exe in cmd to terminate
```
 phone browser  --video-->  this server  --live video + card boxes-->  HighLo (browser)
 (camera page)              OpenCV + YOLO
```

1. Your phone opens a web page served by this program and streams its camera to it.
2. The server runs your YOLO card model on the newest frame (if you have one).
3. HighLo connects to the server by itself and goes live as soon as the phone's camera is on.

Nothing is installed on the phone. It only needs a browser.

## What you need

- **Python 3.10 or newer** on the computer that will run the server
- The phone and that computer on the **same Wi-Fi network**
- A card-detection model file (`.pt`) if you want boxes drawn on the cards. Without one the server still streams video.

## Set up (once)

```bash
cd highlo-camera-server
python -m venv .venv
# Windows:  .venv\Scripts\activate        Mac/Linux:  source .venv/bin/activate
pip install -r requirements.txt
```

`ultralytics` is a large download (it brings PyTorch). If you only want to test the phone connection first, delete that line from `requirements.txt` before installing. The server detects it is missing and streams video only.

## Run it

```bash
python main.py
```

The first run creates a private access token (saved in `.env`) and a self-signed HTTPS certificate (in `certs/`). The terminal then shows a QR code and two values for HighLo.

**On the phone**
1. Scan the QR code with the phone's camera app and open the link.
2. The browser warns that the connection is not private. That is expected: the certificate is yours. Choose *Advanced*, then *Proceed*.
3. Tap **Start camera** and allow camera access. Prop the phone above the table and keep the page open in front.

**In HighLo** (once)
1. Open the server address from the terminal (for example `https://192.168.1.20:8443`) in the same browser you use for HighLo and accept the same warning.
2. Click **Camera** in HighLo's top bar, enter the **server address** and **access token**, and save.

From then on HighLo reconnects on its own. The Camera button turns green and the live feed panel switches from mock data to your phone's video the moment the phone's camera starts, and returns to mock data if it stops.

## Adding your card model

Put your trained model at `models/cards.pt` (or set `MODEL_PATH` in `.env`) and restart. Class names are read as card codes. These all work:

`KH`, `10D`, `AS` (compact) and `king of hearts`, `ten_of_clubs` (spelled out).

Other class names are still drawn, just without a HighLo card code. Tune `CONF` (minimum confidence), `IMGSZ` and `DEVICE` in `.env`. On a laptop without a GPU, a small model (nano or small) at `IMGSZ=640` is a sensible start.

> **Licence:** HighLo is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**; see the `LICENSE` file at the root of the repository. The card detector uses Ultralytics YOLO, which is itself AGPL-3.0, so the project as a whole follows the same licence. If you modify it and let other people use it over a network, you must offer them the source code. Not legal advice: read the licence before redistributing or selling anything built on this.

## How it is protected

- **HTTPS on your network.** Browsers only allow camera access on secure pages, and the video never travels unencrypted.
- **Two separate secrets.** The *phone token* is new every time the server starts and travels in the QR code's `#` part, which the browser never sends to a server. The page removes it from the address bar after reading it. The *viewer token* lets HighLo watch, is stored only in `.env`, and cannot be used to send video.
- **Sign-in is the first message** on each WebSocket, with a 5-second deadline and a constant-time comparison. After 8 failures in a minute an address is locked out for a while.
- **Only known websites can connect.** The viewer socket accepts the HighLo addresses listed in `ALLOWED_ORIGINS` (default: `http://localhost:5173`). Add your deployed HighLo address there, for example `https://your-app.vercel.app`. The phone socket accepts only the server's own page.
- **The video stream needs a short-lived ticket** that HighLo receives after signing in, so the access token never appears in a URL.
- **Frames are checked.** Only JPEGs under `MAX_FRAME_BYTES` are accepted. Only one phone can be connected, and a newly authenticated phone replaces the old one.
- **Strict page rules** (Content-Security-Policy, no referrer, no caching) on the phone page.

Keep `.env` and `certs/` private (they are in `.gitignore`). If you think the viewer token has leaked, delete the `VIEWER_TOKEN` line from `.env` and restart to get a new one.

## Using the deployed (Vercel) HighLo with everyone at the table

The phone that films the table stays on your Wi-Fi as before (the QR code). The people **watching** on their phones
may be on any network, so give the server a public HTTPS address with a tunnel and share one link.

1. Install Cloudflare's `cloudflared` once (`winget install --id Cloudflare.cloudflared` on Windows).
2. With `python main.py` running, in a second terminal:

   ```bash
   cloudflared tunnel --url https://localhost:8443 --no-tls-verify
   ```

   It prints an address like `https://something-random.trycloudflare.com`. Its certificate is trusted, so nobody
   has to accept a warning. The address changes every time you start the tunnel.
3. Make sure your HighLo URL is in `ALLOWED_ORIGINS` (for example `https://highlo-black.vercel.app`).
4. In HighLo, log in as **camera**, open **Camera**, enter the tunnel address and the viewer token, and save.
5. In the same dialog, **Copy link** (or **Share…**) under *Table link* and send it to the table. Opening it connects
   their HighLo to the camera; nobody else needs to type anything. The token travels in the part of the link after
   `#`, which Vercel never receives, but anyone holding the link can watch, so share it only with the table.

Without a tunnel the link only works on the same Wi-Fi, and only after each phone has opened the server address
once and accepted the certificate warning.

All tunnel traffic reaches the server from one address, so eight wrong tokens in a minute lock out every viewer for
a minute. The mobile screens don't load the video, so many phones watching costs little upload.

## Settings (`.env`)

See `.env.example`: `PORT`, `ALLOWED_ORIGINS`, `MODEL_PATH`, `CONF`, `IMGSZ`, `DEVICE`, `TLS`, `EXTRA_SANS`, `MAX_FRAME_BYTES`, and the two tokens.

## Troubleshooting

| Problem | Likely cause |
| --- | --- |
| Phone page says "Not paired" | Open the link from the terminal or QR code again. The code changes each restart. |
| Phone says camera needs HTTPS | You opened a plain `http://` address. Use the `https://` link. |
| HighLo says "server offline" | Open the server address once in that browser and accept the warning. Check the computer's firewall allows the port (default 8443). |
| HighLo says "wrong token" | Copy the viewer token from `.env` again. |
| HighLo says "site not allowed" | Add HighLo's address to `ALLOWED_ORIGINS` and restart. |
| Video but no boxes | No model loaded. The terminal says so at start-up. |
| Video lags | Lower the quality on the phone page, use a smaller model or `DEVICE=0` for a GPU. |
| Server cannot be found from the phone | Both devices must be on the same Wi-Fi. Some guest networks isolate devices from each other. |

## Tests

```bash
python -m unittest discover -s tests -v
```

`tests/test_engine.py` covers the table engine (cards counted once, hole card, rounds, mid-shoe join, shuffle, seats,
splits, doubles, short dropouts). `tests/test_detector.py` covers reading card angles from an oriented-box model.

The server tests cover sign-in, rejection of wrong tokens and unknown sites, lock-out, the phone-to-HighLo path (status, detections, video stream) with a fake detector, and certificate creation.

## Calibration (the camera frame is the reference)

The phone stand is always at the same distance, so the server is calibrated against a real frame from it:
`calibration/reference.jpg` (a snapshot taken with the **Take snapshot** button). `calibrate.py` lines your
empty-board photo up with that frame (SIFT + RANSAC) and works out where the six seats, the dealer, the shoe and the
discard pile are in the camera's picture.

```bash
python calibrate.py --board ../image-references/empty-board.jpg --layout ../highlo-dataset/highlo-dataset/layout.json --frame calibration/reference.jpg
```

It writes `calibration/calibration.json` (used by the server) and `calibration/zones_preview.jpg`. **Open the preview
and check the yellow seat boxes sit on the seat outlines.** Re-run it, with a new snapshot, whenever the stand or the
board moves. Without `calibration.json` the server still relays video and card boxes, but does no table tracking.

## Table tracking

With a model **and** a calibration the server turns card boxes into table state and sends it to HighLo
(`{"type":"state", ...}`: players, dealer, count history, shoe stats, mid-shoe flag):

- Each physical card is tracked and shown after about half a second of steady detection. It goes into the running
  count only once its label has **held for 1.5 seconds** (`COUNT_SETTLE_SECONDS`), and is counted **once** however
  long it stays on the table. A flickering misread is outvoted by the frames around it.
- **The count matches the cards on the table.** If the model changes its mind about a card, the entry is replaced,
  not added. A card that disappears and is seen again in the same spot within `REPLACE_SECONDS` (4) (covered by a
  hand, or relabelled) takes over its old entry. A counted card that vanishes after less than `FLEETING_SECONDS` (4)
  on the table, and isn't seen again, was a misread and is taken back out. Real cards taken away (a bust hand, the
  sweep) stay counted. Two boxes on one card (same rank, one mostly inside the other) count as one card.
- The dealer's hole card shows as hidden only while a face-down card is actually seen, and turns face up after two
  face-up sightings.
- Every card has a stable id (`ids` next to `cards`, and `id` in the count history) that survives relabelling, so a
  correction made in HighLo stays on that card.
- Cards are dealt from the shoe across other seats, so a card is placed **where it comes to rest**: it is shown,
  counted and tied to a seat only after lying still for `REST_SECONDS` (0.6). A card resting on or against a seat's
  cards joins that hand. Cards are sorted into the dealer and seats 1-6 by their position. The dealer's face-down card is shown face down and
  only counted when it is turned over.
- A round ends when the table has been cleared for a couple of seconds.
- "Whose turn" is a guess from the cards (everyone has two cards, then whoever just took a card). Real turns need
  gesture recognition, which is not built yet.

### Seats and joining mid-round

- **Seats** count as occupied as soon as they get their first card, so players can pick their seat straight away.
  When the opening deal is complete (the dealer has two cards and every seat that has a card has two) the seats
  are fixed and remembered, even while the table is swept, until the next opening deal. A seat dealt last round but
  not this one is vacant. A seat that gets a card after that (one the deal check missed) is added. HighLo uses this
  to take someone out of a seat that is no longer in play.
- **Splits** are only looked for once the opening deal is complete (everyone has two cards), and only once per seat.
  When a seat's first two cards are a pair (any two ten-value cards count) and they sit side by side across the seat,
  more than `SPLIT_SEPARATION` card widths (0.7) apart, each on about half of the box, the seat has two hands. Cards
  stacked towards the dealer (a normal hit) don't count, only the sideways distance does. Each later card joins the
  hand it lies nearest. Hand 1 is the one on the dealer's left (the right of the picture) and is played first.
- **Double downs.** A card lying sideways (more than `SIDEWAYS_DEGREES`, 45, from its seat's upright) marks the hand
  doubled and finished, and the turn moves on. This needs an oriented-box model (`yolo obb`, see the dataset README),
  which reports each card's angle. With an ordinary detect model doubles aren't recognised. A card's angle is read
  when it is confirmed, while it is still on top and fully visible.
- **Card placement.** A hand's first card has its top edge on the middle of the seat box, and every next card goes on
  top, towards the dealer. The discard pile and the shoe sit at the board's top corners.
- **Short dropouts.** If frames stop for up to `GAP_SECONDS` (15 s), for example on a weak network, the engine
  assumes the table didn't change: the cards stay and nothing is counted twice. After a longer gap it starts over.
  HighLo also keeps the last table on screen for 15 s after it loses the camera.
- **Joining mid-round.** If cards are already on the table a few seconds after the server starts, they are not shown
  or counted. Once every one of them has been swept away, the next card starts a new round and tracking begins.
- One physical card that the model labels twice (for example QH and QD) is counted once.

### Joining a shoe that is already in progress

If the camera starts while **cards are in the discard pile**, the shoe is marked *mid-shoe*: the cards already played
were never counted, so the running count cannot be trusted. HighLo then shows a banner, labels the count unreliable,
and recommends from the **basic-strategy (hit) chart** only. When the discard pile is picked up and stays gone for a
few seconds between rounds (a shuffle), the server switches to *counting* and the count restarts from zero.
Everything else, including count-based plays like 16 vs 10, is used only when the shoe is *counting*.

The tuning numbers (seconds to confirm a card, to end a round, to call a shuffle) are constants at the top of `engine.py`.

## What this does not do yet

- Gesture recognition (hit / stand), and who is really "in turn".
- It has not been trained or tested with a real card model, and the live HTTPS path was checked with an automated test
  client rather than a real phone. The table engine is tested with simulated detections, not a real game yet.
- A moved stand needs a new snapshot and `calibrate.py` re-run.
