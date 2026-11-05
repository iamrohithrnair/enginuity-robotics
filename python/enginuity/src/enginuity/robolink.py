# Implements socket-backed robot, station and program operations through Item and Enginuity.






















from __future__ import annotations

import json
import logging
import os
import socket
import sys
import subprocess
import threading
import time
from typing import Any, Callable, Dict, Iterator, List, Optional, Sequence, Tuple, Union

from . import robomath
from ._protocol import Encoder, WireSocket, pose_col_major
from .errors import (
    InputError,
    InvalidItemError,
    LicenseError,
    EnginuityConnectionError,
    EnginuityError,
    EnginuityTimeoutError,
    NotSupportedError,
    ProtocolError,
    StoppedError,
    TargetReachError,
    error_for_status,
)
from .robomath import Mat, eye, invH
from .fileio import UploadFTP  # noqa: F401  (post processors import it from robolink)

__all__ = [
    
    
    
    "robomath",
    "UploadFTP",
    
    
    "time",
    "os",
    "sys",
    "Enginuity",
    "Robolink",
    "Item",
    "EnginuityError",
    "EnginuityConnectionError",
    "EnginuityTimeoutError",
    "InvalidItemError",
    "InputError",
    "TargetReachError",
    "StoppedError",
    "LicenseError",
    "NotSupportedError",
    "ProtocolError",
    "EmbedWindow",
    "import_install",
    "getPathIcon",
    "getPathEnginuity",
    "DEFAULT_PORT",
]

logger = logging.getLogger("enginuity")

DEFAULT_HOST = "localhost"
DEFAULT_PORT = 20500

DEFAULT_TIMEOUT = 30.0

DEFAULT_LONG_TIMEOUT = 3600.0
DEFAULT_CONNECT_TIMEOUT = 5.0




ITEM_TYPE_ANY = -1
ITEM_TYPE_STATION = 1
ITEM_TYPE_ROBOT = 2
ITEM_TYPE_FRAME = 3
ITEM_TYPE_TOOL = 4
ITEM_TYPE_OBJECT = 5
ITEM_TYPE_TARGET = 6
ITEM_TYPE_CURVE = 7
ITEM_TYPE_PROGRAM = 8
ITEM_TYPE_INSTRUCTION = 9
ITEM_TYPE_PROGRAM_PYTHON = 10
ITEM_TYPE_PYTHON = ITEM_TYPE_PROGRAM_PYTHON
ITEM_TYPE_MACHINING = 11
ITEM_TYPE_BALLBARVALIDATION = 12
ITEM_TYPE_CALIBPROJECT = 13
ITEM_TYPE_VALID_ISO9283 = 14
ITEM_TYPE_FOLDER = 17
ITEM_TYPE_ROBOT_ARM = 18
ITEM_TYPE_CAMERA = 19
ITEM_TYPE_GENERIC = 20
ITEM_TYPE_ROBOT_AXES = 21
ITEM_TYPE_NOTES = 22

ITEM_TYPE_SCRIPT = 100


INS_TYPE_INVALID = -1
INS_TYPE_MOVE = 0
INS_TYPE_MOVEC = 1
INS_TYPE_CHANGESPEED = 2
INS_TYPE_CHANGEFRAME = 3
INS_TYPE_CHANGETOOL = 4
INS_TYPE_CHANGEROBOT = 5
INS_TYPE_PAUSE = 6
INS_TYPE_EVENT = 7
INS_TYPE_CODE = 8
INS_TYPE_PRINT = 9
INS_TYPE_ROUNDING = 10
INS_TYPE_IO = 11
INS_TYPE_CUSTOM = 12


MOVE_TYPE_INVALID = -1
MOVE_TYPE_JOINT = 1
MOVE_TYPE_LINEAR = 2
MOVE_TYPE_CIRCULAR = 3
MOVE_TYPE_LINEARSEARCH = 5


RUNMODE_SIMULATE = 1
RUNMODE_QUICKVALIDATE = 2
RUNMODE_MAKE_ROBOTPROG = 3
RUNMODE_MAKE_ROBOTPROG_AND_UPLOAD = 4
RUNMODE_MAKE_ROBOTPROG_AND_START = 5
RUNMODE_RUN_ROBOT = 6


PROGRAM_RUN_ON_SIMULATOR = 1
PROGRAM_RUN_ON_ROBOT = 2


ROBOTCOM_PROBLEMS = -3
ROBOTCOM_DISCONNECTED = -2
ROBOTCOM_NOT_CONNECTED = -1
ROBOTCOM_READY = 0
ROBOTCOM_WORKING = 1
ROBOTCOM_WAITING = 2
ROBOTCOM_UNKNOWN = -1000


CALIBRATE_TCP_BY_POINT = 0
CALIBRATE_TCP_BY_PLANE = 1
CALIBRATE_TCP_BY_PLANE_SCARA = 4
CALIBRATE_FRAME_3P_P1_ON_X = 0
CALIBRATE_FRAME_3P_P1_ORIGIN = 1
CALIBRATE_FRAME_6P = 2
CALIBRATE_TURNTABLE = 3
CALIBRATE_TURNTABLE_2X = 4


PROJECTION_NONE = 0
PROJECTION_CLOSEST = 1
PROJECTION_ALONG_NORMAL = 2
PROJECTION_ALONG_NORMAL_RECALC = 3
PROJECTION_CLOSEST_RECALC = 4
PROJECTION_RECALC = 5


JOINT_FORMAT = -1
EULER_RX_RYp_RZpp = 0
EULER_RZ_RYp_RXpp = 1
EULER_RZ_RYp_RZpp = 2
EULER_RZ_RXp_RZpp = 3
EULER_RX_RY_RZ = 4
EULER_RZ_RY_RX = 5
EULER_QUEATERNION = 6
EULER_QUATERNION = EULER_QUEATERNION


WINDOWSTATE_HIDDEN = -1
WINDOWSTATE_SHOW = 0
WINDOWSTATE_MINIMIZED = 1
WINDOWSTATE_NORMAL = 2
WINDOWSTATE_MAXIMIZED = 3
WINDOWSTATE_FULLSCREEN = 4
WINDOWSTATE_CINEMA = 5
WINDOWSTATE_FULLSCREEN_CINEMA = 6
WINDOWSTATE_VIDEO = 7


INSTRUCTION_CALL_PROGRAM = 0
INSTRUCTION_INSERT_CODE = 1
INSTRUCTION_START_THREAD = 2
INSTRUCTION_COMMENT = 3
INSTRUCTION_SHOW_MESSAGE = 4


FEATURE_NONE = 0
FEATURE_SURFACE = 1
FEATURE_CURVE = 2
FEATURE_POINT = 3
FEATURE_OBJECT_MESH = 7
FEATURE_SURFACE_PREVIEW = 8
FEATURE_MESH = 9
FEATURE_HOVER_OBJECT_MESH = 10
FEATURE_HOVER_OBJECT = 11


SPRAY_OFF = 0
SPRAY_ON = 1


COLLISION_OFF = 0
COLLISION_ON = 1


VISIBLE_REFERENCE_DEFAULT = -1
VISIBLE_REFERENCE_ON = 1
VISIBLE_REFERENCE_OFF = 0
VISIBLE_ROBOT_NONE = 0
VISIBLE_ROBOT_FLANGE = 0x01
VISIBLE_ROBOT_AXIS_Base_3D = 0x01 << 1
VISIBLE_ROBOT_AXIS_Base_REF = 0x01 << 2
VISIBLE_ROBOT_AXIS_1_3D = 0x01 << 3
VISIBLE_ROBOT_AXIS_1_REF = 0x01 << 4
VISIBLE_ROBOT_AXIS_2_3D = 0x01 << 5
VISIBLE_ROBOT_AXIS_2_REF = 0x01 << 6
VISIBLE_ROBOT_AXIS_3_3D = 0x01 << 7
VISIBLE_ROBOT_AXIS_3_REF = 0x01 << 8
VISIBLE_ROBOT_AXIS_4_3D = 0x01 << 9
VISIBLE_ROBOT_AXIS_4_REF = 0x01 << 10
VISIBLE_ROBOT_AXIS_5_3D = 0x01 << 11
VISIBLE_ROBOT_AXIS_5_REF = 0x01 << 12
VISIBLE_ROBOT_AXIS_6_3D = 0x01 << 13
VISIBLE_ROBOT_AXIS_6_REF = 0x01 << 14
VISIBLE_ROBOT_AXIS_7_3D = 0x01 << 15
VISIBLE_ROBOT_AXIS_7_REF = 0x02 << 16
VISIBLE_ROBOT_DEFAULT = 0x2AAAAAAB
VISIBLE_ROBOT_ALL = 0x7FFFFFFF
VISIBLE_ROBOT_ALL_REFS = 0x15555555


SELECT_RESET = -1
SELECT_NONE = 0
SELECT_RECTANGLE = 1
SELECT_ROTATE = 2
SELECT_ZOOM = 3
SELECT_PAN = 4
SELECT_MOVE = 5
SELECT_MOVE_SHIFT = 6
SELECT_MOVE_CLEAR = 7
DISPLAY_REF_DEFAULT = -1
DISPLAY_REF_NONE = 0
DISPLAY_REF_TX = 0b001
DISPLAY_REF_TY = 0b010
DISPLAY_REF_TZ = 0b100
DISPLAY_REF_RX = 0b001000
DISPLAY_REF_RY = 0b010000
DISPLAY_REF_RZ = 0b100000
DISPLAY_REF_PXY = 0b001000000
DISPLAY_REF_PXZ = 0b010000000
DISPLAY_REF_PYZ = 0b100000000
DISPLAY_REF_ALL = 0b111111111


SEQUENCE_DISPLAY_DEFAULT = -1
SEQUENCE_DISPLAY_TOOL_POSES = 0
SEQUENCE_DISPLAY_ROBOT_POSES = 256
SEQUENCE_DISPLAY_ROBOT_JOINTS = 2048
SEQUENCE_DISPLAY_COLOR_SELECTED = 1
SEQUENCE_DISPLAY_COLOR_TRANSPARENT = 2
SEQUENCE_DISPLAY_COLOR_GOOD = 3
SEQUENCE_DISPLAY_COLOR_BAD = 4
SEQUENCE_DISPLAY_OPTION_RESET = 1024


EVENT_SELECTION_TREE_CHANGED = 1
EVENT_ITEM_MOVED = 2
EVENT_REFERENCE_PICKED = 3
EVENT_REFERENCE_RELEASED = 4
EVENT_TOOL_MODIFIED = 5
EVENT_CREATED_ISOCUBE = 6
EVENT_SELECTION_3D_CHANGED = 7
EVENT_3DVIEW_MOVED = 8
EVENT_ROBOT_MOVED = 9
EVENT_KEY = 10
EVENT_ITEM_MOVED_POSE = 11
EVENT_COLLISIONMAP_RESET = 12
EVENT_COLLISIONMAP_TOO_LARGE = 13
EVENT_CALIB_MEASUREMENT = 14
EVENT_SELECTION_3D_CLICK = 15
EVENT_ITEM_CHANGED = 16
EVENT_ITEM_RENAMED = 17
EVENT_ITEM_VISIBILITY = 18
EVENT_STATION_CHANGED = 19
EVENT_PROGSLIDER_CHANGED = 20
EVENT_PROGSLIDER_SET = 21


MAKE_ROBOT_1R = 1
MAKE_ROBOT_2R = 2
MAKE_ROBOT_3R = 3
MAKE_ROBOT_1T = 4
MAKE_ROBOT_2T = 5
MAKE_ROBOT_3T = 6
MAKE_ROBOT_6DOF = 7
MAKE_ROBOT_7DOF = 8
MAKE_ROBOT_SCARA = 9
MAKE_ROBOT_GRIPPER = 10
MAKE_ROBOT_6COBOT = 11
MAKE_ROBOT_1T1R = 12
MAKE_ROBOT_5XCNC = 13
MAKE_ROBOT_3T1R = 15
MAKE_ROBOT_GENERIC = 16


ERROR_KINEMATIC = 0b001
ERROR_PATH_LIMIT = 0b010
ERROR_PATH_SINGULARITY = 0b100
ERROR_PATH_NEARSINGULARITY = 0b1000
ERROR_COLLISION = 0b100000


FLAG_ENGINUITY_TREE_ACTIVE = 1
FLAG_ENGINUITY_3DVIEW_ACTIVE = 2
FLAG_ENGINUITY_LEFT_CLICK = 4
FLAG_ENGINUITY_RIGHT_CLICK = 8
FLAG_ENGINUITY_DOUBLE_CLICK = 16
FLAG_ENGINUITY_MENU_ACTIVE = 32
FLAG_ENGINUITY_MENUFILE_ACTIVE = 64
FLAG_ENGINUITY_MENUEDIT_ACTIVE = 128
FLAG_ENGINUITY_MENUPROGRAM_ACTIVE = 256
FLAG_ENGINUITY_MENUTOOLS_ACTIVE = 512
FLAG_ENGINUITY_MENUUTILITIES_ACTIVE = 1024
FLAG_ENGINUITY_MENUCONNECT_ACTIVE = 2048
FLAG_ENGINUITY_WINDOWKEYS_ACTIVE = 4096
FLAG_ENGINUITY_TREE_VISIBLE = 8192
FLAG_ENGINUITY_REFERENCES_VISIBLE = 16384
FLAG_ENGINUITY_STATUSBAR_VISIBLE = 32768
FLAG_ENGINUITY_NONE = 0
FLAG_ENGINUITY_ALL = 0xFFFF
FLAG_ENGINUITY_MENU_ACTIVE_ALL = (
    FLAG_ENGINUITY_MENU_ACTIVE | FLAG_ENGINUITY_MENUFILE_ACTIVE | FLAG_ENGINUITY_MENUEDIT_ACTIVE | FLAG_ENGINUITY_MENUPROGRAM_ACTIVE
    | FLAG_ENGINUITY_MENUTOOLS_ACTIVE | FLAG_ENGINUITY_MENUUTILITIES_ACTIVE | FLAG_ENGINUITY_MENUCONNECT_ACTIVE
)


