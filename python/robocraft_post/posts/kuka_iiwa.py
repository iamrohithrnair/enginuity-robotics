





















import math

from ..base import RobotPost, register
from ..robomath import mul, xyzabc

HEADER = (
    "package application;\n\nimport com.kuka.roboticsAPI.applicationModel.RoboticsAPIApplication;\n"
    "import static com.kuka.roboticsAPI.motionModel.BasicMotions.*;\n\nimport com.kuka.roboticsAPI.deviceModel.LBR;\n"
    "import com.kuka.roboticsAPI.deviceModel.LBRE1Redundancy;\nimport com.kuka.roboticsAPI.geometricModel.Frame;\n"
    "import com.kuka.roboticsAPI.geometricModel.Tool;\nimport com.kuka.roboticsAPI.geometricModel.math.Transformation;\n\n"
    "import com.kuka.roboticsAPI.motionModel.LIN;\nimport com.kuka.roboticsAPI.motionModel.PTP;\n"
    "import com.kuka.roboticsAPI.motionModel.Spline;\nimport com.kuka.roboticsAPI.uiModel.ApplicationDialogType;\n\n"
    "public class %s extends RoboticsAPIApplication {\n\tprivate LBR robot;\n\tprivate Tool TOOL;\n\tSpline move_curve;\n"
    "\t// private Frame FRAME;\n\t\n\tpublic void initialize() {\t\t\n\t\trobot = getContext().getDeviceFromType(LBR.class);\n\t}\n"
)
BLANK = "\t\t"
JOINT_TARGET_C = "// Circular movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."


def _rad(values):
    return ",".join("%.5f" % (v * math.pi / 180.0) for v in values)


def _frame(pose):
    x = xyzabc(pose)
    return "%.3f,%.3f,%.3f,%s" % (x[0], x[1], x[2], _rad(x[3:]))


def _deg(pose):
    x = xyzabc(pose)
    return "%.3f,%.3f,%.3f,%.5f,%.5f,%.5f" % tuple(x)


def _value(value):
    if isinstance(value, str):
        return value
    return "TRUE" if value > 0 else "FALSE"


@register
class KukaIiwa(RobotPost):
    name = "KUKA_IIWA"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.LINES = []
        self.CLASS = None
        self.FRAME = None
        self.MOVER = "robot"
        self.SPEED = 300.0
        self.BLEND = 1.0
        self.N_PTP = 0
        self.N_LIN = 0
        self.N_CIRC = 0
        self.FIRST_COMMENT = False

    def addline(self, line):
        self.FIRST_COMMENT = False
        if not line and self.LINES and self.LINES[-1] == BLANK:
            return  
        self.LINES.append("\t\t" + line if line else BLANK)

    def ProgStart(self, progname):
        if self.CLASS is None:
            self.CLASS = progname
            self.LINES.append("\tpublic void run() {")
            self.LINES += [BLANK, BLANK]
            self.FIRST_COMMENT = True
        else:
            self.LINES.append("\tpublic void %s() {" % progname)
            self.LINES.append(BLANK)

    def ProgFinish(self, progname):
        self.LINES.append("\t}")

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        text = HEADER % (self.CLASS or progname) + "".join(l + "\n" for l in self.LINES) + "}\n"
        self.save_file(folder, "%s.java" % progname, text)

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def _target(self, pose):
        return mul(self.FRAME, pose) if self.FRAME is not None else pose

    def _motion(self):
        return ".setCartVelocity(%.2f).setBlendingCart(%.2f)" % (self.SPEED, self.BLEND)

    def MoveJ(self, pose, joints, conf_RLF=None):
        self.N_PTP += 1
        self.addline("")
        self.addline("PTP MovePTP_%d = ptp(%s);" % (self.N_PTP, _rad(joints)))
        self.addline("%s.move(MovePTP_%d);" % (self.MOVER, self.N_PTP))

    def MoveL(self, pose, joints, conf_RLF=None):
        self.N_LIN += 1
        n = self.N_LIN
        if pose is None:
            self.addline("LIN TargetLIN_%d = lin(%s);" % (n, _rad(joints)))
            self.addline("%s.move(TargetLIN_%d);" % (self.MOVER, n))
            return
        self.addline("Frame FrameLIN_%d = new Frame(%s);" % (n, _frame(self._target(pose))))
        self.addline("%s.move(lin(FrameLIN_%d)%s);" % (self.MOVER, n, self._motion()))

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        self.addline("")
        if pose1 is None or pose2 is None:
            self.addline(JOINT_TARGET_C)
            self.addline("")
            return
        a, b = self.N_CIRC + 1, self.N_CIRC + 2
        self.N_CIRC += 2
        self.addline('getLogger().info("Move circular to FrameCIRC_%d and FrameCIRC_%d");' % (a, b))
        self.addline("Frame FrameCIRC_%d = new Frame(%s);" % (a, _frame(self._target(pose1))))
        self.addline("Frame FrameCIRC_%d = new Frame(%s);" % (b, _frame(self._target(pose2))))
        self.addline("%s.move(circ(FrameCIRC_%d, FrameCIRC_%d)%s);" % (self.MOVER, a, b, self._motion()))

    
    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.FRAME = pose
        self.addline("// Using Reference Frame: %s" % frame_name)
        self.addline('// robot.addDefaultMotionFrame("%s", Transformation.ofDeg(%s);' % (frame_name, _deg(pose)))

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.MOVER = "TOOL"
        self.addline("// Using TCP: %s" % tool_name)
        self.addline('TOOL = new Tool("%s");' % tool_name)
        self.addline("TOOL.attachTo(robot.getFlange(), Transformation.ofDeg(%s));" % _deg(pose))

    def Pause(self, time_ms):
        if time_ms < 0:
            self.addline('if (getApplicationUI().displayModalDialog(ApplicationDialogType.QUESTION, "Program paused. Select Cancel to stop the program.", "OK", "Cancel")== 1)')
            self.addline("{")
            self.addline("\treturn;")
            self.addline("}")
        elif time_ms > 0:
            self.addline("try {")
            self.addline("\tThread.sleep(%.3f);" % time_ms)
            self.addline("} catch (InterruptedException e){")
            self.addline('\tgetLogger().info("Pause Skipped");')
            self.addline("}")

    def setSpeed(self, speed_mms):
        self.SPEED = speed_mms
        self.addline("// Linear speed set to %.3f mm/s" % speed_mms)

    def setAcceleration(self, accel_mmss):
        self.addline("// Warning: set linear acceleration to %.3f mm/ss has no effect" % accel_mmss)

    def setSpeedJoints(self, speed_degs):
        self.addline("// Joint speed set to %.3f rad/s" % (speed_degs * math.pi / 180.0))

    def setAccelerationJoints(self, accel_degss):
        self.addline("// Warning: set angular acceleration to %.3f deg/s has no effect" % accel_degss)

    def setZoneData(self, zone_mm):
        self.BLEND = max(0.0, zone_mm)
        self.addline("// smoothing/blending set to %.1f mm" % self.BLEND)

    
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
            self.addline(code + ";")
        else:
            self.addline(code)

    def RunMessage(self, message, iscomment=False):
        if iscomment:
            if self.FIRST_COMMENT:
                self.LINES.insert(len(self.LINES) - 1, "\t\t// %s" % message)
                self.FIRST_COMMENT = False
                return
            self.addline("// %s" % message)
        else:
            self.addline("")
            self.addline('getLogger().info("%s");' % message)
            self.addline("")
