






import json
import math
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "src"))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))

from enginuity import robomath as rm  # noqa: E402
from enginuity.robomath import Mat, MatrixError  # noqa: E402

GOLDEN = os.path.join(ROOT, "research", "evidence", "scripts", "robomath-golden.json")


def rows(m):
    return [[float(m[i, j]) for j in range(m.size(1))] for i in range(m.size(0))]


class Close:
    def assertClose(self, a, b, tol=1e-9):  # noqa: N802 - unittest style
        fa = _flat(a)
        fb = _flat(b)
        self.assertEqual(len(fa), len(fb), "%r vs %r" % (a, b))
        for x, y in zip(fa, fb):
            self.assertLessEqual(abs(x - y), tol, "%r vs %r" % (a, b))


def _flat(v):
    if isinstance(v, Mat):
        return [x for r in v.rows for x in r]
    if isinstance(v, (list, tuple)):
        out = []
        for x in v:
            out.extend(_flat(x) if isinstance(x, (list, tuple, Mat)) else [float(x)])
        return out
    return [float(v)]


class MatTest(unittest.TestCase, Close):
    def test_construction(self):
        self.assertEqual(Mat().size(), (0, 0))
        self.assertEqual(Mat(2, 3).size(), (2, 3))
        self.assertEqual(Mat(3).size(), (3, 3))
        self.assertEqual(Mat(6, 0).size(), (6, 0))
        self.assertEqual(Mat([1, 2, 3]).size(), (3, 1))
        self.assertEqual(Mat([[1, 2], [3, 4]]).rows, [[1.0, 2.0], [3.0, 4.0]])
        with self.assertRaises(MatrixError):
            Mat([[1, 2], [3]])

    def test_indexing_and_slices(self):
        p = rm.transl(10, 20, 30)
        self.assertEqual(p[0, 3], 10.0)
        self.assertEqual(p[0:3, 3].tolist(), [10.0, 20.0, 30.0])
        self.assertEqual(p[:, 3].size(), (4, 1))
        p[0:3, 3] = [1, 2, 3]
        self.assertEqual(p.Pos(), [1.0, 2.0, 3.0])
        j = Mat([1, 2, 3])
        self.assertEqual(j[1], 2.0)
        self.assertEqual(list(j), [1.0, 2.0, 3.0])
        self.assertEqual(len(j), 1)  
        self.assertEqual(len(Mat(8, 4)), 4)

    def test_arithmetic(self):
        j = Mat([10, 20])
        self.assertEqual((j + 3).tolist(), [13.0, 23.0])
        self.assertEqual((3 + j).tolist(), [13.0, 23.0])
        self.assertEqual((j - 1).tolist(), [9.0, 19.0])
        self.assertEqual((j * 2).tolist(), [20.0, 40.0])
        self.assertEqual((2 * j).tolist(), [20.0, 40.0])
        self.assertEqual((-j).tolist(), [-10.0, -20.0])
        self.assertEqual((j / 2).tolist(), [5.0, 10.0])
        self.assertEqual((j + [1, 1]).tolist(), [11.0, 21.0])
        with self.assertRaises(MatrixError):
            Mat([[1, 2]]) * Mat([[1, 2]])

    def test_point_and_vector_products(self):
        p = rm.transl(1, 2, 3) * rm.rotz(math.pi / 2)
        self.assertClose(p * [1, 0, 0], [1, 3, 3])
        r = p.Rot33()
        self.assertClose(r * [0, 0, -1], [0, 0, -1])

    def test_list_list2_tolist(self):
        a = Mat([[1, 2], [3, 4]])
        self.assertEqual(a.list(), [1.0, 3.0])
        self.assertEqual(a.list2(), [[1.0, 3.0], [2.0, 4.0]])
        self.assertEqual(a.tolist(), [[1.0, 2.0], [3.0, 4.0]])
        self.assertEqual(Mat([5, 6]).tolist(), [5.0, 6.0])

    def test_cat(self):
        jl = Mat(6, 0)
        jl = rm.catH(jl, Mat([1, 2, 3, 4, 5, 6]))
        jl = rm.catH(jl, [7, 8, 9, 10, 11, 12])
        self.assertEqual(jl.size(), (6, 2))
        self.assertEqual(rm.catV(Mat([[1, 2]]), Mat([[3, 4]])).rows, [[1.0, 2.0], [3.0, 4.0]])

    def test_inverse(self):
        p = rm.transl(100, -50, 300) * rm.rotz(0.3) * rm.roty(-0.7) * rm.rotx(1.1)
        self.assertClose(p * p.invH(), rm.eye(4))
        self.assertClose(p.inv(), p.invH())
        g = Mat([[2, 1], [1, 3]])
        self.assertClose(g * g.inv(), rm.eye(2))
        with self.assertRaises(MatrixError):
            Mat([[1, 2], [2, 4]]).inv()
        with self.assertRaises(MatrixError):
            Mat([[1, 2], [3, 4]]).invH()

    def test_axes_and_setters(self):
        p = rm.eye(4).setVX([0, 1, 0]).setVY([-1, 0, 0]).setVZ([0, 0, 1]).setPos([1, 2, 3])
        self.assertClose(p, rm.transl(1, 2, 3) * rm.rotz(math.pi / 2))
        self.assertTrue(p.isHomogeneous())
        self.assertFalse(Mat(4, 4).isHomogeneous())

    def test_value_equality(self):
        self.assertEqual(rm.transl(1, 2, 3), rm.transl(1, 2, 3))
        self.assertNotEqual(rm.transl(1, 2, 3), rm.transl(1, 2, 4))
        self.assertEqual(Mat([[1, 2]]), [[1, 2]])
        with self.assertRaises(TypeError):
            hash(Mat([1]))

    def test_text_and_save(self):
        self.assertIn("Pose(", str(rm.transl(1, 2, 3)))
        self.assertEqual(eval(repr(Mat([[1, 2]])), {"Mat": Mat}).rows, [[1.0, 2.0]])
        with tempfile.TemporaryDirectory() as d:
            f = os.path.join(d, "m.csv")
            Mat([[1, 2], [3, 4]]).save(f)
            from enginuity.fileio import LoadMat

            self.assertEqual(LoadMat(f).rows, [[1.0, 2.0], [3.0, 4.0]])


