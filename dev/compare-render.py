#!/usr/bin/env python3
"""Compares the PNGs of two runs of dev/measure-render.mjs: python3 dev/compare-render.py before-dir after-dir
Prints, for each picture, the share of pixels that differ by more than 8 levels in any channel, the mean absolute difference and the largest one."""
import sys, os
import numpy as np
from PIL import Image
a, b = sys.argv[1], sys.argv[2]
for f in sorted(os.listdir(a)):
    if not f.endswith('.png'): continue
    if not os.path.exists(os.path.join(b, f)):
        print(f'{f}: missing in {b}'); continue
    x = np.asarray(Image.open(os.path.join(a, f)).convert('RGBA'), dtype=np.int16)
    y = np.asarray(Image.open(os.path.join(b, f)).convert('RGBA'), dtype=np.int16)
    if x.shape != y.shape:
        print(f'{f}: size differs {x.shape} vs {y.shape}'); continue
    d = np.abs(x - y)
    print(f'{f}: differing pixels (>8) {100 * (d.max(axis=2) > 8).mean():.2f} %, mean {d.mean():.3f}, max {d.max()}')
