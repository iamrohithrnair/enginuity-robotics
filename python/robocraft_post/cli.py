# Exposes post discovery, source inspection and intermediate-program execution as a JSON CLI.





















import argparse
import base64
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from robocraft_post import posts  # noqa: E402,F401  (registers post processors)
from robocraft_post.base import REGISTRY, post_names  # noqa: E402
from robocraft_post.intermediate import IntermediateError, run  # noqa: E402
from robocraft_post import userposts  # noqa: E402


def _file(name, content):
    if isinstance(content, bytes):
        return {"name": name, "content": base64.b64encode(content).decode("ascii"), "encoding": "base64"}
    return {"name": name, "content": content, "encoding": "utf-8"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true", help="print the available post processors")
    ap.add_argument("--post", default=None, help="override the post named in the intermediate file")
    ap.add_argument("--source", default=None, help="print the source file and class variables of a post")
    ap.add_argument("--template", default=None, help="print a new user post named TEMPLATE deriving from --base")
    ap.add_argument("--base", default=None)
    ap.add_argument("--check", action="store_true", help="parse a user post read from stdin (never run)")
    args = ap.parse_args()
    if args.list:
        print(json.dumps([{"name": n, "assumed": bool(getattr(REGISTRY[n], "assumed", False))} for n in post_names()]))
        return 0
    if args.source:
        cls = REGISTRY.get(args.source)
        if cls is None:
            print(json.dumps({"ok": False, "error": "Unknown post processor %s" % args.source}))
            return 1
        path = sys.modules[cls.__module__].__file__
        with open(path, encoding="utf-8") as fh:
            source = userposts.code_only(fh.read())
        print(json.dumps({"ok": True, "file": os.path.basename(path), "source": source, "variables": userposts.class_variables(args.source)}))
        return 0
    if args.template:
        try:
            print(json.dumps({"ok": True, "source": userposts.template(args.template, args.base or "")}))
            return 0
        except KeyError as exc:
            print(json.dumps({"ok": False, "error": str(exc).strip("'\"")}))
            return 1
    if args.check:
        print(json.dumps(userposts.check(sys.stdin.read())))
        return 0
    try:
        request = json.load(sys.stdin)
        source = request["intermediate"]
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        print(json.dumps({"ok": False, "files": [], "log": "", "error": "Invalid request: %s" % exc}))
        return 1
    post_class = None
    user = request.get("user_post")
    if isinstance(user, dict) and user.get("path"):
        try:
            post_class = userposts.load(str(user.get("name")), str(user["path"]))
        except Exception as exc:  
            print(json.dumps({"ok": False, "files": [], "log": "", "error": "%s: %s" % (type(exc).__name__, exc)}))
            return 1
    try:
        kin = request.get("kinematics") if isinstance(request.get("kinematics"), list) else None
        res = run(source, args.post or request.get("post") or None, post_class, kin)
    except IntermediateError as exc:
        print(json.dumps({"ok": False, "files": [], "log": "", "error": str(exc)}))
        return 1
    print(
        json.dumps(
            {
                "ok": res.ok,
                "post": res.post,
                "total": res.total_instructions,
                "files": [_file(n, c) for n, c in res.files],
                "log": "\n".join(res.stdout),
                "error": res.error,
            }
        )
    )
    return 0 if res.ok else 1


if __name__ == "__main__":
    sys.exit(main())
