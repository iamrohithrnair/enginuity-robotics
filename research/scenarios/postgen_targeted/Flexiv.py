
POST = "Flexiv"
NQ = 7
ROBOT = "Flexiv Rizon 10"
P1 = "p(-607.85,543.849,363.215,150,50,-165)"
J = "[0,-10,20,0,30,0,15]"
MJ = "r.MoveJ(%s,%s,[0,0,0])" % (P1, J)
EXPS = [("subs", "\n".join([MJ, 'r.RunCode(r"""S1""", True)', "r.ProgFinish(r'''TgtProg''')", "r.ProgStart(r'''S1''')", MJ, "r.ProgFinish(r'''S1''')", "r.ProgStart(r'''S2''')", MJ, "r.ProgFinish(r'''S2''')", "r.ProgStart(r'''S3''')"]))]
EXPS += [("emptysubs", "\n".join(["r.ProgFinish(r'''TgtProg''')", "r.ProgStart(r'''S1''')", "r.ProgFinish(r'''S1''')", "r.ProgStart(r'''S2''')", MJ]))]
EXPS += [("zones", "\n".join(["r.setZoneData(%s)\nr.setSpeed(%s)\n%s" % (z, v, MJ) for z, v in [("0", "0"), ("-1", "-5"), ("0.12345", "1e-07"), ("1e20", "1e9")]]))]
