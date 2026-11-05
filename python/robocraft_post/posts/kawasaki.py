# Generates Kawasaki AS programs with joint targets, motions and I/O commands.

















import re

from ..base import RobotPost, register
from ..robomath import euler_zyz


def _trans(pose):
    a, e, r = euler_zyz(pose)
    return "TRANS(%.3f,%.3f,%.3f,%.4f,%.4f,%.4f)" % (pose[0][3], pose[1][3], pose[2][3], a, e, r)


def _joints(joints):
    return "#[%s]" % ", ".join("%.5f" % v for v in joints)


def _prefix(value):
    pass
    if isinstance(value, str):
        return value
    return "" if value else "-"


@register
class Kawasaki(RobotPost):
    name = "Kawasaki"
    PROG_EXT = "pg"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.PROGS = []
        self.LINES = []

    def addline(self, line):
        self.LINES.append("  " + line)

    def ProgStart(self, progname):
        self.CUR = progname
        self.LINES = []

    def ProgFinish(self, progname):
        self.PROGS.append((self.CUR, self.LINES))
        self.LINES = []

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        name, lines = self.PROGS[0] if self.PROGS else (progname, self.LINES)
        text = [".PROGRAM %s()" % progname] + lines + ["  BASE NULL", ".END"]
        self.save_file(folder, "%s.%s" % (progname, self.PROG_EXT), "\n".join(text) + "\n")

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def MoveJ(self, pose, joints, conf_RLF=None):
        self.addline("JMOVE %s" % _joints(joints))

    def MoveL(self, pose, joints, conf_RLF=None):
        self.addline("LMOVE %s" % (_joints(joints) if pose is None else _trans(pose)))

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        self.addline("C1MOVE %s" % (_joints(joints1) if pose1 is None else _trans(pose1)))
        self.addline("C2MOVE %s" % (_joints(joints2) if pose2 is None else _trans(pose2)))

    
    def setFrame(self, pose, frame_id=None, frame_name=None):
        
        self.addline("BASE NULL" if "T" in self.AXES_TYPE else "BASE %s" % _trans(pose))

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.addline("TOOL %s" % _trans(pose))

    def Pause(self, time_ms):
        if time_ms <= 0:
            self.addline("PAUSE")
        else:
            self.addline("TWAIT %.3f" % (time_ms / 1000.0))

    def setSpeed(self, speed_mms):
        self.addline("SPEED %.1f MM/S ALWAYS" % min(speed_mms, 5000.0))

    def setAcceleration(self, accel_mmss):
        a = min(accel_mmss, 100.0)
        self.addline("ACCEL %.1f %.1f" % (a, a))

    def setSpeedJoints(self, speed_degs):
        self.addline("SPEED %.1f ALWAYS" % (speed_degs / 5.0))

    def setAccelerationJoints(self, accel_degss):
        pass

    def setZoneData(self, zone_mm):
        self.addline("ACCURACY %.3f ALWAYS" % zone_mm)

    
    def setDO(self, io_var, io_value):
        self.addline("SIGNAL %s%s" % (_prefix(io_value), io_var))

    def setAO(self, io_var, io_value):
        self.setDO(io_var, io_value)

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        if timeout_ms is not None and timeout_ms > 0:
            self.addline("; Timeout not implemented")
        self.addline("WAIT SIG(%s%s)" % (_prefix(io_value), io_var))

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            self.addline("CALL %s" % re.sub(r"[^A-Za-z0-9_()]", "", code))
        else:
            self.addline(code)

    def RunMessage(self, message, iscomment=False):
        if iscomment:
            self.addline("; %s" % message)
        else:
            self.addline('TYPE "%s"' % message)
