# Provides matrix algebra, rigid transforms and robot pose conversions.




















from __future__ import annotations

import math
import time
from math import acos, asin, atan, atan2, ceil, cos, degrees, exp, fabs, floor, log, pi, radians, sin, sqrt, tan
from typing import Any, Iterator, List, Optional, Sequence, Tuple, Union

__all__ = [
    
    
    "time",
    
    
    
    "math",
    
    "pi", "sqrt", "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "exp", "log", "floor", "ceil",
    "fabs", "radians", "degrees",
    
    "Mat", "MatrixError", "eye", "size", "tr", "invH", "catV", "catH", "transl", "rotx", "roty", "rotz",
    "Offset", "RelTool", "Pose", "PosePP", "Pose_Split", "pose_angle", "pose_angle_between",
    
    "pose_2_xyzrpw", "xyzrpw_2_pose", "Pose_2_TxyzRxyz", "TxyzRxyz_2_Pose", "Pose_2_Staubli", "Staubli_2_Pose",
    "Pose_2_Fanuc", "Fanuc_2_Pose", "Pose_2_Motoman", "Motoman_2_Pose", "Pose_2_KUKA", "KUKA_2_Pose",
    "Pose_2_Nachi", "Nachi_2_Pose", "Pose_2_ABB", "ABB_2_Pose", "Pose_2_UR", "UR_2_Pose", "Pose_2_Adept",
    "Adept_2_Pose", "Pose_2_Comau", "Comau_2_Pose", "Pose_2_Kawasaki", "Kawasaki_2_Pose", "Pose_2_Catia",
    "Catia_2_Pose", "Pose_2_Epson", "Epson_2_Pose", "pose_2_quaternion", "quaternion_2_pose",
    
    "cross", "dot", "norm", "normalize3", "add3", "subs3", "mult3", "distance", "angle3",
    "point_Zaxis_2_pose", "point_Xaxis_2_pose", "point_Yaxis_2_pose", "proj_pt_2_plane", "proj_pt_2_line",
    "intersect_line_2_plane", "fitPlane", "dh", "dhm", "joints_2_angles", "angles_2_joints",
    
    "tic", "toc", "pause", "name_2_id",
]

Number = Union[int, float]
Vector = Sequence[float]

_D2R = pi / 180.0
_R2D = 180.0 / pi
_GIMBAL = 1e-10


class MatrixError(ValueError):
    pass


def _is_seq(v: Any) -> bool:
    return isinstance(v, (list, tuple)) or (hasattr(v, "__len__") and hasattr(v, "__getitem__") and not isinstance(v, (str, bytes, Mat)))


def _numbers(v: Any) -> List[float]:
    pass
    if isinstance(v, Mat):
        r, c = v.size()
        if c == 1:
            return [row[0] for row in v.rows]
        if r == 1:
            return list(v.rows[0])
        raise MatrixError("Expected a vector, got a %dx%d matrix" % (r, c))
    if hasattr(v, "tolist") and not isinstance(v, (list, tuple)):
        v = v.tolist()
    return [float(x) for x in v]


def _vec3(v: Any) -> List[float]:
    n = _numbers(v)
    if len(n) < 3:
        raise MatrixError("Expected a 3D vector, got %d values" % len(n))
    return n[:3]


