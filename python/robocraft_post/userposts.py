# Inspects, validates and loads user-defined subclasses of built-in robot posts.















from __future__ import annotations

import ast
import sys
import types
from typing import Dict, Optional

from . import posts  # noqa: F401  (registers the built-in posts)
from .base import REGISTRY, RobotPost

TEMPLATE = '''"""Post processor %(name)s: %(base)s customized in Enginuity (Program > Add/Edit Post Processor)."""
from %(base)s import RobotPost as BasePost


class RobotPost(BasePost):
%(body)s
'''


def class_variables(base: str) -> Dict[str, object]:
    pass
    cls = REGISTRY[base]
    out: Dict[str, object] = {}
    for klass in reversed(cls.__mro__):
        for key, value in vars(klass).items():
            if key.isupper() and isinstance(value, (str, int, float, bool)) and not key.startswith("_"):
                out[key] = value
    return out


def template(name: str, base: str) -> str:
    pass
    if base not in REGISTRY:
        raise KeyError("Unknown post processor %s" % base)
    lines = ["    # Customize the variables of %s here:" % base]
    for key, value in sorted(class_variables(base).items()):
        lines.append("    %s = %r" % (key, value))
    if len(lines) == 1:
        lines.append("    pass")
    return TEMPLATE % {"name": name, "base": base, "body": "\n".join(lines)}


def code_only(source: str) -> str:
    pass
    tree = ast.parse(source)
    for node in ast.walk(tree):
        body = getattr(node, "body", None)
        if isinstance(body, list) and body and isinstance(body[0], ast.Expr) and isinstance(getattr(body[0], "value", None), ast.Constant) and isinstance(body[0].value.value, str):
            node.body = body[1:] or [ast.Pass()]
    return ast.unparse(tree) + "\n"


def check(source: str) -> Dict[str, object]:
    pass
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        return {"ok": False, "error": "SyntaxError: %s (line %s)" % (exc.msg, exc.lineno), "base": None}
    base = None
    for node in tree.body:
        if isinstance(node, ast.ImportFrom) and node.module and any(a.name == "RobotPost" for a in node.names):
            base = node.module
    has_class = any(isinstance(n, ast.ClassDef) and n.name == "RobotPost" for n in tree.body)
    if not has_class:
        return {"ok": False, "error": "The post processor must define a class named RobotPost", "base": base}
    if base is not None and base not in REGISTRY:
        return {"ok": False, "error": "Unknown base post processor %s" % base, "base": base}
    return {"ok": True, "error": None, "base": base}


def _base_modules() -> None:
    pass
    for name, cls in REGISTRY.items():
        if name not in sys.modules:
            mod = types.ModuleType(name)
            mod.RobotPost = cls  # type: ignore[attr-defined]
            sys.modules[name] = mod


def load(name: str, path: str) -> type:
    pass
    _base_modules()
    with open(path, encoding="utf-8") as fh:
        source = fh.read()
    mod = types.ModuleType("robocraft_user_post_%s" % name)
    mod.__file__ = path
    exec(compile(source, path, "exec"), mod.__dict__)  
    cls: Optional[type] = getattr(mod, "RobotPost", None)
    if not isinstance(cls, type) or not issubclass(cls, RobotPost):
        raise TypeError("%s: RobotPost must derive from one of Enginuity's post processors" % name)
    return type(cls.__name__, (cls,), {"name": name, "__module__": mod.__name__})
