# Captures post-generated files and API traffic through a logging TCP proxy.
























import argparse
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import postgen_blackbox as pb  # noqa: E402

sys.path.insert(0, os.path.join(pb.ROOT, "python", "enginuity", "src"))
from enginuity import Robolink  # noqa: E402

SERVER_PORT = 20610  
PROXY_PORT = 20631  


class Proxy:
    pass

    def __init__(self):
        self.log = []
        self.lock = threading.Lock()
        self.sock = socket.socket()
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", PROXY_PORT))
        self.sock.listen(8)
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self):
        while True:
            try:
                client, _ = self.sock.accept()
            except OSError:
                return
            server = socket.create_connection(("127.0.0.1", SERVER_PORT))
            threading.Thread(target=self._pump, args=(client, server, ">"), daemon=True).start()
            threading.Thread(target=self._pump, args=(server, client, "<"), daemon=True).start()

    def _pump(self, src, dst, tag):
        try:
            while True:
                data = src.recv(65536)
                if not data:
                    break
                with self.lock:
                    self.log.append((tag, data))
                dst.sendall(data)
        except OSError:
            pass
        finally:
            for s_ in (src, dst):
                try:
                    s_.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

    def take(self):
        with self.lock:
            out, self.log = self.log, []
        return out


def execute(out_dir, prog, lines, meta, proxy):
    if os.path.isdir(out_dir):
        shutil.rmtree(out_dir)
    os.makedirs(out_dir)
    lines = lines + ["r.ProgSave(%s,%s,False,False)" % (pb.s(out_dir + "/"), pb.s(prog))]
    text = "\n".join(lines) + "\n"
    sandbox = '(version 1)(allow default)(deny network*)(allow network-outbound (remote ip "localhost:%d"))' % PROXY_PORT
    with tempfile.TemporaryDirectory(prefix="pgbb-") as work:
        script = os.path.join(work, "Post%s.py" % prog)
        with open(script, "w", encoding="utf-8") as fh:
            fh.write(text)
        env = {
            "PATH": "/usr/bin:/bin",
            "HOME": work,
            "TMPDIR": work + "/",
            "PYTHONPATH": pb.HOOKS + ":" + pb.PYPATH,
            "POSTGEN_HOOK_DIR": out_dir,
            "PYTHONIOENCODING": "utf8",
            "PYTHON_EXEC": pb.PYTHON,
            "ROBODK_API_PORT": str(PROXY_PORT),
            "ENGINUITY_API_PORT": str(PROXY_PORT),
        }
        proxy.take()
        try:
            res = subprocess.run(["sandbox-exec", "-p", sandbox, pb.PYTHON, script], cwd=work, env=env, capture_output=True, timeout=90)
            code, out, err = res.returncode, res.stdout, res.stderr
        except subprocess.TimeoutExpired as exc:
            code, out, err = "timeout", exc.stdout or b"", exc.stderr or b""
    traffic = proxy.take()
    with open(os.path.join(out_dir, "intermediate_Post%s.py" % prog), "w", encoding="utf-8") as fh:
        fh.write(text)
    with open(os.path.join(out_dir, "_run.json"), "w", encoding="utf-8") as fh:
        json.dump(dict(meta, exit=code, api_standin=True, hooks=True), fh, indent=1)
    with open(os.path.join(out_dir, "_stdout.txt"), "wb") as fh:
        fh.write(out or b"")
    with open(os.path.join(out_dir, "_stderr.txt"), "wb") as fh:
        fh.write(err or b"")
    with open(os.path.join(out_dir, "_api.log"), "w", encoding="utf-8") as fh:
        for tag, data in traffic:
            fh.write("%s %s\n" % (tag, data.hex()))
    return code, (err or b"").decode("utf-8", "replace").strip().splitlines()[-1:]


def run_targeted(args, robot, handle, proxy):
    import postgen_targeted as pt

    spec = pt.load(args.targeted)
    for exp in spec["EXPS"]:
        label, body = exp[0], exp[1]
        if args.probe and label not in args.probe:
            continue
        prog = pt.PROG
        body = [ln.strip() for ln in body.strip().splitlines() if ln.strip()]
        head = pb.header(args.post, prog, len(body), robot, args.nq)
        lines = head + (body if body[0].startswith("r.ProgStart(") else pb.start(prog, robot) + body)
        if not body[-1].startswith("r.ProgFinish("):
            lines.append("r.ProgFinish(%s)" % pb.s(prog))
        lines = [ln.replace("api_port=20524", "api_port=%d" % PROXY_PORT).replace("robot_ptr=47963324432", "robot_ptr=%d" % handle) for ln in lines]
        out_dir = os.path.join(pb.EVIDENCE, args.post, "targeted-api", label)
        meta = {"post": args.post, "robot": robot, "nq": args.nq, "robot_file": os.path.basename(args.robot_file), "targeted": label}
        code, last = execute(out_dir, prog, lines, meta, proxy)
        print("%-14s exit=%-7s %s" % (label, code, " | ".join(last)), flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("post")
    ap.add_argument("robot_file")
    ap.add_argument("nq", type=int, nargs="?", default=6)
    ap.add_argument("--probe", action="append")
    ap.add_argument("--targeted", help="run the streams of postgen_targeted/<TARGETED>.py")
    args = ap.parse_args()
    rdk = Robolink(port=SERVER_PORT)
    rdk.AddStation("wpF3-%s-standin" % args.post)
    try:
        robot = rdk.AddFile(os.path.abspath(args.robot_file))
        name = robot.Name()
        handle = robot.item
        print("robot %r handle %d" % (name, handle), flush=True)
        proxy = Proxy()
        if args.targeted:
            run_targeted(args, name, handle, proxy)
            return
        for probe in pb.PROBES:
            label = probe.__name__[len("probe_"):]
            if args.probe and label not in args.probe:
                continue
            prog, lines = pb.build(args.post, name, args.nq, probe)
            lines = [ln.replace("api_port=20524", "api_port=%d" % PROXY_PORT).replace("robot_ptr=47963324432", "robot_ptr=%d" % handle) for ln in lines]
            out_dir = os.path.join(pb.EVIDENCE, args.post, "%dax-api" % args.nq, label)
            code, last = execute(out_dir, prog, lines, {"post": args.post, "robot": name, "nq": args.nq, "robot_file": os.path.basename(args.robot_file)}, proxy)
            print("%-10s exit=%-7s %s" % (label, code, " | ".join(last)), flush=True)
    finally:
        rdk.CloseStation()


if __name__ == "__main__":
    main()
