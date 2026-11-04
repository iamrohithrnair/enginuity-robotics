













import json
import math
import os
import random
import sys
import time

PORT = int(sys.argv[1])
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, os.pardir, "python", "enginuity", "src"))  
LIB = sys.argv[3]
OUT = sys.argv[4]

from enginuity import robolink, robomath  # noqa: E402

ROBOTS = os.path.join(LIB, 'library-robots')
TOOLS = os.path.join(LIB, 'library-tools')

SERIAL = [
    
    'ABB-IRB-910SC-3-0-65', 'Epson-LS3-401S', 'Mitsubishi-RH-3CH', 'Yamaha-YK700XGP-200',
    'Brooks-PreciseFlex-c3x-400', 'Brooks-PreciseFlex-400-400', 'Brooks-PreciseFlex-c10-500',
    
    'ABB-CRB-15000-10-152', 'Fanuc-M-710iC-50E', 'Kinova-Link-6', 'Techman-TM30SC', 'Comau-Aura-170-2-8',
    'Yaskawa-Motoman-MA1400', 'Elite-Robots-CS530H', 'Techman-TM14', 'AUBO-ES3', 'DUCO-GCR20-1100',
    
    'KUKA-LBR-iiwa-7-R800', 'Kinova-Gen3', 'Yaskawa-Motoman-SIA20D', 'ABB-YuMi-IRB-14050', 'Daihen-OTC-FD-V6Ls',
    'Franka-Emika-Panda', 'Kassow-Robots-KR0810', 'Productive-Robotics-OB7', 'Agile-Robots-Diana-7',
    'Neura-MAiRA-M', 'RealMan-GEN72-B', 'Yaskawa-Motoman-VS50',
    'uFactory-xArm7', 'Kassow-Robots-KR1240', 'Neuromeka-INDY7-RP2', 'Flexiv-Rizon-4',
    
    'AUCTECH-AN-12-16-0-95-3', 'Chiehey-SR5-1600', 'Efort-GR680', 'Doosan-Robotics-P3020', 'JAKA-Zu20',
    
    'Fanuc-LR-Mate-200iC-5H', 'Staubli-RX170HSM',
]
PASSIVE = [
    'ABB-IRB-6640-185-2-8', 'Nachi-MC500P', 'Comau-Smart5-NJ-110-3-0', 'KUKA-KR-800-R3200-2-PA',
    'Comau-Smart5-NJ4-175-2-2', 'ABB-IRB-580-12S', 'KUKA-KR-300-R2700-2', 'ABB-IRB-1410-4-1-45',
    'Fanuc-R-2000iC-210F', 'Fanuc-M-2000iA-900L',
    
    'ABB-IRB-460', 'ABB-IRB-260', 'KUKA-KR-120-R3200-PA', 'Yaskawa-Motoman-EPL160', 'Fanuc-M-410iB-300',
]
DELTA = [
    'ABB-IRB-360-1-1130-4D', 'ABB-IRB-360-3-1130-3D', 'Codian-D4-800-S020', 'Fanuc-M-1iA-0-5S',
    'autonox-Robotics-DELTA-RL3-600-3kg-AL-00001', 'Codian-D5-1100', 'Codian-D2-1000',
]
TOOLMECH = [
    'SCHUNK-PGN-plus-E-80-Gripper', 'OnRobot-2FG7-Gripper', 'Kinova-Gen3-Lite-Gripper', 'SCHUNK-Co-act-Gripper',
    'RobotiQ-2F-85-Gripper-Mechanism', 'Comau-e-DO-Gripper-CR82442100',
    'FerRobotics-ACF-K-5681900-L-Sander', 'ARO-Spot-Welding-Gun',
]

random.seed(20261020)
RDK = robolink.Robolink(port=PORT, args=[], quit_on_close=False)
out = {'robodk_version': RDK.Version(), 'robots': [], 'tools': []}


def m2l(M):
    return [M[i, j] for i in range(4) for j in range(4)]


def jl(v):
    return [float(x) for x in (v.list() if hasattr(v, 'list') else v)]


