# Probes instruction creation, JSON edits, selection order and deletion.




import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from programs_probe_common import *  # noqa: E402,F403

RDK = connect()
robot, frame, tool = new_station(RDK, "PP1")
RDK.Command("Popups", "0")
robot.setJoints([0, -10, 20, 0, 30, 0])
t1 = RDK.AddTarget("Target 1", frame, robot)
t2 = cart_target(RDK, robot, frame, "Target 2", t1.Pose() * robomath.transl(0, 50, 0))
t3 = cart_target(RDK, robot, frame, "Target 3", t1.Pose() * robomath.transl(50, 50, 0))
sub = RDK.AddProgram("Sub1", robot)


p = RDK.AddProgram("Catalog", robot)
p.setPoseFrame(frame)
p.setPoseTool(tool)
p.setSpeed(250)
p.setRounding(5)
p.MoveJ(t1)
p.MoveL(t2)
p.MoveC(t3, t1)
p.Pause(500)
p.RunInstruction("Hello msg", robolink.INSTRUCTION_SHOW_MESSAGE)
p.RunInstruction("A comment", robolink.INSTRUCTION_COMMENT)
p.RunInstruction("SetRPM(25000)", robolink.INSTRUCTION_INSERT_CODE)
p.RunInstruction("Sub1", robolink.INSTRUCTION_CALL_PROGRAM)
p.RunInstruction("Sub1", robolink.INSTRUCTION_START_THREAD)
p.setDO(1, 1)
p.setAO(3, 2.5)
p.waitDI(2, 1, 1000)
p.customInstruction("MyCustom", "my.py", "", 1, "cmd")
step("A.count", lambda: p.InstructionCount())
for i in range(p.InstructionCount()):
    step("A.ins%02d.Instruction" % i, lambda i=i: list(p.Instruction(i)[:4]))
    step("A.ins%02d.json" % i, lambda i=i: norm_json(p.setParam(i)))


q = RDK.AddProgram("Names", robot)


def last_name():
    return q.setParam(q.InstructionCount() - 1)["Name"]


for v in [0.04, 0.05, 1, 99.94, 99.95, 250.25, 600.05, 1234.5678]:
    step("B.speed_mm(%s)" % v, lambda v=v: (q.setSpeed(v), last_name())[1])
for args in [(-1, 30.05), (-1, -1, 600.06), (-1, -1, -1, 90.06), (-1, 45, 600), (-1, -1, 600, 90), (123.456, 45.678, 789.123, 99.5)]:
    step("B.speed%s" % (args,), lambda a=args: (q.setSpeed(*a), last_name(), norm_json(q.setParam(q.InstructionCount() - 1)))[1:])
for v in [-1, -2, 0, 0.4, 0.5, 1.5, 2.5, 2.345, 10.75, 100]:
    step("B.rounding(%s)" % v, lambda v=v: (q.setRounding(v), last_name())[1])
for v in [0, 0.4, 0.5, 999, 999.5, 1000, 1049, 1050, 1234.5, 59999, 61000, -1, -0.5]:
    step("B.pause(%s)" % v, lambda v=v: (q.Pause(v), last_name())[1])
for v in [-1, 0, 1, 999, 999.5, 1000, 1049.9, 1050, 2500, 60000]:
    step("B.waitDI(3,1,timeout=%s)" % v, lambda v=v: (q.waitDI(3, 1, v), last_name())[1])
for name, val in [(0, 0), ("5", "1"), ("IO_7", "1"), ("DO[3]", "true"), (" 4", " 5"), ("-2", "1"), ("3.5", "1")]:
    step("B.setDO(%r,%r)" % (name, val), lambda n=name, v=val: (q.setDO(n, v), last_name())[1])
for name, val in [(0, 0), ("5", "1.25"), ("AO2", "3")]:
    step("B.setAO(%r,%r)" % (name, val), lambda n=name, v=val: (q.setAO(n, v), last_name())[1])
for name, val in [("5", "1"), ("DI_X", "0")]:
    step("B.waitDI(%r,%r)" % (name, val), lambda n=name, v=val: (q.waitDI(n, v), last_name())[1])
for s in ["Hello", "multi\nline"]:
    step("B.message(%r)" % s, lambda s=s: (q.RunInstruction(s, robolink.INSTRUCTION_SHOW_MESSAGE), last_name(), q.Instruction(q.InstructionCount() - 1)[0])[1:])
for kind, code in [("code", robolink.INSTRUCTION_INSERT_CODE), ("comment", robolink.INSTRUCTION_COMMENT), ("call", robolink.INSTRUCTION_CALL_PROGRAM), ("thread", robolink.INSTRUCTION_START_THREAD)]:
    for s in ["Prog(1,2)", "two\nlines", ""]:
        step("B.%s(%r)" % (kind, s), lambda s=s, c=code: (q.RunInstruction(s, c), last_name(), q.Instruction(q.InstructionCount() - 1)[0])[1:])


