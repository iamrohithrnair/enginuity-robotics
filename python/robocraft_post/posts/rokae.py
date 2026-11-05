# Generates Rokae modules with motion commands and target declarations.
















import math
import re

from ..base import RobotPost, register
from ..robomath import quaternion

EJ = "{EJ %s}" % ",".join(["0.000000000"] * 6)


def _level(value):
    if isinstance(value, str):
        return value
    return "1" if value > 0 else "0"


@register
class Rokae(RobotPost):
    name = "Rokae"
    PROG_EXT = "mod"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.PROGS = []
        self.LINES = []
        self.DECL = []
        self.COUNT = 0
        self.SPEED = "v50"
        self.ZONE = "z50"

    def addline(self, line):
        self.LINES.append(line)

    def ProgStart(self, progname):
        self.CUR = progname
        self.LINES = []
        self.DECL = []

    def ProgFinish(self, progname):
        self.PROGS.append((self.CUR, self.DECL, self.LINES))
        self.LINES = []
        self.DECL = []

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        progs = self.PROGS or [(progname, self.DECL, self.LINES)]
        out = ["MODULE MainModule"]
        for _name, decl, _lines in progs:
            out += decl + [""]
        for _name, _decl, lines in progs:
            out += ["GLOBAL Proc main()"] + ["    " + l for l in lines] + ["EndProc", "EndModule"]
        self.save_file(folder, "%s.%s" % (progname, self.PROG_EXT), "\n".join(out) + "\n")

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def _target(self, pose, joints, conf):
        name = "robpoint%i" % self.COUNT
        self.COUNT += 1
        j = list(joints) + [0.0] * 6
        rear, lower, flip = (list(conf or [0, 0, 0]) + [0, 0, 0])[:3]
        cfg = (math.floor(j[0] / 90.0), math.floor(j[3] / 90.0), math.floor(j[5] / 90.0), int(rear) * 4 + int(lower) * 2 + int(flip))
        q = quaternion(pose)
        if self.ROBOT_AXES > 6:  
            extra = ["%.6f" % v for v in list(joints)[6:]]
            ej = "{%s}" % ",".join(extra + ["0.0"] * (6 - len(extra)))
        else:
            ej = EJ
        self.DECL.append(
            "GLOBAL VAR robtarget %s= p:{{%.3f, %.3f, %.3f},{%.6f, %.6f, %.6f, %.6f}}{cfg %i,%i,%i,%i}%s"
            % ((name, pose[0][3], pose[1][3], pose[2][3]) + tuple(q) + cfg + (ej,))
        )
        return name

    
    def MoveJ(self, pose, joints, conf_RLF=None):
        if pose is not None:
            self.addline("MoveJ %s,%s,%s,tool03,wobj16" % (self._target(pose, joints, conf_RLF), self.SPEED, self.ZONE))

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is not None:
            self.addline("MoveL %s,%s,%s,tool03,wobj16" % (self._target(pose, joints, conf_RLF), self.SPEED, self.ZONE))

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is not None and pose2 is not None:
            t1 = self._target(pose1, joints1, conf_RLF_1)
            t2 = self._target(pose2, joints2, conf_RLF_2)
            self.addline("MoveC %s,%s,%s,%s,tool03,wobj16" % (t1, t2, self.SPEED, self.ZONE))

    
    def _assign(self, var, pose, xfmt):
        q = quaternion(pose)
        self.addline("%s.x = %s" % (var, xfmt(pose[0][3])))
        self.addline("%s.y = %.3f" % (var, pose[1][3]))
        self.addline("%s.z = %.3f" % (var, pose[2][3]))
        for k in range(4):
            self.addline("%s.q%i = %.6f" % (var, k + 1, q[k]))

    def setFrame(self, pose, frame_id=None, frame_name=None):
        self._assign("wobj16", pose, str)  

    def setTool(self, pose, tool_id=None, tool_name=None):
        self._assign("tool03", pose, lambda v: "%.3f" % v)

    def Pause(self, time_ms):
        if time_ms > 0:
            self.addline("Wait %.3f" % (time_ms / 1000.0))

    def setSpeed(self, speed_mms):
        self.SPEED = "v%i" % int(speed_mms)

    def setAcceleration(self, accel_mmss):
        pass

    def setSpeedJoints(self, speed_degs):
        pass

    def setAccelerationJoints(self, accel_degss):
        pass

    def setZoneData(self, zone_mm):
        self.ZONE = "fine" if zone_mm < 0 else "z%i" % int(zone_mm)

    
    def setDO(self, io_var, io_value):
        var = io_var if isinstance(io_var, str) else "D_OUT_%s" % io_var
        self.addline("SetDO %s, %s;" % (var, _level(io_value)))

    def setAO(self, io_var, io_value):
        self.setDO(io_var, io_value)

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        var = io_var if isinstance(io_var, str) else "D_IN_%s" % io_var
        if timeout_ms is None or timeout_ms < 0:
            self.addline("WaitDI %s, %s;" % (var, _level(io_value)))
        else:
            self.addline("WaitDI %s, %s, \\MaxTime:=%.1f;" % (var, _level(io_value), timeout_ms / 1000.0))

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            self.addline("%s;" % re.sub(r"[^A-Za-z0-9_()]", "", code))
        else:
            self.addline(code)

    def RunMessage(self, message, iscomment=False):
        if not iscomment:
            self.addline('TPWrite "%s";' % message)
