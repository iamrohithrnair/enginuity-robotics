# Compares post outputs with captures while normalizing volatile fields and known divergences.











from __future__ import annotations

import difflib
import glob
import gzip
import io
import json
import os
import re
import struct
import sys
import zipfile
from dataclasses import dataclass, field
from typing import List, Optional

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if os.path.join(ROOT, "python") not in sys.path:
    sys.path.insert(0, os.path.join(ROOT, "python"))

from robocraft_post import posts  # noqa: E402,F401  (registers the posts)
from robocraft_post.base import get_post  # noqa: E402
from robocraft_post.intermediate import run  # noqa: E402
from robocraft_post.posts import hans, kinova, xarm  # noqa: E402
EVIDENCE = os.path.join(ROOT, "research", "evidence", "postgen-blackbox")


@dataclass
class Case:
    post: str
    shape: str
    probe: str
    folder: str
    intermediate: str
    exit: object
    expected: List[str]
    error: Optional[str]


@dataclass
class Outcome:
    case: Case
    ok: bool
    problems: List[str] = field(default_factory=list)


def cases(post: Optional[str] = None) -> List[Case]:
    out = []
    for f in sorted(glob.glob(os.path.join(EVIDENCE, post or "*", "*", "*", "intermediate_*.py"))):
        folder = os.path.dirname(f)
        rel = os.path.relpath(folder, EVIDENCE).split(os.sep)
        with open(os.path.join(folder, "_run.json"), encoding="utf-8") as fh:
            meta = json.load(fh)
        with open(os.path.join(folder, "_stderr.txt"), encoding="utf-8", errors="replace") as fh:
            err = [ln for ln in fh.read().splitlines() if ln.strip()]
        names = []
        for root, dirs, files in os.walk(folder):
            if root == folder:
                
                
                dirs[:] = [d for d in dirs if not d.startswith("_")]
            for fn in files:
                if root == folder and fn.startswith(("_", "intermediate_")):
                    continue
                names.append(os.path.relpath(os.path.join(root, fn), folder).replace(os.sep, "/"))
        
        
        written = os.path.join(folder, "_written")
        if os.path.isdir(written):
            for root, _dirs, files in os.walk(written):
                for fn in files:
                    names.append(os.path.relpath(os.path.join(root, fn), folder).replace(os.sep, "/"))
        names.sort()
        out.append(Case(rel[0], rel[1], rel[2], folder, f, meta.get("exit"), names, err[-1] if err else None))
    return out


def output_name(name: str) -> str:
    pass
    parts = name.split("/")
    return "/".join(parts[2:]) if parts[0] == "_written" and len(parts) > 2 else name


def _bytes(content) -> bytes:
    return content if isinstance(content, bytes) else content.encode("utf-8")


def _mask(post: str, data: bytes) -> bytes:
    pass
    cls = get_post(post)
    for pattern in getattr(cls, "VOLATILE", ()):
        data = re.sub(pattern, b"<volatile>", data)
    return data





PRODUCT_NAME = [(b"RoboDK v6.0.7", b"Enginuity v1.0.0"), (b"RoboDK", b"Enginuity")]




_THEIR_PYTHON_DIR = "/workspace/src/RoboDK/RoboDK.app/Contents/Posts/../Python"
PRODUCT_TEXT = {
    
    "XArm": [(_THEIR_PYTHON_DIR.encode(), xarm.PYTHON_DIR.encode())],
    
    "Kinova": [
        (b"from robodk import robolink", b"from enginuity import robolink"),
        (b'(Path(robolink.getPathRoboDK()) / "../../Python/").resolve().as_posix()', kinova.OUR_PATH.encode()),
        (b"installed in C:/RoboDK/Python and/or in PYTHONPATH. Contact us at info@robodk.com if the issue persist.", kinova.OUR_INSTALL.encode()),
    ],
    "Hans": [(b"TCP_roboDK", hans.TCP.encode())],
    "Igus": [(b"robodk", b"enginuity")],
}





HEADER_MASK = {
    "Automata": re.compile(rb"\A.*?(?=^# Program Start,|^if __name__ == \"__main__\":)", re.S | re.M),
}


def _post_table(table: dict, post: Optional[str]) -> list:
    cls = get_post(post) if post else None
    for klass in getattr(cls, "__mro__", ()):
        if klass.__name__ in table:
            return table[klass.__name__] if isinstance(table[klass.__name__], list) else [table[klass.__name__]]
    return []


def normalise_product(data: bytes, post: Optional[str] = None) -> bytes:
    pass
    for theirs, ours in _post_table(PRODUCT_TEXT, post) + PRODUCT_NAME:
        data = data.replace(theirs, ours)
    for pattern in _post_table(HEADER_MASK, post):
        data = pattern.sub(b"<driver header>\n", data, count=1)
    return data


def comparable_name(post: str, name: str) -> str:
    pass
    return normalise_product(name.encode("utf-8"), post).decode("utf-8")


def _comparable(post: str, name: str, data: bytes) -> bytes:
    pass
    if name.lower().endswith(".urp"):
        try:
            data = gzip.decompress(data)
        except OSError:
            pass
    elif name.lower().endswith(".zip"):  
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                data = b"".join(b"== %s %o\n" % (i.filename.encode(), i.external_attr >> 16) + z.read(i.filename) + b"\n" for i in sorted(z.infolist(), key=lambda i: i.filename))
        except zipfile.BadZipFile:
            pass
    return _mask(post, normalise_product(data, post))







ENVIRONMENT_FAILURES = ("Unable to load or install", "macOS 26 (2600) or later required", "Enginuity is not running on")



