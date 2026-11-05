# Emits CLOOS motion programs and pulse-encoded point tables.

























import re

from ..base import RobotPost, register
from ..robomath import xyzwpr

TXT_HEAD = "RESTART\nLIST 1=(4211,3,0,49,91,20,530,0,0,40,50,0,0,0,0,0,0,3,0,0,3,0)\n\nMAIN\nSTCP (10,0,4998)\nSTOV (-1,0,-1)\n$ (1)\n\n"
ZERO = 4194304  


def _onoff(value) -> str:
    if isinstance(value, str):
        return value
    return "ON" if value > 0 else "OFF"


def _pose(pose) -> str:
    return ",".join("%.1f" % v for v in xyzwpr(pose))


class _Part:
    def __init__(self):
        self.lines = []
        self.points = []


@register
class Cloos(RobotPost):
    name = "CLOOS"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.PROGS = []  
        self.PARTS = None
        self.SPEED = 50

    
    def _part(self):
        part = self.PARTS[-1]
        if self.MAX_LINES_X_PROG > 0 and len(part.lines) >= self.MAX_LINES_X_PROG:
            part = _Part()
            self.PARTS.append(part)
        return part

    def addline(self, line):
        self._part().lines.append(line)

    def _enc(self, values):
        pulses = self.PULSES_X_DEG or []
        return ",".join("%010d" % (ZERO + round(v * pulses[i] if i < len(pulses) and pulses[i] else v)) for i, v in enumerate(values))

    def _point(self, joints, kind, code):
        part = self._part()
        values = list(joints) if joints is not None else [0.0] * self.ROBOT_AXES
        part.points.append("%05d,%05d,%05d,00000," % (len(part.points) + 1, int(self.SPEED), kind) + self._enc(values))
        part.lines.append("%s (%d)" % (code, len(part.points)))

    def ProgStart(self, progname):
        self.PARTS = [_Part()]
        self.PROGS.append((progname, self.PARTS))
        saved, self.SPEED = self.SPEED, 50
        self._point([0.0] * self.ROBOT_AXES, 1, "GP")
        self.SPEED = saved

    def ProgFinish(self, progname):
        pass

    def _files(self, folder, name, part):
        txt = TXT_HEAD + "".join(l + "\n" for l in part.lines) + "\nEND\n"
        pkt = "( Robot     : 310 )\n( Serial Nr : 3511462 )\n( Achszahl  : %d )\n( Resolution: %s Konfigend)\n" % (self.ROBOT_AXES, "2:" * self.ROBOT_AXES)
        pkt += "".join(p + "\n" for p in part.points)
        self.save_file(folder, "%s.txt" % name, txt)
        self.save_file(folder, "%s.pkt" % name, pkt)

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        for name, parts in self.PROGS:
            if len(parts) == 1:
                self._files(folder, name[:7], parts[0])
                continue
            names = [name[:7] + ("" if i == 0 else str(i + 1)) for i in range(len(parts))]
            main = _Part()
            main.points.append("%05d,%05d,%05d,00000," % (1, 50, 1) + ",".join("%010d" % ZERO for _ in range(self.ROBOT_AXES)))
            main.lines = ["GP (1)"] + ["CALL %s" % n[:7] for n in names]
            self._files(folder, "M_" + name[:5], main)
            for n, part in zip(names, parts):
                self._files(folder, n, part)

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def MoveJ(self, pose, joints, conf_RLF=None):
        self._point(joints, 1, "GP")

    def MoveL(self, pose, joints, conf_RLF=None):
        self._point(joints, 0, "GC")

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            self.addline("! Circular movement using joint targets is not supported. Change the target type to cartesian or use a joint movement.")
            return
        part = self._part()
        prev = len(part.points)
        for joints in (joints1, joints2):
            part.points.append("%05d,%05d,%05d,00000," % (len(part.points) + 1, int(self.SPEED), 0) + self._enc(joints))
        part.lines.append("ARC (%d,%d,%d)" % (prev, prev + 1, prev + 2))

    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.addline("! Using %s (targets wrt base):" % frame_name)
        self.addline("! " + _pose(pose))

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.addline("! Tool %s should be close to:" % tool_name)
        self.addline("! " + _pose(pose))

    def Pause(self, time_ms):
        self.addline("PAUSE" if time_ms <= 0 else "WAITM %d" % round(time_ms))

    def setSpeed(self, speed_mms):
        self.SPEED = speed_mms

    def setAcceleration(self, accel_mmss):
        pass

    def setSpeedJoints(self, speed_degs):
        pass

    def setAccelerationJoints(self, accel_degss):
        pass

    def setZoneData(self, zone_mm):
        pass

    
    def setDO(self, io_var, io_value):
        var = io_var if isinstance(io_var, str) else "OT#(%s)" % io_var
        self.addline("DOUT %s %s" % (var, _onoff(io_value)))

    def setAO(self, io_var, io_value):
        self.setDO(io_var, io_value)

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        var = io_var if isinstance(io_var, str) else "IN#(%s)" % io_var
        line = "WAIT %s=%s" % (var, _onoff(io_value))
        if timeout_ms is not None and timeout_ms >= 0:
            line += " T=%.2f" % (timeout_ms * 0.001)
        self.addline(line)

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            self.addline("CALL %s" % re.sub(r"[^A-Za-z0-9_()]", "", code)[:7])
        else:
            self.addline(code)

    def RunMessage(self, message, iscomment=False):
        self.addline("! %s" % message if iscomment else "! MSG %s" % message)
