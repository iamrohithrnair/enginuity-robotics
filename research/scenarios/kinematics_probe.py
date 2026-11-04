






import math
import os
import random
import sys

PORT = int(sys.argv[1])
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, os.pardir, "python", "enginuity", "src"))  
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, 'tools'))

from enginuity import robolink, robomath  # noqa: E402
import robotfile_probe as rp  # noqa: E402


RF = os.path.join(os.environ.get('ENGINUITY_LIBRARY_DIR') or os.path.join(os.path.dirname(ROOT), 'data', 'library'), 'files', 'library-robots')
LIB = '/workspace/src/RoboDK/RoboDK.app/Contents/Library'
FILES = [
    ('ABB IRB 120', os.path.join(RF, 'ABB-IRB-120-3-0-6.robot')),
    ('UR5e', os.path.join(RF, 'UR5e.robot')),
    ('KUKA KR6 R900', os.path.join(RF, 'KUKA-KR-6-R900-sixx.robot')),
    ('Fanuc LR Mate 200iD', os.path.join(RF, 'Fanuc-LR-Mate-200iD.robot')),
    ('Fanuc M-20iA', os.path.join(RF, 'Fanuc-M-20iA.robot')),
    ('Yaskawa GP8', os.path.join(RF, 'Yaskawa-Motoman-GP8.robot')),
    ('Staubli TX2-60', os.path.join(RF, 'Staubli-TX2-60.robot')),
    ('Mecademic Meca500', os.path.join(RF, 'Mecademic-Meca500-R3.robot')),
    ('Kawasaki RS006L', os.path.join(RF, 'Kawasaki-RS006L.robot')),
    ('Comau NJ130', os.path.join(LIB, 'Add-in - Collision-free path - Spot Welding with Comau', 'Parts',
                                 'Comau-Smart5-NJ-130-2-6.robot')),
    ('ABB IRB 6640 (9 links)', os.path.join(RF, 'ABB-IRB-6640-185-2-8.robot')),
    ('KUKA LBR iiwa 7', os.path.join(RF, 'KUKA-LBR-iiwa-7-R800.robot')),
    ('Franka Panda', os.path.join(RF, 'Franka-Emika-Panda.robot')),
    ('Kinova Gen3', os.path.join(RF, 'Kinova-Gen3.robot')),
    ('Epson LS3 SCARA', os.path.join(RF, 'Epson-LS3-401S.robot')),
    ('ABB IRB 910SC SCARA', os.path.join(RF, 'ABB-IRB-910SC-3-0-65.robot')),
    ('ABB IRB 460 palletizer', os.path.join(RF, 'ABB-IRB-460.robot')),
    ('ABB IRBP L300 (1 axis)', os.path.join(RF, 'ABB-IRBP-L300-L1250.robot')),
    ('ABB IRBP A250 (2 axes)', os.path.join(RF, 'ABB-IRBP-A250-D1000.robot')),
    ('Gudel FP-1 (3 linear)', os.path.join(RF, 'Gudel-FP-1-300.robot')),
    ('ABB IRBT 6004 track', os.path.join(LIB, '09-3D printing boat mold', 'Parts',
                                         'ABB-IRBT-6004-Standard-3-5m.robot')),
]


def maxerr(A, B):
    return max(abs(A[i][j] - B[i][j]) for i in range(4) for j in range(4))


def rows(M):
    return [list(r) for r in M.rows]


def rnd(v, n=2):
    return [round(x, n) + 0.0 for x in v]


def out(label, value):
    print('%s: %s' % (label, value), flush=True)


RDK = robolink.Robolink(port=PORT, args=[], quit_on_close=False)
RDK.setRunMode(robolink.RUNMODE_SIMULATE)
out('version', RDK.Version().split('.')[0:3])