KNOWN_DIVERGENCES = {
    ("Rokae", "targeted", "tool_quaternion"): "signed zero of a quaternion component for exact half turns about X or Y "
    "(the reference application prints -0.000000 for q4; the rule behind the sign could not be recovered from the outputs)",
}


def known_divergence(case: Case) -> Optional[str]:
    return KNOWN_DIVERGENCES.get((case.post, case.shape, case.probe))


def environment_failure(case: Case) -> bool:
    if case.exit == "timeout" or case.exit == -6:
        return True
    return bool(case.error) and any(m in case.error for m in ENVIRONMENT_FAILURES)


class _Wire:
    def __init__(self, data: bytes):
        self.data, self.pos = data, 0

    def line(self) -> str:
        end = self.data.index(b"\n", self.pos)
        out, self.pos = self.data[self.pos : end].decode("utf-8"), end + 1
        return out

    def take(self, fmt: str):
        vals = struct.unpack_from(fmt, self.data, self.pos)
        self.pos += struct.calcsize(fmt)
        return vals

    def int(self) -> int:
        return self.take(">i")[0]

    def array(self) -> List[float]:
        n = self.int()
        return list(self.take(">%dd" % n))


def api_kinematics(folder: str) -> Optional[list]:
    pass
    path = os.path.join(folder, "_api.log")
    if not os.path.exists(path):
        return None
    sent, got = b"", b""
    with open(path, encoding="utf-8") as fh:
        for ln in fh:
            tag, data = ln.split()
            if tag == ">":
                sent += bytes.fromhex(data)
            else:
                got += bytes.fromhex(data)
    req, ans = _Wire(sent), _Wire(got)
    out: dict = {}
    while req.pos < len(sent):
        name = req.line()
        if name == "RDK_API":
            req.array()
            ans.line(), ans.int(), ans.int()
        elif name == "G_Item_Type":
            req.take(">Q")
            ans.int()
        elif name in ("G_FK", "G_Thetas_Config"):
            joints = tuple(req.array())
            req.take(">Q")
            entry = out.setdefault(joints, {"joints": list(joints)})
            if name == "G_FK":
                col = ans.take(">16d")  
                entry["pose"] = [[col[c * 4 + r] for c in range(4)] for r in range(4)]
            else:
                entry["config"] = ans.array()
        else:
            raise ValueError("%s: API request %s is not decoded" % (path, name))
        if ans.int() != 0:
            raise ValueError("%s: API error answer to %s" % (path, name))
    return list(out.values())


def check(case: Case, diff_lines: int = 0) -> Outcome:
    with open(case.intermediate, encoding="utf-8") as fh:
        source = fh.read()
    res = run(source, kinematics=api_kinematics(case.folder))
    oc = Outcome(case, True)
    if environment_failure(case):
        
        if not case.expected:
            return oc
        if not res.ok:
            oc.problems.append("RoboCraft's post failed: %s" % res.error)
    elif case.exit != 0:
        
        if res.ok:
            oc.problems.append("the reference post failed (%s) but RoboCraft's succeeded" % case.error)
        else:
            
            err = normalise_product(case.error.encode("utf-8"), case.post).decode("utf-8") if case.error else case.error
            if err and err not in (res.error or "") and (res.error or "") not in err:
                oc.problems.append("error differs:\n  reference: %s\n  RoboCraft: %s" % (err, res.error))
    elif not res.ok:
        oc.problems.append("RoboCraft's post failed: %s" % res.error)
    ours = {comparable_name(case.post, n): _bytes(c) for n, c in res.files}
    expected = {comparable_name(case.post, output_name(n)): n for n in case.expected}
    if sorted(ours) != sorted(expected):
        oc.problems.append("files differ: reference %s, RoboCraft %s" % (sorted(expected), sorted(ours)))
    for name, original in sorted(expected.items()):
        if name not in ours:
            continue
        with open(os.path.join(case.folder, original), "rb") as fh:
            theirs = _comparable(case.post, name, fh.read())
        ours[name] = _comparable(case.post, name, ours[name])
        if ours[name] != theirs:
            msg = "%s differs" % name
            if diff_lines:
                a = theirs.decode("utf-8", "replace").splitlines(True)
                b = ours[name].decode("utf-8", "replace").splitlines(True)
                d = list(difflib.unified_diff(a, b, "reference/" + name, "RoboCraft/" + name, n=1))
                if not d:
                    d = ["(line endings or trailing bytes differ: reference %r... RoboCraft %r...)\n" % (theirs[-12:], ours[name][-12:])]
                msg += "\n" + "".join(repr(x)[1:-1] + "\n" if "\r" in x else x for x in d[:diff_lines])
            oc.problems.append(msg)
    oc.ok = not oc.problems
    return oc


def main(argv: List[str]) -> int:
    import argparse

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("post")
    ap.add_argument("--shape")
    ap.add_argument("--probe")
    ap.add_argument("-n", type=int, default=40, help="diff lines per file")
    args = ap.parse_args(argv)
    if get_post(args.post) is None:
        print("no RoboCraft post named %s" % args.post)
        return 2
    passed = failed = 0
    for c in cases(args.post):
        if (args.shape and c.shape != args.shape) or (args.probe and c.probe != args.probe):
            continue
        oc = check(c, args.n)
        if oc.ok:
            passed += 1
            continue
        if known_divergence(c):
            print("KNOWN %s/%s/%s: %s" % (c.post, c.shape, c.probe, known_divergence(c)))
            continue
        failed += 1
        print("FAIL %s/%s/%s" % (c.post, c.shape, c.probe))
        for p in oc.problems:
            print("  " + p.replace("\n", "\n  "))
    print("%s: %d passed, %d failed" % (args.post, passed, failed))
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