class Mat:
    pass

    __slots__ = ("rows",)

    def __init__(self, rows: Any = None, ncols: Optional[int] = None) -> None:
        if rows is None:
            self.rows: List[List[float]] = []
            return
        if isinstance(rows, bool):
            raise TypeError("Mat: expected rows, a vector or a size, got a bool")
        if isinstance(rows, int):
            n = rows
            m = n if ncols is None else int(ncols)
            if n < 0 or m < 0:
                raise MatrixError("Mat: negative size %dx%d" % (n, m))
            self.rows = [[0.0] * m for _ in range(n)]
            return
        if isinstance(rows, Mat):
            self.rows = [list(r) for r in rows.rows]
            return
        if hasattr(rows, "tolist") and not isinstance(rows, (list, tuple)):
            rows = rows.tolist()
        data = list(rows)
        if not data:
            self.rows = []
            return
        if all(_is_seq(r) for r in data):
            out = [[float(x) for x in (r.tolist() if hasattr(r, "tolist") and not isinstance(r, (list, tuple)) else r)] for r in data]
            width = len(out[0])
            if any(len(r) != width for r in out):
                raise MatrixError("Mat: all rows must have the same length")
            self.rows = out
            return
        if any(_is_seq(r) for r in data):
            raise MatrixError("Mat: mixed rows and numbers")
        self.rows = [[float(x)] for x in data]

    

    def size(self, dim: Optional[int] = None) -> Any:
        pass
        n = len(self.rows)
        m = len(self.rows[0]) if n else 0
        if dim is None:
            return (n, m)
        if dim == 0:
            return n
        if dim == 1:
            return m
        raise MatrixError("Mat.size: dim must be 0 or 1")

    def RowsCount(self) -> int:
        pass
        return len(self.rows)

    def ColsCount(self) -> int:
        pass
        return len(self.rows[0]) if self.rows else 0

    def Rows(self) -> List[List[float]]:
        pass
        return [list(r) for r in self.rows]

    def Cols(self) -> List[List[float]]:
        pass
        return [[r[j] for r in self.rows] for j in range(self.ColsCount())]

    def copy(self) -> "Mat":
        pass
        return Mat(self)

    def __len__(self) -> int:
        pass
        return self.ColsCount()

    def __iter__(self) -> Iterator[Any]:
        if self.ColsCount() == 1:
            return iter([r[0] for r in self.rows])
        return iter([list(r) for r in self.rows])

    def __eq__(self, other: object) -> bool:
        pass
        if isinstance(other, Mat):
            return self.rows == other.rows
        if isinstance(other, (list, tuple)):
            try:
                return self.rows == Mat(other).rows
            except (TypeError, ValueError):
                return False
        return NotImplemented

    def __ne__(self, other: object) -> bool:
        eq = self.__eq__(other)
        return eq if eq is NotImplemented else not eq

    __hash__ = None  # type: ignore[assignment]  # mutable value: not hashable, like lists

    def __float__(self) -> float:
        if self.size() != (1, 1):
            raise MatrixError("Only a 1x1 Mat converts to a number")
        return self.rows[0][0]

    

    @staticmethod
    def _indices(key: Any, n: int) -> Tuple[List[int], bool]:
        pass
        if isinstance(key, slice):
            return list(range(*key.indices(n))), False
        if isinstance(key, int):
            k = key + n if key < 0 else key
            if not 0 <= k < n:
                raise IndexError("Mat index %d out of range (size %d)" % (key, n))
            return [k], True
        if _is_seq(key):
            out = []
            for k in key:
                k = int(k)
                out.append(k + n if k < 0 else k)
            return out, False
        raise TypeError("Mat indices must be integers, slices or lists of integers")

    def __getitem__(self, key: Any) -> Any:
        if isinstance(key, tuple):
            if len(key) != 2:
                raise IndexError("Mat takes two indices: M[row, col]")
            ri, r_single = self._indices(key[0], self.RowsCount())
            ci, c_single = self._indices(key[1], self.ColsCount())
            if r_single and c_single:
                return self.rows[ri[0]][ci[0]]
            out = Mat()
            out.rows = [[self.rows[i][j] for j in ci] for i in ri]
            return out
        ri, single = self._indices(key, self.RowsCount())
        if single:
            row = self.rows[ri[0]]
            return row[0] if len(row) == 1 else list(row)
        out = Mat()
        out.rows = [list(self.rows[i]) for i in ri]
        return out

    def __setitem__(self, key: Any, value: Any) -> None:
        if isinstance(key, tuple):
            if len(key) != 2:
                raise IndexError("Mat takes two indices: M[row, col]")
            ri, _ = self._indices(key[0], self.RowsCount())
            ci, _ = self._indices(key[1], self.ColsCount())
        else:
            ri, _ = self._indices(key, self.RowsCount())
            ci = list(range(self.ColsCount()))
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            for i in ri:
                for j in ci:
                    self.rows[i][j] = float(value)
            return
        src = value if isinstance(value, Mat) else Mat(value)
        if src.size() == (len(ri), len(ci)):
            for a, i in enumerate(ri):
                for b, j in enumerate(ci):
                    self.rows[i][j] = src.rows[a][b]
            return
        flat = [x for row in src.rows for x in row]
        if len(flat) != len(ri) * len(ci):
            raise MatrixError("Mat assignment: %d values for %dx%d elements" % (len(flat), len(ri), len(ci)))
        k = 0
        for i in ri:
            for j in ci:
                self.rows[i][j] = flat[k]
                k += 1

    

    def _elementwise(self, other: Any, fn: Any) -> "Mat":
        out = Mat()
        if isinstance(other, (int, float)) and not isinstance(other, bool):
            k = float(other)
            out.rows = [[fn(v, k) for v in r] for r in self.rows]
            return out
        b = other if isinstance(other, Mat) else Mat(other)
        if b.size() != self.size():
            raise MatrixError("Element-wise operation on %s and %s matrices" % (self.size(), b.size()))
        out.rows = [[fn(v, w) for v, w in zip(r, s)] for r, s in zip(self.rows, b.rows)]
        return out

    def __add__(self, other: Any) -> "Mat":
        return self._elementwise(other, lambda a, b: a + b)

    def __radd__(self, other: Any) -> "Mat":
        return self._elementwise(other, lambda a, b: b + a)

    def __sub__(self, other: Any) -> "Mat":
        return self._elementwise(other, lambda a, b: a - b)

    def __rsub__(self, other: Any) -> "Mat":
        return self._elementwise(other, lambda a, b: b - a)

    def __neg__(self) -> "Mat":
        return self._elementwise(-1.0, lambda a, b: a * b)

    def __truediv__(self, k: Number) -> "Mat":
        if not isinstance(k, (int, float)):
            raise TypeError("A Mat can only be divided by a number")
        return self._elementwise(k, lambda a, b: a / b)

    def __mul__(self, other: Any) -> Any:
        if isinstance(other, (int, float)) and not isinstance(other, bool):
            return self._elementwise(other, lambda a, b: a * b)
        if isinstance(other, Mat):
            return self._matmul(other)
        if _is_seq(other):
            v = _numbers(other)
            n, m = self.size()
            if m == 4 and len(v) == 3:
                
                return [self.rows[i][0] * v[0] + self.rows[i][1] * v[1] + self.rows[i][2] * v[2] + self.rows[i][3] for i in range(min(n, 3))]
            if len(v) != m:
                raise MatrixError("Mat * vector: %dx%d matrix and %d values" % (n, m, len(v)))
            return [sum(a * b for a, b in zip(r, v)) for r in self.rows]
        return NotImplemented

    def __rmul__(self, other: Any) -> Any:
        if isinstance(other, (int, float)) and not isinstance(other, bool):
            return self._elementwise(other, lambda a, b: a * b)
        return NotImplemented

    def __matmul__(self, other: "Mat") -> "Mat":
        return self._matmul(other if isinstance(other, Mat) else Mat(other))

    def _matmul(self, b: "Mat") -> "Mat":
        n, k = self.size()
        k2, m = b.size()
        if k != k2:
            raise MatrixError("Matrix product of %dx%d and %dx%d matrices" % (n, k, k2, m))
        bc = b.Cols()
        out = Mat()
        out.rows = [[sum(x * y for x, y in zip(r, c)) for c in bc] if m else [] for r in self.rows]
        return out

    

    def tr(self) -> "Mat":
        pass
        out = Mat()
        out.rows = self.Cols()
        if not out.rows and self.rows:
            out.rows = []
        return out

    def isHomogeneous(self) -> bool:
        pass
        if self.size() != (4, 4):
            return False
        r = self.rows[3]
        return abs(r[0]) < 1e-9 and abs(r[1]) < 1e-9 and abs(r[2]) < 1e-9 and abs(r[3] - 1.0) < 1e-9

    def invH(self) -> "Mat":
        pass
        if not self.isHomogeneous():
            raise MatrixError("invH: the matrix is not a 4x4 homogeneous pose")
        R = self.rows
        out = eye(4)
        for i in range(3):
            for j in range(3):
                out.rows[i][j] = R[j][i]
        for i in range(3):
            out.rows[i][3] = -(out.rows[i][0] * R[0][3] + out.rows[i][1] * R[1][3] + out.rows[i][2] * R[2][3])
        return out

    def inv(self) -> "Mat":
        pass
        if self.isHomogeneous():
            return self.invH()
        n, m = self.size()
        if n != m:
            raise MatrixError("inv: the matrix is not square (%dx%d)" % (n, m))
        a = [list(r) + [1.0 if i == j else 0.0 for j in range(n)] for i, r in enumerate(self.rows)]
        for c in range(n):
            p = max(range(c, n), key=lambda r: abs(a[r][c]))
            if abs(a[p][c]) < 1e-14:
                raise MatrixError("inv: the matrix is singular")
            a[c], a[p] = a[p], a[c]
            d = a[c][c]
            a[c] = [v / d for v in a[c]]
            for r in range(n):
                if r != c and a[r][c] != 0.0:
                    f = a[r][c]
                    a[r] = [v - f * w for v, w in zip(a[r], a[c])]
        out = Mat()
        out.rows = [r[n:] for r in a]
        return out

    

    def _need_pose(self, what: str) -> None:
        if self.size() != (4, 4) and not (self.RowsCount() >= 3 and self.ColsCount() >= 4):
            raise MatrixError("%s: the matrix is not a pose" % what)

    def Pos(self) -> List[float]:
        pass
        self._need_pose("Pos")
        return [self.rows[0][3], self.rows[1][3], self.rows[2][3]]

    def setPos(self, xyz: Any) -> "Mat":
        pass
        self._need_pose("setPos")
        v = _vec3(xyz)
        for i in range(3):
            self.rows[i][3] = v[i]
        return self

    def VX(self) -> List[float]:
        pass
        return [self.rows[0][0], self.rows[1][0], self.rows[2][0]]

    def VY(self) -> List[float]:
        pass
        return [self.rows[0][1], self.rows[1][1], self.rows[2][1]]

    def VZ(self) -> List[float]:
        pass
        return [self.rows[0][2], self.rows[1][2], self.rows[2][2]]

    def _set_col(self, j: int, v: Any) -> "Mat":
        vv = _vec3(v)
        for i in range(3):
            self.rows[i][j] = vv[i]
        return self

    def setVX(self, v: Any) -> "Mat":
        pass
        return self._set_col(0, v)

    def setVY(self, v: Any) -> "Mat":
        pass
        return self._set_col(1, v)

    def setVZ(self, v: Any) -> "Mat":
        pass
        return self._set_col(2, v)

    def Rot33(self) -> "Mat":
        pass
        return Mat([self.rows[i][:3] for i in range(3)])

    def setRot33(self, rot: Any) -> "Mat":
        pass
        r = rot if isinstance(rot, Mat) else Mat(rot)
        if r.size() != (3, 3):
            raise MatrixError("setRot33 expects a 3x3 matrix")
        for i in range(3):
            for j in range(3):
                self.rows[i][j] = r.rows[i][j]
        return self

    def translationPose(self) -> "Mat":
        pass
        return transl(self.Pos())

    def rotationPose(self) -> "Mat":
        pass
        out = Mat(self)
        out.setPos([0.0, 0.0, 0.0])
        return out

    def Offset(self, x: Number, y: Number, z: Number, rx: Number = 0, ry: Number = 0, rz: Number = 0) -> "Mat":
        pass
        return Offset(self, x, y, z, rx, ry, rz)

    def RelTool(self, x: Number, y: Number, z: Number, rx: Number = 0, ry: Number = 0, rz: Number = 0) -> "Mat":
        pass
        return RelTool(self, x, y, z, rx, ry, rz)

    

    def list(self) -> List[float]:
        pass
        return [r[0] for r in self.rows] if self.ColsCount() else []

    def list2(self) -> List[List[float]]:
        pass
        return self.Cols()

    def tolist(self) -> List[Any]:
        pass
        if self.ColsCount() == 1:
            return [r[0] for r in self.rows]
        if self.RowsCount() == 1:
            return list(self.rows[0])
        return [list(r) for r in self.rows]

    def catV(self, other: Any) -> "Mat":
        pass
        return catV(self, other)

    def catH(self, other: Any) -> "Mat":
        pass
        return catH(self, other)

    def save(self, filename: Any, separator: str = ",") -> None:
        pass
        text = "".join(separator.join(repr(float(v)) for v in r) + "\n" for r in self.rows)
        if hasattr(filename, "write"):
            filename.write(text)
            if hasattr(filename, "flush"):
                filename.flush()
            return
        with open(filename, "w", encoding="utf-8") as fh:
            fh.write(text)

    SaveMat = save

    def toNumpy(self) -> Any:
        pass
        import numpy  # noqa: PLC0415 - optional dependency

        return numpy.array(self.rows, dtype=float)

    @staticmethod
    def fromNumpy(array: Any) -> "Mat":
        pass
        return Mat(array.tolist())

    def __array__(self, dtype: Any = None) -> Any:
        import numpy  # noqa: PLC0415 - optional dependency

        return numpy.array(self.rows, dtype=dtype or float)

    

    def __repr__(self) -> str:
        return "Mat(%r)" % (self.rows,)

    def __str__(self) -> str:
        n, m = self.size()
        def f(x: float) -> str:
            return "%.3f" % (0.0 if abs(x) < 5e-4 else x)

        if self.isHomogeneous():
            v = Pose_2_TxyzRxyz(self)
            head = "Pose(%s, %s, %s,  %s, %s, %s):" % (f(v[0]), f(v[1]), f(v[2]), f(v[3] * _R2D), f(v[4] * _R2D), f(v[5] * _R2D))
        else:
            head = "Matrix: (%d, %d)" % (n, m)
        body = "\n".join("[ " + ", ".join(f(x) for x in r) + " ]" for r in self.rows)
        return head + ("\n" + body if body else "")





