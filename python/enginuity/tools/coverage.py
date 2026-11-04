












from __future__ import annotations

import ast
import inspect
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(HERE, "..", "src"))

from enginuity import dialogs, fileio, robomath, utils  # noqa: E402
from enginuity import robolink as rl  # noqa: E402


def server_commands() -> tuple:
    pass
    names = set()
    fallback = set()
    folder = os.path.join(ROOT, "src", "server", "rdkapi")
    for f in sorted(os.listdir(folder)):
        if not f.endswith(".ts"):
            continue
        src = open(os.path.join(folder, f), encoding="utf-8").read()
        names.update(re.findall(r'\bdef\(\s*"([A-Za-z0-9_]+)"', src))
        names.update(re.findall(r'\bnoArgs\(\s*"([A-Za-z0-9_]+)"', src))
        for group in re.findall(r"for \(const name of \[([^\]]+)\]\)\s*\{\s*\n\s*def\(name", src):
            names.update(re.findall(r'"([A-Za-z0-9_]+)"', group))
        m = re.search(r"const UNSUPPORTED[^=]*=\s*\{([^}]+)\}", src)
        if m:
            fallback.update(re.findall(r"^\s*([A-Za-z0-9_]+):", m.group(1), flags=re.M))
    return sorted(names), sorted(fallback - names)


def method_commands(cls, commands: set) -> dict:
    pass
    out = {}
    for name, fn in inspect.getmembers(cls, predicate=inspect.isfunction):
        if name.startswith("__"):
            continue
        try:
            src = inspect.getsource(fn)
        except (OSError, TypeError):
            continue
        out[name] = sorted(set(re.findall(r'"([A-Za-z0-9_]+)"', src)) & commands)
    return out


def main() -> None:
    usage_path = sys.argv[1] if len(sys.argv) > 1 else None
    out_path = sys.argv[2] if len(sys.argv) > 2 else None
    cmds, fallback = server_commands()
    known = set(cmds) | set(fallback) | {"Gun_Add", "Gun_SetState", "Gun_Stats", "Gun_Clear", "MeasLT2", "MeasPose4", "S_Gen_Mat", "S_ValueMat", "S_Gen_Str"}
    link = method_commands(rl.Enginuity, known)
    item = method_commands(rl.Item, known)
    
    sent = set()
    for table in (link, item):
        for v in table.values():
            sent.update(v)
    for fn in (rl.EmbedWindow,):
        sent.update(set(re.findall(r'"([A-Za-z0-9_]+)"', inspect.getsource(fn))) & known)
    protocol = {"RDK_API", "RDK_EVT", "RDK_EVT_FILTER", "CMD_START"}
    sent.update(protocol & set(cmds))  
    unused = [c for c in cmds if c not in sent]
    extra = sorted(c for c in sent if c not in cmds)
    report = {
        "server_commands": len(cmds),
        "server_fallback_only": fallback,
        "commands_sent_by_the_package": len([c for c in cmds if c in sent]),
        "server_commands_not_sent": unused,
        "package_commands_not_on_this_server": extra,
        "public_methods": {"Enginuity": len([k for k in link if not k.startswith("_")]), "Item": len([k for k in item if not k.startswith("_")])},
        "methods": {"Enginuity": {k: v for k, v in link.items() if v}, "Item": {k: v for k, v in item.items() if v}},
        "robomath_functions": len(robomath.__all__),
        "constants": len([n for n in rl.__all__ if n.isupper()]),
    }
    if usage_path:
        usage = json.load(open(usage_path))
        provided = set(dir(rl.Enginuity)) | set(dir(rl.Item)) | set(dir(robomath.Mat)) | set(rl.__all__) | set(robomath.__all__)
        provided |= set(dialogs.__all__) | set(fileio.__all__) | set(utils.__all__)
        api_like = re.compile(r"^(?:[A-Z][A-Za-z0-9_]*|set[A-Z]\w*|get[A-Z]\w*|is[A-Z]\w*|add[A-Z]\w*|[a-z]+_2_[a-z]+|[a-z0-9]+3)$")
        used = {}
        for name, n in usage["attr_calls"] + usage["free_names"]:
            if api_like.match(name) or name in provided:
                used[name] = used.get(name, 0) + n
        covered = {k: v for k, v in used.items() if k in provided}
        missing = {k: v for k, v in sorted(used.items(), key=lambda kv: -kv[1]) if k not in provided}
        report["example_usage"] = {
            "api_like_names_used": len(used),
            "provided": len(covered),
            "uses_covered": sum(covered.values()),
            "uses_total": sum(used.values()),
            "not_provided": missing,
        }
    text = json.dumps(report, indent=1)
    if out_path:
        with open(out_path, "w") as fh:
            fh.write(text + "\n")
    print(text)


if __name__ == "__main__":
    main()
