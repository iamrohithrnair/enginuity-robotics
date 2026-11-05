# Defines Panasonic CSR probes for circular-motion splitting, subprograms and I/O.
POST = "Panasonic_G3_CSR"
NQ = 6
ROBOT = "Panasonic TA-1000"
J = "[0,-10,20,0,30,0]"
MJ = "r.MoveJ(None,%s,None)" % J
MC = "r.MoveC(None,%s,None,[20,-10,20,0,30,0],None,None)" % J
EXPS = [("io", "\n".join(["r.setDO(1,%s)" % v for v in ["0.4", "2", "-1", "True", "False", "'0'", "'1'", "'x'"]] + ["r.setAO(2,%s)" % v for v in ["0.4", "'x'"]] + ["r.waitDI(1,%s)" % v for v in ["0.4", "-1", "'1'", "'x'"]] + ["r.waitDI(1,1,0)", "r.waitDI(1,1,1234.56)", "r.waitDI('V',1,50)"]))]
EXPS += [("msgs", "\n".join('r.RunMessage(r"""%s""", %s)' % ("".join(chr(65 + i % 26) for i in range(n)), c) for n in (29, 30, 31, 32, 33, 61, 64, 65, 130) for c in ("True", "False")))]
EXPS += [("speeds", "\n".join(["r.setSpeed(%s)\n%s" % (v, MJ) for v in ("2000", "1999.9", "-5", "0.08", "0.09")] + ["r.Pause(0.4)", "r.Pause(4)", "r.Pause(5)", "r.Pause(-5)"]))]
EXPS += [("split_c", "\n".join([MJ, MJ, MC, MC, MJ, MC]), None, ", lines_x_prog=3")]
EXPS += [("split_multi", "\n".join([MJ, 'r.RunCode(r"""Sub""", True)', MJ, MJ, "r.ProgFinish(r'''TgtProg''')", "r.ProgStart(r'''Sub''')", MJ, MJ, MJ, MJ]), None, ", lines_x_prog=2")]
EXPS += [("split_second", "\n".join([MJ, "r.ProgFinish(r'''TgtProg''')", "r.ProgStart(r'''Sub''')", MJ, MJ, MJ, MJ]), None, ", lines_x_prog=2")]
EXPS += [("split_first", "\n".join([MJ, MJ, MJ, "r.ProgFinish(r'''TgtProg''')", "r.ProgStart(r'''Sub''')", MJ]), None, ", lines_x_prog=3")]
EXPS += [("split_main", "\n".join([MJ] * 7), None, ", lines_x_prog=2")]
EXPS += [("split_c2", "\n".join([MJ, MC, MJ, MC, MJ]), None, ", lines_x_prog=4")]
EXPS += [("split_c3", "\n".join([MJ, MJ, MC, MJ]), None, ", lines_x_prog=7")]
