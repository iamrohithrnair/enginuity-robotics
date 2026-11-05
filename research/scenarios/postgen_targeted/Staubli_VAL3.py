# Defines Staubli VAL3 probes for split arcs, robot configurations and tool rotations.
POST = "Staubli_VAL3"
NQ = 6
ROBOT = "Staubli RX130B"
P1 = "p(-607.85,543.849,363.215,150,50,-165)"
J = "[0,-10,20,0,30,0]"
MC = "r.MoveC(%s,%s,%s,%s,[0,0,0],[0,0,0])" % (P1, J, P1, J)


def MJ(i):
    return "r.MoveJ(None,[%d,-10,20,0,30,0],None)" % i


EXPS = []
for n, ks in [(3, [1, 2, 3, 5, 6, 7, 11]), (4, [2, 3, 4, 8, 9])]:
    for k in ks:
        EXPS.append(("split_%d_%d" % (n, k), "\n".join(MJ(i) for i in range(k)), None, ", lines_x_prog=%d" % n))
X = {"pause": "r.Pause(100)", "pause_neg": "r.Pause(-1)", "message": 'r.RunMessage(r"""m""")', "comment": 'r.RunMessage(r"""c""",True)',
     "call": 'r.RunCode(r"""S1""",True)', "code": 'r.RunCode(r"""x=1""")', "output": "r.setDO(1,1)", "analog": "r.setAO(1,1)", "wait": "r.waitDI(1,1)",
     "wait_timeout": "r.waitDI(1,1,10)", "speed": "r.setSpeed(10)", "zone": "r.setZoneData(1)", "frame": 'r.setFrame(p(1,2,3,0,0,0),-1,r"""F""")',
     "tool": 'r.setTool(p(1,2,3,0,0,0),-1,r"""T""")', "movel": "r.MoveL(%s,%s,[0,0,0])" % (P1, J), "movel_config": "r.MoveL(%s,%s,[1,1,1])" % (P1, J),
     "movec": MC, "movel_joints": "r.MoveL(None,%s,None)" % J, "speed_joints": "r.setSpeedJoints(10)"}
for k, v in X.items():
    EXPS.append(("count_" + k, "\n".join([MJ(0), v] + [MJ(i) for i in range(1, 6)]), None, ", lines_x_prog=3"))
EXPS += [
    ("split_circular", "\n".join([MJ(0), MC] + [MJ(i) for i in range(1, 8)]), None, ", lines_x_prog=3"),
    ("no_frame_no_tool", "%s\nr.MoveL(%s,%s,[0,0,0])" % (MJ(0), P1, J)),
    ("io", "\n".join(["r.setDO(1,%s)" % v for v in ["2", "-1", "0.5", "'x'", "True"]] + ["r.setAO(2,%s)" % v for v in ["0", "'y'", "1.5"]]
                     + ["r.waitDI(1,%s)" % v for v in ["2", "-1", "'x'"]] + ["r.waitDI(1,1,0)", "r.waitDI('V',1,1234.56)", "r.setDO('V',0)"])),
    ("calls", "\n".join('r.RunCode(r"""%s""", True)' % c for c in ["My Prog", "a b(c, d)", "x.y"]) + '\nr.RunCode(r"""raw code""")\nr.RunMessage(r"""m "q" """)'),
    ("pauses", "\n".join("r.Pause(%s)" % v for v in [0, -1, 0.4, 1234.5678])),
    ("configs", "\n".join("r.MoveL(%s,%s,%s)" % (P1, J, c) for c in ["[1,0,0]", "[1,1,0]", "[1,1,1]", "[0,0,0]", "[0,0,1]", "None"])
     + "\n" + "r.MoveC(%s,%s,%s,%s,[1,1,1],[1,0,1])" % (P1, J, P1, J)),
    ("configs_scara", "\n".join("r.MoveL(%s,[1,2,3,4],%s)" % (P1, c) for c in ["[1,0,0]", "[1,1,1]", "[0,1,1]"]), None, "", None, "RRTR", 4),
    ("subprograms", "\n".join([MJ(0), 'r.RunCode(r"""S1""", True)', "r.ProgFinish(r'''TgtProg''')", "r.ProgStart(r'''S1''')", "r.MoveL(%s,%s,[0,0,0])" % (P1, J),
                               'r.setTool(p(0,0,100,0,90,0),-1,r"""T2""")', "r.ProgFinish(r'''S1''')", "r.ProgStart(r'''S2''')", MJ(1)])),
    ("tool_angles", 'r.setTool(p(1,2,3,0,90,0),-1,r"""T""")\nr.setFrame(p(1,2,3,0,-90,45),-1,r"""F""")\n%s' % MJ(0)),
    ("axes7", "r.MoveJ(None,[1,2,3,4,5,6,7],None)\nr.MoveL(%s,[1,2,3,4,5,6,7],[0,0,0])" % P1, None, "", None, "RRRRRRT", 7),
    ("axes5", "r.MoveJ(None,[1,2,3,4,5],None)\nr.MoveL(%s,[1,2,3,4,5],[0,0,0])" % P1, None, "", None, "RRRRR", 5),
]
