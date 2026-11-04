









import json
import os
import sys

POSTS_DIR = os.environ.get("ROBODK_POSTS", os.path.expanduser("~/RoboDK/RoboDK.app/Contents/Posts"))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "python"))

from robocraft_post import posts  # noqa: E402,F401
from robocraft_post.base import REGISTRY  # noqa: E402


def main():
    with open(os.path.join(ROOT, "research", "evidence", "postgen-blackbox", "library-default-posts.json"), encoding="utf-8") as fh:
        lib = json.load(fh)
    robots = lib["robots"]
    with_post = [r for r in robots if r["post"] and r["post"] != "(none)"]
    have = {k.lower() for k in REGISTRY}
    covered = [r for r in with_post if r["post"].lower() in have]
    by_post = {}
    for r in with_post:
        by_post.setdefault(r["post"], [0, r["post"].lower() in have])[0] += 1
    shipped = {f[:-3].lower() for f in os.listdir(POSTS_DIR) if f.endswith(".py")} if os.path.isdir(POSTS_DIR) else None
    print("library robots: %d, with a default post: %d, covered: %d (%.1f%%), registered posts: %d"
          % (len(robots), len(with_post), len(covered), 100.0 * len(covered) / len(with_post), len(REGISTRY)))
    if shipped is not None:
        real = [r for r in with_post if r["post"].lower() in shipped]
        real_cov = [r for r in real if r["post"].lower() in have]
        print("default post shipped with RoboDK: %d robots (%d posts), covered: %d (%.1f%%)"
              % (len(real), len({r["post"] for r in real}), len(real_cov), 100.0 * len(real_cov) / len(real)))
    for name, (count, ok) in sorted(by_post.items(), key=lambda kv: (-kv[1][0], kv[0])):
        tag = "" if shipped is None else ("" if name.lower() in shipped else "  (not shipped with RoboDK)")
        print("  %-28s %4d  %s%s" % (name, count, "yes" if ok else "-", tag))
    if "--json" in sys.argv:
        out = sys.argv[sys.argv.index("--json") + 1]
        with open(out, "w", encoding="utf-8") as fh:
            json.dump({"robots": len(robots), "withPost": len(with_post), "covered": len(covered),
                       "posts": {k: {"robots": v[0], "implemented": v[1]} for k, v in by_post.items()}}, fh, indent=1)


if __name__ == "__main__":
    main()