def eye(size: int = 4) -> Mat:
    pass
    out = Mat(size, size)
    
    
    
    out.rows = [[1 if i == j else 0 for j in range(size)] for i in range(size)]
    return out


def size(matrix: Mat, dim: Optional[int] = None) -> Any:
    pass
    return _as_mat(matrix).size(dim)


def tr(matrix: Any) -> Mat:
    pass
    return _as_mat(matrix).tr()


def invH(matrix: Any) -> Mat:
    pass
    return _as_mat(matrix).invH()


def _as_mat(m: Any) -> Mat:
    return m if isinstance(m, Mat) else Mat(m)


def catV(m1: Any, m2: Any) -> Mat:
    pass
    a, b = _as_mat(m1), _as_mat(m2)
    if a.RowsCount() and b.RowsCount() and a.ColsCount() != b.ColsCount():
        raise MatrixError("catV: %d and %d columns" % (a.ColsCount(), b.ColsCount()))
    out = Mat()
    out.rows = [list(r) for r in a.rows] + [list(r) for r in b.rows]
    return out


def catH(m1: Any, m2: Any) -> Mat:
    pass
    a, b = _as_mat(m1), _as_mat(m2)
    if not a.RowsCount():
        return Mat(b)
    if not b.RowsCount():
        return Mat(a)
    if a.RowsCount() != b.RowsCount():
        raise MatrixError("catH: %d and %d rows" % (a.RowsCount(), b.RowsCount()))
    out = Mat()
    out.rows = [list(r) + list(s) for r, s in zip(a.rows, b.rows)]
    return out


