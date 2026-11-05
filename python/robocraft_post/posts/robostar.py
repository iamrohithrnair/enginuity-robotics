# Generates Robostar JOB files with numbered points and split motion routines.




















import re

from ..base import RobotPost, register
from ..robomath import xyzwpr


def _round(value, low, high=None):
    v = int(round(value))
    v = max(low, v)
    return min(high, v) if high is not None else v


def _value(value):
    if isinstance(value, str):
        return value
    return "%d" % int(round(value))


class _Job:
    def __init__(self, name):
        self.name = name
        self.points = []
        self.lines = []


@register
class Robostar(RobotPost):
    name = "Robostar"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.JOBS = []
        self.JOB = None
        self.PARTS = []
        self.SPEED_J = None
        self.SPEED_L = None

    
    def _check_split(self):
        if self.MAX_LINES_X_PROG > 0 and len(self.JOB.lines) >= self.MAX_LINES_X_PROG:
            self.PARTS.append(self.JOB)
            self.JOB = _Job("%s%d" % (self.PARTS[0].name, len(self.PARTS) + 1))

    def addline(self, line):
        self.JOB.lines.append(line)

    def _instruction(self, *lines):
        self._check_split()
        for line in lines:
            self.addline(line)

    def ProgStart(self, progname):
        self.JOB = _Job(progname.upper())
        self.PARTS = []

    def ProgFinish(self, progname):
        if self.PARTS:
            self.PARTS.append(self.JOB)
            self.JOBS += self.PARTS
            main = _Job("M_" + self.PARTS[0].name)
            main.lines = ["JCALL %s" % j.name for j in self.PARTS]
            self.JOBS.append(main)
        else:
            self.JOBS.append(self.JOB)
        self.JOB = None
        self.PARTS = []

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        for job in self.JOBS:
            out = ["0,%d,%d" % (len(job.points), len(job.lines) + 2), "[DESC]", "[PNT] 6"]
            out += job.points
            out += ["[JOB]", "MAIN"] + job.lines + ["EOP"]
            self.save_file(folder, "%s.JOB" % job.name, "\n".join(out))

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def _point(self, pose, joints, conf):
        if pose is None:
            values = list(joints)[:8]
            values += [0.0] * (8 - len(values))
            flags = "000"
        else:
            values = xyzwpr(pose) + [0.0, 0.0]
            flags = "".join("%d" % (c + 1) for c in (conf or [0, 0, 0])[:3])
        n = len(self.JOB.points)
        self.JOB.points.append("%03d,%s,%s,0,0" % (n, ",".join("%11.4f" % v for v in values), flags))
        return n

    def MoveJ(self, pose, joints, conf_RLF=None):
        self._check_split()
        n = self._point(None, joints, None)
        self.addline("JMOV P%d%s" % (n, "" if self.SPEED_J is None else ", VEL=%d" % self.SPEED_J))

    def MoveL(self, pose, joints, conf_RLF=None):
        self._check_split()
        n = self._point(pose, joints, conf_RLF)
        self.addline("LMOV P%d%s" % (n, "" if self.SPEED_L is None else ", VEL=%d" % self.SPEED_L))

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        self._check_split()
        a = self._point(pose1, joints1, conf_RLF_1)
        b = self._point(pose2, joints2, conf_RLF_2)
        self.addline("CMOV P%d P%d%s" % (a, b, "" if self.SPEED_L is None else ", VEL=%d" % self.SPEED_L))

    
    def _close_to(self, kind, pose, ident, name):
        self._instruction(
            "",
            "// %s %d (%s) should be close to:" % (kind, max(0, ident if ident is not None else 0), name),
            "// %s" % ",".join("%.1f" % v for v in xyzwpr(pose)),
        )

    def setFrame(self, pose, frame_id=None, frame_name=None):
        self._close_to("Frame", pose, frame_id, frame_name)

    def setTool(self, pose, tool_id=None, tool_name=None):
        self._close_to("Tool", pose, tool_id, tool_name)

    def Pause(self, time_ms):
        if time_ms <= 0:
            self._instruction("STOP")
        else:
            self._instruction("DLAY %d" % int(round(time_ms)))

    def setSpeed(self, speed_mms):
        self.SPEED_L = _round(speed_mms / 10.0, 1)

    def setAcceleration(self, accel_mmss):
        pass

    def setSpeedJoints(self, speed_degs):
        self.SPEED_J = _round(speed_degs, 1, 100)

    def setAccelerationJoints(self, accel_degss):
        pass

    def setZoneData(self, zone_mm):
        self._instruction("FOS %d" % _round(zone_mm, 0, 100))

    
    def setDO(self, io_var, io_value):
        self._instruction("OUT(%s)=%s" % (io_var, _value(io_value)))

    setAO = setDO

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        lines = []
        if timeout_ms is not None and timeout_ms >= 0:
            lines.append("// Timeout not implemented: %d ms" % int(round(timeout_ms)))
        lines.append("IN(%s)=%s" % (io_var, _value(io_value)))
        self._instruction(*lines)

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            self._instruction("JCALL %s" % re.sub(r"[^A-Za-z0-9_()]", "", code).upper())
        else:
            self._instruction(code)

    def RunMessage(self, message, iscomment=False):
        self._instruction(("// %s" if iscomment else "// Message: %s") % message)
