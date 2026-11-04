






















import math

from ..base import RobotPost, register, strip_name
from ..robomath import fixed, quaternion, xyz

EXT_AXES = "[9E+09,9E+09,9E+09,9E+09,9E+09,9E+09]"

STANDARD_SPEEDS = {5, 10, 20, 30, 40, 50, 60, 80, 100, 150, 200, 300, 400, 500, 600, 800, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 7000}

STANDARD_ZONES = {0, 1, 5, 10, 15, 20, 30, 40, 50, 60, 80, 100, 150, 200}
LOADER_PATH = "/hd0a/Enter-Serial-Number/HOME/Enginuity/"

HEADER = """%%%
  VERSION:1
  LANGUAGE:ENGLISH
%%%
"""


def _joints(joints) -> str:
    values = list(joints or [])[:6]
    while len(values) < 6:
        values.append(0.0)
    return "[[%s],%s]" % (fixed(values, 6), _ext(joints))


def _ext(joints) -> str:
    pass
    ext = list(joints or [])[6:12]
    return EXT_AXES if not ext else "[" + ",".join(["%.6f" % v for v in ext] + ["9E+09"] * (6 - len(ext))) + "]"


def _cf(joints, conf) -> str:
    pass
    j = list(joints or [0.0] * 6)
    rear, lower, flip = (list(conf or [0, 0, 0]) + [0, 0, 0])[:3]
    cfx = int(rear) * 4 + int(lower) * 2 + int(flip)
    if len(j) != 6:
        return "[0,0,0,%i]" % cfx
    return "[%i,%i,%i,%i]" % (math.floor(j[0] / 90.0), math.floor(j[3] / 90.0), math.floor(j[5] / 90.0), cfx)


def _robtarget(pose, joints, conf) -> str:
    return "[[%s],[%s],%s,%s]" % (fixed(xyz(pose), 3), fixed(quaternion(pose), 8), _cf(joints, conf), _ext(joints))


