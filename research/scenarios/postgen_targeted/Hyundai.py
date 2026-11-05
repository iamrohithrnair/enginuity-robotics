# Defines Hyundai probes for axis counts, tool IDs, I/O and named program splitting.
POST = "Hyundai"
NQ = 6
ROBOT = "Hyundai HA006B"
J = "[0,-10,20,0,30,0]"
P1 = "p(-607.85,543.849,363.215,150,50,-165)"
MJ = "r.MoveJ(None,%s,None)" % J
EXPS = [("robot_" + n.replace(" ", "_"), MJ, n) for n in ["Hyundai HH020L", "Hyundai HDR35-20", "Hyundai YS140D", "Robot X", "HA006B", "Hyundai HH020 extra"]]
EXPS += [
    ("axes7", "r.MoveJ(None,[1,2,3,4,5,6,7],None)\nr.MoveL(%s,[1,2,3,4,5,6,7],[0,0,0])" % P1, None, "", None, "RRRRRRT", 7),
    ("axes4", "r.MoveJ(None,[1,2,3,4],None)", None, "", None, "RRTR", 4),
    ("zones", "\n".join("r.setZoneData(%s)\n%s" % (z, MJ) for z in [0, -1, -0.5, 0.1, 1000, 5])),
    ("tools", "\n".join('r.setTool(p(1,2,3,4,5,6),%s,r"""T%s""")\n%s' % (i, i, MJ) for i in [-1, 0, 3, 12])),
    ("outputs", "\n".join(["r.setDO(1,%s)" % v for v in ["1", "0", "'1'", "'x'", "2", "-1", "True", "0.5", "0.4"]]
                          + ["r.setDO('V',1)", "r.setDO('V','w')", "r.setDO(123,1)"]
                          + ["r.setAO(3,%s)" % v for v in ["'2.5'", "0.75", "-1"]] + ["r.setAO('P',0.75)", "r.setAO('P','x')"])),
    ("inputs", "\n".join(["r.waitDI(2,%s)" % v for v in ["1", "0", "'1'", "2", "-1", "True"]] + ["r.waitDI('V',1)", "r.waitDI('V','x')", "r.waitDI(2,1,100)", "r.waitDI(123,1)"])),
    ("calls", "\n".join('r.RunCode(r"""%s""", True)' % c for c in ["Prog12x3", "7", "A1B2", "Prog 3a4", "abc", "P(5)", "x12(1, 2)"]) + '\nr.RunCode(r"""raw code""")'),
    ("messages", "\n".join(['r.RunMessage(r"""%s""")' % m for m in ['say "hi" there', "x" * 120]] + ['r.RunMessage(r"""%s""", True)' % m for m in ['c "q" z', "y" * 120]])),
    ("pauses", "\n".join("r.Pause(%s)" % v for v in [0, -1, 0.4, 1, 1234.5])),
    ("speeds", "\n".join(["r.setSpeedJoints(30)", MJ, "r.setSpeed(77.777)", "r.setAcceleration(100)", "r.setAccelerationJoints(10)", MJ, "r.MoveL(%s,%s,[0,0,0])" % (P1, J)])),
    ("subprogram", "\n".join([MJ, 'r.RunCode(r"""S1""", True)', "r.ProgFinish(r'''TgtProg''')", "r.ProgStart(r'''S1''')", MJ])),
]
EXPS += [("program_%s" % n.replace(" ", "_"), MJ, None, "", None, None, None, n) for n in ["Prog12", "7", "A1B2", "Prog 3a4", "999", "0"]]
EXPS += [("split_%d" % k, "\n".join([MJ] * k), None, ", lines_x_prog=3") for k in [1, 2, 3, 4, 7]]
EXPS += [("split_named", "\n".join([MJ] * 4), None, ", lines_x_prog=3", None, None, None, "Prog12")]
