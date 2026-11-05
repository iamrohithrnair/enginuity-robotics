# Registers OmniCore and S4C output variants of the ABB RAPID post processor.











from ..base import register, strip_name
from ..robomath import fixed, quaternion, xyz
from .abb_rapid import AbbRapidIrc5


@register
class AbbRapidOmniCore(AbbRapidIrc5):
    name = "ABB_RAPID_OmniCore"
    PROG_EXT = "modx"


@register
class AbbRapidS4C(AbbRapidIrc5):
    name = "ABB_RAPID_S4C"
    PROG_EXT = "prg"

    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.WOBJ = strip_name(frame_name, "rdkWObj")
        decl = 'PERS wobjdata %s := [FALSE, TRUE, "", [[%s],[%s]],[[0,0,0],[1,0,0,0]]];' % (self.WOBJ, fixed(xyz(pose), 3), fixed(quaternion(pose), 8))
        if decl not in self.FRAMES:
            self.FRAMES.append(decl)
