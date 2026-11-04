
import math

POST = "Universal_Robots"
NQ = 6
ROBOT = "UR10"
J = "[0,-10,20,0,30,0]"
JN = "r.MoveJ(None,[10,-10,20,0,30,0],None)"


def P(x, y, z, a=150, b=50, c=-165):
    return "p(%r,%r,%r,%r,%r,%r)" % (x, y, z, a, b, c)


def L(x, y, z):
    return "r.MoveL(%s,%s,[0,0,0])" % (P(x, y, z), J)


def MC(v, e):
    return "r.MoveC(%s,%s,%s,%s,[0,0,0],[0,0,0])" % (P(*v), J, P(*e), J)


X0, Y0, Z0 = -640.0, 500.0, 370.0
A, B, C = L(X0, Y0, Z0), L(X0 + 100, Y0, Z0), L(X0 + 100, Y0 + 100, Z0)
V, E = (X0 + 150, Y0 + 50, Z0), (X0 + 100, Y0 + 100, Z0)
TRACE = {
    "speedJ": "r.setSpeedJoints(10)",
    "zone": "r.setZoneData(1)",
    "speed": "r.setSpeed(100)",
    "speedsame": "r.setSpeed(250)",
    "pause": "r.Pause(100)",
    "comment": 'r.RunMessage(r"""x""",True)',
    "message": 'r.RunMessage(r"""x""")',
    "call": 'r.RunCode(r"""X""", True)',
    "code": 'r.RunCode(r"""x=1""")',
    "do": "r.setDO(1,1)",
    "ao": "r.setAO(1,1)",
    "wait": "r.waitDI(1,1)",
    "tool": 'r.setTool(p(10,20,150,0,0,15),-1,r"""T""")',
    "frame": 'r.setFrame(p(1234.57,-98.7654,50.5,30,0,0),-1,r"""F""")',
    "accel": "r.setAcceleration(100)",
    "accelJ": "r.setAccelerationJoints(100)",
}
EXPS = [("trace_" + k, "\n".join([A, B, v, C])) for k, v in TRACE.items()]
EXPS += [
    ("trace_pausecommit", "\n".join([A, B, "r.Pause(100)", "r.setDO(1,1)", C])),
    ("trace_double", "\n".join([A, B, "r.setDO(1,1)", "r.setDO(2,1)", C])),
    ("trace_last", "\n".join([A, B, "r.setDO(1,1)"])),
    ("trace_movec", "\n".join([A, B, MC(V, E), "r.setDO(1,1)"])),
    ("trace_other_robot", "\n".join([A, B, "r.setSpeed(100)", C]), "UR10e"),
]
for th in [90, 160, 164.999999, 165.000001, 170, 180]:
    t = math.radians(th)
    EXPS.append(("angle_%s" % th, "\n".join([A, B, L(X0 + 100 + 100 * math.cos(t), Y0 + 100 * math.sin(t), Z0)])))
for name in ["UR3", "UR5", "UR10e", "UR16e", "UR20", "UR3e", "UR8 Long", "Robot X"]:
    EXPS.append(("robot_" + name.replace(" ", "_"), "\n".join([A, B, A]), name))
