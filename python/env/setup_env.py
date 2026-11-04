


















from __future__ import annotations

import json
import os
import subprocess
import sys
import venv

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
ALLOWLIST = os.path.join(HERE, "allowlist.json")
REQUIREMENTS = os.path.join(HERE, "requirements.txt")


def env_dir(arg: str = "") -> str:
    if arg:
        return os.path.abspath(arg)
    if os.environ.get("ENGINUITY_PYTHON_ENV"):
        return os.path.abspath(os.environ["ENGINUITY_PYTHON_ENV"])
    data = os.environ.get("ROBOCRAFT_DATA_DIR") or os.path.join(ROOT, "data")
    return os.path.join(os.path.abspath(data), "python-env")


def env_python(env: str) -> str:
    if os.name == "nt":
        return os.path.join(env, "Scripts", "python.exe")
    return os.path.join(env, "bin", "python3")


def allowlist() -> dict:
    with open(ALLOWLIST, encoding="utf-8") as fh:
        return json.load(fh)


def packages_for(modules: list) -> list:
    pass
    allow = allowlist()["modules"]
    out = []
    for m in modules:
        for p in allow[m]["packages"]:
            if p not in out:
                out.append(p)
    return out


def requirement_blocks() -> dict:
    pass
    blocks: dict = {}
    current = ""
    with open(REQUIREMENTS, encoding="utf-8") as fh:
        for raw in fh:
            line = raw.rstrip("\n")
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            current = current + "\n" + line if current else line
            if line.endswith("\\"):
                continue
            name = current.split("==", 1)[0].strip().lower()
            blocks.setdefault(name, []).append(current)
            current = ""
    return blocks


def requirements_text(packages: list) -> str:
    blocks = requirement_blocks()
    missing = [p for p in packages if p.lower() not in blocks]
    if missing:
        raise SystemExit("requirements.txt has no pinned version of: %s" % ", ".join(missing))
    return "\n".join(b for p in packages for b in blocks[p.lower()]) + "\n"


def ensure_env(env: str) -> str:
    pass
    py = env_python(env)
    if os.path.exists(py):
        ok = subprocess.run([py, "-I", "-c", "import pip"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
        if ok:
            return py
        print("Enginuity Python environment at %s does not work; creating it again" % env, flush=True)
    print("Creating Enginuity's Python environment in %s (Python %s)" % (env, sys.version.split()[0]), flush=True)
    venv.EnvBuilder(with_pip=True, clear=os.path.exists(env), symlinks=os.name != "nt").create(env)
    return py


def main(argv: list) -> int:
    args = list(argv)
    env_arg = ""
    if "--env" in args:
        i = args.index("--env")
        env_arg = args[i + 1]
        del args[i : i + 2]
    dry = "--dry-run" in args
    if dry:
        args.remove("--dry-run")
    allow = allowlist()["modules"]
    modules = sorted(allow) if "--all" in args else [a for a in args if a != "--all"]
    if not modules:
        print(__doc__)
        return 2
    unknown = [m for m in modules if m not in allow]
    if unknown:
        print("Not on Enginuity's list of packages it installs: %s (it installs: %s)" % (", ".join(unknown), ", ".join(sorted(allow))), file=sys.stderr)
        return 2
    packages = packages_for(modules)
    text = requirements_text(packages)
    env = env_dir(env_arg)
    pip_args = ["-I", "-m", "pip", "install", "--require-hashes", "--only-binary", ":all:", "--no-input", "--disable-pip-version-check", "--progress-bar", "off"]
    if dry:
        print("environment: %s" % env)
        print("packages: %s" % " ".join(packages))
        print("pip: %s %s -r <requirements>" % (env_python(env), " ".join(pip_args)))
        print(text, end="")
        return 0
    py = ensure_env(env)
    req = os.path.join(env, "enginuity-requirements.txt")
    with open(req, "w", encoding="utf-8") as fh:
        fh.write(text)
    print("Installing %s into %s" % (", ".join(packages), env), flush=True)
    sys.stdout.flush()
    sys.stderr.flush()
    os.execv(py, [py] + pip_args + ["-r", req])
    return 0  


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
