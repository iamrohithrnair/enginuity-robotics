




























import os

from ..base import RobotPost, register
from ..robomath import xyz

DEG = 180.0 / 3.141592653589793


PYTHON_DIR = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))

JOINT_TARGET_L = "#Linear movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."
JOINT_TARGET_C = "#Circular movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."


def euler_xyz(h):
    pass
    import math

    b = math.asin(max(-1.0, min(1.0, h[0][2])))
    a = math.atan2(-h[1][2], h[2][2])
    c = math.atan2(-h[0][1], h[0][0])
    return [a * DEG, b * DEG, c * DEG]


def pose_text(pose):
    x, y, z = xyz(pose)
    a, b, c = euler_xyz(pose)
    return "%.3f, %.3f, %.3f,  %.3f, %.3f, %.3f" % (x, y, z, a, b, c)


def joints_text(joints):
    return ",".join("%.6f" % v for v in joints)


def call_name(code):
    return code.replace(" ", "").replace(",", "")


class PythonDriverPost(RobotPost):
    pass

    PROG_EXT = "py"
    
    ROBOT_VAR = "robot"
    
    FRAME_NAME = "robot"
    START = "# Program Start: %s"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.LINES = []
        self.PROGS = []
        self.PROG_NAME = None
        self.TAB = "    "

    def addline(self, line):
        self.LINES.append(self.TAB + line)

    def header(self):
        raise NotImplementedError

    def footer(self):
        raise NotImplementedError

    def ProgStart(self, progname):
        self.PROG_NAME = progname
        self.PROGS.append(progname)
        self.LINES.append(self.START % progname)
        self.LINES.append("def %s():" % progname)
        self.addline("global %s" % self.ROBOT_VAR)
        self.addline("# Generating program: %s" % progname)
        self.LINES.append("")

    def ProgFinish(self, progname):
        self.addline("return")
        self.LINES.append("")

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        text = self.header() + "".join(l + "\n" for l in self.LINES) + self.footer()
        self.save_file(folder, "%s.%s" % (progname, self.PROG_EXT), text)

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    def MoveJ(self, pose, joints, conf_RLF=None):
        self.addline("%s.MoveJ([%s])" % (self.ROBOT_VAR, joints_text(joints)))

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is None:
            self.addline(JOINT_TARGET_L)
            return
        self.addline("%s.MoveL([%s,%s])" % (self.ROBOT_VAR, joints_text(joints), pose_text(pose)))

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            self.addline(JOINT_TARGET_C)
            return
        self.addline(
            "%s.MoveC([%s,%s,%s,%s])" % (self.ROBOT_VAR, joints_text(joints1), pose_text(pose1), joints_text(joints2), pose_text(pose2))
        )

    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.addline("#%s ref frame set to %s" % (self.FRAME_NAME, pose_text(pose)))

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.addline("%s.setTool([%s])" % (self.ROBOT_VAR, pose_text(pose)))
        self.LINES.append("")

    def Pause(self, time_ms):
        if time_ms < 0:
            self.addline("print('STOP')")
        else:
            self.addline("import time")
            self.addline("time.sleep(%.3f)" % (time_ms * 1000))

    def _speed(self, slot, value):
        vals = ["-1"] * 4
        vals[slot] = str(float(value))
        self.addline("%s.setSpeed([%s])" % (self.ROBOT_VAR, ",".join(vals)))

    def setSpeed(self, speed_mms):
        self._speed(0, speed_mms)

    def setSpeedJoints(self, speed_degs):
        self._speed(1, speed_degs)

    def setAcceleration(self, accel_mmss):
        self._speed(2, accel_mmss)

    def setAccelerationJoints(self, accel_degss):
        self._speed(3, accel_degss)

    def setZoneData(self, zone_mm):
        self.addline("%s.setRounding(%.3f)" % (self.ROBOT_VAR, zone_mm))

    def setDO(self, io_var, io_value):
        self.addline("%s.setDO([%s,%s])" % (self.ROBOT_VAR, io_var, io_value))

    def setAO(self, io_var, io_value):
        self.setDO(io_var, io_value)

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        timeout = timeout_ms if timeout_ms < 0 else timeout_ms / 1000
        self.addline("%s.WaitDI([%s,%s,%s])" % (self.ROBOT_VAR, io_var, io_value, timeout))

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            name = call_name(code)
            self.addline("%s()" % name)
            self.addline("%s = RDK.Item('%s',ITEM_TYPE_PROGRAM)" % (self.PROG_NAME, self.PROG_NAME))
            self.addline("%s.RunInstruction('%s',INSTRUCTION_CALL_PROGRAM)" % (self.PROG_NAME, name))
        else:
            self.LINES.append(code)

    def RunMessage(self, message, iscomment=False):
        if iscomment:
            self.addline("#%s" % message)
        else:
            self.addline("print('%s')" % message)


