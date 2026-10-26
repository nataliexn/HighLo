# HighLo card dataset maker

Turns your own photos into a labelled training set for the card detector.

```
your photos --extract_cards.py--> card cutouts --generate.py--> thousands of fake table photos + labels --> YOLO training
              layout_from_board.py -> where the seats / dealer / piles are
```

It uses **your real cards and your real board**, so the model learns what *your* deck and table look like.
Nothing here needs a GPU. Training does (see "Train").

## 1. Install (once)

```powershell
cd highlo-dataset
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## 2. Your photos

Put these in one folder (yours is `image-references`):

| File | What |
|---|---|
| `AS.jpg`, `2S.jpg` ... `10H.jpg`, `KC.jpg` | one face-up card per file, lying flat, photographed from above. Name = rank + suit: ranks `A 2 3 4 5 6 7 8 9 10 J Q K`, suits `S H D C`. All 52. |
| `empty-board.jpg` | the board with nothing on it, straight from above, whole board in frame |
| any `board-*.jpg` with a lone face-down card | used once to cut out a card back |

Tips for the card photos: keep the whole card in frame with a little margin, even light, no glare, and nothing else white nearby.

## 3. Run the three steps (ALREADY RAN. DO NOT RUN AGAIN)

```powershell
$IMG = "C:\Users\natal\Desktop\Fall 2026\emergin\image-references" 

python extract_cards.py --src $IMG
#   -> assets/cards/*.png, assets/back.png, assets/cards_contact_sheet.jpg
#   OPEN the contact sheet. Every card should be straight, complete and white. It lists any missing cards.

python layout_from_board.py --board "$IMG\empty-board.jpg"
#   -> layout.json   (it should say "found 6 seat outlines")

python generate.py --board "$IMG\empty-board.jpg" --count 3000 --workers 4
#   -> dataset/images, dataset/labels, dataset/data.yaml, dataset/preview/*.jpg
```

Look at a few files in `dataset/preview/` (boxes drawn on). If those look right, the labels are right.
3000 pictures take roughly 10 minutes with 4 workers.

## What the pictures contain

- dealer cards in a row, sometimes with a face-down hole card
- 0-6 seats, each a fanned hand of 1-6 cards where later cards sit on top and the corner of the earlier ones shows
- the discard pile and shoe (stacks of backs)
- a phone-like camera: board 75-95% of the frame, small tilt and perspective skew, floor around it
- phone-like photos: bright / dim, warm / cool, uneven light, glare, slight blur, noise, JPEG

**Labels are the part of each card you can actually see**, not the whole card. A card that is almost
completely covered gets no label. Classes: the 52 cards (`AS 2S ... KC`) plus `back` (any face-down card:
a hole card, the discard pile, the shoe). Zone logic later decides which backs matter.

## 4. Train

On a machine with an NVIDIA GPU (or free Google Colab):

```powershell
pip install ultralytics
yolo detect train data=dataset/data.yaml model=yolov8s.pt imgsz=1088 epochs=100 batch=8 fliplr=0 flipud=0 degrees=8
```

- **`fliplr=0 flipud=0` matters.** The default mirrors pictures, which turns every suit and number backwards.
- `imgsz=1280` matters: a card is only about 7% of the picture width, so its corner symbol is tiny.
- Slow GPU or out of memory? Use `batch=4`, or `model=yolov8n.pt`.

Result: `runs/detect/train/weights/best.pt`. Install it:

1. Copy it to `highlo-camera-server/models/cards.pt`
2. In the camera server's `.env` set `IMGSZ=1088` (and `DEVICE=0` for an NVIDIA GPU)
3. Restart `python main.py`. The camera page / HighLo should now show card boxes.

## Be honest about the numbers

The validation score printed during training comes from fake pictures made from the *same* cutouts, so it will
look great (99%). It does **not** prove the model works on a real table. To find out:

1. Take 10-20 real photos from the phone stand (or save frames from the camera server) with cards dealt.
2. Label them (Roboflow or Label Studio) with the same 53 class names.
3. Put them in `dataset/images/val` + `dataset/labels/val`, replacing the fake ones, and run `yolo detect val`.

If real accuracy is poor, add those labelled real photos to `train` as well. A few dozen real photos on top
of the synthetic set helps far more than another 10,000 fake ones.

## Known limits

- One photo per card, so every `7H` looks identical. Real decks have bends, wear and a slightly different look
  under every light. More real photos always helps.
- The floor around the board is drawn, not photographed. The model only has to ignore it.
- Hands, sleeves, chips and the phone-stand arm aren't drawn. If they get in the way on your table, photograph
  some and add them to the real set.
- Cards are always flat. Curled cards and a dealer's fingers over a corner are not simulated.

## Tests

```powershell
python -m unittest discover -s tests -v
```

They use made-up cards and a made-up board, so they run without your photos.

## Licence

HighLo is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**; see the `LICENSE` file at the root of the repository. The card detector uses Ultralytics YOLO, which is itself AGPL-3.0, so the project as a whole follows the same licence. If you modify it and let other people use it over a network, you must offer them the source code. Not legal advice: read the licence before redistributing or selling anything built on this.

The card and board photos you use to build the dataset are yours; do not publish them unless you are happy for others to use them.

## Match the real camera framing

The real camera sees only the felt, filling the whole frame (1080x608), not the board with the floor around it. Once the
camera server has a calibration (`highlo-camera-server/calibration/calibration.json`), generate pictures framed exactly
like that, with a small random wobble for a stand that moves a little:

```powershell
python generate.py --board ..\..\image-references\empty-board.jpg --calibration ..\..\highlo-camera-server\calibration\calibration.json --count 3000 --workers 4
```

The picture size then comes from the calibration (1080x608). Train with `imgsz=1088` (a multiple of 32 that fits that
frame), and set `IMGSZ=1088` in the camera server's `.env`.