class PoseIdentityTest(unittest.TestCase, Close):
    POSES = [
        rm.transl(100, -50, 300) * rm.rotz(0.3) * rm.roty(-0.7) * rm.rotx(1.1),
        rm.transl(-20, 40, 10) * rm.rotx(math.pi) * rm.rotz(0.25),
        rm.transl(5, 6, 7) * rm.roty(0.2) * rm.rotz(-2.4) * rm.rotx(0.5),
    ]

    def test_round_trips(self):
        for p in self.POSES:
            self.assertClose(rm.xyzrpw_2_pose(rm.pose_2_xyzrpw(p)), p)
            self.assertClose(rm.TxyzRxyz_2_Pose(rm.Pose_2_TxyzRxyz(p)), p)
            self.assertClose(rm.KUKA_2_Pose(rm.Pose_2_KUKA(p)), p)
            self.assertClose(rm.Staubli_2_Pose(rm.Pose_2_Staubli(p)), p)
            self.assertClose(rm.Fanuc_2_Pose(rm.Pose_2_Fanuc(p)), p)
            self.assertClose(rm.Motoman_2_Pose(rm.Pose_2_Motoman(p)), p)
            self.assertClose(rm.Nachi_2_Pose(rm.Pose_2_Nachi(p)), p)
            self.assertClose(rm.UR_2_Pose(rm.Pose_2_UR(p)), p)
            self.assertClose(rm.ABB_2_Pose(rm.Pose_2_ABB(p)), p)
            self.assertClose(rm.Adept_2_Pose(rm.Pose_2_Adept(p)), p)
            self.assertClose(rm.Comau_2_Pose(rm.Pose_2_Comau(p)), p)
            self.assertClose(rm.Catia_2_Pose(rm.Pose_2_Catia(p)), p)
            self.assertClose(rm.Epson_2_Pose(rm.Pose_2_Epson(p)), p)

    def test_conventions(self):
        
        p = rm.transl(1, 2, 3) * rm.rotz(math.radians(30)) * rm.roty(math.radians(20)) * rm.rotx(math.radians(10))
        self.assertClose(rm.Pose_2_KUKA(p), [1, 2, 3, 30, 20, 10])
        self.assertClose(rm.pose_2_xyzrpw(p), [1, 2, 3, 10, 20, 30])
        self.assertClose(rm.Pose(1, 2, 3, 10, 20, 30), rm.transl(1, 2, 3) * rm.rotx(math.radians(10)) * rm.roty(math.radians(20)) * rm.rotz(math.radians(30)))
        self.assertClose(rm.PosePP(1, 2, 3, 30, 20, 10), p)

    def test_offset_reltool(self):
        p = self.POSES[0]
        self.assertClose(rm.RelTool(p, 10, 0, 0), p * rm.transl(10, 0, 0))
        self.assertClose(rm.Offset(p, 10, 0, 0), rm.transl(10, 0, 0) * p)
        self.assertClose(p.RelTool(0, 0, 5, 0, 0, 90), p * rm.transl(0, 0, 5) * rm.rotz(math.pi / 2))

    def test_vectors(self):
        self.assertEqual(rm.cross([1, 0, 0], [0, 1, 0]), [0.0, 0.0, 1.0])
        self.assertEqual(rm.dot([1, 2, 3], [4, 5, 6]), 32.0)
        self.assertAlmostEqual(rm.angle3([1, 0, 0], [0, 1, 0]), math.pi / 2)
        self.assertClose(rm.proj_pt_2_plane([1, 2, 3], [0, 0, 0], [0, 0, 2]), [1, 2, 0])
        self.assertClose(rm.proj_pt_2_line([1, 2, 3], [0, 0, 0], [0, 0, 1]), [0, 0, 3])
        self.assertClose(rm.intersect_line_2_plane([0, 0, 10], [0, 0, -1], [0, 0, 2], [0, 0, 1]), [0, 0, 2])
        c, n = rm.fitPlane([[0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]])
        self.assertClose(c, [0.5, 0.5, 1])
        self.assertAlmostEqual(abs(n[2]), 1.0)
        with self.assertRaises(MatrixError):
            rm.normalize3([0, 0, 0])

    def test_pose_angles_and_split(self):
        a = rm.transl(0, 0, 0)
        b = rm.transl(10, 0, 0) * rm.rotz(math.radians(40))
        self.assertAlmostEqual(rm.pose_angle_between(a, b), math.radians(40))
        steps = rm.Pose_Split(a, b, 2.5)
        self.assertEqual(len(steps), 4)
        self.assertClose(steps[-1], b)
        self.assertAlmostEqual(rm.pose_angle_between(a, steps[1]), math.radians(20))

    def test_dh(self):
        self.assertClose(rm.dh(0.1, 20, 30, 0.2), rm.rotz(0.1) * rm.transl(0, 0, 30) * rm.transl(20, 0, 0) * rm.rotx(0.2))
        self.assertClose(rm.dhm(0.2, 20, 30, 0.1), rm.rotx(0.2) * rm.transl(20, 0, 0) * rm.rotz(0.1) * rm.transl(0, 0, 30))

    def test_joint_angles_presets(self):
        q = [10, 20, 30, 40, 50, 60]
        self.assertEqual(rm.joints_2_angles(q, 1), q)
        fanuc = rm.joints_2_angles(q, 2)
        self.assertEqual(fanuc, [10, 20, -30 - 20, -40, -50, -60])
        for t in (0, 2, 3, 4, 5, 6, 8, 9, 11, 7):
            self.assertClose(rm.angles_2_joints(rm.joints_2_angles(q, t), t), q)

    def test_names_and_timing(self):
        self.assertEqual(rm.name_2_id("Target 12"), 12)
        self.assertEqual(rm.name_2_id("Frame3"), 3)
        self.assertEqual(rm.name_2_id("Home"), -1)
        rm.tic()
        rm.pause(0.01)
        self.assertGreaterEqual(rm.toc(), 0.009)


