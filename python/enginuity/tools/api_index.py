# Generates Markdown API tables from public client classes and helper functions.




from __future__ import annotations

import inspect
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src"))

from enginuity import dialogs, errors, fileio, robolink, robomath, utils  # noqa: E402


def first_line(obj) -> str:
    doc = inspect.getdoc(obj) or ""
    return doc.split("\n\n")[0].replace("\n", " ").strip()


def signature(fn) -> str:
    pass
    try:
        params = inspect.signature(fn).parameters.values()
    except (TypeError, ValueError):
        return "(...)"
    parts = []
    for p in params:
        if p.name == "self":
            continue
        if p.kind is p.VAR_POSITIONAL:
            parts.append("*" + p.name)
        elif p.kind is p.VAR_KEYWORD:
            parts.append("**" + p.name)
        elif p.default is p.empty:
            parts.append(p.name)
        else:
            parts.append("%s=%r" % (p.name, p.default))
    return "(%s)" % ", ".join(parts)


def methods(cls) -> list:
    out = []
    for name, fn in sorted(inspect.getmembers(cls, predicate=inspect.isfunction), key=lambda kv: kv[0].lower()):
        if name.startswith("_"):
            continue
        alias = fn.__name__ != name
        doc = ("Same as `%s`." % fn.__name__) if alias else first_line(fn)
        out.append("| `%s%s` | %s |" % (name, "" if alias else signature(fn), doc.replace("|", "\\|")))
    return out


def functions(module, names) -> list:
    out = []
    for name in sorted(names, key=str.lower):
        obj = getattr(module, name, None)
        if not callable(obj) or inspect.isclass(obj):
            continue
        out.append("| `%s%s` | %s |" % (name, signature(obj), first_line(obj).replace("|", "\\|")))
    return out


def table(title: str, rows: list) -> str:
    return "### %s\n\n| Name | Description |\n|---|---|\n%s\n" % (title, "\n".join(rows))


def main() -> None:
    parts = [
        table("Enginuity (alias Robolink): the connection", methods(robolink.Enginuity)),
        table("Item: stations, robots, tools, frames, objects, targets, programs", methods(robolink.Item)),
        table("Mat", methods(robomath.Mat)),
        table("robomath functions", functions(robomath, [n for n in robomath.__all__ if n not in ("pi",)])),
        table("dialogs", functions(dialogs, dialogs.__all__)),
        table("fileio", functions(fileio, fileio.__all__)),
        table("utils", functions(utils, utils.__all__)),
        table("robolink module functions", functions(robolink, ["EmbedWindow", "import_install", "getPathIcon", "getPathEnginuity"])),
    ]
    errs = ["| `%s` | %s |" % (n, first_line(getattr(errors, n))) for n in errors.__all__ if inspect.isclass(getattr(errors, n))]
    parts.append(table("Errors", errs))
    print("\n".join(parts))


if __name__ == "__main__":
    main()