@register
class AbbRapidIrc5(RobotPost):
    name = "ABB_RAPID_IRC5"
    PROG_EXT = "mod"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.SPEED = "v500"
        self.ZONE = "z1"
        self.TOOL = "tool0"
        self.WOBJ = "wobj0"
        self.TOOLS = []
        self.FRAMES = []
        self.PROCS = []  
        self.MAIN = None  
        self.LINES = None
        self.PROG_COUNT = 0

    
    def ProgStart(self, progname):
        self.PROG_COUNT += 1
        self.CUR_NAME = "Main" if self.PROG_COUNT == 1 else progname
        
        
        self.LINES = ["! ActUnit Turntable_Mechanical_Unit_Name;"] if any(a in ("T", "J") for a in self.AXES_TYPE) else []
        self.LINES += ["ConfJ \\On;", "ConfL \\Off;"]

    def ProgFinish(self, progname):
        block = (self.CUR_NAME, self.LINES or [])
        if self.PROG_COUNT == 1:
            self.MAIN = block
        else:
            self.PROCS.append(block)
        self.LINES = None

    def addline(self, line):
        if self.LINES is None:
            self.LINES = []
        self.LINES.append(line)

    def _declarations(self):
        out = ["\t! Tool variables: "]
        out += ["\t" + d for d in self.TOOLS]
        out += ["", "\t! Reference variables:"]
        out += ["\t" + d for d in self.FRAMES]
        out += [""]
        return out

    @staticmethod
    def _proc(name, lines):
        return ["\tPROC %s()" % name] + ["\t\t" + l for l in lines] + ["\tENDPROC", ""]

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        main = self.MAIN or ("Main", self.LINES or [])
        head = HEADER + "MODULE MOD_%s\n\n    ! -------------------------------\n    ! Define customized variables here\n    ! ...\n\n" % progname
        if self.MAX_LINES_X_PROG > 0 and len(main[1]) > self.MAX_LINES_X_PROG and not self.PROCS:
            self._save_split(folder, progname, head, main[1])
            return
        body = self._declarations()
        for name, lines in self.PROCS:
            body += self._proc(name, lines)
        body += self._proc(main[0], main[1])
        body += ["ENDMODULE"]
        self.save_file(folder, "%s.%s" % (progname, self.PROG_EXT), head + "\n".join(body) + "\n")

    def _save_split(self, folder, progname, head, lines):
        n = self.MAX_LINES_X_PROG
        parts = [lines[i : i + n] for i in range(0, len(lines), n)]
        for i, part in enumerate(parts):
            k = i % 3 + 1
            text = HEADER + "MODULE MOD_Tmp%i\n\n\tPROC Prg_Tmp%i()\n\n" % (k, k)
            text += "\n".join("\t\t" + l for l in part) + "\n\n\tENDPROC\n\nENDMODULE\n"
            self.save_file(folder, "%s_%i.%s" % (progname, i, self.PROG_EXT), text)
        loader = self._declarations()
        loader += [
            "",
            '\tLOCAL PERS string modulepath1 := "";',
            '\tLOCAL PERS string modulepath2 := "";',
            "\tLOCAL VAR loadsession load1;",
            "\tLOCAL VAR loadsession load2;",
            '\tLOCAL VAR string module_unload := "";',
            "\t",
            "\tPROC Main()",
            "\t\t! This program has automatically been split into smaller subprograms",
            "\t\tTPErase;",
            "",
        ]
        count = len(parts)
        for i in range(count):
            k = i % 3 + 1
            slot = 1 if i % 2 == 0 else 2
            other = 2 if slot == 1 else 1
            path = lambda j: '"%s%s_%i.%s"' % (LOADER_PATH, progname, j, self.PROG_EXT)
            loader.append('\t\tTPWrite "Starting Subprogram %i/%i";' % (i + 1, count))
            if i == 0:
                loader.append("\t\t! Load the first program (may take some time)")
                loader.append("\t\tmodulepath1 := %s;" % path(0))
                loader.append("\t\tLoad \\Dynamic, modulepath1;")
            else:
                loader.append("\t\t! Wait for the program to be ready (fast)")
                loader.append("\t\tWaitLoad load%i;" % slot)
            if i + 1 < count:
                loader.append("\t\tmodulepath%i := %s;" % (other, path(i + 1)))
                loader.append("\t\tStartLoad modulepath%i, load%i;" % (other, other))
            loader.append('\t\t%%"MOD_Tmp%i:Prg_Tmp%i"%%;' % (k, k))
            loader.append("\t\tUnload modulepath%i;" % slot)
            loader.append('\t\tmodulepath%i := "";' % slot)
            loader += ["", ""]
        loader += ['\t\tTPWrite "Program completed";', "", "\tENDPROC", "", "ENDMODULE"]
        self.save_file(folder, "%s.%s" % (progname, self.PROG_EXT), head + "\n".join(loader) + "\n")

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def _suffix(self):
        return "%s,%s,%s \\WObj:=%s;" % (self.SPEED, self.ZONE, self.TOOL, self.WOBJ)

    def MoveJ(self, pose, joints, conf_RLF=None):
        self.addline("MoveAbsJ %s,%s" % (_joints(joints), self._suffix()))

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is None:
            target = "CalcRobT(%s,%s \\WObj:=%s)" % (_joints(joints), self.TOOL, self.WOBJ)
        else:
            target = _robtarget(pose, joints, conf_RLF)
        self.addline("MoveL %s,%s" % (target, self._suffix()))

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            t1 = "CalcRobT(%s, %s \\WObj:=%s)" % (_joints(joints1), self.TOOL, self.WOBJ)
            t2 = "CalcRobT(%s,%s \\WObj:=%s)" % (_joints(joints2), self.TOOL, self.WOBJ)
        else:
            t1 = _robtarget(pose1, joints1, conf_RLF_1)
            t2 = _robtarget(pose2, joints2, conf_RLF_2)
        self.addline("MoveC %s,%s,%s" % (t1, t2, self._suffix()))

    
    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.WOBJ = strip_name(frame_name, "rdkWObj")
        decl = 'PERS wobjdata %s := [FALSE, TRUE, "", [[0,0,0],[1,0,0,0]],[[%s],[%s]]];' % (self.WOBJ, fixed(xyz(pose), 3), fixed(quaternion(pose), 8))
        if decl not in self.FRAMES:
            self.FRAMES.append(decl)

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.TOOL = strip_name(tool_name, "rdkTool")
        decl = "PERS tooldata %s := [TRUE,[[%s],[%s]],[1,[0,0,20],[1,0,0,0],0,0,0.005]];" % (self.TOOL, fixed(xyz(pose), 3), fixed(quaternion(pose), 8))
        if decl not in self.TOOLS:
            self.TOOLS.append(decl)

    def Pause(self, time_ms):
        if time_ms <= 0:
            self.addline("STOP;")
        else:
            self.addline("WaitTime %.3f;" % (time_ms * 0.001))

    def setSpeed(self, speed_mms):
        speed_mms = min(speed_mms, 7000.0)  
        if float(speed_mms).is_integer() and int(speed_mms) in STANDARD_SPEEDS:
            self.SPEED = "v%i" % int(speed_mms)
        else:
            self.SPEED = "[%.2f,500,5000,1000]" % speed_mms

    def setAcceleration(self, accel_mmss):
        pass  

    def setSpeedJoints(self, speed_degs):
        pass

    def setAccelerationJoints(self, accel_degss):
        pass

    def setZoneData(self, zone_mm):
        if zone_mm < 0:
            self.ZONE = "fine"
        elif float(zone_mm).is_integer() and int(zone_mm) in STANDARD_ZONES:
            self.ZONE = "z%i" % zone_mm
        else:
            z = zone_mm
            self.ZONE = "[FALSE,%.1f,%.1f,%.1f,%.1f,%.1f,%.1f]" % (z, 1.5 * z, 1.5 * z, 1.5 * z / 10, 1.5 * z, 1.5 * z / 10)

    
    def setDO(self, io_var, io_value):
        var = "D_OUT_%s" % io_var if isinstance(io_var, int) else str(io_var)
        self.addline("SetDO %s, %s;" % (var, io_value))

    def setAO(self, io_var, io_value):
        var = "A_OUT_%s" % io_var if isinstance(io_var, int) else str(io_var)
        self.addline("SetAO %s, %s;" % (var, io_value))

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        var = "D_IN_%s" % io_var if isinstance(io_var, int) else str(io_var)
        if timeout_ms is None or timeout_ms <= 0:
            self.addline("WaitDI %s, %s;" % (var, io_value))
        else:
            self.addline("WaitDI %s, %s, \\MaxTime:=%.1f;" % (var, io_value, timeout_ms / 1000.0))

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            
            name, paren, args = code.partition("(")
            name = name.strip().replace(" ", "_")
            self.addline("%s %s;" % (name, args.rsplit(")", 1)[0]) if paren else "%s;" % name)
        else:
            self.addline(code)

    def RunMessage(self, message, iscomment=False):
        if iscomment:
            self.addline("! %s" % message)
        else:
            self.addline('TPWrite "%s";' % message)
