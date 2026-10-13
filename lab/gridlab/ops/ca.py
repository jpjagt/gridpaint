"""Cellular automata + lace-grammar helpers (used by recipes/automata.py, ornament.py, layering.py).

- Silhouettes: ``silhouette(name, h, w)`` (capsule, oval, ring, octagon, shield, diamond, square, rrect).
- Life-like CA: ``parse_rule("B3/S12345")``, ``life_step``, ``run_life`` (symmetry is preserved for free:
  outer-totalistic rules are isotropic, so a symmetric start + symmetric mask stays symmetric).
- Elementary 1D CA folded onto concentric rings: ``folded_rings``.
- Margolus block CA: ``margolus_step`` (critters, tron, bbm, flip).
- Lace grammar: ``sym_thin`` (symmetric Zhang-Suen), ``break_2x2``, ``prune_spurs``, ``lace_clean``.

Registered CLI ops: ``life`` (run a Life-like rule), ``sym-thin``, ``break-2x2``.
"""

from __future__ import annotations

import numpy as np
from scipy import ndimage

from . import masks as M
from . import morph, symmetry
from .registry import register_op

# ---- silhouettes -----------------------------------------------------------------

SILHOUETTES = ["capsule", "oval", "ring", "octagon", "shield", "diamond", "rrect", "square"]


def superellipse(h: int, w: int, n: float = 3.0) -> np.ndarray:
    y, x = np.mgrid[0:h, 0:w]
    dx = (x - (w - 1) / 2) / (w / 2)
    dy = (y - (h - 1) / 2) / (h / 2)
    return np.abs(dx) ** n + np.abs(dy) ** n <= 1.0


