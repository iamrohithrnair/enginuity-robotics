




















from ..base import RobotPost, register
from ..robomath import xyzabc

DEF_HEADER = """&ACCESS RVP
&REL 1
&PARAM TEMPLATE = C:\\KRC\\Roboter\\Template\\vorgabe
&PARAM EDITMASK = *
DEF %s ( )
"""

INIT = """

; GLOBAL INTERRUPT DECL 3 WHEN $STOPMESS==TRUE DO IR_STOPM ( )
; INTERRUPT ON 3

;FOLD Initialise and set default speed
BAS (#INITMOV,0)
BAS (#VEL_PTP,100)
BAS (#ACC_PTP,20)
$VEL.CP=0.2
BAS (#TOOL,0)
BAS (#BASE,0)
;ENDFOLD

;;FOLD STARTPOS
;$BWDSTART = FALSE
;PDAT_ACT = PDEFAULT
;BAS(#PTP_DAT)
;FDAT_ACT = {TOOL_NO 0,BASE_NO 0,IPO_FRAME #BASE}
;BAS(#FRAMES)
;;ENDFOLD

$ADVANCE = 5

;FOLD ---- Quickly skip BCO ----
; PTP $AXIS_ACT
;ENDFOLD

;FOLD ---- GO HOME ----
; PTP {A1 0.000, A2 -90.000, A3 90.000, A4 0.000, A5 0.000, A6 0.000, E1 0, E2 0, E3 0, E4 0, E5 0, E6 0}
;ENDFOLD


"""


def _axes(joints):
    values = list(joints or [])
    if len(values) == 4:
        
        values = [values[0], values[1], values[2], 0.0, 90.0 - values[1] - values[2], values[3]]
    names = ["A%i" % (i + 1) for i in range(min(6, len(values)))] + ["E%i" % (i + 1) for i in range(max(0, len(values) - 6))]
    return "{" + ",".join("%s %.5f" % (n, v) for n, v in zip(names, values)) + "}"


def _frame(pose):
    x, y, z, a, b, c = xyzabc(pose)
    return "{X %.3f,Y %.3f,Z %.3f,A %.3f,B %.3f,C %.3f}" % (x, y, z, a, b, c)


JOINT_TARGET_L = "; Linear movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."
JOINT_TARGET_C = "; Circular movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."


def _value(value):
    pass
    if isinstance(value, str):
        return value
    return "TRUE" if value > 0 else "FALSE"


