





import os
import socket
import struct
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src"))

from enginuity import robomath as rm  # noqa: E402
from enginuity._protocol import Encoder, WireSocket, pose_col_major, pose_from_col_major  # noqa: E402
from enginuity.errors import EnginuityConnectionError, EnginuityTimeoutError, ProtocolError  # noqa: E402


def pair():
    a, b = socket.socketpair()
    return WireSocket(a, "test"), b


class EncoderTest(unittest.TestCase):
    def test_handshake_bytes(self):
        
        data = Encoder().line("RDK_API").array([1, 0, 0]).payload()
        self.assertEqual(
            data.hex(),
            "52444b5f4150490a" + "00000003" + "3ff0000000000000" + "0000000000000000" + "0000000000000000",
        )

    def test_lines_replace_line_breaks(self):
        self.assertEqual(Encoder().line("a\nb\r\nc").payload(), b"a<br>b<br>c\n")
        self.assertEqual(Encoder().line("x\ny", br="<<br>>").payload(), b"x<<br>>y\n")
        self.assertEqual(Encoder().line("été").payload(), "été\n".encode("utf-8"))

    def test_ints_and_handles(self):
        self.assertEqual(Encoder().int(-1).payload(), b"\xff\xff\xff\xff")
        self.assertEqual(Encoder().int(5000.4).payload(), struct.pack(">i", 5000))
        self.assertEqual(Encoder().handle(0x0000000BEF504A10).payload().hex(), "0000000bef504a10")
        with self.assertRaises(OverflowError):
            Encoder().int(2 ** 31)

    def test_pose_is_column_major(self):
        
        p = rm.transl(100, 200, 300) * rm.rotz(rm.pi / 2)
        values = struct.unpack(">16d", Encoder().pose(p).payload())
        self.assertAlmostEqual(values[0], 0.0)
        self.assertAlmostEqual(values[1], 1.0)  
        self.assertEqual(values[12:15], (100.0, 200.0, 300.0))
        self.assertEqual(pose_col_major(pose_from_col_major(values)), list(values))

    def test_matrix_and_floats(self):
        m = rm.Mat([[1, 2, 3], [4, 5, 6]])
        data = Encoder().matrix(m).payload()
        self.assertEqual(struct.unpack(">ii6d", data), (2, 3, 1.0, 4.0, 2.0, 5.0, 3.0, 6.0))
        data = Encoder().matrix_f(m).payload()
        self.assertEqual(struct.unpack(">ii6f", data), (2, 3, 1.0, 4.0, 2.0, 5.0, 3.0, 6.0))
        self.assertEqual(Encoder().array_f([1.5]).payload(), struct.pack(">if", 1, 1.5))
        self.assertEqual(Encoder().bytes(b"ab").payload(), b"\x00\x00\x00\x02ab")
        self.assertEqual(Encoder().xyz([1, 2]).payload(), struct.pack(">3d", 1, 2, 0))


class ReaderTest(unittest.TestCase):
    def test_reads_every_type(self):
        w, peer = pair()
        try:
            m = rm.Mat([[1, 2, 3], [4, 5, 6]])
            peer.sendall(
                Encoder().line("hello<br>").int(-7).handle(42).int(4).pose(rm.transl(1, 2, 3)).array([1.5, 2.5]).matrix(m).bytes(b"\x00\x01").xyz([7, 8, 9]).payload()
            )
            peer.sendall(struct.pack(">i", 3) + b"bad thing<br>more\n" + struct.pack(">i", 0))
            self.assertEqual(w.read_line(), "hello<br>")
            self.assertEqual(w.read_int(), -7)
            self.assertEqual(w.read_item_ref(), (42, 4))
            self.assertEqual(w.read_pose().Pos(), [1.0, 2.0, 3.0])
            self.assertEqual(w.read_array(), [1.5, 2.5])
            self.assertEqual(w.read_matrix().rows, m.rows)
            self.assertEqual(w.read_bytes(), b"\x00\x01")
            self.assertEqual(w.read_xyz(), [7.0, 8.0, 9.0])
            self.assertEqual(w.read_status(), (3, "bad thing<br>more"))  
            self.assertEqual(w.read_status(), (0, ""))
        finally:
            w.close()
            peer.close()

    def test_errors(self):
        w, peer = pair()
        peer.sendall(struct.pack(">i", -5))
        with self.assertRaises(ProtocolError):
            w.read_array()
        w.settimeout(0.05)
        with self.assertRaises(EnginuityTimeoutError):
            w.read_int()
        peer.close()
        with self.assertRaises(EnginuityConnectionError):
            w.read_int()
        w.close()

    def test_peer_closed_detection(self):
        w, peer = pair()
        self.assertFalse(w.peer_closed())
        peer.close()
        self.assertTrue(w.peer_closed())
        w.close()


if __name__ == "__main__":
    unittest.main()
