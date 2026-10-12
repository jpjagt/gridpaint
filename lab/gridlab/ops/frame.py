"""`frame`: a border band around the design's outer silhouette (what people mean by "give it a frame").

`outline` puts a band around every stroke, which on lace fills the gaps into a solid slab; `frame`
first takes the silhouette (close + fill holes of the layer union) and rings only that.
"""

from __future__ import annotations

import numpy as np

from ..model import Design
from . import masks as M
from . import morph
from .registry import register_op


@register_op("frame", kind="design")
def _frame(design: Design, layer_ids, d: int = 1, thickness: int = 1, close: int = 2):
    """Add a border band around the outer silhouette of the design (distance d, thickness cells).
    Without --layer it goes on the bottom layer (base plate); the canvas grows if the band needs room."""
    ids = list(layer_ids)
    if sorted(ids) == sorted(design.layer_ids) and len(ids) > 1:
        ids = [max(ids)]
    need = d + thickness
    bb = design.bbox()
    if bb is not None:
        x0, y0, x1, y1 = bb
        pad = [max(0, need - x0), max(0, need - y0), max(0, need - (design.width - 1 - x1)),
               max(0, need - (design.height - 1 - y1))]
        if any(pad):
            design.pad(*pad)
    sil = morph.fill_holes(morph.close(design.union_mask(), close, 8))
    band = M.offset_outline(sil, d, thickness)
    for lid in ids:
        g = design.layer(lid, create=True).group("default", create=True)
        g.cells = np.asarray(g.cells | band, bool)
    return design
