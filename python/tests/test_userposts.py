# Verifies custom-post templates, validation, subclass loading and CLI generation.





import json
import os
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "python"))

from robocraft_post import userposts  # noqa: E402

CLI = os.path.join(ROOT, "python", "robocraft_post", "cli.py")
STREAM = """import sys
from Kawasaki import *
r = RobotPost(r\"\"\"Kawasaki\"\"\",r\"\"\"RS006L\"\"\",6, axes_type=['R','R','R','R','R','R'], native_name=r\"\"\"RS006L\"\"\")
r.ProgStart(r\"\"\"Prog1\"\"\")
r.MoveJ(None,[0,0,90,0,0,0],None)
r.ProgFinish(r\"\"\"Prog1\"\"\")
r.ProgSave(r\"\"\"/tmp/\"\"\",r\"\"\"Prog1\"\"\",False,False)
"""


def cli(args, stdin=""):
    res = subprocess.run([sys.executable, "-I", CLI] + args, input=stdin, capture_output=True, text=True)
    return json.loads(res.stdout)


class UserPostTest(unittest.TestCase):
    def test_template_lists_the_base_variables(self):
        src = userposts.template("MyKawasaki", "Kawasaki")
        self.assertIn("from Kawasaki import RobotPost as BasePost", src)
        self.assertIn("class RobotPost(BasePost):", src)
        self.assertIn("    PROG_EXT = 'pg'", src)
        self.assertEqual(userposts.check(src), {"ok": True, "error": None, "base": "Kawasaki"})

    def test_check_never_runs_the_file(self):
        with tempfile.TemporaryDirectory() as d:
            marker = os.path.join(d, "ran")
            src = "open(%r, 'w').write('x')\nclass RobotPost: pass\n" % marker
            self.assertTrue(cli(["--check"], src)["ok"])
            self.assertFalse(os.path.exists(marker))

    def test_check_reports_errors(self):
        self.assertIn("SyntaxError", cli(["--check"], "class RobotPost(:\n")["error"])
        self.assertEqual(cli(["--check"], "x = 1\n")["error"], "The post processor must define a class named RobotPost")
        self.assertEqual(cli(["--check"], "from Nope import RobotPost as B\nclass RobotPost(B): pass\n")["error"], "Unknown base post processor Nope")

    def test_generation_with_a_customized_post(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "MyKawasaki.py")
            with open(path, "w") as fh:
                fh.write(userposts.template("MyKawasaki", "Kawasaki").replace("PROG_EXT = 'pg'", "PROG_EXT = 'as'"))
            reply = cli([], json.dumps({"intermediate": STREAM, "post": "MyKawasaki", "user_post": {"name": "MyKawasaki", "path": path}}))
            self.assertTrue(reply["ok"], reply)
            self.assertEqual([f["name"] for f in reply["files"]], ["Prog1.as"])
            self.assertIn("JMOVE #[0.00000, 0.00000, 90.00000, 0.00000, 0.00000, 0.00000]", reply["files"][0]["content"])

    def test_a_user_post_must_derive_from_a_robocraft_post(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "Bad.py")
            with open(path, "w") as fh:
                fh.write("class RobotPost(object):\n    pass\n")
            reply = cli([], json.dumps({"intermediate": STREAM, "post": "Bad", "user_post": {"name": "Bad", "path": path}}))
            self.assertFalse(reply["ok"])
            self.assertEqual(reply["error"], "TypeError: Bad: RobotPost must derive from one of Enginuity's post processors")

    def test_source_of_a_builtin_post(self):
        reply = cli(["--source", "Kawasaki"])
        self.assertEqual(reply["file"], "kawasaki.py")
        self.assertIn("class Kawasaki(RobotPost):", reply["source"])
        self.assertEqual(reply["variables"]["PROG_EXT"], "pg")
        self.assertFalse(cli(["--source", "Nope"])["ok"])


if __name__ == "__main__":
    unittest.main()
