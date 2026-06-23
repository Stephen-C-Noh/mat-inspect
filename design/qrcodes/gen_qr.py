#!/usr/bin/env python3
"""Generate labelled QR SVGs for the seed equipment tags.

qrencode emits the QR matrix only; it has no label/logo feature. This wraps each
qrencode SVG, adds a white label strip under the code, and writes the tag plus the
equipment type name so a human can tell the ten codes apart. -l H (high error
correction) is used so the codes stay readable, leaving room to drop a centre icon
later (option 2) without regenerating intent.
"""

import re
import subprocess
from pathlib import Path

OUT = Path("design/qrcodes")
OUT.mkdir(parents=True, exist_ok=True)

TYPE_NAMES = {
    "FL": "Forklift",
    "OC": "Overhead Crane",
    "PJ": "Pallet Jack",
    "TR": "Truck",
}
TAGS = [
    "MAT-FL-001",
    "MAT-FL-002",
    "MAT-FL-003",
    "MAT-OC-001",
    "MAT-OC-002",
    "MAT-OC-003",
    "MAT-OC-004",
    "MAT-PJ-001",
    "MAT-TR-001",
    "MAT-TR-002",
]


def make(tag: str) -> None:
    raw = subprocess.run(
        ["qrencode", "-t", "SVG", "-l", "H", "-o", "-", tag],
        check=True,
        capture_output=True,
        text=True,
    ).stdout

    # qrencode sizes the QR to N x N units via viewBox="0 0 N N"; read N so the label
    # strip and text scale with whatever QR version the tag needs.
    n = int(re.search(r'viewBox="0 0 (\d+) \d+"', raw).group(1))
    inner = raw[raw.index('<g id="QRcode">') : raw.rindex("</svg>")].rstrip()

    label_h = round(n * 0.34, 2)  # strip height, proportional to the code
    total_h = n + label_h
    type_name = TYPE_NAMES[tag.split("-")[1]]
    tag_y = n + label_h * 0.55
    type_y = n + label_h * 0.92
    cx = n / 2

    svg = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<svg xmlns="http://www.w3.org/2000/svg" width="{n * 12}" height="{round(total_h * 12)}" viewBox="0 0 {n} {total_h}" preserveAspectRatio="xMidYMid meet" version="1.1">
\t<rect x="0" y="0" width="{n}" height="{total_h}" fill="#ffffff"/>
\t{inner}
\t<text x="{cx}" y="{tag_y}" text-anchor="middle" font-family="monospace" font-size="{round(label_h * 0.42, 2)}" font-weight="bold" fill="#000000">{tag}</text>
\t<text x="{cx}" y="{type_y}" text-anchor="middle" font-family="sans-serif" font-size="{round(label_h * 0.3, 2)}" fill="#000000">{type_name}</text>
</svg>
'''
    (OUT / f"{tag}.svg").write_text(svg)
    print(f"ok: {OUT / f'{tag}.svg'} (viewBox {n}x{total_h})")


for t in TAGS:
    make(t)
