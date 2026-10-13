"""Hitomezashi (一目刺し, "one stitch") and other bit-word / bitwise lattice ornaments.

Hitomezashi (research-esoteric §3.2). Two binary words: ``a[j]`` per horizontal line j and
``b[i]`` per vertical line i. On the doubled lattice (lattice point (i, j) -> pixel (2i, 2j)), line j
carries dashes on segments k with ``(k + a[j]) % 2 == 0`` and line i on segments k with
``(k + b[i]) % 2 == 0``. Every vertex is an L-turn, so the drawing is a union of closed loops plus
border paths with **no 2x2 blocks**. Exact D2: odd segment count N and palindromic words of length
N+1; D4: square and a == b.

Python API
- words: ``text_bits(text, n)``, ``palindrome(w, centre=None)``, ``thue_morse(n)``,
  ``fibonacci_word(n)``, ``prime_word(n)``, ``pi_word(n)``, ``hexagram_bits(seed_or_text)``,
  ``word(kind, n, text=..., seed=...)`` (dispatcher)
- ``hitomezashi(a, b) -> bool (2*(len(a)-1)+1, 2*(len(b)-1)+1)``
- ``faces(a, b) -> bool (len(a)-1, len(b)-1)``: the 2-colouring of regions
- ``face_plate(a, b) -> bool`` (doubled grid): material for colour-1 regions (+ stitches between)
- ``loops(mask) -> (labels, closed_ids)``: 8-components; closed = not touching the border
- ``loop_islands(mask, keep="central"|"closed"|"size", ...)``
- ``bridge_loops(mask, sym)``: join kissing loops with 1-cell diagonal bridges (orbit-wise)
- ``xor_field(h, w, formula, k, r)``: bitwise ornaments at x=|dx|, y=|dy| (D4 for free)

CLI ops: ``hitomezashi-fill`` (stitches clipped to the mask; words from text / thue-morse / ...),
``hitomezashi-loops`` (keep closed loops only), ``xor-fill``.
"""

from __future__ import annotations

import hashlib

import numpy as np
from scipy import ndimage

from . import morph
from .registry import register_op

# ---------------------------------------------------------------------------- words


def text_bits(text: str, n: int | None = None) -> list[int]:
    """UTF-8 bytes -> bits (MSB first). If n is given: cycle/truncate to length n."""
    bs = [(byte >> (7 - i)) & 1 for byte in text.encode("utf-8") for i in range(8)]
    if not bs:
        bs = [0]
    if n is None:
        return bs
    return [bs[i % len(bs)] for i in range(n)]


def letter_bits(text: str) -> list[int]:
    """One bit per letter: vowel = 1, consonant = 0 (spaces/punctuation dropped)."""
    return [1 if ch in "aeiouy" else 0 for ch in text.lower() if ch.isalpha()] or [0]


def text_seed(text: str) -> int:
    return int.from_bytes(hashlib.sha256(text.encode("utf-8")).digest()[:4], "big")


def text_word(text: str, n: int) -> list[int]:
    """n bits that depend on the whole text: XOR-fold of the UTF-8 bits into n slots (so every
    letter matters, also for long mantras)."""
    bs = text_bits(text)
    out = [0] * n
    for i, b in enumerate(bs):
        out[i % n] ^= b
    # stir in a little of the hash so similar short words differ more than one bit
    h = text_seed(text)
    if len(bs) < n:
        out = [(o ^ ((h >> i) & 1)) for i, o in enumerate(out)]
    return out


def palindrome(w: list[int], centre: int | None = None) -> list[int]:
    w = list(w)
    return w + ([] if centre is None else [int(centre)]) + w[::-1]


def thue_morse(n: int) -> list[int]:
    return [bin(k).count("1") % 2 for k in range(n)]


def fibonacci_word(n: int) -> list[int]:
    a, b = "0", "01"
    while len(b) < n:
        a, b = b, b + a
    return [int(ch) for ch in b[:n]]


def prime_word(n: int) -> list[int]:
    def isp(k):
        return k > 1 and all(k % d for d in range(2, int(k ** 0.5) + 1))

    return [1 if isp(k) else 0 for k in range(n)]


PI = "31415926535897932384626433832795028841971693993751058209749445923078164062862089986280348253421170679"


def pi_word(n: int) -> list[int]:
    return [int(PI[i % len(PI)]) % 2 for i in range(n)]


