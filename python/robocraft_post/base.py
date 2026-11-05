# Defines post registration, shared output handling and robot kinematics helpers.















from __future__ import annotations

import re
from typing import Dict, List, Optional, Tuple, Union

FileContent = Union[str, bytes]


class PostError(Exception):
    pass


class RobotPost:
    pass

    
    name = "Base"
    
    aliases: Tuple[str, ...] = ()
    
    assumed = False

    def __init__(self, robotpost: str = "", robotname: str = "", robot_axes: int = 6, **kwargs):
        self.ROBOT_POST = robotpost
        self.ROBOT_NAME = robotname
        self.ROBOT_AXES = int(robot_axes)
        self.AXES_TYPE = kwargs.get("axes_type") or ["R"] * self.ROBOT_AXES
        self.NATIVE_NAME = kwargs.get("native_name", robotname)
        self.IP_COM = kwargs.get("ip_com", "")
        self.API_PORT = kwargs.get("api_port", 20500)
        self.PROG_PTR = kwargs.get("prog_ptr", 0)
        self.ROBOT_PTR = kwargs.get("robot_ptr", 0)
        lines = kwargs.get("lines_x_prog")
        self.MAX_LINES_X_PROG = int(lines) if lines is not None else -1
        self.PULSES_X_DEG = kwargs.get("pulses_x_deg")
        self.POSE_TURNTABLE = kwargs.get("pose_turntable")
        self.POSE_RAIL = kwargs.get("pose_rail")
        self.EXTRA = {k: v for k, v in kwargs.items() if k.startswith("post_")}
        
        self._TargetName: Optional[str] = None
        self._TargetNameVia: Optional[str] = None
        
        self.files: List[Tuple[str, FileContent]] = []
        
        self.stdout: List[str] = []
        
        
        
        self.KINEMATICS: List[Tuple[List[float], List[List[float]], List[float]]] = []

    
    def save_file(self, folder: str, filename: str, content: FileContent) -> None:
        path = (folder or "") + filename
        self.files.append((filename, content))
        self.stdout.append("SAVED: %s" % path)

    def popup(self, message: str) -> None:
        self.stdout.append("POPUP: %s" % message)

    def robot_fk(self, joints) -> Tuple[List[List[float]], List[float]]:
        pass
        q = [float(v) for v in joints]
        for known, pose, config in self.KINEMATICS:
            if len(known) >= len(q) and all(abs(a - b) <= 1e-9 for a, b in zip(q, known)) and all(v == 0 for v in known[len(q):]):
                return pose, list(config)
        raise PostError("The robot kinematics for the joint target %s were not provided" % ",".join("%g" % v for v in q))


def strip_name(name: Optional[str], fallback: str) -> str:
    pass
    s = re.sub(r"[^A-Za-z0-9_]", "", name or "")
    return s or fallback


def is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def on_off(value, true: str, false: str) -> str:
    pass
    if isinstance(value, bool):
        return true if value else false
    if is_number(value):
        return true if value != 0 else false
    s = str(value).strip()
    if s.lower() in ("1", "true", "on", "high"):
        return true
    if s.lower() in ("0", "false", "off", "low"):
        return false
    return s


REGISTRY: Dict[str, type] = {}


def register(cls):
    REGISTRY[cls.name] = cls
    for alias in getattr(cls, "aliases", ()):
        REGISTRY[alias] = cls
    return cls


def get_post(name: str) -> Optional[type]:
    if not name:
        return None
    key = name[:-3] if name.lower().endswith(".py") else name
    if key in REGISTRY:
        return REGISTRY[key]
    low = key.lower()
    for k, v in REGISTRY.items():
        if k.lower() == low:
            return v
    return None


def post_names() -> List[str]:
    return sorted(REGISTRY.keys())
