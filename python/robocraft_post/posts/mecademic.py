# Formats Mecademic motion commands, tool frames and speed settings as controller text.



















import math
import re

from ..base import RobotPost, register

JOINT_TARGET_L = "// Linear movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."


def _xyz_euler(pose):
    pass
    r02 = pose[0][2]
    b = math.asin(max(-1.0, min(1.0, r02)))
    if abs(r02) > 1.0 - 1e-10:
        a = 0.0
        c = math.atan2(pose[1][0], pose[1][1])
    else:
        a = math.atan2(-pose[1][2], pose[2][2])
        c = math.atan2(-pose[0][1], pose[0][0])
    return [a * 180.0 / math.pi, b * 180.0 / math.pi, c * 180.0 / math.pi]


def _pose(pose):
    return ", ".join("%.3f" % v for v in [pose[0][3], pose[1][3], pose[2][3]] + _xyz_euler(pose))


@register
class Mecademic(RobotPost):
    name = "Mecademic"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.LINES = []
        self.NPROGS = 0
        self.DONE = False
        self.CALL = 0

    def addline(self, line):
        if not self.DONE:
            self.LINES.append(line)

    def ProgStart(self, progname):
        self.NPROGS += 1

    def ProgFinish(self, progname):
        self.DONE = True

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        self.save_file(folder, "%s.txt" % progname, "".join(l + "\n" for l in self.LINES))

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def MoveJ(self, pose, joints, conf_RLF=None):
        self.addline("MoveJoints(%s)" % ", ".join("%.6f" % v for v in joints))

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is None:
            self.addline(JOINT_TARGET_L)
            return
        self.addline("MoveLin(%s)" % _pose(pose))

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        pass

    
    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.addline("SetWRF(%s)" % _pose(pose))

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.addline("SetTRF(%s)" % _pose(pose))

    def Pause(self, time_ms):
        if time_ms >= 0:
            self.addline("Delay(%.3f)" % (time_ms * 0.001))

    def setSpeed(self, speed_mms):
        self.addline("SetCartLinVel(%.3f)" % min(speed_mms, 1000.0))

    def setAcceleration(self, accel_mmss):
        self.addline("SetCartAcc(%.3f)" % min(accel_mmss, 600.0))

    def setSpeedJoints(self, speed_degs):
        self.addline("SetJointVel(%.3f)" % min(speed_degs, 100.0))

    def setAccelerationJoints(self, accel_degss):
        self.addline("SetJointAcc(%.3f)" % min(accel_degss, 150.0))

    def setZoneData(self, zone_mm):
        self.addline("SetBlending(%.3f)" % max(0.0, min(zone_mm, 100.0)))

    
    def setDO(self, io_var, io_value):
        self.addline("// Setting Digital Outputs is not implemented (%s=%s)" % (io_var, io_value))

    def setAO(self, io_var, io_value):
        self.addline("// Setting Analog Outputs is not implemented (%s=%s)" % (io_var, io_value))

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        self.addline("// Waiting for Digital Input is not implemented (%s==%s)" % (io_var, io_value))

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            numbers = re.findall(r"\d+", code)
            self.CALL = int(numbers[-1]) if numbers else self.CALL + 1
            self.addline("// %s" % code)
            self.addline("StartProgram(%d)" % self.CALL)
        else:
            self.addline(code)

    def RunMessage(self, message, iscomment=False):
        if iscomment:
            self.addline("// %s" % message)