FLAG_ITEM_SELECTABLE = 1
FLAG_ITEM_EDITABLE = 2
FLAG_ITEM_DRAGALLOWED = 4
FLAG_ITEM_DROPALLOWED = 8
FLAG_ITEM_ENABLED = 32
FLAG_ITEM_AUTOTRISTATE = 64
FLAG_ITEM_NOCHILDREN = 128
FLAG_ITEM_USERTRISTATE = 256
FLAG_ITEM_NONE = 0
FLAG_ITEM_ALL = 64 + 32 + 8 + 4 + 2 + 1


PATH_OPENSTATION = "PATH_OPENSTATION"
FILE_OPENSTATION = "FILE_OPENSTATION"
PATH_DESKTOP = "PATH_DESKTOP"
PATH_LIBRARY = "PATH_LIBRARY"


_OPTIONAL_COMMANDS = frozenset(
    ["Gun_Add", "Gun_SetState", "Gun_Stats", "Gun_Clear", "MB_Dialog", "MeasLT2", "MeasPose4", "S_Gen_Mat", "S_ValueMat", "S_Gen_Str", "CalibRobot", "FilterProg2"]
)



Number = Union[int, float]
JointsLike = Union[Mat, Sequence[float], float]


def _env_float(name: str, default: Optional[float]) -> Optional[float]:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        v = float(raw)
    except ValueError:
        logger.warning("Ignoring %s=%r: not a number", name, raw)
        return default
    return None if v <= 0 else v


def _env_port() -> Optional[int]:
    for name in ("ENGINUITY_API_PORT",):
        raw = os.environ.get(name, "").strip()
        if raw:
            try:
                return int(raw)
            except ValueError:
                logger.warning("Ignoring %s=%r: not a port number", name, raw)
    return None


def _handle_of(x: Any) -> int:
    if x is None or x == 0:
        return 0
    if isinstance(x, Item):
        return x.item
    if isinstance(x, int) and not isinstance(x, bool):
        return x
    raise InputError("Expected an Item, got %s" % type(x).__name__)


def _joints(x: Any) -> List[float]:
    pass
    if isinstance(x, Mat):
        r, c = x.size()
        if c == 1 or r == 1:
            return [float(v) for v in x.tolist()]
        if r == 0 or c == 0:
            return []
        raise InputError("Expected joint values, got a %dx%d matrix" % (r, c))
    if isinstance(x, (int, float)) and not isinstance(x, bool):
        return [float(x)]
    if hasattr(x, "tolist") and not isinstance(x, (list, tuple)):
        x = x.tolist()
    if isinstance(x, (list, tuple)):
        out: List[float] = []
        for v in x:
            if isinstance(v, (list, tuple)):
                out.extend(float(w) for w in v)
            else:
                out.append(float(v))
        return out
    raise InputError("Expected joint values, got %s" % type(x).__name__)


def _pose(x: Any) -> Mat:
    pass
    m = x if isinstance(x, Mat) else None
    if m is None:
        try:
            m = Mat(x.tolist() if hasattr(x, "tolist") else x)
        except (TypeError, ValueError) as e:
            raise InputError("Expected a 4x4 pose, got %s" % type(x).__name__) from e
    if m.size() != (4, 4):
        raise InputError("Expected a 4x4 pose, got a %dx%d matrix" % tuple(m.size()))
    return m


def _is_pose(x: Any) -> bool:
    if isinstance(x, Mat):
        return x.size() == (4, 4)
    if hasattr(x, "shape"):
        return tuple(getattr(x, "shape")) == (4, 4)
    return isinstance(x, (list, tuple)) and len(x) == 4 and all(isinstance(r, (list, tuple)) and len(r) == 4 for r in x)


def _matrix(x: Any) -> Mat:
    if isinstance(x, Mat):
        return x
    try:
        return Mat(x.tolist() if hasattr(x, "tolist") and not isinstance(x, (list, tuple)) else x)
    except (TypeError, ValueError) as e:
        raise InputError("Expected a matrix, got %s" % type(x).__name__) from e


def _points_matrix(points: Any) -> Mat:
    pass
    if isinstance(points, Mat):
        return points
    rows = points.tolist() if hasattr(points, "tolist") and not isinstance(points, (list, tuple)) else list(points)
    if not rows:
        return Mat(3, 0)
    if all(isinstance(r, (list, tuple)) for r in rows):
        width = len(rows[0])
        if width in (3, 6) and (len(rows) not in (3, 6) or width != len(rows)):
            return Mat(rows).tr()
        return Mat(rows)
    return Mat(rows)


def _vec_mat(values: Sequence[float]) -> Mat:
    pass
    if values:
        return Mat([float(v) for v in values])
    out = Mat()
    out.rows = [[0]]
    return out


def _to_int(x: Any, default: int = 0) -> int:
    if x is None:
        return default
    if isinstance(x, bool):
        return int(x)
    try:
        return int(round(float(x)))
    except (TypeError, ValueError) as e:
        raise InputError("Expected an integer, got %r" % (x,)) from e


def _visible_frame(v: Any) -> int:
    if v is None:
        return -1
    if v is True:
        return -3
    if v is False:
        return -2
    return int(v)





class _Call:
    pass

    __slots__ = ("link", "name", "enc", "timeout", "sent", "done", "_sock")

    def __init__(self, link: "Enginuity", name: str, timeout: Optional[float]) -> None:
        self.link = link
        self.name = name
        self.enc = Encoder().line(name)
        self.timeout = timeout
        self.sent = False
        self.done = False
        self._sock: Optional[WireSocket] = None

    
    def line(self, text: Any, br: str = "<br>") -> "_Call":
        self.enc.line(text, br)
        return self

    def int(self, v: Any) -> "_Call":
        self.enc.int(v)
        return self

    def handle(self, x: Any) -> "_Call":
        self.enc.handle(_handle_of(x))
        return self

    def pose(self, x: Any) -> "_Call":
        self.enc.pose(_pose(x))
        return self

    def array(self, values: Sequence[float]) -> "_Call":
        self.enc.array([float(v) for v in values])
        return self

    def array_f(self, values: Sequence[float]) -> "_Call":
        self.enc.array_f([float(v) for v in values])
        return self

    def matrix(self, m: Any) -> "_Call":
        self.enc.matrix(_matrix(m))
        return self

    def matrix_f(self, m: Any) -> "_Call":
        self.enc.matrix_f(_matrix(m))
        return self

    def bytes(self, data: bytes) -> "_Call":
        self.enc.bytes(data)
        return self

    def xyz(self, p: Sequence[float]) -> "_Call":
        self.enc.xyz(p)
        return self

    
    def flush(self) -> WireSocket:
        if self._sock is None:
            self._sock = self.link._send(self.enc.payload(), self.name)
            self.sent = True
        self._sock.settimeout(self.timeout)
        return self._sock

    
    def r_line(self) -> str:
        return self.flush().read_line()

    def r_int(self) -> int:
        return self.flush().read_int()

    def r_handle(self) -> int:
        return self.flush().read_handle()

    def r_item(self) -> "Item":
        h, t = self.flush().read_item_ref()
        return Item(self.link, h, t)

    def r_items(self) -> List["Item"]:
        n = self.r_int()
        return [self.r_item() for _ in range(max(0, n))]

    def r_pose(self) -> Mat:
        return self.flush().read_pose()

    def r_array(self) -> List[float]:
        return self.flush().read_array()

    def r_matrix(self) -> Mat:
        return self.flush().read_matrix()

    def r_bytes(self) -> bytes:
        return self.flush().read_bytes()

    def r_xyz(self) -> List[float]:
        return self.flush().read_xyz()

    def status(self) -> None:
        pass
        status, message = self.flush().read_status()
        self.done = True
        self.link._raise_status(self.name, status, message)

    def ok(self) -> None:
        pass
        if self.link.skip_status:
            self.flush()
            self.done = True
            return
        self.status()


class _CallContext:
    __slots__ = ("link", "call")

    def __init__(self, link: "Enginuity", call: _Call) -> None:
        self.link = link
        self.call = call

    def __enter__(self) -> _Call:
        self.link._lock.acquire()
        self.link._in_call += 1
        return self.call

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        try:
            if exc_type is None and not self.call.done:
                
                self.link._drop("incomplete reply to %s" % self.call.name)
            elif exc_type is not None and self.call.sent and not self.call.done:
                self.link._drop("%s failed: %s" % (self.call.name, exc))
        finally:
            self.link._in_call -= 1
            self.link._lock.release()





