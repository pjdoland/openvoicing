#!/usr/bin/env python3
"""Build the Goldberg Aria OVB from the freedots two-staff engraving.
Parses and re-serializes through ElementTree (canonical XML that alphaTab's
minimal parser accepts), unfolds the A/B repeats into 64 written-out bars to
match Kimiko Ishizaka's repeated recording, and pairs it with that CC0 audio."""
import os, zipfile, json, copy
import xml.etree.ElementTree as ET

SCRATCH = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(SCRATCH, "freedots-aria.xml")
OGG = os.path.join(SCRATCH, "goldberg-aria.ogg")
OUT = os.path.join(SCRATCH, "goldberg-aria.ovb")

tree = ET.parse(SRC)
root = tree.getroot()  # score-partwise
root.set("version", "4.0")

# Clean title; drop presentation-only blocks.
for tag in ("defaults", "credit"):
    for el in root.findall(tag):
        root.remove(el)
wt = root.find("./work/work-title")
if wt is not None:
    wt.text = "Goldberg Variations, BWV 988 - Aria"

part = root.find("part")
measures = part.findall("measure")
assert len(measures) == 32, len(measures)
A, B = measures[:16], measures[16:]
order = A + A + B + B  # AABB

# Rebuild the part with unfolded, repeat-free, renumbered measures.
for m in measures:
    part.remove(m)
for i, m in enumerate(order):
    nm = copy.deepcopy(m)
    nm.set("number", str(i + 1))
    for bl in nm.findall("barline"):
        if bl.find("repeat") is not None:
            nm.remove(bl)  # drop repeat barlines; the score is written out
    part.append(nm)

xml_bytes = ET.tostring(root, encoding="utf-8", xml_declaration=True)
open(os.path.join(SCRATCH, "goldberg-aria.musicxml"), "wb").write(xml_bytes)

manifest = {
    "format": "openvoicing-bundle",
    "formatVersion": 0,
    "title": "Goldberg Variations, BWV 988 - Aria",
    "attribution": {
        "composer": "J. S. Bach",
        "artist": "Kimiko Ishizaka (Open Goldberg Variations)",
        "license": "Recording CC0-1.0; score engraving CC-BY-SA-3.0 (Mario Lang)",
        "source": "Recording: opengoldbergvariations.org (CC0). Score: freedots bwv988-aria (CC-BY-SA 3.0), repeats unfolded.",
    },
    "score": {"path": "score/aria.musicxml", "type": "musicxml"},
    "recordings": [
        {"id": "opengoldberg", "name": "Kimiko Ishizaka - Aria.ogg",
         "path": "recordings/opengoldberg/aria.ogg"}
    ],
}

with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("manifest.json", json.dumps(manifest, indent=2))
    z.writestr("score/aria.musicxml", xml_bytes)
    z.write(OGG, "recordings/opengoldberg/aria.ogg")

print(f"unfolded {len(order)} measures, {len(xml_bytes)} bytes xml -> {OUT}")
