# Probes collision maps, active pairs, motion tests and run-time collision behavior.




import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from programs_probe_common import *  # noqa: E402,F403

RDK = connect()
RDK.Command("Popups", "0")
RDK.setCollisionActive(robolink.COLLISION_OFF)
robot, frame, tool = new_station(RDK, "PP5")
J0 = [0, 0, 0, 0, 30, 0]
robot.setJoints(J0)
RN = robot.Name()


def pairs(lst):
    out = []
    for a, b, i1, i2 in lst:
        na = "ROBOT" if a.Name() == RN else a.Name()
        nb = "ROBOT" if b.Name() == RN else b.Name()
        out.append("%s[%d]-%s[%d]" % (na, i1, nb, i2))
    return out


def summarize(lst):
    cats = {}
    for s in pairs(lst):
        a, b = s.split("-")
        key = a.split("[")[0] + "-" + b.split("[")[0]
        cats.setdefault(key, []).append(s)
    return {k: len(v) for k, v in cats.items()}


step("map.robot_and_tool_only", lambda: pairs(RDK.CollisionActivePairList()))
c = (frame.PoseAbs() * robot.Pose()).Pos()
far = box(RDK, "FarBox", [100, 100, 100], [0, 800, 50])
step("map.after_adding_one_object", lambda: summarize(RDK.CollisionActivePairList()))
step("map.robot_vs_object_links", lambda: [s for s in pairs(RDK.CollisionActivePairList()) if "FarBox" in s])
hit = box(RDK, "HitBox", [250, 250, 250], [c[0], c[1], c[2]])
step("map.after_second_object(no object-object pair)", lambda: summarize(RDK.CollisionActivePairList()))
for mode in ["All", "None", "Default"]:
    step("map.CollisionMap(%s)" % mode, lambda m=mode: (RDK.Command("CollisionMap", m), summarize(RDK.CollisionActivePairList()))[1])

step("query.Collisions()_global_OFF", lambda: RDK.Collisions())
step("query.Collision(robot,HitBox)_global_OFF", lambda: RDK.Collision(robot, hit))
step("toggle.setCollisionActive(ON)_returns", lambda: RDK.setCollisionActive(robolink.COLLISION_ON))
step("query.Collisions()_ON", lambda: RDK.Collisions())
step("query.CollisionItems", lambda: sorted("ROBOT" if x.Name() == RN else x.Name() for x in RDK.CollisionItems()))
step("query.CollisionPairs", lambda: pairs(RDK.CollisionPairs()))
step("query.Collision(robot,HitBox)", lambda: RDK.Collision(robot, hit))
step("query.Collision(tool_without_geometry,HitBox)", lambda: RDK.Collision(tool, hit))
step("query.HitBox.Collision(robot)", lambda: hit.Collision(robot))
step("query.Collision(robot,FarBox)", lambda: RDK.Collision(robot, far))
step("pair.disable(robot link5,HitBox)", lambda: RDK.setCollisionActivePair(robolink.COLLISION_OFF, robot, hit, 5, 0))
step("pair.Collisions()_after_disable", lambda: (robot.setJoints(J0), RDK.Collisions())[1])
step("pair.enable_again", lambda: RDK.setCollisionActivePair(robolink.COLLISION_ON, robot, hit, 5, 0))
step("move.setJoints(J5=-30).Collisions", lambda: (robot.setJoints([0, 0, 0, 0, -30, 0]), RDK.Collisions(), pairs(RDK.CollisionPairs()))[1:])
step("move.setJoints(J1=90).Collisions", lambda: (robot.setJoints([90, 0, 0, 0, 30, 0]), RDK.Collisions())[1])
step("test.MoveJ_Test(90->-90 through box)", lambda: robot.MoveJ_Test([90, 0, 0, 0, 30, 0], [-90, 0, 0, 0, 30, 0]))
step("test.robot_left_at(J1)", lambda: round(robot.Joints().list()[0], 1))
step("test.MoveJ_Test(90->100 free)", lambda: robot.MoveJ_Test([90, 0, 0, 0, 30, 0], [100, 0, 0, 0, 30, 0]))
robot.setJoints([90, 0, 0, 0, 30, 0])
P90 = robot.Pose()
step("test.MoveL_Test(free 50mm)", lambda: robot.MoveL_Test([90, 0, 0, 0, 30, 0], P90 * robomath.transl(0, 0, -50)))
step("test.MoveL_Test(unreachable)", lambda: robot.MoveL_Test([90, 0, 0, 0, 30, 0], P90 * robomath.transl(0, 0, -3000)))
step("settings[CollisideOneStop,PathStepCollisionMM,PathStepCollisionDeg,CollisionMethod]", lambda: [RDK.Command(k) for k in ("CollisideOneStop", "PathStepCollisionMM", "PathStepCollisionDeg", "CollisionMethod")])


A = joint_target(RDK, robot, frame, "A", [90, 0, 0, 0, 30, 0])
B = joint_target(RDK, robot, frame, "B", [-90, 0, 0, 0, 30, 0])
p = RDK.AddProgram("CollRun", robot)
p.setPoseFrame(frame); p.setPoseTool(tool)
p.MoveJ(A); p.MoveJ(B); p.setDO("coll_after", 1)
RDK.setSimulationSpeed(5)
RDK.setParam("coll_after", 0)
robot.setJoints([90, 0, 0, 0, 30, 0])
p.RunCode(); wait_done(p, 20)
jend = robot.Joints().list()[0]
step("run.ON[busy,stopped_before_target(-90<J1<90),last_instruction_executed,collisions_at_stop>0]", lambda: [p.Busy(), -89.0 < jend < 89.0, RDK.getParam("coll_after"), RDK.Collisions() > 0])
RDK.setCollisionActive(robolink.COLLISION_OFF)
RDK.setParam("coll_after", 0)
robot.setJoints([90, 0, 0, 0, 30, 0])
p.RunCode(); wait_done(p, 20)
step("run.OFF[busy,J1_end,last_instruction_executed]", lambda: [p.Busy(), round(robot.Joints().list()[0], 2), RDK.getParam("coll_after")])
RDK.Disconnect()
print("done", flush=True)