class Item:
    pass

    __slots__ = ("link", "item", "type")

    def __init__(self, link: "Enginuity", ptr_item: int = 0, itemtype: int = -1) -> None:
        self.link = link
        self.item = int(ptr_item)
        self.type = int(itemtype)

    

    def __repr__(self) -> str:
        if not self.item:
            return "Item(invalid)"
        name = None
        try:
            
            if self.link is not None and self.link._sock is not None and not self.link._in_call:
                name = self.Name()
        except EnginuityError:
            name = None
        kind = _TYPE_NAMES.get(self.type, str(self.type))
        if name is None:
            return "Item(%s, handle=%d)" % (kind, self.item)
        return "Item(%s %r, handle=%d)" % (kind, name, self.item)

    def __eq__(self, other: object) -> bool:
        return isinstance(other, Item) and other.item == self.item

    def __ne__(self, other: object) -> bool:
        return not self.__eq__(other)

    def __hash__(self) -> int:
        return hash(self.item)

    def equals(self, item2: "Item") -> bool:
        pass
        return isinstance(item2, Item) and item2.item == self.item

    def RDK(self) -> "Enginuity":
        pass
        return self.link

    def Valid(self, check_deleted: bool = False) -> bool:
        pass
        if not self.item:
            return False
        if check_deleted:
            return self.Type() >= 0
        return True

    def _need(self) -> None:
        if not self.item:
            raise InvalidItemError("Invalid item: this item is null (a lookup found nothing).", 1)

    

    def Type(self) -> int:
        pass
        with self.link._call("G_Item_Type") as c:
            c.handle(self)
            t = c.r_int()
            c.status()
        self.type = t
        return t

    def Name(self) -> str:
        pass
        with self.link._call("G_Name") as c:
            c.handle(self)
            name = c.r_line()
            c.status()
        return name

    def setName(self, name: str) -> "Item":
        pass
        with self.link._call("S_Name") as c:
            c.handle(self).line(name)
            c.ok()
        return self

    def Parent(self) -> "Item":
        pass
        with self.link._call("G_Parent") as c:
            c.handle(self)
            it = c.r_item()
            c.status()
        return it

    def setParent(self, parent: "Item") -> "Item":
        pass
        with self.link._call("S_Parent") as c:
            c.handle(self).handle(parent)
            c.ok()
        return self

    def setParentStatic(self, parent: "Item") -> "Item":
        pass
        with self.link._call("S_Parent_Static") as c:
            c.handle(self).handle(parent)
            c.ok()
        return self

    def Childs(self) -> List["Item"]:
        pass
        with self.link._call("G_Childs") as c:
            c.handle(self)
            items = c.r_items()
            c.status()
        return items

    Children = Childs

    def Visible(self) -> int:
        pass
        with self.link._call("G_Visible") as c:
            c.handle(self)
            v = c.r_int()
            c.status()
        return v

    def setVisible(self, visible: Any, visible_frame: Any = None) -> "Item":
        pass
        with self.link._call("S_Visible") as c:
            c.handle(self).int(1 if visible else 0).int(_visible_frame(visible_frame))
            c.ok()
        return self

    def AttachClosest(self, keyword: str = "", tolerance_mm: float = -1, list_objects: Optional[Sequence["Item"]] = None) -> "Item":
        pass
        objs = list(list_objects or [])
        with self.link._call("Attach_Closest2") as c:
            c.handle(self).line(keyword).array([tolerance_mm]).int(len(objs))
            for o in objs:
                c.handle(o)
            it = c.r_item()
            c.status()
        return it

    def DetachClosest(self, parent: Optional["Item"] = None) -> "Item":
        pass
        with self.link._call("Detach_Closest") as c:
            c.handle(self).handle(parent)
            it = c.r_item()
            c.status()
        return it

    def DetachAll(self, parent: Optional["Item"] = None) -> "Item":
        pass
        with self.link._call("Detach_All") as c:
            c.handle(self).handle(parent)
            c.ok()
        return self

    def Copy(self, copy_children: bool = True, copy_childs: Optional[bool] = None) -> "Item":
        pass
        self.link.Copy(self, copy_children if copy_childs is None else copy_childs)
        return self

    def Paste(self, paste_times: int = 1) -> Any:
        pass
        return self.link.Paste(self, paste_times)

    def Delete(self) -> None:
        pass
        if not self.item:
            raise InputError("Item is not valid or was already deleted")
        with self.link._call("Remove") as c:
            c.handle(self)
            c.ok()
        self.item = 0

    def Save(self, filename: str) -> None:
        pass
        self.link.Save(filename, self)

    def IsInside(self, object: "Item") -> int:  # noqa: A002 - robolink-compatible argument name
        pass
        with self.link._call("IsInside", self.link.long_timeout) as c:
            c.handle(self).handle(object)
            v = c.r_int()
            c.status()
        return v

    def Collision(self, item_check: "Item") -> int:
        pass
        return self.link.Collision(self, item_check)

    def setParam(self, param: Any, value: Any = None, skip_result: bool = False) -> Any:
        pass
        if isinstance(value, (bytes, bytearray)):
            with self.link._call("S_ItmDataParam") as c:
                c.handle(self).line(str(param)).bytes(bytes(value))
                c.ok()
            return None
        text = "" if value is None else json.dumps(value) if isinstance(value, (dict, list)) else str(value)
        if skip_result:
            with self.link._call("BlindICMD") as c:
                c.handle(self).line(str(param)).line(text)
                c.flush()
                c.done = True
            return None
        with self.link._call("ICMD", self.link.long_timeout) as c:
            c.handle(self).line(str(param)).line(text)
            answer = c.r_line()
            c.status()
        return _maybe_json(answer)

    def getParam(self, param: str, str: bool = True) -> Any:  # noqa: A002 - robolink-compatible argument name
        pass
        with self.link._call("G_ItmDataParam") as c:
            c.handle(self).line(param)
            data = c.r_bytes()
            c.status()
        if not str:
            return data
        return data.decode("utf-8", errors="replace")

    def setValue(self, varname: str, value: Any = None) -> Any:
        pass
        cmd = "S_Gen_Str" if isinstance(value, str) or value is None else "S_ValueMat"
        self.link._require(cmd, "Item.setValue")
        with self.link._call(cmd) as c:
            if cmd == "S_Gen_Str":
                c.handle(self).line(varname).line("" if value is None else value)
                c.ok()
                return None
            c.handle(self).line(varname).matrix(value)
            m = c.r_matrix()
            c.status()
        return m

    

    def Pose(self) -> Mat:
        pass
        with self.link._call("G_Hlocal") as c:
            c.handle(self)
            p = c.r_pose()
            c.status()
        return p

    def setPose(self, pose: Any) -> "Item":
        pass
        with self.link._call("S_Hlocal") as c:
            c.handle(self).pose(pose)
            c.ok()
        return self

    def PoseAbs(self) -> Mat:
        pass
        with self.link._call("G_Hlocal_Abs") as c:
            c.handle(self)
            p = c.r_pose()
            c.status()
        return p

    def setPoseAbs(self, pose: Any) -> "Item":
        pass
        with self.link._call("S_Hlocal_Abs") as c:
            c.handle(self).pose(pose)
            c.ok()
        return self

    def setGeometryPose(self, pose: Any, apply: bool = False) -> "Item":
        pass
        with self.link._call("S_Hgeo2") as c:
            c.handle(self).pose(pose).int(1 if apply else 0)
            c.ok()
        return self

    def GeometryPose(self) -> Mat:
        pass
        with self.link._call("G_Hgeom") as c:
            c.handle(self)
            p = c.r_pose()
            c.status()
        return p

    def PoseTool(self) -> Mat:
        pass
        with self.link._call("G_Tool") as c:
            c.handle(self)
            p = c.r_pose()
            c.status()
        return p

    def Htool(self) -> Mat:
        pass
        with self.link._call("G_Htool") as c:
            c.handle(self)
            p = c.r_pose()
            c.status()
        return p

    def setPoseTool(self, tool: Any) -> "Item":
        pass
        if isinstance(tool, Item):
            with self.link._call("S_Tool_ptr") as c:
                c.handle(tool).handle(self)
                c.ok()
            return self
        with self.link._call("S_Tool") as c:
            c.pose(tool).handle(self)
            c.ok()
        return self

    setTool = setPoseTool

    def setHtool(self, pose: Any) -> "Item":
        pass
        with self.link._call("S_Htool") as c:
            c.handle(self).pose(pose)
            c.ok()
        return self

    def PoseFrame(self) -> Mat:
        pass
        with self.link._call("G_Frame") as c:
            c.handle(self)
            p = c.r_pose()
            c.status()
        return p

    def setPoseFrame(self, frame: Any) -> "Item":
        pass
        if isinstance(frame, Item):
            with self.link._call("S_Link_ptr") as c:
                c.handle(frame).handle(self)
                c.ok()
            return self
        with self.link._call("S_Frame") as c:
            c.pose(frame).handle(self)
            c.ok()
        return self

    setFrame = setPoseFrame

    def setLink(self, item: "Item") -> "Item":
        pass
        with self.link._call("S_Link_ptr") as c:
            c.handle(item).handle(self)
            c.ok()
        return self

    def getLink(self, type_linked: int = ITEM_TYPE_ROBOT) -> "Item":
        pass
        with self.link._call("G_LinkType") as c:
            c.handle(self).int(type_linked)
            it = c.r_item()
            c.status()
        return it

    def setRobot(self, robot: Optional["Item"] = None) -> "Item":
        pass
        with self.link._call("S_Robot") as c:
            c.handle(self).handle(robot)
            c.ok()
        return self

    def AddTool(self, tool_pose: Any, tool_name: str = "New TCP") -> "Item":
        pass
        with self.link._call("AddToolEmpty") as c:
            c.handle(self).pose(tool_pose).line(tool_name)
            it = c.r_item()
            c.status()
        return it

    def ObjectLink(self, link_id: int = 0) -> "Item":
        pass
        with self.link._call("G_LinkObjId") as c:
            c.handle(self).int(link_id)
            it = c.r_item()
            c.status()
        return it

    

    def Scale(self, scale: Any, pre_mult: Any = None, post_mult: Any = None) -> "Item":
        pass
        s = [float(scale)] * 3 if isinstance(scale, (int, float)) else _joints(scale)[:3]
        if pre_mult is None and post_mult is None:
            with self.link._call("Scale") as c:
                c.handle(self).array(s)
                c.ok()
            return self
        with self.link._call("TrScale") as c:
            c.handle(self).array(s).pose(eye() if pre_mult is None else pre_mult).pose(eye() if post_mult is None else post_mult)
            c.r_int()
            c.status()
        return self

    def Recolor(self, tocolor: Any, fromcolor: Any = None, tolerance: Optional[float] = None) -> "Item":
        pass
        to = _color(tocolor)
        if fromcolor is None:
            values = [tolerance if tolerance is not None else 2.0, 0.0, 0.0, 0.0, 0.0] + to
        else:
            values = [tolerance if tolerance is not None else 0.1] + _color(fromcolor) + to
        with self.link._call("Recolor") as c:
            c.handle(self).array(values)
            c.ok()
        return self

    def setColor(self, tocolor: Any) -> "Item":
        pass
        with self.link._call("S_Color") as c:
            c.handle(self).array(_color(tocolor))
            c.ok()
        return self

    def Color(self) -> List[float]:
        pass
        with self.link._call("G_Color") as c:
            c.handle(self)
            v = c.r_array()
            c.status()
        return v

    def setColorShape(self, tocolor: Any, shape_id: int) -> "Item":
        pass
        with self.link._call("S_ShapeColor") as c:
            c.handle(self).int(shape_id).array(_color(tocolor))
            c.ok()
        return self

    def setColorCurve(self, tocolor: Any, curve_id: int = -1) -> "Item":
        pass
        with self.link._call("S_CurveColor") as c:
            c.handle(self).int(curve_id).array(_color(tocolor))
            c.ok()
        return self

    def AddGeometry(self, fromitem: "Item", pose: Any) -> "Item":
        pass
        with self.link._call("CopyFaces") as c:
            c.handle(fromitem).handle(self).pose(pose)
            c.ok()
        return self

    def AddShape(self, triangle_points: Any, override_shapes: bool = False, color: Any = None) -> "Item":
        pass
        return self.link.AddShape(triangle_points, self, override_shapes, color)

    def AddCurve(self, curve_points: Any, add_to_ref: bool = False, projection_type: int = PROJECTION_ALONG_NORMAL_RECALC) -> "Item":
        pass
        return self.link.AddCurve(curve_points, self, add_to_ref, projection_type)

    def AddPoints(self, points: Any, add_to_ref: bool = False, projection_type: int = PROJECTION_ALONG_NORMAL_RECALC) -> "Item":
        pass
        return self.link.AddPoints(points, self, add_to_ref, projection_type)

    def ProjectPoints(self, points: Any, projection_type: int = PROJECTION_ALONG_NORMAL_RECALC) -> Mat:
        pass
        return self.link.ProjectPoints(points, self, projection_type)

    def SelectedFeature(self) -> Tuple[bool, int, int]:
        pass
        with self.link._call("G_ObjSelection") as c:
            c.handle(self)
            sel = c.r_int()
            ftype = c.r_int()
            fid = c.r_int()
            c.status()
        return sel > 0, ftype, fid

    def GetPoints(self, feature_type: int = FEATURE_SURFACE, feature_id: int = 0) -> Any:
        pass
        with self.link._call("G_ObjPoint") as c:
            c.handle(self).int(feature_type).int(feature_id)
            if feature_type >= FEATURE_HOVER_OBJECT_MESH:
                pts = c.r_matrix() if feature_type == FEATURE_HOVER_OBJECT_MESH else Mat()
                it = c.r_item()
                a = c.r_int()
                b = c.r_int()
                c.r_int()
                name = c.r_line()
                c.status()
                return pts, it, a, b, name
            pts = c.r_matrix()
            name = c.r_line()
            c.status()
        return pts, name

    def GetCurves(self) -> List[Tuple[Mat, str]]:
        pass
        with self.link._call("G_ObjCurves") as c:
            c.handle(self).int(FEATURE_CURVE)
            n = c.r_int()
            out = [(c.r_matrix(), c.r_line()) for _ in range(max(0, n))]
            c.status()
        return out

    

    def Joints(self) -> Mat:
        pass
        with self.link._call("G_Thetas") as c:
            c.handle(self)
            v = c.r_array()
            c.status()
        return _vec_mat(v)

    def SimulatorJoints(self) -> Mat:
        pass
        with self.link._call("G_Thetas_Sim") as c:
            c.handle(self)
            v = c.r_array()
            c.status()
        return _vec_mat(v)

    def setJoints(self, joints: JointsLike) -> "Item":
        pass
        with self.link._call("S_Thetas") as c:
            c.array(_joints(joints)).handle(self)
            c.ok()
        return self

    def JointsHome(self) -> Mat:
        pass
        with self.link._call("G_Home") as c:
            c.handle(self)
            v = c.r_array()
            c.status()
        return _vec_mat(v)

    def setJointsHome(self, joints: JointsLike) -> "Item":
        pass
        with self.link._call("S_Home") as c:
            c.array(_joints(joints)).handle(self)
            c.ok()
        return self

    def JointLimits(self) -> Tuple[Mat, Mat, float]:
        pass
        with self.link._call("G_RobLimits") as c:
            c.handle(self)
            lo = c.r_array()
            hi = c.r_array()
            jt = c.r_int() / 1000.0
            c.status()
        return _vec_mat(lo), _vec_mat(hi), jt

    def setJointLimits(self, lower_limit: JointsLike, upper_limit: JointsLike) -> "Item":
        pass
        with self.link._call("S_RobLimits") as c:
            c.handle(self).array(_joints(lower_limit)).array(_joints(upper_limit))
            c.ok()
        return self

    def JointPoses(self, joints: Optional[JointsLike] = None) -> List[Mat]:
        pass
        with self.link._call("G_LinkPoses") as c:
            c.handle(self).array(_joints(joints) if joints is not None else [])
            n = c.r_int()
            out = [c.r_pose() for _ in range(max(0, n))]
            c.status()
        return out

    def SolveFK(self, joints: JointsLike, tool: Any = None, reference: Any = None) -> Mat:
        pass
        with self.link._call("G_FK") as c:
            c.array(_joints(joints)).handle(self)
            pose = c.r_pose()
            c.status()
        if tool is not None:
            pose = pose * _pose(tool)
        if reference is not None:
            pose = invH(_pose(reference)) * pose
        return pose

    def JointsConfig(self, joints: JointsLike) -> Mat:
        pass
        with self.link._call("G_Thetas_Config") as c:
            c.array(_joints(joints)).handle(self)
            v = c.r_array()
            c.status()
        return _vec_mat(v)

    def SolveIK(self, pose: Any, joints_approx: Optional[JointsLike] = None, tool: Any = None, reference: Any = None) -> Mat:
        pass
        p = _pose(pose)
        if tool is not None:
            p = p * invH(_pose(tool))
        if reference is not None:
            p = _pose(reference) * p
        if joints_approx is None:
            with self.link._call("G_IK") as c:
                c.pose(p).handle(self)
                v = c.r_array()
                c.status()
        else:
            with self.link._call("G_IK_jnts") as c:
                c.pose(p).array(_joints(joints_approx)).handle(self)
                v = c.r_array()
                c.status()
        return _vec_mat(v)

    def SolveIK_All(self, pose: Any, tool: Any = None, reference: Any = None) -> Mat:
        pass
        p = _pose(pose)
        if tool is not None:
            p = p * invH(_pose(tool))
        if reference is not None:
            p = _pose(reference) * p
        with self.link._call("G_IK_cmpl") as c:
            c.pose(p).handle(self)
            m = c.r_matrix()
            c.status()
        return m

    def FilterTarget(self, pose: Any, joints_approx: Optional[JointsLike] = None) -> Tuple[Mat, Mat]:
        pass
        with self.link._call("FilterTarget") as c:
            c.pose(pose).array(_joints(joints_approx) if joints_approx is not None else []).handle(self)
            p = c.r_pose()
            j = c.r_array()
            c.status()
        return p, _vec_mat(j)

    def setAccuracyActive(self, accurate: int = 1) -> "Item":
        pass
        with self.link._call("S_AbsAccOn") as c:
            c.handle(self).int(accurate)
            c.ok()
        return self

    def AccuracyActive(self) -> int:
        pass
        with self.link._call("G_AbsAccOn") as c:
            c.handle(self)
            v = c.r_int()
            c.status()
        return v

    def setParamRobotTool(self, tool_mass: float = 5, tool_cog: Optional[Sequence[float]] = None) -> "Item":
        pass
        values = [float(tool_mass)] + (list(tool_cog)[:3] if tool_cog is not None else [])
        with self.link._call("S_ParamCalibTool") as c:
            c.handle(self).array(values)
            c.ok()
        return self

    def ShowSequence(self, matrix: Any, display_type: int = -1, timeout: int = -1) -> "Item":
        pass
        if isinstance(matrix, Mat) and display_type == -1 and timeout == -1:
            with self.link._call("Show_Seq") as c:
                c.matrix(matrix).handle(self)
                c.ok()
            return self
        entries = list(matrix.Cols()) if isinstance(matrix, Mat) else list(matrix)
        joints = display_type > 0 and display_type & SEQUENCE_DISPLAY_ROBOT_JOINTS != 0
        if not joints and entries and not _is_pose(entries[0]):
            joints = True
            display_type = SEQUENCE_DISPLAY_ROBOT_JOINTS if display_type < 0 else display_type | SEQUENCE_DISPLAY_ROBOT_JOINTS
        with self.link._call("Show_SeqPoses") as c:
            c.handle(self).array([display_type, timeout]).int(len(entries))
            for e in entries:
                if joints:
                    c.array(_joints(e))
                else:
                    c.pose(e)
            c.ok()
        return self

    

    def _move(self, move_type: int, target: Any, blocking: bool) -> None:
        if self.type == ITEM_TYPE_PROGRAM and isinstance(target, Item):
            with self.link._call("Add_INSMOVE") as c:
                c.handle(target).handle(self).int(move_type)
                c.ok()
            return
        kind, values, handle = _move_target(target)
        blocking = blocking and self.type != ITEM_TYPE_PROGRAM
        name = "MoveXb" if blocking else "MoveX"
        with self.link._call(name, self.link.long_timeout if blocking else None) as c:
            c.int(move_type).int(kind).array(values).handle(handle).handle(self)
            c.status()
            if blocking:
                c.done = False
                c.status()

    def MoveJ(self, target: Any, blocking: bool = True) -> "Item":
        pass
        self._move(MOVE_TYPE_JOINT, target, blocking)
        return self

    def MoveL(self, target: Any, blocking: bool = True) -> "Item":
        pass
        self._move(MOVE_TYPE_LINEAR, target, blocking)
        return self

    def SearchL(self, target: Any, blocking: bool = True) -> "Item":
        pass
        self._move(MOVE_TYPE_LINEARSEARCH, target, blocking)
        return self

    def MoveC(self, target1: Any, target2: Any, blocking: bool = True) -> "Item":
        pass
        if self.type == ITEM_TYPE_PROGRAM and isinstance(target1, Item) and isinstance(target2, Item):
            with self.link._call("Add_INSMOVEC") as c:
                c.handle(target1).handle(target2).handle(self)
                c.ok()
            return self
        k1, v1, h1 = _move_target(target1)
        k2, v2, h2 = _move_target(target2)
        blocking = blocking and self.type != ITEM_TYPE_PROGRAM
        name = "MoveCb" if blocking else "MoveC"
        with self.link._call(name, self.link.long_timeout if blocking else None) as c:
            c.int(MOVE_TYPE_CIRCULAR).int(k1).array(v1).handle(h1).int(k2).array(v2).handle(h2).handle(self)
            c.status()
            if blocking:
                c.done = False
                c.status()
        return self

    def MoveJ_Test(self, j1: JointsLike, j2: JointsLike, minstep_deg: float = -1) -> int:
        pass
        with self.link._call("CollisionMove", self.link.long_timeout) as c:
            c.handle(self).array(_joints(j1)).array(_joints(j2)).int(minstep_deg * 1000)
            v = c.r_int()
            c.status()
        return v

    MoveJ_Collision = MoveJ_Test

    def MoveL_Test(self, joints1: JointsLike, pose2: Any, minstep_mm: float = -1) -> int:
        pass
        with self.link._call("CollisionMoveL", self.link.long_timeout) as c:
            c.handle(self).array(_joints(joints1)).pose(pose2).int(minstep_mm * 1000)
            v = c.r_int()
            c.status()
        return v

    def MoveJ_Test_Blend(self, j1: JointsLike, j2: JointsLike, j3: JointsLike, blend_deg: float = 5, minstep_deg: float = -1) -> int:
        pass
        with self.link._call("CollisionMoveBlend", self.link.long_timeout) as c:
            c.handle(self).array(_joints(j1)).array(_joints(j2)).array(_joints(j3)).int(minstep_deg * 1000).int(blend_deg * 1000)
            v = c.r_int()
            c.status()
        return v

    def setSpeed(self, speed_linear: float, speed_joints: float = -1, accel_linear: float = -1, accel_joints: float = -1) -> "Item":
        pass
        with self.link._call("S_Speed4") as c:
            c.handle(self).array([speed_linear, speed_joints, accel_linear, accel_joints])
            c.ok()
        return self

    def setAcceleration(self, accel_linear: float) -> "Item":
        pass
        return self.setSpeed(-1, -1, accel_linear, -1)

    def setSpeedJoints(self, speed_joints: float) -> "Item":
        pass
        return self.setSpeed(-1, speed_joints, -1, -1)

    def setAccelerationJoints(self, accel_joints: float) -> "Item":
        pass
        return self.setSpeed(-1, -1, -1, accel_joints)

    def setRounding(self, rounding_mm: float) -> "Item":
        pass
        with self.link._call("S_ZoneData") as c:
            c.int(rounding_mm * 1000).handle(self)
            c.ok()
        return self

    setZoneData = setRounding

    def Busy(self) -> int:
        pass
        with self.link._call("IsBusy") as c:
            c.handle(self)
            v = c.r_int()
            c.status()
        return v

    def Stop(self) -> "Item":
        pass
        with self.link._call("Stop") as c:
            c.handle(self)
            c.ok()
        return self

    def WaitMove(self, timeout: float = 360000) -> "Item":
        pass
        with self.link._call("WaitMove", max(float(timeout), self.link.timeout or 0) if timeout else None) as c:
            c.handle(self)
            c.status()
            c.done = False
            c.status()
        return self

    def WaitFinished(self) -> "Item":
        pass
        while self.Busy():
            time.sleep(0.05)
        return self

    def setRunType(self, program_run_type: int) -> "Item":
        pass
        with self.link._call("S_ProgRunType") as c:
            c.handle(self).int(program_run_type)
            c.ok()
        return self

    def RunType(self) -> int:
        pass
        with self.link._call("G_ProgRunType") as c:
            c.handle(self)
            v = c.r_int()
            c.status()
        return v

    

    def RunProgram(self, prog_parameters: Optional[Sequence[Any]] = None) -> int:
        pass
        if prog_parameters:
            with self.link._call("RunProgParam") as c:
                c.handle(self).line("<br>".join(str(p) for p in prog_parameters))
                v = c.r_int()
                c.status()
            return v
        with self.link._call("RunProg") as c:
            c.handle(self)
            v = c.r_int()
            c.status()
        return v

    RunCode = RunProgram

    def RunInstruction(self, code: str, run_type: int = INSTRUCTION_CALL_PROGRAM) -> int:
        pass
        with self.link._call("RunCode2") as c:
            c.handle(self).line(code, br="<<br>>").int(run_type)
            v = c.r_int()
            c.status()
        return v

    RunCodeCustom = RunInstruction

    def Pause(self, time_ms: float = -1) -> "Item":
        pass
        with self.link._call("RunPause", self.link.long_timeout) as c:
            c.handle(self).int(time_ms * 1000)
            c.ok()
        return self

    def setDO(self, io_var: Any, io_value: Any) -> "Item":
        pass
        with self.link._call("setDO") as c:
            c.handle(self).line(io_var).line(io_value)
            c.ok()
        return self

    def setAO(self, io_var: Any, io_value: Any) -> "Item":
        pass
        with self.link._call("setAO") as c:
            c.handle(self).line(io_var).line(io_value)
            c.ok()
        return self

    def getDI(self, io_var: Any) -> str:
        pass
        with self.link._call("getDI") as c:
            c.handle(self).line(io_var)
            v = c.r_line()
            c.status()
        return v

    def getAI(self, io_var: Any) -> Any:
        pass
        with self.link._call("getAI") as c:
            c.handle(self).line(io_var)
            v = c.r_line()
            c.status()
        try:
            return float(v)
        except ValueError:
            return v

    def waitDI(self, io_var: Any, io_value: Any, timeout_ms: float = -1) -> "Item":
        pass
        with self.link._call("waitDI", self.link.long_timeout) as c:
            c.handle(self).line(io_var).line(io_value).int(-1000 if timeout_ms is None else timeout_ms * 1000)
            c.ok()
        return self

    def customInstruction(self, name: str, path_run: str, path_icon: str = "", blocking: int = 1, cmd_run_on_robot: str = "") -> "Item":
        pass
        with self.link._call("InsCustom2") as c:
            c.handle(self).line(name).line(path_run).line(path_icon).line(cmd_run_on_robot).int(blocking)
            c.ok()
        return self

    def addMoveJ(self, itemtarget: "Item") -> "Item":
        pass
        with self.link._call("Add_INSMOVE") as c:
            c.handle(itemtarget).handle(self).int(MOVE_TYPE_JOINT)
            c.ok()
        return self

    def addMoveL(self, itemtarget: "Item") -> "Item":
        pass
        with self.link._call("Add_INSMOVE") as c:
            c.handle(itemtarget).handle(self).int(MOVE_TYPE_LINEAR)
            c.ok()
        return self

    def addMoveC(self, itemtarget1: "Item", itemtarget2: "Item") -> "Item":
        pass
        with self.link._call("Add_INSMOVEC") as c:
            c.handle(itemtarget1).handle(itemtarget2).handle(self)
            c.ok()
        return self

    def ShowInstructions(self, show: bool = True) -> "Item":
        pass
        with self.link._call("Prog_ShowIns") as c:
            c.handle(self).int(1 if show else 0)
            c.ok()
        return self

    def ShowTargets(self, show: bool = True) -> "Item":
        pass
        with self.link._call("Prog_ShowTargets") as c:
            c.handle(self).int(1 if show else 0)
            c.ok()
        return self

    def InstructionCount(self) -> int:
        pass
        with self.link._call("Prog_Nins") as c:
            c.handle(self)
            v = c.r_int()
            c.status()
        return v

    def Instruction(self, ins_id: int = -1) -> Tuple[str, int, Optional[int], Optional[int], Optional[Mat], Optional[Mat]]:
        pass
        with self.link._call("Prog_GIns") as c:
            c.handle(self).int(ins_id)
            name = c.r_line()
            ins_type = c.r_int()
            move_type: Optional[int] = None
            isjoint: Optional[int] = None
            pose: Optional[Mat] = None
            joints: Optional[Mat] = None
            if ins_type == INS_TYPE_MOVE:
                move_type = c.r_int()
                isjoint = c.r_int()
                pose = c.r_pose()
                joints = _vec_mat(c.r_array())
            c.status()
        return name, ins_type, move_type, isjoint, pose, joints

    def setInstruction(self, ins_id: int, name: str, instype: int, movetype: int, isjointtarget: int, target: Any, joints: JointsLike) -> "Item":
        pass
        with self.link._call("Prog_SIns") as c:
            c.handle(self).int(ins_id).line(name).int(instype)
            if instype == INS_TYPE_MOVE:
                c.int(movetype).int(isjointtarget).pose(target if target is not None else eye()).array(_joints(joints) if joints is not None else [])
            c.ok()
        return self

    def InstructionSelect(self, ins_id: int = -1) -> int:
        pass
        with self.link._call("Prog_SelIns") as c:
            c.handle(self).int(ins_id)
            v = c.r_int()
            c.status()
        return v

    def InstructionDelete(self, ins_id: int = 0) -> bool:
        pass
        with self.link._call("Prog_DelIns") as c:
            c.handle(self).int(ins_id)
            v = c.r_int()
            c.status()
        return v > 0

    def InstructionList(self) -> Tuple[Mat, int]:
        pass
        with self.link._call("G_ProgInsList", self.link.long_timeout) as c:
            c.handle(self)
            m = c.r_matrix()
            err = c.r_int()
            c.status()
        return m, err

    def InstructionListJoints(self, mm_step: float = 10, deg_step: float = 5, save_to_file: Optional[str] = None,
                              collision_check: int = COLLISION_OFF, flags: int = 0, time_step: float = 0.1) -> Tuple[str, Mat, int]:
        pass
        with self.link._call("G_ProgJointList", self.link.long_timeout) as c:
            c.handle(self).array([mm_step, deg_step, collision_check, flags, time_step]).line(save_to_file or "")
            m = Mat() if save_to_file else c.r_matrix()
            status = c.r_int()
            msg = c.r_line()
            c.status()
        return msg, m, status

    def Update(self, check_collisions: int = COLLISION_OFF, timeout_sec: float = 3600, mm_step: float = -1, deg_step: float = -1) -> Tuple[float, float, float, float, str]:
        pass
        with self.link._call("Update2", max(float(timeout_sec), 1.0)) as c:
            c.handle(self).array([check_collisions, mm_step, deg_step])
            v = c.r_array()
            msg = c.r_line()
            c.status()
        v = (v + [0.0, 0.0, 0.0, 0.0])[:4]
        return v[0], v[1], v[2], v[3], msg

    def MakeProgram(self, folder_path: str = "", run_mode: int = RUNMODE_MAKE_ROBOTPROG) -> Tuple[bool, str, bool]:
        pass
        folder = folder_path or ""
        if folder and not folder.endswith(("/", "\\")):
            folder += "/"
        with self.link._call("MakeProg2", self.link.long_timeout) as c:
            c.handle(self).line(folder).int(run_mode)
            ok = c.r_int()
            log = c.r_line()
            transfer = c.r_int()
            c.status()
        return ok > 0, log, transfer > 0

    def FilterProgram(self, filestr: str) -> Tuple[int, str]:
        pass
        with self.link._call("FilterProg2", self.link.long_timeout) as c:
            c.handle(self).line(filestr)
            status = c.r_int()
            msg = c.r_line()
            c.status()
        return status, msg

    def setMillingParameters(self, ncfile: str = "", part: Optional["Item"] = None, params: str = "") -> Tuple["Item", float]:
        pass
        with self.link._call("S_MachiningParams", self.link.long_timeout) as c:
            c.handle(self).line(ncfile).handle(part).line(params)
            prog = c.r_item()
            status = c.r_int() / 1000.0
            c.status()
        return prog, status

    setMachiningParameters = setMillingParameters

    

    def setAsCartesianTarget(self) -> "Item":
        pass
        with self.link._call("S_Target_As_RT") as c:
            c.handle(self)
            c.ok()
        return self

    def setAsJointTarget(self) -> "Item":
        pass
        with self.link._call("S_Target_As_JT") as c:
            c.handle(self)
            c.ok()
        return self

    def isJointTarget(self) -> bool:
        pass
        with self.link._call("Target_Is_JT") as c:
            c.handle(self)
            v = c.r_int()
            c.status()
        return v > 0

    

    def Connect(self, robot_ip: str = "", blocking: bool = True) -> int:
        pass
        with self.link._call("Connect2") as c:
            c.handle(self).line(robot_ip).int(1 if blocking else 0)
            v = c.r_int()
            c.status()
        return v

    def ConnectSafe(self, robot_ip: str = "", max_attempts: int = 5, wait_connection: float = 4, callback_abort: Optional[Callable[[], bool]] = None) -> int:
        pass
        state = ROBOTCOM_NOT_CONNECTED
        for _ in range(max(1, max_attempts)):
            if callback_abort is not None and callback_abort():
                break
            self.Connect(robot_ip)
            state, _msg = self.ConnectedState()
            if state == ROBOTCOM_READY:
                break
            time.sleep(min(wait_connection, 1.0))
        return state

    def ConnectionParams(self) -> Tuple[str, int, str, str, str]:
        pass
        with self.link._call("ConnectParams") as c:
            c.handle(self)
            out = (c.r_line(), c.r_int(), c.r_line(), c.r_line(), c.r_line())
            c.status()
        return out

    def setConnectionParams(self, robot_ip: str, port: int, remote_path: str, ftp_user: str, ftp_pass: str) -> "Item":
        pass
        with self.link._call("setConnectParams") as c:
            c.handle(self).line(robot_ip).int(port).line(remote_path).line(ftp_user).line(ftp_pass)
            c.ok()
        return self

    def ConnectedState(self) -> Tuple[int, str]:
        pass
        with self.link._call("ConnectedState") as c:
            c.handle(self)
            state = c.r_int()
            msg = c.r_line()
            c.status()
        return state, msg

    def Disconnect(self) -> int:
        pass
        with self.link._call("Disconnect") as c:
            c.handle(self)
            v = c.r_int()
            c.status()
        return v


