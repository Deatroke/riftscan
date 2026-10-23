"""Draws the Riftscan app icon (teal square, white rift zigzag) as PNGs, no dependencies."""
import struct, zlib, math, sys
from pathlib import Path

TEAL, WHITE = (10, 124, 134), (255, 255, 255)
# zigzag in a 100x100 box, kept inside the 80% maskable safe zone
PTS = [(58, 22), (40, 52), (60, 52), (42, 80)]

def dist(px, py, a, b):
    ax, ay = a; bx, by = b
    dx, dy = bx - ax, by - ay
    t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))

def render(size, path):
    rows = []
    half = 0.055 * size
    pts = [(x / 100 * size, y / 100 * size) for x, y in PTS]
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            d = min(dist(x + .5, y + .5, pts[i], pts[i + 1]) for i in range(len(pts) - 1))
            a = max(0, min(1, half + .5 - d))  # 1px antialias edge
            c = tuple(round(TEAL[k] + (WHITE[k] - TEAL[k]) * a) for k in range(3))
            row += bytes(c)
        rows.append(bytes(row))
    raw = b"".join(rows)
    def chunk(t, d): 
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d))
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)) \
        + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    Path(path).write_bytes(png)

out = Path(__file__).resolve().parent.parent / "icons"
for s in (192, 512):
    render(s, out / f"icon-{s}.png")
print("ok")
