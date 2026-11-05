# Exports robot math, dialog and file helpers into a shared script prelude.

















from __future__ import annotations

import os
import sys
import time
from typing import List

from . import dialogs, fileio, robolink, robomath, utils

robodialogs = dialogs
robofileio = fileio
robolinkutils = utils


def _public(module: object) -> List[str]:
    names = getattr(module, "__all__", None)
    if names is None:
        names = [n for n in vars(module) if not n.startswith("_")]
    return list(names)


__all__: List[str] = []
for _mod in (robomath, dialogs, fileio):
    for _name in _public(_mod):
        globals()[_name] = getattr(_mod, _name)
        if _name not in __all__:
            __all__.append(_name)
__all__ += ["robolink", "robomath", "robodialogs", "robofileio", "robolinkutils", "time", "os", "sys"]
del _mod, _name
