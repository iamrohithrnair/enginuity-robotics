

























from __future__ import annotations

import importlib
import importlib.abc
import importlib.machinery
import logging
import os
import sys
import time
import types
from typing import Dict, List, Optional, Sequence

__all__ = ["install", "uninstall", "installed", "ALIASES"]

logger = logging.getLogger("enginuity")

if os.environ.get("ROBODK_API_PORT") and not os.environ.get("ENGINUITY_API_PORT"):
    os.environ["ENGINUITY_API_PORT"] = os.environ["ROBODK_API_PORT"]


ALIASES: Dict[str, str] = {
    "robodk.robolink": "enginuity.robolink",
    "robodk.robomath": "enginuity.robomath",
    "robodk.robodialogs": "enginuity.dialogs",
    "robodk.robofileio": "enginuity.fileio",
    "robodk.robolinkutils": "enginuity.utils",
    "robolink": "enginuity.robolink",
    "robomath": "enginuity.robomath",
    "robodialogs": "enginuity.dialogs",
    "robofileio": "enginuity.fileio",
    "robolinkutils": "enginuity.utils",
}
_PACKAGE = "robodk"
_SUBMODULES = ("robolink", "robomath", "robodialogs", "robofileio", "robolinkutils")


def _public(module: types.ModuleType) -> List[str]:
    names = getattr(module, "__all__", None)
    if names is None:
        names = [n for n in vars(module) if not n.startswith("_")]
    return list(names)


def _legacy_package() -> types.ModuleType:
    pass
    from enginuity import dialogs, fileio, robolink, robomath, utils

    pkg = types.ModuleType(_PACKAGE, "Research shim: the robodk package names on enginuity (research/scenarios/postgen_compat).")
    pkg.__path__ = []  
    pkg.__package__ = _PACKAGE
    exported: List[str] = []
    for mod in (robomath, dialogs, fileio):
        for name in _public(mod):
            setattr(pkg, name, getattr(mod, name))
            if name not in exported:
                exported.append(name)
    subs = {"robolink": robolink, "robomath": robomath, "robodialogs": dialogs, "robofileio": fileio, "robolinkutils": utils}
    for name, mod in subs.items():
        setattr(pkg, name, mod)
        exported.append(name)
    
    for name, mod in (("time", time), ("os", os), ("sys", sys)):
        setattr(pkg, name, mod)
        exported.append(name)
    pkg.__all__ = exported
    return pkg


class _AliasLoader(importlib.abc.Loader):
    pass

    def __init__(self, fullname: str) -> None:
        self.fullname = fullname
        self._spec: Optional[importlib.machinery.ModuleSpec] = None

    def create_module(self, spec: importlib.machinery.ModuleSpec) -> types.ModuleType:
        if self.fullname == _PACKAGE:
            return _legacy_package()
        module = importlib.import_module(ALIASES[self.fullname])
        self._spec = module.__spec__
        return module

    def exec_module(self, module: types.ModuleType) -> None:
        
        if self._spec is not None:
            module.__spec__ = self._spec


class _AliasFinder(importlib.abc.MetaPathFinder):
    pass

    def find_spec(self, fullname: str, path: Optional[Sequence[str]] = None, target: Optional[types.ModuleType] = None) -> Optional[importlib.machinery.ModuleSpec]:
        if fullname == _PACKAGE:
            return importlib.machinery.ModuleSpec(fullname, _AliasLoader(fullname), is_package=True)
        if fullname in ALIASES:
            return importlib.machinery.ModuleSpec(fullname, _AliasLoader(fullname))
        return None

    def __repr__(self) -> str:
        return "<research robodk alias finder>"


_FINDER = _AliasFinder()


def installed() -> bool:
    pass
    return _FINDER in sys.meta_path


def install() -> None:
    pass
    if _FINDER in sys.meta_path:
        sys.meta_path.remove(_FINDER)
    sys.meta_path.insert(0, _FINDER)
    for name in [_PACKAGE] + list(ALIASES):
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
    for name in [_PACKAGE] + list(ALIASES):
        sys.modules.pop(name, None)


install()


def _vendor_api_names() -> None:
    pass
    from enginuity import robolink

    cls = robolink.Enginuity
    for prefix in ("Show", "Hide", "Close", "setFlags"):
        setattr(cls, prefix + "RoboDK", getattr(cls, prefix + "Enginuity"))
    extra = {"getPathRoboDK": robolink.getPathEnginuity}
    for name in list(vars(robolink)):
        if name.startswith("FLAG_ENGINUITY_"):
            extra["FLAG_ROBODK_" + name[len("FLAG_ENGINUITY_"):]] = getattr(robolink, name)
    for name, value in extra.items():
        setattr(robolink, name, value)
        if name not in robolink.__all__:
            robolink.__all__.append(name)


_vendor_api_names()