EXPS += [
    ("native_name", "\n".join([A, B, A]), "Robot X", "", "UR10"),
    ("robot_name_only", "\n".join([A, B, A]), "UR10", "", "Robot X"),
    ("blend_distance", "\n".join(["r.setZoneData(50)", A, L(X0 + 5, Y0, Z0), L(X0 + 5, Y0 + 5, Z0)])),
    ("zero_length", "\n".join([A, B, B, C])),
    ("joint_targets", "\n".join([A, B, JN, C, L(X0, Y0 + 100, Z0), A])),
    ("joint_targets_other", "\n".join([A, B, JN, C, L(X0, Y0 + 100, Z0)]), "UR10e"),
    ("joint_target_first", "\n".join([JN, A, B, A])),
    ("movel_joint_target", "\n".join([A, "r.MoveL(None,[10,-10,20,0,30,0],None)", B, C])),
    ("skip_zone0", "\n".join(["r.setZoneData(0)", A, B, A])),
    ("skip_zoneneg", "\n".join(["r.setZoneData(-1)", A, B, A])),
    ("movej_pose", "\n".join(["r.MoveJ(%s,%s,[0,0,0])" % (P(X0, Y0, Z0), J), B, "r.MoveJ(%s,%s,[0,0,0])" % (P(X0, Y0, Z0), J)])),
    ("frame_offset", "\n".join([A, B, 'r.setFrame(p(10,20,30,0,0,0),-1,r"""F""")', A])),
    ("frame_shift", "\n".join([A, B, 'r.setFrame(p(-100,0,0,0,0,0),-1,r"""F""")', B])),
    ("frame_same", "\n".join([A, B, 'r.setFrame(p(0,0,0,0,0,0),-1,r"""F""")', A])),
    ("tool_ignored", "\n".join([A, B, 'r.setTool(p(0,0,200,0,0,0),-1,r"""T""")', L(X0, Y0, Z0 + 10)])),
    ("movec_after", "\n".join([A, B, MC(V, E), L(E[0] + 100, E[1], Z0), L(*E)])),
    ("movec_no_check", "\n".join([A, B, MC((X0 + 200, Y0, Z0), (X0 + 200, Y0 + 100, Z0)), B])),
    ("movec_first", "\n".join([MC(V, E), L(E[0] + 100, E[1], Z0), L(*E)])),
    ("movec_first_other", "\n".join([MC(V, E), L(E[0] + 100, E[1], Z0), L(*E)]), "UR10e"),
    ("movec_after_joint", "\n".join([A, JN, MC(V, E), L(E[0] + 100, E[1], Z0)])),
    ("movec_joint_target", "\n".join([A, B, "r.MoveC(None,%s,None,%s,[0,0,0],[0,0,0])" % (J, J), A])),
    ("subprograms", "\n".join([A, 'r.RunCode(r"""S1""", True)', B, "r.ProgFinish(r'''TgtProg''')", "r.ProgStart(r'''S1''')", A, B,
                               "r.ProgFinish(r'''S1''')", "r.ProgStart(r'''S2''')", A, "r.setDO(1,1)", "r.ProgFinish(r'''S2''')",
                               "r.ProgStart(r'''S3''')", "r.ProgFinish(r'''S3''')"])),
    ("speeds", "\n".join(["r.setSpeedJoints(43)", "r.setSpeedJoints(43)", "r.setSpeed(100)", "r.setSpeed(100)", "r.setAcceleration(500)",
                          "r.setAcceleration(500)", "r.setAccelerationJoints(50)", "r.setAccelerationJoints(50)", "r.setZoneData(3)", "r.setZoneData(3)", A])),
    ("speed_caps", "\n".join(["r.setSpeed(100000)", "r.setSpeedJoints(100000)", "r.setAcceleration(100000)", "r.setAccelerationJoints(100000)",
                              "r.setZoneData(100000)", A, "r.setSpeed(-5)", "r.setSpeedJoints(-5)", "r.setAcceleration(-5)",
                              "r.setAccelerationJoints(-5)", "r.setZoneData(-5)", B])),
    ("speed_changes", "\n".join(["r.setSpeed(250.0006)", "r.setSpeed(250.001)", "r.setSpeed(250.4)", "r.setSpeed(250.6)", "r.setSpeed(251)", A,
                                 "r.setSpeedJoints(180.5)", "r.setAccelerationJoints(2291.8)", "r.setAccelerationJoints(2300)",
                                 "r.setAcceleration(15001)", "r.setSpeed(3000)", "r.setSpeed(3001)"])),
    ("digital_outputs", "\n".join(["r.setDO(%s,1)" % k for k in [0, 7, 9, 10, 12, 19, 20, 100, -1]]
                                  + ["r.setDO(1,%s)" % v for v in ["'1'", "1.5", "0", "True", "'x'", "-1", "2", "'True'", "'true'", "'TRUE'", "'tRuE'", "'false'", "'on'", "0.0"]]
                                  + ["r.setDO('A','B')", "r.setDO('A',1)", "r.setDO('1',1)"])),
    ("analog_outputs", "\n".join(["r.setAO(%s,0.5)" % k for k in [0, 4, 10, 12, 20]] + ["r.setAO(1,'x')", "r.setAO('V',1)", "r.setAO('V','w')"])),
    ("digital_inputs", "\n".join(["r.waitDI(%s,1)" % k for k in [0, 7, 10, 12, 16, 20, -1]]
                                 + ["r.waitDI(1,0)", "r.waitDI(1,'x')", "r.waitDI('V',0)", "r.waitDI('V','on')", "r.waitDI(1,1,100)",
                                    "r.waitDI('3',1)", "r.waitDI(1,True)", "r.waitDI(1,2)", "r.waitDI(1,-1)", "r.waitDI(1,0.5)"])),
    ("calls", "\n".join(['r.RunCode(r"""%s""", True)' % c for c in ["My Prog", "a b(c d)", "x(1)", "Name-With.Dots", "Prog 2 ()"]]
                        + ['r.RunCode(r"""%s""")' % c for c in ["raw code", "a b(c d)"]])),
    ("messages", "\n".join(['r.RunMessage(r"""%s""")' % c for c in ["short", 'q"uote', "x" * 200, "a 'b' <c> & d"]]
                           + ['r.RunMessage(r"""%s""", True)' % c for c in ["c1", "x" * 200]])),
    ("pauses", "\n".join(["r.Pause(%s)" % v for v in [0, -1, 0.4, 0.5, 1, 1234.5, 100000]])),
]
