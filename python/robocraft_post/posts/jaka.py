# Packages JAKA motion scripts, project metadata and variable definitions.





















import io
import json
import math
import random
import time
import uuid
import zipfile

from ..base import RobotPost, register
from ..robomath import mul, eye, xyzwpr

JOINT_TARGET_L = "# Linear movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."
JOINT_TARGET_C = "# Circular movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."
HEADER = [
    "# This script was generated with the JAKA post and is suitable for JAKA 1.7.x.",
    "",
    "# Global parameters:",
    "endPosJ =[0,0,0,0,0,0]",
    "endPosL =[0,0,0,0,0,0]",
    "pos_mvl =[0,0,0,0,0,0]",
    "pos_waypoint =[0,0,0,0,0,0]",
    "set_tool_id(0)",
    "set_user_frame_id(0)",
    "",
    "# Main program:",
]
STAGE = {"name": "Stage", "isStage": True, "x": 0, "y": 0, "size": 100, "direction": 90, "draggable": False, "visible": True, "rotationStyle": "allaround", "blocks": {}}
META = {
    "programVer": 15,
    "semver": "3.0.0",
    "vm": "0.1.0",
    "programMD5": "md5",
    "agent": "Mozilla/5.0(Linux;Android8.1.0;MIPAD4Build/OPM1.171019.019;wv)AppleWebKit/537.36(KHTML,likeGecko)Version/4.0Chrome/62.0.3202.84Safari/537.36",
}
VARIABLES = '{"serializableVariableItemLst":[],"Count":0}'


def _num(value, decimals=6):
    pass
    text = ("%%.%if" % decimals) % value
    text = text.rstrip("0").rstrip(".") if "." in text else text
    return "0" if text in ("-0", "") else text


def _nums(values, decimals=6, sep=","):
    return sep.join(_num(v, decimals) for v in values)


def _collinear(a, b, c):
    pass
    u = [b[i] - a[i] for i in range(3)]
    v = [c[i] - a[i] for i in range(3)]
    cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    return math.hypot(*cross) <= 1e-9 * max(1.0, math.hypot(*u) * math.hypot(*v))


def _bit(value):
    pass
    try:
        v = int(value) if isinstance(value, str) else value
    except ValueError:
        return None
    if v in (0, 1) and (not isinstance(v, float) or v.is_integer()):
        return int(v)
    return None


