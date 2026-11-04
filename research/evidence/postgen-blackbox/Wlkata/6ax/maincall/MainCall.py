import sys
from mirobot import Mirobot
import time

def print_message(arg):
    print(arg)

def print_joints(arg1, arg2):
    print(arg1)

def UpdateStatus(arg):
    pass

DRIVER_VERSION = "RoboDK Driver for WLKATA Mirobot v1.0.1"

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


WlkataHaro380 = ComRobot()
WlkataHaro380.connect('192.168.0.10', 12345)



# Program Start,MainCall
def MainCall():
    global WlkataHaro380
    # Generating program: MainCall

    #Program generated by RoboDK v6.0.7 for Wlkata Haro380 on XX/XX/XXXX 18:00:00
    #Using nominal kinematics.
    #Wlkata Haro380 ref frame set to 1234.570, -98.765, 50.500,  0.000, 0.000, 30.000
    WlkataHaro380.MoveJ([0.000000,-10.000000,20.000000,0.000000,30.000000,0.000000])
    SubProg2()
    NotAProgram()
    return

# Program Start,SubProg2
def SubProg2():
    global WlkataHaro380
    # Generating program: SubProg2

    WlkataHaro380.MoveJ([20.000000,-10.000000,20.000000,0.000000,30.000000,0.000000])
    return

#Call main
MainCall()
