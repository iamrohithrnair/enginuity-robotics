# Checks math and filename helpers required by post-processor scripts.



import math
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src"))

from enginuity import robomath as rm  # noqa: E402
from enginuity.fileio import FilterName  # noqa: E402


class PostRuntimeTest(unittest.TestCase):
    def test_math_comes_with_robomath_star(self):
        
        ns = {}
        exec("from enginuity.robomath import *", ns)
        self.assertIs(ns["math"], math)

    def test_zyz_with_aligned_z_axes_puts_the_rotation_last(self):
        
        pose = rm.transl(1234.57, -98.7654, 50.5) * rm.rotz(30 * math.pi / 180)
        for f in (rm.Pose_2_Comau, rm.Pose_2_Adept, rm.Pose_2_Kawasaki):
            v = f(pose)
            self.assertEqual(v[3], 0.0)
            self.assertEqual(v[4], 0.0)
            self.assertAlmostEqual(v[5], 30.0, places=9)
        
        back = rm.Comau_2_Pose(rm.Pose_2_Comau(pose))
        for i in range(4):
            for j in range(4):
                self.assertAlmostEqual(back[i, j], pose[i, j], places=9)

    def test_quaternion_near_a_half_turn(self):
        
        
        q = rm.pose_2_quaternion(rm.PosePP(0.4999, -0.5001, 0.25, 0.005, -0.005, 180))
        self.assertEqual(["%.8f" % v for v in q], ["0.00000000", "1.00000000", "0.00004363", "0.00004363"])

    def test_filtername_accepts_invalid_chars(self):
        
        self.assertEqual(FilterName("Frame Pg", invalid_chars=" .-"), "FramePg")
        self.assertEqual(FilterName("Frame Pg"), "FramePg")


if __name__ == "__main__":
    unittest.main()