def links_of(item, nlinks, ref_inv):
    res = []
    for i in range(nlinks):
        try:
            lk = item.ObjectLink(i)
            res.append(m2l(ref_inv * lk.PoseAbs()) if lk.Valid() else None)
        except Exception as e:  # noqa: BLE001
            res.append(str(e))
    return res


def header_nlinks(path):
    import struct
    import zlib
    data = open(path, 'rb').read()
    try:
        raw = zlib.decompress(data[4:])
    except zlib.error:
        raw = data
    v = struct.unpack_from('<4000d', raw, 0)
    return int(round(v[1 * 20 + 2])), int(round(v[1 * 20 + 0]))


def random_q(lo, hi, shrink=0.85):
    return [0.5 * (a + b) + shrink * (random.random() - 0.5) * (b - a) for a, b in zip(lo, hi)]


def solve_ik(item, pose, seed=None):
    try:
        s = item.SolveIK(pose, seed) if seed is not None else item.SolveIK(pose)
        return jl(s)
    except Exception as e:  # noqa: BLE001
        return str(e)


def ik_all(item, pose):
    try:
        M = item.SolveIK_All(pose)
        rows, cols = M.size(0), M.size(1)
        return [[M[r, c] for r in range(rows)] for c in range(cols)]
    except Exception as e:  # noqa: BLE001
        return str(e)


def probe_robot(fname, group, k_random=8, grid=False, tilt=False, ik=True):
    path = os.path.join(ROBOTS, fname + '.robot')
    rec = {'file': fname + '.robot', 'group': group}
    t0 = time.time()
    try:
        nlinks, mech = header_nlinks(path)
        rec['nlinks'] = nlinks
        rec['mech'] = mech
        r = RDK.AddFile(path)
        rec['name'] = r.Name()
        rec['type'] = r.Type()
        ref = r.PoseAbs()
        ref_inv = robomath.invH(ref)
        lo, hi, jtype = r.JointLimits()
        lo, hi = jl(lo), jl(hi)
        rec['limits'] = [lo, hi, float(jtype)]
        rec['home'] = jl(r.JointsHome())
        rec['loaded_joints'] = jl(r.Joints())
        qs = [random_q(lo, hi) for _ in range(k_random)]
        if grid:
            mid = [0.5 * (a + b) for a, b in zip(lo, hi)]
            for j2 in (-0.35, 0.0, 0.35):
                for j3 in (-0.3, 0.0, 0.3):
                    q = list(mid)
                    q[1] = mid[1] + j2 * (hi[1] - lo[1])
                    q[2] = mid[2] + j3 * (hi[2] - lo[2])
                    qs.append(q)
        samples = []
        for q in qs:
            s = {'q_set': q}
            try:
                r.setJoints(q)
                qa = jl(r.Joints())
                s['q'] = qa
                s['fk'] = m2l(r.SolveFK(qa))
                s['links'] = links_of(r, nlinks, ref_inv)
                s['cfg'] = jl(r.JointsConfig(qa))
            except Exception as e:  # noqa: BLE001
                s['error'] = str(e)
            samples.append(s)
        rec['samples'] = samples
        if ik:
            iks = []
            for s in samples[:4]:
                if 'fk' not in s:
                    continue
                pose = robomath.Mat([s['fk'][i * 4:i * 4 + 4] for i in range(4)])
                q = s['q']
                entry = {'q': q}
                seeds = [q, [x + 7.0 for x in q], random_q(lo, hi)]
                if len(q) == 7:
                    seeds.append([x if i != 2 else x + 25.0 for i, x in enumerate(q)])
                entry['seeds'] = seeds
                entry['ik'] = [solve_ik(r, pose, sd) for sd in seeds]
                cur = random_q(lo, hi)
                try:
                    r.setJoints(cur)
                    entry['current'] = jl(r.Joints())
                    entry['ik_current'] = solve_ik(r, pose)
                except Exception as e:  # noqa: BLE001
                    entry['ik_current'] = str(e)
                entry['ik_all'] = ik_all(r, pose)
                if tilt:
                    entry['tilt'] = {}
                    for label, T in (('rx0.2', robomath.rotx(0.2)), ('ry0.2', robomath.roty(0.2)), ('rz0.3', robomath.rotz(0.3)),
                                     ('rx0.2ry0.3', robomath.rotx(0.2) * robomath.roty(0.3))):
                        entry['tilt'][label] = solve_ik(r, pose * T, q)
                iks.append(entry)
            rec['ik'] = iks
        r.Delete()
        try:
            for it in RDK.ItemList(robolink.ITEM_TYPE_FRAME):
                if it.Name().endswith(' Base'):
                    it.Delete()
        except Exception:  # noqa: BLE001
            pass
    except Exception as e:  # noqa: BLE001
        rec['error'] = str(e)
    rec['seconds'] = round(time.time() - t0, 2)
    out['robots'].append(rec)
    print('%-48s %-8s links=%s samples=%d %ss %s' % (fname, group, rec.get('nlinks'), len(rec.get('samples', [])), rec['seconds'], rec.get('error', '')), flush=True)


