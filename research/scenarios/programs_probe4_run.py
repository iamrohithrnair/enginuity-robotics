# Probes program execution, I/O waits, pause/stop behavior and simulation speed.




import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from programs_probe_common import *  # noqa: E402,F403

RDK = connect()
robot, frame, tool = new_station(RDK, "PP4")
J0 = [0, 0, 0, 0, 30, 0]
robot.setJoints(J0)
step("popups_before(1=popups shown; instance default observed 1)", lambda: RDK.Command("Popups"))
RDK.Command("Popups", "0")
step("popups_set0", lambda: RDK.Command("Popups"))
RDK.setSimulationSpeed(10)


def jt(name, joints):
    return joint_target(RDK, robot, frame, name, joints)


def run(p, maxwait=8.0):
    t0 = time.time()
    r = p.RunCode()
    still = wait_done(p, maxwait)
    return [r, still, round(time.time() - t0, 1) if False else None]


def prog(name, build):
    p = RDK.AddProgram(name, robot)
    p.setPoseFrame(frame)
    p.setPoseTool(tool)
    build(p)
    return p



for v in [500, 0, -1]:
    p = prog("Pz%d" % (v + 1), lambda p, v=v: (p.Pause(v), p.setDO("after_pause", 1)))
    RDK.setParam("after_pause", 0)
    t0 = time.time()
    p.RunCode()
    wait_done(p, 5)
    el = time.time() - t0
    step("pause(%d).finished_and_continued" % v, lambda: [p.Busy(), RDK.getParam("after_pause")])
    if v == 500:
        step("pause(500)@simspeed10.wall_time_between_0.03_and_0.5s", lambda: 0.03 <= el <= 0.5)


p = prog("MsgP", lambda p: (p.RunInstruction("Hello sim", robolink.INSTRUCTION_SHOW_MESSAGE), p.setDO("after_msg", 1)))
RDK.setParam("after_msg", 0)
step("message.run", lambda: (run(p), RDK.getParam("after_msg"))[1])


p = prog("IOset", lambda p: (p.setDO("IO_9", 1), p.setDO(4, 1), p.setDO("MyDO", "ON"), p.setAO(3, 2.5)))
run(p)
for k in ["IO_9", "IO_4", "MyDO", "AO_3", "4", "3"]:
    step("io.station_param(%s)" % k, lambda k=k: RDK.getParam(k))
p = prog("IOwaitSet", lambda p: (p.waitDI("IO_9", 1), p.setDO("after_wait", 1)))
RDK.setParam("after_wait", 0)
step("io.waitDI_already_true.run", lambda: (run(p), [p.Busy(), RDK.getParam("after_wait")])[1])
p = prog("IOwaitNever", lambda p: (p.waitDI("IO_10", 1), p.setDO("after_wait2", 1)))
RDK.setParam("after_wait2", 0)
p.RunCode()
time.sleep(1.5)
step("io.waitDI_never_set.after_1.5s[busy,after]", lambda: [p.Busy(), RDK.getParam("after_wait2")])
RDK.setParam("IO_10", "1")
time.sleep(0.5)
step("io.waitDI_after_RDK.setParam(IO_10,1)[busy,after]", lambda: [p.Busy(), RDK.getParam("after_wait2")])
p = prog("IOwaitTimeout", lambda p: (p.waitDI("IO_11", 1, 1000), p.setDO("after_timeout", 1)))
RDK.setParam("after_timeout", 0)
step("io.waitDI_timeout_1s_popups_off[busy,after]", lambda: (run(p), [p.Busy(), RDK.getParam("after_timeout")])[1])


A = jt("A", [0, 0, 0, 0, 30, 0]); B = jt("B", [45, 0, 0, 0, 30, 0]); C = jt("C", [-45, 0, 0, 0, 30, 0])
sub = prog("SubR", lambda p: (p.setDO("sub_ran", 1), p.MoveJ(B), p.setDO("sub_done", 1)))
main = prog("MainR", lambda p: (p.setDO("sub_ran", 0), p.setDO("sub_done", 0), p.MoveJ(A),
                                p.RunInstruction("SubR", robolink.INSTRUCTION_CALL_PROGRAM),
                                p.setDO("after_call", 1),
                                p.RunInstruction("NoSuchProgram", robolink.INSTRUCTION_CALL_PROGRAM),
                                p.setDO("after_missing", 1), p.MoveJ(C)))
step("call.main.instructions", lambda: [main.setParam(i)["Name"] for i in range(main.InstructionCount())])
robot.setJoints(J0)
main.RunCode()
seen = set()
t0 = time.time()
while main.Busy() and time.time() - t0 < 10:
    seen.add((main.Busy(), sub.Busy()))
    time.sleep(0.01)
step("call.states_seen(main_busy,sub_busy)", lambda: sorted(seen))
step("call.params[sub_ran,sub_done,after_call,after_missing]", lambda: [RDK.getParam(k) for k in ("sub_ran", "sub_done", "after_call", "after_missing")])
step("call.final_joints(=last target C)", lambda: robot.Joints().list(), nd=2)
th = prog("ThR", lambda p: (p.Pause(3000), p.setDO("th_done", 1)))
m2 = prog("M2R", lambda p: (p.setDO("th_done", 0), p.RunInstruction("ThR", robolink.INSTRUCTION_START_THREAD), p.setDO("m2_done", 1)))
RDK.setParam("m2_done", 0)
m2.RunCode(); wait_done(m2, 5)
step("thread.after_main_finished[main_busy,thread_busy,m2_done,th_done]", lambda: [m2.Busy(), th.Busy(), RDK.getParam("m2_done"), RDK.getParam("th_done")])
wait_done(th, 5)
step("thread.later[thread_busy,th_done]", lambda: [th.Busy(), RDK.getParam("th_done")])
m3 = prog("M3R", lambda p: (p.RunInstruction("NoSuchThread", robolink.INSTRUCTION_START_THREAD), p.RunInstruction("SubR(1,2)", robolink.INSTRUCTION_CALL_PROGRAM), p.setDO("m3_done", 1)))
RDK.setParam("m3_done", 0); RDK.setParam("sub_ran", 0)
step("missing_thread_and_call_with_args[m3_done,sub_ran]", lambda: (run(m3), [RDK.getParam("m3_done"), RDK.getParam("sub_ran")])[1])