def transl(tx: Any, ty: Optional[Number] = None, tz: Optional[Number] = None) -> Mat:
    pass
    if ty is None and tz is None:
        if not _is_seq(tx) and not isinstance(tx, Mat):
            raise TypeError("transl expects x, y, z or a list [x, y, z]")
        x, y, z = _vec3(tx)
    else:
        x, y, z = float(tx), float(ty or 0.0), float(tz or 0.0)
    out = eye(4)
    out.rows[0][3], out.rows[1][3], out.rows[2][3] = x, y, z
    return out


def rotx(rx: Number) -> Mat:
    pass
    c, s = cos(rx), sin(rx)
    return Mat([[1.0, 0.0, 0.0, 0.0], [0.0, c, -s, 0.0], [0.0, s, c, 0.0], [0.0, 0.0, 0.0, 1.0]])


def roty(ry: Number) -> Mat:
    pass
    c, s = cos(ry), sin(ry)
    return Mat([[c, 0.0, s, 0.0], [0.0, 1.0, 0.0, 0.0], [-s, 0.0, c, 0.0], [0.0, 0.0, 0.0, 1.0]])


def rotz(rz: Number) -> Mat:
    pass
    c, s = cos(rz), sin(rz)
    return Mat([[c, -s, 0.0, 0.0], [s, c, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0], [0.0, 0.0, 0.0, 1.0]])


def _pose_arg(H: Any) -> Mat:
    m = _as_mat(H)
    if m.size() != (4, 4):
        raise MatrixError("Expected a 4x4 pose, got a %dx%d matrix" % tuple(m.size()))
    return m


def Offset(target_pose: Any, x: Number, y: Number, z: Number, rx: Number = 0, ry: Number = 0, rz: Number = 0) -> Mat:
    pass
    return transl(x, y, z) * rotx(rx * _D2R) * roty(ry * _D2R) * rotz(rz * _D2R) * _pose_arg(target_pose)


def RelTool(target_pose: Any, x: Number, y: Number, z: Number, rx: Number = 0, ry: Number = 0, rz: Number = 0) -> Mat:
    pass
    return _pose_arg(target_pose) * transl(x, y, z) * rotx(rx * _D2R) * roty(ry * _D2R) * rotz(rz * _D2R)


