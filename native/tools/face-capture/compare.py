#!/usr/bin/env python3
"""Compare the native face with MGL's page, picture against picture.

    compare.py <reference.png> <native.png> <out-folder> [x y w h]

Writes <out>/side.png (the page left, native right, the region if given),
<out>/diff.png (where they differ, brighter is further), and prints the share
of pixels that differ by more than a little and the mean difference, overall
and for a grid of regions, worst first, so the next fix is the biggest one.
"""
import sys
from PIL import Image, ImageChops, ImageOps

ref_path, nat_path, out = sys.argv[1:4]
ref = Image.open(ref_path).convert("RGB")
nat = Image.open(nat_path).convert("RGB")
if nat.size != ref.size:
    nat = nat.resize(ref.size, Image.LANCZOS)
if len(sys.argv) >= 8:
    x, y, w, h = map(int, sys.argv[4:8])
    ref, nat = ref.crop((x, y, x + w, y + h)), nat.crop((x, y, x + w, y + h))

diff = ImageChops.difference(ref, nat).convert("L")
hist = diff.histogram()
total = sum(hist)
off = sum(hist[24:]) / total
mean = sum(i * n for i, n in enumerate(hist)) / total
print(f"differs (>24/255): {off * 100:.1f}%   mean difference {mean:.2f}/255")

W, H = ref.size
cols, rows = 8, 6
cells = []
for r in range(rows):
    for c in range(cols):
        box = (c * W // cols, r * H // rows, (c + 1) * W // cols, (r + 1) * H // rows)
        h = diff.crop(box).histogram()
        t = sum(h)
        cells.append((sum(h[24:]) / t, box))
cells.sort(reverse=True)
for share, box in cells[:8]:
    print(f"  {share * 100:5.1f}%  at {box}")

side = Image.new("RGB", (W * 2 + 8, H), (255, 0, 255))
side.paste(ref, (0, 0))
side.paste(nat, (W + 8, 0))
side.save(f"{out}/side.png")
ImageOps.autocontrast(diff).save(f"{out}/diff.png")
