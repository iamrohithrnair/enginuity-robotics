# Builds Doosan DRL routines from motion, speed and I/O instructions.
















import re

from ..base import RobotPost, register
from ..robomath import euler_zyz

HEADER = """  
  #--------------------------
  # Add your default header and subprograms here
  # For example, to drive a gripper as a program call:
  # def Gripper_Open():
  #   set_digital_output(3, 1)
  #
  # def Gripper_Close():
  #   set_digital_output(3, 0)
  #
  # Example to drive a spray gun:
  def SprayOn(value):
    # use the value as an output:
    DO_SPRAY = 5
    if value == 0:
      set_digital_output(DO_SPRAY, 0)
    else:
      set_digital_output(DO_SPRAY, 1)

  #--------------------------
  
"""
JOINT_TARGET_C = "# Circular movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."


def _posx(pose):
    a, e, r = euler_zyz(pose)
    return "posx(%.3f,%.3f,%.3f,%.4f,%.4f,%.4f)" % (pose[0][3], pose[1][3], pose[2][3], a, e, r)


def _posj(joints):
    return "posj(%s)" % ",".join("%.6f" % v for v in joints)


@register
class DoosanRobotics(RobotPost):
    name = "Doosan_Robotics"
    PROG_EXT = "drl"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.LINES_GIVEN = kwargs.get("lines_x_prog")
        self.PROGS = []
        self.LINES = []
        self.BLENDING = False

    def addline(self, line):
        self.LINES.append(line)

    def ProgStart(self, progname):
        self.CUR = progname
        self.LINES = []

    def ProgFinish(self, progname):
        if self.BLENDING:
            self.addline("end_blend()")
            self.BLENDING = False
        self.PROGS.append((self.CUR, self.LINES))
        self.LINES = []

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        progs = self.PROGS or [(progname, self.LINES)]
        main = progs[0][1]
        text = "def %s():\n" % progname + HEADER
        for name, lines in progs[1:]:
            text += "  # Subprogram %s\n  def %s():\n" % (name, name) + "".join("    " + l + "\n" for l in lines) + "  \n"
        text += "  \n  # Main program:\n" + "".join("  " + l + "\n" for l in main) + "  # End of main program\n"
        if not (self.LINES_GIVEN is not None and len(main) >= self.LINES_GIVEN):
            text += "  \n"
        text += "%s()\n" % progname
        self.save_file(folder, "%s.%s" % (progname, self.PROG_EXT), text)

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def MoveJ(self, pose, joints, conf_RLF=None):
        self.addline("movej(%s)" % _posj(joints))

    def MoveL(self, pose, joints, conf_RLF=None):
        self.addline("movel(%s)" % (_posj(joints) if pose is None else _posx(pose)))

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            self.addline(JOINT_TARGET_C)
            return
        self.addline("movec(%s,%s)" % (_posx(pose1), _posx(pose2)))

    
    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.addline("set_ref_coord(set_user_cart_coord(%s,ref=DR_BASE))" % _posx(pose))

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.addline("# TCP: %s" % _posx(pose))
        self.addline('set_tcp("%s")' % tool_name)

    def Pause(self, time_ms):
        if time_ms <= 0:
            self.addline("halt() # reimplement this function to force stop")
        else:
            self.addline("wait(%.3f)" % (time_ms / 1000.0))

    def setSpeed(self, speed_mms):
        self.addline("set_velx(%.3f)" % speed_mms)

    def setAcceleration(self, accel_mmss):
        self.addline("set_accx(%.3f)" % accel_mmss)

    def setSpeedJoints(self, speed_degs):
        self.addline("set_velj(%.3f)" % speed_degs)

    def setAccelerationJoints(self, accel_degss):
        self.addline("set_accj(%.3f)" % accel_degss)

    def setZoneData(self, zone_mm):
        if zone_mm < 0:
            self.addline("end_blend()")
            self.BLENDING = False
        else:
            self.addline("begin_blend(radius=%.3f)" % zone_mm)
            self.BLENDING = True

    
    def setDO(self, io_var, io_value):
        if isinstance(io_var, str):
            self.addline("%s = %s" % (io_var, io_value))
        else:
            self.addline("set_digital_output(%s, %s)" % (io_var, io_value))

    def setAO(self, io_var, io_value):
        self.setDO(io_var, io_value)

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        if timeout_ms is None or timeout_ms < 0:
            self.addline("wait_digital_input(%s,%s):" % (io_var, io_value))
        else:
            self.addline("wait_digital_input(%s,%s,%.3f):" % (io_var, io_value, timeout_ms / 1000.0))

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            code = re.sub(r"[^A-Za-z0-9_()]", "", code)
            self.addline(code if "(" in code else code + "()")
        else:
            self.addline(code)

    def RunMessage(self, message, iscomment=False):
        if iscomment:
            self.addline("# %s" % message)
        else:
            self.addline('tp_popup("%s", DR_PM_MESSAGE)' % message)