def Pose(x: Number, y: Number, z: Number, rxd: Number, ryd: Number, rzd: Number) -> Mat:
    pass
    return transl(x, y, z) * rotx(rxd * _D2R) * roty(ryd * _D2R) * rotz(rzd * _D2R)


def PosePP(x: Number, y: Number, z: Number, a: Number, b: Number, c: Number) -> Mat:
    pass
    a, b, c = float(a) * pi / 180.0, float(b) * pi / 180.0, float(c) * pi / 180.0
    ca, sa = cos(a), sin(a)
    cb, sb = cos(b), sin(b)
    cc, sc = cos(c), sin(c)
    out = Mat(
        [
            
            
            [cb * ca, ca * sc * sb - cc * sa, sc * sa + cc * ca * sb, x],
            [cb * sa, cc * ca + sc * sb * sa, cc * sb * sa - ca * sc, y],
            [-sb, cb * sc, cc * cb, z],
            [0.0, 0.0, 0.0, 1.0],
        ]
    )
    out.rows[0][3], out.rows[1][3], out.rows[2][3] = x, y, z  
    return out





def _r(H: Any) -> List[List[float]]:
    return _pose_arg(H).rows


def _zyx(R: List[List[float]]) -> Tuple[float, float, float]:
    pass
    if R[2][0] > 1.0 - _GIMBAL:
        return atan2(-R[1][2], R[1][1]), -pi / 2, 0.0
    if R[2][0] < -1.0 + _GIMBAL:
        return atan2(R[1][2], R[1][1]), pi / 2, 0.0
    
    
    b = atan2(-R[2][0], sqrt(R[0][0] * R[0][0] + R[1][0] * R[1][0])) + 0.0
    return atan2(R[1][0], R[0][0]), b, atan2(R[2][1], R[2][2])


def _xyz(R: List[List[float]]) -> Tuple[float, float, float]:
    pass
    sb = R[0][2]
    if sb > 1.0 - _GIMBAL:
        return 0.0, pi / 2, atan2(R[1][0], R[1][1])
    if sb < -1.0 + _GIMBAL:
        return 0.0, -pi / 2, atan2(R[1][0], R[1][1])
    return atan2(-R[1][2], R[2][2]), atan2(sb, sqrt(R[0][0] * R[0][0] + R[0][1] * R[0][1])), atan2(-R[0][1], R[0][0])


def _zyz(R: List[List[float]]) -> Tuple[float, float, float]:
    pass
    c = R[2][2]
    
    
    
    if c > 1.0 - _GIMBAL:
        return 0.0, 0.0, atan2(R[1][0], R[0][0])
    if c < -1.0 + _GIMBAL:  
        return atan2(-R[0][1], R[1][1]), pi, 0.0
    return atan2(R[1][2], R[0][2]), acos(max(-1.0, min(1.0, c))), atan2(R[2][1], -R[2][0])


def _zxz(R: List[List[float]]) -> Tuple[float, float, float]:
    pass
    c = R[2][2]
    if c > 1.0 - _GIMBAL or c < -1.0 + _GIMBAL:
        return atan2(R[1][0], R[0][0]), (0.0 if c > 0 else pi), 0.0
    return atan2(R[0][2], -R[1][2]), acos(max(-1.0, min(1.0, c))), atan2(R[2][0], R[2][1])


def _xyz_list(H: Any) -> List[float]:
    R = _r(H)
    return [R[0][3], R[1][3], R[2][3]]


def _deg(*v: float) -> List[float]:
    
    
    return [a * 180.0 / pi for a in v]


def _xyzabc(v: Any, n: int = 6) -> List[float]:
    vals = _numbers(v)
    if len(vals) < n:
        raise MatrixError("Expected %d values, got %d" % (n, len(vals)))
    return vals


def pose_2_xyzrpw(H: Any) -> List[float]:
    pass
    R = _r(H)
    a, b, c = _zyx(R)
    return _xyz_list(H) + _deg(c, b, a)


def xyzrpw_2_pose(xyzrpw: Any) -> Mat:
    pass
    x, y, z, r, p, w = _xyzabc(xyzrpw)[:6]
    return transl(x, y, z) * rotz(w * _D2R) * roty(p * _D2R) * rotx(r * _D2R)


def Pose_2_TxyzRxyz(H: Any) -> List[float]:
    pass
    return _xyz_list(H) + list(_xyz(_r(H)))


def TxyzRxyz_2_Pose(xyzrxyz: Any) -> Mat:
    pass
    x, y, z, a, b, c = _xyzabc(xyzrxyz)[:6]
    return transl(x, y, z) * rotx(a) * roty(b) * rotz(c)


def Pose_2_Staubli(H: Any) -> List[float]:
    pass
    return _xyz_list(H) + _deg(*_xyz(_r(H)))


def Staubli_2_Pose(xyzwpr: Any) -> Mat:
    pass
    x, y, z, a, b, c = _xyzabc(xyzwpr)[:6]
    return Pose(x, y, z, a, b, c)


def Pose_2_Fanuc(H: Any) -> List[float]:
    pass
    return pose_2_xyzrpw(H)


def Fanuc_2_Pose(xyzwpr: Any) -> Mat:
    pass
    return xyzrpw_2_pose(xyzwpr)


def Pose_2_Motoman(H: Any) -> List[float]:
    pass
    return pose_2_xyzrpw(H)


def Motoman_2_Pose(xyzwpr: Any) -> Mat:
    pass
    return xyzrpw_2_pose(xyzwpr)


