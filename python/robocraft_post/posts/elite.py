# Builds Elite CS motion tasks and accompanying controller configuration files.







































from __future__ import annotations

import math
import random
import re
import time
import uuid
import xml.etree.ElementTree as ET

from ..base import PostError, RobotPost, register
from ..robomath import euler_zyx

_UNITS = {
    "AngularSpeed": ("cn.elibot.robot.plugin.domain.value.AngularSpeed$Unit", "RAD_S"),
    "AngularAcceleration": ("cn.elibot.robot.plugin.domain.value.AngularAcceleration$Unit", "RAD_S2"),
    "Speed": ("cn.elibot.robot.plugin.domain.value.Speed$Unit", "M_S"),
    "Acceleration": ("cn.elibot.robot.plugin.domain.value.Acceleration$Unit", "M_S2"),
    "Length": ("cn.elibot.robot.plugin.domain.value.Length$Unit", "M"),
    "Time": ("cn.elibot.robot.plugin.domain.value.Time$Unit", "S"),
}

_EMPTY_FOLDER = "\n" + " " * 24 + "\n"
_TIMER = "计时器_1"
_PINS = tuple(str(i) for i in range(15))
_HIGH = ("1", "True")
_LOW = ("0", "False")


class _Stop(Exception):
    pass


def _rad_pose(pose):
    rz, ry, rx = euler_zyx(pose)
    return [math.radians(rx), math.radians(ry), math.radians(rz)]


def _value(parent, tag, value, unit):
    e = ET.SubElement(parent, tag)
    ET.SubElement(e, "valueInSi").text = repr(value)
    cls, si = _UNITS[unit]
    ET.SubElement(e, "siUnit", {"class": cls}).text = si
    ET.SubElement(e, "xmlElementName").text = unit
    ET.SubElement(e, "supportType").text = cls.replace(".domain.value.", ".core.domain.value.").split("$")[0] + "Impl"
    return e


def _level(value):
    s = str(value)
    if s in _HIGH:
        return True
    if s in _LOW:
        return False
    raise _Stop()


def _pin(name):
    s = str(name)
    if s not in _PINS:
        raise _Stop()
    return s


