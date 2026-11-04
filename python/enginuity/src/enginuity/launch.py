














from __future__ import annotations

import os
import sys


def _prepare_path() -> None:
    src = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if src not in sys.path:
        sys.path.insert(0, src)


def main(argv: list) -> int:
    pass
    import site
    import traceback
    import types

    if not argv:
        print("usage: python3 -I -u launch.py script.py [arguments...]", file=sys.stderr)
        return 2
    import enginuity.compat  # noqa: F401 - installs the import aliases

    
    
    try:
        user_site = site.getusersitepackages()
        if isinstance(user_site, str) and os.path.isdir(user_site) and user_site not in sys.path:
            site.addsitedir(user_site)
    except Exception:  # noqa: BLE001 - a broken user site must not stop the script
        pass

    script = os.path.abspath(argv[0])
    with open(script, "rb") as fh:
        source = fh.read()
    code = compile(source, script, "exec", dont_inherit=True)
    sys.argv = [script] + list(argv[1:])
    folder = os.path.dirname(script)
    if folder not in sys.path:
        sys.path.insert(1, folder)
    main_module = types.ModuleType("__main__")
    main_module.__file__ = script
    main_module.__builtins__ = __builtins__  # type: ignore[attr-defined]
    sys.modules["__main__"] = main_module
    try:
        exec(code, main_module.__dict__)
    except SystemExit as e:
        if e.code is None:
            return 0
        if isinstance(e.code, int):
            return e.code
        print(e.code, file=sys.stderr)
        return 1
    except BaseException:  # noqa: BLE001 - report the script's own traceback
        etype, value, tb = sys.exc_info()
        
        traceback.print_exception(etype, value, tb.tb_next if tb is not None else None)
        return 1
    return 0


if __name__ == "__main__":
    _prepare_path()
    sys.exit(main(sys.argv[1:]))
