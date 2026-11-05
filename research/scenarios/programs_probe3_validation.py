# Probes motion validation for unreachable targets, joint limits, singularities and collisions.




import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from programs_probe_common import *  # noqa: E402,F403

RDK = connect()
RDK.Command("Popups", "0")
robot, frame, tool = new_station(RDK, "PP3")
J0 = [0, 0, 0, 0, 30, 0]
robot.setJoints(J0)
P0 = robot.Pose()
tr = robomath.transl


def jt(name, joints):
    return joint_target(RDK, robot, frame, name, joints)


def ct(name, pose):
    return cart_target(RDK, robot, frame, name, pose)


def check(label, build, collisions=robolink.COLLISION_OFF):
    robot.setJoints(J0)
    p = RDK.AddProgram("V_" + label, robot)
    p.setPoseFrame(frame)
    p.setPoseTool(tool)
    build(p)
    step(label + ".n_instructions", lambda: p.InstructionCount())
    step(label + ".Update", lambda: p.Update(collisions))
    robot.setJoints(J0)
    step(label + ".InstructionList.status", lambda: p.InstructionList()[1])
    robot.setJoints(J0)

    def ilj():
        msg, jl, st = p.InstructionListJoints(mm_step=1, deg_step=1, collision_check=collisions)
        codes = sorted(set(int(c[6]) for c in zip(*jl.rows))) if jl.rows else []
        return [st, msg, codes]
    step(label + ".InstructionListJoints[status,msg,ERROR codes]", ilj)
    step(label + ".robot_joints_after", lambda: robot.Joints().list(), nd=2)
    return p


far = ct("Far", P0 * tr(0, 0, -2000))
check("unreachable_cart_MoveJ", lambda p: (p.MoveJ(jt("j0", J0)), p.MoveJ(far)))
check("unreachable_cart_MoveL", lambda p: (p.MoveJ(jt("j0b", J0)), p.MoveL(far)))
check("continue_after_failure_MoveJ", lambda p: (p.MoveJ(jt("j0c", J0)), p.MoveJ(far), p.MoveJ(jt("j90", [90, 0, 0, 0, 30, 0])), p.setDO("x", 1)))
check("continue_after_failure_MoveL", lambda p: (p.MoveJ(jt("j0d", J0)), p.MoveJ(far), p.MoveL(ct("ok", P0 * tr(0, 50, 0))), p.setDO("x", 1)))
check("joint_target_beyond_limit(J1=170)", lambda p: (p.MoveJ(jt("j0e", J0)), p.MoveJ(jt("jbad", [170, 0, 0, 0, 30, 0]))))
check("MoveL_crossing_J1_limit(150->-150)", lambda p: (p.MoveJ(jt("a150", [150, 0, 0, 0, 30, 0])), p.MoveL(jt("am150", [-150, 0, 0, 0, 30, 0]))))
for a in (10, 40):
    check("MoveL_wrist_flip(J5 %d->-%d)" % (a, a), lambda p, a=a: (p.MoveJ(jt("w1", [0, 0, 0, 0, a, 0])), p.MoveL(jt("w2", [0, 0, 0, 0, -a, 0]))))
    check("MoveJ_wrist_flip(J5 %d->-%d)" % (a, a), lambda p, a=a: (p.MoveJ(jt("w3", [0, 0, 0, 0, a, 0])), p.MoveJ(jt("w4", [0, 0, 0, 0, -a, 0]))))
check("MoveL_to_J5=1deg(near wrist singularity)", lambda p: (p.MoveJ(jt("j0f", J0)), p.MoveL(jt("ns", [0, 0, 0, 0, 1, 0]))))
check("MoveL_to_J5=3deg", lambda p: (p.MoveJ(jt("j0g", J0)), p.MoveL(jt("ns3", [0, 0, 0, 0, 3, 0]))))
check("first_instruction_MoveC", lambda p: (p.MoveC(ct("c1", P0 * tr(50, 50, 0)), ct("c2", P0 * tr(0, 100, 0)))))
check("missing_program_call", lambda p: (p.MoveJ(jt("j0h", J0)), p.RunInstruction("NoSuchProgram", robolink.INSTRUCTION_CALL_PROGRAM)))
step("tolerances(ToleranceSingularityWrist,Elbow,Back,Turn180)", lambda: [RDK.Command(k) for k in ("ToleranceSingularityWrist", "ToleranceSingularityElbow", "ToleranceSingularityBack", "ToleranceTurn180")])


c = (frame.PoseAbs() * robot.Pose()).Pos()
hit = box(RDK, "HitBox", [250, 250, 250], [c[0], c[1], c[2]])
pc = check("collision_sweep_COLLISION_ON", lambda p: (p.MoveJ(jt("ca", [90, 0, 0, 0, 30, 0])), p.MoveJ(jt("cb", [-90, 0, 0, 0, 30, 0]))), robolink.COLLISION_ON)
robot.setJoints([90, 0, 0, 0, 30, 0])
step("collision_sweep.Update(COLLISION_OFF)", lambda: pc.Update(robolink.COLLISION_OFF))
robot.setJoints([90, 0, 0, 0, 30, 0])
step("collision_sweep.Update(ON, mm_step=1, deg_step=1)", lambda: pc.Update(robolink.COLLISION_ON, 3600, 1, 1))
robot.setJoints([90, 0, 0, 0, 30, 0])
step("collision_sweep.Update(ON, mm_step=20, deg_step=20)", lambda: pc.Update(robolink.COLLISION_ON, 3600, 20, 20))
hit.Delete()
RDK.Disconnect()
print("done", flush=True)
