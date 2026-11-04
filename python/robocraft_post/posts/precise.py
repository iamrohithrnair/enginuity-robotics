






















import re

from ..base import RobotPost, register
from ..robomath import euler_zyz, mul, eye

JOINT_TARGET_L = "' Linear movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."
JOINT_TARGET_C = "' Circular movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."
NO_ANALOG = "' PreciseFlex robots have no analog I/O. PreciseFlex robots have digital I/O at the base of the robot and at the end of the arm."
PAUSE = [
    'Dim Text As String = "The program has been paused. Click on the Continue button to resume the program."',
    "Dim Label(0) As String",
    "Dim Nop() As String",
    "Dim Index As Integer",
    'Label(0) = "Continue"',
    'Controller.ShowDialog(2, "", Text, Index, Label, Nop)',
]
PROFILE = [
    "'<MotionProfile>prof1",
    "prof1 = New Profile",
    "prof1.Speed = 25",
    "prof1.Speed2 = 0",
    "prof1.Accel = 100",
    "prof1.Decel = 100",
    "prof1.AccelRamp = 0.1",
    "prof1.DecelRamp = 0.1",
    "prof1.Straight = False",
    "prof1.InRange = 10",
    "'</MotionProfile>",
]


def _percent(value, full):
    pass
    return str(max(1, min(100, round(value / full * 100, 1))))


def _xyz(pose):
    a, e, r = euler_zyz(pose)
    return "%.3f,%.3f,%.3f,%.3f,%.3f,%.3f" % (pose[0][3], pose[1][3], pose[2][3], a, e, r)


def _bool(value):
    if isinstance(value, str):
        return value
    return "True" if value > 0 else "False"