def hexagram_bits(seed) -> list[int]:
    """Cast a hexagram with the three-coin method (seeded). Returns 6 lines bottom->top, yang=1."""
    rng = np.random.default_rng(text_seed(seed) if isinstance(seed, str) else seed)
    lines = []
    for _ in range(6):
        s = int(sum(rng.choice([2, 3], size=3)))  # 6 old yin, 7 young yang, 8 young yin, 9 old yang
        lines.append(1 if s in (7, 9) else 0)
    return lines


def word(kind: str, n: int, text: str = "", seed: int = 0) -> list[int]:
    """Word of length n by kind: text|thue-morse|fibonacci|prime|pi|random|letters."""
    if kind == "text":
        return text_word(text, n)
    if kind == "letters":
        lb = letter_bits(text)
        return [lb[i % len(lb)] for i in range(n)]
    if kind in ("thue-morse", "thue_morse", "tm"):
        return thue_morse(n)
    if kind == "fibonacci":
        return fibonacci_word(n)
    if kind == "prime":
        return prime_word(n)
    if kind == "pi":
        return pi_word(n)
    if kind == "random":
        return [int(v) for v in np.random.default_rng(seed).integers(0, 2, n)]
    raise ValueError("word kind: text|letters|thue-morse|fibonacci|prime|pi|random")


def sym_word(kind: str, n_lines: int, text: str = "", seed: int = 0, offset: int = 0) -> list[int]:
    """Palindromic word of length n_lines (must be even for exact D2 with odd segment count)."""
    half = n_lines // 2
    w = word(kind, half + offset, text, seed)[offset:]
    return palindrome(w, None if n_lines % 2 == 0 else w[-1] ^ 1)


# ---------------------------------------------------------------------------- stitches

def hitomezashi(a, b) -> np.ndarray:
    """a: one bit per horizontal line (len = rows+1), b: per vertical line (len = cols+1)."""
    a = [int(v) & 1 for v in a]
    b = [int(v) & 1 for v in b]
    ny, nx = len(a) - 1, len(b) - 1
    H, W = 2 * ny + 1, 2 * nx + 1
    m = np.zeros((H, W), bool)
    for j in range(ny + 1):
        for k in range(nx):
            if (k + a[j]) % 2 == 0:
                m[2 * j, 2 * k:2 * k + 3] = True
    for i in range(nx + 1):
        for k in range(ny):
            if (k + b[i]) % 2 == 0:
                m[2 * k:2 * k + 3, 2 * i] = True
    return m


def faces(a, b) -> np.ndarray:
    """2-colouring of the (rows x cols) faces; crossing a stitched edge toggles colour."""
    a = [int(v) & 1 for v in a]
    b = [int(v) & 1 for v in b]
    ny, nx = len(a) - 1, len(b) - 1
    f = np.zeros((ny, nx), bool)
    for j in range(ny):
        if j > 0:
            # vertical move from face (0, j-1) to (0, j) crosses horizontal line j at segment 0
            f[j, 0] = f[j - 1, 0] ^ ((0 + a[j]) % 2 == 0)
        for i in range(1, nx):
            f[j, i] = f[j, i - 1] ^ ((j + b[i]) % 2 == 0)
    return f


def face_plate(a, b, colour: bool = True) -> np.ndarray:
    """Doubled-grid mask: faces of the given colour filled (face pixel + the edge/vertex pixels
    around it), i.e. a solid two-tone plate whose boundaries are the stitches."""
    f = faces(a, b) == colour
    ny, nx = f.shape
    H, W = 2 * ny + 1, 2 * nx + 1
    m = np.zeros((H, W), bool)
    for j, i in zip(*np.nonzero(f)):
        m[2 * j:2 * j + 3, 2 * i:2 * i + 3] = True
    return m


def loops(mask: np.ndarray):
    """(labels, closed_ids): 8-connected stitch components and those not touching the border."""
    lab, n = morph.label(mask, 8)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    closed = [i for i in range(1, n + 1) if i not in border]
    return lab, closed