c = RDK.AddProgram("JsonAdd", robot)
for t in range(0, 14):
    step("C.add_type%d" % t, lambda t=t: (c.setParam("Add", {"Type": t}), norm_json(c.setParam(c.InstructionCount() - 1)))[1])


d = RDK.AddProgram("JsonMod", robot)
d.Pause(100)
d.Pause(200)
step("D.set_pause_1500", lambda: (d.setParam(0, {"Pause": 1500}), d.setParam(0))[1])
step("D.set_custom_name", lambda: (d.setParam(0, {"Name": "My custom name"}), d.setParam(0))[1])
step("D.set_pause_700_after_custom", lambda: (d.setParam(0, {"Pause": 700}), d.setParam(0))[1])
step("D.set_speed_fields", lambda: (d.setParam("Add", {"Type": 2}), d.setParam(2, {"Speed": 77, "SpeedSet": 1, "Accel": 123, "AccelSet": 1}), norm_json(d.setParam(2)))[2])
step("D.delete_by_type_-1", lambda: (d.setParam(1, {"Type": -1}), [d.setParam(i)["Name"] for i in range(d.InstructionCount())])[1])
step("D.InstructionDelete(0)", lambda: (d.InstructionDelete(0), [d.setParam(i)["Name"] for i in range(d.InstructionCount())])[1])


e = RDK.AddProgram("Order", robot)


def names(prog):
    return [prog.setParam(i)["Name"] for i in range(prog.InstructionCount())]


e.Pause(1)
e.Pause(2)
e.Pause(3)
step("E.initial", lambda: names(e))
step("E.InstructionSelect(0)", lambda: e.InstructionSelect(0))
step("E.after_add_10", lambda: (e.Pause(10), names(e))[1])
step("E.after_add_11", lambda: (e.Pause(11), names(e))[1])
step("E.InstructionSelect()", lambda: e.InstructionSelect())
step("E.after_setSelection([])_add_12", lambda: (RDK.setSelection([]), e.Pause(12), names(e))[2])


f = RDK.AddProgram("NoTarget", robot)
f.Pause(1)
f.MoveJ([0, -10, 20, 0, 30, 0])
f.RunInstruction("x", robolink.INSTRUCTION_COMMENT)
f.MoveJ([0, -10, 20, 0, 30, 10])
f.MoveL(t1.Pose() * robomath.transl(0, 0, -10))
step("F.names", lambda: names(f))
step("F.json_last", lambda: norm_json(f.setParam(f.InstructionCount() - 1)))
step("F.MoveC_with_pose", lambda: f.MoveC(t1.Pose(), t2.Pose()))


g = RDK.AddProgram("GuiIns", robot)
g.Pause(100)
for act in ["actionAdd_Pause", "actionAdd_Speed_Change", "actionAdd_Zone_change", "actionAdd_Message",
            "actionAdd_Code_Custom", "actionAdd_I_O_change", "actionAdd_Tool_Change", "actionAdd_Frame_Change"]:
    def run_act(a=act):
        RDK.setSelection([g])
        n0 = g.InstructionCount()
        RDK.Command("TriggerAction", a)
        time.sleep(0.5)
        return [g.InstructionCount() - n0, norm_json(g.setParam(g.InstructionCount() - 1))]
    step("G." + act, run_act)
step("G.actionAdd_Move_Joint[target selected]", lambda: (RDK.setSelection([g, t2]), RDK.Command("TriggerAction", "actionAdd_Move_Joint"), time.sleep(0.5), names(g)[-1])[3])
step("G.actionAdd_Move_Linear[only target selected]", lambda: (RDK.setSelection([t3]), RDK.Command("TriggerAction", "actionAdd_Move_Linear"), time.sleep(0.5), names(g)[-1])[3])
robot.setJoints([10, -10, 20, 0, 30, 0])
step("G.actionAdd_Move_Joint[program only -> new target]", lambda: (RDK.setSelection([g]), RDK.Command("TriggerAction", "actionAdd_Move_Joint"), time.sleep(0.5), names(g)[-1])[3])
step("G.new_target", lambda: [(x.Name(), x.Parent().Name(), x.isJointTarget(), [round(j, 3) for j in x.Joints().list()]) for x in RDK.ItemList(robolink.ITEM_TYPE_TARGET)][-1])
step("G.selection_after", lambda: [(x.Name(), x.Type()) for x in RDK.Selection()])
RDK.setSelection([])
RDK.Disconnect()
print("done", flush=True)
