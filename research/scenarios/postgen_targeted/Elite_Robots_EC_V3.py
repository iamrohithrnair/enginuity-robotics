# Defines Elite EC V3 probes for split boundaries, circular moves and motion settings.
POST = "Elite_Robots_EC_V3"
NQ = 6
ROBOT = "Elite Robots EC612"
P1 = "p(-607.85,543.849,363.215,150,50,-165)"
P2 = "p(-640.584,506.98,371.534,150,50,-165)"
J = "[0,-10,20,0,30,0]"
MJ = "r.MoveJ(%s,%s,[0,0,0])" % (P1, J)
MJN = "r.MoveJ(None,%s,None)" % J
ML = "r.MoveL(%s,%s,[0,0,0])" % (P1, J)
MLN = "r.MoveL(None,%s,None)" % J
MC = "r.MoveC(%s,%s,%s,%s,[0,0,0],[0,0,0])" % (P1, J, P2, J)
MCN = "r.MoveC(None,%s,None,%s,None,None)" % (J, J)
L5 = ", lines_x_prog=5"
EXPS = [
    ("vj", "\n".join("r.setSpeedJoints(%s)\n%s" % (v, MJ) for v in ["1", "5.5", "33.333", "99.9", "100", "150", "400", "0.5", "-5"])),
    ("speeds", "\n".join("r.setSpeed(%s)\n%s" % (v, ML) for v in ["0.4", "2999.9", "3000", "3001", "-5", "1e6"])),
    ("zones", "\n".join("r.setZoneData(%s)\n%s" % (v, ML) for v in ["0.5", "1.5", "6.5", "7", "7.5", "-0.4", "-2"])),
    ("longcomment", 'r.RunMessage(r"""%s""", True)\nr.RunMessage(r"""%s""")\n%s' % ("abcdefghij" * 17, "ABCDEFGHIJ" * 6, MJ)),
    ("movec_first", MC + "\n" + MJ + "\n" + MC),
    ("io", "r.setDO(1,True)\nr.setDO(2,1.5)\nr.setDO('a b',1)\nr.setAO(4,1)\nr.setAO(5,-2.5)\nr.setAO('x','abc')\nr.waitDI(3,True)\nr.waitDI(3,0,0)\nr.waitDI('k',1,-5)\n" + MJ),
    ("calls", 'r.RunCode(r"""1abc""", True)\nr.RunCode(r"""a-b.c d_e(1, 2.5)""", True)\nr.RunCode(r"""raw code ; here""")\n' + MJ),
    ("split_none", "\n".join([MJ, MJN, MJN, MJN, MJ, MLN, MLN, MLN, MLN, MJ, MCN, MCN, MCN, MCN, MCN, MJ]), None, L5),
    ("split_mix", "\n".join([ML, ML, MC, MJ, ML, MC, ML, "r.Pause(10)", "r.setDO(1,1)", ML, ML, ML, ML, ML]), None, L5),
    ("split_multi", "\n".join([ML, 'r.setTool(p(1.5,2.5,3.5,0,0,0),-1,r"""T""")', 'r.RunMessage(r"""%s""", True)' % ("x" * 160), ML, ML]), None, L5),
    ("split_progs", "\n".join([ML, "r.RunCode(r'''Sub1''', True)", ML, "r.ProgFinish(r'''TgtProg''')", "r.ProgStart(r'''Sub1''')", ML, ML, ML, ML, ML, ML, "r.ProgFinish(r'''Sub1''')"]), None, L5),
    ("progs", "\n".join([ML, "r.RunCode(r'''Sub1''', True)", "r.ProgFinish(r'''TgtProg''')", "r.ProgStart(r'''Sub1''')", MJ, ML, "r.ProgFinish(r'''Sub1''')"])),
]
EXPS += [
    ("ao_none", "r.setAO('x',None)\n" + MJ),
    ("movec_dup", "\n".join([MC, "r.setSpeed(50)", MJ, MC, ML, MC, MC])),
]

EXPS += [("end_%s" % k, "%s\n%s" % (ML, ins), None, L5) for k, ins in [("mjn", MJN), ("mln", MLN), ("mcn", MCN), ("speed", "r.setSpeed(10)"), ("zone", "r.setZoneData(1)"), ("accel", "r.setAcceleration(10)"), ("none", "")]]