D = jt("D", [60, 0, 0, 0, 30, 0]); E = jt("E", [-60, 0, 0, 0, 30, 0])
lp = prog("LoopR", lambda p: (p.MoveJ(A), p.MoveJ(D), p.MoveJ(E)))
RDK.setSimulationSpeed(5)
step("loop.get_default", lambda: lp.setParam("Loop"))
step("loop.set1", lambda: lp.setParam("Loop", "1"))
robot.setJoints(J0)
lp.RunCode()
visits = []
t0 = time.time()
while time.time() - t0 < 4.0:
    j = round(robot.Joints().list()[0])
    if j in (60, -60) and (not visits or visits[-1] != j):
        visits.append(j)
    time.sleep(0.01)
step("loop.busy_after_4s", lambda: lp.Busy())
step("loop.extreme_visits_alternate(>=3)", lambda: len(visits) >= 3 and all(visits[i] != visits[i + 1] for i in range(len(visits) - 1)))
lp.Stop()
time.sleep(0.2)
step("stop.busy_after_Stop", lambda: lp.Busy())
jstop = robot.Joints().list()[0]
time.sleep(0.4)
step("stop.robot_stays_where_stopped", lambda: abs(robot.Joints().list()[0] - jstop) < 1e-6)
lp.setParam("Loop", "0")
robot.setJoints(J0)
lp.RunCode()
time.sleep(0.12)
lp.Stop()
time.sleep(0.2)
mid = robot.Joints().list()[0]
step("stop.mid_motion_is_intermediate(0<J1<60)", lambda: 0.0 < mid < 60.0)
first = []
lp.RunCode()
t0 = time.time()
while lp.Busy() and time.time() - t0 < 10:
    first.append(round(robot.Joints().list()[0]))
    time.sleep(0.01)
step("rerun.starts_from_first_instruction(goes_to_A=0_before_D=60)", lambda: (0 in first[: max(1, first.index(60) if 60 in first else len(first))]) if first else None)
step("rerun.end_joint", lambda: round(robot.Joints().list()[0], 2))
robot.setJoints(J0)
step("start_at.setParam(Start,4)=MoveJ(E)", lambda: lp.setParam("Start", "4"))
traj = []
t0 = time.time()
time.sleep(0.05)
while lp.Busy() and time.time() - t0 < 10:
    traj.append(round(robot.Joints().list()[0]))
    time.sleep(0.01)
step("start_at.never_visits_D(60)_and_ends_at_E", lambda: [max(traj + [0]) < 5, round(robot.Joints().list()[0], 2)])
robot.setJoints(J0)
lp.RunCode(); time.sleep(0.2)
step("item_command_Stop", lambda: (lp.setParam("Stop"), time.sleep(0.2), lp.Busy())[2])


RDK.setSimulationSpeed(5)
step("simspeed.initial", lambda: RDK.SimulationSpeed())
step("simspeed.after_actionFast_simulation", lambda: (RDK.Command("TriggerAction", "actionFast_simulation"), time.sleep(0.3), RDK.SimulationSpeed())[2])
step("simspeed.after_second_toggle", lambda: (RDK.Command("TriggerAction", "actionFast_simulation"), time.sleep(0.3), RDK.SimulationSpeed())[2])
RDK.setSimulationSpeed(7.5)
step("simspeed.custom_7.5_then_toggle_twice", lambda: (RDK.Command("TriggerAction", "actionFast_simulation"), time.sleep(0.3), RDK.SimulationSpeed(), RDK.Command("TriggerAction", "actionFast_simulation"), time.sleep(0.3), RDK.SimulationSpeed())[2::3])
for v in [0.001, 0.0005, 0, -1, 1000]:
    step("simspeed.set(%s)->get" % v, lambda v=v: (RDK.setSimulationSpeed(v), RDK.SimulationSpeed())[1])
RDK.setSimulationSpeed(5)
F = jt("F", [90, 0, 0, 0, 30, 0]); G = jt("G", [-90, 0, 0, 0, 30, 0])
pp = prog("PauseAct", lambda p: (p.MoveJ(F), p.MoveJ(G)))
robot.setJoints(J0)
pp.RunCode(); time.sleep(0.2)
RDK.Command("TriggerAction", "actionPauseProgram")
j1 = robot.Joints().list()[0]; time.sleep(0.5); j2 = robot.Joints().list()[0]
step("pause_action.first[busy,robot_frozen]", lambda: [pp.Busy(), abs(j2 - j1) < 1e-6])
RDK.Command("TriggerAction", "actionPauseProgram")
wait_done(pp, 10)
step("pause_action.second_resumes_to_end[busy,J1]", lambda: [pp.Busy(), round(robot.Joints().list()[0], 2)])
RDK.Disconnect()
print("done", flush=True)
