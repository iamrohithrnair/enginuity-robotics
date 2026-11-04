


















import re

from ..base import RobotPost, register
from ..robomath import mul, xyzwpr


HEADER = """# Program generated for a Niryo robot
import sys
import math

from robolink import import_install

import_install("pyniryo")
import pyniryo

def print_message(arg):
    print(arg)

def UpdateStatus(arg):
    pass

ROBOTCOM_UNKNOWN = -1000
ROBOTCOM_CONNECTION_PROBLEMS = -3
ROBOTCOM_DISCONNECTED = -2
ROBOTCOM_NOT_CONNECTED = -1
ROBOTCOM_READY = 0
ROBOTCOM_WORKING = 1
ROBOTCOM_WAITING = 2

# This class handles communication between this driver (PC) and the robot
class ComRobot:
    # Robot class for programming Niryo robots
    LAST_MSG = None  # Keep a copy of the last message received
    CONNECTED = False  # Connection status is known at all times
    BUFFER_SIZE = None
    NIRYOAPI = None
    #TIMEOUT = None
    #Speed and accelerations
    LINEARSPEED = 100
    LINEARACEL = 30
    JOINTSPEED = 100
    JOINTACEL = 80
    LAST_TARGET_JOINTS = []

    # This is executed when the object is created
    def __init__(self):
        self.BUFFER_SIZE = 512  # bytes
        #self.TIMEOUT = 5 * 60  # seconds: it must be enough time for a movement to complete
        # self.TIMEOUT = 10 # seconds
        self.CONNECTED = False
        self.router = None
        self.base = None
        self.base_cyclic = None

    def __del__(self):
        self.disconnect()

    # Disconnect from robot
    def disconnect(self):
        if self.NIRYOAPI is not None:
            try:
                self.NIRYOAPI.close_connection()
            except:
                print("Failed to properly disconnect")

        self.CONNECTED = False
        return True

    # Connect to robot
    def connect(self, ip, port=-1):
        import pyniryo
        self.disconnect()
        print_message('Connecting to robot %s:%i' % (ip, port))
        # Create new socket connection
        UpdateStatus(ROBOTCOM_WORKING)
        self.NIRYOAPI = pyniryo.NiryoRobot(ip)
        self.NIRYOAPI.calibrate_auto()
        self.NIRYOAPI.update_tool()

        self.CONNECTED = True
        sys.stdout.flush()
        return True

    def MoveJ(self, coordArray):
        # Joint move to the provided angles
        coordArray = list(map(math.radians, coordArray))
        self.NIRYOAPI.move_joints(coordArray[:6])
        return True

    def MoveL(self, xyzwpr, joints):
        # Linear move (joint values provided in degrees)
        robotJoints = list(map(math.radians, joints[:6]))
        linearMovePose = self.NIRYOAPI.forward_kinematics(robotJoints)
        self.NIRYOAPI.move_linear_pose(linearMovePose)
        return True

    def MoveC(self, joints):
        raise Exception("Circular move not implemented")

    def getJoints(self):
        return list(map(math.degrees, self.NIRYOAPI.get_joints()))

    def setTool(self, tool_pose):
        #Driver works off of joints for linear moves
        return True
    
    def GripperOpen(self):
        self.NIRYOAPI.release_with_tool()
        return True
    
    def GripperClose(self):
        self.NIRYOAPI.grasp_with_tool()
        return True

    def Pause(self, timeMS):
        import time
        time.sleep(timeMS / 1000)
        return True

    def setRounding(self, rounding):
        return True

    def setDO(self, digital_IO_State):
        self.NIRYOAPI.digital_write(digital_IO_State[0], digital_IO_State[1])
        return True

    def WaitDI(self, digital_IO_Num):
        import time
        start = time.time()
        ioNumber = digital_IO_Num[0]
        ioState = self.NIRYOAPI.NiryoRobot.get_digital_io_state(ioNumber).state
        desiredState = digital_IO_Num[1]
        try:
            timeout = digital_IO_Num[2]
        except Exception as e:
            e = e
            timeout = 0

        while not (ioState == desiredState) and (time.time() - start) < timeout:
            ioState = self.NIRYOAPI.NiryoRobot.get_digital_io_state(ioNumber).state
            time.sleep(0.1)
        return True

"""


