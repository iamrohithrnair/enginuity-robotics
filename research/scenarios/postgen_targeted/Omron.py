


POST = "Omron"
NQ = 6
ROBOT = "Omron TM12"
J = "[0,-10,20,0,30,0]"
J2 = "[20,-10,20,0,30,0]"
A = "p(-640.584,506.98,371.534,150,50,-165)"
B = "p(-607.85,543.849,363.215,150,50,-165)"
C = "p(-602.951,596.788,316.595,150,50,-165)"
ML = "r.MoveL(%s,%s,[0,0,0])" % (A, J)
MJ = "r.MoveJ(%s,%s,[0,0,0])" % (B, J)
F1 = 'r.setFrame(p(1234.57,-98.7654,50.5,30,0,0),-1,r"""Frame S""")'
T1 = 'r.setTool(p(10,20,150,0,0,0),-1,r"""Tool S""")'


def _prog(body, name="TgtProg"):
    pass
    return "r.ProgStart(r'''%s''')\n%s" % (name, body)


EXPS = [
    ("analog", "\n".join([F1, T1, ML] + ["r.setAO(%s,%s)" % (n, v) for n, v in [(0, 1), (1, 1), (2, 1), (3, 1), (4, 1), (5, 0.5), (10, 1.5), (3, "'x'"), (3, -2), ("'7'", "'2.5'")]])),
    ("digital", "\n".join([F1, T1, ML] + ["r.setDO(%s,%s)" % (n, v) for n, v in [(0, 1), (1, 2), (1, -1), (1, "'x'"), (1, True), (1, 0.5), (20, 0), (1, "'1'"), (1, "'0'"), ("'V'", 1), ("'Gripper'", "'ON'"), ("'Valve 2'", 3), ("'8'", 1)]])),
    ("inputs", "\n".join([F1, T1, ML] + ["r.waitDI(%s,%s,-1)" % (n, v) for n, v in [(0, 1), (1, 2), (1, -1), (1, "'x'"), (1, True), (1, 0.5), (1, "'0'"), ("'V'", 1), ("'Part Present'", "'ON'"), ("'9'", 0)]]
                          + ["r.waitDI(1,1,0)", "r.waitDI(1,1,1234.5678)", "r.waitDI('V',0,250)"])),
    ("speeds_lin", "\n".join([F1, T1] + ["r.setSpeed(%s)\nr.setAcceleration(%s)\n%s" % (v, a, ML) for v, a in [(100, 800), (250, 800), (300, 1000), (500, 1000), (100, 100), (1000, 500), (50, 2000), (2000, 1000), (240, 800), (241, 800), (12.5, 100.5)]])),
    ("speeds_joint", "\n".join([F1, T1] + ["r.setSpeedJoints(%s)\nr.setAccelerationJoints(%s)\n%s" % (v, a, MJ) for v, a in [(60, 120), (100, 100), (185, 100), (185, 1000), (10, 1000), (180, 50), (1, 1), (92.5, 400), (200, 200), (37, 3)]])),
    ("speeds_order", "\n".join([F1, T1, "r.setAccelerationJoints(240)", MJ, "r.setSpeedJoints(60)", MJ, "r.setAcceleration(600)", ML, "r.setSpeed(60)", ML])),
    ("zones", "\n".join([F1, T1] + ["r.setZoneData(%s)\n%s\n%s" % (z, ML, MJ) for z in [-1, 0, 0.99, 1, 1.5, 99.9, 100, 101, 1000]])),
    ("pauses", "\n".join([F1, T1, ML] + ["r.Pause(%s)" % v for v in [0, -1, 0.4, 1234.5678, 500, 500, -1, 0.9999, 60000]])),
    ("no_header", _prog("\n".join([F1, T1, ML, 'r.RunMessage(r"""late comment""",True)', MJ]))),
    ("header_late", "\n".join([F1, T1, ML, 'r.RunMessage(r"""after a move""",True)', 'r.RunMessage(r"""second one""",True)', MJ])),
    ("popup_first", _prog("\n".join(['r.RunMessage(r"""Popup first message""")', 'r.RunMessage(r"""then a comment""",True)', F1, T1, ML]))),
    ("comments_only", _prog("\n".join(['r.RunMessage(r"""one""",True)', 'r.RunMessage(r"""two""",True)', 'r.RunMessage(r"""three""",True)', F1, T1, ML]))),
    ("nothing", _prog(ML)),
    ("no_frame", "\n".join([T1, ML, MJ, "r.MoveJ(None,%s,None)" % J2])),
    ("frames_tools", "\n".join([F1, T1, ML, 'r.setFrame(p(100,200,300,0,90,0),-1,r"""Frame 2""")', ML, 'r.setTool(p(0,0,100,45,0,0),-1,r"""Tool 2""")', ML,
                                'r.setTool(p(0,0,120,0,0,0),-1,r"""Tool 2""")', ML, F1, ML, 'r.setTool(p(10,20,150,0,0,0),-1,r"""Tool S""")', ML,
                                'r.setFrame(p(0,0,0,0,0,0),-1,r"""Frame 3""")', ML, 'r.setTool(p(0,0,0,0,0,0),-1,r"""Tool 0""")', ML,
                                'r.setFrame(p(1,2,3,0,0,0),5,r"""Frame 2""")', ML, 'r.setTool(p(1,2,3,4,5,6),3,r"""T-1.x""")', ML])),
    ("names", "\n".join([F1, T1, 'r._TargetName=r"""Home"""', ML, MJ, 'r._TargetName=r"""Home"""', "r.MoveL(%s,%s,[0,0,0])" % (C, J),
                         'r._TargetName=r"""T-1.x (a)"""', "r.MoveJ(None,%s,None)" % J2, "r.MoveL(%s,%s,[0,0,0])" % (B, J), 'r._TargetName=r"""1st"""', ML,
                         'r._TargetName=r"""Point2"""', "r.MoveL(p(-600,500,371.534,150,50,-165),%s,[0,0,0])" % J, "r.MoveL(p(-610,500,371.534,150,50,-165),%s,[0,0,0])" % J])),
    ("circles", "\n".join([F1, T1, ML, "r.MoveC(%s,%s,%s,%s,[0,0,0],[0,0,0])" % (B, J, C, J), "r.MoveC(None,%s,%s,%s,None,[0,0,0])" % (J, C, J),
                           "r.MoveC(%s,%s,None,%s,[0,0,0],None)" % (B, J, J2), "r.MoveC(%s,%s,%s,%s,[0,0,0],[0,0,0])" % (B, J, C, J), ML])),
    ("subprograms", "\n".join([F1, T1, ML, 'r.RunCode(r"""S1""", True)', 'r.RunCode(r"""S2""", True)', 'r.RunCode(r"""S1""", True)', 'r.RunCode(r"""Ext Prog""", True)',
                               "r.ProgFinish(r'''TgtProg''')", "r.ProgStart(r'''S2''')", 'r.RunMessage(r"""in S2""",True)', MJ, 'r.RunCode(r"""S3""", True)', "r.setDO(1,1)",
                               "r.ProgFinish(r'''S2''')", "r.ProgStart(r'''S1''')", "r.MoveJ(None,%s,None)" % J2, ML, MJ, ML, MJ, ML, MJ, ML, MJ, ML, "r.ProgFinish(r'''S1''')",
                               "r.ProgStart(r'''S3''')", "r.Pause(-1)", "r.ProgFinish(r'''S3''')", "r.ProgStart(r'''S4''')", ML, "r.ProgFinish(r'''S4''')"])),
    ("messages", "\n".join([F1, T1, ML] + ['r.RunMessage(r"""%s"""%s)' % (m, c) for m, c in [("A long message with \"quotes\", 'apostrophes' & symbols: <>[]{}()=+-*/%;#@! end", ""),
                                                                                         ("Comment with ; semicolon", ",True"), ("123 starts with digits", ""), ("x", ""), ("", ""), ("Ünïcödé text", ",True"),
                                                                                         ("line1\\nline2", ",True")]]
                         + ['r.RunCode(r"""%s""")' % c for c in ["x = 1", "Do Something(1, 2)", "123abc", "ab_cd_ef_gh_ij"]])),
    ("many_nodes", "\n".join([F1, T1] + [ML, MJ] * 30 + ["r.Pause(10)"] * 5)),
]
