# Equipment QR codes (test fixtures)

QR codes for the ten seed equipment tags, for testing the PWA scan flow
(`/scan` to `/inspect/{id}`). Each code encodes the bare asset tag string
(for example `MAT-FL-003`). The scan screen (`apps/pwa/src/components/qr-scan-screen.tsx`,
`tagFromScan`) takes the last path segment of the decoded value and uppercases
it, so a bare tag or a tag URL both resolve.

These are test fixtures, not the production label design. Real equipment labels
are out of scope until the lab walkthrough.

## How these were generated

qrencode produces the QR matrix only; it has no label or logo feature. Each SVG
is a qrencode code (`-l H`, high error correction) wrapped with a white label
strip carrying the tag and the equipment type name, so a human can tell the ten
codes apart. The labels sit below the code's quiet zone, so they do not affect
scanning.

```
python3 design/qrcodes/gen_qr.py   # run from the repo root; writes the SVGs here
```

The generator (`gen_qr.py`) runs qrencode per tag and appends the label strip.
Type map: FL Forklift, OC Overhead Crane, PJ Pallet Jack, TR Truck. To add a
tag, extend the `TAGS` list.

## Why a text label, not just an icon

A type icon distinguishes the four categories (FL, OC, PJ, TR) but not the ten
units: three forklifts (FL-001/002/003) would share one icon and stay
confusable. The text label distinguishes every unit. The two options below add
an icon on top of the label, they do not replace it.

## Other options considered (not built)

1. **Label plus a centre type icon, in SVG.** The codes already use `-l H`
   (up to ~30 percent of the matrix can be obscured), so a small type icon can
   be dropped in the centre with a white pad behind it. Needs four icon glyphs
   (forklift, crane, truck, pallet jack); the repo has only a generic
   `EquipmentIcon` in `apps/pwa/src/components/ui/icons.tsx`, so the glyphs would
   have to be drawn. SVG path injection, no extra tooling.

2. **PNG with a composited centre logo via ImageMagick.** Generate a PNG QR
   (`qrencode -l H -s 10 -o code.png TAG`), then composite an icon onto the
   centre (`magick code.png icon.png -gravity center -composite out.png`).
   Closest to a real branded QR, but needs ImageMagick installed (it is not) and
   an icon source file.
