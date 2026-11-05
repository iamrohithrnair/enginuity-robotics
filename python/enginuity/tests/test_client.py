# Checks client handshake, errors and reconnection against a fake socket server.







import json
import logging
import os
import socket
import struct
import sys
import threading
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src"))

from enginuity import (  # noqa: E402
    InputError,
    InvalidItemError,
    Item,
    Enginuity,
    EnginuityConnectionError,
    EnginuityError,
    EnginuityTimeoutError,
    NotSupportedError,
    TargetReachError,
)
from enginuity._protocol import Encoder  # noqa: E402


class FakeServer:
    pass

    def __init__(self, commands_json=None, close_after=None, silent=()):
        self.sock = socket.socket()
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(8)
        self.port = self.sock.getsockname()[1]
        self.commands_json = commands_json
        self.close_after = close_after
        self.silent = set(silent)
        self.connections = 0
        self.received = []
        self.names = {}
        self._stop = False
        threading.Thread(target=self._accept, daemon=True).start()

    def close(self):
        self._stop = True
        self.sock.close()

    def _accept(self):
        while not self._stop:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            self.connections += 1
            threading.Thread(target=self._serve, args=(conn,), daemon=True).start()

    def _serve(self, conn):
        f = conn.makefile("rb")

        def line():
            raw = f.readline()
            if not raw:
                raise EOFError
            return raw.decode("utf-8").rstrip("\n")

        def i32():
            return struct.unpack(">i", f.read(4))[0]

        def h64():
            return struct.unpack(">Q", f.read(8))[0]

        def arr():
            n = i32()
            return list(struct.unpack(">%dd" % n, f.read(8 * n))) if n else []

        def send(enc):
            conn.sendall(enc.payload())

        try:
            assert line() == "RDK_API"
            flags = arr()
            self.skip = len(flags) > 2 and flags[2] != 0
            send(Encoder().line("RDK_API").int(1).int(26935).int(0))
            count = 0
            while True:
                name = line()
                count += 1
                self.received.append(name)
                if name in self.silent:
                    time.sleep(5)
                    continue
                if name == "G_Name":
                    h = h64()
                    if h == 0 or h == 666:
                        send(Encoder().line("(unavailable)").int(1))
                    else:
                        send(Encoder().line(self.names.get(h, "Item%d" % h)).int(0))
                elif name == "S_Name":
                    h = h64()
                    self.names[h] = line()
                    if not self.skip:
                        send(Encoder().int(0))
                elif name == "G_Item_Type":
                    h = h64()
                    send(Encoder().int(-1 if h == 666 else 5).int(0))
                elif name == "G_Param":
                    p = line()
                    send(Encoder().line("UNKNOWN " + p).int(2).line("Invalid/unknown parameter to get: " + p))
                elif name == "MoveX":
                    i32(), i32(), arr(), h64(), h64()
                    send(Encoder().int(10).line("Target cannot be reached"))
                elif name == "SCMD":
                    cmd, _value = line(), line()
                    if cmd == "EnginuityApi" and self.commands_json is not None:
                        send(Encoder().line(json.dumps({"product": "Enginuity", "commands": self.commands_json})).int(0))
                    else:
                        send(Encoder().line("(Command)\t(parameter)\t(description)").int(0))
                elif name == "Gun_Clear":
                    i32()
                    send(Encoder().int(1).int(0))
                elif name == "Version":
                    send(Encoder().line("Fake v1").int(64).line("1.0.0.1").line("today").int(0))
                else:
                    send(Encoder().int(3).line("unknown " + name))
                if self.close_after and count >= self.close_after:
                    conn.close()
                    return
        except (EOFError, OSError, AssertionError, struct.error):
            pass
        finally:
            try:
                conn.close()
            except OSError:
                pass