@unittest.skipUnless(os.path.exists(GOLDEN), "golden values not available")
class GoldenTest(unittest.TestCase, Close):
    pass

    @classmethod
    def setUpClass(cls):
        with open(GOLDEN) as fh:
            cls.g = json.load(fh)
        cls.inputs = {k: Mat(v) for k, v in cls.g["inputs"].items()}

    def expect(self, key, value, tol=1e-9):
        ref = self.g[key]["ok"]
        if isinstance(ref, dict):
            ref = ref["mat"]
        self.assertClose(value if not isinstance(value, Mat) else rows(value), ref, tol)

    def test_basic(self):
        A, B = self.inputs["A"], self.inputs["B"]
        self.expect("transl", rm.transl(1, 2, 3))
        self.expect("transl_list", rm.transl([4, 5, 6]))
        self.expect("rotx", rm.rotx(0.5))
        self.expect("roty", rm.roty(0.5))
        self.expect("rotz", rm.rotz(0.5))
        self.expect("eye4", rm.eye(4))
        self.expect("eye3", rm.eye(3))
        self.expect("mul_AB", A * B)
        self.expect("invH_A", rm.invH(A))
        self.expect("inv_A", A.inv())
        self.expect("tr_A", A.tr())
        self.expect("A_Pos", A.Pos())
        self.expect("A_VX", A.VX())
        self.expect("A_VY", A.VY())
        self.expect("A_VZ", A.VZ())
        self.expect("A_list", A.list())
        self.expect("A_list2", A.list2())
        self.expect("A_mul_point", A * [1, 2, 3])
        self.expect("A_Offset", A.Offset(10, 20, 30, 5, 10, 15))
        self.expect("A_RelTool", A.RelTool(10, 20, 30, 5, 10, 15))
        self.expect("Offset_fn", rm.Offset(A, 10, 20, 30, 5, 10, 15))
        self.expect("RelTool_fn", rm.RelTool(A, 10, 20, 30, 5, 10, 15))
        self.expect("A_setPos", Mat(A).setPos([7, 8, 9]))
        self.expect("Mat_2x2_list", Mat([[1, 2], [3, 4]]).list())
        self.expect("Mat_col_list", Mat([[1], [2], [3]]).list())
        self.expect("Mat_vec_from_list", Mat([1, 2, 3]))
        self.expect("Mat_zeros", Mat(2, 3))
        self.expect("pi", [rm.pi])

    def test_conversions(self):
        for name, M in self.inputs.items():
            self.expect("pose_2_xyzrpw_" + name, rm.pose_2_xyzrpw(M), 1e-7)
            self.expect("Pose_2_TxyzRxyz_" + name, rm.Pose_2_TxyzRxyz(M), 1e-9)
            self.expect("Pose_2_KUKA_" + name, rm.Pose_2_KUKA(M), 1e-7)
            self.expect("Pose_2_ABB_" + name, rm.Pose_2_ABB(M), 1e-9)
            self.expect("Pose_2_UR_" + name, rm.Pose_2_UR(M), 1e-7)
            self.expect("Pose_2_Staubli_" + name, rm.Pose_2_Staubli(M), 1e-7)
            self.expect("Pose_2_Fanuc_" + name, rm.Pose_2_Fanuc(M), 1e-7)
            self.expect("Pose_2_Motoman_" + name, rm.Pose_2_Motoman(M), 1e-7)
            self.expect("pose_2_quaternion_" + name, rm.pose_2_quaternion(M), 1e-9)
        v6 = [100, -50, 300, 20, -30, 45]
        self.expect("xyzrpw_2_pose", rm.xyzrpw_2_pose(v6))
        self.expect("TxyzRxyz_2_Pose", rm.TxyzRxyz_2_Pose([100, -50, 300, 0.2, -0.3, 0.45]))
        self.expect("KUKA_2_Pose", rm.KUKA_2_Pose(v6))
        self.expect("UR_2_Pose", rm.UR_2_Pose([100, -50, 300, 0.2, -0.3, 0.45]))
        self.expect("quaternion_2_pose", rm.quaternion_2_pose([0.7071067811865476, 0, 0.7071067811865476, 0]), 1e-12)

    def test_vectors(self):
        self.expect("cross", rm.cross([1, 2, 3], [-4, 5, 0.5]))
        self.expect("dot", [rm.dot([1, 2, 3], [-4, 5, 0.5])])
        self.expect("norm", [rm.norm([3, 4, 12])])
        self.expect("normalize3", rm.normalize3([3, 4, 12]))
        self.expect("add3", rm.add3([1, 2, 3], [4, 5, 6]))
        self.expect("subs3", rm.subs3([1, 2, 3], [4, 5, 6]))
        self.expect("mult3", rm.mult3([1, 2, 3], 2.5))
        self.expect("distance", [rm.distance([1, 2, 3], [4, 6, 15])])
        self.expect("angle3", [rm.angle3([1, 0, 0], [1, 1, 0])])
        self.expect("point_Zaxis_2_pose", rm.point_Zaxis_2_pose([10, 20, 30], [0, 0, -1]))
        self.expect("point_Zaxis_2_pose_hint", rm.point_Zaxis_2_pose([10, 20, 30], [1, 0, 0], [0, 0, 1], [0, 1, 1]))


if __name__ == "__main__":
    unittest.main()
