








import itertools
import math
import os
import random
import struct
import sys
import zlib

PORT = int(sys.argv[1])
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, os.pardir, "python", "enginuity", "src"))  
WORK = sys.argv[3]
os.makedirs(WORK, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, 'tools'))

from enginuity import robolink, robomath  # noqa: E402
import robotfile_probe as rp  # noqa: E402


SRC = os.path.join(os.path.dirname(ROOT), 'data', 'library', 'files', 'library-robots', 'ABB-IRB-120-3-0-6.robot')


def out(label, value):
    print('%s: %s' % (label, value), flush=True)


def f(v):
    if v == 0:
        return '0'
    for m, s in ((math.pi / 2, 'pi/2'), (math.pi, 'pi'), (-math.pi / 2, '-pi/2')):
        if abs(v - m) < 1e-9:
            return s
    return '%.6g' % v


def header_of(path):
    raw, comp = rp.load_payload(path)
    return rp.Header(raw), raw, comp


def diff(h0, h1):
    return ['c%d.r%d:%s->%s' % (i // 20, i % 20, f(a), f(b))
            for i, (a, b) in enumerate(zip(h0.values, h1.values)) if a != b]


def write_mod(name, changes, compress=True):
    raw, _ = rp.load_payload(SRC)
    b = bytearray(raw)
    for (c, r), v in changes.items():
        struct.pack_into('<d', b, (c * 20 + r) * 8, float(v))
    data = bytes(b)
    if compress:
        data = struct.pack('>I', len(data)) + zlib.compress(data)
    p = os.path.join(WORK, name + '.robot')
    open(p, 'wb').write(data)
    return p


RDK = robolink.Robolink(port=PORT, args=[], quit_on_close=False)
RDK.setRunMode(robolink.RUNMODE_SIMULATE)


RDK.AddStation('Mapping save-diff')
robot = RDK.AddFile(SRC)
n = [0]


def snap(tag):
    n[0] += 1
    p = os.path.join(WORK, 'snap_%02d_%s.robot' % (n[0], tag))
    RDK.Save(p, robot)
    return header_of(p)


h0, raw0, comp0 = snap('unchanged')
src_h, src_raw, _ = header_of(SRC)
out('save_unchanged', 'qCompress=%s payload identical to source=%s' % (comp0, raw0 == src_raw))
steps = [
    ('setJoints([10,20,30,40,50,60])', lambda: robot.setJoints([10, 20, 30, 40, 50, 60])),
    ('setJointsHome([1..6])', lambda: robot.setJointsHome([1, 2, 3, 4, 5, 6])),
    ('setJointLimits(-100..-105, 100..105)', lambda: robot.setJointLimits([-100, -101, -102, -103, -104, -105],
                                                                          [100, 101, 102, 103, 104, 105])),
    ("setName('MyRobot')", lambda: robot.setName('MyRobot')),
    ('setSpeed(123,45,678,90)', lambda: robot.setSpeed(123, 45, 678, 90)),
    ('setRounding(7)', lambda: robot.setRounding(7)),
    ('setParamRobotTool(7.5,[1,2,3])', lambda: robot.setParamRobotTool(7.5, [1, 2, 3])),
    ("setParam('PostProcessor','KUKA_KRC4')", lambda: robot.setParam('PostProcessor', 'KUKA_KRC4')),
    ("setParam('Reach','777')", lambda: robot.setParam('Reach', '777')),
    ("setParam('Payload','4.5')", lambda: robot.setParam('Payload', '4.5')),
    ("setParam('Repeatability','0.02')", lambda: robot.setParam('Repeatability', '0.02')),
    ("setParam('Weight','33')", lambda: robot.setParam('Weight', '33')),
    ("setParam('KinematicsPoseBase','transl(1,2,3)*rotz(0.5)*roty(0.2)*rotx(0.1)')",
     lambda: robot.setParam('KinematicsPoseBase', 'transl(1,2,3)*rotz(0.5)*roty(0.2)*rotx(0.1)')),
    ("setParam('PulsesXdeg','1,2,3,4,5,6')", lambda: robot.setParam('PulsesXdeg', '1,2,3,4,5,6')),
    ('setPoseTool(transl(1,2,3))', lambda: robot.setPoseTool(robomath.transl(1, 2, 3))),
    ('setPoseFrame(transl(4,5,6))', lambda: robot.setPoseFrame(robomath.transl(4, 5, 6))),
]
for label, fn in steps:
    try:
        res = fn()
        res = res if isinstance(res, (str, type(None))) else type(res).__name__
    except Exception as e:  # noqa: BLE001
        res = 'ERROR %s' % e
    h1, _, _ = snap('step')
    out('savediff[%s]' % label, 'result=%r cells=%s' % (res, diff(h0, h1)))
    h0 = h1
robot.setColor([1, 0, 0, 1])
p = os.path.join(WORK, 'snap_color.robot')
RDK.Save(p, robot)
raw, _ = rp.load_payload(p)
res, H, objs = rp.parse_file(p)
out('savediff[setColor([1,0,0,1])]', 'header changed=%s; shape colours now=%s' % (
    rp.Header(raw).values != h0.values, sorted(set(tuple(L['colors_rgba'][0]) for L in res['links']))))
for idx in (0, 1, 2, 3, 20, 21, 22, 61, 101, 203, 600, 640, 3082, 4000):
    out('RobotValue[%d]' % idx, robot.setParam('RobotValue', str(idx)) if idx < 4000 else 'beyond 4000 -> %s' % (
        'reads memory (non-header value)'))
for key in ('MechType', 'TypeAxes', 'MasteringJoints', 'NativeName', 'IsCalibrated', 'IsAccuracyActive'):
    out('getParam[%s]' % key, robot.setParam(key))


RDK.AddStation('Mapping modified files')
p = write_mod('uncompressed_check', {}, compress=False)
out('uncompressed_robot_file', 'NOT loaded here: RoboDK shows modal "The robot file is not valid. The robot file is '
    'corrupted or there\'s not enough available space. Errors will follow." (see screenshot)')


def fit_presets(item, path, n=6):
    M = rp.RobotModel(rp.Header(rp.load_payload(path)[0]))
    random.seed(5)
    S = []
    while len(S) < 5:
        q = [random.uniform(M.lo[j] * 0.9, M.hi[j] * 0.9) for j in range(n)]
        try:
            S.append((q, [list(r) for r in item.SolveFK(q).rows]))
        except Exception:  # noqa: BLE001
            pass
    best = None
    for a3 in (-1, 1):
        for b3 in (-1, 0, 1):
            for sen in itertools.product((1, -1), repeat=n):
                def fk(q):
                    v = [q[j] * sen[j] for j in range(n)]
                    v[2] = a3 * q[2] + b3 * q[1]
                    T = rp.pose_xyz_rxryrz(M.base)
                    for j in range(n):
                        al, a, th, d = M.dh[j][:4]
                        T = rp.mul(T, rp.dh_modified(al, a, th + math.radians(v[j]), d))
                    return rp.mul(T, rp.pose_xyz_rxryrz(M.tool))
                e = 0.0
                for q, P in S:
                    F = fk(q)
                    e = max(e, max(abs(P[i][j] - F[i][j]) for i in range(4) for j in range(4)))
                    if best is not None and e >= best[0]:
                        break
                if best is None or e < best[0]:
                    s = list(sen)
                    s[2] = a3
                    best = (e, s, b3)
    return best


for jt in (0, 1, 2, 3, 4, 5, 6, 8, 9, 11, 13):
    p = write_mod('jt%d' % jt, {(3, 1): jt})
    item = RDK.AddFile(p)
    e, s, b3 = fit_presets(item, p)
    lo, hi, t = item.JointLimits()
    out('joints_type[%d]' % jt, 'JointLimits.type=%g senses=%s theta3 += %+d*q2  fit err=%.1e' % (t, s, b3, e))
    item.Delete()
for name, ch in (('jt7_rows', {(3, 1): 7, (3, 4): -1, (3, 5): 1, (3, 6): -1, (3, 7): 1, (3, 8): 1, (3, 9): 1}),
                 ('jt1_rows_ignored', {(3, 1): 1, (3, 4): -1, (3, 5): 1, (3, 6): 1, (3, 7): 1, (3, 8): 1, (3, 9): 1}),
                 ('jt12_row11neg', {(3, 1): 12, (3, 4): 1, (3, 5): 1, (3, 6): 1, (3, 7): 1, (3, 8): 1, (3, 9): 1,
                                    (3, 10): 0, (3, 11): -1, (3, 12): 1}),
                 ('jt12_row12neg', {(3, 1): 12, (3, 4): 1, (3, 5): 1, (3, 6): 1, (3, 7): 1, (3, 8): 1, (3, 9): 1,
                                    (3, 10): 0, (3, 11): 1, (3, 12): -1})):
    p = write_mod(name, ch)
    item = RDK.AddFile(p)
    e, s, b3 = fit_presets(item, p)
    out('joints_rows[%s]' % name, 'senses=%s theta3 += %+d*q2 fit err=%.1e' % (s, b3, e))
    item.Delete()


def lim_probe(item):
    lo, hi, t = item.JointLimits()
    r = []
    for q1 in (100, 160, 170):
        try:
            item.SolveFK([q1, 0, 0, 0, 0, 0])
            fk = 'ok'
        except Exception:  # noqa: BLE001
            fk = 'ERR'
        item.setJoints([q1, 0, 0, 0, 0, 0])
        r.append('J1=%d FK %s setJoints->%g' % (q1, fk, item.Joints().list()[0]))
    return 'JointLimits J1=[%g,%g]; %s' % (lo.list()[0], hi.list()[0], '; '.join(r))


for name, ch in (('c30c31_J1_50', {(30, 0): -50, (31, 0): 50}), ('c32c33_J1_50', {(32, 0): -50, (33, 0): 50}),
                 ('c130c131_J1_50', {(130, 0): -50, (131, 0): 50}), ('c132c133_J1_50', {(132, 0): -50, (133, 0): 50})):
    item = RDK.AddFile(write_mod(name, ch))
    out('limits[%s]' % name, lim_probe(item))
    item.Delete()
for name, ch in (('c10r3_999', {(10, 3): 999}), ('c110r3_999', {(110, 3): 999}), ('c28r2_100', {(28, 2): 100}),
                 ('c128r2_500', {(128, 2): 500}), ('c109r2_500', {(109, 2): 500}), ('c50_pose', {(50, 0): 100}),
                 ('c0r6_1', {(0, 6): 1}), ('c3r2_0', {(3, 2): 0}), ('c51r0_0', {(51, 0): 0})):
    item = RDK.AddFile(write_mod(name, ch))
    out('fk0_effect[%s]' % name, [round(x, 3) for x in item.SolveFK([0] * 6).Pos()])
    item.Delete()
item = RDK.AddFile(write_mod('jt7_zero_rows', {(3, 1): 7}))
out('jt7_zero_rows', 'FK pos for q=0 / J1=30 / J2=30 / J6=90: %s' % [
    [round(x, 2) for x in item.SolveFK(q).Pos()] for q in ([0] * 6, [30, 0, 0, 0, 0, 0], [0, 30, 0, 0, 0, 0],
                                                           [0, 0, 0, 0, 0, 90])])
item.Delete()
out('done', True)