def _move_target(target: Any) -> Tuple[int, List[float], int]:
    pass
    if isinstance(target, Item):
        return 3, [], target.item
    if _is_pose(target):
        return 2, pose_col_major(_pose(target)), 0
    return 1, _joints(target), 0


def _color(c: Any) -> List[float]:
    values = _joints(c)
    if len(values) < 3:
        raise InputError("A color needs at least 3 values [r, g, b] (0..1)")
    return values[:4] if len(values) >= 4 else values + [1.0]


def _warn(message: str) -> None:
    pass
    if logger.hasHandlers():
        logger.warning("%s", message)
    else:
        print("WARNING: %s" % message, flush=True)


def _param_value(text: str) -> Any:
    pass
    try:
        return float(text)
    except ValueError:
        return text


def _maybe_json(text: str) -> Any:
    t = text.strip()
    if len(t) >= 2 and ((t[0] == "{" and t[-1] == "}") or (t[0] == "[" and t[-1] == "]")):
        try:
            return json.loads(t)
        except ValueError:
            return text
    return text


_TYPE_NAMES = {
    ITEM_TYPE_STATION: "station", ITEM_TYPE_ROBOT: "robot", ITEM_TYPE_FRAME: "frame", ITEM_TYPE_TOOL: "tool",
    ITEM_TYPE_OBJECT: "object", ITEM_TYPE_TARGET: "target", ITEM_TYPE_CURVE: "curve", ITEM_TYPE_PROGRAM: "program",
    ITEM_TYPE_INSTRUCTION: "instruction", ITEM_TYPE_PROGRAM_PYTHON: "python", ITEM_TYPE_MACHINING: "machining",
    ITEM_TYPE_FOLDER: "folder", ITEM_TYPE_CAMERA: "camera", ITEM_TYPE_NOTES: "notes", ITEM_TYPE_SCRIPT: "script",
}





