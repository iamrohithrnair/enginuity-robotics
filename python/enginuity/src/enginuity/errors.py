# Maps protocol status codes to typed Enginuity client exceptions.





















from __future__ import annotations

from typing import Optional

__all__ = [
    "EnginuityError",
    "EnginuityConnectionError",
    "EnginuityTimeoutError",
    "ProtocolError",
    "InvalidItemError",
    "InputError",
    "TargetReachError",
    "StoppedError",
    "LicenseError",
    "NotSupportedError",
    "error_for_status",
]


class EnginuityError(Exception):
    pass

    def __init__(self, message: str = "", status: Optional[int] = None) -> None:
        super().__init__(message)
        self.status = status


class EnginuityConnectionError(EnginuityError, ConnectionError):
    pass


class EnginuityTimeoutError(EnginuityConnectionError, TimeoutError):
    pass


class ProtocolError(EnginuityError):
    pass


class InvalidItemError(EnginuityError):
    pass


class InputError(EnginuityError):
    pass


class TargetReachError(EnginuityError):
    pass


class StoppedError(EnginuityError):
    pass


class LicenseError(EnginuityError):
    pass


class NotSupportedError(EnginuityError):
    pass


def error_for_status(status: int, message: str = "") -> EnginuityError:
    pass
    if status == 1:
        return InvalidItemError(message or "Invalid item provided: The item identifier provided is not valid or it does not exist.", status)
    if status in (9, 13):
        return LicenseError(message or "This feature is not available.", status)
    if status == 10:
        return TargetReachError(message or "Target cannot be reached.", status)
    if status == 11:
        return StoppedError(message or "Stopped.", status)
    if status == 12:
        return InputError(message or "Invalid input.", status)
    return EnginuityError(message or "The API command failed (status %d)." % status, status)