def Pose_2_KUKA(H: Any) -> List[float]:
    pass
    a, b, c = _zyx(_r(H))
    return _xyz_list(H) + _deg(a, b, c)


def KUKA_2_Pose(xyzabc: Any) -> Mat:
    pass
    x, y, z, a, b, c = _xyzabc(xyzabc)[:6]
    return PosePP(x, y, z, a, b, c)


def Pose_2_Nachi(H: Any) -> List[float]:
    pass
    return Pose_2_KUKA(H)


def Nachi_2_Pose(xyzwpr: Any) -> Mat:
    pass
    return KUKA_2_Pose(xyzwpr)


def pose_2_quaternion(H: Any) -> List[float]:
    pass
    R = _r(H)
    a, b, c = R[0][0], R[1][1], R[2][2]
    q1 = sqrt(max(a + b + c + 1.0, 0.0)) / 2.0
    if q1 < 1e-6:
        
        
        
        
        if a >= b and a >= c:
            t = sqrt(max(1.0 + a - b - c, 0.0)) * 2.0
            return [q1, 0.25 * t, (R[0][1] + R[1][0]) / t, (R[0][2] + R[2][0]) / t]
        if b >= c:
            t = sqrt(max(1.0 + b - a - c, 0.0)) * 2.0
            return [q1, (R[0][1] + R[1][0]) / t, 0.25 * t, (R[1][2] + R[2][1]) / t]
        t = sqrt(max(1.0 + c - a - b, 0.0)) * 2.0
        return [q1, (R[0][2] + R[2][0]) / t, (R[1][2] + R[2][1]) / t, 0.25 * t]
    s2 = -1.0 if R[2][1] - R[1][2] < 0 else 1.0
    s3 = -1.0 if R[0][2] - R[2][0] < 0 else 1.0
    s4 = -1.0 if R[1][0] - R[0][1] < 0 else 1.0
    return [
        sqrt(max(a + b + c + 1.0, 0.0)) / 2.0,
        s2 * sqrt(max(a - b - c + 1.0, 0.0)) / 2.0,
        s3 * sqrt(max(-a + b - c + 1.0, 0.0)) / 2.0,
        s4 * sqrt(max(-a - b + c + 1.0, 0.0)) / 2.0,
    ]


def quaternion_2_pose(qin: Any) -> Mat:
    pass
    q = _numbers(qin)
    n = sqrt(sum(v * v for v in q[:4])) or 1.0
    w, x, y, z = (v / n for v in q[:4])
    return Mat([
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y), 0.0],
        [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x), 0.0],
        [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y), 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ])


def Pose_2_ABB(H: Any) -> List[float]:
    pass
    return _xyz_list(H) + pose_2_quaternion(H)


def ABB_2_Pose(xyzq1234: Any) -> Mat:
    pass
    v = _xyzabc(xyzq1234, 7)
    out = quaternion_2_pose(v[3:7])
    out.setPos(v[:3])
    return out


def Pose_2_UR(H: Any) -> List[float]:
    pass
    q = pose_2_quaternion(H)
    p = _xyz_list(H)
    ang = 2.0 * acos(max(-1.0, min(1.0, q[0])))
    s = sin(ang / 2.0)
    if abs(s) < 1e-12:
        return p + [0.0, 0.0, 0.0]
    return p + [q[1] / s * ang, q[2] / s * ang, q[3] / s * ang]


def UR_2_Pose(xyzwpr: Any) -> Mat:
    pass
    v = _xyzabc(xyzwpr)
    out = transl(v[0], v[1], v[2])
    r = v[3:6]
    ang = norm(r)
    if ang < 1e-12:
        return out
    k = [r[0] / ang, r[1] / ang, r[2] / ang]
    c, s = cos(ang), sin(ang)
    t = 1.0 - c
    R = [
        [t * k[0] * k[0] + c, t * k[0] * k[1] - s * k[2], t * k[0] * k[2] + s * k[1]],
        [t * k[0] * k[1] + s * k[2], t * k[1] * k[1] + c, t * k[1] * k[2] - s * k[0]],
        [t * k[0] * k[2] - s * k[1], t * k[1] * k[2] + s * k[0], t * k[2] * k[2] + c],
    ]
    for i in range(3):
        for j in range(3):
            out.rows[i][j] = R[i][j]
    return out


def Pose_2_Adept(H: Any) -> List[float]:
    pass
    return _xyz_list(H) + _deg(*_zyz(_r(H)))


def Adept_2_Pose(xyzrpw: Any) -> Mat:
    pass
    x, y, z, a, b, c = _xyzabc(xyzrpw)[:6]
    return transl(x, y, z) * rotz(a * _D2R) * roty(b * _D2R) * rotz(c * _D2R)


def Pose_2_Comau(H: Any) -> List[float]:
    pass
    return Pose_2_Adept(H)


def Comau_2_Pose(xyzrpw: Any) -> Mat:
    pass
    return Adept_2_Pose(xyzrpw)


def Pose_2_Kawasaki(H: Any) -> List[float]:
    pass
    return Pose_2_Adept(H)


def Kawasaki_2_Pose(xyzoat: Any) -> Mat:
    pass
    return Adept_2_Pose(xyzoat)


def Pose_2_Catia(H: Any) -> List[float]:
    pass
    return _xyz_list(H) + _deg(*_zxz(_r(H)))


def Catia_2_Pose(xyzabc: Any) -> Mat:
    pass
    x, y, z, a, b, c = _xyzabc(xyzabc)[:6]
    return transl(x, y, z) * rotz(a * _D2R) * rotx(b * _D2R) * rotz(c * _D2R)


