"""Slope profile curves for the pillow parting surface.

All functions are vectorized over numpy arrays and map [0,1] -> [0,1].
- f_axis: "gain" sigmoid — slow start, steep middle, horizontal at t=1.
  Used along the straight horizontal/vertical axes.
- f_diag: steep start (slope b at t=0), horizontal at t=1.
  Used along the diagonals.
- quarter_weight: |cos 2θ|^k blend — 1 on the axes, 0 on the diagonals.
"""

import numpy as np


def f_axis(t, a):
    t = np.clip(np.asarray(t, dtype=float), 0.0, 1.0)
    num = t**a
    return num / (num + (1.0 - t) ** a)


def f_diag(t, b):
    t = np.clip(np.asarray(t, dtype=float), 0.0, 1.0)
    return 1.0 - (1.0 - t) ** b


def quarter_weight(theta, k):
    return np.abs(np.cos(2.0 * np.asarray(theta, dtype=float))) ** k


def smoothstep(x):
    x = np.clip(np.asarray(x, dtype=float), 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)