class ClientTest(unittest.TestCase):
    def setUp(self):
        self.srv = FakeServer(commands_json=["G_Name", "S_Name", "SCMD", "Gun_Clear"])

    def tearDown(self):
        self.srv.close()

    def test_handshake_and_commands(self):
        rdk = Enginuity(port=self.srv.port)
        self.assertEqual(rdk.BUILD, 26935)
        it = Item(rdk, 7, 5)
        self.assertEqual(it.Name(), "Item7")
        it.setName("Seven")
        self.assertEqual(it.Name(), "Seven")
        self.assertEqual(repr(it), "Item(object 'Seven', handle=7)")
        self.assertEqual(it, Item(rdk, 7))
        self.assertEqual(len({it, Item(rdk, 7), Item(rdk, 8)}), 2)
        rdk.Disconnect()

    def test_status_errors_keep_the_connection(self):
        rdk = Enginuity(port=self.srv.port)
        with self.assertRaises(InvalidItemError) as inv:
            Item(rdk, 666).Name()
        self.assertIn("Invalid item provided", str(inv.exception))
        with self.assertRaises(InputError):
            Item(rdk, 0).Delete()  
        with self.assertRaises(TargetReachError) as cm:
            Item(rdk, 2, 2).MoveJ([0, 0, 0, 0, 0, 0], False)
        self.assertEqual(str(cm.exception), "Target cannot be reached")
        with self.assertRaises(EnginuityError):
            rdk.CloseStation()  
        with self.assertLogs("enginuity", logging.DEBUG):
            self.assertIsNone(rdk.getParam("Nope"))
        self.assertFalse(Item(rdk, 666).Valid(True))
        self.assertEqual(Item(rdk, 1).Name(), "Item1")
        self.assertEqual(self.srv.connections, 1)
        rdk.Disconnect()

    def test_reconnects_when_the_server_closed_the_connection(self):
        srv = FakeServer(close_after=1)
        try:
            rdk = Enginuity(port=srv.port)
            self.assertEqual(Item(rdk, 1).Name(), "Item1")
            time.sleep(0.1)
            self.assertEqual(Item(rdk, 2).Name(), "Item2")
            self.assertEqual(srv.connections, 2)
            rdk.Disconnect()
        finally:
            srv.close()

    def test_timeout_drops_and_next_call_reconnects(self):
        srv = FakeServer(silent={"Version"})
        try:
            rdk = Enginuity(port=srv.port, timeout=0.3)
            with self.assertRaises(EnginuityTimeoutError):
                rdk.Version()
            self.assertIsNone(rdk._sock)
            self.assertEqual(Item(rdk, 3).Name(), "Item3")
            self.assertEqual(srv.connections, 2)
            rdk.Disconnect()
        finally:
            srv.close()

    def test_optional_commands_are_refused_before_sending(self):
        rdk = Enginuity(port=self.srv.port)
        with self.assertRaises(NotSupportedError):
            rdk.Spray_Add()
        self.assertNotIn("Gun_Add", self.srv.received)
        self.assertEqual(rdk.Spray_Clear(), 1)
        self.assertEqual(self.srv.received.count("SCMD"), 1)
        rdk.Disconnect()

    def test_servers_without_a_command_list_get_every_command(self):
        srv = FakeServer(commands_json=None)
        try:
            rdk = Enginuity(port=srv.port)
            self.assertEqual(rdk.Spray_Clear(), 1)
            rdk.Disconnect()
        finally:
            srv.close()

    def test_skip_status_mode(self):
        rdk = Enginuity(port=self.srv.port, skipstatus=True)
        it = Item(rdk, 9)
        it.setName("Nine")
        self.assertEqual(it.Name(), "Nine")
        rdk.Disconnect()

    def test_threads_share_one_connection(self):
        rdk = Enginuity(port=self.srv.port)
        errors = []

        def work(h):
            try:
                for _ in range(50):
                    if Item(rdk, h).Name() != "Item%d" % h:
                        errors.append(h)
            except Exception as e:  # noqa: BLE001
                errors.append(e)

        threads = [threading.Thread(target=work, args=(h,)) for h in range(10, 18)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(errors, [])
        self.assertEqual(self.srv.connections, 1)
        rdk.Disconnect()

    def test_context_manager_and_not_running(self):
        with Enginuity(port=self.srv.port) as rdk:
            self.assertEqual(Item(rdk, 4).Name(), "Item4")
        self.assertIsNone(rdk._sock)
        with self.assertRaises(EnginuityConnectionError) as cm:
            Enginuity(port=1, connect_timeout=1)
        self.assertIn("Enginuity is not running on localhost:1", str(cm.exception))

    def test_environment_settings(self):
        os.environ["ENGINUITY_API_PORT"] = str(self.srv.port)
        os.environ["ENGINUITY_HOST"] = "127.0.0.1"
        os.environ["ENGINUITY_API_TIMEOUT"] = "12"
        try:
            rdk = Enginuity()
            self.assertEqual((rdk.host, rdk.port, rdk.timeout), ("127.0.0.1", self.srv.port, 12.0))
            rdk.Disconnect()
        finally:
            for k in ("ENGINUITY_API_PORT", "ENGINUITY_HOST", "ENGINUITY_API_TIMEOUT"):
                os.environ.pop(k, None)


class ImportInstallTest(unittest.TestCase):
    def test_explains_instead_of_installing(self):
        from enginuity.robolink import import_install

        self.assertIsNone(import_install("json"))
        with self.assertRaises(ImportError) as cm:
            import_install("enginuity_missing_module_for_test", "missing-dist")
        self.assertIn("-m pip install --user missing-dist", str(cm.exception))
        self.assertNotIn("enginuity_missing_module_for_test", sys.modules)


if __name__ == "__main__":
    unittest.main()