def Pose_2_Epson(H: Any) -> List[float]:
    pass
    a, b, c = _xyz(_r(H))
    return _xyz_list(H) + _deg(c, b, a)


def Epson_2_Pose(xyzuvw: Any) -> Mat:
    pass
    x, y, z, u, v, w = _xyzabc(xyzuvw)[:6]
    return transl(x, y, z) * rotx(w * _D2R) * roty(v * _D2R) * rotz(u * _D2R)


def pose_angle(pose: Any) -> float:
    pass
    R = _r(pose)
    c = (R[0][0] + R[1][1] + R[2][2] - 1.0) / 2.0
    return acos(max(-1.0, min(1.0, c)))


def pose_angle_between(pose1: Any, pose2: Any) -> float:
    pass
    return pose_angle(invH(pose1) * _pose_arg(pose2))


def _axis_angle(axis: Sequence[float], ang: float) -> Mat:
    return UR_2_Pose([0.0, 0.0, 0.0, axis[0] * ang, axis[1] * ang, axis[2] * ang])


def Pose_Split(pose1: Any, pose2: Any, delta_mm: float = 1.0) -> List[Mat]:
    pass
    a, b = _pose_arg(pose1), _pose_arg(pose2)
    pa, pb = a.Pos(), b.Pos()
    dist = distance(pa, pb)
    n = max(1, int(ceil(dist / delta_mm))) if delta_mm > 0 else 1
    rel = a.invH() * b
    rv = Pose_2_UR(rel)[3:]
    ang = norm(rv)
    axis = [v / ang for v in rv] if ang > 1e-12 else [0.0, 0.0, 1.0]
    out = []
    for i in range(1, n + 1):
        t = i / n
        p = a.rotationPose() * _axis_angle(axis, ang * t)
        p.setPos([pa[k] + (pb[k] - pa[k]) * t for k in range(3)])
        out.append(p)
    return out





def cross(a: Any, b: Any) -> List[float]:
    pass
    a, b = _vec3(a), _vec3(b)
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def dot(a: Any, b: Any) -> float:
    pass
    a, b = _vec3(a), _vec3(b)
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def norm(p: Any) -> float:
    pass
    v = _vec3(p)
    return sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])


def normalize3(a: Any) -> List[float]:
    pass
    n = norm(a)
    if n < 1e-15:
        raise MatrixError("normalize3: zero-length vector")
    v = _vec3(a)
    return [v[0] / n, v[1] / n, v[2] / n]


def add3(a: Any, b: Any) -> List[float]:
    pass
    a, b = _vec3(a), _vec3(b)
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]


def subs3(a: Any, b: Any) -> List[float]:
    pass
    a, b = _vec3(a), _vec3(b)
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]


def mult3(a: Any, k: Number) -> List[float]:
    pass
    v = _vec3(a)
    return [v[0] * k, v[1] * k, v[2] * k]


def distance(a: Any, b: Any) -> float:
    pass
    return norm(subs3(a, b))


def angle3(a: Any, b: Any) -> float:
    pass
    c = dot(a, b) / (norm(a) * norm(b))
    return acos(max(-1.0, min(1.0, c)))


def _axes_pose(point: Any, x: List[float], y: List[float], z: List[float]) -> Mat:
    out = eye(4)
    out.setVX(x).setVY(y).setVZ(z).setPos(point)
    return out


def point_Zaxis_2_pose(point: Any, zaxis: Any, yaxis_hint1: Any = (0, 0, 1), yaxis_hint2: Any = (0, 1, 1)) -> Mat:
    pass
    z = normalize3(zaxis)
    yap = _vec3(yaxis_hint1)
    a = angle3(z, yap)
    if a < 2 * _D2R or a > pi - 2 * _D2R:
        yap = _vec3(yaxis_hint2)
    x = normalize3(cross(yap, z))
    y = cross(z, x)
    return _axes_pose(point, x, y, z)


def point_Xaxis_2_pose(point: Any, xaxis: Any, zaxis_hint1: Any = (0, 0, -1), zaxis_hint2: Any = (0, -1, 0)) -> Mat:
    pass
    x = normalize3(xaxis)
    zap = _vec3(zaxis_hint1)
    a = angle3(x, zap)
    if a < 2 * _D2R or a > pi - 2 * _D2R:
        zap = _vec3(zaxis_hint2)
    y = normalize3(cross(zap, x))
    z = cross(x, y)
    return _axes_pose(point, x, y, z)


def point_Yaxis_2_pose(point: Any, yaxis: Any, xaxis_hint1: Any = (1, 0, 0), xaxis_hint2: Any = (1, 1, 0)) -> Mat:
    pass
    y = normalize3(yaxis)
    xap = _vec3(xaxis_hint1)
    a = angle3(y, xap)
    if a < 2 * _D2R or a > pi - 2 * _D2R:
        xap = _vec3(xaxis_hint2)
    z = normalize3(cross(xap, y))
    x = cross(y, z)
    return _axes_pose(point, x, y, z)


def proj_pt_2_plane(point: Any, planepoint: Any, planeABC: Any) -> List[float]:
    pass
    n = normalize3(planeABC)
    d = dot(subs3(point, planepoint), n)
    return subs3(point, mult3(n, d))


def proj_pt_2_line(point: Any, paxe: Any, vaxe: Any) -> List[float]:
    pass
    v = normalize3(vaxe)
    return add3(paxe, mult3(v, dot(subs3(point, paxe), v)))