RDK.AddStation('KinProbe FK')
models = {}
for label, path in FILES:
    RDK.AddStation('KinProbe ' + label)
    item = RDK.AddFile(path)
    res, H, objs = rp.parse_file(path)
    M = rp.RobotModel(H)
    models[label] = (item, M)
    random.seed(1234)
    fk_err, frame_err, n = 0.0, 0.0, 0
    robot_abs = rows(item.PoseAbs())
    for k in range(20):
        q = [random.uniform(M.lo_user[j] * 0.95, M.hi_user[j] * 0.95) for j in range(M.n)]
        try:
            P = rows(item.SolveFK(q))
        except Exception:
            continue
        n += 1
        fk_err = max(fk_err, maxerr(P, M.fk(q)))
        if k < 3:
            item.setJoints(q)
            F = M.frames(q)
            for i in range(M.nlinks if M.mech != 9 else M.n + 1):
                L = item.ObjectLink(i)
                if not L.Valid() or i >= len(F):
                    continue
                frame_err = max(frame_err, maxerr(rows(L.PoseAbs()), rp.mul(robot_abs, F[i])))
    out('fk[%s]' % label, 'mech=%d axes=%d jtype=%d samples=%d max|FK err|=%.2e link-frame err=%.2e exact-parse=%s'
        % (M.mech, M.n, M.jtype, n, fk_err, frame_err, res['bytes_consumed_exactly']))


abb, Mabb = models['ABB IRB 120']
RDK.AddStation('KinProbe IK')
abb = RDK.AddFile(FILES[0][1])
kuka = RDK.AddFile(FILES[2][1])
ur = RDK.AddFile(FILES[1][1])


def solutions(item, P):
    A = item.SolveIK_All(P)
    if A.size(0) < 2:
        return []
    return [[A[i, j] for i in range(A.size(0))] for j in range(A.size(1))]


for name, item, q in (('ABB', abb, [30, 40, -50, 100, -60, 200]), ('KUKA', kuka, [10, -60, 80, 20, 40, 30]),
                      ('UR5e', ur, [10, -80, 70, -30, 60, 20])):
    item.setJoints([0] * 6 if name != 'UR5e' else [0, -90, -90, 0, 90, 0])
    P = item.SolveFK(q)
    S = solutions(item, P)
    out('ik_all[%s] q=%s' % (name, q), 'count=%d rows=%d' % (len(S), len(S[0]) if S else 0))
    for s in S:
        cfg = item.JointsConfig(s[:6]).list()
        out('   sol', '%s extra=%s cfg=%s' % (rnd(s[:6], 1), rnd(s[6:], 2), [int(c) for c in cfg]))


for name, item, q in (('ABB', abb, [30, 40, -50, 100, -60, 200]), ('UR5e', ur, [10, -80, 70, -30, 60, 20])):
    P = item.SolveFK(q)
    S = solutions(item, P)
    lo, hi, _ = item.JointLimits()
    lo, hi = lo.list(), hi.list()
    random.seed(99)
    agree = {'Linf': 0, 'L2': 0, 'L1': 0}
    total = 0
    for k in range(25):
        c = [random.uniform(lo[i], hi[i]) for i in range(6)]
        r = item.SolveIK(P, c).list()
        idx = min(range(len(S)), key=lambda t: max(abs(S[t][i] - r[i]) for i in range(6)))
        total += 1
        for metric in agree:
            def dist(s):
                d = [s[i] - c[i] for i in range(6)]
                return {'Linf': max(abs(x) for x in d), 'L2': sum(x * x for x in d), 'L1': sum(abs(x) for x in d)}[metric]
            if min(range(len(S)), key=lambda t: dist(S[t])) == idx:
                agree[metric] += 1
    out('ik_select[%s]' % name, 'agreement with argmin over SolveIK_All: %s of %d' % (agree, total))
    item.setJoints([q[0] + 3, q[1] + 3, q[2] - 3, q[3], q[4], q[5]])
    out('ik_no_approx_uses_current[%s]' % name, rnd(item.SolveIK(P).list(), 3))

out('ik_unreachable[ABB]', 'robolink Mat size=%s rows=%s' % (abb.SolveIK(robomath.transl(5000, 0, 0)).size(),
                                                           abb.SolveIK(robomath.transl(5000, 0, 0)).rows))
