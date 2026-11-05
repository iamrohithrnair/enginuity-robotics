# Generates Epson RC programs with joint, linear and circular moves.
















import re

from ..base import RobotPost, register
from ..robomath import xyzabc

JOINT_TARGET_C = "' Circular movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."


def _xy(pose):
    return "XY(%s)" % ", ".join("%.3f" % v for v in xyzabc(pose))


def _ja(joints):
    return "JA(%s)" % ",".join("%.3f" % v for v in joints)


def _state(value):
    if isinstance(value, str):
        return value
    return "On" if value > 0 else "Off"


def _id(value):
    return value if value is not None and value > 0 else 1


@register
class EpsonRc(RobotPost):
    name = "Epson_RC"
    PROG_EXT = "prg"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.PROGS = []
        self.LINES = []
        self.FRAME_ID = None
        self.CP = ""

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
        out = []
        for k, (name, lines) in enumerate(progs):
            out.append("Function %s" % name)
            if k == 0:
                out += ["    Motor On", "    Power High"]
            out += ["    " + l for l in lines] + ["Fend"]
        self.save_file(folder, "%s.%s" % (progname, self.PROG_EXT), "\n".join(out) + "\n")

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def MoveJ(self, pose, joints, conf_RLF=None):
        self.addline("Go %s%s" % (_ja(joints), self.CP))

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is None:
            self.addline("Move %s%s" % (_ja(joints), self.CP))
            return
        flags = ""
        if self.ROBOT_AXES == 4:  
            flags += " /L" if joints[1] < 0 else " /R"
        if self.FRAME_ID is not None:
            flags += " /%i" % self.FRAME_ID
        self.addline("Move %s%s%s" % (_xy(pose), flags, self.CP))

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            self.addline(JOINT_TARGET_C)
            return
        self.addline("Arc %s, %s " % (_xy(pose1), _xy(pose2)))

    
    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.FRAME_ID = _id(frame_id)
        self.addline("' Using reference: %s" % frame_name)
        self.addline("Local %i, %s" % (self.FRAME_ID, _xy(pose)))

    def setTool(self, pose, tool_id=None, tool_name=None):
        tid = _id(tool_id)
        self.addline("' Using Tool frame %s: %s" % (tool_name, _xy(pose)))
        self.addline("TLSet %i, %s" % (tid, _xy(pose)))
        self.addline("Tool %i" % tid)

    def Pause(self, time_ms):
        self.addline("Wait %.3f" % (time_ms / 1000.0))

    def setSpeed(self, speed_mms):
        self.addline("SpeedS %.2f" % speed_mms)

    def setAcceleration(self, accel_mmss):
        pass

    def setSpeedJoints(self, speed_degs):
        self.addline("Speed %.2f" % speed_degs)

    def setAccelerationJoints(self, accel_degss):
        self.addline("Accel %.2f" % accel_degss)

    def setZoneData(self, zone_mm):
        self.CP = " CP" if zone_mm > 0 else ""

    
    def setDO(self, io_var, io_value):
        self.addline("%s %s" % (_state(io_value), io_var))

    def setAO(self, io_var, io_value):
        self.setDO(io_var, io_value)

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        var = io_var if isinstance(io_var, str) else "In(%s)" % io_var
        line = "Wait %s = %s" % (var, _state(io_value))
        if timeout_ms is not None and timeout_ms >= 0:
            line += " Timeout = %.1f" % timeout_ms
        self.addline(line)

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            self.addline("Call %s" % re.sub(r"[^A-Za-z0-9_()]", "", code))
        else:
            self.addline("Xqt 2, %s" % code)

    def RunMessage(self, message, iscomment=False):
        if iscomment:
            self.addline("' %s" % message)
        else:
            self.addline('Print "%s"' % message)
