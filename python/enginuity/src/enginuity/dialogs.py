











from __future__ import annotations

import json
import logging
import os
import sys
import threading
from typing import IO, Any, List, Optional, Sequence, Tuple, Union

from .errors import EnginuityConnectionError, EnginuityError, NotSupportedError

__all__ = [
    "mbox",
    "ShowMessage",
    "ShowMessageOkCancel",
    "ShowMessageYesNo",
    "ShowMessageYesNoCancel",
    "InputDialog",
    "getOpenFileName",
    "getOpenFileNames",
    "getSaveFileName",
    "getOpenFile",
    "getSaveFile",
    "getOpenFolder",
    "getSaveFolder",
    "set_connection",
]

logger = logging.getLogger("enginuity")

Button = Union[str, Tuple[str, Any]]

_link_lock = threading.Lock()
_link: Any = None
_link_failed = False


def set_connection(link: Any) -> None:
    pass
    global _link, _link_failed
    with _link_lock:
        _link = link
        _link_failed = link is None


def _connection() -> Any:
    global _link, _link_failed
    with _link_lock:
        if _link is None and not _link_failed:
            from .robolink import Enginuity

            try:
                _link = Enginuity()
            except EnginuityConnectionError as e:
                logger.info("Dialogs use the console: %s", e)
                _link_failed = True
        return _link


def _ask(message: str, buttons: Sequence[str], title: str, entry: Optional[str]) -> Tuple[str, str]:
    pass
    link = _connection()
    if link is not None:
        try:
            return link.ShowDialog(message, buttons, title, entry)
        except NotSupportedError:
            if entry is None and len(buttons) == 1:
                link.ShowMessage(message, True)
                return buttons[-1], ""
        except EnginuityError as e:
            logger.warning("Could not show the dialog in Enginuity (%s); using the console", e)
    return _console(message, buttons, title, entry)


def _console(message: str, buttons: Sequence[str], title: str, entry: Optional[str]) -> Tuple[str, str]:
    head = "[%s] " % title if title else ""
    print("%s%s" % (head, message), flush=True)
    interactive = sys.stdin is not None and hasattr(sys.stdin, "isatty") and sys.stdin.isatty()
    default = buttons[-1] if buttons else ""
    if not interactive:
        return default, (entry or "")
    if entry is not None:
        text = input("Value [%s]: " % entry)
        return default, (text if text != "" else entry)
    if len(buttons) <= 1:
        input("Press Enter to continue ")
        return default, ""
    choice = input("Choose %s [%s]: " % (" / ".join(buttons), default)).strip().lower()
    for b in buttons:
        if choice and (b.lower() == choice or b.lower().startswith(choice)):
            return b, ""
    return default, ""


def _label(b: Button) -> str:
    return str(b[0]) if isinstance(b, (tuple, list)) else str(b)


def mbox(msg: str, b1: Button = "OK", b2: Button = "Cancel", frame: bool = True, t: bool = False, entry: Any = None, *args: Any, **kwargs: Any) -> Any:
    pass
    title = kwargs.get("title", "") or (str(t) if t and not isinstance(t, bool) else "")
    first = _label(b1)
    has_second = b2 is not None and b2 != ""
    
    labels = ([_label(b2)] if has_second else []) + [first]
    button, text = _ask(str(msg), labels, title, None if entry is None else str(entry))
    if button == first:
        return text if entry is not None else _value(b1, True)
    return _value(b2, False) if has_second else False


def _value(b: Button, default: Any) -> Any:
    if isinstance(b, (tuple, list)) and len(b) > 1:
        return b[1]
    return default


def ShowMessage(msg: str, title: Optional[str] = None) -> None:
    pass
    _ask(str(msg), ["OK"], title or "", None)


def ShowMessageOkCancel(msg: str, title: Optional[str] = None) -> bool:
    pass
    button, _ = _ask(str(msg), ["Cancel", "OK"], title or "", None)
    return button == "OK"


def ShowMessageYesNo(msg: str, title: Optional[str] = None) -> bool:
    pass
    button, _ = _ask(str(msg), ["No", "Yes"], title or "", None)
    return button == "Yes"


def ShowMessageYesNoCancel(msg: str, title: Optional[str] = None) -> Optional[bool]:
    pass
    button, _ = _ask(str(msg), ["Cancel", "No", "Yes"], title or "", None)
    if button == "Yes":
        return True
    if button == "No":
        return False
    return None


