#!/usr/bin/env python3
"""Draws assets/icon.png (256x256, an isometric cube, orange for STEP) with the standard library only."""
import math, os, struct, zlib

N, SS = 256, 3
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'icon.png')
c, r = N / 2, N * 0.36
hexa = [(c + r * math.cos(math.radians(a)), c + r * math.sin(math.radians(a))) for a in (-90, -30, 30, 90, 150, 210)]
mid = (c, c)
faces = [([hexa[0], hexa[1], mid, hexa[5]], (255, 190, 110)),   # top
         ([hexa[5], mid, hexa[3], hexa[4]], (224, 130, 60)),    # left
         ([hexa[1], hexa[2], hexa[3], mid], (168, 88, 36))]     # right
BG = (24, 28, 38)

def inside(poly, x, y):
    s = [(poly[i][0] - x) * (poly[(i + 1) % len(poly)][1] - y) - (poly[i][1] - y) * (poly[(i + 1) % len(poly)][0] - x) for i in range(len(poly))]
    return all(v >= 0 for v in s) or all(v <= 0 for v in s)

def rounded(x, y, rad=44):
    cx, cy = min(max(x, rad), N - rad), min(max(y, rad), N - rad)
    return (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad

rows = []
for y in range(N):
    row = bytearray([0])
    for x in range(N):
        acc, cover = [0, 0, 0], 0
        for sy in range(SS):
            for sx in range(SS):
                px, py = x + (sx + .5) / SS, y + (sy + .5) / SS
                if not rounded(px, py):
                    continue
                col = BG
                for poly, fc in faces:
                    if inside(poly, px, py):
                        col = fc
                        break
                cover += 1
                for i in range(3):
                    acc[i] += col[i]
        a = int(255 * cover / (SS * SS))
        rgb = [int(acc[i] / cover) if cover else 0 for i in range(3)]
        row += bytes(rgb + [a])
    rows.append(bytes(row))
def chunk(t, d):
    c2 = struct.pack('>I', len(d)) + t + d
    return c2 + struct.pack('>I', zlib.crc32(t + d) & 0xFFFFFFFF)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', N, N, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(b''.join(rows), 9)) + chunk(b'IEND', b''))
print(OUT)
