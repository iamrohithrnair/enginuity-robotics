# Defines JAKA probes for I/O conversion, arc geometry and blend behavior.
POST = "JAKA"
NQ = 6
ROBOT = "JAKA 12L"
J = "[0,-10,20,0,30,0]"
A = "p(-640.584,506.98,371.534,150,50,-165)"
B = "p(-607.85,543.849,363.215,150,50,-165)"
ML = "r.MoveL(p(1,2,3,4,5,6),%s,[0,0,0])" % J
EXPS = [
    ("analog", "\n".join("r.setAO(%s,%s)" % (n, v) for n, v in [(0, 1), (1, 1), (2, 1), (3, 1), (4, 1), (10, 1.5), (3, "'x'"), (3, -2), (3, "'2.5'")])),
    ("digital", "\n".join("r.setDO(%s,%s)" % (n, v) for n, v in [(0, 1), (1, 2), (1, -1), (1, "'x'"), (1, True), (1, 0.5), (20, 1), (1, "'1'"), ("'V'", 1)])),
    ("inputs", "\n".join("r.waitDI(%s,%s,-1)" % (n, v) for n, v in [(0, 1), (1, 2), (1, -1), (1, "'x'"), (1, True), (1, 0.5), (1, "'0'"), ("'V'", 1)])
     + "\nr.waitDI(1,1,0)\nr.waitDI(1,1,1234.5678)"),
    ("speeds", "r.setSpeedJoints(10)\nr.setAccelerationJoints(20)\nr.setSpeed(30)\nr.setAcceleration(40)\nr.setZoneData(-2)\nr.MoveJ(None,%s,None)\n%s\n"
     "r.setZoneData(1.23456789)\nr.MoveL(p(1.23456789,2,3,4,5,6.000001),[1.23456789,-10,20,0,30,0],[0,0,0])" % (J, ML)),
    ("zones", "\n".join("r.setZoneData(%s)\n%s" % (z, ML) for z in [1, 2, 1.25, 0.5])),
    ("pauses", "\n".join("r.Pause(%s)" % v for v in [0, -1, 0.4, 1234.5678, 500])),
    ("axes7", "r.MoveJ(None,[1,2,3,4,5,6,7],None)\nr.MoveL(p(1,2,3,4,5,6),[1,2,3,4,5,6,7],[0,0,0])", None, "", None, "RRRRRRT", 7),
    ("frames", 'r.setFrame(p(1,2,3,4,5,6),3,r"""F""")\nr.setTool(p(1,2,3,4,5,6),4,r"""T""")\nr.MoveJ(p(1,2,3,4,5,6),%s,[0,0,0])' % J),
    ("subprograms", "\n".join(["r.MoveJ(None,[1,2,3,4,5,6],None)", 'r.RunCode(r"""S1""", True)', "r.ProgFinish(r'''TgtProg''')", "r.ProgStart(r'''S1''')",
                               "r.MoveJ(None,[7,8,9,10,11,12],None)", "r.setDO(1,1)", "r.ProgFinish(r'''S1''')", "r.ProgStart(r'''S2''')"])),
    ("blend_joint", "r.setZoneData(5)\nr.MoveL(%s,%s,[0,0,0])\nr.MoveJ(%s,%s,[0,0,0])\nr.MoveL(%s,%s,[0,0,0])\nr.MoveJ(None,%s,None)\nr.MoveL(%s,%s,[0,0,0])" % (A, J, B, J, A, J, J, B, J)),
    ("blend_circle", 'r.setZoneData(50)\nr.setFrame(p(1000,0,0,0,0,0),-1,r"""F""")\nr.MoveL(%s,%s,[0,0,0])\nr.MoveL(%s,%s,[0,0,0])\n'
     'r.MoveC(%s,%s,%s,%s,[0,0,0],[0,0,0])\nr.MoveL(%s,%s,[0,0,0])\nr.MoveC(%s,%s,p(-600,600,300,150,50,-165),%s,[0,0,0],[0,0,0])' % (A, J, B, J, A, J, B, J, A, J, B, J, J)),
    ("messages_calls", 'r.RunMessage(r"""m""")\nr.RunMessage(r"""c""", True)\nr.RunCode(r"""S""", True)\nr.RunCode(r"""raw""")'),
    ("joint_targets", "r.MoveL(None,%s,None)\nr.MoveC(None,%s,None,%s,None,None)" % (J, J, J)),
]
EXPS += [("lines_x_prog_%d_%d" % (n, k), "\n".join(["r.MoveJ(None,%s,None)" % J] * k), None, ", lines_x_prog=%d" % n) for n, k in [(3, 1), (3, 2), (4, 1), (100, 3)]]

EXPS += [("sw_j_%d_%d" % (n, k), "\n".join(["r.MoveJ(None,%s,None)" % J] * k), None, ", lines_x_prog=%d" % n) for n in range(1, 7) for k in range(0, 6)]
EXPS += [("sw_l_%d_%d" % (n, k), "\n".join([ML] * k), None, ", lines_x_prog=%d" % n) for n in range(2, 6) for k in range(1, 4)]



def _pt(x, y, z):
    return "p(%s,%s,%s,150,50,-165)" % (x, y, z)


def _ml(x, y, z):
    return "r.MoveL(%s,%s,[0,0,0])" % (_pt(x, y, z), J)


def _mc(a, b):
    return "r.MoveC(%s,%s,%s,%s,[0,0,0],[0,0,0])" % (_pt(*a), J, _pt(*b), J)


EXPS += [
    ("circle_far", "\n".join(["r.setZoneData(50)", _ml(0, 500, 300), _ml(300, 500, 300), _mc((300, 600, 300), (200, 700, 300))])),
    ("circle_near", "\n".join(["r.setZoneData(50)", _ml(0, 500, 300), _ml(30, 500, 300), _mc((130, 500, 350), (230, 500, 300))])),
    ("circle_small_zone", "\n".join(["r.setZoneData(5)", _ml(0, 500, 300), _ml(300, 500, 300), _mc((300, 600, 300), (200, 700, 300))])),
    ("circle_after_joint", "\n".join(["r.setZoneData(50)", "r.MoveJ(None,%s,None)" % J, _mc((300, 600, 300), (200, 700, 300))])),
    ("circle_then_line", "\n".join(["r.setZoneData(50)", _ml(0, 500, 300), _mc((100, 600, 300), (0, 700, 300)), _ml(0, 900, 300), _ml(0, 910, 300)])),
    ("circle_first", "\n".join(["r.setZoneData(50)", _mc((100, 600, 300), (0, 700, 300)), _mc((0, 800, 300), (-100, 700, 300))])),
]
EXPS += [
    ("circle_short_end", "\n".join(["r.setZoneData(50)", _ml(0, 500, 300), _mc((200, 500, 300), (200, 550, 300))])),
    ("circle_collinear", "\n".join(["r.setZoneData(50)", _ml(0, 500, 300), _mc((100, 500, 300), (200, 500, 300))])),
    ("circle_via_start", "\n".join(["r.setZoneData(50)", _ml(0, 500, 300), _mc((0, 500, 300), (200, 500, 300))])),
]
