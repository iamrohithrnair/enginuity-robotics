













from ..base import register
from .wlkata import Wlkata


HEADER = '''import sys

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
nDOFs_MIN = 6


class ComRobot:
    """Robot class for programming MyCobot robots"""
    LAST_MSG = None  # Keep a copy of the last message received
    CONNECTED = False  # Connection status is known at all times
    MYCOBOTAPI = None
    BUFFER_SIZE = None
    #TIMEOUT = None
    #Speed and accelerations
    LINEARSPEED = 100
    LINEARACEL = 30
    JOINTSPEED  = 100
    JOINTACEL  = 80
    LAST_TARGET_JOINTS = []

    from robolink import import_install

    import_install("pymycobot")


    def joints_to_mycobot(self,jnts):
        return jnts

    def joints_from_mycobot(self,jnts):
        return jnts

    # This is executed when the object is created
    def __init__(self):
        self.BUFFER_SIZE = 512  # bytes
        #self.TIMEOUT = 5 * 60  # seconds: it must be enough time for a movement to complete
        # self.TIMEOUT = 10 # seconds
        self.CONNECTED = False
        self.MYCOBOTAPI = None

    def __del__(self):
        self.disconnect()

    # Disconnect from robot
    def disconnect(self):
        if self.MYCOBOTAPI is not None:
            # Disconnect
            self.MYCOBOTAPI = None

        self.CONNECTED = False
        return True

    # Connect to robot
    def connect(self, ip_com, port=-1):
        self.disconnect()
        print_message('Connecting to robot %s:%i' % (ip_com, port))
        # Create new socket connection
        UpdateStatus(ROBOTCOM_WORKING)
        sys.stdout.flush()

        from pymycobot import MyCobot280 as MyCobot #Need to be replaced with a switch case to switch between versions of the interface if it doesn't work with all robots
        self.MYCOBOTAPI = MyCobot(ip_com, 115200)
        UpdateStatus(ROBOTCOM_READY)
        sys.stdout.flush()
        return True

    def MoveJ(self, joints):
        #By passing the angle parameter, let each joint of the robotic arm move to the position corresponding to [0, 0, 0, 0, 0, 0]
        self.MYCOBOTAPI.set_movement_type(0)
        self.MYCOBOTAPI.sync_send_angles(joints[:6], self.JOINTSPEED)
        UpdateStatus(ROBOTCOM_READY)
        sys.stdout.flush()

    def MoveL(self,xyzabc):
        self.MYCOBOTAPI.set_movement_type(1)
        self.MYCOBOTAPI.sync_send_angles(xyzabc[:6], self.LINEARSPEED)
        UpdateStatus(ROBOTCOM_READY)
        sys.stdout.flush()


    def MoveC(self,joints):
        raise Exception("Circular move not implemented")

    def getJoints(self):
        joints = self.MYCOBOTAPI.get_angles()
        return joints

    def setSpeed(self, speed_values):
        # speed_values[0] = speed_values[0] # linear speed in mm/s
        # speed_values[1] = speed_values[1] # joint speed in mm/s
        # speed_values[2] = speed_values[2] # linear acceleration in mm/s2
        # speed_values[3] = speed_values[3] # joint acceleration in deg/s2
        if (speed_values[0] != -1):
            self.LINEARSPEED = int(speed_values[0])

        if (speed_values[1] != -1):
            self.JOINTSPEED = int(speed_values[1])

        if (speed_values[2] != -1):
            self.LINEARACEL = int(speed_values[2])

        if (speed_values[3] != -1):
            self.JOINTACEL = int(speed_values[3])

        return True

    def setTool(self,tool_pose):
        self.MYCOBOTAPI.set_tool_reference(tool_pose)
        return True

    def Pause(self,timeMS):
        import time
        time.sleep(timeMS/1000)
        return True

    def setRounding(self,rounding):
        return True

    def setDO(self,io_var, io_value):
        self.MYCOBOTAPI.set_digital_output(io_var, io_value)

    def WaitDI(self,io_var, io_value,timeout):
        import time
        start = time.time()
        ioState = self.MYCOBOTAPI.get_digital_input(io_var)
        while not (ioState == io_value) and (time.time() - start) < timeout:
           ioState = self.MYCOBOTAPI.get_digital_input(io_var)
           time.sleep(0.1)


'''


@register
class MyCobot(Wlkata):
    name = "MyCobot"
    HEADER_TEXT = HEADER

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.VAR = "robot"

    def Pause(self, time_ms):
        if time_ms < 0:
            self.addline('input("Paused. Press enter to continue")')
        else:
            self.addline("%s.Pause(%d)" % (self.VAR, int(round(time_ms))))

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            super().RunCode(code, True)
        else:
            self.addline(code)
