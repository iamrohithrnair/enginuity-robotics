# Generates Siemens Sinumerik MPF programs with numbered G-code motion blocks.







































import datetime
import math
import re

from ..base import RobotPost, register


def euler_xyz(h):
    pass
    if h[0][2] > 1.0 - 1e-10:
        return [0.0, 90.0, math.atan2(h[1][0], h[1][1]) * 180.0 / math.pi]
    if h[0][2] < -1.0 + 1e-10:
        return [0.0, -90.0, math.atan2(h[1][0], h[1][1]) * 180.0 / math.pi]
    rx = math.atan2(-h[1][2], h[2][2])
    ry = math.atan2(h[0][2], math.sqrt(h[1][2] * h[1][2] + h[2][2] * h[2][2]))
    rz = math.atan2(-h[0][1], h[0][0])
    return [rx * 180.0 / math.pi, ry * 180.0 / math.pi, rz * 180.0 / math.pi]




AXIS_NAMES = ["RA1", "RA2", "RA3", "RA4", "RA5", "RA6", "G"]
TRAFO_OFF = "TRAFO OFF ;Transformation between KUKA.CNC and KRL OFF"
HEADER = [
    "G17 G710 G40 ; XY plane selection, metric, no tool radius compensation",
    "TRAORI",
    "M32",
    "G54",
    "G90",
    "G64",
    "ORIWKS",
    "ORIVIRT1",
    "STOPRE ; stop preprocessing",
    "; R6=1.181",
    "; R19=0.00",
    "; R20=83.00",
    "STOPRE",
    "; M3 S7458 ; Generic way to turn on the spindle",
    "; S1700.0 M80 ; Customized Spindle speed and power on",
]