Pw = abb.SolveFK([10, 20, -10, 0, 0, 0])
for approx in ([10, 20, -10, 0, 0, 0], [10, 20, -10, 30, 5, -30], [10, 20, -10, -50, -3, 40]):
    out('ik_wrist_singular approx=%s' % approx, rnd(abb.SolveIK(Pw, approx).list(), 2))




def cfg_rules(M, q):
    F = M.frames(q)
    v = M.dh_variables(q)
    Ti = rp.mul(F[1], rp.eye())
    
    R = [[Ti[i][j] for j in range(3)] for i in range(3)]
    p = [F[5][i][3] - Ti[i][3] for i in range(3)]
    wc_x = sum(R[i][0] * p[i] for i in range(3))
    rear = int(wc_x < 0)
    th3 = math.degrees(M.dh[2][2]) + v[2]
    if M.mech == 6:
        lower = int(th3 < 0)
    else:
        ths = -math.degrees(math.atan2(M.dh[3][3], M.dh[3][1]))
        lower = int(th3 <= ths or th3 > 90.0)
    flip = int(math.degrees(M.dh[4][2]) + v[4] < 0)
    return [rear, lower, flip]


RDK.AddStation('KinProbe CFG')
for label in ('ABB IRB 120', 'KUKA KR6 R900', 'Fanuc LR Mate 200iD', 'Yaskawa GP8', 'Staubli TX2-60', 'UR5e'):
    path = dict(FILES)[label]
    item = RDK.AddFile(path)
    M = rp.RobotModel(rp.Header(rp.load_payload(path)[0]))
    random.seed(7)
    ok = [0, 0, 0, 0]
    n = 0
    for k in range(160):
        q = [random.uniform(M.lo_user[j], M.hi_user[j]) for j in range(6)]
        try:
            item.SolveFK(q)
        except Exception:
            continue
        c = item.JointsConfig(q).list()
        mine = cfg_rules(M, q)
        n += 1
        for i in range(3):
            ok[i] += int(int(c[i]) == mine[i])
        ok[3] += int(c[3] == 0)
    out('config_rules[%s]' % label, 'rear %d/%d lower %d/%d flip %d/%d turns==0 %d/%d' % (
        ok[0], n, ok[1], n, ok[2], n, ok[3], n))


RDK.AddStation('KinProbe LIM')
abb = RDK.AddFile(FILES[0][1])
fan = RDK.AddFile(FILES[3][1])
ur = RDK.AddFile(FILES[1][1])
for q in ([200] * 6, [-200] * 6, [0, 0, 0, 0, 0, 9999], [1, 2, 3]):
    abb.setJoints(q)
    out('setJoints_clamp[ABB] %s' % q, rnd(abb.Joints().list(), 2))
for q in ([0, 0, 0, 0, 0, 400], [0, 0, 0, 0, 0, -725]):
    ur.setJoints(q)
    out('setJoints_clamp[UR5e] %s' % q, rnd(ur.Joints().list(), 2))
for q in ([0, 0, 214, 0, 0, 0], [0, -100, -50, 0, 0, 0], [0, 100, 150, 0, 0, 0], [0, 0, -68, 0, 0, 0]):
    try:
        fan.SolveFK(q)
        fk = 'ok'
    except Exception as e:
        fk = 'ERROR %s' % str(e).strip()
    fan.setJoints(q)
    out('fanuc_j23[%s]' % q, 'SolveFK=%s setJoints->%s' % (fk, rnd(fan.Joints().list(), 2)))
out('fanuc_JointLimits', [rnd(x.list(), 1) if hasattr(x, 'list') else x for x in fan.JointLimits()])
try:
    abb.SolveFK([0, 0, 0, 0, 0, 500])
    out('SolveFK_out_of_limits', 'ok')
except Exception as e:
    out('SolveFK_out_of_limits', '%s: %s' % (type(e).__name__, str(e).strip()))