@register
class XArm(PythonDriverPost):
    name = "xArm"

    def header(self):
        return HEADER % {"pypath": PYTHON_DIR, "ip": self.IP_COM}

    def footer(self):
        first = self.PROGS[0] if self.PROGS else ""
        return 'if __name__ == "__main__":\n    # Connect to the robot and run the program\n    ConnectRobot()\n    %s()\n' % first



HEADER = r'''# Program automatically generated by Enginuity using the post processor for uFactory uArm robots
# Run this file with Python to run the program on the robot
# 
# Make sure the xArm Python library is installed or available in the path
import sys
sys.path.insert(0,"%(pypath)s")
# Import the xArm library
from xarm.wrapper import XArmAPI

def print_message(arg):
    print(arg)

def print_joints(arg1, arg2):
    print(arg1)

def UpdateStatus(arg):
    pass

DRIVER_VERSION = "Enginuity Driver for xArm v1.1.5"

ROBOTCOM_UNKNOWN = -1000
ROBOTCOM_CONNECTION_PROBLEMS = -3
ROBOTCOM_DISCONNECTED = -2
ROBOTCOM_NOT_CONNECTED = -1
ROBOTCOM_READY = 0
ROBOTCOM_WORKING = 1
ROBOTCOM_WAITING = 2
nDOFs_MIN = 6


class ComRobot:
    """Robot class for programming xArm robots"""
    LAST_MSG = None  # Keep a copy of the last message received
    CONNECTED = False  # Connection status is known at all times
    UARMAPI = None  #XArmAPI("127.0.0.1")
    BUFFER_SIZE = None
    TIMEOUT = None
    #Speed and accelerations
    LINEARSPEED = 100
    LINEARACELL = 30
    JOINTSPEED = 50
    JOINTACELL = 80
    LAST_TARGET_JOINTS = []

    # This is executed when the object is created
    def __init__(self):
        self.BUFFER_SIZE = 512  # bytes
        #self.TIMEOUT = 5 * 60  # seconds: it must be enough time for a movement to complete
        self.TIMEOUT = 10  # seconds

        # destructor

    def __del__(self):
        self.disconnect()

    # Disconnect from robot
    def disconnect(self):
        self.CONNECTED = False
        if self.UARMAPI:
            try:
                self.UARMAPI.disconnect()
            except OSError:
                return False
        return True

    # Connect to robot
    def connect(self, ip, port=-1):
        global ROBOT_MOVING
        self.disconnect()
        #print_message('Connecting to robot %%s:%%i' %% (ip, port))
        print_message(DRIVER_VERSION)
        print_message('Connecting to robot IP %%s' %% (ip))
        # Create new socket connection
        UpdateStatus(ROBOTCOM_WORKING)
        try:
            import time
            self.UARMAPI = XArmAPI(ip, do_not_open=False)
            self.UARMAPI.motion_enable(enable=True)
            self.UARMAPI.clean_error()
            time.sleep(0.01)
            self.UARMAPI.set_mode(0)
            time.sleep(0.01)
            self.UARMAPI.set_state(state=0)
            time.sleep(0.01)
            self.UARMAPI.motion_enable(True)

            self.LAST_TARGET_JOINTS = self.UARMAPI.angles
            #self.UARMAPI.reset(wait=True)
            #self.UARMAPI.register_report_callback(self.monitoringCallback, report_cartesian=False, report_joints=True,
            #                            report_state=False, report_error_code=False, report_warn_code=False,
            #                            report_mtable=False, report_mtbrake=False, report_cmd_num=False)
        except Exception as e:
            print_message(str(e))
            return False

        version = self.UARMAPI.version
        print_message("API Version:" + str(version))

        self.CONNECTED = True
        ROBOT_MOVING = False

        sys.stdout.flush()
        return True

    def joints_error(self, j1, j2):
        if j1 is None or j2 is None:
            return 1e6

        if type(j2) is list and type(j2[0]) is str:
            j2 = [float(x) for x in j2]

        error = -1
        nj = min(len(j1), len(j2))
        for i in range(nj):
            error = max(error, abs(j1[i] - j2[i]))

        return error

    def recv_acknowledge(self):
        done = False
        startState = self.UARMAPI.state
        endState = 0
        while done == False:

            #cartesianPosition = self.UARMAPI.get_position(is_radian=False)
            jointPosition = self.UARMAPI.angles
            print_joints(jointPosition, True)

            #if self.joints_error(self.UARMAPI.angles,self.LAST_TARGET_JOINTS) < 4.0:
            #    done = True
            curState = self.UARMAPI.state
            if (curState != 1) and (curState != 4):
                endState = curState
                done = True

            if self.UARMAPI.connected != True:
                return False

            if self.UARMAPI.has_error == True:
                print_message("Error code:" + str(self.UARMAPI.error_code))
                self.UARMAPI.clean_error()
                return False

            if self.UARMAPI.has_warn == True:
                print_message("Warning code:" + str(self.UARMAPI.warn_code))
                self.UARMAPI.clean_warn()
                return False

        jointPosition = self.UARMAPI.angles
        print_joints(jointPosition, True)

        return True

    def MoveJ(self, joints_xyzwpr):
        global nDOFs_MIN
        import math
        joints = joints_xyzwpr[:nDOFs_MIN]
        xyzwpr = joints_xyzwpr[nDOFs_MIN:]

        jointsRad = [round(x * (math.pi / 180), 6) for x in joints[:6]] + [0]  # 6 DOF + 1 null
        try:
            #self.UARMAPI.set_mode(mode=1) #Mode 1 corresponds to moving this breaks it
            self.UARMAPI.set_state(state=0)
            self.UARMAPI.motion_enable(True)
            self.UARMAPI.set_servo_angle(angle=joints, mvacc=self.JOINTACELL, speed=self.JOINTSPEED, is_radian=False, wait=False)
            import time
            if self.UARMAPI.state == 2:
                time.sleep(0.01)
            self.LAST_TARGET_JOINTS = joints
        except Exception as e:
            print_message(str(e))
            return False
        return True

    def MoveL(self, joints_xyzwpr):
        global nDOFs_MIN
        joints = joints_xyzwpr[:nDOFs_MIN]
        joints.insert(0, 0)
        xyzwpr = joints_xyzwpr[nDOFs_MIN:]
        try:
            #self.UARMAPI.set_mode(mode=1) #Mode 1 corresponds to moving
            self.UARMAPI.set_state(state=0)
            self.UARMAPI.motion_enable(True)
            #xArmPose = self.UARMAPI.get_forward_kinematics(tuple(joints),input_is_radian=False,return_is_radian=False)[1]
            self.UARMAPI.set_position_aa(axis_angle_pose=xyzwpr, mvacc=self.LINEARACELL, speed=self.LINEARSPEED, is_radian=False, wait=False)
            import time
            if self.UARMAPI.state == 2:
                time.sleep(0.01)
            self.LAST_TARGET_JOINTS = joints
        except Exception as e:
            print_message(str(e))
            return False
        return True

    def MoveC(self, joints):
        try:
            self.UARMAPI.set_mode(mode=1)  #Mode 1 corresponds to moving
            self.UARMAPI.motion_enable(True)
            self.UARMAPI.move_circle(pose1=joints[0:6], pose2=joints[7:], percent=50, speed=self.JOINTSPEED, mvacc=self.JOINTACELL, wait=True)
            self.LAST_TARGET_JOINTS = joints
        except Exception as e:
            print_message(str(e))
            return False
        return True

    def getJoints(self):
        import math
        if (self.UARMAPI.default_is_radian == True):
            jointPosition = self.UARMAPI.angles
            for i in range(0, len(jointPosition)):
                jointPosition[i] = math.degrees(jointPosition[i])
        else:
            #cartesianPosition = self.UARMAPI.get_position(is_radian=False)
            jointPosition = self.UARMAPI.angles
        return jointPosition

    def setSpeed(self, speed_values):
        # speed_values[0] = speed_values[0] # linear speed in mm/s
        # speed_values[1] = speed_values[1] # joint speed in mm/s
        # speed_values[2] = speed_values[2] # linear acceleration in mm/s2
        # speed_values[3] = speed_values[3] # joint acceleration in deg/s2
        if (speed_values[0] != -1):
            self.LINEARSPEED = speed_values[0]

        if (speed_values[1] != -1):
            self.JOINTSPEED = speed_values[1]

        if (speed_values[2] != -1):
            self.LINEARACELL = speed_values[2]

        if (speed_values[3] != -1):
            self.JOINTACELL = speed_values[3]

        return True

    def setTool(self, tool_pose):
        self.UARMAPI.set_tcp_offset(tool_pose)
        return True

    def Pause(self, timeMS):
        import time
        time.sleep(timeMS / 1000)
        return True

    def setRounding(self, rounding):
        self.UARMAPI.set_tcp_jerk(rounding)
        return True

    def setDO(self, digital_IO_State):
        self.UARMAPI.set_cgpio_digital_output_function(digital_IO_State[0], digital_IO_State[1])
        return True

    def WaitDI(self, digital_IO_Num):
        import time
        start = time.time()
        ioNumber = digital_IO_Num[0]
        ioState = self.UARMAPI.get_tgpio_digital(ioNumber)
        desiredState = digital_IO_Num[1]
        try:
            timeout = digital_IO_Num[2]
        except Exception as e:
            e = e
            timeout = 0

        while not (ioState == desiredState) and (time.time() - start) < timeout:
            ioState = self.UARMAPI.get_tgpio_digital(ioNumber)
            time.sleep(0.1)
        return True

    #def SendCmd(self, cmd, values=None):
    #    """Send a command. Returns True if success, False otherwise."""
    #    # print('SendCmd(cmd=' + str(cmd) + ', values=' + str(values) if values else '' + ')')
    #    # Skip the command if the robot is not connected
    #    if not self.CONNECTED:
    #        UpdateStatus(ROBOTCOM_NOT_CONNECTED)
    #        return False
    #
    #    if not self.send_int(cmd):
    #        print_message("Robot connection broken")
    #        UpdateStatus(ROBOTCOM_NOT_CONNECTED)
    #        return False
    #
    #    if values is None:
    #        return True
    #    elif not isinstance(values, list):
    #        values = [values]
    #
    #    if not self.send_array(values):
    #        print_message("Robot connection broken")
    #        UpdateStatus(ROBOTCOM_NOT_CONNECTED)
    #        return False
    #
    #    return True


def ConnectRobot():
    # Connect to the robot
    global robot
    ROBOT_IP   = "%(ip)s"
    robot = ComRobot()
    while not robot.connect(ROBOT_IP):
        print_message("Retrying connection...")
        import time
        time.sleep(0.5)

    print_message("Connected to robot: " + ROBOT_IP)



'''
