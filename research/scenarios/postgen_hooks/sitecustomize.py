# Intercepts file writes and dialog calls to capture noninteractive post outputs.














import builtins
import importlib.abc
import os
import sys

import vendor_aliases  # noqa: F401  (research shim, before the dialogs finder below, which then comes first)

_DIR = os.environ.get("POSTGEN_HOOK_DIR", os.getcwd())
_YES = os.environ.get("POSTGEN_HOOK_YES", "1") == "1"


def _log(*parts):
    sys.stderr.write("HOOK " + " ".join(str(p) for p in parts) + "\n")
    sys.stderr.flush()


_open = builtins.open


_TMP = os.path.realpath(os.environ.get("TMPDIR", "/nonexistent"))


def _keep(path):
    pass
    try:
        real = os.path.realpath(str(path))
        if not real.startswith(_TMP + os.sep):
            return
        dst = os.path.join(_DIR, "_written", os.path.relpath(real, _TMP))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with _open(real, "rb") as src, _open(dst, "wb") as out:
            out.write(src.read())
        _log("kept", dst)
    except OSError as exc:
        _log("keep failed", path, exc)


class _Written:
    pass

    def __init__(self, fh, path):
        self._fh = fh
        self._path = path

    def close(self):
        closed = self._fh.closed
        self._fh.close()
        if not closed:
            _keep(self._path)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False

    def __iter__(self):
        return iter(self._fh)

    def __getattr__(self, name):
        return getattr(self._fh, name)


def _hooked_open(file, mode="r", *args, **kwargs):
    if any(m in str(mode) for m in "wax+"):
        _log("write", file)
        if isinstance(file, (str, bytes, os.PathLike)):
            return _Written(_open(file, mode, *args, **kwargs), os.fsdecode(file))
    return _open(file, mode, *args, **kwargs)


builtins.open = _hooked_open


def _short(v):
    s = repr(v)
    return s if len(s) < 160 else s[:157] + "..."


def _answer(name):
    def fn(*args, **kwargs):
        _log("dialog", name, _short(args), _short(kwargs))
        low = name.lower()
        if "folder" in low:
            return _DIR
        if "save" in low:
            default = kwargs.get("strfile") or kwargs.get("filename") or (args[1] if len(args) > 1 and isinstance(args[1], str) else "file")
            return os.path.join(_DIR, os.path.basename(str(default)) or "file")
        if "open" in low:
            return None
        if low == "inputdialog":
            return kwargs.get("value", args[1] if len(args) > 1 else None)
        if "yesno" in low or "okcancel" in low or low == "mbox":
            return _YES
        return None

    return fn


_DIALOGS = ["ShowMessage", "ShowMessageOkCancel", "ShowMessageYesNo", "ShowMessageYesNoCancel", "InputDialog", "mbox",
            "getOpenFile", "getOpenFileName", "getOpenFileNames", "getOpenFolder", "getSaveFile", "getSaveFileName", "getSaveFolder"]


def _patch(module):
    for name in _DIALOGS:
        if hasattr(module, name):
            setattr(module, name, _answer(name))
    _log("dialogs patched", module.__name__)


class _PatchingLoader(importlib.abc.Loader):
    pass

    def __init__(self, loader):
        self.loader = loader

    def create_module(self, spec):
        return self.loader.create_module(spec)

    def exec_module(self, module):
        self.loader.exec_module(module)
        _patch(module)


class _DialogsFinder(importlib.abc.MetaPathFinder):
    pass

    def find_spec(self, fullname, path=None, target=None):
        if fullname.rsplit(".", 1)[-1] != "robodialogs":
            return None
        for finder in sys.meta_path:
            if finder is self or not hasattr(finder, "find_spec"):
                continue
            spec = finder.find_spec(fullname, path, target)
            if spec is not None and spec.loader is not None:
                spec.loader = _PatchingLoader(spec.loader)
                return spec
        return None


sys.meta_path.insert(0, _DialogsFinder())
