















import math

from ..base import register
from .niryo import Niryo, _list6


HEADER = '''import sys
from mirobot import Mirobot
import time

def print_message(arg):
    print(arg)

def print_joints(arg1, arg2):
    print(arg1)

def UpdateStatus(arg):
    pass

DRIVER_VERSION = "Enginuity Driver for WLKATA Mirobot v1.0.1"

ROBOTCOM_UNKNOWN = -1000
ROBOTCOM_CONNECTION_PROBLEMS = -3
ROBOTCOM_DISCONNECTED = -2
ROBOTCOM_NOT_CONNECTED = -1
ROBOTCOM_READY = 0
ROBOTCOM_WORKING = 1
ROBOTCOM_WAITING = 2
nDOFs_MIN = 6


class ComRobot:
    """Robot class for programming WLKATA robots"""
    LAST_MSG = None  # Keep a copy of the last message received
    CONNECTED = False  # Connection status is known at all times
    MIROBOTAPI = None
    BUFFER_SIZE = None
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

    def __del__(self):
        self.disconnect()

    # Disconnect from robot
    def disconnect(self):
        self.CONNECTED = False
        return True

    # Connect to robot
    def connect(self, ip, port=-1):
        if (self.CONNECTED == True):
            return
        self.disconnect()
        print_message(DRIVER_VERSION)
        print_message('Connecting to robot %s:%i' % (ip, port))

        # Create new socket or serial connection
        if ip == "" or ip == "127.0.0.1":
            self.MIROBOTAPI = Mirobot()
            self.MIROBOTAPI.autoConnect()
        elif ip.startswith("COM"):
            self.MIROBOTAPI = Mirobot(portname=ip)
        else:
            self.MIROBOTAPI = Mirobot(ip)

        self.MIROBOTAPI.home_simultaneous()
        UpdateStatus(ROBOTCOM_WORKING)

        self.CONNECTED = True
        sys.stdout.flush()
        return True

    def MoveJ(self, coordArray):
        # Joint move to the provided angles
        import threading

        def runMove():
            self.MIROBOTAPI.go_to_axis(coordArray[0], coordArray[1], coordArray[2], coordArray[3], coordArray[4], coordArray[5])

        t = threading.Thread(target=runMove)
        t.start()
        while t.is_alive():
            joints = [None] * 7
            joints[0] = self.MIROBOTAPI.status.angle.a
            joints[1] = self.MIROBOTAPI.status.angle.b
            joints[2] = self.MIROBOTAPI.status.angle.c
            joints[3] = self.MIROBOTAPI.status.angle.x
            joints[4] = self.MIROBOTAPI.status.angle.y
            joints[5] = self.MIROBOTAPI.status.angle.z
            joints[6] = self.MIROBOTAPI.status.angle.d
            print_joints(joints, True)
            time.sleep(1.0 / 1000.0)

        joints = [None] * 7
        joints[0] = self.MIROBOTAPI.status.angle.a
        joints[1] = self.MIROBOTAPI.status.angle.b
        joints[2] = self.MIROBOTAPI.status.angle.c
        joints[3] = self.MIROBOTAPI.status.angle.x
        joints[4] = self.MIROBOTAPI.status.angle.y
        joints[5] = self.MIROBOTAPI.status.angle.z
        joints[6] = self.MIROBOTAPI.status.angle.d
        print_joints(joints)
        return True

    def MoveL(self, xyzabc):
        import threading
        """Linear move (joint values provided in degrees)"""
        # Create new action
        #print(self.MIROBOTAPI.status)
        self.MoveJ(xyzabc)
        return True

    def MoveC(self, joints):
        raise Exception("Circular move not implemented")

    def getJoints(self):
        joints = [None] * 7
        joints[0] = self.MIROBOTAPI.status.angle.a
        joints[1] = self.MIROBOTAPI.status.angle.b
        joints[2] = self.MIROBOTAPI.status.angle.c
        joints[3] = self.MIROBOTAPI.status.angle.x
        joints[4] = self.MIROBOTAPI.status.angle.y
        joints[5] = self.MIROBOTAPI.status.angle.z
        joints[6] = self.MIROBOTAPI.status.angle.d
        return joints

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
            self.LINEARACEL = speed_values[2]

        if (speed_values[3] != -1):
            self.JOINTACEL = speed_values[3]

        return True

    def setTool(self, tool_pose):
        return True

    def Pause(self, timeMS):
        import time
        time.sleep(timeMS / 1000)
        return True

    def setRounding(self, rounding):
        return True

    def setDO(self, digital_IO_State):
        return False

    def WaitDI(self, digital_IO_Num):
        return False


'''


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
    return [v * 180.0 / math.pi for v in (a, b, c)]


def _pose(pose):
    x = [pose[0][3], pose[1][3], pose[2][3]] + _xyz_euler(pose)
    return "%.3f, %.3f, %.3f,  %.3f, %.3f, %.3f" % tuple(round(v, 3) + 0.0 for v in x)


@register
class Wlkata(Niryo):
    name = "Wlkata"
    HEADER_TEXT = HEADER

    def _target(self, pose):
        return _pose(pose)

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is None:
            self.addline("#Linear movement using joint targets is not supported. Change the target type to cartesian or use a joint movement.")
            return
        self.addline("%s.MoveL([%s,%s])" % (self.VAR, _list6(joints, ","), _pose(pose)))

    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.addline("#%s ref frame set to %s" % (self.ROBOT_NAME, _pose(pose)))

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.addline("%s.setTool([%s])" % (self.VAR, _pose(pose)))
        self.LINES.append("")

    def Pause(self, time_ms):
        if time_ms < 0:
            self.addline("print('STOP')")
        else:
            self.addline("import time")
            self.addline("time.sleep(%.3f)" % (time_ms * 1000.0))

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            code = "".join(c for c in code if c.isalnum() or c in "_()")
            if "(" not in code:
                code += "()"
            self.addline(code)
        else:
            self.addline(code, "")
