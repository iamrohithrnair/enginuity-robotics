# Checks post output and expected failures against black-box program captures.








import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "python"))

from robocraft_post.base import REGISTRY, get_post  # noqa: E402
from blackbox import cases, check, known_divergence  # noqa: E402


class BlackBoxParityTest(unittest.TestCase):
    def test_every_capture_of_every_registered_post(self):
        compared = 0
        for case in cases():
            if get_post(case.post) is None:
                continue  
            with self.subTest(case="%s/%s/%s" % (case.post, case.shape, case.probe)):
                outcome = check(case, diff_lines=12)
                if known_divergence(case):
                    
                    self.assertFalse(outcome.ok, "now matches the reference application: remove it from KNOWN_DIVERGENCES")
                    continue
                self.assertTrue(outcome.ok, "\n".join(outcome.problems))
            compared += 1
        self.assertGreater(compared, 0, "no black-box captures found")

    def test_registered_posts_are_real(self):
        pass
        for name, cls in REGISTRY.items():
            self.assertEqual(cls.name, name, "%s is registered as an alias of %s" % (name, cls.name))

    def test_coverage_report(self):
        captured = sorted({c.post for c in cases()})
        missing = [p for p in captured if get_post(p) is None]
        print("\nblack-box captures: %d posts, implemented %d, missing %d" % (len(captured), len(captured) - len(missing), len(missing)))


if __name__ == "__main__":
    unittest.main()
