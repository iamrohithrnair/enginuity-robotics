






import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from robocraft_post import intermediate, posts  # noqa: E402,F401

HEAD = (
    "import sys\nimport os\nimport robodk\n\nfrom Motoman import *\n\n"
    "print('Total instructions: 1')\n"
)


def stream(ctor_extra, axes="'R','R','L','R'", pre=""):
    return (
        HEAD
        + pre
        + "r = RobotPost(r\"\"\"Motoman\"\"\",r\"\"\"Yaskawa Motoman SCARA\"\"\",4, axes_type=[%s], native_name=r\"\"\"X\"\"\", ip_com=r\"\"\"1.2.3.4\"\"\", api_port=20500, prog_ptr=1, robot_ptr=2%s)\n\n"
        % (axes, ctor_extra)
        + "r.ProgStart(r\"\"\"TgtProg\"\"\")\n"
        + "r.MoveJ(None,[10,-20,30,-40],None)\n"
        + "r.ProgFinish(r\"\"\"TgtProg\"\"\")\n"
        + "r.ProgSave(r\"\"\"/tmp/\"\"\",r\"\"\"TgtProg\"\"\",False,False)\n"
    )


class PostHeaderTests(unittest.TestCase):
    def test_optional_arguments_parse(self):
        pre = "import base64\npost_cell = base64.b64decode(b'QQ==')\n"
        s = intermediate.parse(
            stream(
                ", pulses_x_deg=[1000.000000,2000.000000,300.500000,4000.000000], lines_x_prog=5,"
                " pose_turntable=p(100.000000,0.000000,0.000000,0.000000,0.000000,90.000000),"
                " pose_rail=p(0.000000,0.000000,500.000000,0.000000,0.000000,0.000000), post_cell=post_cell",
                pre=pre,
            )
        )
        self.assertEqual(s.kwargs["pulses_x_deg"], [1000.0, 2000.0, 300.5, 4000.0])
        self.assertEqual(s.kwargs["lines_x_prog"], 5)
        self.assertEqual(s.kwargs["post_cell"], b"A")
        self.assertEqual(s.kwargs["axes_type"], ["R", "R", "L", "R"])
        self.assertIn("pose_rail", s.kwargs)

    def test_post_parameter_must_be_bytes(self):
        with self.assertRaises(intermediate.IntermediateError):
            intermediate.parse(stream(", post_x=post_x", pre="post_x = open('f')\n"))

    def test_motoman_station_axis_and_pulses(self):
        
        res = intermediate.run(stream(", pulses_x_deg=[1000.000000,2000.000000,300.500000,4000.000000]"))
        self.assertTrue(res.ok, res.error)
        jbi = dict(res.files)["TGTPROG.JBI"]
        self.assertIn("///NPOS 1,0,1,0,0,0", jbi)
        self.assertIn("C00000=10000,-40000,-160000", jbi)
        self.assertIn("EC00000=9015", jbi)
        self.assertIn("MOVJ C00000 VJ=50.00  +MOVJ EC00000 VJ=100.00", jbi)


if __name__ == "__main__":
    unittest.main()
