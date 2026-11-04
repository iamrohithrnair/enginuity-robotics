




















from ..base import RobotPost, register
from ..robomath import xyzwpr

BLOCK = """pattern_params {
  pattern_name: "WPT %(n)d"
  pattern_type: "Scatter"
  scatterpoint_pattern {
    pose_params {
        x:"%(x).3f"
        y:"%(y).3f"
        z:"%(z).3f"
        rx:"%(rx).3f"
        ry:"%(ry).3f"
        rz:"%(rz).3f"
        coord_type: "WORLD"
        coord_ref: "WORLD_ORIGIN"
        use_quaternion: false
      preferJntPos {
%(joints)s
      }
      externalAxes {
        axis1: "0"
        axis2: "0"
        axis3: "0"
        axis4: "0"
        axis5: "0"
        axis6: "0"
      }
    }
    force_params {
      fx: "0"
      fy: "0"
      fz: "0"
      mx: "0"
      my: "0"
      mz: "0"
    }
    path_profile: "%(profile)s"
    blend_zone: "Z%(zone)s"
    velocity: "%(speed)s"
    acceleration: "1"
  }
}
"""


ARC = """pattern_params {
  pattern_name: "ARC %(n)d"
  pattern_type: "Arc"
  arc_pattern {
    
    force_params {
      fx: "0"
      fy: "0"
      fz: "0"
      mx: "0"
      my: "0"
      mz: "0"
    }
    
    first_coord {
%(p1)s
    }
    second_coord {
%(p2)s
    }
    blend_zone: "Z%(zone)s"
    velocity: %(speed)s
    acceleration: 1
  }
}
"""
COORD = """        x:"%.3f"
        y:"%.3f"
        z:"%.3f"
        rx:"%.3f"
        ry:"%.3f"
        rz:"%.3f"
        coord_type: "WORLD"
        coord_ref: "WORLD_ORIGIN"
        use_quaternion: false"""


def coord(pose):
    x, y, z, rx, ry, rz = xyzwpr(pose)
    return COORD % (x / 1000, y / 1000, z / 1000, rx, ry, rz)


@register
class Flexiv(RobotPost):
    name = "Flexiv"
    PROG_EXT = "traj"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.LINES = []
        self.COUNT = 0
        self.ZONE = "0"
        self.SPEED = "0.5"
        self.NPROGS = 0

    def ProgStart(self, progname):
        self.NPROGS += 1
        if self.NPROGS > 1:
            self.LINES.append("\n")

    def ProgFinish(self, progname):
        pass

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        self.save_file(folder, "%s.%s" % (progname, self.PROG_EXT), "".join(self.LINES))

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    def _waypoint(self, pose, joints, profile):
        x, y, z, rx, ry, rz = xyzwpr(pose)
        js = "\n".join('        joint%d:"%.6f"' % (i + 1, v) for i, v in enumerate(joints)) + "      "
        self.LINES.append(
            BLOCK
            % dict(n=self.COUNT, x=x / 1000, y=y / 1000, z=z / 1000, rx=rx, ry=ry, rz=rz, joints=js, profile=profile, zone=self.ZONE, speed=self.SPEED)
        )
        self.COUNT += 1

    def MoveJ(self, pose, joints, conf_RLF=None):
        if pose is not None:
            self._waypoint(pose, joints, "spline")

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is not None:
            self._waypoint(pose, joints, "line")

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is not None and pose2 is not None:
            self.LINES.append(ARC % dict(n=self.COUNT, p1=coord(pose1), p2=coord(pose2), zone=self.ZONE, speed=self.SPEED))
            self.COUNT += 1

    def setFrame(self, pose, frame_id=None, frame_name=None):
        pass

    def setTool(self, pose, tool_id=None, tool_name=None):
        pass

    def Pause(self, time_ms):
        pass

    def setSpeed(self, speed_mms):
        self.SPEED = str(speed_mms / 1000)

    def setSpeedJoints(self, speed_degs):
        pass

    def setAcceleration(self, accel_mmss):
        pass

    def setAccelerationJoints(self, accel_degss):
        pass

    def setZoneData(self, zone_mm):
        self.ZONE = str(zone_mm)

    def setDO(self, io_var, io_value):
        pass

    def setAO(self, io_var, io_value):
        pass

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        pass

    def RunCode(self, code, is_function_call=False):
        pass

    def RunMessage(self, message, iscomment=False):
        pass
