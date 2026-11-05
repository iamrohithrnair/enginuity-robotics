# Runs post-generation cases with stubbed robot SDK modules on the import path.








import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import postgen_blackbox as bb  # noqa: E402

STUBS = os.path.join(HERE, "postgen_stubs")
bb.PYPATH = STUBS + ":" + bb.PYPATH
_execute = bb.execute


def execute(out_dir, prog, lines, meta):
    return _execute(out_dir, prog, lines, dict(meta, stub_modules=sorted(f[:-3] for f in os.listdir(STUBS) if f.endswith(".py"))))


bb.execute = execute

if __name__ == "__main__":
    sys.argv = ["postgen_blackbox.py"] + sys.argv[1:]
    bb.main()
