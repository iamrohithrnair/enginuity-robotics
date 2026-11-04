
























import json
import random

from ..base import RobotPost, register
from ..robomath import xyzwpr

STORE = {"identifier": "", "schemaKey": "", "type": 4}


def _plugin(action, plugin=""):
    return {"actionHandle": {"identifier": action}, "pluginHandle": {"identifier": plugin}}


@register
class KinovaLink6(RobotPost):
    name = "Kinova_Link6"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.RAND = random.Random(0)
        self.PROG_ID = self._id()
        self.ACTIONS = [{
            "handle": {"identifier": 1}, "type": 1, "name": "", "next": None, "blocking": True,
            "pluginActionHandle": _plugin("1"), "branches": [], "storeOutputTo": dict(STORE), "configuration": {},
        }]
        self.PROG_COUNT = 0
        self.PROG_NAME = None
        self.SPEED = 0.1
        self.ACCEL = 2.5
        self.SPEED_J = 60
        self.ACCEL_J = 200
        self.BLEND = -1
        self.FRAME = {"x": 0.0, "y": 0.0, "z": 0.0, "thetaX": 0.0, "thetaY": 0.0, "thetaZ": 0.0}
        self.GROUP = None  

    def _id(self):
        return int(self.RAND.random() * 4294967295)

    def _main(self):
        return self.PROG_COUNT == 1

    def _add(self, action):
        self.ACTIONS[-1]["next"] = {"identifier": action["handle"]["identifier"]}
        self.ACTIONS.append(action)
        self.GROUP = None

    def _generic(self, type_, name, config, action=None, plugin=""):
        a = {"branches": [], "handle": {"identifier": self._id()}, "type": type_, "name": name, "next": None, "blocking": True,
             "version": "", "pluginActionHandle": _plugin(action or str(type_), plugin), "storeOutputTo": dict(STORE), "configuration": config}
        self._add(a)

    
    def ProgStart(self, progname):
        self.PROG_COUNT += 1
        if self.PROG_NAME is None:
            self.PROG_NAME = progname

    def ProgFinish(self, progname):
        pass

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        actions = []
        for a in self.ACTIONS:
            if a.get("pluginActionHandle", {}).get("actionHandle", {}).get("identifier") == "tool_path":
                a = dict(a)
                a["configuration"] = json.dumps(a["configuration"], separators=(",", ":"))
            actions.append(a)
        doc = {"handle": {"identifier": self.PROG_ID, "permission": 7}, "name": self.PROG_NAME or progname, "isValidated": False,
               "actions": actions, "variables": []}
        self.save_file(folder, "%s.json" % progname, json.dumps(doc, indent=4))

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def _name(self, kind, n):
        return "%s (%s)" % (kind, self._TargetName) if self._TargetName is not None else "%s %d" % (kind, n)

    def MoveJ(self, pose, joints, conf_RLF=None):
        if not self._main():
            return
        if self.GROUP is None or self.GROUP[0] != "waypoints":
            wl = []
            config = {
                "waypoint_list_options": {"type_of_waypoint_global": "Angular", "use_optimal_blending": True, "global_reference_frame": 4},
                "goto_options": {"option": 0},
                "constraint": {
                    "speed": {"tcp_translation": self.SPEED, "tcp_rotation": 150, "edit_all_joints_in_one": True, "single_joint": self.SPEED_J, "joints": [60, 60, 60, 140, 140, 140]},
                    "acceleration": {"tcp_translation": self.ACCEL, "tcp_rotation": 300, "edit_all_joints_in_one": True, "single_joint": self.ACCEL_J, "joints": [200, 200, 200, 400, 400, 400]},
                },
                "custom_frame": dict(self.FRAME),
                "waypoint_list": wl,
            }
            self._add({"branches": [], "handle": {"identifier": self._id()}, "next": None, "name": "", "pluginActionHandle": _plugin("waypoints", "arm_plugin"),
                       "configuration": config, "storeOutputTo": dict(STORE), "type": 4, "blocking": True, "version": "1.3.0-dev.615"})
            self.GROUP = ("waypoints", wl)
        wl = self.GROUP[1]
        zero = {"x": 0.0, "y": 0.0, "z": 0.0, "thetaX": 0.0, "thetaY": 0.0, "thetaZ": 0.0}
        wl.append({
            "index": str(len(wl) + 1), "name": self._name("MoveJ", len(wl) + 1), "type_of_waypoint": "Angular", "angles": list(joints),
            "blending_radius_angular": 0, "waypoint_speed_limits_toggle": True, "waypoint_acceleration_limits_toggle": True,
            "waypoint_speed_limits_angular_input": [self.SPEED_J] * 6, "waypoint_acceleration_limits_angular_input": [self.ACCEL_J] * 6,
            "blending_radius": self.BLEND, "init": {"angles": list(joints), "pose": dict(zero)}, "pose": dict(zero),
            "specific_reference_frame_toggle": False,
        })

    def MoveL(self, pose, joints, conf_RLF=None):
        if not self._main() or pose is None:
            return
        fine = self.BLEND < 0
        if self.GROUP is None or self.GROUP[0] != "tool_path":
            wl = []
            config = {
                "waypoint_list_options": {"global_reference_frame": 4},
                "goto_options": {"option": 0},
                "path_configuration": {
                    "tcp_translation_speed": self.SPEED, "tcp_translation_acceleration": self.ACCEL, "tcp_rotation_acceleration": 300,
                    "path_blending": {"path_configuration_fine_positioning_toggle": fine, "blending_radius": 0.02 if fine else self.BLEND},
                },
                "custom_frame": dict(self.FRAME),
                "waypoint_list": wl,
            }
            self._add({"handle": {"identifier": self._id()}, "type": 4, "name": "", "next": None, "blocking": True,
                       "pluginActionHandle": _plugin("tool_path", "arm_plugin"), "branches": [], "storeOutputTo": dict(STORE), "configuration": config})
            self.GROUP = ("tool_path", wl)
        wl = self.GROUP[1]
        w, p, r = xyzwpr(pose)[3:]
        wl.append({
            "index": str(len(wl) + 1), "name": self._name("MoveL", len(wl) + 1), "waypoint_type": 1, "last_reference_frame": 4,
            "pose": {"x": pose[0][3] * 0.001, "y": pose[1][3] * 0.001, "z": pose[2][3] * 0.001, "thetaX": round(w, 2), "thetaY": round(p, 2), "thetaZ": round(r, 2)},
            "waypoint_specific_path_configuration": {
                "waypoint_translation_speed_toggle": True, "waypoint_translation_acceleration_toggle": True, "waypoint_rotation_acceleration_toggle": True,
                "waypoint_fine_positioning_toggle": fine, "waypoint_specific_blending_toggle": True, "waypoint_blending_input": self.BLEND,
                "waypoint_translation_speed_input": self.SPEED, "waypoint_translation_acceleration_input": self.ACCEL, "waypoint_rotation_acceleration_input": 300,
            },
        })

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        pass

    
    def setFrame(self, pose, frame_id=None, frame_name=None):
        w, p, r = xyzwpr(pose)[3:]
        self.FRAME = {"x": pose[0][3] * 0.001, "y": pose[1][3] * 0.001, "z": pose[2][3] * 0.001, "thetaX": round(w, 2), "thetaY": round(p, 2), "thetaZ": round(r, 2)}

    def setTool(self, pose, tool_id=None, tool_name=None):
        pass

    def Pause(self, time_ms):
        if self._main() and time_ms >= 0:
            self._generic(7, "Enginuity", {"milliseconds": float(time_ms)})

    def setSpeed(self, speed_mms):
        self.SPEED = speed_mms / 1000

    def setAcceleration(self, accel_mmss):
        self.ACCEL = accel_mmss / 1000

    def setSpeedJoints(self, speed_degs):
        self.SPEED_J = min(speed_degs, 200)

    def setAccelerationJoints(self, accel_degss):
        self.ACCEL_J = accel_degss

    def setZoneData(self, zone_mm):
        self.BLEND = zone_mm / 1000

    
    def setDO(self, io_var, io_value):
        if not self._main() or isinstance(io_var, str):
            return
        state = int(float(io_value))
        if io_var >= 10:
            config = {"io_type": "Wrist digital", "output_settings": {"state": state, "name": io_var - 10},
                      "analog_settings": {"unit_type": "Voltage", "voltage_settings": {"voltage": 0}}}
        else:
            config = {"io_type": "Digital", "output_settings": {"state": state, "name": io_var}}
        self._generic(4, "", config, "set_output", "industrial_io_plugin")

    def setAO(self, io_var, io_value):
        if not self._main() or isinstance(io_var, str):
            return
        config = {"io_type": "Analog", "analog_settings": {"name": io_var, "unit_type": "Voltage", "voltage_settings": {"voltage": float(io_value)}}}
        self._generic(4, "", config, "set_output", "industrial_io_plugin")

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        if not self._main() or isinstance(io_var, str):
            return
        config = {"io_type": "Digital", "timeout": timeout_ms, "input_settings": {"state": int(float(io_value)), "name": io_var}}
        self._generic(4, "", config, "wait_input", "industrial_io_plugin")

    def RunCode(self, code, is_function_call=False):
        pass

    def RunMessage(self, message, iscomment=False):
        if self._main():
            self._generic(9, "Enginuity", {"message": message, "level": 2})