q = [10, -20, 30, -40, 50, -60]
T = robomath.transl(0, 0, 100) * robomath.rotx(0.3)
Fr = robomath.transl(200, 100, 50) * robomath.rotz(0.7)
A = abb.SolveFK(q, T, Fr)
B = Fr.inv() * abb.SolveFK(q) * T
out('SolveFK(q,tool,ref) == inv(ref)*FK(q)*tool', '%.1e' % maxerr(rows(A), rows(B)))
abb.setJoints(q)
abb.setPoseTool(T)
abb.setPoseFrame(Fr)
out('Pose() == inv(PoseFrame)*FK*PoseTool', '%.1e' % maxerr(rows(abb.Pose()), rows(B)))


import itertools  # noqa: E402
rot = {'x': robomath.rotx, 'y': robomath.roty, 'z': robomath.rotz}
a, b, c = 25.0, -40.0, 70.0
cands = {}
for axes in itertools.product('xyz', repeat=3):
    if axes[0] == axes[1] or axes[1] == axes[2]:
        continue
    for perm in itertools.permutations(range(3)):
        ang = [(a, b, c)[p] for p in perm]
        Mx = robomath.transl(1, 2, 3)
        for ax, v in zip(axes, ang):
            Mx = Mx * rot[ax](math.radians(v))
        cands['R%s(%s)*R%s(%s)*R%s(%s)' % (axes[0], 'abc'[perm[0]], axes[1], 'abc'[perm[1]], axes[2],
                                            'abc'[perm[2]])] = rows(Mx)
for fname, M in (('xyzrpw_2_pose', robomath.xyzrpw_2_pose([1, 2, 3, a, b, c])),
                 ('Pose', robomath.Pose(1, 2, 3, a, b, c)),
                 ('TxyzRxyz_2_Pose', robomath.TxyzRxyz_2_Pose([1, 2, 3] + [math.radians(x) for x in (a, b, c)])),
                 ('KUKA_2_Pose', robomath.KUKA_2_Pose([1, 2, 3, a, b, c])),
                 ('Fanuc_2_Pose', robomath.Fanuc_2_Pose([1, 2, 3, a, b, c])),
                 ('Staubli_2_Pose', robomath.Staubli_2_Pose([1, 2, 3, a, b, c])),
                 ('Adept_2_Pose', robomath.Adept_2_Pose([1, 2, 3, a, b, c])),
                 ('Comau_2_Pose', robomath.Comau_2_Pose([1, 2, 3, a, b, c]))):
    best = min(cands.items(), key=lambda kv: maxerr(kv[1], rows(M)))
    out('euler[%s(a,b,c)]' % fname, 'transl*%s err=%.0e' % (best[0], maxerr(best[1], rows(M))))


D = dict(FILES)
for label in ('Fanuc LR Mate 200iD', 'Staubli TX2-60', 'Kawasaki RS006L', 'ABB IRBP A250 (2 axes)', 'Epson LS3 SCARA'):
    RDK.AddStation('Place ' + label)
    it = RDK.AddFile(D[label])
    par = it.Parent()
    rel = par.PoseAbs().inv() * it.PoseAbs()
    out('placement[%s]' % label, 'parent=%r type=%d frame_xyz=%s robot_rel_frame_identity=%s' % (
        par.Name(), par.Type(), rnd(par.PoseAbs().Pos(), 1), maxerr(rows(rel), rows(robomath.eye(4))) < 1e-9))
RDK.AddStation('Place three robots')
p1 = RDK.AddFile(D['ABB IRB 120'])
p2 = RDK.AddFile(D['KUKA KR6 R900'])
p3 = RDK.AddFile(D['UR5e'])
out('placement[3 robots]', [rnd(x.Parent().PoseAbs().Pos(), 1) for x in (p1, p2, p3)])
RDK.AddStation('Saved joints')
for path in (os.path.join(RF, 'Gudel-FP-1-300.robot'),
             os.path.join(LIB, '02-Robot drilling x2 coordinate systems', 'Parts', 'KUKA-KR-10-R900-sixx.robot')):
    it = RDK.AddFile(path)
    H = rp.Header(rp.load_payload(path)[0])
    n = int(H.cell(1, 1))
    out('loaded_joints[%s]' % os.path.basename(path), 'Joints=%s col35=%s JointsHome=%s col34=%s' % (
        rnd(it.Joints().list(), 3), rnd(H.col(35, n), 3), rnd(it.JointsHome().list(), 3), rnd(H.col(34, n), 3)))