@register
class Jaka(RobotPost):
    name = "JAKA"
    PROG_EXT = "jks"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.PROGS = []
        self.LINES = []
        self.RNG = random.Random(0)
        self.FLAG = self._id()
        self.STAGE_ID = self._id()
        self.SPRITE_ID = self._id()
        self.BLOCKS = {}
        self.LAST_BLOCK = self.FLAG
        self.BLOCKS[self.FLAG] = {"id": self.FLAG, "opcode": "event_whenflagclicked", "inputs": {}, "fields": {}, "next": None, "topLevel": True,
                                  "parent": None, "shadow": False, "disabled": False, "x": 148, "y": -222}
        self.FRAME = eye()
        self.SPEED_J, self.ACCEL_J = 60, 200
        self.SPEED_L, self.ACCEL_L = 250, 250
        self.ZONE = 1.0
        self.PREV = None  

    def _id(self):
        return uuid.UUID(int=self.RNG.getrandbits(128), version=4).hex

    def addline(self, line):
        self.LINES.append(line)

    def ProgStart(self, progname):
        self.CUR = progname
        self.LINES = []

    def ProgFinish(self, progname):
        self.PROGS.append((self.CUR, self.LINES))
        self.LINES = []

    
    def _block(self, opcode, fields=None, inputs=None):
        pass
        bid = self._id()
        self.BLOCKS[self.LAST_BLOCK]["next"] = bid
        block = {"id": bid, "opcode": opcode, "inputs": {}, "fields": {}, "next": None, "topLevel": False, "parent": self.LAST_BLOCK, "shadow": False, "disabled": False}
        for name, value in (fields or []):
            block["fields"][name] = {"name": name, "value": value}
        subs = []
        for k, (name, sub_opcode, value, disabled) in enumerate(inputs or []):
            sid = "O%i%s" % (k + 1, bid)
            block["inputs"][name] = {"name": name, "block": sid, "shadow": sid, "disabled": "true" if disabled else "false"}
            field = "NUM" if sub_opcode.startswith("math") else "TEXT"
            subs.append((sid, {"id": sid, "opcode": sub_opcode, "inputs": {}, "fields": {field: {"name": field, "value": value}}, "next": None,
                               "topLevel": False, "parent": bid, "shadow": True, "disabled": "true" if disabled else False}))
        self.BLOCKS[bid] = block
        for sid, sub in subs:
            self.BLOCKS[sid] = sub
        self.LAST_BLOCK = bid

    def _project(self):
        sprite = dict(STAGE, name="Sprite1", isStage=False, blocks=self.BLOCKS)
        stage = dict(STAGE)
        data = {"targets": [dict({"id": self.STAGE_ID}, **stage), dict({"id": self.SPRITE_ID}, **sprite)], "meta": META}
        return json.dumps(data, separators=(",", ":"))

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        lines = self.PROGS[0][1] if self.PROGS else self.LINES
        n = self.MAX_LINES_X_PROG
        
        end = [] if n > 0 and lines and len(lines) % (n + 1) == 0 else ["# End of main program"]
        script = "\n".join(HEADER + lines + end) + "\n"
        project = self._project()
        self.save_file(folder, "%s.jks" % progname, script)
        self.save_file(folder, "%s.zu" % progname, project)
        self.save_file(folder, "variable.vi", VARIABLES)
        buf = io.BytesIO()
        stamp = time.localtime()[:6]
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as z:
            for name, content in (("%s.jks" % progname, script), ("%s.zu" % progname, project), ("variable.vi", VARIABLES)):
                info = zipfile.ZipInfo(name, date_time=stamp)
                info.external_attr = 0o100644 << 16
                info.create_system = 3
                z.writestr(info, content)
            info = zipfile.ZipInfo("sub/", date_time=stamp)
            info.external_attr = (0o40755 << 16) | 0x10
            info.create_system = 3
            z.writestr(info, "")
        self.save_file(folder, "%s.zip" % progname, buf.getvalue())

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def _blend(self, pos):
        pass
        if self.PREV is None or pos is None:
            zone = 0.0
        else:
            zone = min(self.ZONE, 0.4 * math.dist(self.PREV, pos))
        self.PREV = pos
        return round(zone, 3)

    def _infos(self, joints, pose_values, speed, accel, zone):
        return "%s|%s|%s|%s|2|%s|-1|-1,-1,0" % (_nums(list(joints)[:6]), pose_values, _num(speed), _num(accel), _num(zone))

    def MoveJ(self, pose, joints, conf_RLF=None):
        j = list(joints)[:6]
        self.addline("endPosJ=[%s]" % _nums(j, sep=", "))
        if pose is None:
            self.PREV = None
            self.addline("movj(endPosJ,0,%s,%s,0)" % (self.SPEED_J, self.ACCEL_J))
            self._block("jaka_move_combine", [("move_combine", "join")],
                        [("Name", "obj_text", "Point", False), ("MoveInfos", "text", self._infos(j, "0,0,0,0,0,0", self.SPEED_J, self.ACCEL_J, 0), True)])
            return
        zone = self._blend([pose[0][3], pose[1][3], pose[2][3]])
        self.addline("movj(endPosJ,0,%s,%s,%s)" % (self.SPEED_J, self.ACCEL_J, zone))
        base = _nums(xyzwpr(mul(self.FRAME, pose)))
        self._block("jaka_move_combine", [("move_combine", "join")],
                    [("Name", "obj_text", "Point", False), ("MoveInfos", "text", self._infos(j, base, self.SPEED_J, self.ACCEL_J, zone), True)])

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is None:
            self.addline(JOINT_TARGET_L)
            return
        j = list(joints)[:6]
        zone = self._blend([pose[0][3], pose[1][3], pose[2][3]])
        self.addline("endPosJ = [%s]" % _nums(j, sep=", "))
        self.addline("endPosL = [%s]" % _nums(xyzwpr(pose), sep=", "))
        self.addline("movl(endPosL,0,%s,%s,%s)" % (self.SPEED_L, self.ACCEL_L, zone))
        self._block("jaka_move_combine", [("move_combine", "line")],
                    [("Name", "obj_text", "Point", False), ("MoveInfos", "text", self._infos(j, _nums(xyzwpr(pose)), self.SPEED_L, self.ACCEL_L, zone), True)])

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            self.addline(JOINT_TARGET_C)
            return
        via = [pose1[0][3], pose1[1][3], pose1[2][3]]
        end = [pose2[0][3], pose2[1][3], pose2[2][3]]
        if self.PREV is None or _collinear(self.PREV, via, end):
            
            self.MoveL(pose2, joints2, conf_RLF_2)
            return
        zone = round(min(self.ZONE, 0.2 * math.dist(self.PREV, via)), 3)
        self.PREV = end
        self.addline("passPos = [%s]" % _nums(xyzwpr(pose1), sep=", "))
        self.addline("endPos = [%s]" % _nums(xyzwpr(pose2), sep=", "))
        self.addline("movc(passPos,endPos,0,%s,%s,%s,0)" % (self.SPEED_L, self.ACCEL_L, zone))
        infos = "%s|%s|%s|%s|%s|%s|2|%s|-1|-1,-1,0" % (_nums(list(joints1)[:6]), _nums(xyzwpr(pose1)), _nums(list(joints2)[:6]), _nums(xyzwpr(pose2)),
                                                       _num(self.SPEED_L), _num(self.ACCEL_L), _num(zone))
        self._block("jaka_move_circle", [], [("Point1", "obj_text", "Point1", False), ("Point2", "obj_text", "Point2", False), ("MoveInfos", "text", infos, True)])

    
    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.FRAME = pose
        self.addline("ucspos = [%s]" % _nums(xyzwpr(pose), 3, ", "))
        self.addline("set_user_frame(ucspos)")
        self._block("jaka_set_ucs", [], [("UcsName", "obj_text", "New_UCS", False), ("UcsInfos", "text", _nums(xyzwpr(pose)), True)])

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.addline("toolpos = [%s]" % _nums(xyzwpr(pose), 3, ", "))
        self.addline("set_tool(toolpos)")
        self._block("jaka_set_tcp", [], [("TcpName", "obj_text", "Tool", False), ("TcpInfos", "text", _nums(xyzwpr(pose)), True)])

    def Pause(self, time_ms):
        seconds = -0.001 if time_ms < 0 else time_ms / 1000.0
        self.addline("sleep(%s)" % _num(seconds))
        self._block("control_wait", [], [("DURATION", "math_whole_number", str(seconds), False)])

    def setSpeed(self, speed_mms):
        self.SPEED_L = speed_mms

    def setAcceleration(self, accel_mmss):
        self.ACCEL_L = accel_mmss

    def setSpeedJoints(self, speed_degs):
        self.SPEED_J = speed_degs

    def setAccelerationJoints(self, accel_degss):
        self.ACCEL_J = accel_degss

    def setZoneData(self, zone_mm):
        self.ZONE = max(zone_mm, 0)

    
    def setDO(self, io_var, io_value):
        state = _bit(io_value)
        if isinstance(io_var, str) or io_var < 1 or state is None:
            return
        self.addline("set_digital_output(0,%i,%i,1)" % (io_var - 1, state))
        self._block("jaka_set_do", [("JAKA_IO_Type", "0"), ("JAKA_DO_Name", str(io_var - 1)), ("JAKA_DO_State", str(state))])

    def setAO(self, io_var, io_value):
        try:
            value = float(io_value)
        except ValueError:
            return
        if isinstance(io_var, str) or io_var < 1:
            return
        index = io_var * 10 - 1
        self.addline("set_analog_output(0,%i,%s,1)" % (index, _num(value)))
        self._block("jaka_set_ao", [("JAKA_IO_Type", "0"), ("JAKA_AO_Name", str(index))], [("JAKA_AO_Value", "math_whole_number", _num(value), False)])

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        state = _bit(io_value)
        if isinstance(io_var, str) or io_var < 1 or state is None:
            return
        if timeout_ms is not None and timeout_ms >= 0:
            seconds = timeout_ms / 1000.0
            timeout, duration = _num(seconds), str(seconds)
        else:
            timeout = duration = "0"
        self.addline("wait_input(0,%i,%i,%s)" % (io_var - 1, state, timeout))
        self._block("jaka_di_wait", [("JAKA_IO_Type", "0"), ("JAKA_DI_Name", str(io_var - 1)), ("JAKA_DI_State", str(state))],
                    [("DURATION", "math_positive_number", duration, False)])

    def RunCode(self, code, is_function_call=False):
        if not is_function_call:
            self.addline(code)

    def RunMessage(self, message, iscomment=False):
        if iscomment:
            self.addline("# %s" % message)