class Event:
    pass

    __slots__ = ("evt", "item", "data")

    def __init__(self, evt: int, item: Item, data: Any = None) -> None:
        self.evt = evt
        self.item = item
        self.data = data

    def __iter__(self) -> Iterator[Any]:
        return iter((self.evt, self.item))

    def __repr__(self) -> str:
        return "Event(%d, %r, %r)" % (self.evt, self.item, self.data)





class Enginuity:
    pass

    def __init__(
        self,
        ip: Optional[str] = None,
        port: Optional[int] = None,
        args: Any = None,
        app_path: Optional[str] = None,
        close_std_out: bool = False,
        quit_on_close: bool = False,
        com_object: Any = None,
        skipstatus: bool = False,
        *,
        host: Optional[str] = None,
        timeout: Optional[float] = None,
        long_timeout: Optional[float] = None,
        connect_timeout: Optional[float] = None,
        auto_reconnect: bool = True,
        safe_mode: bool = True,
        connect: bool = True,
    ) -> None:
        self.host: str = host or ip or os.environ.get("ENGINUITY_HOST", "").strip() or DEFAULT_HOST
        env_port = _env_port()
        self.port: int = int(port) if port else (env_port if env_port else DEFAULT_PORT)
        self.timeout: Optional[float] = timeout if timeout is not None else _env_float("ENGINUITY_API_TIMEOUT", DEFAULT_TIMEOUT)
        self.long_timeout: Optional[float] = long_timeout if long_timeout is not None else DEFAULT_LONG_TIMEOUT
        self.connect_timeout: float = connect_timeout if connect_timeout is not None else DEFAULT_CONNECT_TIMEOUT
        self.auto_reconnect = auto_reconnect
        self.safe_mode = safe_mode
        self.skip_status = bool(skipstatus)
        self.quit_on_close = quit_on_close
        self.app_path: Optional[str] = app_path
        self.app_args: List[str] = [str(a) for a in (args or [])]
        self._app: Optional[subprocess.Popen] = None
        self.APPLICATION_DIR = os.path.dirname(app_path) if app_path else ""
        self.BUILD = 0
        self._lock = threading.RLock()
        self._in_call = 0
        self._connected_once = False
        self._sock: Optional[WireSocket] = None
        self._run_mode: Optional[int] = None
        self._supported: Optional[frozenset] = None
        self._supported_checked = False
        self._events: Optional[WireSocket] = None
        self.event_data: Any = None
        if connect:
            self.Connect()

    

    @property
    def address(self) -> str:
        return "%s:%d" % (self.host, self.port)

    def __repr__(self) -> str:
        state = "connected" if self._sock is not None else "not connected"
        return "<Enginuity %s %s>" % (self.address, state)

    def __enter__(self) -> "Enginuity":
        if self._sock is None:
            self.Connect()
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        self.Disconnect()

    def _launch(self) -> None:
        pass
        cmd = [str(self.app_path)] + self.app_args
        if not any(a.upper().startswith(("-PORT=", "/PORT=")) for a in self.app_args):
            cmd.append("-PORT=%d" % self.port)
        logger.info("Starting %s", " ".join(cmd))
        self._app = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)

    def _connect_raw(self) -> socket.socket:
        try:
            return socket.create_connection((self.host, self.port), timeout=self.connect_timeout)
        except ConnectionRefusedError:
            if not self.app_path or self._app is not None:
                raise
        self._launch()
        deadline = time.monotonic() + 60.0
        while True:
            try:
                return socket.create_connection((self.host, self.port), timeout=self.connect_timeout)
            except OSError:
                if time.monotonic() > deadline or (self._app is not None and self._app.poll() is not None):
                    raise
                time.sleep(0.25)

    def _open(self) -> WireSocket:
        try:
            raw = self._connect_raw()
        except socket.timeout as e:
            raise EnginuityConnectionError(
                "Enginuity did not answer on %s within %.0f s. Is Enginuity running? Start it (npm run dev or "
                "npm start in the Enginuity folder) or set ENGINUITY_HOST / ENGINUITY_API_PORT." % (self.address, self.connect_timeout)
            ) from e
        except OSError as e:
            raise EnginuityConnectionError(
                "Enginuity is not running on %s (%s). Start Enginuity (npm run dev or npm start in the Enginuity "
                "folder) and try again, or set ENGINUITY_HOST / ENGINUITY_API_PORT to the address of a running "
                "instance." % (self.address, e.strerror or e)
            ) from e
        raw.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        sock = WireSocket(raw, self.address)
        try:
            sock.settimeout(max(self.connect_timeout, 5.0))
            flags = [1.0 if self.safe_mode else 0.0, 0.0, 1.0 if self.skip_status else 0.0]
            sock.send(Encoder().line("RDK_API").array(flags).payload())
            welcome = sock.read_line()
            if welcome != "RDK_API":
                raise ProtocolError("%s is not an Enginuity API server (answered %r)" % (self.address, welcome[:40]))
            sock.read_int()
            self.BUILD = sock.read_int()
            status, message = sock.read_status()
            if status != 0:
                raise EnginuityConnectionError("Enginuity refused the connection: %s" % (message or status))
        except BaseException:
            sock.close()
            raise
        return sock

    def Connect(self) -> int:
        pass
        with self._lock:
            self._drop()
            self._sock = self._open()
            self._connected_once = True
            self._supported = None
            self._supported_checked = False
            logger.info("Connected to Enginuity at %s", self.address)
            if self._run_mode is not None:
                self._restore_run_mode()
        return 1

    def _restore_run_mode(self) -> None:
        mode = self._run_mode
        if mode is None:
            return
        with self._call("S_RunMode") as c:
            c.int(mode)
            c.ok()

    def _drop(self, reason: str = "") -> None:
        if self._sock is not None:
            if reason:
                logger.debug("Closing the connection to %s: %s", self.address, reason)
            self._sock.close()
            self._sock = None

    def _ensure(self) -> WireSocket:
        if self._sock is not None and self._sock.peer_closed():
            if not self.auto_reconnect:
                self._drop()
                raise EnginuityConnectionError("Enginuity at %s closed the connection" % self.address)
            logger.info("Enginuity closed the connection; reconnecting to %s", self.address)
            self._drop()
        if self._sock is None:
            if not self.auto_reconnect and self._connected_once:
                raise EnginuityConnectionError("Not connected to Enginuity (call Connect())")
            self._sock = self._open()
            self._connected_once = True
            self._supported = None
            self._supported_checked = False
            if self._run_mode is not None:
                self._sock.send(Encoder().line("S_RunMode").int(self._run_mode).payload())
                if not self.skip_status:
                    self._sock.settimeout(self.timeout)
                    status, message = self._sock.read_status()
                    self._raise_status("S_RunMode", status, message)
        return self._sock

    def _send(self, payload: bytes, name: str) -> WireSocket:
        pass
        logger.debug("-> %s", name)
        sock = self._ensure()
        try:
            sock.send(payload)
        except EnginuityConnectionError:
            if not self.auto_reconnect:
                self._drop()
                raise
            logger.info("Connection lost; reconnecting to %s", self.address)
            self._drop()
            sock = self._ensure()
            sock.send(payload)
        return sock

    def _call(self, name: str, timeout: Optional[float] = None) -> _CallContext:
        pass
        if name in _OPTIONAL_COMMANDS:
            self._require(name)
        return _CallContext(self, _Call(self, name, timeout if timeout is not None else self.timeout))

    def _raise_status(self, name: str, status: int, message: str) -> None:
        if status == 0:
            return
        if status == 2:
            _warn(message or "Warning from %s" % name)
            return
        raise error_for_status(status, message)

    def _supported_commands(self) -> Optional[frozenset]:
        pass
        if not self._supported_checked:
            self._supported_checked = True
            try:
                with self._call("SCMD") as c:
                    c.line("EnginuityApi").line("")
                    answer = c.r_line()
                    c.status()
                info = json.loads(answer) if answer.startswith("{") else None
                if isinstance(info, dict) and isinstance(info.get("commands"), list):
                    self._supported = frozenset(str(x) for x in info["commands"])
            except (ValueError, EnginuityError) as e:
                logger.debug("Could not read the server's command list: %s", e)
        return self._supported

    def _require(self, command: str, what: Optional[str] = None) -> None:
        supported = self._supported_commands()
        if supported is not None and command not in supported:
            raise NotSupportedError("%s is not available in this Enginuity (API command %s)" % (what or command, command))

    def Disconnect(self) -> None:
        pass
        with self._lock:
            if self.quit_on_close and self._app is not None and self._sock is not None:
                try:
                    with self._call("QUIT") as c:
                        c.ok()
                except EnginuityError:
                    pass
            self._drop()
        self.EventsClose()

    Finish = Disconnect
    close = Disconnect

    def _check_connection(self) -> None:
        self._ensure()

    

    def Version(self) -> str:
        pass
        with self._call("Version") as c:
            c.r_line()
            c.r_int()
            ver = c.r_line()
            c.r_line()
            c.status()
        return ver

    def VersionInfo(self) -> Dict[str, Any]:
        pass
        with self._call("Version") as c:
            info = {"product": c.r_line(), "bits": c.r_int(), "version": c.r_line(), "date": c.r_line()}
            c.status()
        return info

    def License(self) -> Tuple[str, str]:
        pass
        with self._call("G_License2") as c:
            out = (c.r_line(), c.r_line())
            c.status()
        return out

    def Command(self, cmd: str, value: Any = "", skip_result: bool = False, timeout: Optional[float] = None) -> Any:
        pass
        if isinstance(value, (Item, Mat)):
            
            
            with self._call("G_Gen_Mat", timeout if timeout is not None else self.long_timeout) as c:
                c.handle(value if isinstance(value, Item) else 0).line(cmd).matrix(value if isinstance(value, Mat) else Mat(0, 0))
                n = c.r_int()
                mats = [c.r_matrix() for _ in range(max(0, n))]
                c.status()
            return mats
        if isinstance(value, bool):
            text = "1" if value else "0"
        elif isinstance(value, (dict, list)):
            text = json.dumps(value)
        else:
            text = "" if value is None else str(value)
        if skip_result:
            with self._call("BlindSCMD") as c:
                c.line(cmd).line(text)
                c.flush()
                c.done = True
            return None
        with self._call("SCMD", timeout if timeout is not None else self.long_timeout) as c:
            c.line(cmd).line(text)
            answer = c.r_line()
            c.status()
        return _maybe_json(answer)

    def getParam(self, param: str = "PATH_OPENSTATION", str: bool = True) -> Any:  # noqa: A002 - robolink-compatible argument name
        pass
        if not str:
            with self._call("G_DataParam") as c:
                c.line(param)
                data = c.r_bytes()
                c.status()
            return data
        with self._call("G_Param") as c:
            c.line(param)
            value = c.r_line()
            status, message = c.flush().read_status()
            c.done = True
        if status == 2 and value.startswith("UNKNOWN "):
            _warn(message)
            return None
        self._raise_status("G_Param", status, message)
        return _param_value(value)

    def setParam(self, param: str, value: Any) -> None:
        pass
        if isinstance(value, (bytes, bytearray)):
            with self._call("S_DataParam") as c:
                c.line(param).bytes(bytes(value))
                c.ok()
            return
        text = json.dumps(value) if isinstance(value, (dict, list)) else str(value)
        with self._call("S_Param") as c:
            c.line(param).line(text)
            c.ok()

    def getParams(self) -> List[Tuple[str, Any]]:
        pass
        with self._call("G_Params") as c:
            n = c.r_int()
            out = [(c.r_line(), _param_value(c.r_line())) for _ in range(max(0, n))]
            c.status()
        return out

    def setRunMode(self, run_mode: int = RUNMODE_SIMULATE) -> None:
        pass
        with self._call("S_RunMode") as c:
            c.int(run_mode)
            c.ok()
        self._run_mode = int(run_mode)

    def RunMode(self) -> int:
        pass
        with self._call("G_RunMode") as c:
            v = c.r_int()
            c.status()
        self._run_mode = v
        return v

    def ProgramStart(self, programname: str, defaultfolder: str = "", postprocessor: str = "", robot: Optional[Item] = None) -> int:
        pass
        with self._call("ProgramStart") as c:
            c.line(programname).line(defaultfolder).line(postprocessor).handle(0).handle(robot)
            v = c.r_int()
            c.status()
        return v

    def Render(self, always_render: bool = False) -> None:
        pass
        with self._call("Render") as c:
            c.int(0 if always_render else 1)
            c.ok()

    def Update(self) -> None:
        pass
        with self._call("Refresh") as c:
            c.int(0)
            c.ok()

    def ShowMessage(self, message: str, popup: bool = True) -> None:
        pass
        name = "ShowMessage" if popup else "ShowMessageStatus"
        with self._call(name, self.long_timeout if popup else None) as c:
            c.line(message)
            c.ok()

    def setWindowState(self, windowstate: int = WINDOWSTATE_NORMAL) -> None:
        pass
        with self._call("S_WindowState") as c:
            c.int(windowstate)
            c.ok()

    def ShowEnginuity(self) -> None:
        pass
        with self._call("RAISE") as c:
            c.ok()

    def HideEnginuity(self) -> None:
        pass
        with self._call("HIDE") as c:
            c.ok()

    def CloseEnginuity(self) -> None:
        pass
        with self._call("QUIT") as c:
            c.ok()

    def setFlagsEnginuity(self, flags: int = FLAG_ENGINUITY_ALL) -> None:
        pass
        with self._call("S_App_Rights") as c:
            c.int(flags)
            c.ok()

    def setFlagsItem(self, item: Item, flags: int = FLAG_ITEM_ALL) -> None:
        pass
        with self._call("S_Item_Rights") as c:
            c.handle(item).int(flags)
            c.ok()

    def getFlagsItem(self, item: Item) -> int:
        pass
        with self._call("G_Item_Rights") as c:
            c.handle(item)
            v = c.r_int()
            c.status()
        return v

    def PluginLoad(self, pluginName: str = "", load: int = 1) -> str:
        pass
        with self._call("PluginLoad") as c:
            c.line(pluginName).int(load)
            c.ok()
        return ""

    def PluginCommand(self, pluginName: str, pluginCommand: str = "", pluginValue: Any = "") -> str:
        pass
        with self._call("PluginCommand", self.long_timeout) as c:
            c.line(pluginName).line(pluginCommand).line(str(pluginValue))
            v = c.r_line()
            c.status()
        return v

    def setInteractiveMode(self, mode_type: int = SELECT_MOVE, default_ref_flags: int = DISPLAY_REF_DEFAULT,
                           custom_objects: Optional[Sequence[Item]] = None, custom_ref_flags: Optional[Sequence[int]] = None) -> None:
        pass
        objs = list(custom_objects or [])
        flags = list(custom_ref_flags or [])
        if len(flags) < len(objs):
            flags += [default_ref_flags] * (len(objs) - len(flags))
        with self._call("S_InteractiveMode") as c:
            c.int(mode_type).int(default_ref_flags).int(len(objs))
            for o, f in zip(objs, flags):
                c.handle(o).int(f)
            c.ok()

    def ViewPose(self) -> Mat:
        pass
        with self._call("G_ViewPose") as c:
            p = c.r_pose()
            c.status()
        return p

    def setViewPose(self, pose: Any) -> None:
        pass
        with self._call("S_ViewPose") as c:
            c.pose(pose)
            c.ok()

    def SimulationSpeed(self) -> float:
        pass
        with self._call("GetSimulateSpeed") as c:
            v = c.r_int() / 1000.0
            c.status()
        return v

    def setSimulationSpeed(self, speed: float) -> None:
        pass
        with self._call("SimulateSpeed") as c:
            c.int(float(speed) * 1000)
            c.ok()

    def SimulationTime(self) -> float:
        pass
        with self._call("GetSimTime") as c:
            v = c.r_int() / 1000.0
            c.status()
        return v

    

    def AddStation(self, name: str = "New Station") -> Item:
        pass
        with self._call("NewStation") as c:
            c.line(name)
            it = c.r_item()
            c.status()
        return it

    def ActiveStation(self) -> Item:
        pass
        with self._call("G_ActiveStn") as c:
            it = c.r_item()
            c.status()
        return it

    def setActiveStation(self, stn: Item) -> None:
        pass
        with self._call("S_ActiveStn") as c:
            c.handle(stn)
            c.ok()

    def getOpenStations(self) -> List[Item]:
        pass
        with self._call("G_AllStn") as c:
            items = c.r_items()
            c.status()
        return items

    def CloseStation(self) -> None:
        pass
        with self._call("RemoveStn", self.long_timeout) as c:
            c.ok()

    def Save(self, filename: str, itemsave: Any = 0) -> None:
        pass
        with self._call("Save", self.long_timeout) as c:
            c.line(os.path.abspath(filename)).handle(itemsave)
            c.ok()

    

    def Item(self, name: str, itemtype: Optional[int] = None) -> Item:
        pass
        if itemtype is None or itemtype < 0:
            with self._call("G_Item") as c:
                c.line(name)
                it = c.r_item()
                c.status()
            return it
        with self._call("G_Item2") as c:
            c.line(name).int(itemtype)
            it = c.r_item()
            c.status()
        return it

    def ItemList(self, filter: Optional[int] = None, list_names: bool = False) -> List[Any]:  # noqa: A002 - robolink-compatible argument name
        pass
        if filter is None or filter < 0:
            name = "G_List_Items" if list_names else "G_List_Items_ptr"
        else:
            name = "G_List_Items_Type" if list_names else "G_List_Items_Type_ptr"
        with self._call(name) as c:
            if filter is not None and filter >= 0:
                c.int(filter)
            n = c.r_int()
            out = [c.r_line() if list_names else c.r_item() for _ in range(max(0, n))]
            c.status()
        return out

    def ItemUserPick(self, message: str = "Pick one item", itemtype_or_list: Any = None) -> Item:
        pass
        if isinstance(itemtype_or_list, (list, tuple)):
            with self._call("PickItemList", self.long_timeout) as c:
                c.line(message).int(len(itemtype_or_list))
                for it in itemtype_or_list:
                    c.handle(it)
                picked = c.r_item()
                c.status()
            return picked
        with self._call("PickItem", self.long_timeout) as c:
            c.line(message).int(-1 if itemtype_or_list is None else itemtype_or_list)
            picked = c.r_item()
            c.status()
        return picked

    def Selection(self) -> List[Item]:
        pass
        with self._call("G_Selection") as c:
            items = c.r_items()
            c.status()
        return items

    def setSelection(self, list_items: Optional[Sequence[Item]] = None) -> None:
        pass
        items = list(list_items or [])
        with self._call("S_Selection") as c:
            c.int(len(items))
            for it in items:
                c.handle(it)
            c.ok()

    def AddFile(self, filename: str, parent: Any = 0) -> Item:
        pass
        with self._call("Add", self.long_timeout) as c:
            c.line(os.path.abspath(filename)).handle(parent)
            it = c.r_item()
            c.status()
        return it

    def AddFrame(self, name: str, itemparent: Any = 0) -> Item:
        pass
        with self._call("Add_FRAME") as c:
            c.line(name).handle(itemparent)
            it = c.r_item()
            c.status()
        return it

    def AddTarget(self, name: str, itemparent: Any = 0, itemrobot: Any = 0) -> Item:
        pass
        with self._call("Add_TARGET") as c:
            c.line(name).handle(itemparent).handle(itemrobot)
            it = c.r_item()
            c.status()
        return it

    def AddProgram(self, name: str, itemrobot: Any = 0) -> Item:
        pass
        with self._call("Add_PROG") as c:
            c.line(name).handle(itemrobot)
            it = c.r_item()
            c.status()
        return it

    def AddMachiningProject(self, name: str = "Milling settings", itemrobot: Any = 0) -> Item:
        pass
        with self._call("Add_MACHINING") as c:
            c.line(name).handle(itemrobot)
            it = c.r_item()
            c.status()
        return it

    AddMillingProject = AddMachiningProject

    def Copy(self, item: Item, copy_children: bool = True, copy_childs: Optional[bool] = None) -> None:
        pass
        flag = copy_children if copy_childs is None else copy_childs
        with self._call("Copy2") as c:
            c.handle(item).int(1 if flag else 0)
            c.ok()

    def Paste(self, paste_to: Any = 0, paste_times: int = 1) -> Any:
        pass
        if paste_times > 1:
            with self._call("PastN") as c:
                c.handle(paste_to).int(paste_times)
                items = c.r_items()
                c.status()
            return items
        with self._call("Paste") as c:
            c.handle(paste_to)
            it = c.r_item()
            c.status()
        return it

    def Delete(self, item_list: Any) -> None:
        pass
        if isinstance(item_list, Item):
            item_list.Delete()
            return
        items = list(item_list)
        with self._call("RemoveLst") as c:
            c.int(len(items))
            for it in items:
                c.handle(it)
            c.ok()
        for it in items:
            if isinstance(it, Item):
                it.item = 0

    def MergeItems(self, list_items: Sequence[Item]) -> Item:
        pass
        items = list(list_items)
        with self._call("MergeItems", self.long_timeout) as c:
            c.int(len(items))
            for it in items:
                c.handle(it)
            out = c.r_item()
            c.status()
        return out

    def setPoses(self, items: Sequence[Item], poses: Sequence[Any]) -> None:
        pass
        self._set_poses("S_Hlocals", items, poses)

    def setPosesAbs(self, items: Sequence[Item], poses: Sequence[Any]) -> None:
        pass
        self._set_poses("S_Hlocal_AbsS", items, poses)

    def _set_poses(self, name: str, items: Sequence[Item], poses: Sequence[Any]) -> None:
        items, poses = list(items), list(poses)
        if len(items) != len(poses):
            raise InputError("setPoses: %d items and %d poses" % (len(items), len(poses)))
        with self._call(name) as c:
            c.int(len(items))
            for it, p in zip(items, poses):
                c.handle(it).pose(p)
            c.ok()

    def Joints(self, robot_item_list: Sequence[Item]) -> List[Mat]:
        pass
        items = list(robot_item_list)
        with self._call("G_ThetasList") as c:
            c.int(len(items))
            for it in items:
                c.handle(it)
            out = [_vec_mat(c.r_array()) for _ in items]
            c.status()
        return out

    def setJoints(self, robot_item_list: Sequence[Item], joints_list: Sequence[JointsLike]) -> None:
        pass
        items, joints = list(robot_item_list), list(joints_list)
        if len(items) != len(joints):
            raise InputError("setJoints: %d robots and %d joint vectors" % (len(items), len(joints)))
        with self._call("S_ThetasList") as c:
            c.int(len(items))
            for it, j in zip(items, joints):
                c.handle(it).array(_joints(j))
            c.ok()

    def setColor(self, item_list: Sequence[Item], color_list: Sequence[Any]) -> None:
        pass
        items, colors = list(item_list), list(color_list)
        if len(items) != len(colors):
            raise InputError("setColor: %d items and %d colors" % (len(items), len(colors)))
        if colors and all(isinstance(col, str) for col in colors):
            with self._call("S_ColorList") as c:
                c.int(len(items))
                for it, col in zip(items, colors):
                    c.handle(it).line(col)
                c.ok()
            return
        with self._call("S_ColorList2") as c:
            c.int(len(items))
            for it, col in zip(items, colors):
                c.handle(it).array(_color(col))
            c.ok()

    def setVisible(self, item_list: Sequence[Item], visible_list: Any, visible_frames: Any = None) -> None:
        pass
        items = list(item_list)
        vis = list(visible_list) if isinstance(visible_list, (list, tuple)) else [visible_list] * len(items)
        frames = list(visible_frames) if isinstance(visible_frames, (list, tuple)) else [visible_frames] * len(items)
        with self._call("S_VisibleList") as c:
            c.int(len(items))
            for it, v, f in zip(items, vis, frames):
                c.handle(it).int(1 if v else 0).int(_visible_frame(f))
            c.ok()

    def ShowAsCollided(self, item_list: Any, collided_list: Any = None, robot_link_id: Any = None) -> None:
        pass
        if isinstance(item_list, Item):
            with self._call("ShowAsCollided") as c:
                c.handle(item_list).int(0 if robot_link_id is None else robot_link_id).int(0 if collided_list is False else 1)
                c.ok()
            return
        items = list(item_list)
        collided = list(collided_list) if collided_list is not None else [True] * len(items)
        ids = list(robot_link_id) if robot_link_id is not None else [0] * len(items)
        with self._call("ShowAsCollidedList") as c:
            c.int(len(items))
            for it, cl, i in zip(items, collided, ids):
                c.handle(it).int(i).int(1 if cl else 0)
            c.ok()

    

    def SolveFK(self, robot_list: Sequence[Item], joints_list: Sequence[JointsLike]) -> List[Mat]:
        pass
        robots, joints = list(robot_list), list(joints_list)
        with self._call("G_LFK") as c:
            c.int(len(robots))
            for r, j in zip(robots, joints):
                c.array(_joints(j)).handle(r)
            out = []
            for _ in robots:
                out.append(c.r_pose())
                c.r_int()
            c.status()
        return out

    def SolveIK(self, robot_list: Sequence[Item], pose_list: Sequence[Any], japprox_list: Optional[Sequence[JointsLike]] = None) -> List[Mat]:
        pass
        robots, poses = list(robot_list), list(pose_list)
        if japprox_list is None:
            with self._call("G_LIK") as c:
                c.int(len(robots))
                for r, p in zip(robots, poses):
                    c.pose(p).handle(r)
                out = [_vec_mat(c.r_array()) for _ in robots]
                c.status()
            return out
        approx = list(japprox_list)
        with self._call("G_LIK_jnts") as c:
            c.int(len(robots))
            for r, p, j in zip(robots, poses, approx):
                c.pose(p).array(_joints(j)).handle(r)
            out = [_vec_mat(c.r_array()) for _ in robots]
            c.status()
        return out

    def SolveIK_All(self, robot_list: Sequence[Item], pose_list: Sequence[Any]) -> List[Mat]:
        pass
        robots, poses = list(robot_list), list(pose_list)
        with self._call("G_LIK_cmpl", self.long_timeout) as c:
            c.int(len(robots))
            for r, p in zip(robots, poses):
                c.pose(p).handle(r)
            out = [c.r_matrix() for _ in robots]
            c.status()
        return out

    def JointsConfig(self, robot_list: Sequence[Item], joints_list: Sequence[JointsLike]) -> List[Mat]:
        pass
        robots, joints = list(robot_list), list(joints_list)
        with self._call("G_LThetas_Config") as c:
            c.int(len(robots))
            for r, j in zip(robots, joints):
                c.array(_joints(j)).handle(r)
            out = [_vec_mat(c.r_array()) for _ in robots]
            c.status()
        return out

    def FilterTargets(self, robot: Item, pose_list: Sequence[Any], japprox_list: Optional[Sequence[JointsLike]] = None) -> List[Tuple[Mat, Mat]]:
        pass
        if not isinstance(robot, Item) or not robot.Valid(True):
            raise InputError("FilterTargets needs a valid robot")
        poses = list(pose_list)
        approx = list(japprox_list) if japprox_list is not None else None
        with self._call("FilterListTarget") as c:
            c.handle(robot).int(1 if approx is not None else 0).int(len(poses))
            for i, p in enumerate(poses):
                c.pose(p)
                if approx is not None:
                    c.array(_joints(approx[i]))
            n = c.r_int()
            out = []
            for _ in range(max(0, n)):
                flag = c.r_int()
                if flag < 0:
                    break
                out.append((c.r_pose(), _vec_mat(c.r_array())))
            c.status()
        return out

    

    def Collisions(self) -> int:
        pass
        with self._call("Collisions", self.long_timeout) as c:
            v = c.r_int()
            c.status()
        return v

    def Collision(self, item1: Item, item2: Item, useCollisionMap: bool = True) -> int:
        pass
        if useCollisionMap:
            with self._call("Collided", self.long_timeout) as c:
                c.handle(item1).handle(item2)
                v = c.r_int()
                c.status()
            return v
        with self._call("Collided3", self.long_timeout) as c:
            c.handle(item1).handle(item2).int(1)
            v = c.r_int()
            c.status()
        return v

    def setCollisionActive(self, check_state: int = COLLISION_ON) -> int:
        pass
        with self._call("Collision_SetState", self.long_timeout) as c:
            c.int(check_state)
            v = c.r_int()
            c.status()
        return v

    def setCollisionActivePair(self, check_state: int, item1: Item, item2: Item, id1: int = 0, id2: int = 0) -> int:
        pass
        with self._call("Collision_SetPair") as c:
            c.handle(item1).handle(item2).int(id1).int(id2).int(check_state)
            v = c.r_int()
            c.status()
        return v

    def setCollisionActivePairList(self, list_check_state: Sequence[int], list_item1: Sequence[Item], list_item2: Sequence[Item],
                                   list_id1: Optional[Sequence[int]] = None, list_id2: Optional[Sequence[int]] = None) -> int:
        pass
        n = len(list_item1)
        ids1 = list(list_id1) if list_id1 is not None else [0] * n
        ids2 = list(list_id2) if list_id2 is not None else [0] * n
        states = list(list_check_state)
        with self._call("Collision_SetPairList") as c:
            c.int(n)
            for i in range(n):
                c.handle(list_item1[i]).handle(list_item2[i]).int(ids1[i]).int(ids2[i]).int(states[i])
            v = c.r_int()
            c.status()
        return v

    def CollisionActivePairList(self, list_names: bool = False) -> List[Any]:
        pass
        with self._call("Collision_GetPairList") as c:
            n = c.r_int()
            pairs = []
            for _ in range(max(0, n)):
                a = c.r_item()
                ia = c.r_int()
                b = c.r_item()
                ib = c.r_int()
                pairs.append([a, b, ia, ib])
            c.status()
        if list_names:
            return [[p[0].Name(), p[1].Name(), p[2], p[3]] for p in pairs]
        return pairs

    def CollisionPairs(self) -> List[List[Any]]:
        pass
        with self._call("Collision_Pairs", self.long_timeout) as c:
            n = c.r_int()
            out = []
            for _ in range(max(0, n)):
                a = c.r_item()
                ia = c.r_int()
                b = c.r_item()
                ib = c.r_int()
                out.append([a, b, ia, ib])
            c.status()
        return out

    def CollisionItems(self) -> List[Item]:
        pass
        with self._call("Collision_Items", self.long_timeout) as c:
            n = c.r_int()
            out = []
            for _ in range(max(0, n)):
                out.append(c.r_item())
                c.r_int()
                c.r_int()
            c.status()
        return out

    def Collision_Line(self, p1: Sequence[float], p2: Sequence[float], ref: Any = None) -> Tuple[bool, Item, List[float]]:
        pass
        a, b = list(p1)[:3], list(p2)[:3]
        if ref is not None:
            r = _pose(ref)
            a, b = r * a, r * b
        with self._call("CollisionLine", self.long_timeout) as c:
            c.xyz(a).xyz(b)
            it = c.r_item()
            xyz = c.r_xyz()
            c.status()
        return it.Valid(), it, xyz

    def Collision_Lines(self, p1_list: Sequence[Sequence[float]], p2_list: Sequence[Sequence[float]]) -> Tuple[Item, Mat]:
        pass
        n = len(p1_list)
        with self._call("CollisionLineLst", self.long_timeout) as c:
            c.int(n)
            for a, b in zip(p1_list, p2_list):
                c.xyz(a).xyz(b)
            it = c.r_item()
            m = c.r_matrix()
            c.status()
        return it, m

    

    def AddCurve(self, curve_points: Any, reference_object: Any = 0, add_to_ref: bool = False,
                 projection_type: int = PROJECTION_ALONG_NORMAL_RECALC) -> Item:
        pass
        if isinstance(curve_points, (list, tuple)) and curve_points and isinstance(curve_points[0], Mat):
            with self._call("AddWir2", self.long_timeout) as c:
                c.handle(reference_object).int(1 if add_to_ref else 0).int(projection_type).int(len(curve_points))
                for m in curve_points:
                    c.matrix(_points_matrix(m))
                it = c.r_item()
                c.status()
            return it
        with self._call("AddWire", self.long_timeout) as c:
            c.matrix(_points_matrix(curve_points)).handle(reference_object).int(1 if add_to_ref else 0).int(projection_type)
            it = c.r_item()
            c.status()
        return it

    def AddPoints(self, points: Any, reference_object: Any = 0, add_to_ref: bool = False,
                  projection_type: int = PROJECTION_ALONG_NORMAL_RECALC) -> Item:
        pass
        with self._call("AddPoints", self.long_timeout) as c:
            c.matrix(_points_matrix(points)).handle(reference_object).int(1 if add_to_ref else 0).int(projection_type)
            it = c.r_item()
            c.status()
        return it

    def ProjectPoints(self, points: Any, object_project: Item, projection_type: int = PROJECTION_ALONG_NORMAL_RECALC) -> Mat:
        pass
        with self._call("ProjectPoints", self.long_timeout) as c:
            c.matrix(_points_matrix(points)).handle(object_project).int(projection_type)
            m = c.r_matrix()
            c.status()
        return m

    def AddShape(self, triangle_points: Any, add_to: Any = 0, override_shapes: bool = False, color: Any = None) -> Item:
        pass
        if isinstance(triangle_points, (list, tuple)) and triangle_points and isinstance(triangle_points[0], Mat):
            shapes = list(triangle_points)
            colors = list(color) if isinstance(color, (list, tuple)) and color and isinstance(color[0], (list, tuple)) else [color] * len(shapes)
            mats = [_points_matrix(m) for m in shapes]
            
            fast = sum(m.ColsCount() for m in mats) > 30000
            with self._call("AddShape5" if fast else "AddShape4", self.long_timeout) as c:
                c.handle(add_to).int(1 if override_shapes else 0).int(len(mats))
                for m, col in zip(mats, colors):
                    if fast:
                        c.matrix_f(m).array_f(_color(col) if col is not None else [])
                    else:
                        c.matrix(m).array(_color(col) if col is not None else [])
                it = c.r_item()
                c.status()
            return it
        pts = _points_matrix(triangle_points)
        if color is None:
            with self._call("AddShape2", self.long_timeout) as c:
                c.matrix(pts).handle(add_to).int(1 if override_shapes else 0)
                it = c.r_item()
                c.status()
            return it
        with self._call("AddShape3", self.long_timeout) as c:
            c.matrix(pts).handle(add_to).int(1 if override_shapes else 0).array(_color(color))
            it = c.r_item()
            c.status()
        return it

    

    def RunProgram(self, fcn_param: str, wait_for_finished: bool = False) -> int:
        pass
        prog_status = self.RunCode(fcn_param, True)
        if wait_for_finished:
            prog = self.Item(fcn_param.split("(")[0], ITEM_TYPE_PROGRAM)
            if prog.Valid():
                prog.WaitFinished()
        return prog_status

    def RunCode(self, code: str, code_is_fcn_call: bool = False) -> int:
        pass
        with self._call("RunCode") as c:
            c.int(1 if code_is_fcn_call else 0).line(code)
            v = c.r_int()
            c.status()
        return v

    def RunMessage(self, message: str, message_is_comment: bool = False) -> None:
        pass
        with self._call("RunMessage") as c:
            c.int(1 if message_is_comment else 0).line(message)
            c.ok()

    

    def CalibrateTool(self, poses_xyzwpr: Any, input_format: int = EULER_RX_RY_RZ, algorithm: int = CALIBRATE_TCP_BY_POINT,
                      robot: Optional[Item] = None, tool: Optional[Item] = None) -> Tuple[List[float], List[float], Mat]:
        pass
        m = _matrix(poses_xyzwpr)
        if m.ColsCount() >= 6 and m.RowsCount() > m.ColsCount() or (input_format == JOINT_FORMAT and m.RowsCount() > 12):
            m = m.tr()
        with self._call("CalibTCP3", self.long_timeout) as c:
            c.matrix(m).int(input_format).array([algorithm]).handle(robot).handle(tool)
            tcp = c.r_array()
            stats = c.r_array()
            errors = c.r_matrix()
            c.status()
        return tcp, stats, errors

    def CalibrateReference(self, joints_points: Any, method: int = CALIBRATE_FRAME_3P_P1_ON_X, use_joints: bool = False,
                           robot: Optional[Item] = None) -> Mat:
        pass
        with self._call("CalibFrame", self.long_timeout) as c:
            c.matrix(_matrix(joints_points)).int(1 if use_joints else 0).int(method).handle(robot)
            pose = c.r_pose()
            c.r_array()
            c.status()
        return pose

    def BuildMechanism(self, type: int, list_obj: Sequence[Item], parameters: Sequence[float], joints_build: Sequence[float],  # noqa: A002
                       joints_home: Sequence[float], joints_senses: Sequence[float], joints_lim_low: Sequence[float],
                       joints_lim_high: Sequence[float], base: Any = None, tool: Any = None, name: str = "New robot",
                       robot: Optional[Item] = None) -> Item:
        pass
        objs = list(list_obj)
        ndofs = max(1, len(objs) - 1)
        cols = [list(joints_build), list(joints_home), list(joints_senses), list(joints_lim_low), list(joints_lim_high)]
        rows = max(len(col) for col in cols)
        jm = Mat(rows, 5)
        for j, col in enumerate(cols):
            for i, v in enumerate(col):
                jm.rows[i][j] = float(v)
        with self._call("BuildMechanism", self.long_timeout) as c:
            c.handle(robot).line(name).int(type).int(ndofs)
            for i in range(ndofs + 1):
                c.handle(objs[i] if i < len(objs) else 0)
            c.pose(base if base is not None else eye()).pose(tool if tool is not None else eye()).array(list(parameters)).matrix(jm)
            it = c.r_item()
            c.status()
        return it

    def Cam2D_Add(self, item_object: Any, cam_params: str = "", cam_item: Optional[Item] = None) -> Item:
        pass
        with self._call("Cam2D_PtrAdd") as c:
            c.handle(item_object).handle(cam_item).line(cam_params)
            it = c.r_item()
            c.status()
        return it

    def Cam2D_Snapshot(self, file_save_img: str = "", cam_handle: Any = 0, params: str = "") -> Any:
        pass
        with self._call("Cam2D_PtrSnapshot", self.long_timeout) as c:
            c.handle(cam_handle).line(os.path.abspath(file_save_img) if file_save_img else "").line(params)
            out: Any = c.r_int() > 0 if file_save_img else c.r_bytes()
            c.status()
        return out

    def Cam2D_Close(self, cam_handle: Any = 0) -> bool:
        pass
        if not _handle_of(cam_handle):
            with self._call("Cam2D_CloseAll") as c:
                v = c.r_int()
                c.status()
            return v > 0
        with self._call("Cam2D_PtrClose") as c:
            c.handle(cam_handle)
            v = c.r_int()
            c.status()
        return v > 0

    def Cam2D_SetParams(self, params: str, cam_handle: Any = 0) -> bool:
        pass
        with self._call("Cam2D_PtrSetParams") as c:
            c.handle(cam_handle).line(params)
            v = c.r_int()
            c.status()
        return v > 0

    def Popup_ISO9283_CubeProgram(self, robot: Any = 0) -> Item:
        pass
        with self._call("Popup_ProgISO9283", self.long_timeout) as c:
            c.handle(robot)
            it = c.r_item()
            c.status()
        return it

    def Spray_Add(self, item_tool: Any = 0, item_object: Any = 0, params: str = "", points: Any = None, geometry: Any = None) -> int:
        pass
        with self._call("Gun_Add", self.long_timeout) as c:
            c.handle(item_tool).handle(item_object).line(params)
            c.matrix(_matrix(points) if points is not None else Mat(0, 0))
            c.matrix(_matrix(geometry) if geometry is not None else Mat(0, 0))
            v = c.r_int()
            c.status()
        return v

    def Spray_SetState(self, state: int = SPRAY_ON, id_spray: Any = -1) -> int:
        pass
        with self._call("Gun_SetState") as c:
            c.int(_to_int(id_spray, -1)).int(state)
            v = c.r_int()
            c.status()
        return v

    def Spray_GetStats(self, id_spray: Any = -1) -> Tuple[str, Mat]:
        pass
        with self._call("Gun_Stats", self.long_timeout) as c:
            c.int(_to_int(id_spray, -1))
            info = c.r_line()
            data = c.r_matrix()
            c.status()
        return info, data

    def Spray_Clear(self, id_spray: Any = -1) -> int:
        pass
        with self._call("Gun_Clear") as c:
            c.int(_to_int(id_spray, -1))
            v = c.r_int()
            c.status()
        return v

    def LaserTracker_Measure(self, estimate: Sequence[float] = (0, 0, 0), search: bool = False) -> List[float]:
        pass
        with self._call("MeasLT2", self.long_timeout) as c:
            c.xyz(estimate).int(1 if search else 0)
            v = c.r_array()
            c.status()
        return v

    def MeasurePose(self, target: int = -1, time_avg_ms: float = 0, tip_xyz: Optional[Sequence[float]] = None) -> Tuple[Mat, List[float]]:
        pass
        with self._call("MeasPose4", self.long_timeout) as c:
            c.array([target, time_avg_ms] + list(tip_xyz or []))
            pose = c.r_pose()
            data = c.r_array()
            c.status()
        return pose, data

    def ShowDialog(self, message: str, buttons: Sequence[str] = ("OK",), title: str = "", entry: Optional[str] = None) -> Tuple[str, str]:
        pass
        btns = [str(b) for b in buttons] or ["OK"]
        with self._call("MB_Dialog", self.long_timeout) as c:
            c.line(title).line(message).int(len(btns))
            for b in btns:
                c.line(b)
            c.int(0 if entry is None else 1).line("" if entry is None else entry)
            button = c.r_line()
            text = c.r_line()
            c.status()
        return button, text

    

    def EventsListen(self, filter: Optional[Sequence[int]] = None) -> bool:  # noqa: A002
        pass
        self.EventsClose()
        sock = self._open_events(filter)
        self._events = sock
        return True

    def _open_events(self, filter: Optional[Sequence[int]]) -> WireSocket:  # noqa: A002
        try:
            raw = socket.create_connection((self.host, self.port), timeout=self.connect_timeout)
        except OSError as e:
            raise EnginuityConnectionError("Enginuity is not running on %s (%s)" % (self.address, e)) from e
        sock = WireSocket(raw, self.address)
        enc = Encoder()
        if filter:
            enc.line("RDK_EVT_FILTER").int(len(filter))
            for f in filter:
                enc.int(f)
        else:
            enc.line("RDK_EVT")
        enc.int(0)
        sock.settimeout(max(self.connect_timeout, 5.0))
        sock.send(enc.payload())
        if sock.read_line() != "RDK_EVT":
            sock.close()
            raise ProtocolError("Unexpected answer to the event channel request")
        sock.read_int()
        status, message = sock.read_status()
        if status != 0:
            sock.close()
            raise error_for_status(status, message)
        return sock

    def WaitForEvent(self, timeout: Optional[float] = None) -> Event:
        pass
        if self._events is None:
            self.EventsListen()
        sock = self._events
        assert sock is not None
        sock.settimeout(timeout)
        evt = sock.read_int()
        h, t = sock.read_item_ref()
        item = Item(self, h, t)
        data: Any = None
        if evt == EVENT_ITEM_RENAMED:
            data = sock.read_line()
        elif evt == EVENT_ITEM_VISIBILITY:
            data = sock.read_array()
        elif evt == EVENT_ITEM_MOVED_POSE:
            n = sock.read_int()
            data = sock.read_pose() if n == 16 else sock.read_doubles(n)
        elif evt == EVENT_KEY:
            data = [sock.read_int(), sock.read_int(), sock.read_int()]
        elif evt == EVENT_SELECTION_3D_CHANGED:
            data = sock.read_array()
        self.event_data = data
        return Event(evt, item, data)

    def EventsLoop(self, callback: Optional[Callable[[Event], Any]] = None) -> None:
        pass
        if self._events is None:
            self.EventsListen()
        try:
            while True:
                e = self.WaitForEvent(None)
                if callback is not None:
                    if callback(e) is False:
                        break
                else:
                    print("Event: %d item: %r data: %r" % (e.evt, e.item, e.data))
        except EnginuityConnectionError:
            pass
        finally:
            self.EventsClose()

    def EventsClose(self) -> None:
        pass
        if self._events is not None:
            self._events.close()
            self._events = None

    

    def NewLink(self) -> "Enginuity":
        pass
        return Enginuity(host=self.host, port=self.port, timeout=self.timeout, long_timeout=self.long_timeout,
                          connect_timeout=self.connect_timeout, auto_reconnect=self.auto_reconnect, safe_mode=self.safe_mode)