def octagon(h: int, w: int, cut: int | None = None) -> np.ndarray:
    cut = max(1, min(h, w) // 4) if cut is None else cut
    y, x = np.mgrid[0:h, 0:w]
    dx = np.minimum(x, w - 1 - x)
    dy = np.minimum(y, h - 1 - y)
    return dx + dy >= cut


def silhouette(name: str, h: int, w: int, thickness: float = 4) -> np.ndarray:
    """Symmetric silhouette mask fitted to the canvas (D2; D4 when square and the shape allows)."""
    if name == "capsule":
        m = M.capsule(h, w)
    elif name == "oval":
        m = M.ellipse(h, w)
    elif name == "ring":
        m = M.ring(h, w, thickness)
    elif name == "octagon":
        m = octagon(h, w)
    elif name == "shield":
        m = M.shield(h, w)
        return m | m[:, ::-1]
    elif name == "diamond":
        m = M.diamond(h, w)
    elif name == "rrect":
        m = superellipse(h, w, 4.0)
    elif name == "square":
        m = np.ones((h, w), bool)
    else:
        raise ValueError(f"silhouette: {'|'.join(SILHOUETTES)}")
    return symmetry.symmetry_or(m, "d2")


def sym_kind(kind: str, shape) -> str:
    """Downgrade d4/rot4/diag to d2 on non-square canvases."""
    if kind in ("d4", "rot4", "diag") and shape[0] != shape[1]:
        return "d2"
    return kind


def symmetrize(m: np.ndarray, kind: str) -> np.ndarray:
    kind = sym_kind(kind, m.shape)
    if kind == "d2":
        return symmetry.symmetrize_d2(m)
    if kind == "d4":
        return symmetry.symmetrize_d4(m)
    if kind == "x":
        return symmetry.mirror(m, "x")
    if kind == "none":
        return m
    return symmetry.symmetry_or(m, kind)


def sym_noise(rng, shape, p: float, kind: str = "d2", within: np.ndarray | None = None) -> np.ndarray:
    m = rng.random(shape) < p
    m = symmetrize(m, kind)
    if within is not None:
        m &= within
    return m


def orbit_or(m: np.ndarray, kind: str) -> np.ndarray:
    kind = sym_kind(kind, m.shape)
    if kind == "none":
        return m
    return symmetry.symmetry_or(m, kind)


# ---- life-like -----------------------------------------------------------------

RULES = {
    "maze": "B3/S12345",
    "mazectric": "B3/S1234",
    "coral": "B3/S45678",
    "daynight": "B3678/S34678",
    "diamoeba": "B35678/S5678",
    "assimilation": "B345/S4567",
    "anneal": "B4678/S35678",
    "stains": "B3678/S235678",
    "walled": "B45678/S2345",
    "coagulations": "B378/S235678",
    "amoeba": "B357/S1358",
    "life": "B3/S23",
    "longlife": "B345/S5",
    "move": "B368/S245",
    "gnarl": "B1/S1",
    "replicator": "B1357/S1357",
    "serviettes": "B234/S",
}


# start densities at which each rule does something interesting in a small silhouette
RULE_DENSITY = {
    "maze": 0.3, "mazectric": 0.3, "coral": 0.6, "daynight": 0.5, "diamoeba": 0.6, "assimilation": 0.4,
    "anneal": 0.55, "stains": 0.45, "walled": 0.55, "coagulations": 0.45, "amoeba": 0.4, "life": 0.35,
    "longlife": 0.45, "move": 0.5, "gnarl": 0.04, "replicator": 0.04, "serviettes": 0.08,
}


def parse_rule(rule: str) -> tuple[set[int], set[int]]:
    """'maze' or 'B3/S12345' -> ({3}, {1,2,3,4,5})."""
    r = RULES.get(rule, rule).upper().replace(" ", "")
    b, s = r.split("/")
    if b.startswith("S"):
        b, s = s, b
    return {int(c) for c in b[1:]}, {int(c) for c in s[1:]}


def life_step(m: np.ndarray, birth: set[int], survive: set[int], mask: np.ndarray | None = None,
              no_block: bool = False) -> np.ndarray:
    n = morph.neighbour_count(m, 8)
    born = ~m & np.isin(n, list(birth))
    if no_block:
        born &= ~_would_block(m)
    new = born | (m & np.isin(n, list(survive)))
    if mask is not None:
        new &= mask
    return new


def _would_block(m: np.ndarray) -> np.ndarray:
    """Empty cells that would complete a 2x2 solid block if turned on."""
    p = np.pad(m, 1)
    H, W = m.shape
    out = np.zeros((H, W), bool)
    for dy in (-1, 1):
        for dx in (-1, 1):
            a = p[1 + dy:1 + dy + H, 1:1 + W]
            b = p[1:1 + H, 1 + dx:1 + dx + W]
            c = p[1 + dy:1 + dy + H, 1 + dx:1 + dx + W]
            out |= a & b & c
    return out & ~m


def run_life(m: np.ndarray, rule: str, steps: int, mask: np.ndarray | None = None, no_block: bool = False,
             record: bool = False):
    birth, survive = parse_rule(rule)
    hist = [m.copy()]
    for _ in range(steps):
        nm = life_step(m, birth, survive, mask, no_block)
        if np.array_equal(nm, m):
            m = nm
            break
        m = nm
        hist.append(m.copy())
    return (m, hist) if record else m


# ---- lace grammar ---------------------------------------------------------------

def blocks_2x2(m: np.ndarray) -> np.ndarray:
    """bool[H-1, W-1]: top-left corners of solid 2x2 blocks."""
    return m[:-1, :-1] & m[1:, :-1] & m[:-1, 1:] & m[1:, 1:]


def _simple(m: np.ndarray, y: int, x: int) -> bool:
    """True if removing (y, x) keeps its 8-neighbourhood in one 8-connected piece."""
    H, W = m.shape
    win = np.zeros((3, 3), bool)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            yy, xx = y + dy, x + dx
            if 0 <= yy < H and 0 <= xx < W:
                win[dy + 1, dx + 1] = m[yy, xx]
    win[1, 1] = False
    if not win.any():
        return False
    _, n = ndimage.label(win, np.ones((3, 3)))
    return n == 1


def break_2x2(m: np.ndarray, kind: str = "d2", max_iter: int = 400) -> np.ndarray:
    """Remove one cell from every solid 2x2 block (orbit-wise, so symmetry is kept). Prefers cells
    whose removal keeps the local topology, then the cell with most orthogonal neighbours."""
    m = np.asarray(m, bool).copy()
    H, W = m.shape
    for _ in range(max_iter):
        B = blocks_2x2(m)
        if not B.any():
            break
        ys, xs = np.nonzero(B)
        y0, x0 = ys[0], xs[0]
        n4 = morph.neighbour_count(m, 4)
        best, bscore = None, None
        for (y, x) in ((y0, x0), (y0, x0 + 1), (y0 + 1, x0), (y0 + 1, x0 + 1)):
            # distance from centre as gentle tie-break: prefer removing outer cells
            dc = abs(y - (H - 1) / 2) + abs(x - (W - 1) / 2)
            score = (_simple(m, y, x), n4[y, x], dc)
            if bscore is None or score > bscore:
                best, bscore = (y, x), score
        rm = np.zeros_like(m)
        rm[best] = True
        m &= ~orbit_or(rm, kind)
    return m


def prune_spurs(m: np.ndarray, n: int = 1, min_keep: int = 0) -> np.ndarray:
    """Remove endpoint cells (exactly one 8-neighbour) n times. Isotropic, so symmetry is kept."""
    m = np.asarray(m, bool).copy()
    for _ in range(n):
        nc = morph.neighbour_count(m, 8)
        ends = m & (nc == 1)
        if not ends.any() or m.sum() - ends.sum() < min_keep:
            break
        m &= ~ends
    return m


def _yokoi8(m: np.ndarray, y: int, x: int) -> int:
    """Yokoi 8-connectivity number of (y, x); 1 = simple point (removal keeps topology)."""
    H, W = m.shape
    # E, NE, N, NW, W, SW, S, SE
    off = [(0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1), (1, 0), (1, 1)]
    v = []
    for dy, dx in off:
        yy, xx = y + dy, x + dx
        v.append(0 if (0 <= yy < H and 0 <= xx < W and m[yy, xx]) else 1)  # complemented
    n = 0
    for k in (0, 2, 4, 6):
        n += v[k] - v[k] * v[(k + 1) % 8] * v[(k + 2) % 8]
    return n


def _orbit_cells(y: int, x: int, shape, kind: str) -> list[tuple[int, int]]:
    H, W = shape
    pts = {(y, x)}
    if kind in ("d2", "x", "d4"):
        pts |= {(py, W - 1 - px) for py, px in list(pts)}
    if kind in ("d2", "y", "d4"):
        pts |= {(H - 1 - py, px) for py, px in list(pts)}
    if kind in ("d4", "diag"):
        pts |= {(px, py) for py, px in list(pts)}
        pts |= {(py, W - 1 - px) for py, px in list(pts)}
        pts |= {(H - 1 - py, px) for py, px in list(pts)}
    if kind == "rot2":
        pts.add((H - 1 - y, W - 1 - x))
    return sorted(pts)


def sym_thin(m: np.ndarray, kind: str = "d2", keep_ends: bool = True) -> np.ndarray:
    """Symmetric sequential thinning to 1-cell strokes. Peels the outer layer each pass, removing a
    whole symmetry orbit at a time and only if every member is a simple point (Yokoi number 1) and
    (keep_ends) not an end point - so topology and mirror symmetry are both preserved."""
    kind = sym_kind(kind, m.shape)
    m = np.asarray(m, bool).copy()
    H, W = m.shape
    cy, cx = (H - 1) / 2, (W - 1) / 2
    for _ in range(max(H, W)):
        n4 = morph.neighbour_count(m, 4)
        border = m & (n4 < 4)
        ys, xs = np.nonzero(border & (np.mgrid[0:H, 0:W][0] <= cy) & (np.mgrid[0:H, 0:W][1] <= cx))
        changed = False
        for y, x in zip(ys, xs):
            orb = [p for p in _orbit_cells(int(y), int(x), (H, W), kind) if m[p]]
            if not orb:
                continue
            removed = []
            ok = True
            for p in orb:
                nb = m[max(0, p[0] - 1):p[0] + 2, max(0, p[1] - 1):p[1] + 2].sum() - 1
                if _yokoi8(m, *p) != 1 or (keep_ends and nb <= 1):
                    ok = False
                    break
                m[p] = False
                removed.append(p)
            if not ok:
                for p in removed:
                    m[p] = True
            else:
                changed = True
        if not changed:
            break
    return m


def lace_clean(m: np.ndarray, kind: str = "d2", min_size: int = 3, keep: int = 0, spurs: int = 0) -> np.ndarray:
    """Grammar cleanup: break 2x2 blocks, prune spurs, drop dust (< min_size), keep the `keep`
    largest 8-connected pieces (0 = all). Re-symmetrised at the end."""
    m = break_2x2(m, kind)
    if spurs:
        m = prune_spurs(m, spurs)
    m = morph.remove_small(m, min_size, 8)
    if keep:
        m = morph.keep_largest(m, 8, keep * _orbit_size(kind))
    return symmetry.symmetry_and(m, sym_kind(kind, m.shape)) if kind != "none" else m


def _orbit_size(kind: str) -> int:
    return {"d2": 4, "d4": 8, "x": 2, "y": 2, "rot2": 2, "rot4": 4, "none": 1}.get(kind, 1)


def lace_stats(m: np.ndarray) -> dict:
    n4 = morph.neighbour_count(m, 4)
    n8 = morph.neighbour_count(m, 8)
    cells = int(m.sum())
    return {"cells": cells, "blocks": int(blocks_2x2(m).sum()),
            "diag_only": float((m & (n4 == 0) & (n8 > 0)).sum() / max(cells, 1)),
            "pieces": int(morph.label(m, 8)[1])}


# ---- elementary CA folded on rings -------------------------------------------------

def peel_rings(sil: np.ndarray, conn: int = 4) -> np.ndarray:
    """int[H, W]: ring index (0 = outer edge) by successive erosion; -1 outside."""
    out = np.full(sil.shape, -1, int)
    cur = sil.copy()
    k = 0
    while cur.any():
        inner = morph.erode(cur, 1, conn)
        out[cur & ~inner] = k
        cur = inner
        k += 1
    return out


def elementary(rule: int, l: np.ndarray, c: np.ndarray, r: np.ndarray) -> np.ndarray:
    idx = (l.astype(int) << 2) | (c.astype(int) << 1) | r.astype(int)
    table = np.array([(rule >> i) & 1 for i in range(8)], bool)
    return table[idx]


def _ring_order(rid: np.ndarray, k: int) -> tuple[np.ndarray, np.ndarray]:
    """Cells of ring k sorted by angle around the canvas centre (a cyclic 1D 'row')."""
    H, W = rid.shape
    ys, xs = np.nonzero(rid == k)
    ang = np.arctan2(ys - (H - 1) / 2, xs - (W - 1) / 2)
    o = np.argsort(ang, kind="stable")
    return ys[o], xs[o]


def folded_rings(sil: np.ndarray, rule: int, seed_ring: np.ndarray, depth: int, kind: str = "d2",
                 rules: list[int] | None = None, record: bool = False):
    """Run an elementary CA inward over concentric rings of a silhouette: ring k = generation k.
    Each ring is unrolled to a cyclic row by angle; cell i of ring k reads cells (j-1, j, j+1) of
    ring k-1 where j is its proportional position. Mirrored after every ring (symmetric rules
    90/150/18/182... make this nearly exact anyway)."""
    rid = peel_rings(sil)
    state = seed_ring & (rid == 0)
    hist = [state.copy()]
    prev = _ring_order(rid, 0)
    for k in range(1, depth + 1):
        cur = _ring_order(rid, k)
        n0, n1 = len(prev[0]), len(cur[0])
        if n1 == 0 or n0 == 0:
            break
        rule_k = rules[(k - 1) % len(rules)] if rules else rule
        row = state[prev]
        j = np.floor((np.arange(n1) + 0.5) * n0 / n1).astype(int) % n0
        l, c, r = row[(j - 1) % n0], row[j], row[(j + 1) % n0]
        vals = elementary(rule_k, l, c, r)
        new = np.zeros_like(state)
        new[cur] = vals
        new = symmetrize(new, kind) & (rid == k)
        state = state | new
        hist.append(state.copy())
        prev = cur
    return (state, hist) if record else state


# ---- Margolus block CA ------------------------------------------------------------

def margolus_step(m: np.ndarray, phase: int, rule: str = "critters") -> np.ndarray:
    """One Margolus step on 2x2 blocks offset by `phase` (0/1). Works on even-sized arrays; with
    even H, W and D4-equivariant block rules mirror symmetry is preserved."""
    H, W = m.shape
    p = phase % 2
    a = np.pad(m, ((p, p), (p, p))) if p else m.copy()
    h2, w2 = (a.shape[0] // 2) * 2, (a.shape[1] // 2) * 2
    blk = a[:h2, :w2].reshape(h2 // 2, 2, w2 // 2, 2).transpose(0, 2, 1, 3).copy()  # [by, bx, 2, 2]
    cnt = blk.sum(axis=(2, 3))
    out = blk.copy()
    if rule == "critters":
        inv = cnt != 2
        out[inv] = ~blk[inv]
        r3 = cnt == 3
        out[r3] = out[r3][:, ::-1, ::-1]
    elif rule == "tron":
        inv = (cnt == 0) | (cnt == 4)
        out[inv] = ~blk[inv]
    elif rule == "bbm":
        # billiard ball: single ball moves diagonally across; two diagonal balls turn 90deg
        one = cnt == 1
        out[one] = blk[one][:, ::-1, ::-1]
        diag = (cnt == 2) & (blk[..., 0, 0] == blk[..., 1, 1])
        out[diag] = ~blk[diag]
    elif rule == "flip":
        # 'melting': blocks with 1 or 3 cells are rotated 180, full blocks hollow out to a diagonal
        odd = (cnt == 1) | (cnt == 3)
        out[odd] = blk[odd][:, ::-1, ::-1]
        full = cnt == 4
        out[full] = np.array([[True, False], [False, True]])
    else:
        raise ValueError("margolus rule: critters|tron|bbm|flip")
    a2 = a.copy()
    a2[:h2, :w2] = out.transpose(0, 2, 1, 3).reshape(h2, w2)
    return a2[p:p + H, p:p + W] if p else a2


# ---- registered ops ---------------------------------------------------------------

@register_op("life")
def _life_op(mask, rule: str = "coral", steps: int = 4, within: str = "all", no_block: bool = False):
    """Run a Life-like CA on the layer: rule=maze|mazectric|coral|daynight|diamoeba|assimilation|anneal|
    stains|walled|... or B3/S12345 form. within=all|capsule|oval|... keeps cells inside a silhouette.
    no_block=true forbids births that complete a 2x2 block (lace-friendly)."""
    H, W = mask.shape
    sil = None if within == "all" else silhouette(within, H, W)
    return run_life(np.asarray(mask, bool), rule, steps, sil, no_block)


@register_op("sym-thin")
def _sym_thin_op(mask, sym: str = "d2"):
    """Symmetric Zhang-Suen thinning to 1-cell strokes (unlike `skeleton`, keeps mirror symmetry)."""
    return sym_thin(np.asarray(mask, bool), sym)


@register_op("break-2x2")
def _break_op(mask, sym: str = "d2"):
    """Remove one cell from each solid 2x2 block (orbit-wise), keeping topology where possible."""
    return break_2x2(np.asarray(mask, bool), sym)