def loop_islands(mask: np.ndarray, keep: str = "central", radius: float = 1e9,
                 min_size: int = 0, max_size: int = 10 ** 9, n_central: int = 1) -> np.ndarray:
    """Keep closed loops: keep='closed' (all closed loops within radius of the centre by bbox
    centre and min/max size), 'central' (the n_central loops nearest the centre, + their images
    since distances are symmetric), 'enclosing' (loops that enclose the centre)."""
    lab, closed = loops(mask)
    H, W = mask.shape
    cy, cx = (H - 1) / 2, (W - 1) / 2
    objs = ndimage.find_objects(lab)
    cand = []
    for i in closed:
        sl = objs[i - 1]
        size = int((lab[sl] == i).sum())
        if not (min_size <= size <= max_size):
            continue
        by = (sl[0].start + sl[0].stop - 1) / 2
        bx = (sl[1].start + sl[1].stop - 1) / 2
        d = float(np.hypot(by - cy, bx - cx))
        if d > radius:
            continue
        cand.append((round(d, 3), i, sl))
    out = np.zeros_like(mask, dtype=bool)
    if keep == "closed":
        for _, i, _ in cand:
            out |= lab == i
        return out
    if keep == "enclosing":
        for _, i, sl in cand:
            if sl[0].start < cy < sl[0].stop - 1 and sl[1].start < cx < sl[1].stop - 1:
                out |= lab == i
        return out
    ds = sorted({d for d, _, _ in cand})[:n_central]
    for d, i, _ in cand:
        if d in ds:
            out |= lab == i
    return out


def bridge_loops(mask: np.ndarray, sym: str = "d2", allowed: np.ndarray | None = None, max_len: int = 3) -> np.ndarray:
    """Join separate loops by short symmetric bridges (uses composition.connect when available)."""
    try:
        from .composition import connect

        return connect(mask, allowed, sym, max_len=max_len)
    except Exception:  # pragma: no cover - fallback if composition changes
        return mask


# ---------------------------------------------------------------------------- bitwise ornaments

XOR_FORMULAS = ("xor_mod", "and_zero", "or_mod", "popcount", "mul_mod", "sum_xor_diff", "xor_square")


def xor_field(h: int, w: int, formula: str = "xor_mod", k: int = 7, r: int = 0) -> np.ndarray:
    """Bitwise ornament at x=|dx|, y=|dy| from the canvas centre (symmetric in x,y => D4)."""
    yy, xx = np.mgrid[0:h, 0:w]
    x = np.abs(xx - (w - 1) // 2).astype(np.int64)
    y = np.abs(yy - (h - 1) // 2).astype(np.int64)
    k = max(1, int(k))
    if formula == "xor_mod":
        return (x ^ y) % k == r % k
    if formula == "and_zero":
        return (x & y) == 0
    if formula == "or_mod":
        return (x | y) % k == r % k
    if formula == "popcount":
        v = x ^ y
        pc = np.zeros_like(v)
        for b in range(12):
            pc += (v >> b) & 1
        return pc == (r if r else 2)
    if formula == "mul_mod":
        return (x * y) % k == r % k
    if formula == "sum_xor_diff":
        return ((x + y) ^ np.abs(x - y)) % k == r % k
    if formula == "xor_square":
        return ((x * x) ^ (y * y)) % k == r % k
    raise ValueError(f"formula: {'|'.join(XOR_FORMULAS)}")


# ---------------------------------------------------------------------------- CLI ops

def _fit_words(H, W, kind, text, seed):
    ny, nx = (H - 1) // 2, (W - 1) // 2
    # odd segment counts + even-length palindromes give exact D2
    a = sym_word(kind, ny + 1, text, seed)
    b = sym_word(kind, nx + 1, text, seed, offset=0) if ny != nx else a
    return a, b


@register_op("hitomezashi-fill")
def _hito_fill(mask, kind: str = "text", text: str = "om", seed: int = 0, mode: str = "replace", loops_only: bool = False):
    """Hitomezashi stitch pattern clipped to the mask (centred, D2/D4 palindromic words).
    kind=text|letters|thue-morse|fibonacci|prime|pi|random; loops_only keeps closed loops."""
    mask = np.asarray(mask, bool)
    H, W = mask.shape
    h2, w2 = H - (1 - H % 2), W - (1 - W % 2)
    a, b = _fit_words(h2, w2, kind, text, seed)
    st = hitomezashi(a, b)
    out = np.zeros_like(mask)
    out[:st.shape[0], :st.shape[1]] = st
    out &= mask if mask.any() else True
    if loops_only:
        out = loop_islands(out, "closed")
    return (mask | out) if mode == "or" else out


@register_op("hitomezashi-loops")
def _hito_loops(mask, keep: str = "closed", n_central: int = 1):
    """Keep only closed loops of a stitch-like mask (keep=closed|central|enclosing)."""
    return loop_islands(np.asarray(mask, bool), keep, n_central=n_central)


@register_op("xor-fill")
def _xor_fill(mask, formula: str = "xor_mod", k: int = 7, r: int = 0, mode: str = "and"):
    """Bitwise ornament (x=|dx|, y=|dy|; D4 for free) inside the mask (mode=and) or replace."""
    H, W = mask.shape
    f = xor_field(H, W, formula, k, r)
    return f & mask if mode == "and" else f