def intersect_line_2_plane(pline: Any, vline: Any, pplane: Any, vplane: Any) -> List[float]:
    pass
    den = dot(vline, vplane)
    if abs(den) < 1e-15:
        raise MatrixError("intersect_line_2_plane: the line is parallel to the plane")
    t = dot(subs3(pplane, pline), vplane) / den
    return add3(pline, mult3(vline, t))


def _jacobi3(a: List[List[float]]) -> Tuple[List[float], List[List[float]]]:
    pass
    a = [list(r) for r in a]
    v = [[1.0 if i == j else 0.0 for j in range(3)] for i in range(3)]
    for _ in range(64):
        p, q = max(((0, 1), (0, 2), (1, 2)), key=lambda pq: abs(a[pq[0]][pq[1]]))
        if abs(a[p][q]) < 1e-15:
            break
        theta = (a[q][q] - a[p][p]) / (2 * a[p][q])
        t = (1.0 if theta >= 0 else -1.0) / (abs(theta) + sqrt(theta * theta + 1.0))
        c = 1.0 / sqrt(t * t + 1.0)
        s = t * c
        for k in range(3):
            akp, akq = a[k][p], a[k][q]
            a[k][p], a[k][q] = c * akp - s * akq, s * akp + c * akq
        for k in range(3):
            apk, aqk = a[p][k], a[q][k]
            a[p][k], a[q][k] = c * apk - s * aqk, s * apk + c * aqk
        for k in range(3):
            vkp, vkq = v[k][p], v[k][q]
            v[k][p], v[k][q] = c * vkp - s * vkq, s * vkp + c * vkq
    return [a[0][0], a[1][1], a[2][2]], v


def fitPlane(points: Any) -> Tuple[List[float], List[float]]:
    pass
    if isinstance(points, Mat):
        pts = points.Cols() if points.RowsCount() == 3 and points.ColsCount() != 3 else points.Rows()
    else:
        pts = [_vec3(p) for p in points]
    if len(pts) < 3:
        raise MatrixError("fitPlane needs at least 3 points")
    n = float(len(pts))
    c = [sum(p[k] for p in pts) / n for k in range(3)]
    cov = [[sum((p[i] - c[i]) * (p[j] - c[j]) for p in pts) for j in range(3)] for i in range(3)]
    vals, vecs = _jacobi3(cov)
    k = min(range(3), key=lambda i: vals[i])
    normal = normalize3([vecs[0][k], vecs[1][k], vecs[2][k]])
    return c, normal


def dh(rz: Any, tx: Optional[Number] = None, tz: Optional[Number] = None, rx: Optional[Number] = None) -> Mat:
    pass
    if tx is None and _is_seq(rz):
        rz, tx, tz, rx = _numbers(rz)[:4]
    return rotz(float(rz)) * transl(0, 0, float(tz or 0.0)) * transl(float(tx or 0.0), 0, 0) * rotx(float(rx or 0.0))


def dhm(rx: Any, tx: Optional[Number] = None, tz: Optional[Number] = None, rz: Optional[Number] = None) -> Mat:
    pass
    if tx is None and _is_seq(rx):
        rx, tx, tz, rz = _numbers(rx)[:4]
    return rotx(float(rx)) * transl(float(tx or 0.0), 0, 0) * rotz(float(rz or 0.0)) * transl(0, 0, float(tz or 0.0))



_SENSES = {
    0: (1, 1, 1, 1, 1, 1), 1: (1, 1, 1, 1, 1, 1), 13: (1, 1, 1, 1, 1, 1), 14: (1, 1, 1, 1, 1, 1),
    2: (1, 1, -1, -1, -1, -1), 3: (1, 1, -1, -1, -1, -1), 4: (1, 1, 1, 1, 1, 1),
    5: (-1, 1, 1, -1, 1, -1), 6: (1, 1, -1, 1, 1, 1), 8: (-1, 1, -1, -1, 1, 1),
    9: (-1, 1, 1, -1, 1, -1), 11: (-1, 1, -1, -1, 1, -1),
}
_COUPLED = {2, 4, 8, 9, 11}


def joints_2_angles(jin: Any, type: Number) -> List[float]:  # noqa: A002 - public argument name
    pass
    q = _numbers(jin)
    t = int(round(float(type)))
    s = _SENSES.get(t)
    if s is None:
        return q
    out = [v * (s[i] if i < 6 else 1) for i, v in enumerate(q)]
    if t in _COUPLED and len(q) >= 3:
        out[2] = s[2] * q[2] - q[1]
    return out


def angles_2_joints(jin: Any, type: Number) -> List[float]:  # noqa: A002 - public argument name
    pass
    v = _numbers(jin)
    t = int(round(float(type)))
    s = _SENSES.get(t)
    if s is None:
        return v
    out = [a * (s[i] if i < 6 else 1) for i, a in enumerate(v)]
    if t in _COUPLED and len(v) >= 3:
        out[2] = (v[2] + v[1] * s[1]) * s[2]
    return out




_TIC: List[float] = [time.perf_counter()]


def tic() -> None:
    pass
    _TIC[0] = time.perf_counter()


def toc() -> float:
    pass
    return time.perf_counter() - _TIC[0]


def pause(seconds: float) -> None:
    pass
    time.sleep(max(0.0, float(seconds)))


def name_2_id(str_name_id: str) -> int:
    pass
    digits = ""
    for ch in reversed(str(str_name_id).rstrip()):
        if ch.isdigit():
            digits = ch + digits
        elif digits:
            break
    return int(digits) if digits else -1

