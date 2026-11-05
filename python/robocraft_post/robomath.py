# Provides lightweight pose arithmetic and orientation conversions for post generation.












from __future__ import annotations

import math
from typing import List, Sequence

Pose = List[List[float]]

DEG = math.pi / 180.0


def p(x: float, y: float, z: float, a: float, b: float, c: float) -> Pose:
    pass
    a = a * math.pi / 180.0
    b = b * math.pi / 180.0
    c = c * math.pi / 180.0
    ca, sa = math.cos(a), math.sin(a)
    cb, sb = math.cos(b), math.sin(b)
    cc, sc = math.cos(c), math.sin(c)
    return [
        [cb * ca, ca * sc * sb - cc * sa, sc * sa + cc * ca * sb, x],
        [cb * sa, cc * ca + sc * sb * sa, cc * sb * sa - ca * sc, y],
        [-sb, cb * sc, cc * cb, z],
        [0.0, 0.0, 0.0, 1.0],
    ]


def eye() -> Pose:
    return [[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0], [0.0, 0.0, 0.0, 1.0]]


def mul(a: Pose, b: Pose) -> Pose:
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def inv(h: Pose) -> Pose:
    pass
    r = [[h[j][i] for j in range(3)] for i in range(3)]
    t = [-(r[i][0] * h[0][3] + r[i][1] * h[1][3] + r[i][2] * h[2][3]) for i in range(3)]
    return [r[0] + [t[0]], r[1] + [t[1]], r[2] + [t[2]], [0.0, 0.0, 0.0, 1.0]]


def xyz(h: Pose) -> List[float]:
    return [h[0][3], h[1][3], h[2][3]]


def _sign(v: float) -> float:
    return -1.0 if v < 0 else 1.0


def quaternion(h: Pose) -> List[float]:
    pass
    a, b, c = h[0][0], h[1][1], h[2][2]
    q1 = math.sqrt(max(a + b + c + 1, 0)) / 2
    if q1 < 1e-6:
        if a >= b and a >= c:
            s = math.sqrt(max(1 + a - b - c, 0)) * 2
            return [q1, 0.25 * s, (h[0][1] + h[1][0]) / s, (h[0][2] + h[2][0]) / s]
        if b >= c:
            s = math.sqrt(max(1 + b - a - c, 0)) * 2
            return [q1, (h[0][1] + h[1][0]) / s, 0.25 * s, (h[1][2] + h[2][1]) / s]
        s = math.sqrt(max(1 + c - a - b, 0)) * 2
        return [q1, (h[0][2] + h[2][0]) / s, (h[1][2] + h[2][1]) / s, 0.25 * s]
    q2 = _sign(h[2][1] - h[1][2]) * math.sqrt(max(a - b - c + 1, 0)) / 2
    q3 = _sign(h[0][2] - h[2][0]) * math.sqrt(max(-a + b - c + 1, 0)) / 2
    q4 = _sign(h[1][0] - h[0][1]) * math.sqrt(max(-a - b + c + 1, 0)) / 2
    return [q1, q2, q3, q4]


def euler_zyx(h: Pose) -> List[float]:
    pass
    if h[2][0] > 1.0 - 1e-10:
        ry = -math.pi / 2
        rz = 0.0
        rx = math.atan2(-h[1][2], h[1][1])
    elif h[2][0] < -1.0 + 1e-10:
        ry = math.pi / 2
        rz = 0.0
        rx = math.atan2(h[1][2], h[1][1])
    else:
        ry = math.atan2(-h[2][0], math.sqrt(h[0][0] * h[0][0] + h[1][0] * h[1][0]))
        rz = math.atan2(h[1][0], h[0][0])
        rx = math.atan2(h[2][1], h[2][2])
    return [rz * 180.0 / math.pi, ry * 180.0 / math.pi, rx * 180.0 / math.pi]


def xyzabc(h: Pose) -> List[float]:
    pass
    rz, ry, rx = euler_zyx(h)
    return [h[0][3], h[1][3], h[2][3], rz, ry, rx]


def euler_zyz(h: Pose) -> List[float]:
    pass
    if abs(h[2][2]) > 1.0 - 1e-10:
        if h[2][2] > 0:
            return [0.0, 0.0, math.atan2(h[1][0], h[0][0]) * 180.0 / math.pi]
        return [0.0, 180.0, math.atan2(-h[1][0], h[0][0]) * 180.0 / math.pi]
    a = math.atan2(h[1][2], h[0][2])
    e = math.atan2(math.sqrt(h[0][2] * h[0][2] + h[1][2] * h[1][2]), h[2][2])
    r = math.atan2(h[2][1], -h[2][0])
    return [a * 180.0 / math.pi, e * 180.0 / math.pi, r * 180.0 / math.pi]


def xyzwpr(h: Pose) -> List[float]:
    pass
    rz, ry, rx = euler_zyx(h)
    return [h[0][3], h[1][3], h[2][3], rx, ry, rz]


def rotation_vector(h: Pose) -> List[float]:
    pass
    trace = h[0][0] + h[1][1] + h[2][2]
    cos_angle = max(-1.0, min(1.0, (trace - 1.0) / 2.0))
    angle = math.acos(cos_angle)
    if angle < 1e-6:
        return [0.0, 0.0, 0.0]
    if math.pi - angle < 1e-6:
        
        ax = [math.sqrt(max((h[i][i] + 1.0) / 2.0, 0.0)) for i in range(3)]
        k = ax.index(max(ax))
        if k == 0:
            ax[1] = math.copysign(ax[1], h[0][1])
            ax[2] = math.copysign(ax[2], h[0][2])
        elif k == 1:
            ax[0] = math.copysign(ax[0], h[0][1])
            ax[2] = math.copysign(ax[2], h[1][2])
        else:
            ax[0] = math.copysign(ax[0], h[0][2])
            ax[1] = math.copysign(ax[1], h[1][2])
        return [v * angle for v in ax]
    s = 2.0 * math.sin(angle)
    return [
        (h[2][1] - h[1][2]) / s * angle,
        (h[0][2] - h[2][0]) / s * angle,
        (h[1][0] - h[0][1]) / s * angle,
    ]


def fixed(values: Sequence[float], decimals: int, sep: str = ",") -> str:
    pass
    return sep.join("%.*f" % (decimals, v) for v in values)