def _name(robot):
    return re.sub(r"[^A-Za-z0-9_]", "", robot or "") or "Robot"


def _list6(values, sep):
    return sep.join("%.6f" % v for v in values)


def _value(value):
    return value if isinstance(value, str) else "%s" % value


@register
class Niryo(RobotPost):
    name = "Niryo"
    
    HEADER_TEXT = HEADER + "nDOFs_MIN = 6\n\n\n\n\n"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.VAR = _name(self.ROBOT_NAME)
        self.LINES = []
        self.MAIN = None
        self.FRAME = None

    def addline(self, line, indent="    "):
        self.LINES.append(indent + line)

    def ProgStart(self, progname):
        if self.MAIN is None:
            self.MAIN = progname
        self.LINES += ["# Program Start,%s" % progname, "def %s():" % progname, "    global %s" % self.VAR]
        self.addline("# Generating program: %s" % progname)
        self.LINES.append("")

    def ProgFinish(self, progname):
        self.addline("return")
        self.LINES.append("")

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        text = self.HEADER_TEXT
        text += "%s = ComRobot()\n%s.connect('%s', 12345)\n\n\n\n" % (self.VAR, self.VAR, self.IP_COM)
        text += "".join(l + "\n" for l in self.LINES)
        text += "#Call main\n%s()\n" % (self.MAIN or progname)
        self.save_file(folder, "%s.py" % progname, text)

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def _target(self, pose):
        return _list6(xyzwpr(mul(self.FRAME, pose) if self.FRAME is not None else pose), ", ")

    def MoveJ(self, pose, joints, conf_RLF=None):
        self.addline("%s.MoveJ([%s])" % (self.VAR, _list6(joints, ",")))

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is None:
            self.addline("#Linear movement using joint targets is not supported. Change the target type to cartesian or use a joint movement.")
            return
        self.addline("%s.MoveL([%s],[%s])" % (self.VAR, self._target(pose), _list6(joints, ",")))

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            self.addline("#Circular movement using joint targets is not supported. Change the target type to cartesian or use a joint movement.")
            return
        values = [_list6(joints1, ","), self._target(pose1), _list6(joints2, ","), self._target(pose2)]
        self.addline("%s.MoveC([%s])" % (self.VAR, ",".join(values)))

    
    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.FRAME = pose
        self.addline("#%s reference frame set to [%s]" % (self.ROBOT_NAME, _list6(xyzwpr(pose), ", ")))

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.addline("%s.setTool([%s])" % (self.VAR, _list6(xyzwpr(pose), ", ")))
        self.LINES.append("")

    def Pause(self, time_ms):
        if time_ms < 0:
            self.addline("print('STOP')")
        else:
            self.addline("%s.Pause(%.3f)" % (self.VAR, time_ms * 0.001))

    def _speed(self, i, value):
        values = ["-1"] * 4
        values[i] = "%s" % float(value)
        self.addline("%s.setSpeed([%s])" % (self.VAR, ",".join(values)))

    def setSpeed(self, speed_mms):
        self._speed(0, speed_mms)

    def setSpeedJoints(self, speed_degs):
        self._speed(1, speed_degs)

    def setAcceleration(self, accel_mmss):
        self._speed(2, accel_mmss)

    def setAccelerationJoints(self, accel_degss):
        self._speed(3, accel_degss)

    def setZoneData(self, zone_mm):
        self.addline("%s.setRounding(%.3f)" % (self.VAR, zone_mm))

    
    def setDO(self, io_var, io_value):
        self.addline("%s.setDO([%s,%s])" % (self.VAR, io_var, _value(io_value)))

    setAO = setDO

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        timeout = "-1" if timeout_ms is None or timeout_ms < 0 else "%s" % (timeout_ms / 1000.0)
        self.addline("%s.WaitDI([%s,%s,%s])" % (self.VAR, io_var, _value(io_value), timeout))

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            code = "".join(c for c in code if c.isalnum() or c in "_()")
            if "(" not in code:
                code += "()"
            self.addline("%s.%s" % (self.VAR, code))
        else:
            self.addline(code, "")

    def RunMessage(self, message, iscomment=False):
        if iscomment:
            self.addline("#%s" % message)
        else:
            self.addline("print('%s')" % message)
