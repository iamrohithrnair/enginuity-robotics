


































from __future__ import annotations

import datetime
import re

from ..base import RobotPost, register
from ..robomath import euler_zyx

COMMENT_CHUNK = 73
MESSAGE_CHUNK = 25
FOOTER = ["//set total pose number and use lua to tranf pose in user to in_base", "SET B010 %d", "SET B000 1", "TIMER T=0.2 S", "WAIT B000=0  "]


def _num(v):
    s = ("%.5f" % v).rstrip("0")
    return s + "0" if s.endswith(".") else s


def _pose(pose):
    rz, ry, rx = euler_zyx(pose)
    return ",".join([str(pose[0][3]), str(pose[1][3]), str(pose[2][3])] + [_num(a * 3.14159 / 180) for a in (rx, ry, rz)])


def _chunks(text, n):
    return [text[k : k + n] for k in range(0, max(len(text), 1), n)]


def filter_name(name):
    s = re.sub(r"[^A-Za-z0-9_()]", "", str(name))
    return "P" + s if s[:1].isdigit() else s


@register
class EliteRobotsECV3(RobotPost):
    name = "Elite_Robots_EC_V3"
    VOLATILE = (rb"// DATE \d{4}/\d\d/\d\d \d\d:\d\d",)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.OUT = []  
        self.MOTIONS = []
        self.V_IDX = 0
        self.P_IDX = 0
        self.FIRST_ARC = True
        self.SPLIT_PROG = None
        self.BASE = None
        self.PARTS = []
        self.LINES = []
        self.COUNT = 0
        self.STR_V = "V=100.0"
        self.STR_VJ = "VJ=100%"
        self.STR_CR = "CR=0.0MM"

    
    def _render(self, lines):
        date = datetime.datetime.now().strftime("%Y/%m/%d %H:%M")
        out = ["NOP", "// HEADER", "// DATE %s" % date, "// COMM Generated using Enginuity"] + lines
        out += [FOOTER[0], FOOTER[1] % (self.V_IDX - 1)] + FOOTER[2:] + self.MOTIONS + ["END"]
        return "".join(l + "\n" for l in out)

    def _part_name(self):
        return self.BASE if len(self.PARTS) == 0 else "%s%d" % (self.BASE, len(self.PARTS) + 1)

    def ProgStart(self, progname):
        self.BASE = progname
        self.PARTS = []
        self.LINES = []
        self.COUNT = 0
        self.P_IDX = 0

    def _split(self):
        if self.SPLIT_PROG is not None and self.SPLIT_PROG != self.BASE:
            raise Exception("Only one program at a time can be split into smaller programs")
        self.SPLIT_PROG = self.BASE
        self.PARTS.append((self._part_name(), self._render(self.LINES)))
        self.LINES = []
        self.COUNT = 0
        self.P_IDX = 0

    def _check(self):
        pass
        if self.MAX_LINES_X_PROG > 0 and self.COUNT >= self.MAX_LINES_X_PROG:
            self._split()

    def addline(self, line):
        self._check()
        self.LINES.append(line)
        self.COUNT += 1

    def addmotion(self, line):
        self._check()
        self.MOTIONS.append(line)
        self.COUNT += 1

    def ProgFinish(self, progname):
        if self.BASE is None:
            return
        last = (self._part_name(), self._render(self.LINES))
        if self.PARTS:
            parts = self.PARTS + [last]
            main = ("M_%s" % self.BASE, self._render(["CALL JOB:%s" % n for n, _t in parts]))
            self.OUT.append([main] + parts)
        else:
            self.OUT.append([last])
        self.BASE = None

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        if self.BASE is not None:
            self.ProgFinish(self.BASE)
        for files in reversed(self.OUT):
            for name, text in files:
                self.save_file(folder, "%s.jbi" % name, text)

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def _tail(self, speed):
        return "%s %s ACC=50 DEC=50" % (speed, self.STR_CR)

    def MoveJ(self, pose, joints, conf_RLF=None):
        if pose is None:
            self._check()
            return
        n = self.P_IDX
        self.P_IDX += 1
        self.addline("SETJOINT P%03d %s" % (n, ",".join("%.5f" % j for j in joints)))
        self.addmotion("MOVJ P%03d %s" % (n, self._tail(self.STR_VJ)))

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is None:
            self._check()
            return
        n = self.V_IDX
        self.addline("SETPOSE V%03d %s" % (n, _pose(pose)))
        self.V_IDX += 1
        self.addmotion("MOVL V%03d %s" % (n, self._tail(self.STR_V)))

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            self._check()
            return
        n = self.V_IDX
        self.V_IDX += 2
        tail = self._tail(self.STR_V)
        self.addline("SETPOSE V%03d %s" % (n, _pose(pose1)))
        if self.FIRST_ARC:
            self.FIRST_ARC = False
            self.addmotion("MOVC V%03d %s" % (n - 1, tail))
        self.addmotion("MOVC V%03d %s" % (n, tail))
        self.addline("SETPOSE V%03d %s" % (n + 1, _pose(pose2)))
        self.addmotion("MOVC V%03d %s" % (n + 1, tail))

    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.addline("SETPOSE V000 %s" % _pose(pose))
        self.addline("SETUSERFRAME USER #(1) V000")

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.addline("SETPOSE V000 %s" % _pose(pose))
        self.addline("SETTOOLFRAME TOOL#(1) V000")
        self.addline("SETTOOLNUMBER TF=1")

    def Pause(self, time_ms):
        self.addline("TIMER T=%s" % (time_ms / 1000))

    def setSpeed(self, speed_mms):
        self.STR_V = "V=%dMM/S" % max(0, min(speed_mms, 3000))

    def setAcceleration(self, accel_mmss):
        pass

    def setSpeedJoints(self, speed_degs):
        self.STR_VJ = "VJ=%d%%" % max(1, min(round(speed_degs), 100))

    def setAccelerationJoints(self, accel_degss):
        pass

    def setZoneData(self, zone_mm):
        self.STR_CR = "CR=%.1fMM" % max(0, min(round(zone_mm), 7))

    def setDO(self, io_var, io_value):
        name = io_var if isinstance(io_var, str) else "OT#(%s)" % io_var
        self.addline("DOUT %s %s" % (name, io_value))

    def setAO(self, io_var, io_value):
        if not isinstance(io_value, str):
            io_value > 0  # noqa: B015  (the reference post compares the value: None fails with a TypeError)
        name = io_var if isinstance(io_var, str) else "AO#(%s)" % io_var
        self.addline("AOUT %s %s" % (name, io_value))

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        name = io_var if isinstance(io_var, str) else "IN#(%s)" % io_var
        line = "WAIT %s=%s" % (name, io_value)
        if timeout_ms is not None and timeout_ms > 0:
            line += " T=%s" % (timeout_ms / 1000)
        self.addline(line)

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            self.addline("CALL JOB:%s" % filter_name(code))
        else:
            self.addline(code)

    def RunMessage(self, message, iscomment=False):
        if iscomment:
            for piece in _chunks(message, COMMENT_CHUNK):
                self.addline("// " + piece)
        else:
            for piece in _chunks(message, MESSAGE_CHUNK):
                self.addline("TPWRITE " + piece)