def InputDialog(msg: str, value: Any, title: Optional[str] = None, default_button: bool = False, *args: Any, **kwargs: Any) -> Any:
    pass
    if isinstance(value, (list, tuple, dict)):
        shown = json.dumps(value)
    elif isinstance(value, bool):
        shown = "1" if value else "0"
    else:
        shown = "" if value is None else str(value)
    button, text = _ask(str(msg), ["Cancel", "OK"], title or "", shown)
    if button != "OK":
        return None
    try:
        if isinstance(value, bool):
            return text.strip().lower() in ("1", "true", "yes", "on")
        if isinstance(value, int):
            return int(float(text))
        if isinstance(value, float):
            return float(text)
        if isinstance(value, (list, tuple, dict)):
            out = json.loads(text)
            return type(value)(out) if isinstance(value, tuple) else out
    except ValueError:
        logger.warning("InputDialog: %r is not a valid %s", text, type(value).__name__)
        return None
    return text


def _path_dialog(title: str, message: str, default: str) -> Optional[str]:
    button, text = _ask(message, ["Cancel", "OK"], title, default)
    if button != "OK" or not text.strip():
        return None
    return os.path.expanduser(text.strip())


def _filetypes_hint(filetypes: Any) -> str:
    try:
        pats = ["%s (%s)" % (n, p) for n, p in filetypes]
    except (TypeError, ValueError):
        return ""
    return "<br>File types: " + ", ".join(pats) if pats else ""


def getOpenFileName(path_preference: str = "", strfile: str = "", strtitle: str = "Open file ...", defaultextension: str = ".txt",
                    filetypes: Any = (("All files", ".*"), ("Text files", ".txt"))) -> Optional[str]:
    pass
    default = os.path.join(path_preference, strfile) if path_preference else strfile
    return _path_dialog(strtitle, "Path of the file to open:" + _filetypes_hint(filetypes), default)


def getOpenFileNames(path_preference: str = "", strfile: str = "", strtitle: str = "Open file(s) ...", defaultextension: str = ".txt",
                     filetypes: Any = (("All files", ".*"), ("Text files", ".txt"))) -> Optional[List[str]]:
    pass
    default = os.path.join(path_preference, strfile) if path_preference else strfile
    text = _path_dialog(strtitle, "Paths of the files to open, separated by ';':" + _filetypes_hint(filetypes), default)
    if text is None:
        return None
    return [os.path.expanduser(p.strip()) for p in text.split(";") if p.strip()]


def getSaveFileName(path_preference: str = "", strfile: str = "file.txt", strtitle: str = "Save file as ...", defaultextension: str = ".txt",
                    filetypes: Any = (("All files", ".*"), ("Text files", ".txt"))) -> Optional[str]:
    pass
    default = os.path.join(path_preference, strfile) if path_preference else strfile
    path = _path_dialog(strtitle, "Save the file as:" + _filetypes_hint(filetypes), default)
    if path and defaultextension and not os.path.splitext(path)[1]:
        path += defaultextension
    return path


def getOpenFile(path_preference: str = "", strfile: str = "", strtitle: str = "Open file ...", defaultextension: str = ".txt",
                filetypes: Any = (("All files", ".*"), ("Text files", ".txt"))) -> Optional[IO[str]]:
    pass
    path = getOpenFileName(path_preference, strfile, strtitle, defaultextension, filetypes)
    return open(path, "r", encoding="utf-8") if path else None


def getSaveFile(path_preference: str = "", strfile: str = "file.txt", strtitle: str = "Save file as ...", defaultextension: str = ".txt",
                filetypes: Any = (("All files", ".*"), ("Text files", ".txt"))) -> Optional[IO[str]]:
    pass
    path = getSaveFileName(path_preference, strfile, strtitle, defaultextension, filetypes)
    if not path:
        return None
    folder = os.path.dirname(path)
    if folder:
        os.makedirs(folder, exist_ok=True)
    return open(path, "w", encoding="utf-8")


def getOpenFolder(path_preference: str = "", strtitle: str = "Open folder ...") -> Optional[str]:
    pass
    return _path_dialog(strtitle, "Folder:", path_preference)


def getSaveFolder(path_programs: str = "", popup_msg: str = "Select a directory to save your program") -> Optional[str]:
    pass
    return _path_dialog("Save to folder", popup_msg, path_programs)
