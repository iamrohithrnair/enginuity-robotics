# Generates Denso RC8 PACScript programs with motion, tool and I/O commands.















import re

from ..base import RobotPost, register
from ..robomath import xyzwpr

JOINT_TARGET_C = "' Circular movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."


def _p(pose):
    return "P(%s)" % ",".join("%.3f" % v for v in xyzwpr(pose))


def _j(joints):
    return "J(%s)" % ",".join("%.5f" % v for v in joints)


def _state(value):
    if isinstance(value, str):
        return value
    return "ON" if value > 0 else "OFF"


@register
class DensoRc8(RobotPost):
    name = "Denso_RC8"
    PROG_EXT = "pcs"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.PROGS = []
        self.LINES = []
        self.PASS = "@0"
        self.SPEED = 100.0
        self.SPEED_J = 20
        self.WORK = 3
        self.TOOL = 2

    def addline(self, line):
        self.LINES.append(line)

    def ProgStart(self, progname):
        self.CUR = progname
        self.LINES = []

    def ProgFinish(self, progname):
        self.PROGS.append((self.CUR, self.LINES))
        self.LINES = []

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        progs = self.PROGS or [(progname, self.LINES)]
        out = ["'!TITLE ”%s”" % progname, "", "Sub Main", "  TAKEARM Keep = 0", ""]
        out += ["  " + l for l in progs[0][1]] + ["End Sub"]
        for name, lines in progs[1:]:
            out += ["", "Sub %s" % name] + ["  " + l for l in lines] + ["End Sub"]
        self.save_file(folder, "%s.%s" % (progname, self.PROG_EXT), "\n".join(out) + "\n")

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def MoveJ(self, pose, joints, conf_RLF=None):
        self.addline("MOVE P, %s %s, Speed=%i" % (self.PASS, _j(joints), self.SPEED_J))

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is None:
            self.addline("MOVE L, %s %s, Speed=%i" % (self.PASS, _j(joints), self.SPEED_J))
        else:
            self.addline("MOVE L, %s %s, Speed=Mps(%.2f)" % (self.PASS, _p(pose), self.SPEED))

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            self.addline(JOINT_TARGET_C)
            return
        self.addline("MOVE C, %s,%s %s, Speed=Mps(%.2f)" % (_p(pose1), self.PASS, _p(pose2), self.SPEED))

    
    def setFrame(self, pose, frame_id=None, frame_name=None):
        if frame_id is not None and frame_id > 0:
            self.WORK = frame_id
        self.addline("Work %i, %s" % (self.WORK, _p(pose)))
        self.addline("ChangeWork %i" % self.WORK)

    def setTool(self, pose, tool_id=None, tool_name=None):
        if tool_id is not None and tool_id > 0:
            self.TOOL = tool_id
        self.addline("Tool %i, %s" % (self.TOOL, _p(pose)))
        self.addline("ChangeTool %i" % self.TOOL)

    def Pause(self, time_ms):
        if time_ms <= 0:
            self.addline("PAUSE")
        else:
            self.addline("DELAY %i" % int(time_ms))

    def setSpeed(self, speed_mms):
        self.SPEED = speed_mms

    def setAcceleration(self, accel_mmss):
        pass

    def setSpeedJoints(self, speed_degs):
        self.SPEED_J = int(max(1, min(100, speed_degs / 2.0)))

    def setAccelerationJoints(self, accel_degss):
        pass

    def setZoneData(self, zone_mm):
        self.PASS = "@P" if zone_mm > 0 else "@0"

    
    def setDO(self, io_var, io_value):
        var = io_var if isinstance(io_var, str) else "IO[%s]" % io_var
        self.addline("OUT %s = %s" % (var, _state(io_value)))

    def setAO(self, io_var, io_value):
        self.setDO(io_var, io_value)

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        var = io_var if isinstance(io_var, str) else "IO[%s]" % io_var
        line = "WAIT %s = %s" % (var, _state(io_value))
        if timeout_ms is not None and timeout_ms >= 0:
            line += ", %.0f" % timeout_ms
        self.addline(line)

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            code = re.sub(r"[^A-Za-z0-9_()]", "", code)
            self.addline("Call %s" % (code if "(" in code else code + "()"))
        else:
            self.addline(code)

    def RunMessage(self, message, iscomment=False):
        if iscomment:
            self.addline("' %s" % message)
        else:
            self.addline("'Output \"%s\"" % message)