@register
class SiemensSinumerik(RobotPost):
    name = "Siemens_Sinumerik"
    PROG_EXT = "mpf"
    VOLATILE = [rb"; Created on \d{4}-\d\d-\d\d \d\d:\d\d:\d\d"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.LINES = []
        self.NLINE = 0
        self.NPROGS = 0
        self.JOINT_MODE = False
        self.LAST_X = None
        self.LAST_Y = None
        self.LAST_Z = None
        self.FEED = 5000.0
        self.FEEDJ = 2000.0

    def addline(self, line):
        self.NLINE += 1
        self.LINES.append("N%02i %s" % (self.NLINE, line))

    def comment(self, text):
        self.LINES.append("; %s" % text)

    def ProgStart(self, progname):
        self.NPROGS += 1
        if self.NPROGS == 1:
            self.comment("File: %s" % progname)
            self.comment("Created on %s" % datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
            self.comment("Program created using Enginuity")
            for line in HEADER:
                self.addline(line)
            self.comment("---- Program start ----")
        else:
            self.comment("")
            self.comment("---------- Subprogram: %s ----------" % progname)
            self.addline("%s:" % progname)
            self.addline("TRAORI")
        self.JOINT_MODE = False

    def ProgFinish(self, progname):
        if self.NPROGS == 1:
            self.comment("End of main program %s" % progname)
            self.addline("M30")
            self.comment("---------------------------")
        else:
            self.addline("GOTOB %s_done" % progname)
            self.comment("------------------------------------")
        self.comment("")

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        self.save_file(folder, "%s.%s" % (progname, self.PROG_EXT), "".join(l + "\n" for l in self.LINES))

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def _xyzabc(self, pose):
        x, y, z = pose[0][3], pose[1][3], pose[2][3]
        parts = []
        if x != self.LAST_X:
            parts.append("X%.3f" % x)
        if y != self.LAST_Y:
            parts.append("Y%.3f" % y)
        if z != self.LAST_Z or not parts:
            parts.append("Z%.3f" % z)
        parts += ["%s=%.3f" % (k, v) for k, v in zip("ABC", euler_xyz(pose))]
        self.LAST_X, self.LAST_Y, self.LAST_Z = x, y, z
        return " ".join(parts)

    def _joint_mode(self):
        if not self.JOINT_MODE:
            self.addline(TRAFO_OFF)
            self.JOINT_MODE = True

    def _cart_mode(self):
        if self.JOINT_MODE:
            self.addline("TRAORI")
            self.addline("G54")
            self.JOINT_MODE = False

    def _joint_move(self, joints, feed):
        self._joint_mode()
        self.addline("G1 " + " ".join("%s=%.6f" % (AXIS_NAMES[i] if i < len(AXIS_NAMES) else "RA%i" % (i + 1), v) for i, v in enumerate(joints)) + " F%.1f" % feed)

    def MoveJ(self, pose, joints, conf_RLF=None):
        self._joint_move(joints, self.FEEDJ)
        if pose is None:
            return
        conf = conf_RLF or [0, 0, 0]
        stat = int(conf[0]) + 2 * (1 - int(conf[1])) + 4 * int(conf[2])
        n = len(joints)
        turn = sum(1 << (n - 1 - i) for i, v in enumerate(joints) if v < 0)
        self.addline("; TRAORI")
        self.addline("; PTP G1 %s STAT=%i TU=%i F%.1f ; same joint coordinate" % (self._xyzabc(pose), stat, turn, self.FEED))
        self.addline("; " + TRAFO_OFF)

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is None:
            self._joint_move(joints, self.FEED)
            return
        self._cart_mode()
        self.addline("G1 %s F%.1f" % (self._xyzabc(pose), self.FEED))

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            self.RunMessage("Circular movement using joint targets is not supported. Change the target type to cartesian or use a joint movement.", True)
            return
        self.addline(
            "G2 X%.3f Y%.3f Z%.3f I1=%.3f J1=%.3f K1=%.3f F%.1f"
            % (pose2[0][3], pose2[1][3], pose2[2][3], pose1[0][3], pose1[1][3], pose1[2][3], self.FEED)
        )

    
    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.comment("------ Update reference: %s ------" % frame_name)
        self.addline(
            "$P_UIFR[1]=CTRANS(X,%.5f,Y,%.5f,Z,%.5f):CROT(X,%.5f,Y,%.5f,Z,%.5f)"
            % tuple([pose[0][3], pose[1][3], pose[2][3]] + euler_xyz(pose))
        )
        self.addline("G54")
        self.comment("---------------------------")

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.comment("------ Update TCP: %s ------" % tool_name)
        values = [pose[0][3], pose[1][3], pose[2][3]] + euler_xyz(pose)
        for key, v in zip("XYYABC", values):
            self.addline("; $TC_DP_%s[1,1]=%.5f" % (key, v))

    def Pause(self, time_ms):
        if time_ms < 0:
            self.addline("M0 ; STOP")
        else:
            self.addline("G4 F%.0f ; pause in seconds" % (time_ms * 0.001))

    def setSpeed(self, speed_mms):
        self.FEED = speed_mms * 60.0

    def setAcceleration(self, accel_mmss):
        self.comment("Acceleration set to %.3f mm/s2" % accel_mmss)

    def setSpeedJoints(self, speed_degs):
        self.FEEDJ = speed_degs * 60.0

    def setAccelerationJoints(self, accel_degss):
        self.comment("Joint acceleration set to %.3f deg/s2" % accel_degss)

    def setZoneData(self, zone_mm):
        if zone_mm < 0:
            self.addline("CYCLE832(0,_OFF,1)")
        else:
            self.addline("CYCLE832(0.1,_FINISH,1)")

    
    def setDO(self, io_var, io_value):
        var = io_var if isinstance(io_var, str) else "P%s" % io_var
        if isinstance(io_value, str):
            cmd = io_value
        else:
            cmd = "M62" if io_value > 0 else "M63"
        self.addline("%s %s ; Set digital output %s = %s" % (cmd, var, io_var, io_value))

    def setAO(self, io_var, io_value):
        self.setDO(io_var, io_value)

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        var = io_var if isinstance(io_var, str) else "P%s" % io_var
        if isinstance(io_value, str):
            level = io_value
        else:
            level = "L3" if io_value > 0 else "L4"
        if timeout_ms is None or timeout_ms < 0:
            self.addline("M66 %s %s Q9999; Wait Digital Input %s = %s" % (var, level, io_var, io_value))
        else:
            t = timeout_ms * 0.001
            line = "M66 %s %s Q%.3f; Wait Digital Input %s = %s" % (var, level, t, io_var, io_value)
            self.addline(line + (" (timeout = %.3f)" % t if timeout_ms > 0 else ""))

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            code = re.sub(r"[^A-Za-z0-9_()]", "", code)
            self.addline("GOTOF %s" % code)
            self.addline("%s_done:" % code)
        else:
            self.comment(code)

    def RunMessage(self, message, iscomment=False):
        if iscomment:
            self.comment(message)
        else:
            self.comment("Display message: %s" % message)
