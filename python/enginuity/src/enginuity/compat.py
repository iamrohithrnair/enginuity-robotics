# Installs import aliases that route legacy helper modules to Enginuity.




























from __future__ import annotations

import importlib
import importlib.abc
import importlib.machinery
import logging
import sys
import types
from typing import Dict, Optional, Sequence

__all__ = ["install", "uninstall", "installed", "ALIASES"]

logger = logging.getLogger("enginuity")


ALIASES: Dict[str, str] = {
    "robolink": "enginuity.robolink",
    "robomath": "enginuity.robomath",
    "robodialogs": "enginuity.dialogs",
    "robofileio": "enginuity.fileio",
    "robolinkutils": "enginuity.utils",
}


class _AliasLoader(importlib.abc.Loader):
    pass

    def __init__(self, fullname: str) -> None:
        self.fullname = fullname
        self._spec: Optional[importlib.machinery.ModuleSpec] = None

    def create_module(self, spec: importlib.machinery.ModuleSpec) -> types.ModuleType:
        module = importlib.import_module(ALIASES[self.fullname])
        self._spec = module.__spec__
        return module

    def exec_module(self, module: types.ModuleType) -> None:
        
        if self._spec is not None:
            module.__spec__ = self._spec


class _AliasFinder(importlib.abc.MetaPathFinder):
    pass

    def find_spec(self, fullname: str, path: Optional[Sequence[str]] = None, target: Optional[types.ModuleType] = None) -> Optional[importlib.machinery.ModuleSpec]:
        if fullname in ALIASES:
            return importlib.machinery.ModuleSpec(fullname, _AliasLoader(fullname))
        return None

    def __repr__(self) -> str:
        return "<enginuity.compat alias finder>"


_FINDER = _AliasFinder()


def installed() -> bool:
    pass
    return _FINDER in sys.meta_path


def install() -> None:
    pass
    if _FINDER in sys.meta_path:
        sys.meta_path.remove(_FINDER)
    sys.meta_path.insert(0, _FINDER)
    for name in list(ALIASES):
        mod = sys.modules.get(name)
        if mod is None:
            continue
        origin = getattr(getattr(mod, "__spec__", None), "loader", None)
        if not isinstance(origin, _AliasLoader) and not getattr(mod, "__name__", "").startswith("enginuity"):
            logger.warning("Replacing the already imported module %r with Enginuity's", name)
            del sys.modules[name]


def uninstall() -> None:
    pass
    while _FINDER in sys.meta_path:
        sys.meta_path.remove(_FINDER)
    for name in list(ALIASES):
        sys.modules.pop(name, None)


install()
