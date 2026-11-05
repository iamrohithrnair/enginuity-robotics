# Generates split HIWIN HRSS motion programs with robot-axis targets.
















import re

from ..base import RobotPost, register
from ..robomath import xyzabc

HEADER = [";[Point&S]", "DECL E6POINT P0={A1 0.0, A2 0.0, A3 0.0, A4 0.0, A5 -90.0, A6 0.0}", ";NULL", ";[Point&E]", ";[Program&SV2]", "",
          ";PTP P0 CONT Vel=100% Acc=50% TOOL[0] BASE[0]"]
JOINT_TARGET_L = "; Linear movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."
JOINT_TARGET_C = "; Circular movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."


def _name(text):
    return re.sub(r"[^A-Za-z0-9_]", "", (text or "").replace(" ", "_"))


def _state(value):
    if isinstance(value, str):
        return value
    return "TRUE" if value > 0 else "FALSE"


@register
class HiwinHrss(RobotPost):
    name = "HIWIN_HRSS"
    PROG_EXT = "hrb"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.PROGS = []
        self.LINES = []
        self.MODE = "CONT"
        self.VEL_J = 50
        self.VEL_L = 1000.0
        self.TOOL = 0
        self.BASE = 0

    def addline(self, line):
        self.LINES.append(line)

    def ProgStart(self, progname):
        self.CUR = progname
        self.LINES = []

    def ProgFinish(self, progname):
        self.PROGS.append((self.CUR, self.LINES))
        self.LINES = []

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        lines = self.PROGS[0][1] if self.PROGS else self.LINES
        n = self.MAX_LINES_X_PROG
        if n <= 0 or len(lines) <= n:
            out = ["; Program: %s" % progname] + HEADER + lines + ["", ";[Program&E]"]
            self.save_file(folder, "%s.%s" % (progname, self.PROG_EXT), "\n".join(out) + "\n")
            return
        parts = [lines[k : k + n] for k in range(0, len(lines), n)]
        names = [progname] + ["%s%i" % (progname, k) for k in range(1, len(parts))]
        for k, (name, part) in enumerate(zip(names, parts)):
            out = ["; Program: %s" % name] + (HEADER if k == 0 else []) + part + ["", ";[Program&E]"]
            self.save_file(folder, "%s.%s" % (name, self.PROG_EXT), "\n".join(out) + "\n")
        self.save_file(folder, "%sMain.%s" % (progname, self.PROG_EXT), "\n".join(["Program: %sMain" % progname] + names) + "\n")

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def _extra(self, joints):
        return "".join(",E%i %.5f" % (k + 1, v) for k, v in enumerate(list(joints)[6:]))

    def _pose(self, pose, joints):
        x, y, z, a, b, c = xyzabc(pose)
        return "{X %.3f,Y %.3f,Z %.3f,A %.3f,B %.3f,C %.3f%s}" % (x, y, z, a, b, c, self._extra(joints))

    def _tail(self):
        return "TOOL[%i] BASE[%i]" % (self.TOOL, self.BASE)

    def MoveJ(self, pose, joints, conf_RLF=None):
        j = list(joints)
        target = "{%s%s}" % (",".join("A%i %.5f" % (k + 1, v) for k, v in enumerate(j[:6])), self._extra(j))
        mode = "C_PTP" if self.MODE == "C" else "CONT"
        self.addline("PTP %s %s Vel=%i%% %s" % (target, mode, self.VEL_J, self._tail()))

    def _linear(self, kind, target):
        mode = "C_LIN" if self.MODE == "C" else "CONT"
        self.addline("%s %s %s Vel=%.1fmm/s %s" % (kind, target, mode, self.VEL_L, self._tail()))

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is None:
            self.addline(JOINT_TARGET_L)
            return
        self._linear("LIN", self._pose(pose, joints))

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            self.addline(JOINT_TARGET_C)
            return
        self._linear("CIRC", self._pose(pose1, joints1) + self._pose(pose2, joints2))

    
    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.BASE = frame_id if frame_id is not None and frame_id > 0 else 1
        name = _name(frame_name)
        self.addline("FRAME %s=%s" % (name, self._pose(pose, [])))
        self.addline("SET_BASE %i" % self.BASE)
        self.addline("SET_BASE %s" % name)

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.TOOL = tool_id if tool_id is not None and tool_id > 0 else 0
        name = _name(tool_name)
        self.addline("FRAME %s=%s" % (name, self._pose(pose, [])))
        self.addline("SET_TOOL %i" % self.TOOL)
        self.addline("SET_TOOL %s" % name)

    def Pause(self, time_ms):
        if time_ms <= 0:
            self.addline("HALT")
        else:
            self.addline("WAIT SEC %.3f" % (time_ms / 1000.0))

    def setSpeed(self, speed_mms):
        self.VEL_L = speed_mms
        self.addline("; SPEED = %.5f mm/s" % speed_mms)

    def setAcceleration(self, accel_mmss):
        self.addline("; ACCELERATION = %.5f" % (accel_mmss / 1000.0))

    def setSpeedJoints(self, speed_degs):
        self.VEL_J = max(0, min(100, int(speed_degs / 3.0)))
        self.addline("; JOINT SPEED = %.5f deg/s" % speed_degs)

    def setAccelerationJoints(self, accel_degss):
        self.addline("; JOINT ACCELERATION = %.5f deg/s2" % accel_degss)

    def setZoneData(self, zone_mm):
        if zone_mm < 0:
            self.MODE = "CONT"
            return
        self.MODE = "C"
        self.addline("CPTP = %.3f" % zone_mm)
        self.addline("CLIN = %.3f" % zone_mm)

    
    def setDO(self, io_var, io_value):
        var = io_var if isinstance(io_var, str) else "$DO[%s]" % io_var
        self.addline("%s=%s" % (var, _state(io_value)))

    def setAO(self, io_var, io_value):
        self.setDO(io_var, io_value)

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        var = io_var if isinstance(io_var, str) else "$DI[%s]" % io_var
        self.addline("WHILE %s!=%s" % (var, _state(io_value)))
        self.addline("    WAIT SEC 0.1")
        self.addline("ENDWHILE")

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            self.addline(re.sub(r"[^A-Za-z0-9_()]", "", code))
        else:
            self.addline(code)

    def RunMessage(self, message, iscomment=False):
        if iscomment:
            self.addline("; %s" % message)
        else:
            self.addline("; Display message: %s" % message)
