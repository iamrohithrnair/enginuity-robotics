# Loads targeted post specifications and captures their experiment outputs in parallel.

















import os
import sys
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import postgen_blackbox as bb  # noqa: E402

SPECS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "postgen_targeted")
PROG = "TgtProg"


def load(post):
    spec = {}
    with open(os.path.join(SPECS, post + ".py"), encoding="utf-8") as fh:
        exec(compile(fh.read(), fh.name, "exec"), spec)  
    return spec


def run(post, exp, spec):
    name, body = exp[0], exp[1]
    robot = exp[2] if len(exp) > 2 and exp[2] else spec.get("ROBOT", "Robot X")
    extra = exp[3] if len(exp) > 3 else spec.get("EXTRA", "")
    nq = exp[6] if len(exp) > 6 and exp[6] else spec["NQ"]
    axes = exp[5] if len(exp) > 5 and exp[5] else spec.get("AXES")
    prog = exp[7] if len(exp) > 7 and exp[7] else PROG
    body = [ln.strip() for ln in body.strip().splitlines() if ln.strip()]
    lines = bb.header(post, prog, len(body), robot, nq, extra, axes) + bb.start(prog, robot) + body
    if len(exp) > 4 and exp[4]:  
        lines = [ln.replace("native_name=%s" % bb.s(robot), "native_name=%s" % bb.s(exp[4])) for ln in lines]
    if not any(ln.startswith("r.ProgFinish(") for ln in body[-1:]):
        lines.append("r.ProgFinish(%s)" % bb.s(prog))
    out_dir = os.path.join(bb.EVIDENCE, post, "targeted", name)
    meta = {"post": post, "robot": robot, "nq": nq, "axes": axes or bb.AXES[nq], "targeted": name}
    return name, bb.execute(out_dir, prog, lines, meta)


def main():
    post, only = sys.argv[1], sys.argv[2:]
    spec = load(post)
    exps = [e for e in spec["EXPS"] if not only or e[0] in only]
    with ThreadPoolExecutor(8) as ex:
        for name, (code, files, last) in ex.map(lambda e: run(post, e, spec), exps):
            print("%-24s %-24s exit=%-7s %s %s" % (post, name, code, files, " | ".join(last)), flush=True)


if __name__ == "__main__":
    main()
