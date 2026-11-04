












import json
import math
import os
import sys
import time

PORT = int(sys.argv[1])
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, os.pardir, "python", "enginuity", "src"))  
LIB = sys.argv[3]
PROBE1 = json.load(open(sys.argv[4]))
OUT = sys.argv[5]

from enginuity import robolink, robomath  # noqa: E402

RDK = robolink.Robolink(port=PORT, args=[], quit_on_close=False)
ROBOTS = os.path.join(LIB, 'library-robots')
PICK = ['ABB-IRB-910SC-3-0-65.robot', 'Mitsubishi-RH-3CH.robot', 'Brooks-PreciseFlex-c3x-400.robot', 'Epson-LS3-401S.robot']
SCARA = [r for f in PICK for r in PROBE1['robots'] if r['file'] == f]
POSITIONERS = ['ABB-IRBP-A250-D1000', 'KUKA-DKP-400']
T0 = time.time()


def log(*a):
    print('%7.1f' % (time.time() - T0), *a, flush=True)


def m2l(M):
    return [M[i, j] for i in range(4) for j in range(4)]


def jl(v):
    return [float(x) for x in (v.list() if hasattr(v, 'list') else v)]


def rot_about(axis, deg):
    x, y, z = axis
    n = math.sqrt(x * x + y * y + z * z)
    x, y, z = x / n, y / n, z / n
    a = math.radians(deg)
    c, s, t = math.cos(a), math.sin(a), 1 - math.cos(a)
    return robomath.Mat([
        [t * x * x + c, t * x * y - s * z, t * x * z + s * y, 0],
        [t * x * y + s * z, t * y * y + c, t * y * z - s * x, 0],
        [t * x * z - s * y, t * y * z + s * x, t * z * z + c, 0],
        [0, 0, 0, 1],
    ])


def solve(robot, pose, seed, n):
    j = jl(robot.SolveIK(pose, seed))
    return j if len(j) >= n else None


def save(out):
    json.dump(out, open(OUT, 'w'), indent=1)


RDK.Render(False)
RDK.AddStation('wpg-scara')
out = {'robodk_version': RDK.Version(), 'scara': [], 'positioners': []}
log('start', out['robodk_version'])
for rec in SCARA:
    robot = RDK.AddFile(os.path.join(ROBOTS, rec['file']))
    n = len(robot.Joints().list())
    entry = {'file': rec['file'], 'poses': []}
    e = rec['ik'][0]
    q = e['q']
    pose = robot.SolveFK(q)
    p = {'q': q, 'fk': m2l(pose), 'tilt': {}}
    t1 = time.time(); ok1 = solve(robot, pose, q, n); t2 = time.time()
    bad1 = solve(robot, pose * rot_about((1, 1, 0), 40), q, n); t3 = time.time()
    p['timing'] = {'ok_s': t2 - t1, 'ok': ok1, 'bad_s': t3 - t2, 'bad': bad1}
    log(rec['file'], 'timing', p['timing'])
    for k in range(8):
        ang = 45 * k
        axis = (math.cos(math.radians(ang)), math.sin(math.radians(ang)), 0)
        ok, bad = 0.0, 40.0
        if solve(robot, pose * rot_about(axis, bad), q, n) is not None:
            ok = bad
        else:
            for _ in range(8):
                mid = 0.5 * (ok + bad)
                if solve(robot, pose * rot_about(axis, mid), q, n) is not None:
                    ok = mid
                else:
                    bad = mid
        below = solve(robot, pose * rot_about(axis, max(ok - 0.5, 0)), q, n)
        p['tilt'][str(ang)] = {'max_ok': ok, 'first_bad': bad, 'below': below, 'below_deg': max(ok - 0.5, 0)}
    log(rec['file'], 'tilt', {k: round(v['max_ok'], 2) for k, v in p['tilt'].items()})
    p['zero_elbow'] = {'zeros': solve(robot, pose, [0.0] * n, n), 'home': solve(robot, pose, jl(robot.JointsHome()), n)}
    robot.setJoints(e['current'])
    M = robot.SolveIK_All(pose)
    p['ik_all'] = {'current': jl(robot.Joints()), 'rows': [[M[r, c] for r in range(M.size(0))] for c in range(M.size(1))]}
    entry['poses'].append(p)
    out['scara'].append(entry)
    save(out)
    robot.Delete()

for name in POSITIONERS:
    path = os.path.join(ROBOTS, name + '.robot')
    if not os.path.exists(path):
        continue
    robot = RDK.AddFile(path)
    lo, hi, _ = robot.JointLimits()
    lo, hi = jl(lo), jl(hi)
    samples = []
    for k in range(9):
        q = [lo[i] + (hi[i] - lo[i]) * ((k * (i + 3)) % 9) / 8.0 for i in range(len(lo))]
        robot.setJoints(q)
        samples.append({'q': jl(robot.Joints()), 'cfg': jl(robot.JointsConfig(robot.Joints()))})
    out['positioners'].append({'file': name + '.robot', 'limits': [lo, hi], 'samples': samples})
    save(out)
    robot.Delete()
    log(name, 'done')

save(out)
log('ok', len(out['scara']), len(out['positioners']))
RDK.CloseRoboDK()
