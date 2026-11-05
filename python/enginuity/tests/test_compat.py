# Verifies import aliases, prelude exports and script-launcher behavior.



import os
import subprocess
import sys
import tempfile
import textwrap
import unittest

SRC = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src"))
LAUNCHER = os.path.join(SRC, "enginuity", "launch.py")


def run(code: str, *args: str, extra_path: str = "") -> subprocess.CompletedProcess:
    with tempfile.TemporaryDirectory() as d:
        script = os.path.join(d, "script.py")
        with open(script, "w") as fh:
            fh.write(textwrap.dedent(code))
        prelude = "import sys; sys.path[:0] = [%r]" % (extra_path,) if extra_path else ""
        cmd = [sys.executable, "-I", LAUNCHER, script, *args]
        if prelude:
            cmd = [sys.executable, "-I", "-c", prelude + "; sys.argv = [%r] + sys.argv[1:]; import runpy; runpy.run_path(%r, run_name='__main__')" % (LAUNCHER, LAUNCHER), script, *args]
        return subprocess.run(cmd, capture_output=True, text=True, timeout=60)


class CompatTest(unittest.TestCase):
    def test_every_import_style(self):
        r = run(
            """
            from robolink import *
            from robomath import *
            import robomath as rm2, robolink as rl2
            import robodialogs, robofileio, robolinkutils
            from enginuity.prelude import *
            import enginuity.robolink, enginuity.robomath, enginuity.dialogs, enginuity.fileio, enginuity.utils
            assert robolink is enginuity.robolink and rl2 is robolink
            assert robomath is enginuity.robomath and rm2 is robomath
            assert robodialogs is enginuity.dialogs and robofileio is enginuity.fileio and robolinkutils is enginuity.utils
            assert Robolink is enginuity.robolink.Enginuity
            assert ITEM_TYPE_ROBOT == 2 and RUNMODE_SIMULATE == 1
            assert callable(mbox) and callable(getSaveFile) and callable(LoadList)
            assert time.time() > 0 and isinstance(transl(1, 2, 3), Mat)
            assert robolink.__spec__.name == "enginuity.robolink"
            print("ok")
            """
        )
        self.assertEqual(r.stderr, "")
        self.assertEqual(r.stdout.strip(), "ok")

    def test_prelude_holds_what_one_star_import_of_the_old_package_gave(self):
        r = run(
            """
            import os as _os, sys as _sys, time as _time
            import enginuity.prelude as p
            from enginuity import dialogs, fileio, robolink, robomath, utils
            assert p.robolink is robolink and p.robomath is robomath
            assert p.robodialogs is dialogs and p.robofileio is fileio and p.robolinkutils is utils
            assert p.os is _os and p.sys is _sys and p.time is _time
            for mod in (robomath, dialogs, fileio):
                for name in mod.__all__:
                    assert name in p.__all__ and getattr(p, name) is getattr(mod, name), name
            ns = {}
            exec("from enginuity.prelude import *", ns)
            assert ns["robodialogs"] is dialogs and ns["transl"] is robomath.transl and ns["os"] is _os
            print("ok")
            """
        )
        self.assertEqual(r.stderr, "")
        self.assertEqual(r.stdout.strip(), "ok")

    def test_a_package_named_like_an_alias_on_the_path_is_never_used(self):
        with tempfile.TemporaryDirectory() as fake:
            for name in ("robolink.py", "robomath.py", "robodialogs.py"):
                with open(os.path.join(fake, name), "w") as fh:
                    fh.write("raise RuntimeError('third-party module imported')\n")
            r = run(
                """
                import robolink, robomath
                from robodialogs import mbox
                print(robolink.__name__, robomath.__name__, mbox.__module__)
                """,
                extra_path=fake,
            )
            self.assertEqual(r.stderr, "")
            self.assertEqual(r.stdout.strip(), "enginuity.robolink enginuity.robomath enginuity.dialogs")

    def test_no_alias_for_the_original_package_name(self):
        
        
        old = "robo" + "dk"
        r = run(
            """
            import sys
            try:
                import %s
            except ModuleNotFoundError as e:
                print("missing", e.name)
            print(any(n == %r or n.startswith(%r) for n in sys.modules))
            """
            % (old, old, old + ".")
        )
        self.assertEqual(r.stdout.split(), ["missing", old, "False"])

    def test_launcher_argv_exit_codes_and_tracebacks(self):
        r = run("import sys\nprint(sys.argv[1:])\nsys.exit(3)\n", "0", " b ")
        self.assertEqual(r.stdout.strip(), "['0', ' b ']")
        self.assertEqual(r.returncode, 3)
        r = run("def f():\n    raise ValueError('boom')\nf()\n")
        self.assertEqual(r.returncode, 1)
        self.assertIn("ValueError: boom", r.stderr)
        self.assertIn('script.py", line 3', r.stderr)
        self.assertNotIn("launch.py", r.stderr)

    def test_install_and_uninstall(self):
        sys.path.insert(0, SRC)
        try:
            import enginuity.compat as compat

            self.assertTrue(compat.installed())
            import robomath  # noqa: F401 - resolved through the alias

            compat.uninstall()
            self.assertFalse(compat.installed())
            self.assertNotIn("robomath", sys.modules)
            compat.install()
            self.assertIs(sys.meta_path[0], compat._FINDER)
        finally:
            compat.uninstall()
            sys.path.remove(SRC)


if __name__ == "__main__":
    unittest.main()
