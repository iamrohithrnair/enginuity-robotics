

import os

exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)) if "__file__" in dir() else "research/scenarios/postgen_targeted", "AUBO.py")).read())
POST = "AUBO_ARCS"
ROBOT = "AUBO-iS20L"
CALL = 'r.RunCode(r"""%s""", True)'
CODE = 'r.RunCode(r"""%s""")'
EXPS += [
    ("k_call_only", CALL % "fn"),
    ("k_call2", CALL % "fn" + "\n" + CALL % "fn2"),
    ("k_mj_call", MJ1 + "\n" + CALL % "fn"),
    ("k_mj_call2", MJ1 + "\n" + CALL % "fn" + "\n" + CALL % "fn2"),
    ("k_code_call", CODE % "x" + "\n" + CALL % "fn"),
    ("k_wait_call", "r.Pause(250)\n" + CALL % "fn"),
    ("k_code_only", CODE % "x"),
    ("k_def_only", "\n".join([CALL % "S", 'r.ProgFinish(r"""TgtProg""")', 'r.ProgStart(r"""S""")', 'r.Pause(250)', 'r.ProgFinish(r"""S""")'])),
    ("k_def_mj", "\n".join([MJ1, CALL % "S", 'r.ProgFinish(r"""TgtProg""")', 'r.ProgStart(r"""S""")', 'r.Pause(250)', 'r.ProgFinish(r"""S""")'])),
    ("k_def_late", "\n".join([MJ1, CALL % "S", MJ2, 'r.ProgFinish(r"""TgtProg""")', 'r.ProgStart(r"""S""")', 'r.Pause(250)', 'r.ProgFinish(r"""S""")'])),
    ("k_ml_call", ML1 + "\n" + CALL % "fn"),
    ("k_msg_pop", 'r.RunMessage(r"""hello""")\n' + MJ1),
    ("k_io", "r.setDO(1,1)\nr.waitDI(2,1)\nr.setAO(1,2)\n" + MJ1),
]
