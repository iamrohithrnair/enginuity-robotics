



















import math
import re

from ..base import RobotPost, register
from ..robomath import euler_zyz

SETTINGS = [
    "$ORNT_TYPE := RS_WORLD",
    "$MOVE_TYPE := JOINT",
    "$JNT_MTURN := TRUE",
    "$CNFG_CARE := TRUE",
    "$TURN_CARE := TRUE",
    "$SING_CARE := FALSE",
    "$TERM_TYPE := NOSETTLE",
    "$FLY_TYPE := FLY_CART",
    "$FLY_TRAJ := FLY_PASS",
    "$FLY_DIST := -1.000",
    "$STRESS_PER:= 65",
]
JOINT_TARGET_C = "Circular movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."


def _joints(joints):
    return "{" + ",".join("%.5f" % v for v in joints) + "}"


def _pos(pose, cfg=""):
    x, y, z = pose[0][3], pose[1][3], pose[2][3]
    a, e, r = euler_zyz(pose)
    return "POS(%.4f, %.4f, %.4f, %.4f, %.4f, %.4f, '%s')" % (x, y, z, a, e, r, cfg)


def _on_off(value):
    if isinstance(value, str):
        return value
    return "ON" if value > 0 else "OFF"


def _call_name(code):
    pass
    return re.sub(r"[^A-Za-z0-9_()]", "", code)


@register
class ComauC5G(RobotPost):
    name = "Comau_C5G"
    PROG_EXT = "pdl"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.PROGS = []  
        self.LINES = []
        self.CALLS = []  
        self.FLY = -1.0
        self.LAST_POSE = None

    
    def _cfg(self, joints):
        pass
        j = list(joints)
        if len(j) >= 6:
            flags = "W " if j[4] < 0 else ""
            return flags + "T1:%d T2:%d T3:%d" % (_turn(j[3]), _turn(j[5]), _turn(j[2]))
        if len(j) >= 4:
            return "T1:%d" % _turn(j[3])
        return ""

    def addline(self, line):
        self.LINES.append("  " + line)

    def ProgStart(self, progname):
        self.CUR = progname
        self.LINES = []

    def ProgFinish(self, progname):
        self.PROGS.append([self.CUR, self.LINES])
        self.LINES = []

    def _routine(self, name, lines, settings):
        out = ["ROUTINE R_%s" % name, "VAR", "BEGIN"]
        if settings:
            out += ["  " + s for s in SETTINGS]
        return out + lines

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        main_name, main_lines = self.PROGS[0] if self.PROGS else (progname, self.LINES)
        defined = {n for n, _ in self.PROGS}
        imports = []
        for c in self.CALLS:
            if c not in defined and c not in imports:
                imports.append(c)
        n = self.MAX_LINES_X_PROG
        if n > 0 and len(main_lines) > n:
            parts = [main_lines[i : i + n] for i in range(0, len(main_lines), n)]
            names = [progname] + ["%s%i" % (progname, i) for i in range(1, len(parts))]
            for i, part in enumerate(parts):
                text = ["PROGRAM %s" % names[i], "VAR", "ROUTINE R_%s EXPORTED FROM %s GLOBAL" % (names[i], names[i]), ""]
                text += self._routine(names[i], part, True)
                text += ["END R_%s" % progname, "", "BEGIN", "  R_%s" % progname, "END %s" % progname, ""]
                self.save_file(folder, "%s.%s" % (names[i], self.PROG_EXT), "\n".join(text) + "\n")
            main = "%sMain" % progname
            text = ["PROGRAM %s" % main] + ["IMPORT '%s'" % nm for nm in names] + ["CONST", "VAR", "BEGIN"]
            text += ["  R_%s()" % nm for nm in names] + ["END %s" % main]
            self.save_file(folder, "%s.%s" % (main, self.PROG_EXT), "\n".join(text) + "\n")
            return
        text = ["PROGRAM %s" % main_name] + ["IMPORT '%s'" % c for c in imports]
        text += ["VAR", "ROUTINE R_%s EXPORTED FROM %s GLOBAL" % (main_name, main_name), ""]
        for sub, lines in self.PROGS[1:]:
            text += self._routine(sub, lines, False) + ["END R_%s" % sub, ""]
        text += self._routine(main_name, main_lines, True)
        text += ["END R_%s" % main_name, "", "BEGIN", "  R_%s" % main_name, "END %s" % main_name, ""]
        self.save_file(folder, "%s.%s" % (progname, self.PROG_EXT), "\n".join(text) + "\n")

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def MoveJ(self, pose, joints, conf_RLF=None):
        self.addline("MOVE TO %s" % _joints(joints))

    def _fly(self, move):
        return ("MOVEFLY %s ADVANCE" if self.FLY > 0 else "MOVE %s") % move

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is None:
            self.addline(self._fly("LINEAR TO %s" % _joints(joints)))
            return
        if self.LAST_POSE == pose:
            return  
        self.LAST_POSE = pose
        self.addline(self._fly("LINEAR TO %s" % _pos(pose, self._cfg(joints))))

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            self.addline("-- " + JOINT_TARGET_C)
            return
        self.LAST_POSE = pose2
        self.addline(self._fly("CIRCULAR TO %s VIA %s" % (_pos(pose2, self._cfg(joints2)), _pos(pose1, self._cfg(joints1)))))

    
    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.addline("$UFRAME := %s" % _pos(pose))

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.addline("$TOOL := %s" % _pos(pose))

    def Pause(self, time_ms):
        if time_ms <= 0:
            self.addline("PAUSE")
        else:
            self.addline("DELAY %.0f" % time_ms)

    def setSpeed(self, speed_mms):
        self.addline("$SPD_OPT := SPD_LIN")
        self.addline("$LIN_SPD := %.3f" % (speed_mms / 1000.0))

    def setAcceleration(self, accel_mmss):
        pass

    def setSpeedJoints(self, speed_degs):
        self.addline("$ROT_SPD := %.3f" % (speed_degs * 3.141592653589793 / 180.0))

    def setAccelerationJoints(self, accel_degss):
        pass

    def setZoneData(self, zone_mm):
        self.FLY = zone_mm
        self.addline("$FLY_DIST := %.3f" % zone_mm)

    
    def setDO(self, io_var, io_value):
        var = "$DOUT[%s]" % io_var if not isinstance(io_var, str) else io_var
        self.addline("%s := %s" % (var, _on_off(io_value)))

    def setAO(self, io_var, io_value):
        self.setDO(io_var, io_value)

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        var = "$DIN[%s]" % io_var if not isinstance(io_var, str) else io_var
        cond = "(%s = %s)" % (var, _on_off(io_value))
        self.addline("$TIMER[1] := 0")
        self.addline("REPEAT")
        self.addline("  DELAY 1")
        if timeout_ms is None or timeout_ms < 0:
            self.addline("UNTIL %s" % cond)
            return
        self.addline("UNTIL %s OR ($TIMER[1] > %.1f)" % (cond, timeout_ms))
        self.addline("IF $TIMER[1] > %.1f THEN" % timeout_ms)
        self.addline("-- TIMED OUT! Important: This section must be updated accordingly")
        self.addline("  DELAY 2000")
        self.addline("ENDIF")

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            call = _call_name(code)
            self.CALLS.append(call.split("(")[0])
            self.addline("R_%s" % call)
        else:
            self.addline(code)

    def RunMessage(self, message, iscomment=False):
        self.addline("-- %s" % message)


def _turn(angle):
    pass
    return int(math.floor((angle + 180.0) / 360.0))
