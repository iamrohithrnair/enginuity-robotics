
POST = "GSK"
NQ = 6
ROBOT = "GSK RB03A1"
J = "[0,-10,20,0,30,0]"
A = "p(-640.584,506.98,371.534,150,50,-165)"
B = "p(-607.85,543.849,363.215,150,50,-165)"
C = "p(-602.951,596.788,316.595,150,50,-165)"
MJ = "r.MoveJ(None,%s,None)" % J
MJP = "r.MoveJ(%s,%s,[0,0,0])" % (A, J)
ML = "r.MoveL(%s,%s,[0,0,0])" % (B, J)
MC = "r.MoveC(%s,%s,%s,%s,[0,0,0],[0,0,0])" % (B, J, C, J)
FT = 'r.setFrame(p(1234.57,-98.7654,50.5,30,0,0),-1,r"""Frame S""")\nr.setTool(p(10,20,150,0,0,0),-1,r"""Tool S""")'
EXPS = [
    ("io", "\n".join(["r.setDO(1,%s)" % v for v in ["1", "0", "2", "-1", "0.5", "'x'", "True", "False", "'1'"]]
                     + ["r.setAO(2,%s)" % v for v in ["0", "1.5", "-0.5", "'x'"]] + ["r.setDO('V','OFF')", "r.setAO('A',0)"]
                     + ["r.waitDI(1,0,0)", "r.waitDI(1,2,10.25)", "r.waitDI(1,'x',-5)", "r.waitDI('S',0.5,1234.5678)", "r.waitDI(3,True,1e7)"])),
    ("code", "\n".join(['r.RunCode(r"""%s""", True)' % c for c in ["A B", "Fn(1, 2)", "Fn(a,b) x", "x-y.z", "f()", "  pad  "]]
                       + ['r.RunCode(r"""%s""")' % c for c in ["a;b", "  spaced  ", ""]] + ['r.RunMessage(r"""m""")', 'r.RunMessage(r"""""", True)', 'r.RunMessage(r"""""")'])),
    ("pauses", "\n".join("r.Pause(%s)" % v for v in [0, -5, 0.4, 1, 99999.9, 0.0004, 0.0005])),
    ("circle_after_joint", "\n".join([FT, MJ, MC])),
    ("circle_first", "\n".join([FT, MC])),
    ("circle_tool_change", "\n".join([FT, ML.replace(B, A), 'r.setTool(p(0,0,100,0,0,45),-1,r"""T2""")', MC])),
    ("circle_frame_change", "\n".join([FT, ML.replace(B, A), 'r.setFrame(p(10,20,30,0,0,90),-1,r"""F2""")', MC])),
    ("circle_noframe", "\n".join([ML.replace(B, A), MC])),
    ("joint_targets", "\n".join([FT, "r.MoveL(None,%s,None)" % J, "r.MoveC(None,%s,None,%s,None,None)" % (J, J), MJ])),
    ("speeds", "\n".join(["r.setSpeed(-5)", "r.setSpeedJoints(-1)", MJP, MJ, "r.setSpeedJoints(100.9)", MJ, "r.setSpeedJoints(99.99)", MJ,
                          "r.setZoneData(4.99)", ML, "r.setZoneData(-0.5)", ML, "r.setZoneData(4)", ML, "r.setSpeed(1e6)", ML])),
    ("programs", "\n".join([MJ, 'r.RunCode(r"""S1""", True)', "r.ProgFinish(r'''TgtProg''')", "r.ProgStart(r'''S1''')", MJP, ML, "r.ProgFinish(r'''S1''')", "r.ProgStart(r'''S2''')", MJ])),
    ("axes7", "r.MoveJ(None,[1,2,3,4,5,6,7],None)\nr.MoveL(%s,[1,2,3,4,5,6,7],[0,0,0])" % B, "GSK RB08", "", None, "RRRRRRT", 7),
    ("scara4", "r.MoveJ(None,[1,2,3,4],None)\nr.MoveL(%s,[1,2,3,4],[0,0,0])\nr.MoveC(%s,[1,2,3,4],%s,[1,2,3,4],[0,0,0],[0,0,0])" % (B, A, C), "GSK RMD08", "", None, "RRTR", 4),
]
EXPS += [("split_%d_%d" % (n, k), "\n".join([FT] + [MJP if i % 2 == 0 else MJ for i in range(k)]), None, ", lines_x_prog=%d" % n)
         for n in (1, 2, 3, 4, 6) for k in (1, 2, 3, 4, 5, 6)]
EXPS += [("split_circle_%d" % n, "\n".join([FT, ML, MC, ML, MC, MJ]), None, ", lines_x_prog=%d" % n) for n in (2, 3, 4, 5)]
D = "p(-663.517,575.988,286.611,150,50,-165)"
MLA = "r.MoveL(%s,%s,[0,0,0])" % (A, J)
MC2 = "r.MoveC(%s,%s,%s,%s,[0,0,0],[0,0,0])" % (C, J, D, J)
EXPS += [("cnum_%d_%d" % (n, k), "\n".join([MLA, ML] * k + [MC2, MJ, MC2, MJ]), None, ", lines_x_prog=%d" % n if n else "")
         for n in (0, 100, 7, 9) for k in (1, 2)]
EXPS += [("code_chars", "\n".join('r.RunCode(r"""%s""", True)' % c for c in ["a_b", "a+b", "a/b", "a[1]", "a:b", "a\"b", "a'b", "Fn(1)x(2)", "a\tb", "a=b", "Prog-1.2"]))]
EXPS += [("code_chars2", "\n".join('r.RunCode(r"""a%sb""", True)' % c for c in "*!?&%#@{};<>|\\^~`$"))]
EXPS += [("circle_after_movej_pose", "\n".join([FT, MLA, "r.MoveJ(%s,%s,[0,0,0])" % (B, J), MC2])),
         ("circle_after_movel_joints", "\n".join([FT, MLA, "r.MoveL(None,%s,None)" % J, MC2]))]
