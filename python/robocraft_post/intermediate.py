# Parses restricted intermediate Python and dispatches robot instructions to registered posts.

















from __future__ import annotations

import ast
import base64
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from . import robomath
from .base import REGISTRY, PostError, get_post

INSTRUCTIONS = frozenset(
    {
        "ProgStart",
        "ProgFinish",
        "ProgSave",
        "ProgSendRobot",
        "MoveJ",
        "MoveL",
        "MoveC",
        "setFrame",
        "setTool",
        "Pause",
        "setSpeed",
        "setAcceleration",
        "setSpeedJoints",
        "setAccelerationJoints",
        "setZoneData",
        "setDO",
        "setAO",
        "waitDI",
        "RunCode",
        "RunMessage",
    }
)
ATTRIBUTES = frozenset({"_TargetName", "_TargetNameVia"})


class IntermediateError(ValueError):
    pass


@dataclass
class CallStream:
    post: str = ""
    args: List[Any] = field(default_factory=list)
    kwargs: Dict[str, Any] = field(default_factory=dict)
    
    steps: List[Tuple[str, str, Any]] = field(default_factory=list)
    total_instructions: Optional[int] = None
    
    raised: Optional[str] = None


def _literal(node: ast.AST) -> Any:
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
        v = _literal(node.operand)
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return -v if isinstance(node.op, ast.USub) else +v
        raise IntermediateError("unsupported unary operand")
    if isinstance(node, (ast.List, ast.Tuple)):
        values = [_literal(e) for e in node.elts]
        return values if isinstance(node, ast.List) else tuple(values)
    if isinstance(node, ast.Call) and not node.keywords:
        f = node.func
        if isinstance(f, ast.Name) and f.id == "p":
            nums = [_literal(a) for a in node.args]
            if len(nums) != 6 or not all(isinstance(n, (int, float)) and not isinstance(n, bool) for n in nums):
                raise IntermediateError("p() takes 6 numbers")
            return robomath.p(*nums)
        if (
            isinstance(f, ast.Attribute)
            and f.attr == "b64decode"
            and isinstance(f.value, ast.Name)
            and f.value.id == "base64"
            and len(node.args) == 1
        ):
            raw = _literal(node.args[0])
            if not isinstance(raw, (bytes, str)):
                raise IntermediateError("b64decode takes bytes")
            return base64.b64decode(raw)
    raise IntermediateError("unsupported expression: %s" % ast.dump(node)[:80])


def _is_r(node: ast.AST) -> bool:
    return isinstance(node, ast.Name) and node.id == "r"


def parse(source: str) -> CallStream:
    pass
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        raise IntermediateError("invalid intermediate file: %s" % exc) from exc
    out = CallStream()
    
    
    variables: Dict[str, Any] = {}
    for stmt in tree.body:
        if isinstance(stmt, (ast.Import, ast.ImportFrom, ast.Try)):
            continue  
        if isinstance(stmt, ast.Raise):
            exc = stmt.exc
            if isinstance(exc, ast.Call) and isinstance(exc.func, ast.Name) and exc.func.id == "Exception" and exc.args:
                out.raised = str(_literal(exc.args[0]))
                continue
            raise IntermediateError("unsupported raise statement")
        if isinstance(stmt, ast.Assign) and len(stmt.targets) == 1:
            target = stmt.targets[0]
            if _is_r(target):
                call = stmt.value
                if not (isinstance(call, ast.Call) and isinstance(call.func, ast.Name) and call.func.id == "RobotPost"):
                    raise IntermediateError("r must be a RobotPost(...)")
                args = [_literal(a) for a in call.args]
                kwargs = {
                    k.arg: (variables[k.value.id] if isinstance(k.value, ast.Name) and k.value.id in variables else _literal(k.value))
                    for k in call.keywords
                    if k.arg
                }
                out.post = str(args[0]) if args else ""
                out.args = args[1:]
                out.kwargs = kwargs
                continue
            if isinstance(target, ast.Name) and target.id.lower().startswith("post_") and isinstance(stmt.value, ast.Call):
                value = _literal(stmt.value)
                if not isinstance(value, bytes):
                    raise IntermediateError("post parameters are base64.b64decode(...) values")
                variables[target.id] = value
                continue
            if isinstance(target, ast.Attribute) and _is_r(target.value) and target.attr in ATTRIBUTES:
                out.steps.append(("set", target.attr, _literal(stmt.value)))
                continue
            raise IntermediateError("unsupported assignment")
        if isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Call):
            call = stmt.value
            f = call.func
            if isinstance(f, ast.Attribute) and _is_r(f.value):
                if f.attr not in INSTRUCTIONS:
                    raise IntermediateError("unsupported instruction r.%s" % f.attr)
                if call.keywords:
                    raise IntermediateError("keyword arguments are not used by r.%s" % f.attr)
                out.steps.append(("call", f.attr, [_literal(a) for a in call.args]))
                continue
            if isinstance(f, ast.Name) and f.id == "print" and len(call.args) == 1:
                text = _literal(call.args[0])
                if isinstance(text, str) and text.startswith("Total instructions:"):
                    try:
                        out.total_instructions = int(text.split(":", 1)[1])
                    except ValueError:
                        pass
                continue
            if isinstance(f, ast.Attribute) and f.attr == "append":
                continue  
        raise IntermediateError("unsupported statement on line %d" % getattr(stmt, "lineno", 0))
    return out


@dataclass
class RunResult:
    ok: bool
    post: str
    files: List[Tuple[str, Any]]
    stdout: List[str]
    error: Optional[str] = None
    total_instructions: Optional[int] = None


def missing_post_message(post: str, robot: str) -> str:
    
    return "Select a Post Processor for the robot %s (post processor %s was not found)" % (robot, post)


def run(source: str, post_override: Optional[str] = None, post_class: Optional[type] = None, kinematics: Optional[list] = None) -> RunResult:
    pass
    stream = parse(source)
    post = post_override or stream.post
    if stream.raised is not None:
        return RunResult(False, post, [], [], "Exception: %s" % stream.raised, stream.total_instructions)
    cls = post_class or get_post(post)
    robot = str(stream.args[0]) if stream.args else ""
    if cls is None:
        return RunResult(False, post, [], [], missing_post_message(post, robot), stream.total_instructions)
    key = post[:-3] if post.lower().endswith(".py") else post
    if post_class is None and key not in REGISTRY:
        
        
        
        
        return RunResult(False, post, [], [], "ModuleNotFoundError: No module named '%s'" % key, stream.total_instructions)
    r = cls(post, *stream.args, **stream.kwargs)
    for k in kinematics or ():
        r.KINEMATICS.append(([float(v) for v in k["joints"]], [[float(v) for v in row] for row in k["pose"]], [float(v) for v in k.get("config") or []]))
    stdout: List[str] = []
    if stream.total_instructions is not None:
        stdout.append("Total instructions: %d" % stream.total_instructions)
    try:
        for kind, name, value in stream.steps:
            if kind == "set":
                setattr(r, name, value)
            else:
                getattr(r, name)(*value)
    except PostError as exc:
        return RunResult(False, post, list(r.files), stdout + r.stdout + [str(exc)], str(exc), stream.total_instructions)
    except Exception as exc:  
        return RunResult(False, post, list(r.files), stdout + r.stdout, "%s: %s" % (type(exc).__name__, exc), stream.total_instructions)
    return RunResult(True, post, list(r.files), stdout + r.stdout, None, stream.total_instructions)
