
import importlib as _importlib
import pkgutil as _pkgutil

for _m in sorted(m.name for m in _pkgutil.iter_modules(__path__)):
    if not _m.startswith("_"):
        _importlib.import_module("%s.%s" % (__name__, _m))
