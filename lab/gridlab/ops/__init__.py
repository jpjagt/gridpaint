"""Pure numpy ops on bool masks (H, W) indexed [y, x].

Submodules: masks (shapes), symmetry, morph, draw, registry (CLI op registry), builtin
(registered ops). Add new op modules here; any module in this package is auto-imported by the
registry, so ``@register_op`` decorated functions become available as ``gridlab op FILE NAME``.
"""

from . import draw, masks, morph, symmetry  # noqa: F401
from .registry import OPS, apply_op, get_op, list_ops, register_op  # noqa: F401