@register
class EliteRobotsCS(RobotPost):
    name = "Elite_Robots_CS"
    VOLATILE = (rb'savedTime="[^"]*"',)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.PROGS = []  
        self.CURRENT = None
        self.TOOLS = []  
        self.FRAMES = []
        self.TOOL = None
        self.FRAME = None
        self.SPEED_J = math.radians(60)
        self.ACCEL_J = math.radians(80)
        self.SPEED = 0.25
        self.ACCEL = 1.2
        self.ZONE = -1.0

    
    def _add(self, *ins):
        if self.CURRENT is None:
            self.ProgStart("Prog")
        self.CURRENT.append(ins)

    def _state(self):
        return dict(frame=self.FRAME, tool=self.TOOL, sj=self.SPEED_J, aj=self.ACCEL_J, s=self.SPEED, a=self.ACCEL, zone=self.ZONE)

    def ProgStart(self, progname):
        self.CURRENT = []
        self.PROGS.append((progname, self.CURRENT))

    def ProgFinish(self, progname):
        pass

    def _entry(self, table, name, pose):
        if not isinstance(name, str):
            raise TypeError("Argument 'varStr' has incorrect type (expected str, got %s)" % type(name).__name__)
        base = re.sub(r"\W", "_", name)
        value = ", ".join(repr(v) for v in [pose[0][3], pose[1][3], pose[2][3]] + _rad_pose(pose))
        candidate, n = base, 0
        while True:
            found = [v for k, v in table if k == candidate]
            if not found:
                table.append((candidate, value))
                return candidate
            if found[0] == value:
                return candidate
            n += 1
            candidate = "%s_%d" % (base, n)

    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.FRAME = self._entry(self.FRAMES, frame_name, pose)

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.TOOL = self._entry(self.TOOLS, tool_name, pose)

    def MoveJ(self, pose, joints, conf_RLF=None):
        self._add("movej", pose, joints, self._state())

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is None:
            self._add("comment", "Linear movement using joint targets is not supported. Change the target type to cartesian or use a joint movement.")
            return
        self._add("movel", pose, joints, self._state())

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            self._add("comment", "Circular movement using joint targets is not supported. Change the target type to cartesian or use a joint movement.")
            return
        self._add("movec", (pose1, joints1, pose2, joints2), None, self._state())

    def Pause(self, time_ms):
        self._add("pause", time_ms)

    def setSpeed(self, speed_mms):
        self.SPEED = speed_mms / 1000

    def setAcceleration(self, accel_mmss):
        self.ACCEL = accel_mmss / 1000

    def setSpeedJoints(self, speed_degs):
        self.SPEED_J = math.radians(speed_degs)

    def setAccelerationJoints(self, accel_degss):
        self.ACCEL_J = math.radians(accel_degss)

    def setZoneData(self, zone_mm):
        self.ZONE = zone_mm

    def setDO(self, io_var, io_value):
        self._add("do", io_var, io_value)

    def setAO(self, io_var, io_value):
        pass

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        self._add("di", io_var, io_value, timeout_ms)

    def RunCode(self, code, is_function_call=False):
        self._add("call" if is_function_call else "code", code)

    def RunMessage(self, message, iscomment=False):
        self._add("comment" if iscomment else "popup", message)

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def _waypoint(self, parent, name, pose, joints, st, radius, custom, option="SPEED_AND_ACCELERATION", inherited=False):
        w = ET.SubElement(parent, "WaypointNode", {"name": name, "positionNodeType": "FIXED_POSITION", "kinematicFlag": "-1",
                                                   "customTransitionRadius": "true" if custom else "false",
                                                   "advancedPositionOptionType": option, "typeName": "路点"})
        if inherited:
            ET.SubElement(w, "transitionRadius", {"reference": "../../../inheritedProcessMoveTransitionRadius"})
        else:
            _value(w, "transitionRadius", radius, "Length")
        ip = ET.SubElement(w, "internalPosition")
        ET.SubElement(ip, "jointPositions", {"joints": ", ".join(repr(math.radians(j)) for j in joints)})
        if pose is None:
            xyz, rpw = [0.0, 0.0, 0.0], [0.0, 0.0, 0.0]
        else:
            xyz, rpw = [pose[0][3], pose[1][3], pose[2][3]], _rad_pose(pose)
        ET.SubElement(ip, "toolPose", dict(zip(("X", "Y", "Z", "RX", "RY", "RZ"), (repr(v) for v in xyz + rpw))))
        fp = ET.SubElement(w, "fromPosition")
        ET.SubElement(fp, "jointPositions", {"joints": ", ".join(["NaN"] * len(joints))})
        ET.SubElement(fp, "toolPose", {"X": "0.0", "Y": "0.0", "Z": "0.0", "RX": "0.0", "RY": "0.0", "RZ": "0.0"})
        _value(w, "jointSpeed", st["sj"], "AngularSpeed")
        _value(w, "jointAcceleration", st["aj"], "AngularAcceleration")
        _value(w, "cartesianSpeed", st["s"], "Speed")
        _value(w, "cartesianAcceleration", st["a"], "Acceleration")
        _value(w, "nextMotionTime", 0.0, "Time")
        bp = ET.SubElement(w, "Pose", {"key": "baseToFrame"})
        pos = ET.SubElement(bp, "Position", {"key": "posePosition"})
        for k in "XYZ":
            ET.SubElement(pos, "Length", {"key": k, "value": "0.0", "unit": "M"})
        rot = ET.SubElement(bp, "Rotation", {"key": "poseRotation"})
        for k in ("RX", "RY", "RZ"):
            ET.SubElement(rot, "Angle", {"key": k, "value": "0.0", "unit": "RAD"})

    def _move(self, parent, kind, target, joints, st):
        tcp = "USER_DEFINED_TCP" if st["tool"] else "ACTIVE_TCP"
        if kind == "movej":
            attrs = ("JOINT_MOVEMENT", "JOINT_ANGLES", "MoveJ")
        elif kind == "movel":
            attrs = ("LINEAR_MOVEMENT", "CARTESIAN_POSE", "MoveL")
        else:
            attrs = ("PROCESS_MOVEMENT", "CARTESIAN_POSE", "MoveP")
        m = ET.SubElement(parent, "MoveNode", {"movementType": attrs[0], "positionType": attrs[1], "tcpType": tcp, "typeName": attrs[2]})
        ET.SubElement(m, "frameReference").text = st["frame"] or "Ctrl_base_frame"
        zone = st["zone"]
        radius = max(zone, 0) / 1000 if zone > 0 else 0.0
        if kind == "movej":
            _value(m, "jointSpeed", st["sj"], "AngularSpeed")
            _value(m, "jointAcceleration", st["aj"], "AngularAcceleration")
        else:
            _value(m, "cartesianSpeed", st["s"], "Speed")
            _value(m, "cartesianAcceleration", st["a"], "Acceleration")
        if kind == "movec":
            pose1, joints1, pose2, joints2 = target
            _value(m, "inheritedProcessMoveTransitionRadius", zone / 1000 if zone > 0 else 0.001, "Length")
            arc = ET.SubElement(m, "ArcMotion", {"orientationMode": "UNCONSTRAINED", "typeName": "圆弧移动"})
            self._waypoint(arc, "经过点", pose1, joints1, st, None, False, "INHERITED_PARAMETERS", inherited=True)
            self._waypoint(arc, "终点", pose2, joints2, st, radius, False)
        else:
            self.WP += 1
            self._waypoint(m, "路点_%d" % self.WP, target, joints, st, radius, zone > 0)
        if st["tool"]:
            ET.SubElement(m, "tcpToolNameReference").text = st["tool"]

    @staticmethod
    def _chars(parent, text):
        for ch in text:
            ET.SubElement(parent, "ExpressionCharCell", {"char": ch})

    def _convert(self, parent, instructions, depth=0):
        try:
            for ins in instructions:
                kind = ins[0]
                if kind in ("movej", "movel", "movec"):
                    self._move(parent, kind, ins[1], ins[2], ins[3])
                elif kind == "comment":
                    ET.SubElement(parent, "Comment", {"comment": ins[1], "typeName": "注释"})
                elif kind == "popup":
                    ET.SubElement(parent, "PopupNode", {"dialogType": "INFO", "contentType": "TEXT", "message": ins[1], "blockWhenPopup": "false", "typeName": "弹出窗口"})
                elif kind == "pause":
                    if ins[1] < 0:
                        ET.SubElement(parent, "PopupNode", {"dialogType": "INFO", "contentType": "TEXT", "message": "Pause", "blockWhenPopup": "false", "typeName": "弹出窗口"})
                    else:
                        w = ET.SubElement(parent, "WaitNode", {"type": "WAIT_TIME", "typeName": "等待"})
                        _value(w, "waitTime", ins[1] / 1000, "Time")
                elif kind == "do":
                    pin, high = _pin(ins[1]), _level(ins[2])
                    s = ET.SubElement(parent, "SetNode", {"type": "DIGITAL_OUTPUT", "typeName": "设置"})
                    ET.SubElement(s, "digitalOutputPinName").text = "digital_out[%s]" % pin
                    ET.SubElement(s, "digitalOutputPinValue").text = "HIGH" if high else "LOW"
                elif kind == "di":
                    pin, high = _pin(ins[1]), _level(ins[2])
                    timeout = ins[3]
                    if timeout is None or timeout < 0:
                        w = ET.SubElement(parent, "WaitNode", {"type": "WAIT_DIGITAL_INPUT", "typeName": "等待"})
                        ET.SubElement(w, "digitalInputType").text = "digital_in[%s]" % pin
                        ET.SubElement(w, "digitalValue").text = "HIGH" if high else "LOW"
                    else:
                        t = ET.SubElement(parent, "TimerNode", {"action": "RESET", "typeName": "计时器"})
                        ET.SubElement(t, "variable", {"name": _TIMER, "prefersPersistentValue": "false"})
                        t = ET.SubElement(parent, "TimerNode", {"action": "START", "typeName": "计时器"})
                        ET.SubElement(t, "variable", {"reference": "../../TimerNode/variable"})
                        w = ET.SubElement(parent, "WaitNode", {"type": "EXPRESSION", "typeName": "等待"})
                        e = ET.SubElement(w, "Expression")
                        self._chars(e, "get_standard_digital_in(%s)" % pin)
                        ET.SubElement(e, "ExpressionTokenCell", {"token": " ?= ", "scriptCode": "=="})
                        b = " True " if high else " False "
                        ET.SubElement(e, "ExpressionTokenCell", {"token": b, "scriptCode": b})
                        ET.SubElement(e, "ExpressionTokenCell", {"token": " or ", "scriptCode": " or "})
                        v = ET.SubElement(e, "ExpressionVariableCell")
                        ET.SubElement(v, "TaskVariable", {"reference": "../../../../TimerNode/variable"})
                        self._chars(e, "≥" + str(timeout / 1000))
                        t = ET.SubElement(parent, "TimerNode", {"action": "STOP", "typeName": "计时器"})
                        ET.SubElement(t, "variable", {"reference": "../../TimerNode/variable"})
                elif kind == "call":
                    f = ET.SubElement(parent, "FolderNode", {"display": ins[1], "isHideSubtree": "false", "typeName": "文件夹"})
                    sub = [p for n, p in self.PROGS if n == ins[1]]
                    if not sub or depth > 50:
                        ET.SubElement(f, "PlaceHolder", {"typeName": "占位节点"})
                    else:
                        self._convert(f, sub[0], depth + 1)
                        if len(f) == 0:
                            f.text = _EMPTY_FOLDER
                elif kind == "code":
                    raise TypeError("attrib must be dict, not set")
        except _Stop:
            pass

    def _uuids(self, n):
        rng = random.Random(0)
        return [str(uuid.UUID(int=rng.getrandbits(128), version=4)) for _ in range(n)]

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        if not self.PROGS:
            return
        self.WP = 0
        model = (self.ROBOT_NAME.split() or [""])[-1]
        task = ET.Element("EliTask", {"name": progname, "installationName": progname, "robotType": model, "typeName": "机器人主任务"})
        main = ET.SubElement(task, "MainTask", {"isTaskAlwaysLoops": "true", "hasBeforeStart": "false", "hasInitVariables": "false", "typeName": "机器人主任务"})
        self._convert(main, self.PROGS[0][1])
        ET.indent(task, "  ")

        m = re.match(r"CS6(\d+)$", model)
        ctype = "62" + (m.group(1).zfill(2) if m else model)
        ids = self._uuids(1 + len(self.TOOLS) + len(self.FRAMES))
        conf = ET.Element("ConfigurationSettings", {"robotType": ctype, "savedTime": time.strftime("%Y-%m-%d %H:%M:%S")})
        tools = ET.SubElement(conf, "ToolsManager", {"Active": ids[0]})
        t = ET.SubElement(tools, "TcpTool", {"name": "TCP", "uuid": ids[0]})
        ET.SubElement(t, "ToolShape", {"value": "0, 0, 0, 0.0, 0.0, 0.0"})
        k = 1
        for name, value in self.TOOLS:
            t = ET.SubElement(tools, "TcpTool", {"name": name, "uuid": ids[k]})
            ET.SubElement(t, "ToolShape", {"value": value})
            k += 1
        frames = ET.SubElement(conf, "FramesManager")
        for name, value in self.FRAMES:
            f = ET.SubElement(frames, "Frame", {"name": name, "isValid": "true", "isVariable": "true", "uuid": ids[k]})
            ET.SubElement(f, "Transform", {"value": value})
            k += 1
        if not self.FRAMES:
            frames.text = "\n  "
        ET.SubElement(conf, "IOConfig").text = "\n  "
        st = ET.SubElement(conf, "StartupConfigsManager")
        ET.SubElement(st, "config", {"needAutoLoad": "false", "triggerValueToRunTask": "false", "triggerValueToInit": "false"})
        ET.indent(conf, "  ")
        self.save_file(folder, "%s.task" % progname, ET.tostring(task, encoding="unicode"))
        self.save_file(folder, "%s.configuration" % progname, ET.tostring(conf, encoding="unicode"))