def probe_tool(fname):
    path = os.path.join(TOOLS, fname + '.robot')
    rec = {'file': fname + '.robot', 'group': 'toolmech'}
    try:
        nlinks, mech = header_nlinks(path)
        rec['nlinks'] = nlinks
        rec['mech'] = mech
        ur = RDK.AddFile(os.path.join(ROBOTS, 'UR5e.robot'))
        ur.setJoints([0, -90, -90, 0, 90, 0])
        tools_before = [t.Name() for t in RDK.ItemList(robolink.ITEM_TYPE_TOOL)]
        g = RDK.AddFile(path)
        rec['added'] = {'name': g.Name(), 'type': g.Type(), 'parent': g.Parent().Name(), 'parent_type': g.Parent().Type()}
        rec['children'] = [[c.Name(), c.Type()] for c in g.Childs()]
        rec['tools_after'] = [[t.Name(), t.Parent().Name()] for t in RDK.ItemList(robolink.ITEM_TYPE_TOOL) if t.Name() not in tools_before]
        rec['ur_active_tool'] = ur.getLink(robolink.ITEM_TYPE_TOOL).Name() if ur.getLink(robolink.ITEM_TYPE_TOOL).Valid() else None
        flange = ur.PoseAbs() * ur.SolveFK(ur.Joints())
        rec['mount_rel_flange'] = m2l(robomath.invH(flange) * g.PoseAbs())
        if g.Type() == robolink.ITEM_TYPE_ROBOT:
            lo, hi, jtype = g.JointLimits()
            lo, hi = jl(lo), jl(hi)
            rec['limits'] = [lo, hi, float(jtype)]
            rec['home'] = jl(g.JointsHome())
            ref_inv = robomath.invH(g.PoseAbs())
            samples = []
            for f in (0.0, 0.25, 0.5, 0.75, 1.0):
                q = [a + f * (b - a) for a, b in zip(lo, hi)]
                g.setJoints(q)
                samples.append({'q': jl(g.Joints()), 'fk': m2l(g.SolveFK(jl(g.Joints()))), 'links': links_of(g, nlinks, ref_inv),
                                'tcp_abs': m2l(robomath.invH(flange) * g.PoseAbs() * g.SolveFK(jl(g.Joints())))})
            rec['samples'] = samples
            try:
                rec['pose_tool'] = m2l(g.PoseTool())
            except Exception as e:  # noqa: BLE001
                rec['pose_tool'] = str(e)
        for it in RDK.ItemList():
            if it.Type() in (robolink.ITEM_TYPE_ROBOT, robolink.ITEM_TYPE_TOOL, robolink.ITEM_TYPE_FRAME):
                try:
                    it.Delete()
                except Exception:  # noqa: BLE001
                    pass
    except Exception as e:  # noqa: BLE001
        rec['error'] = str(e)
    out['tools'].append(rec)
    print('%-48s toolmech added=%s %s' % (fname, rec.get('added'), rec.get('error', '')), flush=True)


RDK.AddStation('WPG kinematics')
for f in SERIAL:
    probe_robot(f, 'serial', tilt=True)
for f in PASSIVE:
    probe_robot(f, 'passive', k_random=6, grid=True)
for f in DELTA:
    probe_robot(f, 'delta', k_random=12, tilt=True)
for f in TOOLMECH:
    probe_tool(f)
json.dump(out, open(OUT, 'w'))
print('wrote', OUT, flush=True)