Robolink = Enginuity





def EmbedWindow(window_name: str, docked_name: Optional[str] = None, size_w: int = -1, size_h: int = -1, pid: int = 0,
                area_add: int = 1, area_allowed: int = 15, timeout: int = 500, port: Optional[int] = None, args: Any = None) -> bool:
    pass
    rdk = Enginuity(port=port)
    try:
        with rdk._call("WinProcDock") as c:
            c.line(window_name).line(docked_name or window_name).array([size_w, size_h]).line(str(pid)).int(area_add).int(area_allowed).int(timeout)
            v = c.r_int()
            c.status()
        return v > 0
    finally:
        rdk.Disconnect()


def import_install(module_name: str, pip_name: Optional[str] = None, rdk: Any = None, upgrade_pip: Any = None) -> None:
    pass
    import importlib
    import sys

    try:
        importlib.import_module(module_name)
    except ImportError as e:
        in_venv = sys.prefix != getattr(sys, "base_prefix", sys.prefix)  
        raise ImportError(
            "The Python package %r is not installed for this interpreter. Install it with: %s -m pip install %s%s"
            % (module_name, sys.executable or "python3", "" if in_venv else "--user ", pip_name or module_name)
        ) from e


def getPathEnginuity() -> str:
    pass
    return ""


def getPathIcon() -> str:
    pass
    return ""



from .robomath import *  # noqa: E402,F401,F403 - re-exported for `from robolink import *` style scripts

__all__ += [n for n in robomath.__all__ if n not in __all__]
__all__ += [n for n in list(globals()) if n.isupper() and not n.startswith("_") and n not in __all__ and n != "DEFAULT_PORT"]
__all__ += ["Event"]
