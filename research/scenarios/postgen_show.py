







import argparse
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EVIDENCE = os.path.join(ROOT, "research", "evidence", "postgen-blackbox")


def describe(data):
    eol = "CRLF" if b"\r\n" in data else ("CR" if b"\r" in data else "LF")
    try:
        data.decode("ascii")
        enc = "ascii"
    except UnicodeDecodeError:
        try:
            data.decode("utf-8")
            enc = "utf-8"
        except UnicodeDecodeError:
            enc = "binary/other"
    return "%d bytes, %s, %s, final-newline=%s" % (len(data), eol, enc, data.endswith(b"\n"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("post")
    ap.add_argument("shape", nargs="?")
    ap.add_argument("--probe", action="append")
    ap.add_argument("--full", action="store_true")
    ap.add_argument("--head", type=int, default=60)
    args = ap.parse_args()
    base = os.path.join(EVIDENCE, args.post)
    for shape in sorted(os.listdir(base)):
        if args.shape and shape != args.shape:
            continue
        probes = ["pgprog", "maincall", "longprog", "manymoves", "types", "names", "edge", "configs", "speedzones", "precision", "turns"]
        probes += sorted(set(os.listdir(os.path.join(base, shape))) - set(probes))
        for probe in probes:
            if args.probe and probe not in args.probe:
                continue
            folder = os.path.join(base, shape, probe)
            if not os.path.isdir(folder):
                continue
            with open(os.path.join(folder, "_run.json")) as fh:
                meta = json.load(fh)
            err = open(os.path.join(folder, "_stderr.txt"), errors="replace").read().strip().splitlines()
            out = [l for l in open(os.path.join(folder, "_stdout.txt"), errors="replace").read().splitlines() if not l.startswith(("Using Python", "RoboDK Post Processor", "SAVED:", "Total instructions"))]
            print("#" * 8, args.post, shape, probe, "exit=%s" % meta["exit"], ("stderr: " + err[-1]) if err else "", ("stdout: " + " | ".join(out[:4])) if out else "")
            names = []
            for root, _dirs, files in os.walk(folder):
                for f in files:
                    if root == folder and f.startswith(("_", "intermediate_")):
                        continue
                    names.append(os.path.relpath(os.path.join(root, f), folder))
            for name in sorted(names):
                data = open(os.path.join(folder, name), "rb").read()
                print("=" * 4, name, "(%s)" % describe(data))
                text = data.decode("utf-8", "replace").replace("\r\n", "\n").split("\n")
                if args.full or len(text) <= args.head:
                    print("\n".join(text))
                else:
                    k = args.head // 2
                    print("\n".join(text[:k]))
                    print("... (%d lines omitted) ..." % (len(text) - 2 * k))
                    print("\n".join(text[-k:]))


if __name__ == "__main__":
    main()