RDK.AddStation('Special mechanisms')
grip = RDK.AddFile(os.path.join(LIB, '06-Pick and Place', 'Parts', 'Gripper.robot'))
base = grip.PoseAbs()
for qg in (0, -10, -20):
    grip.setJoints([qg])
    xs = [round((base.inv() * grip.ObjectLink(i).PoseAbs()).Pos()[0], 2) + 0.0 for i in range(3)]
    out('gripper[q=%d]' % qg, 'link x offsets=%s TCP=%s' % (xs, rnd(grip.SolveFK([qg]).Pos(), 2)))
sc = RDK.AddFile(D['Epson LS3 SCARA'])
Ps = sc.SolveFK([30, -60, -50, 45])
sc.setJoints([0, 0, 0, 0])
out('scara_ik[tilted 0.2 rad about X]', '%s vs untilted %s' % (rnd(sc.SolveIK(Ps * robomath.rotx(0.2)).list(), 3),
                                                             rnd(sc.SolveIK(Ps).list(), 3)))
out('scara_cfg', 'J2=-60 -> %s ; J2=+60 -> %s' % (sc.JointsConfig([30, -60, -50, 45]).list(),
                                                   sc.JointsConfig([-30, 60, -50, 45]).list()))
for label in ('KUKA LBR iiwa 7', 'Franka Panda', 'Kinova Gen3'):
    it = RDK.AddFile(D[label])
    q7 = [10, 30, -20, -60, 15, 40, 30]
    P7 = it.SolveFK(q7)
    A7 = it.SolveIK_All(P7)
    res = []
    for approx in (q7, [10, 30, 25, -60, 15, 40, 30]):
        s = it.SolveIK(P7, approx).list()
        resid = maxerr(rows(it.SolveFK(s[:7])), rows(P7)) if len(s) >= 7 else None
        res.append('approx J3=%g -> J3=%.2f residual=%.2e' % (approx[2], s[2], resid))
    out('ik7[%s]' % label, 'SolveIK_All=%dx%d; %s' % (A7.size(0), A7.size(1), '; '.join(res)))
ur = RDK.AddFile(D['UR5e'])
P = ur.SolveFK([10, -80, 70, -30, 60, 20])
A = ur.SolveIK_All(P)
prim = [[A[i, j] for i in range(6)] for j in range(A.size(1)) if A[6, j] == 10]
cand = []
for s in prim:
    opts = [[s[i] + k * 360 for k in (-2, -1, 0, 1, 2) if -360 - 1e-9 <= s[i] + k * 360 <= 360 + 1e-9] for i in range(6)]
    cand += [list(c) for c in itertools.product(*opts)]
random.seed(99)
agree = ties = 0
for k in range(30):
    c = [random.uniform(-360, 360) for i in range(6)]
    r = ur.SolveIK(P, c).list()
    dmin = min(max(abs(s[i] - c[i]) for i in range(6)) for s in cand)
    dr = max(abs(r[i] - c[i]) for i in range(6))
    agree += int(abs(dr - dmin) < 1e-6)
    ties += int(sum(1 for s in cand if abs(max(abs(s[i] - c[i]) for i in range(6)) - dmin) < 1e-6) > 1)
out('ik_select_full_turns[UR5e]', 'returned solution has minimal L-inf distance in %d/30 cases (%d cases had ties)' % (
    agree, ties))
pg = RDK.AddFile(D['ABB IRB 120'])
tool_path = os.path.join(LIB, '01-Robot painting', 'Parts', 'Paint-gun.tool')
tl = RDK.AddFile(tool_path, pg)
Ht = rp.Header(rp.load_payload(tool_path)[0])
col10 = [[Ht.col(10, 16)[k * 4 + r] for k in range(4)] for r in range(4)]
out('tool_file', 'name=%r type=%d parent=%r PoseTool==header col10: %s' % (
    tl.Name(), tl.Type(), tl.Parent().Name(), maxerr(rows(tl.PoseTool()), col10) < 1e-9))