@register
class Precise(RobotPost):
    name = "Precise"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.PROGS = []
        self.LINES = []
        self.LOCS = []  
        self.FRAME = eye()

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
        project = "Project%s" % progname
        main = ["'GPL project created using the Precise post-processor for Enginuity", "Module GPL", "    Public Sub MAIN", ""]
        main += ["    Controller.PowerEnabled = 1", "    Robot.Attached = 1", "    Robot.Home", ""]
        main += ["    " + l for l in progs[0][1]] + ["", "    End Sub", ""]
        for name, lines in progs[1:]:
            main += ["    Public Sub %s()" % name] + ["        " + l for l in lines] + ["", "    End Sub", ""]
        main += ["End Module"]
        module = ["Module GModule", "  Public prof1 As Profile"] + ["  Public %s As Location" % n for n, _ in self.LOCS]
        module += ["", "  Public Sub Init"] + ["    " + l for l in PROFILE] + [""]
        for _name, lines in self.LOCS:
            module += ["    " + l for l in lines] + [""]
        module += ["  End Sub", "End Module"]
        gpr = ["ProjectBegin", 'ProjectName="%s"' % project, 'ProjectStart="Main"', 'ProjectSource="Main.gpl"', 'ProjectSource="GModule.gpo"', "ProjectEnd"]
        self.save_file(folder, "%s/Main.gpl" % project, "\n".join(main) + "\n")
        self.save_file(folder, "%s/GModule.gpo" % project, "\n".join(module) + "\n")
        self.save_file(folder, "%s/Project.gpr" % project, "\n".join(gpr) + "\n")

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def _location(self, target_name, kind, values):
        pass
        if target_name:
            name = re.sub(r"[^A-Za-z0-9_()]", "", target_name)
            if name[:1].isdigit():
                name = "P" + name
            name += "_Angular" if kind == 1 else "_Cartesian"
        else:
            name = "Loc%i" % (len(self.LOCS) + 1)
        setter = "%s.Angles(%s)" % (name, values) if kind == 1 else "%s.XYZ(%s)" % (name, values)
        lines = ["'<MotionLocation>%s" % name, "%s = New Location" % name, "%s.Type = %i" % (name, kind), setter]
        lines += ["%s.ZWorld = False" % name, "%s.ZClearance = 1E+32" % name, "%s.Config = 0" % name, "'</MotionLocation>"]
        
        self.LOCS = [(n, lines if n == name else l) for n, l in self.LOCS]
        if all(n != name for n, _ in self.LOCS):
            self.LOCS.append((name, lines))
        return name

    def _angles(self, joints):
        j = list(joints)
        if len(j) < 6 and "T" in self.AXES_TYPE:
            
            j = j[: len(j) - 2] + j[len(j) - 1 :]
        return ",".join("%.3f" % v for v in (j + [0.0] * 12)[:12])

    def _cartesian(self, name, pose):
        return self._location(name, 0, _xyz(mul(self.FRAME, pose)))

    
    def MoveJ(self, pose, joints, conf_RLF=None):
        loc = self._location(self._TargetName, 1, self._angles(joints))
        self.addline("prof1.Straight = False")
        self.addline("Move.Loc(%s, prof1)" % loc)

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is None:
            self.addline(JOINT_TARGET_L)
            return
        loc = self._cartesian(self._TargetName, pose)
        self.addline("prof1.Straight = True")
        self.addline("Move.Loc(%s, prof1)" % loc)

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            self.addline(JOINT_TARGET_C)
            return
        via = self._cartesian(self._TargetNameVia, pose1)
        end = self._cartesian(self._TargetName, pose2)
        self.addline("Move.Arc(%s, %s, prof1)" % (via, end))

    
    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.FRAME = pose
        self.addline("Robot.Base = Location.XYZValue(%s)" % _xyz(pose))

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.addline("Robot.Tool = Location.XYZValue(%s)" % _xyz(pose))

    def Pause(self, time_ms):
        if time_ms < 0:
            for line in PAUSE:
                self.addline(line)
        else:
            self.addline("Thread.Sleep(%s)" % time_ms)

    def setSpeed(self, speed_mms):
        self.addline("prof1.Speed = %s" % _percent(speed_mms, 500.0))

    def setAcceleration(self, accel_mmss):
        value = _percent(accel_mmss, 4000.0)
        self.addline("prof1.Accel = %s" % value)
        self.addline("prof1.Decel = %s" % value)

    def setSpeedJoints(self, speed_degs):
        self.addline("prof1.Speed = %s" % _percent(speed_degs, 720.0))

    def setAccelerationJoints(self, accel_degss):
        self.setAcceleration(accel_degss)

    def setZoneData(self, zone_mm):
        if zone_mm > 0:
            self.addline("prof1.InRange = -1")
        elif zone_mm == 0:
            self.addline("prof1.InRange = 10")
        elif zone_mm == -1:
            self.addline("prof1.InRange = 100")

    
    def setDO(self, io_var, io_value):
        self.addline("Signal.DIO(%s) = %s" % (io_var, _bool(io_value)))

    def setAO(self, io_var, io_value):
        self.addline(NO_ANALOG)

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        target = _bool(io_value)
        other = "[]" if isinstance(io_value, str) else ("False" if io_value > 0 else "True")
        if timeout_ms is None or timeout_ms < 0:
            lines = ["Dim DI_wait As Boolean", "DI_wait = %s" % other, "While DI_wait = %s" % other, "  DI_wait = Signal.DIO(%s)" % io_var, "End While"]
        else:
            lines = [
                "Dim DI_wait, DI_while As Boolean",
                "Dim StartTime, ElapsedTime As Double",
                "DI_wait = %s" % other,
                "DI_while = DI_wait",
                "StartTime = Controller.Timer(1)",
                "While DI_while = %s" % other,
                "  DI_wait = Signal.DIO(%s)" % io_var,
                "  DI_while = DI_wait",
                "  ElapsedTime = Controller.Timer(1) - StartTime",
                "  if ElapsedTime >= %s Then" % (timeout_ms / 1000.0),
                "    DI_while = %s" % target,
                "  End If",
                "End While",
            ]
        for line in lines:
            self.addline(line)

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            code = re.sub(r"[^A-Za-z0-9_()]", "", code)
            self.addline(code if "(" in code else code + "()")
        else:
            self.addline(code)

    def RunMessage(self, message, iscomment=False):
        if iscomment:
            self.addline("' %s" % message)
        else:
            self.addline('Controller.SystemMessage("Important message: %s")' % message)