@register
class KukaKrc4(RobotPost):
    name = "KUKA_KRC4"
    PROG_EXT = "src"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.PROGS = []  
        self.LINES = None
        self.ZONE_SET = False
        self.CALLS = []

    def ProgStart(self, progname):
        self.CUR = progname
        self.LINES = []

    def ProgFinish(self, progname):
        self.PROGS.append((self.CUR, self.LINES or []))
        self.LINES = None

    def addline(self, line):
        if self.LINES is None:
            self.LINES = []
        self.LINES.append(line)

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        name, lines = self.PROGS[0] if self.PROGS else (progname, self.LINES or [])
        n = self.MAX_LINES_X_PROG
        if n > 0 and len(lines) > n and len(self.PROGS) <= 1:
            parts = [lines[i : i + n] for i in range(0, len(lines), n)]
            names = [progname] + ["%s%i" % (progname, i) for i in range(1, len(parts))]
            for i, part in enumerate(parts):
                head = DEF_HEADER % names[i] + (INIT if i == 0 else "")
                self.save_file(folder, "%s.%s" % (names[i], self.PROG_EXT), head + "".join(l + "\n" for l in part) + "END\n")
            main = "%sMain" % progname
            calls = "".join("%s()\n" % nm for nm in names)
            self.save_file(folder, "%s.%s" % (main, self.PROG_EXT), DEF_HEADER % main + calls + "END\n")
            return
        
        text = DEF_HEADER % progname + INIT + "".join(l + "\n" for l in lines) + "END\n"
        self.save_file(folder, "%s.%s" % (progname, self.PROG_EXT), text)

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def _suffix(self, kind):
        return " C_%s" % kind if self.ZONE_SET else ""

    def MoveJ(self, pose, joints, conf_RLF=None):
        self.addline("PTP %s%s" % (_axes(joints), self._suffix("PTP")))

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is None:
            self.addline(JOINT_TARGET_L)
            return
        self.addline("LIN %s%s" % (_frame(pose), self._suffix("DIS")))

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            self.addline(JOINT_TARGET_C)
            return
        self.addline("CIRC %s,%s%s" % (_frame(pose1), _frame(pose2), self._suffix("DIS")))

    
    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.addline("; ---- Setting reference (Base) ----")
        self.addline("$BASE = {FRAME: %s}" % _frame(pose)[1:-1])
        self.addline("; --------------------------")

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.addline("; ---- Setting tool (TCP) ----")
        self.addline("$TOOL = {FRAME: %s}" % _frame(pose)[1:-1])
        self.addline("; --------------------------")

    def Pause(self, time_ms):
        if time_ms <= 0:
            self.addline("HALT")
        else:
            self.addline("WAIT SEC %.3f" % (time_ms * 0.001))

    def setSpeed(self, speed_mms):
        self.addline("$VEL.CP = %.5f" % (speed_mms / 1000.0))

    def setAcceleration(self, accel_mmss):
        self.addline("$ACC.CP = %.5f" % (accel_mmss / 1000.0))

    def setSpeedJoints(self, speed_degs):
        self.addline("$VEL.ORI1 = %.5f" % speed_degs)
        self.addline("$VEL.ORI2 = %.5f" % speed_degs)

    def setAccelerationJoints(self, accel_degss):
        self.addline("$ACC.ORI1 = %.5f" % accel_degss)
        self.addline("$ACC.ORI2 = %.5f" % accel_degss)

    def setZoneData(self, zone_mm):
        if zone_mm < 0:
            self.ZONE_SET = False
            return
        self.ZONE_SET = True
        self.addline("$APO.CPTP = %i" % min(100, int(zone_mm)))  
        self.addline("$APO.CDIS = %.3f" % zone_mm)

    
    def setDO(self, io_var, io_value):
        var = "$OUT[%s]" % io_var if isinstance(io_var, int) else str(io_var)
        self.addline("%s=%s" % (var, _value(io_value)))

    def setAO(self, io_var, io_value):
        var = "$ANOUT[%s]" % io_var if isinstance(io_var, int) else str(io_var)
        self.addline("%s=%s" % (var, _value(io_value)))

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        var = "$IN[%s]" % io_var if isinstance(io_var, int) else str(io_var)
        value = _value(io_value)
        if timeout_ms is None or timeout_ms <= 0:
            self.addline("WAIT FOR (%s==%s)" % (var, value))
            return
        self.addline("START_TIMER:")
        self.addline("$TIMER_STOP[1]=TRUE")
        self.addline("$TIMER_FLAG[1]=FALSE")
        self.addline("$TIMER[1]=%.3f" % (timeout_ms * 0.001))
        self.addline("$TIMER_STOP[1]=FALSE")
        self.addline("WAIT FOR (%s==%s OR $TIMER_FLAG[1])" % (var, value))
        self.addline("$TIMER_STOP[1]=TRUE")
        self.addline("IF $TIMER_FLAG[1]== TRUE THEN")
        self.addline("    HALT ; Timed out!")
        self.addline("    GOTO START_TIMER")
        self.addline("ENDIF")

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            code = code.replace(" ", "_")
            if "(" not in code:
                code += "()"
            self.CALLS.append(code.split("(")[0] + "()")
            self.addline(code)
        else:
            self.addline(code)

    def RunMessage(self, message, iscomment=False):
        if iscomment:
            self.addline("; %s" % message)
        else:
            self.addline("Wait for StrClear($LOOP_MSG[])")
            self.addline("$LOOP_CONT = TRUE")
            self.addline('$LOOP_MSG[] = "%s"' % message)


EXT_BAS = "EXT BAS (BAS_COMMAND :IN,REAL :IN )\n"
CASCADE = "\n; Continue running program as cascaded execution\n%s()\n\n"


@register
class KukaKrc2(KukaKrc4):
    pass

    name = "KUKA_KRC2"

    @staticmethod
    def _ext(calls):
        unique = []
        for c in calls:
            if c not in unique:
                unique.append(c)
        if not unique:
            return ""
        return "\n; External program calls:\n" + "".join("EXT %s\n" % c for c in unique) + "\n"

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        name, lines = self.PROGS[0] if self.PROGS else (progname, self.LINES or [])
        n = self.MAX_LINES_X_PROG
        parts = [lines[i : i + n] for i in range(0, len(lines), n)] if n > 0 and len(lines) > n else [lines]
        names = [progname] + ["%s%i" % (progname, i) for i in range(1, len(parts))]
        for i, part in enumerate(parts):
            nxt = names[i + 1] if i + 1 < len(parts) else None
            calls = (self.CALLS if i == 0 else []) + (["%s()" % nxt] if nxt else [])
            head = DEF_HEADER % names[i] + self._ext(calls)
            if i == 0:
                head += EXT_BAS + INIT
            tail = (CASCADE % nxt) if nxt else ""
            self.save_file(folder, "%s.%s" % (names[i], self.PROG_EXT), head + "".join(l + "\n" for l in part) + tail + "END\n")
