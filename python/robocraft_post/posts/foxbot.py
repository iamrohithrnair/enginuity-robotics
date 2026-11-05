# Generates Foxbot PAC routines with motion, tool and I/O instructions.




















import re

from ..base import RobotPost, register
from ..robomath import xyzwpr


def _pose(pose):
    return "P(%s)" % ",".join("%.3f" % v for v in xyzwpr(pose))


def _joints(joints):
    return "J(%s)" % ",".join("%.5f" % v for v in joints)


def _value(value):
    if isinstance(value, str):
        return value
    return "True" if value > 0 else "False"


@register
class Foxbot(RobotPost):
    name = "Foxbot"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.LINES = []
        self.NPROGS = 0
        self.ZONE = "0"
        self.NPOINT = 0

    def addline(self, line):
        self.LINES.append("\t" + line)

    def ProgStart(self, progname):
        self.NPROGS += 1
        self.LINES.append("Sub Main" if self.NPROGS == 1 else "Sub %s" % progname)

    def ProgFinish(self, progname):
        self.LINES.append("End Sub")

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        self.save_file(folder, "%s.pac" % progname, "".join(l + "\n" for l in self.LINES))

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def MoveJ(self, pose, joints, conf_RLF=None):
        self.addline("Move P, @%s, %s, 20" % (self.ZONE, _joints(joints)))

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is None:
            self.addline("Move L, @%s, %s, 20" % (self.ZONE, _joints(joints)))
            return
        self.NPOINT += 1
        self.addline("Move L, @%s, P(%d), 20" % (self.ZONE, self.NPOINT))

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            self.addline("' Circular movement using joint targets is not supported. Change the target type to cartesian or use a joint movement.")
            return
        self.addline("Move C, %s, @%s, %s, 20" % (_pose(pose1), self.ZONE, _pose(pose2)))

    
    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.addline("Work 3, %s" % _pose(pose))
        self.addline("ChangeWork 3")

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.addline("Tool 2, %s" % _pose(pose))
        self.addline("ChangeTool 2")

    def Pause(self, time_ms):
        if time_ms <= 0:
            self.addline("Pause")
        else:
            self.addline("Delay %d" % int(time_ms))

    def setSpeed(self, speed_mms):
        self.addline("Speed %.1f, True" % speed_mms)

    def setAcceleration(self, accel_mmss):
        pass

    def setSpeedJoints(self, speed_degs):
        pass

    def setAccelerationJoints(self, accel_degss):
        pass

    def setZoneData(self, zone_mm):
        self.ZONE = "P" if zone_mm > 0 else "0"

    
    def setDO(self, io_var, io_value):
        self.addline("SetOutp PB, %s, %s" % (io_var, _value(io_value)))

    setAO = setDO

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        line = "Wait %s, %s" % (io_var, _value(io_value))
        if timeout_ms is not None and timeout_ms >= 0:
            line += ", %d" % int(timeout_ms)
        self.addline(line)

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            code = re.sub(r"[^A-Za-z0-9_()]", "", code)
            if "(" not in code:
                code += "()"
            self.addline("Call %s" % code)
        else:
            self.addline(code)

    def RunMessage(self, message, iscomment=False):
        self.addline(("' %s" if iscomment else "'Output \"%s\"") % message)
