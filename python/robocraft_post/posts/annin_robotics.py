# Formats Annin robot moves, speed settings and I/O assignments as controller text.





















from ..base import RobotPost, register
from ..robomath import mul, xyzwpr


def _xyzwprt(pose):
    return "X %.3f Y %.3f Z %.3f W %.3f P %.3f R %.3f T 0.000" % tuple(xyzwpr(pose))


def _value(value):
    if isinstance(value, str):
        return value
    return "TRUE" if value > 0 else "FALSE"


@register
class AnninRobotics(RobotPost):
    name = "Annin_Robotics"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.LINES = []
        self.FRAME = None
        self.SPEED = 10.0

    def addline(self, line):
        self.LINES.append(line)

    def ProgStart(self, progname):
        self.addline("###BEGINNING OF PROGRAM: %s###" % progname)

    def ProgFinish(self, progname):
        self.addline("###END OF PROGRAM###")

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        self.save_file(folder, "%s.ar4" % progname, "".join(l + "\n" for l in self.LINES))

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def _target(self, pose):
        return _xyzwprt(mul(self.FRAME, pose) if self.FRAME is not None else pose)

    def _speed(self):
        return "Sp %.1f Ad 10 As 10 Dd 15 Ds 10" % self.SPEED

    def MoveJ(self, pose, joints, conf_RLF=None):
        if pose is None:
            values = list(joints)[:7] + [0.0] * (7 - len(joints))
            target = " ".join("J%d %.3f" % (i + 1, v) for i, v in enumerate(values))
        else:
            target = self._target(pose)
        self.addline("Move J [*] %s %s $N" % (target, self._speed()))

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is None:
            self.addline("# Linear movement using joint targets is not supported. Change the target type to cartesian or use a joint movement.")
            return
        self.addline("Move L [*] %s %s $F" % (self._target(pose), self._speed()))

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            self.addline("# Circular movement using joint targets is not supported. Change the target type to cartesian or use a joint movement.")
            return
        self.addline("Move C [*] %s %s" % (self._target(pose1), self._target(pose2)))

    
    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.FRAME = pose
        self.addline("# Display message: Using reference: %s" % frame_name)
        self.addline("# Set Base %s" % _xyzwprt(pose))

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.addline("# Display message: Using tool: %s" % tool_name)
        self.addline("# Set Tool %s" % _xyzwprt(pose))

    def Pause(self, time_ms):
        if time_ms < 0:
            self.addline("PAUSE")
        else:
            self.addline("WAIT %.3f" % (time_ms * 0.001))

    def setSpeed(self, speed_mms):
        self.SPEED = speed_mms

    def setAcceleration(self, accel_mmss):
        pass

    def setSpeedJoints(self, speed_degs):
        pass

    def setAccelerationJoints(self, accel_degss):
        pass

    def setZoneData(self, zone_mm):
        self.addline("# Set Rounding %.3f mm" % zone_mm)

    
    def setDO(self, io_var, io_value):
        name = io_var if isinstance(io_var, str) else "OUT[%s]" % io_var
        self.addline("%s=%s" % (name, _value(io_value)))

    setAO = setDO

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        name = io_var if isinstance(io_var, str) else "IN[%s]" % io_var
        line = "WAIT FOR %s==%s" % (name, _value(io_value))
        if timeout_ms is not None and timeout_ms >= 0:
            line += " TIMEOUT=%.1f" % timeout_ms
        self.addline(line)

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            code = "".join(c for c in code if c.isalnum() or c in "_()")
            if "(" not in code:
                code += "()"
        self.addline(code)

    def RunMessage(self, message, iscomment=False):
        self.addline(("# %s" if iscomment else "# Display message: %s") % message)
