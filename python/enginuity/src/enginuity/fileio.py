

from __future__ import annotations

import csv
import datetime
import os
import re
from typing import Any, List, Optional, Sequence, Union

from .robomath import Mat

__all__ = [
    "UploadFTP",
    "LoadList",
    "SaveList",
    "LoadMat",
    "SaveMat",
    "getFileDir",
    "getBaseName",
    "getFileName",
    "getFileExtension",
    "RemoveFileExtension",
    "DateModified",
    "DateCreated",
    "DirExists",
    "FileExists",
    "FilterName",
]


def _number(text: str) -> Union[float, str]:
    t = text.strip()
    try:
        return float(t)
    except ValueError:
        return t


def LoadList(strfile: str, separator: str = ",", codec: str = "utf-8") -> List[List[Union[float, str]]]:
    pass
    rows: List[List[Union[float, str]]] = []
    with open(strfile, "r", encoding=codec, newline="") as fh:
        for row in csv.reader(fh, delimiter=separator):
            if not row or all(not c.strip() for c in row):
                continue
            rows.append([_number(c) for c in row])
    return rows


def SaveList(list_variable: Sequence[Any], strfile: str, separator: str = ",") -> None:
    pass
    with open(strfile, "w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh, delimiter=separator, lineterminator="\n")
        for row in list_variable:
            if isinstance(row, (list, tuple)):
                w.writerow(row)
            elif isinstance(row, Mat):
                w.writerow(row.tolist())
            else:
                w.writerow([row])


def LoadMat(strfile: str, separator: str = ",") -> Mat:
    pass
    rows = LoadList(strfile, separator)
    numeric = [[float(v) for v in r if not isinstance(v, str) or v == ""] for r in rows]
    width = max((len(r) for r in numeric), default=0)
    return Mat([r + [0.0] * (width - len(r)) for r in numeric]) if numeric else Mat()


def SaveMat(mat_variable: Any, strfile: str, separator: str = ",") -> None:
    pass
    m = mat_variable if isinstance(mat_variable, Mat) else Mat(mat_variable)
    m.save(strfile, separator)


def getFileDir(filepath: str) -> str:
    pass
    return os.path.dirname(filepath)


def getBaseName(filepath: str) -> str:
    pass
    return os.path.basename(filepath)


def getFileName(filepath: str) -> str:
    pass
    return os.path.splitext(os.path.basename(filepath))[0]


def getFileExtension(filepath: str) -> str:
    pass
    return os.path.splitext(filepath)[1].lstrip(".")


def RemoveFileExtension(filepath: str) -> str:
    pass
    return os.path.splitext(filepath)[0]


def _date(ts: float, stringformat: bool) -> Union[datetime.datetime, str]:
    d = datetime.datetime.fromtimestamp(ts)
    return d.strftime("%Y-%m-%d %H:%M:%S") if stringformat else d


def DateModified(filepath: str, stringformat: bool = False) -> Union[datetime.datetime, str]:
    pass
    return _date(os.path.getmtime(filepath), stringformat)


def DateCreated(filepath: str, stringformat: bool = False) -> Union[datetime.datetime, str]:
    pass
    st = os.stat(filepath)
    ts = getattr(st, "st_birthtime", None) or st.st_ctime
    return _date(ts, stringformat)


def DirExists(folder: str) -> bool:
    pass
    return os.path.isdir(folder)


def FileExists(file: str) -> bool:
    pass
    return os.path.isfile(file)


def FilterName(namefilter: str, safechar: str = "P", reserved_names: Optional[Sequence[str]] = None, max_len: int = -1, invalid_chars: Optional[str] = None) -> str:
    pass
    
    
    
    
    if invalid_chars:
        namefilter = "".join(ch for ch in str(namefilter) if ch not in invalid_chars)
    name = re.sub(r"[^A-Za-z0-9_()]", "", str(namefilter))
    if not name or name[0].isdigit():
        name = safechar + name
    if max_len is not None and max_len > 0:
        name = name[:max_len]  
    if reserved_names:
        taken = {n.lower() for n in reserved_names}
        base, i = name, 2
        while name.lower() in taken:
            name = "%s%d" % (base, i)
            i += 1
    return name


def UploadFTP(program: Any, robot_ip: str, remote_path: str, ftp_user: str, ftp_pass: str, pause_sec: float = 2) -> bool:
    pass
    import ftplib
    import time

    files = program if isinstance(program, (list, tuple)) else [program]
    paths: List[str] = []
    for f in files:
        f = str(f)
        if os.path.isdir(f):
            paths += [os.path.join(f, n) for n in sorted(os.listdir(f)) if os.path.isfile(os.path.join(f, n))]
        else:
            paths.append(f)
    try:
        print("POPUP: <p>Connecting to <strong>%s</strong> using user name <strong>%s</strong> and password ****</p>" % (robot_ip, ftp_user))
        ftp = ftplib.FTP(robot_ip, timeout=10)
        ftp.login(ftp_user, ftp_pass)
        if remote_path:
            ftp.cwd(remote_path)
        for path in paths:
            print("POPUP: Sending %s ..." % os.path.basename(path))
            with open(path, "rb") as fh:
                ftp.storbinary("STOR " + os.path.basename(path), fh)
        ftp.quit()
    except (OSError, ftplib.Error) as exc:
        print("POPUP: <font color=\"red\">Connection to %s failed: %s</font>" % (robot_ip, exc))
        time.sleep(pause_sec)
        return False
    print("POPUP: Done")
    time.sleep(pause_sec)
    return True
