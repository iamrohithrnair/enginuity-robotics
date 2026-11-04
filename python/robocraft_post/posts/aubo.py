








































import math
import random
import uuid

from ..base import PostError, RobotPost, register
from ..robomath import quaternion

LOOP_UUID = "2e581cce4eab4e2fb7425a1ba362149d"
PROCEDURE_MD5 = "e1bce1291a91d8072549b0c821e2167b"


def _xml_text(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace('"', "&quot;").replace(">", "&gt;")


def _rad(joints):
    return [math.radians(j) for j in joints]


def _f6(values):
    return ",".join("%f" % v for v in values)


def _true(value):
    if isinstance(value, bool):
        return 1 if value else 0
    if isinstance(value, (int, float)):
        return 1 if value > 0 else 0
    return 0


class _Node:
    def __init__(self, ctype, alias, uid=None, attrs=None):
        self.ctype = ctype
        self.alias = alias
        self.uid = uid
        self.attrs = attrs or []  
        self.children = []
        self.group = None  
        self.open = False  


class _Prog:
    def __init__(self, name, is_main):
        self.name = name
        self.is_main = is_main
        self.lines = []
        self.node = None  


@register
class AUBO(RobotPost):
    name = "AUBO"
    

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._rand = random.Random(0)
        self.PROGS = []
        self.PROG = None
        self.ROOT = _Node("Loop", "Loop", LOOP_UUID, [("LoopConditionMode", "Always")])
        self.PENDING = []  
        self.SPEED_J = None
        self.ACCEL_J = None
        self.SPEED_L = 0.25
        self.ACCEL_L = 0.25
        self.ZONE = 1.0
        self.LAST = None  
        self.SPLIT = False  

    
    def _uuid(self):
        return uuid.UUID(int=self._rand.getrandbits(128), version=4).hex

    def _base(self):
        return " " * (6 if self.PROG.is_main else 8)

    def addline(self, line, extra=0):
        self.PROG.lines.append(self._base() + " " * extra + line)

    def _add(self, node):
        cont = self.PROG.node
        if cont is not None:
            if cont.children and cont.children[-1].ctype == "Move":
                cont.children[-1].open = False
            cont.children.append(node)

    def _close_move(self):
        cont = self.PROG.node
        if cont is not None and cont.children and cont.children[-1].ctype == "Move":
            cont.children[-1].open = False

    
    def ProgStart(self, progname):
        uid = self._uuid()
        prog = _Prog(progname, not self.PROGS)
        self.PROGS.append(prog)
        self.PROG = prog
        if prog.is_main:
            prog.node = self.ROOT
        else:
            for proc in self.PENDING:
                if proc.alias == progname and proc.uid is None:
                    proc.uid = uid
                    prog.node = proc
                    break

    def ProgFinish(self, progname):
        self._uuid()

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        pp_uid = self._uuid()
        lua = []
        for prog in self.PROGS[1:]:
            lua.append("-- Subprogram %s" % prog.name)
            lua.append("--script function definition")
            lua.append("  function %s()" % prog.name)
            lua.extend(prog.lines)
            lua.append("  end")
            lua.append("--End of sub program")
            lua.append("")
        main = self.PROGS[0] if self.PROGS else _Prog(progname, True)
        lua.append("--Main Program")
        lua.append("--script function definition")
        lua.append("  function loopScriptFunc_0()")
        lua.extend(main.lines)
        lua.append("  end")
        lua.append("")
        lua.append("--(Logic tree item : Project_Program) Project_Program")
        lua.append("  --(Logic tree item : Loop) Loop")
        lua.append("  while (true) do")
        lua.append("    sleep(0.001)")
        lua.append("    if (loopScriptFunc_0() == false) then")
        lua.append("      break")
        lua.append("    end")
        lua.append("  end")
        lua.append("--End of main program")
        lua.append("")
        project = _Node(
            "Project_Program",
            "Project_Program",
            pp_uid,
            [
                ("enableMoveGroupPro", "false"),
                ("md5OfProjectContinueFile", None),
                ("md5OfProjectPauseFile", None),
                ("md5OfProjectStopFile", None),
                ("projectContinueFile", None),
                ("projectPauseFile", None),
                ("projectStopFile", None),
                ("selectProjectContinue", "false"),
                ("selectProjectPause", "false"),
                ("selectProjectStop", "false"),
            ],
        )
        project.children.append(self.ROOT)
        xml = ['<?xml version="1.0" ?>', "<MainProgram>"]
        self._xml(project, 1, xml)
        xml.append("</MainProgram>")
        sub = progname + "/"
        self.save_file(folder, sub + "main.aubo", "\n".join(lua) + "\n")
        self.files.append((sub + "main.xml", "\n".join(xml) + "\n"))

    def _xml(self, node, level, out):
        ind = "    " * level
        out.append('%s<Condition ConditionType="%s" ConditionAlias="%s" ConditionUuid="%s">' % (ind, node.ctype, _xml_text(node.alias), node.uid))
        out.append("%s    <Attribute>" % ind)
        for tag, text in node.attrs:
            if text is None:
                out.append("%s        <%s/>" % (ind, tag))
            else:
                out.append("%s        <%s>%s</%s>" % (ind, tag, _xml_text(text), tag))
        out.append("%s    </Attribute>" % ind)
        for child in node.children:
            if child.uid is None:
                continue  
            self._xml(child, level + 1, out)
        out.append("%s</Condition>" % ind)

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def _move_attrs(self, kind):
        n = self.ROBOT_AXES
        if self.ZONE > 0:
            zone = [("ArrivalAheadThreshold", repr(self.ZONE / 1000.0)), ("ArrivalAheadType", "BlendRadius"), ("EnableArrivalAhead", "true")]
        else:
            zone = [("ArrivalAheadThreshold", "0.000000"), ("ArrivalAheadType", "None"), ("EnableArrivalAhead", "false")]
        mode = {"MoveJ": "MoveJoint", "MoveL": "MoveLine", "MoveC": "MoveTrack"}[kind]
        attrs = [("MoveConditionMode", mode)] + zone + [("EnableOffset", "false")]
        if kind == "MoveJ":
            attrs += [("JointAcc", ",".join(["50"] * n)), ("JointSpeed", ",".join(["50"] * n))]
        else:
            attrs += [("EndAngleAcc", "50"), ("EndAngleSpeed", "50"), ("EndLinearAcc", "50"), ("EndLinearSpeed", "50")]
        attrs += [("OffsetCoordName", "Base"), ("OffsetCoordType", "BaseCoord")]
        attrs += [(t, None) for t in ("OffsetRX", "OffsetRY", "OffsetRZ", "OffsetX", "OffsetY", "OffsetZ")]
        if kind == "MoveC":
            attrs.append(("TrackType", "Arc"))
        attrs += [("angleJerkRatio", "0.25"), ("isInGluing", "false"), ("isInMoveGroup", "false"), ("jerkRatio", "0.25"), ("resolutionLength", "1")]
        return attrs

    def _move_header(self, kind):
        self.addline("--(Logic tree item : Move) %s" % kind)
        self.addline("init_global_move_profile()")
        if kind == "MoveJ":
            n = self.ROBOT_AXES
            v = repr(self.SPEED_J) if self.SPEED_J is not None else "0.3"
            a = repr(self.ACCEL_J) if self.ACCEL_J is not None else "1.1"
            self.addline("set_joint_maxvelc({%s})" % ",".join([v] * n))
            self.addline("set_joint_maxacc({%s})" % ",".join([a] * n))
        else:
            self.addline("set_end_maxvelc(%f)" % self.SPEED_L)
            self.addline("set_end_maxacc(%f)" % self.ACCEL_L)
        if self.ZONE > 0:
            self.addline("set_arrival_ahead_blend_mode(%.4f)" % (self.ZONE / 1000.0))

    def _fixed(self, pose, joints):
        if pose is None:
            head = [0.0] * 7
        else:
            head = [pose[0][3] / 1000.0, pose[1][3] / 1000.0, pose[2][3] / 1000.0] + quaternion(pose)
        return _f6(head + _rad(joints))

    def _waypoint(self, uid, pose, joints):
        return _Node("Waypoint", "Waypoint", uid, [("WaypointConditionMode", "FixedPoint"), ("FixedPoint", self._fixed(pose, joints))])

    def _move(self, kind, pose, joints):
        cont = self.PROG.node
        last = cont.children[-1] if cont is not None and cont.children else None
        join = last is not None and last.ctype == "Move" and last.open and last.group == kind and not self.SPLIT
        self._uuid()
        wp_uid = self._uuid()
        self._uuid()
        if not join:
            mv_uid = self._uuid()
            self._uuid()
            self._move_header(kind)
            node = _Node("Move", kind, mv_uid, self._move_attrs(kind))
            node.group = kind
            node.open = True
            if cont is not None:
                cont.children.append(node)
            last = node
        last.children.append(self._waypoint(wp_uid, pose, joints))
        self.addline("--(Logic tree item : Waypoint) Waypoint", 2)
        self.addline('set_current_logic_tree_item("%s")' % wp_uid, 2)
        self.addline("%s({%s}, true)" % ("move_joint" if kind == "MoveJ" else "move_line", _f6(_rad(joints))), 2)
        self.addline("set_step_breakpoint()", 2)
        self.SPLIT = False
        self.LAST = (pose, joints)

    def MoveJ(self, pose, joints, conf_RLF=None):
        self._move("MoveJ", pose, joints)

    def MoveL(self, pose, joints, conf_RLF=None):
        self._move("MoveL", pose, joints)

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if self.LAST is None:
            raise AttributeError("'RobotPost' object has no attribute 'LAST_JOINTS'")  
        if pose1 is None:
            start = (None, self.LAST[1])  
        elif self.LAST[0] is None:
            
            raise PostError("MatrixError: Expected a 4x4 pose, got a 0x0 matrix")
        else:
            start = self.LAST
        self._uuid()
        uids = [self._uuid() for _ in range(3)]
        self._uuid()
        mv_uid = self._uuid()
        for _ in range(3):
            self._uuid()
        self._close_move()
        self._move_header("MoveC")
        node = _Node("Move", "MoveC", mv_uid, self._move_attrs("MoveC"))
        node.group = "MoveC"
        points = [start, (pose1, joints1), (pose2, joints2)]
        for i, (uid, (pose, joints)) in enumerate(zip(uids, points)):
            node.children.append(self._waypoint(uid, pose, joints))
            if i or pose1 is not None:
                self.addline("--(Logic tree item : Waypoint) Waypoint", 2)
            self.addline('set_current_logic_tree_item("%s")' % uid, 2)
            self.addline("add_waypoint({%s})" % _f6(_rad(joints)), 2)
        self.addline("move_track(MoveTrackType.Arc, true)", 2)
        self.addline("set_step_breakpoint()", 2)
        if self.PROG.node is not None:
            self.PROG.node.children.append(node)
        self.SPLIT = False
        self.LAST = (pose2, joints2)

    
    def setFrame(self, pose, frame_id=None, frame_name=None):
        pass

    def setTool(self, pose, tool_id=None, tool_name=None):
        q = quaternion(pose)
        self.addline("--set_tool_kinematics_param({%f,%f,%f},{%f,%f,%f,%f})" % tuple([pose[0][3], pose[1][3], pose[2][3]] + q))

    def setSpeed(self, speed_mms):
        self.SPEED_L = min(speed_mms / 1000.0, 2.0)
        self.SPLIT = True

    def setAcceleration(self, accel_mmss):
        self.ACCEL_L = accel_mmss / 1000.0
        self.SPLIT = True

    def setSpeedJoints(self, speed_degs):
        self.SPEED_J = math.radians(min(speed_degs, 150.0))
        self.SPLIT = True

    def setAccelerationJoints(self, accel_degss):
        self.ACCEL_J = math.radians(accel_degss)
        self.SPLIT = True

    def setZoneData(self, zone_mm):
        self.ZONE = zone_mm
        self.SPLIT = True

    
    def _item(self, ctype, alias, attrs):
        uid = self._uuid()
        self._add(_Node(ctype, alias, uid, attrs))
        self.addline("--(Logic tree item : %s) %s" % (ctype, alias))
        self.addline('set_current_logic_tree_item("%s")' % uid)

    def Pause(self, time_ms):
        if time_ms is None or time_ms <= 0:
            self._uuid()
            self.PROG.lines.append("  halt() # reimplement this function to force stop")
            return
        self._item("Wait", "Wait", [("WaitConditionMode", "Time"), ("WaitTime", repr(time_ms / 1000.0))])
        self.addline("sleep(%.3f)" % (time_ms / 1000.0))
        self.addline("set_step_breakpoint()")

    def RunMessage(self, message, iscomment=False):
        if iscomment:
            self._uuid()
            self.addline("-- %s" % message)
            return
        self._item(
            "Message",
            "Message",
            [("EnableStopProgramRunningWhenMessagePopsUp", "false"), ("MessageContent", message), ("MessageType", "Information")],
        )
        self.addline('popup_message(0, "%s", false)' % message)

    def RunCode(self, code, is_function_call=False):
        self._uuid()
        if is_function_call:
            proc = _Node("Procedure", code, None, [("MD5", PROCEDURE_MD5), ("ProcedureName", code)])
            self._add(proc)
            self.PENDING.append(proc)
            self.addline("--(Logic tree item : Procedure) %s" % code)
            self.addline("%s()" % code)
        else:
            self.PROG.lines.append("  -- %s" % code)

    def _set(self, name, value, io_type, lua_value):
        self._item(
            "Set",
            "Set",
            [
                ("SetConditionMode", "IO"),
                ("Duration", "0"),
                ("IOCategory", "User"),
                ("IOName", name),
                ("IOValue", value),
                ("IsPulseSignal", "false"),
                ("RobotIOType", io_type),
            ],
        )
        self.addline('set_robot_io_status(RobotIOType.%s, "%s", %s)' % (io_type, name, lua_value))
        self.addline("set_step_breakpoint()")

    def setDO(self, io_var, io_value):
        name = "U_DO_%02d" % io_var if isinstance(io_var, int) and not isinstance(io_var, bool) else str(io_var)
        v = _true(io_value)
        self._set(name, str(v), "RobotBoardUserDO", str(v))

    def setAO(self, io_var, io_value):
        if not (isinstance(io_var, int) and not isinstance(io_var, bool)):
            raise UnboundLocalError("local variable 'ao_type' referenced before assignment")
        name = "VO%d" % io_var if io_var < 2 else "CO%d" % (io_var - 2)
        try:
            v = float(io_value)
        except (TypeError, ValueError):
            return
        self._set(name, str(io_value), "RobotBoardUserAO", "%.2f" % v)

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        name = "U_DI_%02d" % io_var if isinstance(io_var, int) and not isinstance(io_var, bool) else str(io_var)
        v = _true(io_value)
        self._item("Wait", "Wait", [("WaitConditionMode", "Exp"), ("WaitConditionExp", "(U,DI)%s == %d" % (name, v))])
        self.addline('while (not (    get_robot_io_status(RobotIOType.RobotBoardUserDI, "%s") == %d)) do' % (name, v))
        self.addline("sleep(0.01)", 2)
        self.addline("end")
