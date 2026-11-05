# Defines Nachi AX/FD probes for smoothing, tool changes, circular moves and splitting.
POST = "Nachi_AX_FD"
NQ = 6
ROBOT = "Nachi MC10L-01"
P1 = "p(-607.85,543.849,363.215,150,50,-165)"
J = "[0,-10,20,0,30,0]"
ML = "r.MoveL(%s,%s,[0,0,0])" % (P1, J)
MC = "r.MoveC(%s,%s,%s,%s,[0,0,0],[0,0,0])" % (P1, J, P1, J)
EXPS = [("smooth", "\n".join("r.setZoneData(%s)\n%s\nr.MoveJ(None,%s,None)\nr.MoveL(None,%s,None)\n%s" % (z, ML, J, J, MC) for z in [20, 24.9, 25, 49.9, 50, 74.9, 75, 100, -1, 0, -0.5]))]
EXPS += [("robot_" + n.replace(" ", "_"), ML, n) for n in ["Robot X", "NachiOnly", "Nachi MZ07 extra", "Nachi SRA166-01"]]
EXPS += [("program_%s" % n, ML, None, "", None, None, None, n) for n in ["Prog12", "7", "A1B2"]]
EXPS += [
    ("tools", "\n".join('r.setTool(p(1,2,3,4,5,6),%s,r"""T%s""")\n%s' % (i, i, ML) for i in [-1, 0, 3])),
    ("io", "\n".join(["r.setDO(1,%s)" % v for v in ["'x'", "-1", "2", "0.5", "True", "0.0", "1", "0"]] + ["r.setAO(2,%s)" % v for v in ["0", "1", "'x'", "0.5"]]
                     + ["r.waitDI(3,%s)" % v for v in ["2", "-1", "True", "0.5", "'x'", "1", "0"]] + ["r.waitDI('V',0,10)", "r.setDO(123,1)", "r.waitDI(123,1)", "r.setDO('V',0)"])),
    ("speed_tool", "r.setSpeed(123.456)\nr.setTool(p(1,2,3,0,0,0),-1,r\"\"\"T\"\"\")\nr.setSpeedJoints(10)\nr.setAcceleration(10)\nr.setAccelerationJoints(10)\n%s\nr.MoveJ(None,%s,None)" % (ML, J)),
    ("pauses", "\n".join("r.Pause(%s)" % v for v in [0, -1, 0.4, 1234.5])),
    ("circular_frames", 'r.setFrame(p(100,0,0,0,0,90),-1,r"""F""")\n%s\n%s\nr.setFrame(p(1,2,3,4,5,6),-1,r"""F2""")\n%s\n%s' % (MC, ML, MC, ML)),
    ("joint_circular", "r.MoveC(None,%s,None,[1,2,3,4,5,6],[0,0,0],[0,0,0])\nr.setZoneData(30)\nr.MoveC(None,%s,None,%s,[0,0,0],[0,0,0])" % (J, J, J)),
    ("axes7", "r.MoveJ(None,[1,2,3,4,5,6,7],None)\n%s\n%s" % (ML.replace(J, "[1,2,3,4,5,6,7]"), MC.replace(J, "[1,2,3,4,5,6,-7.555]")), None, "", None, "RRRRRRT", 7),
    ("calls", "\n".join('r.RunCode(r"""%s""", True)' % c for c in ["Prog12x3", "Do Something(1, 2)", "abc"]) + '\nr.RunCode(r"""raw""")\nr.RunMessage(r"""m "q" """)\nr.RunMessage(r"""c""", True)'),
]
EXPS += [("split_%d" % k, "\n".join(["r.MoveJ(None,%s,None)" % J] * k), None, ", lines_x_prog=3") for k in [1, 2, 4]]
EXPS += [("split_named", "\n".join(["r.MoveJ(None,%s,None)" % J] * 4), None, ", lines_x_prog=3", None, None, None, "Prog12")]
