# Generates Nachi AX/FD and OTC programs with numbered motion steps.



















import re

from ..base import RobotPost, register
from ..robomath import mul, eye, xyzabc

JOINT_TARGET_C = "' Circular movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."


def _number(name, default=-1):
    numbers = re.findall(r"\d+", name or "")
    return int(numbers[-1]) if numbers else default


def _values(values, fmt):
    return ",".join(fmt % v for v in values)


@register
class NachiAxFd(RobotPost):
    name = "Nachi_AX_FD"
    
    DEFAULT_MODEL = "MZ07L"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.PROGS = []
        self.LINES = []
        self.FRAME = eye()
        self.SPEED = 500.0
        self.TOOL = 1
        self.SMOOTH = ""  

    def addline(self, line):
        self.LINES.append(line)

    def ProgStart(self, progname):
        self.CUR = progname
        self.LINES = []

    def ProgFinish(self, progname):
        self.PROGS.append((self.CUR, self.LINES))
        self.LINES = []

    
    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        words = self.ROBOT_NAME.split(" ")
        base = "%s-01-A" % (words[1] if len(words) > 1 else self.DEFAULT_MODEL)
        lines = self.PROGS[0][1] if self.PROGS else self.LINES
        number = _number(progname, 5)
        n = self.MAX_LINES_X_PROG
        if n <= 0 or len(lines) < n:
            self.save_file(folder, "%s.%03i" % (base, number), "\n".join(lines + ["END"]) + "\n")
            return
        parts = [lines[k : k + n] for k in range(0, len(lines), n)]
        if len(lines) % n == 0:
            parts.append([])  
        for k, part in enumerate(parts):
            trailer = ["END"] if k == len(parts) - 1 else ["END", "' Program %s" % progname]
            self.save_file(folder, "%s.%03i" % (base, number + 1 + k), "\n".join(part + trailer) + "\n")
        main = ["' Main program %s calls %i subprograms" % (progname, len(parts))]
        main += ["CALLP [%03i]" % (number + 1 + k) for k in range(len(parts))] + ["END"]
        self.save_file(folder, "%s.%03i" % (base, number), "\n".join(main) + "\n")

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def _tail(self, joints):
        tail = ",S=%.2f,H=%i,MS" % (self.SPEED, self.TOOL)
        if self.ROBOT_AXES > 6:  
            tail += ",M2J,P(%s),R= 100, H=1" % _values(list(joints)[6:], "%6.2f")
        return tail

    def _joint_move(self, kind, joints):
        smooth = "" if kind == "P" else self.SMOOTH  
        self.addline("MOVEX %sM1J,%s,(%s)%s" % (smooth, kind, _values(list(joints)[:6], "%.5f"), self._tail(joints)))

    def _linear_move(self, kind, pose, joints):
        self.addline("MOVEX %sM1X,%s,(%s)%s" % (self.SMOOTH, kind, _values(xyzabc(pose), "%.3f"), self._tail(joints)))

    def MoveJ(self, pose, joints, conf_RLF=None):
        self._joint_move("P", joints)

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is None:
            self._joint_move("L", joints)
        else:
            self._linear_move("L", mul(self.FRAME, pose), joints)

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            self._joint_move("C1", joints1)
            self._joint_move("C2", joints2)
            return
        frame2 = mul(self.FRAME, self.FRAME)  
        self._linear_move("C1", mul(frame2, pose1), joints1)
        self._linear_move("C2", mul(frame2, pose2), joints2)

    
    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.FRAME = pose
        self.addline("' Using reference frame:")
        self.addline("' USERFRAME=(%s)" % _values(xyzabc(pose), "%.3f"))
        self.addline("' (using all targets with respect to the robot base)")
        self.addline("CHGCOORD 0")

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.TOOL = tool_id if tool_id is not None and tool_id >= 0 else 1
        self.addline("' Using the tool:")
        self.addline("' TOOL%i=(%s)" % (self.TOOL, _values(xyzabc(pose), "%.3f")))
        self.addline("MOVEX M1J,P,P*,S=%.1f,H=%i,MS" % (self.SPEED, self.TOOL))

    def Pause(self, time_ms):
        if time_ms <= 0:
            self.addline("PAUSE 99999")
        else:
            self.addline("PAUSE %.3f" % (time_ms / 1000.0))

    def setSpeed(self, speed_mms):
        self.SPEED = speed_mms

    def setAcceleration(self, accel_mmss):
        pass

    def setSpeedJoints(self, speed_degs):
        pass

    def setAccelerationJoints(self, accel_degss):
        pass

    def setZoneData(self, zone_mm):
        self.SMOOTH = ("A=1P," if zone_mm < 0 else "") + "SM=%i," % min(3, int(max(zone_mm, 0) / 25.0))

    
    def setDO(self, io_var, io_value):
        var = io_var if isinstance(io_var, str) else "[%02i]" % io_var
        on = isinstance(io_value, str) or io_value > 0
        self.addline("%s %s" % ("SET" if on else "RESET", var))

    def setAO(self, io_var, io_value):
        self.setDO(io_var, io_value)

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        var = io_var if isinstance(io_var, str) else "[%02i]" % io_var
        cmd = "" if isinstance(io_value, str) else ("WAITI" if io_value > 0 else "WAITJ")
        self.addline("%s %s" % (cmd, var))

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            name = re.sub(r"[^A-Za-z0-9_()]", "", code)
            self.addline("' Call program %s:" % name)
            self.addline("CALLP %03i" % _number(name))
        else:
            self.addline(code)

    def RunMessage(self, message, iscomment=False):
        if iscomment:
            self.addline("' %s" % message)
        else:
            self.addline('REM "%s"' % message)


@register
class Otc(NachiAxFd):
    pass

    name = "OTC"