p66 = RDK.AddFile(D['ABB IRB 6640 (9 links)'])
b66 = p66.PoseAbs()
for qq in ([0, 0, 0, 0, 0, 0], [0, 30, 0, 0, 0, 0], [0, 0, 30, 0, 0, 0]):
    p66.setJoints(qq)
    ls = []
    for i in (7, 8):
        Mi = b66.inv() * p66.ObjectLink(i).PoseAbs()
        ls.append('L%d pos=%s angY=%.2f' % (i, rnd(Mi.Pos(), 1), math.degrees(math.atan2(Mi[2, 0], Mi[0, 0]))))
    out('passive_links[IRB6640 q=%s]' % qq, '; '.join(ls))


RDK.AddStation('Edge cases')
abb = RDK.AddFile(D['ABB IRB 120'])
for qx in ([1, 2, 3], [0, 0, 0, 0, 0, 0, 0], [float('nan')] * 6):
    try:
        out('SolveFK_len_nan[%s]' % qx, rnd(abb.SolveFK(qx).Pos(), 2))
    except Exception as e:  # noqa: BLE001
        out('SolveFK_len_nan[%s]' % qx, 'ERROR %s' % e)
P2 = abb.SolveFK([10, 20, -10, 40, 0.001, -40])
out('ik_near_wrist_singular[J5=0.001]', rnd(abb.SolveIK(P2, [10, 20, -10, 40, 0.001, -40]).list(), 4))
P3 = abb.SolveFK([30, 40, -50, 100, -60, 200])
abb.setJoints([30, 40, -50, 100, 1, -160])
out('ik_current_J5pos_with_flip_J4J6', rnd(abb.SolveIK(P3).list(), 2))
out('JointsConfig_no_limit_check', abb.JointsConfig([0, 0, 0, 0, 0, 9999]).list())
kk = RDK.AddFile(D['KUKA KR6 R900'])
kk.setJointLimits([-100, -150, -110, -100, -100, -300], [50, 40, 150, 180, 110, 340])
cells = [[float(kk.setParam('RobotValue', str(c * 20 + r))) for r in range(6)] for c in (30, 31, 32, 33)]
out('kuka_setJointLimits_cells[30,31,32,33]', cells)
ff = RDK.AddFile(D['Fanuc LR Mate 200iD'])
ff.setJointLimits([-170, -90, -60, -190, -125, -360], [170, 140, 200, 190, 125, 360])
cells = [[float(ff.setParam('RobotValue', str(c * 20 + r))) for r in range(6)] for c in (30, 31, 32, 33)]
out('fanuc_setJointLimits_cells[30,31,32,33]', cells)
RDK.AddStation('Place delta')
dl = RDK.AddFile(os.path.join(RF, 'ABB-IRB-360-1-800-4D.robot'))
out('placement[ABB IRB 360 delta, H0 z=-275]', rnd(dl.Parent().PoseAbs().Pos(), 1))


RDK.AddStation('Shoulder singularity')
sh = RDK.AddFile(D['ABB IRB 120'])
Ms = models['ABB IRB 120'][1]
lo2, hi2 = -60.0, -20.0
for _ in range(80):  
    mid = (lo2 + hi2) / 2
    if Ms.frames([0, lo2, 0, 0, 30, 0])[5][0][3] * Ms.frames([0, mid, 0, 0, 30, 0])[5][0][3] <= 0:
        hi2 = mid
    else:
        lo2 = mid
qs = [0, (lo2 + hi2) / 2, 0, 0, 30, 0]
Ps = sh.SolveFK(qs)
out('shoulder_singular_q', rnd(qs, 4))
for j1 in (0, 40, -60):
    out('ik_shoulder_singular approxJ1=%d' % j1, rnd(sh.SolveIK(Ps, [j1] + qs[1:]).list(), 3))
out('ik_all_shoulder_singular_count', sh.SolveIK_All(Ps).size(1))
out('done', True)
